import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  runOwnedIosNativeSession,
  type OwnedIosNativeSessionOptions,
  type OwnedIosNativeSessionResult,
} from './capture-native-testability';
import {
  nativeCameraRuntimeSidecarPaths,
  stageIosCameraSubmissionEvidence,
  validateIosCameraSubmissionPreparation,
} from './native-camera-submission-evidence';
import { stageNativeConnectionPublicEvidence } from './native-connection-public-evidence';
import { requireNativePilotAssertions } from './native-pilot-contract';
import { stageNativeSaveRetryPublicEvidence } from './native-save-retry-public-evidence';
import { stageNativeTrainingPublicEvidence } from './native-training-public-evidence';
import { readNativeEvidenceObservation } from './native-view-evidence';
import { nativeCameraPublicEvidenceBindings } from './run-native-pilot';
import { assertArtifactPath, assertPublicReceipt } from './schema-validation';
import type {
  NativeComparisonAttemptExpectation,
  NativeComparisonColdAttemptIdentity,
  NativeComparisonOwnershipWindow,
  NativeComparisonReceiptInput,
} from './compare-native-pilot';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeEvidenceIdentity } from './native-view-evidence';
import type { ProxyObservation } from './owned-api-proxy';
import type {
  ColdComparisonAttemptReceipt,
  ColdComparisonOwnedAttemptInvocation,
  FreshColdReset,
  QualifiedBuildReuse,
} from './t15-cold-dispatcher';
import type { ColdResetPreparationExpectation } from './t15-cold-ios-reset-producer';

const HASH = /^[a-f0-9]{64}$/u;
const MAX_REASON = 256;

type Row = Record<string, unknown>;

type LifecycleTiming = {
  completedAt: string | null;
  outcome: 'completed' | 'failed' | null;
};

export type T15OwnedLifecycleFailure =
  | 'cancelled-before-acquisition'
  | 'cancelled-after-lifecycle'
  | 'deadline-before-acquisition'
  | 'deadline-after-lifecycle'
  | 'unsupported-platform'
  | 'unsupported-engine'
  | 'unsupported-family'
  | 'build-reuse-unqualified'
  | 'scenario-callback-unwired'
  | 'capture-failed'
  | 'reset-not-bound'
  | 'attempt-receipt-not-bound'
  | 'ownership-windows-missing'
  | 'cleanup-not-proven'
  | 'public-consumer-unwired'
  | 'public-consumer-mismatch'
  | 'owner-route-unavailable';

export type T15OwnedLifecycleScenario =
  | {
      charter: 'training-journey';
      executeTraining: NonNullable<OwnedIosNativeSessionOptions['executeTraining']>;
    }
  | {
      charter: 'save-retry';
      executeSaveRetry: NonNullable<OwnedIosNativeSessionOptions['executeSaveRetry']>;
    }
  | {
      charter: 'connection-journey';
      executeConnection: NonNullable<OwnedIosNativeSessionOptions['executeConnection']>;
    }
  | {
      charter: 'camera-denied';
      executeCamera: NonNullable<OwnedIosNativeSessionOptions['executeCamera']>;
    };

export type T15OwnedLifecycleScenarioFactory = (input: {
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  reusableBuild: QualifiedBuildReuse;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
  coldReset: ColdResetPreparationExpectation;
}) => T15OwnedLifecycleScenario;

/**
 * Production family bridge.  The bridge owns the real family producer call;
 * the generic lifecycle still owns reset, receipt, cleanup and public handoff
 * validation around the returned capture.
 */
export type T15OwnedLifecycleFamilyAttemptRunner = (input: {
  invocation: ColdComparisonOwnedAttemptInvocation;
  selection: NativePilotSelection;
  scenario?: T15OwnedLifecycleScenario;
  reusableBuild: QualifiedBuildReuse;
  coldReset: ColdResetPreparationExpectation;
  callerOutputRoot: string;
  deadlineAtMonotonicMs: number;
}) => Promise<T15OwnedLifecycleSessionResult>;

/**
 * The protected capture report remains byte-identical to the producer's
 * receipt.  Producer callback facts therefore live beside that report and
 * never get appended to it after the protected reread.
 */
export type T15OwnedLifecycleSessionResult = OwnedIosNativeSessionResult & {
  familyProducerCallbackCompleted?: boolean;
  familyProducerVerificationResult?: string;
};

export type T15OwnedPublicConsumer = (input: {
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  lifecycle: OwnedIosNativeSessionResult;
  reset: FreshColdReset;
  /** Caller-owned public receipt namespace bound by the same attempt. */
  outputRoot: string;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
}) => Promise<NativeComparisonReceiptInput | null>;

export type T15OwnedLifecycleProducerOptions = {
  repositoryRoot: string;
  outputRoot: string;
  supportedPlatform?: 'ios' | 'android';
  supportedEngine?: 'maestro' | 'detox';
  scenario?: T15OwnedLifecycleScenarioFactory;
  familyAttempt?: T15OwnedLifecycleFamilyAttemptRunner;
  consumePublic?: T15OwnedPublicConsumer;
  runOwned?: typeof runOwnedIosNativeSession;
  attemptDeadlineMs?: number;
};

type PublicStageResult = {
  assertions: readonly {
    id: string;
    requirementRefs: string[];
    outcome: 'passed';
    evidencePaths: string[];
  }[];
  artifacts: readonly string[];
};

type PublicAssertionBinding = {
  id: string;
  requirementRefs: string[];
  evidencePaths: string[];
};

export type T15OwnedLifecycleResult = ColdComparisonAttemptReceipt & {
  lifecycleStage: 'reset' | 'scenario' | 'original-receipt' | 'cleanup' | 'public-consumption';
  failure: T15OwnedLifecycleFailure | null;
};

function isRecord(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, label: string, max = 4096): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    /[\0\r\n]/u.test(value)
  )
    throw new Error(label + ' is invalid');
  return value;
}

function hash(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!HASH.test(result)) throw new Error(label + ' is not a SHA-256 hash');
  return result;
}

function iso(value: unknown, label: string): string {
  const result = text(value, label, 128);
  if (!Number.isFinite(Date.parse(result))) throw new Error(label + ' is invalid');
  return new Date(value as string).toISOString();
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isRecord(value)) {
    return (
      '{' +
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => JSON.stringify(key) + ':' + canonical(child))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

function sha256Bytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function blockedReset(
  expected: NativeComparisonAttemptExpectation,
  blocker: string,
  cohortFixtureFingerprint = expected.inputs.fixtureHash ?? 'unknown',
): FreshColdReset {
  return {
    fixtureResetId: expected.fixtureResetId,
    ownerRunId: expected.runId,
    cohortFixtureFingerprint,
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
    blocker: blocker.slice(0, MAX_REASON),
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

function blockedResult(
  input: ColdComparisonOwnedAttemptInvocation,
  failure: T15OwnedLifecycleFailure,
  issue: string,
  reset?: FreshColdReset,
): T15OwnedLifecycleResult {
  return {
    runId: input.expected.runId,
    attemptId: input.expected.attemptId,
    status:
      input.signal.aborted || failure === 'cancelled-before-acquisition'
        ? 'cancelled'
        : 'harness-blocked',
    ownerRunId: input.expected.runId,
    coldAttemptIdentity: blockedIdentity(input.expected),
    reset: reset ?? blockedReset(input.expected, issue, input.spec.cohort.fixtureResetFingerprint),
    receipt: null,
    issue,
    lifecycleStage: reset?.status === 'fresh' ? 'cleanup' : 'reset',
    failure,
  };
}

function retainedLifecycleResult(
  input: ColdComparisonOwnedAttemptInvocation,
  failure: T15OwnedLifecycleFailure,
  issue: string,
  reset: FreshColdReset,
  identity: NativeComparisonColdAttemptIdentity,
): T15OwnedLifecycleResult {
  return {
    runId: input.expected.runId,
    attemptId: input.expected.attemptId,
    status: failure === 'cancelled-after-lifecycle' ? 'cancelled' : 'harness-blocked',
    ownerRunId: input.expected.runId,
    coldAttemptIdentity: identity,
    reset,
    receipt: null,
    issue,
    lifecycleStage: 'cleanup',
    failure,
  };
}

function attemptFamily(
  selection: NativePilotSelection,
): 'training' | 'connection' | 'camera-denied' | 'save-retry' | null {
  const id = selection.scenario.id;
  const suffix = '-' + selection.arguments.platform;
  if (!id.startsWith('SCN-') || !id.endsWith(suffix)) return null;
  const family = id.slice(4, -suffix.length);
  return family === 'training' ||
    family === 'connection' ||
    family === 'camera-denied' ||
    family === 'save-retry'
    ? family
    : null;
}

function coldExpectation(
  input: ColdComparisonOwnedAttemptInvocation,
  build: QualifiedBuildReuse,
): ColdResetPreparationExpectation {
  const fixture = input.spec.cohort.fixtureResetFingerprint;
  const source = input.spec.cohort.sourceFingerprint;
  const helper = build.helperFingerprint;
  hash(fixture, 'cohort fixture fingerprint');
  hash(source, 'cohort source fingerprint');
  hash(helper, 'build helper fingerprint');
  return {
    requestedRunId: input.expected.runId,
    requestedAttemptId: input.expected.attemptId,
    fixtureResetId: input.expected.fixtureResetId,
    cohortFixtureFingerprint: fixture,
    sourceFingerprint: source,
    helperFingerprint: helper,
  };
}

async function privateAttemptRoot(parent: string, runId: string): Promise<string> {
  if (!path.isAbsolute(parent) || path.normalize(parent) !== parent)
    throw new Error('owned lifecycle output root must be absolute');
  const parentPath = await realpath(parent);
  const parentStat = await lstat(parentPath);
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    (parentStat.mode & 0o777) !== 0o700
  )
    throw new Error('owned lifecycle output root must be canonical 0700');
  const child = path.join(parentPath, runId);
  await mkdir(child, { recursive: true, mode: 0o700 });
  const childStat = await lstat(child);
  if (
    childStat.isSymbolicLink() ||
    !childStat.isDirectory() ||
    (childStat.mode & 0o777) !== 0o700 ||
    (await realpath(child)) !== child
  )
    throw new Error('owned lifecycle attempt root is not canonical 0700');
  return child;
}

function requireSameField(
  left: Row,
  right: Row,
  key: string,
  failure: T15OwnedLifecycleFailure,
): void {
  if (left[key] !== right[key]) throw new Error(failure + ':' + key);
}

function requireTargetBackendBindings(
  expected: NativeComparisonAttemptExpectation,
  raw: Row,
  captureRunId: string,
  supportedPlatform: 'ios' | 'android',
): { target: Row; backend: Row } {
  const target = raw.target;
  const backend = raw.backend;
  if (!isRecord(target) || !isRecord(backend)) throw new Error('reset-not-bound');
  requireSameField(target, backend, 'ownerRunId', 'reset-not-bound');
  if (typeof target.ownerRunId !== 'string' || target.ownerRunId !== backend.ownerRunId)
    throw new Error('reset-not-bound:ownerRunId');
  if (
    target.ownerRunId !== expected.runId &&
    (supportedPlatform !== 'android' || target.ownerRunId === captureRunId)
  )
    throw new Error('reset-not-bound:ownerRunId');
  if (target.captureRunId !== captureRunId || backend.captureRunId !== captureRunId)
    throw new Error('reset-not-bound:captureRunId');
  if (target.platform !== supportedPlatform) throw new Error('reset-not-bound:platform');
  const expectedTargetFields = ['deviceId', 'osVersion', 'appId', 'binaryHash', 'apiOrigin'];
  for (const field of expectedTargetFields) {
    const expectedValue = expected.target[field as keyof typeof expected.target];
    if (expectedValue !== null && target[field] !== expectedValue)
      throw new Error('reset-not-bound:' + field);
  }
  if (typeof backend.runId !== 'string' || backend.runId !== expected.runId)
    throw new Error('reset-not-bound:backend-runId');
  return { target, backend };
}

function requireIdentity(value: unknown, label: string): NativeEvidenceIdentity {
  if (!isRecord(value)) throw new Error(label + ' identity missing');
  const fields = ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'];
  for (const field of fields) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field]))
      throw new Error(label + ' identity invalid');
  }
  return value as NativeEvidenceIdentity;
}

