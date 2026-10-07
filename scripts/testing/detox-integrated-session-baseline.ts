import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import {
  androidSourceIdentity,
  assertAndroidPilotApkMetadata,
  resolveAndroidPilotToolchain,
} from './android-build-identity';
import {
  buildDetoxAndroidStorageCommandHash,
  readDetoxAndroidSessionStorageCheckpoint,
  type DetoxAndroidSessionStorageBinding,
  type DetoxAndroidSessionStoragePhase,
  type DetoxAndroidSessionStorageTarget,
} from './detox-android-session-storage-producer';
import {
  writeAtomicDetoxConnectionBytes,
  type DetoxConnectionEvidenceDirectoryIdentity,
} from './detox-connection-evidence';
import {
  observeIosSessionCache,
  projectAndroidSessionCacheCheckpoint,
  requireAfterCancelCacheIdentity,
  requireDetoxNativeSessionCache,
  type DetoxNativeSessionCacheObservation,
  type DetoxSessionCacheCheckpoint,
} from './detox-session-cache-observation';
import {
  requireCancelEvidenceShape,
  verifyDetoxCancelUiEvidence,
  type DetoxCancelUiEvidence,
} from './detox-session-cancel-evidence';
import {
  requireClosedStartedRequestWindows,
  stopAndReadFinalTransport,
  type DetoxFinalTransportEvidence,
} from './detox-session-final-transport';
import {
  requireIntegratedLoopbackOrigin,
  assertNoIntegratedBypasses,
} from './integration-preflight';
import {
  requireAndroidOwnedApiLifetimeBinding,
  requireAndroidSessionCheckpointSet,
  requireAndroidSessionDomainBinding,
  type AndroidSessionCheckpointReceipt,
  type AndroidSessionCheckpointPhase,
  type AndroidOwnedApiLifetimeProbe,
  type AndroidSessionStorageCheckpoint,
} from './native-android-session-adapter';
import { observeIosAuthMetadata } from './native-auth-observation';
import { sourceIdentity, treeHash } from './native-build-identity';
import { requireConnectionSnapshot } from './native-connection-snapshot';
import {
  createAndroidDetoxSessionOwnedChildDirectory,
  type AndroidDetoxSessionDirectoryIdentity,
} from './native-detox-android-session-public-staging';
import { requireNativeHostAvailability } from './native-host-contention';
import {
  nativeSessionProfileCheckpointIds,
  requireSignedOutSessionTransport,
  verifyNativeSessionProfileCheckpoints,
  type NativeSessionProfileCheckpointInput,
} from './native-session-profile-checkpoints';
import { readNativeEvidenceObservation } from './native-view-evidence';
import {
  acquireOwnedAndroidEmulator,
  resolveOwnedAndroidSystemImage,
} from './owned-android-emulator';
import { startOwnedApiProxy } from './owned-api-proxy';
import { reserveOwnedAppPort, startOwnedExpo } from './owned-expo';
import { acquireOwnedIosSimulator, validateBootedIosDevice } from './owned-ios-simulator';
import { verifyIosSimulatorApp } from './owned-ios-simulator-app';
import { executeOwnedNativeCommand } from './owned-native-command';
import { inspectProcessIdentity } from './owned-process-group';
import { startOwnedSession } from './owned-session';
import {
  produceAndroidColdReset,
  type ColdResetPreparationExpectation,
  type AndroidColdResetOwnership,
} from './t15-cold-android-reset-producer';
import { prepareT15AndroidSessionColdReset } from './t15-detox-android-session-reset-preparation';
import { verifyOwnedAndroidCleanup } from './verify-owned-android-cleanup';
import { verifyOwnedIosCleanup } from './verify-owned-ios-cleanup';
import type { NativeComparisonOwnershipWindow } from './compare-native-pilot';
import type { DetoxRuntimeBuildMetadata } from './detox-runtime-build-metadata';
import type { ReusableIosBuildIdentity } from './native-build-reuse';
import type { OwnedConnectionSnapshot } from './native-connection-snapshot';
import type { NativeAuthIdentityObservation, ProxyObservation } from './owned-api-proxy';
import type { OwnedDomainSnapshot, OwnedFixtures } from './owned-session';

const signInPathHash = createHash('sha256').update('/auth/email/sign-in').digest('hex');
const execute = promisify(execFile);
const runIdPattern = /^[a-f0-9]{24}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const gitShaPattern = /^[a-f0-9]{40}$/;
const appIdentifierPattern = /^[A-Za-z0-9._-]+$/;
const allowedPlatforms = ['ios', 'android'] as const;
const allowedRoles = ['student', 'professional'] as const;
const expectedIosAppId = 'com.edufelip.mychampions.dev';
const expectedAndroidAppId = 'com.edufelip.mychampions.dev';
const expectedSessionStepIds = [
  'NAT-session-login',
  'NAT-session-restore',
  'NAT-session-account',
  'NAT-session-signout',
  'NAT-session-signed-out-relaunch',
  'NAT-session-unrelated-state',
] as const;
const expectedUiSessionStepIds = [
  'NAT-session-login',
  'NAT-session-restore',
  'NAT-session-account',
  'NAT-session-signout',
  'NAT-session-signed-out-relaunch',
] as const;
const hydratePathHash = createHash('sha256').update('/me/hydrate').digest('hex');
const expectedDetoxConfigName = 'jest.detox-integrated-session-baseline.config.js';
const expectedDetoxTestName = 'detox-integrated-session-baseline.e2e.test.js';

/**
 * The build descriptor must cover the actual runner closure.  A caller may not
 * select only the two obvious config files and then claim a fresh helper
 * identity for a changed lifecycle module.
 */
export const detoxSessionHelperClosure = [
  '.detoxrc.js',
  'app.config.ts',
  'scripts/run-detox-integrated-session-baseline.ts',
  'e2e/jest.detox-integrated-session-baseline.config.js',
  'e2e/detox-integrated-session-baseline.e2e.test.js',
  'scripts/testing/detox-integrated-session-baseline.ts',
  'scripts/testing/detox-android-connection-producer.ts',
  'scripts/testing/verify-owned-android-detox-connection-cleanup.ts',
  'scripts/testing/detox-android-session-producer.ts',
  'scripts/testing/native-detox-android-session-public-staging.ts',
  'scripts/testing/native-detox-android-session-public-finalization.ts',
  'scripts/testing/native-detox-android-session-public-adapter.ts',
  'scripts/testing/native-detox-android-session-native-pilot-route.ts',
  'scripts/testing/t15-cold-android-reset-producer.ts',
  'scripts/testing/t15-detox-android-session-reset-preparation.ts',
  'scripts/testing/t15-detox-android-session-cold-route.ts',
  'scripts/testing/native-detox-connection-android-public-dispatch.ts',
  'scripts/testing/native-detox-connection-android-public-staging.ts',
  'scripts/testing/detox-connection-evidence.ts',
  'scripts/testing/native-detox-connection-public-dispatch.ts',
  'scripts/testing/run-native-pilot.ts',
  'scripts/testing/native-session-profile-checkpoints.ts',
  'scripts/testing/native-connection-snapshot.ts',
  'scripts/testing/owned-session.ts',
  'scripts/testing/owned-api-proxy.ts',
  'scripts/testing/native-auth-observation.ts',
  'scripts/testing/owned-native-command.ts',
  'scripts/testing/owned-expo.ts',
  'scripts/testing/owned-ios-simulator.ts',
  'scripts/testing/owned-ios-simulator-app.ts',
  'scripts/testing/native-build-identity.ts',
  'scripts/testing/android-build-identity.ts',
  'scripts/testing/integration-preflight.ts',
  'scripts/testing/native-host-contention.ts',
  'scripts/testing/verify-owned-ios-cleanup.ts',
  'scripts/testing/owned-android-emulator.ts',
  'scripts/testing/owned-android-port.ts',
  'scripts/testing/verify-owned-android-cleanup.ts',
  'scripts/testing/android-native-input-reader.ts',
  'scripts/testing/native-build-reuse.ts',
  'scripts/testing/native-cleanup-evidence.ts',
  'scripts/testing/native-hierarchy.ts',
  'scripts/testing/native-runtime-preflight.ts',
  'scripts/testing/native-save-retry-observation.ts',
  'scripts/testing/native-training-edit-observation.ts',
  'scripts/testing/native-training-journey.ts',
  'scripts/testing/native-training-load-observation.ts',
  'scripts/testing/native-training-maestro-driver.ts',
  'scripts/testing/native-training-quantity-contract.ts',
  'scripts/testing/native-view-evidence.ts',
  'scripts/testing/owned-adb-server.ts',
  'scripts/testing/owned-process-group.ts',
  'scripts/testing/detox-session-cache-observation.ts',
  'scripts/testing/detox-android-session-storage-producer.ts',
  'scripts/testing/native-android-session-adapter.ts',
  'scripts/testing/detox-session-cancel-evidence.ts',
  'scripts/testing/detox-session-final-transport.ts',
  'scripts/ci/android-runner-slot.ts',
  'scripts/testing/schema-validation.ts',
] as const;

/**
 * Android Detox build qualification has a separate closure because the app
 * APK and instrumentation APK are produced together by Gradle.  The producer
 * records these paths in the private descriptor; it never treats an app-only
 * Maestro APK as a Detox build.
 */
export const detoxAndroidBuildInputClosure = [
  '.detoxrc.js',
  'app.config.ts',
  'android/settings.gradle',
  'android/build.gradle',
  'android/gradle.properties',
  'android/gradlew',
  'android/app/build.gradle',
  'android/app/src/androidTest/java/com/eduardo880/mychampions/DetoxTest.java',
  'android/app/src/androidTest/java/com/edufelip/mychampions/DetoxCameraPermissionBridge.java',
  'android/app/src/main/java/com/eduardo880/mychampions/MainActivity.kt',
  'e2e/detox-android-camera-denied.e2e.test.js',
  'e2e/jest.detox-integrated-connection-baseline.config.js',
  'scripts/ci/android-runner-slot.ts',
  'scripts/testing/android-build-identity.ts',
  'scripts/testing/detox-android-connection-producer.ts',
  'scripts/testing/detox-android-session-producer.ts',
  'scripts/testing/native-detox-android-session-public-staging.ts',
  'scripts/testing/native-detox-android-session-public-finalization.ts',
  'scripts/testing/native-detox-android-session-public-adapter.ts',
  'scripts/testing/native-detox-android-session-native-pilot-route.ts',
  'scripts/testing/t15-cold-android-reset-producer.ts',
  'scripts/testing/t15-detox-android-session-reset-preparation.ts',
  'scripts/testing/t15-detox-android-session-cold-route.ts',
  'scripts/testing/detox-connection-artifact-root.ts',
  'scripts/testing/detox-integrated-connection-driver.ts',
  'scripts/testing/detox-integrated-session-baseline.ts',
  'scripts/testing/native-connection-engine-contract.ts',
  'scripts/testing/native-detox-connection-android-public-dispatch.ts',
  'scripts/testing/native-detox-connection-android-public-staging.ts',
  'scripts/testing/native-detox-camera-android-owned-session.ts',
  'scripts/testing/owned-android-emulator.ts',
  'scripts/testing/owned-native-command.ts',
  'scripts/testing/run-native-pilot.ts',
  'scripts/testing/verify-owned-android-detox-connection-cleanup.ts',
  'scripts/testing/detox-android-qualified-build.ts',
] as const;

export type DetoxBaselinePlatform = (typeof allowedPlatforms)[number];
export type DetoxBaselineRole = (typeof allowedRoles)[number];

/**
 * The Android storage/cleanup producer is owned by the Android session packet.
 * Keep this gate before any host, port, target, backend, proxy, Expo, or Detox
 * acquisition until that packet is integrated and its source closure is
 * requalified together with this runner.
 */
export function requireDetoxAndroidProducerBeforeAcquisition(
  platform: DetoxBaselinePlatform,
  producer?: DetoxAndroidSessionProducerRegistration,
): void {
  if (platform !== 'android') return;
  if (
    !producer ||
    producer.kind !== 'owned-android-detox-session-producer' ||
    typeof producer.acquireOwnedTarget !== 'function' ||
    typeof producer.verifyOwnedAndroidCleanup !== 'function'
  )
    throw new Error(
      'Detox Android producer is required before acquisition: use the owned Android session producer with its cleanup verifier',
    );
}

export type DetoxBaselineBuildInstrumentation = Readonly<{
  platform: DetoxBaselinePlatform;
  configuration: 'ios.sim.debug' | 'android.emu.debug';
  binaryPath: string;
  binaryHash: string;
  testBinaryPath: string | null;
  testBinaryHash: string | null;
  source: {
    sha: string;
    dirty: boolean;
    sourceTreeHash: string;
  };
  helperInputPaths: readonly string[];
  helperInputsHash: string;
  detoxConfigPath: string;
  detoxConfigHash: string;
  metroPort: number;
  appIdentifier: string;
  embeddedRuntime: {
    variant: 'dev';
    appIdentifier: string;
    apiOrigin: string;
    configSourcePath: string;
    configSourceHash: string;
  };
  /** Present only for an explicitly qualified immutable build reuse. */
  binaryReuse?: DetoxQualifiedBuildReuse | DetoxQualifiedAndroidBuildReuse;
  /** Present when the build crosses into the Detox public runtime. */
  environmentHash?: DetoxRuntimeBuildMetadata['environmentHash'];
  toolVersions?: DetoxRuntimeBuildMetadata['toolVersions'];
  toolVersionEvidence?: DetoxRuntimeBuildMetadata['toolVersionEvidence'];
}>;

export type DetoxQualifiedBuildReuse = Readonly<{
  kind: 'qualified-ios-build-reuse';
  runId: string;
  binaryPath: string;
  binaryHash: string;
  binaryIdentity: ReusableIosBuildIdentity;
  /** The checked-in path the selected Detox debug profile normally names. */
  checkedInBinaryPath: string;
}>;

export type DetoxQualifiedAndroidBuildReuse = Readonly<{
  kind: 'qualified-android-build-reuse';
  runId: string;
  binaryPath: string;
  binaryHash: string;
  binaryIdentity: ReusableIosBuildIdentity;
  testBinaryPath: string;
  testBinaryHash: string;
  testBinaryIdentity: ReusableIosBuildIdentity;
  checkedInBinaryPath: string;
  checkedInTestBinaryPath: string;
  androidBuildInputPaths: readonly string[];
  androidBuildInputsHash: string;
  commandReceiptPath: string;
  commandReceiptHash: string;
}>;

export type DetoxBaselineFixtureEvidence = Readonly<{
  runId: string;
  scope: string;
  fixtureHash: string;
  actorRole: DetoxBaselineRole;
  actorAuthUid: string;
  fixtureAuthUids: readonly string[];
}>;

export type DetoxBaselineSnapshotEvidence = Readonly<{
  runId: string;
  scope: string;
  checkpointIds: readonly (typeof nativeSessionProfileCheckpointIds)[number][];
  checkpoints: readonly DetoxBaselineCheckpointEvidence[];
  beforeHash: string;
  afterHash: string;
  beforeTrainingPlanCount: number;
  afterTrainingPlanCount: number;
  beforeConnectionCount: number;
  afterConnectionCount: number;
  domainRowsUnchanged: true;
  beforeFile: string;
  afterFile: string;
  beforeFileSha256: string;
  afterFileSha256: string;
}>;

export type DetoxBaselineCheckpointEvidence = Readonly<{
  checkpointId: (typeof nativeSessionProfileCheckpointIds)[number];
  profileFile: string;
  profileSourceFile: string;
  profileSha256: string;
  domainFile: string;
  domainSourceFile: string;
  domainSha256: string;
  profileBytes: number;
  domainBytes: number;
}>;

export type DetoxBaselineTransportEvidence = Readonly<{
  requestId: number;
  targetOrigin: string;
  status: 201;
  outcome: 'forwarded';
  requestProfile: 'native';
  requestOrigin: null;
  authUid: string;
  apiPid: number;
}>;

export type DetoxBaselineRunnerPaths = Readonly<{
  entryPath: string;
  jestConfigPath: string;
  testPath: string;
  /** Private packet-only path mode; canonical execution must omit it. */
  privateCandidate?: true;
}>;

export type DetoxSessionStepEvent = Readonly<{
  stepId: (typeof expectedUiSessionStepIds)[number];
  ordinal: number;
  monotonicMs: number;
  confirmationAfterCancel?: 'not-visible';
  cancelEvidence?: Readonly<{
    hierarchyFile: string;
    hierarchySha256: string;
    screenshotFile: string;
    screenshotSha256: string;
    modalPresent: false;
    accountScreenPresent: true;
  }>;
}>;

export type DetoxSessionStepResult = Readonly<{
  schemaVersion: 2;
  kind: 'private-detox-session-steps';
  platform: DetoxBaselinePlatform;
  role: DetoxBaselineRole;
  steps: Readonly<Record<(typeof expectedUiSessionStepIds)[number], true>>;
  launchCount: 3;
  synchronizationDisabled: true;
  events: readonly DetoxSessionStepEvent[];
}>;

export type DetoxPhaseCheckpoint = Readonly<{
  stepId: (typeof expectedUiSessionStepIds)[number];
  ordinal: number;
  childMonotonicMs: number;
  parentMonotonicMs: number;
  requestIdFence: number;
  observedRequestIds: readonly number[];
}>;

type DetoxAuthMetadata = Awaited<ReturnType<typeof observeIosAuthMetadata>> & {
  /** Hash read from the actual native persisted profile, never SQL-derived. */
  authUidHash?: string;
  profileAuthUidHash?: string;
};

export type DetoxOwnedEvidenceFile = Readonly<{
  name: string;
  bytes: number;
  sha256: string;
}>;

export type DetoxBaselineReport = Readonly<{
  schemaVersion: 5;
  kind: 'private-detox-integrated-session-baseline-not-public-receipt';
  result:
    'passed' | 'application-failed' | 'verification-failed' | 'harness-blocked' | 'cleanup-failed';
  publicNativePassingCases: 0;
  platform: DetoxBaselinePlatform;
  configuration: DetoxBaselineBuildInstrumentation['configuration'];
  role: DetoxBaselineRole;
  captureRunId: string;
  backendRunId: string | null;
  backendAttemptId: string | null;
  appOrigin: string | null;
  apiOrigin: string | null;
  apiPid: number | null;
  target: { platform: DetoxBaselinePlatform; deviceId: string } | null;
  fixture: DetoxBaselineFixtureEvidence | null;
  coldReset: Readonly<{
    status: 'not-requested' | 'fresh' | 'blocked';
    requestedRunId: string | null;
    requestedAttemptId: string | null;
    ownerRunId: string | null;
    receiptPath: string | null;
    receiptHash: string | null;
    target: Readonly<Record<string, unknown>> | null;
    backend: Readonly<Record<string, unknown>> | null;
    fixture: Readonly<Record<string, unknown>> | null;
    originalResetBinding: Readonly<Record<string, unknown>> | null;
    blocker: string | null;
  }>;
  transport: DetoxBaselineTransportEvidence | null;
  sessionCache: Readonly<{
    afterLogin: DetoxNativeSessionCacheObservation;
    afterRestoration: DetoxNativeSessionCacheObservation;
    afterCancel: DetoxNativeSessionCacheObservation;
    afterSignout: DetoxNativeSessionCacheObservation;
    afterSignedOutRelaunch: DetoxNativeSessionCacheObservation;
  }> | null;
  finalTransport: DetoxFinalTransportEvidence | null;
  snapshots: DetoxBaselineSnapshotEvidence | null;
  build: DetoxBaselineBuildInstrumentation;
  runnerPaths: DetoxBaselineRunnerPaths;
  /** Real phase durations measured by the owned baseline controller. */
  timingsMs: Readonly<{
    build: number;
    install: number;
    reset: number;
    scenario: number;
    verify: number;
    cleanup: number;
  }>;
  /** Versions used by the actual owned baseline command. */
  toolVersions: Readonly<Record<string, string>>;
  childExecution: NativeCommandExecutionSummary | null;
  cancellation: 'SIGINT' | 'SIGTERM' | 'deadline' | 'unknown' | null;
  phaseCheckpoints: readonly DetoxPhaseCheckpoint[];
  authMetadata: Readonly<{
    beforeRelaunch: DetoxAuthMetadata;
    afterRelaunch: DetoxAuthMetadata;
    afterSignout: DetoxAuthMetadata;
    afterSignedOutRelaunch: DetoxAuthMetadata;
  }> | null;
  evidenceFiles: readonly DetoxOwnedEvidenceFile[];
  ui: {
    launchCount: 3;
    synchronizationDisabled: true;
    signInMarker: 'auth.signIn.title';
    landingMarker: string;
    assertionIds: readonly string[];
  } | null;
  cleanup: {
    attempted: readonly string[];
    cleaned: readonly string[];
    failures: readonly string[];
    independent: 'passed' | 'failed' | 'not-executed';
  };
  failure: { phase: string; name: string } | null;
}>;

