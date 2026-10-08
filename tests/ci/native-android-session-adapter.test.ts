import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  androidSessionAssertionSequence,
  buildAndroidSessionTerminalQualification,
  androidNativeCaptureExitCode,
  requireAndroidSessionCharter,
} from '../../scripts/testing/android-session-charter';
import {
  androidSessionStorageLimits,
  buildAndroidSessionActionPlans,
  buildAndroidSessionStorageProbePlan,
  parseAndroidSessionStorageObservation,
  redactAndroidSqliteQuery,
  parseAndroidStorageListing,
  requireAndroidPersistedLoginCheckpoint,
  requireAndroidPersistedProfileIdentityHash,
  requireAndroidOwnedApiLifetimeBinding,
  requireAndroidSessionCheckpointSet,
  requireAndroidSessionTransportSlice,
  requireAndroidSessionDomainBinding,
  requireAndroidStorageReceiptSet,
  requireAndroidCancelledConfirmationAbsent,
  requireAndroidRetainedNativeSessionIdentity,
  requireCoherentAndroidDatabaseListing,
  requireSameAndroidDatabaseListing,
  requireAndroidLocalSessionClear,
  readOwnedAndroidStableFile,
  writeOwnedAndroidPrivateFile,
} from '../../scripts/testing/native-android-session-adapter';
import {
  OwnedSessionAcquisitionError,
  readOwnedRuntimeDocumentWithReceipt,
  startOwnedSession,
} from '../../scripts/testing/owned-session';

const keyHash = 'a'.repeat(64);
const signInPathHash = createHash('sha256').update('/auth/email/sign-in').digest('hex');
const presentQuery = JSON.stringify([
  {
    jsonValid: 1,
    profileType: 'object',
    profileAuthUid: 'coach-1',
    expiryType: 'text',
    accessTokenType: null,
    refreshTokenType: null,
    recordBytes: 192,
  },
]);
const wrongProfileQuery = presentQuery.replace('coach-1', 'student-1');
const presentXml =
  '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n' +
  '<map><string name="key_v1-secure.auth.server.session">encrypted-value</string></map>';
const legacyXml = '<map><string name="secure.auth.server.session">legacy-value</string></map>';
const guessedAliasXml =
  '<map><string name="key_v1-auth.server.session">guessed-value</string></map>';
const absentXml = '<map><boolean name="unrelated" value="true" /></map>';

const fileReceipt = (
  filePath: string,
  kind: 'database' | 'sidecar' | 'query' | 'xml' | 'listing' | 'frame',
  sizeBytes: number,
  sha256: string,
) => ({
  path: filePath,
  kind,
  sizeBytes,
  sha256,
  ownerUid: 501,
  mode: 0o600,
  verification: 'owned-stable-reader-v6' as const,
});

const present = () =>
  parseAndroidSessionStorageObservation({
    database: 'present',
    sqliteJson: presentQuery,
    securePreferences: 'present',
    secureStoreXml: presentXml,
    sessionKeyHash: keyHash,
  });
const absent = () =>
  parseAndroidSessionStorageObservation({
    database: 'present',
    sqliteJson: '[]',
    securePreferences: 'present',
    secureStoreXml: absentXml,
    sessionKeyHash: keyHash,
  });

const checkpoint = (observation = present(), includeSidecars = false) => ({
  ...observation,
  coherence: {
    basePresent: true,
    sidecars: includeSidecars ? (['RKStorage-wal'] as const) : [],
    orphanSidecars: [],
    rollbackJournals: [],
  },
  privateArtifacts: {
    database: fileReceipt('auth-before-relaunch-async-storage.db', 'database', 128, 'b'.repeat(64)),
    databaseSidecars: includeSidecars
      ? [fileReceipt('auth-before-relaunch-async-storage.db-wal', 'sidecar', 16, '0'.repeat(64))]
      : [],
    query: fileReceipt(
      'auth-before-relaunch-async-storage-query.json',
      'query',
      32,
      'c'.repeat(64),
    ),
    querySource: {
      path: 'auth-before-relaunch-async-storage-query.raw.private',
      kind: 'query' as const,
      sizeBytes: 48,
      sha256: 'a'.repeat(64),
      ownerUid: 501,
      mode: 0o600,
      retained: false as const,
      databaseSha256: 'b'.repeat(64),
      databaseSidecarSha256: includeSidecars ? ['0'.repeat(64)] : [],
      verification: 'owned-query-source-v6' as const,
    },
    secureStore:
      observation.secureStore.preferences === 'present'
        ? fileReceipt('auth-before-relaunch-secure-store.xml', 'xml', 64, 'f'.repeat(64))
        : null,
    databaseListing: fileReceipt(
      'auth-before-relaunch-async-directory.stdout',
      'listing',
      10,
      'd'.repeat(64),
    ),
    secureStoreListing: fileReceipt(
      'auth-before-relaunch-secure-presence.stdout',
      'listing',
      10,
      'e'.repeat(64),
    ),
  },
});

const domainSnapshot = () => ({
  schemaVersion: 1 as const,
  runId: 'a'.repeat(24),
  scope: 'native-entry-android',
  readOnly: true as const,
  trainingPlans: [
    {
      id: 'plan-1',
      studentAuthUid: 'student-1',
      ownerProfessionalUid: 'coach-1',
      sourceKind: 'assigned' as const,
      name: 'Plan',
      isArchived: false,
      isDraft: false,
      lifecycleConnectionId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sessions: [],
    },
  ],
  connections: [
    {
      id: 'connection-1',
      professionalAuthUid: 'coach-1',
      studentAuthUid: 'student-1',
      status: 'active' as const,
      specialty: 'fitness_coach' as const,
      canceledReason: null,
      sourceInviteCodeId: null,
      sourceInviteCodeValue: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      endedAt: null,
    },
  ],
});

