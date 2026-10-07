import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  createOwnedAndroidDetoxConnectionProducer,
  requireAndroidDetoxCleanupResult,
  requireAndroidDetoxConnectionProducer,
  type AndroidDetoxConnectionProducer,
} from './detox-android-connection-producer';
import {
  ANDROID_DETOX_BUILD_DESCRIPTOR_NAME,
  inspectAndroidDetoxBuildArtifacts,
  prepareAndroidDetoxQualifiedBuild,
  requireAndroidDetoxBuildDescriptor,
  type AndroidDetoxBuildDescriptor,
} from './detox-android-qualified-build';
import { acquireDetoxConnectionArtifactRoot } from './detox-connection-artifact-root';
import { runOwnedDetoxConnectionAttempt } from './detox-integrated-connection-driver';
import {
  requireDetoxBuildInstrumentation,
  type DetoxBaselineBuildInstrumentation,
  type DetoxBaselineFactories,
} from './detox-integrated-session-baseline';
import {
  requireDetoxRuntimeBuildMetadata,
  type DetoxRuntimeBuildMetadata,
} from './detox-runtime-build-metadata';
import { requireDetoxSaveRetrySelection } from './detox-save-retry-owned-dispatch';
import {
  nativeConnectionAssertionIds,
  nativeSaveRetryAssertionIds,
  requireNativePilotAssertions,
  selectNativePilotScenario,
  type NativePilotSelection,
} from './native-pilot-contract';
import { readNativeEvidenceObservation } from './native-view-evidence';
import type { DetoxConnectionAttemptResult } from './detox-integrated-connection-baseline';
import type { DetoxConnectionDriverOptions } from './detox-integrated-connection-driver';
import type { DetoxSaveRetryOwnerRuntimeSource } from './detox-save-retry-runtime-finalizer';

const runIdPattern = /^[a-f0-9]{24}$/;
const hashPattern = /^[a-f0-9]{64}$/;

export const DETOX_ANDROID_CONNECTION_PUBLIC_OWNER = 'detox-driver' as const;
export const DETOX_ANDROID_CONNECTION_PUBLIC_DISPATCH = 'android-detox-connection' as const;
export const DETOX_ANDROID_SAVE_RETRY_PUBLIC_DISPATCH = 'android-detox-save-retry' as const;
export const ANDROID_DETOX_CONNECTION_PUBLIC_DISPATCH = DETOX_ANDROID_CONNECTION_PUBLIC_DISPATCH;
export const DETOX_ANDROID_CONNECTION_PUBLIC_STATUS = 'source-only' as const;

export type DetoxAndroidConnectionPublicBridgeInput = Readonly<{
  owner: typeof DETOX_ANDROID_CONNECTION_PUBLIC_OWNER;
  repositoryRoot: string;
  serverRoot: string;
  artifactRoot: string;
  /** Outer public attempt root; production supplies a distinct capture root. */
  captureRoot?: string;
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  /** Optional T14-E branch executed by the already-acquired connection owner. */
  saveRetrySelection?: NativePilotSelection;
  build: DetoxBaselineBuildInstrumentation;
  runnerPaths: Readonly<{
    jestConfigPath: string;
    testPath: string;
    saveRetryActionsPath?: string;
  }>;
  signal: AbortSignal;
  deadlineMs: number;
  /** Aggregate caller deadline; it must not be renewed by the Android branch. */
  deadlineAtMonotonicMs: number;
  parentEnv?: Readonly<Record<string, string | undefined>>;
  /** Resource boundary seam for private controls; production leaves it unset. */
  factories?: DetoxBaselineFactories;
  /** Resource boundary seam for private controls; production leaves it unset. */
  startOwnedNativeCommand?: NonNullable<DetoxConnectionDriverOptions['startOwnedNativeCommand']>;
  producer?: AndroidDetoxConnectionProducer;
  delegate?: DetoxAndroidConnectionDriverDelegate;
  validateBuild?: (
    build: DetoxBaselineBuildInstrumentation,
    repositoryRoot: string,
  ) => void | Promise<void>;
}>;

export type DetoxAndroidConnectionDriverDelegate = (
  options: DetoxConnectionDriverOptions & {
    androidProducer: AndroidDetoxConnectionProducer;
  },
) => Promise<DetoxConnectionAttemptResult>;

export const androidDetoxConnectionDefaultDelegate: DetoxAndroidConnectionDriverDelegate =
  runOwnedDetoxConnectionAttempt;

export type DetoxAndroidConnectionPublicBridgeResult = Readonly<{
  kind: 'private-detox-android-connection-public-bridge-result-not-public-receipt';
  owner: typeof DETOX_ANDROID_CONNECTION_PUBLIC_OWNER;
  engine: 'detox';
  platform: 'android';
  requestedRunId: string;
  captureRunId: string;
  captureRoot: string;
  publicOutputRoot: string;
  requestedAttemptId: string;
  selection: Readonly<{
    arguments: NativePilotSelection['arguments'];
    scenarioId: string;
    scenarioHash: string;
    requirementHash: string;
    assertionIds: readonly string[];
  }>;
  saveRetrySelection?: Readonly<{
    arguments: NativePilotSelection['arguments'];
    scenarioId: string;
    scenarioHash: string;
    requirementHash: string;
    assertionIds: readonly string[];
  }>;
  declaredBuildIdentity: Readonly<{
    sourceTreeHash: string;
    helperInputsHash: string;
    binaryHash: string;
    testBinaryHash: string;
    detoxConfigHash: string;
  }>;
  attempt: DetoxConnectionAttemptResult;
  /** Producer-owned source proof; staging binds copied paths before finalization. */
  detoxSaveRetryRuntimeSource?: DetoxSaveRetryOwnerRuntimeSource;
  nativePassingCases: 0;
  publicPromotionEligible: false;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && hashPattern.test(value), `${label} must be a SHA-256 hash`);
}