export type NativeCommandExecutionSummary = Readonly<{
  phase: NativeCommandExecution['phase'];
  execution: NativeCommandExecution['execution'];
  cleanup: NativeCommandExecution['cleanup'];
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  pid: number | null;
  pgid: number | null;
  command: string;
  argv: readonly string[];
  cwd: string;
  deadlineMs: number;
  logPath: string | null;
  stdoutPath: string | null;
  ownershipPath: string | null;
  cleanupMs: number;
  censusFailure: unknown;
  outputFailure: unknown;
  elapsedMs: number;
}>;

export type DetoxOwnedTarget = Readonly<{
  platform: DetoxBaselinePlatform;
  deviceId: string;
  ownership: Readonly<{
    artifactRoot: string;
    hostLockRequired: true;
    cleanupAuthorized: true;
  }>;
  verify(signal?: AbortSignal): Promise<void>;
  stop(): Promise<void>;
  androidRuntimeParent?: string;
  androidSdkRoot?: string;
  /** Exact owner identities from the acquired Android emulator. */
  androidTargetRunId?: string;
  androidOsVersion?: string;
  androidSessionStorage?: DetoxAndroidSessionStorageTarget;
}>;

type OwnedReservation = Awaited<ReturnType<typeof reserveOwnedAppPort>>;
type OwnedSession = Awaited<ReturnType<typeof startOwnedSession>>;
type OwnedProxy = Awaited<ReturnType<typeof startOwnedApiProxy>>;
type OwnedExpo = Awaited<ReturnType<typeof startOwnedExpo>>;
type NativeCommandExecution = Awaited<ReturnType<typeof executeOwnedNativeCommand>>;

type DetoxTerminalEvidenceWriter = (filePath: string, bytes: Buffer) => Promise<void>;

type DetoxTerminalPublicationReceipt = DetoxOwnedEvidenceFile;

export type DetoxBaselineFactories = Readonly<{
  reserveOwnedAppPort: typeof reserveOwnedAppPort;
  startOwnedSession: typeof startOwnedSession;
  startOwnedApiProxy: typeof startOwnedApiProxy;
  startOwnedExpo: typeof startOwnedExpo;
  acquireOwnedTarget: (options: {
    platform: DetoxBaselinePlatform;
    artifactRoot: string;
    signal?: AbortSignal;
    deadlineAtMonotonicMs?: number;
    artifactRootIdentity?: DetoxConnectionEvidenceDirectoryIdentity;
  }) => Promise<DetoxOwnedTarget>;
  capturePreviousIosDevices: (artifactRoot: string, signal?: AbortSignal) => Promise<void>;
  verifyAndroidBuild: (options: {
    build: DetoxBaselineBuildInstrumentation;
    artifactRoot: string;
    apiOrigin: string;
    signal?: AbortSignal;
    deadlineAtMonotonicMs: number;
  }) => Promise<void>;
  executeOwnedNativeCommand: typeof executeOwnedNativeCommand;
  requireNativeHostAvailability: typeof requireNativeHostAvailability;
  verifyIosSimulatorApp: typeof verifyIosSimulatorApp;
  verifyOwnedIosCleanup: typeof verifyOwnedIosCleanup;
  inspectDetoxBuildInstrumentation: typeof inspectDetoxBuildInstrumentation;
  /** Private failure-injection seam; production uses the guarded default writer. */
  writeTerminalEvidence?: DetoxTerminalEvidenceWriter;
  resolveIosDataContainer?: (options: {
    deviceId: string;
    bundleId: string;
    signal?: AbortSignal;
  }) => Promise<string>;
  observeIosAuthMetadata?: typeof observeIosAuthMetadata;
  observeNativeSessionCache?: (input: {
    platform: DetoxBaselinePlatform;
    checkpoint: DetoxSessionCacheCheckpoint;
    actorAuthUid: string;
    artifactRoot: string;
    dataRoot?: string;
  }) => Promise<DetoxNativeSessionCacheObservation>;
  readAndroidSessionStorageCheckpoint?: (input: {
    checkpoint: DetoxSessionCacheCheckpoint;
    artifactRoot: string;
    target: DetoxOwnedTarget;
    actorAuthUid?: string;
    binding: DetoxAndroidSessionStorageBinding;
    phase?: DetoxAndroidSessionStoragePhase;
    signal: AbortSignal;
  }) => Promise<AndroidSessionStorageCheckpoint>;
  verifyOwnedAndroidCleanup?: typeof verifyOwnedAndroidCleanup;
}>;

export type DetoxAndroidSessionProducerRegistration = Readonly<{
  kind: 'owned-android-detox-session-producer';
  acquireOwnedTarget: DetoxBaselineFactories['acquireOwnedTarget'];
  verifyOwnedAndroidCleanup: (options: {
    repositoryRoot: string;
    artifactRoot: string;
    target: DetoxOwnedTarget;
    signal: AbortSignal;
    deadlineAtMonotonicMs: number;
  }) => Promise<unknown>;
}>;

export type DetoxIntegratedSessionBaselineOptions = Readonly<{
  repositoryRoot: string;
  serverRoot: string;
  artifactRoot: string;
  platform: DetoxBaselinePlatform;
  configuration: DetoxBaselineBuildInstrumentation['configuration'];
  role: DetoxBaselineRole;
  build: DetoxBaselineBuildInstrumentation;
  signal?: AbortSignal;
  deadlineMs?: number;
  /** Caller-owned absolute monotonic deadline; downstream phases must share it. */
  deadlineAtMonotonicMs?: number;
  parentEnv?: Readonly<Record<string, string | undefined>>;
  runnerPaths: DetoxBaselineRunnerPaths;
  factories?: DetoxBaselineFactories;
  /** Required for Android: acquisition and cleanup are one owned capability. */
  androidProducer?: DetoxAndroidSessionProducerRegistration;
  /** T15-only reset request; omitted for legacy source controls. */
  coldReset?: Readonly<{
    expectation: ColdResetPreparationExpectation;
    ownerRunId: string;
  }>;
}>;

export class DetoxIntegratedSessionBaselineError extends Error {
  readonly report?: DetoxBaselineReport;

  constructor(message: string, report?: DetoxBaselineReport, cause?: unknown) {
    super(message, { cause });
    this.name = 'DetoxIntegratedSessionBaselineError';
    this.report = report;
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function hashBytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function helperInputsDigest(paths: readonly string[], contents: readonly Buffer[]): string {
  if (paths.length !== contents.length) throw new Error('Detox helper input pair count changed');
  const digest = createHash('sha256').update('detox-integrated-helper-inputs-v2\0');
  const pairs = paths
    .map((relative, index) => ({ relative, content: contents[index] }))
    .sort((left, right) => left.relative.localeCompare(right.relative));
  for (const pair of pairs) digest.update(pair.relative).update('\0').update(pair.content);
  return digest.digest('hex');
}

export const detoxAndroidBuildInputsDigest = helperInputsDigest;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function commandExecutionSummary(
  execution: NativeCommandExecution | null,
  descriptor: Readonly<{
    command: string;
    argv: readonly string[];
    cwd: string;
    deadlineMs: number;
  }>,
): NativeCommandExecutionSummary | null {
  return execution
    ? {
        phase: execution.phase,
        execution: execution.execution,
        cleanup: execution.cleanup,
        childExitCode: execution.childExitCode,
        childSignal: execution.childSignal,
        pid: execution.pid,
        pgid: execution.pgid,
        command: descriptor.command,
        argv: [...descriptor.argv],
        cwd: descriptor.cwd,
        deadlineMs: descriptor.deadlineMs,
        logPath: execution.logPath,
        stdoutPath: execution.stdoutPath,
        ownershipPath: execution.ownershipPath,
        cleanupMs: execution.cleanupMs,
        censusFailure: execution.censusFailure ?? null,
        outputFailure: execution.outputFailure ?? null,
        elapsedMs: execution.elapsedMs,
      }
    : null;
}

export function classifyDetoxChildExecution(
  execution: Pick<
    NativeCommandExecution,
    'execution' | 'cleanup' | 'childExitCode' | 'childSignal'
  >,
): 'passed' | 'application-failed' | 'harness-blocked' {
  if (execution.cleanup !== 'cleaned') return 'harness-blocked';
  if (
    execution.execution === 'completed' &&
    execution.childExitCode === 0 &&
    execution.childSignal === null
  )
    return 'passed';
  if (execution.execution === 'child-failed') return 'application-failed';
  return 'harness-blocked';
}

function cancellationReason(signal: AbortSignal | undefined): DetoxBaselineReport['cancellation'] {
  if (!signal?.aborted) return null;
  const reason: unknown = signal.reason;
  return reason === 'SIGINT' || reason === 'SIGTERM' || reason === 'deadline' ? reason : 'unknown';
}

async function requireRunnerPaths(
  value: DetoxBaselineRunnerPaths,
  repositoryRoot: string,
): Promise<DetoxBaselineRunnerPaths> {
  const root = await realpath(repositoryRoot);
  const canonical = {
    entryPath: path.join(root, 'scripts/run-detox-integrated-session-baseline.ts'),
    jestConfigPath: path.join(root, 'e2e', expectedDetoxConfigName),
    testPath: path.join(root, 'e2e', expectedDetoxTestName),
  };
  const privateCandidate = value.privateCandidate === true;
  const paths = [
    ['entryPath', value.entryPath, 'run-detox-integrated-session-baseline.ts'],
    ['jestConfigPath', value.jestConfigPath, expectedDetoxConfigName],
    ['testPath', value.testPath, expectedDetoxTestName],
  ] as const;
  if (
    !privateCandidate &&
    (value.entryPath !== canonical.entryPath ||
      value.jestConfigPath !== canonical.jestConfigPath ||
      value.testPath !== canonical.testPath)
  )
    throw new Error('Detox runner paths must be the canonical transferred entry/config/test');
  if (privateCandidate && !value.entryPath.includes('/.qa/artifacts/'))
    throw new Error('Private Detox runner paths must remain inside the preparation packet');
  for (const [label, candidate, basename] of paths) {
    if (!path.isAbsolute(candidate) || !candidate.startsWith(root + path.sep))
      throw new Error(`Detox ${label} must be inside the repository`);
    if (path.basename(candidate) !== basename || (await realpath(candidate)) !== candidate)
      throw new Error(`Detox ${label} is not the declared canonical entry`);
    const metadata = await lstat(candidate);
    if (!metadata.isFile() || (process.getuid && metadata.uid !== process.getuid()))
      throw new Error(`Detox ${label} is not an owned regular file`);
  }
  return value;
}

async function writeOwnedJsonEvidence(
  artifactRoot: string,
  name: string,
  value: unknown,
  maxBytes = 1_048_576,
  expectedRootIdentity?: DetoxConnectionEvidenceDirectoryIdentity,
): Promise<DetoxOwnedEvidenceFile> {
  if (!/^[a-z0-9-]+\.private\.json$/.test(name))
    throw new Error('Detox evidence filename is unsafe');
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (bytes.byteLength > maxBytes) throw new Error(`Detox evidence ${name} exceeds its bound`);
  const file = path.join(artifactRoot, name);
  const published = await writeAtomicDetoxConnectionBytes(
    artifactRoot,
    name,
    bytes,
    maxBytes,
    expectedRootIdentity ? { expectedRootIdentity } : {},
  );
  if (published.realpath !== file)
    throw new Error(`Detox evidence ${name} is not a private regular file`);
  return {
    name,
    bytes: published.bytes.byteLength,
    sha256: hashBytes(published.bytes),
  };
}

/** Record the exact bounded bytes emitted by the native child command. */
function readOwnedJsonEvidenceReceipt(artifactRoot: string, name: string): DetoxOwnedEvidenceFile {
  if (!/^[a-z0-9-]+\.private\.json$/.test(name))
    throw new Error('Detox child evidence filename is unsafe');
  const observation = readNativeEvidenceObservation(artifactRoot, name, true, 'private-artifact');
  return {
    name,
    bytes: observation.bytes.byteLength,
    sha256: hashBytes(observation.bytes),
  };
}

export function requireDetoxPhaseCheckpoints(input: {
  checkpoints: readonly DetoxPhaseCheckpoint[];
  observations: readonly ProxyObservation[];
  finalRequestIdFence?: number;
}): readonly DetoxPhaseCheckpoint[] {
  if (input.checkpoints.length !== expectedUiSessionStepIds.length)
    throw new Error('Detox phase checkpoint count is incomplete');
  const requestById = new Map<number, ProxyObservation>();
  for (const row of input.observations) {
    if (!Number.isSafeInteger(row.requestId) || row.requestId < 1 || requestById.has(row.requestId))
      throw new Error('Detox observations contain duplicate or invalid request IDs');
    if (typeof row.requestCredentialPresent !== 'boolean')
      throw new Error('Detox transport is missing the redacted credential-presence bit');
    requestById.set(row.requestId, row);
  }
  let previousRequestIdFence = 0;
  let previousParentMonotonicMs = -1;
  input.checkpoints.forEach((checkpoint, index) => {
    if (
      checkpoint.stepId !== expectedUiSessionStepIds[index] ||
      checkpoint.ordinal !== index + 1 ||
      !Number.isSafeInteger(checkpoint.ordinal) ||
      !Number.isFinite(checkpoint.childMonotonicMs) ||
      !Number.isFinite(checkpoint.parentMonotonicMs) ||
      checkpoint.parentMonotonicMs <= previousParentMonotonicMs ||
      !Number.isSafeInteger(checkpoint.requestIdFence) ||
      checkpoint.requestIdFence < previousRequestIdFence ||
      !Array.isArray(checkpoint.observedRequestIds)
    )
      throw new Error('Detox phase checkpoint ordering, timing or request fence is invalid');
    const expectedIds = input.observations
      .filter(
        (row) =>
          row.requestId > previousRequestIdFence && row.requestId <= checkpoint.requestIdFence,
      )
      .map((row) => row.requestId);
    const observedIds = Array.from<number>(checkpoint.observedRequestIds);
    const observedSorted = observedIds.slice().sort((a, b) => a - b);
    const expectedSorted = expectedIds.slice().sort((a, b) => a - b);
    if (
      observedIds.some((requestId) => !Number.isSafeInteger(requestId) || requestId < 1) ||
      new Set(observedIds).size !== observedIds.length ||
      stableJson(observedSorted) !== stableJson(expectedSorted)
    )
      throw new Error('Detox phase checkpoint does not close its started-request window');
    const rows = expectedIds.map((requestId) => {
      const row = requestById.get(requestId);
      if (!row) throw new Error('Detox phase checkpoint references an unobserved started request');
      return row;
    });
    const signIns = rows.filter((row) => row.method === 'POST' && row.pathHash === signInPathHash);
    const hydrates = rows.filter(
      (row) => row.method === 'POST' && row.pathHash === hydratePathHash,
    );
    if (index === 0) {
      if (
        signIns.length !== 1 ||
        signIns[0].status !== 201 ||
        signIns[0].outcome !== 'forwarded' ||
        signIns[0].requestCredentialPresent !== false ||
        hydrates.length !== 0
      )
        throw new Error('Detox login checkpoint lacks the exact initial sign-in window');
    } else if (index === 1) {
      if (
        signIns.length !== 0 ||
        hydrates.length !== 1 ||
        hydrates[0].status !== 200 ||
        hydrates[0].outcome !== 'forwarded' ||
        hydrates[0].requestCredentialPresent !== true
      )
        throw new Error(
          'Detox restore checkpoint lacks the exact authenticated POST hydrate window',
        );
    } else if (index === 4) {
      if (
        signIns.length !== 0 ||
        hydrates.length !== 0 ||
        rows.some((row) => row.requestCredentialPresent === true)
      )
        throw new Error('Signed-out relaunch emitted an authenticated transport request');
    } else if (signIns.length !== 0 || hydrates.length !== 0) {
      throw new Error(
        'Detox session emitted an unexpected authentication request outside its window',
      );
    }
    previousRequestIdFence = checkpoint.requestIdFence;
    previousParentMonotonicMs = checkpoint.parentMonotonicMs;
  });
  if (
    input.finalRequestIdFence !== undefined &&
    previousRequestIdFence !== input.finalRequestIdFence
  )
    throw new Error('Detox phase checkpoints do not reach the final started-request fence');
  return input.checkpoints;
}

export function requireDetoxTerminalPhaseWindow(input: {
  checkpoints: readonly DetoxPhaseCheckpoint[];
  observations: readonly ProxyObservation[];
  finalRequestIdFence?: number;
}): void {
  const terminal = input.checkpoints.at(-1);
  if (!terminal) throw new Error('Detox terminal phase checkpoint is missing');
  const finalFence =
    input.finalRequestIdFence ?? Math.max(0, ...input.observations.map((row) => row.requestId));
  const terminalStart = input.checkpoints.at(-2)?.requestIdFence ?? 0;
  if (terminalStart > finalFence)
    throw new Error('Detox terminal checkpoint starts after the final request fence');
  const expected = Array.from(
    { length: finalFence - terminalStart },
    (_, index) => terminalStart + index + 1,
  );
  const observed = [...terminal.observedRequestIds].sort((left, right) => left - right);
  if (stableJson(observed) !== stableJson(expected))
    throw new Error('Detox terminal checkpoint omitted or received a late transport request');
  if (input.observations.some((row) => row.requestId < 1 || row.requestId > finalFence))
    throw new Error('Detox terminal transport request identity is invalid');
  if (
    input.observations.some(
      (row) =>
        row.requestId > terminalStart &&
        row.requestId <= finalFence &&
        row.requestCredentialPresent === true,
    )
  )
    throw new Error('Detox signed-out terminal stream retained an authenticated credential');
}

function requireAbsoluteOwnedPath(value: string, root: string, label: string): string {
  if (!path.isAbsolute(value) || !value.startsWith(root + path.sep))
    throw new Error(`${label} must be inside the requested repository`);
  return value;
}

function requireHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !hashPattern.test(value)) throw new Error(`${label} is invalid`);
}

function requireBuildIdentity(
  value: unknown,
  label: string,
): asserts value is ReusableIosBuildIdentity {
  record(value, label);
  const identity = value as ReusableIosBuildIdentity;
  for (const key of [
    'dev',
    'ino',
    'uid',
    'gid',
    'mode',
    'nlink',
    'size',
    'mtimeMs',
    'ctimeMs',
  ] as const) {
    if (!Number.isFinite(identity[key]) || identity[key] < 0)
      throw new Error(`${label}.${key} is invalid`);
  }
}

function requireAbsoluteNormalizedPath(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value)
    throw new Error(`${label} must be an absolute normalized path`);
}

