import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  readOwnedAndroidBoundedFile,
  writeOwnedAndroidPrivateFile,
  type AndroidStorageFileReceipt,
} from './native-android-session-adapter';
import {
  OWNED_INITIAL_API_LEDGER_BASENAME,
  readOwnedRuntimeDocumentWithReceipt,
  type OwnedApiLifetimeProbe,
  type OwnedApiProcessRecord,
  type OwnedDomainSnapshot,
  type OwnedManifest,
  type OwnedRuntimeDocumentReceipt,
  type OwnedSnapshotEvidence,
  type OwnedSnapshotReceipt,
} from './owned-session';
import { assertTestingDocument } from './schema-validation';
import type {
  AndroidCameraSqlReceiptPhase,
  AndroidCameraSqlSourceReceipt,
} from './native-camera-android-observation';
import type { OwnedConnectionSnapshot } from './native-connection-snapshot';

const CONNECTION_TABLES = [
  'userProfiles',
  'professionalSpecialties',
  'inviteCodes',
  'connections',
  'connectionInviteGuards',
  'pendingStudents',
  'pendingStudentSlots',
  'trackingAccess',
  'activeSpecialties',
] as const;

type ConnectionTable = (typeof CONNECTION_TABLES)[number];

type SourceConnectionEvidence = OwnedSnapshotEvidence<OwnedConnectionSnapshot>;
type SourceDomainEvidence = OwnedSnapshotEvidence<OwnedDomainSnapshot>;

type SourceReceipt = AndroidStorageFileReceipt & {
  phase: AndroidCameraSqlReceiptPhase;
  scope: string;
  table: ConnectionTable | 'domain';
  queryId: string;
  parentSnapshotRoot: string;
  parentManifestPath: 'manifest.json';
  parentManifestRetainedPath: string;
  parentManifestRetainedKind: 'sidecar';
  parentManifestRetainedSha256: string;
  parentManifestRetainedSizeBytes: number;
  parentManifestRetainedOwnerUid: number;
  parentManifestRetainedMode: number;
  parentManifestRetainedVerification: 'owned-stable-reader-v6';
  parentManifestSizeBytes: number;
  parentSnapshotPath: string;
  parentSnapshotRetainedPath: string;
  parentSnapshotRetainedKind: 'sidecar';
  parentSnapshotRetainedSha256: string;
  parentSnapshotRetainedSizeBytes: number;
  parentSnapshotRetainedOwnerUid: number;
  parentSnapshotRetainedMode: number;
  parentSnapshotRetainedVerification: 'owned-stable-reader-v6';
  parentSnapshotSha256: string;
  parentSnapshotSchema: 'connection-snapshot-v1' | 'domain-snapshot-v1';
  parentSnapshotKind: 'connection' | 'domain';
  parentSnapshotSizeBytes: number;
  parentSnapshotOwnerUid: number;
  parentSnapshotMode: number;
  parentSnapshotVerification: 'owned-runtime-document-v6';
  parentApiLedgerPath: string;
  parentApiLedgerRetainedPath: string;
  parentApiLedgerRetainedKind: 'sidecar';
  parentApiLedgerRetainedSha256: string;
  parentApiLedgerRetainedSizeBytes: number;
  parentApiLedgerRetainedOwnerUid: number;
  parentApiLedgerRetainedMode: number;
  parentApiLedgerRetainedVerification: 'owned-stable-reader-v6';
  parentApiLedgerSizeBytes: number;
  parentRunId: string;
  parentScope: string;
  parentApiOrigin: string;
  parentApiPid: number;
  parentApiStarted: string;
  parentApiScript: string;
  parentBackendAttemptId: string;
  parentManifestSha256: string;
  parentApiAttempt: string;
  parentApiLedgerSha256: string;
  parentFixtureAuthUidAllowlistHash: string;
  sourceProjection:
    'owned-session.connection-snapshot-v1.rows' | 'owned-session.domain-snapshot-v1.document';
};

export type SourceEvidence = SourceConnectionEvidence | SourceDomainEvidence;
type ParentKind = 'connection' | 'domain';

type StableOwnedDocument<T> = {
  value: T;
  bytes: Buffer;
  receipt: OwnedRuntimeDocumentReceipt;
  identity: Awaited<ReturnType<typeof readOwnedAndroidBoundedFile>>['identity'];
};

export type RetainedParentEvidence = {
  snapshot: AndroidStorageFileReceipt;
  manifest: AndroidStorageFileReceipt;
  apiLedger: AndroidStorageFileReceipt;
};

type OwnedParentProvenance = {
  parentRoot: string;
  manifestPath: 'manifest.json';
  manifest: StableOwnedDocument<OwnedManifest>;
  apiLedgerPath: string;
  apiLedger: StableOwnedDocument<OwnedApiProcessRecord>;
};

export type VerifiedParent = {
  evidence: SourceEvidence;
  receipt: OwnedSnapshotReceipt;
  bytes: Buffer;
  provenance: OwnedParentProvenance;
  retained?: RetainedParentEvidence;
};

const HASH = /^[a-f0-9]{64}$/u;
const MAX_PARENT_BYTES = 1 * 1024 * 1024;

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && HASH.test(value), `${label} is not a SHA-256`);
}

function requireRelativePath(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' &&
      value.length > 0 &&
      !path.isAbsolute(value) &&
      !value.split(/[\\/]/u).includes('..') &&
      !value.includes('\\0'),
    `${label} must be an owned relative path`,
  );
}

function requireRetainedReceipt(
  value: AndroidStorageFileReceipt,
  parent: OwnedSnapshotReceipt,
): void {
  requireRetainedCopy(value, {
    expectedPath: parent.path,
    expectedSha256: parent.sha256,
    expectedSizeBytes: parent.sizeBytes,
    label: 'retained parent snapshot',
  });
}

