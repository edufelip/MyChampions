import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadActualIosSessionAdapterInput } from './actual-capture-preflight.v6.candidate';
import {
  verifyNativeSessionProfileCheckpoints,
  type NativeSessionProfileCheckpointInput,
} from '../../../scripts/testing/native-session-profile-checkpoints';
import type {
  ConnectionSnapshotRows,
  OwnedConnectionSnapshot,
} from '../../../scripts/testing/native-connection-snapshot';
import type { OwnedDomainSnapshot } from '../../../scripts/testing/owned-session';

const runId = 'a'.repeat(24);
const coach = 'fixture-coach';
const student = 'fixture-student';
const fixtureAuthUids = [coach, student];
const apiPid = 4321;
const targetOrigin = 'http://127.0.0.1:19001';
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const uidHash = sha256(coach);
const allowlistHash = sha256(JSON.stringify(fixtureAuthUids));
const checkpointIds = [
  'beforeLogin',
  'afterLogin',
  'afterRestoration',
  'afterSignedOutRelaunch',
] as const;

function profile(coachUpdatedAt: string): OwnedConnectionSnapshot {
  const rows: ConnectionSnapshotRows = {
    userProfiles: [
      {
        authUid: coach,
        lockedRole: 'professional',
        acceptedTermsVersion: 'v1',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: coachUpdatedAt,
      },
      {
        authUid: student,
        lockedRole: 'student',
        acceptedTermsVersion: 'v1',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
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
    runId,
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

function input(): NativeSessionProfileCheckpointInput {
  const domain: OwnedDomainSnapshot = {
    schemaVersion: 1,
    runId,
    scope: 'native-entry-ios',
    readOnly: true,
    trainingPlans: [],
    connections: [],
  };
  const observation = (requestId: number, route: string, status: number) => ({
    requestId,
    method: 'POST',
    pathHash: sha256(route),
    requestOrigin: null,
    requestProfile: 'native' as const,
    targetOrigin,
    status,
    outcome: 'forwarded' as const,
    faultAttemptId: null,
    elapsedMs: 1,
  });
  return {
    platform: 'ios',
    backendRunId: runId,
    fixtureAuthUids,
    coachAuthUid: coach,
    studentAuthUid: student,
    expectedApiIdentity: { apiPid, targetOrigin },
    profiles: {
      beforeLogin: profile('2026-10-01T00:00:00.000Z'),
      afterLogin: profile('2026-10-01T00:00:01.000Z'),
      afterRestoration: profile('2026-10-01T00:00:02.000Z'),
      afterSignedOutRelaunch: profile('2026-10-01T00:00:02.000Z'),
    },
    domain: {
      beforeLogin: structuredClone(domain),
      afterLogin: structuredClone(domain),
      afterRestoration: structuredClone(domain),
      afterSignedOutRelaunch: structuredClone(domain),
    },
    observations: [observation(1, '/auth/email/sign-in', 201), observation(2, '/me/hydrate', 200)],
    authIdentities: [
      {
        requestId: 1,
        ordinal: 1,
        targetOrigin,
        apiPid,
        status: 201,
        authUid: coach,
        verification: 'verified',
        verificationReason: 'verified',
        fixtureAuthUidAllowlistHash: allowlistHash,
      },
    ],
    loginWindow: { afterRequestId: 0, throughRequestId: 1 },
    restorationWindow: { afterRequestId: 1, throughRequestId: 2 },
    persistedCoachIdentity: {
      afterLoginAuthUidHash: uidHash,
      afterRestorationAuthUidHash: uidHash,
    },
  };
}

async function writeOwnedJson(root: string, relative: string, value: unknown) {
  await writeFile(path.join(root, relative), JSON.stringify(value, null, 2), {
    mode: 0o600,
    flag: 'wx',
  });
}

async function makeCompleteCapture() {
  const captureRoot = await mkdtemp(path.join(path.resolve(__dirname), 'loader-fixture-'));
  const backendRoot = path.join(captureRoot, 'backend');
  await mkdir(backendRoot, { recursive: true, mode: 0o700 });
  await chmod(captureRoot, 0o700);
  await chmod(backendRoot, 0o700);
  const fixtures = {
    runId,
    scope: 'native-entry-ios',
    accounts: {
      coach: {
        email: 'coach@example.test',
        password: 'secret',
        authUid: coach,
        role: 'professional',
      },
      student: {
        email: 'student@example.test',
        password: 'secret',
        authUid: student,
        role: 'student',
      },
    },
  };
  const manifest = {
    phase: 'tests',
    runId,
    artifactRoot: backendRoot,
    fixtureScopes: ['native-entry-ios'],
    processes: [{ role: 'api', pid: apiPid, started: 'now', script: 'serve.ts' }],
  };
  await writeOwnedJson(backendRoot, 'manifest.json', manifest);
  await writeOwnedJson(backendRoot, 'fixtures-native-entry-ios.private.json', fixtures);
  const actual = input();
  const files: Record<string, { path: string; value: unknown }> = {};
  const receipt = (relative: string, bytes: Buffer) => ({
    path: relative,
    runId,
    scope: 'native-entry-ios',
    sha256: sha256(bytes),
    bytes: bytes.length,
    ownedRunId: runId,
    fixtureScope: 'native-entry-ios',
    artifactRoot: backendRoot,
    apiPid,
    targetOrigin,
    fixtureAuthUidAllowlistHash: allowlistHash,
  });
  const writeCaptureFile = async (relative: string, value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value, null, 2));
    await writeFile(path.join(captureRoot, relative), bytes, { mode: 0o600, flag: 'wx' });
    return receipt(relative, bytes);
  };
  for (const checkpoint of checkpointIds) {
    files[`profile-${checkpoint}`] = {
      path: `session-profile-${checkpoint}.private.json`,
      value: actual.profiles[checkpoint === 'beforeLogin' ? 'beforeLogin' : checkpoint],
    };
    files[`domain-${checkpoint}`] = {
      path: `session-domain-${checkpoint}.private.json`,
      value: actual.domain[checkpoint === 'beforeLogin' ? 'beforeLogin' : checkpoint],
    };
  }
  const profileReceipts: Record<string, unknown> = {};
  const domainReceipts: Record<string, unknown> = {};
  for (const checkpoint of checkpointIds) {
    const p = files[`profile-${checkpoint}`];
    const d = files[`domain-${checkpoint}`];
    profileReceipts[checkpoint] = await writeCaptureFile(p.path, p.value);
    domainReceipts[checkpoint] = await writeCaptureFile(d.path, d.value);
  }
  const transportReceipt = await writeCaptureFile(
    'transport-observations.private.json',
    actual.observations,
  );
  const authReceipt = await writeCaptureFile(
    'native-auth-identities.private.json',
    actual.authIdentities,
  );
  const capturedFixturesHash = sha256(JSON.stringify(fixtures));
  const capture: Record<string, unknown> = {
    charter: 'session',
    result: 'harness-blocked',
    cleanup: 'cleaned',
    nativePassingCases: 0,
    fixtureHash: capturedFixturesHash,
    backend: { runId, artifactRoot: backendRoot },
    transportEvidence: transportReceipt,
    nativeAuthIdentityEvidence: authReceipt,
    sessionProfileSnapshots: profileReceipts,
    sessionDomainSnapshots: domainReceipts,
    sessionProfileLoginWindow: actual.loginWindow,
    sessionProfileRestorationWindow: actual.restorationWindow,
    persistedCoachIdentity: actual.persistedCoachIdentity,
    sessionProfileCheckpointVerification: verifyNativeSessionProfileCheckpoints(actual),
  };
  await writeCaptureFile('capture.private.json', capture);
  return { captureRoot, capture, backendRoot };
}

void test('v6 loader re-reads a complete owned capture and invokes the shared verifier', async () => {
  const made = await makeCompleteCapture();
  try {
    const loaded = await loadActualIosSessionAdapterInput({ captureRoot: made.captureRoot });
    assert.equal(loaded.status, 'loaded');
    assert.equal(loaded.verification?.status, 'verified');
    assert.equal(loaded.verification?.nativePassingCases, 0);
  } finally {
    await rm(made.captureRoot, { recursive: true, force: true });
  }
});

void test('v6 loader rejects a snapshot hash mutation before verification', async () => {
  const made = await makeCompleteCapture();
  try {
    const capturePath = path.join(made.captureRoot, 'capture.private.json');
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as Record<string, any>;
    capture.sessionProfileSnapshots.afterLogin.sha256 = '0'.repeat(64);
    await writeFile(capturePath, JSON.stringify(capture, null, 2), { mode: 0o600 });
    const loaded = await loadActualIosSessionAdapterInput({ captureRoot: made.captureRoot });
    assert.equal(loaded.status, 'incomplete');
    assert.ok(
      loaded.missing.some((value) => value.includes('sessionProfileSnapshots.afterLogin.sha256')),
    );
    assert.equal(loaded.verification, undefined);
  } finally {
    await rm(made.captureRoot, { recursive: true, force: true });
  }
});

void test('v6 loader rejects missing checkpoint bytes and foreign receipt provenance', async () => {
  const made = await makeCompleteCapture();
  try {
    const capturePath = path.join(made.captureRoot, 'capture.private.json');
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as Record<string, any>;
    await rm(path.join(made.captureRoot, 'session-domain-afterSignedOutRelaunch.private.json'));
    const loaded = await loadActualIosSessionAdapterInput({ captureRoot: made.captureRoot });
    assert.equal(loaded.status, 'incomplete');
    assert.ok(loaded.missing.some((value) => value.includes('afterSignedOutRelaunch')));
    assert.equal(loaded.verification, undefined);
  } finally {
    await rm(made.captureRoot, { recursive: true, force: true });
  }
});

void test('v6 loader rejects a foreign checkpoint receipt root', async () => {
  const made = await makeCompleteCapture();
  try {
    const capturePath = path.join(made.captureRoot, 'capture.private.json');
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as Record<string, any>;
    capture.sessionDomainSnapshots.afterRestoration.artifactRoot = '/tmp/foreign-owned-root';
    await writeFile(capturePath, JSON.stringify(capture, null, 2), { mode: 0o600 });
    const loaded = await loadActualIosSessionAdapterInput({ captureRoot: made.captureRoot });
    assert.equal(loaded.status, 'incomplete');
    assert.ok(
      loaded.missing.some((value) =>
        value.includes('sessionDomainSnapshots.afterRestoration.artifactRoot'),
      ),
    );
    assert.equal(loaded.verification, undefined);
  } finally {
    await rm(made.captureRoot, { recursive: true, force: true });
  }
});