function requireBuildShape(value: DetoxBaselineBuildInstrumentation, repositoryRoot: string) {
  record(value, 'Detox build instrumentation');
  if (!allowedPlatforms.includes(value.platform)) throw new Error('Unsupported Detox platform');
  const expectedConfiguration = value.platform === 'ios' ? 'ios.sim.debug' : 'android.emu.debug';
  if (value.configuration !== expectedConfiguration)
    throw new Error('Integrated Detox baseline requires the dev debug configuration');
  const root = path.resolve(repositoryRoot);
  if (value.binaryReuse)
    requireAbsoluteNormalizedPath(value.binaryPath, 'Detox reused binary path');
  else requireAbsoluteOwnedPath(value.binaryPath, root, 'Detox binary path');
  requireAbsoluteOwnedPath(value.detoxConfigPath, root, 'Detox config path');
  if (path.basename(value.detoxConfigPath) !== '.detoxrc.js')
    throw new Error('Detox config must be the checked-in .detoxrc.js');
  const expectedBinary =
    value.platform === 'ios'
      ? path.join(root, 'ios/build/Build/Products/Debug-iphonesimulator/mychampions.app')
      : path.join(root, 'android/app/build/outputs/apk/dev/debug/app-dev-debug.apk');
  if (value.platform === 'ios' && value.binaryReuse) {
    const reuse = value.binaryReuse;
    if (reuse.kind !== 'qualified-ios-build-reuse')
      throw new Error('Detox iOS build reuse descriptor kind is invalid');
    if (!runIdPattern.test(reuse.runId)) throw new Error('Detox iOS build reuse run ID is invalid');
    requireAbsoluteNormalizedPath(reuse.binaryPath, 'Detox reused binary path');
    requireAbsoluteNormalizedPath(reuse.checkedInBinaryPath, 'Detox profile binary path');
    if (
      value.binaryPath !== reuse.binaryPath ||
      value.binaryHash !== reuse.binaryHash ||
      reuse.checkedInBinaryPath !== expectedBinary
    )
      throw new Error('Detox reused binary is not bound to the checked-in debug profile');
    const expectedReuseBinary = path.join(
      root,
      '.qa/artifacts/native-pilot',
      reuse.runId,
      'ios-build/Build/Products/Debug-iphonesimulator/mychampions.app',
    );
    if (reuse.binaryPath !== expectedReuseBinary)
      throw new Error('Detox reused binary path is outside the qualified artifact run');
    requireHash(reuse.binaryHash, 'Detox reused binary hash');
    requireBuildIdentity(reuse.binaryIdentity, 'Detox reused binary identity');
  } else if (value.platform === 'android' && value.binaryReuse) {
    const reuse = value.binaryReuse;
    if (reuse.kind !== 'qualified-android-build-reuse')
      throw new Error('Detox Android build reuse descriptor kind is invalid');
    if (!runIdPattern.test(reuse.runId))
      throw new Error('Detox Android build reuse run ID is invalid');
    requireAbsoluteNormalizedPath(reuse.binaryPath, 'Detox Android reused app path');
    requireAbsoluteNormalizedPath(reuse.testBinaryPath, 'Detox Android reused test APK path');
    requireAbsoluteNormalizedPath(reuse.checkedInBinaryPath, 'Detox Android profile app path');
    requireAbsoluteNormalizedPath(
      reuse.checkedInTestBinaryPath,
      'Detox Android profile test APK path',
    );
    const runRoot = path.join(root, '.qa/artifacts/native-pilot', reuse.runId);
    const expectedReuseBinary = path.join(
      runRoot,
      'android-build/outputs/apk/dev/debug/app-dev-debug.apk',
    );
    const expectedReuseTestBinary = path.join(
      runRoot,
      'android-build/outputs/apk/androidTest/dev/debug/app-dev-debug-androidTest.apk',
    );
    const expectedTestBinary = path.join(
      root,
      'android/app/build/outputs/apk/androidTest/dev/debug/app-dev-debug-androidTest.apk',
    );
    if (
      value.binaryPath !== reuse.binaryPath ||
      value.binaryHash !== reuse.binaryHash ||
      value.testBinaryPath !== reuse.testBinaryPath ||
      value.testBinaryHash !== reuse.testBinaryHash ||
      reuse.binaryPath !== expectedReuseBinary ||
      reuse.testBinaryPath !== expectedReuseTestBinary ||
      reuse.checkedInBinaryPath !== expectedBinary ||
      reuse.checkedInTestBinaryPath !== expectedTestBinary
    )
      throw new Error(
        'Detox Android reused binaries are not bound to the checked-in debug profile',
      );
    requireHash(reuse.binaryHash, 'Detox Android reused app hash');
    requireHash(reuse.testBinaryHash, 'Detox Android reused test APK hash');
    requireBuildIdentity(reuse.binaryIdentity, 'Detox Android reused app identity');
    requireBuildIdentity(reuse.testBinaryIdentity, 'Detox Android reused test APK identity');
    if (
      !Array.isArray(reuse.androidBuildInputPaths) ||
      Array.from(reuse.androidBuildInputPaths).sort().join('\0') !==
        Array.from(detoxAndroidBuildInputClosure).sort().join('\0')
    )
      throw new Error('Detox Android build input closure is not manifest-complete');
    requireHash(reuse.androidBuildInputsHash, 'Detox Android build input hash');
    requireAbsoluteNormalizedPath(reuse.commandReceiptPath, 'Detox Android command receipt path');
    if (
      reuse.commandReceiptPath !== path.join(runRoot, 'android-detox-build.execution.private.json')
    )
      throw new Error('Detox Android command receipt is outside the qualified run');
    requireHash(reuse.commandReceiptHash, 'Detox Android command receipt hash');
  } else if (value.binaryPath !== expectedBinary) {
    throw new Error('Detox binary path differs from the checked-in debug profile');
  }
  if (value.platform === 'android') {
    const expectedTestBinary = path.join(
      root,
      'android/app/build/outputs/apk/androidTest/dev/debug/app-dev-debug-androidTest.apk',
    );
    if (!value.binaryReuse && value.testBinaryPath !== expectedTestBinary)
      throw new Error('Detox Android test APK path differs from the checked-in debug profile');
    requireHash(value.testBinaryHash, 'Detox Android test APK hash');
  } else if (value.testBinaryPath !== null || value.testBinaryHash !== null) {
    throw new Error('iOS Detox build must not carry an Android test APK');
  }
  requireHash(value.binaryHash, 'Detox binary hash');
  requireHash(value.helperInputsHash, 'Detox helper input hash');
  requireHash(value.detoxConfigHash, 'Detox config hash');
  requireHash(value.embeddedRuntime.configSourceHash, 'Embedded runtime config hash');
  if (
    !gitShaPattern.test(value.source.sha) ||
    typeof value.source.dirty !== 'boolean' ||
    !hashPattern.test(value.source.sourceTreeHash) ||
    !Array.isArray(value.helperInputPaths) ||
    value.helperInputPaths.length === 0 ||
    new Set(value.helperInputPaths).size !== value.helperInputPaths.length ||
    value.helperInputPaths.some(
      (relative) =>
        typeof relative !== 'string' ||
        !relative ||
        path.isAbsolute(relative) ||
        relative.includes('..') ||
        relative.trim() !== relative,
    )
  )
    throw new Error('Detox source/helper identity is incomplete');
  const expectedHelperClosure =
    value.platform === 'android' && value.binaryReuse
      ? detoxAndroidBuildInputClosure
      : detoxSessionHelperClosure;
  if (
    Array.from(value.helperInputPaths).sort().join('\0') !==
    Array.from(expectedHelperClosure).sort().join('\0')
  )
    throw new Error('Detox helper input closure is not manifest-complete');
  const maxOwnedMetroPort = value.platform === 'ios' ? 65535 : 49151;
  if (
    !Number.isSafeInteger(value.metroPort) ||
    value.metroPort < 1024 ||
    value.metroPort > maxOwnedMetroPort
  )
    throw new Error('Detox Metro port is outside the owned range');
  const expectedAppIdentifier = value.platform === 'ios' ? expectedIosAppId : expectedAndroidAppId;
  if (
    value.appIdentifier !== expectedAppIdentifier ||
    value.embeddedRuntime.appIdentifier !== expectedAppIdentifier ||
    value.embeddedRuntime.variant !== 'dev' ||
    !appIdentifierPattern.test(value.appIdentifier)
  )
    throw new Error('Detox app identifier differs from the dev application');
  requireIntegratedLoopbackOrigin(value.embeddedRuntime.apiOrigin);
  requireAbsoluteOwnedPath(value.embeddedRuntime.configSourcePath, root, 'Runtime config source');
  if (path.basename(value.embeddedRuntime.configSourcePath) !== 'app.config.ts')
    throw new Error('Runtime config source must be app.config.ts');
}

export function requireDetoxBuildInstrumentation(
  value: DetoxBaselineBuildInstrumentation,
  repositoryRoot: string,
): DetoxBaselineBuildInstrumentation {
  requireBuildShape(value, repositoryRoot);
  return value;
}

/** Compare fresh observations with the original qualified descriptor. */
export function requireUnchangedQualifiedBuild(
  qualified: DetoxBaselineBuildInstrumentation,
  observed: DetoxBaselineBuildInstrumentation,
): DetoxBaselineBuildInstrumentation {
  const comparable = [
    'platform',
    'configuration',
    'binaryPath',
    'binaryHash',
    'testBinaryPath',
    'testBinaryHash',
    'source',
    'helperInputPaths',
    'helperInputsHash',
    'detoxConfigPath',
    'detoxConfigHash',
    'metroPort',
    'appIdentifier',
    'embeddedRuntime',
    'binaryReuse',
  ] as const;
  for (const key of comparable) {
    if (stableJson(qualified[key]) !== stableJson(observed[key]))
      throw new Error(`Detox qualified build changed: ${key}`);
  }
  return observed;
}

/** Recompute every qualified input; never replace a caller-provided hash. */
export async function inspectDetoxBuildInstrumentation(input: {
  repositoryRoot: string;
  build: DetoxBaselineBuildInstrumentation;
}): Promise<DetoxBaselineBuildInstrumentation> {
  const root = await realpath(input.repositoryRoot);
  requireBuildShape(input.build, root);
  const configPath = path.resolve(input.build.detoxConfigPath);
  if (configPath !== path.join(root, '.detoxrc.js') || (await realpath(configPath)) !== configPath)
    throw new Error('Detox config is not canonical');
  const configRelative = path.relative(root, configPath);
  const configObservation = readNativeEvidenceObservation(
    root,
    configRelative,
    false,
    'owned-source',
  );
  if (hashBytes(configObservation.bytes) !== input.build.detoxConfigHash)
    throw new Error('Detox config identity changed after qualification');
  const actualSource =
    input.build.platform === 'ios' ? await sourceIdentity(root) : await androidSourceIdentity(root);
  if (stableJson(actualSource) !== stableJson(input.build.source))
    throw new Error('Detox source identity changed after qualification');
  const helperContents = await Promise.all(
    input.build.helperInputPaths.map(async (relative) => {
      const file = path.join(root, relative);
      if ((await realpath(file)) !== file) throw new Error('Detox helper input is not canonical');
      return readNativeEvidenceObservation(root, relative, false, 'owned-source').bytes;
    }),
  );
  if (
    helperInputsDigest(input.build.helperInputPaths, helperContents) !==
    input.build.helperInputsHash
  )
    throw new Error('Detox helper input identity changed after qualification');
  const configSourcePath = path.resolve(input.build.embeddedRuntime.configSourcePath);
  if ((await realpath(configSourcePath)) !== configSourcePath)
    throw new Error('Embedded runtime config source is not canonical');
  const configSourceRelative = path.relative(root, configSourcePath);
  const configSourceObservation = readNativeEvidenceObservation(
    root,
    configSourceRelative,
    false,
    'owned-source',
  );
  if (hashBytes(configSourceObservation.bytes) !== input.build.embeddedRuntime.configSourceHash)
    throw new Error('Embedded runtime config source changed after qualification');
  const binaryPath = path.resolve(input.build.binaryPath);
  if ((await realpath(binaryPath)) !== binaryPath)
    throw new Error('Detox binary artifact is not canonical');
  const metadata = await lstat(binaryPath);
  if (!metadata.isFile() && !metadata.isDirectory())
    throw new Error('Detox binary artifact is not a file or app bundle');
  if (process.getuid && metadata.uid !== process.getuid())
    throw new Error('Detox binary artifact is not owned by the current user');
  const binaryIdentityBefore: ReusableIosBuildIdentity = {
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    mode: metadata.mode,
    nlink: metadata.nlink,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
  };
  const binaryHash = metadata.isDirectory()
    ? await treeHash(binaryPath)
    : hashBytes(await readFile(binaryPath));
  const metadataAfter = await lstat(binaryPath);
  const binaryIdentityAfter: ReusableIosBuildIdentity = {
    dev: metadataAfter.dev,
    ino: metadataAfter.ino,
    uid: metadataAfter.uid,
    gid: metadataAfter.gid,
    mode: metadataAfter.mode,
    nlink: metadataAfter.nlink,
    size: metadataAfter.size,
    mtimeMs: metadataAfter.mtimeMs,
    ctimeMs: metadataAfter.ctimeMs,
  };
  if (
    (await realpath(binaryPath)) !== binaryPath ||
    stableJson(binaryIdentityAfter) !== stableJson(binaryIdentityBefore)
  )
    throw new Error('Detox binary artifact identity changed during inspection');
  if (binaryHash !== input.build.binaryHash)
    throw new Error('Detox binary changed after qualification');
  if (
    input.build.binaryReuse &&
    stableJson(binaryIdentityAfter) !== stableJson(input.build.binaryReuse.binaryIdentity)
  )
    throw new Error('Detox reused binary identity changed after qualification');
  if (input.build.platform === 'android') {
    const testBinaryPath = path.resolve(input.build.testBinaryPath!);
    if ((await realpath(testBinaryPath)) !== testBinaryPath)
      throw new Error('Detox Android test APK is not canonical');
    const testMetadata = await lstat(testBinaryPath);
    if (!testMetadata.isFile() || (process.getuid && testMetadata.uid !== process.getuid()))
      throw new Error('Detox Android test APK is not an owned regular file');
    const testBinaryHash = hashBytes(await readFile(testBinaryPath));
    if (testBinaryHash !== input.build.testBinaryHash)
      throw new Error('Detox Android test APK changed after qualification');
    const testIdentity: ReusableIosBuildIdentity = {
      dev: testMetadata.dev,
      ino: testMetadata.ino,
      uid: testMetadata.uid,
      gid: testMetadata.gid,
      mode: testMetadata.mode,
      nlink: testMetadata.nlink,
      size: testMetadata.size,
      mtimeMs: testMetadata.mtimeMs,
      ctimeMs: testMetadata.ctimeMs,
    };
    const testMetadataAfter = await lstat(testBinaryPath);
    if (
      (await realpath(testBinaryPath)) !== testBinaryPath ||
      stableJson(testIdentity) !==
        stableJson({
          dev: testMetadataAfter.dev,
          ino: testMetadataAfter.ino,
          uid: testMetadataAfter.uid,
          gid: testMetadataAfter.gid,
          mode: testMetadataAfter.mode,
          nlink: testMetadataAfter.nlink,
          size: testMetadataAfter.size,
          mtimeMs: testMetadataAfter.mtimeMs,
          ctimeMs: testMetadataAfter.ctimeMs,
        })
    )
      throw new Error('Detox Android test APK identity changed during inspection');
    if (input.build.binaryReuse?.kind === 'qualified-android-build-reuse') {
      if (stableJson(testIdentity) !== stableJson(input.build.binaryReuse.testBinaryIdentity))
        throw new Error('Detox Android reused test APK identity changed after qualification');
      const inputContents = input.build.binaryReuse.androidBuildInputPaths.map(
        (relative) => readNativeEvidenceObservation(root, relative, false, 'owned-source').bytes,
      );
      if (
        helperInputsDigest(input.build.binaryReuse.androidBuildInputPaths, inputContents) !==
        input.build.binaryReuse.androidBuildInputsHash
      )
        throw new Error('Detox Android build input identity changed after qualification');
      const receiptPath = path.resolve(input.build.binaryReuse.commandReceiptPath);
      if ((await realpath(receiptPath)) !== receiptPath)
        throw new Error('Detox Android build command receipt is not canonical');
      const receiptRelative = path.relative(root, receiptPath);
      const receiptObservation = readNativeEvidenceObservation(
        root,
        receiptRelative,
        true,
        'owned-source',
      );
      if (hashBytes(receiptObservation.bytes) !== input.build.binaryReuse.commandReceiptHash)
        throw new Error('Detox Android build command receipt changed after qualification');
    }
  }
  return requireUnchangedQualifiedBuild(input.build, {
    ...input.build,
    source: actualSource,
    binaryHash,
  });
}

async function defaultAcquireOwnedTarget(options: {
  platform: DetoxBaselinePlatform;
  artifactRoot: string;
  signal?: AbortSignal;
  deadlineAtMonotonicMs?: number;
  artifactRootIdentity?: DetoxConnectionEvidenceDirectoryIdentity;
}): Promise<DetoxOwnedTarget> {
  requireDetoxAndroidProducerBeforeAcquisition(options.platform);
  if (options.platform === 'ios') {
    const device = await acquireOwnedIosSimulator({
      artifactRoot: options.artifactRoot,
      deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
      signal: options.signal,
    });
    return {
      platform: 'ios',
      deviceId: device.udid,
      ownership: {
        artifactRoot: options.artifactRoot,
        hostLockRequired: true,
        cleanupAuthorized: true,
      },
      verify: async (signal?: AbortSignal) => {
        signal?.throwIfAborted();
        return validateBootedIosDevice(device, await device.inspect(signal));
      },
      stop: device.stop,
    };
  }
  const systemImage = resolveOwnedAndroidSystemImage();
  const sdkRoot = process.env.ANDROID_SDK_ROOT ?? '/Users/eduwaldo/Library/Android/sdk';
  const runtimeParent = path.join(options.artifactRoot, 'android-runtime');
  options.signal?.throwIfAborted();
  const artifactMetadata = await lstat(options.artifactRoot);
  if (
    !artifactMetadata.isDirectory() ||
    artifactMetadata.isSymbolicLink() ||
    (process.getuid && artifactMetadata.uid !== process.getuid()) ||
    (artifactMetadata.mode & 0o777) !== 0o700 ||
    (await realpath(options.artifactRoot)) !== options.artifactRoot
  )
    throw new Error('Android Detox artifact root is not an owned private directory');
  if (
    options.artifactRootIdentity &&
    (artifactMetadata.dev !== options.artifactRootIdentity.dev ||
      artifactMetadata.ino !== options.artifactRootIdentity.ino ||
      artifactMetadata.uid !== options.artifactRootIdentity.uid ||
      artifactMetadata.gid !== options.artifactRootIdentity.gid ||
      (artifactMetadata.mode & 0o777) !== options.artifactRootIdentity.mode)
  )
    throw new Error('Android Detox artifact root identity changed before runtime creation');
  const artifactIdentity: AndroidDetoxSessionDirectoryIdentity = {
    path: options.artifactRoot,
    dev: artifactMetadata.dev,
    ino: artifactMetadata.ino,
    uid: artifactMetadata.uid,
    gid: artifactMetadata.gid,
    mode: artifactMetadata.mode & 0o777,
    nlink: artifactMetadata.nlink,
  };
  await createAndroidDetoxSessionOwnedChildDirectory({
    parent: options.artifactRoot,
    name: path.basename(runtimeParent),
    expectedParentIdentity: artifactIdentity,
    lifecycle: {
      signal: options.signal ?? new AbortController().signal,
      deadlineAtMonotonicMs: options.deadlineAtMonotonicMs ?? performance.now() + 120_000,
    },
  });
  if (options.artifactRootIdentity) {
    const binding: OwnedArtifactRootBinding = {
      root: path.dirname(options.artifactRoot),
      artifact: options.artifactRoot,
      identity: options.artifactRootIdentity,
    };
    await assertArtifactRootIdentity(binding, 'Android runtime parent creation');
  }
  const runtimeIdentity = await lstat(runtimeParent);
  if (
    !runtimeIdentity.isDirectory() ||
    runtimeIdentity.isSymbolicLink() ||
    (process.getuid && runtimeIdentity.uid !== process.getuid()) ||
    (runtimeIdentity.mode & 0o777) !== 0o700 ||
    (await realpath(runtimeParent)) !== runtimeParent
  )
    throw new Error('Android Detox runtime parent is not an owned private directory');
  const device = await acquireOwnedAndroidEmulator({
    runtimeParent,
    artifactRoot: options.artifactRoot,
    sdkRoot,
    systemImage,
    signal: options.signal,
    deadlineAtMonotonicMs: options.deadlineAtMonotonicMs ?? performance.now() + 120_000,
  });
  const androidSessionStorage: DetoxAndroidSessionStorageTarget = {
    appId: expectedAndroidAppId,
    serial: device.identity.serial,
    adbServerPort: device.slot.adbServerPort,
    verify: device.verify,
    runAdb: async (input) => {
      const command = path.join(sdkRoot, 'platform-tools/adb');
      const argv = [
        '-H',
        '127.0.0.1',
        '-P',
        String(device.slot.adbServerPort),
        '-s',
        device.slot.emulatorSerial,
        ...input.argv,
      ];
      const cwd = process.cwd();
      const execution = await executeOwnedNativeCommand({
        command,
        argv,
        artifactRoot: input.artifactRoot,
        label: input.label,
        env: device.env,
        cwd,
        input: input.input,
        deadlineMs: input.deadlineMs,
        phase: 'step',
        signal: input.signal,
        stdoutPath: input.stdoutPath,
      });
      return {
        ...execution,
        command,
        argv,
        cwd,
        deadlineMs: input.deadlineMs,
        ...(input.input !== undefined
          ? { inputSha256: createHash('sha256').update(input.input).digest('hex') }
          : {}),
        commandHash: buildDetoxAndroidStorageCommandHash({
          command,
          argv,
          cwd,
          deadlineMs: input.deadlineMs,
          ...(input.input !== undefined
            ? { inputSha256: createHash('sha256').update(input.input).digest('hex') }
            : {}),
          phase: 'step',
          target: input.target,
          binding: input.binding,
        }),
        target: input.target,
        binding: input.binding,
      };
    },
    runHostSqlite: async (input) => {
      const command = '/usr/bin/sqlite3';
      const argv = [...input.argv];
      const cwd = process.cwd();
      const execution = await executeOwnedNativeCommand({
        command,
        argv,
        artifactRoot: input.artifactRoot,
        label: input.label,
        env: { ...process.env },
        cwd,
        deadlineMs: input.deadlineMs,
        phase: 'step',
        signal: input.signal,
        stdoutPath: input.stdoutPath,
      });
      return {
        ...execution,
        command,
        argv,
        cwd,
        deadlineMs: input.deadlineMs,
        commandHash: buildDetoxAndroidStorageCommandHash({
          command,
          argv,
          cwd,
          deadlineMs: input.deadlineMs,
          phase: 'step',
          target: input.target,
          binding: input.binding,
        }),
        target: input.target,
        binding: input.binding,
      };
    },
  };
  return {
    platform: 'android',
    deviceId: device.identity.serial,
    androidRuntimeParent: runtimeParent,
    androidSdkRoot: sdkRoot,
    androidTargetRunId: device.runId,
    androidOsVersion: device.osVersion,
    androidSessionStorage,
    ownership: {
      artifactRoot: options.artifactRoot,
      hostLockRequired: true,
      cleanupAuthorized: true,
    },
    verify: async () => device.verify(),
    stop: device.stop,
  };
}

