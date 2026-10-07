import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  acquireDetoxConnectionArtifactRoot,
  type DetoxConnectionArtifactRootLease,
} from './detox-connection-artifact-root';
import {
  readOwnedDetoxConnectionEvidence,
  writeAtomicDetoxConnectionBytes,
} from './detox-connection-evidence';
import { requireDetoxConnectionSelection } from './detox-integrated-connection-baseline';
import {
  detoxSessionHelperClosure,
  requireDetoxBuildInstrumentation,
  type DetoxQualifiedBuildReuse,
  type DetoxBaselineBuildInstrumentation,
} from './detox-integrated-session-baseline';
import {
  readActualDetoxRuntimeMetadata,
  requireDetoxRuntimeBuildMetadata,
  type DetoxRuntimeBuildMetadata,
} from './detox-runtime-build-metadata';
import { sourceIdentity } from './native-build-identity';
import { loadReusableIosBuild } from './native-build-reuse';
import {
  delegateIosDetoxConnectionAsSingleOwner,
  DETOX_IOS_CONNECTION_PUBLIC_OWNER,
  type DetoxIosConnectionDriverDelegate,
  type DetoxIosConnectionPublicBridgeInput,
  type DetoxIosConnectionPublicBridgeResult,
} from './native-detox-connection-public-bridge';
import { produceDetoxRuntimeFactsFromActualProducer } from './native-detox-connection-runtime-producer';
import {
  boundedDetoxBridgeDeadlineMs,
  createDetoxDispatchLifecycle,
  createDetoxDispatchLifecycleAt,
  detoxDispatchFence,
  type DetoxDispatchClock,
  type DetoxDispatchLifecycle,
  type DetoxQualifiedBuildReadHooks,
} from './native-detox-dispatch-lifecycle';
import {
  readNativeEvidenceObservation,
  readNativeEvidenceObservationForTest,
  type NativeEvidenceIdentity,
  type NativeEvidenceObservation,
} from './native-view-evidence';
import type { DetoxIosConnectionRuntimeFacts } from './native-detox-connection-runtime-verification';
import type { NativePilotSelection } from './native-pilot-contract';

export const IOS_DETOX_CONNECTION_PUBLIC_DISPATCH = 'ios-detox-connection' as const;
export const DETOX_CONNECTION_PUBLIC_DISPATCH_STATUS = 'source-only' as const;

/**
 * Every source/config/runner input consumed by the iOS Detox dispatch path.
 * This is intentionally distinct from detoxSessionHelperClosure: the latter is
 * the reusable build baseline, while this closure covers the complete dispatch
 * module graph and its declared native-pilot inputs.
 */
