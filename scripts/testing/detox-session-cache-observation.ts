import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  androidSessionStorageLimits,
  type AndroidSessionStorageCheckpoint,
  type AndroidSessionStorageObservation,
  type AndroidQuerySourceReceipt,
  type AndroidStorageFileReceipt,
} from './native-android-session-adapter';

export const detoxSessionCacheCheckpointIds = [
  'afterLogin',
  'afterRestoration',
  'afterCancel',
  'afterSignout',
  'afterSignedOutRelaunch',
] as const;
export type DetoxSessionCacheCheckpoint = (typeof detoxSessionCacheCheckpointIds)[number];
export type DetoxSessionCacheStatus = 'session-present' | 'session-absent';

export type DetoxNativeSessionCacheObservation = Readonly<{
  checkpoint: DetoxSessionCacheCheckpoint;
  status: DetoxSessionCacheStatus;
  sessionPresent: boolean;
  profileAuthUidHash: string | null;
  source: Readonly<{
    kind: 'ios-rct-async-storage' | 'android-rkstorage-sqlite';
    path: string;
    bytes: number;
    sha256: string;
  }>;
  receipts: readonly Readonly<{
    path: string;
    bytes: number;
    sha256: string;
  }>[];
}>;

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const uidHashPattern = /^[a-f0-9]{64}$/;
const bundleId = 'com.edufelip.mychampions.dev';
const sessionKey = 'auth.server.session';

function requireCheckpoint(value: string): asserts value is DetoxSessionCacheCheckpoint {
  if (!detoxSessionCacheCheckpointIds.includes(value as DetoxSessionCacheCheckpoint))
    throw new Error('Detox session cache checkpoint is invalid');
}

function requireHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !uidHashPattern.test(value))
    throw new Error(`${label} is invalid`);
}