function requireRunId(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' && runIdPattern.test(value),
    `${label} must be a 24-character run ID`,
  );
}

export function requireAndroidDetoxConnectionPublicSelection(
  selection: NativePilotSelection,
): NativePilotSelection {
  assert.deepEqual(selection.arguments, {
    platform: 'android',
    engine: 'detox',
    scenario: 'SCN-connection-android',
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, 'SCN-connection-android');
  assert.equal(selection.scenario.platform, 'android');
  assert.equal(selection.scenario.flowId, 'FLW-connection');
  assert.equal(selection.scenario.dataMode, 'postgres');
  assert.equal(
    selection.scenario.fixtureRef,
    'owned-postgres:SCN-connection-android:fresh-attempt',
  );
  assert(
    selection.scenario.engine === undefined || selection.scenario.engine === 'detox',
    'Android Detox selection is bound to the Detox scenario declaration',
  );
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    [...nativeConnectionAssertionIds],
    'Android Detox connection assertion order differs from the shared contract',
  );
  requireHash(selection.scenarioHash, 'Android Detox scenario hash');
  requireHash(selection.requirementHash, 'Android Detox requirement hash');
  return selection;
}

export function androidDetoxConnectionExecutionAdapter(
  args: NativePilotSelection['arguments'],
): typeof DETOX_ANDROID_CONNECTION_PUBLIC_DISPATCH | null {
  return args.platform === 'android' &&
    args.engine === 'detox' &&
    args.scenario === 'SCN-connection-android' &&
    args.mode === 'integration'
    ? DETOX_ANDROID_CONNECTION_PUBLIC_DISPATCH
    : null;
}

export function requireAndroidDetoxSaveRetryPublicSelection(
  selection: NativePilotSelection,
): NativePilotSelection {
  const valid = requireDetoxSaveRetrySelection(selection);
  assert.deepEqual(valid.arguments, {
    platform: 'android',
    engine: 'detox',
    scenario: 'SCN-save-retry-android',
    mode: 'integration',
  });
  assert.deepEqual(
    requireNativePilotAssertions(valid).map((row) => row.id),
    [...nativeSaveRetryAssertionIds],
  );
  return valid;
}

export function androidDetoxSaveRetryExecutionAdapter(
  selection: NativePilotSelection,
): typeof DETOX_ANDROID_SAVE_RETRY_PUBLIC_DISPATCH | null {
  try {
    requireAndroidDetoxSaveRetryPublicSelection(selection);
    return DETOX_ANDROID_SAVE_RETRY_PUBLIC_DISPATCH;
  } catch {
    return null;
  }
}

