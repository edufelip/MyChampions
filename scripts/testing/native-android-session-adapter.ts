import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { chmod, lstat, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  requireRetainedNativeSessionIdentity,
  type NativeAuthMetadataObservation,
} from './native-auth-observation';
import type { ProxyObservation } from './owned-api-proxy';

type AndroidProxyObservation = ProxyObservation;

type AndroidOwnedDomainSnapshot = {
  schemaVersion: 1;
  runId: string;
  scope: string;
  readOnly: true;
  trainingPlans: readonly unknown[];
  connections: readonly unknown[];
};

const ANDROID_APP_ID = 'com.edufelip.mychampions.dev';
const SESSION_KEY = 'auth.server.session';
const SECURE_SESSION_KEY = `secure.${SESSION_KEY}`;
const CURRENT_SECURE_STORE_KEY = `key_v1-${SECURE_SESSION_KEY}`;
// Expo SecureStoreModule falls back to the raw namespaced key.  The
// keychain-aware key is the current representation; the raw namespaced key is
// the only legacy representation accepted by this read-only observer.
const LEGACY_SECURE_STORE_KEY = SECURE_SESSION_KEY;
const DATABASE_BASE = 'RKStorage';
const DATABASE_WAL = 'RKStorage-wal';
const DATABASE_SHM = 'RKStorage-shm';
const MAX_DATABASE_BYTES = 32 * 1024 * 1024;
const MAX_SIDECAR_BYTES = 32 * 1024 * 1024;
const MAX_XML_BYTES = 256 * 1024;
const MAX_QUERY_BYTES = 256 * 1024;
const MAX_SESSION_TRANSPORT_BYTES = 1 * 1024 * 1024;
const MAX_LISTING_BYTES = 64 * 1024;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

const query = `SELECT
  json_valid(value) AS jsonValid,
  CASE WHEN json_valid(value) THEN json_type(value, '$.profile') ELSE NULL END AS profileType,
  CASE WHEN json_valid(value) THEN json_extract(value, '$.profile.authUid') ELSE NULL END AS profileAuthUid,
  CASE WHEN json_valid(value) THEN json_type(value, '$.expiresAt') ELSE NULL END AS expiryType,
  CASE WHEN json_valid(value) THEN json_type(value, '$.accessToken') ELSE NULL END AS accessTokenType,
  CASE WHEN json_valid(value) THEN json_type(value, '$.refreshToken') ELSE NULL END AS refreshTokenType,
  length(value) AS recordBytes
FROM catalystLocalStorage
WHERE key = '${SESSION_KEY}';`;

export type AndroidStorageFileKind =
  'database' | 'sidecar' | 'query' | 'xml' | 'listing' | 'frame' | 'transport' | 'auth';

export type AndroidStorageFileReceipt = {
  path: string;
  kind: AndroidStorageFileKind;
  sizeBytes: number;
  sha256: string;
  ownerUid: number;
  mode: number;
  verification: 'owned-stable-reader-v6';
};

export type AndroidOwnedFileIdentity = {
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  nlink: number;
};

export type AndroidBoundedFileReadOptions = {
  artifactRoot: string;
  filePath: string;
  label: string;
  maxBytes: number;
  signal?: AbortSignal;
  beforeRead?: () => void | Promise<void>;
};

export type AndroidBoundedFileReadResult = {
  bytes: Buffer;
  path: string;
  identity: AndroidOwnedFileIdentity;
};

export type AndroidCapturedFrameReceipt = {
  path: string;
  sizeBytes: number;
  sha256: string;
  ownerUid: number;
  mode: number;
  contentKind: 'hierarchy-source' | 'hierarchy-json' | 'png';
  verification: 'owned-stable-reader-v6';
};

export type AndroidSessionStorageProbePlan = {
  appId: typeof ANDROID_APP_ID;
  sessionKey: typeof SESSION_KEY;
  secureSessionKey: typeof SECURE_SESSION_KEY;
  currentSecureStoreKey: typeof CURRENT_SECURE_STORE_KEY;
  legacySecureStoreKey: typeof LEGACY_SECURE_STORE_KEY;
  databaseRelativePath: 'databases/RKStorage';
  databaseRelativePaths: readonly [
    'databases/RKStorage',
    'databases/RKStorage-wal',
    'databases/RKStorage-shm',
  ];
  secureStoreRelativePath: 'shared_prefs/SecureStore.xml';
  databaseDirectoryArgv: readonly string[];
  databaseCaptureArgv: (relativePath: string) => readonly string[];
  secureStorePresenceArgv: readonly string[];
  secureStoreCaptureArgv: readonly string[];
  sqliteQuery: string;
};

export type AndroidDatabaseCoherence = {
  basePresent: boolean;
  sidecars: readonly ('RKStorage-wal' | 'RKStorage-shm')[];
  orphanSidecars: readonly string[];
  rollbackJournals: readonly string[];
};

export type AndroidSessionStorageObservation = {
  status: 'session-present' | 'session-absent' | 'storage-inconsistent';
  reason: 'none' | 'store-presence-mismatch' | 'plaintext-token-in-async-storage';
  asyncStorage: {
    database: 'present' | 'absent';
    recordPresent: boolean;
    profilePresent: boolean;
    expiryPresent: boolean;
    plaintextAccessTokenPresent: boolean;
    plaintextRefreshTokenPresent: boolean;
    recordBytes: number | null;
    profileAuthUidHash: string | null;
  };
  secureStore: {
    preferences: 'present' | 'absent';
    sessionEntryPresent: boolean;
    keyFormat: 'current' | 'legacy' | 'none';
  };
  source: {
    asyncStorage: 'android-async-storage-rkstorage-sqlite';
    secureStore: 'expo-secure-store-shared-preferences-presence-only';
    sessionKeyHash: string;
  };
};

export type AndroidSessionStorageCheckpoint = AndroidSessionStorageObservation & {
  coherence: AndroidDatabaseCoherence;
  privateArtifacts: {
    /** Null only when the before-login sandbox has no AsyncStorage database yet. */
    database: AndroidStorageFileReceipt | null;
    databaseSidecars: AndroidStorageFileReceipt[];
    query: AndroidStorageFileReceipt | null;
    querySource: AndroidQuerySourceReceipt | null;
    secureStore: AndroidStorageFileReceipt | null;
    databaseListing: AndroidStorageFileReceipt;
    secureStoreListing: AndroidStorageFileReceipt;
  };
};

export type AndroidQuerySourceReceipt = {
  path: string;
  /** Every current Android query-source producer publishes this role discriminator. */
  kind: 'query';
  sizeBytes: number;
  sha256: string;
  ownerUid: number;
  mode: number;
  retained: false;
  databaseSha256: string;
  databaseSidecarSha256: readonly string[];
  verification: 'owned-query-source-v6';
};

export type AndroidLoginObservation = {
  requestId: number;
  pathHash: string;
  status: number;
  outcome: string;
  requestProfile: string;
};

export type AndroidPersistedLoginIdentity = {
  actor: 'coach' | 'student';
  actorAuthUid: string;
  authRequestId: number;
  afterRequestId: number;
  apiPid: number;
  targetOrigin: string;
  fixtureAuthUidAllowlistHash: string;
};

export type AndroidBackendIdentity = {
  backendAttemptId: string;
  apiOrigin: string;
  apiProcess: { pid: number; started: string; script: string };
};

export type AndroidPersistedLoginCheckpoint = {
  status: 'verified';
  actor: 'coach' | 'student';
  actorAuthUidHash: string;
  authRequestId: number;
  afterRequestId: number;
  authPathHash: string;
  apiPid: number;
  targetOrigin: string;
  fixtureAuthUidAllowlistHash: string;
  backendAttemptId: string;
  backendApiOrigin: string;
  backendApiProcess: { pid: number; started: string; script: string };
  persistedStorageCheckpoint: 'auth-before-relaunch';
  persistedProfileAuthUidHash: string;
  sessionStatus: 'session-present';
};

type SqliteRow = {
  jsonValid: 0 | 1;
  profileType: string | null;
  profileAuthUidHash: string;
  expiryType: string | null;
  accessTokenType: string | null;
  refreshTokenType: string | null;
  recordBytes: number;
};

function assertRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Android session storage record is not an object');
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  )
    throw new Error('Android session storage query returned an unexpected projection');
}