export const detoxDispatchRuntimeClosure = [
  'docs/qa/native-pilot/inventory.json',
  'localization/en-US.ts',
  'scripts/ci/android-runner-slot.ts',
  'scripts/testing/android-build-identity.ts',
  'scripts/testing/android-native-input-reader.ts',
  'scripts/testing/android-session-charter.ts',
  'scripts/testing/capture-android-testability.ts',
  'scripts/testing/capture-native-testability.ts',
  'scripts/testing/detox-connection-artifact-root.ts',
  'scripts/testing/detox-android-session-storage-producer.ts',
  'scripts/testing/detox-connection-actionability.ts',
  'scripts/testing/detox-connection-evidence.ts',
  'scripts/testing/detox-connection-result-writer.ts',
  'scripts/testing/detox-runtime-build-metadata.ts',
  'scripts/testing/detox-connection-ancestor-safe.py',
  'scripts/testing/detox-connection-ipc.ts',
  'scripts/testing/detox-connection-lifecycle.ts',
  'scripts/testing/detox-integrated-connection-baseline.ts',
  'scripts/testing/detox-integrated-connection-driver.ts',
  'scripts/testing/detox-integrated-session-baseline.ts',
  'scripts/testing/detox-save-retry-child-client.ts',
  'scripts/testing/detox-save-retry-child-protocol.mjs',
  'scripts/testing/detox-save-retry-driver.ts',
  'scripts/testing/detox-save-retry-owned-dispatch.ts',
  'scripts/testing/detox-save-retry-runtime-finalizer.ts',
  'scripts/testing/detox-native-hierarchy.ts',
  'scripts/testing/detox-session-cache-observation.ts',
  'scripts/testing/detox-session-cancel-evidence.ts',
  'scripts/testing/detox-session-final-transport.ts',
  'scripts/testing/detox-training-child-client.ts',
  'scripts/testing/detox-training-child-protocol.mjs',
  'scripts/testing/detox-training-journey.ts',
  'scripts/testing/detox-training-owned-dispatch.ts',
  'scripts/testing/integration-preflight.ts',
  'scripts/testing/ios-credential-entry-diagnostic.ts',
  'scripts/testing/ios-credential-entry-owned-seam.ts',
  'scripts/testing/ios-locale-capture-wiring.ts',
  'scripts/testing/ios-locale-quiescence.ts',
  'scripts/testing/ios-locale-runtime-adapter.ts',
  'scripts/testing/ios-locale-storage.ts',
  'scripts/testing/locale-context-validator.ts',
  'scripts/testing/locale-native-observation.ts',
  'scripts/testing/native-android-driver-diagnostics.ts',
  'scripts/testing/native-android-driver-startup-sampling.ts',
  'scripts/testing/native-android-session-adapter.ts',
  'scripts/testing/native-android-session-checkpoint-copy.ts',
  'scripts/testing/native-android-session-public-contract.ts',
  'scripts/testing/native-android-session-public-dependency.ts',
  'scripts/testing/native-auth-observation.ts',
  'scripts/testing/native-build-identity.ts',
  'scripts/testing/native-build-reuse.ts',
  'scripts/testing/native-camera-android-capture-adapter.ts',
  'scripts/testing/native-camera-android-contract.ts',
  'scripts/testing/native-camera-android-observation.ts',
  'scripts/testing/native-camera-android-producer.ts',
  'scripts/testing/native-camera-android-runtime-locale.ts',
  'scripts/testing/native-camera-android-sql-source.ts',
  'scripts/testing/native-camera-observation.ts',
  'scripts/testing/native-cleanup-evidence.ts',
  'scripts/testing/native-connection-attempt-binding.ts',
  'scripts/testing/native-connection-checkpoints.ts',
  'scripts/testing/native-connection-hierarchy-android.ts',
  'scripts/testing/native-connection-hierarchy.ts',
  'scripts/testing/native-connection-journey-core.ts',
  'scripts/testing/native-connection-journey.ts',
  'scripts/testing/native-connection-observation.ts',
  'scripts/testing/native-connection-password-offer-witness.ts',
  'scripts/testing/native-connection-platform-contract.ts',
  'scripts/testing/native-connection-public-evidence-core.ts',
  'scripts/testing/native-connection-snapshot.ts',
  'scripts/testing/native-detox-connection-public-bridge.ts',
  'scripts/testing/native-connection-public-evidence.ts',
  'scripts/testing/native-detox-connection-public-staging.ts',
  'scripts/testing/native-detox-connection-runtime-dispatch.ts',
  'scripts/testing/native-detox-connection-runtime-producer.ts',
  'scripts/testing/native-detox-connection-runtime-verification.ts',
  'scripts/testing/native-detox-connection-public-dispatch.ts',
  'scripts/testing/native-hierarchy.ts',
  'scripts/testing/native-host-contention.ts',
  'scripts/testing/native-locale-capture-seam.ts',
  'scripts/testing/native-locale-file-observation.ts',
  'scripts/testing/native-maestro-assertion-failure.ts',
  'scripts/testing/native-pilot-contract.ts',
  'scripts/testing/native-pilot-invocation.ts',
  'scripts/testing/native-runtime-preflight.ts',
  'scripts/testing/native-save-retry-observation.ts',
  'scripts/testing/native-session-helper-ledger.ts',
  'scripts/testing/native-session-profile-checkpoints.ts',
  'scripts/testing/native-training-attempt-binding.ts',
  'scripts/testing/native-training-attempt-outcome.ts',
  'scripts/testing/native-training-discard-observation.ts',
  'scripts/testing/native-training-edit-observation.ts',
  'scripts/testing/native-training-journey.ts',
  'scripts/testing/native-training-load-observation.ts',
  'scripts/testing/native-training-maestro-driver.ts',
  'scripts/testing/native-training-observation.ts',
  'scripts/testing/native-training-pilot-evidence.ts',
  'scripts/testing/native-training-quantity-contract.ts',
  'scripts/testing/t15-cold-ios-reset-producer.ts',
  'scripts/testing/testing-repository-identity.ts',
  'scripts/testing/native-view-evidence.ts',
  'scripts/testing/owned-adb-server.ts',
  'scripts/testing/owned-android-emulator.ts',
  'scripts/testing/owned-android-port.ts',
  'scripts/testing/owned-api-proxy.ts',
  'scripts/testing/owned-expo.ts',
  'scripts/testing/owned-ios-simulator-app.ts',
  'scripts/testing/owned-ios-simulator.ts',
  'scripts/testing/owned-native-command.ts',
  'scripts/testing/owned-process-group.ts',
  'scripts/testing/owned-session.ts',
  'scripts/testing/schema-validation.ts',
  'scripts/testing/validate-native-inventory.mjs',
  'scripts/testing/verify-owned-android-cleanup.ts',
  'scripts/testing/verify-owned-ios-cleanup.ts',
] as const;

/**
 * The native pilot consumes this exact result shape so the outer terminal
 * receipt can preserve the bridge's real attempt facts. No field here makes a
 * public pass: all values are projected from the accepted bridge result and
 * the passing count remains zero.
 */
export type DetoxNativePilotAttemptResult = Readonly<{
  kind: 'private-owned-ios-detox-connection-attempt-not-public-receipt';
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
    phase: 'cleanup' | 'verification' | 'adapter-write';
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
  /** Private hand-off values for the engine-aware staging branch only. */
  detoxBridgeResult: DetoxIosConnectionPublicBridgeResult;
  dispatchRuntimeInputPaths: readonly string[];
  dispatchRuntimeInputsHash: string;
  detoxBuild: DetoxDispatchQualifiedBuild;
  /** Producer-owned runtime facts; null keeps the current source-only path. */
  detoxRuntimeFacts: DetoxIosConnectionRuntimeFacts | null;
}>;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function helperInputsDigest(paths: readonly string[], contents: readonly Buffer[]): string {
  const digest = createHash('sha256').update('detox-integrated-helper-inputs-v2\0');
  for (const pair of paths
    .map((relative, index) => ({ relative, content: contents[index] }))
    .sort((left, right) => left.relative.localeCompare(right.relative)))
    digest.update(pair.relative).update('\0').update(pair.content);
  return digest.digest('hex');
}

export type DetoxDispatchQualifiedBuild = DetoxBaselineBuildInstrumentation &
  Readonly<{
    dispatchRuntimeInputPaths: readonly string[];
    dispatchRuntimeInputIdentities: readonly NativeEvidenceIdentity[];
    dispatchRuntimeInputsHash: string;
  }>;

