import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, realpath, stat, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { requireIntegratedLoopbackOrigin } from './integration-preflight';
import {
  requireConnectionSnapshot,
  type OwnedConnectionSnapshot,
} from './native-connection-snapshot';
import { assertTestingDocument, loadTestingSchema } from './schema-validation';

const execute = promisify(execFile);
export type OwnedManifest = {
  phase: 'bootstrap' | 'tests' | 'cleanup';
  runId: string;
  repoRoot: string;
  runtimeRoot: string;
  artifactRoot: string;
  ownerTokenHash: string;
  orchestratorPid: number;
  composeProject: string;
  port: number;
  targets: Record<string, string>;
  fixtureScopes: string[];
  processes: { role: string; pid: number; started: string; script: string }[];
  repositories: Record<string, { sha: string; dirty: boolean; workingTreeHash: string }>;
};
export type OwnedManifestFacts = Pick<
  OwnedManifest,
  'runId' | 'ownerTokenHash' | 'repositories' | 'processes'
>;
type OwnedProcessLedgerEntry = OwnedManifest['processes'][number];
type OwnedProcessLedgerKey = Pick<OwnedProcessLedgerEntry, 'role' | 'pid'>;
type OwnedProcessLedger = OwnedProcessLedgerEntry[];
export type OwnedApiLifetimeProbe = {
  runId: string;
  apiOrigin: string;
  apiPid: number;
  apiStarted: string;
  apiScript: string;
  backendAttemptId: string;
  manifestSha256: string;
  /** Physical attempt and exact API ledger hash observed by the probe. */
  apiAttempt: string;
  apiLedgerSha256: string;
};
export type OwnedApiAttemptProbe = OwnedApiLifetimeProbe;
export const OWNED_INITIAL_API_ATTEMPT = 'session-start' as const;
export const OWNED_INITIAL_API_LEDGER_BASENAME = 'api-session-start.json' as const;
export type OwnedSnapshotReceipt = OwnedRuntimeDocumentReceipt & {
  /** Canonical owned server runtime root where this snapshot was published. */
  parentRoot: string;
  kind: 'domain' | 'connection';
  runId: string;
  scope: string;
  snapshotId: string;
  apiOrigin: string;
  apiPid: number;
  apiStarted: string;
  apiScript: string;
  backendAttemptId: string;
  manifestSha256: string;
  /** Physical API attempt and ledger hash used to bind this snapshot. */
  apiAttempt: string;
  apiLedgerSha256: string;
  fixtureAuthUidAllowlistHash: string;
  verification: 'owned-runtime-document-v6';
};
export type OwnedSnapshotEvidence<T> = {
  value: T;
  receipt: OwnedSnapshotReceipt;
};
export type OwnedApiProcessRecord = {
  schemaVersion: 1;
  runId: string;
  ownerTokenHash: string;
  pid: number;
  started: string;
  script: string;
  attempt: string;
  origin: string;
};
export type OwnedApiProcessIdentity = {
  apiPid: number;
  apiOrigin: string;
  apiStarted: string;
  apiScript: string;
};
export type OwnedApiAttemptState = OwnedApiProcessIdentity & {
  apiAttempt: string;
};
type Ready = {
  event: 'ready';
  runId: string;
  manifestPath: string;
  apiOrigin: string;
  apiPid: number;
  fixtureSummary: { contentHash: string };
};
type Acquired = { event: 'acquired'; runId: string; manifestPath: string };
type Seeded = { event: 'seeded'; id: string; fixtureRef: string };
type Snapshotted = { event: 'snapshotted'; id: string; snapshotRef: string };
type ConnectionSnapshotted = {
  event: 'connection-snapshotted';
  id: string;
  snapshotRef: string;
};
export type OwnedDomainSnapshot = {
  schemaVersion: 1;
  runId: string;
  scope: string;
  readOnly: true;
  trainingPlans: {
    id: string;
    studentAuthUid: string;
    ownerProfessionalUid: string | null;
    sourceKind: 'predefined' | 'assigned' | 'self_managed';
    name: string | null;
    isArchived: boolean;
    isDraft: boolean;
    lifecycleConnectionId: string | null;
    createdAt: string;
    updatedAt: string;
    sessions: Record<string, unknown>[];
  }[];
  connections: {
    id: string;
    professionalAuthUid: string;
    studentAuthUid: string;
    status: 'invited' | 'pending_confirmation' | 'active' | 'ended';
    specialty: 'nutritionist' | 'fitness_coach';
    canceledReason: string | null;
    sourceInviteCodeId: string | null;
    sourceInviteCodeValue: string | null;
    createdAt: string;
    updatedAt: string;
    endedAt: string | null;
  }[];
};
type Restarted = {
  event: 'restarted';
  id: string;
  apiOrigin: string;
  apiPid: number;
  previousPid: number;
};
type ClosedEvent = {
  event: 'closed';
  receiptPath: string;
  cleanup: 'cleaned' | 'failed-recovery-ledger-retained';
  exitCode: 0 | 2 | 130 | 143;
};
export type OwnedSessionReceipt = {
  schemaVersion: 1;
  runId: string;
  repositories: OwnedManifest['repositories'];
  startedAt: string;
  finishedAt: string;
  requests: { id: string; op: string; outcome: 'completed' }[];
  result: 'passed' | 'harness-blocked' | 'cancelled';
  reason: 'SIGINT' | 'SIGTERM' | 'timeout' | 'parent-closed' | null;
  cleanup: 'cleaned' | 'failed-recovery-ledger-retained';
  error: string | null;
  exitCode: 0 | 2 | 130 | 143;
};
export type OwnedSessionClosed = ClosedEvent & {
  /** Authenticated server terminal receipt, retained for cleanup evidence. */
  receipt: OwnedSessionReceipt;
  /** Read receipt for the private server terminal document. */
  receiptDocument: OwnedRuntimeDocumentReceipt;
};
type Event =
  Acquired | Ready | Seeded | Snapshotted | ConnectionSnapshotted | Restarted | ClosedEvent;
export type OwnedOrchestratorIdentity = {
  pid: number;
  /** Null means the direct child was spawned but its start identity could not be observed. */
  started: string | null;
  script: string;
  status: 'verified' | 'unavailable';
};
export class OwnedSessionAcquisitionError extends Error {
  readonly cleanup: 'not-acquired' | 'cleaned' | 'failed-recovery-ledger-retained';
  readonly manifest?: OwnedManifest;
  readonly closed?: OwnedSessionClosed;
  readonly childExitCode: number | null;
  readonly pid?: number;
  readonly orchestrator?: OwnedOrchestratorIdentity;
  readonly diagnostics: string;
  constructor(details: {
    cleanup: OwnedSessionAcquisitionError['cleanup'];
    manifest?: OwnedManifest;
    closed?: OwnedSessionClosed;
    childExitCode: number | null;
    pid?: number;
    orchestrator?: OwnedOrchestratorIdentity;
    diagnostics?: string;
    cause?: unknown;
  }) {
    super('Owned session acquisition failed; inspect validated ownership and private diagnostics', {
      cause: details.cause,
    });
    this.cleanup = details.cleanup;
    this.manifest = details.manifest;
    this.closed = details.closed;
    this.childExitCode = details.childExitCode;
    this.pid = details.pid;
    this.orchestrator = details.orchestrator;
    this.diagnostics = details.diagnostics ?? '';
  }
}
export type OwnedFixtures = {
  runId: string;
  scope: string;
  accounts: Record<
    | 'new'
    | 'student'
    | 'coach'
    | 'unrelated-student'
    | 'unrelated-coach'
    | 'pending-student'
    | 'active-student',
    { email: string; password: string; authUid: string; role: string | null }
  >;
  pendingConnectionId: string;
  activeConnectionId: string;
  savedPlanId: string;
  draft: {
    name: string;
    sessions: {
      id: string;
      name: string;
      notes: string;
      items: {
        id: string;
        name: string;
        quantity: string;
        notes: string;
        exerciseId: string;
      }[];
    }[];
  };
};