const identity = {
  actor: 'coach' as const,
  actorAuthUid: 'coach-1',
  authRequestId: 7,
  afterRequestId: 9,
  apiPid: 1234,
  targetOrigin: 'http://127.0.0.1:40123',
  fixtureAuthUidAllowlistHash: 'f'.repeat(64),
};
const backendProvenance = {
  backendAttemptId: `${'a'.repeat(24)}:first`,
  apiOrigin: identity.targetOrigin,
  apiProcess: {
    pid: identity.apiPid,
    started: '2026-01-01T00:00:00.000Z',
    script: '/server/scripts/testing/serve.ts',
  },
};
const cancelledHierarchyReceipt = {
  path: 'auth-signout-cancelled-hierarchy.json',
  sizeBytes: 512,
  sha256: '1'.repeat(64),
  ownerUid: 501,
  mode: 0o600,
  contentKind: 'hierarchy-json' as const,
  verification: 'owned-stable-reader-v6' as const,
};
const cancelledScreenshotReceipt = {
  path: 'auth-signout-cancelled.png',
  sizeBytes: 1024,
  sha256: '2'.repeat(64),
  ownerUid: 501,
  mode: 0o600,
  contentKind: 'png' as const,
  verification: 'owned-stable-reader-v6' as const,
};
const cancelledHierarchySourceReceipt = {
  path: 'auth-signout-cancelled-hierarchy.xml',
  sizeBytes: 640,
  sha256: '3'.repeat(64),
  ownerUid: 501,
  mode: 0o600,
  contentKind: 'hierarchy-source' as const,
  verification: 'owned-stable-reader-v6' as const,
};

const apiLifetime = {
  runId: 'a'.repeat(24),
  proxyRunId: 'a'.repeat(24),
  proxyOrigin: 'http://127.0.0.1:40123',
  apiOrigin: 'http://127.0.0.1:40123',
  apiPid: 1234,
  apiStarted: '2026-01-01T00:00:00.000Z',
  apiScript: '/server/scripts/testing/serve.ts',
  backendAttemptId: `${'a'.repeat(24)}:first`,
  manifestSha256: '9'.repeat(64),
};

const observation = (
  requestId: number,
  method: string,
  pathHash: string,
  status = method === 'GET' ? 200 : 201,
  requestCredentialPresent?: boolean,
) => ({
  requestId,
  method,
  pathHash,
  requestOrigin: null,
  requestProfile: 'native' as const,
  targetOrigin: identity.targetOrigin,
  status,
  outcome: 'forwarded' as const,
  faultAttemptId: null,
  requestCredentialPresent,
  elapsedMs: 1,
});

void test('Android session probe binds actual AsyncStorage and SecureStore keys', () => {
  const plan = buildAndroidSessionStorageProbePlan();
  assert.equal(plan.appId, 'com.edufelip.mychampions.dev');
  assert.equal(plan.sessionKey, 'auth.server.session');
  assert.equal(plan.secureSessionKey, 'secure.auth.server.session');
  assert.equal(plan.currentSecureStoreKey, 'key_v1-secure.auth.server.session');
  assert.equal(plan.legacySecureStoreKey, 'secure.auth.server.session');
  assert.deepEqual(plan.databaseRelativePaths, [
    'databases/RKStorage',
    'databases/RKStorage-wal',
    'databases/RKStorage-shm',
  ]);
  assert.deepEqual(plan.databaseDirectoryArgv.slice(-2), ['-1', 'databases']);
  assert.deepEqual(plan.secureStorePresenceArgv.slice(-2), ['-1', 'shared_prefs']);
  assert.equal(plan.databaseCaptureArgv('databases/RKStorage').at(-1), 'databases/RKStorage');
  assert.equal(plan.secureStoreCaptureArgv.at(-1), 'shared_prefs/SecureStore.xml');
  assert.match(plan.sqliteQuery, /WHERE key = 'auth\.server\.session'/);
  assert.match(plan.sqliteQuery, /json_extract\(value, '\$\.profile\.authUid'\)/);
  assert.throws(() => plan.databaseCaptureArgv('databases/foreign.db'), /not declared/);
  assert.throws(() => buildAndroidSessionStorageProbePlan('com.foreign.app'), /dev app/);
});

void test('Android parser reports shape only for current and legacy encrypted-store keys', () => {
  const observation = present();
  assert.equal(observation.status, 'session-present');
  assert.equal(observation.asyncStorage.profilePresent, true);
  assert.equal(
    observation.asyncStorage.profileAuthUidHash,
    createHash('sha256').update('coach-1').digest('hex'),
  );
  assert.equal(observation.asyncStorage.plaintextAccessTokenPresent, false);
  assert.equal(observation.secureStore.keyFormat, 'current');
  assert.equal(JSON.stringify(observation).includes('encrypted-value'), false);
  const legacy = parseAndroidSessionStorageObservation({
    database: 'present',
    sqliteJson: presentQuery,
    securePreferences: 'present',
    secureStoreXml: legacyXml,
    sessionKeyHash: keyHash,
  });
  assert.equal(legacy.secureStore.keyFormat, 'legacy');
  const guessedAlias = parseAndroidSessionStorageObservation({
    database: 'present',
    sqliteJson: presentQuery,
    securePreferences: 'present',
    secureStoreXml: guessedAliasXml,
    sessionKeyHash: keyHash,
  });
  assert.equal(guessedAlias.status, 'storage-inconsistent');
  assert.equal(guessedAlias.secureStore.keyFormat, 'none');
  const guessedAliasOnlyWithoutAsyncRow = parseAndroidSessionStorageObservation({
    database: 'present',
    sqliteJson: '[]',
    securePreferences: 'present',
    secureStoreXml: guessedAliasXml,
    sessionKeyHash: keyHash,
  });
  assert.equal(guessedAliasOnlyWithoutAsyncRow.status, 'storage-inconsistent');
  assert.equal(guessedAliasOnlyWithoutAsyncRow.reason, 'store-presence-mismatch');
});