function parseSqliteProjection(raw: string | null, database: 'present' | 'absent') {
  if (database === 'absent') {
    if (raw !== null) throw new Error('Android session storage query exists without its database');
    return null;
  }
  if (raw === null) throw new Error('Android session storage query output is missing');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Android session storage query output is not JSON');
  }
  if (!Array.isArray(parsed) || parsed.length > 1)
    throw new Error('Android session storage session row is missing or ambiguous');
  if (parsed.length === 0) return null;
  const row = assertRecord(parsed[0]);
  const recordBytes = row.recordBytes;
  requireExactKeys(row, [
    'jsonValid',
    'profileType',
    'profileAuthUid',
    'expiryType',
    'accessTokenType',
    'refreshTokenType',
    'recordBytes',
  ]);
  if (
    (row.jsonValid !== 0 && row.jsonValid !== 1) ||
    (row.profileType !== null && typeof row.profileType !== 'string') ||
    typeof row.profileAuthUid !== 'string' ||
    row.profileAuthUid.length === 0 ||
    (row.expiryType !== null && typeof row.expiryType !== 'string') ||
    (row.accessTokenType !== null && typeof row.accessTokenType !== 'string') ||
    (row.refreshTokenType !== null && typeof row.refreshTokenType !== 'string') ||
    !Number.isSafeInteger(recordBytes) ||
    (recordBytes as number) < 0
  )
    throw new Error('Android session storage query projection is malformed');
  const typed: SqliteRow = {
    jsonValid: row.jsonValid,
    profileType: row.profileType,
    profileAuthUidHash: createHash('sha256').update(row.profileAuthUid).digest('hex'),
    expiryType: row.expiryType,
    accessTokenType: row.accessTokenType,
    refreshTokenType: row.refreshTokenType,
    recordBytes: recordBytes as number,
  };
  if (typed.jsonValid !== 1) throw new Error('Android session storage record is malformed');
  return typed;
}

/**
 * Replace the raw profile UID in a private sqlite projection with its hash.
 * The command output is read only long enough to validate and hash the field;
 * the retained query artifact contains no UID or bearer value.
 */
export function redactAndroidSqliteQuery(raw: string): {
  redactedJson: string;
  profileAuthUidHash: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Android session storage query output is not JSON');
  }
  const row = parseSqliteProjection(raw, 'present');
  if (row === null) {
    if (!Array.isArray(parsed) || parsed.length !== 0)
      throw new Error('Android session storage query output is not an empty projection');
    return { redactedJson: '[]', profileAuthUidHash: null };
  }
  if (!Array.isArray(parsed) || parsed.length !== 1)
    throw new Error('Android session storage query output is malformed');
  const redactedRow = { ...assertRecord(parsed[0]) };
  delete redactedRow.profileAuthUid;
  return {
    redactedJson: JSON.stringify([{ ...redactedRow, profileAuthUidHash: row.profileAuthUidHash }]),
    profileAuthUidHash: row.profileAuthUidHash,
  };
}

function parseSecureStoreXml(raw: string | null, preferences: 'present' | 'absent') {
  if (preferences === 'absent') {
    if (raw !== null) throw new Error('Android SecureStore XML exists without its file');
    return { sessionEntryPresent: false, keyFormat: 'none' as const };
  }
  // Android writes an emptied SharedPreferences file as a self-closing <map />.
  if (
    raw === null ||
    !/^\s*(?:<\?xml[^>]*>\s*)?(?:<map(?:\s[^>]*)?>[\s\S]*<\/map>|<map\s*\/>)\s*$/.test(raw)
  )
    throw new Error('Android SecureStore preferences XML is malformed');
  const openStrings = [...raw.matchAll(/<string\s+name="([^"]+)"[^>]*>/g)].map((match) => match[1]);
  const closeCount = (raw.match(/<\/string>/g) ?? []).length;
  if (openStrings.length !== closeCount)
    throw new Error('Android SecureStore preferences XML has an unclosed value');
  const currentCount = openStrings.filter((name) => name === CURRENT_SECURE_STORE_KEY).length;
  const legacyCount = openStrings.filter((name) => name === LEGACY_SECURE_STORE_KEY).length;
  if (currentCount > 1 || legacyCount > 1 || (currentCount > 0 && legacyCount > 0))
    throw new Error('Android SecureStore session entry is ambiguous');
  if (currentCount === 1) return { sessionEntryPresent: true, keyFormat: 'current' as const };
  if (legacyCount === 1) return { sessionEntryPresent: true, keyFormat: 'legacy' as const };
  return { sessionEntryPresent: false, keyFormat: 'none' as const };
}

function hasUnrecognizedSecureStoreString(raw: string | null): boolean {
  if (raw === null) return false;
  return [...raw.matchAll(/<string\s+name="([^"]+)"[^>]*>/g)].some(
    (match) => match[1] !== CURRENT_SECURE_STORE_KEY && match[1] !== LEGACY_SECURE_STORE_KEY,
  );
}

/** Build fixed, read-only commands; no caller-provided shell text is accepted. */
export function buildAndroidSessionStorageProbePlan(
  appId: string = ANDROID_APP_ID,
): AndroidSessionStorageProbePlan {
  if (appId !== ANDROID_APP_ID) throw new Error('Android session probe requires the dev app');
  return {
    appId: ANDROID_APP_ID,
    sessionKey: SESSION_KEY,
    secureSessionKey: SECURE_SESSION_KEY,
    currentSecureStoreKey: CURRENT_SECURE_STORE_KEY,
    legacySecureStoreKey: LEGACY_SECURE_STORE_KEY,
    databaseRelativePath: 'databases/RKStorage',
    databaseRelativePaths: [
      'databases/RKStorage',
      'databases/RKStorage-wal',
      'databases/RKStorage-shm',
    ],
    secureStoreRelativePath: 'shared_prefs/SecureStore.xml',
    databaseDirectoryArgv: ['shell', 'run-as', ANDROID_APP_ID, 'ls', '-1', 'databases'],
    databaseCaptureArgv: (relativePath) => {
      const declaredPaths: readonly string[] = [
        'databases/RKStorage',
        'databases/RKStorage-wal',
        'databases/RKStorage-shm',
      ];
      if (!declaredPaths.includes(relativePath))
        throw new Error('Android session database path is not declared');
      return ['exec-out', 'run-as', ANDROID_APP_ID, 'cat', relativePath];
    },
    secureStorePresenceArgv: ['shell', 'run-as', ANDROID_APP_ID, 'ls', '-1', 'shared_prefs'],
    secureStoreCaptureArgv: [
      'exec-out',
      'run-as',
      ANDROID_APP_ID,
      'cat',
      'shared_prefs/SecureStore.xml',
    ],
    sqliteQuery: query,
  };
}

function safeListingName(value: string) {
  return Boolean(value) && !/[\s/\\\0]/.test(value) && value !== '.' && value !== '..';
}

/** Parse a bounded `ls -1` stream and reject ambiguous or escaped names. */
export function parseAndroidStorageListing(raw: string, label: string): readonly string[] {
  if (Buffer.byteLength(raw, 'utf8') > MAX_LISTING_BYTES)
    throw new Error(`${label} listing exceeds its bounded size`);
  const names = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (names.some((name) => !safeListingName(name)))
    throw new Error(`${label} listing contains an unsafe name`);
  if (new Set(names).size !== names.length)
    throw new Error(`${label} listing contains duplicate names`);
  return names;
}

function rollbackJournal(name: string) {
  return name === 'RKStorage-journal' || /^RKStorage-(?:mj|rollback)/i.test(name);
}

/** Require a coherent target database set; unrelated databases remain observable. */
export function requireCoherentAndroidDatabaseListing(
  names: readonly string[],
  options: {
    /**
     * Android SQLite's TRUNCATE/PERSIST journal modes keep RKStorage-journal
     * after a commit (empty, or with a zeroed header). Only a caller that read
     * it and found no hot-journal header may pass this.
     */
    rollbackJournalVerifiedEmpty?: boolean;
  } = {},
): AndroidDatabaseCoherence {
  const set = new Set(names);
  const basePresent = set.has(DATABASE_BASE);
  const sidecars = [DATABASE_WAL, DATABASE_SHM].filter((name) => set.has(name)) as (
    'RKStorage-wal' | 'RKStorage-shm'
  )[];
  const orphanSidecars = sidecars.length > 0 && !basePresent ? [...sidecars] : [];
  const rollbackJournals = names.filter(
    (name) =>
      rollbackJournal(name) &&
      !(options.rollbackJournalVerifiedEmpty && name === 'RKStorage-journal'),
  );
  if (orphanSidecars.length) throw new Error('Android AsyncStorage has orphan WAL/SHM sidecars');
  if (rollbackJournals.length) throw new Error('Android AsyncStorage has a rollback journal');
  if (!basePresent) throw new Error('Android AsyncStorage database is missing');
  return { basePresent, sidecars, orphanSidecars, rollbackJournals };
}

