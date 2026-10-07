import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  sessionProfileSnapshotLabels,
  validateSessionProfileSnapshotSupplement,
  type SessionProfileSnapshotEvidence,
  type SessionProfileSupplementInput,
} from './session-profile-snapshot-supplement.candidate';
import type { NativeAuthIdentityObservation } from '../../../scripts/testing/owned-api-proxy';
import type {
  ConnectionSnapshotRows,
  OwnedConnectionSnapshot,
} from '../../../scripts/testing/native-connection-snapshot';

const runId = 'a'.repeat(24);
const scope = 'native-entry-ios';
const coach = 'auth-coach';
const student = 'auth-student';
const fixtureAuthUids = [
  coach,
  student,
  'auth-new',
  'auth-pending',
  'auth-active',
  'auth-unrelated-coach',
  'auth-unrelated-student',
].sort();
const timestamp = '2026-10-01T00:00:00.000Z';
const loginTimestamp = '2026-10-01T00:00:01.000Z';
const restoreTimestamp = '2026-10-01T00:00:02.000Z';
const expectedApiIdentity = { targetOrigin: 'http://127.0.0.1:19001', apiPid: 1234 };

function hash(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

const fixtureAuthUidAllowlistHash = hash(JSON.stringify(fixtureAuthUids));

const fixtures = {
  accounts: {
    coach: {
      authUid: coach,
      email: 'coach@example.test',
      password: 'secret',
      role: 'professional',
    },
    student: {
      authUid: student,
      email: 'student@example.test',
      password: 'secret',
      role: 'student',
    },
    new: { authUid: 'auth-new', email: 'new@example.test', password: 'secret', role: null },
    'pending-student': {
      authUid: 'auth-pending',
      email: 'pending@example.test',
      password: 'secret',
      role: 'student',
    },
    'active-student': {
      authUid: 'auth-active',
      email: 'active@example.test',
      password: 'secret',
      role: 'student',
    },
    'unrelated-coach': {
      authUid: 'auth-unrelated-coach',
      email: 'other-coach@example.test',
      password: 'secret',
      role: 'professional',
    },
    'unrelated-student': {
      authUid: 'auth-unrelated-student',
      email: 'other-student@example.test',
      password: 'secret',
      role: 'student',
    },
  },
} as const;

function rows(): ConnectionSnapshotRows {
  return {
    userProfiles: fixtureAuthUids.map((authUid) => ({
      authUid,
      lockedRole:
        authUid === coach
          ? ('professional' as const)
          : authUid === 'auth-new'
            ? null
            : ('student' as const),
      acceptedTermsVersion: authUid === 'auth-new' ? null : 'v1',
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    professionalSpecialties: [
      {
        id: 'coach-fitness',
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    inviteCodes: [
      {
        id: 'invite-fitness',
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        rotatedAt: null,
      },
    ],
    connections: [
      {
        id: 'connection-1',
        professionalAuthUid: coach,
        studentAuthUid: student,
        status: 'pending_confirmation',
        specialty: 'fitness_coach',
        canceledReason: null,
        sourceInviteCodeId: 'invite-fitness',
        createdAt: timestamp,
        updatedAt: timestamp,
        endedAt: null,
      },
    ],
    connectionInviteGuards: [
      {
        id: 'guard-1',
        connectionId: 'connection-1',
        professionalAuthUid: coach,
        studentAuthUid: student,
        specialty: 'fitness_coach',
        status: 'pending_confirmation',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    pendingStudents: [
      {
        id: 'pending-1',
        professionalAuthUid: coach,
        studentAuthUid: student,
        slotId: 'slot-1',
        nutritionistConnectionId: null,
        fitnessCoachConnectionId: 'connection-1',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    pendingStudentSlots: [
      {
        id: 'coach-slot-1',
        professionalAuthUid: coach,
        slotId: 'slot-1',
        studentAuthUid: student,
        updatedAt: timestamp,
      },
    ],
    trackingAccess: [],
    activeSpecialties: [],
  };
}

function snapshot(coachUpdatedAt = timestamp): OwnedConnectionSnapshot {
  const value = rows();
  value.userProfiles = value.userProfiles.map((profile) =>
    profile.authUid === coach ? { ...profile, updatedAt: coachUpdatedAt } : profile,
  );
  return {
    schemaVersion: 1,
    kind: 'connection-snapshot-v1',
    runId,
    scope,
    readOnly: true,
    fixtureAuthUids: [...fixtureAuthUids],
    target: { professionalAuthUid: coach, studentAuthUid: student, specialty: 'fitness_coach' },
    rowCounts: Object.fromEntries(
      Object.entries(value).map(([name, values]) => [name, values.length]),
    ) as OwnedConnectionSnapshot['rowCounts'],
    rows: value,
  };
}

function evidence(
  label: (typeof sessionProfileSnapshotLabels)[number],
  value: OwnedConnectionSnapshot,
): SessionProfileSnapshotEvidence {
  const paths = {
    'before-login': 'session-sql-before-login.private.json',
    'after-initial-login': 'session-sql-after-initial-login.private.json',
    'after-restore': 'session-sql-after-restore.private.json',
    'after-signed-out-relaunch': 'session-sql-after-signed-out-relaunch.private.json',
  } as const;
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    label,
    snapshot: value,
    bytes,
    receipt: {
      path: paths[label],
      sha256: hash(bytes),
      bytes: bytes.length,
      runId,
      scope,
      ownedRunId: runId,
      apiPid: expectedApiIdentity.apiPid,
      targetOrigin: expectedApiIdentity.targetOrigin,
      fixtureAuthUidAllowlistHash,
    },
  };
}

const signInObservation = {
  requestId: 10,
  method: 'POST',
  pathHash: hash('/auth/email/sign-in'),
  requestOrigin: null,
  requestProfile: 'native' as const,
  targetOrigin: expectedApiIdentity.targetOrigin,
  status: 201,
  outcome: 'forwarded' as const,
  faultAttemptId: null,
  elapsedMs: 10,
};
const restoreObservation = {
  requestId: 20,
  method: 'POST',
  pathHash: hash('/me/hydrate'),
  requestOrigin: null,
  requestProfile: 'native' as const,
  targetOrigin: expectedApiIdentity.targetOrigin,
  status: 200,
  outcome: 'forwarded' as const,
  faultAttemptId: null,
  elapsedMs: 10,
};
const nativeAuthIdentity: NativeAuthIdentityObservation = {
  requestId: 10,
  ordinal: 1,
  targetOrigin: expectedApiIdentity.targetOrigin,
  apiPid: expectedApiIdentity.apiPid,
  status: 201,
  authUid: coach,
  verification: 'verified',
  verificationReason: 'verified',
  fixtureAuthUidAllowlistHash,
};

function makeInput(
  overrides: Partial<SessionProfileSupplementInput> = {},
): SessionProfileSupplementInput {
  return {
    fixtures,
    expectedApiIdentity,
    snapshots: {
      'before-login': evidence('before-login', snapshot()),
      'after-initial-login': evidence('after-initial-login', snapshot(loginTimestamp)),
      'after-restore': evidence('after-restore', snapshot(restoreTimestamp)),
      'after-signed-out-relaunch': evidence(
        'after-signed-out-relaunch',
        snapshot(restoreTimestamp),
      ),
    },
    signIn: {
      observations: [signInObservation],
      authIdentities: [nativeAuthIdentity],
      range: { afterRequestId: 0, throughRequestId: 10 },
    },
    restore: {
      observations: [restoreObservation],
      range: { afterRequestId: 10, throughRequestId: 20 },
    },
    ...overrides,
  };
}

void test('v5 accepts four owned profile snapshots and the two bounded native write spans', () => {
  const result = validateSessionProfileSnapshotSupplement(makeInput());
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.serverRevocationQualified, false);
  assert.equal(result.signInRequestId, 10);
  assert.equal(result.restoreHydrateRequestId, 20);
  assert.equal(result.noGetAssertion, true);
});

void test('v5 rejects missing profile rows and missing intermediate checkpoints', () => {
  const missingProfile = makeInput();
  const altered = snapshot(loginTimestamp);
  altered.rows.userProfiles = altered.rows.userProfiles.slice(1);
  missingProfile.snapshots['after-initial-login'] = evidence('after-initial-login', altered);
  assert.throws(
    () => validateSessionProfileSnapshotSupplement(missingProfile),
    /count|profile|fixture|target|identity/i,
  );

  const missingIntermediate = makeInput();
  delete (missingIntermediate.snapshots as Partial<typeof missingIntermediate.snapshots>)[
    'after-restore'
  ];
  assert.throws(
    () => validateSessionProfileSnapshotSupplement(missingIntermediate),
    /four profile snapshot labels|required/i,
  );
});

void test('v5 permits only coach updatedAt movement and rejects other profile or domain mutation', () => {
  const nonCoachMutation = makeInput();
  const changedStudent = snapshot(loginTimestamp);
  changedStudent.rows.userProfiles = changedStudent.rows.userProfiles.map((profile) =>
    profile.authUid === student ? { ...profile, acceptedTermsVersion: 'v2' } : profile,
  );
  nonCoachMutation.snapshots['after-initial-login'] = evidence(
    'after-initial-login',
    changedStudent,
  );
  assert.throws(
    () => validateSessionProfileSnapshotSupplement(nonCoachMutation),
    /non-coach|changed/i,
  );

  const coachFieldMutation = makeInput();
  const changedCoach = snapshot(loginTimestamp);
  changedCoach.rows.userProfiles = changedCoach.rows.userProfiles.map((profile) =>
    profile.authUid === coach ? { ...profile, acceptedTermsVersion: 'v2' } : profile,
  );
  coachFieldMutation.snapshots['after-initial-login'] = evidence(
    'after-initial-login',
    changedCoach,
  );
  assert.throws(
    () => validateSessionProfileSnapshotSupplement(coachFieldMutation),
    /coach|changed/i,
  );

  const domainMutation = makeInput();
  const changedDomain = snapshot(restoreTimestamp);
  changedDomain.rows.connections = changedDomain.rows.connections.map((row) => ({
    ...row,
    updatedAt: restoreTimestamp,
  }));
  domainMutation.snapshots['after-restore'] = evidence('after-restore', changedDomain);
  assert.throws(
    () => validateSessionProfileSnapshotSupplement(domainMutation),
    /connections|changed/i,
  );
});

void test('v5 rejects updatedAt regression or changed timestamp encoding', () => {
  const regressed = makeInput();
  regressed.snapshots['after-initial-login'] = evidence(
    'after-initial-login',
    snapshot('2026-09-30T23:59:59.000Z'),
  );
  assert.throws(() => validateSessionProfileSnapshotSupplement(regressed), /updatedAt|regress/i);

  const encoding = makeInput();
  const changed = snapshot(timestamp);
  changed.rows.userProfiles = changed.rows.userProfiles.map((profile) =>
    profile.authUid === coach ? { ...profile, updatedAt: '2026-10-01T00:00:00Z' } : profile,
  );
  encoding.snapshots['after-initial-login'] = evidence('after-initial-login', changed);
  assert.throws(() => validateSessionProfileSnapshotSupplement(encoding), /encoding|updatedAt/i);
});

void test('v5 binds exact POST status, origin, path and request ranges without asserting a GET', () => {
  const wrongHydrate = makeInput({
    restore: {
      observations: [{ ...restoreObservation, method: 'GET' }],
      range: { afterRequestId: 10, throughRequestId: 20 },
    },
  });
  assert.throws(
    () => validateSessionProfileSnapshotSupplement(wrongHydrate),
    /hydrate|native POST/i,
  );

  const wrongStatus = makeInput({
    restore: {
      observations: [{ ...restoreObservation, status: 201 }],
      range: { afterRequestId: 10, throughRequestId: 20 },
    },
  });
  assert.throws(() => validateSessionProfileSnapshotSupplement(wrongStatus), /hydrate|200/i);

  const overlapping = makeInput({
    restore: {
      observations: [restoreObservation],
      range: { afterRequestId: 9, throughRequestId: 20 },
    },
  });
  assert.throws(() => validateSessionProfileSnapshotSupplement(overlapping), /overlaps|range/i);
});

void test('v5 rejects receipt bytes, hashes, paths and API or fixture provenance tampering', () => {
  const bytesTampered = makeInput();
  bytesTampered.snapshots['after-restore'].bytes = Buffer.from('tampered');
  assert.throws(() => validateSessionProfileSnapshotSupplement(bytesTampered), /bytes|hash/i);

  const pathTampered = makeInput();
  pathTampered.snapshots['after-restore'].receipt.path = 'wrong.private.json';
  assert.throws(() => validateSessionProfileSnapshotSupplement(pathTampered), /path/i);

  const provenanceTampered = makeInput();
  provenanceTampered.snapshots['after-restore'].receipt.apiPid = 9999;
  assert.throws(() => validateSessionProfileSnapshotSupplement(provenanceTampered), /API pid/i);

  const finalChanged = makeInput();
  const finalSnapshot = snapshot(restoreTimestamp);
  finalSnapshot.rows.userProfiles = finalSnapshot.rows.userProfiles.map((profile) =>
    profile.authUid === coach ? { ...profile, updatedAt: loginTimestamp } : profile,
  );
  finalChanged.snapshots['after-signed-out-relaunch'] = evidence(
    'after-signed-out-relaunch',
    finalSnapshot,
  );
  assert.throws(
    () => validateSessionProfileSnapshotSupplement(finalChanged),
    /post-restore|logout/i,
  );
});
