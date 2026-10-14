import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  collectIosCredentialEntryDiagnostic,
  iosCredentialEntryDiagnosticSelectors,
  type IosCredentialEntryDiagnosticActionKind,
  type IosCredentialEntryDiagnosticActionStatus,
  type IosCredentialEntryDiagnosticAppBoundary,
  type IosCredentialEntryDiagnosticKeyboardState,
  type IosCredentialEntryDiagnosticResult,
  type IosCredentialEntryDiagnosticSnapshot,
  type IosCredentialEntryDiagnosticStage,
} from './ios-credential-entry-diagnostic';
import type { NativeCommandExecution } from './owned-native-command';

export type OwnedIosCredentialCommandExecution = NativeCommandExecution & {
  label: string;
  deadlineMs: number;
  command: string;
  argv: string[];
  flowSha256?: string;
  ownershipReceiptSha256?: string;
  startIdentity?: {
    pid: number;
    pgid: number;
    started: string;
    commandHash: string;
  };
};

export type IosCredentialEntryOwnedBinding = {
  captureRunId: string;
  fixtureRunId: string;
  fixtureScope: 'native-entry-ios';
  backendRunId: string;
  backendAttemptId: string;
  scope: 'native-entry-ios';
  semanticSelector: typeof iosCredentialEntryDiagnosticSelectors.email;
  deviceId: string;
  runtime: string;
  bundleId: string;
  binaryHash: string;
  sourceTreeHash: string;
  sourceTreeHashAfter: string;
  helperInputsHash: string;
  helperInputsAfterHash: string;
  apiOrigin: string;
  apiPid: number;
};

export type IosCredentialEntryOwnedStageInput = {
  stage: IosCredentialEntryDiagnosticStage;
  sequence: number;
  actionKind: IosCredentialEntryDiagnosticActionKind;
  selector: string | null;
  actionStatus: IosCredentialEntryDiagnosticActionStatus;
  actionLabel: string | null;
  hierarchyLabel: string;
  screenshotLabel: string;
  actionExecution: OwnedIosCredentialCommandExecution | null;
  actionFlowSha256: string | null;
  assertionExecution: OwnedIosCredentialCommandExecution | null;
  assertionLabel: string | null;
  assertionFlowSha256: string | null;
  hierarchyExecution: OwnedIosCredentialCommandExecution | null;
  screenshotExecution: OwnedIosCredentialCommandExecution | null;
  postAssertionHierarchyExecution: OwnedIosCredentialCommandExecution | null;
  postAssertionScreenshotExecution: OwnedIosCredentialCommandExecution | null;
  postAssertionHierarchyLabel: string | null;
  postAssertionScreenshotLabel: string | null;
  commandExecutions: readonly OwnedIosCredentialCommandExecution[];
  hierarchy: unknown;
  hierarchyBytes: Buffer | null;
  screenshotBytes: Buffer | null;
  hierarchyPath: string | null;
  screenshotPath: string | null;
  postAssertionHierarchy: unknown;
  postAssertionHierarchyBytes: Buffer | null;
  postAssertionHierarchyPath: string | null;
  postAssertionScreenshotBytes: Buffer | null;
  postAssertionScreenshotPath: string | null;
  keyboard: IosCredentialEntryDiagnosticKeyboardState;
  appBoundary: IosCredentialEntryDiagnosticAppBoundary;
  expectedEmail: string;
};

type PrivateCommandReceipt = {
  label: string;
  command: string;
  argv: string[];
  phase: NativeCommandExecution['phase'];
  execution: NativeCommandExecution['execution'];
  cleanup: NativeCommandExecution['cleanup'];
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  deadlineMs: number;
  elapsedMs: number;
  cleanupMs: number;
  logPath: string | null;
  ownershipPath: string | null;
  flowSha256: string | null;
  ownershipReceiptSha256: string | null;
  startIdentity: OwnedIosCredentialCommandExecution['startIdentity'] | null;
};

export type IosCredentialEntryOwnedStageReceipt = {
  stage: IosCredentialEntryDiagnosticStage;
  sequence: number;
  actionKind: IosCredentialEntryDiagnosticActionKind;
  selector: string | null;
  actionStatus: IosCredentialEntryDiagnosticActionStatus;
  actionExecution: PrivateCommandReceipt | null;
  assertionExecution: PrivateCommandReceipt | null;
  assertionFlowSha256: string | null;
  hierarchyExecution: PrivateCommandReceipt | null;
  screenshotExecution: PrivateCommandReceipt | null;
  postAssertionHierarchyExecution: PrivateCommandReceipt | null;
  postAssertionScreenshotExecution: PrivateCommandReceipt | null;
  postAssertionHierarchyPath: string | null;
  postAssertionScreenshotPath: string | null;
  hierarchyPath: string | null;
  screenshotPath: string | null;
  hierarchySha256: string | null;
  screenshotSha256: string | null;
  postAssertionHierarchySha256: string | null;
  postAssertionScreenshotSha256: string | null;
  commandReceiptSha256: string;
  exactValueBound: boolean | null;
};

