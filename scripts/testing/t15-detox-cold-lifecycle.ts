import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type {
  NativeComparisonAttemptExpectation,
  NativeComparisonColdAttemptIdentity,
  NativeComparisonOwnershipWindow,
  NativeComparisonReceiptInput,
  NativeComparisonSpec,
} from './compare-native-pilot';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeEvidenceIdentity } from './native-view-evidence';
import type {
  ColdComparisonAttemptReceipt,
  ColdComparisonOwnedAttemptInvocation,
  ColdComparisonResetProducer,
  ColdResetOriginalReceiptBinding,
  FreshColdReset,
  QualifiedBuildReuse,
} from './t15-cold-dispatcher';

type Row = Record<string, unknown>;

const HASH = /^[a-f0-9]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

/**
 * These are the current Detox routes whose existing owners already expose a
 * target/fixture/backend/public seam. Android camera is intentionally absent:
 * its permission/system-prompt adapter is a separate dependency.
 */
export const T15_DETOX_SHARED_ROUTE_KEYS = Object.freeze([
  'session|ios',
  'session|android',
  'training|ios',
  'training|android',
  'connection|ios',
  'connection|android',
  'camera-denied|ios',
  'save-retry|ios',
  'save-retry|android',
] as const);

export type T15DetoxSharedRouteKey = (typeof T15_DETOX_SHARED_ROUTE_KEYS)[number];

export type T15DetoxSharedRoute = Readonly<{
  key: T15DetoxSharedRouteKey;
  family: 'session' | 'training' | 'connection' | 'camera-denied' | 'save-retry';
  platform: 'ios' | 'android';
  ownerModule: string;
  ownerExport: string;
  publicModule: string;
  publicExport: string;
  /** The route is source-composable; it has no implicit runtime binding. */
  runtimeBinding: 'caller-supplied';
}>;

const ROUTES: readonly T15DetoxSharedRoute[] = Object.freeze([
  {
    key: 'session|ios',
    family: 'session',
    platform: 'ios',
    ownerModule: 'scripts/testing/native-detox-session-native-pilot-route.ts',
    ownerExport: 'runIosDetoxSessionAttemptForNativePilot',
    publicModule: 'scripts/testing/native-detox-session-public-adapter.ts',
    publicExport: 'runIosDetoxSessionPublicAdapter',
    runtimeBinding: 'caller-supplied',
  },
  {
    key: 'session|android',
    family: 'session',
    platform: 'android',
    // The native-pilot route is the caller adapter; the existing owned
    // process/session owner is the integrated Detox baseline below.
    ownerModule: 'scripts/testing/detox-integrated-session-baseline.ts',
    ownerExport: 'runDetoxIntegratedSessionBaseline',
    publicModule: 'scripts/testing/native-detox-android-session-public-finalization.ts',
    publicExport: 'stageAndroidDetoxSessionPublicEvidence',
    runtimeBinding: 'caller-supplied',
  },
  {
    key: 'training|ios',
    family: 'training',
    platform: 'ios',
    ownerModule: 'scripts/testing/native-detox-training-public-dispatch.ts',
    ownerExport: 'runIosDetoxTrainingAttemptForNativePilot',
    publicModule: 'scripts/testing/native-detox-training-public-dispatch.ts',
    publicExport: 'runIosDetoxTrainingAttemptForPublicDispatch',
    runtimeBinding: 'caller-supplied',
  },
  {
    key: 'training|android',
    family: 'training',
    platform: 'android',
    ownerModule: 'scripts/testing/detox-training-owned-dispatch.ts',
    ownerExport: 'runDetoxTrainingOnExistingOwner',
    publicModule: 'scripts/testing/detox-training-owned-dispatch.ts',
    publicExport: 'runDetoxTrainingOnExistingOwner',
    runtimeBinding: 'caller-supplied',
  },
  {
    key: 'connection|ios',
    family: 'connection',
    platform: 'ios',
    ownerModule: 'scripts/testing/native-detox-connection-public-dispatch.ts',
    ownerExport: 'runIosDetoxConnectionAttemptForNativePilot',
    publicModule: 'scripts/testing/native-detox-connection-public-dispatch.ts',
    publicExport: 'runIosDetoxConnectionPublicAttempt',
    runtimeBinding: 'caller-supplied',
  },
  {
    key: 'connection|android',
    family: 'connection',
    platform: 'android',
    ownerModule: 'scripts/testing/native-detox-connection-android-public-dispatch.ts',
    ownerExport: 'runAndroidDetoxConnectionAttemptForNativePilot',
    publicModule: 'scripts/testing/native-detox-connection-android-public-dispatch.ts',
    publicExport: 'runAndroidDetoxConnectionPublicAttempt',
    runtimeBinding: 'caller-supplied',
  },
  {
    key: 'camera-denied|ios',
    family: 'camera-denied',
    platform: 'ios',
    ownerModule: 'scripts/testing/run-ios-detox-camera-attempt.ts',
    ownerExport: 'runIosDetoxCameraAttemptForPublicDispatch',
    publicModule: 'scripts/testing/native-detox-camera-ios-verifier.ts',
    publicExport: 'verifyDetoxIosCameraPrivateEvidence',
    runtimeBinding: 'caller-supplied',
  },
  {
    key: 'save-retry|ios',
    family: 'save-retry',
    platform: 'ios',
    ownerModule: 'scripts/testing/detox-save-retry-owned-dispatch.ts',
    ownerExport: 'runDetoxSaveRetryOnExistingOwner',
    publicModule: 'scripts/testing/native-save-retry-public-evidence.ts',
    publicExport: 'stageNativeSaveRetryPublicEvidence',
    runtimeBinding: 'caller-supplied',
  },
  {
    key: 'save-retry|android',
    family: 'save-retry',
    platform: 'android',
    ownerModule: 'scripts/testing/detox-save-retry-owned-dispatch.ts',
    ownerExport: 'runDetoxSaveRetryOnExistingOwner',
    publicModule: 'scripts/testing/native-android-save-retry-public-evidence.ts',
    publicExport: 'stageNativeAndroidSaveRetryPublicEvidence',
    runtimeBinding: 'caller-supplied',
  },
] as const);

