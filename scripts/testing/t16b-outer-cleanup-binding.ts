import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { readNativeEvidenceObservation, type NativeEvidenceIdentity } from './native-view-evidence';
import type { NativeConnectionAttemptBinding } from './native-connection-attempt-binding';

const RUN_ID = /^[a-f0-9]{24}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const REQUIRED_SELECTION_KEYS = [
  'target',
  'build',
  'tool',
  'locale',
  'roles',
  'fixture',
  'reset',
  'authApi',
  'sql',
  'ownership',
] as const;

type JsonRecord = Record<string, unknown>;

export type T16BOuterCleanupFacts = Readonly<{
  kind: 'independent ios native inventory cleanup proof';
  result: 'passed' | 'failed';
  runId: string;
  captureResult: string;
  captureCleanupClean: boolean | null;
  pidStartPairs: number | null;
  survivors: readonly number[] | null;
  unknownProcessQueries: readonly number[] | null;
  missingForeignDevices: readonly string[] | null;
  ownedDeviceAbsent: boolean | null;
  cacheAbsent: boolean | null;
  docker: Readonly<{
    container: readonly string[];
    network: readonly string[];
    volume: readonly string[];
  }> | null;
  finishedAt: string | null;
}>;

export type T16BOuterCleanupBinding = Readonly<{
  schemaVersion: 1;
  kind: 'private-t16-b-outer-cleanup-binding-not-public-receipt';
  scope: 'outer-ios-native-session';
  captureRunId: string;
  artifactRoot: string;
  source: Readonly<{
    path: 'external-cleanup.private.json';
    bytes: number;
    sha256: string;
    identity: NativeEvidenceIdentity;
  }>;
  facts: T16BOuterCleanupFacts;
}>;

export type T16BParentOwnedInputBinding = Readonly<{
  schemaVersion: 1;
  kind: 'private-t16-b-parent-owned-input-binding-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  backendRunId: string;
  backendAttemptId: string;
  fixtureScope: NativeConnectionAttemptBinding['fixtureScope'];
  selection: NativeConnectionAttemptBinding['selection'];
  assertionIds: readonly string[];
  assertionSemanticSha256: string;
  assertionContractSha256: string;
  selectionEvidence: Readonly<Record<string, T16BEvidenceReference>>;
}>;

export type T16BEvidenceReference = Readonly<{
  path: string;
  sha256: string;
  bytes: number;
  kind: string;
  /** Selection-time protected descriptor identity from the real producer. */
  identity?: NativeEvidenceIdentity;
}>;

/**
 * A parent binding is only terminal evidence after every referenced selection
 * artifact has been reread from the capture root through the protected
 * descriptor reader.  Keep this as a distinct type so a shape-valid,
 * caller-constructed compact binding cannot be mistaken for a verified one.
 */
export type T16BVerifiedEvidenceReference = T16BEvidenceReference &
  Readonly<{
    identity: NativeEvidenceIdentity;
  }>;

export type T16BVerifiedParentOwnedInputBinding = Omit<
  T16BParentOwnedInputBinding,
  'selectionEvidence'
> & {
  selectionEvidence: Readonly<Record<string, T16BVerifiedEvidenceReference>>;
  verification: Readonly<{
    verified: true;
    artifactRoot: string;
    selectionEvidenceSha256: string;
  }>;
};