type Receipt = { path: string; bytes: number; sha256: string };

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} is incomplete`);
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new Error(`${label} has unexpected fields`);
}

function requireBoundedName(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    /[\\/\0]/.test(value) ||
    value === '.' ||
    value === '..'
  )
    throw new Error(`${label} is unsafe`);
}

function requireAndroidReceipt(
  value: unknown,
  label: string,
  kind: AndroidStorageFileReceipt['kind'],
  maxBytes: number,
  suffix: RegExp,
): AndroidStorageFileReceipt {
  const row = requireRecord(value, label);
  requireExactKeys(
    row,
    ['path', 'kind', 'sizeBytes', 'sha256', 'ownerUid', 'mode', 'verification'],
    label,
  );
  requireBoundedName(row.path, `${label} path`);
  if (
    row.kind !== kind ||
    !suffix.test(row.path) ||
    typeof row.sizeBytes !== 'number' ||
    !Number.isSafeInteger(row.sizeBytes) ||
    row.sizeBytes <= 0 ||
    row.sizeBytes > maxBytes ||
    typeof row.ownerUid !== 'number' ||
    !Number.isSafeInteger(row.ownerUid) ||
    row.ownerUid <= 0 ||
    row.mode !== 0o600 ||
    row.verification !== 'owned-stable-reader-v6'
  )
    throw new Error(`${label} is malformed or unbound`);
  requireHash(row.sha256, `${label} hash`);
  return {
    path: row.path,
    kind,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    ownerUid: row.ownerUid,
    mode: row.mode,
    verification: 'owned-stable-reader-v6',
  };
}

function requireAndroidStorageObservation(value: unknown): AndroidSessionStorageObservation {
  const row = requireRecord(value, 'Android session storage observation');
  requireExactKeys(
    row,
    ['status', 'reason', 'asyncStorage', 'secureStore', 'source'],
    'Android session storage observation',
  );
  if (
    row.status !== 'session-present' &&
    row.status !== 'session-absent' &&
    row.status !== 'storage-inconsistent'
  )
    throw new Error('Android session storage status is invalid');
  if (
    row.reason !== 'none' &&
    row.reason !== 'store-presence-mismatch' &&
    row.reason !== 'plaintext-token-in-async-storage'
  )
    throw new Error('Android session storage reason is invalid');
  const asyncStorage = requireRecord(row.asyncStorage, 'Android AsyncStorage observation');
  requireExactKeys(
    asyncStorage,
    [
      'database',
      'recordPresent',
      'profilePresent',
      'expiryPresent',
      'plaintextAccessTokenPresent',
      'plaintextRefreshTokenPresent',
      'recordBytes',
      'profileAuthUidHash',
    ],
    'Android AsyncStorage observation',
  );
  if (asyncStorage.database !== 'present' && asyncStorage.database !== 'absent')
    throw new Error('Android AsyncStorage database state is invalid');
  for (const key of [
    'recordPresent',
    'profilePresent',
    'expiryPresent',
    'plaintextAccessTokenPresent',
    'plaintextRefreshTokenPresent',
  ]) {
    if (typeof asyncStorage[key] !== 'boolean')
      throw new Error(`Android AsyncStorage ${key} is invalid`);
  }
  const recordPresent = asyncStorage.recordPresent as boolean;
  const profilePresent = asyncStorage.profilePresent as boolean;
  const expiryPresent = asyncStorage.expiryPresent as boolean;
  const plaintextAccessTokenPresent = asyncStorage.plaintextAccessTokenPresent as boolean;
  const plaintextRefreshTokenPresent = asyncStorage.plaintextRefreshTokenPresent as boolean;
  if (
    asyncStorage.recordBytes !== null &&
    (typeof asyncStorage.recordBytes !== 'number' ||
      !Number.isSafeInteger(asyncStorage.recordBytes) ||
      asyncStorage.recordBytes < 0)
  )
    throw new Error('Android AsyncStorage record size is invalid');
  if (
    asyncStorage.profileAuthUidHash !== null &&
    (typeof asyncStorage.profileAuthUidHash !== 'string' ||
      !uidHashPattern.test(asyncStorage.profileAuthUidHash))
  )
    throw new Error('Android AsyncStorage profile identity hash is invalid');
  const secureStore = requireRecord(row.secureStore, 'Android SecureStore observation');
  requireExactKeys(
    secureStore,
    ['preferences', 'sessionEntryPresent', 'keyFormat'],
    'Android SecureStore observation',
  );
  if (secureStore.preferences !== 'present' && secureStore.preferences !== 'absent')
    throw new Error('Android SecureStore preference state is invalid');
  if (typeof secureStore.sessionEntryPresent !== 'boolean')
    throw new Error('Android SecureStore session entry state is invalid');
  if (
    secureStore.keyFormat !== 'current' &&
    secureStore.keyFormat !== 'legacy' &&
    secureStore.keyFormat !== 'none'
  )
    throw new Error('Android SecureStore key format is invalid');
  if (
    secureStore.sessionEntryPresent !== (secureStore.keyFormat !== 'none') ||
    (secureStore.preferences === 'absent' && secureStore.keyFormat !== 'none')
  )
    throw new Error('Android SecureStore key format is not bound to its entry');
  const source = requireRecord(row.source, 'Android session storage source');
  requireExactKeys(
    source,
    ['asyncStorage', 'secureStore', 'sessionKeyHash'],
    'Android session storage source',
  );
  if (
    source.asyncStorage !== 'android-async-storage-rkstorage-sqlite' ||
    source.secureStore !== 'expo-secure-store-shared-preferences-presence-only'
  )
    throw new Error('Android session storage source is not the owned adapter');
  requireHash(source.sessionKeyHash, 'Android session storage key hash');
  if (row.status === 'session-present') {
    if (
      row.reason !== 'none' ||
      asyncStorage.database !== 'present' ||
      recordPresent !== true ||
      profilePresent !== true ||
      expiryPresent !== true ||
      plaintextAccessTokenPresent ||
      plaintextRefreshTokenPresent ||
      asyncStorage.profileAuthUidHash === null ||
      secureStore.preferences !== 'present' ||
      secureStore.sessionEntryPresent !== true ||
      secureStore.keyFormat === 'none'
    )
      throw new Error('Android present session observation is inconsistent');
  }
  if (row.status === 'session-absent') {
    if (
      row.reason !== 'none' ||
      recordPresent ||
      profilePresent ||
      expiryPresent ||
      plaintextAccessTokenPresent ||
      plaintextRefreshTokenPresent ||
      asyncStorage.profileAuthUidHash !== null ||
      secureStore.sessionEntryPresent
    )
      throw new Error('Android absent session observation is inconsistent');
  }
  if (
    (recordPresent && asyncStorage.recordBytes === null) ||
    (!recordPresent && asyncStorage.recordBytes !== null) ||
    (asyncStorage.database === 'absent' && recordPresent)
  )
    throw new Error('Android AsyncStorage record presence is inconsistent');
  return {
    status: row.status,
    reason: row.reason,
    asyncStorage: {
      database: asyncStorage.database,
      recordPresent,
      profilePresent,
      expiryPresent,
      plaintextAccessTokenPresent,
      plaintextRefreshTokenPresent,
      recordBytes: asyncStorage.recordBytes,
      profileAuthUidHash: asyncStorage.profileAuthUidHash,
    },
    secureStore: {
      preferences: secureStore.preferences,
      sessionEntryPresent: secureStore.sessionEntryPresent,
      keyFormat: secureStore.keyFormat,
    },
    source: {
      asyncStorage: source.asyncStorage,
      secureStore: source.secureStore,
      sessionKeyHash: source.sessionKeyHash,
    },
  };
}

/**
 * The Android adapter parses raw SQL/XML before it constructs this checkpoint and owns the
 * four-phase/domain validators.  The Detox cache lane receives one already-parsed checkpoint,
 * so it revalidates only that exported value shape here; it never reconstructs raw observations
 * from hashes or substitutes a missing adapter export.
 */
function requireAndroidStorageCheckpoint(value: unknown): AndroidSessionStorageCheckpoint {
  const row = requireRecord(value, 'Android session storage checkpoint');
  const observation = requireAndroidStorageObservation({
    status: row.status,
    reason: row.reason,
    asyncStorage: row.asyncStorage,
    secureStore: row.secureStore,
    source: row.source,
  });
  const coherence = requireRecord(row.coherence, 'Android database coherence');
  requireExactKeys(
    coherence,
    ['basePresent', 'sidecars', 'orphanSidecars', 'rollbackJournals'],
    'Android database coherence',
  );
  if (typeof coherence.basePresent !== 'boolean' || !Array.isArray(coherence.sidecars))
    throw new Error('Android database coherence is malformed');
  const sidecars = coherence.sidecars.filter(
    (value): value is 'RKStorage-wal' | 'RKStorage-shm' =>
      value === 'RKStorage-wal' || value === 'RKStorage-shm',
  );
  if (sidecars.length !== coherence.sidecars.length || new Set(sidecars).size !== sidecars.length)
    throw new Error('Android database coherence sidecars are malformed');
  const coherenceNames = (key: 'orphanSidecars' | 'rollbackJournals') => {
    const values = coherence[key];
    if (!Array.isArray(values)) throw new Error(`Android database coherence ${key} is malformed`);
    return (values as unknown[]).map((value) => {
      requireBoundedName(value, `Android database coherence ${key}`);
      return value;
    });
  };
  const orphanSidecars = coherenceNames('orphanSidecars');
  const rollbackJournals = coherenceNames('rollbackJournals');
  if (coherence.basePresent !== true)
    throw new Error('Android database coherence lacks the required base database');
  if (orphanSidecars.length > 0 || rollbackJournals.length > 0)
    throw new Error('Android database coherence contains an unowned sidecar or rollback journal');
  const privateArtifacts = requireRecord(row.privateArtifacts, 'Android private storage artifacts');
  requireExactKeys(
    privateArtifacts,
    [
      'database',
      'databaseSidecars',
      'query',
      'querySource',
      'secureStore',
      'databaseListing',
      'secureStoreListing',
    ],
    'Android private storage artifacts',
  );
  const database = requireAndroidReceipt(
    privateArtifacts.database,
    'Android database receipt',
    'database',
    androidSessionStorageLimits.databaseBytes,
    /async-storage\.db$/,
  );
  const sidecarValues = privateArtifacts.databaseSidecars;
  if (!Array.isArray(sidecarValues))
    throw new Error('Android database sidecar receipts are missing');
  const databaseSidecars = sidecarValues.map((value, index) =>
    requireAndroidReceipt(
      value,
      `Android database sidecar ${index}`,
      'sidecar',
      androidSessionStorageLimits.sidecarBytes,
      /async-storage\.db-(?:wal|shm)$/,
    ),
  );
  if (databaseSidecars.length !== sidecars.length)
    throw new Error('Android database sidecar receipts do not match coherence');
  const receiptSidecars = databaseSidecars
    .map((receipt) => receipt.path.replace(/^.*async-storage\.db/, 'RKStorage'))
    .sort();
  if (JSON.stringify(receiptSidecars) !== JSON.stringify([...sidecars].sort()))
    throw new Error('Android database sidecar paths do not match coherence');
  const query = requireAndroidReceipt(
    privateArtifacts.query,
    'Android redacted query receipt',
    'query',
    androidSessionStorageLimits.queryBytes,
    /async-storage-query\.json$/,
  );
  const querySourceValue = requireRecord(
    privateArtifacts.querySource,
    'Android query source receipt',
  );
  requireExactKeys(
    querySourceValue,
    [
      'path',
      'kind',
      'sizeBytes',
      'sha256',
      'ownerUid',
      'mode',
      'retained',
      'databaseSha256',
      'databaseSidecarSha256',
      'verification',
    ],
    'Android query source receipt',
  );
  requireBoundedName(querySourceValue.path, 'Android query source path');
  if (
    querySourceValue.kind !== 'query' ||
    !/async-storage-query\.raw\.private$/.test(querySourceValue.path) ||
    typeof querySourceValue.sizeBytes !== 'number' ||
    !Number.isSafeInteger(querySourceValue.sizeBytes) ||
    querySourceValue.sizeBytes <= 0 ||
    querySourceValue.sizeBytes > androidSessionStorageLimits.queryBytes ||
    typeof querySourceValue.ownerUid !== 'number' ||
    !Number.isSafeInteger(querySourceValue.ownerUid) ||
    querySourceValue.ownerUid <= 0 ||
    querySourceValue.mode !== 0o600 ||
    querySourceValue.retained !== false ||
    querySourceValue.verification !== 'owned-query-source-v6' ||
    querySourceValue.databaseSha256 !== database.sha256 ||
    !Array.isArray(querySourceValue.databaseSidecarSha256) ||
    querySourceValue.databaseSidecarSha256.some(
      (value) => typeof value !== 'string' || !uidHashPattern.test(value),
    ) ||
    JSON.stringify(querySourceValue.databaseSidecarSha256) !==
      JSON.stringify(databaseSidecars.map((receipt) => receipt.sha256)) ||
    querySourceValue.path === query.path ||
    querySourceValue.sha256 === query.sha256
  )
    throw new Error('Android query source receipt is malformed or unbound');
  requireHash(querySourceValue.sha256, 'Android query source hash');
  const secureStore =
    privateArtifacts.secureStore === null
      ? null
      : requireAndroidReceipt(
          privateArtifacts.secureStore,
          'Android SecureStore receipt',
          'xml',
          androidSessionStorageLimits.xmlBytes,
          /secure-store\.xml$/,
        );
  const databaseListing = requireAndroidReceipt(
    privateArtifacts.databaseListing,
    'Android database listing receipt',
    'listing',
    androidSessionStorageLimits.listingBytes,
    /(?:async-directory(?:-after)?|secure-presence)\.stdout$/,
  );
  const secureStoreListing = requireAndroidReceipt(
    privateArtifacts.secureStoreListing,
    'Android SecureStore listing receipt',
    'listing',
    androidSessionStorageLimits.listingBytes,
    /(?:async-directory(?:-after)?|secure-presence)\.stdout$/,
  );
  if (
    (observation.secureStore.preferences === 'present') !== Boolean(secureStore) ||
    coherence.basePresent !== (observation.asyncStorage.database === 'present')
  )
    throw new Error('Android storage checkpoint presence is not bound to receipts');
  const allPaths = [
    database.path,
    ...databaseSidecars.map((receipt) => receipt.path),
    query.path,
    querySourceValue.path,
    ...(secureStore ? [secureStore.path] : []),
    databaseListing.path,
    secureStoreListing.path,
  ];
  if (new Set(allPaths).size !== allPaths.length)
    throw new Error('Android storage checkpoint receipts contain duplicate paths');
  return {
    ...observation,
    coherence: {
      basePresent: coherence.basePresent,
      sidecars,
      orphanSidecars,
      rollbackJournals,
    },
    privateArtifacts: {
      database,
      databaseSidecars,
      query,
      querySource: querySourceValue as AndroidQuerySourceReceipt,
      secureStore,
      databaseListing,
      secureStoreListing,
    },
  };
}

function requireOwnedReceipt(value: unknown, label: string): Receipt {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} is incomplete`);
  const row = value as Record<string, unknown>;
  if (
    typeof row.path !== 'string' ||
    row.path.length === 0 ||
    path.isAbsolute(row.path) ||
    row.path.includes('..') ||
    !Number.isSafeInteger(row.bytes) ||
    (row.bytes as number) < 0
  )
    throw new Error(`${label} path/bytes are invalid`);
  requireHash(row.sha256, `${label} hash`);
  return {
    path: row.path,
    bytes: row.bytes as number,
    sha256: row.sha256,
  };
}