export const T15_DETOX_SHARED_ROUTES: readonly T15DetoxSharedRoute[] = ROUTES;

export function requireT15DetoxSharedRoute(key: string): T15DetoxSharedRoute {
  const route = ROUTES.find((candidate) => candidate.key === key);
  if (!route) throw new Error(`T15 Detox shared route is not eligible: ${key}`);
  return route;
}

function requireRouteSelection(
  route: T15DetoxSharedRouteKey,
  selection: NativePilotSelection,
): void {
  const [family, platform] = route.split('|');
  if (
    selection.arguments.engine !== 'detox' ||
    selection.arguments.platform !== platform ||
    selection.arguments.mode !== 'integration' ||
    selection.arguments.scenario !== `SCN-${family}-${platform}` ||
    selection.scenario.id !== selection.arguments.scenario ||
    selection.scenario.platform !== platform
  )
    throw new Error(`detox-route-selection-mismatch:${route}`);
}

export type T15DetoxResetPreparationInput = Readonly<{
  spec: NativeComparisonSpec;
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  signal: AbortSignal;
  reusableBuild: QualifiedBuildReuse | null;
  outputRoot: string;
  deadlineAtMonotonicMs: number;
}>;

/** A real route adapter must provide this producer; no reset row is fabricated. */
export type T15DetoxResetPreparation = (
  input: T15DetoxResetPreparationInput,
) => Promise<FreshColdReset>;

export type T15DetoxProcessOwnership = Readonly<{
  pid: number;
  processStartIdentity: string;
}>;

export type T15DetoxOwnedLifecycle = Readonly<{
  ownerRunId: string;
  captureRunId: string;
  target: Row;
  backend: Row;
  fixture: Row;
  originalReceiptBinding: ColdResetOriginalReceiptBinding & {
    identity: NativeEvidenceIdentity;
  };
  process: T15DetoxProcessOwnership;
  ownedPorts: readonly number[];
  ownershipWindows: readonly NativeComparisonOwnershipWindow[];
  cleanupStatus: 'cleaned';
  /** Opaque owner state is passed to public and cleanup callbacks unchanged. */
  ownerState?: unknown;
}>;

export type T15DetoxOwnerInput = Readonly<{
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  reset: FreshColdReset;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
  reusableBuild: QualifiedBuildReuse;
  outputRoot: string;
}>;

