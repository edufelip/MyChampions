import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  readOwnedDetoxConnectionEvidence,
  writeAtomicDetoxConnectionBytes,
  type DetoxConnectionEvidenceStat,
} from './detox-connection-evidence';
import {
  revalidateDetoxRuntimeBuildMetadata,
  requireDetoxRuntimeBuildMetadata,
  type DetoxRuntimeBuildMetadata,
} from './detox-runtime-build-metadata';
import { nativeSaveRetryAssertionIds } from './native-pilot-contract';

const HASH = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[a-f0-9]{24}$/u;
const MAX_EVIDENCE_BYTES = 16 * 1024 * 1024;
const MAX_SEMANTIC_SOURCE_BYTES = 512 * 1024;
const SEMANTIC_SOURCE_NAME = 'detox-save-retry-owner-semantic.private.json';
const OWNER_SOURCE_CAPABILITY = Symbol('detox-save-retry-owner-source-capability');
const RUNTIME_PROOF_CAPABILITY = Symbol('detox-save-retry-runtime-proof-capability');
const EVIDENCE_NAME =
  /^(?:detox-save-retry-(?:command|response)-[1-9][0-9]*|detox-save-retry-unrelated-state|detox-save-retry-owner-semantic)\.private\.json$/u;

export type DetoxRuntimeDirectoryIdentity = Readonly<{
  realpath: string;
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
}>;

export type DetoxSaveRetryEvidenceIdentity = Readonly<
  Pick<
    DetoxConnectionEvidenceStat,
    'dev' | 'ino' | 'uid' | 'gid' | 'mode' | 'nlink' | 'size' | 'mtimeMs' | 'ctimeMs'
  >
>;

export type DetoxSaveRetryAssertionBinding = Readonly<{
  id: string;
  outcome: 'passed';
  evidencePaths: readonly string[];
  evidenceHashes: readonly string[];
  evidenceIdentities: readonly DetoxSaveRetryEvidenceIdentity[];
}>;

export type DetoxSaveRetryOwnerRuntimeSource = Readonly<{
  repositoryRoot: string;
  runtimeMetadata: DetoxRuntimeBuildMetadata;
  build: Readonly<{
    sourceTreeHash: string;
    helperInputsHash: string;
    binaryHash: string;
    detoxConfigHash: string;
  }>;
  captureRootIdentity: DetoxRuntimeDirectoryIdentity;
  targetOrigin: string;
  backendRunId: string;
  accountUid: string;
  cleanupStatus: 'cleaned';
  cleanupOwner: 'existing-detox-connection-driver-aggregate';
  semanticSourceHashBefore: string;
  semanticSourceHashAfter: string;
  semanticSourceReceipt: Readonly<{
    name: typeof SEMANTIC_SOURCE_NAME;
    sha256: string;
    bytes: number;
    identity: DetoxSaveRetryEvidenceIdentity;
  }>;
  /**
   * Producer-owned identity.  The outer bridge may consume this receipt, but
   * it cannot manufacture a passing proof without the persisted owner token
   * and the exact build/runner/child binding emitted by the owner callback.
   */
  producerReceipt: Readonly<{
    kind: 'private-detox-save-retry-owner-producer-receipt';
    owner: 'existing-detox-connection-driver-aggregate';
    producerToken: string;
    executionBinding: Readonly<Record<string, unknown>>;
  }>;
  executionBinding: Readonly<Record<string, unknown>>;
  fault: Readonly<{
    attemptId: string;
    backendRunId: string;
    accountUid: string;
    method: 'POST';
    path: '/plans/training';
    injectedStatus: 503;
    injectedWrites: 1;
    forwardedStatus: 201;
    forwardedWrites: 1;
  }>;
  finalResult: Readonly<{
    planId: string;
    snapshotsSemanticHash: string;
    apiSemanticHash: string;
    transportHash: string;
  }>;
  assertionSources: readonly Readonly<{
    id: string;
    name: string;
    sha256: string;
  }>[];
}>;

export type DetoxSaveRetryRuntimeProof = Readonly<{
  repositoryRoot: string;
  runtimeMetadata: DetoxRuntimeBuildMetadata;
  build: DetoxSaveRetryOwnerRuntimeSource['build'];
  assertionBindings: readonly DetoxSaveRetryAssertionBinding[];
  cleanupStatus: 'cleaned';
  cleanupOwner: 'existing-detox-connection-driver-aggregate';
  captureRootIdentity: DetoxRuntimeDirectoryIdentity;
  outputRootIdentityBefore: DetoxRuntimeDirectoryIdentity;
  outputRootIdentityAfter: DetoxRuntimeDirectoryIdentity;
  semanticSourceReceipt: DetoxSaveRetryOwnerRuntimeSource['semanticSourceReceipt'];
  semanticSourceHashBefore: string;
  semanticSourceHashAfter: string;
  targetOrigin: string;
  backendRunId: string;
  accountUid: string;
  fault: DetoxSaveRetryOwnerRuntimeSource['fault'];
  finalResult: DetoxSaveRetryOwnerRuntimeSource['finalResult'];
  producerReceipt: DetoxSaveRetryOwnerRuntimeSource['producerReceipt'];
  executionBinding: Readonly<Record<string, unknown>>;
  lifecycle: Readonly<{
    signal: AbortSignal;
    deadlineAtMonotonicMs: number;
  }>;
}>;