export type IosCredentialEntryOwnedDiagnostic = {
  result: IosCredentialEntryDiagnosticResult;
  receipts: readonly IosCredentialEntryOwnedStageReceipt[];
};

export type IosCredentialEntryOwnedEvidenceReport = {
  credentialEntryDiagnostic?: IosCredentialEntryDiagnosticResult | null;
  credentialEntryDiagnosticEvidence?: Record<string, unknown> | null;
  credentialEntryDiagnosticInvalidated?: boolean;
};

/**
 * Invalidates a previously written diagnostic projection after a late source
 * or helper drift. Raw receipts remain in the private sidecar; the report
 * loses its independently promotable diagnostic projection.
 */
export function invalidateIosCredentialEntryOwnedEvidence(
  report: IosCredentialEntryOwnedEvidenceReport,
  reason: string,
): void {
  if (typeof reason !== 'string' || reason.trim().length === 0)
    throw new Error('Credential diagnostic invalidation reason is missing');
  const evidence = report.credentialEntryDiagnosticEvidence;
  if (!evidence) return;
  report.credentialEntryDiagnostic = null;
  report.credentialEntryDiagnosticEvidence = {
    ...evidence,
    evidenceState: 'invalidated',
    valid: false,
    invalidationReason: reason,
  };
  report.credentialEntryDiagnosticInvalidated = true;
}

export function buildIosCredentialEntryInvalidatedSidecar(input: {
  originalBytes: Buffer;
  reason: string;
  invalidatedAt: string;
}): {
  bytes: Buffer;
  originalSha256: string;
  invalidatedSha256: string;
  invalidation: {
    reason: string;
    invalidatedAt: string;
    originalSha256: string;
  };
} {
  if (!Buffer.isBuffer(input.originalBytes) || input.originalBytes.length === 0)
    throw new Error('Credential diagnostic sidecar bytes are empty');
  if (typeof input.reason !== 'string' || input.reason.trim().length === 0)
    throw new Error('Credential diagnostic invalidation reason is missing');
  if (typeof input.invalidatedAt !== 'string' || input.invalidatedAt.trim().length === 0)
    throw new Error('Credential diagnostic invalidation time is missing');
  const originalSha256 = createHash('sha256').update(input.originalBytes).digest('hex');
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.originalBytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('Credential diagnostic sidecar is malformed');
  }
  if (!isRecord(parsed)) throw new Error('Credential diagnostic sidecar is malformed');
  const invalidation = {
    reason: input.reason,
    invalidatedAt: input.invalidatedAt,
    originalSha256,
  };
  const bytes = Buffer.from(
    JSON.stringify(
      { ...parsed, evidenceState: 'invalidated', valid: false, invalidation },
      null,
      2,
    ),
  );
  return {
    bytes,
    originalSha256,
    invalidatedSha256: createHash('sha256').update(bytes).digest('hex'),
    invalidation,
  };
}

export type IosCredentialEntryOwnedSidecarIo = {
  read: (filePath: string) => Promise<Buffer>;
  write: (
    filePath: string,
    bytes: Buffer,
    options: { flag?: string; mode: number },
  ) => Promise<void>;
  now?: () => string;
};

/**
 * Publishes late invalidation while making the in-memory projection fail
 * closed before any filesystem write. The original raw sidecar is copied to
 * an immutable private backup first, and publication failure is retained in a
 * bounded failure record when the writer still permits it.
 */
