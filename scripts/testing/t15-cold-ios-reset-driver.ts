import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  runOwnedIosNativeSession,
  type OwnedIosNativeSessionOptions,
  type OwnedIosNativeSessionResult,
} from './capture-native-testability';
import {
  createT15ColdResetProducer,
  type T15ColdResetDriver,
  type T15ProductionRunOptions,
} from './t15-cold-production-runner';
import type {
  NativeComparisonAttemptExpectation,
  NativeComparisonCohortExpectation,
  NativeComparisonEngine,
  NativeComparisonPlatform,
} from './compare-native-pilot';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeEvidenceIdentity } from './native-view-evidence';
import type {
  ColdResetOriginalReceiptBinding,
  FreshColdReset,
  QualifiedBuildReuse,
} from './t15-cold-dispatcher';

const HASH = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[a-f0-9]{24}$/u;
const MAX_REASON = 256;

export type ActualIosResetExecutor = (
  options: OwnedIosNativeSessionOptions,
) => Promise<OwnedIosNativeSessionResult>;

export type ActualT15ColdResetDriverOptions = {
  /** Defaults to the real owned iOS lifecycle. Tests may provide a typed
   * lifecycle executor that returns an actual-shaped capture report; they may
   * not inject a FreshColdReset directly. */
  runIos?: ActualIosResetExecutor;
};

type Row = Record<string, unknown>;

class ColdResetOnlyStop extends Error {
  constructor() {
    super('T15 reset producer stops after the owned cold-reset checkpoint');
    this.name = 'ColdResetOnlyStop';
  }
}

function record(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, label: string, max = 512): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    /[\0\r\n]/u.test(value)
  )
    throw new Error(`${label} is invalid`);
  return value;
}

function hash(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!HASH.test(result)) throw new Error(`${label} is not a SHA-256 hash`);
  return result;
}