async function capturePreviousIosDevices(artifactRoot: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const result = await execute('xcrun', ['simctl', 'list', 'devices', '--json'], {
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
    signal,
  });
  const parsed = JSON.parse(result.stdout) as { devices?: unknown };
  if (!parsed.devices || typeof parsed.devices !== 'object' || Array.isArray(parsed.devices))
    throw new Error('iOS pre-acquisition device inventory is invalid');
  await writeFile(
    path.join(artifactRoot, 'previous-ios-devices.private.json'),
    JSON.stringify(parsed),
    { flag: 'wx', mode: 0o600 },
  );
}

async function defaultResolveIosDataContainer(input: {
  deviceId: string;
  bundleId: string;
  signal?: AbortSignal;
}): Promise<string> {
  if (input.bundleId !== expectedIosAppId || !/^[A-Fa-f0-9-]{8,64}$/.test(input.deviceId))
    throw new Error('Detox iOS data-container request is not bound to the owned dev target');
  const result = await execute(
    'xcrun',
    ['simctl', 'get_app_container', input.deviceId, input.bundleId, 'data'],
    { timeout: 15_000, maxBuffer: 64 * 1024, signal: input.signal },
  );
  const dataContainer = result.stdout.trim();
  if (!path.isAbsolute(dataContainer) || dataContainer.includes('\n'))
    throw new Error('Detox iOS data container is invalid');
  return dataContainer;
}

async function defaultReadAndroidSessionStorageCheckpoint(input: {
  checkpoint: DetoxSessionCacheCheckpoint;
  artifactRoot: string;
  target: DetoxOwnedTarget;
  actorAuthUid?: string;
  binding: DetoxAndroidSessionStorageBinding;
  phase?: DetoxAndroidSessionStoragePhase;
  signal: AbortSignal;
}): Promise<AndroidSessionStorageCheckpoint> {
  if (input.target.platform !== 'android' || !input.target.androidSessionStorage)
    throw new Error('Android Detox storage reader requires the owned Android target runtime');
  return readDetoxAndroidSessionStorageCheckpoint({
    checkpoint: input.checkpoint,
    artifactRoot: input.artifactRoot,
    target: input.target.androidSessionStorage,
    actorAuthUid: input.actorAuthUid,
    binding: input.binding,
    phase: input.phase,
    signal: input.signal,
  });
}

type BaselineLifecycle = Readonly<{
  signal?: AbortSignal;
  deadlineAtMonotonicMs: number;
}>;

function baselineFence(lifecycle: BaselineLifecycle, phase: string): void {
  lifecycle.signal?.throwIfAborted();
  if (
    !Number.isFinite(lifecycle.deadlineAtMonotonicMs) ||
    performance.now() >= lifecycle.deadlineAtMonotonicMs
  )
    throw new Error(`Detox baseline deadline elapsed during ${phase}`);
  lifecycle.signal?.throwIfAborted();
}