export function validateOwnedManifest(
  value: unknown,
  identity: {
    serverRoot: string;
    runId: string;
    pid: number;
    started: string;
    acquiring?: boolean;
  },
) {
  assertTestingDocument('resource-manifest-v1', value);
  const manifest = value as OwnedManifest;
  const runtimeRoot = path.join(identity.serverRoot, '.qa/runtime');
  const owners = manifest.processes.filter((record) => record.role === 'orchestrator');
  if (
    manifest.runId !== identity.runId ||
    manifest.repoRoot !== identity.serverRoot ||
    manifest.runtimeRoot !== runtimeRoot ||
    manifest.artifactRoot !== path.join(runtimeRoot, identity.runId) ||
    manifest.orchestratorPid !== identity.pid ||
    owners.length !== 1 ||
    owners[0].pid !== identity.pid ||
    owners[0].started !== identity.started ||
    owners[0].script !== path.join(identity.serverRoot, 'scripts/testing/session.ts') ||
    manifest.composeProject !== `mc_test_${identity.runId}` ||
    (manifest.port < 1024 && !(identity.acquiring && manifest.port === 0)) ||
    manifest.port === 15432 ||
    manifest.targets.DATABASE_URL !== `mc_test_${identity.runId}` ||
    manifest.targets.FOOD_CATALOG_DATABASE_URL !== `mc_test_${identity.runId}_food` ||
    manifest.targets.EXERCISE_CATALOG_DATABASE_URL !== `mc_test_${identity.runId}_exercise` ||
    new Set(manifest.processes.map((record) => record.pid)).size !== manifest.processes.length
  )
    throw new Error('Owned session manifest identity mismatch');
  return manifest;
}

export type OwnedRuntimeDocumentReceipt = {
  path: string;
  schema: string;
  sizeBytes: number;
  sha256: string;
  ownerUid: number;
  mode: number;
  verification: 'owned-runtime-document-v6';
};

export async function readOwnedRuntimeDocumentWithReceipt(
  file: string,
  runRoot: string,
  basename: string,
  schema: string,
  signal?: AbortSignal,
): Promise<{ value: unknown; receipt: OwnedRuntimeDocumentReceipt }> {
  signal?.throwIfAborted();
  if (typeof basename !== 'string' || basename.length === 0)
    throw new Error('Owned runtime document path mismatch');
  const normalizedBasename = path.normalize(basename);
  const relativeFile = path.relative(runRoot, file);
  const escapesArtifactRoot =
    basename.includes('\0') ||
    path.isAbsolute(basename) ||
    normalizedBasename !== basename ||
    normalizedBasename === '..' ||
    normalizedBasename.startsWith(`..${path.sep}`) ||
    relativeFile.length === 0 ||
    relativeFile === '..' ||
    relativeFile.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeFile);
  if (escapesArtifactRoot) throw new Error('Owned runtime document path escapes the artifact root');
  if (
    file !== path.join(runRoot, basename) ||
    (await realpath(runRoot)) !== runRoot ||
    (await realpath(file)) !== file
  )
    throw new Error('Owned runtime document path mismatch');
  const directory = await stat(runRoot);
  if ((directory.mode & 0o777) !== 0o700 || (process.getuid && directory.uid !== process.getuid()))
    throw new Error('Owned runtime directory must be private');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o777) !== 0o600 ||
      (process.getuid && metadata.uid !== process.getuid())
    )
      throw new Error('Owned runtime document must be private');
    if (metadata.size > 1_048_576) throw new Error('Owned runtime document exceeds size limit');
    const bytes = await handle.readFile({ signal });
    signal?.throwIfAborted();
    const after = await handle.stat();
    if (after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs)
      throw new Error('Owned runtime document changed during read');
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error('Owned runtime document contains invalid JSON');
    }
    assertTestingDocument(schema, value);
    return {
      value,
      receipt: {
        path: path.relative(runRoot, file),
        schema,
        sizeBytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ownerUid: metadata.uid,
        mode: metadata.mode & 0o777,
        verification: 'owned-runtime-document-v6',
      },
    };
  } finally {
    await handle.close();
  }
}

export async function readOwnedRuntimeDocument(
  file: string,
  runRoot: string,
  basename: string,
  schema: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return (await readOwnedRuntimeDocumentWithReceipt(file, runRoot, basename, schema, signal)).value;
}

export function captureOwnedManifestFacts(manifest: OwnedManifest): OwnedManifestFacts {
  return structuredClone({
    runId: manifest.runId,
    ownerTokenHash: manifest.ownerTokenHash,
    repositories: manifest.repositories,
    processes: manifest.processes,
  });
}

function captureOwnedProcessLedger(
  manifest: OwnedManifest,
  keys: readonly OwnedProcessLedgerKey[],
): OwnedProcessLedger {
  const rows = keys.map((key) => {
    const matches = manifest.processes.filter(
      (record) => record.role === key.role && record.pid === key.pid,
    );
    if (matches.length !== 1) throw new Error('Owned session process ledger identity mismatch');
    return matches[0];
  });
  if (new Set(rows.map((row) => row.pid)).size !== rows.length)
    throw new Error('Owned session process ledger identity mismatch');
  return structuredClone(rows);
}

function assertOwnedProcessLedgerStable(expected: OwnedProcessLedger, actual: OwnedManifest): void {
  const actualByPid = new Map(actual.processes.map((record) => [record.pid, record]));
  const expectedPids = new Set(expected.map((record) => record.pid));
  if (
    expectedPids.size !== expected.length ||
    actual.processes.length !== expected.length ||
    actual.processes.some((record) => !expectedPids.has(record.pid)) ||
    expected.some((record) => {
      const current = actualByPid.get(record.pid);
      return (
        current === undefined ||
        current.role !== record.role ||
        current.started !== record.started ||
        current.script !== record.script
      );
    })
  )
    throw new Error('Owned session process ledger mismatch');
}

export function assertOwnedManifestFactsStable(
  expected: OwnedManifestFacts,
  actual: OwnedManifest,
): void {
  const repositoryNames = new Set([
    ...Object.keys(expected.repositories),
    ...Object.keys(actual.repositories),
  ]);
  const repositoriesStable = [...repositoryNames].every((name) => {
    const before = expected.repositories[name];
    const after = actual.repositories[name];
    return (
      before !== undefined &&
      after !== undefined &&
      before.sha === after.sha &&
      before.dirty === after.dirty &&
      before.workingTreeHash === after.workingTreeHash
    );
  });
  const processesStable = expected.processes.every((before) => {
    const after = actual.processes.find((row) => row.pid === before.pid);
    return (
      after !== undefined &&
      after.role === before.role &&
      after.started === before.started &&
      after.script === before.script
    );
  });
  if (
    actual.runId !== expected.runId ||
    actual.ownerTokenHash !== expected.ownerTokenHash ||
    !repositoriesStable ||
    !processesStable
  )
    throw new Error('Owned session manifest facts changed after acquisition');
}

