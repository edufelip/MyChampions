import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  runOwnedAndroidNativeSession,
  type AndroidOwnedNativeSessionPreparation,
  type OwnedAndroidNativeSessionOptions,
  type OwnedAndroidNativeSessionResult,
} from './capture-android-testability';
import {
  removeAndroidCameraAnchoredFile,
  requireAndroidCameraCleanupProof,
  stageAndroidCameraPublicEvidence,
  type AndroidCameraPublicStageResult,
  writeAndroidCameraAnchoredFile,
} from './native-android-camera-public-staging';
import {
  collectAndVerifyAndroidCameraNativeRuntime,
  type AndroidCameraNativeRuntimeCollection,
  type AndroidCameraNativeRuntimeTerminal,
} from './native-android-camera-runtime-collector';
import { publishAndroidCameraNativeRuntimeFinalizerReceipt } from './native-android-camera-runtime-finalizer';
import { readOwnedAndroidStableFile } from './native-android-session-adapter';
import {
  buildAndroidCameraContext,
  type AndroidCameraCaptureBoundary,
} from './native-camera-android-capture-adapter';
import {
  ANDROID_CAMERA_ASSERTION_IDS,
  ANDROID_CAMERA_SCENARIO,
  requireAndroidCameraIdentityBoundary,
} from './native-camera-android-contract';
import {
  selectNativePilotScenario,
  type NativePilotArguments,
  type NativePilotSelection,
} from './native-pilot-contract';
import {
  normalizeNativeCommandDiagnostic,
  trainingAttemptChildExitCode,
} from './native-training-attempt-outcome';
import {
  runAndroidCameraAttemptV4,
  type AndroidCameraAttemptOptionsV4,
  type AndroidCameraOwnedSessionBridge,
} from './run-android-camera-attempt';
import type { AndroidCameraRuntimeEligibilityResult } from './native-android-camera-runtime-eligibility';
import type { AndroidCameraProducerReceipts } from './native-camera-android-producer';
import type { NativeExecutionDeadlines } from './native-runtime-preflight';
import type { AndroidMaestroQualifiedBuildReuse } from './t15-cold-android-maestro-build-reuse';

const RUN_ID = /^[a-f0-9]{24}$/u;

export const androidCameraPublicRequiredSourcePaths = Object.freeze([
  'scripts/testing/run-android-camera-attempt.ts',
  'scripts/testing/run-android-camera-attempt-core.ts',
  'scripts/testing/native-camera-android-capture-adapter.ts',
  'scripts/testing/native-camera-android-saved-flow.ts',
  '.maestro/flows/camera-denied-android.yaml',
  'scripts/testing/native-camera-android-contract.ts',
  'scripts/testing/native-camera-android-observation.ts',
  'scripts/testing/native-camera-android-producer.ts',
  'scripts/testing/run-android-camera-public-attempt.ts',
  'scripts/testing/native-android-camera-public-staging.ts',
  'scripts/testing/native-android-camera-runtime-collector.ts',
  'scripts/testing/native-android-camera-runtime-driver.ts',
  'scripts/testing/native-android-camera-runtime-dispatch.ts',
  'scripts/testing/native-android-camera-runtime-receipt.ts',
  'scripts/testing/native-android-camera-runtime-eligibility.ts',
  'scripts/testing/native-android-camera-runtime-finalizer.ts',
] as const);

export const androidCameraPublicRequiredDeclarationPath =
  'scripts/testing/run-android-camera-public-attempt.ts' as const;

type AndroidCaptureCleanup =
  'not-acquired' | 'cleaned' | { status: 'failed-recovery-retained'; resources: string[] } | null;
type PostCaptureFailurePhase = 'cleanup' | 'verification' | 'adapter-write';

