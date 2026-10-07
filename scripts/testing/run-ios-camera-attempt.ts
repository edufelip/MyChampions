import assert from 'node:assert/strict';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  runOwnedIosNativeSession,
  type IosCameraRuntimeContext,
} from './capture-native-testability';
import { observeIosCameraDeniedManualSubmit } from './native-camera-observation';
import { validateIosCameraSubmissionPreparation } from './native-camera-submission-evidence';
import {
  nativeCameraDeniedAssertionIds,
  requireNativePilotAssertions,
  selectNativePilotScenario,
} from './native-pilot-contract';
import { nativeExecutionDeadlines } from './native-runtime-preflight';
import { normalizeNativeCommandDiagnostic } from './native-training-attempt-outcome';
import { iosSimulatorBootstatusDeadline } from './owned-ios-simulator';
import {
  projectIosConnectionAttemptTerminalFacts,
  requireIosSuccessfulConnectionCommandDiagnostics,
} from './run-ios-connection-attempt';
import { verifyOwnedIosCleanup } from './verify-owned-ios-cleanup';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeExecutionDeadlines } from './native-runtime-preflight';
import type { ProxyObservation } from './owned-api-proxy';
import type { ColdResetPreparationExpectation } from './t15-cold-ios-reset-producer';

const id = /^[a-f0-9]{24}$/;

type PostCaptureFailurePhase = 'cleanup' | 'verification' | 'adapter-write';
type PostCaptureFailure = {
  phase: PostCaptureFailurePhase;
  name: string;
  message: string;
};

type CameraPreparation = Record<string, unknown>;

/** Source-only seams for the public adapter; production keeps the defaults. */
export type IosCameraAttemptDependencies = {
  selectNativePilotScenario: typeof selectNativePilotScenario;
  runOwnedIosNativeSession: typeof runOwnedIosNativeSession;
  observeIosCameraDeniedManualSubmit: typeof observeIosCameraDeniedManualSubmit;
  verifyOwnedIosCleanup: typeof verifyOwnedIosCleanup;
  validateIosCameraSubmissionPreparation: typeof validateIosCameraSubmissionPreparation;
};