async function selectAndroidDetoxConnectionOwnerSelection(
  repositoryRoot: string,
): Promise<NativePilotSelection> {
  const root = await realpath(path.resolve(repositoryRoot));
  const inventory = JSON.parse(
    await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  return selectNativePilotScenario(
    {
      platform: 'android',
      engine: 'detox',
      scenario: 'SCN-connection-android',
      mode: 'integration',
    },
    inventory,
    root,
  );
}

function requireBridgePaths(input: DetoxAndroidConnectionPublicBridgeInput) {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const serverRoot = path.resolve(input.serverRoot);
  const publicOutputRoot = path.resolve(input.artifactRoot);
  const captureRoot = path.resolve(input.captureRoot ?? input.artifactRoot);
  requireRunId(input.requestedRunId, 'Android Detox requested run ID');
  if (!input.captureRoot)
    assert(input.delegate, 'Production Android Detox bridge requires a distinct capture root');
  if (input.captureRoot) {
    requireRunId(path.basename(captureRoot), 'Android Detox capture run ID');
    assert.notEqual(
      captureRoot,
      publicOutputRoot,
      'Android Detox capture root must be distinct from the public output root',
    );
    assert.equal(
      path.dirname(captureRoot),
      path.join(repositoryRoot, '.qa/artifacts/native-pilot'),
      'Android Detox capture root is outside the owned capture namespace',
    );
  }
  assert.equal(
    input.requestedAttemptId,
    `${input.requestedRunId}:first`,
    'Android Detox public bridge only accepts the original first attempt',
  );
  assert.equal(input.owner, DETOX_ANDROID_CONNECTION_PUBLIC_OWNER);
  assert.notEqual(repositoryRoot, serverRoot);
  assert.equal(
    publicOutputRoot,
    path.join(repositoryRoot, '.qa/artifacts/native-pilot-attempts', input.requestedRunId),
  );
  assert(input.signal instanceof AbortSignal);
  assert(
    Number.isSafeInteger(input.deadlineMs) &&
      input.deadlineMs >= 30_000 &&
      input.deadlineMs <= 600_000,
    'Android Detox public bridge deadline is outside the owned driver range',
  );
  const runnerPaths = {
    jestConfigPath: path.resolve(input.runnerPaths.jestConfigPath),
    testPath: path.resolve(input.runnerPaths.testPath),
    ...(input.runnerPaths.saveRetryActionsPath
      ? {
          saveRetryActionsPath: path.resolve(input.runnerPaths.saveRetryActionsPath),
        }
      : {}),
  };
  assert.equal(
    runnerPaths.jestConfigPath,
    path.join(repositoryRoot, 'e2e/jest.detox-integrated-connection-baseline.config.js'),
  );
  assert.equal(
    runnerPaths.testPath,
    path.join(repositoryRoot, 'e2e/detox-integrated-connection-baseline.e2e.test.js'),
  );
  if (input.saveRetrySelection) {
    assert.equal(
      runnerPaths.saveRetryActionsPath,
      path.join(repositoryRoot, 'scripts/testing/detox-save-retry-child-actions.js'),
      'Android Detox save/retry actions are outside the checked-in child contract',
    );
  }
  return { repositoryRoot, serverRoot, artifactRoot: captureRoot, publicOutputRoot, runnerPaths };
}

function requireAttemptResult(
  attempt: DetoxConnectionAttemptResult,
  input: DetoxAndroidConnectionPublicBridgeInput,
): void {
  assert.equal(attempt.kind, 'private-detox-connection-attempt-not-public-receipt');
  assert(['source-only', 'blocked', 'cancelled', 'deadline'].includes(attempt.status));
  assert(['not-acquired', 'cleaned', 'failed'].includes(attempt.cleanup));
  assert.equal(attempt.selectionValid, true);
  assert.equal(attempt.nativePassingCases, 0);
  assert.equal(attempt.publicPromotionEligible, false);
  if (attempt.status === 'source-only') {
    assert(attempt.acquired, 'Android Detox source-only result must retain acquisition facts');
    assert.equal(attempt.cleanup, 'cleaned');
    assert.equal(attempt.recoveryStatus, 'verified');
    assert(attempt.report !== null);
    const report = record(attempt.report, 'Android Detox producer report');
    const cleanup = requireAndroidDetoxCleanupResult(report.detoxAndroidCleanup);
    assert.equal(
      cleanup.runId,
      input.requestedRunId,
      'Android independent cleanup belongs to a different attempt',
    );
    if (input.saveRetrySelection) {
      const originals = report.detoxOriginalProducerReceipts;
      assert(
        Array.isArray(originals) && originals.length >= 8,
        'Android Detox producer original receipt bundle/source is missing',
      );
      const producer = record(report.detoxProducerReceipt, 'Android Detox producer receipt');
      assert.equal(
        producer.captureRunId,
        path.basename(path.resolve(input.captureRoot ?? input.artifactRoot)),
      );
      assert.equal(String(producer.artifactRoot), String(report.output));
    }
  }
  if (attempt.cleanup === 'failed')
    assert.notEqual(attempt.recoveryStatus, 'verified', 'Failed cleanup cannot be verified');
  if (input.signal.aborted)
    assert(
      attempt.status === 'cancelled' || attempt.status === 'deadline',
      'Android Detox delegate completed after cancellation',
    );
}

export async function runAndroidDetoxConnectionPublicAttempt(
  input: DetoxAndroidConnectionPublicBridgeInput,
  dependencies?: Readonly<{
    runOwnedDetoxConnectionAttempt: DetoxAndroidConnectionDriverDelegate;
  }>,
): Promise<DetoxAndroidConnectionPublicBridgeResult> {
  assert(
    Number.isFinite(input.deadlineAtMonotonicMs) && input.deadlineAtMonotonicMs > performance.now(),
    'Android Detox public route requires the caller-owned absolute deadline',
  );
  const paths = requireBridgePaths(input);
  requireAndroidDetoxConnectionPublicSelection(input.selection);
  if (input.saveRetrySelection)
    requireAndroidDetoxSaveRetryPublicSelection(input.saveRetrySelection);
  const validateBuild =
    input.validateBuild ??
    ((build: DetoxBaselineBuildInstrumentation, repositoryRoot: string) => {
      requireDetoxBuildInstrumentation(build, repositoryRoot);
    });
  await validateBuild(input.build, paths.repositoryRoot);
  input.signal.throwIfAborted();
  const producer = requireAndroidDetoxConnectionProducer(
    input.producer ?? createOwnedAndroidDetoxConnectionProducer(),
  );
  const delegate =
    input.delegate ??
    dependencies?.runOwnedDetoxConnectionAttempt ??
    androidDetoxConnectionDefaultDelegate;
  const attempt = await delegate({
    repositoryRoot: paths.repositoryRoot,
    serverRoot: paths.serverRoot,
    artifactRoot: paths.artifactRoot,
    selection: input.selection,
    build: input.build,
    configuration: input.build.configuration,
    runnerPaths: paths.runnerPaths,
    parentEnv: input.parentEnv,
    signal: input.signal,
    deadlineMs: input.deadlineMs,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    ...(input.factories ? { factories: input.factories } : {}),
    ...(input.startOwnedNativeCommand
      ? { startOwnedNativeCommand: input.startOwnedNativeCommand }
      : {}),
    androidProducer: producer,
    ...(input.saveRetrySelection ? { saveRetrySelection: input.saveRetrySelection } : {}),
  });
  requireAttemptResult(attempt, input);
  const attemptReport =
    attempt.report && typeof attempt.report === 'object' && !Array.isArray(attempt.report)
      ? attempt.report
      : null;
  const runtimeSource = attemptReport?.detoxSaveRetryRuntimeSource;
  if (input.saveRetrySelection && attempt.status === 'source-only') {
    assert(attemptReport, 'Android Detox save/retry source-only result lost its report');
    requireAndroidSaveRetryReportSummary(attemptReport, input);
    assert(runtimeSource, 'Android Detox save/retry owner did not emit producer source');
  }
  return Object.freeze({
    kind: 'private-detox-android-connection-public-bridge-result-not-public-receipt' as const,
    owner: DETOX_ANDROID_CONNECTION_PUBLIC_OWNER,
    engine: 'detox' as const,
    platform: 'android' as const,
    requestedRunId: input.requestedRunId,
    captureRunId: path.basename(paths.artifactRoot),
    captureRoot: paths.artifactRoot,
    publicOutputRoot: paths.publicOutputRoot,
    requestedAttemptId: input.requestedAttemptId,
    selection: Object.freeze({
      arguments: input.selection.arguments,
      scenarioId: input.selection.scenario.id,
      scenarioHash: input.selection.scenarioHash,
      requirementHash: input.selection.requirementHash,
      assertionIds: [...nativeConnectionAssertionIds],
    }),
    ...(input.saveRetrySelection
      ? {
          saveRetrySelection: Object.freeze({
            arguments: input.saveRetrySelection.arguments,
            scenarioId: input.saveRetrySelection.scenario.id,
            scenarioHash: input.saveRetrySelection.scenarioHash,
            requirementHash: input.saveRetrySelection.requirementHash,
            assertionIds: [...nativeSaveRetryAssertionIds],
          }),
        }
      : {}),
    declaredBuildIdentity: Object.freeze({
      sourceTreeHash: input.build.source.sourceTreeHash,
      helperInputsHash: input.build.helperInputsHash,
      binaryHash: input.build.binaryHash,
      testBinaryHash: input.build.testBinaryHash!,
      detoxConfigHash: input.build.detoxConfigHash,
    }),
    attempt,
    ...(runtimeSource !== undefined
      ? {
          detoxSaveRetryRuntimeSource: runtimeSource as DetoxSaveRetryOwnerRuntimeSource,
        }
      : {}),
    nativePassingCases: 0,
    publicPromotionEligible: false,
  });
}

export async function runAndroidDetoxSaveRetryPublicAttempt(
  input: DetoxAndroidConnectionPublicBridgeInput,
): Promise<DetoxAndroidConnectionPublicBridgeResult> {
  assert(input.saveRetrySelection, 'Android Detox save/retry selection is missing');
  requireAndroidDetoxConnectionPublicSelection(input.selection);
  requireAndroidDetoxSaveRetryPublicSelection(input.saveRetrySelection);
  assert.equal(input.owner, DETOX_ANDROID_CONNECTION_PUBLIC_OWNER);
  const result = await runAndroidDetoxConnectionPublicAttempt(input);
  assert.equal(result.engine, 'detox');
  assert.equal(result.platform, 'android');
  assert.equal(result.owner, DETOX_ANDROID_CONNECTION_PUBLIC_OWNER);
  assert(result.saveRetrySelection, 'Android Detox save/retry result lost its selection');
  assert(
    result.detoxSaveRetryRuntimeSource,
    'Android Detox save/retry result lost producer source',
  );
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.publicPromotionEligible, false);
  return result;
}