/** A build loaded by the real Detox dispatch path with actual runtime metadata. */
export type DetoxRuntimeQualifiedBuild = DetoxDispatchQualifiedBuild & DetoxRuntimeBuildMetadata;

/**
 * Keep the runtime closure manifest exact. A helper may not silently omit a
 * driver, bridge, capture, or native-view module and still publish a fresh
 * dispatch identity.
 */
export function requireDetoxDispatchRuntimeClosure(
  paths: readonly string[] = detoxDispatchRuntimeClosure,
): readonly string[] {
  const expected = [...detoxDispatchRuntimeClosure].sort();
  const actual = [...paths];
  assert.equal(new Set(actual).size, actual.length, 'Detox dispatch closure contains duplicates');
  assert(
    actual.every(
      (relative) =>
        typeof relative === 'string' &&
        relative.length > 0 &&
        !path.isAbsolute(relative) &&
        !relative.includes('..') &&
        relative.trim() === relative,
    ),
    'Detox dispatch closure contains an unsafe relative path',
  );
  assert.deepEqual(
    [...actual].sort(),
    expected,
    'Detox dispatch runtime closure is not manifest-complete',
  );
  return paths;
}

export function detoxDispatchRuntimeInputsDigest(
  paths: readonly string[],
  contents: readonly Buffer[],
): string {
  requireDetoxDispatchRuntimeClosure(paths);
  assert.equal(paths.length, contents.length, 'Detox dispatch closure contents are incomplete');
  const digest = createHash('sha256').update('detox-ios-dispatch-runtime-inputs-v1\0');
  for (const pair of paths
    .map((relative, index) => ({ relative, content: contents[index] }))
    .sort((left, right) => left.relative.localeCompare(right.relative))) {
    digest
      .update(String(pair.relative.length))
      .update(':')
      .update(pair.relative)
      .update(String(pair.content.byteLength))
      .update(':')
      .update(pair.content);
  }
  return digest.digest('hex');
}

const DETOX_BUILD_INPUT_MAX_BYTES = 8 * 1024 * 1024;
const DETOX_PARTIAL_ATTEMPT_MAX_BYTES = 8 * 1024 * 1024;

export {
  boundedDetoxBridgeDeadlineMs,
  createDetoxDispatchLifecycle,
  createDetoxDispatchLifecycleAt,
  detoxDispatchFence,
  remainingDetoxDispatchBudget,
  type DetoxDispatchClock,
  type DetoxDispatchLifecycle,
  type DetoxQualifiedBuildReadHooks,
} from './native-detox-dispatch-lifecycle';