export type DetoxSaveRetryRuntimeFinalization = Readonly<{
  status: 'qualified';
  assertionIds: readonly string[];
  assertionBindings: readonly DetoxSaveRetryAssertionBinding[];
  nativePassingCases: 5;
  publicPromotionEligible: true;
  environmentHash: string;
}>;

type Row = Record<string, unknown>;

function record(value: unknown, label: string): Row {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Row;
}

function brand<T extends object>(value: T, capability: symbol): T {
  Object.defineProperty(value, capability, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return value;
}

function requireCapability(value: unknown, capability: symbol, label: string): void {
  assert(
    value &&
      typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, capability) &&
      (value as Record<PropertyKey, unknown>)[capability] === true,
    `${label} was not produced by the owned runtime path`,
  );
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashJson(value: unknown): string {
  return hashBytes(Buffer.from(JSON.stringify(value)));
}

function requireLive(
  lifecycle: Readonly<{
    signal: AbortSignal;
    deadlineAtMonotonicMs: number;
  }>,
  phase: string,
): void {
  if (lifecycle.signal.aborted)
    throw lifecycle.signal.reason ?? new Error(`Save/retry runtime cancelled: ${phase}`);
  assert(
    performance.now() < lifecycle.deadlineAtMonotonicMs,
    `Save/retry runtime deadline elapsed: ${phase}`,
  );
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && HASH.test(value), `${label} must be a SHA-256 hash`);
}

function evidenceIdentity(metadata: DetoxConnectionEvidenceStat): DetoxSaveRetryEvidenceIdentity {
  return {
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
}

function requireEvidenceIdentity(value: unknown, label: string): DetoxSaveRetryEvidenceIdentity {
  const row = record(value, label);
  for (const field of ['dev', 'ino', 'uid', 'gid', 'nlink', 'size'])
    assert(
      Number.isSafeInteger(row[field]) && Number(row[field]) >= 0,
      `${label}.${field} is invalid`,
    );
  for (const field of ['mtimeMs', 'ctimeMs'])
    assert(
      typeof row[field] === 'number' && Number.isFinite(row[field]) && Number(row[field]) >= 0,
      `${label}.${field} is invalid`,
    );
  assert.equal((row.mode as number) & 0o777, 0o600, `${label}.mode is invalid`);
  assert.equal(row.nlink, 1, `${label}.nlink is invalid`);
  assert(
    typeof row.size === 'number' &&
      Number.isSafeInteger(row.size) &&
      row.size > 0 &&
      row.size <= MAX_EVIDENCE_BYTES,
  );
  return row as unknown as DetoxSaveRetryEvidenceIdentity;
}

function assertSameEvidenceIdentity(
  expected: DetoxSaveRetryEvidenceIdentity,
  observed: DetoxSaveRetryEvidenceIdentity,
  label: string,
): void {
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
  ] as const)
    assert.equal(observed[field], expected[field], `${label}.${field} changed`);
}

function requireRunId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
}

function requireIdentity(value: unknown, label: string): DetoxRuntimeDirectoryIdentity {
  const row = record(value, label);
  assert(typeof row.realpath === 'string' && path.isAbsolute(row.realpath));
  for (const field of ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink'])
    assert(
      Number.isSafeInteger(row[field]) && Number(row[field]) >= 0,
      `${label}.${field} is invalid`,
    );
  const nlink = row.nlink;
  assert(
    typeof nlink === 'number' && Number.isSafeInteger(nlink) && nlink >= 1,
    `${label} must expose a positive directory link count`,
  );
  assert.equal((row.mode as number) & 0o777, 0o700, `${label} must be mode 0700`);
  return row as unknown as DetoxRuntimeDirectoryIdentity;
}

async function readLiveDirectoryIdentity(
  root: string,
  label: string,
): Promise<DetoxRuntimeDirectoryIdentity> {
  const resolved = path.resolve(root);
  const canonical = await realpath(resolved);
  assert.equal(canonical, resolved, `${label} path is not canonical`);
  const metadata = await lstat(canonical);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink(), `${label} is not a directory`);
  assert.equal(metadata.mode & 0o777, 0o700, `${label} mode is invalid`);
  if (typeof process.getuid === 'function') assert.equal(metadata.uid, process.getuid());
  return {
    realpath: canonical,
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    mode: metadata.mode,
    nlink: metadata.nlink,
  };
}