function iso(value: unknown, label: string): string {
  const result = text(value, label, 128);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} is invalid`);
  return result;
}

function pendingBinding(): ColdResetOriginalReceiptBinding {
  return {
    status: 'pending',
    receiptPath: null,
    artifactRoot: null,
    receiptHash: null,
  };
}

function blockedReset(
  expected: NativeComparisonAttemptExpectation,
  blocker: string,
): FreshColdReset {
  return {
    fixtureResetId: expected.fixtureResetId,
    ownerRunId: expected.runId,
    cohortFixtureFingerprint: expected.inputs.fixtureHash ?? 'unknown',
    status: 'blocked',
    startedAt: new Date(0).toISOString(),
    finishedAt: null,
    appStateFingerprint: null,
    fixtureStateFingerprint: null,
    sourceFingerprint: null,
    helperFingerprint: null,
    originalResetBinding: pendingBinding(),
    cleanupStatus: 'not-acquired',
    blocker: blocker.slice(0, MAX_REASON),
  };
}

function familyForSelection(
  selection: NativePilotSelection,
): 'session' | 'training' | 'connection' | 'camera-denied' | 'save-retry' | null {
  const id = selection.scenario.id;
  if (!id.startsWith('SCN-') || !id.endsWith(`-${selection.arguments.platform}`)) return null;
  const family = id.slice(4, -(selection.arguments.platform.length + 1));
  return ['session', 'training', 'connection', 'camera-denied', 'save-retry'].includes(family)
    ? (family as 'session' | 'training' | 'connection' | 'camera-denied' | 'save-retry')
    : null;
}

function requireSupportedSelection(selection: NativePilotSelection): {
  platform: NativeComparisonPlatform;
  engine: NativeComparisonEngine;
  family: Exclude<ReturnType<typeof familyForSelection>, null>;
} {
  if (selection.arguments.platform !== 'ios')
    throw new Error('ios-reset-driver-platform-unsupported');
  if (selection.arguments.engine !== 'maestro')
    throw new Error('detox-cold-reset-consumer-unwired');
  if (selection.arguments.mode !== 'integration')
    throw new Error('ios-reset-driver-mode-unsupported');
  const family = familyForSelection(selection);
  if (!family) throw new Error('ios-reset-driver-scenario-unsupported');
  if (family === 'session') throw new Error('ios-session-cold-reset-seam-unwired');
  return {
    platform: 'ios',
    engine: 'maestro',
    family,
  };
}

function callbackForFamily(
  family: Exclude<ReturnType<typeof familyForSelection>, null>,
): Pick<
  OwnedIosNativeSessionOptions,
  'executeTraining' | 'executeSaveRetry' | 'executeConnection' | 'executeCamera'
> {
  const stop = (): Promise<never> => Promise.reject(new ColdResetOnlyStop());
  switch (family) {
    case 'training':
      return { executeTraining: stop };
    case 'save-retry':
      return { executeSaveRetry: stop };
    case 'connection':
      return { executeConnection: stop };
    case 'camera-denied':
      return { executeCamera: stop };
    case 'session':
      throw new Error('ios-session-cold-reset-seam-unwired');
  }
}

function requirePrivateCallerRoot(root: string, runId: string): Promise<string> {
  if (!path.isAbsolute(root) || path.normalize(root) !== root)
    return Promise.reject(new Error('T15 reset output root must be absolute'));
  return realpath(root).then(async (canonicalRoot) => {
    const rootStat = await lstat(canonicalRoot);
    if (
      rootStat.isSymbolicLink() ||
      !rootStat.isDirectory() ||
      (rootStat.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === 'function' && rootStat.uid !== process.getuid())
    )
      throw new Error('T15 reset output root is not private and canonical');
    const child = path.join(canonicalRoot, runId);
    await mkdir(child, { mode: 0o700 });
    const stat = await lstat(child);
    const resolved = await realpath(child);
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      resolved !== child ||
      (stat.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid())
    )
      throw new Error('T15 reset caller root is not private and canonical');
    return resolved;
  });
}

function expectedField(
  expected: NativeComparisonAttemptExpectation,
  field: keyof typeof expected.target,
): string | null {
  return expected.target[field];
}

function requireTargetBinding(actual: Row, expected: NativeComparisonAttemptExpectation): void {
  if (actual.platform !== 'ios') throw new Error('ios-reset-target-platform-mismatch');
  for (const field of [
    'deviceId',
    'osVersion',
    'appId',
    'buildProfile',
    'binaryHash',
    'apiOrigin',
  ] as const) {
    const wanted = expectedField(expected, field);
    if (wanted !== null && actual[field] !== wanted)
      throw new Error(`ios-reset-target-${field}-mismatch`);
  }
  if (actual.ownerRunId !== expected.runId) throw new Error('ios-reset-target-owner-mismatch');
  if (actual.phase !== 'installed-before-ui') throw new Error('ios-reset-target-phase-mismatch');
}

function requireBackendBinding(actual: Row, expected: NativeComparisonAttemptExpectation): void {
  if (actual.ownerRunId !== expected.runId) throw new Error('ios-reset-backend-owner-mismatch');
  if (typeof actual.runId !== 'string' || actual.runId.length === 0)
    throw new Error('ios-reset-backend-run-missing');
  if (typeof actual.artifactRoot !== 'string' || !path.isAbsolute(actual.artifactRoot))
    throw new Error('ios-reset-backend-artifact-root-missing');
  if (typeof actual.apiOrigin !== 'string' || actual.apiOrigin.length === 0)
    throw new Error('ios-reset-backend-origin-missing');
}

function resetFromOwnedReport(
  result: OwnedIosNativeSessionResult,
  expected: NativeComparisonAttemptExpectation,
): FreshColdReset {
  if (!record(result.report)) throw new Error('ios-reset-capture-report-missing');
  if (result.report.cleanup !== 'cleaned') throw new Error('ios-reset-capture-cleanup-not-proven');
  const raw = result.report.coldReset;
  if (!record(raw)) throw new Error('ios-reset-capture-report-has-no-reset');
  if (raw.status !== 'fresh' || raw.cleanupStatus !== 'cleaned' || raw.blocker !== null)
    throw new Error('ios-reset-capture-report-reset-not-clean');
  if (raw.fixtureResetId !== expected.fixtureResetId || raw.ownerRunId !== expected.runId)
    throw new Error('ios-reset-capture-report-reset-owner-mismatch');
  if (raw.requestedRunId !== expected.runId || raw.requestedAttemptId !== expected.attemptId)
    throw new Error('ios-reset-capture-report-request-mismatch');
  const target = raw.target;
  const backend = raw.backend;
  if (!record(target) || !record(backend))
    throw new Error('ios-reset-capture-report-binding-missing');
  requireTargetBinding(target, expected);
  requireBackendBinding(backend, expected);
  if (!record(raw.originalResetBinding))
    throw new Error('ios-reset-capture-report-receipt-binding-missing');
  const binding = raw.originalResetBinding;
  if (
    binding.status !== 'verified' ||
    typeof binding.receiptPath !== 'string' ||
    typeof binding.artifactRoot !== 'string' ||
    typeof binding.receiptHash !== 'string' ||
    !HASH.test(binding.receiptHash) ||
    !record(binding.identity)
  )
    throw new Error('ios-reset-capture-report-receipt-binding-invalid');
  const artifactRoot = text(binding.artifactRoot, 'reset.originalResetBinding.artifactRoot', 4096);
  if (path.resolve(artifactRoot) !== path.resolve(result.artifactRoot))
    throw new Error('ios-reset-capture-report-artifact-root-mismatch');
  const resetEvidence = result.report.coldResetEvidence;
  if (
    !record(resetEvidence) ||
    typeof resetEvidence.path !== 'string' ||
    typeof resetEvidence.sha256 !== 'string' ||
    resetEvidence.sha256 !== binding.receiptHash
  )
    throw new Error('ios-reset-capture-report-reset-evidence-mismatch');
  const owner = text(raw.ownerRunId, 'reset.ownerRunId', 64);
  const startedAt = iso(raw.startedAt, 'reset.startedAt');
  const finishedAt = iso(raw.finishedAt, 'reset.finishedAt');
  if (Date.parse(finishedAt) < Date.parse(startedAt))
    throw new Error('ios-reset-capture-report-time-order-invalid');
  const fresh: FreshColdReset = {
    fixtureResetId: text(raw.fixtureResetId, 'reset.fixtureResetId'),
    ownerRunId: owner,
    cohortFixtureFingerprint: hash(raw.cohortFixtureFingerprint, 'reset.cohortFixtureFingerprint'),
    status: 'fresh',
    startedAt,
    finishedAt,
    appStateFingerprint: hash(raw.appStateFingerprint, 'reset.appStateFingerprint'),
    fixtureStateFingerprint: hash(raw.fixtureStateFingerprint, 'reset.fixtureStateFingerprint'),
    sourceFingerprint: hash(raw.sourceFingerprint, 'reset.sourceFingerprint'),
    helperFingerprint: hash(raw.helperFingerprint, 'reset.helperFingerprint'),
    originalResetBinding: {
      status: 'verified',
      receiptPath: text(binding.receiptPath, 'reset.originalResetBinding.receiptPath', 4096),
      artifactRoot: text(binding.artifactRoot, 'reset.originalResetBinding.artifactRoot', 4096),
      receiptHash: hash(binding.receiptHash, 'reset.originalResetBinding.receiptHash'),
      identity: structuredClone(binding.identity) as NativeEvidenceIdentity,
    },
    target: structuredClone(target),
    backend: structuredClone(backend),
    cleanupStatus: 'cleaned',
    blocker: null,
  };
  return fresh;
}

function buildIosOptions(input: {
  repositoryRoot: string;
  outputRoot: string;
  expected: NativeComparisonAttemptExpectation;
  cohort: NativeComparisonCohortExpectation;
  selection: NativePilotSelection;
  reusableBuild: QualifiedBuildReuse | null;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
}): OwnedIosNativeSessionOptions {
  if (!RUN_ID.test(input.expected.runId)) throw new Error('ios-reset-run-id-invalid');
  const supported = requireSupportedSelection(input.selection);
  if (!input.reusableBuild || input.reusableBuild.platform !== 'ios')
    throw new Error('ios-reset-build-reuse-unqualified');
  if (!RUN_ID.test(input.reusableBuild.buildId)) throw new Error('ios-reset-build-id-invalid');
  if (input.reusableBuild.sourceFingerprint !== input.cohort.sourceFingerprint)
    throw new Error('ios-reset-build-source-fingerprint-mismatch');
  if (
    input.expected.target.binaryHash !== null &&
    input.expected.target.binaryHash !== input.reusableBuild.binaryHash
  )
    throw new Error('ios-reset-build-binary-fingerprint-mismatch');
  const coldReset = {
    requestedRunId: input.expected.runId,
    requestedAttemptId: input.expected.attemptId,
    fixtureResetId: input.expected.fixtureResetId,
    cohortFixtureFingerprint: input.cohort.fixtureResetFingerprint,
    sourceFingerprint: input.cohort.sourceFingerprint,
    helperFingerprint: input.reusableBuild.helperFingerprint,
  };
  // The capture lifecycle validates all fingerprints as SHA-256 before any
  // reset receipt is published. Passing the reviewed expected values keeps
  // reset provenance bound to this exact matrix attempt.
  hash(coldReset.cohortFixtureFingerprint, 'expected fixture fingerprint');
  hash(coldReset.sourceFingerprint, 'expected source fingerprint');
  hash(coldReset.helperFingerprint, 'expected helper fingerprint');
  return {
    charter:
      supported.family === 'training'
        ? 'training-journey'
        : supported.family === 'save-retry'
          ? 'save-retry'
          : supported.family === 'connection'
            ? 'connection-journey'
            : 'camera-denied',
    requestedRunId: input.expected.runId,
    callerOutputRoot: input.outputRoot,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    reuseBuildRunId: input.reusableBuild.buildId,
    reuseBuildSourceRoot: input.repositoryRoot,
    coldReset,
    signal: input.signal,
    ...callbackForFamily(supported.family),
  };
}

export function createActualT15ColdResetDriver(
  options: ActualT15ColdResetDriverOptions = {},
): T15ColdResetDriver {
  const runIos = options.runIos ?? runOwnedIosNativeSession;
  return async (input) => {
    if (input.signal.aborted) return blockedReset(input.expected, 'cancelled-before-acquisition');
    if (
      !Number.isFinite(input.deadlineAtMonotonicMs) ||
      input.deadlineAtMonotonicMs <= performance.now()
    )
      return blockedReset(input.expected, 'deadline-before-acquisition');
    let lifecycleStarted = false;
    let ownedResult: OwnedIosNativeSessionResult | undefined;
    try {
      // Reject unsupported cells before creating even the caller namespace;
      // a blocked cell must not leave a reusable per-attempt directory behind.
      requireSupportedSelection(input.selection);
      const callerRoot = await requirePrivateCallerRoot(input.outputRoot, input.expected.runId);
      const iosOptions = buildIosOptions({
        repositoryRoot: input.repositoryRoot,
        outputRoot: callerRoot,
        expected: input.expected,
        cohort: input.cohort,
        selection: input.selection,
        reusableBuild: input.reusableBuild,
        signal: input.signal,
        deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
      });
      lifecycleStarted = true;
      ownedResult = await runIos(iosOptions);
      // A late abort after the owned lifecycle has emitted a clean reset must
      // retain that original reset row for the dispatcher’s cancelled
      // denominator; it must not be relabeled as pre-acquisition.
      if (input.signal.aborted) return resetFromOwnedReport(ownedResult, input.expected);
      // The callback deliberately terminates after the capture has written
      // `coldReset`; it is not an application pass and remains blocked until
      // the separate public child consumes the same protected binding.
      if (ownedResult.exitCode !== 2 && ownedResult.exitCode !== 0)
        throw new Error('ios-reset-capture-exit-unexpected');
      return resetFromOwnedReport(ownedResult, input.expected);
    } catch (error) {
      if (input.signal.aborted) {
        if (ownedResult) {
          try {
            return resetFromOwnedReport(ownedResult, input.expected);
          } catch {
            return blockedReset(input.expected, 'cancelled-after-acquisition-reset-unavailable');
          }
        }
        return blockedReset(
          input.expected,
          lifecycleStarted ? 'cancelled-during-reset' : 'cancelled-before-acquisition',
        );
      }
      if (error instanceof ColdResetOnlyStop)
        return blockedReset(input.expected, 'ios-reset-capture-stopped-before-report');
      if (error instanceof Error && /(unsupported|unwired)/u.test(error.message))
        return blockedReset(input.expected, error.message);
      throw error;
    }
  };
}

/**
 * Ready-to-wire native producer. The caller owns the identity map and passes
 * native 24-hex expectations so the reset and later public child share the
 * same run/attempt/target/backend binding.
 */
export function createActualT15ColdResetProducer(options: {
  repositoryRoot: string;
  outputRoot: string;
  identityMap?: Parameters<typeof createT15ColdResetProducer>[0]['identityMap'];
  runIos?: ActualIosResetExecutor;
  attemptDeadlineMs?: T15ProductionRunOptions['attemptDeadlineMs'];
}) {
  return createT15ColdResetProducer({
    repositoryRoot: options.repositoryRoot,
    outputRoot: options.outputRoot,
    identityMap: options.identityMap,
    driver: createActualT15ColdResetDriver({ runIos: options.runIos }),
    driverIdentity: 'native',
    attemptDeadlineMs: options.attemptDeadlineMs,
  });
}