/** Coherence for a fresh install whose app sandbox has no databases/ yet. */
export function requireAbsentAndroidDatabaseCoherence(): AndroidDatabaseCoherence {
  return { basePresent: false, sidecars: [], orphanSidecars: [], rollbackJournals: [] };
}

export function requireSameAndroidDatabaseListing(
  before: readonly string[],
  after: readonly string[],
) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const changed = [...new Set([...beforeSet, ...afterSet])].filter(
    (name) => beforeSet.has(name) !== afterSet.has(name),
  );
  if (changed.length) throw new Error('Android AsyncStorage database changed during capture');
}

function identity(metadata: {
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  nlink: number;
}): AndroidOwnedFileIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    mode: metadata.mode,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
    nlink: metadata.nlink,
  };
}

function sameIdentity(left: AndroidOwnedFileIdentity, right: AndroidOwnedFileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink
  );
}

function assertAbort(signal?: AbortSignal) {
  signal?.throwIfAborted();
}

const boundedReadChunkBytes = 64 * 1024;

function requireBoundedLimit(maxBytes: number, label: string): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new Error(`${label} size cap is invalid`);
  return maxBytes;
}

function requireOwnedFileStats(
  metadata: {
    isFile(): boolean;
    isSymbolicLink(): boolean;
    dev: number;
    ino: number;
    uid: number;
    gid: number;
    mode: number;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
    nlink: number;
  },
  maxBytes: number,
  label: string,
): AndroidOwnedFileIdentity {
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${label} is not a regular file`);
  assert.equal(metadata.nlink, 1, `${label} must have one link`);
  assert.equal(metadata.uid, process.getuid?.(), `${label} owner changed`);
  assert.equal(metadata.mode & 0o777, 0o600, `${label} mode is not private`);
  assert(metadata.size > 0 && metadata.size <= maxBytes, `${label} exceeds its bounded size`);
  return identity(metadata);
}

function requireOwnedPrivateRootSync(root: string): string {
  const resolved = path.resolve(root);
  assert.equal(realpathSync(resolved), resolved, 'Android artifact root is not canonical');
  const metadata = lstatSync(resolved);
  assert(
    metadata.isDirectory() && !metadata.isSymbolicLink(),
    'Android artifact root is not a private directory',
  );
  assert.equal(metadata.uid, process.getuid?.(), 'Android artifact root owner changed');
  assert.equal(metadata.mode & 0o777, 0o700, 'Android artifact root is not private');
  return resolved;
}

function resolveOwnedFileSync(root: string, filePath: string, label: string): string {
  const resolved = path.resolve(filePath);
  assert(resolved.startsWith(`${root}${path.sep}`), `${label} escaped its artifact root`);
  assert.equal(realpathSync(resolved), resolved, `${label} is not canonical`);
  return resolved;
}

function readSyncBounded(
  descriptor: number,
  expectedSize: number,
  maxBytes: number,
  guard?: () => void,
): Buffer {
  const targetBytes = Math.min(maxBytes + 1, expectedSize + 1);
  const result = Buffer.allocUnsafe(targetBytes);
  let offset = 0;
  while (offset < targetBytes) {
    guard?.();
    const bytesRead = readSync(
      descriptor,
      result,
      offset,
      Math.min(boundedReadChunkBytes, targetBytes - offset),
      offset,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  guard?.();
  return result.subarray(0, offset);
}

async function readAsyncBounded(
  descriptor: Awaited<ReturnType<typeof open>>,
  expectedSize: number,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const targetBytes = Math.min(maxBytes + 1, expectedSize + 1);
  const result = Buffer.allocUnsafe(targetBytes);
  let offset = 0;
  while (offset < targetBytes) {
    assertAbort(signal);
    const read = await descriptor.read(
      result,
      offset,
      Math.min(boundedReadChunkBytes, targetBytes - offset),
      offset,
    );
    if (read.bytesRead === 0) break;
    offset += read.bytesRead;
  }
  assertAbort(signal);
  return result.subarray(0, offset);
}

/** Shared bounded reader for all Android producer files consumed by the session verifier. */
export async function readOwnedAndroidBoundedFile(
  options: AndroidBoundedFileReadOptions,
): Promise<AndroidBoundedFileReadResult> {
  assertAbort(options.signal);
  const maxBytes = requireBoundedLimit(options.maxBytes, options.label);
  const root = await requireOwnedPrivateRoot(options.artifactRoot);
  const resolved = path.resolve(options.filePath);
  if (!resolved.startsWith(`${root}${path.sep}`))
    throw new Error(`${options.label} escaped its artifact root`);
  if ((await realpath(resolved)) !== resolved) throw new Error(`${options.label} is not canonical`);
  const before = await lstat(resolved);
  const beforeIdentity = requireOwnedFileStats(before, maxBytes, options.label);
  assertAbort(options.signal);
  const descriptor = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorBefore = identity(await descriptor.stat());
    assert(
      sameIdentity(beforeIdentity, descriptorBefore),
      `${options.label} descriptor identity changed before read`,
    );
    await options.beforeRead?.();
    const bytes = await readAsyncBounded(
      descriptor,
      descriptorBefore.size,
      maxBytes,
      options.signal,
    );
    const descriptorAfter = identity(await descriptor.stat());
    const pathAfter = identity(await lstat(resolved));
    assert(
      sameIdentity(descriptorBefore, descriptorAfter),
      `${options.label} descriptor identity changed while reading`,
    );
    assert(
      sameIdentity(descriptorBefore, pathAfter),
      `${options.label} path identity changed while reading`,
    );
    assert.equal(await realpath(resolved), resolved, `${options.label} path changed while reading`);
    assert.equal(bytes.length, descriptorAfter.size, `${options.label} byte count changed`);
    assert(bytes.length <= maxBytes, `${options.label} exceeds its bounded size`);
    return { bytes, path: path.relative(root, resolved), identity: descriptorAfter };
  } finally {
    await descriptor.close();
  }
}

/** Synchronous counterpart used by the public dependency's synchronous validator. */
export function readOwnedAndroidBoundedFileSync(options: {
  artifactRoot: string;
  filePath: string;
  label: string;
  maxBytes: number;
  guard?: () => void;
  beforeRead?: () => void;
}): AndroidBoundedFileReadResult {
  const maxBytes = requireBoundedLimit(options.maxBytes, options.label);
  const root = requireOwnedPrivateRootSync(options.artifactRoot);
  const resolved = resolveOwnedFileSync(root, options.filePath, options.label);
  const before = lstatSync(resolved);
  const beforeIdentity = requireOwnedFileStats(before, maxBytes, options.label);
  options.guard?.();
  const descriptor = openSync(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorBefore = identity(fstatSync(descriptor));
    assert(
      sameIdentity(beforeIdentity, descriptorBefore),
      `${options.label} descriptor identity changed before read`,
    );
    options.beforeRead?.();
    const bytes = readSyncBounded(descriptor, descriptorBefore.size, maxBytes, options.guard);
    const descriptorAfter = identity(fstatSync(descriptor));
    const pathAfter = identity(lstatSync(resolved));
    assert(
      sameIdentity(descriptorBefore, descriptorAfter),
      `${options.label} descriptor identity changed while reading`,
    );
    assert(
      sameIdentity(descriptorBefore, pathAfter),
      `${options.label} path identity changed while reading`,
    );
    assert.equal(realpathSync(resolved), resolved, `${options.label} path changed while reading`);
    assert.equal(bytes.length, descriptorAfter.size, `${options.label} byte count changed`);
    assert(bytes.length <= maxBytes, `${options.label} exceeds its bounded size`);
    return { bytes, path: path.relative(root, resolved), identity: descriptorAfter };
  } finally {
    closeSync(descriptor);
  }
}

function maxBytesForStorageKind(kind: AndroidStorageFileKind): number {
  return kind === 'database'
    ? MAX_DATABASE_BYTES
    : kind === 'sidecar'
      ? MAX_SIDECAR_BYTES
      : kind === 'xml'
        ? MAX_XML_BYTES
        : kind === 'query'
          ? MAX_QUERY_BYTES
          : kind === 'listing'
            ? MAX_LISTING_BYTES
            : kind === 'transport' || kind === 'auth'
              ? MAX_SESSION_TRANSPORT_BYTES
              : MAX_FRAME_BYTES;
}

async function requireOwnedPrivateRoot(root: string) {
  const resolved = path.resolve(root);
  if ((await realpath(resolved)) !== resolved)
    throw new Error('Android artifact root is not canonical');
  const metadata = await lstat(resolved);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o700
  )
    throw new Error('Android artifact root is not an owned private directory');
  return resolved;
}

type AndroidStableFileReadOptions = {
  artifactRoot: string;
  filePath: string;
  kind: AndroidStorageFileKind;
  maxBytes: number;
  signal?: AbortSignal;
};

async function readOwnedAndroidStableFileInternal(
  options: AndroidStableFileReadOptions,
  beforeRead?: () => void | Promise<void>,
): Promise<{ bytes: Buffer; receipt: AndroidStorageFileReceipt }> {
  const loaded = await readOwnedAndroidBoundedFile({
    artifactRoot: options.artifactRoot,
    filePath: options.filePath,
    label: `Android ${options.kind} output`,
    maxBytes: options.maxBytes,
    signal: options.signal,
    beforeRead,
  });
  const receipt = {
    path: loaded.path,
    kind: options.kind,
    sizeBytes: loaded.bytes.byteLength,
    sha256: createHash('sha256').update(loaded.bytes).digest('hex'),
    ownerUid: loaded.identity.uid,
    mode: loaded.identity.mode & 0o777,
    verification: 'owned-stable-reader-v6' as const,
  } satisfies AndroidStorageFileReceipt;
  return { bytes: loaded.bytes, receipt };
}

/** Read one owned private output only after stable bounded stat checks. */
export async function readOwnedAndroidStableFile(
  options: AndroidStableFileReadOptions,
): Promise<{ bytes: Buffer; receipt: AndroidStorageFileReceipt }> {
  return readOwnedAndroidStableFileInternal(options);
}

/** Resource-free filesystem race seam used only by the private candidate tests. */
export async function readOwnedAndroidStableFileForTest(
  options: AndroidStableFileReadOptions,
  beforeRead: () => void | Promise<void>,
): Promise<{ bytes: Buffer; receipt: AndroidStorageFileReceipt }> {
  return readOwnedAndroidStableFileInternal(options, beforeRead);
}

export async function writeOwnedAndroidPrivateFile(options: {
  artifactRoot: string;
  relativePath: string;
  bytes: Uint8Array | string;
  kind: AndroidStorageFileKind;
  signal?: AbortSignal;
}): Promise<AndroidStorageFileReceipt> {
  assertAbort(options.signal);
  const bytes =
    typeof options.bytes === 'string' ? Buffer.byteLength(options.bytes) : options.bytes.byteLength;
  const maxBytes = maxBytesForStorageKind(options.kind);
  if (bytes <= 0 || bytes > maxBytes)
    throw new Error(`Android ${options.kind} output exceeds its bounded write size`);
  const root = await requireOwnedPrivateRoot(options.artifactRoot);
  if (!options.relativePath || path.isAbsolute(options.relativePath))
    throw new Error('Android output path must be relative');
  const target = path.resolve(root, options.relativePath);
  if (!target.startsWith(root + path.sep)) throw new Error('Android output escaped its root');
  const parent = path.dirname(target);
  if ((await realpath(parent)) !== parent)
    throw new Error('Android output parent is not canonical');
  const parentMetadata = await lstat(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink())
    throw new Error('Android output parent is not a regular directory');
  await writeFile(target, options.bytes, { flag: 'wx', mode: 0o600 });
  await chmod(target, 0o600);
  assertAbort(options.signal);
  return (
    await readOwnedAndroidStableFile({
      artifactRoot: root,
      filePath: target,
      kind: options.kind,
      maxBytes,
      signal: options.signal,
    })
  ).receipt;
}

/** Convert private query output into redacted storage state with profile identity hash only. */
export function parseAndroidSessionStorageObservation(input: {
  database: 'present' | 'absent';
  sqliteJson: string | null;
  securePreferences: 'present' | 'absent';
  secureStoreXml: string | null;
  sessionKeyHash: string;
}): AndroidSessionStorageObservation {
  if (!/^[a-f0-9]{64}$/.test(input.sessionKeyHash))
    throw new Error('Android session storage key hash is invalid');
  const row = parseSqliteProjection(input.sqliteJson, input.database);
  const secure = parseSecureStoreXml(input.secureStoreXml, input.securePreferences);
  const asyncStorage = {
    database: input.database,
    recordPresent: row !== null,
    profilePresent: row?.profileType === 'object',
    expiryPresent: row?.expiryType === 'text',
    plaintextAccessTokenPresent: row?.accessTokenType === 'text',
    plaintextRefreshTokenPresent: row?.refreshTokenType === 'text',
    recordBytes: row?.recordBytes ?? null,
    profileAuthUidHash: row?.profileAuthUidHash ?? null,
  } as const;
  if (
    row &&
    (asyncStorage.plaintextAccessTokenPresent || asyncStorage.plaintextRefreshTokenPresent)
  )
    return {
      status: 'storage-inconsistent',
      reason: 'plaintext-token-in-async-storage',
      asyncStorage,
      secureStore: { preferences: input.securePreferences, ...secure },
      source: {
        asyncStorage: 'android-async-storage-rkstorage-sqlite',
        secureStore: 'expo-secure-store-shared-preferences-presence-only',
        sessionKeyHash: input.sessionKeyHash,
      },
    };
  if (row && (!asyncStorage.profilePresent || !asyncStorage.expiryPresent))
    throw new Error('Android session storage record lacks profile or expiry metadata');
  const present = Boolean(row) && secure.sessionEntryPresent;
  const absent = !row && !secure.sessionEntryPresent;
  const unrecognizedSecureStoreOnly =
    input.securePreferences === 'present' &&
    !row &&
    hasUnrecognizedSecureStoreString(input.secureStoreXml);
  return {
    status:
      present || (absent && !unrecognizedSecureStoreOnly)
        ? present
          ? 'session-present'
          : 'session-absent'
        : 'storage-inconsistent',
    reason:
      present || (absent && !unrecognizedSecureStoreOnly) ? 'none' : 'store-presence-mismatch',
    asyncStorage,
    secureStore: { preferences: input.securePreferences, ...secure },
    source: {
      asyncStorage: 'android-async-storage-rkstorage-sqlite',
      secureStore: 'expo-secure-store-shared-preferences-presence-only',
      sessionKeyHash: input.sessionKeyHash,
    },
  };
}

const signInPathHash = createHash('sha256').update('/auth/email/sign-in').digest('hex');

/** Compare the redacted profile identity read from owned RKStorage with the authenticated actor. */
export function requireAndroidPersistedProfileIdentityHash(input: {
  observation: AndroidSessionStorageObservation;
  expectedAuthUid: string;
}): string {
  if (typeof input.expectedAuthUid !== 'string' || input.expectedAuthUid.length === 0)
    throw new Error('Android persisted profile identity expectation is missing');
  if (input.observation.status !== 'session-present')
    throw new Error('Android persisted profile identity lacks a present session');
  const actual = input.observation.asyncStorage.profileAuthUidHash;
  if (typeof actual !== 'string' || !/^[a-f0-9]{64}$/.test(actual))
    throw new Error('Android persisted profile identity hash is missing or malformed');
  const expected = createHash('sha256').update(input.expectedAuthUid).digest('hex');
  if (actual !== expected)
    throw new Error('Android persisted profile identity does not match the authenticated actor');
  return actual;
}

export function requireAndroidPersistedLoginCheckpoint(input: {
  beforeRelaunch: AndroidSessionStorageObservation;
  signInBoundary: Pick<AndroidPersistedLoginIdentity, 'authRequestId' | 'afterRequestId'>;
  actorIdentity: AndroidPersistedLoginIdentity;
  apiIdentity: { apiPid: number; targetOrigin: string };
  expectedRunId: string;
  backendProvenance: AndroidBackendIdentity;
}): AndroidPersistedLoginCheckpoint {
  const { actorIdentity, apiIdentity, backendProvenance, signInBoundary } = input;
  if (
    actorIdentity.actor !== 'coach' ||
    typeof actorIdentity.actorAuthUid !== 'string' ||
    actorIdentity.actorAuthUid.length === 0 ||
    !Number.isSafeInteger(actorIdentity.authRequestId) ||
    actorIdentity.authRequestId < 1 ||
    actorIdentity.authRequestId !== signInBoundary.authRequestId ||
    !Number.isSafeInteger(actorIdentity.afterRequestId) ||
    actorIdentity.afterRequestId < actorIdentity.authRequestId ||
    actorIdentity.afterRequestId !== signInBoundary.afterRequestId ||
    !Number.isSafeInteger(actorIdentity.apiPid) ||
    actorIdentity.apiPid !== apiIdentity.apiPid ||
    typeof actorIdentity.targetOrigin !== 'string' ||
    actorIdentity.targetOrigin !== apiIdentity.targetOrigin ||
    !/^[a-f0-9]{64}$/.test(actorIdentity.fixtureAuthUidAllowlistHash)
  )
    throw new Error('Android persisted-login actor identity is not bound to the owned API');
  if (
    !/^[a-f0-9]{24}$/.test(input.expectedRunId) ||
    typeof backendProvenance.backendAttemptId !== 'string' ||
    backendProvenance.backendAttemptId !== `${input.expectedRunId}:first` ||
    backendProvenance.apiOrigin !== apiIdentity.targetOrigin ||
    backendProvenance.apiProcess.pid !== apiIdentity.apiPid ||
    typeof backendProvenance.apiProcess.started !== 'string' ||
    backendProvenance.apiProcess.started.length === 0 ||
    typeof backendProvenance.apiProcess.script !== 'string' ||
    backendProvenance.apiProcess.script.length === 0
  )
    throw new Error('Android persisted-login backend identity is not bound to the owned API');
  if (input.beforeRelaunch.status !== 'session-present')
    throw new Error('Android persisted-login checkpoint lacks a restored session');
  const persistedProfileAuthUidHash = requireAndroidPersistedProfileIdentityHash({
    observation: input.beforeRelaunch,
    expectedAuthUid: actorIdentity.actorAuthUid,
  });
  return {
    status: 'verified',
    actor: actorIdentity.actor,
    actorAuthUidHash: createHash('sha256').update(actorIdentity.actorAuthUid).digest('hex'),
    authRequestId: actorIdentity.authRequestId,
    afterRequestId: actorIdentity.afterRequestId,
    authPathHash: signInPathHash,
    apiPid: actorIdentity.apiPid,
    targetOrigin: actorIdentity.targetOrigin,
    fixtureAuthUidAllowlistHash: actorIdentity.fixtureAuthUidAllowlistHash,
    backendAttemptId: backendProvenance.backendAttemptId,
    backendApiOrigin: backendProvenance.apiOrigin,
    backendApiProcess: structuredClone(backendProvenance.apiProcess),
    persistedStorageCheckpoint: 'auth-before-relaunch',
    persistedProfileAuthUidHash,
    sessionStatus: 'session-present',
  };
}

const hydratePathHash = createHash('sha256').update('/me/hydrate').digest('hex');

export type AndroidOwnedApiLifetimeProbe = {
  runId: string;
  proxyRunId: string;
  proxyOrigin: string;
  apiOrigin: string;
  apiPid: number;
  apiStarted: string;
  apiScript: string;
  backendAttemptId: string;
  manifestSha256: string;
};

export function requireAndroidOwnedApiLifetimeBinding(input: {
  before: AndroidOwnedApiLifetimeProbe;
  after: AndroidOwnedApiLifetimeProbe;
  expectedRunId: string;
  expectedProxyRunId: string;
  expectedProxyOrigin: string;
}): AndroidOwnedApiLifetimeProbe {
  const { before, after } = input;
  if (
    !/^[a-f0-9]{24}$/.test(input.expectedRunId) ||
    input.expectedProxyRunId !== input.expectedRunId ||
    typeof input.expectedProxyOrigin !== 'string' ||
    input.expectedProxyOrigin.length === 0
  )
    throw new Error('Android owned API lifetime expectation is malformed');
  const fields = [
    'runId',
    'proxyRunId',
    'proxyOrigin',
    'apiOrigin',
    'apiPid',
    'apiStarted',
    'apiScript',
    'backendAttemptId',
    'manifestSha256',
  ] as const;
  for (const probe of [before, after]) {
    if (
      probe.runId !== input.expectedRunId ||
      probe.proxyRunId !== input.expectedProxyRunId ||
      probe.proxyOrigin !== input.expectedProxyOrigin ||
      !/^https?:\/\//.test(probe.apiOrigin) ||
      !Number.isSafeInteger(probe.apiPid) ||
      probe.apiPid <= 1 ||
      typeof probe.apiStarted !== 'string' ||
      probe.apiStarted.length === 0 ||
      typeof probe.apiScript !== 'string' ||
      probe.apiScript.length === 0 ||
      !probe.backendAttemptId.endsWith(':first') ||
      !/^[a-f0-9]{64}$/.test(probe.manifestSha256)
    )
      throw new Error('Android owned API lifetime probe is malformed or unbound');
  }
  if (fields.some((field) => before[field] !== after[field]))
    throw new Error('Android owned API lifetime changed across the transport window');
  return structuredClone(before);
}

export type AndroidSessionCheckpointPhase =
  'before-login' | 'after-login' | 'after-restoration' | 'after-signed-out-relaunch';

export type AndroidSessionCheckpointReceipt = {
  phase: AndroidSessionCheckpointPhase;
  runId: string;
  scope: string;
  apiOrigin: string;
  apiPid: number;
  backendAttemptId: string;
  manifestSha256: string;
  fixtureAuthUidAllowlistHash: string;
  profile: {
    path: string;
    sizeBytes: number;
    sha256: string;
    ownerUid: number;
    mode: number;
    verification: 'owned-runtime-document-v6';
  };
  domain: {
    path: string;
    sizeBytes: number;
    sha256: string;
    ownerUid: number;
    mode: number;
    verification: 'owned-runtime-document-v6';
  };
};

export function requireAndroidSessionCheckpointSet(input: {
  checkpoints: readonly AndroidSessionCheckpointReceipt[];
  expectedRunId: string;
  expectedScope: string;
  expectedApiOrigin: string;
  expectedApiPid: number;
  expectedBackendAttemptId: string;
  expectedManifestSha256: string;
  expectedFixtureAuthUidAllowlistHash: string;
}): AndroidSessionCheckpointReceipt[] {
  const phases: readonly AndroidSessionCheckpointPhase[] = [
    'before-login',
    'after-login',
    'after-restoration',
    'after-signed-out-relaunch',
  ];
  if (input.checkpoints.length !== phases.length)
    throw new Error('Android session checkpoint set must contain four phases');
  const paths = new Set<string>();
  const hashes = new Set<string>();
  return phases.map((phase, index) => {
    const receipt = input.checkpoints[index];
    if (
      receipt.phase !== phase ||
      receipt.runId !== input.expectedRunId ||
      receipt.scope !== input.expectedScope ||
      receipt.apiOrigin !== input.expectedApiOrigin ||
      receipt.apiPid !== input.expectedApiPid ||
      receipt.backendAttemptId !== input.expectedBackendAttemptId ||
      receipt.manifestSha256 !== input.expectedManifestSha256 ||
      receipt.fixtureAuthUidAllowlistHash !== input.expectedFixtureAuthUidAllowlistHash
    )
      throw new Error('Android session checkpoint identity is not bound to one owned run');
    for (const source of [receipt.profile, receipt.domain]) {
      if (
        typeof source.path !== 'string' ||
        source.path.length === 0 ||
        !Number.isSafeInteger(source.sizeBytes) ||
        source.sizeBytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(source.sha256) ||
        !Number.isSafeInteger(source.ownerUid) ||
        source.ownerUid <= 0 ||
        source.mode !== 0o600 ||
        source.verification !== 'owned-runtime-document-v6' ||
        paths.has(source.path) ||
        hashes.has(source.sha256)
      )
        throw new Error(
          'Android session checkpoint source receipt is missing, duplicated or forged',
        );
      paths.add(source.path);
      hashes.add(source.sha256);
    }
    return structuredClone(receipt);
  });
}

export type AndroidSessionTransportRow = {
  requestId: number;
  ordinal: number;
  method: string;
  pathHash: string;
  status: number;
  outcome: string;
  requestProfile: string;
  requestOrigin: string | null;
  targetOrigin: string;
  faultAttemptId: string | null;
  requestCredentialPresent: boolean | undefined;
};

export type AndroidSessionTransportSlice = {
  status: 'verified';
  phase: 'restore' | 'signed-out-relaunch';
  beforeRequestId: number;
  afterRequestId: number;
  rows: readonly AndroidSessionTransportRow[];
  hydrationRequestIds: readonly number[];
  signInRequestIds: readonly number[];
};

function projectAndroidSessionTransportRow(
  row: AndroidProxyObservation,
  ordinal: number,
): AndroidSessionTransportRow {
  if (
    !Number.isSafeInteger(row.requestId) ||
    row.requestId < 1 ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1 ||
    typeof row.method !== 'string' ||
    !/^[A-Z]+$/.test(row.method) ||
    !/^[a-f0-9]{64}$/.test(row.pathHash) ||
    !Number.isSafeInteger(row.status) ||
    typeof row.outcome !== 'string' ||
    row.requestProfile !== 'native' ||
    row.requestOrigin !== null ||
    typeof row.targetOrigin !== 'string' ||
    row.targetOrigin.length === 0 ||
    row.faultAttemptId !== null
  )
    throw new Error('Android session transport row crossed the owned native boundary');
  return {
    requestId: row.requestId,
    ordinal,
    method: row.method,
    pathHash: row.pathHash,
    status: row.status,
    outcome: row.outcome,
    requestProfile: row.requestProfile,
    requestOrigin: row.requestOrigin,
    targetOrigin: row.targetOrigin,
    faultAttemptId: row.faultAttemptId,
    requestCredentialPresent: row.requestCredentialPresent,
  };
}

/**
 * Bind a lifecycle window to the exact observed request ordinal slice.  The
 * restore window must contain the owned authenticated POST hydrate and no sign-in;
 * the signed-out relaunch window must contain neither hydrate nor sign-in.
 */
export function requireAndroidSessionTransportSlice(input: {
  observations: readonly AndroidProxyObservation[];
  beforeRequestId: number;
  afterRequestId: number;
  phase: 'restore' | 'signed-out-relaunch';
  targetOrigin: string;
  apiLifetime: AndroidOwnedApiLifetimeProbe;
  expectedRunId: string;
  expectedProxyRunId: string;
  expectedProxyOrigin: string;
}): AndroidSessionTransportSlice {
  if (
    !Number.isSafeInteger(input.beforeRequestId) ||
    input.beforeRequestId < 0 ||
    !Number.isSafeInteger(input.afterRequestId) ||
    input.afterRequestId < input.beforeRequestId ||
    typeof input.targetOrigin !== 'string' ||
    input.targetOrigin.length === 0
  )
    throw new Error('Android session transport slice boundary is invalid');
  requireAndroidOwnedApiLifetimeBinding({
    before: input.apiLifetime,
    after: input.apiLifetime,
    expectedRunId: input.expectedRunId,
    expectedProxyRunId: input.expectedProxyRunId,
    expectedProxyOrigin: input.expectedProxyOrigin,
  });
  const requestIds = new Set<number>();
  const allIds = input.observations.map((row) => row.requestId);
  if (
    allIds.some((requestId) => !Number.isSafeInteger(requestId) || requestId < 1) ||
    new Set(allIds).size !== allIds.length
  )
    throw new Error(
      'Android session transport observations contain duplicate or invalid request IDs',
    );
  const rows = input.observations
    .map((row) => ({ row }))
    .filter(
      ({ row }) => row.requestId > input.beforeRequestId && row.requestId <= input.afterRequestId,
    )
    .sort((left, right) => left.row.requestId - right.row.requestId)
    .map(({ row }, index) => {
      if (requestIds.has(row.requestId))
        throw new Error('Android session transport request identity is duplicated');
      requestIds.add(row.requestId);
      const projected = projectAndroidSessionTransportRow(row, index + 1);
      if (projected.targetOrigin !== input.targetOrigin || projected.outcome !== 'forwarded')
        throw new Error('Android session transport row is not a forwarded owned request');
      return projected;
    });
  if (
    rows.length !== input.afterRequestId - input.beforeRequestId ||
    rows.some((row, index) => row.requestId !== input.beforeRequestId + index + 1) ||
    (input.afterRequestId > 0 && Math.max(...allIds, 0) !== input.afterRequestId)
  )
    throw new Error('Android session transport slice is not an exact request ordinal window');
  const signInRequestIds = rows
    .filter((row) => row.method === 'POST' && row.pathHash === signInPathHash)
    .map((row) => row.requestId);
  const hydrationRows = rows.filter(
    (row) => row.method === 'POST' && row.pathHash === hydratePathHash,
  );
  const hydrationRequestIds = hydrationRows.map((row) => row.requestId);
  if (signInRequestIds.length !== 0)
    throw new Error('Android session transport slice contains a second native sign-in');
  if (input.phase === 'restore' && (hydrationRows.length !== 1 || hydrationRows[0]?.status !== 200))
    throw new Error('Android restore transport slice lacks exactly one authenticated hydrate 200');
  if (input.phase === 'signed-out-relaunch' && hydrationRequestIds.length !== 0)
    throw new Error('Android signed-out relaunch transport slice hydrated a session');
  if (
    input.phase === 'signed-out-relaunch' &&
    rows.some((row) => row.requestCredentialPresent !== false)
  )
    throw new Error('Android signed-out relaunch transport sent credentials');
  return {
    status: 'verified',
    phase: input.phase,
    beforeRequestId: input.beforeRequestId,
    afterRequestId: input.afterRequestId,
    rows,
    hydrationRequestIds,
    signInRequestIds,
  };
}

export type AndroidSessionDomainBinding = {
  status: 'verified';
  source: 'owned-domain-snapshot-plus-quiesced-sql-receipts';
  runId: string;
  scope: string;
  trainingPlans: { count: number; sha256: string };
  connections: { count: number; sha256: string };
  sql: {
    before: AndroidSessionStorageReceiptSet;
    after: AndroidSessionStorageReceiptSet;
  };
};

export type AndroidSessionStorageReceiptSet = {
  database: AndroidStorageFileReceipt | null;
  databaseSidecars: AndroidStorageFileReceipt[];
  query: AndroidStorageFileReceipt | null;
  querySource: AndroidQuerySourceReceipt | null;
  secureStore: AndroidStorageFileReceipt | null;
  databaseListing: AndroidStorageFileReceipt;
  secureStoreListing: AndroidStorageFileReceipt;
};

function snapshotRowsHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function requireAndroidStorageReceipt(
  value: unknown,
  label: string,
  allowedKinds: readonly AndroidStorageFileKind[],
): AndroidStorageFileReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} SQL file receipt is missing`);
  const row = value as Partial<AndroidStorageFileReceipt>;
  const pathValue = row.path;
  const kindValue = row.kind;
  const sizeBytesValue = row.sizeBytes;
  const sha256Value = row.sha256;
  if (
    typeof pathValue !== 'string' ||
    pathValue.length === 0 ||
    /[\\/\0]/.test(pathValue) ||
    typeof kindValue !== 'string' ||
    !allowedKinds.includes(kindValue) ||
    !Number.isSafeInteger(sizeBytesValue) ||
    typeof sizeBytesValue !== 'number' ||
    sizeBytesValue <= 0 ||
    typeof sha256Value !== 'string' ||
    !/^[a-f0-9]{64}$/.test(sha256Value) ||
    !Number.isSafeInteger(row.ownerUid) ||
    (row.ownerUid as number) < 1 ||
    row.mode !== 0o600 ||
    row.verification !== 'owned-stable-reader-v6'
  )
    throw new Error(`${label} SQL file receipt is malformed`);
  if (
    (kindValue === 'database' && !/async-storage\.db$/.test(pathValue)) ||
    (kindValue === 'sidecar' && !/async-storage\.db-(?:wal|shm)$/.test(pathValue)) ||
    (kindValue === 'query' && !/async-storage-query\.json$/.test(pathValue)) ||
    (kindValue === 'xml' && !/secure-store\.xml$/.test(pathValue)) ||
    (kindValue === 'listing' &&
      !/(?:async-directory(?:-after)?|app-directory|secure-presence)\.stdout$/.test(pathValue))
  )
    throw new Error(`${label} SQL file receipt is not bound to its checkpoint artifact`);
  return {
    path: pathValue,
    kind: kindValue,
    sizeBytes: sizeBytesValue,
    sha256: sha256Value,
    ownerUid: row.ownerUid as number,
    mode: row.mode,
    verification: 'owned-stable-reader-v6',
  };
}