function safePostCaptureFailure(
  error: unknown,
  phase: 'verification',
): {
  phase: 'verification';
  name: string;
  message: string;
} {
  return {
    phase,
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function cleanupDetoxArtifactRootBeforeDriver(
  lease: DetoxConnectionArtifactRootLease,
  cause: unknown,
  lifecycle: DetoxDispatchLifecycle,
): Promise<Error | null> {
  try {
    const cleanup = await lease.cleanupBeforeDriver({
      reason: 'Detox public dispatch preflight failed',
      signal: lifecycle.signal,
      deadlineAt: lifecycle.deadlineAtMonotonicMs,
    });
    const recovery = await lease.retainRecoveryEvidence(
      cleanup,
      'Detox public dispatch preflight failed',
      {
        signal: lifecycle.signal,
        deadlineAt: lifecycle.deadlineAtMonotonicMs,
      },
    );
    return new Error(
      `Detox artifact-root preflight cleanup is ${cleanup.status}${
        recovery
          ? `; recovery retained at ${recovery.path} (${recovery.sha256})`
          : '; recovery publication unavailable'
      }`,
      { cause },
    );
  } catch (error) {
    return new Error('Detox artifact-root preflight cleanup could not be classified', {
      cause: error,
    });
  }
}

/**
 * Read a qualified source/config input through the shared descriptor-backed
 * reader. The reader binds dev/ino/uid/gid/mode/nlink/size/mtime/ctime before
 * and after the bounded read, so a same-sized replacement cannot be accepted
 * merely because its length is unchanged.
 */
export function readDetoxQualifiedBuildInput(
  repositoryRoot: string,
  relative: string,
  maxBytes = DETOX_BUILD_INPUT_MAX_BYTES,
): NativeEvidenceObservation {
  const observation = readNativeEvidenceObservation(
    repositoryRoot,
    relative,
    false,
    'owned-source',
  );
  assert(
    observation.bytes.byteLength <= maxBytes,
    `Detox build input is larger than ${maxBytes} bytes`,
  );
  return observation;
}

/** Resource-free race seam used by the private same-size replacement control. */
export function readDetoxQualifiedBuildInputForTest(
  repositoryRoot: string,
  relative: string,
  hooks: DetoxQualifiedBuildReadHooks,
  maxBytes = DETOX_BUILD_INPUT_MAX_BYTES,
): NativeEvidenceObservation {
  const observation = readNativeEvidenceObservationForTest(
    repositoryRoot,
    relative,
    false,
    hooks,
    'owned-source',
  );
  assert(
    observation.bytes.byteLength <= maxBytes,
    `Detox build input is larger than ${maxBytes} bytes`,
  );
  return observation;
}

function optionalBuildFence(
  input: Readonly<{
    signal?: AbortSignal;
    deadlineAtMonotonicMs?: number;
    now?: DetoxDispatchClock;
  }>,
  phase: string,
): void {
  if (!input.signal || input.deadlineAtMonotonicMs === undefined) return;
  detoxDispatchFence(
    {
      signal: input.signal,
      deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
      now: input.now ?? (() => performance.now()),
    },
    phase,
  );
}

/**
 * Reconstructs the existing qualified iOS Debug build descriptor from the
 * sealed byte-reuse record. It performs only bounded source/build reads; the
 * accepted Detox bridge remains the sole target/session/proxy/child owner.
 */
export async function loadIosDetoxQualifiedBuild(
  input: Readonly<{
    repositoryRoot: string;
    buildRunId: string;
    reuseBuildSourceRoot?: string;
    signal?: AbortSignal;
    deadlineAtMonotonicMs?: number;
    now?: DetoxDispatchClock;
  }>,
): Promise<DetoxRuntimeQualifiedBuild> {
  const repositoryRoot = await realpath(path.resolve(input.repositoryRoot));
  requireDetoxDispatchRuntimeClosure();
  optionalBuildFence(input, 'qualified build start');
  const currentSource = await sourceIdentity(repositoryRoot);
  optionalBuildFence(input, 'qualified source identity');
  const reuseBuildSourceRoot =
    input.reuseBuildSourceRoot ??
    (typeof process.env.MYCHAMPIONS_NATIVE_BUILD_CACHE_ROOT === 'string'
      ? process.env.MYCHAMPIONS_NATIVE_BUILD_CACHE_ROOT
      : undefined);
  if (
    reuseBuildSourceRoot !== undefined &&
    (!path.isAbsolute(reuseBuildSourceRoot) || reuseBuildSourceRoot.includes('\0'))
  )
    throw new Error('Detox reusable build source root must be an absolute path');
  const reusable = await loadReusableIosBuild(repositoryRoot, input.buildRunId, currentSource, {
    sourceRoot: reuseBuildSourceRoot,
  });
  assert(reusable.binaryIdentity, 'Qualified reusable iOS build identity is missing');
  optionalBuildFence(input, 'reusable build read');
  const helperInputPaths = [...detoxSessionHelperClosure];
  const helperObservations = helperInputPaths.map((relative) => {
    optionalBuildFence(input, `helper input ${relative}:before`);
    const observation = readDetoxQualifiedBuildInput(repositoryRoot, relative);
    optionalBuildFence(input, `helper input ${relative}:after`);
    return observation;
  });
  const detoxConfigPath = path.join(repositoryRoot, '.detoxrc.js');
  const configSourcePath = path.join(repositoryRoot, 'app.config.ts');
  optionalBuildFence(input, 'Detox config read:before');
  const detoxConfigObservation = readDetoxQualifiedBuildInput(repositoryRoot, '.detoxrc.js');
  optionalBuildFence(input, 'Detox config read:after');
  const configSourceObservation = readDetoxQualifiedBuildInput(repositoryRoot, 'app.config.ts');
  optionalBuildFence(input, 'runtime config read');
  const dispatchRuntimeInputPaths = [...detoxDispatchRuntimeClosure];
  const dispatchRuntimeObservations = dispatchRuntimeInputPaths.map((relative) => {
    optionalBuildFence(input, `dispatch runtime input ${relative}:before`);
    const observation = readDetoxQualifiedBuildInput(repositoryRoot, relative);
    optionalBuildFence(input, `dispatch runtime input ${relative}:after`);
    return observation;
  });
  const dispatchRuntimeInputsHash = detoxDispatchRuntimeInputsDigest(
    dispatchRuntimeInputPaths,
    dispatchRuntimeObservations.map((observation) => observation.bytes),
  );
  const sourceAfterReads = await sourceIdentity(repositoryRoot);
  assert.deepEqual(
    sourceAfterReads,
    currentSource,
    'Detox source identity changed during qualified build input reads',
  );
  const helperContents = helperObservations.map((observation) => observation.bytes);
  const detoxConfigBytes = detoxConfigObservation.bytes;
  const configSourceBytes = configSourceObservation.bytes;
  optionalBuildFence(input, 'Detox engine metadata read:before');
  const runtimeMetadata = await readActualDetoxRuntimeMetadata(
    repositoryRoot,
    reusable.environmentHash,
    () => optionalBuildFence(input, 'Detox engine metadata read'),
  );
  optionalBuildFence(input, 'Detox engine metadata read:after');
  const build: DetoxDispatchQualifiedBuild = {
    ...runtimeMetadata,
    platform: 'ios',
    configuration: 'ios.sim.debug',
    binaryPath: reusable.binaryPath,
    binaryHash: reusable.binaryHash,
    ...runtimeMetadata,
    testBinaryPath: null,
    testBinaryHash: null,
    source: currentSource,
    helperInputPaths,
    helperInputsHash: helperInputsDigest(helperInputPaths, helperContents),
    detoxConfigPath,
    detoxConfigHash: hashBytes(detoxConfigBytes),
    metroPort: reusable.metroPort,
    appIdentifier: reusable.bundleId,
    embeddedRuntime: {
      variant: 'dev',
      appIdentifier: reusable.bundleId,
      apiOrigin: reusable.apiOrigin,
      configSourcePath,
      configSourceHash: hashBytes(configSourceBytes),
    },
    binaryReuse: {
      kind: 'qualified-ios-build-reuse',
      runId: reusable.sourceRunId,
      binaryPath: reusable.binaryPath,
      binaryHash: reusable.binaryHash,
      binaryIdentity: reusable.binaryIdentity,
      checkedInBinaryPath: path.join(
        repositoryRoot,
        'ios/build/Build/Products/Debug-iphonesimulator/mychampions.app',
      ),
    } satisfies DetoxQualifiedBuildReuse,
    dispatchRuntimeInputPaths,
    dispatchRuntimeInputIdentities: dispatchRuntimeObservations.map(
      (observation) => observation.identity,
    ),
    dispatchRuntimeInputsHash,
  };
  optionalBuildFence(input, 'qualified build validation');
  const validated = requireDetoxBuildInstrumentation(build, repositoryRoot);
  requireDetoxRuntimeBuildMetadata(validated, 'Qualified Detox runtime metadata');
  optionalBuildFence(input, 'qualified build identity reread');
  const helperAfter = helperInputPaths.map((relative) => {
    optionalBuildFence(input, `helper input reread ${relative}:before`);
    const observation = readDetoxQualifiedBuildInput(repositoryRoot, relative);
    optionalBuildFence(input, `helper input reread ${relative}:after`);
    return observation;
  });
  helperObservations.forEach((before, index) => {
    const after = helperAfter[index];
    assert(after, `Detox helper input reread is missing: ${helperInputPaths[index]}`);
    assert.deepEqual(
      after.identity,
      before.identity,
      `Detox helper input identity changed: ${helperInputPaths[index]}`,
    );
    assert.equal(
      hashBytes(after.bytes),
      hashBytes(before.bytes),
      `Detox helper input bytes changed: ${helperInputPaths[index]}`,
    );
  });
  optionalBuildFence(input, 'Detox config reread:before');
  const detoxConfigAfter = readDetoxQualifiedBuildInput(repositoryRoot, '.detoxrc.js');
  optionalBuildFence(input, 'Detox config reread:after');
  const configSourceAfter = readDetoxQualifiedBuildInput(repositoryRoot, 'app.config.ts');
  optionalBuildFence(input, 'runtime config reread');
  assert.deepEqual(detoxConfigAfter.identity, detoxConfigObservation.identity);
  assert.deepEqual(configSourceAfter.identity, configSourceObservation.identity);
  assert.equal(hashBytes(detoxConfigAfter.bytes), hashBytes(detoxConfigObservation.bytes));
  assert.equal(hashBytes(configSourceAfter.bytes), hashBytes(configSourceObservation.bytes));
  const dispatchRuntimeAfter = dispatchRuntimeInputPaths.map((relative) => {
    optionalBuildFence(input, `dispatch runtime reread ${relative}:before`);
    const observation = readDetoxQualifiedBuildInput(repositoryRoot, relative);
    optionalBuildFence(input, `dispatch runtime reread ${relative}:after`);
    return observation;
  });
  dispatchRuntimeObservations.forEach((before, index) => {
    const after = dispatchRuntimeAfter[index];
    assert(
      after,
      `Detox dispatch runtime input reread is missing: ${dispatchRuntimeInputPaths[index]}`,
    );
    assert.deepEqual(
      after.identity,
      before.identity,
      `Detox dispatch runtime input identity changed: ${dispatchRuntimeInputPaths[index]}`,
    );
    assert.equal(
      hashBytes(after.bytes),
      hashBytes(before.bytes),
      `Detox dispatch runtime input bytes changed: ${dispatchRuntimeInputPaths[index]}`,
    );
  });
  assert.equal(
    detoxDispatchRuntimeInputsDigest(
      dispatchRuntimeInputPaths,
      dispatchRuntimeAfter.map((observation) => observation.bytes),
    ),
    dispatchRuntimeInputsHash,
    'Detox dispatch runtime input digest changed after qualification',
  );
  const dispatchRuntimeInputIdentities = dispatchRuntimeAfter.map(
    (observation) => observation.identity,
  );
  assert.equal(
    dispatchRuntimeInputIdentities.length,
    dispatchRuntimeInputPaths.length,
    'Detox dispatch runtime input identities are incomplete after qualification',
  );
  return {
    ...validated,
    dispatchRuntimeInputPaths,
    dispatchRuntimeInputIdentities,
    dispatchRuntimeInputsHash,
  };
}

export function revalidateDetoxDispatchRuntimeClosure(
  repositoryRoot: string,
  build: Pick<
    DetoxDispatchQualifiedBuild,
    'dispatchRuntimeInputPaths' | 'dispatchRuntimeInputIdentities' | 'dispatchRuntimeInputsHash'
  >,
  lifecycle: DetoxDispatchLifecycle,
): void {
  const paths = requireDetoxDispatchRuntimeClosure(build.dispatchRuntimeInputPaths);
  assert.equal(
    build.dispatchRuntimeInputIdentities.length,
    paths.length,
    'Detox dispatch runtime closure identities are incomplete',
  );
  const observations = paths.map((relative, index) => {
    detoxDispatchFence(lifecycle, `dispatch runtime closure reread ${relative}:before`);
    const observation = readDetoxQualifiedBuildInput(repositoryRoot, relative);
    detoxDispatchFence(lifecycle, `dispatch runtime closure reread ${relative}:after`);
    assert.deepEqual(
      observation.identity,
      build.dispatchRuntimeInputIdentities[index],
      `Detox dispatch runtime input identity changed after the bridge returned: ${relative}`,
    );
    return observation;
  });
  detoxDispatchFence(lifecycle, 'dispatch runtime closure post-read');
  const currentHash = detoxDispatchRuntimeInputsDigest(
    paths,
    observations.map((observation) => observation.bytes),
  );
  detoxDispatchFence(lifecycle, 'dispatch runtime closure digest');
  assert.equal(
    currentHash,
    build.dispatchRuntimeInputsHash,
    'Detox dispatch runtime closure bytes changed after the bridge returned',
  );
}

function projectDetoxAttemptForNativePilot(
  input: Readonly<{
    result: DetoxIosConnectionPublicBridgeResult;
    artifactRoot: string;
    build: DetoxDispatchQualifiedBuild;
    postCaptureFailure?: DetoxNativePilotAttemptResult['postCaptureFailure'];
    detoxRuntimeFacts?: DetoxIosConnectionRuntimeFacts | null;
  }>,
): DetoxNativePilotAttemptResult {
  const attempt = input.result.attempt;
  const report = objectRecord(attempt.report);
  const producer = objectRecord(report?.detoxProducerReceipt);
  const backend = objectRecord(report?.backend);
  const sourceOnly = attempt.status === 'source-only';
  let runtimeMetadata: DetoxRuntimeBuildMetadata | null = null;
  let runtimeMetadataFailure: DetoxNativePilotAttemptResult['postCaptureFailure'] = null;
  try {
    const reportedBuild = objectRecord(report?.build);
    assert(reportedBuild, 'Detox producer report is missing its actual build record');
    const reportedMetadata = {
      environmentHash: reportedBuild.environmentHash,
      toolVersions: reportedBuild.toolVersions,
      toolVersionEvidence: reportedBuild.toolVersionEvidence,
    };
    requireDetoxRuntimeBuildMetadata(reportedMetadata, 'Detox producer runtime metadata');
    requireDetoxRuntimeBuildMetadata(input.build, 'Detox qualified runtime metadata');
    assert.equal(
      reportedMetadata.environmentHash,
      input.build.environmentHash,
      'Detox producer flags profile differs from the qualified build',
    );
    assert.deepEqual(
      reportedMetadata.toolVersions,
      input.build.toolVersions,
      'Detox producer tool versions differ from the qualified build',
    );
    assert.deepEqual(
      reportedMetadata.toolVersionEvidence,
      input.build.toolVersionEvidence,
      'Detox producer tool evidence differs from the qualified build',
    );
    runtimeMetadata = reportedMetadata;
  } catch (error) {
    runtimeMetadataFailure = safePostCaptureFailure(error, 'verification');
  }
  const cleanup =
    attempt.cleanup === 'cleaned'
      ? ('cleaned' as const)
      : attempt.cleanup === 'failed'
        ? {
            status: 'failed-recovery-retained' as const,
            resources: [] as string[],
          }
        : ('not-acquired' as const);
  const failure = attempt.failures[0];
  const reportTimings = objectRecord(report?.detoxRuntimeTimingsMs);
  const timing = (name: string): number =>
    typeof reportTimings?.[name] === 'number' && Number.isFinite(reportTimings[name])
      ? Number(reportTimings[name])
      : 0;
  return {
    kind: 'private-owned-ios-detox-connection-attempt-not-public-receipt',
    requestedRunId: input.result.requestedRunId,
    requestedAttemptId: input.result.requestedAttemptId,
    captureRunId:
      typeof producer?.captureRunId === 'string'
        ? producer.captureRunId
        : input.result.requestedRunId,
    backendRunId: typeof backend?.runId === 'string' ? backend.runId : null,
    backendAttemptId: null,
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
    captureCleanup: cleanup,
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
      build: timing('build'),
      install: timing('install'),
      reset: timing('reset'),
      scenario: timing('scenario'),
      verify: timing('verify'),
      cleanup: timing('cleanup'),
    },
    nativePassingCases: 0,
    artifactRoot: input.artifactRoot,
    publicFinalization: null,
    publicFinalizationInput: null,
    publicDependency: null,
    captureInvocation: { count: sourceOnly ? 1 : 0, returned: sourceOnly },
    captureCompleted: sourceOnly && !input.postCaptureFailure,
    censusFailureCount: Array.isArray(report?.censusFailures) ? report.censusFailures.length : 0,
    staged: null,
    faultAttemptId: null,
    detoxBridgeResult: input.result,
    dispatchRuntimeInputPaths: input.build.dispatchRuntimeInputPaths,
    dispatchRuntimeInputsHash: input.build.dispatchRuntimeInputsHash,
    detoxBuild: input.build,
    detoxRuntimeFacts: input.detoxRuntimeFacts ?? null,
  };
}

export type DetoxDispatchDependencies = Readonly<{
  /** Resource-free clock seam; production uses performance.now(). */
  now?: DetoxDispatchClock;
  /** Resource-free qualified-build seam; production uses the real loader. */
  loadBuild?: (
    input: Parameters<typeof loadIosDetoxQualifiedBuild>[0],
  ) => Promise<DetoxDispatchQualifiedBuild>;
  /** Resource-free bridge seam; production uses the single-owner bridge. */
  runBridge?: (
    input: DetoxConnectionPublicDispatchInput,
  ) => Promise<DetoxIosConnectionPublicBridgeResult>;
}>;

/**
 * Actual run-native-pilot Detox branch. The reusable build is loaded before
 * the existing Maestro host/acquisition path, then the accepted bridge calls
 * the real Detox driver. The bridge result is projected only for the outer
 * private terminal receipt; no projection can create a public pass.
 */
export async function runIosDetoxConnectionAttemptForNativePilot(
  input: Readonly<{
    repositoryRoot: string;
    serverRoot: string;
    artifactRoot: string;
    requestedRunId: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    signal: AbortSignal;
    deadlineMs: number;
    deadlineAtMonotonicMs?: number;
    buildRunId: string;
    reuseBuildSourceRoot?: string;
    parentEnv?: Readonly<Record<string, string | undefined>>;
  }>,
  dependencies: DetoxDispatchDependencies = {},
): Promise<DetoxNativePilotAttemptResult> {
  const lifecycle =
    input.deadlineAtMonotonicMs === undefined
      ? createDetoxDispatchLifecycle(input.deadlineMs, input.signal, dependencies.now)
      : createDetoxDispatchLifecycleAt(input.deadlineAtMonotonicMs, input.signal, dependencies.now);
  requireIosDetoxConnectionPublicSelection(input.selection);
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  detoxDispatchFence(lifecycle, 'selection');
  const artifactLease = await acquireDetoxConnectionArtifactRoot({
    root: input.artifactRoot,
    signal: lifecycle.signal,
    deadlineAt: lifecycle.deadlineAtMonotonicMs,
  });
  let transferred = false;
  try {
    const loadBuild = dependencies.loadBuild ?? loadIosDetoxQualifiedBuild;
    const build = await loadBuild({
      repositoryRoot: input.repositoryRoot,
      buildRunId: input.buildRunId,
      reuseBuildSourceRoot: input.reuseBuildSourceRoot,
      signal: lifecycle.signal,
      deadlineAtMonotonicMs: lifecycle.deadlineAtMonotonicMs,
      now: lifecycle.now,
    });
    detoxDispatchFence(lifecycle, 'qualified build');
    const runBridge = dependencies.runBridge ?? runIosDetoxConnectionPublicAttempt;
    artifactLease.markTransferred();
    transferred = true;
    const bridgeResult = await runBridge({
      owner: DETOX_IOS_CONNECTION_PUBLIC_OWNER,
      repositoryRoot: input.repositoryRoot,
      serverRoot: input.serverRoot,
      artifactRoot: input.artifactRoot,
      requestedRunId: input.requestedRunId,
      requestedAttemptId: input.requestedAttemptId,
      selection: input.selection,
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
      },
      signal: input.signal,
      deadlineMs: boundedDetoxBridgeDeadlineMs(lifecycle, input.deadlineMs),
      deadlineAtMonotonicMs: lifecycle.deadlineAtMonotonicMs,
      parentEnv: input.parentEnv,
    });
    let postCaptureFailure: DetoxNativePilotAttemptResult['postCaptureFailure'] = null;
    const postBridgeResult = bridgeResult;
    try {
      detoxDispatchFence(lifecycle, 'bridge result readback');
      revalidateDetoxDispatchRuntimeClosure(input.repositoryRoot, build, lifecycle);
    } catch (error) {
      // The bridge result is already the owner-produced cleanup/failure ledger.
      // Preserve it in the returned private result even if the outer readback
      // boundary is cancelled or expires after the bridge has settled.
      postCaptureFailure = safePostCaptureFailure(error, 'verification');
    }
    const projected = projectDetoxAttemptForNativePilot({
      result: postBridgeResult,
      artifactRoot: input.artifactRoot,
      build,
      postCaptureFailure,
    });
    let detoxRuntimeFacts: DetoxIosConnectionRuntimeFacts | null = null;
    try {
      detoxRuntimeFacts = await produceDetoxRuntimeFactsFromActualProducer({
        repositoryRoot: input.repositoryRoot,
        captureRoot: projected.artifactRoot,
        requestedRunId: input.requestedRunId,
        requestedAttemptId: input.requestedAttemptId,
        selection: input.selection,
        build,
        bridgeResult: postBridgeResult,
        attempt: projected,
        signal: lifecycle.signal,
        deadlineAtMonotonicMs: lifecycle.deadlineAtMonotonicMs,
      });
    } catch (error) {
      postCaptureFailure ??= safePostCaptureFailure(error, 'verification');
    }
    return {
      ...projected,
      ...(postCaptureFailure ? { postCaptureFailure } : {}),
      detoxRuntimeFacts,
    };
  } catch (error) {
    if (transferred) throw error;
    const cleanupError = await cleanupDetoxArtifactRootBeforeDriver(
      artifactLease,
      error,
      lifecycle,
    );
    throw cleanupError ?? error;
  }
}