export function requireStableDirectoryIdentity(
  before: DetoxRuntimeDirectoryIdentity,
  after: DetoxRuntimeDirectoryIdentity,
  label: string,
): void {
  const left = requireIdentity(before, `${label} before`);
  const right = requireIdentity(after, `${label} after`);
  assert.equal(right.realpath, left.realpath, `${label} path changed`);
  for (const field of ['dev', 'ino', 'uid', 'gid', 'mode'] as const)
    assert.equal(right[field], left[field], `${label} identity changed`);
}

export function requireStrictBackendOrigin(value: unknown): string {
  assert(typeof value === 'string' && value.length > 0, 'Save/retry backend origin is missing');
  const parsed = new URL(value);
  assert(parsed.protocol === 'http:' || parsed.protocol === 'https:');
  assert(parsed.username === '' && parsed.password === '');
  assert(parsed.pathname === '/' && parsed.search === '' && parsed.hash === '');
  assert(parsed.hostname.length > 0 && !parsed.hostname.includes('_'));
  return parsed.origin;
}

function requireBuild(value: unknown): DetoxSaveRetryOwnerRuntimeSource['build'] {
  const row = record(value, 'Detox build identity');
  const source =
    row.source && typeof row.source === 'object' && !Array.isArray(row.source)
      ? record(row.source, 'Detox build source')
      : row;
  requireHash(source.sourceTreeHash, 'Detox build sourceTreeHash');
  for (const field of ['helperInputsHash', 'binaryHash', 'detoxConfigHash'])
    requireHash(row[field], `Detox build ${field}`);
  return {
    sourceTreeHash: source.sourceTreeHash,
    helperInputsHash: row.helperInputsHash as string,
    binaryHash: row.binaryHash as string,
    detoxConfigHash: row.detoxConfigHash as string,
  };
}

function requireBindings(value: unknown): readonly DetoxSaveRetryAssertionBinding[] {
  assert(Array.isArray(value) && value.length === nativeSaveRetryAssertionIds.length);
  const rows = value.map((raw, index) => {
    const row = record(raw, `Save/retry assertion binding ${index}`);
    assert.equal(row.id, nativeSaveRetryAssertionIds[index]);
    assert.equal(row.outcome, 'passed');
    assert(Array.isArray(row.evidencePaths) && row.evidencePaths.length > 0);
    assert(Array.isArray(row.evidenceHashes));
    assert(Array.isArray(row.evidenceIdentities));
    const paths = row.evidencePaths.filter((item): item is string => typeof item === 'string');
    const hashes = row.evidenceHashes.filter((item): item is string => typeof item === 'string');
    const identities = row.evidenceIdentities.map((item, identityIndex) =>
      requireEvidenceIdentity(item, `binding ${index} identity ${identityIndex}`),
    );
    assert.equal(paths.length, row.evidencePaths.length);
    assert.equal(hashes.length, paths.length);
    assert.equal(identities.length, paths.length);
    hashes.forEach((hash, hashIndex) => requireHash(hash, `binding ${index} hash ${hashIndex}`));
    return {
      id: row.id as string,
      outcome: 'passed' as const,
      evidencePaths: [...paths],
      evidenceHashes: [...hashes],
      evidenceIdentities: identities,
    };
  });
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  return rows;
}

async function readOwnedEvidence(
  root: string,
  source: Readonly<{ name: string; sha256?: string }>,
  lifecycle?: Readonly<{ signal: AbortSignal; deadlineAtMonotonicMs: number }>,
): Promise<{
  bytes: Buffer;
  sha256: string;
  identity: DetoxSaveRetryEvidenceIdentity;
}> {
  assert(EVIDENCE_NAME.test(source.name), `Save/retry evidence name is unsafe: ${source.name}`);
  const targetRoot = path.resolve(root);
  const target = path.join(targetRoot, source.name);
  assert.equal(path.dirname(target), targetRoot);
  const observed = await readOwnedDetoxConnectionEvidence(
    targetRoot,
    source.name,
    MAX_EVIDENCE_BYTES,
    lifecycle
      ? {
          signal: lifecycle.signal,
          deadlineAt: lifecycle.deadlineAtMonotonicMs,
        }
      : undefined,
  );
  const identity = evidenceIdentity(observed.metadata);
  const bytes = observed.bytes;
  const sha256 = hashBytes(bytes);
  if (source.sha256 !== undefined)
    assert.equal(sha256, source.sha256, `${source.name} bytes changed`);
  return { bytes, sha256, identity };
}