function requireRetainedCopy(
  value: AndroidStorageFileReceipt,
  input: {
    expectedPath?: string;
    expectedSha256: string;
    expectedSizeBytes: number;
    label: string;
  },
): void {
  requireRelativePath(value.path, `${input.label} path`);
  if (input.expectedPath)
    assert.notEqual(value.path, input.expectedPath, `${input.label} aliases its source path`);
  assert.equal(value.kind, 'sidecar');
  assert(Number.isSafeInteger(value.sizeBytes) && value.sizeBytes === input.expectedSizeBytes);
  requireHash(value.sha256, `${input.label} hash`);
  assert.equal(value.sha256, input.expectedSha256);
  assert.equal(value.ownerUid, process.getuid?.());
  assert.equal(value.mode, 0o600);
  assert.equal(value.verification, 'owned-stable-reader-v6');
}

function requireParentReceipt(
  value: OwnedSnapshotReceipt,
  expectedKind: ParentKind,
  expectedSchema: 'connection-snapshot-v1' | 'domain-snapshot-v1',
): void {
  assert(typeof value.parentRoot === 'string' && value.parentRoot.length > 0);
  assert(path.isAbsolute(value.parentRoot), 'parent snapshot root must be absolute');
  assert.equal(path.resolve(value.parentRoot), value.parentRoot);
  requireRelativePath(value.path, 'parent snapshot path');
  assert.equal(value.schema, expectedSchema);
  assert.equal(value.kind, expectedKind);
  assert.equal(value.verification, 'owned-runtime-document-v6');
  assert(Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0);
  assert(value.sizeBytes <= MAX_PARENT_BYTES);
  requireHash(value.sha256, 'parent snapshot hash');
  assert.equal(value.ownerUid, process.getuid?.());
  assert.equal(value.mode, 0o600);
  assert(typeof value.runId === 'string' && value.runId.length > 0);
  assert(typeof value.scope === 'string' && value.scope.length > 0);
  assert(typeof value.snapshotId === 'string' && value.snapshotId.length > 0);
  assert(typeof value.apiOrigin === 'string' && value.apiOrigin.length > 0);
  assert(Number.isSafeInteger(value.apiPid) && value.apiPid > 0);
  assert(typeof value.apiStarted === 'string' && value.apiStarted.length > 0);
  assert(typeof value.apiScript === 'string' && value.apiScript.length > 0);
  assert(typeof value.backendAttemptId === 'string' && value.backendAttemptId.length > 0);
  requireHash(value.manifestSha256, 'parent manifest hash');
  assert(typeof value.apiAttempt === 'string' && value.apiAttempt.length > 0);
  requireHash(value.apiLedgerSha256, 'parent API ledger hash');
  requireHash(value.fixtureAuthUidAllowlistHash, 'parent fixture allowlist hash');
}

function requireParentRootIdentity(input: {
  artifactRoot: string;
  receipt: OwnedSnapshotReceipt;
}): string {
  const parentRoot = path.resolve(input.receipt.parentRoot);
  assert.equal(parentRoot, input.receipt.parentRoot, 'parent snapshot root is not normalized');
  assert.notEqual(
    parentRoot,
    path.resolve(input.artifactRoot),
    'Android camera SQL parent root must be distinct from the capture root',
  );
  return parentRoot;
}

async function readStableOwnedDocument<T>(input: {
  parentRoot: string;
  basename: string;
  schema: 'resource-manifest-v1' | 'api-process-v1';
  label: string;
  signal?: AbortSignal;
}): Promise<StableOwnedDocument<T>> {
  const parsed = await readOwnedRuntimeDocumentWithReceipt(
    path.join(input.parentRoot, input.basename),
    input.parentRoot,
    input.basename,
    input.schema,
    input.signal,
  );
  const loaded = await readOwnedAndroidBoundedFile({
    artifactRoot: input.parentRoot,
    filePath: path.join(input.parentRoot, input.basename),
    label: input.label,
    maxBytes: MAX_PARENT_BYTES,
    signal: input.signal,
  });
  assert.equal(loaded.path, input.basename, `${input.label} path changed`);
  assert.equal(loaded.bytes.byteLength, parsed.receipt.sizeBytes, `${input.label} size changed`);
  assert.equal(sha256(loaded.bytes), parsed.receipt.sha256, `${input.label} hash changed`);
  return {
    value: parsed.value as T,
    bytes: loaded.bytes,
    receipt: parsed.receipt,
    identity: loaded.identity,
  };
}

function apiLedgerPath(apiAttempt: string): string {
  assert.match(apiAttempt, /^[a-z0-9-]{1,48}$/u, 'parent API attempt is malformed');
  return apiAttempt === 'session-start'
    ? OWNED_INITIAL_API_LEDGER_BASENAME
    : `api-${apiAttempt}.json`;
}

function requireApiProvenance(
  input: {
    receipt: OwnedSnapshotReceipt;
    parentRoot: string;
  },
  manifest: StableOwnedDocument<OwnedManifest>,
  apiLedgerPath: string,
  apiLedger: StableOwnedDocument<OwnedApiProcessRecord>,
): OwnedParentProvenance {
  assert.equal(
    manifest.receipt.sha256,
    input.receipt.manifestSha256,
    'Android camera SQL parent manifest hash is not receipt-bound',
  );
  const manifestRecord = manifest.value;
  assert.equal(
    manifestRecord.runId,
    input.receipt.runId,
    'Android camera SQL parent run is not manifest-bound',
  );
  assert.equal(
    manifestRecord.artifactRoot,
    input.parentRoot,
    'Android camera SQL parent root is not manifest-bound',
  );
  const api = manifestRecord.processes.find(
    (row) => row.role === 'api' && row.pid === input.receipt.apiPid,
  );
  assert(api, 'Android camera SQL parent API owner is missing from the manifest');
  assert.equal(
    api.started,
    input.receipt.apiStarted,
    'Android camera SQL parent API start is not manifest-bound',
  );
  assert.equal(
    api.script,
    input.receipt.apiScript,
    'Android camera SQL parent API script is not manifest-bound',
  );
  assert.equal(
    apiLedger.receipt.sha256,
    input.receipt.apiLedgerSha256,
    'Android camera SQL parent API ledger hash is not receipt-bound',
  );
  const ledger = apiLedger.value;
  assert.equal(ledger.runId, input.receipt.runId, 'Android camera SQL API ledger run is not bound');
  assert.equal(
    ledger.ownerTokenHash,
    manifestRecord.ownerTokenHash,
    'Android camera SQL API ledger owner is not manifest-bound',
  );
  assert.equal(
    ledger.pid,
    input.receipt.apiPid,
    'Android camera SQL API ledger PID is not receipt-bound',
  );
  assert.equal(
    ledger.started,
    input.receipt.apiStarted,
    'Android camera SQL API ledger start is not receipt-bound',
  );
  assert.equal(
    ledger.script,
    input.receipt.apiScript,
    'Android camera SQL API ledger script is not receipt-bound',
  );
  assert.equal(
    ledger.attempt,
    input.receipt.apiAttempt,
    'Android camera SQL API ledger attempt is not receipt-bound',
  );
  assert.equal(
    ledger.origin,
    input.receipt.apiOrigin,
    'Android camera SQL API ledger origin is not receipt-bound',
  );
  return {
    parentRoot: input.parentRoot,
    manifestPath: 'manifest.json',
    manifest,
    apiLedgerPath,
    apiLedger,
  };
}