export type AndroidCameraPublicAttemptResult = {
  kind: 'private-owned-android-camera-public-attempt-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string | null;
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
  captureCleanup: AndroidCaptureCleanup;
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGINT' | 'SIGTERM' | null;
  callbackInvocations: number;
  callbackCompleted: boolean;
  captureInvocation: {
    count: number;
    returned: boolean;
    exitCode: number;
    result: string;
  };
  captureCompleted: boolean;
  externalCleanupResult: 'passed' | 'failed';
  verificationResult: 'source-only' | 'blocked' | 'not-executed';
  verificationFailure: { name: string; message: string } | null;
  postCaptureFailure: {
    phase: PostCaptureFailurePhase;
    name: string;
    message: string;
  } | null;
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
  publicPassingCases: 0;
  publicPromotionEligible: false;
  artifactRoot: string;
  cameraProducer: AndroidCameraProducerReceipts | null;
  /** Private native proof only; public counts remain zero until the canonical receipt terminal. */
  nativeRuntime: AndroidCameraNativeRuntimeTerminal | null;
  nativeRuntimeFailure: { name: string; message: string } | null;
  /** The private eligibility proof is retained for the single outer terminal to re-read. */
  nativeRuntimeEligibility: AndroidCameraRuntimeEligibilityResult | null;
  nativeRuntimeFinalizerReceipt: { path: string; sha256: string } | null;
};

export type AndroidCameraPublicSessionRunner = (
  options: OwnedAndroidNativeSessionOptions,
) => Promise<OwnedAndroidNativeSessionResult>;

function requireCompleteCameraTerminal(
  runtime: AndroidCameraPublicAttemptResult,
  captureRunId: string,
  fixtureRunId: string,
): void {
  assert.equal(runtime.kind, 'private-owned-android-camera-public-attempt-not-public-receipt');
  assert.equal(runtime.captureRunId, captureRunId);
  assert.equal(runtime.fixtureRunId, fixtureRunId);
  assert.equal(runtime.verificationResult, 'source-only');
  assert.equal(runtime.captureCompleted, true);
  assert.equal(runtime.captureResult, 'observed');
  assert.equal(runtime.captureCleanup, 'cleaned');
  assert.equal(runtime.externalCleanupResult, 'passed');
  assert.equal(runtime.callbackInvocations, 1);
  assert.equal(runtime.callbackCompleted, true);
  assert.equal(runtime.captureInvocation.count, 1);
  assert.equal(runtime.captureInvocation.returned, true);
  assert.equal(runtime.captureInvocation.exitCode, 0);
  assert.equal(runtime.captureInvocation.result, 'observed');
  assert.equal(runtime.captureExitCode, 0);
  assert.equal(runtime.childClassification, 'completed');
  assert.equal(runtime.cancellation, null);
  assert.equal(runtime.captureTimeout, null);
  assert.equal(runtime.postCaptureFailure, null);
  assert.equal(runtime.verificationFailure, null);
  assert.deepEqual(runtime.censusFailures, []);
  assert.deepEqual(runtime.outputFailures, []);
  assert(runtime.commandDiagnostics.length > 0, 'Android camera command history is missing');
  assert(
    runtime.commandDiagnostics.every(
      (row) => row.execution === 'completed' && row.cleanup === 'cleaned',
    ),
    'Android camera command history is not a clean completed terminal history',
  );
  assert.equal(runtime.nativePassingCases, 0);
  assert.equal(runtime.publicPassingCases, 0);
  assert.equal(runtime.publicPromotionEligible, false);
  assert(runtime.cameraProducer, 'Android camera producer output is missing');
}

async function requireCurrentCameraSelection(options: {
  repositoryRoot: string;
  inventory: unknown;
  selection: NativePilotSelection;
}): Promise<void> {
  const root = await realpath(options.repositoryRoot);
  assert.equal(root, path.resolve(options.repositoryRoot));
  const current = await selectNativePilotScenario(
    options.selection.arguments,
    options.inventory,
    root,
  );
  assert.deepEqual(current.scenario, options.selection.scenario);
  assert.equal(current.scenarioHash, options.selection.scenarioHash);
  assert.equal(current.requirementHash, options.selection.requirementHash);
}

