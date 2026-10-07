import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDetoxElementAttributeEvidence,
  normalizeDetoxElementAttributes,
  parseDetoxViewHierarchyXml,
  resolveActiveConnectionCardFromDetoxXml,
  resolvePendingConnectionTargetFromDetoxXml,
  type DetoxElementAttributeEvidence,
} from '../../scripts/testing/detox-native-hierarchy';
import type { NativeConnectionTargetScope } from '../../scripts/testing/native-connection-hierarchy';
import type {
  ConnectionSnapshotRows,
  OwnedConnectionSnapshot,
} from '../../scripts/testing/native-connection-snapshot';

const runId = 'a'.repeat(24);
const scope = 'detox-xml-bridge';
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

function pendingXml(platform: 'android' | 'ios', duplicateTarget = false): string {
  const targetViews = duplicateTarget
    ? '<Label class="Label" width="180" height="20" visibility="visible" alpha="1" focused="false" x="10" y="10" text="connection-target" /><Label class="Label" width="180" height="20" visibility="visible" alpha="1" focused="false" x="10" y="40" text="connection-target" />'
    : '<Label class="Label" width="180" height="20" visibility="visible" alpha="1" focused="false" x="10" y="10" text="connection-target" />';
  const accept =
    '<Button class="Button" width="100" height="40" visibility="visible" alpha="1" focused="false" x="250" y="10" id="pro.pending.acceptButton.0" />';
  const row = `<Row class="Row" width="400" height="100" visibility="visible" alpha="1" focused="false" x="0" y="0" id="pro.pending.row.0">${targetViews}${accept}</Row>`;
  const nested =
    platform === 'android'
      ? `<android.view.ViewGroup class="android.view.ViewGroup" width="400" height="800" visibility="visible" alpha="1" focused="false" value="" label="" x="0" y="0"><android.view.ViewGroup class="android.view.ViewGroup" width="400" height="800" visibility="visible" alpha="1" focused="false" value="" label="" x="0" y="0" id="pro.pending.screen"><android.view.ViewGroup class="android.view.ViewGroup" width="400" height="400" visibility="visible" alpha="1" focused="false" value="" label="" x="0" y="0">${row}</android.view.ViewGroup></android.view.ViewGroup></android.view.ViewGroup>`
      : `<UIWindow class="UIWindow" width="400" height="800" visibility="visible" alpha="1" focused="false"><UIView class="UIView" width="400" height="800" visibility="visible" alpha="1" focused="false" x="5" y="7" id="pro.pending.screen"><UIView class="UIView" width="400" height="400" visibility="visible" alpha="1" focused="false" x="10" y="11">${row}</UIView></UIView></UIWindow>`;
  const rootAttrs = platform === 'android' ? ' density="3"' : '';
  return `<?xml version="1.0" encoding="utf-8"?><ViewHierarchy${rootAttrs}>${nested}</ViewHierarchy>`;
}

function activeXml(platform: 'android' | 'ios'): string {
  const marker =
    '<View class="View" width="20" height="20" visibility="visible" alpha="1" focused="false" x="10" y="10" id="student.professionals.activeConnection.connection-target" />';
  const unbind = `<Button class="Button" width="100" height="40" visibility="visible" alpha="1" focused="false" x="250" y="10" id="student.professionals.unbindButton.0">${marker}</Button>`;
  const card = `<Card class="Card" width="400" height="100" visibility="visible" alpha="1" focused="false" x="0" y="0" id="student.professionals.connectionCard.0">${unbind}</Card>`;
  const nested =
    platform === 'android'
      ? `<android.view.ViewGroup class="android.view.ViewGroup" width="400" height="800" visibility="visible" alpha="1" focused="false" value="" label="" x="0" y="0"><android.view.ViewGroup class="android.view.ViewGroup" width="400" height="800" visibility="visible" alpha="1" focused="false" value="" label="" x="0" y="0" id="student.professionals.screen">${card}</android.view.ViewGroup></android.view.ViewGroup>`
      : `<UIWindow class="UIWindow" width="400" height="800" visibility="visible" alpha="1" focused="false"><UIView class="UIView" width="400" height="800" visibility="visible" alpha="1" focused="false" x="3" y="4" id="student.professionals.screen">${card}</UIView></UIWindow>`;
  const rootAttrs = platform === 'android' ? ' density="3"' : '';
  return `<?xml version="1.0" encoding="utf-8"?><ViewHierarchy${rootAttrs}>${nested}</ViewHierarchy>`;
}