const ANDROID_DETOX_BUILD_DESCRIPTOR_MAX_BYTES = 256 * 1024;
const DETOX_MIN_DISPATCH_DEADLINE_MS = 30_000;
const DETOX_MAX_DISPATCH_DEADLINE_MS = 600_000;

function requireBuildRunId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && runIdPattern.test(value), `${label} is invalid`);
}

export type DetoxAndroidBuildLoaderInput = Readonly<{
  repositoryRoot: string;
  buildRunId: string;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
}>;

function dispatchFence(input: DetoxAndroidBuildLoaderInput, label: string): void {
  input.signal.throwIfAborted();
  assert(
    Number.isFinite(input.deadlineAtMonotonicMs) && performance.now() < input.deadlineAtMonotonicMs,
    `Android Detox build descriptor deadline expired during ${label}`,
  );
}

/**
 * Read the actual producer-owned Android build descriptor.  The descriptor is
 * only an immutable binding to the checked-in Detox debug APK/test APK and
 * current source/config hashes; this loader never builds, copies, or accepts a
 * caller filename as evidence.
 */
export async function loadAndroidDetoxQualifiedBuild(
  input: DetoxAndroidBuildLoaderInput,
): Promise<DetoxBaselineBuildInstrumentation> {
  requireBuildRunId(input.buildRunId, 'Android Detox build run ID');
  dispatchFence(input, 'descriptor start');
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const relative = path.posix.join(
    '.qa/artifacts/native-pilot',
    input.buildRunId,
    ANDROID_DETOX_BUILD_DESCRIPTOR_NAME,
  );
  const observation = readNativeEvidenceObservation(repositoryRoot, relative, true, 'owned-source');
  dispatchFence(input, 'descriptor read');
  assert(observation.bytes.byteLength <= ANDROID_DETOX_BUILD_DESCRIPTOR_MAX_BYTES);
  let descriptor: AndroidDetoxBuildDescriptor;
  try {
    descriptor = requireAndroidDetoxBuildDescriptor(
      JSON.parse(observation.bytes.toString('utf8')),
      repositoryRoot,
    );
  } catch (error) {
    throw new Error('Android Detox qualified build descriptor is invalid', {
      cause: error,
    });
  }
  assert.equal(descriptor.buildRunId, input.buildRunId);
  const producerReceipt = readNativeEvidenceObservation(
    repositoryRoot,
    path.relative(repositoryRoot, descriptor.producerReceiptPath),
    true,
    'owned-source',
  );
  assert.equal(
    createHash('sha256').update(producerReceipt.bytes).digest('hex'),
    descriptor.producerReceiptHash,
    'Android Detox build producer receipt changed after descriptor publication',
  );
  const receipt = record(
    JSON.parse(producerReceipt.bytes.toString('utf8')),
    'Android Detox build receipt',
  );
  assert.equal(receipt.kind, 'private-android-detox-build-execution-not-public-receipt');
  assert.equal(receipt.buildRunId, input.buildRunId);
  assert.equal(receipt.execution, 'completed');
  assert.equal(receipt.cleanup, 'cleaned');
  assert.equal(receipt.childExitCode, 0);
  assert.equal(receipt.childSignal, null);
  requireDetoxBuildInstrumentation(descriptor.build, repositoryRoot);
  const inspected = await inspectAndroidDetoxBuildArtifacts({
    repositoryRoot,
    build: descriptor.build,
  });
  dispatchFence(input, 'descriptor qualification');
  assert.equal(inspected.platform, 'android');
  return inspected;
}

