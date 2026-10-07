import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { enUS } from '../../localization/en-US';
import {
  resolveActiveConnectionCard,
  resolvePendingStudentConnectionCard,
  resolvePendingConnectionTarget,
  resolveProfessionalRosterTarget,
  type NativeConnectionTargetScope,
} from '../../scripts/testing/native-connection-hierarchy';
import type {
  ConnectionSnapshotRows,
  OwnedConnectionSnapshot,
} from '../../scripts/testing/native-connection-snapshot';

const runId = 'a'.repeat(24);
const scope = 'connection-test';
const coach = 'auth-coach';
const student = 'auth-student';
const fixtureAuthUids = [coach, student].sort();
const timestamp = '2026-10-01T00:00:00.000Z';
const connectionId = 'connection-target';
const pendingGuidance = enUS['relationship.pending.helper'];

function node(
  attributes: Record<string, unknown> = {},
  children: unknown[] = [],
  enabled?: boolean,
): Record<string, unknown> {
  return { attributes, children, ...(enabled === undefined ? {} : { enabled }) };
}

function flatProfessionalRosterTree(
  studentAuthUid: string,
  screenCount = 1,
): Record<string, unknown> {
  const specialty = enUS['pro.student_profile.specialty.fitness_coach'];
  const pendingStatus = enUS['pro.student_profile.assignment.pending'];
  const targetRow = node(
    {
      'resource-id': `pro.students.row.${studentAuthUid}`,
      bounds: '[36,343][366,429]',
      accessibilityText: `Synthetic pending name, ${specialty}, ${pendingStatus}`,
    },
    [],
    true,
  );
  const listCard = node(
    { 'resource-id': 'pro.students.listCard', bounds: '[20,327][382,759]' },
    [node({}, [node({}, [targetRow], true)], true)],
    true,
  );
  const searchCard = node(
    { 'resource-id': 'pro.students.searchCard', bounds: '[20,181][382,311]' },
    [
      node({ 'resource-id': 'pro.students.filter.all', bounds: '[36,257][80,295]' }, [], true),
      node({ 'resource-id': 'pro.students.filter.active', bounds: '[92,257][157,295]' }, [], true),
      node(
        { 'resource-id': 'pro.students.filter.pending', bounds: '[169,257][246,295]' },
        [],
        true,
      ),
    ],
    true,
  );
  const screens = Array.from({ length: screenCount }, () =>
    node({ 'resource-id': 'pro.students.screen', bounds: '[0,0][402,791]' }, [], true),
  );
  return node({}, [node({ bounds: '[0,0][402,791]' }, [...screens, searchCard, listCard], true)]);
}