function attributes(identifier: string, enabled = true): DetoxElementAttributeEvidence {
  return {
    identifier,
    enabled,
    visible: true,
    visibility: 'visible',
    width: 100,
    height: 40,
    elevation: 0,
    alpha: 1,
    focused: false,
    frame: { x: 0, y: 0, width: 100, height: 40 },
  };
}

function iosAttributes(identifier: string): DetoxElementAttributeEvidence {
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
  };
}

function deepXml(depth: number): string {
  const open =
    '<Node class="Node" width="1" height="1" visibility="visible" alpha="1" focused="false" x="0" y="0">'.repeat(
      depth,
    );
  const close = '</Node>'.repeat(depth);
  return `<ViewHierarchy><Window class="Window" width="1" height="1" visibility="visible" alpha="1" focused="false" x="0" y="0">${open}${close}</Window></ViewHierarchy>`;
}

void test('parses installed Android XML and preserves IDs, text, labels, bounds and ancestry', () => {
  const tree = parseDetoxViewHierarchyXml(pendingXml('android'), 'android');
  const screen = tree.children[0].children[0];
  const row = screen.children[0].children[0];
  const targetNode = row.children[0];
  assert.equal(screen.attributes['resource-id'], 'pro.pending.screen');
  assert.equal(targetNode.attributes.text, connectionId);
  assert.equal(targetNode.attributes.bounds, '[10,10][190,30]');
  assert.equal(row.attributes.bounds, '[0,0][400,100]');
  assert.equal(targetNode.attributes['resource-id'], undefined);
  assert.equal(tree.attributes.density, '3');
});

void test('accumulates iOS relative coordinates without guessing Android coordinates', () => {
  const iosTree = parseDetoxViewHierarchyXml(pendingXml('ios'), 'ios');
  const iosTarget = iosTree.children[0].children[0].children[0].children[0].children[0];
  assert.equal(iosTarget.attributes.bounds, '[25,28][205,48]');

  const androidTree = parseDetoxViewHierarchyXml(pendingXml('android'), 'android');
  const androidTarget = androidTree.children[0].children[0].children[0].children[0].children[0];
  assert.equal(androidTarget.attributes.bounds, '[10,10][190,30]');
});

void test('maps the actual Detox label/id fields to canonical consumer fields', () => {
  const xml =
    '<ViewHierarchy><UIView class="UIView" width="10" height="10" visibility="visible" alpha="1" focused="false" label="Accessible" value="Value" x="0" y="0" id="stable.test.id" tag="42" /></ViewHierarchy>';
  const tree = parseDetoxViewHierarchyXml(xml, 'ios');
  const node = tree.children[0];
  assert.equal(node.attributes.id, 'stable.test.id');
  assert.equal(node.attributes['resource-id'], 'stable.test.id');
  assert.equal(node.attributes.accessibilityText, 'Accessible');
  assert.equal(node.attributes.value, 'Value');
  assert.equal(node.attributes.tag, '42');
});

void test('uses Detox getAttributes evidence for actionability rather than inferring enabled', () => {
  const tree = parseDetoxViewHierarchyXml(pendingXml('android'), 'android');
  const accept = tree.children[0].children[0].children[0].children[0].children[1];
  assert.equal(accept.enabled, undefined);
  applyDetoxElementAttributeEvidence(tree, attributes('pro.pending.acceptButton.0'));
  assert.equal(accept.enabled, true);

  const iosFrameTree = parseDetoxViewHierarchyXml(pendingXml('ios'), 'ios');
  applyDetoxElementAttributeEvidence(iosFrameTree, {
    ...attributes('pro.pending.acceptButton.0'),
    frame: { x: 0.5, y: -1.25, width: 100.5, height: 40.25 },
  });
  assert.equal(
    iosFrameTree.children[0].children[0].children[0].children[0].children[1].enabled,
    true,
  );

  const disabledTree = parseDetoxViewHierarchyXml(pendingXml('android'), 'android');
  applyDetoxElementAttributeEvidence(disabledTree, attributes('pro.pending.acceptButton.0', false));
  assert.equal(
    disabledTree.children[0].children[0].children[0].children[0].children[1].enabled,
    false,
  );
});