export type DetoxAndroidNativePilotAttemptResult = Readonly<{
  kind: 'private-owned-android-detox-connection-attempt-not-public-receipt';
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
    'not-acquired' | 'cleaned' | { status: 'failed-recovery-retained'; resources: string[] };
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGINT' | 'SIGTERM' | null;
  callbackInvocations: number;
  callbackCompleted: boolean;
  externalCleanupResult: 'passed' | 'failed';
  verificationResult: 'passed' | 'failed' | 'not-executed';
  applicationFailure: null;
  applicationFailureCandidate: null;
  verificationFailure: { name: string; message: string } | null;
  postCaptureFailure: {
    phase: 'verification';
    name: string;
    message: string;
  } | null;
  deadline: { step: string; deadlineMs: number } | null;
  commandDiagnostics: unknown[];
  censusFailures: unknown[];
  outputFailures: unknown[];
  assertionBindings: never[];
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
  publicFinalization: null;
  publicFinalizationInput: null;
  publicDependency: null;
  captureInvocation: { count: number; returned: boolean };
  captureCompleted: boolean;
  censusFailureCount: number;
  staged: null;
  faultAttemptId: null;
  detoxBridgeResult: DetoxAndroidConnectionPublicBridgeResult;
  detoxBuild: DetoxBaselineBuildInstrumentation;
  detoxOwnerSelection: NativePilotSelection;
  detoxSaveRetrySelection?: NativePilotSelection;
  detoxSaveRetryRuntimeSource?: DetoxSaveRetryOwnerRuntimeSource;
}>;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function reportTiming(report: Record<string, unknown> | null, name: string): number {
  const timings = objectRecord(report?.detoxRuntimeTimingsMs);
  const value = timings?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Project the producer-owned Android attempt into the runner shape.  Keeping
 * this pure projection exported lets source controls exercise the same
 * producer-to-runner boundary used by the native path without creating a
 * second adapter or claiming a device run.
 */
export function projectAndroidDetoxAttemptForNativePilot(
  input: Readonly<{
    result: DetoxAndroidConnectionPublicBridgeResult;
    ownerSelection: NativePilotSelection;
    saveRetrySelection?: NativePilotSelection;
    artifactRoot: string;
    build: DetoxBaselineBuildInstrumentation;
    postCaptureFailure?: DetoxAndroidNativePilotAttemptResult['postCaptureFailure'];
  }>,
): DetoxAndroidNativePilotAttemptResult {
  const attempt = input.result.attempt;
  const report = objectRecord(attempt.report);
  const producer = objectRecord(report?.detoxProducerReceipt);
  const backend = objectRecord(report?.backend);
  const sourceOnly = attempt.status === 'source-only';
  const failure = attempt.failures[0];
  let runtimeMetadata: DetoxRuntimeBuildMetadata | null = null;
  let runtimeMetadataFailure: DetoxAndroidNativePilotAttemptResult['postCaptureFailure'] = null;
  try {
    const reportedBuild = objectRecord(report?.build);
    assert(reportedBuild, 'Android Detox producer report is missing its actual build record');
    const reportedMetadata = {
      environmentHash: reportedBuild.environmentHash,
      toolVersions: reportedBuild.toolVersions,
      toolVersionEvidence: reportedBuild.toolVersionEvidence,
    };
    requireDetoxRuntimeBuildMetadata(reportedMetadata, 'Android Detox producer runtime metadata');
    requireDetoxRuntimeBuildMetadata(input.build, 'Android Detox qualified runtime metadata');
    assert.equal(
      reportedMetadata.environmentHash,
      input.build.environmentHash,
      'Android Detox producer flags profile differs from the qualified build',
    );
    assert.deepEqual(
      reportedMetadata.toolVersions,
      input.build.toolVersions,
      'Android Detox producer tool versions differ from the qualified build',
    );
    assert.deepEqual(
      reportedMetadata.toolVersionEvidence,
      input.build.toolVersionEvidence,
      'Android Detox producer tool evidence differs from the qualified build',
    );
    runtimeMetadata = reportedMetadata;
  } catch (error) {
    runtimeMetadataFailure = {
      phase: 'verification',
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const producerCaptureRunId = producer?.captureRunId;
  const backendAttemptId =
    typeof producer?.backendAttemptId === 'string' ? producer.backendAttemptId : null;
  if (sourceOnly) {
    assert(
      typeof producerCaptureRunId === 'string' &&
        producerCaptureRunId === input.result.requestedRunId,
      'Android producer capture identity must bind the requested run',
    );
    assert(backendAttemptId, 'Android producer backend attempt identity is unavailable');
    assert(runtimeMetadata, 'Android producer runtime metadata is unavailable');
    for (const phase of ['build', 'install', 'reset', 'scenario', 'verify', 'cleanup'])
      assert(reportTiming(report, phase) > 0, `Android producer timing is missing for ${phase}`);
    assert.equal(runtimeMetadataFailure, null);
  }
  return {
    kind: 'private-owned-android-detox-connection-attempt-not-public-receipt',
    requestedRunId: input.result.requestedRunId,
    requestedAttemptId: input.result.requestedAttemptId,
    captureRunId:
      typeof producerCaptureRunId === 'string' ? producerCaptureRunId : input.result.requestedRunId,
    backendRunId: typeof backend?.runId === 'string' ? backend.runId : null,
    backendAttemptId,
    captureExitCode: sourceOnly ? 0 : 2,
    childExitCode: sourceOnly ? 0 : null,
    childSignal: null,
    childClassification: sourceOnly
      ? 'completed'
      : attempt.status === 'cancelled'
        ? 'cancelled'
        : attempt.status === 'deadline'
          ? 'deadline'
          : 'harness-blocked',
    captureResult: sourceOnly ? 'observed' : attempt.status,
    captureCleanup:
      attempt.cleanup === 'cleaned'
        ? 'cleaned'
        : attempt.cleanup === 'failed'
          ? { status: 'failed-recovery-retained', resources: [] }
          : 'not-acquired',
    captureTimeout: null,
    cancellation: attempt.status === 'cancelled' ? 'SIGTERM' : null,
    callbackInvocations: sourceOnly ? 1 : 0,
    callbackCompleted: sourceOnly,
    externalCleanupResult: attempt.cleanup === 'cleaned' ? 'passed' : 'failed',
    verificationResult:
      sourceOnly && !input.postCaptureFailure && !runtimeMetadataFailure
        ? 'passed'
        : 'not-executed',
    applicationFailure: null,
    applicationFailureCandidate: null,
    verificationFailure: failure ? { name: failure.name, message: failure.message } : null,
    postCaptureFailure: input.postCaptureFailure ?? runtimeMetadataFailure,
    deadline: attempt.deadlineAccounting?.deadlineReached
      ? {
          step: 'detox-connection',
          deadlineMs: attempt.deadlineAccounting.configuredMs,
        }
      : null,
    commandDiagnostics: Array.isArray(report?.detoxConnectionCommands)
      ? report.detoxConnectionCommands
      : [],
    censusFailures: Array.isArray(report?.censusFailures) ? report.censusFailures : [],
    outputFailures: Array.isArray(report?.outputFailures) ? report.outputFailures : [],
    assertionBindings: [],
    fixtureRunId: typeof backend?.runId === 'string' ? backend.runId : null,
    fixtureHash: typeof report?.fixtureHash === 'string' ? report.fixtureHash : null,
    flagsHash: runtimeMetadata?.environmentHash ?? null,
    toolVersions: runtimeMetadata ? { ...runtimeMetadata.toolVersions } : {},
    timingsMs: {
      build: reportTiming(report, 'build'),
      install: reportTiming(report, 'install'),
      reset: reportTiming(report, 'reset'),
      scenario: reportTiming(report, 'scenario'),
      verify: reportTiming(report, 'verify'),
      cleanup: reportTiming(report, 'cleanup'),
    },
    nativePassingCases: 0,
    artifactRoot: input.artifactRoot,
    publicFinalization: null,
    publicFinalizationInput: null,
    publicDependency: null,
    captureInvocation: { count: sourceOnly ? 1 : 0, returned: sourceOnly },
    captureCompleted: sourceOnly && !input.postCaptureFailure && !runtimeMetadataFailure,
    censusFailureCount: Array.isArray(report?.censusFailures) ? report.censusFailures.length : 0,
    staged: null,
    faultAttemptId: null,
    detoxBridgeResult: input.result,
    detoxBuild: input.build,
    detoxOwnerSelection: input.ownerSelection,
    ...(input.saveRetrySelection ? { detoxSaveRetrySelection: input.saveRetrySelection } : {}),
    ...(input.result.detoxSaveRetryRuntimeSource
      ? {
          detoxSaveRetryRuntimeSource: input.result.detoxSaveRetryRuntimeSource,
        }
      : {}),
  };
}

export type DetoxAndroidDispatchDependencies = Readonly<{
  now?: () => number;
  loadBuild?: typeof loadAndroidDetoxQualifiedBuild;
  prepareBuild?: typeof prepareAndroidDetoxQualifiedBuild;
  runBridge?: (
    input: DetoxAndroidConnectionPublicBridgeInput,
  ) => Promise<DetoxAndroidConnectionPublicBridgeResult>;
}>;

/**
 * Actual native-pilot Android Detox route.  A qualified descriptor is loaded
 * before the owned bridge, then the bridge invokes the existing driver and the
 * result is projected for the runner's single terminal publication.  The
 * projection remains source-only and cannot create a public pass.
 */
async function runAndroidDetoxAttemptForNativePilot(
  input: Readonly<{
    repositoryRoot: string;
    serverRoot: string;
    artifactRoot: string;
    requestedRunId: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    saveRetrySelection?: NativePilotSelection;
    signal: AbortSignal;
    deadlineMs: number;
    deadlineAtMonotonicMs: number;
    buildRunId: string;
    parentEnv?: Readonly<Record<string, string | undefined>>;
  }>,
  dependencies: DetoxAndroidDispatchDependencies = {},
): Promise<DetoxAndroidNativePilotAttemptResult> {
  assert(
    Number.isSafeInteger(input.deadlineMs) &&
      input.deadlineMs >= DETOX_MIN_DISPATCH_DEADLINE_MS &&
      input.deadlineMs <= DETOX_MAX_DISPATCH_DEADLINE_MS,
    'Android Detox dispatch deadline is outside the owned bridge range',
  );
  requireAndroidDetoxConnectionPublicSelection(input.selection);
  if (input.saveRetrySelection)
    requireAndroidDetoxSaveRetryPublicSelection(input.saveRetrySelection);
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  input.signal.throwIfAborted();
  assert(
    Number.isFinite(input.deadlineAtMonotonicMs) && input.deadlineAtMonotonicMs > performance.now(),
    'Android Detox dispatch requires the caller-owned absolute deadline',
  );
  const stepDeadlineAt = performance.now() + input.deadlineMs;
  const deadlineAt = Math.min(input.deadlineAtMonotonicMs, stepDeadlineAt);
  assert(
    deadlineAt > performance.now(),
    'Android Detox dispatch deadline elapsed before acquisition',
  );
  const dispatchInput: DetoxAndroidBuildLoaderInput = {
    repositoryRoot: input.repositoryRoot,
    buildRunId: input.buildRunId,
    signal: input.signal,
    deadlineAtMonotonicMs: deadlineAt,
  };
  const captureRunId = randomBytes(12).toString('hex');
  const captureRoot = path.join(input.repositoryRoot, '.qa/artifacts/native-pilot', captureRunId);
  assert.notEqual(captureRoot, path.resolve(input.artifactRoot));
  const lease = await acquireDetoxConnectionArtifactRoot({
    root: captureRoot,
    selection: input.selection.arguments,
    signal: input.signal,
    deadlineAt,
  });
  let transferred = false;
  try {
    if (input.parentEnv?.MYCHAMPIONS_NATIVE_ANDROID_DETOX_BUILD_PREPARE === '1') {
      const apiOrigin = input.parentEnv.MYCHAMPIONS_NATIVE_ANDROID_DETOX_API_ORIGIN;
      const metroPort = Number(input.parentEnv.DETOX_METRO_PORT);
      assert(typeof apiOrigin === 'string', 'Android Detox build preparation requires API origin');
      assert(
        Number.isSafeInteger(metroPort),
        'Android Detox build preparation requires Metro port',
      );
      await (dependencies.prepareBuild ?? prepareAndroidDetoxQualifiedBuild)({
        repositoryRoot: input.repositoryRoot,
        artifactRoot: path.join(
          input.repositoryRoot,
          '.qa/artifacts/native-pilot',
          input.buildRunId,
        ),
        buildRunId: input.buildRunId,
        apiOrigin,
        metroPort,
        signal: input.signal,
        deadlineMs: Math.floor(deadlineAt - performance.now()),
      });
    }
    const build = await (dependencies.loadBuild ?? loadAndroidDetoxQualifiedBuild)(dispatchInput);
    input.signal.throwIfAborted();
    assert(performance.now() < deadlineAt, 'Android Detox dispatch deadline elapsed before bridge');
    const runBridge =
      dependencies.runBridge ??
      (input.saveRetrySelection
        ? runAndroidDetoxSaveRetryPublicAttempt
        : runAndroidDetoxConnectionPublicAttempt);
    lease.markTransferred();
    transferred = true;
    const bridgeResult = await runBridge({
      owner: DETOX_ANDROID_CONNECTION_PUBLIC_OWNER,
      repositoryRoot: input.repositoryRoot,
      serverRoot: input.serverRoot,
      artifactRoot: input.artifactRoot,
      captureRoot,
      requestedRunId: input.requestedRunId,
      requestedAttemptId: input.requestedAttemptId,
      selection: input.selection,
      ...(input.saveRetrySelection ? { saveRetrySelection: input.saveRetrySelection } : {}),
      build,
      runnerPaths: {
        jestConfigPath: path.join(
          input.repositoryRoot,
          'e2e/jest.detox-integrated-connection-baseline.config.js',
        ),
        testPath: path.join(
          input.repositoryRoot,
          'e2e/detox-integrated-connection-baseline.e2e.test.js',
        ),
        ...(input.saveRetrySelection
          ? {
              saveRetryActionsPath: path.join(
                input.repositoryRoot,
                'scripts/testing/detox-save-retry-child-actions.js',
              ),
            }
          : {}),
      },
      signal: input.signal,
      deadlineMs: Math.floor(deadlineAt - performance.now()),
      deadlineAtMonotonicMs: deadlineAt,
      parentEnv: input.parentEnv,
    });
    let postCaptureFailure: DetoxAndroidNativePilotAttemptResult['postCaptureFailure'] = null;
    try {
      input.signal.throwIfAborted();
      assert(
        performance.now() < deadlineAt,
        'Android Detox dispatch deadline elapsed after bridge',
      );
      await inspectAndroidDetoxBuildArtifacts({
        repositoryRoot: input.repositoryRoot,
        build,
      });
    } catch (error) {
      postCaptureFailure = {
        phase: 'verification',
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return projectAndroidDetoxAttemptForNativePilot({
      result: bridgeResult,
      ownerSelection: input.selection,
      ...(input.saveRetrySelection ? { saveRetrySelection: input.saveRetrySelection } : {}),
      artifactRoot: captureRoot,
      build,
      postCaptureFailure,
    });
  } catch (error) {
    if (transferred) throw error;
    try {
      const cleanup = await lease.cleanupBeforeDriver({
        reason: 'Android Detox public dispatch preflight failed',
        signal: input.signal,
        deadlineAt,
      });
      await lease.retainRecoveryEvidence(
        cleanup,
        'Android Detox public dispatch preflight failed',
        {
          signal: input.signal,
          deadlineAt,
        },
      );
    } catch {
      // The lease retains its own classified recovery record; preserve the original error.
    }
    throw error;
  }
}

export async function runAndroidDetoxConnectionAttemptForNativePilot(
  input: Readonly<{
    repositoryRoot: string;
    serverRoot: string;
    artifactRoot: string;
    requestedRunId: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    signal: AbortSignal;
    deadlineMs: number;
    deadlineAtMonotonicMs: number;
    buildRunId: string;
    parentEnv?: Readonly<Record<string, string | undefined>>;
  }>,
  dependencies: DetoxAndroidDispatchDependencies = {},
): Promise<DetoxAndroidNativePilotAttemptResult> {
  return runAndroidDetoxAttemptForNativePilot(input, dependencies);
}

export async function runAndroidDetoxSaveRetryAttemptForNativePilot(
  input: Readonly<{
    repositoryRoot: string;
    serverRoot: string;
    artifactRoot: string;
    requestedRunId: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    signal: AbortSignal;
    deadlineMs: number;
    deadlineAtMonotonicMs: number;
    buildRunId: string;
    parentEnv?: Readonly<Record<string, string | undefined>>;
  }>,
  dependencies: DetoxAndroidDispatchDependencies = {},
): Promise<DetoxAndroidNativePilotAttemptResult> {
  const saveRetrySelection = requireAndroidDetoxSaveRetryPublicSelection(input.selection);
  const ownerSelection = await selectAndroidDetoxConnectionOwnerSelection(input.repositoryRoot);
  return runAndroidDetoxAttemptForNativePilot(
    { ...input, selection: ownerSelection, saveRetrySelection },
    dependencies,
  );
}

function requireAndroidSaveRetryReportSummary(
  report: Record<string, unknown>,
  input: DetoxAndroidConnectionPublicBridgeInput,
): void {
  assert(input.saveRetrySelection, 'Android Detox save/retry report has no selected scenario');
  const saved = record(report.detoxSaveRetry, 'Android Detox save/retry dispatch report');
  assert.equal(saved.kind, 'private-detox-save-retry-owned-dispatch');
  assert.deepEqual(saved.selection, input.saveRetrySelection);
  assert.equal(saved.platform, 'android');
  assert.equal(saved.cleanupOwner, 'existing-detox-connection-driver-aggregate');
  const result = record(saved.result, 'Android Detox save/retry result');
  assert.equal(result.kind, 'private-detox-save-retry-capture-not-public-receipt');
  assert.equal(result.platform, 'android');
  assert.equal(result.injectedWrites, 1);
  assert.equal(result.forwardedWrites, 1);
  assert.deepEqual(result.snapshots, ['before', 'failed', 'after', 'reopened']);
  assert.deepEqual(result.assertionIds, [...nativeSaveRetryAssertionIds]);
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.publicPromotionEligible, false);
  assert.equal(report.detoxSaveRetryTerminal, undefined);
  const snapshots = report.detoxSaveRetrySnapshots;
  assert(Array.isArray(snapshots) && snapshots.length === 5);
  const apiReads = report.detoxSaveRetryApiReads;
  assert(Array.isArray(apiReads) && apiReads.length === 2);
  assert(
    report.detoxSaveRetryRuntimeSource &&
      typeof report.detoxSaveRetryRuntimeSource === 'object' &&
      !Array.isArray(report.detoxSaveRetryRuntimeSource),
    'Successful Android Detox save/retry owner did not emit producer source runtime metadata proof',
  );
}
