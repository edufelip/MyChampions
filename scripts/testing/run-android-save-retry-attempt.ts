import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { resolveAndroidPilotToolchain } from './android-build-identity';
import {
  runOwnedAndroidNativeSession,
  type AndroidSaveRetryRuntimeContext,
  type AndroidOwnedNativeSessionPreparation,
} from './capture-android-testability';
import {
  prepareAndroidSaveRetryPilotEvidence,
  writeAndroidSaveRetryRuntimeFrames,
} from './native-android-save-retry-public-evidence';
import { requireNativePilotAssertions, selectNativePilotScenario } from './native-pilot-contract';
import { nativeExecutionDeadlines } from './native-runtime-preflight';
import {
  requireNativeSaveRetryAssertionContract,
  writeNativeSaveRetryAttemptBinding,
} from './native-save-retry-attempt-binding';
import { observeAndroidSaveRetry } from './native-save-retry-observation';
import {
  normalizeNativeCommandDiagnostic,
  requireSuccessfulNativeCommandDiagnostics,
  trainingAttemptChildExitCode,
} from './native-training-attempt-outcome';
import { observeNativeTrainingDraft } from './native-training-observation';
import { inspectPrivateAndroidDirectory } from './owned-android-emulator';
import { verifyOwnedAndroidCleanup } from './verify-owned-android-cleanup';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeExecutionDeadlines } from './native-runtime-preflight';
import type { NativeSaveRetryAttemptBinding } from './native-save-retry-attempt-binding';
import type { AndroidMaestroQualifiedBuildReuse } from './t15-cold-android-maestro-build-reuse';

const id = /^[a-f0-9]{24}$/;

type PostCaptureFailure = {
  phase: 'cleanup' | 'verification' | 'adapter-write';
  name: string;
  message: string;
};

type SaveRetryPreparation = { faultAttemptId?: unknown; attemptId?: unknown };