export function requireDetoxNativeSessionCache(
  value: unknown,
  expected: {
    checkpoint: DetoxSessionCacheCheckpoint;
    status: DetoxSessionCacheStatus;
    actorAuthUid?: string;
    sourceKind: DetoxNativeSessionCacheObservation['source']['kind'];
  },
): DetoxNativeSessionCacheObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Detox native session cache observation is incomplete');
  const row = value as Record<string, unknown>;
  requireCheckpoint(String(row.checkpoint));
  if (
    row.checkpoint !== expected.checkpoint ||
    row.status !== expected.status ||
    row.sessionPresent !== (expected.status === 'session-present')
  )
    throw new Error('Detox native session cache checkpoint/status binding changed');
  if (row.source === undefined || typeof row.source !== 'object' || Array.isArray(row.source))
    throw new Error('Detox native session cache source receipt is missing');
  const source = requireOwnedReceipt(row.source, 'Detox native session cache source');
  const sourceKind = (row.source as Record<string, unknown>).kind;
  if (sourceKind !== expected.sourceKind)
    throw new Error('Detox native session cache source kind changed');
  const profileAuthUidHash = row.profileAuthUidHash;
  if (expected.status === 'session-present') {
    requireHash(profileAuthUidHash, 'Detox native session cache profile UID hash');
    if (!expected.actorAuthUid || hash(expected.actorAuthUid) !== profileAuthUidHash)
      throw new Error('Detox native session cache profile UID is not bound to the actor');
  } else if (profileAuthUidHash !== null) {
    throw new Error('Signed-out native session cache retained a profile UID hash');
  }
  if (!Array.isArray(row.receipts) || row.receipts.length === 0)
    throw new Error('Detox native session cache receipts are missing');
  const receipts = row.receipts.map((receipt, index) =>
    requireOwnedReceipt(receipt, `Detox native session cache receipt ${index}`),
  );
  if (!receipts.some((receipt) => receipt.path === source.path && receipt.sha256 === source.sha256))
    throw new Error('Detox native session cache source is not bound to its receipt set');
  return Object.freeze({
    checkpoint: expected.checkpoint,
    status: expected.status,
    sessionPresent: expected.status === 'session-present',
    profileAuthUidHash: profileAuthUidHash,
    source: Object.freeze({
      ...source,
      kind: sourceKind as DetoxNativeSessionCacheObservation['source']['kind'],
    }),
    receipts: Object.freeze(receipts),
  });
}