export function requireAndroidStorageReceiptSet(
  value: unknown,
  label: string,
): AndroidSessionStorageReceiptSet {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} storage receipt set is missing`);
  const artifacts = value as Partial<AndroidSessionStorageReceiptSet>;
  if (artifacts.database === null) {
    // Fresh-install before-login state: no database, sidecars or query, but
    // the owned app-directory listing that proved the absence is required.
    if (
      artifacts.query !== null ||
      artifacts.querySource !== null ||
      !Array.isArray(artifacts.databaseSidecars) ||
      artifacts.databaseSidecars.length !== 0
    )
      throw new Error(`${label} absent database receipts are inconsistent`);
    return {
      database: null,
      databaseSidecars: [],
      query: null,
      querySource: null,
      secureStore:
        artifacts.secureStore === null || artifacts.secureStore === undefined
          ? null
          : requireAndroidStorageReceipt(artifacts.secureStore, `${label} SecureStore`, ['xml']),
      databaseListing: requireAndroidStorageReceipt(
        artifacts.databaseListing,
        `${label} app directory listing`,
        ['listing'],
      ),
      secureStoreListing: requireAndroidStorageReceipt(
        artifacts.secureStoreListing,
        `${label} SecureStore listing`,
        ['listing'],
      ),
    };
  }
  const database = requireAndroidStorageReceipt(artifacts.database, `${label} database`, [
    'database',
  ]);
  const databaseSidecarsValue = artifacts.databaseSidecars;
  if (!Array.isArray(databaseSidecarsValue))
    throw new Error(`${label} database sidecar receipts are missing`);
  const databaseSidecars = databaseSidecarsValue.map((receipt, index) =>
    requireAndroidStorageReceipt(receipt, `${label} database sidecar ${index}`, ['sidecar']),
  );
  const receiptPaths = [database.path, ...databaseSidecars.map((receipt) => receipt.path)];
  if (new Set(receiptPaths).size !== receiptPaths.length)
    throw new Error(`${label} storage receipts contain duplicate paths`);
  const query = requireAndroidStorageReceipt(artifacts.query, `${label} query`, ['query']);
  const querySourceValue = artifacts.querySource;
  if (!querySourceValue || typeof querySourceValue !== 'object' || Array.isArray(querySourceValue))
    throw new Error(`${label} query source receipt is missing`);
  const querySource = querySourceValue as Partial<AndroidQuerySourceReceipt>;
  if (
    typeof querySource.path !== 'string' ||
    querySource.path.length === 0 ||
    /[\\/\0]/.test(querySource.path) ||
    !/async-storage-query\.raw\.private$/.test(querySource.path) ||
    querySource.kind !== 'query' ||
    typeof querySource.sizeBytes !== 'number' ||
    !Number.isSafeInteger(querySource.sizeBytes) ||
    querySource.sizeBytes <= 0 ||
    querySource.sizeBytes > MAX_QUERY_BYTES ||
    typeof querySource.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(querySource.sha256) ||
    !Number.isSafeInteger(querySource.ownerUid) ||
    (querySource.ownerUid as number) < 1 ||
    querySource.mode !== 0o600 ||
    querySource.retained !== false ||
    typeof querySource.databaseSha256 !== 'string' ||
    querySource.databaseSha256 !== database.sha256 ||
    !Array.isArray(querySource.databaseSidecarSha256) ||
    querySource.databaseSidecarSha256.some(
      (hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash),
    ) ||
    JSON.stringify(querySource.databaseSidecarSha256) !==
      JSON.stringify(databaseSidecars.map((receipt) => receipt.sha256)) ||
    querySource.verification !== 'owned-query-source-v6'
  )
    throw new Error(`${label} query source receipt is malformed or unbound`);
  if (querySource.path === query.path || querySource.sha256 === query.sha256)
    throw new Error(`${label} query source and redacted query are not distinct`);
  const secureStore =
    artifacts.secureStore === null || artifacts.secureStore === undefined
      ? null
      : requireAndroidStorageReceipt(artifacts.secureStore, `${label} SecureStore`, ['xml']);
  const databaseListing = requireAndroidStorageReceipt(
    artifacts.databaseListing,
    `${label} database listing`,
    ['listing'],
  );
  const secureStoreListing = requireAndroidStorageReceipt(
    artifacts.secureStoreListing,
    `${label} SecureStore listing`,
    ['listing'],
  );
  const allPaths = [
    ...receiptPaths,
    query.path,
    ...(secureStore ? [secureStore.path] : []),
    databaseListing.path,
    secureStoreListing.path,
  ];
  if (new Set(allPaths).size !== allPaths.length)
    throw new Error(`${label} storage receipts contain duplicate artifact paths`);
  return {
    database,
    databaseSidecars,
    query,
    querySource: querySource as AndroidQuerySourceReceipt,
    secureStore,
    databaseListing,
    secureStoreListing,
  };
}

function requireDomainSnapshot(value: unknown, label: string): AndroidOwnedDomainSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} domain snapshot is missing`);
  const snapshot = value as AndroidOwnedDomainSnapshot;
  if (
    snapshot.schemaVersion !== 1 ||
    typeof snapshot.runId !== 'string' ||
    !/^[a-f0-9]{24}$/.test(snapshot.runId) ||
    typeof snapshot.scope !== 'string' ||
    snapshot.scope.length === 0 ||
    snapshot.readOnly !== true ||
    !Array.isArray(snapshot.trainingPlans) ||
    !Array.isArray(snapshot.connections)
  )
    throw new Error(`${label} owned domain snapshot identity is malformed`);
  return snapshot;
}