async function readOwnedParentProvenance(input: {
  artifactRoot: string;
  receipt: OwnedSnapshotReceipt;
  signal?: AbortSignal;
}): Promise<OwnedParentProvenance> {
  const parentRoot = requireParentRootIdentity(input);
  const manifest = await readStableOwnedDocument<OwnedManifest>({
    parentRoot,
    basename: 'manifest.json',
    schema: 'resource-manifest-v1',
    label: 'Android camera SQL parent manifest',
    signal: input.signal,
  });
  const ledgerPath = apiLedgerPath(input.receipt.apiAttempt);
  const apiLedger = await readStableOwnedDocument<OwnedApiProcessRecord>({
    parentRoot,
    basename: ledgerPath,
    schema: 'api-process-v1',
    label: 'Android camera SQL parent API ledger',
    signal: input.signal,
  });
  return requireApiProvenance(
    { receipt: input.receipt, parentRoot },
    manifest,
    ledgerPath,
    apiLedger,
  );
}

function isMissingPath(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT',
  );
}

async function readRetainedParent(input: {
  artifactRoot: string;
  receipt: OwnedSnapshotReceipt;
  retained: AndroidStorageFileReceipt;
  signal?: AbortSignal;
}): Promise<{
  bytes: Buffer;
  path: string;
  identity: Awaited<ReturnType<typeof readOwnedAndroidBoundedFile>>['identity'];
}> {
  requireRetainedReceipt(input.retained, input.receipt);
  const loaded = await readOwnedAndroidBoundedFile({
    artifactRoot: input.artifactRoot,
    filePath: path.resolve(input.artifactRoot, input.retained.path),
    label: 'Android camera retained original SQL parent snapshot',
    maxBytes: MAX_PARENT_BYTES,
    signal: input.signal,
  });
  assert.equal(loaded.path, input.retained.path, 'retained parent path changed');
  assert.equal(loaded.identity.size, input.retained.sizeBytes, 'retained parent size changed');
  assert.equal(loaded.identity.uid, input.retained.ownerUid, 'retained parent owner changed');
  assert.equal(loaded.identity.mode & 0o777, input.retained.mode, 'retained parent mode changed');
  assert.equal(loaded.identity.nlink, 1, 'retained parent link count changed');
  assert.equal(
    loaded.bytes.byteLength,
    input.receipt.sizeBytes,
    'retained parent byte count changed',
  );
  assert.equal(sha256(loaded.bytes), input.receipt.sha256, 'retained parent hash changed');
  return loaded;
}

async function readRetainedDocument<T>(input: {
  artifactRoot: string;
  retained: AndroidStorageFileReceipt;
  expectedSha256: string;
  expectedSizeBytes: number;
  schema: 'resource-manifest-v1' | 'api-process-v1';
  label: string;
  signal?: AbortSignal;
}): Promise<StableOwnedDocument<T>> {
  requireRetainedCopy(input.retained, {
    expectedSha256: input.expectedSha256,
    expectedSizeBytes: input.expectedSizeBytes,
    label: input.label,
  });
  const loaded = await readOwnedAndroidBoundedFile({
    artifactRoot: input.artifactRoot,
    filePath: path.resolve(input.artifactRoot, input.retained.path),
    label: input.label,
    maxBytes: MAX_PARENT_BYTES,
    signal: input.signal,
  });
  assert.equal(loaded.path, input.retained.path, `${input.label} path changed`);
  assert.equal(loaded.identity.nlink, 1, `${input.label} link count changed`);
  assert.equal(loaded.bytes.byteLength, input.expectedSizeBytes, `${input.label} size changed`);
  assert.equal(sha256(loaded.bytes), input.expectedSha256, `${input.label} hash changed`);
  let value: unknown;
  try {
    value = JSON.parse(loaded.bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`${input.label} is not JSON`, { cause: error });
  }
  assertTestingDocument(input.schema, value);
  return {
    value: value as T,
    bytes: loaded.bytes,
    receipt: {
      path: loaded.path,
      schema: input.schema,
      sizeBytes: loaded.bytes.byteLength,
      sha256: input.expectedSha256,
      ownerUid: loaded.identity.uid,
      mode: loaded.identity.mode & 0o777,
      verification: 'owned-runtime-document-v6',
    },
    identity: loaded.identity,
  };
}