async function awaitBaselineDeadline<T>(
  operation: Promise<T>,
  lifecycle: BaselineLifecycle,
  phase: string,
): Promise<T> {
  baselineFence(lifecycle, `${phase}:before`);
  const remaining = Math.max(1, Math.floor(lifecycle.deadlineAtMonotonicMs - performance.now()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Detox baseline deadline elapsed during ${phase}`)),
      remaining,
    );
  });
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(
        lifecycle.signal?.reason instanceof Error
          ? lifecycle.signal.reason
          : new Error(`Detox baseline cancelled during ${phase}`),
      );
  });
  if (lifecycle.signal?.aborted) onAbort?.();
  else if (onAbort) lifecycle.signal?.addEventListener('abort', onAbort, { once: true });
  void operation.catch(() => undefined);
  try {
    const value = await Promise.race([operation, deadline, cancelled]);
    baselineFence(lifecycle, `${phase}:after`);
    return value;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) lifecycle.signal?.removeEventListener('abort', onAbort);
  }
}

async function readBaselineBytes(
  file: string,
  lifecycle: BaselineLifecycle,
  maxBytes: number,
): Promise<Buffer> {
  const resolved = path.resolve(file);
  const before = await lstat(resolved);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes)
    throw new Error('Detox baseline source file is not a bounded regular file');
  if ((await realpath(resolved)) !== resolved)
    throw new Error('Detox baseline source file is not canonical');
  const bytes = await awaitBaselineDeadline(readFile(resolved), lifecycle, 'APK read');
  const after = await lstat(resolved);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.size !== before.size ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    (await realpath(resolved)) !== resolved
  )
    throw new Error('Detox baseline source file changed during bounded read');
  return bytes;
}

async function defaultVerifyAndroidBuild(input: {
  build: DetoxBaselineBuildInstrumentation;
  artifactRoot: string;
  apiOrigin: string;
  signal?: AbortSignal;
  deadlineAtMonotonicMs: number;
}): Promise<void> {
  baselineFence(input, 'Android build verification');
  const tools = await resolveAndroidPilotToolchain();
  const binaryPath = path.resolve(input.build.binaryPath);
  const binaryBytes = await readBaselineBytes(binaryPath, input, 256 * 1024 * 1024);
  if (hashBytes(binaryBytes) !== input.build.binaryHash)
    throw new Error('Android Detox APK changed before identity inspection');
  const buildTools = path.join(tools.sdkRoot, 'build-tools/36.0.0');
  const command = (executable: string, argv: readonly string[], timeoutMs: number, phase: string) =>
    awaitBaselineDeadline(
      execute(executable, [...argv], {
        timeout: Math.max(
          1,
          Math.min(timeoutMs, Math.floor(input.deadlineAtMonotonicMs - performance.now())),
        ),
        maxBuffer: 1024 * 1024,
        signal: input.signal,
      }),
      input,
      phase,
    );
  const [badging, signing, embedded] = await Promise.all([
    command(path.join(buildTools, 'aapt2'), ['dump', 'badging', binaryPath], 15_000, 'aapt2'),
    command(
      path.join(buildTools, 'apksigner'),
      ['verify', '--verbose', '--print-certs', binaryPath],
      30_000,
      'apksigner',
    ),
    command(
      '/usr/bin/python3',
      [
        '-c',
        'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); i=z.getinfo("assets/app.config"); assert i.file_size<=1048576; sys.stdout.buffer.write(z.read(i))',
        binaryPath,
      ],
      15_000,
      'APK config ZIP read',
    ),
  ]);
  assertAndroidPilotApkMetadata(
    {
      badging: badging.stdout,
      signing: signing.stdout,
      config: JSON.parse(embedded.stdout),
    },
    input.apiOrigin,
  );
}

export const ownedDetoxBaselineFactories: DetoxBaselineFactories = Object.freeze({
  reserveOwnedAppPort,
  startOwnedSession,
  startOwnedApiProxy,
  startOwnedExpo,
  acquireOwnedTarget: defaultAcquireOwnedTarget,
  capturePreviousIosDevices,
  verifyAndroidBuild: defaultVerifyAndroidBuild,
  executeOwnedNativeCommand,
  requireNativeHostAvailability,
  verifyIosSimulatorApp,
  verifyOwnedIosCleanup,
  inspectDetoxBuildInstrumentation,
  resolveIosDataContainer: defaultResolveIosDataContainer,
  observeIosAuthMetadata,
  readAndroidSessionStorageCheckpoint: defaultReadAndroidSessionStorageCheckpoint,
  verifyOwnedAndroidCleanup,
});

function requireFixture(
  value: OwnedFixtures,
  platform: DetoxBaselinePlatform,
  role: DetoxBaselineRole,
) {
  if (!runIdPattern.test(value.runId) || value.scope !== `native-entry-${platform}`)
    throw new Error('Owned Detox fixture identity or scope mismatch');
  const actor = role === 'student' ? value.accounts.student : value.accounts.coach;
  const expectedRole = role === 'student' ? 'student' : 'professional';
  if (
    !actor ||
    typeof actor.email !== 'string' ||
    actor.email.trim() !== actor.email ||
    actor.email.length === 0 ||
    typeof actor.password !== 'string' ||
    actor.password.length === 0 ||
    typeof actor.authUid !== 'string' ||
    actor.authUid.length === 0 ||
    actor.role !== expectedRole
  )
    throw new Error('Owned Detox fixture actor credentials or locked role are invalid');
  const fixtureAuthUids = Object.values(value.accounts)
    .map((account) => account.authUid)
    .sort();
  if (
    fixtureAuthUids.some((uid) => typeof uid !== 'string' || uid.length === 0) ||
    new Set(fixtureAuthUids).size !== fixtureAuthUids.length
  )
    throw new Error('Owned Detox fixture actor allowlist is invalid');
  return {
    actor,
    evidence: {
      runId: value.runId,
      scope: value.scope,
      fixtureHash: hashJson(value),
      actorRole: role,
      actorAuthUid: actor.authUid,
      fixtureAuthUids,
    } satisfies DetoxBaselineFixtureEvidence,
  };
}

function requireSnapshot(
  value: OwnedDomainSnapshot,
  expected: { runId: string; scope: string },
): OwnedDomainSnapshot {
  if (
    value.schemaVersion !== 1 ||
    value.runId !== expected.runId ||
    value.scope !== expected.scope ||
    value.readOnly !== true ||
    !Array.isArray(value.trainingPlans) ||
    !Array.isArray(value.connections)
  )
    throw new Error('Owned Detox snapshot is incomplete or not read-only');
  return value;
}

type ExactOwnedSnapshot<T> = Readonly<{
  value: T;
  sourceFile: string;
  sourceSha256: string;
  sourceBytes: number;
  stagedFile: string;
}>;

async function captureExactOwnedSnapshot<T>(input: {
  session: OwnedSession;
  scope: string;
  prefix: 'snapshot' | 'connection-snapshot';
  artifactRoot: string;
  stagedName: string;
  read: () => Promise<T>;
  validate: (value: T) => T;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
  /** Path and identity captured from the owned session manifest before snapshot discovery. */
  sessionArtifactRoot: string;
  sessionArtifactRootIdentity: DetoxConnectionEvidenceDirectoryIdentity;
  artifactRootIdentity: DetoxConnectionEvidenceDirectoryIdentity;
  /** Private race controls; production callers leave these unset. */
  onBeforeSourceDiscovery?: () => void | Promise<void>;
  onAfterSourceDiscovery?: () => void | Promise<void>;
  onAfterSourceRead?: () => void | Promise<void>;
}): Promise<ExactOwnedSnapshot<T>> {
  if (!/^[a-z0-9-]+$/.test(input.scope) || !/^[a-zA-Z0-9-]+\.private\.json$/.test(input.stagedName))
    throw new Error('Owned Detox snapshot identity is invalid');
  const lifecycle = {
    signal: input.signal,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
  };
  baselineFence(lifecycle, 'owned snapshot source root:before');
  await assertSessionArtifactRootIdentity(input, 'owned snapshot source discovery before');
  await input.onBeforeSourceDiscovery?.();
  await assertSessionArtifactRootIdentity(input, 'owned snapshot source discovery race fence');
  const sourceRoot = await realpath(input.session.manifest.artifactRoot);
  baselineFence(lifecycle, 'owned snapshot source root:after');
  const before = new Set(await readdir(sourceRoot));
  await input.onAfterSourceDiscovery?.();
  await assertSessionArtifactRootIdentity(input, 'owned snapshot source discovery after');
  baselineFence(lifecycle, 'owned snapshot read:before');
  const value = input.validate(
    await awaitBaselineDeadline(input.read(), lifecycle, 'owned snapshot value read'),
  );
  await input.onAfterSourceRead?.();
  await assertSessionArtifactRootIdentity(input, 'owned snapshot source read after');
  baselineFence(lifecycle, 'owned snapshot read:after');
  const names = (await readdir(sourceRoot))
    .filter(
      (name) =>
        name.startsWith(input.prefix + '-' + input.scope + '-') &&
        name.endsWith('.private.json') &&
        !before.has(name),
    )
    .sort();
  if (names.length !== 1) throw new Error('Owned Detox snapshot source file is not unique');
  const sourceFile = path.join(sourceRoot, names[0]);
  const sourceRelative = path.relative(sourceRoot, sourceFile);
  baselineFence(lifecycle, 'owned snapshot source descriptor read:before');
  await assertSessionArtifactRootIdentity(input, 'owned snapshot source descriptor read before');
  const sourceObservation = readNativeEvidenceObservation(sourceRoot, sourceRelative, true);
  await assertSessionArtifactRootIdentity(input, 'owned snapshot source descriptor read after');
  baselineFence(lifecycle, 'owned snapshot source descriptor read:after');
  const bytes = sourceObservation.bytes;
  const parsed = JSON.parse(bytes.toString('utf8')) as T;
  if (stableJson(parsed) !== stableJson(value))
    throw new Error('Owned Detox snapshot source differs from the returned value');
  baselineFence(lifecycle, 'owned snapshot staged write:before');
  await assertSessionArtifactRootIdentity(input, 'owned snapshot staged write before');
  const staged = await writeAtomicDetoxConnectionBytes(
    input.artifactRoot,
    input.stagedName,
    bytes,
    8 * 1024 * 1024,
    {
      signal: input.signal,
      deadlineAt: input.deadlineAtMonotonicMs,
      expectedRootIdentity: input.artifactRootIdentity,
    },
  );
  await assertSessionArtifactRootIdentity(input, 'owned snapshot staged write after');
  baselineFence(lifecycle, 'owned snapshot staged write:after');
  const stagedFile = path.join(input.artifactRoot, input.stagedName);
  if (staged.realpath !== stagedFile) throw new Error('Owned Detox snapshot staged path changed');
  const stagedMetadata = await lstat(stagedFile);
  if (
    !stagedMetadata.isFile() ||
    (stagedMetadata.mode & 0o777) !== 0o600 ||
    (process.getuid && stagedMetadata.uid !== process.getuid()) ||
    (await realpath(stagedFile)) !== stagedFile
  )
    throw new Error('Owned Detox snapshot staged file is not private');
  const sourceSha256 = hashBytes(bytes);
  if (hashBytes(staged.bytes) !== sourceSha256)
    throw new Error('Owned Detox snapshot staged bytes changed');
  baselineFence(lifecycle, 'owned snapshot staged readback:after');
  return {
    value,
    sourceFile,
    sourceSha256,
    sourceBytes: bytes.byteLength,
    stagedFile,
  };
}

/** Private source-race control; the production route never supplies race hooks. */
export const captureExactOwnedSnapshotForTest = captureExactOwnedSnapshot;

export function requireSessionStepResult(value: unknown): DetoxSessionStepResult {
  const row = record(value, 'Detox session result');
  if (
    row.schemaVersion !== 2 ||
    row.kind !== 'private-detox-session-steps' ||
    row.launchCount !== 3 ||
    row.synchronizationDisabled !== true
  )
    throw new Error('Detox session result metadata is incomplete');
  if (!allowedPlatforms.includes(row.platform as DetoxBaselinePlatform))
    throw new Error('Detox session result platform is invalid');
  if (!allowedRoles.includes(row.role as DetoxBaselineRole))
    throw new Error('Detox session result role is invalid');
  const steps = record(row.steps, 'Detox session result steps');
  if (
    Object.keys(steps).sort().join('\0') !== [...expectedUiSessionStepIds].sort().join('\0') ||
    expectedUiSessionStepIds.some((id) => steps[id] !== true)
  )
    throw new Error('Detox session assertions are incomplete');
  if (!Array.isArray(row.events) || row.events.length !== expectedUiSessionStepIds.length)
    throw new Error('Detox session event evidence is incomplete');
  requireSessionEvents(row.events, true);
  return value as DetoxSessionStepResult;
}

function requireSessionEvents(
  events: readonly unknown[],
  complete: boolean,
): asserts events is readonly DetoxSessionStepEvent[] {
  if (events.length === 0 || events.length > expectedUiSessionStepIds.length)
    throw new Error('Detox session event evidence is out of bounds');
  let previousMonotonicMs = -1;
  events.forEach((event, index) => {
    const candidate = record(event, 'Detox session event');
    const cancelEvidence = candidate.cancelEvidence;
    if (cancelEvidence !== undefined) requireCancelEvidenceShape(cancelEvidence);
    if (
      candidate.stepId !== expectedUiSessionStepIds[index] ||
      candidate.ordinal !== index + 1 ||
      !Number.isSafeInteger(candidate.ordinal) ||
      typeof candidate.monotonicMs !== 'number' ||
      !Number.isFinite(candidate.monotonicMs) ||
      candidate.monotonicMs <= previousMonotonicMs ||
      (candidate.stepId === 'NAT-session-signout' &&
        (candidate.confirmationAfterCancel !== 'not-visible' ||
          !cancelEvidence ||
          cancelEvidence.modalPresent !== false ||
          cancelEvidence.accountScreenPresent !== true)) ||
      (candidate.stepId !== 'NAT-session-signout' &&
        (candidate.confirmationAfterCancel !== undefined || candidate.cancelEvidence !== undefined))
    )
      throw new Error('Detox session event timing or cancel evidence is invalid');
    previousMonotonicMs = candidate.monotonicMs;
  });
  if (complete && events.length !== expectedUiSessionStepIds.length)
    throw new Error('Detox session event evidence is incomplete');
}

type DetoxSessionProgress = Readonly<{
  schemaVersion: 2;
  kind: 'private-detox-session-progress';
  platform: DetoxBaselinePlatform;
  role: DetoxBaselineRole;
  completedSteps: readonly (typeof expectedUiSessionStepIds)[number][];
  events: readonly DetoxSessionStepEvent[];
  cancelCheckpoint?: Readonly<{
    monotonicMs: number;
    cancelEvidence: DetoxCancelUiEvidence;
  }>;
  launchCount: number;
  synchronizationDisabled: true;
}>;

function requireSessionProgress(value: unknown): DetoxSessionProgress {
  const row = record(value, 'Detox session progress');
  const launchCount = row.launchCount;
  if (
    row.schemaVersion !== 2 ||
    row.kind !== 'private-detox-session-progress' ||
    row.synchronizationDisabled !== true ||
    typeof launchCount !== 'number' ||
    !Number.isSafeInteger(launchCount) ||
    launchCount < 0 ||
    launchCount > 3 ||
    !Array.isArray(row.completedSteps) ||
    !Array.isArray(row.events) ||
    row.completedSteps.length !== row.events.length ||
    row.completedSteps.some((step) => !expectedUiSessionStepIds.includes(step as never))
  )
    throw new Error('Detox session progress metadata is incomplete');
  if (!allowedPlatforms.includes(row.platform as DetoxBaselinePlatform))
    throw new Error('Detox session progress platform is invalid');
  if (!allowedRoles.includes(row.role as DetoxBaselineRole))
    throw new Error('Detox session progress role is invalid');
  if (new Set(row.completedSteps).size !== row.completedSteps.length)
    throw new Error('Detox session progress repeats an assertion');
  if (row.events.length !== row.completedSteps.length)
    throw new Error('Detox session progress steps and events differ');
  const events = row.events as unknown as readonly DetoxSessionStepEvent[];
  requireSessionEvents(events, false);
  const cancelCheckpoint = row.cancelCheckpoint;
  if (cancelCheckpoint !== undefined && cancelCheckpoint !== null) {
    const checkpoint = record(cancelCheckpoint, 'Detox session cancel checkpoint');
    requireCancelEvidenceShape(checkpoint.cancelEvidence);
    if (typeof checkpoint.monotonicMs !== 'number' || !Number.isFinite(checkpoint.monotonicMs))
      throw new Error('Detox session cancel checkpoint timing is invalid');
    const accountEvent = events.find((event) => event.stepId === 'NAT-session-account');
    const signoutEvent = events.find((event) => event.stepId === 'NAT-session-signout');
    if (
      !accountEvent ||
      checkpoint.monotonicMs <= accountEvent.monotonicMs ||
      (signoutEvent && checkpoint.monotonicMs >= signoutEvent.monotonicMs)
    )
      throw new Error('Detox session cancel checkpoint is outside the account/cancel window');
  } else if (cancelCheckpoint === null)
    throw new Error('Detox session cancel checkpoint is invalid');
  if (row.events.length > 0 && launchCount === 0)
    throw new Error('Detox session progress recorded an assertion before launch');
  return row as DetoxSessionProgress;
}

export function requireDetoxTransportEvidence(input: {
  observations: readonly ProxyObservation[];
  identities: readonly NativeAuthIdentityObservation[];
  actorAuthUid: string;
  apiOrigin: string;
  apiPid: number;
  fixtureAuthUids: readonly string[];
}): DetoxBaselineTransportEvidence {
  const authAttempts = input.observations.filter(
    (row) =>
      row.method === 'POST' &&
      row.pathHash === signInPathHash &&
      row.requestProfile === 'native' &&
      row.requestOrigin === null &&
      row.targetOrigin === input.apiOrigin,
  );
  if (authAttempts.length !== 1)
    throw new Error('Detox baseline requires exactly one native sign-in attempt');
  const matches = input.observations.filter(
    (row) =>
      row.requestId >= 1 &&
      row.method === 'POST' &&
      row.pathHash === signInPathHash &&
      row.requestProfile === 'native' &&
      row.requestOrigin === null &&
      row.targetOrigin === input.apiOrigin &&
      row.status === 201 &&
      row.outcome === 'forwarded' &&
      row.faultAttemptId === null,
  );
  if (matches.length !== 1) throw new Error('Detox baseline lacks one owned forwarded sign-in');
  if (matches[0].requestCredentialPresent !== false)
    throw new Error('Detox baseline sign-in did not prove a credential-free native request');
  if (input.observations.some((row) => row.outcome === 'upstream-failed'))
    throw new Error('Detox baseline observed an upstream transport failure');
  const allowlistHash = hashJson([...input.fixtureAuthUids].sort());
  const identities = input.identities.filter((row) => row.requestId === matches[0].requestId);
  if (identities.length !== 1) throw new Error('Detox baseline lacks one auth identity record');
  const identity = identities[0];
  if (
    identity.status !== 201 ||
    identity.authUid !== input.actorAuthUid ||
    identity.verification !== 'verified' ||
    identity.verificationReason !== 'verified' ||
    identity.targetOrigin !== input.apiOrigin ||
    identity.apiPid !== input.apiPid ||
    identity.fixtureAuthUidAllowlistHash !== allowlistHash
  )
    throw new Error('Detox baseline auth identity is not bound to the owned API and fixture');
  return {
    requestId: matches[0].requestId,
    targetOrigin: matches[0].targetOrigin,
    status: 201,
    outcome: 'forwarded',
    requestProfile: 'native',
    requestOrigin: null,
    authUid: identity.authUid,
    apiPid: identity.apiPid,
  };
}

/** Bind the report sidecar to an actual iOS storage observation and cache read. */
export function requireDetoxIosAuthMetadataBinding(
  metadata: DetoxAuthMetadata,
  cache: DetoxNativeSessionCacheObservation,
): DetoxAuthMetadata {
  if (metadata.sessionPresent !== cache.sessionPresent)
    throw new Error('Detox iOS auth metadata disagrees with the native cache status');
  if (metadata.sessionPresent) {
    if (
      metadata.profilePresent !== true ||
      typeof metadata.profileAuthUidHash !== 'string' ||
      metadata.profileAuthUidHash !== cache.profileAuthUidHash
    )
      throw new Error('Detox iOS auth metadata is not bound to the native cache identity');
    return { ...metadata, authUidHash: metadata.profileAuthUidHash };
  }
  return metadata;
}

function landingMarker(role: DetoxBaselineRole): string {
  return role === 'student' ? 'student.home.screen' : 'pro.home.screen';
}

type OwnedArtifactRootBinding = Readonly<{
  root: string;
  artifact: string;
  identity: DetoxConnectionEvidenceDirectoryIdentity;
}>;

function artifactRootIdentity(metadata: {
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
}): DetoxConnectionEvidenceDirectoryIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    mode: metadata.mode & 0o777,
  };
}

function sameArtifactRootIdentity(
  expected: DetoxConnectionEvidenceDirectoryIdentity,
  actual: DetoxConnectionEvidenceDirectoryIdentity,
): boolean {
  return (
    expected.dev === actual.dev &&
    expected.ino === actual.ino &&
    expected.uid === actual.uid &&
    expected.gid === actual.gid &&
    expected.mode === actual.mode
  );
}

async function assertSessionArtifactRootIdentity(
  input: {
    session: OwnedSession;
    sessionArtifactRoot: string;
    sessionArtifactRootIdentity: DetoxConnectionEvidenceDirectoryIdentity;
    artifactRoot: string;
    artifactRootIdentity: DetoxConnectionEvidenceDirectoryIdentity;
  },
  phase: string,
): Promise<void> {
  const expectedSessionArtifactRoot = path.resolve(input.sessionArtifactRoot);
  const sessionArtifactRoot = path.resolve(input.session.manifest.artifactRoot);
  if (sessionArtifactRoot !== expectedSessionArtifactRoot)
    throw new Error(`Detox session artifact root changed during ${phase}`);
  await assertArtifactRootIdentity(
    {
      root: path.dirname(expectedSessionArtifactRoot),
      artifact: expectedSessionArtifactRoot,
      identity: input.sessionArtifactRootIdentity,
    },
    phase,
  );
  await assertArtifactRootIdentity(
    {
      root: path.dirname(path.resolve(input.artifactRoot)),
      artifact: path.resolve(input.artifactRoot),
      identity: input.artifactRootIdentity,
    },
    `${phase}:output artifact`,
  );
}

async function assertArtifactRootIdentity(
  binding: OwnedArtifactRootBinding,
  phase: string,
): Promise<void> {
  if ((await realpath(binding.artifact)) !== binding.artifact)
    throw new Error(`Detox artifact root identity changed during ${phase}`);
  const metadata = await lstat(binding.artifact);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !sameArtifactRootIdentity(binding.identity, artifactRootIdentity(metadata))
  )
    throw new Error(`Detox artifact root identity changed during ${phase}`);
}

async function requireArtifactRoot(
  repositoryRoot: string,
  artifactRoot: string,
): Promise<OwnedArtifactRootBinding> {
  const root = await realpath(repositoryRoot);
  const artifact = await realpath(artifactRoot);
  const metadata = await lstat(artifact);
  if (
    artifact !== path.resolve(artifactRoot) ||
    artifact !== path.join(root, '.qa/artifacts/native-pilot', path.basename(artifact)) ||
    !runIdPattern.test(path.basename(artifact)) ||
    !metadata.isDirectory() ||
    (metadata.mode & 0o777) !== 0o700 ||
    (process.getuid && metadata.uid !== process.getuid())
  )
    throw new Error('Detox baseline artifact root must be a private native-pilot directory');
  return { root, artifact, identity: artifactRootIdentity(metadata) };
}

async function requireOwnedHostLock(parentEnv: Readonly<Record<string, string | undefined>>) {
  if (parentEnv.MYCHAMPIONS_NATIVE_HOST_LOCK_HELD !== '1')
    throw new Error('Detox baseline requires the shared native host-lock wrapper');
  const stateRoot = parentEnv.MYCHAMPIONS_NATIVE_STATE_ROOT;
  if (!stateRoot || !path.isAbsolute(stateRoot) || (await realpath(stateRoot)) !== stateRoot)
    throw new Error('Detox baseline host-lock state root is not canonical');
  const metadata = await lstat(stateRoot);
  if (!metadata.isDirectory() || (metadata.mode & 0o777) !== 0o700)
    throw new Error('Detox baseline host-lock state root is not private');
  const lockPath = path.join(stateRoot, 'mychampions-native-host.lock');
  const lock = await lstat(lockPath);
  if (
    !lock.isFile() ||
    (lock.mode & 0o777) !== 0o600 ||
    (process.getuid && lock.uid !== process.getuid()) ||
    (await realpath(lockPath)) !== lockPath
  )
    throw new Error('Detox baseline shared host lock is missing or not owned');
  return lockPath;
}

async function readPrivateSessionResult(
  artifactRoot: string,
  expected: { platform: DetoxBaselinePlatform; role: DetoxBaselineRole },
) {
  const file = path.join(artifactRoot, 'detox-session-result.private.json');
  if ((await realpath(file)) !== file) throw new Error('Detox session result is not canonical');
  const metadata = await lstat(file);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o777) !== 0o600 ||
    (process.getuid && metadata.uid !== process.getuid()) ||
    metadata.size > 64 * 1024
  )
    throw new Error('Detox session result is not a bounded private file');
  const result = requireSessionStepResult(JSON.parse(await readFile(file, 'utf8')));
  if (result.platform !== expected.platform || result.role !== expected.role)
    throw new Error('Detox session result actor/build binding changed');
  return result;
}

async function readPrivateSessionProgress(
  artifactRoot: string,
  expected: { platform: DetoxBaselinePlatform; role: DetoxBaselineRole },
): Promise<DetoxSessionProgress> {
  const file = path.join(artifactRoot, 'detox-session-progress.private.json');
  if ((await realpath(file)) !== file) throw new Error('Detox session progress is not canonical');
  const metadata = await lstat(file);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o777) !== 0o600 ||
    (process.getuid && metadata.uid !== process.getuid()) ||
    metadata.size > 64 * 1024
  )
    throw new Error('Detox session progress is not a bounded private file');
  const result = requireSessionProgress(JSON.parse(await readFile(file, 'utf8')));
  if (result.platform !== expected.platform || result.role !== expected.role)
    throw new Error('Detox session progress actor/build binding changed');
  return result;
}

function maybeUnrefTimer(timer: unknown): void {
  if (
    typeof timer === 'object' &&
    timer !== null &&
    'unref' in timer &&
    typeof (timer as { unref?: unknown }).unref === 'function'
  )
    (timer as { unref: () => void }).unref();
}

function createDetoxProgressMonitor(input: {
  artifactRoot: string;
  expected: { platform: DetoxBaselinePlatform; role: DetoxBaselineRole };
  proxy: OwnedProxy;
  signal?: AbortSignal;
  onEvent?: (event: DetoxSessionStepEvent) => Promise<void>;
  onCancel?: (evidence: DetoxCancelUiEvidence, requestIdFence: number) => Promise<void>;
}) {
  const checkpoints: DetoxPhaseCheckpoint[] = [];
  const seen = new Set<number>();
  let previousProgressEvents: readonly DetoxSessionStepEvent[] = [];
  let previousProgressSteps: readonly string[] = [];
  let previousCancelCheckpoint: DetoxSessionProgress['cancelCheckpoint'];
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending = Promise.resolve();
  let monitorError: unknown;
  const poll = async () => {
    if (monitorError || input.signal?.aborted) return;
    try {
      const progress = await readPrivateSessionProgress(input.artifactRoot, input.expected);
      if (progress.cancelCheckpoint) {
        requireCancelEvidenceShape(progress.cancelCheckpoint.cancelEvidence);
        if (!Number.isFinite(progress.cancelCheckpoint.monotonicMs))
          throw new Error('Detox cancel checkpoint timing is invalid');
        if (
          previousCancelCheckpoint &&
          stableJson(progress.cancelCheckpoint) !== stableJson(previousCancelCheckpoint)
        )
          throw new Error('Detox progress bridge rewrote the immutable cancel checkpoint');
      }
      if (previousCancelCheckpoint && !progress.cancelCheckpoint)
        throw new Error('Detox progress bridge removed the immutable cancel checkpoint');
      if (progress.events.length < previousProgressEvents.length)
        throw new Error('Detox progress bridge rewrote an already-published event stream');
      for (let index = 0; index < previousProgressEvents.length; index++) {
        if (stableJson(progress.events[index]) !== stableJson(previousProgressEvents[index]))
          throw new Error('Detox progress bridge rewrote an immutable event');
      }
      if (progress.completedSteps.length < previousProgressSteps.length)
        throw new Error('Detox progress bridge removed a completed step');
      for (let index = 0; index < previousProgressSteps.length; index++) {
        if (progress.completedSteps[index] !== previousProgressSteps[index])
          throw new Error('Detox progress bridge rewrote a completed step');
      }
      previousProgressEvents = progress.events.map((event) => structuredClone(event));
      previousProgressSteps = [...progress.completedSteps];
      if (progress.cancelCheckpoint && !previousCancelCheckpoint) {
        const cancelFence = input.proxy.requestIdFence;
        previousCancelCheckpoint = structuredClone(progress.cancelCheckpoint);
        pending = pending.then(() =>
          input.onCancel?.(progress.cancelCheckpoint!.cancelEvidence, cancelFence),
        );
      }
      for (const event of progress.events) {
        if (seen.has(event.ordinal)) continue;
        seen.add(event.ordinal);
        pending = pending.then(async () => {
          // Capture the transport window before asynchronous cache/auth evidence
          // can observe a later request.  The progress event is the boundary;
          // verification work must not move that boundary forward.
          const requestIdFence = input.proxy.requestIdFence;
          const previousFence = checkpoints.at(-1)?.requestIdFence ?? 0;
          const observedRequestIds = input.proxy.observations
            .filter((row) => row.requestId > previousFence && row.requestId <= requestIdFence)
            .map((row) => row.requestId);
          await input.onEvent?.(event);
          const parentMonotonicMs = performance.now();
          checkpoints.push({
            stepId: event.stepId,
            ordinal: event.ordinal,
            childMonotonicMs: event.monotonicMs,
            parentMonotonicMs,
            requestIdFence,
            observedRequestIds,
          });
        });
      }
      await pending;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') monitorError = error;
    }
  };
  return {
    start() {
      timer = setInterval(() => {
        void poll();
      }, 25);
      maybeUnrefTimer(timer);
    },
    async stop(requireComplete = true) {
      if (timer) clearInterval(timer);
      await poll();
      await pending;
      if (monitorError)
        throw monitorError instanceof Error
          ? monitorError
          : new Error('Detox progress monitor failed');
      if (requireComplete)
        requireDetoxPhaseCheckpoints({
          checkpoints,
          observations: input.proxy.observations,
        });
    },
    checkpoints,
  };
}

type DetoxBackendCleanupEvidence = Readonly<{
  status: 'available' | 'unknown';
  attempted: boolean;
  result: 'passed' | 'failed' | 'unknown';
  reason: string;
}>;

/**
 * A writer seam is not a publication receipt.  Verify the exact path after
 * every writer call so a no-op, symlink, wrong owner/mode, or altered byte
 * stream cannot leave the report claiming that terminal evidence exists.
 */
async function writeVerifiedTerminalEvidence(
  filePath: string,
  bytes: Buffer,
  writer: DetoxTerminalEvidenceWriter,
): Promise<DetoxTerminalPublicationReceipt> {
  if (!path.isAbsolute(filePath)) throw new Error('Detox terminal evidence path must be absolute');
  await writer(filePath, bytes);
  const metadata = await lstat(filePath);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o777) !== 0o600 ||
    (process.getuid && metadata.uid !== process.getuid()) ||
    (await realpath(filePath)) !== filePath
  )
    throw new Error('Detox terminal evidence is not an owned 0600 regular file');
  const actual = await readFile(filePath);
  if (!actual.equals(bytes)) throw new Error('Detox terminal evidence readback changed');
  return {
    name: path.basename(filePath),
    bytes: actual.byteLength,
    sha256: hashBytes(actual),
  };
}

function boundedTerminalFailurePayload(input: {
  artifactRoot: string;
  phase: string;
  error: unknown;
  originalFailure: { phase: string; name: string } | null;
  cleanupFailures: readonly string[];
  acquisitionIntents: readonly string[];
  acquisitionSequence: readonly string[];
  backendCleanup: DetoxBackendCleanupEvidence;
}) {
  const payload = {
    schemaVersion: 1,
    kind: 'private Detox terminal publication fallback; not a public receipt',
    phase: input.phase,
    error: safeFailure(input.phase, input.error),
    originalFailure: input.originalFailure,
    cleanupFailures: [...input.cleanupFailures],
    acquisitionIntents: [...input.acquisitionIntents],
    acquisitionSequence: [...input.acquisitionSequence],
    backendCleanup: input.backendCleanup,
    artifactRoot: input.artifactRoot,
  };
  const bytes = Buffer.from(JSON.stringify(payload, null, 2) + '\n');
  if (bytes.byteLength > 64 * 1024) throw new Error('Detox terminal fallback exceeds its bound');
  return bytes;
}

type DetoxTerminalFallbackPublication = Readonly<{
  signal: AbortSignal;
  deadlineAt: number;
  expectedRootIdentity: DetoxConnectionEvidenceDirectoryIdentity;
  beforePublish?: (input: { temporary: string; final: string }) => void | Promise<void>;
  afterPublish?: (input: { temporary: string; final: string }) => void | Promise<void>;
}>;

async function writeTerminalFallback(
  artifactRoot: string,
  name: string,
  input: Omit<Parameters<typeof boundedTerminalFailurePayload>[0], 'artifactRoot'>,
  publication: DetoxTerminalFallbackPublication,
): Promise<string | null> {
  const file = path.join(artifactRoot, name);
  try {
    const relative = path.relative(artifactRoot, path.resolve(file));
    if (
      relative === '' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      path.dirname(relative) !== '.'
    )
      throw new Error('Detox terminal fallback escaped the owned artifact root');
    const published = await writeAtomicDetoxConnectionBytes(
      artifactRoot,
      relative,
      boundedTerminalFailurePayload({ ...input, artifactRoot }),
      64 * 1024,
      {
        signal: publication.signal,
        deadlineAt: publication.deadlineAt,
        expectedRootIdentity: publication.expectedRootIdentity,
        beforePublish: publication.beforePublish,
        afterPublish: publication.afterPublish,
      },
    );
    if (published.realpath !== file)
      throw new Error('Detox terminal fallback path changed during publication');
    baselineFence(
      { signal: publication.signal, deadlineAtMonotonicMs: publication.deadlineAt },
      'Detox terminal fallback publication after',
    );
    return file;
  } catch {
    return null;
  }
}

/** Private publication control; production callers use the run-bound closure. */
export const writeTerminalFallbackForTest = writeTerminalFallback;

type DetoxLifecycleIdentityBinding = Readonly<{
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  ownerRunId: string;
  ownershipWindows: readonly NativeComparisonOwnershipWindow[];
}>;

function closeAndroidColdOwnershipWindows(
  ownership: Readonly<{
    backendProcesses: readonly Record<string, unknown>[];
    listeners: readonly Record<string, unknown>[];
  }>,
  ownerRunId: string,
  releasedAt: string,
): readonly NativeComparisonOwnershipWindow[] {
  const releasedMs = Date.parse(releasedAt);
  if (!Number.isFinite(releasedMs))
    throw new Error('Android cold cleanup release timestamp is invalid');
  const windows: NativeComparisonOwnershipWindow[] = [];
  for (const [index, process] of ownership.backendProcesses.entries()) {
    const pid = process.pid;
    const started = process.started ?? process.startedAt;
    if (!Number.isSafeInteger(pid) || (pid as number) <= 1 || typeof started !== 'string')
      throw new Error(`Android cold backend ownership process ${index} is incomplete`);
    if (!Number.isFinite(Date.parse(started)) || Date.parse(started) >= releasedMs)
      throw new Error(`Android cold backend ownership process ${index} has an invalid window`);
    const rowOwner = process.ownerRunId;
    if (rowOwner !== undefined && rowOwner !== ownerRunId)
      throw new Error(`Android cold backend ownership process ${index} has a foreign owner`);
    windows.push({
      resourceType: 'process',
      resourceId: String(pid),
      ownerRunId,
      processStartIdentity: started,
      acquiredAt: started,
      releasedAt,
    });
  }
  for (const [index, listener] of ownership.listeners.entries()) {
    const resourceId = listener.resourceId;
    const process = listener.process;
    if (
      listener.resourceType !== 'port' ||
      (typeof resourceId !== 'string' && typeof resourceId !== 'number') ||
      !process ||
      typeof process !== 'object' ||
      Array.isArray(process)
    )
      throw new Error(`Android cold ownership listener ${index} is incomplete`);
    const processRow = process as Record<string, unknown>;
    const started = processRow.started ?? processRow.startedAt;
    if (typeof started !== 'string' || !Number.isFinite(Date.parse(started)))
      throw new Error(`Android cold ownership listener ${index} has no start timestamp`);
    const rowOwner = listener.ownerRunId;
    if (rowOwner !== undefined && rowOwner !== ownerRunId)
      throw new Error(`Android cold ownership listener ${index} has a foreign owner`);
    if (Date.parse(started) >= releasedMs)
      throw new Error(`Android cold ownership listener ${index} has an invalid window`);
    windows.push({
      resourceType: 'port',
      resourceId: String(resourceId),
      ownerRunId,
      processStartIdentity: null,
      acquiredAt: started,
      releasedAt,
    });
  }
  if (!windows.some((entry) => entry.resourceType === 'process'))
    throw new Error('Android cold cleanup has no owned backend process window');
  if (!windows.some((entry) => entry.resourceType === 'port'))
    throw new Error('Android cold cleanup has no owned port window');
  const keys = windows.map((entry) => `${entry.resourceType}:${entry.resourceId}`);
  if (new Set(keys).size !== keys.length)
    throw new Error('Android cold cleanup ownership windows are duplicated');
  return windows;
}

async function writeCaptureLedger(
  artifactRoot: string,
  target: DetoxOwnedTarget | null,
  session: OwnedSession | null,
  result: DetoxBaselineReport['result'],
  execution: NativeCommandExecution | null,
  descriptor: Readonly<{
    command: string;
    argv: readonly string[];
    cwd: string;
    deadlineMs: number;
  }>,
  liveSignal: Readonly<{
    stopped: boolean;
    proxyStopped: boolean;
    cancellation: DetoxBaselineReport['cancellation'];
    cleanupFailures: readonly string[];
  }>,
  acquisitionIntents: readonly string[],
  acquisitionSequence: readonly string[],
  backendCleanup: DetoxBackendCleanupEvidence,
  writer: DetoxTerminalEvidenceWriter,
  options: Readonly<{
    phase: 'partial' | 'final';
    fileName: 'capture.private.json' | 'capture-final.private.json';
    independentCleanup: DetoxBaselineReport['cleanup']['independent'];
    cleanupFinalLedgerPublished: boolean;
    lifecycleBinding?: DetoxLifecycleIdentityBinding;
  }> = {
    phase: 'final',
    fileName: 'capture-final.private.json',
    independentCleanup: 'not-executed',
    cleanupFinalLedgerPublished: false,
  },
): Promise<DetoxTerminalPublicationReceipt> {
  const manifest = session ? record(session.manifest, 'Owned session manifest') : null;
  const captureResult =
    options.phase === 'partial' && result === 'passed' ? 'harness-blocked' : result;
  const capture = {
    kind: 'private Detox owned-session capture ledger; not a public receipt',
    fileName: options.fileName,
    phase: options.phase,
    finalized: options.phase === 'final',
    result: captureResult,
    cleanup:
      options.phase === 'partial'
        ? session
          ? result === 'cleanup-failed'
            ? 'failed-recovery-ledger-retained'
            : 'cleaned'
          : 'partial-acquisition-blocked'
        : session
          ? result === 'cleanup-failed'
            ? 'failed-recovery-ledger-retained'
            : 'cleaned'
          : 'partial-acquisition-blocked',
    independentCleanup: options.independentCleanup,
    cleanupFinalLedger:
      options.phase === 'final' && options.cleanupFinalLedgerPublished
        ? 'cleanup-final.private.json'
        : null,
    device: target ? { udid: target.deviceId } : null,
    backend: manifest
      ? {
          runId: typeof manifest.runId === 'string' ? manifest.runId : session!.manifest.runId,
          composeProject:
            typeof manifest.composeProject === 'string' ? manifest.composeProject : '',
          artifactRoot: typeof manifest.artifactRoot === 'string' ? manifest.artifactRoot : '',
          processes: Array.isArray(manifest.processes) ? manifest.processes : [],
        }
      : null,
    backendCleanup,
    command: commandExecutionSummary(execution, descriptor),
    acquisitionIntents: [...acquisitionIntents],
    acquisitionSequence: [...acquisitionSequence],
    liveSignal,
    ...(options.lifecycleBinding ?? {}),
  };
  const bytes = Buffer.from(JSON.stringify(capture, null, 2) + '\n');
  return writeVerifiedTerminalEvidence(path.join(artifactRoot, options.fileName), bytes, writer);
}

async function writeCleanupLedger(
  artifactRoot: string,
  value: unknown,
  writer: DetoxTerminalEvidenceWriter,
): Promise<DetoxTerminalPublicationReceipt> {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  return writeVerifiedTerminalEvidence(
    path.join(artifactRoot, 'cleanup-final.private.json'),
    bytes,
    writer,
  );
}

/**
 * Qualification consumers must bind a passing capture to the final report and
 * the independently verified cleanup ledger. A partial ledger is evidence of
 * work attempted, never a passing native result.
 */
export function requireDetoxFinalCaptureQualification(input: {
  capture: unknown;
  cleanupFinal: unknown;
  report: unknown;
}): void {
  const capture = record(input.capture, 'Detox capture ledger');
  if (
    capture.kind !== 'private Detox owned-session capture ledger; not a public receipt' ||
    capture.fileName !== 'capture-final.private.json' ||
    capture.phase !== 'final' ||
    capture.finalized !== true ||
    capture.result !== 'passed' ||
    capture.cleanup !== 'cleaned' ||
    capture.independentCleanup !== 'passed' ||
    capture.cleanupFinalLedger !== 'cleanup-final.private.json'
  )
    throw new Error('Detox capture is not a final independently-cleaned ledger');
  const cleanup = record(input.cleanupFinal, 'Detox cleanup-final ledger');
  const cleanupFailures = cleanup.failures;
  if (
    cleanup.kind !== 'private Detox cleanup ledger after stopped-resource drain' ||
    cleanup.finalized !== true ||
    cleanup.independent !== 'passed' ||
    !Array.isArray(cleanupFailures) ||
    cleanupFailures.length !== 0
  )
    throw new Error('Detox cleanup-final ledger is not independently clean');
  const report = record(input.report, 'Detox final report');
  const reportCleanup = record(report.cleanup, 'Detox final report cleanup');
  if (
    report.kind !== 'private-detox-integrated-session-baseline-not-public-receipt' ||
    report.result !== 'passed' ||
    report.failure !== null ||
    reportCleanup.independent !== 'passed' ||
    !Array.isArray(reportCleanup.failures) ||
    reportCleanup.failures.length !== 0
  )
    throw new Error('Detox final report is not bound to a clean passing capture');
}

function safeFailure(phase: string, error: unknown) {
  return { phase, name: error instanceof Error ? error.name : 'UnknownError' };
}

function requireNativeCommandCompleted(execution: NativeCommandExecution) {
  if (execution.execution !== 'completed' || execution.cleanup !== 'cleaned')
    throw new Error(`Detox child command did not complete cleanly: ${execution.execution}`);
  if (execution.childExitCode !== 0 || execution.childSignal !== null)
    throw new Error('Detox child command exited unsuccessfully');
}

export function classifyDetoxOperationResult(
  operationError: unknown,
  childExecution: NativeCommandExecution | null,
  cancellation: DetoxBaselineReport['cancellation'],
): Extract<
  DetoxBaselineReport['result'],
  'application-failed' | 'verification-failed' | 'harness-blocked' | 'passed'
> {
  if (!operationError) return 'passed';
  if (cancellation || !childExecution) return 'harness-blocked';
  const childResult = classifyDetoxChildExecution(childExecution);
  if (childResult === 'application-failed') return 'application-failed';
  if (childResult === 'passed') return 'verification-failed';
  return 'harness-blocked';
}

/** Runs the retained Jest/Detox session through existing owned helpers. */
export async function runDetoxIntegratedSessionBaseline(
  options: DetoxIntegratedSessionBaselineOptions,
): Promise<{ report: DetoxBaselineReport; reportPath: string }> {
  const deadlineMs = options.deadlineMs ?? 600_000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 3_600_000)
    throw new Error('Detox baseline deadline is invalid');
  const deadlineAtMonotonicMs = options.deadlineAtMonotonicMs ?? performance.now() + deadlineMs;
  if (!Number.isFinite(deadlineAtMonotonicMs) || deadlineAtMonotonicMs <= performance.now())
    throw new Error('Detox baseline absolute deadline is invalid or elapsed');
  const artifactBinding = await requireArtifactRoot(options.repositoryRoot, options.artifactRoot);
  const { root, artifact } = artifactBinding;
  const runnerPaths = await requireRunnerPaths(options.runnerPaths, root);
  requireDetoxBuildInstrumentation(options.build, root);
  if (
    options.build.platform !== options.platform ||
    options.build.configuration !== options.configuration
  )
    throw new Error('Detox build/platform selection mismatch');
  if (!allowedRoles.includes(options.role)) throw new Error('Unsupported Detox baseline role');
  if (options.role !== 'professional')
    throw new Error(
      'Detox session profile contract is declared for the seeded coach; the student actor branch remains Pending',
    );
  requireDetoxAndroidProducerBeforeAcquisition(options.platform, options.androidProducer);
  const parentEnv = options.parentEnv ?? process.env;
  assertNoIntegratedBypasses(parentEnv);
  const runController = new AbortController();
  const forwardAbort = () => {
    if (!runController.signal.aborted) runController.abort(options.signal?.reason);
  };
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener('abort', forwardAbort, { once: true });
  const deadlineTimer = setTimeout(
    () => {
      if (!runController.signal.aborted) runController.abort('deadline');
    },
    Math.max(1, Math.ceil(deadlineAtMonotonicMs - performance.now())),
  );
  maybeUnrefTimer(deadlineTimer);
  const runSignal = runController.signal;
  const phaseTimings = {
    build: 0,
    install: 0,
    reset: 0,
    scenario: 0,
    verify: 0,
    cleanup: 0,
  };
  let timedPhase: keyof typeof phaseTimings = 'build';
  let phaseStartedAt = performance.now();
  const beginTimedPhase = (next: keyof typeof phaseTimings): void => {
    const now = performance.now();
    phaseTimings[timedPhase] += now - phaseStartedAt;
    timedPhase = next;
    phaseStartedAt = now;
  };
  const measuredTimings = (): typeof phaseTimings => {
    const now = performance.now();
    return {
      ...phaseTimings,
      [timedPhase]: phaseTimings[timedPhase] + now - phaseStartedAt,
    };
  };
  let toolVersions: Record<string, string> = { node: process.version };
  const factories = options.factories ?? ownedDetoxBaselineFactories;
  const writeBoundedTerminalEvidence: DetoxTerminalEvidenceWriter = async (filePath, bytes) => {
    const relative = path.relative(artifact, path.resolve(filePath));
    if (
      relative === '' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      path.dirname(relative) !== '.'
    )
      throw new Error('Detox terminal evidence escaped the owned artifact root');
    const published = await writeAtomicDetoxConnectionBytes(
      artifact,
      relative,
      bytes,
      8 * 1024 * 1024,
      { expectedRootIdentity: artifactBinding.identity },
    );
    if (published.realpath !== path.resolve(filePath))
      throw new Error('Detox terminal evidence path changed during publication');
  };
  const writeTerminalFallbackForRun = (
    name: string,
    input: Omit<Parameters<typeof boundedTerminalFailurePayload>[0], 'artifactRoot'>,
  ): Promise<string | null> =>
    writeTerminalFallback(artifact, name, input, {
      signal: runSignal,
      deadlineAt: deadlineAtMonotonicMs,
      expectedRootIdentity: artifactBinding.identity,
    });
  const writeArtifactEvidence = (
    name: string,
    value: unknown,
    maxBytes?: number,
  ): Promise<DetoxOwnedEvidenceFile> =>
    writeOwnedJsonEvidence(artifact, name, value, maxBytes, artifactBinding.identity);
  const captureRunId = path.basename(artifact);
  let reservation: OwnedReservation | undefined;
  let session: OwnedSession | undefined;
  let sessionArtifactRoot: string | undefined;
  let sessionArtifactRootIdentity: DetoxConnectionEvidenceDirectoryIdentity | undefined;
  let proxy: OwnedProxy | undefined;
  let expo: OwnedExpo | undefined;
  let target: DetoxOwnedTarget | undefined;
  let reservationTransferred = false;
  let fixtureEvidence: DetoxBaselineFixtureEvidence | null = null;
  let coldResetEvidence: DetoxBaselineReport['coldReset'] = {
    status: options.coldReset ? 'blocked' : 'not-requested',
    requestedRunId: options.coldReset?.expectation.requestedRunId ?? null,
    requestedAttemptId: options.coldReset?.expectation.requestedAttemptId ?? null,
    ownerRunId: options.coldReset?.ownerRunId ?? null,
    receiptPath: null,
    receiptHash: null,
    target: null,
    backend: null,
    fixture: null,
    originalResetBinding: null,
    blocker: options.coldReset ? 'cold-reset-pending' : null,
  };
  let coldResetOwnership: AndroidColdResetOwnership | null = null;
  let transport: DetoxBaselineTransportEvidence | null = null;
  let snapshots: DetoxBaselineSnapshotEvidence | null = null;
  let backendRunId: string | null = null;
  let backendAttemptId: string | null = null;
  let appOrigin: string | null = null;
  let apiOrigin: string | null = null;
  let apiPid: number | null = null;
  let independentCleanup: DetoxBaselineReport['cleanup']['independent'] = 'not-executed';
  let failure: { phase: string; name: string } | null = null;
  let operationError: unknown;
  let publicationError: unknown;
  const attemptedCleanup: string[] = [];
  const cleaned: string[] = [];
  const cleanupFailures: string[] = [];
  let childExecution: NativeCommandExecution | null = null;
  let phaseCheckpoints: readonly DetoxPhaseCheckpoint[] = [];
  let authMetadata: {
    beforeRelaunch: DetoxAuthMetadata;
    afterRelaunch: DetoxAuthMetadata;
    afterSignout: DetoxAuthMetadata;
    afterSignedOutRelaunch: DetoxAuthMetadata;
  } | null = null;
  const evidenceFiles: DetoxOwnedEvidenceFile[] = [];
  let progressMonitor: ReturnType<typeof createDetoxProgressMonitor> | undefined;
  let progressMonitorStopped = false;
  let beforeSnapshot: OwnedDomainSnapshot | undefined;
  let afterSnapshot: OwnedDomainSnapshot | undefined;
  const profileSnapshots = new Map<
    (typeof nativeSessionProfileCheckpointIds)[number],
    ExactOwnedSnapshot<OwnedConnectionSnapshot>
  >();
  const domainSnapshots = new Map<
    (typeof nativeSessionProfileCheckpointIds)[number],
    ExactOwnedSnapshot<OwnedDomainSnapshot>
  >();
  const nativeSessionCacheByCheckpoint = new Map<
    DetoxSessionCacheCheckpoint,
    DetoxNativeSessionCacheObservation
  >();
  const androidStorageByPhase = new Map<
    AndroidSessionCheckpointPhase,
    AndroidSessionStorageCheckpoint
  >();
  const androidApiLifetimeByPhase = new Map<
    AndroidSessionCheckpointPhase,
    AndroidOwnedApiLifetimeProbe
  >();
  let finalTransport: DetoxFinalTransportEvidence | null = null;
  let proxyFrozen = false;
  let proxyStopped = false;
  let proxyStopAttempted = false;
  let cancelUiEvidence: DetoxCancelUiEvidence | null = null;
  const acquisitionIntents: string[] = [];
  const acquisitionSequence: string[] = [];
  let backendCleanup: DetoxBackendCleanupEvidence = {
    status: 'unknown',
    attempted: false,
    result: 'unknown',
    reason: 'Owned backend session was not acquired',
  };
  const authMetadataByStep = new Map<string, DetoxAuthMetadata>();
  let iosDataContainer: string | undefined;
  const detoxCommand = {
    command: 'yarn',
    argv: [
      'detox',
      'test',
      '-C',
      options.build.detoxConfigPath,
      '-c',
      options.configuration,
      '--headless',
      '--no-start',
      '--artifacts-location',
      path.join(artifact, 'detox-artifacts'),
      '--record-logs',
      'none',
    ] as const,
    cwd: root,
    deadlineMs,
  };
  const baseReport = (result: DetoxBaselineReport['result']): DetoxBaselineReport => ({
    schemaVersion: 5,
    kind: 'private-detox-integrated-session-baseline-not-public-receipt',
    result,
    publicNativePassingCases: 0,
    platform: options.platform,
    configuration: options.configuration,
    role: options.role,
    captureRunId,
    backendRunId,
    backendAttemptId,
    appOrigin,
    apiOrigin,
    apiPid,
    target: target ? { platform: target.platform, deviceId: target.deviceId } : null,
    fixture: fixtureEvidence,
    coldReset: coldResetEvidence,
    transport,
    sessionCache:
      nativeSessionCacheByCheckpoint.size === 5
        ? {
            afterLogin: nativeSessionCacheByCheckpoint.get('afterLogin')!,
            afterRestoration: nativeSessionCacheByCheckpoint.get('afterRestoration')!,
            afterCancel: nativeSessionCacheByCheckpoint.get('afterCancel')!,
            afterSignout: nativeSessionCacheByCheckpoint.get('afterSignout')!,
            afterSignedOutRelaunch: nativeSessionCacheByCheckpoint.get('afterSignedOutRelaunch')!,
          }
        : null,
    finalTransport,
    snapshots,
    build: options.build,
    runnerPaths,
    timingsMs: measuredTimings(),
    toolVersions,
    childExecution: commandExecutionSummary(childExecution, detoxCommand),
    cancellation: cancellationReason(runSignal),
    phaseCheckpoints,
    authMetadata,
    evidenceFiles,
    ui:
      childExecution?.execution === 'completed'
        ? {
            launchCount: 3,
            synchronizationDisabled: true,
            signInMarker: 'auth.signIn.title',
            landingMarker: landingMarker(options.role),
            assertionIds: expectedSessionStepIds,
          }
        : null,
    cleanup: {
      attempted: attemptedCleanup,
      cleaned,
      failures: cleanupFailures,
      independent: independentCleanup,
    },
    failure,
  });
  const retainStoppedTransport = async (): Promise<DetoxFinalTransportEvidence | null> => {
    if (!proxy || proxyStopAttempted) return finalTransport;
    proxyStopAttempted = true;
    try {
      const retained = await stopAndReadFinalTransport({
        proxy,
        artifactRoot: artifact,
      });
      finalTransport = retained;
      proxyStopped = true;
      proxyFrozen = true;
      if (!evidenceFiles.some((file) => file.name === path.basename(retained.file)))
        evidenceFiles.push({
          name: path.basename(retained.file),
          bytes: retained.bytes,
          sha256: retained.sha256,
        });
      return retained;
    } catch (error) {
      // A failed receipt write must still leave the generic cleanup path able
      // to retry the owned proxy stop. The attempt itself remains recorded by
      // the caller as a cleanup failure.
      proxyStopAttempted = false;
      throw error;
    }
  };
  try {
    runSignal.throwIfAborted();
    const detoxPackage = JSON.parse(
      await readFile(path.join(root, 'node_modules/detox/package.json'), 'utf8'),
    ) as Record<string, unknown>;
    if (
      typeof detoxPackage.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(detoxPackage.version)
    )
      throw new Error('Installed Detox package version is unavailable');
    toolVersions = { ...toolVersions, detox: detoxPackage.version };
    await requireOwnedHostLock(parentEnv);
    await factories.requireNativeHostAvailability(artifact);
    runSignal?.throwIfAborted();
    await factories.inspectDetoxBuildInstrumentation({
      repositoryRoot: root,
      build: options.build,
    });
    runSignal?.throwIfAborted();
    if (options.platform === 'ios') await factories.capturePreviousIosDevices(artifact, runSignal);
    beginTimedPhase('install');
    acquisitionIntents.push('app-port');
    reservation = await factories.reserveOwnedAppPort(options.build.metroPort);
    acquisitionSequence.push('app-port');
    appOrigin = requireIntegratedLoopbackOrigin(reservation.origin);
    acquisitionIntents.push('target');
    target = await (
      options.platform === 'android' && options.androidProducer
        ? options.androidProducer.acquireOwnedTarget
        : factories.acquireOwnedTarget
    )({
      platform: options.platform,
      artifactRoot: artifact,
      signal: runSignal,
      deadlineAtMonotonicMs,
      artifactRootIdentity: artifactBinding.identity,
    });
    acquisitionSequence.push('target');
    if (
      target.platform !== options.platform ||
      !target.deviceId ||
      target.ownership.artifactRoot !== artifact ||
      target.ownership.hostLockRequired !== true ||
      target.ownership.cleanupAuthorized !== true
    )
      throw new Error('Detox target is not an owned host-locked cleanup-authorized target');
    await target.verify();
    if (options.platform === 'ios')
      await factories.verifyIosSimulatorApp(options.build.binaryPath, artifact);
    acquisitionIntents.push('backend');
    session = await factories.startOwnedSession({
      serverRoot: options.serverRoot,
      appOrigin,
      signal: runSignal,
      deadlineMs,
    });
    const observedSessionArtifactRoot = path.resolve(session.manifest.artifactRoot);
    const sessionRootMetadata = await lstat(observedSessionArtifactRoot);
    const observedSessionArtifactRootIdentity = artifactRootIdentity(sessionRootMetadata);
    await assertArtifactRootIdentity(
      {
        root: path.dirname(observedSessionArtifactRoot),
        artifact: observedSessionArtifactRoot,
        identity: observedSessionArtifactRootIdentity,
      },
      'session manifest acquisition',
    );
    sessionArtifactRoot = observedSessionArtifactRoot;
    sessionArtifactRootIdentity = observedSessionArtifactRootIdentity;
    acquisitionSequence.push('backend');
    backendCleanup = {
      status: 'available',
      attempted: false,
      result: 'unknown',
      reason: 'Owned backend session manifest acquired; backend cleanup not yet attempted',
    };
    backendRunId = session.manifest.runId;
    backendAttemptId = `${session.manifest.runId}:first`;
    apiOrigin = requireIntegratedLoopbackOrigin(session.apiOrigin);
    apiPid = session.apiPid;
    acquisitionIntents.push('proxy');
    proxy = await factories.startOwnedApiProxy({
      session,
      appOrigin,
      requestProfile: 'native',
    });
    acquisitionSequence.push('proxy');
    if (proxy.origin === appOrigin) throw new Error('Detox proxy and app origins must differ');
    if (proxy.origin !== options.build.embeddedRuntime.apiOrigin)
      throw new Error('Qualified native runtime network origin differs from owned proxy origin');
    if (options.platform === 'android')
      await factories.verifyAndroidBuild({
        build: options.build,
        artifactRoot: artifact,
        apiOrigin: proxy.origin,
        signal: runSignal,
        deadlineAtMonotonicMs,
      });
    beginTimedPhase('reset');
    const fixtures = await session.fixtures(`native-entry-${options.platform}`);
    const fixture = requireFixture(fixtures, options.platform, options.role);
    fixtureEvidence = fixture.evidence;
    const fixtureAuthUidAllowlistHash = hashJson([...fixture.evidence.fixtureAuthUids].sort());
    proxy.enableNativeAuthIdentityCapture(fixture.evidence.fixtureAuthUids);
    const snapshotScope = `native-entry-${options.platform}`;
    const androidStorageBinding = (
      api: Awaited<ReturnType<OwnedSession['probeApiLifetime']>>,
    ): DetoxAndroidSessionStorageBinding => ({
      runId: fixtures.runId,
      scope: 'native-entry-android',
      apiOrigin: api.apiOrigin,
      apiPid: api.apiPid,
      backendAttemptId: api.backendAttemptId,
      manifestSha256: api.manifestSha256,
      fixtureAuthUidAllowlistHash,
      waitForQuiescence: async () => {
        await proxy!.waitForQuiescence();
      },
    });
    if (options.coldReset) {
      if (options.platform !== 'android')
        throw new Error('Android cold reset request cannot run on an iOS baseline');
      const androidTarget = target as DetoxOwnedTarget & {
        platform: 'android';
        androidTargetRunId?: string;
        androidOsVersion?: string;
        androidSessionStorage?: DetoxAndroidSessionStorageTarget;
      };
      const storage = androidTarget.androidSessionStorage;
      if (!storage || !androidTarget.androidTargetRunId || !androidTarget.androidOsVersion)
        throw new Error('Android session target did not expose its acquired owner identity');
      const proxyProcess = await inspectProcessIdentity(process.pid);
      if (!proxyProcess)
        throw new Error('Android session proxy control process identity is unavailable');
      const resetStartedAt = new Date().toISOString();
      const preparation = await prepareT15AndroidSessionColdReset({
        artifactRoot: artifact,
        captureRunId,
        ownerRunId: options.coldReset.ownerRunId,
        target: {
          ...androidTarget,
          androidSessionStorage: storage,
        },
        appId: options.build.appIdentifier,
        binaryPath: options.build.binaryPath,
        binaryHash: options.build.binaryHash,
        buildProfile: options.configuration,
        metroPort: options.build.metroPort,
        apiOrigin: proxy.origin,
        binding: androidStorageBinding(await session.probeApiLifetime(runSignal)),
        expectation: options.coldReset.expectation,
        deadlineMs: Math.min(
          600_000,
          Math.max(100, Math.floor(deadlineAtMonotonicMs - performance.now())),
        ),
        signal: runSignal,
      });
      const reset = await produceAndroidColdReset({
        expectation: options.coldReset.expectation,
        outputRoot: artifact,
        captureRunId,
        ownerRunId: options.coldReset.ownerRunId,
        deadlineAtMonotonicMs,
        resetStartedAt,
        target: {
          identity: { serial: storage.serial },
          osVersion: androidTarget.androidOsVersion,
          runId: androidTarget.androidTargetRunId,
          verify: async () => {
            runSignal.throwIfAborted();
            await androidTarget.verify(runSignal);
          },
          androidSessionStorage: storage,
        },
        session: {
          manifest: session.manifest,
          apiOrigin: session.apiOrigin,
          apiPid: session.apiPid,
          probeApiLifetime: (signal) => session!.probeApiLifetime(signal),
          snapshotWithEvidence: (scope, signal) => session!.snapshotWithEvidence(scope, signal),
        },
        proxy: {
          runId: proxy.runId,
          origin: proxy.origin,
          waitForQuiescence: (deadlineMs, signal) => proxy!.waitForQuiescence(deadlineMs, signal),
        },
        proxyProcess: {
          pid: proxyProcess.pid,
          started: proxyProcess.started,
          script: proxyProcess.command,
        },
        fixtures: {
          ...(fixtures as unknown as Record<string, unknown>),
          resetId: options.coldReset.expectation.fixtureResetId,
        } as Record<string, unknown> & { runId: string; scope: string; resetId: string },
        build: {
          appId: options.build.appIdentifier,
          buildProfile: options.configuration,
          binaryHash: options.build.binaryHash,
          apiOrigin: proxy.origin,
        },
        installedApk: preparation.installedApk,
        commandExecutions: preparation.commandExecutions,
        signal: runSignal,
      });
      coldResetOwnership = reset.ownership;
      coldResetEvidence = {
        status: 'fresh',
        requestedRunId: reset.requestedRunId,
        requestedAttemptId: reset.requestedAttemptId,
        ownerRunId: reset.ownerRunId,
        receiptPath: reset.receiptPath,
        receiptHash: reset.receiptHash,
        target: reset.target,
        backend: reset.backend,
        fixture: reset.fixture,
        originalResetBinding: reset.originalResetBinding,
        blocker: null,
      };
      evidenceFiles.push({
        name: path.basename(reset.receiptPath),
        bytes: reset.identity.size,
        sha256: reset.receiptHash,
      });
    }
    const captureCheckpoint = async (
      checkpoint: (typeof nativeSessionProfileCheckpointIds)[number],
    ) => {
      const androidApiBefore =
        options.platform === 'android' ? await session!.probeApiLifetime(runSignal) : null;
      const profile = await captureExactOwnedSnapshot({
        session: session!,
        scope: snapshotScope,
        prefix: 'connection-snapshot',
        artifactRoot: artifact,
        stagedName: `detox-profile-${checkpoint}.private.json`,
        read: () => session!.connectionSnapshot(snapshotScope),
        validate: (value) =>
          requireConnectionSnapshot(value, {
            runId: fixtures.runId,
            scope: fixtures.scope,
            fixtureAuthUids: fixture.evidence.fixtureAuthUids,
            target: {
              professionalAuthUid: fixtures.accounts.coach.authUid,
              studentAuthUid: fixtures.accounts.student.authUid,
              specialty: 'fitness_coach',
            },
          }),
        signal: runSignal,
        deadlineAtMonotonicMs,
        sessionArtifactRoot: sessionArtifactRoot!,
        sessionArtifactRootIdentity: sessionArtifactRootIdentity!,
        artifactRootIdentity: artifactBinding.identity,
      });
      const domain = await captureExactOwnedSnapshot({
        session: session!,
        scope: snapshotScope,
        prefix: 'snapshot',
        artifactRoot: artifact,
        stagedName:
          checkpoint === 'beforeLogin'
            ? 'detox-domain-before.private.json'
            : `detox-domain-${checkpoint.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())}.private.json`,
        read: () => session!.snapshot(snapshotScope),
        validate: (value) =>
          requireSnapshot(value, {
            runId: fixtures.runId,
            scope: fixtures.scope,
          }),
        signal: runSignal,
        deadlineAtMonotonicMs,
        sessionArtifactRoot: sessionArtifactRoot!,
        sessionArtifactRootIdentity: sessionArtifactRootIdentity!,
        artifactRootIdentity: artifactBinding.identity,
      });
      const androidApiAfter =
        options.platform === 'android' ? await session!.probeApiLifetime(runSignal) : null;
      const androidApi =
        options.platform === 'android'
          ? requireAndroidOwnedApiLifetimeBinding({
              before: {
                ...androidApiBefore!,
                proxyRunId: proxy!.runId,
                proxyOrigin: proxy!.origin,
              },
              after: {
                ...androidApiAfter!,
                proxyRunId: proxy!.runId,
                proxyOrigin: proxy!.origin,
              },
              expectedRunId: fixtures.runId,
              expectedProxyRunId: proxy!.runId,
              expectedProxyOrigin: proxy!.origin,
            })
          : null;
      if (androidApi) {
        const phase: AndroidSessionCheckpointPhase =
          checkpoint === 'beforeLogin'
            ? 'before-login'
            : checkpoint === 'afterLogin'
              ? 'after-login'
              : checkpoint === 'afterRestoration'
                ? 'after-restoration'
                : 'after-signed-out-relaunch';
        androidApiLifetimeByPhase.set(phase, androidApi);
        if (phase === 'before-login') {
          const readStorage = factories.readAndroidSessionStorageCheckpoint
            ? factories.readAndroidSessionStorageCheckpoint
            : defaultReadAndroidSessionStorageCheckpoint;
          const storageApiBefore = await session!.probeApiLifetime(runSignal);
          const beforeLoginStorage = await readStorage({
            checkpoint: 'afterSignout',
            artifactRoot: artifact,
            target: target!,
            actorAuthUid: undefined,
            binding: androidStorageBinding(storageApiBefore),
            phase,
            signal: runSignal,
          });
          const storageApiAfter = await session!.probeApiLifetime(runSignal);
          const storageApi = requireAndroidOwnedApiLifetimeBinding({
            before: {
              ...storageApiBefore,
              proxyRunId: proxy!.runId,
              proxyOrigin: proxy!.origin,
            },
            after: {
              ...storageApiAfter,
              proxyRunId: proxy!.runId,
              proxyOrigin: proxy!.origin,
            },
            expectedRunId: fixtures.runId,
            expectedProxyRunId: proxy!.runId,
            expectedProxyOrigin: proxy!.origin,
          });
          if (
            storageApi.apiOrigin !== androidApi.apiOrigin ||
            storageApi.apiPid !== androidApi.apiPid ||
            storageApi.backendAttemptId !== androidApi.backendAttemptId ||
            storageApi.manifestSha256 !== androidApi.manifestSha256
          )
            throw new Error('Android before-login storage changed owned API identity');
          androidStorageByPhase.set(phase, beforeLoginStorage);
          androidApiLifetimeByPhase.set(phase, storageApi);
        }
      }
      profileSnapshots.set(checkpoint, profile);
      domainSnapshots.set(checkpoint, domain);
      evidenceFiles.push(
        {
          name: path.basename(profile.stagedFile),
          bytes: profile.sourceBytes,
          sha256: profile.sourceSha256,
        },
        {
          name: path.basename(domain.stagedFile),
          bytes: domain.sourceBytes,
          sha256: domain.sourceSha256,
        },
      );
      if (checkpoint === 'beforeLogin') beforeSnapshot = domain.value;
      if (checkpoint === 'afterSignedOutRelaunch') afterSnapshot = domain.value;
    };
    await captureCheckpoint('beforeLogin');
    acquisitionIntents.push('expo');
    expo = await factories.startOwnedExpo({
      clientRoot: root,
      artifactRoot: artifact,
      reservation,
      apiOrigin: proxy.origin,
      parentEnv,
      signal: runSignal,
      deadlineMs,
      surface: 'native',
    });
    acquisitionSequence.push('expo');
    reservationTransferred = true;
    runSignal?.throwIfAborted();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...parentEnv,
      DETOX_IOS_SIMULATOR_UDID: options.platform === 'ios' ? target.deviceId : undefined,
      DETOX_ANDROID_DEVICE: options.platform === 'android' ? target.deviceId : undefined,
      DETOX_METRO_PORT: String(options.build.metroPort),
      DETOX_BASELINE_ENTRY_PATH: runnerPaths.entryPath,
      DETOX_JEST_CONFIG: runnerPaths.jestConfigPath,
      DETOX_BASELINE_TEST_PATH: runnerPaths.testPath,
      DETOX_BASELINE_ARTIFACT_ROOT: artifact,
      DETOX_BASELINE_PLATFORM: options.platform,
      DETOX_BASELINE_ROLE: options.role,
      DETOX_BASELINE_AUTH_UID: fixture.actor.authUid,
      DETOX_BASELINE_EMAIL: fixture.actor.email,
      DETOX_BASELINE_PASSWORD: fixture.actor.password,
    };
    const resolveDataContainer =
      factories.resolveIosDataContainer ?? defaultResolveIosDataContainer;
    const observeSessionCache = async (checkpoint: DetoxSessionCacheCheckpoint) => {
      runSignal.throwIfAborted();
      const expectedStatus: 'session-present' | 'session-absent' =
        checkpoint === 'afterLogin' ||
        checkpoint === 'afterRestoration' ||
        checkpoint === 'afterCancel'
          ? 'session-present'
          : 'session-absent';
      if (options.platform === 'ios') {
        iosDataContainer ??= await resolveDataContainer({
          deviceId: target!.deviceId,
          bundleId: options.build.appIdentifier,
          signal: runSignal,
        });
      }
      let observed: DetoxNativeSessionCacheObservation;
      if (factories.observeNativeSessionCache) {
        observed = await factories.observeNativeSessionCache({
          platform: options.platform,
          checkpoint,
          actorAuthUid: fixture.actor.authUid,
          artifactRoot: artifact,
          dataRoot: iosDataContainer,
        });
      } else if (options.platform === 'ios') {
        observed = await observeIosSessionCache({
          dataRoot: iosDataContainer!,
          checkpoint,
        });
      } else {
        const apiBefore = await session!.probeApiLifetime(runSignal);
        const phase: DetoxAndroidSessionStoragePhase | undefined =
          checkpoint === 'afterLogin'
            ? 'after-login'
            : checkpoint === 'afterRestoration'
              ? 'after-restoration'
              : checkpoint === 'afterSignedOutRelaunch'
                ? 'after-signed-out-relaunch'
                : undefined;
        const binding = androidStorageBinding(apiBefore);
        const readStorage = factories.readAndroidSessionStorageCheckpoint
          ? factories.readAndroidSessionStorageCheckpoint
          : defaultReadAndroidSessionStorageCheckpoint;
        const checkpointFile = await readStorage({
          checkpoint,
          artifactRoot: artifact,
          target: target!,
          actorAuthUid: expectedStatus === 'session-present' ? fixture.actor.authUid : undefined,
          binding,
          phase,
          signal: runSignal,
        });
        const apiAfter = await session!.probeApiLifetime(runSignal);
        const apiLifetime = requireAndroidOwnedApiLifetimeBinding({
          before: {
            ...apiBefore,
            proxyRunId: proxy!.runId,
            proxyOrigin: proxy!.origin,
          },
          after: {
            ...apiAfter,
            proxyRunId: proxy!.runId,
            proxyOrigin: proxy!.origin,
          },
          expectedRunId: fixtures.runId,
          expectedProxyRunId: proxy!.runId,
          expectedProxyOrigin: proxy!.origin,
        });
        if (
          apiLifetime.apiOrigin !== binding.apiOrigin ||
          apiLifetime.apiPid !== binding.apiPid ||
          apiLifetime.backendAttemptId !== binding.backendAttemptId ||
          apiLifetime.manifestSha256 !== binding.manifestSha256
        )
          throw new Error('Android storage checkpoint changed owned API identity');
        if (phase) {
          androidStorageByPhase.set(phase, checkpointFile);
          androidApiLifetimeByPhase.set(phase, apiLifetime);
        }
        observed = projectAndroidSessionCacheCheckpoint(
          checkpointFile,
          checkpoint,
          expectedStatus === 'session-present' ? fixture.actor.authUid : undefined,
        );
      }
      const verified = requireDetoxNativeSessionCache(observed, {
        checkpoint,
        status: expectedStatus,
        actorAuthUid: expectedStatus === 'session-present' ? fixture.actor.authUid : undefined,
        sourceKind:
          options.platform === 'ios' ? 'ios-rct-async-storage' : 'android-rkstorage-sqlite',
      });
      nativeSessionCacheByCheckpoint.set(checkpoint, verified);
      return verified;
    };
    const observeIosAuthMetadataForCache = async (
      cache: DetoxNativeSessionCacheObservation,
    ): Promise<DetoxAuthMetadata> => {
      if (options.platform !== 'ios' || !iosDataContainer)
        throw new Error('Detox iOS auth metadata requires the owned data container');
      const reader = factories.observeIosAuthMetadata ?? observeIosAuthMetadata;
      const metadata = await reader(iosDataContainer, options.build.appIdentifier, runSignal);
      return requireDetoxIosAuthMetadataBinding(metadata, cache);
    };
    progressMonitor = createDetoxProgressMonitor({
      artifactRoot: artifact,
      expected: { platform: options.platform, role: options.role },
      proxy,
      signal: runSignal,
      onCancel: async (evidence, requestIdFence) => {
        cancelUiEvidence = evidence;
        const files = await verifyDetoxCancelUiEvidence(artifact, evidence);
        evidenceFiles.push(...files);
        const afterCancel = await observeSessionCache('afterCancel');
        const afterRestoration = nativeSessionCacheByCheckpoint.get('afterRestoration');
        if (!afterRestoration)
          throw new Error('Cancel boundary arrived before restoration cache proof');
        requireAfterCancelCacheIdentity({
          afterRestoration,
          afterCancel,
          actorAuthUid: fixture.actor.authUid,
        });
        if (requestIdFence !== proxy!.requestIdFence)
          throw new Error('Cancel cache proof crossed a started-request fence');
      },
      onEvent: async (event) => {
        await target!.verify();
        const checkpoint =
          event.stepId === 'NAT-session-login'
            ? 'afterLogin'
            : event.stepId === 'NAT-session-restore'
              ? 'afterRestoration'
              : event.stepId === 'NAT-session-signout'
                ? 'afterSignout'
                : event.stepId === 'NAT-session-signed-out-relaunch'
                  ? 'afterSignedOutRelaunch'
                  : undefined;
        if (checkpoint) {
          const cache = await observeSessionCache(checkpoint);
          if (options.platform === 'ios')
            authMetadataByStep.set(event.stepId, await observeIosAuthMetadataForCache(cache));
        }
        if (event.stepId === 'NAT-session-login') await captureCheckpoint('afterLogin');
        if (event.stepId === 'NAT-session-restore') await captureCheckpoint('afterRestoration');
        if (event.stepId === 'NAT-session-signed-out-relaunch')
          await captureCheckpoint('afterSignedOutRelaunch');
      },
    });
    progressMonitor.start();
    beginTimedPhase('scenario');
    acquisitionIntents.push('detox');
    childExecution = await factories.executeOwnedNativeCommand({
      command: detoxCommand.command,
      argv: [...detoxCommand.argv],
      artifactRoot: artifact,
      label: 'detox-integrated-session',
      cwd: root,
      env,
      deadlineMs,
      phase: 'step',
      signal: runSignal,
    });
    acquisitionSequence.push('detox');
    await progressMonitor.stop(childExecution.execution === 'completed');
    beginTimedPhase('verify');
    progressMonitorStopped = true;
    phaseCheckpoints = progressMonitor.checkpoints;
    if (childExecution.execution === 'completed') {
      finalTransport = await retainStoppedTransport();
      if (!finalTransport) throw new Error('Detox final transport stream was not retained');
      requireDetoxPhaseCheckpoints({
        checkpoints: phaseCheckpoints,
        observations: finalTransport.observations,
        finalRequestIdFence: finalTransport.requestIdFence,
      });
      requireClosedStartedRequestWindows({
        checkpoints: phaseCheckpoints,
        observations: finalTransport.observations,
        finalRequestIdFence: finalTransport.requestIdFence,
      });
      requireDetoxTerminalPhaseWindow({
        checkpoints: phaseCheckpoints,
        observations: finalTransport.observations,
        finalRequestIdFence: finalTransport.requestIdFence,
      });
    }
    evidenceFiles.push(
      await writeArtifactEvidence('detox-phase-checkpoints.private.json', phaseCheckpoints),
    );
    requireNativeCommandCompleted(childExecution);
    runSignal?.throwIfAborted();
    const steps = await readPrivateSessionResult(artifact, {
      platform: options.platform,
      role: options.role,
    });
    evidenceFiles.push(
      readOwnedJsonEvidenceReceipt(artifact, 'detox-session-result.private.json'),
      readOwnedJsonEvidenceReceipt(artifact, 'detox-session-progress.private.json'),
    );
    if (steps.events.length !== expectedUiSessionStepIds.length)
      throw new Error('Detox session did not complete all UI assertions');
    const eventCancelEvidence = steps.events[3]?.cancelEvidence;
    requireCancelEvidenceShape(eventCancelEvidence);
    if (!cancelUiEvidence || stableJson(cancelUiEvidence) !== stableJson(eventCancelEvidence))
      throw new Error('Detox cancel UI evidence was not published at the cancel boundary');
    if (options.platform === 'ios') {
      const beforeRelaunch = authMetadataByStep.get('NAT-session-login');
      const afterRelaunch = authMetadataByStep.get('NAT-session-restore');
      const afterSignout = authMetadataByStep.get('NAT-session-signout');
      const afterSignedOutRelaunch = authMetadataByStep.get('NAT-session-signed-out-relaunch');
      if (!beforeRelaunch || !afterRelaunch || !afterSignout || !afterSignedOutRelaunch)
        throw new Error('Detox session auth metadata checkpoints are incomplete');
      authMetadata = {
        beforeRelaunch,
        afterRelaunch,
        afterSignout,
        afterSignedOutRelaunch,
      };
      evidenceFiles.push(
        await writeArtifactEvidence('detox-auth-metadata.private.json', authMetadata),
      );
    }
    runSignal?.throwIfAborted();
    const missingProfiles = nativeSessionProfileCheckpointIds.filter(
      (checkpoint) => !profileSnapshots.has(checkpoint),
    );
    const missingDomains = nativeSessionProfileCheckpointIds.filter(
      (checkpoint) => !domainSnapshots.has(checkpoint),
    );
    if (missingProfiles.length || missingDomains.length)
      throw new Error('Detox session did not produce all four SQL checkpoints');
    if (!proxyFrozen) throw new Error('Detox proxy was not frozen before verification');
    const profiles = Object.fromEntries(
      nativeSessionProfileCheckpointIds.map((checkpoint) => [
        checkpoint,
        profileSnapshots.get(checkpoint)!.value,
      ]),
    ) as NativeSessionProfileCheckpointInput['profiles'];
    const domains = Object.fromEntries(
      nativeSessionProfileCheckpointIds.map((checkpoint) => [
        checkpoint,
        domainSnapshots.get(checkpoint)!.value,
      ]),
    ) as NativeSessionProfileCheckpointInput['domain'];
    const final = finalTransport;
    if (!final || !proxyStopped)
      throw new Error('Detox final transport stream was not sealed before verification');
    const checkpointAt = (index: number) => phaseCheckpoints[index]?.requestIdFence ?? 0;
    requireSignedOutSessionTransport({
      observations: final.observations,
      window: {
        afterRequestId: checkpointAt(3),
        throughRequestId: final.requestIdFence,
      },
      expectedTargetOrigin: session.apiOrigin,
    });
    transport = requireDetoxTransportEvidence({
      observations: final.observations,
      identities: final.identities,
      actorAuthUid: fixture.actor.authUid,
      apiOrigin: session.apiOrigin,
      apiPid: session.apiPid,
      fixtureAuthUids: fixture.evidence.fixtureAuthUids,
    });
    const afterLogin = nativeSessionCacheByCheckpoint.get('afterLogin');
    const afterRestoration = nativeSessionCacheByCheckpoint.get('afterRestoration');
    const afterCancel = nativeSessionCacheByCheckpoint.get('afterCancel');
    const afterSignout = nativeSessionCacheByCheckpoint.get('afterSignout');
    const afterSignedOutRelaunch = nativeSessionCacheByCheckpoint.get('afterSignedOutRelaunch');
    if (
      !afterLogin ||
      !afterRestoration ||
      !afterCancel ||
      !afterSignout ||
      !afterSignedOutRelaunch
    )
      throw new Error('Detox native session cache checkpoints are incomplete');
    requireAfterCancelCacheIdentity({
      afterRestoration,
      afterCancel,
      actorAuthUid: fixture.actor.authUid,
    });
    if (
      afterSignout.status !== 'session-absent' ||
      afterSignedOutRelaunch.status !== 'session-absent'
    )
      throw new Error('Detox signed-out cache checkpoints retain a native session');
    const actorHash = createHash('sha256').update(fixture.actor.authUid).digest('hex');
    if (
      afterLogin.profileAuthUidHash !== actorHash ||
      afterRestoration.profileAuthUidHash !== actorHash
    )
      throw new Error(
        'Detox native cache profile identity does not match the selected coach/student actor',
      );
    verifyNativeSessionProfileCheckpoints({
      platform: options.platform,
      backendRunId: fixtures.runId,
      fixtureAuthUids: fixture.evidence.fixtureAuthUids,
      coachAuthUid: fixtures.accounts.coach.authUid,
      studentAuthUid: fixtures.accounts.student.authUid,
      expectedApiIdentity: {
        apiPid: session.apiPid,
        targetOrigin: session.apiOrigin,
      },
      profiles,
      domain: domains,
      observations: final.observations,
      authIdentities: final.identities,
      loginWindow: { afterRequestId: 0, throughRequestId: checkpointAt(0) },
      restorationWindow: {
        afterRequestId: checkpointAt(0),
        throughRequestId: checkpointAt(1),
      },
      persistedCoachIdentity: {
        afterLoginAuthUidHash: afterLogin.profileAuthUidHash,
        afterRestorationAuthUidHash: afterRestoration.profileAuthUidHash,
      },
    });
    if (options.platform === 'android') {
      const phases: readonly AndroidSessionCheckpointPhase[] = [
        'before-login',
        'after-login',
        'after-restoration',
        'after-signed-out-relaunch',
      ];
      const checkpoints: AndroidSessionCheckpointReceipt[] = phases.map((phase) => {
        const checkpointId =
          phase === 'before-login'
            ? 'beforeLogin'
            : phase === 'after-login'
              ? 'afterLogin'
              : phase === 'after-restoration'
                ? 'afterRestoration'
                : 'afterSignedOutRelaunch';
        const profile = profileSnapshots.get(checkpointId)!;
        const domain = domainSnapshots.get(checkpointId)!;
        const api = androidApiLifetimeByPhase.get(phase);
        if (!api) throw new Error(`Android ${phase} API lifetime evidence is missing`);
        const sourceReceipt = (snapshot: ExactOwnedSnapshot<unknown>) => ({
          path: snapshot.sourceFile,
          sizeBytes: snapshot.sourceBytes,
          sha256: snapshot.sourceSha256,
          ownerUid: process.getuid?.() ?? 0,
          mode: 0o600,
          verification: 'owned-runtime-document-v6' as const,
        });
        return {
          phase,
          runId: fixtures.runId,
          scope: fixtures.scope,
          apiOrigin: api.apiOrigin,
          apiPid: api.apiPid,
          backendAttemptId: api.backendAttemptId,
          manifestSha256: api.manifestSha256,
          fixtureAuthUidAllowlistHash,
          profile: sourceReceipt(profile),
          domain: sourceReceipt(domain),
        };
      });
      const verifiedCheckpoints = requireAndroidSessionCheckpointSet({
        checkpoints,
        expectedRunId: fixtures.runId,
        expectedScope: fixtures.scope,
        expectedApiOrigin: session.apiOrigin,
        expectedApiPid: session.apiPid,
        expectedBackendAttemptId: (() => {
          if (!backendAttemptId) throw new Error('Android backend attempt identity is missing');
          return backendAttemptId;
        })(),
        expectedManifestSha256: androidApiLifetimeByPhase.get('before-login')!.manifestSha256,
        expectedFixtureAuthUidAllowlistHash: fixtureAuthUidAllowlistHash,
      });
      const beforeDomain = domainSnapshots.get('beforeLogin')!.value;
      const afterDomain = domainSnapshots.get('afterSignedOutRelaunch')!.value;
      const beforeStorage = androidStorageByPhase.get('before-login');
      const afterStorage = androidStorageByPhase.get('after-signed-out-relaunch');
      if (!beforeStorage || !afterStorage)
        throw new Error('Android session storage phase mapping is incomplete');
      const verifiedDomain = requireAndroidSessionDomainBinding({
        before: beforeDomain,
        after: afterDomain,
        beforeStorage,
        afterStorage,
      });
      evidenceFiles.push(
        await writeArtifactEvidence('detox-android-session-checkpoints.private.json', {
          schemaVersion: 1,
          kind: 'private-detox-android-session-checkpoints',
          mapping: {
            beforeLogin: 'before-login',
            afterLogin: 'after-login',
            afterRestoration: 'after-restoration',
            afterCancel: 'retained-observation-only',
            afterSignout: 'retained-observation-only',
            afterSignedOutRelaunch: 'after-signed-out-relaunch',
          },
          checkpoints: verifiedCheckpoints,
          domainBinding: verifiedDomain,
        }),
      );
    }
    afterSnapshot = domainSnapshots.get('afterSignedOutRelaunch')!.value;
    evidenceFiles.push(
      await writeArtifactEvidence('detox-session-cache-observations.private.json', {
        checkpoints: {
          afterLogin,
          afterRestoration,
          afterCancel,
          afterSignout,
          afterSignedOutRelaunch,
        },
        actorAuthUidHash: actorHash,
      }),
    );
    snapshots = {
      runId: fixtures.runId,
      scope: fixtures.scope,
      checkpointIds: [...nativeSessionProfileCheckpointIds],
      checkpoints: nativeSessionProfileCheckpointIds.map((checkpoint) => {
        const profile = profileSnapshots.get(checkpoint)!;
        const domain = domainSnapshots.get(checkpoint)!;
        return {
          checkpointId: checkpoint,
          profileFile: path.basename(profile.stagedFile),
          profileSourceFile: profile.sourceFile,
          profileSha256: profile.sourceSha256,
          domainFile: path.basename(domain.stagedFile),
          domainSourceFile: domain.sourceFile,
          domainSha256: domain.sourceSha256,
          profileBytes: profile.sourceBytes,
          domainBytes: domain.sourceBytes,
        };
      }),
      beforeHash: profileSnapshots.get('beforeLogin')!.sourceSha256,
      afterHash: profileSnapshots.get('afterSignedOutRelaunch')!.sourceSha256,
      beforeTrainingPlanCount: beforeSnapshot!.trainingPlans.length,
      afterTrainingPlanCount: afterSnapshot.trainingPlans.length,
      beforeConnectionCount: beforeSnapshot!.connections.length,
      afterConnectionCount: afterSnapshot.connections.length,
      domainRowsUnchanged: true,
      beforeFile: path.basename(domainSnapshots.get('beforeLogin')!.stagedFile),
      afterFile: path.basename(domainSnapshots.get('afterSignedOutRelaunch')!.stagedFile),
      beforeFileSha256: domainSnapshots.get('beforeLogin')!.sourceSha256,
      afterFileSha256: domainSnapshots.get('afterSignedOutRelaunch')!.sourceSha256,
    };
  } catch (error) {
    operationError = error;
    failure = safeFailure(
      childExecution?.execution === 'completed' ? 'verification' : 'execution',
      error,
    );
  } finally {
    beginTimedPhase('cleanup');
    const stop = async (name: string, action: (() => Promise<unknown>) | undefined) => {
      if (!action) return;
      attemptedCleanup.push(name);
      try {
        await action();
        cleaned.push(name);
      } catch (error) {
        cleanupFailures.push(name);
        failure ??= safeFailure(`cleanup:${name}`, error);
      }
    };
    await stop(
      'detox-progress-monitor',
      progressMonitor && !progressMonitorStopped ? () => progressMonitor!.stop(false) : undefined,
    );
    await stop('expo', expo ? () => expo!.stop() : undefined);
    if (proxy && !proxyStopAttempted) {
      try {
        await retainStoppedTransport();
      } catch (error) {
        cleanupFailures.push('proxy-final-transport');
        failure ??= safeFailure('cleanup:proxy-final-transport', error);
      }
    }
    await stop(
      'proxy',
      proxy && !proxyStopAttempted
        ? async () => {
            await proxy!.stop();
            proxyStopped = true;
          }
        : undefined,
    );
    await stop('backend', session ? () => session!.stop() : undefined);
    await stop('target', target ? () => target!.stop() : undefined);
    if (!reservationTransferred)
      await stop('app-port', reservation ? () => reservation!.release() : undefined);
    if (session) {
      const backendStopFailed = cleanupFailures.includes('backend');
      backendCleanup = {
        status: 'available',
        attempted: true,
        result: backendStopFailed ? 'failed' : cleaned.includes('backend') ? 'passed' : 'unknown',
        reason: backendStopFailed
          ? 'Owned backend stop failed; backend cleanup remains unresolved'
          : cleaned.includes('backend')
            ? 'Owned backend stop completed'
            : 'Owned backend stop was attempted without a completion record',
      };
    }
    if (target || session || acquisitionIntents.length > 0) {
      const preliminaryResult: DetoxBaselineReport['result'] = cleanupFailures.length
        ? 'cleanup-failed'
        : operationError
          ? classifyDetoxOperationResult(
              operationError,
              childExecution,
              cancellationReason(runSignal),
            )
          : 'passed';
      let cleanupFinalLedgerPublished = false;
      const originalFailureBeforeCapture = failure;
      try {
        const receipt = await writeCaptureLedger(
          artifact,
          target ?? null,
          session ?? null,
          preliminaryResult,
          childExecution,
          detoxCommand,
          {
            stopped: true,
            proxyStopped,
            cancellation: cancellationReason(runSignal),
            cleanupFailures: [...cleanupFailures],
          },
          acquisitionIntents,
          acquisitionSequence,
          backendCleanup,
          factories.writeTerminalEvidence ?? writeBoundedTerminalEvidence,
          {
            phase: 'partial',
            fileName: 'capture.private.json',
            independentCleanup,
            cleanupFinalLedgerPublished: false,
          },
        );
        evidenceFiles.push(receipt);
      } catch (error) {
        publicationError ??= error;
        cleanupFailures.push('capture-ledger');
        failure ??= safeFailure('publication:capture-ledger', error);
        await writeTerminalFallbackForRun('detox-capture-partial-fallback.private.json', {
          phase: 'publication:capture-ledger',
          error,
          originalFailure: originalFailureBeforeCapture,
          cleanupFailures,
          acquisitionIntents,
          acquisitionSequence,
          backendCleanup,
        });
      }
      if (target && session) {
        try {
          if (options.platform === 'ios') {
            const cleanup = await factories.verifyOwnedIosCleanup({
              repositoryRoot: root,
              artifactRoot: artifact,
            });
            independentCleanup = cleanup.result === 'passed' ? 'passed' : 'failed';
            if (cleanup.result !== 'passed') cleanupFailures.push('independent-cleanup');
          } else if (options.androidProducer) {
            const cleanup = await options.androidProducer.verifyOwnedAndroidCleanup({
              repositoryRoot: root,
              artifactRoot: artifact,
              target,
              signal: runSignal,
              deadlineAtMonotonicMs,
            });
            const cleanupRecord = record(cleanup, 'Android Detox cleanup result');
            independentCleanup = cleanupRecord.result === 'passed' ? 'passed' : 'failed';
            if (independentCleanup !== 'passed') cleanupFailures.push('independent-cleanup');
          } else {
            independentCleanup = 'not-executed';
            cleanupFailures.push('android-native-engine-pending');
            failure ??= safeFailure(
              'cleanup:independent-cleanup',
              new Error('Android native engine producer is missing before cleanup'),
            );
          }
        } catch (error) {
          independentCleanup = 'failed';
          cleanupFailures.push('independent-cleanup');
          failure ??= safeFailure('cleanup:independent-cleanup', error);
        }
      }
      let lifecycleBinding: DetoxLifecycleIdentityBinding | undefined;
      if (coldResetOwnership) {
        try {
          const ownerRunId = coldResetEvidence.ownerRunId;
          if (!ownerRunId) throw new Error('Android cold cleanup owner identity is missing');
          const releasedAt = new Date().toISOString();
          lifecycleBinding = {
            requestedRunId: coldResetEvidence.requestedRunId ?? '',
            requestedAttemptId: coldResetEvidence.requestedAttemptId ?? '',
            captureRunId,
            ownerRunId,
            ownershipWindows: closeAndroidColdOwnershipWindows(
              coldResetOwnership,
              ownerRunId,
              releasedAt,
            ),
          };
        } catch (error) {
          cleanupFailures.push('ownership-windows');
          failure ??= safeFailure('cleanup:ownership-windows', error);
        }
      }
      const cleanupLedger = {
        kind: 'private Detox cleanup ledger after stopped-resource drain',
        finalized: true,
        stopped: true,
        proxyStopped,
        attempted: attemptedCleanup,
        cleaned,
        failures: cleanupFailures,
        independent: independentCleanup,
        cancellation: cancellationReason(runSignal),
        acquisitionIntents,
        acquisitionSequence,
        backendCleanup,
        ...(lifecycleBinding ?? {}),
      };
      const originalFailureBeforeCleanupLedger = failure;
      try {
        const receipt = await writeCleanupLedger(
          artifact,
          cleanupLedger,
          factories.writeTerminalEvidence ?? writeBoundedTerminalEvidence,
        );
        evidenceFiles.push(receipt);
        cleanupFinalLedgerPublished = true;
      } catch (error) {
        publicationError ??= error;
        cleanupFailures.push('cleanup-final-ledger');
        failure ??= safeFailure('publication:cleanup-final-ledger', error);
        await writeTerminalFallbackForRun('detox-cleanup-fallback.private.json', {
          phase: 'publication:cleanup-final-ledger',
          error,
          originalFailure: originalFailureBeforeCleanupLedger,
          cleanupFailures,
          acquisitionIntents,
          acquisitionSequence,
          backendCleanup,
        });
      }
      const finalCaptureResult: DetoxBaselineReport['result'] = cleanupFailures.length
        ? 'cleanup-failed'
        : operationError
          ? classifyDetoxOperationResult(
              operationError,
              childExecution,
              cancellationReason(runSignal),
            )
          : independentCleanup !== 'passed'
            ? 'cleanup-failed'
            : 'passed';
      const originalFailureBeforeFinalCapture = failure;
      try {
        const receipt = await writeCaptureLedger(
          artifact,
          target ?? null,
          session ?? null,
          finalCaptureResult,
          childExecution,
          detoxCommand,
          {
            stopped: true,
            proxyStopped,
            cancellation: cancellationReason(runSignal),
            cleanupFailures: [...cleanupFailures],
          },
          acquisitionIntents,
          acquisitionSequence,
          backendCleanup,
          factories.writeTerminalEvidence ?? writeBoundedTerminalEvidence,
          {
            phase: 'final',
            fileName: 'capture-final.private.json',
            independentCleanup,
            cleanupFinalLedgerPublished,
            lifecycleBinding,
          },
        );
        evidenceFiles.push(receipt);
      } catch (error) {
        publicationError ??= error;
        cleanupFailures.push('capture-final-ledger');
        failure ??= safeFailure('publication:capture-final-ledger', error);
        await writeTerminalFallbackForRun('detox-capture-fallback.private.json', {
          phase: 'publication:capture-final-ledger',
          error,
          originalFailure: originalFailureBeforeFinalCapture,
          cleanupFailures,
          acquisitionIntents,
          acquisitionSequence,
          backendCleanup,
        });
      }
    }
    clearTimeout(deadlineTimer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
  const result: DetoxBaselineReport['result'] = cleanupFailures.length
    ? 'cleanup-failed'
    : operationError
      ? classifyDetoxOperationResult(operationError, childExecution, cancellationReason(runSignal))
      : independentCleanup !== 'passed'
        ? 'cleanup-failed'
        : 'passed';
  let report = baseReport(result);
  const reportPath = path.join(artifact, 'detox-integrated-session-baseline.private.json');
  const originalFailureBeforeReport = failure;
  try {
    const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
    const published = await writeAtomicDetoxConnectionBytes(
      artifact,
      path.basename(reportPath),
      reportBytes,
      8 * 1024 * 1024,
      {
        signal: runSignal,
        deadlineAt: deadlineAtMonotonicMs,
        expectedRootIdentity: artifactBinding.identity,
      },
    );
    if (published.realpath !== reportPath)
      throw new Error('Detox baseline report path changed during publication');
    baselineFence(
      { signal: runSignal, deadlineAtMonotonicMs },
      'Detox baseline report publication after',
    );
  } catch (error) {
    publicationError ??= error;
    failure ??= safeFailure('publication:report', error);
    report = baseReport('cleanup-failed');
    await writeTerminalFallbackForRun('detox-report-fallback.private.json', {
      phase: 'publication:report',
      error,
      originalFailure: originalFailureBeforeReport,
      cleanupFailures,
      acquisitionIntents,
      acquisitionSequence,
      backendCleanup,
    });
  }
  if (operationError || cleanupFailures.length || result !== 'passed' || publicationError)
    throw new DetoxIntegratedSessionBaselineError(
      result === 'cleanup-failed'
        ? 'Detox integrated baseline cleanup failed'
        : 'Detox integrated baseline execution failed',
      report,
      operationError ?? publicationError,
    );
  return { report, reportPath };
}

export { expectedSessionStepIds };