export type T15DetoxOwner = (input: T15DetoxOwnerInput) => Promise<T15DetoxOwnedLifecycle>;

export type T15DetoxPublicInput = Readonly<{
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  reset: FreshColdReset;
  owner: T15DetoxOwnedLifecycle;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
  outputRoot: string;
}>;

export type T15DetoxPublicResult = Readonly<{
  receipt: NativeComparisonReceiptInput;
  receiptIdentity: NativeEvidenceIdentity;
}>;

export type T15DetoxPublicConsumer = (
  input: T15DetoxPublicInput,
) => Promise<T15DetoxPublicResult | null>;

export type T15DetoxCleanupInput = Readonly<{
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  reset: FreshColdReset;
  owner: T15DetoxOwnedLifecycle;
  publicResult: T15DetoxPublicResult | null;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
}>;

export type T15DetoxCleanupResult = Readonly<{
  ownerRunId: string;
  status: 'cleaned';
  ownershipWindows: readonly NativeComparisonOwnershipWindow[];
  recoveryRecordPath: string | null;
}>;

export type T15DetoxCleanup = (input: T15DetoxCleanupInput) => Promise<T15DetoxCleanupResult>;

export type T15DetoxSharedLifecycleOptions = Readonly<{
  route: T15DetoxSharedRouteKey;
  /** Caller-owned private namespace; the factory never creates resources. */
  outputRoot: string;
  reset: T15DetoxResetPreparation;
  owner: T15DetoxOwner;
  consumePublic: T15DetoxPublicConsumer;
  cleanup: T15DetoxCleanup;
}>;