export type DetoxConnectionPublicDispatchInput = Readonly<
  Omit<DetoxIosConnectionPublicBridgeInput, 'delegate'> & {
    delegate?: DetoxIosConnectionDriverDelegate;
  }
>;

/**
 * The public runner must select an engine-specific adapter before any native
 * resource is acquired. This predicate is deliberately separate from the
 * existing Maestro adapter so a Detox report can never enter a Maestro
 * capture/staging path by accident.
 */
export function requireIosDetoxConnectionPublicSelection(
  selection: NativePilotSelection,
): NativePilotSelection {
  const valid = requireDetoxConnectionSelection(selection);
  assert.deepEqual(valid.arguments, {
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-connection-ios',
    mode: 'integration',
  });
  return valid;
}

export function iosDetoxConnectionExecutionAdapter(
  selection: NativePilotSelection,
): typeof IOS_DETOX_CONNECTION_PUBLIC_DISPATCH | null {
  try {
    requireIosDetoxConnectionPublicSelection(selection);
    return IOS_DETOX_CONNECTION_PUBLIC_DISPATCH;
  } catch {
    return null;
  }
}

/**
 * Invoke the accepted bridge. It receives no target, session, proxy, child or
 * cleanup handle: the Detox producer remains the only owner of those objects.
 * The returned result is always private/source-only and can never be a public
 * native passing attempt.
 */