async function stableOwnedFile(file: string, root: string) {
  const resolvedRoot = await realpath(root);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(resolvedRoot + path.sep) || (await realpath(resolved)) !== resolved)
    throw new Error('Detox native cache file escaped its owned container');
  const before = await lstat(resolved);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.uid !== process.getuid?.() ||
    (before.mode & 0o777) !== 0o600
  )
    throw new Error('Detox native cache file is not an owned private file');
  const bytes = await readFile(resolved);
  const after = await lstat(resolved);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size)
    throw new Error('Detox native cache file changed during read');
  return {
    bytes,
    receipt: {
      path: path.relative(resolvedRoot, resolved),
      bytes: bytes.byteLength,
      sha256: hash(bytes),
    },
  };
}

/** Reads the actual iOS AsyncStorage record and hashes only profile.authUid. */
export async function observeIosSessionCache(options: {
  dataRoot: string;
  checkpoint: DetoxSessionCacheCheckpoint;
}): Promise<DetoxNativeSessionCacheObservation> {
  requireCheckpoint(options.checkpoint);
  const inputRootMetadata = await lstat(options.dataRoot);
  if (!inputRootMetadata.isDirectory() || inputRootMetadata.isSymbolicLink())
    throw new Error('Detox iOS cache container path is not a direct private directory');
  const root = await realpath(options.dataRoot);
  const rootMetadata = await lstat(root);
  if (
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    rootMetadata.uid !== process.getuid?.() ||
    (rootMetadata.mode & 0o777) !== 0o700
  )
    throw new Error('Detox iOS cache container is not an owned private directory');
  const storage = path.join(
    root,
    'Library/Application Support',
    bundleId,
    'RCTAsyncLocalStorage_V1',
  );
  const manifestPath = path.join(storage, 'manifest.json');
  const manifestFile = await stableOwnedFile(manifestPath, root);
  const manifest = JSON.parse(manifestFile.bytes.toString('utf8')) as Record<string, unknown>;
  const receipts = [manifestFile.receipt];
  if (!Object.hasOwn(manifest, sessionKey))
    return requireDetoxNativeSessionCache(
      {
        checkpoint: options.checkpoint,
        status: 'session-absent',
        sessionPresent: false,
        profileAuthUidHash: null,
        source: { ...manifestFile.receipt, kind: 'ios-rct-async-storage' },
        receipts,
      },
      {
        checkpoint: options.checkpoint,
        status: 'session-absent',
        sourceKind: 'ios-rct-async-storage',
      },
    );
  const value = manifest[sessionKey];
  const recordPath = value === null ? path.join(storage, hashMd5(sessionKey)) : null;
  const recordFile = recordPath ? await stableOwnedFile(recordPath, root) : null;
  if (recordFile) receipts.push(recordFile.receipt);
  const raw = recordFile ? recordFile.bytes.toString('utf8') : value;
  if (typeof raw !== 'string') throw new Error('Detox iOS session record is malformed');
  const record = JSON.parse(raw) as Record<string, unknown>;
  const profile = record.profile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile))
    throw new Error('Detox iOS session profile is missing');
  const authUid = (profile as Record<string, unknown>).authUid;
  if (typeof authUid !== 'string' || authUid.length === 0)
    throw new Error('Detox iOS session profile authUid is missing');
  const source = recordFile?.receipt ?? manifestFile.receipt;
  return requireDetoxNativeSessionCache(
    {
      checkpoint: options.checkpoint,
      status: 'session-present',
      sessionPresent: true,
      profileAuthUidHash: hash(authUid),
      source: { ...source, kind: 'ios-rct-async-storage' },
      receipts,
    },
    {
      checkpoint: options.checkpoint,
      status: 'session-present',
      sourceKind: 'ios-rct-async-storage',
    },
  );
}

