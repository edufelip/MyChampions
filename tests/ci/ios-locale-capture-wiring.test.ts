import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createIosLocaleCaptureWiring,
  createIosLocaleQuiescenceProbe,
  type IosLocaleCaptureWiringInput,
} from '../../scripts/testing/ios-locale-capture-wiring';
import type { NativeLocaleBinding } from '../../scripts/testing/locale-native-observation';
import type {
  ConnectionSnapshotRows,
  OwnedConnectionSnapshot,
} from '../../scripts/testing/native-connection-snapshot';
import type {
  ProxyObservation,
  NativeAuthIdentityObservation,
} from '../../scripts/testing/owned-api-proxy';
import type { OwnedDomainSnapshot } from '../../scripts/testing/owned-session';

const captureRunId = 'a'.repeat(24);
const backendRunId = 'b'.repeat(24);
const apiOrigin = 'http://127.0.0.1:19001';
const appOrigin = 'http://127.0.0.1:19002';
const coach = 'fixture-coach';
const student = 'fixture-student';
const fixtureAuthUids = [coach, student, 'fixture-unrelated'].sort();
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const sourceHash = '1'.repeat(64);
const helperHash = '2'.repeat(64);
const binaryHash = '3'.repeat(64);
const signInPathHash = sha('/auth/email/sign-in');
const allowlistHash = sha(JSON.stringify(fixtureAuthUids));
const binding: NativeLocaleBinding = {
  captureRunId,
  sourceTreeHash: sourceHash,
  helperInputsHash: helperHash,
  target: {
    platform: 'ios',
    deviceId: '01234567-89AB-CDEF-0123-456789ABCDEF',
    osVersion: 'iOS 26.5',
    appId: 'com.edufelip.mychampions.dev',
    binaryHash,
    apiOrigin: appOrigin,
  },
};
const timestamp = '2026-10-02T12:00:00.000Z';