function baseRows(): ConnectionSnapshotRows {
  return {
    userProfiles: fixtureAuthUids.map((authUid) => ({
      authUid,
      lockedRole: authUid === coach ? ('professional' as const) : ('student' as const),
      acceptedTermsVersion: 'v1',
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
    pendingStudentSlots: [],
    trackingAccess: [],
    activeSpecialties: [],
  };
}

function snapshot(next: Partial<ConnectionSnapshotRows> = {}): OwnedConnectionSnapshot {
  const rows = { ...baseRows(), ...next };
  return {
    schemaVersion: 1,
    kind: 'connection-snapshot-v1',
    runId,
    scope,
    readOnly: true,
    fixtureAuthUids: [...fixtureAuthUids],
    target: { professionalAuthUid: coach, studentAuthUid: student, specialty: 'fitness_coach' },
    rowCounts: Object.fromEntries(
      Object.entries(rows).map(([name, values]) => [name, values.length]),
    ) as OwnedConnectionSnapshot['rowCounts'],
    rows,
  };
}

const pendingConnection = {
  id: connectionId,
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
const pendingStudent = {
  id: 'pending-target',
  professionalAuthUid: coach,
  studentAuthUid: student,
  slotId: 'slot-target',
  nutritionistConnectionId: null,
  fitnessCoachConnectionId: connectionId,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const pendingSlot = {
  id: 'coach_slot-target',
  professionalAuthUid: coach,
  slotId: 'slot-target',
  studentAuthUid: student,
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
    connections: [
      { ...pendingConnection, status: 'active', updatedAt: '2026-10-01T00:00:01.000Z' },
    ],
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
        id: 'tracking-target',
        studentAuthUid: student,
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        connectionId,
        status: 'active',
        updatedAt: '2026-10-01T00:00:01.000Z',
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
        updatedAt: '2026-10-01T00:00:01.000Z',
      },
    ],
  });
}

const target: NativeConnectionTargetScope = {
  runId,
  scope,
  fixtureAuthUids,
  professionalAuthUid: coach,
  studentAuthUid: student,
};

function pendingRow(
  index: number,
  id: string,
  acceptEnabled = true,
  includeTextAlias = false,
): unknown[] {
  const top = index * 100;
  const rowBounds = `[0,${top}][100,${top + 100}]`;
  const targetBounds = `[10,${top + 10}][90,${top + 30}]`;
  const acceptBounds = `[50,${top + 10}][90,${top + 50}]`;
  const target = includeTextAlias
    ? node({ accessibilityText: id, bounds: targetBounds }, [
        node({ text: id, bounds: targetBounds }),
      ])
    : node({ text: id, bounds: targetBounds });
  return [
    node({ 'resource-id': `pro.pending.row.${index}`, bounds: rowBounds }, [], true),
    node({ 'resource-id': `pro.pending.checkbox.${index}` }, [], true),
    node({ text: 'Fitness Coach' }),
    node(
      { 'resource-id': `pro.pending.acceptButton.${index}`, bounds: acceptBounds },
      [],
      acceptEnabled,
    ),
    node({ 'resource-id': `pro.pending.denyButton.${index}` }, [], true),
    target,
  ];
}

function pendingTree(rows: unknown[]): unknown {
  return node({ 'resource-id': 'pro.pending.screen' }, [node({}, rows)]);
}

function activeCard(
  index: number,
  id: string,
  options: { unbindIndex?: number; enabled?: boolean; includePendingMarker?: boolean } = {},
): unknown {
  const unbindIndex = options.unbindIndex ?? index;
  const unbindChildren: unknown[] = [
    node({ 'resource-id': `student.professionals.activeConnection.${id}` }),
  ];
  if (options.includePendingMarker)
    unbindChildren.push(node({ 'resource-id': `student.professionals.connectionPending.${id}` }));
  return node(
    { 'resource-id': `student.professionals.connectionCard.${index}` },
    [
      node({ accessibilityText: 'Fitness Coach' }, [node({ accessibilityText: 'Fitness Coach' })]),
      node(
        { 'resource-id': `student.professionals.unbindButton.${unbindIndex}` },
        unbindChildren,
        options.enabled ?? true,
      ),
    ],
    true,
  );
}

function pendingStudentCard(
  index: number,
  id: string,
  options: {
    guidance?: string;
    includeActiveMarker?: boolean;
    includeEnd?: boolean;
    duplicateMarker?: boolean;
  } = {},
): unknown {
  const guidance = options.guidance ?? pendingGuidance;
  const marker = node({
    'resource-id': `student.professionals.connectionPending.${id}`,
    accessibilityText: guidance,
    bounds: `[38,${488 + index * 100}][368,${522 + index * 100}]`,
  });
  const children: unknown[] = [marker];
  if (options.duplicateMarker)
    children.push(
      node({
        'resource-id': `student.professionals.connectionPending.${id}`,
        accessibilityText: guidance,
      }),
    );
  if (options.includeActiveMarker)
    children.push(node({ 'resource-id': `student.professionals.activeConnection.${id}` }));
  if (options.includeEnd)
    children.push(node({ 'resource-id': `student.professionals.unbindButton.${index}` }));
  return node(
    {
      'resource-id': `student.professionals.connectionCard.${index}`,
      bounds: `[20,${444 + index * 100}][382,${536 + index * 100}]`,
    },
    children,
    true,
  );
}

function pendingStudentTree(cards: unknown[]): unknown {
  return node({ 'resource-id': 'student.professionals.screen' }, cards);
}

void test('pending target mapping follows the target ID into its exact row and accept control', () => {
  const tree = pendingTree([
    ...pendingRow(0, 'other-connection'),
    ...pendingRow(1, connectionId, true, true),
  ]);
  const match = resolvePendingConnectionTarget({ tree, snapshot: pendingSnapshot(), target });

  assert.equal(match.rowIndex, 1);
  assert.equal(match.rowSelector, 'pro.pending.row.1');
  assert.equal(match.acceptSelector, 'pro.pending.acceptButton.1');
  assert.deepEqual(match.rowPath.slice(0, -1), match.acceptPath.slice(0, -1));
  assert.deepEqual(match.targetPath.slice(0, match.groupPath.length), match.groupPath);
  assert.equal(match.provenance.checkpoint, 'pending');
  assert.equal(match.provenance.scope, scope);
  assert.deepEqual(match.provenance.fixtureAuthUids, fixtureAuthUids);
});

void test('pending mapping rejects duplicate, detached, and disabled target controls', () => {
  const duplicate = pendingTree([...pendingRow(0, connectionId), ...pendingRow(1, connectionId)]);
  assert.throws(
    () => resolvePendingConnectionTarget({ tree: duplicate, snapshot: pendingSnapshot(), target }),
    /absent or duplicated/,
  );

  const detached = node({ 'resource-id': 'pro.pending.screen' }, [
    node({}, pendingRow(0, 'other-connection')),
    node({ text: connectionId }),
  ]);
  assert.throws(
    () => resolvePendingConnectionTarget({ tree: detached, snapshot: pendingSnapshot(), target }),
    /ancestry is ambiguous/,
  );

  const disabled = pendingTree(pendingRow(0, connectionId, false));
  assert.throws(
    () => resolvePendingConnectionTarget({ tree: disabled, snapshot: pendingSnapshot(), target }),
    /ancestry is ambiguous/,
  );

  const detachedAfterLastRow = pendingTree([
    ...pendingRow(0, 'other-connection'),
    node({ text: connectionId, bounds: '[10,300][90,330]' }),
  ]);
  assert.throws(
    () =>
      resolvePendingConnectionTarget({
        tree: detachedAfterLastRow,
        snapshot: pendingSnapshot(),
        target,
      }),
    /ancestry is ambiguous/,
  );

  const sameBoundsSibling = pendingTree([
    ...pendingRow(0, 'other-connection'),
    node({ text: connectionId, bounds: '[10,100][90,120]' }),
    node({ accessibilityText: connectionId, bounds: '[10,100][90,120]' }),
  ]);
  assert.throws(
    () =>
      resolvePendingConnectionTarget({
        tree: sameBoundsSibling,
        snapshot: pendingSnapshot(),
        target,
      }),
    /absent or duplicated/,
  );
});

void test('active mapping binds the exact connection marker to one card and its same-index End control', () => {
  const tree = node({ 'resource-id': 'student.professionals.screen' }, [
    activeCard(0, 'other-connection'),
    activeCard(1, connectionId),
  ]);
  const match = resolveActiveConnectionCard({ tree, snapshot: activeSnapshot(), target });

  assert.equal(match.cardIndex, 1);
  assert.equal(match.cardSelector, 'student.professionals.connectionCard.1');
  assert.equal(match.unbindSelector, 'student.professionals.unbindButton.1');
  assert.equal(
    match.activeMarkerSelector,
    `student.professionals.activeConnection.${connectionId}`,
  );
  assert.deepEqual(match.activeMarkerPath.slice(0, match.unbindPath.length), match.unbindPath);
  assert.equal(match.provenance.checkpoint, 'active');
  assert.equal(match.provenance.runId, runId);
  assert.equal(match.provenance.target.studentAuthUid, student);
});

void test('active mapping rejects wrong scope, duplicate or detached markers, pending markers, and unsafe controls', () => {
  const tree = node({ 'resource-id': 'student.professionals.screen' }, [
    activeCard(1, connectionId),
  ]);
  assert.throws(
    () =>
      resolveActiveConnectionCard({
        tree,
        snapshot: activeSnapshot(),
        target: { ...target, scope: 'other-scope' },
      }),
    /scope identity mismatch/,
  );
  assert.throws(
    () =>
      resolveActiveConnectionCard({
        tree,
        snapshot: activeSnapshot(),
        target: { ...target, studentAuthUid: 'auth-foreign-student' },
      }),
    /target student mismatch/,
  );

  const duplicateMarker = node({ 'resource-id': 'student.professionals.screen' }, [
    activeCard(0, connectionId),
    activeCard(1, connectionId),
  ]);
  assert.throws(
    () =>
      resolveActiveConnectionCard({ tree: duplicateMarker, snapshot: activeSnapshot(), target }),
    /absent or duplicated/,
  );

  const detachedMarker = node({ 'resource-id': 'student.professionals.screen' }, [
    activeCard(1, 'other-connection'),
    node({ 'resource-id': `student.professionals.activeConnection.${connectionId}` }),
  ]);
  assert.throws(
    () => resolveActiveConnectionCard({ tree: detachedMarker, snapshot: activeSnapshot(), target }),
    /card ancestry is ambiguous/,
  );

  const pendingMarker = node({ 'resource-id': 'student.professionals.screen' }, [
    activeCard(1, connectionId, { includePendingMarker: true }),
  ]);
  assert.throws(
    () => resolveActiveConnectionCard({ tree: pendingMarker, snapshot: activeSnapshot(), target }),
    /pending marker/,
  );

  const wrongIndex = node({ 'resource-id': 'student.professionals.screen' }, [
    activeCard(1, connectionId, { unbindIndex: 0 }),
  ]);
  assert.throws(
    () => resolveActiveConnectionCard({ tree: wrongIndex, snapshot: activeSnapshot(), target }),
    /End control/,
  );

  const disabled = node({ 'resource-id': 'student.professionals.screen' }, [
    activeCard(1, connectionId, { enabled: false }),
  ]);
  assert.throws(
    () => resolveActiveConnectionCard({ tree: disabled, snapshot: activeSnapshot(), target }),
    /End control/,
  );
});

void test('pending student mapping binds guidance to the exact target card without exposing its text', () => {
  const tree = pendingStudentTree([
    pendingStudentCard(0, 'other-connection'),
    pendingStudentCard(1, connectionId),
  ]);
  const match = resolvePendingStudentConnectionCard({
    tree,
    snapshot: pendingSnapshot(),
    target,
    expectedPendingGuidance: pendingGuidance,
  });

  assert.equal(match.cardIndex, 1);
  assert.equal(match.cardSelector, 'student.professionals.connectionCard.1');
  assert.equal(
    match.pendingMarkerSelector,
    `student.professionals.connectionPending.${connectionId}`,
  );
  assert.equal(match.pendingText.selector, match.pendingMarkerSelector);
  assert.equal(match.pendingText.attribute, 'accessibilityText');
  assert.equal(
    match.pendingText.sha256,
    createHash('sha256').update(pendingGuidance).digest('hex'),
  );
  assert.equal(match.pendingText.path.at(-1), 0);
  assert.deepEqual(match.pendingMarkerPath.slice(0, match.cardPath.length), match.cardPath);
  assert.equal(match.provenance.checkpoint, 'pending');
  assert.equal(match.provenance.target.studentAuthUid, student);
});

void test('pending student mapping rejects duplicate, detached, active and End-state evidence', () => {
  const cases: [unknown, RegExp][] = [
    [
      pendingStudentTree([pendingStudentCard(0, connectionId, { duplicateMarker: true })]),
      /absent or duplicated/,
    ],
    [
      pendingStudentTree([
        pendingStudentCard(0, 'other-connection'),
        node({
          'resource-id': `student.professionals.connectionPending.${connectionId}`,
          accessibilityText: pendingGuidance,
        }),
      ]),
      /card ancestry is ambiguous/,
    ],
    [
      pendingStudentTree([pendingStudentCard(0, connectionId, { includeActiveMarker: true })]),
      /target active marker/,
    ],
    [
      pendingStudentTree([pendingStudentCard(0, connectionId, { includeEnd: true })]),
      /matching End control/,
    ],
    [
      pendingStudentTree([pendingStudentCard(0, connectionId, { guidance: '  ' })]),
      /guidance is absent or blank/,
    ],
  ];
  const ambiguous = pendingStudentTree([
    node(
      { 'resource-id': 'student.professionals.connectionCard.0' },
      [
        node({
          'resource-id': `student.professionals.connectionPending.${connectionId}`,
          text: 'Guidance A',
          accessibilityText: 'Guidance B',
        }),
      ],
      true,
    ),
  ]);
  cases.push([ambiguous, /guidance is ambiguous/]);

  for (const [tree, error] of cases)
    assert.throws(
      () =>
        resolvePendingStudentConnectionCard({
          tree,
          snapshot: pendingSnapshot(),
          target,
          expectedPendingGuidance: pendingGuidance,
        }),
      error,
    );
});

void test('professional roster mapping requires one exact target UID on the roster screen', () => {
  const studentSelector = `pro.students.row.${student}`;
  const tree = node({ 'resource-id': 'pro.students.screen' }, [
    node({ 'resource-id': studentSelector }),
  ]);
  const match = resolveProfessionalRosterTarget({ tree, targetStudentAuthUid: student });
  assert.equal(match.studentSelector, studentSelector);
  assert.equal(match.studentPath.at(-1), 0);

  const duplicate = node({ 'resource-id': 'pro.students.screen' }, [
    node({ 'resource-id': studentSelector }),
    node({ 'resource-id': studentSelector }),
  ]);
  assert.throws(
    () => resolveProfessionalRosterTarget({ tree: duplicate, targetStudentAuthUid: student }),
    /absent or duplicated/,
  );

  assert.throws(
    () =>
      resolveProfessionalRosterTarget({
        tree: node({ 'resource-id': 'pro.students.screen.other' }, [
          node({ 'resource-id': studentSelector }),
        ]),
        targetStudentAuthUid: student,
      }),
    /outside the roster screen/,
  );
});

void test('professional roster mapping verifies the localized fitness assignment state when requested', () => {
  const specialty = enUS['pro.student_profile.specialty.fitness_coach'];
  const pendingStatus = enUS['pro.student_profile.assignment.pending'];
  const activeStatus = enUS['pro.student_profile.assignment.active'];
  const pendingTree = node({ 'resource-id': 'pro.students.screen' }, [
    node({
      'resource-id': `pro.students.row.${student}`,
      accessibilityText: `Synthetic pending name, ${specialty}, ${pendingStatus}`,
    }),
  ]);
  const pendingMatch = resolveProfessionalRosterTarget({
    tree: pendingTree,
    targetStudentAuthUid: student,
    assignmentState: 'pending',
  });
  assert.equal(pendingMatch.assignmentState, 'pending');
  assert.equal(pendingMatch.assignmentStateEvidence?.attribute, 'accessibilityText');
  assert.equal(
    pendingMatch.assignmentStateEvidence?.suffixSha256,
    createHash('sha256').update(`, ${specialty}, ${pendingStatus}`).digest('hex'),
  );

  const activeTree = node({ 'resource-id': 'pro.students.screen' }, [
    node({
      'resource-id': `pro.students.row.${student}`,
      accessibilityText: `Another display name, ${specialty}, ${activeStatus}`,
    }),
  ]);
  const activeMatch = resolveProfessionalRosterTarget({
    tree: activeTree,
    targetStudentAuthUid: student,
    assignmentState: 'active',
  });
  assert.equal(activeMatch.assignmentState, 'active');

  for (const accessibilityText of [
    `Synthetic pending name, ${enUS['pro.student_profile.specialty.nutritionist']}, ${pendingStatus}`,
    `Synthetic pending name, ${specialty}, ${activeStatus}`,
    'Synthetic pending name',
  ])
    assert.throws(
      () =>
        resolveProfessionalRosterTarget({
          tree: node({ 'resource-id': 'pro.students.screen' }, [
            node({ 'resource-id': `pro.students.row.${student}`, accessibilityText }),
          ]),
          targetStudentAuthUid: student,
          assignmentState: 'pending',
        }),
      /accessibility identity is absent|specialty or assignment state mismatch/,
    );
});

void test('professional roster mapping accepts the observed flat iOS screen scope', () => {
  const match = resolveProfessionalRosterTarget({
    tree: flatProfessionalRosterTree(student),
    targetStudentAuthUid: student,
    assignmentState: 'pending',
  });
  assert.equal(match.assignmentState, 'pending');
  assert.ok(match.studentPath.length > 3);

  assert.throws(
    () =>
      resolveProfessionalRosterTarget({
        tree: flatProfessionalRosterTree(student, 2),
        targetStudentAuthUid: student,
        assignmentState: 'pending',
      }),
    /outside the roster screen/,
  );

  const specialty = enUS['pro.student_profile.specialty.fitness_coach'];
  const pendingStatus = enUS['pro.student_profile.assignment.pending'];
  const targetRow = node(
    {
      'resource-id': `pro.students.row.${student}`,
      bounds: '[36,343][366,429]',
      accessibilityText: `Synthetic pending name, ${specialty}, ${pendingStatus}`,
    },
    [],
    true,
  );
  const detached = node({}, [
    node(
      { bounds: '[0,0][402,791]' },
      [node({ 'resource-id': 'pro.students.screen', bounds: '[0,0][402,791]' }, [], true)],
      true,
    ),
    node(
      { bounds: '[0,0][402,791]' },
      [
        node(
          { 'resource-id': 'pro.students.listCard', bounds: '[20,327][382,759]' },
          [node({}, [targetRow], true)],
          true,
        ),
      ],
      true,
    ),
  ]);
  assert.throws(
    () =>
      resolveProfessionalRosterTarget({
        tree: detached,
        targetStudentAuthUid: student,
        assignmentState: 'pending',
      }),
    /outside the roster screen/,
  );
});

void test('hierarchy inspection rejects malformed and cyclic trees within bounded traversal', () => {
  assert.throws(
    () =>
      resolveProfessionalRosterTarget({
        tree: { attributes: {}, children: 'malformed' },
        targetStudentAuthUid: student,
      }),
    /children are malformed/,
  );

  const cyclic: Record<string, unknown> = { attributes: {} };
  cyclic.children = [cyclic];
  assert.throws(
    () => resolveProfessionalRosterTarget({ tree: cyclic, targetStudentAuthUid: student }),
    /cycle/,
  );
});