function hashMd5(value: string) {
  return createHash('md5').update(value).digest('hex');
}

/** Projects the actual Android capture engine checkpoint without retaining raw UID/query bytes. */
export function projectAndroidSessionCacheCheckpoint(
  checkpoint: AndroidSessionStorageCheckpoint,
  expectedCheckpoint: DetoxSessionCacheCheckpoint,
  actorAuthUid?: string,
): DetoxNativeSessionCacheObservation {
  const validated = requireAndroidStorageCheckpoint(checkpoint);
  const observation: AndroidSessionStorageObservation = validated;
  if (observation.status === 'storage-inconsistent')
    throw new Error('Android session cache storage is inconsistent');
  const query = validated.privateArtifacts.query;
  const receipts = [
    validated.privateArtifacts.database,
    ...validated.privateArtifacts.databaseSidecars,
    validated.privateArtifacts.query,
    validated.privateArtifacts.databaseListing,
    validated.privateArtifacts.secureStoreListing,
    ...(validated.privateArtifacts.secureStore ? [validated.privateArtifacts.secureStore] : []),
  ].map((receipt) => ({ path: receipt.path, bytes: receipt.sizeBytes, sha256: receipt.sha256 }));
  return requireDetoxNativeSessionCache(
    {
      checkpoint: expectedCheckpoint,
      status: observation.status,
      sessionPresent: observation.status === 'session-present',
      profileAuthUidHash: observation.asyncStorage.profileAuthUidHash,
      source: {
        kind: 'android-rkstorage-sqlite',
        path: query.path,
        bytes: query.sizeBytes,
        sha256: query.sha256,
      },
      receipts,
    },
    {
      checkpoint: expectedCheckpoint,
      status: observation.status,
      actorAuthUid: observation.status === 'session-present' ? actorAuthUid : undefined,
      sourceKind: 'android-rkstorage-sqlite',
    },
  );
}

export function requireAfterCancelCacheIdentity(input: {
  afterRestoration: DetoxNativeSessionCacheObservation;
  afterCancel: DetoxNativeSessionCacheObservation;
  actorAuthUid: string;
}) {
  const expected = hash(input.actorAuthUid);
  if (
    input.afterRestoration.checkpoint !== 'afterRestoration' ||
    input.afterCancel.checkpoint !== 'afterCancel' ||
    input.afterRestoration.status !== 'session-present' ||
    input.afterCancel.status !== 'session-present' ||
    input.afterRestoration.profileAuthUidHash !== expected ||
    input.afterCancel.profileAuthUidHash !== expected
  )
    throw new Error('Cancel boundary did not retain the verified native session identity');
  return {
    profileAuthUidHash: expected,
    status: 'session-present' as const,
    shape: { sessionPresent: true, profileAuthUidHash: expected },
  };
}