export async function invalidateIosCredentialEntryOwnedSidecar(input: {
  report: IosCredentialEntryOwnedEvidenceReport;
  reason: string;
  sidecarIoPath: string;
  sidecarReportPath: string;
  originalIoPath: string;
  invalidationIoPath: string;
  invalidationReportPath: string;
  failureIoPath: string;
  failureReportPath: string;
  io: IosCredentialEntryOwnedSidecarIo;
}): Promise<'not-present' | 'invalidated' | 'publication-failed'> {
  const evidence = input.report.credentialEntryDiagnosticEvidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return 'not-present';

  // This must happen before readFile/writeFile so a failed publication cannot
  // leave a valid-looking projection in the outer report.
  invalidateIosCredentialEntryOwnedEvidence(input.report, input.reason);
  let originalBytes: Buffer | null = null;
  let originalBackupWritten = false;
  let sidecarOverwritten = false;
  try {
    originalBytes = await input.io.read(input.sidecarIoPath);
    const invalidated = buildIosCredentialEntryInvalidatedSidecar({
      originalBytes,
      reason: input.reason,
      invalidatedAt: input.io.now?.() ?? new Date().toISOString(),
    });
    await input.io.write(input.originalIoPath, originalBytes, {
      flag: 'wx',
      mode: 0o600,
    });
    originalBackupWritten = true;
    await input.io.write(input.sidecarIoPath, invalidated.bytes, {
      mode: 0o600,
    });
    sidecarOverwritten = true;
    const invalidationBytes = Buffer.from(
      JSON.stringify(
        {
          kind: 'private-owned-ios-credential-entry-diagnostic-invalidation',
          schemaVersion: 1,
          sidecarPath: input.sidecarReportPath,
          originalSha256: invalidated.originalSha256,
          invalidatedSha256: invalidated.invalidatedSha256,
          invalidation: invalidated.invalidation,
        },
        null,
        2,
      ),
    );
    await input.io.write(input.invalidationIoPath, invalidationBytes, {
      flag: 'wx',
      mode: 0o600,
    });
    input.report.credentialEntryDiagnosticEvidence = {
      ...((input.report.credentialEntryDiagnosticEvidence as Record<string, unknown>) ?? {}),
      path: input.sidecarReportPath,
      bytes: invalidated.bytes.length,
      sha256: invalidated.invalidatedSha256,
      invalidationPath: input.invalidationReportPath,
      evidenceState: 'invalidated',
      valid: false,
      invalidationPublication: 'written',
      originalSidecarRetained: originalBackupWritten,
    };
    return 'invalidated';
  } catch (error) {
    const boundedError =
      error instanceof Error ? error.message.slice(0, 240) : 'sidecar publication failed';
    const failureBytes = Buffer.from(
      JSON.stringify(
        {
          kind: 'private-owned-ios-credential-entry-diagnostic-invalidation-failure',
          schemaVersion: 1,
          sidecarPath: input.sidecarReportPath,
          reason: input.reason,
          originalSha256: originalBytes
            ? createHash('sha256').update(originalBytes).digest('hex')
            : null,
          originalSidecarRetained:
            originalBytes === null ? null : !sidecarOverwritten || originalBackupWritten,
          invalidationPublication: 'failed',
          error: boundedError,
        },
        null,
        2,
      ),
    );
    let failureWritten = false;
    try {
      await input.io.write(input.failureIoPath, failureBytes, {
        flag: 'wx',
        mode: 0o600,
      });
      failureWritten = true;
    } catch {
      // The report remains invalidated even when the failure record cannot be
      // published; callers must treat the missing failure record as unknown.
    }
    input.report.credentialEntryDiagnosticEvidence = {
      ...((input.report.credentialEntryDiagnosticEvidence as Record<string, unknown>) ?? {}),
      path: input.sidecarReportPath,
      evidenceState: 'invalidated',
      valid: false,
      invalidationPath: failureWritten ? input.failureReportPath : null,
      invalidationPublication: 'failed',
      originalSidecarRetained:
        originalBytes === null ? null : !sidecarOverwritten || originalBackupWritten,
    };
    (input.report as Record<string, unknown>).credentialEntryDiagnosticInvalidationUnavailable =
      !failureWritten;
    return 'publication-failed';
  }
}

/**
 * The diagnostic sidecar is only current when the source and helper inputs
 * observed after the final frame match the inputs observed before the first
 * frame.  This check belongs after the diagnostic branch, rather than only at
 * capture start, so a concurrent source edit cannot be mistaken for a valid
 * owned observation.
 */
export function requireIosCredentialEntryFreshness(input: {
  sourceTreeHashBefore: string;
  sourceTreeHashAfter: string;
  helperInputsHashBefore: string;
  helperInputsHashAfter: string;
}): void {
  requireDigest(input.sourceTreeHashBefore, 'Credential source before hash');
  requireDigest(input.sourceTreeHashAfter, 'Credential source after hash');
  requireDigest(input.helperInputsHashBefore, 'Credential helper before hash');
  requireDigest(input.helperInputsHashAfter, 'Credential helper after hash');
  if (input.sourceTreeHashBefore !== input.sourceTreeHashAfter)
    throw new Error('Credential diagnostic source changed after the final frame');
  if (input.helperInputsHashBefore !== input.helperInputsHashAfter)
    throw new Error('Credential diagnostic helper inputs changed after the final frame');
}

/**
 * Keeps a failed or blocked diagnostic from falling through into the normal
 * credential flow.  The continuation is deliberately injected so branch
 * tests can prove invocation counts without running a native command.
 */
export async function runIosCredentialEntryOwnedBranch<T>(input: {
  captureDiagnostic: () => Promise<IosCredentialEntryOwnedDiagnostic>;
  continueAfterDiagnostic: (diagnostic: IosCredentialEntryOwnedDiagnostic) => Promise<T>;
  onDiagnostic?: (diagnostic: IosCredentialEntryOwnedDiagnostic) => Promise<void> | void;
  onOuterFailure?: (error: unknown) => Promise<void> | void;
}): Promise<T> {
  try {
    const diagnostic = await input.captureDiagnostic();
    await input.onDiagnostic?.(diagnostic);
    if (diagnostic.result.status !== 'observed')
      throw new Error(
        `Credential diagnostic did not observe all stages: ${diagnostic.result.status}`,
      );
    return await input.continueAfterDiagnostic(diagnostic);
  } catch (error) {
    await input.onOuterFailure?.(error);
    throw error;
  }
}

