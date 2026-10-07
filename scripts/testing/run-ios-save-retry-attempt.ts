import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runOwnedIosNativeSession } from './capture-native-testability';
import { requireNativePilotAssertions, selectNativePilotScenario } from './native-pilot-contract';
import { nativeExecutionDeadlines } from './native-runtime-preflight';
import {
  requireNativeSaveRetryAssertionContract,
  writeNativeSaveRetryAttemptBinding,
} from './native-save-retry-attempt-binding';
import { observeIosSaveRetry } from './native-save-retry-observation';
import {
  prepareIosSaveRetryPilotEvidence,
  writeIosSaveRetryRuntimeFrames,
} from './native-save-retry-public-evidence';
import {
  normalizeNativeCommandDiagnostic,
  requireSuccessfulNativeCommandDiagnostics,
  trainingAttemptChildExitCode,
} from './native-training-attempt-outcome';
import { observeNativeTrainingDraft } from './native-training-observation';
import { iosSimulatorBootstatusDeadline } from './owned-ios-simulator';
import {
  projectIosTrainingAttemptTerminalFacts,
  requireIosSuccessfulTrainingCommandDiagnostics,
} from './run-ios-training-attempt';
import { verifyOwnedIosCleanup } from './verify-owned-ios-cleanup';
import type { IosSaveRetryRuntimeContext } from './capture-native-testability';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeExecutionDeadlines } from './native-runtime-preflight';
import type { NativeSaveRetryAttemptBinding } from './native-save-retry-attempt-binding';
import type { ColdResetPreparationExpectation } from './t15-cold-ios-reset-producer';

const id = /^[a-f0-9]{24}$/;

type PostCaptureFailurePhase = 'cleanup' | 'verification' | 'adapter-write';
type PostCaptureFailure = {
  phase: PostCaptureFailurePhase;
  name: string;
  message: string;
};

type SimulatorBootstrapFailure = {
  phase: string;
  failureReason: string;
  deadlineMs: number;
  elapsedMs: number;
};

type SaveRetryEvidenceBindings = Awaited<
  ReturnType<typeof prepareIosSaveRetryPilotEvidence>
>['bindings'];