function canReleaseOwnedSessionCleanly(
  closed: OwnedSessionClosed,
  terminalRequestFailure: Error | undefined,
): boolean {
  if (closed.cleanup !== 'cleaned' || closed.receipt.cleanup !== 'cleaned') return false;
  if (closed.exitCode === 0) return true;
  return (
    closed.exitCode === 2 &&
    (terminalRequestFailure !== undefined ||
      (closed.receipt.result === 'harness-blocked' &&
        closed.receipt.reason === 'timeout' &&
        closed.receipt.error === null))
  );
}

function assertOwnedSessionReceiptOutcome(receipt: OwnedSessionReceipt): void {
  if (
    receipt.exitCode === 0 &&
    (receipt.result !== 'passed' || receipt.reason !== null || receipt.error !== null)
  )
    throw new Error('Owned session terminal outcome mismatch');
  if (
    receipt.exitCode === 2 &&
    (receipt.result !== 'harness-blocked' ||
      ![null, 'timeout', 'parent-closed'].includes(receipt.reason) ||
      (receipt.reason === null && receipt.error === null))
  )
    throw new Error('Owned session terminal outcome mismatch');
  if (receipt.exitCode === 130 && (receipt.result !== 'cancelled' || receipt.reason !== 'SIGINT'))
    throw new Error('Owned session terminal outcome mismatch');
  if (receipt.exitCode === 143 && (receipt.result !== 'cancelled' || receipt.reason !== 'SIGTERM'))
    throw new Error('Owned session terminal outcome mismatch');
}

export function validateOwnedSessionClosed(input: {
  event: ClosedEvent;
  receipt: OwnedSessionReceipt;
  receiptDocument: OwnedRuntimeDocumentReceipt;
  manifest: OwnedManifest;
  acquiredFacts?: OwnedManifestFacts;
  readyFacts?: OwnedManifestFacts;
  approvedProcessLedger: OwnedProcessLedger;
  stopId?: string;
}): OwnedSessionClosed {
  if (input.acquiredFacts) assertOwnedManifestFactsStable(input.acquiredFacts, input.manifest);
  if (input.readyFacts) assertOwnedManifestFactsStable(input.readyFacts, input.manifest);
  assertOwnedProcessLedgerStable(input.approvedProcessLedger, input.manifest);
  assertOwnedSessionReceiptOutcome(input.receipt);
  const ownerRows = input.manifest.processes.filter((record) => record.role === 'orchestrator');
  const expectedReceiptPath = path.join(input.manifest.artifactRoot, 'session-receipt.json');
  const expectedOrchestratorScript = path.join(
    input.manifest.repoRoot,
    'scripts/testing/session.ts',
  );
  const processIds = input.manifest.processes.map((record) => record.pid);
  const repositoriesMatch = (name: 'server' | 'client') => {
    const expected = input.manifest.repositories[name];
    const actual = input.receipt.repositories[name];
    return (
      expected !== undefined &&
      actual !== undefined &&
      expected.sha === actual.sha &&
      expected.dirty === actual.dirty &&
      expected.workingTreeHash === actual.workingTreeHash
    );
  };
  if (
    input.event.receiptPath !== expectedReceiptPath ||
    input.receiptDocument.path !== 'session-receipt.json' ||
    input.receiptDocument.schema !== 'session-receipt-v1' ||
    input.receiptDocument.mode !== 0o600 ||
    input.receiptDocument.verification !== 'owned-runtime-document-v6' ||
    input.receipt.runId !== input.manifest.runId ||
    input.receipt.exitCode !== input.event.exitCode ||
    input.receipt.cleanup !== input.event.cleanup ||
    !repositoriesMatch('server') ||
    !repositoriesMatch('client') ||
    ownerRows.length !== 1 ||
    ownerRows[0]?.pid !== input.manifest.orchestratorPid ||
    ownerRows[0]?.script !== expectedOrchestratorScript ||
    new Set(processIds).size !== processIds.length ||
    (input.event.exitCode === 0 &&
      (!input.stopId ||
        !input.receipt.requests.some(
          (request) => request.id === input.stopId && request.op === 'stop',
        )))
  )
    throw new Error('Owned session close receipt or process identity mismatch');
  return {
    ...input.event,
    receipt: input.receipt,
    receiptDocument: input.receiptDocument,
  };
}

async function processStart(pid: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const result = await execute('ps', ['-p', String(pid), '-o', 'lstart='], {
    timeout: 5000,
    signal,
  });
  signal?.throwIfAborted();
  if (!result.stdout.trim()) throw new Error('Owned process start identity unavailable');
  return result.stdout.trim();
}

export function validateOwnedInitialApiProcess(input: {
  record: OwnedApiProcessRecord;
  manifest: OwnedManifest;
  serverRoot: string;
  current: OwnedApiProcessIdentity;
  initial: OwnedApiProcessIdentity;
}): string {
  const expectedScript = path.join(input.serverRoot, 'scripts/testing/serve.ts');
  const current = input.current;
  const initial = input.initial;
  requireIntegratedLoopbackOrigin(current.apiOrigin);
  if (
    !Number.isSafeInteger(current.apiPid) ||
    current.apiPid <= 1 ||
    current.apiOrigin.length === 0 ||
    current.apiStarted.length === 0 ||
    current.apiScript !== expectedScript ||
    current.apiPid !== initial.apiPid ||
    current.apiOrigin !== initial.apiOrigin ||
    current.apiStarted !== initial.apiStarted ||
    current.apiScript !== initial.apiScript
  )
    throw new Error('Owned first API provenance changed or was restarted');
  const apiRows = input.manifest.processes.filter(
    (row) => row.role === 'api' && row.pid === current.apiPid,
  );
  if (
    apiRows.length !== 1 ||
    apiRows[0].started !== current.apiStarted ||
    apiRows[0].script !== expectedScript
  )
    throw new Error('Owned initial API process is absent from the current manifest');
  const record = input.record;
  if (
    record.runId !== input.manifest.runId ||
    record.ownerTokenHash !== input.manifest.ownerTokenHash ||
    record.pid !== current.apiPid ||
    record.started !== current.apiStarted ||
    record.script !== expectedScript ||
    record.attempt !== OWNED_INITIAL_API_ATTEMPT ||
    record.origin !== current.apiOrigin
  )
    throw new Error('Owned initial API ledger identity mismatch');
  return `${input.manifest.runId}:first`;
}

