import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { resolveAndroidPilotToolchain } from './android-build-identity';
import {
  runOwnedAndroidNativeSession,
  type AndroidOwnedNativeSessionPreparation,
} from './capture-android-testability';
import { readQualifiedNativeQuantityFailure } from './native-maestro-assertion-failure';
import { requireNativePilotAssertions, selectNativePilotScenario } from './native-pilot-contract';
import { nativeExecutionDeadlines } from './native-runtime-preflight';
import { writeNativeTrainingAttemptBinding } from './native-training-attempt-binding';
import {
  normalizeNativeCommandDiagnostic,
  trainingAttemptChildExitCode,
} from './native-training-attempt-outcome';
import { observeAndroidSavedTrainingJourney } from './native-training-maestro-driver';
import {
  prepareAndroidTrainingPilotEvidence,
  writeAndroidTrainingRuntimeFrames,
} from './native-training-pilot-evidence';
import { inspectPrivateAndroidDirectory } from './owned-android-emulator';
import { verifyOwnedAndroidCleanup } from './verify-owned-android-cleanup';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeExecutionDeadlines } from './native-runtime-preflight';
import type {
  NativeCommandDiagnostic,
  NativeCommandExecution,
  NativeCommandOutputFailure,
} from './native-training-attempt-outcome';
import type { AndroidMaestroQualifiedBuildReuse } from './t15-cold-android-maestro-build-reuse';

export {
  normalizeNativeCommandDiagnostic as normalizeAndroidCommandDiagnostic,
  requireSuccessfulNativeCommandDiagnostics,
} from './native-training-attempt-outcome';

export type {
  NativeCommandDiagnostic,
  NativeCommandExecution,
  NativeCommandOutputFailure,
} from './native-training-attempt-outcome';

const id = /^[a-f0-9]{24}$/;

export type AndroidCommandExecution = NativeCommandExecution;
export type AndroidOutputFailure = NativeCommandOutputFailure;
export type AndroidCommandDiagnostic = NativeCommandDiagnostic;

type NativeAssertionBinding = {
  id: string;
  requirementRefs: string[];
  evidencePaths: string[];
};

export type AndroidTrainingAttemptResult = {
  kind: 'private-owned-android-training-attempt-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  captureExitCode: number;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  childClassification:
    | 'completed'
    | 'child-failed'
    | 'deadline'
    | 'cancelled'
    | 'output-limit'
    | 'output-failed'
    | 'harness-blocked'
    | null;
  captureResult: string;
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGINT' | 'SIGTERM' | null;
  callbackInvocations: number;
  callbackCompleted: boolean;
  externalCleanupResult: 'passed' | 'failed';
  verificationResult: 'passed' | 'failed' | 'not-executed' | 'application-failed';
  applicationFailure: { assertionId: string; label: string; candidateHash: string } | null;
  verificationFailure: { name: string; message: string } | null;
  postCaptureFailure: {
    phase: 'cleanup' | 'verification' | 'adapter-write';
    name: string;
    message: string;
  } | null;
  deadline: { step: string; deadlineMs: number } | null;
  commandDiagnostics: AndroidCommandDiagnostic[];
  censusFailures: unknown[];
  outputFailures: NonNullable<AndroidCommandDiagnostic['outputFailure']>[];
  assertionBindings: NativeAssertionBinding[];
  fixtureRunId: string | null;
  fixtureHash: string | null;
  flagsHash: string | null;
  toolVersions: Record<string, string>;
  timingsMs: {
    build: number;
    install: number;
    reset: number;
    scenario: number;
    verify: number;
    cleanup: number;
  };
  nativePassingCases: 0;
  artifactRoot: string;
};

type PostCaptureFailure = NonNullable<AndroidTrainingAttemptResult['postCaptureFailure']>;

function postCaptureFailure(phase: PostCaptureFailure['phase'], error: unknown) {
  return {
    phase,
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : 'Android post-capture processing failed',
  } as const;
}