/** Require unchanged unrelated domain rows and bind them to owned SQL bytes. */
export function requireAndroidSessionDomainBinding(input: {
  before: AndroidOwnedDomainSnapshot;
  after: AndroidOwnedDomainSnapshot;
  beforeStorage: AndroidSessionStorageCheckpoint;
  afterStorage: AndroidSessionStorageCheckpoint;
}): AndroidSessionDomainBinding {
  const before = requireDomainSnapshot(input.before, 'Before');
  const after = requireDomainSnapshot(input.after, 'After');
  if (before.runId !== after.runId || before.scope !== after.scope)
    throw new Error('Android session domain snapshots are not from the same owned scope');
  if (JSON.stringify(before.trainingPlans) !== JSON.stringify(after.trainingPlans))
    throw new Error('Android session changed unrelated training plans');
  if (JSON.stringify(before.connections) !== JSON.stringify(after.connections))
    throw new Error('Android session changed unrelated connections');
  const beforeReceipts = requireAndroidStorageReceiptSet(
    input.beforeStorage.privateArtifacts,
    'Before',
  );
  const afterReceipts = requireAndroidStorageReceiptSet(
    input.afterStorage.privateArtifacts,
    'After',
  );
  if (
    beforeReceipts.databaseSidecars.length !== input.beforeStorage.coherence.sidecars.length ||
    afterReceipts.databaseSidecars.length !== input.afterStorage.coherence.sidecars.length
  )
    throw new Error('Android session SQL sidecar receipts do not match directory coherence');
  const sidecarSuffixes = (receipts: AndroidStorageFileReceipt[]) =>
    receipts.map((receipt) =>
      path.basename(receipt.path).replace(/^.*async-storage\.db/, 'RKStorage'),
    );
  if (
    JSON.stringify(sidecarSuffixes(beforeReceipts.databaseSidecars).sort()) !==
      JSON.stringify([...input.beforeStorage.coherence.sidecars].sort()) ||
    JSON.stringify(sidecarSuffixes(afterReceipts.databaseSidecars).sort()) !==
      JSON.stringify([...input.afterStorage.coherence.sidecars].sort())
  )
    throw new Error('Android session SQL sidecar paths do not match directory coherence');
  if (
    (input.beforeStorage.secureStore.preferences === 'present') !==
      Boolean(beforeReceipts.secureStore) ||
    (input.afterStorage.secureStore.preferences === 'present') !==
      Boolean(afterReceipts.secureStore)
  )
    throw new Error('Android session SecureStore receipt does not match file presence');
  if (input.beforeStorage.source.sessionKeyHash !== input.afterStorage.source.sessionKeyHash)
    throw new Error('Android session SQL identity changed between checkpoints');
  return {
    status: 'verified',
    source: 'owned-domain-snapshot-plus-quiesced-sql-receipts',
    runId: before.runId,
    scope: before.scope,
    trainingPlans: {
      count: before.trainingPlans.length,
      sha256: snapshotRowsHash(before.trainingPlans),
    },
    connections: {
      count: before.connections.length,
      sha256: snapshotRowsHash(before.connections),
    },
    sql: {
      before: beforeReceipts,
      after: afterReceipts,
    },
  };
}