export async function readOwnedInitialApiProcess(input: {
  manifest: OwnedManifest;
  serverRoot: string;
  current: OwnedApiProcessIdentity;
  initial: OwnedApiProcessIdentity;
  signal?: AbortSignal;
}): Promise<{
  record: OwnedApiProcessRecord;
  receipt: OwnedRuntimeDocumentReceipt;
  backendAttemptId: string;
}> {
  input.signal?.throwIfAborted();
  const source = await readOwnedRuntimeDocumentWithReceipt(
    path.join(input.manifest.artifactRoot, OWNED_INITIAL_API_LEDGER_BASENAME),
    input.manifest.artifactRoot,
    OWNED_INITIAL_API_LEDGER_BASENAME,
    'api-process-v1',
    input.signal,
  );
  input.signal?.throwIfAborted();
  const record = source.value as OwnedApiProcessRecord;
  const backendAttemptId = validateOwnedInitialApiProcess({
    record,
    manifest: input.manifest,
    serverRoot: input.serverRoot,
    current: input.current,
    initial: input.initial,
  });
  input.signal?.throwIfAborted();
  return { record, receipt: source.receipt, backendAttemptId };
}

export function validateOwnedApiProcessAttempt(input: {
  record: OwnedApiProcessRecord;
  manifest: OwnedManifest;
  serverRoot: string;
  current: OwnedApiProcessIdentity;
  attempt: string;
}): string {
  if (!/^[a-z0-9-]{1,48}$/.test(input.attempt))
    throw new Error('Owned API attempt identity is malformed');
  const expectedScript = path.join(input.serverRoot, 'scripts/testing/serve.ts');
  const current = input.current;
  requireIntegratedLoopbackOrigin(current.apiOrigin);
  if (
    !Number.isSafeInteger(current.apiPid) ||
    current.apiPid <= 1 ||
    current.apiStarted.length === 0 ||
    current.apiScript !== expectedScript
  )
    throw new Error('Owned current API provenance is malformed');
  const apiRows = input.manifest.processes.filter(
    (row) => row.role === 'api' && row.pid === current.apiPid,
  );
  if (
    apiRows.length !== 1 ||
    apiRows[0].started !== current.apiStarted ||
    apiRows[0].script !== expectedScript
  )
    throw new Error('Owned current API process is absent from the current manifest');
  const record = input.record;
  if (
    record.runId !== input.manifest.runId ||
    record.ownerTokenHash !== input.manifest.ownerTokenHash ||
    record.pid !== current.apiPid ||
    record.started !== current.apiStarted ||
    record.script !== expectedScript ||
    record.attempt !== input.attempt ||
    record.origin !== current.apiOrigin
  )
    throw new Error('Owned current API ledger identity mismatch');
  return input.attempt === OWNED_INITIAL_API_ATTEMPT
    ? `${input.manifest.runId}:first`
    : `${input.manifest.runId}:${input.attempt}`;
}

export async function readOwnedApiProcessAttempt(input: {
  manifest: OwnedManifest;
  serverRoot: string;
  current: OwnedApiProcessIdentity;
  attempt: string;
  signal?: AbortSignal;
}): Promise<{
  record: OwnedApiProcessRecord;
  receipt: OwnedRuntimeDocumentReceipt;
  backendAttemptId: string;
  apiAttempt: string;
}> {
  input.signal?.throwIfAborted();
  if (!/^[a-z0-9-]{1,48}$/.test(input.attempt))
    throw new Error('Owned API attempt identity is malformed');
  const basename = `api-${input.attempt}.json`;
  const source = await readOwnedRuntimeDocumentWithReceipt(
    path.join(input.manifest.artifactRoot, basename),
    input.manifest.artifactRoot,
    basename,
    'api-process-v1',
    input.signal,
  );
  input.signal?.throwIfAborted();
  const record = source.value as OwnedApiProcessRecord;
  const backendAttemptId = validateOwnedApiProcessAttempt({
    record,
    manifest: input.manifest,
    serverRoot: input.serverRoot,
    current: input.current,
    attempt: input.attempt,
  });
  input.signal?.throwIfAborted();
  return {
    record,
    receipt: source.receipt,
    backendAttemptId,
    apiAttempt: input.attempt,
  };
}

export function assertOwnedApiAttemptStateStable(
  expected: OwnedApiAttemptState,
  actual: OwnedApiAttemptState,
): void {
  if (
    actual.apiPid !== expected.apiPid ||
    actual.apiOrigin !== expected.apiOrigin ||
    actual.apiStarted !== expected.apiStarted ||
    actual.apiScript !== expected.apiScript ||
    actual.apiAttempt !== expected.apiAttempt
  )
    throw new Error('Owned API attempt changed during receipt acquisition');
}

function apiAttemptStateFromProbe(probe: OwnedApiAttemptProbe): OwnedApiAttemptState {
  return {
    apiPid: probe.apiPid,
    apiOrigin: probe.apiOrigin,
    apiStarted: probe.apiStarted,
    apiScript: probe.apiScript,
    apiAttempt: probe.apiAttempt,
  };
}

export async function readOwnedApiAttemptWithStability<T>(input: {
  captureState: () => OwnedApiAttemptState;
  assertLive: (
    expected: OwnedApiAttemptState,
    signal?: AbortSignal,
  ) => Promise<OwnedApiAttemptState>;
  read: (expected: OwnedApiAttemptState, signal?: AbortSignal) => Promise<T>;
  signal?: AbortSignal;
}): Promise<{ value: T; state: OwnedApiAttemptState }> {
  input.signal?.throwIfAborted();
  const before = input.captureState();
  assertOwnedApiAttemptStateStable(before, await input.assertLive(before, input.signal));
  const value = await input.read(before, input.signal);
  input.signal?.throwIfAborted();
  const after = await input.assertLive(before, input.signal);
  assertOwnedApiAttemptStateStable(before, after);
  return { value, state: after };
}

