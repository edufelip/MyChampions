import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requireDetoxConnectionActionRequest,
  runDetoxConnectionAction,
} from '../../scripts/testing/detox-connection-actionability';
import type { DetoxElementAttributesResult } from '../../scripts/testing/detox-native-hierarchy';
import type { NativeConnectionTargetScope } from '../../scripts/testing/native-connection-hierarchy';
import type {
  ConnectionSnapshotRows,
  OwnedConnectionSnapshot,
} from '../../scripts/testing/native-connection-snapshot';

const runId = 'a'.repeat(24);
const scope = 'detox-connection-actionability';
const coach = 'auth-coach';
const student = 'auth-student';
const connectionId = 'connection-target';
const timestamp = '2026-10-01T00:00:00.000Z';
const fixtureAuthUids = [coach, student];

const target: NativeConnectionTargetScope = {
  runId,
  scope,
  fixtureAuthUids,
  professionalAuthUid: coach,
  studentAuthUid: student,
};

function rows(next: Partial<ConnectionSnapshotRows> = {}): ConnectionSnapshotRows {
  return {
    userProfiles: [
      {
        authUid: coach,
        lockedRole: 'professional',
        acceptedTermsVersion: 'v1',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        authUid: student,
        lockedRole: 'student',
        acceptedTermsVersion: 'v1',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    professionalSpecialties: [
      {
        id: 'specialty-coach',
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    inviteCodes: [
      {
        id: 'invite-coach',
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
    pendingStudentSlots: [],
    trackingAccess: [],
    activeSpecialties: [],
    ...next,
  };
}

function snapshot(next: Partial<ConnectionSnapshotRows> = {}): OwnedConnectionSnapshot {
  const value = rows(next);
  return {
    schemaVersion: 1,
    kind: 'connection-snapshot-v1',
    runId,
    scope,
    readOnly: true,
    fixtureAuthUids,
    target: { professionalAuthUid: coach, studentAuthUid: student, specialty: 'fitness_coach' },
    rowCounts: Object.fromEntries(
      Object.entries(value).map(([name, entries]) => [name, entries.length]),
    ) as OwnedConnectionSnapshot['rowCounts'],
    rows: value,
  };
}

const pendingConnection = {
  id: connectionId,
  professionalAuthUid: coach,
  studentAuthUid: student,
  status: 'pending_confirmation' as const,
  specialty: 'fitness_coach' as const,
  canceledReason: null,
  sourceInviteCodeId: 'invite-coach',
  createdAt: timestamp,
  updatedAt: timestamp,
  endedAt: null,
};

const pendingStudent = {
  id: 'pending-student',
  professionalAuthUid: coach,
  studentAuthUid: student,
  slotId: 'slot-coach',
  nutritionistConnectionId: null,
  fitnessCoachConnectionId: connectionId,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const pendingSlot = {
  id: 'slot-coach',
  professionalAuthUid: coach,
  slotId: 'slot-coach',
  studentAuthUid: student,
  updatedAt: timestamp,
};

const pendingGuard = {
  id: 'guard-target',
  connectionId,
  professionalAuthUid: coach,
  studentAuthUid: student,
  specialty: 'fitness_coach' as const,
  status: 'pending_confirmation' as const,
  createdAt: timestamp,
  updatedAt: timestamp,
};

function pendingSnapshot(): OwnedConnectionSnapshot {
  return snapshot({
    connections: [pendingConnection],
    connectionInviteGuards: [pendingGuard],
    pendingStudents: [pendingStudent],
    pendingStudentSlots: [pendingSlot],
  });
}

function activeSnapshot(): OwnedConnectionSnapshot {
  return snapshot({
    connections: [{ ...pendingConnection, status: 'active' as const }],
    pendingStudents: [{ ...pendingStudent, fitnessCoachConnectionId: null }],
    pendingStudentSlots: [{ ...pendingSlot, studentAuthUid: null }],
    trackingAccess: [
      {
        id: 'tracking-target',
        studentAuthUid: student,
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        connectionId,
        status: 'active',
        updatedAt: timestamp,
      },
    ],
    activeSpecialties: [
      {
        id: 'active-target',
        studentAuthUid: student,
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        connectionId,
        status: 'active',
        updatedAt: timestamp,
      },
    ],
  });
}

function pendingXml(): string {
  const row =
    '<Row class="Row" width="400" height="100" visibility="visible" alpha="1" focused="false" x="0" y="0" id="pro.pending.row.0">' +
    '<Label class="Label" width="180" height="20" visibility="visible" alpha="1" focused="false" x="10" y="10" text="connection-target" />' +
    '<Button class="Button" width="100" height="40" visibility="visible" alpha="1" focused="false" enabled="true" x="250" y="10" id="pro.pending.acceptButton.0" />' +
    '</Row>';
  return `<ViewHierarchy><UIWindow class="UIWindow" width="400" height="800" visibility="visible" alpha="1" focused="false" x="0" y="0"><UIView class="UIView" width="400" height="800" visibility="visible" alpha="1" focused="false" x="5" y="7" id="pro.pending.screen"><UIView class="UIView" width="400" height="400" visibility="visible" alpha="1" focused="false" x="10" y="11">${row}</UIView></UIView></UIWindow></ViewHierarchy>`;
}

function activeXml(): string {
  const marker =
    '<View class="View" width="20" height="20" visibility="visible" alpha="1" focused="false" x="10" y="10" id="student.professionals.activeConnection.connection-target" />';
  const unbind = `<Button class="Button" width="100" height="40" visibility="visible" alpha="1" focused="false" enabled="true" x="250" y="10" id="student.professionals.unbindButton.0">${marker}</Button>`;
  const card = `<Card class="Card" width="400" height="100" visibility="visible" alpha="1" focused="false" x="0" y="0" id="student.professionals.connectionCard.0">${unbind}</Card>`;
  return `<ViewHierarchy><UIWindow class="UIWindow" width="400" height="800" visibility="visible" alpha="1" focused="false"><UIView class="UIView" width="400" height="800" visibility="visible" alpha="1" focused="false" x="3" y="4" id="student.professionals.screen">${card}</UIView></UIWindow></ViewHierarchy>`;
}

function androidAttributes(identifier: string, visible = true): DetoxElementAttributesResult {
  return {
    identifier,
    enabled: true,
    visible,
    visibility: visible ? 'visible' : 'invisible',
    width: 100,
    height: 40,
    elevation: 0,
    alpha: 1,
    focused: false,
    frame: { x: 0, y: 0, width: 100, height: 40 },
  } as DetoxElementAttributesResult;
}

function iosAttributes(identifier: string): DetoxElementAttributesResult {
  const frame = { x: 0, y: 0, width: 100, height: 40 };
  return {
    identifier,
    enabled: true,
    visible: true,
    activationPoint: { x: 10, y: 10 },
    normalizedActivationPoint: { x: 0.5, y: 0.5 },
    hittable: true,
    frame,
    elementFrame: frame,
    elementBounds: frame,
    safeAreaInsets: { right: 0, top: 0, left: 0, bottom: 0 },
    elementSafeBounds: frame,
    layer: 'CALayer',
  } as DetoxElementAttributesResult;
}

function actionDriver(xml: string, attributes: DetoxElementAttributesResult, calls: string[]) {
  return {
    generateViewHierarchyXml: () => {
      calls.push('hierarchy');
      return Promise.resolve(xml);
    },
    elementForSelector: (selector: string) => {
      calls.push(`select:${selector}`);
      return {
        getAttributes: () => {
          calls.push('getAttributes');
          return Promise.resolve(attributes);
        },
        tap: () => {
          calls.push('tap');
          return Promise.resolve();
        },
      };
    },
    runOwned: async <T>(operation: () => Promise<T>) => operation(),
  };
}

void test('Accept child action resolves the identity target from actual attributes before tap', async () => {
  const calls: string[] = [];
  const result = await runDetoxConnectionAction({
    action: { kind: 'accept', target, snapshot: pendingSnapshot() },
    platform: 'android',
    driver: actionDriver(pendingXml(), androidAttributes('pro.pending.acceptButton.0'), calls),
  });
  assert.equal(result.selector, 'pro.pending.acceptButton.0');
  assert.equal(result.tapCompleted, true);
  assert.deepEqual(calls, [
    'hierarchy',
    'select:pro.pending.acceptButton.0',
    'getAttributes',
    'hierarchy',
    'getAttributes',
    'tap',
  ]);
});

void test('End child action requires observed iOS hittability before tap', async () => {
  const calls: string[] = [];
  const result = await runDetoxConnectionAction({
    action: { kind: 'end', target, snapshot: activeSnapshot() },
    platform: 'ios',
    driver: actionDriver(activeXml(), iosAttributes('student.professionals.unbindButton.0'), calls),
  });
  assert.equal(result.selector, 'student.professionals.unbindButton.0');
  assert.equal(calls.at(-1), 'tap');
});

void test('disabled or hidden action target fails before tap', async () => {
  const calls: string[] = [];
  await assert.rejects(
    runDetoxConnectionAction({
      action: { kind: 'accept', target, snapshot: pendingSnapshot() },
      platform: 'android',
      driver: actionDriver(
        pendingXml(),
        androidAttributes('pro.pending.acceptButton.0', false),
        calls,
      ),
    }),
  );
  assert.equal(calls.includes('tap'), false);
});

void test('action request rejects a snapshot from another fixture scope', () => {
  assert.throws(() =>
    requireDetoxConnectionActionRequest({
      kind: 'accept',
      target,
      snapshot: { ...pendingSnapshot(), scope: 'foreign-scope' },
    }),
  );
});
