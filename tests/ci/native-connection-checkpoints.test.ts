import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  verifyConnectionAuthCheckpoint,
  verifyConnectionConfirmationSnapshotTransition,
  verifyConnectionSubmissionSnapshotTransition,
  verifyNativeConnectionJourney,
  type ConnectionAuthIdentityObservation,
  type ConnectionAuthTransportObservation,
} from '../../scripts/testing/native-connection-checkpoints';
import type {
  ConnectionSnapshotRows,
  OwnedConnectionSnapshot,
} from '../../scripts/testing/native-connection-snapshot';

const runId = 'a'.repeat(24);
const scope = 'connection-checkpoints';
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
const coachAuthenticatedAt = '2026-10-01T00:00:01.000Z';
const studentAuthenticatedAt = '2026-10-01T00:00:02.000Z';
const expectedApiIdentity = { targetOrigin: 'http://127.0.0.1:19001', apiPid: 1234 };

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

const fixtureAuthUidAllowlistHash = hash(JSON.stringify(fixtureAuthUids));

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
    connections: [],
    connectionInviteGuards: [],
    pendingStudents: [],
    pendingStudentSlots: [
      {
        id: 'coach-slot-1',
        professionalAuthUid: coach,
        slotId: 'slot-1',
        studentAuthUid: null,
        updatedAt: timestamp,
      },
    ],
    trackingAccess: [],
    activeSpecialties: [],
  };
}