async function readRetainedProvenance(input: {
  artifactRoot: string;
  receipt: OwnedSnapshotReceipt;
  retained: RetainedParentEvidence;
  signal?: AbortSignal;
}): Promise<OwnedParentProvenance> {
  const parentRoot = requireParentRootIdentity({
    artifactRoot: input.artifactRoot,
    receipt: input.receipt,
  });
  const manifest = await readRetainedDocument<OwnedManifest>({
    artifactRoot: input.artifactRoot,
    retained: input.retained.manifest,
    expectedSha256: input.receipt.manifestSha256,
    expectedSizeBytes: input.retained.manifest.sizeBytes,
    schema: 'resource-manifest-v1',
    label: 'Android camera retained parent manifest',
    signal: input.signal,
  });
  const ledgerPath = apiLedgerPath(input.receipt.apiAttempt);
  const apiLedger = await readRetainedDocument<OwnedApiProcessRecord>({
    artifactRoot: input.artifactRoot,
    retained: input.retained.apiLedger,
    expectedSha256: input.receipt.apiLedgerSha256,
    expectedSizeBytes: input.retained.apiLedger.sizeBytes,
    schema: 'api-process-v1',
    label: 'Android camera retained parent API ledger',
    signal: input.signal,
  });
  return requireApiProvenance(
    { receipt: input.receipt, parentRoot },
    manifest,
    ledgerPath,
    apiLedger,
  );
}

function requireParentDocument(
  value: unknown,
  receipt: OwnedSnapshotReceipt,
  expectedKind: ParentKind,
): asserts value is SourceEvidence['value'] {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  assert.equal(row.schemaVersion, 1);
  assert.equal(row.readOnly, true);
  assert.equal(row.runId, receipt.runId);
  assert.equal(row.scope, receipt.scope);
  if (expectedKind === 'connection') {
    assert.equal(row.kind, 'connection-snapshot-v1');
    assert(row.rows && typeof row.rows === 'object' && !Array.isArray(row.rows));
  } else {
    assert.equal(row.kind, undefined);
    assert(Array.isArray(row.trainingPlans));
    assert(Array.isArray(row.connections));
  }
}