export type AndroidCancelledConfirmationEvidence = {
  status: 'verified';
  source: 'captured-hierarchy-after-owned-cancel';
  commandLabel: 'auth-signout-cancelled-readiness';
  hierarchyPath: string;
  screenshotPath: string;
  hierarchySourcePath: string;
  hierarchySourceReceipt: AndroidCapturedFrameReceipt;
  hierarchyReceipt: AndroidCapturedFrameReceipt;
  screenshotReceipt: AndroidCapturedFrameReceipt;
  modalPresent: false;
  confirmCtaPresent: false;
  commandExecution: {
    execution: 'completed';
    cleanup: 'cleaned';
    childExitCode: 0;
    childSignal: null;
  };
};

/** Bind the cancellation claim to the captured tree and completed command. */
export function requireAndroidCancelledConfirmationAbsent(input: {
  hierarchyObserved: boolean;
  hierarchyPath: string;
  screenshotPath: string;
  hierarchySourcePath: string;
  hierarchySourceReceipt: unknown;
  hierarchyReceipt: unknown;
  screenshotReceipt: unknown;
  modalPresent: boolean;
  confirmCtaPresent: boolean;
  commandExecution: unknown;
}): AndroidCancelledConfirmationEvidence {
  const command = input.commandExecution as Partial<{
    label: string;
    execution: string;
    cleanup: string;
    childExitCode: number | null;
    childSignal: string | null;
  }>;
  const requireFrameReceipt = (value: unknown, label: string): AndroidCapturedFrameReceipt => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`${label} frame receipt is missing`);
    const receipt = value as Partial<AndroidCapturedFrameReceipt>;
    if (
      typeof receipt.path !== 'string' ||
      receipt.path.length === 0 ||
      /[\\/\0]/.test(receipt.path) ||
      typeof receipt.sizeBytes !== 'number' ||
      !Number.isSafeInteger(receipt.sizeBytes) ||
      receipt.sizeBytes <= 0 ||
      typeof receipt.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
      !Number.isSafeInteger(receipt.ownerUid) ||
      (receipt.ownerUid as number) < 1 ||
      receipt.mode !== 0o600 ||
      !['hierarchy-source', 'hierarchy-json', 'png'].includes(receipt.contentKind as string) ||
      receipt.verification !== 'owned-stable-reader-v6'
    )
      throw new Error(`${label} frame receipt is malformed`);
    return {
      path: receipt.path,
      sizeBytes: receipt.sizeBytes,
      sha256: receipt.sha256,
      ownerUid: receipt.ownerUid as number,
      mode: receipt.mode,
      contentKind: receipt.contentKind as AndroidCapturedFrameReceipt['contentKind'],
      verification: 'owned-stable-reader-v6',
    };
  };
  const hierarchyReceipt = requireFrameReceipt(input.hierarchyReceipt, 'Android hierarchy');
  const screenshotReceipt = requireFrameReceipt(input.screenshotReceipt, 'Android screenshot');
  const hierarchySourceReceipt = requireFrameReceipt(
    input.hierarchySourceReceipt,
    'Android hierarchy source',
  );
  if (
    input.hierarchyObserved !== true ||
    typeof input.hierarchyPath !== 'string' ||
    input.hierarchyPath.length === 0 ||
    typeof input.screenshotPath !== 'string' ||
    input.screenshotPath.length === 0 ||
    typeof input.hierarchySourcePath !== 'string' ||
    input.hierarchySourcePath.length === 0 ||
    input.hierarchyPath !== 'auth-signout-cancelled-hierarchy.json' ||
    input.screenshotPath !== 'auth-signout-cancelled.png' ||
    input.hierarchySourcePath === input.hierarchyPath ||
    hierarchySourceReceipt.path !== input.hierarchySourcePath ||
    hierarchyReceipt.path !== input.hierarchyPath ||
    screenshotReceipt.path !== input.screenshotPath ||
    hierarchySourceReceipt.contentKind !== 'hierarchy-source' ||
    hierarchyReceipt.contentKind !== 'hierarchy-json' ||
    screenshotReceipt.contentKind !== 'png' ||
    new Set([hierarchySourceReceipt.path, hierarchyReceipt.path, screenshotReceipt.path]).size !==
      3 ||
    new Set([hierarchySourceReceipt.sha256, hierarchyReceipt.sha256, screenshotReceipt.sha256])
      .size !== 3 ||
    input.modalPresent ||
    input.confirmCtaPresent ||
    command.label !== 'auth-signout-cancelled-readiness' ||
    command.execution !== 'completed' ||
    command.cleanup !== 'cleaned' ||
    command.childExitCode !== 0 ||
    command.childSignal !== null
  )
    throw new Error('Android cancelled sign-out evidence is not bound to an actual clean command');
  return {
    status: 'verified',
    source: 'captured-hierarchy-after-owned-cancel',
    commandLabel: 'auth-signout-cancelled-readiness',
    hierarchyPath: input.hierarchyPath,
    screenshotPath: input.screenshotPath,
    hierarchySourcePath: input.hierarchySourcePath,
    modalPresent: false,
    confirmCtaPresent: false,
    commandExecution: {
      execution: 'completed',
      cleanup: 'cleaned',
      childExitCode: 0,
      childSignal: null,
    },
    hierarchyReceipt,
    hierarchySourceReceipt,
    screenshotReceipt,
  };
}