type OwnedSessionOptions = {
  serverRoot: string;
  appOrigin: string;
  bunExecutable?: string;
  deadlineMs?: number;
  signal?: AbortSignal;
  onAcquired?: (manifest: OwnedManifest) => void | Promise<void>;
};
async function prepareOwnedSession(options: OwnedSessionOptions) {
  options.signal?.throwIfAborted();
  for (const name of [
    'resource-manifest-v1',
    'api-process-v1',
    'session-event-v1',
    'session-request-v1',
    'session-receipt-v1',
    'application-fixtures-v1',
    'connection-snapshot-v1',
  ])
    loadTestingSchema(name);
  const serverRoot = await realpath(options.serverRoot);
  requireIntegratedLoopbackOrigin(options.appOrigin);
  const packageJson = JSON.parse(await readFile(path.join(serverRoot, 'package.json'), 'utf8')) as {
    name: string;
    engines: { bun: string };
  };
  if (packageJson.name !== 'mychampions-server') throw new Error('Wrong server owner repository');
  const script = path.join(serverRoot, 'scripts/testing/session.ts');
  let executable = options.bunExecutable;
  if (!executable) {
    const local = path.resolve(serverRoot, '../.local-bun/bin/bun');
    executable = await access(local)
      .then(() => local)
      .catch(() => 'bun');
  }
  const version = await execute(executable, ['--version'], {
    timeout: 5000,
    signal: options.signal,
  });
  if (version.stdout.trim() !== packageJson.engines.bun)
    throw new Error('Owned session Bun version mismatch');
  const deadlineMs = options.deadlineMs ?? 600_000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 3_600_000)
    throw new Error('Invalid owned session deadline');
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
  };
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT'])
    if (process.env[key]) env[key] = process.env[key];
  options.signal?.throwIfAborted();
  return { serverRoot, script, executable, env, deadlineMs };
}
export async function startOwnedSession(options: OwnedSessionOptions) {
  const { serverRoot, script, executable, env, deadlineMs } = await prepareOwnedSession(
    options,
  ).catch((cause: unknown) => {
    throw new OwnedSessionAcquisitionError({
      cleanup: 'not-acquired',
      childExitCode: null,
      cause,
    });
  });
  const child = spawn(
    executable,
    [
      '--no-env-file',
      script,
      '--web-origin',
      options.appOrigin,
      '--deadline-ms',
      String(deadlineMs),
    ],
    { cwd: serverRoot, env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  // Attach the line reader before any asynchronous ownership census. Bun can emit
  // `acquired` before `processStart` returns; buffering that first protocol event
  // preserves the handshake instead of leaving a healthy session idle in `tests`.
  const bufferedProtocolLines: string[] = [];
  let deliverProtocolLine: ((line: string) => void) | undefined;
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (deliverProtocolLine) deliverProtocolLine(line);
    else bufferedProtocolLines.push(line);
  });
  child.once('error', () => {}); // Observe a spawn failure before async ownership setup.
  // Capture close before any await as well: a child that exits during the start census
  // would otherwise close unobserved and leave acquisition waiting forever.
  const childClosed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => child.once('close', (code, signal) => resolve({ code, signal })),
  );
  if (!child.pid)
    throw new OwnedSessionAcquisitionError({
      cleanup: 'not-acquired',
      childExitCode: null,
    });
  const pid = child.pid;
  let orchestrator: OwnedOrchestratorIdentity = {
    pid,
    started: null,
    script,
    status: 'unavailable',
  };
  let childStarted: string;
  try {
    childStarted = await processStart(pid, options.signal);
    orchestrator = { pid, started: childStarted, script, status: 'verified' };
  } catch (error) {
    // The ChildProcess handle is still the direct owner capability, so it is
    // safe to request termination; the PID must never be treated as a proof
    // of ownership after the start census failed.
    child.kill('SIGTERM');
    throw new OwnedSessionAcquisitionError({
      cleanup: 'failed-recovery-ledger-retained',
      childExitCode: null,
      pid,
      orchestrator,
      cause: error,
    });
  }
  let acquired: Acquired | undefined;
  let ownerDigest: string | undefined;
  let ready: Ready | undefined;
  let initialApiIdentity: OwnedApiProcessIdentity | undefined;
  let currentApiAttempt: string = OWNED_INITIAL_API_ATTEMPT;
  let manifest: OwnedManifest | undefined;
  let acquiredManifestFacts: OwnedManifestFacts | undefined;
  let readyManifestFacts: OwnedManifestFacts | undefined;
  let approvedProcessLedger: OwnedProcessLedger | undefined;
  let closed: OwnedSessionClosed | undefined;
  let terminalRequestFailure: Error | undefined;
  let failed: Error | undefined;
  let failureDeadline: ReturnType<typeof setTimeout> | undefined;
  let counter = 0;
  let stopPromise: Promise<OwnedSessionClosed> | undefined;
  let stopId: string | undefined;
  let stderr = '';
  child.stderr.on('data', (bytes: Buffer) => {
    stderr = (stderr + bytes.toString()).slice(-65_536);
  });
  const pending = new Map<
    string,
    {
      op: string;
      resolve: (event: Event) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      disposeAbort: () => void;
    }
  >();
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const readiness = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Keep readiness rejection observed during child setup as well as the final await.
  void readiness.catch(() => {});
  const fail = (error: unknown) => {
    failed ??= error instanceof Error ? error : new Error('Owned session harness failed');
    rejectReady(failed);
    for (const row of pending.values()) {
      clearTimeout(row.timer);
      row.disposeAbort();
      row.reject(failed);
    }
    pending.clear();
    if (!closed && child.exitCode === null) {
      child.kill('SIGTERM');
      failureDeadline ??= setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 90_000);
    }
  };
  child.on('error', fail);
  const verifyApi = async (event: Ready | Restarted, attempt: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!manifest) throw new Error('Owned manifest missing');
    requireIntegratedLoopbackOrigin(event.apiOrigin);
    if (event.apiOrigin === options.appOrigin) throw new Error('API origin points to Expo');
    const record = (await readOwnedRuntimeDocument(
      path.join(manifest.artifactRoot, `api-${attempt}.json`),
      manifest.artifactRoot,
      `api-${attempt}.json`,
      'api-process-v1',
      signal,
    )) as OwnedApiProcessRecord;
    if (
      record.runId !== manifest.runId ||
      record.ownerTokenHash !== manifest.ownerTokenHash ||
      record.pid !== event.apiPid ||
      record.origin !== event.apiOrigin ||
      record.attempt !== attempt ||
      record.script !== path.join(serverRoot, 'scripts/testing/serve.ts') ||
      record.started !== (await processStart(record.pid, signal))
    )
      throw new Error('Owned API process identity mismatch');
    const manifestPath = event.event === 'ready' ? event.manifestPath : ready!.manifestPath;
    manifest = validateOwnedManifest(
      await readOwnedRuntimeDocument(
        manifestPath,
        manifest.artifactRoot,
        'manifest.json',
        'resource-manifest-v1',
        signal,
      ),
      { serverRoot, runId: manifest.runId, pid, started: childStarted },
    );
    if (manifest.ownerTokenHash !== ownerDigest)
      throw new Error('Owned API manifest digest changed');
    if (
      !manifest.processes.some(
        (process) =>
          process.role === 'api' &&
          process.pid === record.pid &&
          process.started === record.started &&
          process.script === record.script,
      )
    )
      throw new Error('API process absent from owned manifest');
    const healthSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(2000)])
      : AbortSignal.timeout(2000);
    const health = await fetch(`${event.apiOrigin}/health`, {
      signal: healthSignal,
    });
    signal?.throwIfAborted();
    if (!health.ok) throw new Error('Owned API health check failed');
  };
  let queue = Promise.resolve();
  const receive = async (line: string) => {
    if (line.length > 65_536) throw new Error('Owned session response exceeds size limit');
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error('Owned session emitted invalid protocol JSON');
    }
    assertTestingDocument('session-event-v1', raw);
    const event = raw as Event;
    if (event.event === 'acquired') {
      if (acquired || ready || closed) throw new Error('Duplicate or late acquired event');
      manifest = validateOwnedManifest(
        await readOwnedRuntimeDocument(
          event.manifestPath,
          path.join(serverRoot, '.qa/runtime', event.runId),
          'manifest.json',
          'resource-manifest-v1',
          options.signal,
        ),
        {
          serverRoot,
          runId: event.runId,
          pid,
          started: childStarted,
          acquiring: true,
        },
      );
      acquired = event;
      acquiredManifestFacts = captureOwnedManifestFacts(manifest);
      approvedProcessLedger = captureOwnedProcessLedger(manifest, [
        { role: 'orchestrator', pid: manifest.orchestratorPid },
      ]);
      ownerDigest = manifest.ownerTokenHash;
      await options.onAcquired?.(manifest);
      if (options.signal?.aborted) abortAcquisition();
      return;
    }
    if (event.event === 'ready') {
      if (
        ready ||
        !acquired ||
        acquired.runId !== event.runId ||
        acquired.manifestPath !== event.manifestPath
      )
        throw new Error('Unowned or duplicate session readiness');
      const runRoot = path.join(serverRoot, '.qa/runtime', event.runId);
      const value = await readOwnedRuntimeDocument(
        event.manifestPath,
        runRoot,
        'manifest.json',
        'resource-manifest-v1',
        options.signal,
      );
      manifest = validateOwnedManifest(value, {
        serverRoot,
        runId: event.runId,
        pid,
        started: childStarted,
      });
      if (manifest.ownerTokenHash !== ownerDigest) throw new Error('Owned session digest changed');
      if (acquiredManifestFacts) assertOwnedManifestFactsStable(acquiredManifestFacts, manifest);
      if (options.signal?.aborted) {
        abortAcquisition();
        return;
      }
      await verifyApi(event, 'session-start', options.signal);
      const initialApiProcess = manifest.processes.find(
        (row) => row.role === 'api' && row.pid === event.apiPid,
      );
      if (!initialApiProcess)
        throw new Error('Owned initial API process record missing after readiness');
      if (!approvedProcessLedger)
        throw new Error('Owned session process ledger was never established');
      initialApiIdentity = {
        apiPid: event.apiPid,
        apiOrigin: event.apiOrigin,
        apiStarted: initialApiProcess.started,
        apiScript: initialApiProcess.script,
      };
      const readyProcessLedger = captureOwnedProcessLedger(manifest, [
        ...approvedProcessLedger.map(({ role, pid }) => ({ role, pid })),
        { role: 'api', pid: event.apiPid },
      ]);
      assertOwnedProcessLedgerStable(readyProcessLedger, manifest);
      approvedProcessLedger = readyProcessLedger;
      readyManifestFacts = captureOwnedManifestFacts(manifest);
      currentApiAttempt = OWNED_INITIAL_API_ATTEMPT;
      ready = event;
      resolveReady();
      return;
    }
    if (event.event === 'closed') {
      if (closed || !acquired || !manifest)
        throw new Error('Owned session closed without acquired identity');
      if (!approvedProcessLedger)
        throw new Error('Owned session process ledger was never established');
      manifest = validateOwnedManifest(
        await readOwnedRuntimeDocument(
          acquired.manifestPath,
          manifest.artifactRoot,
          'manifest.json',
          'resource-manifest-v1',
          options.signal,
        ),
        {
          serverRoot,
          runId: acquired.runId,
          pid,
          started: childStarted,
          acquiring: true,
        },
      );
      if (manifest.ownerTokenHash !== ownerDigest)
        throw new Error('Closed session owner digest changed');
      const receiptSource = await readOwnedRuntimeDocumentWithReceipt(
        event.receiptPath,
        manifest.artifactRoot,
        'session-receipt.json',
        'session-receipt-v1',
        options.signal,
      );
      const terminal = validateOwnedSessionClosed({
        event,
        receipt: receiptSource.value as OwnedSessionReceipt,
        receiptDocument: receiptSource.receipt,
        manifest,
        acquiredFacts: acquiredManifestFacts,
        readyFacts: readyManifestFacts,
        approvedProcessLedger,
        stopId,
      });
      closed = terminal;
      if (!ready) rejectReady(new Error('Owned session closed before API readiness'));
      if (stopId) {
        const row = pending.get(stopId);
        if (row) {
          clearTimeout(row.timer);
          row.disposeAbort();
          pending.delete(stopId);
          row.resolve(terminal);
        }
      }
      const requestFailure = pending.size
        ? new Error('Owned session closed with an outstanding request')
        : undefined;
      terminalRequestFailure ??= requestFailure;
      for (const row of pending.values()) {
        clearTimeout(row.timer);
        row.disposeAbort();
        row.reject(requestFailure ?? new Error('Owned session closed with an outstanding request'));
      }
      pending.clear();
      return;
    }
    const row = pending.get(event.id);
    if (
      !row ||
      (row.op === 'seed'
        ? event.event !== 'seeded'
        : row.op === 'snapshot'
          ? event.event !== 'snapshotted'
          : row.op === 'connection-snapshot'
            ? event.event !== 'connection-snapshotted'
            : row.op !== 'restart' || event.event !== 'restarted')
    )
      throw new Error('Owned session response ID/operation mismatch');
    if (event.event === 'restarted') {
      await verifyApi(event, event.id, options.signal);
      if (!ready || event.previousPid !== ready.apiPid || event.apiPid === ready.apiPid)
        throw new Error('Owned API did not restart');
      if (!approvedProcessLedger)
        throw new Error('Owned session process ledger was never established');
      if (
        !approvedProcessLedger.some(
          (record) => record.role === 'api' && record.pid === event.previousPid,
        )
      )
        throw new Error('Owned API restart predecessor is absent from the process ledger');
      const restartedProcessLedger = captureOwnedProcessLedger(manifest!, [
        ...approvedProcessLedger.map(({ role, pid }) => ({ role, pid })),
        { role: 'api', pid: event.apiPid },
      ]);
      assertOwnedProcessLedgerStable(restartedProcessLedger, manifest!);
      approvedProcessLedger = restartedProcessLedger;
      ready = { ...ready, apiPid: event.apiPid, apiOrigin: event.apiOrigin };
      currentApiAttempt = event.id;
    }
    clearTimeout(row.timer);
    row.disposeAbort();
    pending.delete(event.id);
    row.resolve(event);
  };
  const enqueueProtocolLine = (line: string) => {
    queue = queue.then(() => receive(line)).catch(fail);
  };
  deliverProtocolLine = enqueueProtocolLine;
  for (const line of bufferedProtocolLines.splice(0)) enqueueProtocolLine(line);
  const exited = childClosed.then(({ code, signal }) =>
    queue.then(() => {
      if (!closed) fail(new Error('Owned session exited without a validated close receipt'));
      const result = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 2);
      if (closed && closed.exitCode !== result)
        fail(new Error('Owned session exit differs from its receipt'));
      clearTimeout(failureDeadline);
      return result;
    }),
  );
  const request = (
    op: 'seed' | 'snapshot' | 'connection-snapshot' | 'restart' | 'stop',
    scope?: string,
    signal?: AbortSignal,
  ): Promise<Event> => {
    signal?.throwIfAborted();
    if (failed) return Promise.reject(failed);
    if (closed || stopId) return Promise.reject(new Error('Owned session is closing'));
    const id = `${op}-${++counter}`;
    const value =
      op === 'seed' || op === 'snapshot' || op === 'connection-snapshot'
        ? { id, op, scope }
        : op === 'restart'
          ? { id, op, attempt: id }
          : { id, op };
    assertTestingDocument('session-request-v1', value);
    if (op === 'stop') stopId = id;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(
        () => fail(new Error('Owned session request deadline exceeded')),
        op === 'stop' ? 90_000 : 30_000,
      );
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new Error(`Owned session ${op} request aborted`),
        );
      };
      const disposeAbort = () => signal?.removeEventListener('abort', onAbort);
      const resolveOnce = (event: Event) => {
        disposeAbort();
        if (!settled) {
          settled = true;
          resolve(event);
        }
      };
      const rejectOnce = (error: Error) => {
        disposeAbort();
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      pending.set(id, {
        op,
        resolve: resolveOnce,
        reject: rejectOnce,
        timer,
        disposeAbort,
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stdin.write(`${JSON.stringify(value)}\n`, (error) => {
        if (error) fail(new Error('Owned session protocol write failed'));
      });
    });
  };
  const bootTimer = setTimeout(
    () => fail(new Error('Owned session acquisition deadline exceeded')),
    Math.min(deadlineMs, 120_000),
  );
  function abortAcquisition() {
    // fail() rejects readiness and terminates the owned child even before the
    // server emits its acquired identity; recovery remains bounded and visible.
    fail(new Error('Owned session acquisition cancelled'));
  }
  options.signal?.addEventListener('abort', abortAcquisition, { once: true });
  if (options.signal?.aborted) abortAcquisition();
  try {
    await readiness;
    if (options.signal?.aborted || failed)
      throw failed ?? new Error('Owned session acquisition cancelled');
  } catch (error) {
    const code = await exited;
    throw new OwnedSessionAcquisitionError({
      cleanup:
        closed && closed.exitCode === code && manifest
          ? closed.cleanup
          : 'failed-recovery-ledger-retained',
      manifest,
      closed,
      childExitCode: code,
      pid,
      orchestrator,
      diagnostics: stderr,
      cause: error,
    });
  } finally {
    clearTimeout(bootTimer);
    options.signal?.removeEventListener('abort', abortAcquisition);
  }
  const captureCurrentApiState = (): OwnedApiAttemptState => {
    if (!ready || !manifest || closed || failed || stopId)
      throw new Error('Owned API session is closed, closing, or failed');
    const apiPid = ready.apiPid;
    const record = manifest.processes.find((row) => row.role === 'api' && row.pid === apiPid);
    if (!record || record.script !== path.join(serverRoot, 'scripts/testing/serve.ts'))
      throw new Error('Owned API process record missing');
    return {
      apiPid,
      apiOrigin: ready.apiOrigin,
      apiStarted: record.started,
      apiScript: record.script,
      apiAttempt: currentApiAttempt,
    };
  };
  const assertCurrentApiStateLive = async (signal?: AbortSignal): Promise<OwnedApiAttemptState> => {
    signal?.throwIfAborted();
    const expected = captureCurrentApiState();
    const [started, command] = await Promise.all([
      processStart(expected.apiPid, signal),
      execute('ps', ['-p', String(expected.apiPid), '-o', 'command='], {
        timeout: 5000,
        signal,
      }),
    ]);
    signal?.throwIfAborted();
    if (
      started !== expected.apiStarted ||
      !command.stdout.includes(expected.apiScript) ||
      closed ||
      failed
    )
      throw new Error('Owned API process identity changed');
    const actual = captureCurrentApiState();
    assertOwnedApiAttemptStateStable(expected, actual);
    return actual;
  };
  const assertCurrentApiOwnership = async (signal?: AbortSignal) =>
    (await assertCurrentApiStateLive(signal)).apiOrigin;
  const assertLiveCurrentApi = async (
    expected: OwnedApiAttemptState,
    signal?: AbortSignal,
  ): Promise<OwnedApiAttemptState> => {
    const actual = await assertCurrentApiStateLive(signal);
    assertOwnedApiAttemptStateStable(expected, actual);
    return actual;
  };
  const readCurrentApiLifetime = async (signal?: AbortSignal): Promise<OwnedApiAttemptProbe> => {
    const stable = await readOwnedApiAttemptWithStability({
      captureState: captureCurrentApiState,
      assertLive: assertLiveCurrentApi,
      read: async (expected, readSignal) => {
        const readManifest = manifest!;
        const readManifestPath = ready!.manifestPath;
        const manifestDocument = await readOwnedRuntimeDocumentWithReceipt(
          readManifestPath,
          readManifest.artifactRoot,
          'manifest.json',
          'resource-manifest-v1',
          readSignal,
        );
        const currentManifest = validateOwnedManifest(manifestDocument.value, {
          serverRoot,
          runId: readManifest.runId,
          pid,
          started: childStarted,
        });
        if (
          currentManifest.runId !== readManifest.runId ||
          !ownerDigest ||
          currentManifest.ownerTokenHash !== ownerDigest
        )
          throw new Error('Owned current API lifetime probe manifest changed');
        const apiProcess = currentManifest.processes.find(
          (row) => row.role === 'api' && row.pid === expected.apiPid,
        );
        if (!apiProcess) throw new Error('Owned current API process record missing');
        const currentApi = await readOwnedApiProcessAttempt({
          manifest: currentManifest,
          serverRoot,
          current: expected,
          attempt: expected.apiAttempt,
          signal: readSignal,
        });
        return {
          runId: readManifest.runId,
          backendAttemptId: currentApi.backendAttemptId,
          manifestSha256: manifestDocument.receipt.sha256,
          apiAttempt: currentApi.apiAttempt,
          apiLedgerSha256: currentApi.receipt.sha256,
        };
      },
      signal,
    });
    return {
      runId: stable.value.runId,
      apiOrigin: stable.state.apiOrigin,
      apiPid: stable.state.apiPid,
      apiStarted: stable.state.apiStarted,
      apiScript: stable.state.apiScript,
      backendAttemptId: stable.value.backendAttemptId,
      manifestSha256: stable.value.manifestSha256,
      apiAttempt: stable.state.apiAttempt,
      apiLedgerSha256: stable.value.apiLedgerSha256,
    };
  };
  return {
    pid,
    get manifest() {
      return manifest!;
    },
    get apiOrigin() {
      return ready!.apiOrigin;
    },
    get apiPid() {
      return ready!.apiPid;
    },
    get diagnostics() {
      return stderr;
    },
    async assertApiOwnership(signal?: AbortSignal) {
      return assertCurrentApiOwnership(signal);
    },
    async probeApiLifetime(signal?: AbortSignal): Promise<OwnedApiLifetimeProbe> {
      signal?.throwIfAborted();
      if (!initialApiIdentity)
        throw new Error('Owned initial API provenance was never established');
      if (currentApiAttempt !== OWNED_INITIAL_API_ATTEMPT)
        throw new Error('Owned initial API provenance was restarted');
      const currentApi = await readCurrentApiLifetime(signal);
      if (
        currentApi.apiPid !== initialApiIdentity.apiPid ||
        currentApi.apiOrigin !== initialApiIdentity.apiOrigin ||
        currentApi.apiStarted !== initialApiIdentity.apiStarted ||
        currentApi.apiScript !== initialApiIdentity.apiScript
      )
        throw new Error('Owned first API provenance changed or was restarted');
      signal?.throwIfAborted();
      return {
        runId: currentApi.runId,
        apiOrigin: currentApi.apiOrigin,
        apiPid: currentApi.apiPid,
        apiStarted: currentApi.apiStarted,
        apiScript: currentApi.apiScript,
        backendAttemptId: currentApi.backendAttemptId,
        manifestSha256: currentApi.manifestSha256,
        apiAttempt: currentApi.apiAttempt,
        apiLedgerSha256: currentApi.apiLedgerSha256,
      };
    },
    async probeCurrentApiLifetime(signal?: AbortSignal): Promise<OwnedApiAttemptProbe> {
      return readCurrentApiLifetime(signal);
    },
    async fixtures(scope: string, signal?: AbortSignal): Promise<OwnedFixtures> {
      signal?.throwIfAborted();
      const response = (await request('seed', scope, signal)) as Seeded;
      const value = (await readOwnedRuntimeDocument(
        response.fixtureRef,
        manifest!.artifactRoot,
        `fixtures-${scope}.private.json`,
        'application-fixtures-v1',
        signal,
      )) as OwnedFixtures;
      if (value.runId !== manifest!.runId || value.scope !== scope)
        throw new Error('Private fixture identity mismatch');
      manifest = validateOwnedManifest(
        await readOwnedRuntimeDocument(
          ready!.manifestPath,
          manifest!.artifactRoot,
          'manifest.json',
          'resource-manifest-v1',
          signal,
        ),
        { serverRoot, runId: ready!.runId, pid, started: childStarted },
      );
      if (!manifest.fixtureScopes.includes(scope))
        throw new Error('Fixture scope absent from owned manifest');
      return value;
    },
    async snapshotWithEvidence(
      scope: string,
      signal?: AbortSignal,
    ): Promise<OwnedSnapshotEvidence<OwnedDomainSnapshot>> {
      signal?.throwIfAborted();
      const snapshotState = captureCurrentApiState();
      const response = (await request('snapshot', scope, signal)) as Snapshotted;
      const source = await readOwnedRuntimeDocumentWithReceipt(
        response.snapshotRef,
        manifest!.artifactRoot,
        `snapshot-${scope}-${response.id}.private.json`,
        'domain-snapshot-v1',
        signal,
      );
      const value = source.value as OwnedDomainSnapshot;
      if (
        value.runId !== manifest!.runId ||
        value.scope !== scope ||
        !manifest!.fixtureScopes.includes(scope)
      )
        throw new Error('Private snapshot identity mismatch');
      const fixtures = (await readOwnedRuntimeDocument(
        path.join(manifest!.artifactRoot, `fixtures-${scope}.private.json`),
        manifest!.artifactRoot,
        `fixtures-${scope}.private.json`,
        'application-fixtures-v1',
        signal,
      )) as OwnedFixtures;
      if (fixtures.runId !== manifest!.runId || fixtures.scope !== scope)
        throw new Error('Private snapshot fixture identity mismatch');
      const api = await readCurrentApiLifetime(signal);
      assertOwnedApiAttemptStateStable(snapshotState, apiAttemptStateFromProbe(api));
      return {
        value,
        receipt: {
          ...source.receipt,
          parentRoot: manifest!.artifactRoot,
          kind: 'domain',
          runId: value.runId,
          scope: value.scope,
          snapshotId: response.id,
          apiOrigin: api.apiOrigin,
          apiPid: api.apiPid,
          apiStarted: api.apiStarted,
          apiScript: api.apiScript,
          backendAttemptId: api.backendAttemptId,
          manifestSha256: api.manifestSha256,
          apiAttempt: api.apiAttempt,
          apiLedgerSha256: api.apiLedgerSha256,
          fixtureAuthUidAllowlistHash: createHash('sha256')
            .update(
              JSON.stringify(
                Object.values(fixtures.accounts)
                  .map((account) => account.authUid)
                  .sort(),
              ),
            )
            .digest('hex'),
          verification: 'owned-runtime-document-v6',
        },
      };
    },
    async snapshot(scope: string, signal?: AbortSignal): Promise<OwnedDomainSnapshot> {
      return (await this.snapshotWithEvidence(scope, signal)).value;
    },
    async connectionSnapshotWithEvidence(
      scope: string,
      signal?: AbortSignal,
    ): Promise<OwnedSnapshotEvidence<OwnedConnectionSnapshot>> {
      signal?.throwIfAborted();
      const snapshotState = captureCurrentApiState();
      if (!manifest!.fixtureScopes.includes(scope))
        throw new Error('Connection snapshot scope was not seeded');
      const response = (await request(
        'connection-snapshot',
        scope,
        signal,
      )) as ConnectionSnapshotted;
      const fixtures = (await readOwnedRuntimeDocument(
        path.join(manifest!.artifactRoot, `fixtures-${scope}.private.json`),
        manifest!.artifactRoot,
        `fixtures-${scope}.private.json`,
        'application-fixtures-v1',
        signal,
      )) as OwnedFixtures;
      if (fixtures.runId !== manifest!.runId || fixtures.scope !== scope)
        throw new Error('Private connection snapshot fixture identity mismatch');
      const source = await readOwnedRuntimeDocumentWithReceipt(
        response.snapshotRef,
        manifest!.artifactRoot,
        `connection-snapshot-${scope}-${response.id}.private.json`,
        'connection-snapshot-v1',
        signal,
      );
      const value = requireConnectionSnapshot(source.value, {
        runId: manifest!.runId,
        scope,
        fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
        target: {
          professionalAuthUid: fixtures.accounts.coach.authUid,
          studentAuthUid: fixtures.accounts.student.authUid,
          specialty: 'fitness_coach',
        },
      });
      const api = await readCurrentApiLifetime(signal);
      assertOwnedApiAttemptStateStable(snapshotState, apiAttemptStateFromProbe(api));
      return {
        value,
        receipt: {
          ...source.receipt,
          parentRoot: manifest!.artifactRoot,
          kind: 'connection',
          runId: value.runId,
          scope: value.scope,
          snapshotId: response.id,
          apiOrigin: api.apiOrigin,
          apiPid: api.apiPid,
          apiStarted: api.apiStarted,
          apiScript: api.apiScript,
          backendAttemptId: api.backendAttemptId,
          manifestSha256: api.manifestSha256,
          apiAttempt: api.apiAttempt,
          apiLedgerSha256: api.apiLedgerSha256,
          fixtureAuthUidAllowlistHash: createHash('sha256')
            .update(
              JSON.stringify(
                Object.values(fixtures.accounts)
                  .map((account) => account.authUid)
                  .sort(),
              ),
            )
            .digest('hex'),
          verification: 'owned-runtime-document-v6',
        },
      };
    },
    async connectionSnapshot(
      scope: string,
      signal?: AbortSignal,
    ): Promise<OwnedConnectionSnapshot> {
      return (await this.connectionSnapshotWithEvidence(scope, signal)).value;
    },
    async restart(signal?: AbortSignal) {
      await request('restart', undefined, signal);
      return { apiOrigin: ready!.apiOrigin, apiPid: ready!.apiPid };
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        if (closed) {
          await exited;
          if (failed) throw failed;
          if (!canReleaseOwnedSessionCleanly(closed, terminalRequestFailure))
            throw new Error('Owned session cleanup blocked');
          return closed;
        }
        const result = (await request('stop')) as OwnedSessionClosed;
        await exited;
        if (failed) throw failed;
        if (!canReleaseOwnedSessionCleanly(result, terminalRequestFailure))
          throw new Error('Owned session cleanup blocked');
        return result;
      })();
      return stopPromise;
    },
    async cancel(signal: 'SIGINT' | 'SIGTERM') {
      if (child.exitCode === null && !closed) child.kill(signal);
      const code = await exited;
      if (failed) throw failed;
      if (!closed) throw new Error('Owned session exited without a validated close receipt');
      if (closed.exitCode !== code) throw new Error('Owned session exit differs from its receipt');
      return { exitCode: code, closed };
    },
  };
}