export async function readVerifiedAndroidCameraSqlParent(input: {
  artifactRoot: string;
  evidence: SourceEvidence;
  expectedKind: ParentKind;
  retained?: RetainedParentEvidence;
  /** Public post-cleanup readers must opt into sidecars explicitly. */
  retainedOnly?: boolean;
  signal?: AbortSignal;
}): Promise<VerifiedParent> {
  input.signal?.throwIfAborted();
  const expectedSchema =
    input.expectedKind === 'connection' ? 'connection-snapshot-v1' : 'domain-snapshot-v1';
  requireParentReceipt(input.evidence.receipt, input.expectedKind, expectedSchema);
  if (input.retainedOnly) {
    assert(input.retained, 'retained-only SQL parent read requires retained sidecars');
  }
  let provenance: OwnedParentProvenance;
  let usingRetained = input.retainedOnly === true;
  if (usingRetained) {
    provenance = await readRetainedProvenance({
      artifactRoot: input.artifactRoot,
      receipt: input.evidence.receipt,
      retained: input.retained!,
      signal: input.signal,
    });
  } else {
    try {
      provenance = await readOwnedParentProvenance({
        artifactRoot: input.artifactRoot,
        receipt: input.evidence.receipt,
        signal: input.signal,
      });
    } catch (error) {
      if (!input.retained || !isMissingPath(error)) throw error;
      provenance = await readRetainedProvenance({
        artifactRoot: input.artifactRoot,
        receipt: input.evidence.receipt,
        retained: input.retained,
        signal: input.signal,
      });
      usingRetained = true;
    }
  }
  let loaded: Awaited<ReturnType<typeof readOwnedAndroidBoundedFile>>;
  let loadedPath = input.evidence.receipt.path;
  if (usingRetained) {
    loaded = await readRetainedParent({
      artifactRoot: input.artifactRoot,
      receipt: input.evidence.receipt,
      retained: input.retained!.snapshot,
      signal: input.signal,
    });
    loadedPath = input.retained!.snapshot.path;
  } else {
    try {
      loaded = await readOwnedAndroidBoundedFile({
        artifactRoot: provenance.parentRoot,
        filePath: path.resolve(provenance.parentRoot, input.evidence.receipt.path),
        label: 'Android camera original SQL parent snapshot',
        maxBytes: MAX_PARENT_BYTES,
        signal: input.signal,
      });
    } catch (error) {
      if (!input.retained || !isMissingPath(error)) throw error;
      loaded = await readRetainedParent({
        artifactRoot: input.artifactRoot,
        receipt: input.evidence.receipt,
        retained: input.retained.snapshot,
        signal: input.signal,
      });
      loadedPath = input.retained.snapshot.path;
      usingRetained = true;
    }
  }
  assert.equal(loaded.path, loadedPath);
  assert.equal(loaded.identity.size, input.evidence.receipt.sizeBytes);
  assert.equal(loaded.identity.uid, input.evidence.receipt.ownerUid);
  assert.equal(loaded.identity.mode & 0o777, input.evidence.receipt.mode);
  assert.equal(loaded.identity.nlink, 1);
  assert.equal(loaded.bytes.byteLength, input.evidence.receipt.sizeBytes);
  requireHash(input.evidence.receipt.sha256, 'parent snapshot hash');
  assert.equal(sha256(loaded.bytes), input.evidence.receipt.sha256);
  const afterProvenance = usingRetained
    ? await readRetainedProvenance({
        artifactRoot: input.artifactRoot,
        receipt: input.evidence.receipt,
        retained: input.retained!,
        signal: input.signal,
      })
    : await readOwnedParentProvenance({
        artifactRoot: input.artifactRoot,
        receipt: input.evidence.receipt,
        signal: input.signal,
      });
  assert.equal(
    afterProvenance.parentRoot,
    provenance.parentRoot,
    'Android camera SQL parent root changed during snapshot read',
  );
  assert.equal(
    afterProvenance.manifest.receipt.sha256,
    provenance.manifest.receipt.sha256,
    'Android camera SQL parent manifest changed during snapshot read',
  );
  assert.equal(
    afterProvenance.apiLedger.receipt.sha256,
    provenance.apiLedger.receipt.sha256,
    'Android camera SQL parent API ledger changed during snapshot read',
  );
  assert.equal(afterProvenance.apiLedger.value.pid, provenance.apiLedger.value.pid);
  assert.equal(afterProvenance.apiLedger.value.started, provenance.apiLedger.value.started);
  assert.equal(afterProvenance.apiLedger.value.script, provenance.apiLedger.value.script);
  assert.equal(afterProvenance.apiLedger.value.origin, provenance.apiLedger.value.origin);
  let actual: unknown;
  try {
    actual = JSON.parse(loaded.bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error('Android camera original SQL parent snapshot is not JSON', {
      cause: error,
    });
  }
  requireParentDocument(actual, input.evidence.receipt, input.expectedKind);
  assert.deepEqual(actual, input.evidence.value, 'supplied SQL parent value differs from its file');
  return {
    evidence: input.evidence,
    receipt: input.evidence.receipt,
    bytes: loaded.bytes,
    provenance: afterProvenance,
    retained: input.retained,
  };
}

function parentMetadata(
  parent: VerifiedParent,
): Pick<
  SourceReceipt,
  | 'parentSnapshotPath'
  | 'parentSnapshotRoot'
  | 'parentSnapshotRetainedPath'
  | 'parentSnapshotRetainedKind'
  | 'parentSnapshotRetainedSha256'
  | 'parentSnapshotRetainedSizeBytes'
  | 'parentSnapshotRetainedOwnerUid'
  | 'parentSnapshotRetainedMode'
  | 'parentSnapshotRetainedVerification'
  | 'parentManifestPath'
  | 'parentManifestRetainedPath'
  | 'parentManifestRetainedKind'
  | 'parentManifestRetainedSha256'
  | 'parentManifestRetainedSizeBytes'
  | 'parentManifestRetainedOwnerUid'
  | 'parentManifestRetainedMode'
  | 'parentManifestRetainedVerification'
  | 'parentManifestSizeBytes'
  | 'parentSnapshotSha256'
  | 'parentSnapshotSchema'
  | 'parentSnapshotKind'
  | 'parentSnapshotSizeBytes'
  | 'parentSnapshotOwnerUid'
  | 'parentSnapshotMode'
  | 'parentSnapshotVerification'
  | 'parentRunId'
  | 'parentScope'
  | 'parentApiOrigin'
  | 'parentApiPid'
  | 'parentApiStarted'
  | 'parentApiScript'
  | 'parentBackendAttemptId'
  | 'parentManifestSha256'
  | 'parentApiAttempt'
  | 'parentApiLedgerSha256'
  | 'parentApiLedgerPath'
  | 'parentApiLedgerRetainedPath'
  | 'parentApiLedgerRetainedKind'
  | 'parentApiLedgerRetainedSha256'
  | 'parentApiLedgerRetainedSizeBytes'
  | 'parentApiLedgerRetainedOwnerUid'
  | 'parentApiLedgerRetainedMode'
  | 'parentApiLedgerRetainedVerification'
  | 'parentApiLedgerSizeBytes'
  | 'parentFixtureAuthUidAllowlistHash'
> {
  const receipt = parent.receipt;
  assert(parent.retained, 'Android camera SQL parent retention receipt is missing');
  assert(parent.provenance, 'Android camera SQL parent provenance is missing');
  const manifest = parent.provenance.manifest.receipt;
  const apiLedger = parent.provenance.apiLedger.receipt;
  const retainedManifest = parent.retained.manifest;
  const retainedSnapshot = parent.retained.snapshot;
  const retainedApiLedger = parent.retained.apiLedger;
  return {
    parentSnapshotRoot: receipt.parentRoot,
    parentSnapshotPath: receipt.path,
    parentSnapshotRetainedPath: retainedSnapshot.path,
    parentSnapshotRetainedKind: 'sidecar',
    parentSnapshotRetainedSha256: retainedSnapshot.sha256,
    parentSnapshotRetainedSizeBytes: retainedSnapshot.sizeBytes,
    parentSnapshotRetainedOwnerUid: retainedSnapshot.ownerUid,
    parentSnapshotRetainedMode: retainedSnapshot.mode,
    parentSnapshotRetainedVerification: retainedSnapshot.verification,
    parentManifestPath: parent.provenance.manifestPath,
    parentManifestRetainedPath: retainedManifest.path,
    parentManifestRetainedKind: 'sidecar',
    parentManifestRetainedSha256: retainedManifest.sha256,
    parentManifestRetainedSizeBytes: retainedManifest.sizeBytes,
    parentManifestRetainedOwnerUid: retainedManifest.ownerUid,
    parentManifestRetainedMode: retainedManifest.mode,
    parentManifestRetainedVerification: retainedManifest.verification,
    parentManifestSizeBytes: manifest.sizeBytes,
    parentSnapshotSha256: receipt.sha256,
    parentSnapshotSchema: receipt.schema as 'connection-snapshot-v1' | 'domain-snapshot-v1',
    parentSnapshotKind: receipt.kind,
    parentSnapshotSizeBytes: receipt.sizeBytes,
    parentSnapshotOwnerUid: receipt.ownerUid,
    parentSnapshotMode: receipt.mode,
    parentSnapshotVerification: receipt.verification,
    parentRunId: receipt.runId,
    parentScope: receipt.scope,
    parentApiOrigin: receipt.apiOrigin,
    parentApiPid: receipt.apiPid,
    parentApiStarted: receipt.apiStarted,
    parentApiScript: receipt.apiScript,
    parentBackendAttemptId: receipt.backendAttemptId,
    parentManifestSha256: receipt.manifestSha256,
    parentApiAttempt: receipt.apiAttempt,
    parentApiLedgerSha256: receipt.apiLedgerSha256,
    parentApiLedgerPath: parent.provenance.apiLedgerPath,
    parentApiLedgerRetainedPath: retainedApiLedger.path,
    parentApiLedgerRetainedKind: 'sidecar',
    parentApiLedgerRetainedSha256: retainedApiLedger.sha256,
    parentApiLedgerRetainedSizeBytes: retainedApiLedger.sizeBytes,
    parentApiLedgerRetainedOwnerUid: retainedApiLedger.ownerUid,
    parentApiLedgerRetainedMode: retainedApiLedger.mode,
    parentApiLedgerRetainedVerification: retainedApiLedger.verification,
    parentApiLedgerSizeBytes: apiLedger.sizeBytes,
    parentFixtureAuthUidAllowlistHash: receipt.fixtureAuthUidAllowlistHash,
  };
}

function safePart(value: string): string {
  assert(/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/u.test(value), 'Camera SQL source label is invalid');
  return value;
}

async function writeProjection(input: {
  artifactRoot: string;
  phase: AndroidCameraSqlReceiptPhase;
  scope: string;
  table: ConnectionTable | 'domain';
  parent: VerifiedParent;
  value: unknown;
  sourceProjection: SourceReceipt['sourceProjection'];
  signal?: AbortSignal;
}): Promise<SourceReceipt> {
  const phasePart = safePart(input.phase);
  const tablePart = safePart(input.table);
  const relativePath = `camera-sql-${phasePart}-${tablePart}.private.json`;
  const queryId = `camera-${phasePart}-${tablePart.toLowerCase()}`;
  const bytes = Buffer.from(JSON.stringify(input.value), 'utf8');
  const receipt = await writeOwnedAndroidPrivateFile({
    artifactRoot: input.artifactRoot,
    relativePath,
    bytes,
    kind: 'query',
    signal: input.signal,
  });
  const result: SourceReceipt = {
    ...receipt,
    phase: input.phase,
    scope: input.scope,
    table: input.table,
    queryId,
    ...parentMetadata(input.parent),
    sourceProjection: input.sourceProjection,
  };
  return Object.freeze(result);
}

function evidenceKind(evidence: SourceEvidence): ParentKind {
  const kind = evidence.receipt.kind;
  assert(
    kind === 'connection' || kind === 'domain',
    'Android camera SQL parent kind is not supported',
  );
  return kind;
}

function requireApiProbeMatchesParent(
  probe: OwnedApiLifetimeProbe,
  parent: VerifiedParent,
  label: string,
): void {
  assert.equal(probe.runId, parent.receipt.runId, `${label} run changed`);
  assert.equal(probe.apiOrigin, parent.receipt.apiOrigin, `${label} origin changed`);
  assert.equal(probe.apiPid, parent.receipt.apiPid, `${label} PID changed`);
  assert.equal(probe.apiStarted, parent.receipt.apiStarted, `${label} start changed`);
  assert.equal(probe.apiScript, parent.receipt.apiScript, `${label} script changed`);
  assert.equal(
    probe.backendAttemptId,
    parent.receipt.backendAttemptId,
    `${label} backend attempt changed`,
  );
  assert.equal(
    probe.manifestSha256,
    parent.receipt.manifestSha256,
    `${label} manifest hash changed`,
  );
  assert.equal(probe.apiAttempt, parent.receipt.apiAttempt, `${label} API attempt changed`);
  assert.equal(
    probe.apiLedgerSha256,
    parent.receipt.apiLedgerSha256,
    `${label} API ledger hash changed`,
  );
}

function requireSameApiProbe(
  expected: OwnedApiLifetimeProbe,
  actual: OwnedApiLifetimeProbe,
  label: string,
): void {
  assert.deepEqual(actual, expected, `${label} changed during SQL source capture`);
}

function requireSameParentBytes(
  expected: VerifiedParent,
  actual: VerifiedParent,
  label: string,
): void {
  assert.equal(actual.receipt.parentRoot, expected.receipt.parentRoot, `${label} root changed`);
  assert.equal(actual.receipt.path, expected.receipt.path, `${label} path changed`);
  assert.equal(actual.receipt.sha256, expected.receipt.sha256, `${label} hash changed`);
  assert.deepEqual(actual.bytes, expected.bytes, `${label} bytes changed after retention`);
  assert.equal(
    actual.provenance.manifest.receipt.sha256,
    expected.provenance.manifest.receipt.sha256,
    `${label} manifest changed after retention`,
  );
  assert.equal(
    actual.provenance.apiLedger.receipt.sha256,
    expected.provenance.apiLedger.receipt.sha256,
    `${label} API ledger changed after retention`,
  );
}

async function writePhase(input: {
  artifactRoot: string;
  phase: AndroidCameraSqlReceiptPhase;
  evidence: SourceEvidence;
  parent: VerifiedParent;
  signal?: AbortSignal;
}): Promise<readonly SourceReceipt[]> {
  const kind = evidenceKind(input.evidence);
  assert.equal(
    input.parent.receipt.kind,
    kind,
    `Android camera SQL parent kind changed for ${input.phase}`,
  );
  if (kind === 'connection') {
    const evidence = input.evidence as SourceConnectionEvidence;
    const rows = evidence.value.rows as Record<ConnectionTable, unknown>;
    const output: SourceReceipt[] = [];
    for (const table of CONNECTION_TABLES) {
      output.push(
        await writeProjection({
          artifactRoot: input.artifactRoot,
          phase: input.phase,
          scope: evidence.value.scope,
          table,
          parent: input.parent,
          value: rows[table],
          sourceProjection: 'owned-session.connection-snapshot-v1.rows',
          signal: input.signal,
        }),
      );
    }
    return output;
  }
  const evidence = input.evidence as SourceDomainEvidence;
  return [
    await writeProjection({
      artifactRoot: input.artifactRoot,
      phase: input.phase,
      scope: evidence.value.scope,
      table: 'domain',
      parent: input.parent,
      value: evidence.value,
      sourceProjection: 'owned-session.domain-snapshot-v1.document',
      signal: input.signal,
    }),
  ];
}

/**
 * Persist exact byte projections from the already-owned repeatable-read snapshot
 * responses. These are private source receipts, not synthetic SQL rows: every
 * file is bound to the parent session document path/hash and table/phase.
 */
export async function writeAndroidCameraSqlSourceReceipts(input: {
  artifactRoot: string;
  before: SourceConnectionEvidence;
  pending: SourceConnectionEvidence;
  isolationBefore: SourceEvidence;
  isolationAfter: SourceEvidence;
  trainingBefore: SourceEvidence;
  trainingAfter: SourceEvidence;
  probeApiLifetime: (signal?: AbortSignal) => Promise<OwnedApiLifetimeProbe>;
  signal?: AbortSignal;
}): Promise<readonly AndroidCameraSqlSourceReceipt[]> {
  const startApi = await input.probeApiLifetime(input.signal);
  const parents = {
    before: await readVerifiedAndroidCameraSqlParent({
      artifactRoot: input.artifactRoot,
      evidence: input.before,
      expectedKind: 'connection',
      signal: input.signal,
    }),
    pending: await readVerifiedAndroidCameraSqlParent({
      artifactRoot: input.artifactRoot,
      evidence: input.pending,
      expectedKind: 'connection',
      signal: input.signal,
    }),
    isolationBefore: await readVerifiedAndroidCameraSqlParent({
      artifactRoot: input.artifactRoot,
      evidence: input.isolationBefore,
      expectedKind: evidenceKind(input.isolationBefore),
      signal: input.signal,
    }),
    isolationAfter: await readVerifiedAndroidCameraSqlParent({
      artifactRoot: input.artifactRoot,
      evidence: input.isolationAfter,
      expectedKind: evidenceKind(input.isolationAfter),
      signal: input.signal,
    }),
    trainingBefore: await readVerifiedAndroidCameraSqlParent({
      artifactRoot: input.artifactRoot,
      evidence: input.trainingBefore,
      expectedKind: evidenceKind(input.trainingBefore),
      signal: input.signal,
    }),
    trainingAfter: await readVerifiedAndroidCameraSqlParent({
      artifactRoot: input.artifactRoot,
      evidence: input.trainingAfter,
      expectedKind: evidenceKind(input.trainingAfter),
      signal: input.signal,
    }),
  };
  const retainedByKey = new Map<string, AndroidStorageFileReceipt>();
  const retainCopy = async (inputCopy: {
    key: string;
    prefix: string;
    expectedPath: string;
    bytes: Buffer;
    expectedSha256: string;
    expectedSizeBytes: number;
    label: string;
  }): Promise<AndroidStorageFileReceipt> => {
    const existing = retainedByKey.get(inputCopy.key);
    if (existing) return existing;
    const relativePath = `${inputCopy.prefix}-${sha256(Buffer.from(inputCopy.key, 'utf8'))}.private.json`;
    const retained = await writeOwnedAndroidPrivateFile({
      artifactRoot: input.artifactRoot,
      relativePath,
      bytes: inputCopy.bytes,
      kind: 'sidecar',
      signal: input.signal,
    });
    requireRetainedCopy(retained, {
      expectedPath: inputCopy.expectedPath,
      expectedSha256: inputCopy.expectedSha256,
      expectedSizeBytes: inputCopy.expectedSizeBytes,
      label: inputCopy.label,
    });
    const reread = await readOwnedAndroidBoundedFile({
      artifactRoot: input.artifactRoot,
      filePath: path.resolve(input.artifactRoot, retained.path),
      label: `${inputCopy.label} reread`,
      maxBytes: MAX_PARENT_BYTES,
      signal: input.signal,
    });
    assert.equal(reread.identity.nlink, 1, `${inputCopy.label} link count changed`);
    assert.equal(reread.identity.uid, retained.ownerUid, `${inputCopy.label} owner changed`);
    assert.equal(reread.identity.mode & 0o777, retained.mode, `${inputCopy.label} mode changed`);
    assert.equal(
      reread.bytes.byteLength,
      inputCopy.expectedSizeBytes,
      `${inputCopy.label} size changed`,
    );
    assert.equal(sha256(reread.bytes), inputCopy.expectedSha256, `${inputCopy.label} hash changed`);
    retainedByKey.set(inputCopy.key, retained);
    return retained;
  };
  const retainedByParent = new Map<string, RetainedParentEvidence>();
  const retain = async (parent: VerifiedParent): Promise<VerifiedParent> => {
    assert(parent.provenance, 'Android camera SQL parent provenance is missing before retention');
    const parentKey = `${parent.receipt.parentRoot}\0${parent.receipt.path}\0${parent.receipt.sha256}`;
    const existing = retainedByParent.get(parentKey);
    if (existing) return { ...parent, retained: existing };
    const manifestKey = `${parent.receipt.parentRoot}\0${parent.provenance.manifestPath}\0${parent.provenance.manifest.receipt.sha256}`;
    const ledgerKey = `${parent.receipt.parentRoot}\0${parent.provenance.apiLedgerPath}\0${parent.provenance.apiLedger.receipt.sha256}`;
    const snapshot = await retainCopy({
      key: parentKey,
      prefix: 'camera-sql-parent',
      expectedPath: parent.receipt.path,
      bytes: parent.bytes,
      expectedSha256: parent.receipt.sha256,
      expectedSizeBytes: parent.receipt.sizeBytes,
      label: 'retained parent snapshot',
    });
    const manifest = await retainCopy({
      key: manifestKey,
      prefix: 'camera-sql-manifest',
      expectedPath: parent.provenance.manifestPath,
      bytes: parent.provenance.manifest.bytes,
      expectedSha256: parent.provenance.manifest.receipt.sha256,
      expectedSizeBytes: parent.provenance.manifest.receipt.sizeBytes,
      label: 'retained parent manifest',
    });
    const apiLedger = await retainCopy({
      key: ledgerKey,
      prefix: 'camera-sql-api-ledger',
      expectedPath: parent.provenance.apiLedgerPath,
      bytes: parent.provenance.apiLedger.bytes,
      expectedSha256: parent.provenance.apiLedger.receipt.sha256,
      expectedSizeBytes: parent.provenance.apiLedger.receipt.sizeBytes,
      label: 'retained parent API ledger',
    });
    const retained: RetainedParentEvidence = { snapshot, manifest, apiLedger };
    retainedByParent.set(parentKey, retained);
    return { ...parent, retained };
  };
  const retainedParents = {
    before: await retain(parents.before),
    pending: await retain(parents.pending),
    isolationBefore: await retain(parents.isolationBefore),
    isolationAfter: await retain(parents.isolationAfter),
    trainingBefore: await retain(parents.trainingBefore),
    trainingAfter: await retain(parents.trainingAfter),
  };
  assert.equal(
    new Set(Object.values(retainedParents).map((parent) => parent.receipt.parentRoot)).size,
    1,
    'Android camera SQL parents must share one authenticated runtime root',
  );
  const canonical = retainedParents.before;
  assert(canonical.provenance, 'Android camera SQL canonical parent provenance is missing');
  for (const parent of Object.values(retainedParents)) {
    assert(parent.provenance, 'Android camera SQL parent provenance is missing');
    assert.equal(parent.receipt.parentRoot, canonical.receipt.parentRoot);
    assert.equal(parent.receipt.apiOrigin, canonical.receipt.apiOrigin);
    assert.equal(parent.receipt.apiPid, canonical.receipt.apiPid);
    assert.equal(parent.receipt.apiStarted, canonical.receipt.apiStarted);
    assert.equal(parent.receipt.apiScript, canonical.receipt.apiScript);
    assert.equal(parent.receipt.apiAttempt, canonical.receipt.apiAttempt);
    assert.equal(parent.receipt.manifestSha256, canonical.receipt.manifestSha256);
    assert.equal(parent.receipt.apiLedgerSha256, canonical.receipt.apiLedgerSha256);
    assert.equal(
      parent.provenance.manifest.receipt.sha256,
      canonical.provenance.manifest.receipt.sha256,
      'Android camera SQL parent manifest changed across snapshots',
    );
    assert.equal(
      parent.provenance.apiLedger.receipt.sha256,
      canonical.provenance.apiLedger.receipt.sha256,
      'Android camera SQL parent API ledger changed across snapshots',
    );
    assert.equal(parent.provenance.apiLedger.value.pid, canonical.provenance.apiLedger.value.pid);
    assert.equal(
      parent.provenance.apiLedger.value.started,
      canonical.provenance.apiLedger.value.started,
    );
    assert.equal(
      parent.provenance.apiLedger.value.script,
      canonical.provenance.apiLedger.value.script,
    );
  }
  requireApiProbeMatchesParent(startApi, canonical, 'Android camera SQL API start probe');
  for (const parent of Object.values(retainedParents))
    requireApiProbeMatchesParent(startApi, parent, 'Android camera SQL API parent');

  const revalidateOriginal = async (
    parent: VerifiedParent,
    evidence: SourceEvidence,
  ): Promise<void> => {
    const reread = await readVerifiedAndroidCameraSqlParent({
      artifactRoot: input.artifactRoot,
      evidence,
      expectedKind: evidenceKind(evidence),
      signal: input.signal,
    });
    requireSameParentBytes(parent, reread, 'Android camera SQL original parent');
    requireApiProbeMatchesParent(startApi, reread, 'Android camera SQL original parent probe');
  };
  await Promise.all([
    revalidateOriginal(retainedParents.before, input.before),
    revalidateOriginal(retainedParents.pending, input.pending),
    revalidateOriginal(retainedParents.isolationBefore, input.isolationBefore),
    revalidateOriginal(retainedParents.isolationAfter, input.isolationAfter),
    revalidateOriginal(retainedParents.trainingBefore, input.trainingBefore),
    revalidateOriginal(retainedParents.trainingAfter, input.trainingAfter),
  ]);
  const endApi = await input.probeApiLifetime(input.signal);
  requireSameApiProbe(startApi, endApi, 'Android camera SQL API end probe');
  requireApiProbeMatchesParent(endApi, canonical, 'Android camera SQL API end probe');
  const settledGroups = await Promise.allSettled([
    writePhase({
      artifactRoot: input.artifactRoot,
      phase: 'before',
      evidence: input.before,
      parent: retainedParents.before,
      signal: input.signal,
    }),
    writePhase({
      artifactRoot: input.artifactRoot,
      phase: 'pending',
      evidence: input.pending,
      parent: retainedParents.pending,
      signal: input.signal,
    }),
    writePhase({
      artifactRoot: input.artifactRoot,
      phase: 'isolation-before',
      evidence: input.isolationBefore,
      parent: retainedParents.isolationBefore,
      signal: input.signal,
    }),
    writePhase({
      artifactRoot: input.artifactRoot,
      phase: 'isolation-after',
      evidence: input.isolationAfter,
      parent: retainedParents.isolationAfter,
      signal: input.signal,
    }),
    writePhase({
      artifactRoot: input.artifactRoot,
      phase: 'training-before',
      evidence: input.trainingBefore,
      parent: retainedParents.trainingBefore,
      signal: input.signal,
    }),
    writePhase({
      artifactRoot: input.artifactRoot,
      phase: 'training-after',
      evidence: input.trainingAfter,
      parent: retainedParents.trainingAfter,
      signal: input.signal,
    }),
  ]);
  const failedGroup = settledGroups.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failedGroup) throw failedGroup.reason;
  input.signal?.throwIfAborted();
  await Promise.all([
    revalidateOriginal(retainedParents.before, input.before),
    revalidateOriginal(retainedParents.pending, input.pending),
    revalidateOriginal(retainedParents.isolationBefore, input.isolationBefore),
    revalidateOriginal(retainedParents.isolationAfter, input.isolationAfter),
    revalidateOriginal(retainedParents.trainingBefore, input.trainingBefore),
    revalidateOriginal(retainedParents.trainingAfter, input.trainingAfter),
  ]);
  const finalApi = await input.probeApiLifetime(input.signal);
  requireSameApiProbe(startApi, finalApi, 'Android camera SQL API final probe');
  requireApiProbeMatchesParent(finalApi, canonical, 'Android camera SQL API final probe');
  return settledGroups.flatMap((result) => {
    assert.equal(result.status, 'fulfilled');
    return result.value;
  });
}