function postCaptureFailure(
  phase: PostCaptureFailure['phase'],
  error: unknown,
): PostCaptureFailure {
  return {
    phase,
    name: error instanceof Error ? error.name : 'UnknownError',
    message:
      error instanceof Error ? error.message : 'Android save/retry post-capture processing failed',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function captureDeadline(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.step !== 'string' ||
    typeof value.deadlineMs !== 'number' ||
    !Number.isFinite(value.deadlineMs)
  )
    return null;
  return { step: value.step, deadlineMs: value.deadlineMs };
}

export type AndroidSaveRetryAttemptResult = {
  kind: 'private-owned-android-save-retry-attempt-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  backendRunId: string | null;
  backendAttemptId: string | null;
  faultAttemptId: string | null;
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
  captureCleanup: unknown;
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGINT' | 'SIGTERM' | null;
  callbackInvocations: number;
  callbackCompleted: boolean;
  externalCleanupResult: 'passed' | 'failed';
  verificationResult: 'passed' | 'failed' | 'not-executed';
  applicationFailure: null;
  applicationFailureCandidate: null;
  verificationFailure: { name: string; message: string } | null;
  postCaptureFailure: PostCaptureFailure | null;
  deadline: { step: string; deadlineMs: number } | null;
  commandDiagnostics: ReturnType<typeof normalizeNativeCommandDiagnostic>[];
  censusFailures: unknown[];
  outputFailures: unknown[];
  assertionBindings: Awaited<ReturnType<typeof prepareAndroidSaveRetryPilotEvidence>>['bindings'];
  assertionBindingsRetired: boolean;
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

/** Suppress reusable assertion bindings after private adapter publication fails. */
export function retireAndroidSaveRetryAssertionBindings(
  outcome: Pick<AndroidSaveRetryAttemptResult, 'assertionBindings' | 'assertionBindingsRetired'>,
): void {
  outcome.assertionBindings = [];
  outcome.assertionBindingsRetired = true;
}

type AndroidSaveRetryAttemptWriter = (
  file: string,
  contents: string,
  options: { flag: 'wx'; mode: 0o600 },
) => Promise<unknown>;

/**
 * Persist the adapter result through the same async failure boundary used by
 * the native runner. A publication failure retires assertion bindings while
 * retaining the terminal diagnostic, so a partial private result cannot be
 * promoted as a native pass.
 */
export async function persistAndroidSaveRetryAttemptOutcome(
  artifactRoot: string,
  outcomeWithoutRoot: Omit<AndroidSaveRetryAttemptResult, 'artifactRoot'>,
  writer: AndroidSaveRetryAttemptWriter = async (file, contents, options) => {
    await writeFile(file, contents, options);
  },
): Promise<AndroidSaveRetryAttemptResult> {
  const outcome = { ...outcomeWithoutRoot, artifactRoot };
  try {
    await writer(
      path.join(artifactRoot, 'runtime-adapter.private.json'),
      JSON.stringify(outcomeWithoutRoot, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    outcome.postCaptureFailure ??= postCaptureFailure('adapter-write', error);
    retireAndroidSaveRetryAssertionBindings(outcome);
  }
  return outcome;
}

/** Android Maestro save/retry execution; final public promotion remains separate. */
export async function runAndroidSaveRetryAttempt(options: {
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
}): Promise<AndroidSaveRetryAttemptResult> {
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
    'Public save/retry selection changed before acquisition',
  );
  assert.deepEqual(current.arguments, {
    platform: 'android',
    engine: 'maestro',
    scenario: 'SCN-save-retry-android',
    mode: 'integration',
  });
  assert.equal(requireNativePilotAssertions(current).length, 5);
  requireNativeSaveRetryAssertionContract(current);
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
  const bindingState: { value: NativeSaveRetryAttemptBinding | null } = { value: null };
  const capture = await runOwnedAndroidNativeSession({
    charter: 'save-retry',
    signal: options.signal,
    deadlines: options.deadlines,
    deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    coldResetOwnerRunId: options.coldResetOwnerRunId,
    coldResetFixtureResetId: options.coldResetFixtureResetId,
    prepareColdReset: options.prepareColdReset,
    qualifiedBuild: options.qualifiedBuild,
    executeSaveRetry: async (context: AndroidSaveRetryRuntimeContext) => {
      callbackInvocations++;
      assert.equal(callbackInvocations, 1, 'Save/retry callback must execute once');
      assert.equal(context.fixtures.scope, 'native-entry-android');
      const binding = await writeNativeSaveRetryAttemptBinding({
        repositoryRoot: root,
        artifactRoot: context.output,
        requestedRunId: options.requestedRunId,
        backendRunId: context.fixtures.runId,
        selection: current,
      });
      bindingState.value = binding;
      await observeNativeTrainingDraft({
        platform: 'android',
        output: context.output,
        savedPlanId: context.fixtures.savedPlanId,
        report: context.report,
        snapshot: context.snapshot,
        observations: () => context.proxy.observations,
        observe: context.observe,
      });
      await observeAndroidSaveRetry({
        output: context.output,
        accountUid: context.accountUid,
        report: context.report,
        snapshot: context.snapshot,
        proxy: context.proxy,
        observe: context.observe,
      });
      const preparation = context.report.saveRetryPreparation as SaveRetryPreparation | undefined;
      assert(preparation && isRecord(preparation), 'Save/retry preparation report is missing');
      assert.equal(preparation.faultAttemptId, binding.faultAttemptId);
      assert.equal(preparation.attemptId, binding.faultAttemptId);
      await writeFile(
        path.join(context.output, 'save-retry-runtime-metadata.private.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            kind: 'private-android-save-retry-runtime-metadata-not-public-receipt',
            requestedRunId: binding.requestedRunId,
            requestedAttemptId: binding.requestedAttemptId,
            captureRunId: binding.captureRunId,
            backendRunId: binding.backendRunId,
            backendAttemptId: binding.backendAttemptId,
            faultAttemptId: binding.faultAttemptId,
            selection: binding.selection,
            assertionContract: binding.assertionContract,
            preparation: context.report.saveRetryPreparation,
            publicNativePassingCases: 0,
          },
          null,
          2,
        ),
        { flag: 'wx', mode: 0o600 },
      );
      callbackCompleted = true;
    },
  });

  const cleanupStarted = performance.now();
  let externalCleanupResult: 'passed' | 'failed' = 'failed';
  let postCaptureFailureRecord: PostCaptureFailure | null = null;
  try {
    const externalCleanup = await verifyOwnedAndroidCleanup({
      repositoryRoot: root,
      artifactRoot: capture.artifactRoot,
      androidRuntimeParent,
      sdkRoot: toolchain.sdkRoot,
    });
    externalCleanupResult = externalCleanup.result === 'passed' ? 'passed' : 'failed';
  } catch (error) {
    postCaptureFailureRecord = postCaptureFailure('cleanup', error);
  }
  const cleanupMs = performance.now() - cleanupStarted;
  const verifyStarted = performance.now();
  let assertionEvidence: Awaited<ReturnType<typeof prepareAndroidSaveRetryPilotEvidence>> | null =
    null;
  let verificationResult: 'passed' | 'failed' | 'not-executed' = 'not-executed';
  let verificationFailure: { name: string; message: string } | null = null;
  if (
    capture.exitCode === 0 &&
    callbackCompleted &&
    externalCleanupResult === 'passed' &&
    !options.signal.aborted
  ) {
    try {
      requireSuccessfulNativeCommandDiagnostics(capture.report.commandExecutions);
      await writeAndroidSaveRetryRuntimeFrames(capture.artifactRoot);
      assertionEvidence = await prepareAndroidSaveRetryPilotEvidence({
        repositoryRoot: root,
        artifactRoot: capture.artifactRoot,
        selection: current,
        requestedRunId: options.requestedRunId,
      });
      verificationResult = 'passed';
    } catch (error) {
      verificationResult = 'failed';
      verificationFailure =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: 'UnknownError', message: 'Android save/retry evidence verification rejected' };
      postCaptureFailureRecord ??= postCaptureFailure('verification', error);
    }
  }
  const captureTimings = (capture.report.timingsMs ?? {}) as Record<string, unknown>;
  const fixture = isRecord(capture.report.backend) ? capture.report.backend : {};
  const build = isRecord(capture.report.build) ? capture.report.build : {};
  const finalBinding = bindingState.value;
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
    .filter((value): value is NonNullable<typeof value> => value !== null);
  const cancellation: 'SIGINT' | 'SIGTERM' | null =
    capture.report.cancellation === 'SIGINT' || capture.report.cancellation === 'SIGTERM'
      ? capture.report.cancellation
      : null;
  const outcomeWithoutRoot = {
    kind: 'private-owned-android-save-retry-attempt-not-public-receipt' as const,
    requestedRunId: options.requestedRunId,
    requestedAttemptId: finalBinding?.requestedAttemptId ?? `${options.requestedRunId}:first`,
    captureRunId: path.basename(capture.artifactRoot),
    backendRunId:
      finalBinding?.backendRunId ?? (typeof fixture.runId === 'string' ? fixture.runId : null),
    backendAttemptId: finalBinding?.backendAttemptId ?? null,
    faultAttemptId: finalBinding?.faultAttemptId ?? null,
    captureExitCode: capture.exitCode,
    childExitCode: trainingAttemptChildExitCode(commandDiagnostics, callbackCompleted),
    childSignal,
    childClassification,
    captureResult:
      typeof capture.report.result === 'string' ? capture.report.result : 'harness-blocked',
    captureCleanup: capture.report.cleanup ?? null,
    captureTimeout:
      capture.report.budgetTimeout === 'whole-capture' ? ('whole-capture' as const) : null,
    cancellation,
    callbackInvocations,
    callbackCompleted,
    externalCleanupResult,
    verificationResult,
    applicationFailure: null,
    applicationFailureCandidate: null,
    verificationFailure,
    postCaptureFailure: postCaptureFailureRecord,
    deadline: captureDeadline(capture.report.deadline),
    commandDiagnostics,
    censusFailures,
    outputFailures,
    assertionBindings: assertionEvidence?.bindings ?? [],
    assertionBindingsRetired: false,
    fixtureRunId: typeof fixture.runId === 'string' ? fixture.runId : null,
    fixtureHash: typeof capture.report.fixtureHash === 'string' ? capture.report.fixtureHash : null,
    flagsHash: typeof build.environmentHash === 'string' ? build.environmentHash : null,
    toolVersions: isRecord(capture.report.toolVersions)
      ? (capture.report.toolVersions as Record<string, string>)
      : {},
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
    nativePassingCases: 0 as const,
  };
  return persistAndroidSaveRetryAttemptOutcome(capture.artifactRoot, outcomeWithoutRoot);
}

export { normalizeNativeCommandDiagnostic, trainingAttemptChildExitCode };