function sourceSemanticHash(input: {
  save: Row;
  build: DetoxSaveRetryOwnerRuntimeSource['build'];
  runtimeMetadata: DetoxRuntimeBuildMetadata;
  producerToken?: string;
  executionBinding?: Readonly<Record<string, unknown>>;
}): string {
  return hashJson(semanticSourceValue(input));
}

function semanticSourceValue(input: {
  save: Row;
  build: DetoxSaveRetryOwnerRuntimeSource['build'];
  runtimeMetadata: DetoxRuntimeBuildMetadata;
  producerToken?: string;
  executionBinding?: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  return {
    selection: input.save.selection,
    faultIdentity: input.save.faultIdentity,
    targetOrigin: input.save.targetOrigin,
    accountUid: input.save.accountUid,
    childIdentity: input.save.childIdentity,
    build: input.build,
    runtimeMetadata: input.runtimeMetadata,
    ...(input.producerToken ? { producerToken: input.producerToken } : {}),
    ...(input.executionBinding ? { executionBinding: input.executionBinding } : {}),
  };
}

function semanticSourceBytes(input: {
  save: Row;
  build: DetoxSaveRetryOwnerRuntimeSource['build'];
  runtimeMetadata: DetoxRuntimeBuildMetadata;
  semanticSourceHash: string;
  producerToken?: string;
  executionBinding?: Readonly<Record<string, unknown>>;
}): Buffer {
  return Buffer.from(
    `${JSON.stringify({
      kind: 'private-detox-save-retry-owner-semantic',
      semanticSourceHash: input.semanticSourceHash,
      semantic: semanticSourceValue(input),
    })}\n`,
    'utf8',
  );
}

/** Capture owner-produced metadata before output staging; no caller proof is accepted. */
export async function createDetoxSaveRetryOwnerRuntimeSource(input: {
  repositoryRoot: string;
  captureRoot: string;
  report: Row;
  build: unknown;
  runtimeMetadata: unknown;
  producerToken: string;
  lifecycle: Readonly<{
    signal: AbortSignal;
    deadlineAtMonotonicMs: number;
  }>;
}): Promise<DetoxSaveRetryOwnerRuntimeSource> {
  requireLive(input.lifecycle, 'owner receipt start');
  assert(
    input.report.detoxSaveRetryOwnerInvocation === 'owned-detox-save-retry-producer-v2',
    'save/retry semantic receipt must be emitted by the existing owner',
  );
  assert(
    typeof input.producerToken === 'string' && input.producerToken.length >= 32,
    'save/retry producer token is missing',
  );
  requireDetoxRuntimeBuildMetadata(input.runtimeMetadata, 'owner runtime metadata');
  const runtimeMetadata = input.runtimeMetadata;
  await revalidateDetoxRuntimeBuildMetadata(input.repositoryRoot, runtimeMetadata);
  requireLive(input.lifecycle, 'owner runtime metadata');
  const save = record(input.report.detoxSaveRetry, 'owner save/retry report');
  const result = record(save.result, 'owner save/retry result');
  assert.equal(save.cleanupOwner, 'existing-detox-connection-driver-aggregate');
  assert.equal(save.nativePassingCases, 0);
  assert.equal(save.publicPromotionEligible, false);
  assert.equal(result.injectedWrites, 1);
  assert.equal(result.forwardedWrites, 1);
  assert.deepEqual(result.assertionIds, [...nativeSaveRetryAssertionIds]);
  assert.equal(input.report.detoxSaveRetryTerminal, undefined);
  requireStrictBackendOrigin(save.targetOrigin);
  requireRunId(save.runId, 'owner backend run ID');
  const build = requireBuild(input.build);
  const reportedBuild = requireBuild(input.report.build);
  assert.deepEqual(reportedBuild, build, 'owner report build differs from qualified build');
  const captureRoot = path.resolve(input.captureRoot);
  const executionBinding = record(input.report.build, 'owner execution build');
  const childBinding = record(input.report.detoxChild, 'owner execution child');
  const childIdentityBinding = record(
    input.report.detoxChildIdentity,
    'owner execution child identity',
  );
  assert.equal(childBinding.cwd, input.repositoryRoot);
  assert.equal(childBinding.ownership, 'owned-process-group');
  assert.equal(childIdentityBinding.pid, record(childBinding, 'child').pid);
  assert.equal(childIdentityBinding.pgid, record(childBinding, 'child').pgid);
  const fullExecutionBinding = {
    build: structuredClone(executionBinding),
    child: structuredClone(childBinding),
    childIdentity: structuredClone(childIdentityBinding),
  } as const;
  const captureIdentity = requireIdentity(
    input.report.detoxSaveRetryCaptureRootIdentity,
    'capture root identity',
  );
  assert.equal(captureIdentity.realpath, captureRoot);
  const snapshots = input.report.detoxSaveRetrySnapshots;
  const apiReads = input.report.detoxSaveRetryApiReads;
  const transport = input.report.detoxTransportSource;
  assert(
    Array.isArray(snapshots) && snapshots.length === 5,
    'owner SQL snapshot ledger is incomplete',
  );
  assert(Array.isArray(apiReads) && apiReads.length === 2, 'owner API read ledger is incomplete');
  assert(Array.isArray(transport) && transport.length > 0, 'owner transport ledger is incomplete');
  const unrelated = record(
    input.report.detoxSaveRetryUnrelatedState,
    'owner unrelated-state receipt',
  );
  assert.equal(unrelated.name, 'detox-save-retry-unrelated-state.private.json');
  const expectedNames = [
    'detox-save-retry-response-2.private.json',
    'detox-save-retry-response-1.private.json',
    'detox-save-retry-response-3.private.json',
    'detox-save-retry-response-4.private.json',
    'detox-save-retry-unrelated-state.private.json',
  ];
  const assertionSources: { id: string; name: string; sha256: string }[] = [];
  for (let index = 0; index < nativeSaveRetryAssertionIds.length; index += 1) {
    const name = expectedNames[index];
    const observed = await readOwnedEvidence(
      captureRoot,
      {
        name,
        ...(index === 4 ? { sha256: String(unrelated.sha256) } : {}),
      },
      input.lifecycle,
    );
    requireLive(input.lifecycle, `owner evidence ${name}`);
    if (index !== 4) {
      const row = record(input.report.detoxSaveRetryActionEvidence, 'owner action evidence');
      const hashes = record(row[name], `owner action evidence ${name}`);
      assert.equal(hashes.sha256, observed.sha256);
    }
    assertionSources.push({
      id: nativeSaveRetryAssertionIds[index],
      name,
      sha256: observed.sha256,
    });
  }
  const semantic = sourceSemanticHash({
    save,
    build,
    runtimeMetadata,
    producerToken: input.producerToken,
    executionBinding: fullExecutionBinding,
  });
  const semanticBytes = semanticSourceBytes({
    save,
    build,
    runtimeMetadata,
    semanticSourceHash: semantic,
    producerToken: input.producerToken,
    executionBinding: fullExecutionBinding,
  });
  assert(semanticBytes.byteLength <= MAX_SEMANTIC_SOURCE_BYTES);
  const semanticReadback = await writeAtomicDetoxConnectionBytes(
    captureRoot,
    SEMANTIC_SOURCE_NAME,
    semanticBytes,
    MAX_SEMANTIC_SOURCE_BYTES,
    {
      signal: input.lifecycle.signal,
      deadlineAt: input.lifecycle.deadlineAtMonotonicMs,
    },
  );
  requireLive(input.lifecycle, 'owner semantic receipt publication');
  assert(semanticReadback.bytes.equals(semanticBytes));
  const faultIdentity = record(save.faultIdentity, 'owner fault identity');
  return brand(
    {
      repositoryRoot: path.resolve(input.repositoryRoot),
      runtimeMetadata,
      build,
      captureRootIdentity: captureIdentity,
      targetOrigin: requireStrictBackendOrigin(save.targetOrigin),
      backendRunId: String(save.runId),
      accountUid: String(save.accountUid),
      cleanupStatus: 'cleaned',
      cleanupOwner: 'existing-detox-connection-driver-aggregate',
      semanticSourceHashBefore: semantic,
      semanticSourceHashAfter: semantic,
      semanticSourceReceipt: {
        name: SEMANTIC_SOURCE_NAME,
        sha256: hashBytes(semanticBytes),
        bytes: semanticBytes.byteLength,
        identity: evidenceIdentity(semanticReadback.metadata),
      },
      producerReceipt: {
        kind: 'private-detox-save-retry-owner-producer-receipt',
        owner: 'existing-detox-connection-driver-aggregate',
        producerToken: input.producerToken,
        executionBinding: fullExecutionBinding,
      },
      executionBinding: fullExecutionBinding,
      fault: {
        attemptId: String(faultIdentity.faultAttemptId),
        backendRunId: String(save.runId),
        accountUid: String(save.accountUid),
        method: 'POST',
        path: '/plans/training',
        injectedStatus: 503,
        injectedWrites: 1,
        forwardedStatus: 201,
        forwardedWrites: 1,
      },
      finalResult: {
        planId: String(result.planId),
        snapshotsSemanticHash: hashJson(snapshots),
        apiSemanticHash: hashJson(apiReads),
        transportHash: hashJson(transport),
      },
      assertionSources,
    },
    OWNER_SOURCE_CAPABILITY,
  ) as DetoxSaveRetryOwnerRuntimeSource;
}

/** Re-read the original owner report after the bridge and before staging. */
export async function rereadDetoxSaveRetryOwnerSemanticSource(input: {
  source: DetoxSaveRetryOwnerRuntimeSource;
  captureRoot: string;
  save: Row;
  runtimeMetadata: DetoxRuntimeBuildMetadata;
  report: Row;
  lifecycle: Readonly<{
    signal: AbortSignal;
    deadlineAtMonotonicMs: number;
  }>;
}): Promise<string> {
  requireCapability(input.source, OWNER_SOURCE_CAPABILITY, 'owner runtime source');
  requireLive(input.lifecycle, 'owner semantic reread start');
  const receipt = input.source.semanticSourceReceipt;
  assert.equal(receipt.name, SEMANTIC_SOURCE_NAME);
  requireHash(receipt.sha256, 'owner semantic source receipt hash');
  assert(receipt.bytes > 0 && receipt.bytes <= MAX_SEMANTIC_SOURCE_BYTES);
  const observed = await readOwnedDetoxConnectionEvidence(
    path.resolve(input.captureRoot),
    receipt.name,
    MAX_SEMANTIC_SOURCE_BYTES,
    {
      signal: input.lifecycle.signal,
      deadlineAt: input.lifecycle.deadlineAtMonotonicMs,
    },
  );
  requireLive(input.lifecycle, 'owner semantic reread');
  assert.equal(observed.bytes.byteLength, receipt.bytes);
  assert.equal(hashBytes(observed.bytes), receipt.sha256);
  assertSameEvidenceIdentity(
    requireEvidenceIdentity(receipt.identity, 'owner semantic source identity'),
    evidenceIdentity(observed.metadata),
    'owner semantic source',
  );
  const payload = record(
    JSON.parse(observed.bytes.toString('utf8')),
    'owner semantic source receipt',
  );
  assert.equal(payload.kind, 'private-detox-save-retry-owner-semantic');
  requireHash(payload.semanticSourceHash, 'owner semantic source hash');
  const semantic = record(payload.semantic, 'owner semantic source value');
  const persistedBuild = requireBuild(semantic.build);
  assert.deepEqual(persistedBuild, input.source.build);
  requireDetoxRuntimeBuildMetadata(semantic.runtimeMetadata, 'owner semantic runtime metadata');
  assert.deepEqual(semantic.runtimeMetadata, input.source.runtimeMetadata);
  const persistedHash = sourceSemanticHash({
    save: semantic,
    build: persistedBuild,
    runtimeMetadata: input.source.runtimeMetadata,
    producerToken: String(semantic.producerToken),
    executionBinding: record(semantic.executionBinding, 'persisted owner execution binding'),
  });
  assert.equal(payload.semanticSourceHash, persistedHash);
  assert.equal(persistedHash, input.source.semanticSourceHashBefore);
  const currentExecutionBinding = {
    build: structuredClone(record(input.report.build, 'current execution build')),
    child: structuredClone(record(input.report.detoxChild, 'current execution child')),
    childIdentity: structuredClone(
      record(input.report.detoxChildIdentity, 'current execution child identity'),
    ),
  };
  assert.deepEqual(
    currentExecutionBinding,
    input.source.executionBinding,
    'owner execution binding changed before public staging',
  );
  const persistedProducer = record(
    {
      producerToken: semantic.producerToken,
      executionBinding: semantic.executionBinding,
    },
    'persisted owner producer receipt',
  );
  assert.equal(
    persistedProducer.producerToken,
    input.source.producerReceipt.producerToken,
    'owner producer token changed before public staging',
  );
  const currentHash = sourceSemanticHash({
    save: input.save,
    build: input.source.build,
    runtimeMetadata: input.runtimeMetadata,
    producerToken: input.source.producerReceipt.producerToken,
    executionBinding: input.source.executionBinding,
  });
  assert.equal(currentHash, persistedHash, 'owner semantic report changed before public staging');
  return persistedHash;
}

export function completeDetoxSaveRetryRuntimeProof(input: {
  source: DetoxSaveRetryOwnerRuntimeSource;
  outputRoot: string;
  outputRootIdentityBefore: DetoxRuntimeDirectoryIdentity;
  outputRootIdentityAfter: DetoxRuntimeDirectoryIdentity;
  outputEvidence: readonly Readonly<{
    name: string;
    identity: DetoxSaveRetryEvidenceIdentity;
  }>[];
  semanticSourceHashAfter?: string;
  lifecycle: Readonly<{
    signal: AbortSignal;
    deadlineAtMonotonicMs: number;
  }>;
}): DetoxSaveRetryRuntimeProof {
  requireCapability(input.source, OWNER_SOURCE_CAPABILITY, 'owner runtime source');
  requireLive(input.lifecycle, 'runtime proof composition');
  const root = path.resolve(input.outputRoot);
  const outputBefore = requireIdentity(
    input.outputRootIdentityBefore,
    'Save/retry output root before staging',
  );
  const capture = requireIdentity(input.source.captureRootIdentity, 'Save/retry capture root');
  assert.equal(root, outputBefore.realpath, 'Save/retry output root is not canonical');
  assert.notEqual(
    outputBefore.realpath,
    capture.realpath,
    'Save/retry output root must be distinct from the owner capture root',
  );
  const evidenceByName = new Map(input.outputEvidence.map((file) => [file.name, file.identity]));
  const assertionBindings = input.source.assertionSources.map((source) => ({
    id: source.id,
    outcome: 'passed' as const,
    evidencePaths: [path.join(root, source.name)],
    evidenceHashes: [source.sha256],
    evidenceIdentities: [
      requireEvidenceIdentity(
        evidenceByName.get(source.name),
        `staged evidence identity ${source.name}`,
      ),
    ],
  }));
  return brand(
    {
      repositoryRoot: input.source.repositoryRoot,
      runtimeMetadata: input.source.runtimeMetadata,
      build: input.source.build,
      assertionBindings,
      cleanupStatus: input.source.cleanupStatus,
      cleanupOwner: input.source.cleanupOwner,
      captureRootIdentity: input.source.captureRootIdentity,
      outputRootIdentityBefore: input.outputRootIdentityBefore,
      outputRootIdentityAfter: input.outputRootIdentityAfter,
      semanticSourceReceipt: input.source.semanticSourceReceipt,
      semanticSourceHashBefore: input.source.semanticSourceHashBefore,
      semanticSourceHashAfter:
        input.semanticSourceHashAfter ?? input.source.semanticSourceHashAfter,
      targetOrigin: input.source.targetOrigin,
      backendRunId: input.source.backendRunId,
      accountUid: input.source.accountUid,
      fault: input.source.fault,
      finalResult: input.source.finalResult,
      producerReceipt: input.source.producerReceipt,
      executionBinding: input.source.executionBinding,
      lifecycle: input.lifecycle,
    },
    RUNTIME_PROOF_CAPABILITY,
  ) as DetoxSaveRetryRuntimeProof;
}

async function requireRetainedEvidence(
  bindings: readonly DetoxSaveRetryAssertionBinding[],
  outputRoot: DetoxRuntimeDirectoryIdentity,
  lifecycle: Readonly<{
    signal: AbortSignal;
    deadlineAtMonotonicMs: number;
  }>,
): Promise<void> {
  const root = requireIdentity(outputRoot, 'Save/retry output root').realpath;
  const paths = new Set<string>();
  for (const binding of bindings) {
    for (let index = 0; index < binding.evidencePaths.length; index += 1) {
      const evidencePath = path.resolve(binding.evidencePaths[index]);
      assert(
        evidencePath.startsWith(`${root}${path.sep}`),
        'Save/retry evidence escaped output root',
      );
      assert.equal(
        path.dirname(evidencePath),
        root,
        'Save/retry evidence must be a direct output-root file',
      );
      assert(!paths.has(evidencePath), 'Save/retry evidence path was reused');
      paths.add(evidencePath);
      const observed = await readOwnedDetoxConnectionEvidence(
        root,
        path.basename(evidencePath),
        MAX_EVIDENCE_BYTES,
        {
          signal: lifecycle.signal,
          deadlineAt: lifecycle.deadlineAtMonotonicMs,
        },
      );
      requireLive(lifecycle, `retained evidence ${evidencePath}`);
      assertSameEvidenceIdentity(
        requireEvidenceIdentity(
          binding.evidenceIdentities[index],
          `retained evidence identity ${evidencePath}`,
        ),
        evidenceIdentity(observed.metadata),
        `retained evidence ${evidencePath}`,
      );
      assert.equal(hashBytes(observed.bytes), binding.evidenceHashes[index]);
    }
  }
}

/** The only source-to-public promotion gate for this route. */
export async function finalizeDetoxSaveRetryRuntime(
  input: DetoxSaveRetryRuntimeProof,
): Promise<DetoxSaveRetryRuntimeFinalization> {
  requireCapability(input, RUNTIME_PROOF_CAPABILITY, 'runtime proof');
  requireLive(input.lifecycle, 'runtime finalization start');
  requireDetoxRuntimeBuildMetadata(input.runtimeMetadata);
  await revalidateDetoxRuntimeBuildMetadata(input.repositoryRoot, input.runtimeMetadata);
  requireLive(input.lifecycle, 'runtime metadata finalization check');
  assert.deepEqual(input.build, requireBuild(input.build));
  requireStrictBackendOrigin(input.targetOrigin);
  assert.equal(input.backendRunId, input.fault.backendRunId);
  assert.equal(input.accountUid, input.fault.accountUid);
  assert.equal(input.fault.method, 'POST');
  assert.equal(input.fault.path, '/plans/training');
  assert.equal(input.fault.injectedStatus, 503);
  assert.equal(input.fault.forwardedStatus, 201);
  assert.equal(input.fault.injectedWrites, 1);
  assert.equal(input.fault.forwardedWrites, 1);
  assert(input.fault.attemptId.length > 0);
  const captureRootBefore = await readLiveDirectoryIdentity(
    input.captureRootIdentity.realpath,
    'Save/retry capture root',
  );
  requireStableDirectoryIdentity(
    input.captureRootIdentity,
    captureRootBefore,
    'Save/retry capture root',
  );
  const outputRootBefore = await readLiveDirectoryIdentity(
    input.outputRootIdentityBefore.realpath,
    'Save/retry output root',
  );
  requireStableDirectoryIdentity(
    input.outputRootIdentityBefore,
    outputRootBefore,
    'Save/retry output root',
  );
  requireStableDirectoryIdentity(
    outputRootBefore,
    input.outputRootIdentityAfter,
    'Save/retry output root',
  );
  requireIdentity(input.captureRootIdentity, 'Save/retry capture root');
  assert.equal(input.producerReceipt.kind, 'private-detox-save-retry-owner-producer-receipt');
  assert.equal(input.producerReceipt.owner, 'existing-detox-connection-driver-aggregate');
  assert(
    input.producerReceipt.producerToken.length >= 32,
    'save/retry producer receipt token is invalid',
  );
  assert.deepEqual(
    input.producerReceipt.executionBinding,
    input.executionBinding,
    'save/retry producer execution binding changed',
  );
  requireHash(input.semanticSourceHashBefore, 'Save/retry semantic source before');
  assert.equal(
    input.semanticSourceHashAfter,
    input.semanticSourceHashBefore,
    'Save/retry semantic source changed',
  );
  assert.equal(input.cleanupStatus, 'cleaned');
  assert.equal(input.cleanupOwner, 'existing-detox-connection-driver-aggregate');
  requireHash(input.finalResult.snapshotsSemanticHash, 'Save/retry snapshots hash');
  requireHash(input.finalResult.apiSemanticHash, 'Save/retry API hash');
  requireHash(input.finalResult.transportHash, 'Save/retry transport hash');
  const assertionBindings = requireBindings(input.assertionBindings);
  await requireRetainedEvidence(assertionBindings, input.outputRootIdentityBefore, input.lifecycle);
  const semanticReceipt = await readOwnedEvidence(
    input.captureRootIdentity.realpath,
    input.semanticSourceReceipt,
    input.lifecycle,
  );
  assert.equal(
    semanticReceipt.sha256,
    input.semanticSourceReceipt.sha256,
    'Save/retry owner semantic receipt changed during finalization',
  );
  assertSameEvidenceIdentity(
    input.semanticSourceReceipt.identity,
    semanticReceipt.identity,
    'Save/retry owner semantic receipt',
  );
  const outputRootAfter = await readLiveDirectoryIdentity(
    input.outputRootIdentityAfter.realpath,
    'Save/retry output root',
  );
  requireStableDirectoryIdentity(
    input.outputRootIdentityAfter,
    outputRootAfter,
    'Save/retry output root',
  );
  const captureRootAfter = await readLiveDirectoryIdentity(
    input.captureRootIdentity.realpath,
    'Save/retry capture root',
  );
  requireStableDirectoryIdentity(captureRootBefore, captureRootAfter, 'Save/retry capture root');
  // Runtime metadata is re-read after every retained-evidence await. A
  // package replacement during staging must invalidate publication even when
  // the initial preflight was genuine.
  await revalidateDetoxRuntimeBuildMetadata(input.repositoryRoot, input.runtimeMetadata);
  requireLive(input.lifecycle, 'runtime finalization return');
  return {
    status: 'qualified',
    assertionIds: [...nativeSaveRetryAssertionIds],
    assertionBindings,
    nativePassingCases: 5,
    publicPromotionEligible: true,
    environmentHash: input.runtimeMetadata.environmentHash,
  };
}