void test('normalizes the actual Detox direct and multi-match result shapes', () => {
  const direct = attributes('pro.pending.acceptButton.0');
  assert.equal(normalizeDetoxElementAttributes(direct).identifier, direct.identifier);
  const ios = normalizeDetoxElementAttributes(iosAttributes('ios.accept'));
  assert.equal('hittable' in ios ? ios.hittable : undefined, true);
  assert.equal(
    normalizeDetoxElementAttributes({ elements: [direct] }).identifier,
    direct.identifier,
  );
  assert.throws(
    () =>
      normalizeDetoxElementAttributes({
        elements: [direct, attributes('other')],
      }),
    /exactly one element/,
  );
  assert.throws(
    () =>
      normalizeDetoxElementAttributes({
        elements: direct,
      } as unknown as { elements: DetoxElementAttributeEvidence[] }),
    /elements is malformed/,
  );
  assert.throws(
    () => normalizeDetoxElementAttributes([direct] as unknown as DetoxElementAttributeEvidence),
    /result is malformed/,
  );
});

void test('routes parsed pending XML through the exact row/accept ancestry consumer', () => {
  for (const platform of ['android', 'ios'] as const) {
    const match = resolvePendingConnectionTargetFromDetoxXml({
      xml: pendingXml(platform),
      platform,
      snapshot: pendingSnapshot(),
      target,
      elementAttributes: attributes('pro.pending.acceptButton.0'),
    });
    assert.equal(match.rowSelector, 'pro.pending.row.0');
    assert.equal(match.acceptSelector, 'pro.pending.acceptButton.0');
    assert.deepEqual(match.targetPath.slice(0, -1), match.rowPath);
  }
});

void test('routes parsed active XML through the exact card/unbind ancestry consumer', () => {
  for (const platform of ['android', 'ios'] as const) {
    const match = resolveActiveConnectionCardFromDetoxXml({
      xml: activeXml(platform),
      platform,
      snapshot: activeSnapshot(),
      target,
      elementAttributes: attributes('student.professionals.unbindButton.0'),
    });
    assert.equal(match.cardSelector, 'student.professionals.connectionCard.0');
    assert.equal(match.unbindSelector, 'student.professionals.unbindButton.0');
  }
});

void test('rejects duplicate semantic targets and detached accept controls', () => {
  assert.throws(
    () =>
      resolvePendingConnectionTargetFromDetoxXml({
        xml: pendingXml('android', true),
        platform: 'android',
        snapshot: pendingSnapshot(),
        target,
        elementAttributes: attributes('pro.pending.acceptButton.0'),
      }),
    /absent or duplicated/,
  );

  const detached = pendingXml('android').replace(
    'pro.pending.acceptButton.0',
    'pro.pending.acceptButton.1',
  );
  assert.throws(
    () =>
      resolvePendingConnectionTargetFromDetoxXml({
        xml: detached,
        platform: 'android',
        snapshot: pendingSnapshot(),
        target,
        elementAttributes: attributes('pro.pending.acceptButton.1'),
      }),
    /detached from its row/,
  );

  const detachedXml = pendingXml('android').replace(
    '<Button class="Button" width="100" height="40" visibility="visible" alpha="1" focused="false" x="250" y="10" id="pro.pending.acceptButton.0" />',
    '',
  ).replace(
    '</android.view.ViewGroup></android.view.ViewGroup></android.view.ViewGroup>',
    '<Button class="Button" width="100" height="40" visibility="visible" alpha="1" focused="false" x="250" y="10" id="pro.pending.acceptButton.0" /></android.view.ViewGroup></android.view.ViewGroup></android.view.ViewGroup>',
  );
  assert.throws(
    () =>
      resolvePendingConnectionTargetFromDetoxXml({
        xml: detachedXml,
        platform: 'android',
        snapshot: pendingSnapshot(),
        target,
        elementAttributes: attributes('pro.pending.acceptButton.0'),
      }),
    /detached from its row/,
  );
});