export async function finalizeAndroidCameraPublicEvidence(options: {
  repositoryRoot: string;
  inventory: unknown;
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  captureRunId: string;
  fixtureRunId: string;
  selection: NativePilotSelection;
  runtime: AndroidCameraPublicAttemptResult;
  signal?: AbortSignal;
  stage?: typeof stageAndroidCameraPublicEvidence;
  /** Resource-free control fired by the real stager after an owned file write. */
  onStagedFileWritten?: (relativePath: string) => void;
}): Promise<{
  sourceOnly: true;
  publicPromotionEligible: false;
  stage: AndroidCameraPublicStageResult;
}> {
  options.signal?.throwIfAborted();
  await requireCurrentCameraSelection(options);
  requireCompleteCameraTerminal(options.runtime, options.captureRunId, options.fixtureRunId);
  assert(options.runtime.cameraProducer);
  const stage = options.stage ?? stageAndroidCameraPublicEvidence;
  const result = await stage({
    captureRoot: options.captureRoot,
    outputRoot: options.outputRoot,
    requestedRunId: options.requestedRunId,
    captureRunId: options.captureRunId,
    fixtureRunId: options.fixtureRunId,
    selection: options.selection,
    producer: options.runtime.cameraProducer,
    signal: options.signal,
    onStagedFileWritten: options.onStagedFileWritten,
  });
  assert.equal(result.status, 'validated-source-only');
  assert.equal(result.publicPromotionEligible, false);
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.publicPassingCases, 0);
  assert.deepEqual(result.assertions, []);
  assert.deepEqual(result.assertionIds, [...ANDROID_CAMERA_ASSERTION_IDS]);
  return { sourceOnly: true, publicPromotionEligible: false, stage: result };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(isRecord(value), `${label} is not an object`);
  return value;
}

function runId(value: unknown, label: string): string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
  return value;
}

function errorRecord(error: unknown, phase: PostCaptureFailurePhase) {
  return {
    phase,
    name: error instanceof Error ? error.name.slice(0, 128) : 'UnknownError',
    message:
      error instanceof Error ? error.message.slice(0, 512) : 'Android camera public attempt failed',
  } as const;
}