export function buildAndroidSessionActionPlans() {
  const tap = (id: string) => `- tapOn:\n    id: ${JSON.stringify(id)}\n`;
  const assertVisible = (id: string) => `- assertVisible:\n    id: ${JSON.stringify(id)}\n`;
  const assertNotVisible = (id: string) => `- assertNotVisible:\n    id: ${JSON.stringify(id)}\n`;
  const scroll = (id: string) =>
    `- scrollUntilVisible:\n    element:\n      id: ${JSON.stringify(id)}\n    direction: DOWN\n    timeout: 30000\n    centerElement: true\n`;
  return {
    account: tap('tabs.account'),
    openConfirm: scroll('settings.account.signOutCta') + tap('settings.account.signOutCta'),
    cancel:
      tap('settings.account.signOutCancelCta') +
      assertNotVisible('settings.account.signOutConfirm') +
      assertNotVisible('settings.account.signOutConfirmCta') +
      assertVisible('settings.account.screen'),
    reopenConfirm: scroll('settings.account.signOutCta') + tap('settings.account.signOutCta'),
    confirm:
      scroll('settings.account.signOutConfirmCta') + tap('settings.account.signOutConfirmCta'),
  } as const;
}

function toNativeAuthMetadataObservation(
  observation: AndroidSessionStorageObservation,
): NativeAuthMetadataObservation {
  if (observation.status === 'session-absent')
    return { status: 'session-absent', sessionPresent: false };
  if (observation.status !== 'session-present')
    throw new Error('Android retained session identity requires a present storage checkpoint');
  return {
    status: 'session-present',
    sessionPresent: true,
    profilePresent: observation.asyncStorage.profilePresent,
    expiryPresent: observation.asyncStorage.expiryPresent,
    plaintextAccessTokenPresent: observation.asyncStorage.plaintextAccessTokenPresent,
    plaintextRefreshTokenPresent: observation.asyncStorage.plaintextRefreshTokenPresent,
    ...(observation.asyncStorage.profileAuthUidHash
      ? { profileAuthUidHash: observation.asyncStorage.profileAuthUidHash }
      : {}),
  };
}