void test('Android profile projection is hashed before the retained query artifact', () => {
  const redacted = redactAndroidSqliteQuery(presentQuery);
  assert.equal(redacted.profileAuthUidHash, createHash('sha256').update('coach-1').digest('hex'));
  assert.equal(redacted.redactedJson.includes('coach-1'), false);
  const redactedRow = (JSON.parse(redacted.redactedJson) as Record<string, unknown>[])[0];
  assert.equal('profileAuthUid' in redactedRow, false);
  assert.match(redacted.redactedJson, /profileAuthUidHash/);
  assert.throws(
    () => redactAndroidSqliteQuery(presentQuery.replace('profileAuthUid', 'profileUid')),
    /unexpected projection/,
  );
});

void test('Android storage parser rejects raw rows, malformed values and duplicate keys', () => {
  assert.throws(
    () =>
      parseAndroidSessionStorageObservation({
        database: 'present',
        sqliteJson: JSON.stringify([{ key: 'auth.server.session', value: 'secret' }]),
        securePreferences: 'present',
        secureStoreXml: presentXml,
        sessionKeyHash: keyHash,
      }),
    /unexpected projection/,
  );
  assert.throws(
    () =>
      parseAndroidSessionStorageObservation({
        database: 'present',
        sqliteJson: JSON.stringify([
          {
            jsonValid: 0,
            profileType: null,
            profileAuthUid: 42,
            expiryType: null,
            accessTokenType: null,
            refreshTokenType: null,
            recordBytes: 4,
          },
        ]),
        securePreferences: 'present',
        secureStoreXml: presentXml,
        sessionKeyHash: keyHash,
      }),
    /malformed/,
  );
  assert.throws(
    () =>
      parseAndroidSessionStorageObservation({
        database: 'present',
        sqliteJson: presentQuery,
        securePreferences: 'present',
        secureStoreXml:
          '<map><string name="key_v1-secure.auth.server.session">a</string>' +
          '<string name="key_v1-secure.auth.server.session">b</string></map>',
        sessionKeyHash: keyHash,
      }),
    /ambiguous/,
  );
});

void test('Android database listing requires a coherent base and sidecar set', () => {
  const names = parseAndroidStorageListing('RKStorage\nRKStorage-wal\nRKStorage-shm\n', 'db');
  assert.deepEqual(requireCoherentAndroidDatabaseListing(names), {
    basePresent: true,
    sidecars: ['RKStorage-wal', 'RKStorage-shm'],
    orphanSidecars: [],
    rollbackJournals: [],
  });
  assert.throws(() => requireCoherentAndroidDatabaseListing(['RKStorage-wal']), /orphan WAL\/SHM/);
  assert.throws(
    () => requireCoherentAndroidDatabaseListing(['RKStorage', 'RKStorage-journal']),
    /rollback journal/,
  );
  assert.throws(() => parseAndroidStorageListing('RKStorage\nRKStorage\n', 'db'), /duplicate/);
  assert.throws(() => parseAndroidStorageListing('RKStorage\n../escaped\n', 'db'), /unsafe name/);
  assert.throws(
    () => requireSameAndroidDatabaseListing(['RKStorage', 'RKStorage-wal'], ['RKStorage']),
    /changed during capture/,
  );
  assert.doesNotThrow(() => requireSameAndroidDatabaseListing(names, [...names]));
});