function sameIdentity(left: NativeEvidenceIdentity, right: NativeEvidenceIdentity): boolean {
  return canonical(left) === canonical(right);
}

function relativeReceiptPath(root: string, receiptPath: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(receiptPath);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (
    !relative ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    path.normalize(resolvedFile) !== resolvedFile
  )
    throw new Error(label + '-outside-capture-root');
  return relative;
}

function readProtectedReceipt(
  root: string,
  receiptPath: string,
  expectedHash: string,
  expectedIdentity: NativeEvidenceIdentity,
  label: string,
): unknown {
  const observation = readNativeEvidenceObservation(
    root,
    relativeReceiptPath(root, receiptPath, label),
    true,
  );
  if (sha256Bytes(observation.bytes) !== expectedHash) throw new Error(label + '-bytes-changed');
  if (!sameIdentity(observation.identity, expectedIdentity))
    throw new Error(label + '-identity-changed');
  try {
    return JSON.parse(observation.bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error(label + '-json-invalid');
  }
}

function wrapScenarioCallback<T>(
  callback: (context: T) => Promise<void>,
  timing: LifecycleTiming,
): (context: T) => Promise<void> {
  return async (context) => {
    try {
      await callback(context);
      timing.completedAt = new Date().toISOString();
      timing.outcome = 'completed';
    } catch (error) {
      timing.completedAt = new Date().toISOString();
      timing.outcome = 'failed';
      throw error;
    }
  };
}

function attachScenario(
  options: OwnedIosNativeSessionOptions,
  scenario: T15OwnedLifecycleScenario,
  timing: LifecycleTiming,
): OwnedIosNativeSessionOptions {
  switch (scenario.charter) {
    case 'training-journey':
      return {
        ...options,
        charter: scenario.charter,
        executeTraining: wrapScenarioCallback(scenario.executeTraining, timing),
      };
    case 'save-retry':
      return {
        ...options,
        charter: scenario.charter,
        executeSaveRetry: wrapScenarioCallback(scenario.executeSaveRetry, timing),
      };
    case 'connection-journey':
      return {
        ...options,
        charter: scenario.charter,
        executeConnection: wrapScenarioCallback(scenario.executeConnection, timing),
      };
    case 'camera-denied':
      return {
        ...options,
        charter: scenario.charter,
        executeCamera: wrapScenarioCallback(scenario.executeCamera, timing),
      };
  }
}

function requireLifecycleReport(value: unknown): Row {
  if (!isRecord(value)) throw new Error('owned-lifecycle-report-missing');
  if (value.cleanup !== 'cleaned') throw new Error('cleanup-not-proven');
  return value;
}

function requireCommandLedger(
  artifactRoot: string,
  row: Row,
  expected: NativeComparisonAttemptExpectation,
): { pid: number; processStartIdentity: string; acquiredAt: string } {
  const pid = row.pid;
  if (!Number.isSafeInteger(pid) || (pid as number) <= 1)
    throw new Error('ownership-windows-process-invalid');
  if (typeof row.ownershipPath !== 'string') throw new Error('ownership-windows-missing');
  const relative = relativeReceiptPath(artifactRoot, row.ownershipPath, 'ownership-ledger');
  const observation = readNativeEvidenceObservation(artifactRoot, relative, true);
  let ledger: Row;
  try {
    const parsed = JSON.parse(observation.bytes.toString('utf8')) as unknown;
    if (!isRecord(parsed)) throw new Error('ownership-ledger-invalid');
    ledger = parsed;
  } catch {
    throw new Error('ownership-ledger-invalid');
  }
  if (ledger.cleanup !== 'cleaned') throw new Error('ownership-windows-open');
  if (!Array.isArray(ledger.processes)) throw new Error('ownership-windows-missing');
  const processRows = ledger.processes as unknown[];
  const process = processRows.find((candidate) => isRecord(candidate) && candidate.pid === pid);
  if (!isRecord(process)) throw new Error('ownership-windows-process-missing');
  const started = iso(process.started, 'ownership process started');
  const commandHash = hash(process.commandHash, 'ownership command hash');
  if (row.cleanup !== 'cleaned' || row.execution === 'harness-blocked')
    throw new Error('ownership-windows-open');
  if (row.ownerRunId !== undefined && row.ownerRunId !== expected.runId)
    throw new Error('ownership-windows-foreign');
  return {
    pid: pid as number,
    processStartIdentity: started + ':' + commandHash,
    acquiredAt: started,
  };
}

async function emitOwnedLifecycleEvidence(input: {
  invocation: ColdComparisonOwnedAttemptInvocation;
  lifecycle: OwnedIosNativeSessionResult;
  timing: LifecycleTiming;
  callerOutputRoot: string;
}): Promise<void> {
  const report = requireLifecycleReport(input.lifecycle.report);
  const captureRunId = text(
    report.captureRunId ?? path.basename(input.lifecycle.artifactRoot),
    'captureRunId',
    128,
  );
  if (captureRunId !== path.basename(input.lifecycle.artifactRoot))
    throw new Error('ownership-windows-captureRunId');
  const startedAt = iso(report.startedAt, 'capture startedAt');
  const finishedAt = iso(report.finishedAt, 'capture finishedAt');
  if (Date.parse(finishedAt) <= Date.parse(startedAt)) throw new Error('capture-time-invalid');
  if (input.timing.completedAt === null || input.timing.outcome === null)
    throw new Error('attempt-receipt-not-bound:scenario-callback');
  const completedAt = iso(input.timing.completedAt, 'scenario completedAt');
  if (
    Date.parse(completedAt) < Date.parse(startedAt) ||
    Date.parse(completedAt) > Date.parse(finishedAt)
  )
    throw new Error('attempt-receipt-time-invalid');
  const callerBinding = report.callerOutputRootBinding;
  if (!isRecord(callerBinding) || callerBinding.requestedRunId !== input.invocation.expected.runId)
    throw new Error('caller-output-root-unbound');
  if (!isRecord(callerBinding.binding) || callerBinding.binding.path !== input.callerOutputRoot)
    throw new Error('caller-output-root-unbound');
  const callerIdentity = callerBinding.binding.identity;
  if (!isRecord(callerIdentity)) throw new Error('caller-output-root-unbound');
  for (const field of ['dev', 'ino', 'uid', 'mode']) {
    if (!Number.isSafeInteger(callerIdentity[field]))
      throw new Error('caller-output-root-identity-invalid');
  }
  const callerStat = await lstat(input.callerOutputRoot);
  if (
    callerStat.isSymbolicLink() ||
    !callerStat.isDirectory() ||
    callerStat.dev !== callerIdentity.dev ||
    callerStat.ino !== callerIdentity.ino ||
    callerStat.uid !== callerIdentity.uid ||
    (callerStat.mode & 0o777) !== callerIdentity.mode
  )
    throw new Error('caller-output-root-identity-changed');
  const commandRows = report.commandExecutions;
  if (!Array.isArray(commandRows)) throw new Error('ownership-windows-missing');
  const candidates = commandRows.filter(
    (row): row is Row =>
      isRecord(row) &&
      row.execution !== 'harness-blocked' &&
      row.cleanup === 'cleaned' &&
      row.pid !== null &&
      typeof row.ownershipPath === 'string',
  );
  if (candidates.length === 0) throw new Error('ownership-windows-missing');
  const command = candidates[candidates.length - 1];
  const ownedProcess = requireCommandLedger(
    input.lifecycle.artifactRoot,
    command,
    input.invocation.expected,
  );
  const reservedPorts = report.reservedPorts;
  if (!Array.isArray(reservedPorts) || reservedPorts.length === 0)
    throw new Error('ownership-windows-port-missing');
  const ports = reservedPorts.map((value) => {
    if (!Number.isSafeInteger(value) || (value as number) < 1024 || (value as number) > 65535)
      throw new Error('ownership-windows-port-invalid');
    return value as number;
  });
  if (new Set(ports).size !== ports.length) throw new Error('ownership-windows-port-duplicate');
  const ownershipWindows: NativeComparisonOwnershipWindow[] = [
    {
      resourceType: 'process',
      resourceId: String(ownedProcess.pid),
      ownerRunId: input.invocation.expected.runId,
      processStartIdentity: ownedProcess.processStartIdentity,
      acquiredAt: ownedProcess.acquiredAt,
      releasedAt: finishedAt,
    },
    ...ports.map((port) => ({
      resourceType: 'port' as const,
      resourceId: String(port),
      ownerRunId: input.invocation.expected.runId,
      processStartIdentity: null,
      acquiredAt: startedAt,
      releasedAt: finishedAt,
    })),
  ];
  if (
    ownershipWindows.some(
      (window) => Date.parse(window.releasedAt) <= Date.parse(window.acquiredAt),
    )
  )
    throw new Error('ownership-windows-open');
  const captureObservation = readNativeEvidenceObservation(
    input.lifecycle.artifactRoot,
    'capture.private.json',
    true,
  );
  let captureReport: unknown;
  try {
    captureReport = JSON.parse(captureObservation.bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('attempt-receipt-capture-json');
  }
  if (canonical(captureReport) !== canonical(report))
    throw new Error('attempt-receipt-capture-report-mismatch');
  const captureReceipt = {
    path: path.join(input.lifecycle.artifactRoot, 'capture.private.json'),
    artifactRoot: input.lifecycle.artifactRoot,
    sha256: sha256Bytes(captureObservation.bytes),
    identity: captureObservation.identity,
  };
  const originalReceiptBody = Buffer.from(
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'private original owned terminal attempt receipt',
        runId: input.invocation.expected.runId,
        attemptId: input.invocation.expected.attemptId,
        captureRunId,
        ownerRunId: input.invocation.expected.runId,
        result: report.result,
        exitCode: input.lifecycle.exitCode,
        scenarioOutcome: input.timing.outcome,
        completedAt,
        cleanupStartedAt: completedAt,
        captureReceipt,
        target: isRecord(report.coldReset) ? report.coldReset.target : null,
        backend: isRecord(report.coldReset) ? report.coldReset.backend : null,
      },
      null,
      2,
    ) + '\n',
  );
  const originalReceiptPath = path.join(
    input.lifecycle.artifactRoot,
    'original-attempt.private.json',
  );
  await writeFile(originalReceiptPath, originalReceiptBody, { flag: 'wx', mode: 0o600 });
  const originalObservation = readNativeEvidenceObservation(
    input.lifecycle.artifactRoot,
    'original-attempt.private.json',
    true,
  );
  if (sha256Bytes(originalObservation.bytes) !== sha256Bytes(originalReceiptBody))
    throw new Error('attempt-receipt-bytes-changed');
  const terminalSidecarPath = path.join(
    input.lifecycle.artifactRoot,
    'owned-terminal.private.json',
  );
  const terminalSidecarBody = Buffer.from(
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'private-t15-owned-terminal-not-public-receipt',
        status: 'verified',
        ownerRunId: input.invocation.expected.runId,
        attemptId: input.invocation.expected.attemptId,
        captureRunId,
        artifactRoot: input.lifecycle.artifactRoot,
        processPid: ownedProcess.pid,
        processStartIdentity: ownedProcess.processStartIdentity,
        ownedPorts: ports,
        ownershipWindows,
        originalReceipt: {
          path: originalReceiptPath,
          hash: sha256Bytes(originalObservation.bytes),
          identity: originalObservation.identity,
        },
        captureReceipt,
        scenarioOutcome: input.timing.outcome,
        completedAt,
        cleanupStartedAt: completedAt,
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(terminalSidecarPath, terminalSidecarBody, { flag: 'wx', mode: 0o600 });
  const terminalSidecarObservation = readNativeEvidenceObservation(
    input.lifecycle.artifactRoot,
    'owned-terminal.private.json',
    true,
  );
  if (sha256Bytes(terminalSidecarObservation.bytes) !== sha256Bytes(terminalSidecarBody))
    throw new Error('ownership-windows-sidecar-changed');
  input.lifecycle.report.ownershipWindows = ownershipWindows;
  input.lifecycle.report.originalAttemptReceipt = {
    status: 'verified',
    runId: input.invocation.expected.runId,
    attemptId: input.invocation.expected.attemptId,
    captureRunId,
    receiptPath: originalReceiptPath,
    artifactRoot: input.lifecycle.artifactRoot,
    receiptHash: sha256Bytes(originalObservation.bytes),
    identity: originalObservation.identity,
    completedAt,
    cleanupStartedAt: completedAt,
    scenarioOutcome: input.timing.outcome,
  };
  input.lifecycle.report.ownershipWindowEvidence = {
    source: 'actual-command-ownership-ledger-and-owned-reserved-ports',
    commandLabel: command.label,
    commandOwnershipPath: command.ownershipPath,
    captureReceipt,
    terminalSidecar: {
      path: terminalSidecarPath,
      sha256: sha256Bytes(terminalSidecarObservation.bytes),
      identity: terminalSidecarObservation.identity,
    },
  };
}

function requireOwnershipWindows(
  expected: NativeComparisonAttemptExpectation,
  value: unknown,
): { identity: NativeComparisonColdAttemptIdentity; processId: string } {
  if (!isRecord(value) || !Array.isArray(value.ownershipWindows))
    throw new Error('ownership-windows-missing');
  const windows = value.ownershipWindows as unknown[];
  const process = windows.filter((row) => isRecord(row) && row.resourceType === 'process');
  const ports = windows.filter((row) => isRecord(row) && row.resourceType === 'port');
  if (process.length !== 1 || ports.length === 0) throw new Error('ownership-windows-missing');
  const normalized: NativeComparisonOwnershipWindow[] = [];
  for (const row of windows) {
    if (!isRecord(row)) throw new Error('ownership-windows-missing');
    if (row.ownerRunId !== expected.runId) throw new Error('ownership-windows-foreign');
    if (row.resourceType !== 'process' && row.resourceType !== 'port')
      throw new Error('ownership-windows-kind');
    const resourceId = text(row.resourceId, 'ownership resourceId', 128);
    const acquiredAt = iso(row.acquiredAt, 'ownership acquiredAt');
    const releasedAt = iso(row.releasedAt, 'ownership releasedAt');
    if (Date.parse(releasedAt) <= Date.parse(acquiredAt)) throw new Error('ownership-windows-open');
    const processStartIdentity =
      row.processStartIdentity === null
        ? null
        : text(row.processStartIdentity, 'processStartIdentity', 256);
    if (row.resourceType === 'process' && !processStartIdentity)
      throw new Error('ownership-windows-process-start-missing');
    normalized.push({
      resourceType: row.resourceType,
      resourceId,
      ownerRunId: expected.runId,
      processStartIdentity,
      acquiredAt,
      releasedAt,
    });
  }
  const processRow = process[0] as Row;
  const pid = Number(processRow.resourceId);
  if (!Number.isSafeInteger(pid) || pid <= 1 || !processRow.processStartIdentity)
    throw new Error('ownership-windows-process-invalid');
  const portIds = ports.map((row) => Number((row as Row).resourceId));
  if (portIds.some((port) => !Number.isSafeInteger(port) || port < 1024 || port > 65535))
    throw new Error('ownership-windows-port-invalid');
  return {
    identity: {
      ownerRunId: expected.runId,
      processPid: pid,
      processStartIdentity: processRow.processStartIdentity as string,
      ownedPorts: portIds,
      ownershipWindows: normalized,
      originalReceiptBinding: {
        status: 'pending',
        receiptPath: null,
        artifactRoot: null,
        receiptHash: null,
      },
    },
    processId: String(pid),
  };
}

function requireReset(
  input: ColdComparisonOwnedAttemptInvocation,
  lifecycle: OwnedIosNativeSessionResult,
): {
  reset: FreshColdReset;
  captureRunId: string;
  captureRoot: string;
  target: Row;
  backend: Row;
} {
  const report = lifecycle.report;
  if (!isRecord(report) || report.cleanup !== 'cleaned') throw new Error('cleanup-not-proven');
  const captureRunId = text(
    report.captureRunId ?? path.basename(lifecycle.artifactRoot),
    'captureRunId',
    128,
  );
  if (path.basename(lifecycle.artifactRoot) !== captureRunId)
    throw new Error('reset-not-bound:captureRunId');
  if (!isRecord(report.coldReset) || report.coldReset.status !== 'fresh')
    throw new Error('reset-not-bound:coldReset');
  const resetRaw = report.coldReset;
  if (
    (resetRaw.ownerRunId !== input.expected.runId &&
      (input.selection.arguments.platform !== 'android' ||
        typeof resetRaw.ownerRunId !== 'string')) ||
    resetRaw.requestedRunId !== input.expected.runId ||
    resetRaw.requestedAttemptId !== input.expected.attemptId ||
    resetRaw.fixtureResetId !== input.expected.fixtureResetId
  )
    throw new Error('reset-not-bound:attempt');
  const bindings = requireTargetBackendBindings(
    input.expected,
    resetRaw,
    captureRunId,
    input.selection.arguments.platform,
  );
  if (
    resetRaw.ownerRunId !== input.expected.runId &&
    bindings.target.ownerRunId !== resetRaw.ownerRunId
  )
    throw new Error('reset-not-bound:ownerRunId');
  const resetBinding = resetRaw.originalResetBinding;
  if (
    !isRecord(resetBinding) ||
    resetBinding.status !== 'verified' ||
    typeof resetBinding.receiptPath !== 'string' ||
    typeof resetBinding.artifactRoot !== 'string' ||
    !HASH.test(String(resetBinding.receiptHash)) ||
    resetBinding.artifactRoot !== lifecycle.artifactRoot
  )
    throw new Error('reset-not-bound:receipt');
  const originalResetIdentity = requireIdentity(resetBinding.identity, 'reset');
  const startedAt = iso(resetRaw.startedAt, 'reset.startedAt');
  const finishedAt = iso(resetRaw.finishedAt, 'reset.finishedAt');
  if (Date.parse(finishedAt) <= Date.parse(startedAt)) throw new Error('reset-not-bound:time');
  const reset: FreshColdReset = {
    fixtureResetId: input.expected.fixtureResetId,
    ownerRunId: input.expected.runId,
    cohortFixtureFingerprint: hash(resetRaw.cohortFixtureFingerprint, 'reset fixture fingerprint'),
    status: 'fresh',
    startedAt,
    finishedAt,
    appStateFingerprint: hash(resetRaw.appStateFingerprint, 'reset app state'),
    fixtureStateFingerprint: hash(resetRaw.fixtureStateFingerprint, 'reset fixture state'),
    sourceFingerprint: hash(resetRaw.sourceFingerprint, 'reset source'),
    helperFingerprint: hash(resetRaw.helperFingerprint, 'reset helper'),
    originalResetBinding: {
      status: 'verified',
      receiptPath: text(resetBinding.receiptPath, 'reset receiptPath'),
      artifactRoot: lifecycle.artifactRoot,
      receiptHash: hash(resetBinding.receiptHash, 'reset receiptHash'),
      identity: originalResetIdentity,
    },
    target: bindings.target,
    backend: bindings.backend,
    cleanupStatus: 'cleaned',
    blocker: null,
  };
  readProtectedReceipt(
    lifecycle.artifactRoot,
    String(resetBinding.receiptPath),
    String(resetBinding.receiptHash),
    originalResetIdentity,
    'reset-receipt',
  );
  return {
    reset,
    captureRunId,
    captureRoot: lifecycle.artifactRoot,
    target: bindings.target,
    backend: bindings.backend,
  };
}

function requireOriginalAttemptReceipt(
  input: ColdComparisonOwnedAttemptInvocation,
  lifecycle: OwnedIosNativeSessionResult,
  captureRunId: string,
): {
  binding: NativeComparisonColdAttemptIdentity['originalReceiptBinding'] & {
    identity: NativeEvidenceIdentity;
  };
  completedAt: string;
} {
  const report = lifecycle.report;
  const raw = report.originalAttemptReceipt;
  if (!isRecord(raw)) throw new Error('attempt-receipt-not-bound');
  if (
    raw.status !== 'verified' ||
    raw.runId !== input.expected.runId ||
    raw.attemptId !== input.expected.attemptId ||
    raw.captureRunId !== captureRunId ||
    typeof raw.receiptPath !== 'string' ||
    typeof raw.artifactRoot !== 'string' ||
    raw.artifactRoot !== lifecycle.artifactRoot
  )
    throw new Error('attempt-receipt-not-bound');
  if (raw.scenarioOutcome !== 'completed' && raw.scenarioOutcome !== 'failed')
    throw new Error('attempt-receipt-not-bound:scenario-outcome');
  const receiptHash = hash(raw.receiptHash, 'original attempt receipt hash');
  const identity = requireIdentity(raw.identity, 'original attempt receipt');
  const completedAt = iso(raw.completedAt, 'original attempt completedAt');
  const cleanupStartedAt = iso(raw.cleanupStartedAt, 'cleanupStartedAt');
  if (Date.parse(completedAt) > Date.parse(cleanupStartedAt))
    throw new Error('attempt-receipt-after-cleanup');
  const receiptBody = readProtectedReceipt(
    lifecycle.artifactRoot,
    String(raw.receiptPath),
    receiptHash,
    identity,
    'original-attempt-receipt',
  );
  if (!isRecord(receiptBody)) throw new Error('attempt-receipt-not-bound:body');
  if (
    receiptBody.runId !== input.expected.runId ||
    receiptBody.attemptId !== input.expected.attemptId ||
    receiptBody.captureRunId !== captureRunId ||
    receiptBody.ownerRunId !== input.expected.runId
  )
    throw new Error('attempt-receipt-not-bound:body-identity');
  const captureReceipt = receiptBody.captureReceipt;
  if (!isRecord(captureReceipt)) throw new Error('attempt-receipt-not-bound:capture');
  if (
    captureReceipt.artifactRoot !== lifecycle.artifactRoot ||
    typeof captureReceipt.path !== 'string' ||
    typeof captureReceipt.sha256 !== 'string'
  )
    throw new Error('attempt-receipt-not-bound:capture');
  const captureIdentity = requireIdentity(captureReceipt.identity, 'capture receipt');
  readProtectedReceipt(
    lifecycle.artifactRoot,
    String(captureReceipt.path),
    hash(captureReceipt.sha256, 'capture receipt hash'),
    captureIdentity,
    'capture-receipt',
  );
  return {
    binding: {
      status: 'verified',
      receiptPath: text(raw.receiptPath, 'original attempt receiptPath'),
      artifactRoot: lifecycle.artifactRoot,
      receiptHash,
      identity,
    },
    completedAt,
  };
}

function buildIdentity(
  expected: NativeComparisonAttemptExpectation,
  ownership: NativeComparisonColdAttemptIdentity,
  original: {
    binding: NonNullable<NativeComparisonColdAttemptIdentity['originalReceiptBinding']> & {
      identity: NativeEvidenceIdentity;
    };
  },
): NativeComparisonColdAttemptIdentity {
  return {
    ...ownership,
    ownerRunId: expected.runId,
    originalReceiptBinding: original.binding,
  };
}

function publicReceiptMatches(
  input: ColdComparisonOwnedAttemptInvocation,
  receipt: NativeComparisonReceiptInput,
  captureRunId: string,
  backend: Row,
): NativeEvidenceIdentity {
  if (
    !isRecord(receipt) ||
    typeof receipt.path !== 'string' ||
    typeof receipt.artifactRoot !== 'string'
  )
    throw new Error('public-consumer-mismatch');
  const row = receipt.receipt;
  if (
    !isRecord(row) ||
    row.runId !== input.expected.runId ||
    row.attemptId !== input.expected.attemptId
  )
    throw new Error('public-consumer-mismatch');
  if (row.captureRunId !== undefined && row.captureRunId !== captureRunId)
    throw new Error('public-consumer-mismatch:captureRunId');
  if (row.ownerRunId !== undefined && row.ownerRunId !== input.expected.runId)
    throw new Error('public-consumer-mismatch:ownerRunId');
  if (row.backendRunId !== undefined && row.backendRunId !== backend.runId)
    throw new Error('public-consumer-mismatch:backendRunId');
  const root = path.resolve(receipt.artifactRoot);
  const relative = relativeReceiptPath(root, receipt.path, 'public-receipt');
  const observation = readNativeEvidenceObservation(root, relative, true);
  if (sha256Bytes(observation.bytes) !== receipt.receiptHash)
    throw new Error('public-consumer-mismatch:receiptHash');
  let parsed: unknown;
  try {
    parsed = JSON.parse(observation.bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('public-consumer-mismatch:receipt-json');
  }
  if (canonical(parsed) !== canonical(row))
    throw new Error('public-consumer-mismatch:receipt-bytes');
  return observation.identity;
}

function parseProtectedJson(root: string, relative: string, label: string): Row {
  const observation = readNativeEvidenceObservation(root, relative, true);
  try {
    const parsed = JSON.parse(observation.bytes.toString('utf8')) as unknown;
    if (!isRecord(parsed)) throw new Error(label + ' is not an object');
    return parsed;
  } catch (error) {
    throw new Error(`${label} is invalid: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}

function requireRuntimeAdapter(
  root: string,
  expected: NativeComparisonAttemptExpectation,
  captureRunId: string,
  backendRunId: string,
  flowId: string,
): { adapter: Row; bindings: PublicAssertionBinding[] } | null {
  const relative =
    flowId === 'FLW-camera-denied'
      ? 'camera-runtime-adapter.private.json'
      : 'runtime-adapter.private.json';
  let adapter: Row;
  try {
    adapter = parseProtectedJson(root, relative, 'runtime adapter');
  } catch (error) {
    if (error instanceof Error && /ENOENT|no such file|not found/i.test(error.message)) return null;
    throw error;
  }
  if (
    adapter.requestedRunId !== expected.runId ||
    adapter.requestedAttemptId !== expected.attemptId ||
    adapter.captureRunId !== captureRunId ||
    adapter.fixtureRunId !== backendRunId ||
    adapter.callbackInvocations !== 1 ||
    adapter.callbackCompleted !== true ||
    adapter.externalCleanupResult !== 'passed' ||
    adapter.verificationResult !== 'passed' ||
    adapter.captureResult !== 'observed' ||
    adapter.captureCleanup !== 'cleaned' ||
    adapter.nativePassingCases !== 0 ||
    (adapter.postCaptureFailure !== null && adapter.postCaptureFailure !== undefined) ||
    !Array.isArray(adapter.censusFailures) ||
    adapter.censusFailures.length !== 0 ||
    !Array.isArray(adapter.outputFailures) ||
    adapter.outputFailures.length !== 0
  )
    throw new Error('public-consumer-mismatch:runtime-adapter-terminal');
  if (flowId === 'FLW-camera-denied') {
    if (!Array.isArray(adapter.assertionIds) || adapter.assertionIds.length === 0)
      throw new Error('public-consumer-mismatch:camera-assertions');
    return { adapter, bindings: [] };
  }
  if (!Array.isArray(adapter.assertionBindings) || adapter.assertionBindings.length === 0)
    throw new Error('public-consumer-mismatch:assertion-bindings');
  const bindings = adapter.assertionBindings.map((raw, index): PublicAssertionBinding => {
    if (!isRecord(raw)) throw new Error(`public-consumer-mismatch:binding-${index}`);
    if (
      typeof raw.id !== 'string' ||
      !Array.isArray(raw.requirementRefs) ||
      !Array.isArray(raw.evidencePaths) ||
      raw.requirementRefs.some((value) => typeof value !== 'string') ||
      raw.evidencePaths.some((value) => typeof value !== 'string')
    )
      throw new Error(`public-consumer-mismatch:binding-${index}`);
    const requirementRefs = raw.requirementRefs as unknown[];
    const evidencePaths = raw.evidencePaths as unknown[];
    return {
      id: raw.id,
      requirementRefs: requirementRefs.map((value) => String(value)),
      evidencePaths: evidencePaths.map((value) => String(value)),
    };
  });
  if (new Set(bindings.map((row) => row.id)).size !== bindings.length)
    throw new Error('public-consumer-mismatch:duplicate-assertion-bindings');
  return { adapter, bindings };
}

function requireProxyObservations(value: unknown): readonly ProxyObservation[] {
  if (!Array.isArray(value)) throw new Error('public-consumer-mismatch:camera-transport');
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`public-consumer-mismatch:camera-transport-${index}`);
    const requestId = raw.requestId;
    const method = raw.method;
    const pathHash = raw.pathHash;
    const requestOrigin = raw.requestOrigin;
    const requestProfile = raw.requestProfile;
    const targetOrigin = raw.targetOrigin;
    const status = raw.status;
    const outcome = raw.outcome;
    const faultAttemptId = raw.faultAttemptId;
    const elapsedMs = raw.elapsedMs;
    if (
      !Number.isSafeInteger(requestId) ||
      typeof method !== 'string' ||
      typeof pathHash !== 'string' ||
      !HASH.test(pathHash) ||
      (requestOrigin !== null && typeof requestOrigin !== 'string') ||
      (requestProfile !== 'native' && requestProfile !== 'browser') ||
      typeof targetOrigin !== 'string' ||
      !Number.isSafeInteger(status) ||
      !['forwarded', 'injected', 'rejected', 'upstream-failed'].includes(String(outcome)) ||
      (faultAttemptId !== null && typeof faultAttemptId !== 'string') ||
      typeof elapsedMs !== 'number' ||
      !Number.isFinite(elapsedMs) ||
      elapsedMs < 0
    )
      throw new Error(`public-consumer-mismatch:camera-transport-${index}`);
    return {
      requestId: requestId as number,
      method,
      pathHash,
      requestOrigin,
      requestProfile,
      targetOrigin,
      status: status as number,
      outcome: outcome as ProxyObservation['outcome'],
      faultAttemptId,
      elapsedMs,
    };
  });
}

function cameraAssertions(
  selection: NativePilotSelection,
  captureRunId: string,
): PublicAssertionBinding[] {
  const ledger = requireNativePilotAssertions(selection);
  return ledger.map((row) => {
    const binding = nativeCameraPublicEvidenceBindings[
      row.id as keyof typeof nativeCameraPublicEvidenceBindings
    ] as
      | Readonly<{
          ui?: readonly string[];
          api?: readonly string[];
          sql?: readonly string[];
        }>
      | undefined;
    if (!binding) throw new Error(`public-consumer-mismatch:camera-binding-${row.id}`);
    const evidencePaths = row.evidenceKinds.flatMap((kind) => {
      const paths = kind === 'ui' ? binding.ui : kind === 'api' ? binding.api : binding.sql;
      if (!paths || paths.length === 0)
        throw new Error(`public-consumer-mismatch:camera-evidence-${row.id}`);
      return paths.map((relative) => `evidence/${captureRunId}/${relative}`);
    });
    return {
      id: row.id,
      requirementRefs: [...row.requirementRefs],
      evidencePaths,
    };
  });
}

function assertPublicDeadline(signal: AbortSignal, deadlineAtMonotonicMs: number): void {
  if (signal.aborted) throw new Error('public-consumer-cancelled');
  if (!Number.isFinite(deadlineAtMonotonicMs) || performance.now() >= deadlineAtMonotonicMs)
    throw new Error('public-consumer-deadline');
}

function publicStageFence(
  lifecycle: { signal: AbortSignal; deadlineAtMs: number } | undefined,
  label: string,
): void {
  if (!lifecycle) return;
  assertPublicDeadline(lifecycle.signal, lifecycle.deadlineAtMs);
  if (label.length === 0) throw new Error('public-consumer-mismatch:stage-fence-label');
}

export async function stageCameraForColdConsumer(input: {
  captureRoot: string;
  outputRoot: string;
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  fixtureRunId: string;
  captureRunId: string;
  lifecycle?: { signal: AbortSignal; deadlineAtMs: number };
}): Promise<PublicStageResult> {
  publicStageFence(input.lifecycle, 'camera-preread:before-metadata');
  const metadata = parseProtectedJson(
    input.captureRoot,
    'camera-runtime-metadata.private.json',
    'camera runtime metadata',
  );
  publicStageFence(input.lifecycle, 'camera-preread:after-metadata');
  if (
    metadata.requestedRunId !== input.expected.runId ||
    metadata.captureRunId !== input.captureRunId
  )
    throw new Error('public-consumer-mismatch:camera-metadata');
  if (metadata.backendRunId !== input.fixtureRunId)
    throw new Error('public-consumer-mismatch:camera-backend');
  publicStageFence(input.lifecycle, 'camera-preread:before-capture');
  const capture = parseProtectedJson(input.captureRoot, 'capture.private.json', 'camera capture');
  publicStageFence(input.lifecycle, 'camera-preread:after-capture');
  const connectionApiIdentity = capture.connectionApiIdentity;
  if (!isRecord(connectionApiIdentity) || typeof connectionApiIdentity.targetOrigin !== 'string')
    throw new Error('public-consumer-mismatch:camera-api-origin');
  publicStageFence(input.lifecycle, 'camera-preread:before-transport');
  const transport = requireProxyObservations(
    JSON.parse(
      readNativeEvidenceObservation(
        input.captureRoot,
        'transport-observations.private.json',
        true,
      ).bytes.toString('utf8'),
    ),
  );
  publicStageFence(input.lifecycle, 'camera-preread:after-transport');
  validateIosCameraSubmissionPreparation({
    root: input.captureRoot,
    backendRunId: input.fixtureRunId,
    targetOrigin: connectionApiIdentity.targetOrigin,
    preparation: metadata.preparation,
    transport,
    captureKind: typeof capture.kind === 'string' ? capture.kind : undefined,
    captureMode: typeof capture.mode === 'string' ? capture.mode : undefined,
  });
  publicStageFence(input.lifecycle, 'camera-preread:after-validation');
  const staged = await stageIosCameraSubmissionEvidence({
    captureRoot: input.captureRoot,
    outputRoot: input.outputRoot,
    captureRunId: input.captureRunId,
    requestedRunId: input.expected.runId,
    fixtureRunId: input.fixtureRunId,
    targetOrigin: connectionApiIdentity.targetOrigin,
    preparation: metadata.preparation,
    transport,
    lifecycle: input.lifecycle,
  });
  publicStageFence(input.lifecycle, 'camera-preread:after-stage');
  if (staged.nativePassingCases !== 0)
    throw new Error('public-consumer-mismatch:camera-stage-pass-count');
  return {
    assertions: cameraAssertions(input.selection, input.captureRunId).map((row) => ({
      ...row,
      outcome: 'passed' as const,
    })),
    artifacts: [
      staged.manifestPath,
      ...nativeCameraRuntimeSidecarPaths.map((name) => `evidence/${input.captureRunId}/${name}`),
    ],
  };
}

function requirePublicTiming(report: Row): Record<string, number> {
  if (!isRecord(report.timingsMs)) throw new Error('public-consumer-mismatch:timings');
  const phases = ['build', 'install', 'reset', 'scenario', 'verify', 'cleanup'];
  const timings: Record<string, number> = {};
  for (const phase of phases) {
    const value = report.timingsMs[phase];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw new Error(`public-consumer-mismatch:timing-${phase}`);
    timings[phase] = value;
  }
  return timings;
}

function requirePublicCommand(report: Row): {
  executable: string;
  argv: string[];
  childExitCode: 0;
} {
  if (!Array.isArray(report.commandExecutions))
    throw new Error('public-consumer-mismatch:command-ledger');
  const rows = report.commandExecutions.filter(isRecord).reverse();
  const terminal = rows.find(
    (row) =>
      row.execution === 'completed' &&
      row.cleanup === 'cleaned' &&
      typeof row.command === 'string' &&
      Array.isArray(row.argv) &&
      row.argv.every((value) => typeof value === 'string') &&
      row.childExitCode === 0,
  );
  if (!terminal) throw new Error('public-consumer-mismatch:terminal-command');
  return {
    executable: text(terminal.command, 'terminal command', 512),
    argv: (terminal.argv as unknown[]).map((value) => text(value, 'terminal argv', 4096)),
    childExitCode: 0,
  };
}

function requirePublicAssertions(
  selection: NativePilotSelection,
  stage: PublicStageResult,
): PublicStageResult['assertions'] {
  const required = requireNativePilotAssertions(selection);
  const requiredIds = new Set(required.map((row) => row.id));
  if (
    stage.assertions.length !== required.length ||
    new Set(stage.assertions.map((row) => row.id)).size !== stage.assertions.length
  )
    throw new Error('public-consumer-mismatch:assertion-count');
  for (const assertion of stage.assertions) {
    if (!requiredIds.has(assertion.id) || assertion.outcome !== 'passed')
      throw new Error(`public-consumer-mismatch:assertion-${assertion.id}`);
    if (assertion.requirementRefs.length === 0 || assertion.evidencePaths.length === 0)
      throw new Error(`public-consumer-mismatch:assertion-evidence-${assertion.id}`);
  }
  if (stage.assertions.some((row) => !requiredIds.has(row.id)))
    throw new Error('public-consumer-mismatch:assertion-ledger');
  return stage.assertions;
}

function requireStagedArtifacts(
  outputRoot: string,
  artifacts: readonly string[],
): readonly string[] {
  if (artifacts.length === 0 || new Set(artifacts).size !== artifacts.length)
    throw new Error('public-consumer-mismatch:stage-artifacts');
  for (const relative of artifacts) {
    assertArtifactPath(outputRoot, relative);
    const observation = readNativeEvidenceObservation(outputRoot, relative, true);
    if (observation.bytes.length === 0)
      throw new Error(`public-consumer-mismatch:empty-stage-artifact-${relative}`);
  }
  return artifacts;
}

function requireActualBuildAndTarget(input: {
  expected: NativeComparisonAttemptExpectation;
  reset: FreshColdReset;
  lifecycle: OwnedIosNativeSessionResult;
}): Row {
  if (!isRecord(input.lifecycle.report.build))
    throw new Error('public-consumer-mismatch:build-metadata');
  const build = input.lifecycle.report.build;
  const target = input.reset.target;
  if (!isRecord(target)) throw new Error('public-consumer-mismatch:target');
  const actualBinaryHash = hash(build.binaryHash, 'captured binary hash');
  const actualSourceHash = hash(build.sourceTreeHash, 'captured source hash');
  const actualHelperHash = hash(build.helperInputsHash, 'captured helper hash');
  const environmentHash = hash(build.environmentHash, 'captured environment hash');
  const profile = text(build.profile, 'captured build profile', 256);
  for (const field of ['deviceId', 'osVersion', 'appId', 'apiOrigin']) {
    const actual = text(target[field], `captured target ${field}`, 512);
    const expected = input.expected.target[field as keyof typeof input.expected.target];
    if (expected !== null && actual !== expected)
      throw new Error(`public-consumer-mismatch:target-${field}`);
  }
  if (text(target.binaryHash, 'captured target binary hash') !== actualBinaryHash)
    throw new Error('public-consumer-mismatch:target-binary');
  if (text(build.bundleId, 'captured build bundleId') !== text(target.appId, 'target appId'))
    throw new Error('public-consumer-mismatch:build-app');
  if (text(build.apiOrigin, 'captured build apiOrigin') !== text(target.apiOrigin, 'target api'))
    throw new Error('public-consumer-mismatch:build-api');
  if (actualSourceHash !== hash(input.reset.sourceFingerprint, 'reset source fingerprint'))
    throw new Error('public-consumer-mismatch:build-source');
  if (actualHelperHash !== hash(input.reset.helperFingerprint, 'reset helper fingerprint'))
    throw new Error('public-consumer-mismatch:build-helper');
  const expectedTarget = input.expected.target;
  return {
    deviceId: text(target.deviceId, 'target deviceId'),
    osVersion: text(target.osVersion, 'target osVersion'),
    appId: text(target.appId, 'target appId'),
    buildProfile:
      expectedTarget.buildProfile === null
        ? profile
        : text(expectedTarget.buildProfile, 'expected build profile'),
    binaryHash: actualBinaryHash,
    apiOrigin: text(target.apiOrigin, 'target apiOrigin'),
    sourceTreeHash: actualSourceHash,
    helperInputsHash: actualHelperHash,
    environmentHash,
  };
}

function requirePublicInputs(input: NativeComparisonAttemptExpectation): Row {
  if (input.repositories.length === 0)
    throw new Error('public-consumer-mismatch:repository-binding');
  for (const repository of input.repositories) {
    if (
      typeof repository.name !== 'string' ||
      typeof repository.sha !== 'string' ||
      typeof repository.dirty !== 'boolean' ||
      (repository.workingTreeHash !== null && typeof repository.workingTreeHash !== 'string')
    )
      throw new Error('public-consumer-mismatch:repository-binding');
  }
  const values = input.inputs;
  for (const key of ['scenarioHash', 'requirementHash', 'flagsHash'] as const)
    hash(values[key], `expected ${key}`);
  if (values.fixtureHash !== null) hash(values.fixtureHash, 'expected fixtureHash');
  if (
    !isRecord(values.toolVersions) ||
    Object.keys(values.toolVersions).length === 0 ||
    Object.values(values.toolVersions).some(
      (value) => typeof value !== 'string' || value.length === 0,
    )
  )
    throw new Error('public-consumer-mismatch:tool-versions');
  return {
    scenarioHash: values.scenarioHash,
    requirementHash: values.requirementHash,
    fixtureHash: values.fixtureHash,
    flagsHash: values.flagsHash,
    toolVersions: values.toolVersions,
  };
}

async function buildQualifiedPublicReceipt(input: {
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  lifecycle: OwnedIosNativeSessionResult;
  reset: FreshColdReset;
  outputRoot: string;
  captureRunId: string;
  backend: Row;
  adapter: Row;
  stage: PublicStageResult;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
}): Promise<NativeComparisonReceiptInput> {
  assertPublicDeadline(input.signal, input.deadlineAtMonotonicMs);
  if (input.lifecycle.exitCode !== 0 || input.lifecycle.report.result !== 'passed')
    throw new Error('public-consumer-mismatch:original-attempt-not-passed');
  if (input.lifecycle.report.cleanup !== 'cleaned')
    throw new Error('public-consumer-mismatch:cleanup');
  if (input.reset.status !== 'fresh' || input.reset.cleanupStatus !== 'cleaned')
    throw new Error('public-consumer-mismatch:reset');
  if (
    input.reset.originalResetBinding.status !== 'verified' ||
    input.reset.originalResetBinding.identity === undefined
  )
    throw new Error('public-consumer-mismatch:reset-receipt');
  const report = input.lifecycle.report;
  if (
    !isRecord(report.originalAttemptReceipt) ||
    report.originalAttemptReceipt.status !== 'verified' ||
    report.originalAttemptReceipt.runId !== input.expected.runId ||
    report.originalAttemptReceipt.attemptId !== input.expected.attemptId ||
    report.originalAttemptReceipt.captureRunId !== input.captureRunId
  )
    throw new Error('public-consumer-mismatch:original-receipt');
  if (!Array.isArray(report.ownershipWindows) || report.ownershipWindows.length < 2)
    throw new Error('public-consumer-mismatch:ownership-windows');
  if (
    report.ownershipWindows.some(
      (row) =>
        !isRecord(row) ||
        row.ownerRunId !== input.expected.runId ||
        typeof row.acquiredAt !== 'string' ||
        typeof row.releasedAt !== 'string' ||
        Date.parse(row.releasedAt) <= Date.parse(row.acquiredAt),
    )
  )
    throw new Error('public-consumer-mismatch:ownership-window-state');
  const target = requireActualBuildAndTarget(input);
  const inputs = requirePublicInputs(input.expected);
  const timingsMs = requirePublicTiming(report);
  const command = requirePublicCommand(report);
  const assertions = requirePublicAssertions(input.selection, input.stage);
  const artifacts = requireStagedArtifacts(input.outputRoot, input.stage.artifacts);
  assertPublicDeadline(input.signal, input.deadlineAtMonotonicMs);
  const startedAt = iso(report.startedAt, 'public startedAt');
  const finishedAt = iso(report.finishedAt, 'public finishedAt');
  if (Date.parse(finishedAt) <= Date.parse(startedAt))
    throw new Error('public-consumer-mismatch:attempt-time');
  const ownershipWindows = report.ownershipWindows as unknown[];
  const ownedResourceIds = ownershipWindows.map((raw) => {
    if (!isRecord(raw)) throw new Error('public-consumer-mismatch:ownership-window-state');
    return text(raw.resourceId, 'resourceId');
  });
  if (new Set(ownedResourceIds).size !== ownedResourceIds.length)
    throw new Error('public-consumer-mismatch:resource-ids');
  const diagnosticsPath = 'cold-public-terminal-diagnostics.private.json';
  const diagnostics = {
    schemaVersion: 1,
    kind: 'private-t15-cold-public-terminal-diagnostics',
    publicPromotionEligible: true,
    nativePassingCases: assertions.length,
    runId: input.expected.runId,
    attemptId: input.expected.attemptId,
    captureRunId: input.captureRunId,
    backendRunId: input.backend.runId,
    reset: input.reset.originalResetBinding,
    ownershipWindows,
    originalAttemptReceipt: report.originalAttemptReceipt,
    adapter: {
      kind: input.adapter.kind,
      callbackInvocations: input.adapter.callbackInvocations,
      callbackCompleted: input.adapter.callbackCompleted,
      verificationResult: input.adapter.verificationResult,
      externalCleanupResult: input.adapter.externalCleanupResult,
      captureResult: input.adapter.captureResult,
      captureCleanup: input.adapter.captureCleanup,
    },
    stage: { assertions, artifacts },
    build: {
      sourceTreeHash: target.sourceTreeHash,
      helperInputsHash: target.helperInputsHash,
      environmentHash: target.environmentHash,
    },
  };
  const diagnosticsBytes = Buffer.from(JSON.stringify(diagnostics, null, 2) + '\n');
  await writeFile(path.join(input.outputRoot, diagnosticsPath), diagnosticsBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  const diagnosticsObservation = readNativeEvidenceObservation(
    input.outputRoot,
    diagnosticsPath,
    true,
  );
  if (sha256Bytes(diagnosticsObservation.bytes) !== sha256Bytes(diagnosticsBytes))
    throw new Error('public-consumer-mismatch:diagnostics-write');
  const receiptRow = {
    schemaVersion: 1,
    runId: input.expected.runId,
    attemptId: input.expected.attemptId,
    scenarioId: input.selection.scenario.id,
    phase: 'P4',
    layer: 'native',
    engine: input.selection.arguments.engine,
    dataMode: input.selection.scenario.dataMode,
    platform: input.selection.arguments.platform,
    locale: input.expected.locale,
    repositories: input.expected.repositories,
    target: {
      deviceId: target.deviceId,
      osVersion: target.osVersion,
      appId: target.appId,
      buildProfile: target.buildProfile,
      binaryHash: target.binaryHash,
      apiOrigin: target.apiOrigin,
    },
    inputs,
    command: { executable: command.executable, argv: command.argv },
    startedAt,
    finishedAt,
    result: 'passed',
    exitCode: 0,
    childExitCode: command.childExitCode,
    assertions,
    timingsMs,
    cleanup: { status: 'cleaned', ownedResourceIds, recoveryRecordPath: null },
    artifacts: [...artifacts, diagnosticsPath],
    blocker: null,
  };
  assertPublicReceipt(receiptRow, input.outputRoot);
  const receiptBytes = Buffer.from(JSON.stringify(receiptRow, null, 2) + '\n');
  const receiptPath = path.join(input.outputRoot, 'cold-public-receipt.private.json');
  await writeFile(receiptPath, receiptBytes, { flag: 'wx', mode: 0o600 });
  const observation = readNativeEvidenceObservation(
    input.outputRoot,
    'cold-public-receipt.private.json',
    true,
  );
  if (sha256Bytes(observation.bytes) !== sha256Bytes(receiptBytes))
    throw new Error('public-consumer-mismatch:receipt-write');
  assertPublicReceipt(receiptRow, input.outputRoot);
  return {
    path: receiptPath,
    artifactRoot: input.outputRoot,
    receipt: receiptRow,
    receiptHash: sha256Bytes(observation.bytes),
  };
}

async function writeBlockedPublicReceipt(input: {
  expected: NativeComparisonAttemptExpectation;
  outputRoot: string;
  captureRunId: string;
  fixtureRunId: string;
  backend: Row;
  report: Row;
  adapter: Row;
  stage: PublicStageResult;
  reason: string;
}): Promise<NativeComparisonReceiptInput> {
  const receiptRow = {
    schemaVersion: 1,
    kind: 'private-t15-cold-public-consumption-not-public-pass',
    result: 'harness-blocked',
    runId: input.expected.runId,
    attemptId: input.expected.attemptId,
    captureRunId: input.captureRunId,
    ownerRunId: input.expected.runId,
    backendRunId: input.backend.runId,
    fixtureRunId: input.fixtureRunId,
    target: isRecord(input.report.coldReset) ? input.report.coldReset.target : null,
    backend: input.backend,
    lifecycle: {
      cleanup: input.report.cleanup,
      ownershipWindows: input.report.ownershipWindows,
      originalAttemptReceipt: input.report.originalAttemptReceipt,
    },
    adapter: {
      kind: input.adapter.kind,
      callbackInvocations: input.adapter.callbackInvocations,
      callbackCompleted: input.adapter.callbackCompleted,
      verificationResult: input.adapter.verificationResult,
      nativePassingCases: input.adapter.nativePassingCases,
    },
    stage: input.stage,
    nativePassingCases: 0,
    publicPromotionEligible: false,
    blocker: input.reason.slice(0, MAX_REASON),
  };
  const receiptBytes = Buffer.from(JSON.stringify(receiptRow, null, 2) + '\n');
  const receiptPath = path.join(input.outputRoot, 'cold-public-receipt.private.json');
  await writeFile(receiptPath, receiptBytes, { flag: 'wx', mode: 0o600 });
  const observation = readNativeEvidenceObservation(
    input.outputRoot,
    'cold-public-receipt.private.json',
    true,
  );
  if (sha256Bytes(observation.bytes) !== sha256Bytes(receiptBytes))
    throw new Error('public-consumer-mismatch:receipt-write');
  let persistedReceipt: unknown;
  try {
    persistedReceipt = JSON.parse(observation.bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('public-consumer-mismatch:receipt-json');
  }
  if (!isRecord(persistedReceipt)) throw new Error('public-consumer-mismatch:receipt-object');
  return {
    path: receiptPath,
    artifactRoot: input.outputRoot,
    // Return the protected reread so JSON omission of undefined optional
    // diagnostics cannot make the caller compare a different in-memory row.
    receipt: persistedReceipt,
    receiptHash: sha256Bytes(observation.bytes),
  };
}

export function createT15OwnedPublicConsumer(options: {
  repositoryRoot: string;
}): T15OwnedPublicConsumer {
  if (!path.isAbsolute(options.repositoryRoot))
    throw new Error('T15 public consumer repository root must be absolute');
  return async (input) => {
    assertPublicDeadline(input.signal, input.deadlineAtMonotonicMs);
    const report = requireLifecycleReport(input.lifecycle.report);
    const captureRunId = text(
      report.captureRunId ?? path.basename(input.lifecycle.artifactRoot),
      'public captureRunId',
      128,
    );
    const backend = report.backend;
    if (!isRecord(backend) || typeof backend.runId !== 'string')
      throw new Error('public-consumer-mismatch:backend');
    const adapterResult = requireRuntimeAdapter(
      input.lifecycle.artifactRoot,
      input.expected,
      captureRunId,
      backend.runId,
      input.selection.scenario.flowId,
    );
    if (!adapterResult) return null;
    const { adapter, bindings } = adapterResult;
    const fixtureRunId = text(String(adapter.fixtureRunId), 'public fixtureRunId', 128);
    let stage: PublicStageResult = { assertions: [], artifacts: [] };
    try {
      switch (input.selection.scenario.flowId) {
        case 'FLW-training':
          stage = await stageNativeTrainingPublicEvidence({
            captureRoot: input.lifecycle.artifactRoot,
            outputRoot: input.outputRoot,
            requestedRunId: input.expected.runId,
            fixtureRunId,
            selection: input.selection,
            bindings,
            lifecycle: {
              signal: input.signal,
              deadlineAtMs: input.deadlineAtMonotonicMs,
            },
          });
          break;
        case 'FLW-connection':
          stage = await stageNativeConnectionPublicEvidence({
            repositoryRoot: options.repositoryRoot,
            captureRoot: input.lifecycle.artifactRoot,
            outputRoot: input.outputRoot,
            requestedRunId: input.expected.runId,
            fixtureRunId,
            selection: input.selection,
            bindings,
            platform: 'ios',
            lifecycle: {
              signal: input.signal,
              deadlineAtMs: input.deadlineAtMonotonicMs,
            },
          });
          break;
        case 'FLW-save-retry':
          stage = await stageNativeSaveRetryPublicEvidence({
            repositoryRoot: options.repositoryRoot,
            captureRoot: input.lifecycle.artifactRoot,
            outputRoot: input.outputRoot,
            requestedRunId: input.expected.runId,
            fixtureRunId,
            selection: input.selection,
            bindings,
            lifecycle: {
              signal: input.signal,
              deadlineAtMs: input.deadlineAtMonotonicMs,
            },
          });
          break;
        case 'FLW-camera-denied':
          stage = await stageCameraForColdConsumer({
            captureRoot: input.lifecycle.artifactRoot,
            outputRoot: input.outputRoot,
            expected: input.expected,
            selection: input.selection,
            fixtureRunId,
            captureRunId,
            lifecycle: {
              signal: input.signal,
              deadlineAtMs: input.deadlineAtMonotonicMs,
            },
          });
          break;
        default:
          throw new Error('public-consumer-unwired:unsupported-family');
      }
      assertPublicDeadline(input.signal, input.deadlineAtMonotonicMs);
      return await buildQualifiedPublicReceipt({
        expected: input.expected,
        selection: input.selection,
        lifecycle: input.lifecycle,
        reset: input.reset,
        outputRoot: input.outputRoot,
        captureRunId,
        backend,
        adapter,
        stage,
        signal: input.signal,
        deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
      });
    } catch (error) {
      // Stage/verification failures retain a truthful blocked receipt. An
      // expired or cancelled caller cannot publish even that terminal row.
      assertPublicDeadline(input.signal, input.deadlineAtMonotonicMs);
      return writeBlockedPublicReceipt({
        expected: input.expected,
        outputRoot: input.outputRoot,
        captureRunId,
        fixtureRunId,
        backend,
        report,
        adapter,
        stage,
        reason: error instanceof Error ? error.message : 'public-terminal-not-eligible',
      });
    }
  };
}

function statusFromPublicReceipt(
  receipt: NativeComparisonReceiptInput,
): ColdComparisonAttemptReceipt['status'] {
  const row = receipt.receipt;
  if (!isRecord(row)) return 'harness-blocked';
  if (row.result === 'passed') return 'received';
  if (row.result === 'application-failed') return 'application-failed';
  if (row.result === 'cancelled') return 'cancelled';
  return 'harness-blocked';
}

function terminalIssue(receipt: NativeComparisonReceiptInput): string | null {
  const row = receipt.receipt;
  if (!isRecord(row)) return 'public-consumer-mismatch';
  return row.result === 'passed' || row.result === 'application-failed'
    ? null
    : 'public-terminal-not-eligible';
}

function lifecycleFailure(
  input: ColdComparisonOwnedAttemptInvocation,
  failure: T15OwnedLifecycleFailure,
  issue: string,
  reset?: FreshColdReset,
): T15OwnedLifecycleResult {
  return blockedResult(input, failure, issue, reset);
}

function chooseScenario(
  input: ColdComparisonOwnedAttemptInvocation,
  options: T15OwnedLifecycleProducerOptions,
  build: QualifiedBuildReuse,
  coldReset: ColdResetPreparationExpectation,
  deadlineAtMonotonicMs: number,
): T15OwnedLifecycleScenario {
  if (!options.scenario) throw new Error('scenario-callback-unwired');
  if (input.selection.arguments.platform !== (options.supportedPlatform ?? 'ios'))
    throw new Error('unsupported-platform');
  if (input.selection.arguments.engine !== (options.supportedEngine ?? 'maestro'))
    throw new Error('unsupported-engine');
  if (input.selection.arguments.mode !== 'integration') throw new Error('unsupported-engine');
  if (!attemptFamily(input.selection)) throw new Error('unsupported-family');
  const scenario = options.scenario({
    expected: input.expected,
    selection: input.selection,
    reusableBuild: build,
    signal: input.signal,
    deadlineAtMonotonicMs,
    coldReset,
  });
  if (!scenario || typeof scenario !== 'object') throw new Error('scenario-callback-unwired');
  return scenario;
}

export function createT15OwnedLifecycleProducer(
  options: T15OwnedLifecycleProducerOptions,
): (input: ColdComparisonOwnedAttemptInvocation) => Promise<T15OwnedLifecycleResult> {
  const runOwned = options.runOwned ?? runOwnedIosNativeSession;
  const supportedPlatform = options.supportedPlatform ?? 'ios';
  const configuredDeadlineMs = options.attemptDeadlineMs ?? 600_000;
  if (
    !Number.isSafeInteger(configuredDeadlineMs) ||
    configuredDeadlineMs < 100 ||
    configuredDeadlineMs > 600_000
  )
    throw new Error('owned lifecycle deadline outside allowed bound');
  return async (input) => {
    if (input.signal.aborted)
      return lifecycleFailure(input, 'cancelled-before-acquisition', 'cancelled');
    if (!input.reusableBuild || input.reusableBuild.platform !== supportedPlatform)
      return lifecycleFailure(input, 'build-reuse-unqualified', 'build-reuse-unqualified');
    const deadlineAt = input.deadlineAtMonotonicMs;
    const remainingMs = deadlineAt - performance.now();
    if (!Number.isFinite(deadlineAt) || !Number.isFinite(remainingMs))
      return lifecycleFailure(input, 'deadline-before-acquisition', 'deadline-invalid');
    if (remainingMs < 100)
      return lifecycleFailure(input, 'deadline-before-acquisition', 'deadline-before-acquisition');
    if (remainingMs > configuredDeadlineMs)
      return lifecycleFailure(input, 'deadline-before-acquisition', 'deadline-exceeds-bound');
    const coldReset = coldExpectation(input, input.reusableBuild);
    let scenario: T15OwnedLifecycleScenario | undefined;
    try {
      if (options.scenario) {
        scenario = chooseScenario(input, options, input.reusableBuild, coldReset, deadlineAt);
      } else if (!options.familyAttempt) {
        throw new Error('scenario-callback-unwired');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'scenario-unwired';
      const failure =
        message === 'unsupported-platform'
          ? 'unsupported-platform'
          : message === 'unsupported-engine'
            ? 'unsupported-engine'
            : message === 'unsupported-family'
              ? 'unsupported-family'
              : message === 'scenario-callback-unwired'
                ? 'scenario-callback-unwired'
                : 'scenario-callback-unwired';
      return lifecycleFailure(input, failure, message);
    }
    const callerOutputRoot = await privateAttemptRoot(options.outputRoot, input.expected.runId);
    const timing: LifecycleTiming = { completedAt: null, outcome: null };
    let lifecycle: T15OwnedLifecycleSessionResult;
    try {
      if (options.familyAttempt) {
        lifecycle = await options.familyAttempt({
          invocation: input,
          selection: input.selection,
          scenario,
          reusableBuild: input.reusableBuild,
          coldReset,
          callerOutputRoot,
          deadlineAtMonotonicMs: deadlineAt,
        });
        timing.completedAt = new Date().toISOString();
        timing.outcome =
          lifecycle.familyProducerCallbackCompleted === false ||
          lifecycle.report.result === 'application-failed'
            ? 'failed'
            : 'completed';
      } else if (scenario) {
        const ownedOptions: OwnedIosNativeSessionOptions = {
          charter: scenario.charter,
          requestedRunId: input.expected.runId,
          callerOutputRoot,
          deadlineAtMonotonicMs: deadlineAt,
          reuseBuildRunId: input.reusableBuild.buildId,
          reuseBuildSourceRoot: options.repositoryRoot,
          coldReset,
          signal: input.signal,
        };
        lifecycle = await runOwned(attachScenario(ownedOptions, scenario, timing));
      } else {
        return lifecycleFailure(input, 'scenario-callback-unwired', 'scenario-callback-unwired');
      }
    } catch (error) {
      if (input.signal.aborted)
        return lifecycleFailure(input, 'cancelled-before-acquisition', 'owned-lifecycle-cancelled');
      return lifecycleFailure(
        input,
        'capture-failed',
        error instanceof Error ? error.message : 'owned-lifecycle-failed',
      );
    }
    let parsed: Awaited<ReturnType<typeof requireReset>> | undefined;
    let original: Awaited<ReturnType<typeof requireOriginalAttemptReceipt>> | undefined;
    let ownership: { identity: NativeComparisonColdAttemptIdentity; processId: string };
    try {
      await emitOwnedLifecycleEvidence({
        invocation: input,
        lifecycle,
        timing,
        callerOutputRoot,
      });
      parsed = requireReset(input, lifecycle);
      ownership = requireOwnershipWindows(input.expected, lifecycle.report);
      original = requireOriginalAttemptReceipt(input, lifecycle, parsed.captureRunId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'lifecycle-binding-invalid';
      const known: T15OwnedLifecycleFailure = message.startsWith('ownership-windows')
        ? 'ownership-windows-missing'
        : message.startsWith('cleanup')
          ? 'cleanup-not-proven'
          : message.startsWith('attempt-receipt') || message.startsWith('attempt-receipt-after')
            ? 'attempt-receipt-not-bound'
            : 'reset-not-bound';
      return lifecycleFailure(input, known, message, parsed?.reset);
    }
    const identity = buildIdentity(input.expected, ownership.identity, original);
    if (input.signal.aborted)
      return retainedLifecycleResult(
        input,
        'cancelled-after-lifecycle',
        'cancelled-after-owned-lifecycle',
        parsed.reset,
        identity,
      );
    if (performance.now() >= deadlineAt)
      return retainedLifecycleResult(
        input,
        'deadline-after-lifecycle',
        'owned-lifecycle-deadline-exceeded',
        parsed.reset,
        identity,
      );
    if (!options.consumePublic)
      return retainedLifecycleResult(
        input,
        'public-consumer-unwired',
        'public-consumer-unwired-after-cleanup',
        parsed.reset,
        identity,
      );
    let receipt: NativeComparisonReceiptInput | null;
    try {
      receipt = await options.consumePublic({
        expected: input.expected,
        selection: input.selection,
        lifecycle,
        reset: parsed.reset,
        outputRoot: callerOutputRoot,
        signal: input.signal,
        deadlineAtMonotonicMs: deadlineAt,
      });
    } catch (error) {
      return retainedLifecycleResult(
        input,
        'public-consumer-mismatch',
        error instanceof Error ? error.message : 'public-consumer-failed',
        parsed.reset,
        identity,
      );
    }
    if (!receipt)
      return retainedLifecycleResult(
        input,
        'public-consumer-unwired',
        'public-consumer-returned-no-receipt',
        parsed.reset,
        identity,
      );
    let publicReceiptIdentity: NativeEvidenceIdentity;
    try {
      publicReceiptIdentity = publicReceiptMatches(
        input,
        receipt,
        parsed.captureRunId,
        parsed.backend,
      );
    } catch (error) {
      return retainedLifecycleResult(
        input,
        'public-consumer-mismatch',
        error instanceof Error ? error.message : 'public-consumer-mismatch',
        parsed.reset,
        identity,
      );
    }
    const publicIdentity: NativeComparisonColdAttemptIdentity & {
      originalReceiptBinding: NativeComparisonColdAttemptIdentity['originalReceiptBinding'] & {
        identity: NativeEvidenceIdentity;
      };
    } = {
      ...identity,
      originalReceiptBinding: {
        status: 'verified',
        receiptPath: receipt.path,
        artifactRoot: receipt.artifactRoot,
        receiptHash: receipt.receiptHash,
        identity: publicReceiptIdentity,
      },
    };
    const status = statusFromPublicReceipt(receipt);
    const issue = terminalIssue(receipt);
    return {
      runId: input.expected.runId,
      attemptId: input.expected.attemptId,
      status,
      ownerRunId: input.expected.runId,
      coldAttemptIdentity: publicIdentity,
      reset: parsed.reset,
      receipt,
      issue,
      lifecycleStage: 'public-consumption',
      failure: issue ? 'public-consumer-mismatch' : null,
    };
  };
}

/**
 * Route-aware owner selection. Temporal validation happens before route
 * selection so unavailable Android/Detox cells still return the same
 * fail-closed cancelled, expired, non-finite, and over-bound outcomes without
 * acquiring a target, backend, proxy, or build.
 */
export function createT15PlatformEngineAwareOwnedLifecycleProducer(options: {
  ios: T15OwnedLifecycleProducerOptions;
  androidMaestro?: T15OwnedLifecycleProducerOptions;
  attemptDeadlineMs?: number;
}): (input: ColdComparisonOwnedAttemptInvocation) => Promise<T15OwnedLifecycleResult> {
  const configuredDeadlineMs = options.attemptDeadlineMs ?? 600_000;
  if (
    !Number.isSafeInteger(configuredDeadlineMs) ||
    configuredDeadlineMs < 100 ||
    configuredDeadlineMs > 600_000
  )
    throw new Error('platform-aware lifecycle deadline outside allowed bound');
  const iosOwner = createT15OwnedLifecycleProducer({
    ...options.ios,
    supportedPlatform: 'ios',
    supportedEngine: 'maestro',
    attemptDeadlineMs: configuredDeadlineMs,
  });
  const androidOwner = options.androidMaestro
    ? createT15OwnedLifecycleProducer({
        ...options.androidMaestro,
        supportedPlatform: 'android',
        supportedEngine: 'maestro',
        attemptDeadlineMs: configuredDeadlineMs,
      })
    : null;
  return async (input) => {
    if (input.signal.aborted)
      return lifecycleFailure(input, 'cancelled-before-acquisition', 'cancelled');
    const deadlineAt = input.deadlineAtMonotonicMs;
    const remainingMs = deadlineAt - performance.now();
    if (!Number.isFinite(deadlineAt) || !Number.isFinite(remainingMs))
      return lifecycleFailure(input, 'deadline-before-acquisition', 'deadline-invalid');
    if (remainingMs < 100)
      return lifecycleFailure(input, 'deadline-before-acquisition', 'deadline-before-acquisition');
    if (remainingMs > configuredDeadlineMs)
      return lifecycleFailure(input, 'deadline-before-acquisition', 'deadline-exceeds-bound');
    const { platform, engine } = input.selection.arguments;
    if (platform === 'ios' && engine === 'maestro') return iosOwner(input);
    if (platform === 'android' && engine === 'maestro' && androidOwner) return androidOwner(input);
    return lifecycleFailure(
      input,
      'owner-route-unavailable',
      `owner-route-unavailable:${platform}/${engine}`,
    );
  };
}

export const t15OwnedLifecycleContract = {
  order: ['reset', 'scenario', 'original-receipt', 'cleanup', 'public-consumption'] as const,
  rejectsCleanedResetChildSubstitution: true,
  rejectsForeignTargetBackend: true,
  requiresClosedOwnershipWindows: true,
  requiresOriginalReceiptBeforeCleanup: true,
  nativeExecution: 'not-run' as const,
  publicPromotionEligible: false as const,
};
