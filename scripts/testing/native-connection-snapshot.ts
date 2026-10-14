import { assertTestingDocument } from './schema-validation';
import type { OwnedFixtures } from './owned-session';

type Specialty = 'nutritionist' | 'fitness_coach';
type ConnectionStatus = 'invited' | 'pending_confirmation' | 'active' | 'ended';

export type ConnectionSnapshotRows = {
  userProfiles: {
    authUid: string;
    lockedRole: 'student' | 'professional' | null;
    acceptedTermsVersion: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  professionalSpecialties: {
    id: string;
    professionalAuthUid: string;
    specialty: Specialty;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  }[];
  inviteCodes: {
    id: string;
    professionalAuthUid: string;
    specialty: Specialty;
    status: 'active' | 'rotated' | 'revoked';
    createdAt: string;
    updatedAt: string;
    rotatedAt: string | null;
  }[];
  connections: {
    id: string;
    professionalAuthUid: string;
    studentAuthUid: string;
    status: ConnectionStatus;
    specialty: Specialty;
    canceledReason: 'code_rotated' | null;
    sourceInviteCodeId: string | null;
    createdAt: string;
    updatedAt: string;
    endedAt: string | null;
  }[];
  connectionInviteGuards: {
    id: string;
    connectionId: string;
    professionalAuthUid: string;
    studentAuthUid: string;
    specialty: Specialty;
    status: 'pending_confirmation';
    createdAt: string;
    updatedAt: string;
  }[];
  pendingStudents: {
    id: string;
    professionalAuthUid: string;
    studentAuthUid: string;
    slotId: string;
    nutritionistConnectionId: string | null;
    fitnessCoachConnectionId: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  pendingStudentSlots: {
    id: string;
    professionalAuthUid: string;
    slotId: string;
    studentAuthUid: string | null;
    updatedAt: string;
  }[];
  trackingAccess: {
    id: string;
    studentAuthUid: string;
    professionalAuthUid: string;
    specialty: Specialty;
    connectionId: string;
    status: 'active' | 'ended';
    updatedAt: string;
  }[];
  activeSpecialties: {
    id: string;
    studentAuthUid: string;
    professionalAuthUid: string;
    specialty: Specialty;
    connectionId: string;
    status: 'active' | 'ended';
    updatedAt: string;
  }[];
};

export type OwnedConnectionSnapshot = {
  schemaVersion: 1;
  kind: 'connection-snapshot-v1';
  runId: string;
  scope: string;
  readOnly: true;
  fixtureAuthUids: string[];
  target: {
    professionalAuthUid: string;
    studentAuthUid: string;
    specialty: 'fitness_coach';
  };
  rowCounts: { [K in keyof ConnectionSnapshotRows]: number };
  rows: ConnectionSnapshotRows;
};

export type ConnectionSnapshotExpectedIdentity = {
  runId?: string;
  scope?: string;
  fixtureAuthUids?: readonly string[];
  professionalAuthUid?: string;
  studentAuthUid?: string;
  target?: {
    professionalAuthUid: string;
    studentAuthUid: string;
    specialty?: 'fitness_coach';
  };
};

export type ConnectionSnapshotCheckpoint = 'unlinked' | 'pending' | 'active';

const rowNames = [
  'userProfiles',
  'professionalSpecialties',
  'inviteCodes',
  'connections',
  'connectionInviteGuards',
  'pendingStudents',
  'pendingStudentSlots',
  'trackingAccess',
  'activeSpecialties',
] as const satisfies readonly (keyof ConnectionSnapshotRows)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function same(value: unknown, other: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(other);
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function requireSortedUniqueRows(
  rows: readonly Record<string, unknown>[],
  key: string,
  name: string,
) {
  const identities = rows.map((row) => row[key]);
  if (
    identities.some((value) => typeof value !== 'string' || !value) ||
    new Set(identities).size !== identities.length ||
    identities.some(
      (value, index) =>
        index > 0 &&
        typeof value === 'string' &&
        typeof identities[index - 1] === 'string' &&
        (identities[index - 1] as string) >= value,
    )
  )
    throw new Error(`${name} rows must be unique and deterministically ordered`);
}

function requireFixtureIds(value: readonly string[], message: string): string[] {
  if (
    value.some((item) => typeof item !== 'string' || !item) ||
    new Set(value).size !== value.length
  )
    throw new Error(message);
  return sorted(value);
}

function assertFixtureRelationshipEndpoints(
  snapshot: OwnedConnectionSnapshot,
  fixtureIds: ReadonlySet<string>,
) {
  const requireFixture = (value: string, field: string) => {
    if (!fixtureIds.has(value))
      throw new Error(`Connection snapshot ${field} references an out-of-fixture identity`);
  };
  const requireOptionalFixture = (value: string | null, field: string) => {
    if (value !== null) requireFixture(value, field);
  };
  for (const row of snapshot.rows.userProfiles) requireFixture(row.authUid, 'userProfiles.authUid');
  for (const row of snapshot.rows.professionalSpecialties)
    requireFixture(row.professionalAuthUid, 'professionalSpecialties.professionalAuthUid');
  for (const row of snapshot.rows.inviteCodes)
    requireFixture(row.professionalAuthUid, 'inviteCodes.professionalAuthUid');
  for (const row of snapshot.rows.connections) {
    requireFixture(row.professionalAuthUid, 'connections.professionalAuthUid');
    requireFixture(row.studentAuthUid, 'connections.studentAuthUid');
  }
  for (const row of snapshot.rows.connectionInviteGuards) {
    requireFixture(row.professionalAuthUid, 'connectionInviteGuards.professionalAuthUid');
    requireFixture(row.studentAuthUid, 'connectionInviteGuards.studentAuthUid');
  }
  for (const row of snapshot.rows.pendingStudents) {
    requireFixture(row.professionalAuthUid, 'pendingStudents.professionalAuthUid');
    requireFixture(row.studentAuthUid, 'pendingStudents.studentAuthUid');
  }
  for (const row of snapshot.rows.pendingStudentSlots) {
    requireFixture(row.professionalAuthUid, 'pendingStudentSlots.professionalAuthUid');
    requireOptionalFixture(row.studentAuthUid, 'pendingStudentSlots.studentAuthUid');
  }
  for (const row of snapshot.rows.trackingAccess) {
    requireFixture(row.studentAuthUid, 'trackingAccess.studentAuthUid');
    requireFixture(row.professionalAuthUid, 'trackingAccess.professionalAuthUid');
  }
  for (const row of snapshot.rows.activeSpecialties) {
    requireFixture(row.studentAuthUid, 'activeSpecialties.studentAuthUid');
    requireFixture(row.professionalAuthUid, 'activeSpecialties.professionalAuthUid');
  }
}

/** AJV owns field shape; this function owns semantic identity/count/order checks. */
export function requireConnectionSnapshot(
  value: unknown,
  expected: ConnectionSnapshotExpectedIdentity = {},
): OwnedConnectionSnapshot {
  assertTestingDocument('connection-snapshot-v1', value);
  if (!isRecord(value)) throw new Error('Connection snapshot is not an object');
  const snapshot = value as OwnedConnectionSnapshot;
  if (snapshot.target.professionalAuthUid === snapshot.target.studentAuthUid)
    throw new Error('Connection snapshot target accounts must differ');
  const fixtureAuthUids = requireFixtureIds(
    snapshot.fixtureAuthUids,
    'Connection snapshot fixture identities are invalid',
  );
  if (!same(snapshot.fixtureAuthUids, fixtureAuthUids))
    throw new Error('Connection snapshot fixture identities are not ordered');
  assertFixtureRelationshipEndpoints(snapshot, new Set(fixtureAuthUids));
  for (const name of rowNames) {
    const rows = snapshot.rows[name];
    if (snapshot.rowCounts[name] !== rows.length)
      throw new Error(`Connection snapshot ${name} count does not match rows`);
    requireSortedUniqueRows(
      rows as unknown as Record<string, unknown>[],
      name === 'userProfiles' ? 'authUid' : 'id',
      name,
    );
  }
  if (expected.runId !== undefined && snapshot.runId !== expected.runId)
    throw new Error('Connection snapshot run identity mismatch');
  if (expected.scope !== undefined && snapshot.scope !== expected.scope)
    throw new Error('Connection snapshot scope identity mismatch');
  if (expected.fixtureAuthUids !== undefined) {
    const expectedFixtureIds = requireFixtureIds(
      expected.fixtureAuthUids,
      'Expected fixture identities are invalid',
    );
    if (!same(fixtureAuthUids, expectedFixtureIds))
      throw new Error('Connection snapshot fixture identity mismatch');
  }
  const professionalAuthUid = expected.target?.professionalAuthUid ?? expected.professionalAuthUid;
  const studentAuthUid = expected.target?.studentAuthUid ?? expected.studentAuthUid;
  if (
    professionalAuthUid !== undefined &&
    snapshot.target.professionalAuthUid !== professionalAuthUid
  )
    throw new Error('Connection snapshot target professional mismatch');
  if (studentAuthUid !== undefined && snapshot.target.studentAuthUid !== studentAuthUid)
    throw new Error('Connection snapshot target student mismatch');
  return snapshot;
}

function targetEndpoints(row: Record<string, unknown>, snapshot: OwnedConnectionSnapshot) {
  return (
    row.professionalAuthUid === snapshot.target.professionalAuthUid &&
    row.studentAuthUid === snapshot.target.studentAuthUid
  );
}

function targetRelation(row: Record<string, unknown>, snapshot: OwnedConnectionSnapshot) {
  return targetEndpoints(row, snapshot) && row.specialty === snapshot.target.specialty;
}

function targetConnections(snapshot: OwnedConnectionSnapshot) {
  return snapshot.rows.connections.filter((row) => targetRelation(row, snapshot));
}

function targetEndpointConnections(snapshot: OwnedConnectionSnapshot) {
  return snapshot.rows.connections.filter((row) => targetEndpoints(row, snapshot));
}

function targetGuards(snapshot: OwnedConnectionSnapshot, connectionId?: string) {
  return snapshot.rows.connectionInviteGuards.filter(
    (row) =>
      targetRelation(row, snapshot) &&
      (connectionId === undefined || row.connectionId === connectionId),
  );
}

function targetEndpointGuards(snapshot: OwnedConnectionSnapshot, connectionId?: string) {
  return snapshot.rows.connectionInviteGuards.filter(
    (row) =>
      targetEndpoints(row, snapshot) &&
      (connectionId === undefined || row.connectionId === connectionId),
  );
}

function targetPendingStudents(snapshot: OwnedConnectionSnapshot) {
  return snapshot.rows.pendingStudents.filter((row) => targetEndpoints(row, snapshot));
}

function targetInviteCodes(snapshot: OwnedConnectionSnapshot) {
  return snapshot.rows.inviteCodes.filter(
    (row) =>
      row.professionalAuthUid === snapshot.target.professionalAuthUid &&
      row.specialty === snapshot.target.specialty,
  );
}

function assertNoForeignTargetReferences(snapshot: OwnedConnectionSnapshot, connectionId: string) {
  for (const row of snapshot.rows.connectionInviteGuards) {
    if (row.connectionId === connectionId && !targetRelation(row, snapshot))
      throw new Error('Connection snapshot guard has a foreign target reference');
  }
  for (const row of snapshot.rows.pendingStudents) {
    if (
      (row.nutritionistConnectionId === connectionId ||
        row.fitnessCoachConnectionId === connectionId) &&
      !targetEndpoints(row, snapshot)
    )
      throw new Error('Connection snapshot pending student has a foreign target reference');
  }
  for (const rows of [snapshot.rows.trackingAccess, snapshot.rows.activeSpecialties]) {
    for (const row of rows) {
      if (row.connectionId === connectionId && !targetRelation(row, snapshot))
        throw new Error('Connection snapshot access row has a foreign target reference');
    }
  }
}

function assertStableRows(
  before: readonly unknown[],
  after: readonly unknown[],
  allowed: (row: unknown) => boolean,
  name: string,
) {
  if (
    !same(
      before.filter((row) => !allowed(row)),
      after.filter((row) => !allowed(row)),
    )
  )
    throw new Error(`Connection snapshot changed non-target ${name} state`);
}

function fixtureIdentity(
  fixtures: Pick<OwnedFixtures, 'accounts'>,
): ConnectionSnapshotExpectedIdentity {
  return {
    fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
    professionalAuthUid: fixtures.accounts.coach.authUid,
    studentAuthUid: fixtures.accounts.student.authUid,
  };
}

function assertFixtureAndTargetIdentity(
  snapshot: OwnedConnectionSnapshot,
  expected: ConnectionSnapshotExpectedIdentity,
) {
  requireConnectionSnapshot(snapshot, expected);
  const fixtureIds = new Set(snapshot.fixtureAuthUids);
  const targetIds = [snapshot.target.professionalAuthUid, snapshot.target.studentAuthUid];
  if (!targetIds.every((uid) => fixtureIds.has(uid)))
    throw new Error('Connection snapshot target is outside its fixture identity set');
  if (
    snapshot.rows.userProfiles.length !== fixtureIds.size ||
    !snapshot.fixtureAuthUids.every((uid) =>
      snapshot.rows.userProfiles.some((row) => row.authUid === uid),
    )
  )
    throw new Error('Connection snapshot fixture profiles are incomplete');
  const profiles = snapshot.rows.userProfiles.filter((row) => targetIds.includes(row.authUid));
  if (
    profiles.length !== 2 ||
    profiles.find((row) => row.authUid === snapshot.target.professionalAuthUid)?.lockedRole !==
      'professional' ||
    profiles.find((row) => row.authUid === snapshot.target.studentAuthUid)?.lockedRole !== 'student'
  )
    throw new Error('Connection snapshot target profiles are incomplete');
  const specialties = snapshot.rows.professionalSpecialties.filter(
    (row) =>
      row.professionalAuthUid === snapshot.target.professionalAuthUid &&
      row.specialty === snapshot.target.specialty,
  );
  if (specialties.length !== 1 || !specialties[0].isActive)
    throw new Error('Connection snapshot target specialty provenance is incomplete');
  const invites = targetInviteCodes(snapshot);
  if (invites.length !== 1 || invites[0].status !== 'active')
    throw new Error('Connection snapshot target invite provenance is incomplete');
}

export function verifyConnectionSnapshotCheckpoint({
  snapshot,
  checkpoint,
  expected,
}: {
  snapshot: OwnedConnectionSnapshot;
  checkpoint: ConnectionSnapshotCheckpoint;
  expected: ConnectionSnapshotExpectedIdentity;
}): void {
  assertFixtureAndTargetIdentity(snapshot, expected);
  const endpointConnections = targetEndpointConnections(snapshot);
  if (checkpoint === 'unlinked') {
    if (
      endpointConnections.length ||
      targetEndpointGuards(snapshot).length ||
      targetPendingStudents(snapshot).length
    )
      throw new Error('Unlinked connection snapshot contains target relationship state');
    if (
      snapshot.rows.trackingAccess.some((row) => targetEndpoints(row, snapshot)) ||
      snapshot.rows.activeSpecialties.some((row) => targetEndpoints(row, snapshot))
    )
      throw new Error('Unlinked connection snapshot contains target access state');
    if (
      snapshot.rows.pendingStudentSlots.some(
        (row) =>
          row.professionalAuthUid === snapshot.target.professionalAuthUid &&
          row.studentAuthUid === snapshot.target.studentAuthUid,
      )
    )
      throw new Error('Unlinked connection snapshot contains an occupied target slot');
    return;
  }
  const connections = targetConnections(snapshot);
  if (endpointConnections.length !== 1 || connections.length !== 1)
    throw new Error(`Connection snapshot lacks one ${checkpoint} target connection`);
  const connection = connections[0];
  assertNoForeignTargetReferences(snapshot, connection.id);
  const endpointGuards = targetEndpointGuards(snapshot);
  const guards = targetGuards(snapshot, connection.id);
  const pendingStudents = targetPendingStudents(snapshot);
  if (checkpoint === 'pending') {
    if (
      connection.status !== 'pending_confirmation' ||
      connection.canceledReason !== null ||
      connection.endedAt !== null ||
      !connection.sourceInviteCodeId ||
      endpointGuards.length !== 1 ||
      guards.length !== 1 ||
      pendingStudents.length !== 1 ||
      pendingStudents[0].fitnessCoachConnectionId !== connection.id ||
      pendingStudents[0].nutritionistConnectionId !== null
    )
      throw new Error('Pending connection snapshot lacks exact target provenance');
    const slots = snapshot.rows.pendingStudentSlots.filter(
      (row) =>
        row.professionalAuthUid === snapshot.target.professionalAuthUid &&
        row.slotId === pendingStudents[0].slotId,
    );
    if (slots.length !== 1 || slots[0].studentAuthUid !== snapshot.target.studentAuthUid)
      throw new Error('Pending connection snapshot lacks occupied target slot');
    if (
      snapshot.rows.trackingAccess.some((row) => targetEndpoints(row, snapshot)) ||
      snapshot.rows.activeSpecialties.some((row) => targetEndpoints(row, snapshot))
    )
      throw new Error('Pending connection snapshot contains premature active access');
  } else {
    if (
      connection.status !== 'active' ||
      connection.canceledReason !== null ||
      connection.endedAt !== null ||
      !connection.sourceInviteCodeId ||
      endpointGuards.length !== 0 ||
      guards.length !== 0 ||
      pendingStudents.length !== 1 ||
      pendingStudents[0].nutritionistConnectionId !== null ||
      pendingStudents[0].fitnessCoachConnectionId !== null
    )
      throw new Error('Active connection snapshot lacks exact released pending state');
    const slots = snapshot.rows.pendingStudentSlots.filter(
      (row) =>
        row.professionalAuthUid === snapshot.target.professionalAuthUid &&
        row.slotId === pendingStudents[0].slotId,
    );
    if (slots.length !== 1 || slots[0].studentAuthUid !== null)
      throw new Error('Active connection snapshot lacks retained free target slot');
    const tracking = snapshot.rows.trackingAccess.filter((row) => targetEndpoints(row, snapshot));
    const specialties = snapshot.rows.activeSpecialties.filter((row) =>
      targetEndpoints(row, snapshot),
    );
    if (
      tracking.length !== 1 ||
      tracking[0].specialty !== snapshot.target.specialty ||
      tracking[0].status !== 'active' ||
      tracking[0].connectionId !== connection.id ||
      specialties.length !== 1 ||
      specialties[0].specialty !== snapshot.target.specialty ||
      specialties[0].status !== 'active' ||
      specialties[0].connectionId !== connection.id
    )
      throw new Error('Active connection snapshot lacks durable access rows');
  }
  const invite = targetInviteCodes(snapshot).find((row) => row.status === 'active');
  if (!invite || connection.sourceInviteCodeId !== invite.id)
    throw new Error('Connection snapshot source invite provenance mismatch');
}

function snapshotTimestampMs(value: string): number {
  // Postgres text timestamps use "YYYY-MM-DD HH:MM:SS.sss+00"; normalize to ISO.
  return Date.parse(value.replace(' ', 'T').replace(/([+-]\d{2})$/u, '$1:00'));
}

// Signing in through the app upserts the actor's profile and bumps only its
// updatedAt (server profile upsertFromSession). Every other profile field must
// stay identical, and updatedAt may only move forward.
function sameProfilesIgnoringSessionTouch(
  before: ConnectionSnapshotRows['userProfiles'],
  after: ConnectionSnapshotRows['userProfiles'],
): boolean {
  if (before.length !== after.length) return false;
  return before.every((row, index) => {
    const { updatedAt: beforeUpdatedAt, ...beforeRest } = row;
    const { updatedAt: afterUpdatedAt, ...afterRest } = after[index];
    if (!same(beforeRest, afterRest)) return false;
    if (beforeUpdatedAt === afterUpdatedAt) return true;
    const beforeMs = snapshotTimestampMs(beforeUpdatedAt);
    const afterMs = snapshotTimestampMs(afterUpdatedAt);
    return Number.isFinite(beforeMs) && Number.isFinite(afterMs) && afterMs >= beforeMs;
  });
}

function assertStrictConnectionProjection(
  before: OwnedConnectionSnapshot,
  after: OwnedConnectionSnapshot,
) {
  if (
    !sameProfilesIgnoringSessionTouch(before.rows.userProfiles, after.rows.userProfiles) ||
    !same(before.rows.professionalSpecialties, after.rows.professionalSpecialties) ||
    !same(before.rows.inviteCodes, after.rows.inviteCodes)
  )
    throw new Error(
      'Connection mutation phase changed target profiles, specialties or invite state',
    );
}

function assertSubmissionMutationIdentity(
  before: OwnedConnectionSnapshot,
  after: OwnedConnectionSnapshot,
  requirePreexistingSlot: boolean,
) {
  const connection = targetConnections(after)[0];
  const guard = targetGuards(after, connection.id)[0];
  const pendingStudent = targetPendingStudents(after)[0];
  const slot = after.rows.pendingStudentSlots.find(
    (row) =>
      row.professionalAuthUid === after.target.professionalAuthUid &&
      row.slotId === pendingStudent.slotId,
  );
  if (!connection || !guard || !pendingStudent || !slot)
    throw new Error('Connection submission phase lacks exact target mutation identities');
  if (requirePreexistingSlot) {
    const beforeSlots = before.rows.pendingStudentSlots.filter(
      (row) =>
        row.professionalAuthUid === before.target.professionalAuthUid &&
        row.slotId === pendingStudent.slotId,
    );
    if (
      beforeSlots.length !== 1 ||
      beforeSlots[0].id !== slot.id ||
      beforeSlots[0].studentAuthUid !== null ||
      slot.professionalAuthUid !== before.target.professionalAuthUid ||
      slot.studentAuthUid !== before.target.studentAuthUid
    )
      throw new Error('Connection submission phase changed or reused the target slot');
  }

  const targetConnection = (row: unknown) =>
    isRecord(row) &&
    row.id === connection.id &&
    row.professionalAuthUid === after.target.professionalAuthUid &&
    row.studentAuthUid === after.target.studentAuthUid &&
    row.specialty === after.target.specialty;
  const targetGuard = (row: unknown) =>
    isRecord(row) &&
    row.id === guard.id &&
    row.connectionId === connection.id &&
    row.professionalAuthUid === after.target.professionalAuthUid &&
    row.studentAuthUid === after.target.studentAuthUid &&
    row.specialty === after.target.specialty;
  const targetPending = (row: unknown) =>
    isRecord(row) &&
    row.id === pendingStudent.id &&
    row.professionalAuthUid === after.target.professionalAuthUid &&
    row.studentAuthUid === after.target.studentAuthUid &&
    row.slotId === pendingStudent.slotId;
  const targetSlot = (row: unknown) =>
    isRecord(row) &&
    row.id === slot.id &&
    row.professionalAuthUid === after.target.professionalAuthUid &&
    row.slotId === pendingStudent.slotId;
  const stableTables: [
    string,
    readonly unknown[],
    readonly unknown[],
    (row: unknown) => boolean,
  ][] = [
    ['connections', before.rows.connections, after.rows.connections, targetConnection],
    [
      'connectionInviteGuards',
      before.rows.connectionInviteGuards,
      after.rows.connectionInviteGuards,
      targetGuard,
    ],
    ['pendingStudents', before.rows.pendingStudents, after.rows.pendingStudents, targetPending],
    [
      'pendingStudentSlots',
      before.rows.pendingStudentSlots,
      after.rows.pendingStudentSlots,
      targetSlot,
    ],
    ['trackingAccess', before.rows.trackingAccess, after.rows.trackingAccess, () => false],
    ['activeSpecialties', before.rows.activeSpecialties, after.rows.activeSpecialties, () => false],
  ];
  for (const [name, beforeRows, afterRows, allowed] of stableTables)
    assertStableRows(beforeRows, afterRows, allowed, name);
}

function assertConfirmationMutationIdentity(
  before: OwnedConnectionSnapshot,
  after: OwnedConnectionSnapshot,
) {
  const beforeConnection = targetConnections(before)[0];
  const afterConnection = targetConnections(after)[0];
  const beforePendingStudent = targetPendingStudents(before)[0];
  const afterPendingStudent = targetPendingStudents(after)[0];
  if (
    !beforeConnection ||
    !afterConnection ||
    !beforePendingStudent ||
    !afterPendingStudent ||
    beforeConnection.id !== afterConnection.id ||
    beforeConnection.professionalAuthUid !== afterConnection.professionalAuthUid ||
    beforeConnection.studentAuthUid !== afterConnection.studentAuthUid ||
    beforeConnection.specialty !== afterConnection.specialty ||
    beforeConnection.sourceInviteCodeId !== afterConnection.sourceInviteCodeId ||
    beforeConnection.createdAt !== afterConnection.createdAt ||
    beforePendingStudent.id !== afterPendingStudent.id ||
    beforePendingStudent.slotId !== afterPendingStudent.slotId ||
    beforePendingStudent.createdAt !== afterPendingStudent.createdAt
  )
    throw new Error(
      'Connection confirmation phase changed target connection identity or provenance',
    );

  const beforeSlot = before.rows.pendingStudentSlots.find(
    (row) =>
      row.professionalAuthUid === before.target.professionalAuthUid &&
      row.slotId === beforePendingStudent.slotId,
  );
  const afterSlot = after.rows.pendingStudentSlots.find(
    (row) =>
      row.professionalAuthUid === after.target.professionalAuthUid &&
      row.slotId === afterPendingStudent.slotId,
  );
  const beforeGuard = targetGuards(before, beforeConnection.id)[0];
  const afterTracking = after.rows.trackingAccess.find(
    (row) =>
      targetRelation(row, after) &&
      row.connectionId === afterConnection.id &&
      row.status === 'active',
  );
  const afterSpecialty = after.rows.activeSpecialties.find(
    (row) =>
      targetRelation(row, after) &&
      row.connectionId === afterConnection.id &&
      row.status === 'active',
  );
  if (
    !beforeSlot ||
    !afterSlot ||
    !beforeGuard ||
    !afterTracking ||
    !afterSpecialty ||
    beforeSlot.id !== afterSlot.id ||
    beforeSlot.professionalAuthUid !== afterSlot.professionalAuthUid ||
    beforeSlot.slotId !== afterSlot.slotId ||
    beforeSlot.studentAuthUid !== before.target.studentAuthUid ||
    afterSlot.studentAuthUid !== null
  )
    throw new Error(
      'Connection confirmation phase did not retain the target pending row, release its slot or grant target access',
    );

  const targetConnection = (row: unknown) =>
    isRecord(row) &&
    row.id === beforeConnection.id &&
    row.professionalAuthUid === before.target.professionalAuthUid &&
    row.studentAuthUid === before.target.studentAuthUid &&
    row.specialty === before.target.specialty;
  const targetGuard = (row: unknown) =>
    isRecord(row) &&
    row.id === beforeGuard.id &&
    row.connectionId === beforeConnection.id &&
    row.professionalAuthUid === before.target.professionalAuthUid &&
    row.studentAuthUid === before.target.studentAuthUid &&
    row.specialty === before.target.specialty;
  const targetPending = (row: unknown) =>
    isRecord(row) &&
    row.id === beforePendingStudent.id &&
    row.professionalAuthUid === before.target.professionalAuthUid &&
    row.studentAuthUid === before.target.studentAuthUid &&
    row.slotId === beforePendingStudent.slotId;
  const targetSlot = (row: unknown) =>
    isRecord(row) &&
    row.id === beforeSlot.id &&
    row.professionalAuthUid === before.target.professionalAuthUid &&
    row.slotId === beforePendingStudent.slotId;
  const targetTracking = (row: unknown) =>
    isRecord(row) &&
    row.id === afterTracking.id &&
    row.connectionId === beforeConnection.id &&
    row.professionalAuthUid === before.target.professionalAuthUid &&
    row.studentAuthUid === before.target.studentAuthUid &&
    row.specialty === before.target.specialty;
  const targetSpecialty = (row: unknown) =>
    isRecord(row) &&
    row.id === afterSpecialty.id &&
    row.connectionId === beforeConnection.id &&
    row.professionalAuthUid === before.target.professionalAuthUid &&
    row.studentAuthUid === before.target.studentAuthUid &&
    row.specialty === before.target.specialty;
  const stableTables: [
    string,
    readonly unknown[],
    readonly unknown[],
    (row: unknown) => boolean,
  ][] = [
    ['connections', before.rows.connections, after.rows.connections, targetConnection],
    [
      'connectionInviteGuards',
      before.rows.connectionInviteGuards,
      after.rows.connectionInviteGuards,
      targetGuard,
    ],
    ['pendingStudents', before.rows.pendingStudents, after.rows.pendingStudents, targetPending],
    [
      'pendingStudentSlots',
      before.rows.pendingStudentSlots,
      after.rows.pendingStudentSlots,
      targetSlot,
    ],
    ['trackingAccess', before.rows.trackingAccess, after.rows.trackingAccess, targetTracking],
    [
      'activeSpecialties',
      before.rows.activeSpecialties,
      after.rows.activeSpecialties,
      targetSpecialty,
    ],
  ];
  for (const [name, beforeRows, afterRows, allowed] of stableTables)
    assertStableRows(beforeRows, afterRows, allowed, name);
}

/**
 * Verify one contiguous connection mutation span. The span is deliberately
 * narrower than the public three-snapshot transition: auth-only checkpoints
 * must be validated between these spans rather than hidden inside them.
 */
export function verifyConnectionSnapshotPhaseTransition({
  before,
  after,
  beforeCheckpoint,
  afterCheckpoint,
  requirePreexistingSlot = true,
  fixtures,
}: {
  before: OwnedConnectionSnapshot;
  after: OwnedConnectionSnapshot;
  beforeCheckpoint: 'unlinked' | 'pending';
  afterCheckpoint: 'pending' | 'active';
  requirePreexistingSlot?: boolean;
  fixtures: Pick<OwnedFixtures, 'accounts'>;
}): void {
  if (
    (beforeCheckpoint === 'unlinked' && afterCheckpoint !== 'pending') ||
    (beforeCheckpoint === 'pending' && afterCheckpoint !== 'active')
  )
    throw new Error('Connection snapshot phase is not a causal mutation span');
  const expected = {
    ...fixtureIdentity(fixtures),
    runId: before.runId,
    scope: before.scope,
  };
  if (after.runId !== before.runId || after.scope !== before.scope)
    throw new Error('Connection snapshot phase identity changed');
  assertFixtureAndTargetIdentity(before, expected);
  assertFixtureAndTargetIdentity(after, expected);
  verifyConnectionSnapshotCheckpoint({ snapshot: before, checkpoint: beforeCheckpoint, expected });
  verifyConnectionSnapshotCheckpoint({ snapshot: after, checkpoint: afterCheckpoint, expected });
  assertStrictConnectionProjection(before, after);
  if (beforeCheckpoint === 'unlinked')
    assertSubmissionMutationIdentity(before, after, requirePreexistingSlot);
  else assertConfirmationMutationIdentity(before, after);
}

export function verifyConnectionSnapshotTransition({
  before,
  pending,
  active,
  fixtures,
}: {
  before: OwnedConnectionSnapshot;
  pending: OwnedConnectionSnapshot;
  active: OwnedConnectionSnapshot;
  fixtures: Pick<OwnedFixtures, 'accounts'>;
}): void {
  verifyConnectionSnapshotPhaseTransition({
    before,
    after: pending,
    beforeCheckpoint: 'unlinked',
    afterCheckpoint: 'pending',
    requirePreexistingSlot: false,
    fixtures,
  });
  verifyConnectionSnapshotPhaseTransition({
    before: pending,
    after: active,
    beforeCheckpoint: 'pending',
    afterCheckpoint: 'active',
    fixtures,
  });
}