type CameraAttemptResult = {
  kind: 'private-owned-ios-camera-attempt-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  backendRunId: string | null;
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
  callbackInvocations: number;
  callbackCompleted: boolean;
  externalCleanupResult: 'passed' | 'failed';
  verificationResult: 'passed' | 'failed' | 'not-executed';
  verificationFailure: { name: string; message: string } | null;
  postCaptureFailure: PostCaptureFailure | null;
  deadline: { step: string; deadlineMs: number } | null;
  commandDiagnostics: ReturnType<typeof normalizeNativeCommandDiagnostic>[];
  censusFailures: unknown[];
  outputFailures: unknown[];
  assertionIds: readonly string[];
  assertionContractSha256: string | null;
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
  stagedManifestPath: string | null;
  nativePassingCases: 0;
  artifactRoot: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function postCaptureFailure(phase: PostCaptureFailurePhase, error: unknown): PostCaptureFailure {
  return {
    phase,
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : 'iOS camera post-capture processing failed',
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

function preparationFromReport(report: Record<string, unknown>): CameraPreparation {
  const preparation = report.cameraSubmissionPreparation;
  assert(isRecord(preparation), 'Camera submission preparation report is missing');
  assert.equal(preparation.nativePassingCases, 0);
  return preparation;
}

function requireCameraSelection(selection: NativePilotSelection): {
  assertionContractSha256: string | null;
} {
  assert.deepEqual(selection.arguments, {
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-camera-denied-ios',
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, 'SCN-camera-denied-ios');
  assert.equal(selection.scenario.platform, 'ios');
  assert.equal(selection.scenario.flowId, 'FLW-camera-denied');
  assert.equal(selection.scenarioHash.length, 64);
  assert.equal(selection.requirementHash.length, 64);
  const rows = requireNativePilotAssertions(selection);
  assert.deepEqual(
    rows.map((row) => row.id),
    nativeCameraDeniedAssertionIds,
    'Camera assertion order changed before acquisition',
  );
  return {
    assertionContractSha256: selection.scenario.pilotAssertionContract?.sha256 ?? null,
  };
}

function requireCameraCaptureIdentity(
  preparation: CameraPreparation,
  options: {
    requestedRunId: string;
    captureRunId: string;
    backendRunId: string;
  },
): void {
  const capture = preparation.captureIdentity;
  assert(isRecord(capture), 'Camera capture identity is missing');
  assert.equal(capture.requestedRunId, options.requestedRunId);
  assert.equal(capture.captureRunId, options.captureRunId);
  assert.equal(capture.backendRunId, options.backendRunId);
}

export async function requireCameraCallerOutputRootBinding(input: {
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  captureRunId: string;
  deadlineAt: number;
  report: Record<string, unknown>;
}): Promise<void> {
  assert.equal(input.report.requestedRunId, input.requestedRunId);
  assert.equal(input.report.captureRunId, input.captureRunId);
  const reportBinding = input.report.callerOutputRootBinding;
  assert(isRecord(reportBinding), 'Camera caller output-root binding is missing from the capture');
  const bindingPath = reportBinding.path;
  assert.equal(bindingPath, path.resolve(input.outputRoot));
  const reportIdentity = reportBinding.identity;
  assert(
    isRecord(reportIdentity),
    'Camera caller output-root identity is missing from the capture',
  );
  const sidecar = JSON.parse(
    await readFile(path.join(input.captureRoot, 'caller-output-root-binding.private.json'), 'utf8'),
  ) as unknown;
  assert(isRecord(sidecar), 'Camera caller output-root binding sidecar is malformed');
  assert.equal(sidecar.requestedRunId, input.requestedRunId);
  assert.equal(sidecar.captureRunId, input.captureRunId);
  assert.deepEqual(sidecar.binding, reportBinding);
  const sidecarDeadline = sidecar.deadlineAtMonotonicMs;
  const budget = input.report.budget;
  assert(isRecord(budget), 'Camera capture deadline budget is missing');
  assert.equal(budget.callerDeadlineAtMonotonicMs, sidecarDeadline);
  assert.equal(input.report.callerDeadlineAtMonotonicMs, sidecarDeadline);
  assert.equal(typeof sidecarDeadline, 'number');
  assert.equal(sidecarDeadline, input.deadlineAt);
  const canonical = await realpath(input.outputRoot);
  assert.equal(canonical, path.resolve(input.outputRoot));
  const metadata = await stat(canonical);
  assert(metadata.isDirectory(), 'Camera caller output root is no longer a directory');
  assert.equal(metadata.mode & 0o777, 0o700);
  if (process.getuid) assert.equal(metadata.uid, process.getuid());
  for (const field of ['dev', 'ino', 'mode', 'uid', 'nlink'] as const) {
    const observed = field === 'mode' ? metadata.mode & 0o777 : metadata[field];
    assert.equal(observed, reportIdentity[field]);
  }
}

function parseTransport(value: string): readonly ProxyObservation[] {
  const parsed: unknown = JSON.parse(value);
  assert(Array.isArray(parsed), 'Camera transport sidecar is not an array');
  return parsed as readonly ProxyObservation[];
}

/** Private actual iOS camera attempt; native and public qualification remain separate. */
export async function runIosCameraAttempt(options: {
  repositoryRoot: string;
  requestedRunId: string;
  selection: NativePilotSelection;
  signal: AbortSignal;
  /** Caller-owned precreated public namespace; capture binds it without adopting it as capture root. */
  outputRoot: string;
  /** Absolute monotonic whole-run deadline inherited from run-native-pilot. */
  deadlineAt: number;
  bootstatusDeadlineMs?: number;
  deadlines?: NativeExecutionDeadlines;
  reuseBuildRunId?: string;
  reuseBuildSourceRoot?: string;
  /** Optional producer-owned cleaned failed build used only for compiler caches. */
  incrementalBuildCacheSourceRoot?: string;
  /** Enables one bounded pre-auth email tap/input diagnostic before camera. */
  credentialInteractionDiagnostic?: boolean;
  /** Fingerprints only; capture derives target/backend from acquired handles. */
  coldReset?: ColdResetPreparationExpectation;
  /**
   * Optional source-only dependency seams. Public production dispatch leaves
   * this absent and uses the owned native implementations above.
   */
  dependencies?: Partial<IosCameraAttemptDependencies>;
}): Promise<CameraAttemptResult> {
  assert.match(options.requestedRunId, id);
  requireIosCameraAttemptLifecycle(options);
  if (options.reuseBuildRunId !== undefined) assert.match(options.reuseBuildRunId, id);
  if (options.reuseBuildSourceRoot !== undefined)
    assert(path.isAbsolute(options.reuseBuildSourceRoot));
  if (options.incrementalBuildCacheSourceRoot !== undefined)
    assert(path.isAbsolute(options.incrementalBuildCacheSourceRoot));
  iosSimulatorBootstatusDeadline(options.bootstatusDeadlineMs);
  nativeExecutionDeadlines(options.deadlines);
  options.signal.throwIfAborted();
  const dependencies: IosCameraAttemptDependencies = {
    selectNativePilotScenario:
      options.dependencies?.selectNativePilotScenario ?? selectNativePilotScenario,
    runOwnedIosNativeSession:
      options.dependencies?.runOwnedIosNativeSession ?? runOwnedIosNativeSession,
    observeIosCameraDeniedManualSubmit:
      options.dependencies?.observeIosCameraDeniedManualSubmit ??
      observeIosCameraDeniedManualSubmit,
    verifyOwnedIosCleanup: options.dependencies?.verifyOwnedIosCleanup ?? verifyOwnedIosCleanup,
    validateIosCameraSubmissionPreparation:
      options.dependencies?.validateIosCameraSubmissionPreparation ??
      validateIosCameraSubmissionPreparation,
  };
  const root = await realpath(options.repositoryRoot);
  const current = await dependencies.selectNativePilotScenario(
    options.selection.arguments,
    JSON.parse(await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8')),
    root,
  );
  assert.deepEqual(
    options.selection,
    current,
    'Public camera selection changed before acquisition',
  );
  const contract = requireCameraSelection(current);
  options.signal.throwIfAborted();

  let callbackInvocations = 0;
  let callbackCompleted = false;
  let preparationState: CameraPreparation | null = null;
  const capture = await dependencies.runOwnedIosNativeSession({
    charter: 'camera-denied',
    requestedRunId: options.requestedRunId,
    callerOutputRoot: options.outputRoot,
    deadlineAtMonotonicMs: options.deadlineAt,
    coldReset: options.coldReset,
    signal: options.signal,
    bootstatusDeadlineMs: options.bootstatusDeadlineMs,
    deadlines: options.deadlines,
    reuseBuildRunId: options.reuseBuildRunId,
    reuseBuildSourceRoot: options.reuseBuildSourceRoot,
    incrementalBuildCacheSourceRoot: options.incrementalBuildCacheSourceRoot,
    ...(options.credentialInteractionDiagnostic === undefined
      ? {}
      : {
          credentialInteractionDiagnostic: options.credentialInteractionDiagnostic,
        }),
    executeCamera: async (context: IosCameraRuntimeContext) => {
      callbackInvocations++;
      assert.equal(callbackInvocations, 1, 'Camera callback must execute once');
      assert.equal(context.fixtures.scope, 'native-entry-ios');
      await dependencies.observeIosCameraDeniedManualSubmit({
        ...context,
        signal: context.signal,
      });
      const preparation = preparationFromReport(context.report);
      assert.equal(preparation.nativePassingCases, 0);
      preparation.captureIdentity = {
        requestedRunId: options.requestedRunId,
        captureRunId: path.basename(context.output),
        backendRunId: context.fixtures.runId,
      };
      context.report.cameraSubmissionPreparation = preparation;
      preparationState = preparation;
      await writeFile(
        path.join(context.output, 'camera-runtime-metadata.private.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            kind: 'private-ios-camera-runtime-metadata-not-public-receipt',
            requestedRunId: options.requestedRunId,
            captureRunId: path.basename(context.output),
            backendRunId: context.fixtures.runId,
            selection: {
              arguments: current.arguments,
              scenarioHash: current.scenarioHash,
              requirementHash: current.requirementHash,
            },
            assertionIds: nativeCameraDeniedAssertionIds,
            assertionContractSha256: contract.assertionContractSha256,
            preparation,
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
    const externalCleanup = await dependencies.verifyOwnedIosCleanup({
      repositoryRoot: root,
      artifactRoot: capture.artifactRoot,
    });
    externalCleanupResult = externalCleanup.result === 'passed' ? 'passed' : 'failed';
  } catch (error) {
    postCaptureFailureRecord = postCaptureFailure('cleanup', error);
  }
  const cleanupMs = performance.now() - cleanupStarted;
  const verifyStarted = performance.now();
  const terminal = projectIosConnectionAttemptTerminalFacts({
    commandExecutions: capture.report.commandExecutions,
    callbackCompleted,
    captureResult: capture.report.result,
    captureExitCode: capture.exitCode,
    captureCleanup: capture.report.cleanup,
    budgetTimeout: capture.report.budgetTimeout,
    cancellation: capture.report.cancellation,
  });
  const captureTimings = (capture.report.timingsMs ?? {}) as Record<string, unknown>;
  const backend = isRecord(capture.report.backend) ? capture.report.backend : {};
  const build = isRecord(capture.report.build) ? capture.report.build : {};
  const stagedManifestPath: string | null = null;
  let verificationResult: 'passed' | 'failed' | 'not-executed' = 'not-executed';
  let verificationFailure: { name: string; message: string } | null = null;

  if (
    capture.exitCode === 0 &&
    terminal.captureResult === 'observed' &&
    terminal.captureCleanup === 'cleaned' &&
    callbackCompleted &&
    preparationState &&
    externalCleanupResult === 'passed' &&
    !options.signal.aborted
  ) {
    try {
      await requireCameraCallerOutputRootBinding({
        captureRoot: capture.artifactRoot,
        outputRoot: options.outputRoot,
        requestedRunId: options.requestedRunId,
        captureRunId: path.basename(capture.artifactRoot),
        deadlineAt: options.deadlineAt,
        report: capture.report,
      });
      requireIosSuccessfulConnectionCommandDiagnostics(capture.report.commandExecutions);
      const preparation = preparationFromReport(capture.report);
      assert.deepEqual(preparation, preparationState, 'Camera preparation changed after callback');
      const backendRunId = backend.runId;
      const connectionApiIdentity = isRecord(capture.report.connectionApiIdentity)
        ? capture.report.connectionApiIdentity
        : {};
      const targetOrigin = connectionApiIdentity.targetOrigin;
      assert(typeof backendRunId === 'string' && id.test(backendRunId));
      assert(typeof targetOrigin === 'string' && targetOrigin.length > 0);
      requireCameraCaptureIdentity(preparation, {
        requestedRunId: options.requestedRunId,
        captureRunId: path.basename(capture.artifactRoot),
        backendRunId,
      });
      const transport = parseTransport(
        await readFile(
          path.join(capture.artifactRoot, 'transport-observations.private.json'),
          'utf8',
        ),
      );
      dependencies.validateIosCameraSubmissionPreparation({
        root: capture.artifactRoot,
        backendRunId,
        targetOrigin,
        preparation,
        transport,
        captureKind: capture.report.kind as string,
        captureMode: capture.report.mode as string,
      });
      // Publish the complete terminal adapter before the public consumer stages
      // the full evidence set. The exclusive public destination is written once.
      verificationResult = 'passed';
    } catch (error) {
      verificationResult = 'failed';
      verificationFailure =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : {
              name: 'UnknownError',
              message: 'iOS camera evidence verification rejected',
            };
      postCaptureFailureRecord ??= postCaptureFailure('verification', error);
    }
  }

  const outcomeWithoutRoot = {
    kind: 'private-owned-ios-camera-attempt-not-public-receipt' as const,
    requestedRunId: options.requestedRunId,
    requestedAttemptId: `${options.requestedRunId}:first`,
    captureRunId: path.basename(capture.artifactRoot),
    backendRunId: typeof backend.runId === 'string' ? backend.runId : null,
    captureExitCode: capture.exitCode,
    childExitCode: terminal.childExitCode,
    childSignal: terminal.childSignal,
    childClassification: terminal.childClassification,
    captureResult: terminal.captureResult,
    captureCleanup: terminal.captureCleanup,
    captureTimeout: terminal.captureTimeout,
    cancellation: terminal.cancellation,
    callbackInvocations,
    callbackCompleted,
    externalCleanupResult,
    verificationResult,
    verificationFailure,
    postCaptureFailure: postCaptureFailureRecord,
    deadline: captureDeadline(capture.report.deadline),
    commandDiagnostics: terminal.commandDiagnostics,
    censusFailures: terminal.censusFailures,
    outputFailures: terminal.outputFailures,
    assertionIds: nativeCameraDeniedAssertionIds,
    assertionContractSha256: contract.assertionContractSha256,
    fixtureRunId: typeof backend.runId === 'string' ? backend.runId : null,
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
    stagedManifestPath,
    nativePassingCases: 0 as const,
  };
  const outcome = { ...outcomeWithoutRoot, artifactRoot: capture.artifactRoot };
  try {
    await writeFile(
      path.join(capture.artifactRoot, 'camera-runtime-adapter.private.json'),
      JSON.stringify(outcomeWithoutRoot, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    outcome.postCaptureFailure ??= postCaptureFailure('adapter-write', error);
  }
  return outcome;
}

/** Validate the runner-owned namespace and absolute deadline before capture acquisition. */
export function requireIosCameraAttemptLifecycle(input: {
  outputRoot: string;
  deadlineAt: number;
  nowMs?: number;
}): void {
  assert(
    typeof input.outputRoot === 'string' &&
      path.isAbsolute(input.outputRoot) &&
      !input.outputRoot.includes('\0'),
    'iOS camera capture output root must be an absolute path',
  );
  const nowMs = input.nowMs ?? performance.now();
  assert(
    Number.isFinite(input.deadlineAt) && input.deadlineAt > nowMs,
    'iOS camera capture deadline must remain in the original future window',
  );
}

export { normalizeNativeCommandDiagnostic };