function record(value: unknown, label: string): JsonRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is missing`);
  return value as JsonRecord;
}

function optionalBoolean(value: unknown, label: string): boolean | null {
  if (value === undefined) return null;
  assert(typeof value === 'boolean', `${label} must be boolean when present`);
  return value;
}

function optionalNonNegativeInteger(value: unknown, label: string): number | null {
  if (value === undefined) return null;
  assert(
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    `${label} must be a non-negative integer when present`,
  );
  return value;
}

function optionalNumberArray(value: unknown, label: string): readonly number[] | null {
  if (value === undefined) return null;
  assert(Array.isArray(value), `${label} must be an array when present`);
  return value.map((row, index) => {
    assert(
      typeof row === 'number' && Number.isSafeInteger(row) && row > 0,
      `${label}[${index}] must be a positive integer`,
    );
    return row;
  });
}

function optionalStringArray(value: unknown, label: string): readonly string[] | null {
  if (value === undefined) return null;
  assert(Array.isArray(value), `${label} must be an array when present`);
  return value.map((row, index) => {
    assert(typeof row === 'string' && row.length > 0, `${label}[${index}] must be non-empty`);
    assert(!/[\u0000\r\n]/u.test(row), `${label}[${index}] contains a control character`);
    return row;
  });
}

function optionalDocker(value: unknown): T16BOuterCleanupFacts['docker'] {
  if (value === undefined) return null;
  const row = record(value, 'cleanup docker facts');
  const values = {} as Record<'container' | 'network' | 'volume', readonly string[]>;
  for (const key of ['container', 'network', 'volume'] as const) {
    assert(Object.prototype.hasOwnProperty.call(row, key), `cleanup docker.${key} is missing`);
    const parsed = optionalStringArray(row[key], `cleanup docker.${key}`);
    assert(parsed !== null, `cleanup docker.${key} is missing`);
    values[key] = parsed;
  }
  return values;
}

function optionalFinishedAt(value: unknown): string | null {
  if (value === undefined) return null;
  assert(
    typeof value === 'string' && !Number.isNaN(Date.parse(value)),
    'cleanup finishedAt is invalid',
  );
  return value;
}

function parseFacts(value: unknown): T16BOuterCleanupFacts {
  const row = record(value, 'outer cleanup receipt');
  assert(
    row.kind === 'independent ios native inventory cleanup proof',
    'outer cleanup kind differs',
  );
  assert(row.result === 'passed' || row.result === 'failed', 'outer cleanup result is invalid');
  assert(typeof row.runId === 'string' && RUN_ID.test(row.runId), 'outer cleanup runId is invalid');
  assert(
    typeof row.captureResult === 'string' && row.captureResult.length > 0,
    'outer cleanup captureResult is missing',
  );
  const facts: T16BOuterCleanupFacts = {
    kind: row.kind,
    result: row.result,
    runId: row.runId,
    captureResult: row.captureResult,
    captureCleanupClean: optionalBoolean(row.captureCleanupClean, 'cleanup captureCleanupClean'),
    pidStartPairs: optionalNonNegativeInteger(row.pidStartPairs, 'cleanup pidStartPairs'),
    survivors: optionalNumberArray(row.survivors, 'cleanup survivors'),
    unknownProcessQueries: optionalNumberArray(
      row.unknownProcessQueries,
      'cleanup unknownProcessQueries',
    ),
    missingForeignDevices: optionalStringArray(
      row.missingForeignDevices,
      'cleanup missingForeignDevices',
    ),
    ownedDeviceAbsent: optionalBoolean(row.ownedDeviceAbsent, 'cleanup ownedDeviceAbsent'),
    cacheAbsent: optionalBoolean(row.cacheAbsent, 'cleanup cacheAbsent'),
    docker: optionalDocker(row.docker),
    finishedAt: optionalFinishedAt(row.finishedAt),
  };
  if (facts.result === 'passed') requirePassedOuterCleanupFacts(facts);
  return facts;
}

export function requirePassedOuterCleanupFacts(facts: T16BOuterCleanupFacts): void {
  assert(facts.result === 'passed', 'outer cleanup did not pass');
  assert(facts.captureCleanupClean === true, 'outer cleanup capture cleanup is not clean');
  assert(facts.pidStartPairs !== null && facts.pidStartPairs > 0, 'outer cleanup census is absent');
  assert(facts.survivors?.length === 0, 'outer cleanup retained owned survivors');
  assert(facts.unknownProcessQueries?.length === 0, 'outer cleanup has unknown process queries');
  assert(facts.missingForeignDevices?.length === 0, 'outer cleanup changed foreign devices');
  assert(facts.ownedDeviceAbsent === true, 'outer cleanup retained the owned device');
  assert(facts.cacheAbsent === true, 'outer cleanup retained the owned cache');
  assert(
    facts.docker !== null &&
      Array.isArray(facts.docker.container) &&
      Array.isArray(facts.docker.network) &&
      Array.isArray(facts.docker.volume) &&
      facts.docker.container.length === 0 &&
      facts.docker.network.length === 0 &&
      facts.docker.volume.length === 0,
    'outer cleanup retained backend resources',
  );
  assert(facts.finishedAt !== null, 'outer cleanup completion timestamp is absent');
}

export function readT16BOuterCleanupBinding(input: {
  artifactRoot: string;
  expectedCaptureRunId: string;
}): T16BOuterCleanupBinding {
  assert(path.isAbsolute(input.artifactRoot), 'outer cleanup artifact root must be absolute');
  assert(RUN_ID.test(input.expectedCaptureRunId), 'outer cleanup capture run id is invalid');
  const observation = readNativeEvidenceObservation(
    input.artifactRoot,
    'external-cleanup.private.json',
    true,
  );
  const facts = parseFacts(JSON.parse(observation.bytes.toString('utf8')));
  assert(facts.runId === input.expectedCaptureRunId, 'outer cleanup run identity differs');
  return {
    schemaVersion: 1,
    kind: 'private-t16-b-outer-cleanup-binding-not-public-receipt',
    scope: 'outer-ios-native-session',
    captureRunId: input.expectedCaptureRunId,
    artifactRoot: path.resolve(input.artifactRoot),
    source: {
      path: 'external-cleanup.private.json',
      bytes: observation.bytes.byteLength,
      sha256: createHash('sha256').update(observation.bytes).digest('hex'),
      identity: observation.identity,
    },
    facts,
  };
}

function safeReference(value: unknown, label: string): T16BEvidenceReference {
  const row = record(value, label);
  assert(
    typeof row.path === 'string' && row.path.length > 0 && !path.isAbsolute(row.path),
    `${label}.path is invalid`,
  );
  assert(!row.path.split('/').includes('..'), `${label}.path escapes its artifact root`);
  assert(typeof row.sha256 === 'string' && SHA256.test(row.sha256), `${label}.sha256 is invalid`);
  assert(
    typeof row.bytes === 'number' && Number.isSafeInteger(row.bytes) && row.bytes > 0,
    `${label}.bytes is invalid`,
  );
  assert(typeof row.kind === 'string' && row.kind.length > 0, `${label}.kind is invalid`);
  return {
    path: row.path,
    sha256: row.sha256,
    bytes: row.bytes,
    kind: row.kind,
    ...(row.identity === undefined
      ? {}
      : { identity: requireEvidenceIdentity(row.identity, `${label}.identity`) }),
  };
}

function requireEvidenceIdentity(value: unknown, label: string): NativeEvidenceIdentity {
  const row = record(value, label);
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
  ] as const)
    assert(typeof row[key] === 'number' && Number.isFinite(row[key]), `${label}.${key} is invalid`);
  return row as unknown as NativeEvidenceIdentity;
}

function sameNativeEvidenceIdentity(
  expected: NativeEvidenceIdentity,
  actual: NativeEvidenceIdentity,
): boolean {
  return (
    expected.dev === actual.dev &&
    expected.ino === actual.ino &&
    expected.uid === actual.uid &&
    expected.gid === actual.gid &&
    expected.mode === actual.mode &&
    expected.nlink === actual.nlink &&
    expected.size === actual.size &&
    expected.mtimeMs === actual.mtimeMs &&
    expected.ctimeMs === actual.ctimeMs
  );
}

function bindingDigest(
  selectionEvidence: Readonly<Record<string, T16BVerifiedEvidenceReference>>,
): string {
  const canonical = Object.fromEntries(
    Object.keys(selectionEvidence)
      .sort()
      .map((key) => {
        const ref = selectionEvidence[key];
        return [key, { ...ref, identity: { ...ref.identity } }];
      }),
  );
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function requireVerifiedParentOwnedInputBinding(
  value: unknown,
  expectedArtifactRoot?: string,
): T16BVerifiedParentOwnedInputBinding {
  const binding = requireT16BParentOwnedInputBinding(value);
  const row = record(value, 'verified parent-owned input binding');
  const verification = record(row.verification, 'parent-owned input verification');
  assert(verification.verified === true, 'parent-owned input reread was not verified');
  assert(
    typeof verification.artifactRoot === 'string',
    'parent-owned input verification root missing',
  );
  if (expectedArtifactRoot !== undefined)
    assert(
      path.resolve(verification.artifactRoot) === path.resolve(expectedArtifactRoot),
      'parent-owned input verification root differs',
    );
  assert(
    SHA256.test(String(verification.selectionEvidenceSha256)),
    'parent-owned input verification digest is invalid',
  );
  const refs = record(binding.selectionEvidence, 'verified parent-owned input selection evidence');
  const verifiedRefs: Record<string, T16BVerifiedEvidenceReference> = {};
  for (const key of REQUIRED_SELECTION_KEYS) {
    const ref = safeReference(refs[key], `selectionEvidence.${key}`);
    const identity = requireEvidenceIdentity(
      (refs[key] as Record<string, unknown>).identity,
      `selectionEvidence.${key}.identity`,
    );
    verifiedRefs[key] = { ...ref, identity };
  }
  assert(
    bindingDigest(verifiedRefs) === verification.selectionEvidenceSha256,
    'parent-owned input verification digest differs',
  );
  return {
    ...binding,
    selectionEvidence: verifiedRefs,
    verification: {
      verified: true,
      artifactRoot: path.resolve(verification.artifactRoot),
      selectionEvidenceSha256: verification.selectionEvidenceSha256,
    },
  };
}

/**
 * Re-read every selection reference through the descriptor-bound native
 * evidence reader.  This is deliberately async only at the call boundary;
 * the reader itself closes each descriptor before returning and checks path,
 * descriptor and post-read identities.
 */
export async function verifyT16BParentOwnedInputBinding(input: {
  artifactRoot: string;
  binding: unknown;
  signal?: AbortSignal;
  deadlineAtMonotonicMs?: number;
}): Promise<T16BVerifiedParentOwnedInputBinding> {
  assert(path.isAbsolute(input.artifactRoot), 'parent binding artifact root must be absolute');
  const binding = requireT16BParentOwnedInputBinding(input.binding);
  const root = path.resolve(input.artifactRoot);
  assert(path.basename(root) === binding.captureRunId, 'parent binding capture root differs');
  const verifiedRefs: Record<string, T16BVerifiedEvidenceReference> = {};
  for (const key of REQUIRED_SELECTION_KEYS) {
    input.signal?.throwIfAborted();
    if (
      input.deadlineAtMonotonicMs !== undefined &&
      performance.now() >= input.deadlineAtMonotonicMs
    )
      throw new Error(`T16 parent binding reread deadline reached during ${key}`);
    const ref = binding.selectionEvidence[key];
    const observation = readNativeEvidenceObservation(root, ref.path, true);
    assert(observation.bytes.byteLength === ref.bytes, `selectionEvidence.${key} size changed`);
    assert(
      createHash('sha256').update(observation.bytes).digest('hex') === ref.sha256,
      `selectionEvidence.${key} hash changed`,
    );
    const selectedIdentity = requireEvidenceIdentity(
      ref.identity,
      `selectionEvidence.${key}.identity`,
    );
    assert(
      sameNativeEvidenceIdentity(selectedIdentity, observation.identity),
      `selectionEvidence.${key} descriptor identity changed`,
    );
    verifiedRefs[key] = { ...ref, identity: selectedIdentity };
  }
  input.signal?.throwIfAborted();
  if (input.deadlineAtMonotonicMs !== undefined && performance.now() >= input.deadlineAtMonotonicMs)
    throw new Error('T16 parent binding reread deadline reached');
  const selectionEvidenceSha256 = bindingDigest(verifiedRefs);
  await Promise.resolve();
  return {
    ...binding,
    selectionEvidence: verifiedRefs,
    verification: {
      verified: true,
      artifactRoot: root,
      selectionEvidenceSha256,
    },
  };
}

export function requireT16BVerifiedParentOwnedInputBinding(
  value: unknown,
  expectedArtifactRoot?: string,
): T16BVerifiedParentOwnedInputBinding {
  return requireVerifiedParentOwnedInputBinding(value, expectedArtifactRoot);
}

export function buildT16BParentOwnedInputBinding(input: {
  connectionBinding: NativeConnectionAttemptBinding;
  selectionEvidence: unknown;
}): T16BParentOwnedInputBinding {
  const binding = input.connectionBinding;
  assert(RUN_ID.test(binding.requestedRunId), 'parent binding requested run id is invalid');
  assert(
    binding.requestedAttemptId === `${binding.requestedRunId}:first`,
    'parent binding attempt differs',
  );
  assert(RUN_ID.test(binding.captureRunId), 'parent binding capture run id is invalid');
  assert(RUN_ID.test(binding.backendRunId), 'parent binding backend run id is invalid');
  assert(
    binding.backendAttemptId === `${binding.backendRunId}:first`,
    'parent binding backend attempt differs',
  );
  const refs = record(input.selectionEvidence, 'parent selection evidence');
  const selectionEvidence: Record<string, T16BEvidenceReference> = {};
  for (const key of REQUIRED_SELECTION_KEYS)
    selectionEvidence[key] = safeReference(refs[key], `selectionEvidence.${key}`);
  return {
    schemaVersion: 1,
    kind: 'private-t16-b-parent-owned-input-binding-not-public-receipt',
    requestedRunId: binding.requestedRunId,
    requestedAttemptId: binding.requestedAttemptId,
    captureRunId: binding.captureRunId,
    backendRunId: binding.backendRunId,
    backendAttemptId: binding.backendAttemptId,
    fixtureScope: binding.fixtureScope,
    selection: binding.selection,
    assertionIds: [...binding.assertionIds],
    assertionSemanticSha256: binding.assertionSemanticSha256,
    assertionContractSha256: binding.assertionContractSha256,
    selectionEvidence,
  };
}

export function requireT16BParentOwnedInputBinding(value: unknown): T16BParentOwnedInputBinding {
  const row = record(value, 'parent-owned input binding');
  assert(row.schemaVersion === 1, 'parent-owned input binding schema differs');
  assert(
    row.kind === 'private-t16-b-parent-owned-input-binding-not-public-receipt',
    'parent-owned input binding kind differs',
  );
  const binding = row as unknown as T16BParentOwnedInputBinding;
  assert(RUN_ID.test(binding.requestedRunId), 'parent-owned input requested run id is invalid');
  assert(
    binding.requestedAttemptId === `${binding.requestedRunId}:first`,
    'parent-owned input attempt differs',
  );
  assert(
    RUN_ID.test(binding.captureRunId) && RUN_ID.test(binding.backendRunId),
    'parent-owned input run ids are invalid',
  );
  assert(
    binding.backendAttemptId === `${binding.backendRunId}:first`,
    'parent-owned input backend attempt differs',
  );
  const refs = record(binding.selectionEvidence, 'parent-owned input selection evidence');
  for (const key of REQUIRED_SELECTION_KEYS) safeReference(refs[key], `selectionEvidence.${key}`);
  assert(
    Array.isArray(binding.assertionIds) && binding.assertionIds.length > 0,
    'parent-owned input assertions are missing',
  );
  assert(
    SHA256.test(binding.assertionSemanticSha256),
    'parent-owned input semantic hash is invalid',
  );
  assert(
    SHA256.test(binding.assertionContractSha256),
    'parent-owned input contract hash is invalid',
  );
  return binding;
}