/** Actual owned execution. Public receipt finalization remains a separate checked boundary. */
export async function runAndroidTrainingAttempt(options: {
  repositoryRoot: string;
  requestedRunId: string;
  selection: NativePilotSelection;
  signal: AbortSignal;
  deadlines?: NativeExecutionDeadlines;
  deadlineAtMonotonicMs?: number;
  coldResetOwnerRunId?: string;
  coldResetFixtureResetId?: string;
  prepareColdReset?: AndroidOwnedNativeSessionPreparation;
  qualifiedBuild?: AndroidMaestroQualifiedBuildReuse;
}) {
  assert.match(options.requestedRunId, id);
  nativeExecutionDeadlines(options.deadlines);
  options.signal.throwIfAborted();
  const root = await realpath(options.repositoryRoot);
  const current = await selectNativePilotScenario(
    options.selection.arguments,
    JSON.parse(await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8')),
    root,
  );
  assert.deepEqual(
    options.selection,
    current,
    'Public native selection changed before acquisition',
  );
  assert.deepEqual(current.arguments, {
    platform: 'android',
    engine: 'maestro',
    scenario: 'SCN-training-android',
    mode: 'integration',
  });
  assert.equal(requireNativePilotAssertions(current).length, 7);
  options.signal.throwIfAborted();
  assert.equal(
    root,
    await realpath(path.resolve(__dirname, '../..')),
    'Android capture repository differs',
  );
  const hostRoot = process.env.MYCHAMPIONS_NATIVE_STATE_ROOT;
  assert(hostRoot, 'Use the shared native host-lock wrapper');
  await inspectPrivateAndroidDirectory(hostRoot);
  const androidRuntimeParent = path.join(path.dirname(hostRoot), 'mychampions-android-pilot');
  await inspectPrivateAndroidDirectory(androidRuntimeParent);
  const toolchain = await resolveAndroidPilotToolchain();
  options.signal.throwIfAborted();
  let callbackInvocations = 0;
  let callbackCompleted = false;
  const capture = await runOwnedAndroidNativeSession({
    charter: 'training-journey',
    signal: options.signal,
    deadlines: options.deadlines,
    deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    coldResetOwnerRunId: options.coldResetOwnerRunId,
    coldResetFixtureResetId: options.coldResetFixtureResetId,
    prepareColdReset: options.prepareColdReset,
    qualifiedBuild: options.qualifiedBuild,
    executeTraining: async (context) => {
      callbackInvocations++;
      assert.equal(callbackInvocations, 1, 'Training callback must execute once');
      assert.equal(context.fixtures.scope, 'native-entry-android');
      const binding = await writeNativeTrainingAttemptBinding({
        repositoryRoot: root,
        artifactRoot: context.output,
        requestedRunId: options.requestedRunId,
        backendRunId: context.fixtures.runId,
        selection: current,
      });
      const report: Record<string, unknown> = {};
      await observeAndroidSavedTrainingJourney({ ...context, report });
      const journey = report.trainingJourney as {
        input: { runId: string; attemptId: string };
        sixSqlCheckpoints: boolean;
        threeAuthenticatedApiReads: boolean;
        savedPlanDurableAfterRestart: boolean;
        publicNativePassingCases: number;
      };
      assert(journey && journey.sixSqlCheckpoints && journey.threeAuthenticatedApiReads);
      assert(journey.savedPlanDurableAfterRestart);
      assert.equal(journey.publicNativePassingCases, 0);
      assert.equal(journey.input.runId, binding.backendRunId);
      assert.equal(journey.input.attemptId, binding.backendAttemptId);
      await writeFile(
        path.join(context.output, 'training-runtime-metadata.private.json'),
        JSON.stringify({
          ...journey,
          requestedAttemptId: binding.requestedAttemptId,
          selection: binding.selection,
        }),
        { flag: 'wx', mode: 0o600 },
      );
      callbackCompleted = true;
    },
  });
  const cleanupStarted = performance.now();
  let externalCleanupResult: 'passed' | 'failed' = 'failed';
  let cleanupFailure: AndroidTrainingAttemptResult['postCaptureFailure'] = null;
  try {
    const externalCleanup = await verifyOwnedAndroidCleanup({
      repositoryRoot: root,
      artifactRoot: capture.artifactRoot,
      androidRuntimeParent,
      sdkRoot: toolchain.sdkRoot,
    });
    externalCleanupResult = externalCleanup.result === 'passed' ? 'passed' : 'failed';
  } catch (error) {
    // The capture and its original cleanup ledger remain authoritative even if
    // a second read-only cleanup receipt cannot be produced.
    cleanupFailure = postCaptureFailure('cleanup', error);
  }
  const cleanupMs = performance.now() - cleanupStarted;
  const verifyStarted = performance.now();
  let assertionEvidence: Awaited<ReturnType<typeof prepareAndroidTrainingPilotEvidence>> | null =
    null;
  let verificationResult: 'passed' | 'failed' | 'not-executed' | 'application-failed' =
    'not-executed';
  let applicationFailure: { assertionId: string; label: string; candidateHash: string } | null =
    null;
  let verificationFailure: { name: string; message: string } | null = null;
  let postCaptureFailureRecord: AndroidTrainingAttemptResult['postCaptureFailure'] = cleanupFailure;
  if (
    capture.report.applicationFailureCandidate &&
    callbackInvocations === 1 &&
    !callbackCompleted &&
    externalCleanupResult === 'passed' &&
    !options.signal.aborted
  ) {
    try {
      const proof = readQualifiedNativeQuantityFailure({
        captureRoot: capture.artifactRoot,
        requestedRunId: options.requestedRunId,
        fixtureRunId: (capture.report.backend as { runId: string }).runId,
        selection: current,
      });
      applicationFailure = {
        assertionId: proof.assertionId,
        label: proof.label,
        candidateHash: proof.candidateHash,
      };
      verificationResult = 'application-failed';
    } catch (error) {
      verificationResult = 'failed';
      verificationFailure =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: 'UnknownError', message: 'Android failure qualification rejected' };
      postCaptureFailureRecord ??= postCaptureFailure('verification', error);
    }
  }
  if (
    capture.exitCode === 0 &&
    callbackCompleted &&
    externalCleanupResult === 'passed' &&
    !options.signal.aborted
  ) {
    try {
      await writeAndroidTrainingRuntimeFrames(capture.artifactRoot);
      assertionEvidence = await prepareAndroidTrainingPilotEvidence({
        repositoryRoot: root,
        artifactRoot: capture.artifactRoot,
        selection: current,
        purpose: 'runtime',
        requestedRunId: options.requestedRunId,
      });
      verificationResult = 'passed';
    } catch (error) {
      verificationResult = 'failed';
      verificationFailure =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: 'UnknownError', message: 'Android evidence verification rejected' };
      postCaptureFailureRecord ??= postCaptureFailure('verification', error);
    }
  }
  const rawCommandExecutions = Array.isArray(capture.report.commandExecutions)
    ? capture.report.commandExecutions
    : [];
  const commandDiagnostics = rawCommandExecutions.map(normalizeNativeCommandDiagnostic);
  const childSignal =
    commandDiagnostics.find((row) => row.childSignal !== null)?.childSignal ?? null;
  const childClassification =
    commandDiagnostics.find((row) => row.execution !== null && row.execution !== 'completed')
      ?.execution ?? (callbackCompleted ? 'completed' : null);
  const censusFailures = commandDiagnostics
    .map((row) => row.censusFailure)
    .filter((value): value is unknown => value !== null);
  const outputFailures = commandDiagnostics
    .map((row) => row.outputFailure)
    .filter((failure): failure is NonNullable<typeof failure> => failure !== null);
  const captureTimings = (capture.report.timingsMs ?? {}) as Record<string, unknown>;
  const outcome: Omit<AndroidTrainingAttemptResult, 'artifactRoot'> = {
    kind: 'private-owned-android-training-attempt-not-public-receipt',
    requestedRunId: options.requestedRunId,
    requestedAttemptId: `${options.requestedRunId}:first`,
    captureRunId: path.basename(capture.artifactRoot),
    captureExitCode: capture.exitCode,
    childExitCode: trainingAttemptChildExitCode(commandDiagnostics, callbackCompleted),
    childSignal,
    childClassification,
    captureResult:
      typeof capture.report.result === 'string' ? capture.report.result : 'harness-blocked',
    captureTimeout: capture.report.budgetTimeout === 'whole-capture' ? 'whole-capture' : null,
    cancellation:
      capture.report.cancellation === 'SIGINT' || capture.report.cancellation === 'SIGTERM'
        ? capture.report.cancellation
        : null,
    callbackInvocations,
    callbackCompleted,
    externalCleanupResult,
    verificationResult,
    applicationFailure,
    verificationFailure,
    postCaptureFailure: postCaptureFailureRecord,
    deadline:
      capture.report.deadline &&
      typeof capture.report.deadline === 'object' &&
      typeof (capture.report.deadline as Record<string, unknown>).step === 'string' &&
      typeof (capture.report.deadline as Record<string, unknown>).deadlineMs === 'number'
        ? (capture.report.deadline as { step: string; deadlineMs: number })
        : null,
    commandDiagnostics,
    censusFailures,
    outputFailures,
    assertionBindings: assertionEvidence?.bindings ?? [],
    fixtureRunId: (capture.report.backend as { runId?: string } | undefined)?.runId ?? null,
    fixtureHash: (capture.report.fixtureHash as string | undefined) ?? null,
    flagsHash:
      (capture.report.build as { environmentHash?: string } | undefined)?.environmentHash ?? null,
    toolVersions: (capture.report.toolVersions as Record<string, string> | undefined) ?? {},
    timingsMs: {
      build: typeof captureTimings.build === 'number' ? captureTimings.build : 0,
      install: typeof captureTimings.install === 'number' ? captureTimings.install : 0,
      reset: typeof captureTimings.reset === 'number' ? captureTimings.reset : 0,
      scenario: typeof captureTimings.scenario === 'number' ? captureTimings.scenario : 0,
      verify:
        (typeof captureTimings.verify === 'number' ? captureTimings.verify : 0) +
        performance.now() -
        verifyStarted,
      cleanup:
        (typeof captureTimings.cleanup === 'number' ? captureTimings.cleanup : 0) + cleanupMs,
    },
    nativePassingCases: 0,
  };
  try {
    await writeFile(
      path.join(capture.artifactRoot, 'runtime-adapter.private.json'),
      JSON.stringify(outcome, null, 2),
      {
        flag: 'wx',
        mode: 0o600,
      },
    );
  } catch (error) {
    outcome.postCaptureFailure ??= postCaptureFailure('adapter-write', error);
  }
  return { ...outcome, artifactRoot: capture.artifactRoot };
}
