import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runOwnedIosNativeSession } from './capture-native-testability';
import { sourceIdentity, type NativeSourceIdentity } from './native-build-identity';
import {
  nativeSessionAssertionIds,
  nativePilotTargetFromCapture,
  requireNativePilotAssertions,
  selectNativePilotScenario,
  type NativePilotTarget,
  type NativePilotSelection,
} from './native-pilot-contract';
import {
  nativeExecutionDeadlines,
  type NativeExecutionDeadlines,
} from './native-runtime-preflight';
import {
  loadNativeSessionPublicDependency,
  type NativeSessionPublicDependencyLoad,
  type NativeSessionPublicDependencyResult,
} from './native-session-public-dependency';
import {
  buildNativeSessionPublicFinalizationCandidate,
  validateNativeSessionPublicFinalizationControls,
  type NativeSessionPublicFinalizationCandidate,
  type NativeSessionPublicFinalizationInput,
} from './native-session-public-finalization';
import {
  stageNativeSessionPublicDependency,
  verifyStagedNativeSessionDependency,
  type NativeSessionStageResult,
} from './native-session-public-staging';
import { iosSimulatorBootstatusDeadline } from './owned-ios-simulator';
import {
  projectIosTrainingAttemptTerminalFacts,
  requireIosSuccessfulTrainingCommandDiagnostics,
} from './run-ios-training-attempt';
import { verifyOwnedIosCleanup } from './verify-owned-ios-cleanup';
import type { normalizeNativeCommandDiagnostic } from './native-training-attempt-outcome';