void test('rejects malformed XML, missing schema fields, depth overflow and node overflow', () => {
  assert.throws(
    () => parseDetoxViewHierarchyXml('<ViewHierarchy><View></ViewHierarchy>', 'ios'),
    /malformed|mismatched/,
  );
  assert.throws(
    () =>
      parseDetoxViewHierarchyXml(
        '<ViewHierarchy><View class="View" height="1" visibility="visible" alpha="1" focused="false" x="0" y="0" /></ViewHierarchy>',
        'ios',
      ),
    /missing width/,
  );
  assert.throws(() => parseDetoxViewHierarchyXml(deepXml(101), 'ios'), /depth bound/);
  assert.throws(
    () => parseDetoxViewHierarchyXml(pendingXml('android'), 'android', { maxNodes: 1 }),
    /node bound/,
  );
  assert.throws(
    () =>
      parseDetoxViewHierarchyXml(
        '<ViewHierarchy><View class="View" width="1" width="2" height="1" visibility="visible" alpha="1" focused="false" x="0" y="0" /></ViewHierarchy>',
        'android',
      ),
    /duplicate width XML attribute/,
  );
  assert.throws(
    () =>
      parseDetoxViewHierarchyXml(
        '<!DOCTYPE ViewHierarchy [<!ENTITY xxe "blocked">]><ViewHierarchy><View class="View" width="1" height="1" visibility="visible" alpha="1" focused="false" x="0" y="0" /></ViewHierarchy>',
        'android',
      ),
    /DOCTYPE/,
  );
  assert.throws(
    () =>
      parseDetoxViewHierarchyXml(
        '<ViewHierarchy><View class="View" width="1" height="1" visibility="visible" alpha="1" focused="false" x="0" y="0">&unknown;</View></ViewHierarchy>',
        'android',
      ),
    /malformed|entity|text/,
  );
});

void test('rejects duplicate XML IDs and unbound Detox attribute evidence', () => {
  const duplicate =
    '<ViewHierarchy><View class="View" width="1" height="1" visibility="visible" alpha="1" focused="false" x="0" y="0" id="same" /><View class="View" width="1" height="1" visibility="visible" alpha="1" focused="false" x="1" y="0" id="same" /></ViewHierarchy>';
  const tree = parseDetoxViewHierarchyXml(duplicate, 'android');
  assert.throws(() => applyDetoxElementAttributeEvidence(tree, attributes('same')), /duplicated/);

  const clean = parseDetoxViewHierarchyXml(pendingXml('android'), 'android');
  assert.throws(
    () => applyDetoxElementAttributeEvidence(clean, attributes('missing')),
    /do not match XML/,
  );
  assert.throws(
    () =>
      applyDetoxElementAttributeEvidence(clean, {
        identifier: 'pro.pending.acceptButton.0',
        enabled: true,
        visible: 'yes',
      } as unknown as DetoxElementAttributeEvidence),
    /lack enabled\/visible booleans/,
  );
});

void test('allows unrelated repeated IDs while rejecting an evidenced duplicate', () => {
  const xml =
    '<ViewHierarchy><View class="View" width="1" height="1" visibility="visible" alpha="1" focused="false" x="0" y="0" id="unrelated" /><View class="View" width="1" height="1" visibility="visible" alpha="1" focused="false" x="1" y="0" id="unrelated" /><Button class="Button" width="1" height="1" visibility="visible" alpha="1" focused="false" x="2" y="0" id="evidenced" /></ViewHierarchy>';
  const tree = parseDetoxViewHierarchyXml(xml, 'android');
  assert.doesNotThrow(() => applyDetoxElementAttributeEvidence(tree, attributes('evidenced')));
  assert.throws(
    () => applyDetoxElementAttributeEvidence(tree, attributes('unrelated')),
    /semantic identifier unrelated is duplicated/,
  );
});