export function requireAndroidRetainedNativeSessionIdentity(input: {
  before: AndroidSessionStorageObservation;
  after: AndroidSessionStorageObservation;
  expectedAuthUidHash: string;
}) {
  requireRetainedNativeSessionIdentity(
    toNativeAuthMetadataObservation(input.before),
    toNativeAuthMetadataObservation(input.after),
    input.expectedAuthUidHash,
  );
  return {
    status: 'verified' as const,
    source: 'android-cache-coach-identity-retained' as const,
    profileAuthUidHash: input.expectedAuthUidHash,
  };
}

export function requireAndroidLocalSessionClear(input: {
  beforeRelaunch: AndroidSessionStorageObservation;
  afterRestore: AndroidSessionStorageObservation;
  afterSignOut: AndroidSessionStorageObservation;
  afterSignedOutRelaunch: AndroidSessionStorageObservation;
  cancelledSessionIdentity: { status: 'verified'; profileAuthUidHash: string };
  cancelledConfirmationEvidence: {
    status: 'verified';
    modalPresent: boolean;
    confirmCtaPresent: boolean;
  };
}) {
  if (
    input.beforeRelaunch.status !== 'session-present' ||
    input.afterRestore.status !== 'session-present' ||
    input.afterSignOut.status !== 'session-absent' ||
    input.afterSignedOutRelaunch.status !== 'session-absent' ||
    input.cancelledSessionIdentity.status !== 'verified' ||
    !/^[a-f0-9]{64}$/.test(input.cancelledSessionIdentity.profileAuthUidHash) ||
    input.cancelledConfirmationEvidence.status !== 'verified' ||
    input.cancelledConfirmationEvidence.modalPresent ||
    input.cancelledConfirmationEvidence.confirmCtaPresent
  )
    throw new Error('Android local session restoration or clearing boundary failed');
  return {
    status: 'verified' as const,
    serverRevocationQualified: false as const,
    source: 'local-native-bearer-session-clear' as const,
  };
}

export const androidSessionStorageLimits = {
  databaseBytes: MAX_DATABASE_BYTES,
  sidecarBytes: MAX_SIDECAR_BYTES,
  xmlBytes: MAX_XML_BYTES,
  queryBytes: MAX_QUERY_BYTES,
  listingBytes: MAX_LISTING_BYTES,
} as const;