void test('Android stable reader returns byte receipts and fail-closes on ownership, size and abort', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'android-session-v2-')));
  try {
    await chmod(root, 0o700);
    const source = path.join(root, 'query.json');
    await writeFile(source, '{}', { mode: 0o600 });
    const read = await readOwnedAndroidStableFile({
      artifactRoot: root,
      filePath: source,
      kind: 'query',
      maxBytes: androidSessionStorageLimits.queryBytes,
    });
    assert.equal(read.bytes.toString(), '{}');
    assert.equal(read.receipt.sizeBytes, 2);
    assert.match(read.receipt.sha256, /^[a-f0-9]{64}$/);
    await assert.rejects(
      readOwnedAndroidStableFile({
        artifactRoot: root,
        filePath: source,
        kind: 'query',
        maxBytes: 1,
      }),
      /exceeds|bounded/,
    );
    const written = await writeOwnedAndroidPrivateFile({
      artifactRoot: root,
      relativePath: 'listing.txt',
      bytes: 'RKStorage\n',
      kind: 'listing',
    });
    assert.equal(written.sizeBytes, 10);
    const redactedQuery = redactAndroidSqliteQuery(presentQuery);
    const queryReceipt = await writeOwnedAndroidPrivateFile({
      artifactRoot: root,
      relativePath: 'session-query.json',
      bytes: redactedQuery.redactedJson,
      kind: 'query',
    });
    const queryRead = await readOwnedAndroidStableFile({
      artifactRoot: root,
      filePath: path.join(root, 'session-query.json'),
      kind: 'query',
      maxBytes: androidSessionStorageLimits.queryBytes,
    });
    assert.equal(queryRead.receipt.sha256, queryReceipt.sha256);
    assert.equal(queryRead.bytes.toString('utf8').includes('coach-1'), false);
    await chmod(source, 0o644);
    await assert.rejects(
      readOwnedAndroidStableFile({
        artifactRoot: root,
        filePath: source,
        kind: 'query',
        maxBytes: androidSessionStorageLimits.queryBytes,
      }),
      /mode is not private/,
    );
    await chmod(source, 0o600);
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await assert.rejects(
      readOwnedAndroidStableFile({
        artifactRoot: root,
        filePath: source,
        kind: 'query',
        maxBytes: androidSessionStorageLimits.queryBytes,
        signal: controller.signal,
      }),
      /cancelled/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Owned runtime documents reject traversal outside the artifact root', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'android-owned-root-')));
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.json`);
  await chmod(root, 0o700);
  await writeFile(
    outside,
    JSON.stringify({
      schemaVersion: 1,
      event: 'acquired',
      runId: 'a'.repeat(24),
      manifestPath: outside,
    }),
    { mode: 0o600 },
  );
  try {
    await assert.rejects(
      readOwnedRuntimeDocumentWithReceipt(
        outside,
        root,
        `../${path.basename(outside)}`,
        'session-event-v1',
      ),
      /escapes the artifact root/,
    );
  } finally {
    await rm(outside, { force: true });
    await rm(root, { recursive: true, force: true });
  }
});

void test('Android persisted-login checkpoint binds coach identity, API process and storage proof', () => {
  const checkpoint = requireAndroidPersistedLoginCheckpoint({
    beforeRelaunch: present(),
    signInBoundary: { authRequestId: 7, afterRequestId: 9 },
    actorIdentity: identity,
    apiIdentity: {
      apiPid: identity.apiPid,
      targetOrigin: identity.targetOrigin,
    },
    expectedRunId: 'a'.repeat(24),
    backendProvenance,
  });
  assert.deepEqual(checkpoint, {
    status: 'verified',
    actor: 'coach',
    actorAuthUidHash: createHash('sha256').update('coach-1').digest('hex'),
    authRequestId: 7,
    afterRequestId: 9,
    authPathHash: signInPathHash,
    apiPid: 1234,
    targetOrigin: identity.targetOrigin,
    fixtureAuthUidAllowlistHash: 'f'.repeat(64),
    backendAttemptId: `${'a'.repeat(24)}:first`,
    backendApiOrigin: identity.targetOrigin,
    backendApiProcess: backendProvenance.apiProcess,
    persistedStorageCheckpoint: 'auth-before-relaunch',
    persistedProfileAuthUidHash: createHash('sha256').update('coach-1').digest('hex'),
    sessionStatus: 'session-present',
  });
  assert.equal(
    requireAndroidPersistedProfileIdentityHash({
      observation: present(),
      expectedAuthUid: 'coach-1',
    }),
    createHash('sha256').update('coach-1').digest('hex'),
  );
  assert.throws(
    () =>
      requireAndroidPersistedProfileIdentityHash({
        observation: present(),
        expectedAuthUid: 'wrong-actor',
      }),
    /does not match/,
  );
  const wrongCacheProfile = parseAndroidSessionStorageObservation({
    database: 'present',
    sqliteJson: wrongProfileQuery,
    securePreferences: 'present',
    secureStoreXml: presentXml,
    sessionKeyHash: keyHash,
  });
  assert.throws(
    () =>
      requireAndroidPersistedProfileIdentityHash({
        observation: wrongCacheProfile,
        expectedAuthUid: 'coach-1',
      }),
    /does not match/,
  );
  const malformedProfile = present();
  malformedProfile.asyncStorage.profileAuthUidHash = null;
  assert.throws(
    () =>
      requireAndroidPersistedProfileIdentityHash({
        observation: malformedProfile,
        expectedAuthUid: 'coach-1',
      }),
    /missing or malformed/,
  );
  assert.throws(
    () =>
      requireAndroidPersistedLoginCheckpoint({
        beforeRelaunch: present(),
        signInBoundary: { authRequestId: 7, afterRequestId: 9 },
        actorIdentity: { ...identity, apiPid: 4321 },
        apiIdentity: {
          apiPid: identity.apiPid,
          targetOrigin: identity.targetOrigin,
        },
        expectedRunId: 'a'.repeat(24),
        backendProvenance,
      }),
    /not bound/,
  );
  assert.throws(
    () =>
      requireAndroidPersistedLoginCheckpoint({
        beforeRelaunch: present(),
        signInBoundary: { authRequestId: 7, afterRequestId: 9 },
        actorIdentity: identity,
        apiIdentity: {
          apiPid: identity.apiPid,
          targetOrigin: identity.targetOrigin,
        },
        expectedRunId: 'b'.repeat(24),
        backendProvenance,
      }),
    /not bound/,
  );
  assert.throws(
    () =>
      requireAndroidPersistedLoginCheckpoint({
        beforeRelaunch: present(),
        signInBoundary: { authRequestId: 7, afterRequestId: 9 },
        actorIdentity: identity,
        apiIdentity: {
          apiPid: identity.apiPid,
          targetOrigin: identity.targetOrigin,
        },
        expectedRunId: 'a'.repeat(24),
        backendProvenance: {
          ...backendProvenance,
          backendAttemptId: `${'a'.repeat(24)}:second`,
        },
      }),
    /not bound/,
  );
  assert.throws(
    () =>
      requireAndroidPersistedLoginCheckpoint({
        beforeRelaunch: present(),
        signInBoundary: { authRequestId: 7, afterRequestId: 9 },
        actorIdentity: identity,
        apiIdentity: {
          apiPid: identity.apiPid,
          targetOrigin: identity.targetOrigin,
        },
        expectedRunId: 'a'.repeat(24),
        backendProvenance: {
          ...backendProvenance,
          apiProcess: { ...backendProvenance.apiProcess, started: '' },
        },
      }),
    /not bound/,
  );
  assert.throws(
    () =>
      requireAndroidPersistedLoginCheckpoint({
        beforeRelaunch: absent(),
        signInBoundary: { authRequestId: 7, afterRequestId: 9 },
        actorIdentity: identity,
        apiIdentity: {
          apiPid: identity.apiPid,
          targetOrigin: identity.targetOrigin,
        },
        expectedRunId: 'a'.repeat(24),
        backendProvenance,
      }),
    /restored session/,
  );
});

void test('Android terminal qualification blocks failed cleanup while retaining checkpoint evidence', () => {
  const rawCheckpoint = {
    status: 'verified',
    persistedProfileAuthUidHash: 'a'.repeat(64),
  };
  const blocked = buildAndroidSessionTerminalQualification({
    result: 'observed',
    cleanup: 'failed-recovery-retained',
    evidenceStatus: 'available',
  });
  assert.deepEqual(blocked, {
    status: 'blocked',
    blockers: ['cleanup-not-cleaned'],
  });
  assert.equal(rawCheckpoint.status, 'verified');
  assert.deepEqual(
    buildAndroidSessionTerminalQualification({
      result: 'observed',
      cleanup: 'cleaned',
      evidenceStatus: 'available',
    }),
    { status: 'verified', blockers: [] },
  );
  assert.deepEqual(
    buildAndroidSessionTerminalQualification({
      result: 'cancelled',
      cleanup: 'cleaned',
      evidenceStatus: undefined,
    }),
    {
      status: 'blocked',
      blockers: ['result-not-observed', 'evidence-unavailable'],
    },
  );
});

void test('Pre-acquisition abort terminates a spawned owned child before readiness', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'android-owned-abort-')));
  const wrapper = path.join(root, 'owned-runtime-wrapper');
  const silent = path.join(root, 'silent-session.js');
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'mychampions-server',
      engines: { bun: process.version },
    }),
    { mode: 0o600 },
  );
  await writeFile(silent, 'setTimeout(() => {}, 60000);\n', { mode: 0o600 });
  await writeFile(
    wrapper,
    `#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\\n' "${process.version}"; exit 0; fi
if [ "$1" = "--no-env-file" ]; then shift; fi
exec "${process.execPath}" "$@"
`,
    { mode: 0o700 },
  );
  await chmod(wrapper, 0o700);
  const controller = new AbortController();
  const pending = startOwnedSession({
    serverRoot: root,
    appOrigin: 'http://127.0.0.1:42401',
    bunExecutable: wrapper,
    deadlineMs: 2000,
    signal: controller.signal,
  });
  const timer = setTimeout(() => controller.abort(new Error('pre-acquisition test abort')), 1000);
  let childPid: number | undefined;
  try {
    await assert.rejects(pending, (error: unknown) => {
      assert(error instanceof OwnedSessionAcquisitionError);
      assert.equal(error.cleanup, 'failed-recovery-ledger-retained');
      assert(Number.isSafeInteger(error.pid));
      childPid = error.pid;
      return true;
    });
    assert(Number.isSafeInteger(childPid));
    assert.throws(() => process.kill(childPid as number, 0), /ESRCH/);
  } finally {
    clearTimeout(timer);
    await rm(root, { recursive: true, force: true });
  }
});

void test('Android restore and signed-out relaunch use exact transport windows', () => {
  const hydrateHash = createHash('sha256').update('/me/hydrate').digest('hex');
  const restoreRows = [
    observation(10, 'POST', hydrateHash, 200),
    observation(11, 'GET', createHash('sha256').update('/plans').digest('hex')),
  ];
  const restore = requireAndroidSessionTransportSlice({
    observations: restoreRows,
    beforeRequestId: 9,
    afterRequestId: 11,
    phase: 'restore',
    targetOrigin: identity.targetOrigin,
    apiLifetime,
    expectedRunId: apiLifetime.runId,
    expectedProxyRunId: apiLifetime.proxyRunId,
    expectedProxyOrigin: apiLifetime.proxyOrigin,
  });
  assert.deepEqual(restore.hydrationRequestIds, [10]);
  assert.equal(restore.rows[0]?.ordinal, 1);
  assert.throws(
    () =>
      requireAndroidSessionTransportSlice({
        observations: [observation(10, 'POST', hydrateHash, 201)],
        beforeRequestId: 9,
        afterRequestId: 10,
        phase: 'restore',
        targetOrigin: identity.targetOrigin,
        apiLifetime,
        expectedRunId: apiLifetime.runId,
        expectedProxyRunId: apiLifetime.proxyRunId,
        expectedProxyOrigin: apiLifetime.proxyOrigin,
      }),
    /hydrate 200/,
  );
  const signedOut = requireAndroidSessionTransportSlice({
    observations: [
      observation(
        12,
        'GET',
        createHash('sha256').update('/auth/sign-out').digest('hex'),
        200,
        false,
      ),
    ],
    beforeRequestId: 11,
    afterRequestId: 12,
    phase: 'signed-out-relaunch',
    targetOrigin: identity.targetOrigin,
    apiLifetime,
    expectedRunId: apiLifetime.runId,
    expectedProxyRunId: apiLifetime.proxyRunId,
    expectedProxyOrigin: apiLifetime.proxyOrigin,
  });
  assert.deepEqual(signedOut.hydrationRequestIds, []);
  assert.throws(
    () =>
      requireAndroidSessionTransportSlice({
        observations: [
          observation(
            12,
            'GET',
            createHash('sha256').update('/auth/sign-out').digest('hex'),
            200,
            true,
          ),
        ],
        beforeRequestId: 11,
        afterRequestId: 12,
        phase: 'signed-out-relaunch',
        targetOrigin: identity.targetOrigin,
        apiLifetime,
        expectedRunId: apiLifetime.runId,
        expectedProxyRunId: apiLifetime.proxyRunId,
        expectedProxyOrigin: apiLifetime.proxyOrigin,
      }),
    /sent credentials/,
  );
  assert.throws(
    () =>
      requireAndroidSessionTransportSlice({
        observations: [observation(10, 'POST', hydrateHash)],
        beforeRequestId: 9,
        afterRequestId: 10,
        phase: 'signed-out-relaunch',
        targetOrigin: identity.targetOrigin,
        apiLifetime,
        expectedRunId: apiLifetime.runId,
        expectedProxyRunId: apiLifetime.proxyRunId,
        expectedProxyOrigin: apiLifetime.proxyOrigin,
      }),
    /hydrated/,
  );
  assert.throws(
    () =>
      requireAndroidSessionTransportSlice({
        observations: [observation(12, 'POST', hydrateHash, 200)],
        beforeRequestId: 9,
        afterRequestId: 12,
        phase: 'restore',
        targetOrigin: identity.targetOrigin,
        apiLifetime,
        expectedRunId: apiLifetime.runId,
        expectedProxyRunId: apiLifetime.proxyRunId,
        expectedProxyOrigin: apiLifetime.proxyOrigin,
      }),
    /exact request ordinal/,
  );
});

void test('Android API lifetime binding uses one owned process identity across the window', () => {
  assert.deepEqual(
    requireAndroidOwnedApiLifetimeBinding({
      before: apiLifetime,
      after: { ...apiLifetime },
      expectedRunId: apiLifetime.runId,
      expectedProxyRunId: apiLifetime.proxyRunId,
      expectedProxyOrigin: apiLifetime.proxyOrigin,
    }),
    apiLifetime,
  );
  assert.throws(
    () =>
      requireAndroidOwnedApiLifetimeBinding({
        before: apiLifetime,
        after: { ...apiLifetime, apiPid: 5678 },
        expectedRunId: apiLifetime.runId,
        expectedProxyRunId: apiLifetime.proxyRunId,
        expectedProxyOrigin: apiLifetime.proxyOrigin,
      }),
    /changed across the transport window/,
  );
  assert.throws(
    () =>
      requireAndroidOwnedApiLifetimeBinding({
        before: apiLifetime,
        after: apiLifetime,
        expectedRunId: apiLifetime.runId,
        expectedProxyRunId: apiLifetime.proxyRunId,
        expectedProxyOrigin: 'http://127.0.0.1:49999',
      }),
    /malformed or unbound/,
  );
});

void test('Android session checkpoints require four distinct profile and domain source files', () => {
  const phases = [
    'before-login',
    'after-login',
    'after-restoration',
    'after-signed-out-relaunch',
  ] as const;
  const checkpoints = phases.map((phase, index) => ({
    phase,
    runId: apiLifetime.runId,
    scope: 'native-entry-android',
    apiOrigin: apiLifetime.apiOrigin,
    apiPid: apiLifetime.apiPid,
    backendAttemptId: apiLifetime.backendAttemptId,
    manifestSha256: apiLifetime.manifestSha256,
    fixtureAuthUidAllowlistHash: identity.fixtureAuthUidAllowlistHash,
    profile: {
      path: `profile-${index}.json`,
      sizeBytes: 100 + index,
      sha256: createHash('sha256').update(`profile-${index}`).digest('hex'),
      ownerUid: 501,
      mode: 0o600,
      verification: 'owned-runtime-document-v6' as const,
    },
    domain: {
      path: `domain-${index}.json`,
      sizeBytes: 200 + index,
      sha256: createHash('sha256').update(`domain-${index}`).digest('hex'),
      ownerUid: 501,
      mode: 0o600,
      verification: 'owned-runtime-document-v6' as const,
    },
  }));
  assert.equal(
    requireAndroidSessionCheckpointSet({
      checkpoints,
      expectedRunId: apiLifetime.runId,
      expectedScope: 'native-entry-android',
      expectedApiOrigin: apiLifetime.apiOrigin,
      expectedApiPid: apiLifetime.apiPid,
      expectedBackendAttemptId: apiLifetime.backendAttemptId,
      expectedManifestSha256: apiLifetime.manifestSha256,
      expectedFixtureAuthUidAllowlistHash: identity.fixtureAuthUidAllowlistHash,
    }).length,
    4,
  );
  // Unchanged domain rows produce byte-identical snapshots in separate files.
  const unchangedDomain = checkpoints.map((checkpoint) => ({
    ...checkpoint,
    domain: { ...checkpoint.domain, sizeBytes: 200, sha256: checkpoints[0].domain.sha256 },
  }));
  assert.equal(
    requireAndroidSessionCheckpointSet({
      checkpoints: unchangedDomain,
      expectedRunId: apiLifetime.runId,
      expectedScope: 'native-entry-android',
      expectedApiOrigin: apiLifetime.apiOrigin,
      expectedApiPid: apiLifetime.apiPid,
      expectedBackendAttemptId: apiLifetime.backendAttemptId,
      expectedManifestSha256: apiLifetime.manifestSha256,
      expectedFixtureAuthUidAllowlistHash: identity.fixtureAuthUidAllowlistHash,
    }).length,
    4,
  );
  assert.throws(
    () =>
      requireAndroidSessionCheckpointSet({
        checkpoints: [
          checkpoints[0],
          checkpoints[1],
          { ...checkpoints[1], phase: 'after-restoration' },
          checkpoints[3],
        ],
        expectedRunId: apiLifetime.runId,
        expectedScope: 'native-entry-android',
        expectedApiOrigin: apiLifetime.apiOrigin,
        expectedApiPid: apiLifetime.apiPid,
        expectedBackendAttemptId: apiLifetime.backendAttemptId,
        expectedManifestSha256: apiLifetime.manifestSha256,
        expectedFixtureAuthUidAllowlistHash: identity.fixtureAuthUidAllowlistHash,
      }),
    /duplicated or forged/,
  );
});

void test('Android session charter requires six ordered assertions and one restoration', () => {
  const assertions = androidSessionAssertionSequence.map((id, index) => ({
    id,
    order: index + 1,
    status: 'verified' as const,
    phase: id,
    sourceReceiptHashes: [createHash('sha256').update(`${id}-source`).digest('hex')],
  }));
  assert.equal(
    requireAndroidSessionCharter({
      assertionReceipts: assertions,
      restorationCount: 1,
    }).status,
    'verified',
  );
  assert.throws(
    () =>
      requireAndroidSessionCharter({
        assertionReceipts: [assertions[1], ...assertions.slice(1)],
        restorationCount: 1,
      }),
    /order or status/,
  );
  assert.throws(
    () =>
      requireAndroidSessionCharter({
        assertionReceipts: assertions,
        restorationCount: 2,
      }),
    /exactly one restoration/,
  );
});

void test('Android session domain binding preserves unrelated rows and owned SQL receipts', () => {
  const before = domainSnapshot();
  const after = structuredClone(before);
  const result = requireAndroidSessionDomainBinding({
    before,
    after,
    beforeStorage: checkpoint(),
    afterStorage: checkpoint(),
  });
  assert.equal(result.status, 'verified');
  assert.match(result.trainingPlans.sha256, /^[a-f0-9]{64}$/);
  assert.match(result.sql.before.database!.sha256, /^[a-f0-9]{64}$/);
  const sidecarResult = requireAndroidSessionDomainBinding({
    before,
    after,
    beforeStorage: checkpoint(present(), true),
    afterStorage: checkpoint(present(), true),
  });
  assert.equal(sidecarResult.sql.before.databaseSidecars.length, 1);
  const changedReceipt = structuredClone(checkpoint());
  changedReceipt.privateArtifacts.database.sizeBytes = 129;
  assert.doesNotThrow(() =>
    requireAndroidSessionDomainBinding({
      before,
      after,
      beforeStorage: changedReceipt,
      afterStorage: checkpoint(),
    }),
  );
  const malformedSidecar = structuredClone(checkpoint(present(), true));
  malformedSidecar.privateArtifacts.databaseSidecars[0].sha256 = 'bad';
  assert.throws(
    () =>
      requireAndroidSessionDomainBinding({
        before,
        after,
        beforeStorage: malformedSidecar,
        afterStorage: checkpoint(),
      }),
    /receipt is malformed/,
  );
  const untypedQuerySource = structuredClone(checkpoint());
  delete (untypedQuerySource.privateArtifacts.querySource as { kind?: unknown }).kind;
  assert.throws(
    () =>
      requireAndroidSessionDomainBinding({
        before,
        after,
        beforeStorage: untypedQuerySource,
        afterStorage: checkpoint(),
      }),
    /query source receipt is malformed or unbound/,
  );
  const changed = structuredClone(after);
  Object.assign(changed.connections[0], { status: 'ended' });
  assert.throws(
    () =>
      requireAndroidSessionDomainBinding({
        before,
        after: changed,
        beforeStorage: checkpoint(),
        afterStorage: checkpoint(),
      }),
    /unrelated connections/,
  );
  const missing = structuredClone(checkpoint());
  delete (missing.privateArtifacts as { query?: unknown }).query;
  assert.throws(
    () =>
      requireAndroidSessionDomainBinding({
        before,
        after,
        beforeStorage: missing,
        afterStorage: checkpoint(),
      }),
    /SQL file receipt is missing/,
  );
});

void test('Android cancel action requires strict confirmation absence before the account screen continues', () => {
  const actions = buildAndroidSessionActionPlans();
  assert.match(actions.cancel, /settings\.account\.signOutCancelCta/);
  assert.match(actions.cancel, /assertNotVisible/);
  assert.match(actions.cancel, /settings\.account\.signOutConfirm/);
  assert.match(actions.cancel, /settings\.account\.signOutConfirmCta/);
  assert.equal((actions.confirm.match(/tapOn/g) ?? []).length, 1);
});

void test('Android cancel retains the observed coach cache identity and shape', () => {
  const before = present();
  const after = structuredClone(before);
  const expectedAuthUidHash = before.asyncStorage.profileAuthUidHash!;
  assert.equal(
    requireAndroidRetainedNativeSessionIdentity({
      before,
      after,
      expectedAuthUidHash,
    }).status,
    'verified',
  );
  after.asyncStorage.profileAuthUidHash = 'b'.repeat(64);
  assert.throws(
    () =>
      requireAndroidRetainedNativeSessionIdentity({
        before,
        after,
        expectedAuthUidHash,
      }),
    /wrong|changed/,
  );
  assert.throws(
    () =>
      requireAndroidRetainedNativeSessionIdentity({
        before,
        after: absent(),
        expectedAuthUidHash,
      }),
    /cleared/,
  );
});

void test('Android local clear requires the cancel dialog to be absent and preserves server-revocation boundary', () => {
  const cancelEvidence = requireAndroidCancelledConfirmationAbsent({
    hierarchyObserved: true,
    hierarchyPath: 'auth-signout-cancelled-hierarchy.json',
    screenshotPath: 'auth-signout-cancelled.png',
    hierarchySourcePath: 'auth-signout-cancelled-hierarchy.xml',
    hierarchySourceReceipt: cancelledHierarchySourceReceipt,
    hierarchyReceipt: cancelledHierarchyReceipt,
    screenshotReceipt: cancelledScreenshotReceipt,
    modalPresent: false,
    confirmCtaPresent: false,
    commandExecution: {
      label: 'auth-signout-cancelled-readiness',
      execution: 'completed',
      cleanup: 'cleaned',
      childExitCode: 0,
      childSignal: null,
    },
  });
  assert.throws(
    () =>
      requireAndroidCancelledConfirmationAbsent({
        hierarchyObserved: false,
        hierarchyPath: 'auth-signout-cancelled-hierarchy.json',
        screenshotPath: 'auth-signout-cancelled.png',
        hierarchySourcePath: 'auth-signout-cancelled-hierarchy.xml',
        hierarchySourceReceipt: cancelledHierarchySourceReceipt,
        hierarchyReceipt: cancelledHierarchyReceipt,
        screenshotReceipt: cancelledScreenshotReceipt,
        modalPresent: false,
        confirmCtaPresent: false,
        commandExecution: {
          label: 'auth-signout-cancelled-readiness',
          execution: 'completed',
          cleanup: 'cleaned',
          childExitCode: 0,
          childSignal: null,
        },
      }),
    /actual clean command/,
  );
  assert.throws(
    () =>
      requireAndroidCancelledConfirmationAbsent({
        hierarchyObserved: true,
        hierarchyPath: 'auth-signout-cancelled-hierarchy.json',
        screenshotPath: 'auth-signout-cancelled.png',
        hierarchySourcePath: 'auth-signout-cancelled-hierarchy.xml',
        hierarchySourceReceipt: cancelledHierarchySourceReceipt,
        hierarchyReceipt: cancelledHierarchyReceipt,
        screenshotReceipt: cancelledScreenshotReceipt,
        modalPresent: false,
        confirmCtaPresent: false,
        commandExecution: {
          label: 'auth-signout-cancelled-readiness',
          execution: 'child-failed',
          cleanup: 'cleaned',
          childExitCode: 1,
          childSignal: null,
        },
      }),
    /clean command/,
  );
  assert.deepEqual(
    requireAndroidLocalSessionClear({
      beforeRelaunch: present(),
      afterRestore: present(),
      afterSignOut: absent(),
      afterSignedOutRelaunch: absent(),
      cancelledSessionIdentity: {
        status: 'verified',
        profileAuthUidHash: present().asyncStorage.profileAuthUidHash!,
      },
      cancelledConfirmationEvidence: cancelEvidence,
    }),
    {
      status: 'verified',
      serverRevocationQualified: false,
      source: 'local-native-bearer-session-clear',
    },
  );
  assert.throws(
    () =>
      requireAndroidLocalSessionClear({
        beforeRelaunch: present(),
        afterRestore: present(),
        afterSignOut: absent(),
        afterSignedOutRelaunch: absent(),
        cancelledSessionIdentity: {
          status: 'verified',
          profileAuthUidHash: present().asyncStorage.profileAuthUidHash!,
        },
        cancelledConfirmationEvidence: {
          ...cancelEvidence,
          modalPresent: true,
        },
      }),
    /restoration or clearing/,
  );
});

void test('capture exit blocks unknown session evidence while preserving other charter success and cancellation', () => {
  const base = {
    cancellation: null,
    result: 'observed',
    cleanup: 'cleaned',
    isAuthSessionFlow: true,
  } as const;
  for (const sessionQualification of [
    undefined,
    null,
    {},
    { status: 'unknown' },
    { status: 'blocked' },
  ]) {
    assert.equal(androidNativeCaptureExitCode({ ...base, sessionQualification }), 2);
  }
  assert.equal(
    androidNativeCaptureExitCode({ ...base, sessionQualification: { status: 'verified' } }),
    0,
  );
  assert.equal(
    androidNativeCaptureExitCode({
      ...base,
      isAuthSessionFlow: false,
      sessionQualification: undefined,
    }),
    0,
  );
  assert.equal(
    androidNativeCaptureExitCode({
      ...base,
      cleanup: 'failed-recovery-retained',
      sessionQualification: { status: 'verified' },
    }),
    2,
  );
  assert.equal(
    androidNativeCaptureExitCode({
      ...base,
      cancellation: 'SIGINT',
      sessionQualification: undefined,
    }),
    130,
  );
  assert.equal(
    androidNativeCaptureExitCode({
      ...base,
      cancellation: 'SIGTERM',
      sessionQualification: undefined,
    }),
    143,
  );
});

void test('before-login storage accepts an absent database only with no database artifacts', () => {
  const receipt = (name: string, kind: string) => ({
    path: name,
    kind,
    sizeBytes: 12,
    sha256: createHash('sha256').update(name).digest('hex'),
    ownerUid: 501,
    mode: 0o600,
    verification: 'owned-stable-reader-v6',
  });
  const absent = {
    database: null,
    databaseSidecars: [],
    query: null,
    querySource: null,
    secureStore: null,
    databaseListing: receipt('auth-before-login-app-directory.stdout', 'listing'),
    secureStoreListing: receipt('auth-before-login-secure-presence.stdout', 'listing'),
  };
  const accepted = requireAndroidStorageReceiptSet(absent, 'Before');
  assert.equal(accepted.database, null);
  assert.equal(accepted.query, null);
  assert.equal(accepted.databaseListing.path, 'auth-before-login-app-directory.stdout');
  for (const invalid of [
    { ...absent, query: receipt('auth-before-login-async-storage-query.json', 'query') },
    { ...absent, databaseSidecars: [receipt('auth-before-login-async-storage.db-wal', 'sidecar')] },
    { ...absent, querySource: {} },
    { ...absent, databaseListing: receipt('auth-before-login-other.stdout', 'listing') },
  ])
    assert.throws(() => requireAndroidStorageReceiptSet(invalid, 'Before'), /absent|bound|missing/);
});

void test('database coherence accepts a TRUNCATE journal only when measured empty', () => {
  const names = ['RKStorage', 'RKStorage-journal', 'exoplayer_internal.db'];
  assert.throws(() => requireCoherentAndroidDatabaseListing(names), /rollback journal/);
  assert.deepEqual(
    requireCoherentAndroidDatabaseListing(names, { rollbackJournalVerifiedEmpty: true })
      .rollbackJournals,
    [],
  );
  assert.throws(
    () =>
      requireCoherentAndroidDatabaseListing(['RKStorage', 'RKStorage-mj01'], {
        rollbackJournalVerifiedEmpty: true,
      }),
    /rollback journal/,
  );
});

void test('SecureStore parser treats an emptied self-closing map as no session entry', () => {
  const observation = parseAndroidSessionStorageObservation({
    database: 'present',
    sqliteJson: '[]',
    securePreferences: 'present',
    secureStoreXml: "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map />\n",
    sessionKeyHash: 'a'.repeat(64),
  });
  assert.equal(observation.status, 'session-absent');
  assert.equal(observation.secureStore.sessionEntryPresent, false);
  assert.throws(
    () =>
      parseAndroidSessionStorageObservation({
        database: 'present',
        sqliteJson: '[]',
        securePreferences: 'present',
        secureStoreXml: '<map',
        sessionKeyHash: 'a'.repeat(64),
      }),
    /malformed/,
  );
});
