import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requireConnectionSnapshot,
  verifyConnectionSnapshotCheckpoint,
  verifyConnectionSnapshotPhaseTransition,
  verifyConnectionSnapshotTransition,
  type ConnectionSnapshotRows,
  type OwnedConnectionSnapshot,
} from '../../scripts/testing/native-connection-snapshot';

const runId = 'a'.repeat(24);
const scope = 'connection-test';
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
        id: 'coach_slot-1',
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
  id: 'coach_slot-1',
  professionalAuthUid: coach,
  slotId: 'slot-1',
  studentAuthUid: student,
  updatedAt: timestamp,
};

function pendingSnapshot() {
  return snapshot({
    connections: [connection],
    connectionInviteGuards: [guard],
    pendingStudents: [pendingStudent],
    pendingStudentSlots: [pendingSlot],
  });
}

function activeSnapshot() {
  return snapshot({
    connections: [{ ...connection, status: 'active', updatedAt: '2026-10-01T00:00:01.000Z' }],
    pendingStudents: [
      {
        ...pendingStudent,
        fitnessCoachConnectionId: null,
        updatedAt: '2026-10-01T00:00:01.000Z',
      },
    ],
    pendingStudentSlots: [
      { ...pendingSlot, studentAuthUid: null, updatedAt: '2026-10-01T00:00:01.000Z' },
    ],
    trackingAccess: [
      {
        id: 'tracking-1',
        studentAuthUid: student,
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        connectionId: connection.id,
        status: 'active',
        updatedAt: '2026-10-01T00:00:01.000Z',
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
        updatedAt: '2026-10-01T00:00:01.000Z',
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

void test('connection snapshot projection accepts exact identities and rejects recomputed counts', () => {
  const value = pendingSnapshot();
  assert.deepEqual(
    requireConnectionSnapshot(value, {
      runId,
      scope,
      fixtureAuthUids,
      target: { professionalAuthUid: coach, studentAuthUid: student },
    }),
    value,
  );
  for (const invalid of [
    { ...value, readOnly: false },
    { ...value, fixtureAuthUids: [...value.fixtureAuthUids].reverse() },
    { ...value, fixtureAuthUids: [...fixtureAuthUids, 'auth-extra'] },
    { ...value, target: { ...value.target, studentAuthUid: coach } },
    { ...value, rowCounts: { ...value.rowCounts, connections: 0 } },
    { ...value, rows: { ...value.rows, connections: [{ ...connection }, { ...connection }] } },
  ])
    assert.throws(
      () => requireConnectionSnapshot(invalid, { runId, scope, fixtureAuthUids }),
      /snapshot|target|count|rows|invite/,
    );
});

void test('connection snapshots reject relationship endpoints outside the trusted fixture set', () => {
  const base = rows();
  const active = activeSnapshot();
  const foreign = 'auth-foreign';
  const invalidRows: [string, Partial<ConnectionSnapshotRows>][] = [
    ['profile owner', { userProfiles: [{ ...base.userProfiles[0], authUid: foreign }] }],
    [
      'professional specialty owner',
      {
        professionalSpecialties: [
          { ...base.professionalSpecialties[0], professionalAuthUid: foreign },
        ],
      },
    ],
    ['invite owner', { inviteCodes: [{ ...base.inviteCodes[0], professionalAuthUid: foreign }] }],
    ['connection endpoint', { connections: [{ ...connection, professionalAuthUid: foreign }] }],
    ['invite guard endpoint', { connectionInviteGuards: [{ ...guard, studentAuthUid: foreign }] }],
    [
      'pending student endpoint',
      { pendingStudents: [{ ...pendingStudent, studentAuthUid: foreign }] },
    ],
    [
      'pending slot endpoint',
      { pendingStudentSlots: [{ ...pendingSlot, studentAuthUid: foreign }] },
    ],
    [
      'tracking access endpoint',
      { trackingAccess: [{ ...active.rows.trackingAccess[0], studentAuthUid: foreign }] },
    ],
    [
      'active specialty endpoint',
      {
        activeSpecialties: [{ ...active.rows.activeSpecialties[0], professionalAuthUid: foreign }],
      },
    ],
  ];
  for (const [label, replacement] of invalidRows)
    assert.throws(
      () => requireConnectionSnapshot(snapshot(replacement)),
      /out-of-fixture identity/,
      label,
    );

  const foreignBaseline = snapshot({
    trackingAccess: [{ ...active.rows.trackingAccess[0], studentAuthUid: foreign }],
  });
  assert.throws(
    () =>
      verifyConnectionSnapshotTransition({
        before: foreignBaseline,
        pending: pendingSnapshot(),
        active,
        fixtures,
      }),
    /out-of-fixture identity/,
  );
});

void test('connection lifecycle verifier requires unlinked, pending and active persistence deltas', () => {
  const before = snapshot();
  const pending = pendingSnapshot();
  const active = activeSnapshot();
  const expected = {
    runId,
    scope,
    fixtureAuthUids,
    professionalAuthUid: coach,
    studentAuthUid: student,
  };
  verifyConnectionSnapshotCheckpoint({ snapshot: before, checkpoint: 'unlinked', expected });
  verifyConnectionSnapshotCheckpoint({ snapshot: pending, checkpoint: 'pending', expected });
  verifyConnectionSnapshotCheckpoint({ snapshot: active, checkpoint: 'active', expected });
  verifyConnectionSnapshotTransition({ before, pending, active, fixtures });

  assert.throws(
    () => verifyConnectionSnapshotCheckpoint({ snapshot: active, checkpoint: 'pending', expected }),
    /Pending|premature|occupied|exact target provenance/,
  );
  assert.throws(
    () =>
      verifyConnectionSnapshotCheckpoint({
        snapshot: snapshot({ connections: [{ ...connection, sourceInviteCodeId: null }] }),
        checkpoint: 'pending',
        expected,
      }),
    /exact target provenance/,
  );
  assert.throws(
    () =>
      verifyConnectionSnapshotTransition({
        before,
        pending: snapshot({
          ...pending.rows,
          pendingStudentSlots: [{ ...pendingSlot, studentAuthUid: 'foreign-student' }],
        }),
        active,
        fixtures,
      }),
    /occupied target slot|non-target|retained|transition|out-of-fixture/,
  );
  assert.throws(
    () =>
      verifyConnectionSnapshotTransition({
        before,
        pending,
        active: snapshot({
          ...active.rows,
          trackingAccess: [
            {
              ...active.rows.trackingAccess[0],
              connectionId: 'foreign-connection',
            },
          ],
        }),
        fixtures,
      }),
    /durable access|target|snapshot/,
  );
  assert.throws(
    () =>
      verifyConnectionSnapshotTransition({
        before: snapshot({
          connectionInviteGuards: [{ ...guard, studentAuthUid: 'auth-pending' }],
        }),
        pending,
        active,
        fixtures,
      }),
    /non-target connectionInviteGuards|transition/,
  );
  assert.throws(
    () =>
      verifyConnectionSnapshotTransition({
        before,
        pending,
        active: snapshot({
          ...active.rows,
          trackingAccess: [
            ...active.rows.trackingAccess,
            {
              ...active.rows.trackingAccess[0],
              id: 'tracking-rogue',
              specialty: 'nutritionist',
              connectionId: 'seeded-other-connection',
            },
          ],
        }),
        fixtures,
      }),
    /durable access|target|snapshot/,
  );
  assert.throws(
    () =>
      verifyConnectionSnapshotTransition({
        before,
        pending,
        active: snapshot({
          ...active.rows,
          pendingStudentSlots: [{ ...active.rows.pendingStudentSlots[0], id: 'other-slot' }],
        }),
        fixtures,
      }),
    /retained|slot|transition/,
  );
});

void test('connection submission tolerates a sign-in profile touch but no other profile change', () => {
  const before = snapshot();
  const pending = pendingSnapshot();
  const touched = (mutate: (row: ConnectionSnapshotRows['userProfiles'][number]) => object) =>
    snapshot({
      ...pending.rows,
      userProfiles: pending.rows.userProfiles.map((row) =>
        row.authUid === student || row.authUid === coach ? { ...row, ...mutate(row) } : row,
      ),
    });
  const verify = (after: OwnedConnectionSnapshot) =>
    verifyConnectionSnapshotPhaseTransition({
      before,
      after,
      beforeCheckpoint: 'unlinked',
      afterCheckpoint: 'pending',
      requirePreexistingSlot: false,
      fixtures,
    });

  // Real run 3cad834993a3965a9b78fd80: both actors signed in during the journey.
  verify(touched(() => ({ updatedAt: '2026-10-01 00:01:05.439+00' })));
  assert.throws(
    () => verify(touched(() => ({ updatedAt: '2025-09-30T00:00:00.000Z' }))),
    /changed target profiles/,
  );
  assert.throws(
    () => verify(touched(() => ({ updatedAt: 'not-a-timestamp' }))),
    /changed target profiles/,
  );
  assert.throws(
    () => verify(touched(() => ({ acceptedTermsVersion: 'v2' }))),
    /changed target profiles/,
  );
  assert.throws(
    () =>
      verify(
        touched((row) => ({
          lockedRole: row.lockedRole === 'student' ? 'professional' : 'student',
        })),
      ),
    /target profiles/,
  );
});