function postCaptureFailure(phase: PostCaptureFailurePhase, error: unknown): PostCaptureFailure {
  return {
    phase,
    name: error instanceof Error ? error.name : 'UnknownError',
    message:
      error instanceof Error ? error.message : 'iOS save/retry post-capture processing failed',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Keep the shared command guard available under a save/retry-specific name. */
export function requireIosSuccessfulSaveRetryCommandDiagnostics(value: unknown) {
  const diagnostics = requireSuccessfulNativeCommandDiagnostics(value);
  assert.deepEqual(
    diagnostics,
    requireIosSuccessfulTrainingCommandDiagnostics(value),
    'iOS save/retry command diagnostics projection changed command facts',
  );
  return diagnostics;
}

/** Save/retry uses the same terminal projection while retaining its own adapter identity. */
export function projectIosSaveRetryAttemptTerminalFacts(
  input: Parameters<typeof projectIosTrainingAttemptTerminalFacts>[0] & {
    simulatorBootstrapFailure?: SimulatorBootstrapFailure | null;
  },
) {
  return {
    ...projectIosTrainingAttemptTerminalFacts(input),
    simulatorBootstrapFailure: input.simulatorBootstrapFailure ?? null,
  };
}

export type IosSaveRetryAttemptResult = {
  kind: 'private-owned-ios-save-retry-attempt-not-public-receipt';
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
  captureCleanup:
    'not-acquired' | 'cleaned' | { status: 'failed-recovery-retained'; resources: string[] } | null;
  simulatorBootstrapFailure: SimulatorBootstrapFailure | null;
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGINT' | 'SIGTERM' | null;
  callbackInvocations: number;
  callbackCompleted: boolean;
  externalCleanupResult: 'passed' | 'failed';
  verificationResult: 'passed' | 'failed' | 'not-executed' | 'application-failed';
  applicationFailure: null;
  applicationFailureCandidate: null;
  verificationFailure: { name: string; message: string } | null;
  postCaptureFailure: PostCaptureFailure | null;
  deadline: { step: string; deadlineMs: number } | null;
  commandDiagnostics: ReturnType<typeof normalizeNativeCommandDiagnostic>[];
  censusFailures: unknown[];
  outputFailures: unknown[];
  assertionBindings: SaveRetryEvidenceBindings;
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

type SaveRetryPreparation = {
  faultAttemptId?: unknown;
  attemptId?: unknown;
};

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

/** Actual owned save/retry execution; public receipt finalization remains separate. */
export async function runIosSaveRetryAttempt(options: {
  repositoryRoot: string;
  requestedRunId: string;
  selection: NativePilotSelection;
  signal: AbortSignal;
  /** Optional caller-owned cold-comparison namespace and absolute deadline. */
  callerOutputRoot?: string;
  deadlineAtMonotonicMs?: number;
  bootstatusDeadlineMs?: number;
  deadlines?: NativeExecutionDeadlines;
  reuseBuildRunId?: string;
  reuseBuildSourceRoot?: string;
  /** Fingerprints only; capture derives target/backend from acquired handles. */
  coldReset?: ColdResetPreparationExpectation;
}): Promise<IosSaveRetryAttemptResult> {
  assert.match(options.requestedRunId, id);
  if (options.reuseBuildRunId !== undefined) assert.match(options.reuseBuildRunId, id);
  if (options.reuseBuildSourceRoot !== undefined)
    assert(path.isAbsolute(options.reuseBuildSourceRoot));
  iosSimulatorBootstatusDeadline(options.bootstatusDeadlineMs);
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
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-save-retry-ios',
    mode: 'integration',
  });
  assert.equal(requireNativePilotAssertions(current).length, 5);
  requireNativeSaveRetryAssertionContract(current);
  options.signal.throwIfAborted();

  let callbackInvocations = 0;
  let callbackCompleted = false;
  const bindingState: { value: NativeSaveRetryAttemptBinding | null } = {
    value: null,
  };
  const capture = await runOwnedIosNativeSession({
    charter: 'save-retry',
    requestedRunId: options.requestedRunId,
    callerOutputRoot: options.callerOutputRoot,
    deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    coldReset: options.coldReset,
    signal: options.signal,
    bootstatusDeadlineMs: options.bootstatusDeadlineMs,
    deadlines: options.deadlines,
    reuseBuildRunId: options.reuseBuildRunId,
    reuseBuildSourceRoot: options.reuseBuildSourceRoot,
    executeSaveRetry: async (context: IosSaveRetryRuntimeContext) => {
      callbackInvocations++;
      assert.equal(callbackInvocations, 1, 'Save/retry callback must execute once');
      assert.equal(context.fixtures.scope, 'native-entry-ios');

      // The binding is written before draft setup, fault injection or UI actions.
      const currentBinding = await writeNativeSaveRetryAttemptBinding({
        repositoryRoot: root,
        artifactRoot: context.output,
        requestedRunId: options.requestedRunId,
        backendRunId: context.fixtures.runId,
        selection: current,
      });
      bindingState.value = currentBinding;
      await observeNativeTrainingDraft({
        platform: 'ios',
        output: context.output,
        savedPlanId: context.fixtures.savedPlanId,
        report: context.report,
        snapshot: context.snapshot,
        observations: () => context.proxy.observations,
        observe: context.observe,
      });
      await observeIosSaveRetry({
        output: context.output,
        accountUid: context.accountUid,
        report: context.report,
        snapshot: context.snapshot,
        proxy: context.proxy,
        observe: context.observe,
      });
      const preparation = context.report.saveRetryPreparation as SaveRetryPreparation | undefined;
      assert(preparation && isRecord(preparation), 'Save/retry preparation report is missing');
      assert.equal(preparation.faultAttemptId, currentBinding.faultAttemptId);
      assert.equal(preparation.attemptId, currentBinding.faultAttemptId);
      await writeFile(
        path.join(context.output, 'save-retry-runtime-metadata.private.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            kind: 'private-ios-save-retry-runtime-metadata-not-public-receipt',
            requestedRunId: currentBinding.requestedRunId,
            requestedAttemptId: currentBinding.requestedAttemptId,
            captureRunId: currentBinding.captureRunId,
            backendRunId: currentBinding.backendRunId,
            backendAttemptId: currentBinding.backendAttemptId,
            faultAttemptId: currentBinding.faultAttemptId,
            selection: currentBinding.selection,
            assertionContract: currentBinding.assertionContract,
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
    const externalCleanup = await verifyOwnedIosCleanup({
      repositoryRoot: root,
      artifactRoot: capture.artifactRoot,
    });
    externalCleanupResult = externalCleanup.result === 'passed' ? 'passed' : 'failed';
  } catch (error) {
    postCaptureFailureRecord = postCaptureFailure('cleanup', error);
  }
  const cleanupMs = performance.now() - cleanupStarted;
  const verifyStarted = performance.now();
  const terminal = projectIosSaveRetryAttemptTerminalFacts({
    commandExecutions: capture.report.commandExecutions,
    callbackCompleted,
    captureResult: capture.report.result,
    captureExitCode: capture.exitCode,
    captureCleanup: capture.report.cleanup,
    budgetTimeout: capture.report.budgetTimeout,
    cancellation: capture.report.cancellation,
    simulatorBootstrapFailure: capture.report.simulatorBootstrapFailure as
      SimulatorBootstrapFailure | undefined,
  });
  let assertionEvidence: Awaited<ReturnType<typeof prepareIosSaveRetryPilotEvidence>> | null = null;
  let verificationResult: 'passed' | 'failed' | 'not-executed' | 'application-failed' =
    'not-executed';
  let verificationFailure: { name: string; message: string } | null = null;
  if (
    capture.exitCode === 0 &&
    callbackCompleted &&
    externalCleanupResult === 'passed' &&
    !options.signal.aborted
  ) {
    try {
      requireIosSuccessfulSaveRetryCommandDiagnostics(capture.report.commandExecutions);
      await writeIosSaveRetryRuntimeFrames(capture.artifactRoot);
      assertionEvidence = await prepareIosSaveRetryPilotEvidence({
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
          : {
              name: 'UnknownError',
              message: 'iOS save/retry evidence verification rejected',
            };
      postCaptureFailureRecord ??= postCaptureFailure('verification', error);
    }
  }

  const captureTimings = (capture.report.timingsMs ?? {}) as Record<string, unknown>;
  const fixture = isRecord(capture.report.backend) ? capture.report.backend : {};
  const build = isRecord(capture.report.build) ? capture.report.build : {};
  const finalBinding = bindingState.value;
  const outcomeWithoutRoot = {
    kind: 'private-owned-ios-save-retry-attempt-not-public-receipt' as const,
    requestedRunId: options.requestedRunId,
    requestedAttemptId: finalBinding?.requestedAttemptId ?? `${options.requestedRunId}:first`,
    captureRunId: path.basename(capture.artifactRoot),
    backendRunId:
      finalBinding?.backendRunId ?? (typeof fixture.runId === 'string' ? fixture.runId : null),
    backendAttemptId: finalBinding?.backendAttemptId ?? null,
    faultAttemptId: finalBinding?.faultAttemptId ?? null,
    captureExitCode: capture.exitCode,
    childExitCode: terminal.childExitCode,
    childSignal: terminal.childSignal,
    childClassification: terminal.childClassification,
    captureResult: terminal.captureResult,
    captureCleanup: terminal.captureCleanup,
    simulatorBootstrapFailure: terminal.simulatorBootstrapFailure,
    captureTimeout: terminal.captureTimeout,
    cancellation: terminal.cancellation,
    callbackInvocations,
    callbackCompleted,
    externalCleanupResult,
    verificationResult,
    applicationFailure: null,
    applicationFailureCandidate: null,
    verificationFailure,
    postCaptureFailure: postCaptureFailureRecord,
    deadline: captureDeadline(capture.report.deadline),
    commandDiagnostics: terminal.commandDiagnostics,
    censusFailures: terminal.censusFailures,
    outputFailures: terminal.outputFailures,
    assertionBindings: assertionEvidence?.bindings ?? [],
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
  const outcome = { ...outcomeWithoutRoot, artifactRoot: capture.artifactRoot };
  try {
    await writeFile(
      path.join(capture.artifactRoot, 'runtime-adapter.private.json'),
      JSON.stringify(outcomeWithoutRoot, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    outcome.postCaptureFailure ??= postCaptureFailure('adapter-write', error);
  }
  return outcome;
}

export { normalizeNativeCommandDiagnostic, trainingAttemptChildExitCode };