function profileSnapshot(): OwnedConnectionSnapshot {
  const rows: ConnectionSnapshotRows = {
    userProfiles: fixtureAuthUids.map((authUid) => ({
      authUid,
      lockedRole: authUid === coach ? 'professional' : 'student',
      acceptedTermsVersion: 'v1',
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    professionalSpecialties: [],
    inviteCodes: [],
    connections: [],
    connectionInviteGuards: [],
    pendingStudents: [],
    pendingStudentSlots: [],
    trackingAccess: [],
    activeSpecialties: [],
  };
  return {
    schemaVersion: 1,
    kind: 'connection-snapshot-v1',
    runId: backendRunId,
    scope: 'native-entry-ios',
    readOnly: true,
    fixtureAuthUids: [...fixtureAuthUids],
    target: { professionalAuthUid: coach, studentAuthUid: student, specialty: 'fitness_coach' },
    rowCounts: Object.fromEntries(
      Object.entries(rows).map(([name, values]) => [name, values.length]),
    ) as OwnedConnectionSnapshot['rowCounts'],
    rows,
  };
}

function domainSnapshot(): OwnedDomainSnapshot {
  return {
    schemaVersion: 1,
    runId: backendRunId,
    scope: 'native-entry-ios',
    readOnly: true,
    trainingPlans: [],
    connections: [],
  };
}

function input(overrides: Partial<IosLocaleCaptureWiringInput> = {}): IosLocaleCaptureWiringInput {
  const observations: ProxyObservation[] = [];
  const identities: NativeAuthIdentityObservation[] = [];
  return {
    artifactRoot: '/tmp/locale-capture-artifacts',
    sourceRoot: '/tmp/mychampions',
    cwd: '/tmp/mychampions',
    output: '/tmp/locale-capture-artifacts',
    captureRunId,
    binding,
    device: { udid: binding.target.deviceId, runtime: binding.target.osVersion },
    metroPort: 8081,
    build: {
      qualification: 'runtime-qualified',
      sourceTreeHash: sourceHash,
      helperInputsHash: helperHash,
      binaryHash,
      bundleId: 'com.edufelip.mychampions.dev',
      apiOrigin: appOrigin,
      backendApiOrigin: apiOrigin,
      reusedFrom: null,
    },
    signal: new AbortController().signal,
    effectiveCommandDeadline: (requestedMs) => requestedMs,
    verifyTarget: () => Promise.resolve(),
    fixtures: {
      runId: backendRunId,
      scope: 'native-entry-ios',
      accounts: {
        coach: {
          email: 'coach@example.invalid',
          password: 'fixture-password',
          authUid: coach,
          role: 'professional',
        },
        student: {
          email: 'student@example.invalid',
          password: 'fixture-password',
          authUid: student,
          role: 'student',
        },
      },
      fixtureAuthUids,
    },
    backend: {
      runId: backendRunId,
      apiPid: 1234,
      apiOrigin,
      readProfileSnapshot: () => Promise.resolve(profileSnapshot()),
      readDomainSnapshot: () => Promise.resolve(domainSnapshot()),
    },
    proxy: {
      requestIdFence: () => 0,
      observations: () => observations,
      nativeAuthIdentities: () => identities,
    },
    probeQuiescence: () =>
      Promise.reject(
        new Error('test quiescence callback should be replaced by the focused probe test'),
      ),
    cleanupOwned: () =>
      Promise.resolve({
        status: 'cleaned' as const,
        captureRunId,
        attempt: 1 as const,
        ownedResources: [],
        foreignResourcesPreserved: true as const,
        startedAt: timestamp,
        finishedAt: timestamp,
        failure: null,
      }),
    ...overrides,
  };
}

function signInObservation(): ProxyObservation {
  return {
    requestId: 1,
    method: 'POST',
    pathHash: signInPathHash,
    requestOrigin: null,
    requestProfile: 'native',
    targetOrigin: apiOrigin,
    status: 201,
    outcome: 'forwarded',
    faultAttemptId: null,
    elapsedMs: 5,
  };
}

function signInIdentity(): NativeAuthIdentityObservation {
  return {
    requestId: 1,
    ordinal: 1,
    targetOrigin: apiOrigin,
    apiPid: 1234,
    status: 201,
    authUid: coach,
    verification: 'verified',
    verificationReason: 'verified',
    fixtureAuthUidAllowlistHash: allowlistHash,
  };
}

function homeFrame() {
  return {
    label: 'locale-coach-home',
    hierarchyPath: 'locale-coach-home-hierarchy.json',
    hierarchyHash: '4'.repeat(64),
    tree: {},
    captureRunId,
    binding,
    observedAt: timestamp,
  } as const;
}

void test('wiring binds live proxy identity plus profile/terms checkpoint without changing Pending result policy', async () => {
  const state = input();
  const observations = state.proxy.observations as () => readonly ProxyObservation[];
  const identities = state.proxy
    .nativeAuthIdentities as () => readonly NativeAuthIdentityObservation[];
  const rows = [signInObservation()];
  const authRows = [signInIdentity()];
  state.proxy = {
    requestIdFence: () => 0,
    observations: () => rows,
    nativeAuthIdentities: () => authRows,
  };
  const wiring = createIosLocaleCaptureWiring(state);
  const profile = await wiring.context.readAuthProfileSnapshot();
  const domain = await wiring.context.readDomainSnapshot();
  assert.equal((profile as OwnedConnectionSnapshot).runId, backendRunId);
  assert.equal((domain as OwnedDomainSnapshot).scope, 'native-entry-ios');
  const receipt = await wiring.context.readCoachSignInReceipt({
    appAuthMetadata: {
      status: 'session-present',
      sessionPresent: true,
      profilePresent: true,
      expiryPresent: true,
      plaintextAccessTokenPresent: true,
      plaintextRefreshTokenPresent: true,
      profileAuthUidHash: sha(coach),
    },
    authProfileSnapshot: profile,
    homeHierarchy: homeFrame(),
    signal: state.signal,
  });
  assert.equal(receipt.fixtureAuthUid, coach);
  assert.equal(receipt.signInRequestId, 1);
  assert.equal(wiring.signInBoundary.beforeRequestId, 0);
  assert.equal(wiring.run !== undefined, true);
  void observations;
  void identities;
});

void test('wiring rejects a second sign-in, foreign principal, or mismatched backend origin', async () => {
  const state = input();
  const rows = [signInObservation(), { ...signInObservation(), requestId: 2 }];
  const identities = [signInIdentity(), { ...signInIdentity(), requestId: 2, ordinal: 2 }];
  state.proxy = {
    requestIdFence: () => 0,
    observations: () => rows,
    nativeAuthIdentities: () => identities,
  };
  const wiring = createIosLocaleCaptureWiring(state);
  await assert.rejects(
    wiring.context.readCoachSignInReceipt({
      appAuthMetadata: {
        status: 'session-present',
        sessionPresent: true,
        profilePresent: true,
        profileAuthUidHash: sha(coach),
      },
      authProfileSnapshot: profileSnapshot(),
      homeHierarchy: homeFrame(),
    }),
    /one new owned 201/,
  );
  const foreign = input({
    backend: {
      ...state.backend,
      apiOrigin: 'http://127.0.0.1:19003',
    },
  });
  assert.throws(() => createIosLocaleCaptureWiring(foreign), /identities do not match/);
});

void test('coach sign-in receipt preserves cancellation through its asynchronous read', async () => {
  const controller = new AbortController();
  const state = input({ signal: controller.signal });
  state.proxy = {
    requestIdFence: () => 0,
    observations: () => [signInObservation()],
    nativeAuthIdentities: () => [signInIdentity()],
  };
  const wiring = createIosLocaleCaptureWiring(state);
  const profile = profileSnapshot();
  const pending = wiring.context.readCoachSignInReceipt({
    appAuthMetadata: {
      status: 'session-present',
      sessionPresent: true,
      profilePresent: true,
      profileAuthUidHash: sha(coach),
    },
    authProfileSnapshot: profile,
    homeHierarchy: homeFrame(),
    signal: controller.signal,
  });
  controller.abort(new Error('receipt-cancelled'));
  await assert.rejects(pending, /receipt-cancelled/);
});

void test('wiring rejects wrong fixture role or wrong profile checkpoint scope before adapter actions', async () => {
  const state = input({
    fixtures: {
      ...input().fixtures,
      accounts: {
        ...input().fixtures.accounts,
        coach: { ...input().fixtures.accounts.coach, role: 'student' },
      },
    },
  });
  assert.throws(() => createIosLocaleCaptureWiring(state), /fixture roles/);
  const wrongProfile = input({
    backend: {
      ...input().backend,
      readProfileSnapshot: () =>
        Promise.resolve({ ...profileSnapshot(), scope: 'native-entry-android' }),
    },
  });
  const wiring = createIosLocaleCaptureWiring(wrongProfile);
  await assert.rejects(
    wiring.context.readAuthProfileSnapshot(),
    /Invalid connection-snapshot-v1|scope/,
  );
});

void test('wiring fails closed when an owned checkpoint callback is absent', () => {
  const state = input({
    backend: {
      ...input().backend,
      readDomainSnapshot:
        undefined as unknown as IosLocaleCaptureWiringInput['backend']['readDomainSnapshot'],
    },
  });
  assert.throws(
    () => createIosLocaleCaptureWiring(state),
    /readDomainSnapshot callback is unavailable/,
  );
});

void test('quiescence bridge accepts an owned empty census and rejects an app process row', async (t) => {
  const root = await mkdtemp(path.join(realpathSync(tmpdir()), 'locale-quiescence-'));
  await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const stdoutPath = path.join(root, 'ps.stdout');
  await writeFile(stdoutPath, '', { mode: 0o600 });
  const command = {
    execution: 'completed' as const,
    cleanup: 'cleaned' as const,
    attempted: true as const,
    pid: 1234,
    pgid: 1234,
    logPath: 'ps.log',
    stdoutPath,
    childExitCode: 0 as const,
    childSignal: null,
    label: 'locale-reset-quiescence-1',
    bindingCaptureRunId: captureRunId,
  };
  const probe = createIosLocaleQuiescenceProbe({
    artifactRoot: root,
    captureRunId,
    deviceId: binding.target.deviceId,
    bundleId: binding.target.appId,
    bindingCaptureRunId: captureRunId,
    runProcessCensus: () => Promise.resolve(command),
  });
  const receipt = await probe();
  assert.equal(receipt.appRunning, false);
  assert.deepEqual(receipt.probe.processes, []);
  await writeFile(stdoutPath, `123 ${binding.target.appId}\n`, { mode: 0o600 });
  await assert.rejects(probe(), /still contains/);
});

void test('quiescence bridge rejects an unbound command before reading stdout', async () => {
  const root = await mkdtemp(path.join(realpathSync(tmpdir()), 'locale-quiescence-invalid-'));
  await chmod(root, 0o700);
  await writeFile(path.join(root, 'ps.stdout'), '', { mode: 0o600 });
  assert.throws(
    () =>
      createIosLocaleQuiescenceProbe({
        artifactRoot: root,
        captureRunId,
        deviceId: binding.target.deviceId,
        bundleId: binding.target.appId,
        bindingCaptureRunId: 'c'.repeat(24),
        runProcessCensus: () => Promise.reject(new Error('must not run')),
      }),
    /binding differs/,
  );
  void rm(root, { recursive: true, force: true });
});