export async function runIosDetoxConnectionPublicAttempt(
  input: DetoxConnectionPublicDispatchInput,
): Promise<DetoxIosConnectionPublicBridgeResult> {
  requireIosDetoxConnectionPublicSelection(input.selection);
  assert.equal(input.owner, DETOX_IOS_CONNECTION_PUBLIC_OWNER);
  const result = await delegateIosDetoxConnectionAsSingleOwner(input);
  assert.equal(result.engine, 'detox');
  assert.equal(result.platform, 'ios');
  assert.equal(result.owner, DETOX_IOS_CONNECTION_PUBLIC_OWNER);
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.publicPromotionEligible, false);
  assert.equal(result.requestedAttemptId, `${result.requestedRunId}:first`);
  assert.equal(DETOX_CONNECTION_PUBLIC_DISPATCH_STATUS, 'source-only');
  return result;
}

export type DetoxPartialAttemptRetentionInput = Readonly<{
  outputRoot: string;
  result: DetoxIosConnectionPublicBridgeResult;
}>;

function projectPrivateBridgeFacts(result: DetoxIosConnectionPublicBridgeResult) {
  const attempt = result.attempt;
  const report = objectRecord(attempt.report);
  const reportRef = report
    ? {
        kind: typeof report.kind === 'string' ? report.kind : null,
        output: typeof report.output === 'string' ? report.output : null,
        selection: report.selection ?? null,
        producerReceipt: report.detoxProducerReceipt ?? null,
        backend: report.backend ?? null,
        connectionApiIdentity: report.connectionApiIdentity ?? null,
        reportPath: typeof report.reportPath === 'string' ? report.reportPath : null,
        ledgerPath: typeof report.ledgerPath === 'string' ? report.ledgerPath : null,
        diagnosticsPath: typeof report.diagnosticsPath === 'string' ? report.diagnosticsPath : null,
        recoveryRecordPath:
          typeof report.recoveryRecordPath === 'string' ? report.recoveryRecordPath : null,
        cleanup: report.detoxConnectionCleanup ?? report.cleanup ?? null,
      }
    : null;
  return {
    report: reportRef,
    ledger: Array.isArray(attempt.ledger) ? attempt.ledger : [],
    diagnostics: {
      commands: Array.isArray(report?.detoxConnectionCommands)
        ? report.detoxConnectionCommands
        : [],
      censusFailures: Array.isArray(report?.censusFailures) ? report.censusFailures : [],
      outputFailures: Array.isArray(report?.outputFailures) ? report.outputFailures : [],
    },
    recovery: {
      status: attempt.recoveryStatus,
      cleanup: attempt.cleanup,
      failures: attempt.failures,
      record: report?.recoveryRecord ?? report?.recoveryRecordPath ?? null,
    },
  };
}