function isRecord(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function token(value: unknown, label: string): string {
  if (typeof value !== 'string' || !TOKEN.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function hash(value: unknown, label: string): string {
  const result = token(value, label);
  if (!HASH.test(result)) throw new Error(`${label} is not a SHA-256 hash`);
  return result;
}

function requireRow(value: unknown, label: string): Row {
  if (!isRecord(value)) throw new Error(`${label} is missing`);
  return value;
}

function requireIdentity(value: unknown, label: string): NativeEvidenceIdentity {
  const row = requireRow(value, label);
  for (const field of [
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
    if (typeof row[field] !== 'number' || !Number.isFinite(row[field]))
      throw new Error(`${label}.${field} is invalid`);
  }
  if (row.nlink !== 1 || (Number(row.mode) & 0o777) !== 0o600 || Number(row.size) <= 0)
    throw new Error(`${label} is not a private immutable receipt`);
  return row as unknown as NativeEvidenceIdentity;
}

function requireBinding(
  value: unknown,
  label: string,
): ColdResetOriginalReceiptBinding & { identity: NativeEvidenceIdentity } {
  const row = requireRow(value, label);
  if (
    row.status !== 'verified' ||
    typeof row.receiptPath !== 'string' ||
    !path.isAbsolute(row.receiptPath) ||
    typeof row.artifactRoot !== 'string' ||
    !path.isAbsolute(row.artifactRoot) ||
    typeof row.receiptHash !== 'string' ||
    !HASH.test(row.receiptHash)
  )
    throw new Error(`${label} is not verified`);
  if (
    path.dirname(path.resolve(row.receiptPath)) !== path.resolve(row.artifactRoot) ||
    !path.relative(path.resolve(row.artifactRoot), path.resolve(row.receiptPath))
  )
    throw new Error(`${label} escaped its artifact root`);
  return {
    status: 'verified',
    receiptPath: row.receiptPath,
    artifactRoot: row.artifactRoot,
    receiptHash: row.receiptHash,
    identity: requireIdentity(row.identity, `${label}.identity`),
  };
}

function sameFields(left: Row, right: Row, fields: readonly string[], label: string): void {
  for (const field of fields)
    if (left[field] !== right[field]) throw new Error(`${label}.${field}`);
}

const targetFields = [
  'platform',
  'deviceId',
  'osVersion',
  'appId',
  'buildProfile',
  'binaryHash',
  'apiOrigin',
  'captureRunId',
  'ownerRunId',
  'phase',
] as const;
const backendFields = [
  'runId',
  'ownerRunId',
  'captureRunId',
  'artifactRoot',
  'apiOrigin',
  'apiPid',
  'apiStarted',
  'apiScript',
  'backendAttemptId',
  'manifestSha256',
] as const;

function requireResetContract(input: {
  reset: FreshColdReset;
  expected: NativeComparisonAttemptExpectation;
  cohortFixtureFingerprint: string;
}): FreshColdReset {
  const { reset, expected, cohortFixtureFingerprint } = input;
  if (reset.status !== 'fresh') throw new Error(`reset-blocked:${reset.blocker ?? 'unknown'}`);
  if (
    reset.fixtureResetId !== expected.fixtureResetId ||
    reset.ownerRunId !== expected.runId ||
    reset.cohortFixtureFingerprint !== cohortFixtureFingerprint ||
    reset.cleanupStatus !== 'cleaned' ||
    reset.blocker !== null
  )
    throw new Error('reset-identity-mismatch');
  if (!reset.finishedAt || Date.parse(reset.finishedAt) <= Date.parse(reset.startedAt))
    throw new Error('reset-interval-invalid');
  hash(reset.appStateFingerprint, 'reset.appStateFingerprint');
  hash(reset.fixtureStateFingerprint, 'reset.fixtureStateFingerprint');
  hash(reset.sourceFingerprint, 'reset.sourceFingerprint');
  hash(reset.helperFingerprint, 'reset.helperFingerprint');
  requireBinding(reset.originalResetBinding, 'reset.originalResetBinding');
  const target = requireRow(reset.target, 'reset.target');
  const backend = requireRow(reset.backend, 'reset.backend');
  sameFields(target, { ownerRunId: input.expected.runId }, ['ownerRunId'], 'reset.target');
  sameFields(backend, { ownerRunId: input.expected.runId }, ['ownerRunId'], 'reset.backend');
  if (backend.runId !== input.expected.runId)
    throw new Error('reset.backend.runId is not bound to owner run');
  for (const [field, wanted] of Object.entries(expected.target)) {
    if (wanted !== null && target[field] !== wanted) throw new Error(`reset.target.${field}`);
  }
  return reset;
}

function requireReset(
  reset: FreshColdReset,
  input: ColdComparisonOwnedAttemptInvocation,
): FreshColdReset {
  return requireResetContract({
    reset,
    expected: input.expected,
    cohortFixtureFingerprint: input.spec.cohort.fixtureResetFingerprint,
  });
}

function requireFixture(
  fixture: Row,
  expected: NativeComparisonAttemptExpectation,
  backend: Row,
): Row {
  const runId = token(fixture.runId, 'owner.fixture.runId');
  if (runId !== backend.runId) throw new Error('owner.fixture.backend-run-mismatch');
  const resetId = fixture.fixtureResetId ?? fixture.resetId;
  if (resetId !== expected.fixtureResetId) throw new Error('owner.fixture.reset-id-mismatch');
  if (fixture.ownerRunId !== undefined && fixture.ownerRunId !== expected.runId)
    throw new Error('owner.fixture.owner-run-mismatch');
  if (fixture.captureRunId !== undefined && fixture.captureRunId !== backend.captureRunId)
    throw new Error('owner.fixture.capture-run-mismatch');
  token(fixture.scope, 'owner.fixture.scope');
  return fixture;
}

function requireWindows(
  windows: readonly NativeComparisonOwnershipWindow[],
  ownerRunId: string,
  label: string,
): readonly NativeComparisonOwnershipWindow[] {
  if (windows.length < 2) throw new Error(`${label} are missing`);
  const processRows = windows.filter((row) => row.resourceType === 'process');
  const portRows = windows.filter((row) => row.resourceType === 'port');
  if (processRows.length !== 1 || portRows.length === 0) throw new Error(`${label} are incomplete`);
  for (const row of windows) {
    if (
      row.ownerRunId !== ownerRunId ||
      !token(row.resourceId, `${label}.resourceId`) ||
      !token(row.acquiredAt, `${label}.acquiredAt`) ||
      !token(row.releasedAt, `${label}.releasedAt`) ||
      Date.parse(row.releasedAt) <= Date.parse(row.acquiredAt)
    )
      throw new Error(`${label} contain an open or foreign resource`);
    if (row.resourceType === 'process' && !row.processStartIdentity)
      throw new Error(`${label} process start identity is missing`);
    if (row.resourceType === 'port' && row.processStartIdentity !== null)
      throw new Error(`${label} port process identity is invalid`);
  }
  return windows.map((row) => ({ ...row }));
}

function sameWindowSet(
  expected: readonly NativeComparisonOwnershipWindow[],
  actual: readonly NativeComparisonOwnershipWindow[],
): void {
  if (expected.length !== actual.length) throw new Error('cleanup ownership window count changed');
  const key = (row: NativeComparisonOwnershipWindow) =>
    `${row.resourceType}:${row.resourceId}:${row.ownerRunId}`;
  const left = new Set(expected.map(key));
  const right = new Set(actual.map(key));
  if (left.size !== right.size || [...left].some((entry) => !right.has(entry)))
    throw new Error('cleanup ownership resources changed');
}

function requireOwner(
  owner: T15DetoxOwnedLifecycle,
  input: ColdComparisonOwnedAttemptInvocation,
  reset: FreshColdReset,
): T15DetoxOwnedLifecycle {
  if (owner.ownerRunId !== input.expected.runId) throw new Error('ownerRunId-mismatch');
  token(owner.captureRunId, 'owner.captureRunId');
  const target = requireRow(owner.target, 'owner.target');
  const backend = requireRow(owner.backend, 'owner.backend');
  sameFields(target, reset.target as Row, targetFields, 'owner.target');
  sameFields(backend, reset.backend as Row, backendFields, 'owner.backend');
  if (target.captureRunId !== owner.captureRunId || backend.captureRunId !== owner.captureRunId)
    throw new Error('owner.captureRunId is not bound to target/backend');
  const fixture = requireFixture(
    requireRow(owner.fixture, 'owner.fixture'),
    input.expected,
    backend,
  );
  const binding = requireBinding(owner.originalReceiptBinding, 'owner.originalReceiptBinding');
  const resetBinding = requireBinding(reset.originalResetBinding, 'reset.originalResetBinding');
  if (
    binding.receiptHash === resetBinding.receiptHash ||
    binding.artifactRoot !== resetBinding.artifactRoot ||
    binding.receiptPath === resetBinding.receiptPath
  )
    throw new Error('owner.originalReceiptBinding is not distinct from reset receipt');
  if (!Number.isSafeInteger(owner.process.pid) || owner.process.pid <= 1)
    throw new Error('owner process PID is invalid');
  token(owner.process.processStartIdentity, 'owner process start identity');
  const ports = owner.ownedPorts.map((port, index) => {
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
      throw new Error(`owner port ${index} is invalid`);
    return port;
  });
  if (new Set(ports).size !== ports.length || ports.length === 0)
    throw new Error('owner ports are duplicated or missing');
  const windows = requireWindows(
    owner.ownershipWindows,
    owner.ownerRunId,
    'owner ownership windows',
  );
  if (
    !windows.some(
      (row) => row.resourceType === 'process' && row.resourceId === String(owner.process.pid),
    ) ||
    ports.some(
      (port) =>
        !windows.some((row) => row.resourceType === 'port' && row.resourceId === String(port)),
    )
  )
    throw new Error('owner ownership windows do not bind process and ports');
  return {
    ...owner,
    target,
    backend,
    fixture,
    originalReceiptBinding: binding,
    ownedPorts: ports,
    ownershipWindows: windows,
  };
}

function requirePublic(
  value: T15DetoxPublicResult,
  input: ColdComparisonOwnedAttemptInvocation,
  owner: T15DetoxOwnedLifecycle,
): T15DetoxPublicResult {
  const receipt = value?.receipt;
  if (!receipt || !path.isAbsolute(receipt.path) || !path.isAbsolute(receipt.artifactRoot))
    throw new Error('public receipt path is invalid');
  if (
    path.dirname(path.resolve(receipt.path)) !== path.resolve(receipt.artifactRoot) ||
    !path.relative(path.resolve(receipt.artifactRoot), path.resolve(receipt.path))
  )
    throw new Error('public receipt escaped artifact root');
  hash(receipt.receiptHash, 'public receipt hash');
  const row = requireRow(receipt.receipt, 'public receipt');
  if (row.runId !== input.expected.runId || row.attemptId !== input.expected.attemptId)
    throw new Error('public receipt attempt mismatch');
  if (row.captureRunId !== undefined && row.captureRunId !== owner.captureRunId)
    throw new Error('public receipt capture mismatch');
  if (row.ownerRunId !== undefined && row.ownerRunId !== input.expected.runId)
    throw new Error('public receipt owner mismatch');
  if (row.backendRunId !== undefined && row.backendRunId !== owner.backend.runId)
    throw new Error('public receipt backend mismatch');
  if (
    !['passed', 'application-failed', 'harness-blocked', 'cancelled'].includes(String(row.result))
  )
    throw new Error('public receipt result is invalid');
  return {
    receipt,
    receiptIdentity: requireIdentity(value.receiptIdentity, 'public receipt identity'),
  };
}

function blockedIdentity(
  expected: NativeComparisonAttemptExpectation,
): NativeComparisonColdAttemptIdentity {
  return {
    ownerRunId: expected.runId,
    processPid: null,
    processStartIdentity: null,
    ownedPorts: [],
    ownershipWindows: [],
    originalReceiptBinding: {
      status: 'pending',
      receiptPath: null,
      artifactRoot: null,
      receiptHash: null,
    },
  };
}

function blockedReset(
  input: ColdComparisonOwnedAttemptInvocation,
  blocker: string,
): FreshColdReset {
  return {
    fixtureResetId: input.expected.fixtureResetId,
    ownerRunId: input.expected.runId,
    cohortFixtureFingerprint: input.spec.cohort.fixtureResetFingerprint,
    status: 'blocked',
    startedAt: new Date(0).toISOString(),
    finishedAt: null,
    appStateFingerprint: null,
    fixtureStateFingerprint: null,
    sourceFingerprint: null,
    helperFingerprint: null,
    originalResetBinding: {
      status: 'pending',
      receiptPath: null,
      artifactRoot: null,
      receiptHash: null,
    },
    cleanupStatus: 'not-acquired',
    blocker: blocker.slice(0, 256),
  };
}

function blocked(
  input: ColdComparisonOwnedAttemptInvocation,
  issue: string,
  reset = blockedReset(input, issue),
  owner?: T15DetoxOwnedLifecycle,
): ColdComparisonAttemptReceipt {
  const identity = owner
    ? {
        ownerRunId: input.expected.runId,
        processPid: owner.process.pid,
        processStartIdentity: owner.process.processStartIdentity,
        ownedPorts: [...owner.ownedPorts],
        ownershipWindows: [...owner.ownershipWindows],
        originalReceiptBinding: owner.originalReceiptBinding,
      }
    : blockedIdentity(input.expected);
  return {
    runId: input.expected.runId,
    attemptId: input.expected.attemptId,
    status: input.signal.aborted ? 'cancelled' : 'harness-blocked',
    ownerRunId: input.expected.runId,
    coldAttemptIdentity: identity,
    reset,
    receipt: null,
    issue,
  };
}

function assertDeadline(signal: AbortSignal, deadlineAtMonotonicMs: number, phase: string): void {
  signal.throwIfAborted();
  if (!Number.isFinite(deadlineAtMonotonicMs) || performance.now() >= deadlineAtMonotonicMs)
    throw new Error(`deadline-${phase}`);
}

/**
 * Compose one actual Detox owner with the shared reset, public-consumer and
 * cleanup contract. Callers must supply all four real seams; this factory has
 * no fallback owner, no synthetic reset and no runtime resource acquisition.
 */
export function createT15DetoxSharedLifecycleProducer(
  options: T15DetoxSharedLifecycleOptions,
): (input: ColdComparisonOwnedAttemptInvocation) => Promise<ColdComparisonAttemptReceipt> {
  requireT15DetoxSharedRoute(options.route);
  if (
    !path.isAbsolute(options.outputRoot) ||
    path.normalize(options.outputRoot) !== options.outputRoot
  )
    throw new Error('T15 Detox shared lifecycle outputRoot must be absolute and normalized');
  if (
    typeof options.reset !== 'function' ||
    typeof options.owner !== 'function' ||
    typeof options.consumePublic !== 'function' ||
    typeof options.cleanup !== 'function'
  )
    throw new Error('T15 Detox shared lifecycle requires reset, owner, public and cleanup seams');
  return async (input) => {
    let reset: FreshColdReset = blockedReset(input, 'detox-reset-not-produced');
    try {
      requireRouteSelection(options.route, input.selection);
      assertDeadline(input.signal, input.deadlineAtMonotonicMs, 'before-reset');
      reset = await options.reset({
        spec: input.spec,
        expected: input.expected,
        selection: input.selection,
        signal: input.signal,
        reusableBuild: input.reusableBuild,
        outputRoot: options.outputRoot,
        deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
      });
      requireReset(reset, input);
      assertDeadline(input.signal, input.deadlineAtMonotonicMs, 'after-reset');
    } catch (error) {
      const issue = error instanceof Error ? error.message : 'detox-reset-rejected';
      return blocked(input, issue, reset ?? blockedReset(input, issue));
    }

    if (!input.reusableBuild) return blocked(input, 'detox-build-reuse-unqualified', reset);
    const cleanupOwned = async (
      owner: T15DetoxOwnedLifecycle,
      publicResult: T15DetoxPublicResult | null,
    ): Promise<T15DetoxCleanupResult> => {
      const cleanup = await options.cleanup({
        expected: input.expected,
        selection: input.selection,
        reset,
        owner,
        publicResult,
        signal: input.signal,
        deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
      });
      if (
        cleanup.ownerRunId !== input.expected.runId ||
        cleanup.status !== 'cleaned' ||
        cleanup.recoveryRecordPath !== null
      )
        throw new Error('detox-cleanup-owner-or-status-mismatch');
      const windows = requireWindows(
        cleanup.ownershipWindows,
        input.expected.runId,
        'cleanup ownership windows',
      );
      sameWindowSet(owner.ownershipWindows, windows);
      // Cleanup is part of the same absolute attempt budget. A callback that
      // reports clean resources after cancellation/deadline cannot promote a
      // public receipt after the ownership window has closed.
      assertDeadline(input.signal, input.deadlineAtMonotonicMs, 'after-cleanup');
      return { ...cleanup, ownershipWindows: windows };
    };

    let owner: T15DetoxOwnedLifecycle | null = null;
    try {
      owner = requireOwner(
        await options.owner({
          expected: input.expected,
          selection: input.selection,
          reset,
          signal: input.signal,
          deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
          reusableBuild: input.reusableBuild,
          outputRoot: options.outputRoot,
        }),
        input,
        reset,
      );
      assertDeadline(input.signal, input.deadlineAtMonotonicMs, 'after-owner');
    } catch (error) {
      const issue = error instanceof Error ? error.message : 'detox-owner-rejected';
      // If validation succeeded and the shared deadline/cancellation tripped
      // immediately afterward, the owner is already ours and must be closed
      // before returning a blocked row. Invalid or foreign owner rows remain
      // pre-acquisition and are not passed to cleanup.
      if (owner) {
        try {
          await cleanupOwned(owner, null);
        } catch (cleanupError) {
          return blocked(
            input,
            cleanupError instanceof Error ? cleanupError.message : 'detox-cleanup-rejected',
            reset,
            owner,
          );
        }
        return blocked(input, issue, reset, owner);
      }
      return blocked(input, issue, reset);
    }
    if (!owner) return blocked(input, 'detox-owner-not-produced', reset);

    let publicResult: T15DetoxPublicResult | null = null;
    let publicIssue: string | null = null;
    try {
      assertDeadline(input.signal, input.deadlineAtMonotonicMs, 'before-public');
      publicResult = await options.consumePublic({
        expected: input.expected,
        selection: input.selection,
        reset,
        owner,
        signal: input.signal,
        deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
        outputRoot: options.outputRoot,
      });
      if (publicResult) publicResult = requirePublic(publicResult, input, owner);
      else publicIssue = 'detox-public-consumer-returned-no-receipt';
      assertDeadline(input.signal, input.deadlineAtMonotonicMs, 'after-public');
    } catch (error) {
      publicIssue = error instanceof Error ? error.message : 'detox-public-consumer-rejected';
    }

    let cleanup: T15DetoxCleanupResult;
    try {
      cleanup = await cleanupOwned(owner, publicResult);
    } catch (error) {
      return blocked(
        input,
        error instanceof Error ? error.message : 'detox-cleanup-rejected',
        reset,
        owner,
      );
    }

    const identity: NativeComparisonColdAttemptIdentity = {
      ownerRunId: input.expected.runId,
      processPid: owner.process.pid,
      processStartIdentity: owner.process.processStartIdentity,
      ownedPorts: [...owner.ownedPorts],
      ownershipWindows: [...cleanup.ownershipWindows],
      originalReceiptBinding: owner.originalReceiptBinding,
    };
    if (!publicResult)
      return blocked(input, publicIssue ?? 'detox-public-consumer-rejected', reset, owner);
    const row = requireRow(publicResult.receipt.receipt, 'public receipt');
    const result = row.result;
    const status =
      result === 'passed' || result === 'application-failed'
        ? 'received'
        : result === 'cancelled'
          ? 'cancelled'
          : 'harness-blocked';
    return {
      runId: input.expected.runId,
      attemptId: input.expected.attemptId,
      status,
      ownerRunId: input.expected.runId,
      coldAttemptIdentity: {
        ...identity,
        originalReceiptBinding: {
          status: 'verified',
          receiptPath: publicResult.receipt.path,
          artifactRoot: publicResult.receipt.artifactRoot,
          receiptHash: publicResult.receipt.receiptHash,
          identity: publicResult.receiptIdentity,
        },
      },
      reset,
      receipt: publicResult.receipt,
      issue:
        result === 'passed' || result === 'application-failed'
          ? null
          : 'detox-public-terminal-not-eligible',
    };
  };
}

/**
 * Adapt one real Detox reset callback to the split dispatcher contract. The
 * callback is still required from the caller and receives the dispatcher’s
 * exact output root; this helper only validates identity and forwards the
 * bounded signal/deadline. It never creates a target, fixture, process or
 * port and it never turns a blocked row into a fresh reset.
 */
export function createT15DetoxSharedResetProducer(options: {
  route: T15DetoxSharedRouteKey;
  prepare: T15DetoxResetPreparation;
  attemptDeadlineMs?: number;
}): ColdComparisonResetProducer {
  requireT15DetoxSharedRoute(options.route);
  if (typeof options.prepare !== 'function')
    throw new Error('T15 Detox shared reset producer requires a real prepare callback');
  const attemptDeadlineMs = options.attemptDeadlineMs ?? 600_000;
  if (!Number.isSafeInteger(attemptDeadlineMs) || attemptDeadlineMs < 100)
    throw new Error('T15 Detox shared reset deadline is outside the bounded range');
  return async (input) => {
    const deadlineAtMonotonicMs = performance.now() + attemptDeadlineMs;
    try {
      requireRouteSelection(options.route, input.selection);
      assertDeadline(input.signal, deadlineAtMonotonicMs, 'before-reset');
      const reset = await options.prepare({
        spec: input.spec,
        expected: input.expected,
        selection: input.selection,
        signal: input.signal,
        reusableBuild: input.reusableBuild,
        outputRoot: input.outputRoot,
        deadlineAtMonotonicMs,
      });
      return requireResetContract({
        reset,
        expected: input.expected,
        cohortFixtureFingerprint: input.spec.cohort.fixtureResetFingerprint,
      });
    } catch (error) {
      const blocker = error instanceof Error ? error.message : 'detox-reset-rejected';
      return {
        fixtureResetId: input.expected.fixtureResetId,
        ownerRunId: input.expected.runId,
        cohortFixtureFingerprint: input.spec.cohort.fixtureResetFingerprint,
        status: 'blocked',
        startedAt: new Date(0).toISOString(),
        finishedAt: null,
        appStateFingerprint: null,
        fixtureStateFingerprint: null,
        sourceFingerprint: null,
        helperFingerprint: null,
        originalResetBinding: {
          status: 'pending',
          receiptPath: null,
          artifactRoot: null,
          receiptHash: null,
        },
        cleanupStatus: 'not-acquired',
        blocker: blocker.slice(0, 256),
      };
    }
  };
}

export const t15DetoxSharedLifecycleContract = Object.freeze({
  routes: T15_DETOX_SHARED_ROUTE_KEYS,
  order: ['reset', 'owner', 'public-consumer', 'cleanup'] as const,
  sameOwnerRunId: true,
  bindsOriginalResetReceipt: true,
  bindsTargetBackendFixture: true,
  forwardsAbsoluteDeadlineAndCancellation: true,
  requiresClosedOwnershipWindows: true,
  requiresCleanupBeforeReceipt: true,
  runtimeBinding: 'caller-supplied' as const,
  nativeExecution: 'not-run' as const,
});