async function publishAndroidCameraAdapterReceipt(options: {
  artifactRoot: string;
  outcome: AndroidCameraPublicAttemptResult;
  signal?: AbortSignal;
}): Promise<void> {
  const relativePath = 'android-camera-runtime-adapter.private.json';
  const bytes = Buffer.from(JSON.stringify(options.outcome, null, 2) + '\n', 'utf8');
  let published: Awaited<ReturnType<typeof writeAndroidCameraAnchoredFile>> | undefined;
  try {
    published = await writeAndroidCameraAnchoredFile({
      root: options.artifactRoot,
      relativePath,
      bytes,
      signal: options.signal,
    });
    const reread = await readOwnedAndroidStableFile({
      artifactRoot: options.artifactRoot,
      filePath: path.join(options.artifactRoot, relativePath),
      kind: 'sidecar',
      maxBytes: 32 * 1024 * 1024,
      signal: options.signal,
    });
    assert.equal(reread.receipt.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(reread.receipt.sizeBytes, bytes.byteLength);
    assert.deepEqual(JSON.parse(reread.bytes.toString('utf8')), options.outcome);
    options.signal?.throwIfAborted();
  } catch (error) {
    // Remove only the exact bytes this attempt published.  A changed or
    // replaced sidecar is retained for diagnosis instead of being deleted.
    try {
      const current = await readOwnedAndroidStableFile({
        artifactRoot: options.artifactRoot,
        filePath: path.join(options.artifactRoot, relativePath),
        kind: 'sidecar',
        maxBytes: 32 * 1024 * 1024,
      });
      if (current.bytes.equals(bytes) && published)
        await removeAndroidCameraAnchoredFile({
          parent: published.parent,
          name: published.name,
          parentIdentity: published.parentIdentity,
          identity: published.identity,
        });
    } catch {
      // Preserve the original publication failure and any evidence that
      // could not be safely identified for removal.
    }
    throw error;
  }
}

function captureDeadline(value: unknown): { step: string; deadlineMs: number } | null {
  if (!isRecord(value)) return null;
  if (typeof value.step !== 'string' || !Number.isFinite(value.deadlineMs)) return null;
  return { step: value.step, deadlineMs: value.deadlineMs as number };
}

function cleanupResult(report: Record<string, unknown>): 'passed' | 'failed' {
  const link = isRecord(report.androidCameraIndependentCleanup)
    ? report.androidCameraIndependentCleanup
    : null;
  return link?.result === 'passed' && link.censusStatus === 'available' ? 'passed' : 'failed';
}

async function requireAndroidCaptureCleanupIdentity(
  capture: OwnedAndroidNativeSessionResult,
  producer: AndroidCameraProducerReceipts,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const report = capture.report;
  const backend = record(report.backend, 'Android camera backend provenance');
  const device = record(report.device, 'Android camera device provenance');
  assert.equal(backend.runId, producer.identity.backendRunId);
  assert.equal(backend.backendAttemptId, producer.identity.backendAttemptId);
  assert.equal(device.runId, producer.identity.ownerRunId);
  const link = record(report.androidCameraIndependentCleanup, 'Android camera cleanup link');
  assert.equal(link.captureRunId, producer.captureRunId);
  assert.equal(link.result, 'passed');
  assert.equal(link.censusStatus, 'available');
  const receipt = record(link.cleanupReceipt, 'Android camera cleanup receipt');
  assert(typeof receipt.path === 'string');
  assert.equal(receipt.path, 'external-cleanup.private.json');
  assert.equal(receipt.kind, 'sidecar');
  assert.equal(receipt.verification, 'owned-stable-reader-v6');
  const observed = await readOwnedAndroidStableFile({
    artifactRoot: capture.artifactRoot,
    filePath: path.join(capture.artifactRoot, receipt.path),
    kind: 'sidecar',
    maxBytes: 32 * 1024 * 1024,
    signal,
  });
  assert.equal(observed.receipt.sha256, receipt.sha256);
  assert.equal(observed.receipt.sizeBytes, receipt.sizeBytes);
  assert.equal(observed.receipt.ownerUid, receipt.ownerUid);
  assert.equal(observed.receipt.mode, receipt.mode);
  const cleanup = record(
    JSON.parse(observed.bytes.toString('utf8')),
    'Android camera external cleanup proof',
  );
  requireAndroidCameraCleanupProof(cleanup, producer.captureRunId);
  signal?.throwIfAborted();
}

function reportTimings(
  report: Record<string, unknown>,
): AndroidCameraPublicAttemptResult['timingsMs'] {
  const timings = isRecord(report.timingsMs) ? report.timingsMs : {};
  const value = (key: string): number =>
    typeof timings[key] === 'number' && Number.isFinite(timings[key]) ? timings[key] : 0;
  return {
    build: value('build'),
    install: value('install'),
    reset: value('reset'),
    scenario: value('scenario'),
    verify: value('verify'),
    cleanup: value('cleanup'),
  };
}

function reportString(report: Record<string, unknown>, key: string): string | null {
  return typeof report[key] === 'string' ? report[key] : null;
}

const commandExecutions = new Set([
  'completed',
  'child-failed',
  'deadline',
  'cancelled',
  'output-limit',
  'output-failed',
  'harness-blocked',
]);

function projectCameraCaptureCleanup(value: unknown): AndroidCaptureCleanup {
  if (value === 'not-acquired' || value === 'cleaned') return value;
  if (
    isRecord(value) &&
    value.status === 'failed-recovery-retained' &&
    Array.isArray(value.resources) &&
    value.resources.every((resource) => typeof resource === 'string')
  )
    return {
      status: 'failed-recovery-retained',
      resources: [...value.resources],
    };
  return null;
}

function projectCameraTerminalFacts(input: {
  commandExecutions: unknown;
  callbackCompleted: boolean;
  captureResult: string;
  captureExitCode: number;
  captureCleanup: unknown;
  budgetTimeout: unknown;
  cancellation: unknown;
}): {
  commandDiagnostics: ReturnType<typeof normalizeNativeCommandDiagnostic>[];
  censusFailures: unknown[];
  outputFailures: NonNullable<
    ReturnType<typeof normalizeNativeCommandDiagnostic>['outputFailure']
  >[];
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  childClassification: ReturnType<typeof normalizeNativeCommandDiagnostic>['execution'];
  historyKnown: boolean;
  captureResult: string;
  captureCleanup: AndroidCaptureCleanup;
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGINT' | 'SIGTERM' | null;
} {
  const rawRows = Array.isArray(input.commandExecutions) ? input.commandExecutions : [];
  const commandDiagnostics = rawRows.map(normalizeNativeCommandDiagnostic);
  const historyKnown =
    rawRows.length > 0 &&
    rawRows.every((raw, index) => {
      const row = commandDiagnostics[index];
      if (!isRecord(raw)) return false;
      return (
        typeof row.label === 'string' &&
        row.label.trim().length > 0 &&
        (row.phase === 'build' || row.phase === 'step') &&
        row.execution !== null &&
        commandExecutions.has(row.execution) &&
        row.cleanup !== null &&
        typeof row.deadlineMs === 'number' &&
        Number.isFinite(row.deadlineMs) &&
        row.deadlineMs > 0
      );
    });
  const censusFailures = commandDiagnostics
    .map((row) => row.censusFailure)
    .filter((value): value is unknown => value !== null);
  const outputFailures = commandDiagnostics
    .map((row) => row.outputFailure)
    .filter((value): value is NonNullable<typeof value> => value !== null);
  const childSignal =
    commandDiagnostics.find((row) => row.childSignal !== null)?.childSignal ?? null;
  const nonCompleted = commandDiagnostics.find((row) => row.execution !== 'completed');
  const childClassification = !historyKnown
    ? ('harness-blocked' as const)
    : (nonCompleted?.execution ?? (input.callbackCompleted ? ('completed' as const) : null));
  const cancellation =
    input.cancellation === 'SIGINT' || input.cancellation === 'SIGTERM'
      ? input.cancellation
      : input.captureExitCode === 130
        ? 'SIGINT'
        : input.captureExitCode === 143
          ? 'SIGTERM'
          : null;
  return {
    commandDiagnostics,
    censusFailures,
    outputFailures,
    childExitCode: historyKnown
      ? trainingAttemptChildExitCode(commandDiagnostics, input.callbackCompleted)
      : null,
    childSignal,
    childClassification,
    historyKnown,
    captureResult: input.captureResult,
    captureCleanup: projectCameraCaptureCleanup(input.captureCleanup),
    captureTimeout: input.budgetTimeout === 'whole-capture' ? 'whole-capture' : null,
    cancellation,
  };
}

function resultFromCapture(input: {
  options: AndroidCameraPublicAttemptOptions;
  capture: OwnedAndroidNativeSessionResult | null;
  producer: AndroidCameraProducerReceipts | null;
  attempt: Awaited<ReturnType<typeof runAndroidCameraAttemptV4>>;
  failure: ReturnType<typeof errorRecord> | null;
}): AndroidCameraPublicAttemptResult {
  const report = input.capture ? record(input.capture.report, 'Android camera capture report') : {};
  const captureRunId = input.capture ? path.basename(input.capture.artifactRoot) : null;
  const backend = isRecord(report.backend) ? report.backend : {};
  const build = isRecord(report.build) ? report.build : {};
  const captureResult = reportString(report, 'result') ?? 'harness-blocked';
  const terminal = projectCameraTerminalFacts({
    commandExecutions: report.commandExecutions,
    callbackCompleted: report.result === 'observed' && input.capture?.exitCode === 0,
    captureResult,
    captureExitCode: input.capture?.exitCode ?? 2,
    captureCleanup: report.cleanup,
    budgetTimeout: report.budgetTimeout,
    cancellation: report.cancellation,
  });
  const captureCleanup = terminal.captureCleanup;
  const callbackInvocations =
    typeof report.androidCameraCallbackInvocations === 'number'
      ? report.androidCameraCallbackInvocations
      : 0;
  const callbackCompleted = report.androidCameraCallbackCompleted === true;
  const captureExitCode = input.capture?.exitCode ?? 2;
  const captureCompleted =
    captureExitCode === 0 &&
    terminal.historyKnown &&
    captureResult === 'observed' &&
    captureCleanup === 'cleaned' &&
    callbackInvocations === 1 &&
    callbackCompleted;
  const externalCleanupResult = input.capture ? cleanupResult(report) : 'failed';
  const sourceOnly =
    input.attempt.status === 'source-only' &&
    captureCompleted &&
    externalCleanupResult === 'passed' &&
    input.producer !== null;
  const failure =
    input.failure ??
    (sourceOnly
      ? null
      : errorRecord(
          new Error('Android camera source-only qualification is unavailable'),
          'verification',
        ));
  const verificationResult = sourceOnly
    ? 'source-only'
    : input.options.signal.aborted
      ? 'blocked'
      : 'blocked';
  const backendRunId =
    input.producer?.identity.backendRunId ??
    (typeof backend.runId === 'string' && RUN_ID.test(backend.runId) ? backend.runId : null);
  return {
    kind: 'private-owned-android-camera-public-attempt-not-public-receipt',
    requestedRunId: input.options.requestedRunId,
    requestedAttemptId: `${input.options.requestedRunId}:first`,
    captureRunId,
    backendRunId,
    backendAttemptId:
      input.producer?.identity.backendAttemptId ?? reportString(backend, 'backendAttemptId'),
    captureExitCode,
    childExitCode: terminal.childExitCode,
    childSignal: terminal.childSignal,
    childClassification: terminal.childClassification,
    captureResult: terminal.captureResult,
    captureCleanup,
    captureTimeout: terminal.captureTimeout,
    cancellation: terminal.cancellation,
    callbackInvocations,
    callbackCompleted,
    captureInvocation: {
      count: input.capture ? 1 : 0,
      returned: input.capture !== null,
      exitCode: captureExitCode,
      result: terminal.captureResult,
    },
    captureCompleted,
    externalCleanupResult,
    verificationResult,
    verificationFailure: failure,
    postCaptureFailure: failure,
    deadline: captureDeadline(report.deadline),
    commandDiagnostics: terminal.commandDiagnostics,
    censusFailures: terminal.censusFailures,
    outputFailures: terminal.outputFailures,
    assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
    assertionContractSha256:
      input.options.selection.scenario.pilotAssertionContract?.sha256 ?? null,
    fixtureRunId: backendRunId,
    fixtureHash: reportString(report, 'fixtureHash'),
    flagsHash: typeof build.environmentHash === 'string' ? build.environmentHash : null,
    toolVersions: isRecord(report.toolVersions)
      ? (report.toolVersions as Record<string, string>)
      : {},
    timingsMs: reportTimings(report),
    stagedManifestPath: null,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    artifactRoot: input.capture?.artifactRoot ?? input.options.outputRoot,
    cameraProducer: input.producer,
    nativeRuntime: null,
    nativeRuntimeFailure: null,
    nativeRuntimeEligibility: null,
    nativeRuntimeFinalizerReceipt: null,
  };
}

/**
 * Adapt the existing Android owned-session callback to the camera attempt
 * contract. This is the only production bridge: target/build/API/fixtures,
 * Maestro actions and cleanup stay owned by runOwnedAndroidNativeSession.
 */
export function createAndroidCameraOwnedSessionBridge(input: {
  expectedLocale: 'en-US' | 'pt-BR' | 'es-ES';
  deadlines?: NativeExecutionDeadlines;
  deadlineAtMonotonicMs?: number;
  coldResetOwnerRunId?: string;
  coldResetFixtureResetId?: string;
  prepareColdReset?: AndroidOwnedNativeSessionPreparation;
  qualifiedBuild?: AndroidMaestroQualifiedBuildReuse;
  sessionRunner?: AndroidCameraPublicSessionRunner;
  onProducer?: (producer: AndroidCameraProducerReceipts) => void;
}): AndroidCameraOwnedSessionBridge {
  const sessionRunner = input.sessionRunner ?? runOwnedAndroidNativeSession;
  return {
    run: async ({ requestedRunId, selection, signal, executeCamera }) => {
      runId(requestedRunId, 'Android camera requested outer run ID');
      if (signal.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error('Android camera owned session aborted before acquisition');
      }
      let producer: AndroidCameraProducerReceipts | null = null;
      const capture = await sessionRunner({
        charter: 'camera-denied',
        signal,
        deadlines: input.deadlines,
        deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
        coldResetOwnerRunId: input.coldResetOwnerRunId,
        coldResetFixtureResetId: input.coldResetFixtureResetId,
        prepareColdReset: input.prepareColdReset,
        qualifiedBuild: input.qualifiedBuild,
        selection,
        expectedLocale: input.expectedLocale,
        executeCamera: async (boundary: AndroidCameraCaptureBoundary) => {
          signal.throwIfAborted();
          requireAndroidCameraIdentityBoundary({
            requestedRunId,
            captureRunId: boundary.captureRunId,
            ownerRunId: boundary.ownerRunId,
            backendRunId: boundary.backendRunId,
          });
          const output = await executeCamera(buildAndroidCameraContext(boundary));
          producer = output;
          input.onProducer?.(output);
          return output;
        },
      });
      const capturedProducer = producer as AndroidCameraProducerReceipts | null;
      assert.equal(
        path.basename(capture.artifactRoot),
        capturedProducer?.captureRunId ?? path.basename(capture.artifactRoot),
      );
      assert.equal(capture.report.platform, 'android');
      assert.equal(capture.report.charter, 'camera-denied');
      assert(capturedProducer, 'Android camera producer callback did not return receipts');
      if (capture.exitCode !== 0 || capture.report.result !== 'observed')
        throw new Error('Android camera owned capture did not complete as observed');
      const cleanup = isRecord(capture.report.androidCameraIndependentCleanup)
        ? capture.report.androidCameraIndependentCleanup
        : null;
      if (
        capture.report.cleanup !== 'cleaned' ||
        cleanup?.result !== 'passed' ||
        cleanup.censusStatus !== 'available'
      )
        throw new Error('Android camera owned cleanup is not independently passed');
      await requireAndroidCaptureCleanupIdentity(capture, capturedProducer, signal);
      requireAndroidCameraIdentityBoundary({
        requestedRunId,
        captureRunId: capturedProducer.identity.captureRunId,
        ownerRunId: capturedProducer.identity.ownerRunId,
        backendRunId: capturedProducer.identity.backendRunId,
      });
      return {
        requestedRunId,
        captureRunId: capturedProducer.captureRunId,
        identity: capturedProducer.identity,
        producerStatus: capturedProducer.producerStatus,
        sourceSelectionHash: capturedProducer.sourceSelectionHash,
        localeStatus: capturedProducer.localeStatus,
        cleanup: {
          status: 'cleaned',
          verified: true,
          runId: capturedProducer.identity.backendRunId,
          ownerRunId: capturedProducer.identity.ownerRunId,
          resources: [],
          independentCensus: { status: 'complete', foreignResources: [] },
        },
      };
    },
  };
}

export function isAndroidCameraPublicArguments(args: NativePilotArguments): boolean {
  return (
    args.platform === 'android' &&
    args.engine === 'maestro' &&
    args.scenario === ANDROID_CAMERA_SCENARIO &&
    args.mode === 'integration'
  );
}

export function androidCameraPublicExecutionAdapter(selection: NativePilotSelection): boolean {
  return isAndroidCameraPublicArguments(selection.arguments);
}

export type AndroidCameraPublicAttemptOptions = {
  repositoryRoot: string;
  outputRoot: string;
  requestedRunId: string;
  selection: NativePilotSelection;
  signal: AbortSignal;
  /** Absolute monotonic deadline owned by run-native-pilot; never reset after capture. */
  deadlineAt?: number;
  deadlines?: NativeExecutionDeadlines;
  coldResetOwnerRunId?: string;
  coldResetFixtureResetId?: string;
  prepareColdReset?: AndroidOwnedNativeSessionPreparation;
  qualifiedBuild?: AndroidMaestroQualifiedBuildReuse;
  expectedLocale?: 'en-US' | 'pt-BR' | 'es-ES';
  requiredSourcePaths?: readonly string[];
  requiredDeclarationPath?: string;
  attemptRunner?: (
    options: AndroidCameraAttemptOptionsV4,
  ) => ReturnType<typeof runAndroidCameraAttemptV4>;
  sessionRunner?: AndroidCameraPublicSessionRunner;
};

/** Public Android camera caller; it deliberately returns a source-only result. */
export async function runAndroidCameraPublicAttempt(
  options: AndroidCameraPublicAttemptOptions,
): Promise<AndroidCameraPublicAttemptResult> {
  // Resolve the caller-owned monotonic deadline before any repository reads,
  // capture or cleanup work. A missing optional value gets one budget here;
  // it is never reconstructed after capture has consumed part of that budget.
  const deadlineAt =
    options.deadlineAt ?? performance.now() + (options.deadlines?.wholeRunMs ?? 2_400_000);
  assert(
    Number.isFinite(deadlineAt) && deadlineAt > performance.now(),
    'Android camera whole-run deadline expired before entry',
  );
  runId(options.requestedRunId, 'Android camera requested run ID');
  assert(
    androidCameraPublicExecutionAdapter(options.selection),
    'Android camera selection is unsupported',
  );
  const root = await realpath(options.repositoryRoot);
  assert.equal(root, options.repositoryRoot, 'Android camera repository root is not canonical');
  const inventory = JSON.parse(
    await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  const requiredSourcePaths = options.requiredSourcePaths ?? androidCameraPublicRequiredSourcePaths;
  const requiredDeclarationPath =
    options.requiredDeclarationPath ?? androidCameraPublicRequiredDeclarationPath;
  let capture: OwnedAndroidNativeSessionResult | null = null;
  let producer: AndroidCameraProducerReceipts | null = null;
  let failure: ReturnType<typeof errorRecord> | null = null;
  const bridge = createAndroidCameraOwnedSessionBridge({
    expectedLocale: options.expectedLocale ?? 'en-US',
    deadlines: options.deadlines,
    deadlineAtMonotonicMs: deadlineAt,
    coldResetOwnerRunId: options.coldResetOwnerRunId,
    coldResetFixtureResetId: options.coldResetFixtureResetId,
    prepareColdReset: options.prepareColdReset,
    qualifiedBuild: options.qualifiedBuild,
    onProducer: (value) => {
      producer = value;
    },
    sessionRunner: async (sessionOptions) => {
      const result = await (options.sessionRunner ?? runOwnedAndroidNativeSession)(sessionOptions);
      capture = result;
      return result;
    },
  });
  let attempt: Awaited<ReturnType<typeof runAndroidCameraAttemptV4>>;
  try {
    attempt = await (options.attemptRunner ?? runAndroidCameraAttemptV4)({
      repositoryRoot: root,
      inventory,
      requestedRunId: options.requestedRunId,
      selection: options.selection,
      requiredSourcePaths,
      requiredDeclarationPath,
      signal: options.signal,
      bridge,
    });
  } catch (error) {
    failure = errorRecord(error, 'verification');
    attempt = {
      kind: 'private-owned-android-camera-v4-attempt',
      status: options.signal.aborted ? 'cancelled' : 'harness-blocked',
      requestedRunId: options.requestedRunId,
      captureRunId: null,
      callbackInvocations: 0,
      runtimeQualification: 'Pending',
      publicPromotionEligible: false,
      nativePassingCases: 0,
      cleanup: 'not-acquired',
      blockedGates: [],
      errorName: error instanceof Error ? error.name : 'UnknownError',
      selectionRevalidated: false,
      bridgeInvoked: false,
      producerOutput: 'not-run',
    };
  }
  const outcome = resultFromCapture({
    options,
    capture,
    producer,
    attempt,
    failure,
  });
  const captured = capture as OwnedAndroidNativeSessionResult | null;
  if (
    captured &&
    producer &&
    outcome.captureCompleted &&
    outcome.externalCleanupResult === 'passed' &&
    outcome.verificationResult === 'source-only'
  ) {
    try {
      const capturedProducer = producer as AndroidCameraProducerReceipts;
      assert(
        Number.isFinite(deadlineAt) && deadlineAt > performance.now(),
        'Android camera whole-run deadline expired before runtime collection',
      );
      const nativeRuntime: AndroidCameraNativeRuntimeCollection =
        await collectAndVerifyAndroidCameraNativeRuntime({
          capture: captured,
          producer: capturedProducer,
          repositoryRoot: root,
          outputRoot: options.outputRoot,
          requestedRunId: options.requestedRunId,
          requestedAttemptId: `${options.requestedRunId}:first`,
          captureRunId: capturedProducer.captureRunId,
          selection: options.selection,
          deadlineAt,
          signal: options.signal,
        });
      const finalizerReceipt = await publishAndroidCameraNativeRuntimeFinalizerReceipt({
        repositoryRoot: root,
        eligibility: nativeRuntime.eligibility,
        captureRoot: captured.artifactRoot,
        outputRoot: options.outputRoot,
        signal: options.signal,
        deadlineAt,
      });
      outcome.nativeRuntime = nativeRuntime.terminal;
      outcome.nativeRuntimeFailure = null;
      outcome.nativeRuntimeEligibility = nativeRuntime.eligibility;
      outcome.nativeRuntimeFinalizerReceipt = {
        path: finalizerReceipt.path,
        sha256: finalizerReceipt.sha256,
      };
      // This is intentionally still the source-only public adapter result.
      // The private native proof cannot change the canonical public counts.
      assert.equal(outcome.nativePassingCases, 0);
      assert.equal(outcome.publicPassingCases, 0);
      assert.equal(outcome.publicPromotionEligible, false);
    } catch (error) {
      outcome.nativeRuntime = null;
      outcome.nativeRuntimeFailure = {
        name: error instanceof Error ? error.name.slice(0, 128) : 'UnknownError',
        message:
          error instanceof Error
            ? error.message.slice(0, 512)
            : 'Android native runtime collection failed',
      };
      outcome.nativeRuntimeEligibility = null;
      outcome.nativeRuntimeFinalizerReceipt = null;
    }
  }
  if (captured) {
    try {
      await publishAndroidCameraAdapterReceipt({
        artifactRoot: captured.artifactRoot,
        outcome,
        signal: options.signal,
      });
    } catch (error) {
      outcome.postCaptureFailure ??= errorRecord(error, 'adapter-write');
      outcome.verificationResult = 'blocked';
    }
  }
  return outcome;
}