/**
 * Preserve a blocked/cancelled/deadline/failed-cleanup attempt as a private
 * diagnostic. A partial attempt is never transformed into a receipt and never
 * contributes to native/public passing counts.
 */
export async function retainIosDetoxConnectionPartialAttempt(
  input: DetoxPartialAttemptRetentionInput,
): Promise<string> {
  const attempt = input.result.attempt;
  assert(
    attempt.status !== 'source-only' || attempt.cleanup === 'failed',
    'A cleaned source-only attempt must go through complete staging',
  );
  assert.equal(input.result.nativePassingCases, 0);
  assert.equal(input.result.publicPromotionEligible, false);
  const root = path.resolve(input.outputRoot);
  assert.equal(await realpath(root), root, 'Detox partial output root must already be canonical');
  const metadata = await lstat(root);
  assert(
    metadata.isDirectory() &&
      !metadata.isSymbolicLink() &&
      (metadata.mode & 0o777) === 0o700 &&
      (typeof process.getuid !== 'function' || metadata.uid === process.getuid()),
    'Detox partial output root must be an existing owned private directory',
  );
  const name = 'detox-connection-partial-attempt.private.json';
  const destination = path.join(root, name);
  const safe = {
    kind: 'private-detox-connection-partial-attempt-not-public-receipt',
    owner: input.result.owner,
    engine: input.result.engine,
    platform: input.result.platform,
    requestedRunId: input.result.requestedRunId,
    requestedAttemptId: input.result.requestedAttemptId,
    selection: input.result.selection,
    attempt: {
      status: attempt.status,
      selectionValid: attempt.selectionValid,
      acquired: attempt.acquired,
      cleanup: attempt.cleanup,
      recoveryStatus: attempt.recoveryStatus,
      failures: attempt.failures,
      deadlineAccounting: attempt.deadlineAccounting,
      reportAvailable: attempt.report !== null,
      bridge: projectPrivateBridgeFacts(input.result),
      nativePassingCases: 0,
      publicPromotionEligible: false,
    },
    nativePassingCases: 0,
    publicPromotionEligible: false,
  };
  const serialized = Buffer.from(`${JSON.stringify(safe, null, 2)}\n`);
  assert(
    serialized.byteLength <= DETOX_PARTIAL_ATTEMPT_MAX_BYTES,
    `Detox partial attempt facts exceed ${DETOX_PARTIAL_ATTEMPT_MAX_BYTES} bytes`,
  );
  const readback = await writeAtomicDetoxConnectionBytes(
    root,
    name,
    serialized,
    DETOX_PARTIAL_ATTEMPT_MAX_BYTES,
  );
  assert(
    readback.bytes.equals(serialized),
    'Detox partial attempt bytes failed descriptor readback',
  );
  assert.equal(readback.realpath, destination);
  assert.equal(readback.metadata.nlink, 1);
  assert.equal(readback.metadata.mode & 0o777, 0o600);
  if (typeof process.getuid === 'function') assert.equal(readback.metadata.uid, process.getuid());
  const written = await readOwnedDetoxConnectionEvidence(
    root,
    name,
    DETOX_PARTIAL_ATTEMPT_MAX_BYTES,
  );
  assert(written.bytes.equals(serialized), 'Detox partial attempt final readback changed');
  assert.equal(written.realpath, destination);
  return destination;
}