const id = /^[a-f0-9]{24}$/;
type PostCaptureFailurePhase = 'cleanup' | 'verification' | 'adapter-write';
type PostCaptureFailure = { phase: PostCaptureFailurePhase; name: string; message: string };
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function failure(phase: PostCaptureFailurePhase, error: unknown): PostCaptureFailure {
  return {
    phase,
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : 'iOS session post-capture processing failed',
  };
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

function requireIosSessionSelection(selection: NativePilotSelection): void {
  assert.deepEqual(selection.arguments, {
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-session-ios',
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, 'SCN-session-ios');
  assert.equal(selection.scenario.platform, 'ios');
  assert.equal(selection.scenario.flowId, 'FLW-session');
  assert.equal(selection.scenarioHash.length, 64);
  assert.equal(selection.requirementHash.length, 64);
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    nativeSessionAssertionIds,
    'Session assertion order changed before acquisition',
  );
}

function dependencyStatus(
  value: NativeSessionPublicDependencyLoad,
): 'validated-source-only' | 'blocked' | 'incomplete' | 'selection-blocked' {
  return value.status;
}

export type IosSessionAttemptResult = {
  kind: 'private-owned-ios-session-attempt-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  backendRunId: string | null;
  backendAttemptId: string | null;
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
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGINT' | 'SIGTERM' | null;
  /** One invocation of the outer owned capture; no scenario callback is supplied for session charter. */
  captureInvocation: {
    count: 1;
    returned: true;
    exitCode: number;
    result: string;
  };
  /** Observable completion of the outer capture lifecycle, including owned cleanup. */
  captureCompleted: boolean;
  externalCleanupResult: 'passed' | 'failed';
  verificationResult: 'source-only' | 'blocked' | 'not-executed';
  verificationFailure: { name: string; message: string } | null;
  postCaptureFailure: PostCaptureFailure | null;
  dependencyStatus: ReturnType<typeof dependencyStatus> | 'not-executed';
  publicPromotionEligible: false;
  nativePassingCases: 0;
  publicPassingCases: 0;
  /**
   * A separate actual-capture publication candidate. The private dependency
   * loader and source-only stage never populate this field.
   */
  publicFinalization: NativeSessionPublicFinalizationCandidate | null;
  /** Validated source-only dependency retained for a separate public candidate gate. */
  publicDependency:
    (NativeSessionPublicDependencyResult & { selection: NativePilotSelection }) | null;
  publicFinalizationInput: NativeSessionPublicFinalizationInput | null;
  target: NativePilotTarget;
  sourceBefore: NativeSourceIdentity | null;
  sourceAfter: NativeSourceIdentity | null;
  staged: NativeSessionStageResult | null;
  deadline: { step: string; deadlineMs: number } | null;
  commandDiagnostics: ReturnType<typeof normalizeNativeCommandDiagnostic>[];
  censusFailures: unknown[];
  outputFailures: unknown[];
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
  artifactRoot: string;
};

export type SessionRuntimeDependencies = {
  capture: typeof runOwnedIosNativeSession;
  cleanup: typeof verifyOwnedIosCleanup;
  load: typeof loadNativeSessionPublicDependency;
  stage: typeof stageNativeSessionPublicDependency;
  verifyStage: typeof verifyStagedNativeSessionDependency;
};

const productionDependencies: SessionRuntimeDependencies = {
  capture: runOwnedIosNativeSession,
  cleanup: verifyOwnedIosCleanup,
  load: loadNativeSessionPublicDependency,
  stage: stageNativeSessionPublicDependency,
  verifyStage: verifyStagedNativeSessionDependency,
};

/** Actual owned iOS session execution with source-only private staging. */
export async function runIosSessionAttempt(
  options: {
    repositoryRoot: string;
    requestedRunId: string;
    selection: NativePilotSelection;
    signal: AbortSignal;
    outputRoot?: string;
    bootstatusDeadlineMs?: number;
    deadlines?: NativeExecutionDeadlines;
    reuseBuildRunId?: string;
    reuseBuildSourceRoot?: string;
  },
  dependencies: SessionRuntimeDependencies = productionDependencies,
): Promise<IosSessionAttemptResult> {
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
    'Public session selection changed before acquisition',
  );
  requireIosSessionSelection(current);
  options.signal.throwIfAborted();
  let sourceBefore: NativeSourceIdentity | null = null;
  try {
    sourceBefore = await sourceIdentity(root);
  } catch {
    // The owned capture records its own source identity; an unavailable
    // adapter-side identity prevents public finalization but does not erase
    // the original private capture.
  }

  const capture = await dependencies.capture({
    charter: 'session',
    signal: options.signal,
    bootstatusDeadlineMs: options.bootstatusDeadlineMs,
    deadlines: options.deadlines,
    reuseBuildRunId: options.reuseBuildRunId,
    reuseBuildSourceRoot: options.reuseBuildSourceRoot,
  });
  const captureInvocation = {
    count: 1 as const,
    returned: true as const,
    exitCode: capture.exitCode,
    result: typeof capture.report.result === 'string' ? capture.report.result : 'unknown',
  };
  const captureCompleted =
    capture.exitCode === 0 &&
    capture.report.result === 'observed' &&
    capture.report.cleanup === 'cleaned';
  const captureRunId = path.basename(capture.artifactRoot);
  const cleanupStarted = performance.now();
  let externalCleanupResult: 'passed' | 'failed' = 'failed';
  let postCaptureFailure: PostCaptureFailure | null = null;
  try {
    const cleanup = await dependencies.cleanup({
      repositoryRoot: root,
      artifactRoot: capture.artifactRoot,
    });
    externalCleanupResult = cleanup.result === 'passed' ? 'passed' : 'failed';
  } catch (error) {
    postCaptureFailure = failure('cleanup', error);
  }
  let sourceAfter: NativeSourceIdentity | null = null;
  try {
    sourceAfter = await sourceIdentity(root);
  } catch {
    // A missing post-capture identity is a finalization blocker.
  }
  const cleanupMs = performance.now() - cleanupStarted;
  const verifyStarted = performance.now();
  const terminal = projectIosTrainingAttemptTerminalFacts({
    commandExecutions: capture.report.commandExecutions,
    callbackCompleted: captureCompleted,
    captureResult: capture.report.result,
    captureExitCode: capture.exitCode,
    captureCleanup: capture.report.cleanup,
    budgetTimeout: capture.report.budgetTimeout,
    cancellation: capture.report.cancellation,
  });
  let verificationResult: IosSessionAttemptResult['verificationResult'] = 'not-executed';
  let dependencyResult: NativeSessionPublicDependencyLoad | null = null;
  let staged: NativeSessionStageResult | null = null;
  let verificationFailure: PostCaptureFailure | null = null;
  if (
    capture.exitCode === 0 &&
    terminal.captureResult === 'observed' &&
    terminal.captureCleanup === 'cleaned' &&
    externalCleanupResult === 'passed' &&
    !options.signal.aborted
  ) {
    try {
      requireIosSuccessfulTrainingCommandDiagnostics(capture.report.commandExecutions);
      dependencyResult = await dependencies.load({
        repositoryRoot: root,
        captureRoot: capture.artifactRoot,
        cleanupRoot: capture.artifactRoot,
        cleanupPath: 'external-cleanup.private.json',
        signal: options.signal,
        deadlineMs: 60_000,
      });
      if (dependencyResult.status !== 'validated-source-only') {
        verificationResult = 'blocked';
        verificationFailure = failure(
          'verification',
          new Error(`Session dependency loader returned ${dependencyResult.status}`),
        );
        postCaptureFailure ??= verificationFailure;
      } else {
        assert.deepEqual(
          dependencyResult.selection,
          current,
          'Session dependency selection changed after owned capture',
        );
        if (!options.outputRoot) {
          verificationResult = 'source-only';
        } else {
          staged = await dependencies.stage({
            dependency: dependencyResult,
            captureRoot: capture.artifactRoot,
            outputRoot: options.outputRoot,
            requestedRunId: options.requestedRunId,
            selection: current,
          });
          await dependencies.verifyStage({
            outputRoot: options.outputRoot,
            copyManifest: staged.copyManifest,
            requestedRunId: options.requestedRunId,
            captureRunId,
          });
          verificationResult = 'source-only';
        }
      }
    } catch (error) {
      verificationResult = 'blocked';
      verificationFailure = failure('verification', error);
      postCaptureFailure ??= verificationFailure;
    }
  }
  const captureTimings = (capture.report.timingsMs ?? {}) as Record<string, unknown>;
  const fixture = isRecord(capture.report.backend) ? capture.report.backend : {};
  const build = isRecord(capture.report.build) ? capture.report.build : {};
  let target = nativePilotTargetFromCapture('ios');
  try {
    target = nativePilotTargetFromCapture('ios', capture.report);
  } catch {
    // Failed or partial captures may not contain a platform/build target;
    // retain the private terminal outcome and block public finalization.
  }
  const outcome: IosSessionAttemptResult = {
    kind: 'private-owned-ios-session-attempt-not-public-receipt',
    requestedRunId: options.requestedRunId,
    requestedAttemptId: `${options.requestedRunId}:first`,
    captureRunId,
    backendRunId: typeof fixture.runId === 'string' ? fixture.runId : null,
    backendAttemptId: typeof fixture.runId === 'string' ? `${fixture.runId}:first` : null,
    captureExitCode: capture.exitCode,
    childExitCode: terminal.childExitCode,
    childSignal: terminal.childSignal,
    childClassification: terminal.childClassification,
    captureResult: terminal.captureResult,
    captureCleanup: terminal.captureCleanup,
    captureTimeout: terminal.captureTimeout,
    cancellation: terminal.cancellation,
    captureInvocation,
    captureCompleted,
    externalCleanupResult,
    verificationResult,
    verificationFailure: verificationFailure
      ? {
          name: verificationFailure.name,
          message: verificationFailure.message,
        }
      : null,
    postCaptureFailure,
    dependencyStatus: dependencyResult ? dependencyStatus(dependencyResult) : 'not-executed',
    publicPromotionEligible: false,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicFinalization: null,
    publicDependency:
      dependencyResult?.status === 'validated-source-only' ? dependencyResult : null,
    publicFinalizationInput: null,
    target,
    sourceBefore,
    sourceAfter,
    staged,
    deadline: captureDeadline(capture.report.deadline),
    commandDiagnostics: terminal.commandDiagnostics,
    censusFailures: terminal.censusFailures,
    outputFailures: terminal.outputFailures,
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
    artifactRoot: capture.artifactRoot,
  };
  if (
    options.outputRoot &&
    outcome.verificationResult === 'source-only' &&
    outcome.captureExitCode === 0 &&
    outcome.childExitCode === 0 &&
    outcome.childSignal === null &&
    outcome.captureResult === 'observed' &&
    outcome.captureCleanup === 'cleaned' &&
    outcome.captureCompleted &&
    outcome.externalCleanupResult === 'passed' &&
    outcome.captureTimeout === null &&
    outcome.cancellation === null &&
    outcome.postCaptureFailure === null &&
    outcome.censusFailures.length === 0 &&
    outcome.outputFailures.length === 0 &&
    capture.report.platform === 'ios' &&
    capture.report.sessionEvidencePublication === 'complete' &&
    outcome.publicDependency &&
    outcome.fixtureRunId &&
    outcome.fixtureHash &&
    outcome.flagsHash &&
    sourceBefore &&
    sourceAfter
  ) {
    try {
      assert(
        Object.values(target).every((value) => typeof value === 'string' && value.length > 0),
        'Actual iOS session target is incomplete',
      );
      const candidate = await buildNativeSessionPublicFinalizationCandidate({
        selection: current,
        captureRoot: capture.artifactRoot,
        capture: capture.report,
        dependency: outcome.publicDependency,
        fixtureRunId: outcome.fixtureRunId,
      });
      const runtime = {
        captureRunId: outcome.captureRunId,
        captureExitCode: outcome.captureExitCode,
        childExitCode: outcome.childExitCode,
        childSignal: outcome.childSignal,
        captureResult: outcome.captureResult,
        captureCleanup: outcome.captureCleanup ?? 'unknown',
        captureCompleted: outcome.captureCompleted,
        externalCleanupResult: outcome.externalCleanupResult,
        captureTimeout: outcome.captureTimeout,
        cancellation: outcome.cancellation,
        postCaptureFailure: outcome.postCaptureFailure,
        censusFailures: outcome.censusFailures,
        outputFailures: outcome.outputFailures,
        fixtureRunId: outcome.fixtureRunId,
        fixtureHash: outcome.fixtureHash,
        flagsHash: outcome.flagsHash,
        timingsMs: outcome.timingsMs,
      };
      const publicFinalizationInput: NativeSessionPublicFinalizationInput = {
        repositoryRoot: root,
        captureRoot: capture.artifactRoot,
        outputRoot: options.outputRoot,
        requestedRunId: outcome.requestedRunId,
        requestedAttemptId: outcome.requestedAttemptId,
        captureRunId: outcome.captureRunId,
        fixtureRunId: outcome.fixtureRunId,
        fixtureHash: outcome.fixtureHash,
        flagsHash: outcome.flagsHash,
        selection: current,
        target,
        sourceBefore,
        sourceAfter,
        dependency: outcome.publicDependency,
        runtime,
        candidate,
      };
      publicFinalizationInput.protectedControls =
        await validateNativeSessionPublicFinalizationControls(publicFinalizationInput);
      outcome.publicFinalization = candidate;
      outcome.publicFinalizationInput = publicFinalizationInput;
    } catch (error) {
      const finalizationFailure = failure('verification', error);
      outcome.verificationFailure ??= {
        name: finalizationFailure.name,
        message: finalizationFailure.message,
      };
      outcome.postCaptureFailure ??= finalizationFailure;
      outcome.verificationResult = 'blocked';
      outcome.publicFinalization = null;
      outcome.publicFinalizationInput = null;
    }
  }
  try {
    await writeFile(
      path.join(capture.artifactRoot, 'session-runtime-adapter.private.json'),
      JSON.stringify(
        {
          kind: outcome.kind,
          requestedRunId: outcome.requestedRunId,
          requestedAttemptId: outcome.requestedAttemptId,
          captureRunId: outcome.captureRunId,
          backendRunId: outcome.backendRunId,
          captureInvocation: outcome.captureInvocation,
          captureCompleted: outcome.captureCompleted,
          dependencyStatus: outcome.dependencyStatus,
          verificationResult: outcome.verificationResult,
          publicFinalization: outcome.publicFinalization,
          nativePassingCases: 0,
          publicPassingCases: 0,
          publicPromotionEligible: false,
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    outcome.postCaptureFailure ??= failure('adapter-write', error);
    outcome.verificationResult = 'blocked';
    // Publication owns the candidate only after the immutable sidecar receipt
    // is durable. A failed receipt write must retire both references so a
    // caller cannot publish late evidence through an in-memory candidate.
    outcome.publicFinalization = null;
    outcome.publicFinalizationInput = null;
  }
  return outcome;
}

export function sessionAttemptMustRemainBlocked(
  result: Pick<IosSessionAttemptResult, 'verificationResult' | 'publicPromotionEligible'>,
): boolean {
  return result.verificationResult === 'source-only' && result.publicPromotionEligible === false;
}

/**
 * The public runner must bind the reported outer capture tuple to the
 * terminal facts produced from that same returned capture. This validator is
 * intentionally pure so malformed receipt/runtime-link data fails closed.
 */
export function isIosSessionCaptureResultConsistent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const invocation = value.captureInvocation;
  if (
    !isRecord(invocation) ||
    invocation.count !== 1 ||
    invocation.returned !== true ||
    !Number.isSafeInteger(invocation.exitCode) ||
    typeof invocation.result !== 'string' ||
    invocation.result.length === 0
  )
    return false;
  if (!Number.isSafeInteger(value.captureExitCode) || typeof value.captureResult !== 'string')
    return false;
  if (invocation.exitCode !== value.captureExitCode || invocation.result !== value.captureResult)
    return false;
  const cleanup = value.captureCleanup;
  const cleanupIsKnown =
    cleanup === 'not-acquired' ||
    cleanup === 'cleaned' ||
    cleanup === null ||
    (isRecord(cleanup) &&
      cleanup.status === 'failed-recovery-retained' &&
      Array.isArray(cleanup.resources) &&
      cleanup.resources.every((resource) => typeof resource === 'string'));
  if (!cleanupIsKnown || typeof value.captureCompleted !== 'boolean') return false;
  const expectedCompleted =
    value.captureExitCode === 0 && value.captureResult === 'observed' && cleanup === 'cleaned';
  return value.captureCompleted === expectedCompleted;
}