/**
 * Explicitly binds the owned diagnostic branch to the capture continuation.
 * The production capture uses this adapter so tests can exercise the same
 * callback ordering and diagnostic-object transfer without a native process.
 */
export async function runIosCredentialEntryOwnedWiring<T>(input: {
  captureDiagnostic: () => Promise<IosCredentialEntryOwnedDiagnostic>;
  continueAfterDiagnostic: (diagnostic: IosCredentialEntryOwnedDiagnostic) => Promise<T>;
  onDiagnostic?: (diagnostic: IosCredentialEntryOwnedDiagnostic) => Promise<void> | void;
  onOuterFailure?: (error: unknown) => Promise<void> | void;
}): Promise<T> {
  return runIosCredentialEntryOwnedBranch({
    captureDiagnostic: input.captureDiagnostic,
    onDiagnostic: input.onDiagnostic,
    onOuterFailure: input.onOuterFailure,
    continueAfterDiagnostic: (diagnostic) => input.continueAfterDiagnostic(diagnostic),
  });
}

const digestPattern = /^[a-f0-9]{64}$/;
const runIdPattern = /^[a-f0-9]{24}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${label} is missing`);
  return value;
}

function requireDigest(value: unknown, label: string): string {
  const text = requireText(value, label);
  if (!digestPattern.test(text)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return text;
}

function requireRunId(value: unknown, label: string): string {
  const text = requireText(value, label);
  if (!runIdPattern.test(text)) throw new Error(`${label} must be an owned run ID`);
  return text;
}

function requireBinding(binding: IosCredentialEntryOwnedBinding): void {
  if (!isRecord(binding)) throw new Error('Credential diagnostic binding is missing');
  const captureRunId = requireRunId(binding.captureRunId, 'Credential capture run ID');
  const fixtureRunId = requireRunId(binding.fixtureRunId, 'Credential fixture run ID');
  const backendRunId = requireRunId(binding.backendRunId, 'Credential backend run ID');
  if (binding.scope !== 'native-entry-ios' || binding.fixtureScope !== 'native-entry-ios')
    throw new Error('Credential diagnostic scope is not the native-entry fixture');
  if (binding.semanticSelector !== iosCredentialEntryDiagnosticSelectors.email)
    throw new Error('Credential diagnostic selector binding is not exact');
  if (fixtureRunId !== backendRunId)
    throw new Error('Credential fixture and backend run IDs differ');
  if (binding.backendAttemptId !== `${backendRunId}:first`)
    throw new Error('Credential backend attempt is not the owned first attempt');
  if (captureRunId.length !== 24) throw new Error('Credential capture run ID is malformed');
  requireText(binding.deviceId, 'Credential device ID');
  requireText(binding.runtime, 'Credential runtime');
  requireText(binding.bundleId, 'Credential bundle ID');
  requireDigest(binding.binaryHash, 'Credential binary hash');
  requireDigest(binding.sourceTreeHash, 'Credential source hash');
  requireDigest(binding.sourceTreeHashAfter, 'Credential source after hash');
  requireDigest(binding.helperInputsHash, 'Credential helper-input hash');
  requireDigest(binding.helperInputsAfterHash, 'Credential helper-input after hash');
  if (!Number.isSafeInteger(binding.apiPid) || binding.apiPid <= 1)
    throw new Error('Credential API PID is invalid');
  let origin: URL;
  try {
    origin = new URL(binding.apiOrigin);
  } catch {
    throw new Error('Credential API origin is invalid');
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
    throw new Error('Credential API origin is not a redacted owned origin');
}

function privateCommandReceipt(
  execution: OwnedIosCredentialCommandExecution,
): PrivateCommandReceipt {
  return {
    label: execution.label,
    command: execution.command,
    argv: [...execution.argv],
    phase: execution.phase,
    execution: execution.execution,
    cleanup: execution.cleanup,
    childExitCode: execution.childExitCode,
    childSignal: execution.childSignal,
    deadlineMs: execution.deadlineMs,
    elapsedMs: execution.elapsedMs,
    cleanupMs: execution.cleanupMs,
    logPath: execution.logPath,
    ownershipPath: execution.ownershipPath,
    flowSha256: execution.flowSha256 ?? null,
    ownershipReceiptSha256: execution.ownershipReceiptSha256 ?? null,
    startIdentity: execution.startIdentity ?? null,
  };
}

/**
 * Binds one command record to the bytes of its owned process ledger. The
 * native caller supplies the actual ledger file bytes; this pure parser keeps
 * the receipt hash and process-start identity inseparable from that input.
 */
/**
 * Checks the already-owned attempt budget before the diagnostic emits its first
 * driver command. This is monotonic and cooperative: no new deadline or retry
 * window is created for the diagnostic.
 */
export function requireIosCredentialInteractionDiagnosticBudget(input: {
  deadlineAtMs: number;
  nowMs?: number;
  signal?: AbortSignal;
}): void {
  if (!Number.isFinite(input.deadlineAtMs) || input.deadlineAtMs <= 0)
    throw new Error('Credential interaction diagnostic deadline is invalid');
  if (input.signal?.aborted)
    throw input.signal.reason instanceof Error
      ? input.signal.reason
      : new Error('Credential interaction diagnostic was cancelled');
  const nowMs = input.nowMs ?? performance.now();
  if (!Number.isFinite(nowMs) || nowMs >= input.deadlineAtMs)
    throw new Error('Credential interaction diagnostic budget expired');
}

/**
 * Validates the pre-auth diagnostic boundary. The login prelude deliberately
 * runs before authentication, but it still requires the owned session and
 * target handles acquired by the outer native lifecycle.
 */
export function requireIosCredentialInteractionDiagnosticPreflight(input: {
  ownedSession: boolean;
  ownedTarget: boolean;
  deadlineAtMs: number;
  nowMs?: number;
  signal?: AbortSignal;
}): void {
  if (!input.ownedSession)
    throw new Error('Credential interaction diagnostic owned session is unavailable');
  if (!input.ownedTarget)
    throw new Error('Credential interaction diagnostic native target is unavailable');
  requireIosCredentialInteractionDiagnosticBudget(input);
}

export function bindIosCredentialEntryOwnedLedger(
  ledgerBytes: Buffer,
  execution: Pick<OwnedIosCredentialCommandExecution, 'pid' | 'pgid' | 'label' | 'startIdentity'>,
): {
  ownershipReceiptSha256: string;
  startIdentity: NonNullable<OwnedIosCredentialCommandExecution['startIdentity']>;
} {
  if (!Buffer.isBuffer(ledgerBytes) || ledgerBytes.length === 0)
    throw new Error(`Credential command ${execution.label} ownership ledger is empty`);
  let ownership: unknown;
  try {
    ownership = JSON.parse(ledgerBytes.toString('utf8')) as unknown;
  } catch {
    throw new Error(`Credential command ${execution.label} ownership ledger is malformed`);
  }
  if (!isRecord(ownership))
    throw new Error(`Credential command ${execution.label} ownership ledger is malformed`);
  const processes = ownership.processes;
  if (!Array.isArray(processes))
    throw new Error(`Credential command ${execution.label} ownership members are missing`);
  const members = processes.filter(
    (
      row,
    ): row is {
      pid: number;
      pgid: number;
      started: string;
      commandHash: string;
    } =>
      isRecord(row) &&
      row.pid === execution.pid &&
      row.pgid === execution.pgid &&
      typeof row.started === 'string' &&
      row.started.trim().length > 0 &&
      typeof row.commandHash === 'string' &&
      digestPattern.test(row.commandHash),
  );
  if (members.length === 0)
    throw new Error(`Credential command ${execution.label} start identity is not owned`);
  if (members.length > 1)
    throw new Error(`Credential command ${execution.label} start identity is ambiguous`);
  const member = members[0];
  if (
    execution.startIdentity &&
    (execution.startIdentity.pid !== member.pid ||
      execution.startIdentity.pgid !== member.pgid ||
      execution.startIdentity.started !== member.started ||
      execution.startIdentity.commandHash !== member.commandHash)
  )
    throw new Error(`Credential command ${execution.label} start identity differs from the ledger`);
  return {
    ownershipReceiptSha256: createHash('sha256').update(ledgerBytes).digest('hex'),
    startIdentity: {
      pid: member.pid,
      pgid: member.pgid,
      started: member.started,
      commandHash: member.commandHash,
    },
  };
}

function requireOwnedExecution(
  execution: OwnedIosCredentialCommandExecution | null,
  expected: {
    label: string;
    command: 'maestro' | 'xcrun';
    deviceId: string;
    required: boolean;
    mustBeCompleted?: boolean;
    flowSha256?: string | null;
  },
  allExecutions: readonly OwnedIosCredentialCommandExecution[],
): PrivateCommandReceipt | null {
  if (execution === null) {
    if (expected.required) throw new Error(`${expected.label} execution is missing`);
    return null;
  }
  if (!allExecutions.some((candidate) => candidate === execution))
    throw new Error(`${expected.label} execution is not an owned command record`);
  if (execution.label !== expected.label || execution.command !== expected.command)
    throw new Error(`${expected.label} execution identity does not match the stage`);
  if (execution.phase !== 'step')
    throw new Error(`${expected.label} execution phase is not a step`);
  if (!Number.isFinite(execution.deadlineMs) || execution.deadlineMs <= 0)
    throw new Error(`${expected.label} execution deadline is invalid`);
  if (!Number.isFinite(execution.elapsedMs) || execution.elapsedMs < 0)
    throw new Error(`${expected.label} execution elapsed time is invalid`);
  if (!Number.isFinite(execution.cleanupMs) || execution.cleanupMs < 0)
    throw new Error(`${expected.label} execution cleanup time is invalid`);
  if (execution.cleanup !== 'cleaned')
    throw new Error(`${expected.label} execution cleanup is not proven`);
  const pid = execution.pid;
  const pgid = execution.pgid;
  if (
    typeof pid !== 'number' ||
    !Number.isSafeInteger(pid) ||
    pid <= 1 ||
    typeof pgid !== 'number' ||
    !Number.isSafeInteger(pgid) ||
    pgid <= 1
  )
    throw new Error(`${expected.label} process identity is incomplete`);
  if (
    expected.flowSha256 !== undefined &&
    (execution.flowSha256 ?? null) !== (expected.flowSha256 ?? null)
  )
    throw new Error(`${expected.label} generated flow binding differs from the owned flow`);
  if (!digestPattern.test(execution.ownershipReceiptSha256 ?? ''))
    throw new Error(`${expected.label} ownership receipt hash is missing`);
  if (
    !execution.startIdentity ||
    execution.startIdentity.pid !== pid ||
    execution.startIdentity.pgid !== pgid ||
    typeof execution.startIdentity.started !== 'string' ||
    !execution.startIdentity.started.trim() ||
    !digestPattern.test(execution.startIdentity.commandHash)
  )
    throw new Error(`${expected.label} process start identity is incomplete`);
  if (
    execution.execution === 'completed' &&
    (execution.childExitCode !== 0 ||
      execution.childSignal !== null ||
      execution.logPath === null ||
      execution.ownershipPath === null)
  )
    throw new Error(`${expected.label} completed execution proof is incomplete`);
  if (expected.mustBeCompleted && execution.execution !== 'completed')
    throw new Error(`${expected.label} execution must be completed for retained evidence`);
  if (expected.command === 'maestro') {
    const udidIndex = execution.argv.indexOf('--udid');
    if (udidIndex < 0 || execution.argv[udidIndex + 1] !== expected.deviceId)
      throw new Error(`${expected.label} Maestro target is not the owned device`);
  } else if (
    execution.argv[0] !== 'simctl' ||
    execution.argv[1] !== 'io' ||
    execution.argv[2] !== expected.deviceId
  ) {
    throw new Error(`${expected.label} screenshot target is not the owned device`);
  }
  return privateCommandReceipt(execution);
}

function hierarchyNodes(value: unknown): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const active = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (!isRecord(candidate)) return;
    if (active.has(candidate)) throw new Error('Credential hierarchy contains a cycle');
    active.add(candidate);
    nodes.push(candidate);
    if (Array.isArray(candidate.children)) candidate.children.forEach(visit);
    active.delete(candidate);
  };
  visit(value);
  return nodes;
}

function nodeAttributes(node: Record<string, unknown>): Record<string, unknown> {
  return isRecord(node.attributes) ? node.attributes : {};
}

/** Derives exact binding from the owned hierarchy instead of trusting a caller flag. */
export function deriveIosCredentialEntryExactValueBound(
  hierarchy: unknown,
  expectedEmail: string,
): boolean {
  if (typeof expectedEmail !== 'string' || expectedEmail.length === 0) return false;
  const matches = hierarchyNodes(hierarchy).filter(
    (node) => nodeAttributes(node)['resource-id'] === iosCredentialEntryDiagnosticSelectors.email,
  );
  if (matches.length !== 1) return false;
  const attributes = nodeAttributes(matches[0]);
  const values = ['text', 'value', 'input-text']
    .filter((key) => Object.hasOwn(attributes, key))
    .map((key) => attributes[key]);
  return (
    values.length > 0 &&
    values.every((value) => typeof value === 'string' && value === expectedEmail)
  );
}

function sha256Bytes(value: Buffer | null): string | null {
  return value ? createHash('sha256').update(value).digest('hex') : null;
}

function commandReceiptHash(
  binding: IosCredentialEntryOwnedBinding,
  stage: IosCredentialEntryOwnedStageInput,
  receipts: readonly (PrivateCommandReceipt | null)[],
  exactValueBound: boolean | null,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        binding,
        stage: stage.stage,
        sequence: stage.sequence,
        actionKind: stage.actionKind,
        selector: stage.selector,
        actionStatus: stage.actionStatus,
        exactValueBound,
        executions: receipts,
        actionFlowSha256: stage.actionFlowSha256,
        assertionFlowSha256: stage.assertionFlowSha256,
        assertionLabel: stage.assertionLabel,
        postAssertionHierarchyLabel: stage.postAssertionHierarchyLabel,
        postAssertionScreenshotLabel: stage.postAssertionScreenshotLabel,
        hierarchySha256: sha256Bytes(stage.hierarchyBytes),
        screenshotSha256: sha256Bytes(stage.screenshotBytes),
        postAssertionHierarchySha256: sha256Bytes(stage.postAssertionHierarchyBytes),
        postAssertionScreenshotSha256: sha256Bytes(stage.postAssertionScreenshotBytes),
      }),
    )
    .digest('hex');
}

function expectedStageAction(stage: IosCredentialEntryDiagnosticStage): {
  actionKind: IosCredentialEntryDiagnosticActionKind;
  selector: string | null;
} {
  if (stage === 'entry') return { actionKind: 'observation', selector: null };
  return {
    actionKind: stage === 'email-after-tap' ? 'tap-email' : 'input-email',
    selector: iosCredentialEntryDiagnosticSelectors.email,
  };
}

function requireStageShape(stage: IosCredentialEntryOwnedStageInput): void {
  const expected = expectedStageAction(stage.stage);
  if (stage.actionKind !== expected.actionKind || stage.selector !== expected.selector)
    throw new Error(`${stage.stage} action does not match the owned semantic selector`);
  if (!Number.isSafeInteger(stage.sequence) || stage.sequence < 0)
    throw new Error(`${stage.stage} sequence is invalid`);
  if (stage.actionLabel !== null) requireText(stage.actionLabel, `${stage.stage} action label`);
  if (stage.assertionLabel !== null)
    requireText(stage.assertionLabel, `${stage.stage} assertion label`);
  requireText(stage.hierarchyLabel, `${stage.stage} hierarchy label`);
  requireText(stage.screenshotLabel, `${stage.stage} screenshot label`);
  if (stage.actionStatus === 'completed') {
    if (stage.hierarchy === null || stage.hierarchy === undefined || !stage.hierarchyBytes)
      throw new Error(`${stage.stage} completed action lacks hierarchy bytes`);
    if (!stage.screenshotBytes)
      throw new Error(`${stage.stage} completed action lacks screenshot bytes`);
  }
  if ((stage.hierarchyBytes === null) !== (stage.hierarchyPath === null))
    throw new Error(`${stage.stage} hierarchy path/bytes binding is incomplete`);
  if ((stage.screenshotBytes === null) !== (stage.screenshotPath === null))
    throw new Error(`${stage.stage} screenshot path/bytes binding is incomplete`);
  if (
    stage.postAssertionHierarchyBytes !== null &&
    (stage.postAssertionHierarchy === null || stage.postAssertionHierarchy === undefined)
  )
    throw new Error(`${stage.stage} post-assertion hierarchy is missing`);
  if ((stage.postAssertionHierarchyBytes === null) !== (stage.postAssertionHierarchyPath === null))
    throw new Error(`${stage.stage} post-assertion hierarchy path/bytes binding is incomplete`);
  if (
    (stage.postAssertionScreenshotBytes === null) !==
    (stage.postAssertionScreenshotPath === null)
  )
    throw new Error(`${stage.stage} post-assertion screenshot path/bytes binding is incomplete`);
}

/**
 * Builds one redacted projector frame from actual owner command records. Raw
 * hierarchy, screenshot, command paths, and credential values stay in the
 * private caller-side files; the returned snapshot is still scrubbed by the
 * standalone projector before it reaches any report.
 */
export function buildIosCredentialEntryOwnedStage(
  binding: IosCredentialEntryOwnedBinding,
  stage: IosCredentialEntryOwnedStageInput,
): {
  snapshot: IosCredentialEntryDiagnosticSnapshot;
  receipt: IosCredentialEntryOwnedStageReceipt;
} {
  requireBinding(binding);
  requireStageShape(stage);
  const actionExecution = requireOwnedExecution(
    stage.actionExecution,
    {
      label: stage.actionLabel ?? `${stage.stage}-action`,
      command: 'maestro',
      deviceId: binding.deviceId,
      required: stage.actionStatus !== 'blocked' && stage.stage !== 'entry',
      mustBeCompleted: stage.actionStatus === 'completed',
      flowSha256: stage.actionFlowSha256,
    },
    stage.commandExecutions,
  );
  const assertionExecution = requireOwnedExecution(
    stage.assertionExecution,
    {
      label: stage.assertionLabel ?? `${stage.stage}-assertion`,
      command: 'maestro',
      deviceId: binding.deviceId,
      required: stage.postAssertionHierarchyBytes !== null,
      mustBeCompleted: stage.actionStatus === 'completed',
      flowSha256: stage.assertionFlowSha256,
    },
    stage.commandExecutions,
  );
  const hierarchyExecution = requireOwnedExecution(
    stage.hierarchyExecution,
    {
      label: stage.hierarchyLabel,
      command: 'maestro',
      deviceId: binding.deviceId,
      required: stage.actionStatus === 'completed' || stage.hierarchyBytes !== null,
      mustBeCompleted: stage.actionStatus === 'completed' || stage.hierarchyBytes !== null,
    },
    stage.commandExecutions,
  );
  const screenshotExecution = requireOwnedExecution(
    stage.screenshotExecution,
    {
      label: stage.screenshotLabel,
      command: 'xcrun',
      deviceId: binding.deviceId,
      required: stage.actionStatus === 'completed' || stage.screenshotBytes !== null,
      mustBeCompleted: stage.actionStatus === 'completed' || stage.screenshotBytes !== null,
    },
    stage.commandExecutions,
  );
  const postAssertionHierarchyExecution = requireOwnedExecution(
    stage.postAssertionHierarchyExecution,
    {
      label: stage.postAssertionHierarchyLabel ?? `${stage.stage}-post-assertion-hierarchy`,
      command: 'maestro',
      deviceId: binding.deviceId,
      required: stage.postAssertionHierarchyBytes !== null,
      mustBeCompleted: stage.postAssertionHierarchyBytes !== null,
    },
    stage.commandExecutions,
  );
  const postAssertionScreenshotExecution = requireOwnedExecution(
    stage.postAssertionScreenshotExecution,
    {
      label: stage.postAssertionScreenshotLabel ?? `${stage.stage}-post-assertion-screenshot`,
      command: 'xcrun',
      deviceId: binding.deviceId,
      required: stage.postAssertionScreenshotBytes !== null,
      mustBeCompleted: stage.postAssertionScreenshotBytes !== null,
    },
    stage.commandExecutions,
  );
  const exactValueBound =
    stage.stage !== 'email-after-input' || stage.assertionExecution === null
      ? null
      : stage.actionStatus === 'completed'
        ? deriveIosCredentialEntryExactValueBound(stage.hierarchy, stage.expectedEmail)
        : stage.actionStatus === 'failed' && stage.assertionFlowSha256 !== null;
  const sameFieldAssertionStatus =
    exactValueBound === true
      ? stage.actionStatus === 'completed'
        ? ('passed' as const)
        : ('failed' as const)
      : null;
  const receipts = [
    actionExecution,
    assertionExecution,
    hierarchyExecution,
    screenshotExecution,
    postAssertionHierarchyExecution,
    postAssertionScreenshotExecution,
  ] as const;
  const commandReceiptSha256 = commandReceiptHash(binding, stage, receipts, exactValueBound);
  const snapshot: IosCredentialEntryDiagnosticSnapshot = {
    stage: stage.stage,
    sequence: stage.sequence,
    hierarchy: stage.hierarchy,
    keyboard: stage.keyboard,
    appBoundary: stage.appBoundary,
    action: {
      kind: stage.actionKind,
      status: stage.actionStatus,
      selector: stage.selector,
      retryCount: 0,
      coordinatesUsed: false,
      optionalAssertionsUsed: false,
      credentialValueRecorded: false,
    },
    evidence: {
      hierarchySha256: sha256Bytes(stage.hierarchyBytes),
      screenshotSha256: sha256Bytes(stage.screenshotBytes),
      commandReceiptSha256,
    },
    ...(sameFieldAssertionStatus
      ? {
          sameFieldAssertion: {
            selector: iosCredentialEntryDiagnosticSelectors.email,
            status: sameFieldAssertionStatus,
            exactValueBound: true as const,
          },
        }
      : {}),
  };
  return {
    snapshot,
    receipt: {
      stage: stage.stage,
      sequence: stage.sequence,
      actionKind: stage.actionKind,
      selector: stage.selector,
      actionStatus: stage.actionStatus,
      actionExecution,
      assertionExecution,
      assertionFlowSha256: stage.assertionFlowSha256,
      hierarchyExecution,
      screenshotExecution,
      postAssertionHierarchyExecution,
      postAssertionScreenshotExecution,
      postAssertionHierarchyPath: stage.postAssertionHierarchyPath,
      postAssertionScreenshotPath: stage.postAssertionScreenshotPath,
      hierarchyPath: stage.hierarchyPath,
      screenshotPath: stage.screenshotPath,
      hierarchySha256: sha256Bytes(stage.hierarchyBytes),
      screenshotSha256: sha256Bytes(stage.screenshotBytes),
      postAssertionHierarchySha256: sha256Bytes(stage.postAssertionHierarchyBytes),
      postAssertionScreenshotSha256: sha256Bytes(stage.postAssertionScreenshotBytes),
      commandReceiptSha256,
      exactValueBound,
    },
  };
}

/** Projects only after every supplied stage is bound to the actual owner ledger. */
export function collectIosCredentialEntryOwnedDiagnostic(
  binding: IosCredentialEntryOwnedBinding,
  stages: readonly IosCredentialEntryOwnedStageInput[],
): IosCredentialEntryOwnedDiagnostic {
  requireBinding(binding);
  const built = stages.map((stage) => buildIosCredentialEntryOwnedStage(binding, stage));
  return {
    result: collectIosCredentialEntryDiagnostic(built.map((row) => row.snapshot)),
    receipts: built.map((row) => row.receipt),
  };
}