function snapshot(next: Partial<ConnectionSnapshotRows> = {}): OwnedConnectionSnapshot {
  const value = { ...rows(), ...next };
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

const connection = {
  id: 'connection-1',
  professionalAuthUid: coach,
  studentAuthUid: student,
  status: 'pending_confirmation' as const,
  specialty: 'fitness_coach' as const,
  canceledReason: null,
  sourceInviteCodeId: 'invite-fitness',
  createdAt: timestamp,
  updatedAt: timestamp,
  endedAt: null,
};
const guard = {
  id: 'guard-1',
  connectionId: connection.id,
  professionalAuthUid: coach,
  studentAuthUid: student,
  specialty: 'fitness_coach' as const,
  status: 'pending_confirmation' as const,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const pendingStudent = {
  id: 'pending-1',
  professionalAuthUid: coach,
  studentAuthUid: student,
  slotId: 'slot-1',
  nutritionistConnectionId: null,
  fitnessCoachConnectionId: connection.id,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const pendingSlot = {
  id: 'coach-slot-1',
  professionalAuthUid: coach,
  slotId: 'slot-1',
  studentAuthUid: student,
  updatedAt: timestamp,
};

function beforeSnapshot() {
  return snapshot();
}

function pendingSnapshot(updated?: Partial<ConnectionSnapshotRows['userProfiles'][number]>) {
  return snapshot({
    userProfiles: rows().userProfiles.map((profile) =>
      profile.authUid === coach && updated ? { ...profile, ...updated } : profile,
    ),
    connections: [connection],
    connectionInviteGuards: [guard],
    pendingStudents: [pendingStudent],
    pendingStudentSlots: [pendingSlot],
  });
}

function activeSnapshot(
  updatedProfiles: Partial<ConnectionSnapshotRows['userProfiles'][number]> = {},
) {
  return snapshot({
    userProfiles: rows().userProfiles.map((profile) => ({
      ...profile,
      ...(profile.authUid === coach ? updatedProfiles : {}),
    })),
    connections: [{ ...connection, status: 'active', updatedAt: coachAuthenticatedAt }],
    pendingStudents: [
      {
        ...pendingStudent,
        fitnessCoachConnectionId: null,
        updatedAt: coachAuthenticatedAt,
      },
    ],
    pendingStudentSlots: [
      { ...pendingSlot, studentAuthUid: null, updatedAt: coachAuthenticatedAt },
    ],
    trackingAccess: [
      {
        id: 'tracking-1',
        studentAuthUid: student,
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        connectionId: connection.id,
        status: 'active',
        updatedAt: coachAuthenticatedAt,
      },
    ],
    activeSpecialties: [
      {
        id: 'active-1',
        studentAuthUid: student,
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        connectionId: connection.id,
        status: 'active',
        updatedAt: coachAuthenticatedAt,
      },
    ],
  });
}

const fixtures = {
  accounts: {
    coach: { authUid: coach },
    student: { authUid: student },
    new: { authUid: 'auth-new' },
    'pending-student': { authUid: 'auth-pending' },
    'active-student': { authUid: 'auth-active' },
    'unrelated-coach': { authUid: 'auth-unrelated-coach' },
    'unrelated-student': { authUid: 'auth-unrelated-student' },
  },
} as never;

function observations(): ConnectionAuthTransportObservation[] {
  return [
    {
      requestId: 1,
      method: 'GET',
      pathHash: hash('/connections'),
      requestOrigin: null,
      requestProfile: 'native',
      targetOrigin: 'http://127.0.0.1:19001',
      status: 200,
      outcome: 'forwarded',
      faultAttemptId: null,
    },
    {
      requestId: 2,
      method: 'POST',
      pathHash: hash('/auth/email/sign-in'),
      requestOrigin: null,
      requestProfile: 'native',
      targetOrigin: 'http://127.0.0.1:19001',
      status: 201,
      outcome: 'forwarded',
      faultAttemptId: null,
    },
    {
      requestId: 3,
      method: 'GET',
      pathHash: hash('/professional/students'),
      requestOrigin: null,
      requestProfile: 'native',
      targetOrigin: 'http://127.0.0.1:19001',
      status: 200,
      outcome: 'forwarded',
      faultAttemptId: null,
    },
    {
      requestId: 4,
      method: 'POST',
      pathHash: hash('/auth/email/sign-in'),
      requestOrigin: null,
      requestProfile: 'native',
      targetOrigin: 'http://127.0.0.1:19001',
      status: 201,
      outcome: 'forwarded',
      faultAttemptId: null,
    },
  ];
}

function authIdentities(): ConnectionAuthIdentityObservation[] {
  return [
    {
      requestId: 2,
      ordinal: 1,
      authUid: coach,
      targetOrigin: expectedApiIdentity.targetOrigin,
      apiPid: 1234,
      status: 201,
      verification: 'verified',
      verificationReason: 'verified',
      fixtureAuthUidAllowlistHash,
    },
    {
      requestId: 4,
      ordinal: 2,
      authUid: student,
      targetOrigin: expectedApiIdentity.targetOrigin,
      apiPid: 1234,
      status: 201,
      verification: 'verified',
      verificationReason: 'verified',
      fixtureAuthUidAllowlistHash,
    },
  ];
}

function coachAuthPending() {
  return pendingSnapshot({ updatedAt: coachAuthenticatedAt });
}

function studentAuthActive() {
  return snapshot({
    userProfiles: rows().userProfiles.map((profile) =>
      profile.authUid === coach
        ? { ...profile, updatedAt: coachAuthenticatedAt }
        : profile.authUid === student
          ? { ...profile, updatedAt: studentAuthenticatedAt }
          : profile,
    ),
    connections: [{ ...connection, status: 'active', updatedAt: coachAuthenticatedAt }],
    pendingStudents: [
      { ...pendingStudent, fitnessCoachConnectionId: null, updatedAt: coachAuthenticatedAt },
    ],
    pendingStudentSlots: [
      { ...pendingSlot, studentAuthUid: null, updatedAt: coachAuthenticatedAt },
    ],
    trackingAccess: [
      {
        id: 'tracking-1',
        studentAuthUid: student,
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        connectionId: connection.id,
        status: 'active',
        updatedAt: coachAuthenticatedAt,
      },
    ],
    activeSpecialties: [
      {
        id: 'active-1',
        studentAuthUid: student,
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        connectionId: connection.id,
        status: 'active',
        updatedAt: coachAuthenticatedAt,
      },
    ],
  });
}

void test('connection causal phases preserve target identity and compose with explicit auth spans', () => {
  const before = beforeSnapshot();
  const pending = pendingSnapshot();
  const pendingAfterCoachAuth = coachAuthPending();
  const active = activeSnapshot({ updatedAt: coachAuthenticatedAt });
  const activeAfterStudentAuth = studentAuthActive();

  verifyConnectionSubmissionSnapshotTransition({ before, pending, fixtures });
  verifyConnectionAuthCheckpoint({
    before: pending,
    after: pendingAfterCoachAuth,
    fixtures,
    actor: 'coach',
    checkpoint: 'pending',
    observations: observations(),
    authIdentities: authIdentities(),
    expectedApiIdentity,
    afterRequestId: 1,
    throughRequestId: 2,
  });
  verifyConnectionConfirmationSnapshotTransition({
    pending: pendingAfterCoachAuth,
    active,
    fixtures,
  });
  const result = verifyNativeConnectionJourney({
    before,
    pending,
    pendingAfterCoachAuth,
    active,
    activeAfterStudentAuth,
    fixtures,
    observations: observations(),
    authIdentities: authIdentities(),
    expectedApiIdentity,
    coachAuth: { afterRequestId: 1, throughRequestId: 2 },
    studentAuth: { afterRequestId: 3, throughRequestId: 4 },
  });
  assert.equal(result.coachAuth.actorAuthUid, coach);
  assert.equal(result.coachAuth.matchedObservation.requestId, 2);
  assert.equal(result.studentAuth.actorAuthUid, student);
  assert.equal(result.studentAuth.matchedObservation.requestId, 4);
  assert.equal(result.coachAuth.actorIdentity, 'verified-from-owned-native-auth-identity');
  assert.equal(result.studentAuth.transportPrincipal, 'proxy-observation-has-no-principal-uid');
});

void test('auth checkpoint rejects profile, foreign-table and timestamp regressions', () => {
  const before = pendingSnapshot();
  const validAfter = coachAuthPending();
  const reject = (after: OwnedConnectionSnapshot, pattern: RegExp) =>
    assert.throws(
      () =>
        verifyConnectionAuthCheckpoint({
          before,
          after,
          fixtures,
          actor: 'coach',
          checkpoint: 'pending',
          observations: observations(),
          authIdentities: authIdentities(),
          expectedApiIdentity,
          afterRequestId: 1,
          throughRequestId: 2,
        }),
      pattern,
    );

  reject(
    snapshot({
      ...validAfter.rows,
      userProfiles: validAfter.rows.userProfiles.map((profile) =>
        profile.authUid === coach ? { ...profile, lockedRole: 'student' } : profile,
      ),
    }),
    /actor profile fields|role|profile/i,
  );
  reject(
    snapshot({
      ...validAfter.rows,
      userProfiles: validAfter.rows.userProfiles.map((profile) =>
        profile.authUid === student ? { ...profile, acceptedTermsVersion: 'v2' } : profile,
      ),
    }),
    /non-actor profile/i,
  );
  reject(
    snapshot({
      ...validAfter.rows,
      userProfiles: validAfter.rows.userProfiles.map((profile) =>
        profile.authUid === coach ? { ...profile, createdAt: coachAuthenticatedAt } : profile,
      ),
    }),
    /actor profile fields|createdAt/i,
  );
  reject(
    snapshot({
      ...validAfter.rows,
      trackingAccess: [
        {
          id: 'foreign-tracking',
          studentAuthUid: 'auth-pending',
          professionalAuthUid: coach,
          specialty: 'fitness_coach',
          connectionId: 'other-connection',
          status: 'active',
          updatedAt: timestamp,
        },
      ],
    }),
    /non-profile trackingAccess/i,
  );
  for (const name of [
    'professionalSpecialties',
    'inviteCodes',
    'connections',
    'connectionInviteGuards',
    'pendingStudents',
    'pendingStudentSlots',
  ] as const) {
    const changedRows = structuredClone(validAfter.rows);
    const first = (changedRows[name] as unknown as { updatedAt: string }[])[0];
    first.updatedAt = coachAuthenticatedAt;
    reject(snapshot(changedRows), new RegExp(`non-profile ${name}`));
  }
  reject(
    snapshot({
      ...validAfter.rows,
      activeSpecialties: [
        {
          id: 'foreign-active',
          studentAuthUid: 'auth-pending',
          professionalAuthUid: 'auth-unrelated-coach',
          specialty: 'fitness_coach',
          connectionId: 'other-connection',
          status: 'active',
          updatedAt: timestamp,
        },
      ],
    }),
    /non-profile activeSpecialties/i,
  );
  reject(pendingSnapshot({ updatedAt: '2026-09-30T23:59:59.000Z' }), /updatedAt regressed/i);
});

void test('auth checkpoint requires one bounded forwarded native sign-in observation', () => {
  const before = pendingSnapshot();
  const after = coachAuthPending();
  const base = observations();
  const check = (
    records: ConnectionAuthTransportObservation[],
    window = { afterRequestId: 1, throughRequestId: 2 },
  ) =>
    assert.throws(
      () =>
        verifyConnectionAuthCheckpoint({
          before,
          after,
          fixtures,
          actor: 'coach',
          checkpoint: 'pending',
          observations: records,
          authIdentities: authIdentities(),
          expectedApiIdentity,
          ...window,
        }),
      /sign-in|observation|ordinal|transport/i,
    );

  check([]);
  check([...base, { ...base[1], requestId: 5 }], { afterRequestId: 1, throughRequestId: 5 });
  check(
    base.map((row) => (row.requestId === 2 ? { ...row, pathHash: hash('/connections') } : row)),
  );
  check(base.map((row) => (row.requestId === 2 ? { ...row, outcome: 'injected' } : row)));
  check(base.map((row) => (row.requestId === 2 ? { ...row, requestProfile: 'browser' } : row)));
  check(base.map((row) => (row.requestId === 2 ? { ...row, status: 503 } : row)));
  check(base, { afterRequestId: 2, throughRequestId: 3 });
  check(base, { afterRequestId: 1, throughRequestId: 1 });
  assert.throws(
    () =>
      verifyConnectionAuthCheckpoint({
        before,
        after,
        fixtures,
        actor: 'coach',
        checkpoint: 'pending',
        observations: base,
        authIdentities: [],
        expectedApiIdentity,
        afterRequestId: 1,
        throughRequestId: 2,
      }),
    /identity evidence|native identity/i,
  );
  assert.throws(
    () =>
      verifyConnectionAuthCheckpoint({
        before,
        after,
        fixtures,
        actor: 'coach',
        checkpoint: 'pending',
        observations: base,
        authIdentities: authIdentities().map((identity) =>
          identity.requestId === 2 ? { ...identity, authUid: student } : identity,
        ),
        expectedApiIdentity,
        afterRequestId: 1,
        throughRequestId: 2,
      }),
    /authenticated fixture identity mismatch/i,
  );
  assert.throws(
    () =>
      verifyConnectionAuthCheckpoint({
        before,
        after,
        fixtures,
        actor: 'coach',
        checkpoint: 'pending',
        observations: base,
        authIdentities: authIdentities().map((identity) =>
          identity.requestId === 2 ? { ...identity, requestId: 5 } : identity,
        ),
        expectedApiIdentity,
        afterRequestId: 1,
        throughRequestId: 2,
      }),
    /request binding is not unique/i,
  );
  assert.throws(
    () =>
      verifyConnectionAuthCheckpoint({
        before,
        after,
        fixtures,
        actor: 'coach',
        checkpoint: 'pending',
        observations: base,
        authIdentities: authIdentities().map((identity) =>
          identity.requestId === 2
            ? { ...identity, targetOrigin: 'http://127.0.0.1:19002' }
            : identity,
        ),
        expectedApiIdentity,
        afterRequestId: 1,
        throughRequestId: 2,
      }),
    /target mismatch/i,
  );
  assert.throws(
    () =>
      verifyConnectionAuthCheckpoint({
        before,
        after,
        fixtures,
        actor: 'coach',
        checkpoint: 'pending',
        observations: base,
        authIdentities: authIdentities(),
        expectedApiIdentity: { ...expectedApiIdentity, apiPid: 4321 },
        afterRequestId: 1,
        throughRequestId: 2,
      }),
    /does not match the owned API/i,
  );
  assert.throws(
    () =>
      verifyConnectionAuthCheckpoint({
        before,
        after,
        fixtures,
        actor: 'coach',
        checkpoint: 'pending',
        observations: base,
        authIdentities: authIdentities().map((identity) =>
          identity.requestId === 2
            ? {
                ...identity,
                fixtureAuthUidAllowlistHash: hash(
                  JSON.stringify([...fixtureAuthUids, 'auth-foreign'].sort()),
                ),
              }
            : identity,
        ),
        expectedApiIdentity,
        afterRequestId: 1,
        throughRequestId: 2,
      }),
    /identity evidence is invalid/i,
  );
  assert.throws(
    () =>
      verifyConnectionAuthCheckpoint({
        before,
        after,
        fixtures,
        actor: 'coach',
        checkpoint: 'pending',
        observations: base,
        authIdentities: authIdentities().map((identity) =>
          identity.requestId === 4 ? { ...identity, ordinal: 1 } : identity,
        ),
        expectedApiIdentity,
        afterRequestId: 1,
        throughRequestId: 2,
      }),
    /identity evidence is invalid/i,
  );
  assert.throws(
    () =>
      verifyConnectionAuthCheckpoint({
        before,
        after,
        fixtures,
        actor: 'coach',
        checkpoint: 'pending',
        observations: base,
        authIdentities: authIdentities().map((identity) =>
          identity.requestId === 2 ? { ...identity, verification: 'unverified' } : identity,
        ),
        expectedApiIdentity,
        afterRequestId: 1,
        throughRequestId: 2,
      }),
    /authenticated fixture identity mismatch|identity evidence is invalid/i,
  );
});

void test('causal validators reject mixed phases, wrong actor and target/provenance mutations', () => {
  const before = beforeSnapshot();
  const pending = pendingSnapshot();
  const active = activeSnapshot({ updatedAt: coachAuthenticatedAt });
  assert.throws(
    () =>
      verifyConnectionSubmissionSnapshotTransition({ before: pending, pending: active, fixtures }),
    /causal|unlinked|phase|target/i,
  );
  assert.throws(
    () => verifyConnectionConfirmationSnapshotTransition({ pending: before, active, fixtures }),
    /pending|target|connection/i,
  );
  assert.throws(
    () =>
      verifyConnectionAuthCheckpoint({
        before: pending,
        after: pending,
        fixtures,
        actor: 'student',
        checkpoint: 'pending',
        observations: observations(),
        authIdentities: authIdentities(),
        expectedApiIdentity,
        afterRequestId: 1,
        throughRequestId: 2,
      }),
    /actor|causal/i,
  );
  assert.throws(
    () =>
      verifyConnectionConfirmationSnapshotTransition({
        pending: pending,
        active: snapshot({
          ...active.rows,
          connections: [{ ...active.rows.connections[0], sourceInviteCodeId: 'foreign-invite' }],
        }),
        fixtures,
      }),
    /provenance|connection|invite/i,
  );
  assert.throws(
    () =>
      verifyConnectionSubmissionSnapshotTransition({
        before,
        pending: snapshot({
          ...pending.rows,
          pendingStudentSlots: [{ ...pendingSlot, id: 'foreign-slot' }],
        }),
        fixtures,
      }),
    /slot|identity|transition/i,
  );
});
