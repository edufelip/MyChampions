import assert from 'node:assert/strict';
import test from 'node:test';
import { requireAndroidCameraTrainingTransition } from '../../scripts/testing/native-camera-android-observation';

type Row = Record<string, unknown>;
type TrainingSession = Row & { items: unknown[] };
type TrainingPlan = Row & { sessions: TrainingSession[] };

type Domain = {
  schemaVersion: 1;
  runId: string;
  scope: string;
  readOnly: true;
  trainingPlans: TrainingPlan[];
  connections: Row[];
};

const coach = 'coach-fixture';
const student = 'student-fixture';
const foreignCoach = 'foreign-coach';
const foreignStudent = 'foreign-student';
const targetId = 'target-pending';
const foreignId = 'foreign-active';
const inviteCode = 'AB12CD34';

function connectionRow(id: string, overrides: Row = {}): Row {
  return {
    id,
    professionalAuthUid: id === foreignId ? foreignCoach : coach,
    studentAuthUid: id === foreignId ? foreignStudent : student,
    status: id === targetId ? 'pending_confirmation' : 'active',
    specialty: 'fitness_coach',
    canceledReason: null,
    sourceInviteCodeId: 'coach_fitness_coach',
    sourceInviteCodeValue: id === foreignId ? 'FOREIGNCODE' : inviteCode,
    createdAt: '2026-10-05T10:38:04.000Z',
    updatedAt: id === targetId ? '2026-10-05T10:47:30.218Z' : '2026-10-05T10:38:04.000Z',
    endedAt: null,
    ...overrides,
  };
}

function domain(connections: Row[]): Domain {
  return {
    schemaVersion: 1,
    runId: 'run-camera-v30',
    scope: 'native-entry-android',
    readOnly: true,
    trainingPlans: [
      {
        id: 'training-plan-1',
        studentAuthUid: student,
        ownerProfessionalUid: coach,
        sourceKind: 'predefined',
        name: 'QA native-entry-android Training',
        isArchived: false,
        isDraft: false,
        lifecycleConnectionId: null,
        createdAt: '2026-10-05T10:38:04.000Z',
        updatedAt: '2026-10-05T10:38:04.000Z',
        sessions: [{ id: 'qa-session', items: [{ id: 'qa-item' }] }],
      },
    ],
    connections,
  };
}

function sqlConnectionSnapshot(connections: Row[]) {
  return {
    target: {
      professionalAuthUid: coach,
      studentAuthUid: student,
      specialty: 'fitness_coach' as const,
    },
    rows: { connections: connections.map(({ sourceInviteCodeValue: _value, ...row }) => row) },
  } as never;
}

const beforeRows = [
  connectionRow(foreignId),
  connectionRow('existing-pending', {
    studentAuthUid: 'pending-student',
    status: 'pending_confirmation',
  }),
];
const pendingRows = [...beforeRows, connectionRow(targetId)];
const beforeDomain = domain(beforeRows);
const afterDomain = domain(pendingRows);
const beforeConnection = sqlConnectionSnapshot(beforeRows);
const pendingConnection = sqlConnectionSnapshot(pendingRows);

void test('Android projection allows only the observed target pending connection', () => {
  assert.throws(() => assert.deepEqual(afterDomain, beforeDomain));
  const beforeBytes = structuredClone(beforeDomain);
  const afterBytes = structuredClone(afterDomain);
  assert.doesNotThrow(() =>
    requireAndroidCameraTrainingTransition({
      beforeDomain,
      afterDomain,
      beforeConnection,
      pendingConnection,
      inviteCode,
    }),
  );
  assert.deepEqual(beforeDomain, beforeBytes);
  assert.deepEqual(afterDomain, afterBytes);
});

void test('Android projection rejects foreign connection and plan mutations', () => {
  const foreignMutation = structuredClone(afterDomain);
  foreignMutation.connections[0].status = 'ended';
  assert.throws(
    () =>
      requireAndroidCameraTrainingTransition({
        beforeDomain,
        afterDomain: foreignMutation,
        beforeConnection,
        pendingConnection,
        inviteCode,
      }),
    /not bound to the pending SQL snapshot/,
  );

  const planMutation = structuredClone(afterDomain);
  const plan = planMutation.trainingPlans[0];
  assert(plan);
  const session = plan.sessions[0];
  assert(session);
  session.items = [{ id: 'mutated-item' }];
  assert.throws(
    () =>
      requireAndroidCameraTrainingTransition({
        beforeDomain,
        afterDomain: planMutation,
        beforeConnection,
        pendingConnection,
        inviteCode,
      }),
    /Android camera changed unrelated training state/,
  );

  const targetCodeMutation = structuredClone(afterDomain);
  targetCodeMutation.connections[2].sourceInviteCodeValue = 'WRONGCODE';
  assert.throws(
    () =>
      requireAndroidCameraTrainingTransition({
        beforeDomain,
        afterDomain: targetCodeMutation,
        beforeConnection,
        pendingConnection,
        inviteCode,
      }),
    /source invite value is not bound/,
  );
});

void test('Android projection rejects an arbitrary extra connection', () => {
  const extraConnection = structuredClone(afterDomain);
  extraConnection.connections.push(
    connectionRow('arbitrary-extra', {
      professionalAuthUid: foreignCoach,
      studentAuthUid: foreignStudent,
      sourceInviteCodeValue: 'FOREIGNCODE',
    }),
  );
  assert.throws(
    () =>
      requireAndroidCameraTrainingTransition({
        beforeDomain,
        afterDomain: extraConnection,
        beforeConnection,
        pendingConnection,
        inviteCode,
      }),
    /not bound to the pending SQL snapshot/,
  );
});
