/**
 * Connection Firestore source — invite submit, confirm, end, list.
 */

import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';

import { getFirestoreInstance as _getFirestoreInstance, getCurrentAuthUid as _getCurrentAuthUid, nowIso } from '../firestore';
import { classifyFirestoreError } from '../firestore-error';
import {
  normalizeConnectionStatus,
  normalizeCanceledReason,
  normalizeConnectionSpecialty,
  type ConnectionRecord,
  type ConnectionSpecialty,
} from './connection.logic';
import {
  buildPendingInviteGuardId,
  getPendingStudentConnectionField,
  shouldReleasePendingStudentSlot,
  type PendingStudentOccupancy,
} from './pending-invite-guards';

// ─── Error type ───────────────────────────────────────────────────────────────

type ConnectionSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

export class ConnectionSourceError extends Error {
  code: ConnectionSourceErrorCode;

  constructor(code: ConnectionSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ConnectionSourceError';
  }
}

type FirestoreConnection = {
  id: string;
  status: string;
  canceledReason?: string | null;
  specialty: string;
  professionalAuthUid: string;
  studentAuthUid: string;
  sourceInviteCodeId?: string | null;
  sourceInviteCodeValue?: string | null;
  createdAt: string;
  updatedAt: string;
  endedAt?: string | null;
};

type FirestoreInviteCode = {
  scope: 'professional_specialty';
  professionalAuthUid: string;
  specialty: ConnectionSpecialty;
  codeValue: string;
  status: 'active' | 'rotated' | 'revoked';
  createdAt: string;
  updatedAt: string;
  rotatedAt?: string | null;
};

type FirestoreInviteCodeLookup = {
  scope: 'invite_code_lookup';
  codeValue: string;
  professionalAuthUid: string;
  specialty: ConnectionSpecialty;
  inviteCodeId: ConnectionSpecialty;
  status: 'active' | 'rotated' | 'revoked';
};

const MAX_PENDING_STUDENTS = 10;

export function buildPendingConnectionFromInvite(input: {
  connectionId: string;
  studentUid: string;
  inviteDocId: string;
  invite: Pick<FirestoreInviteCode, 'professionalAuthUid' | 'specialty' | 'codeValue'>;
  timestamp: string;
}): FirestoreConnection {
  return {
    id: input.connectionId,
    studentAuthUid: input.studentUid,
    professionalAuthUid: input.invite.professionalAuthUid,
    specialty: input.invite.specialty,
    status: 'pending_confirmation',
    canceledReason: null,
    sourceInviteCodeId: input.inviteDocId,
    sourceInviteCodeValue: input.invite.codeValue,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    endedAt: null,
  };
}

export function isPendingStudentCapReached(
  pendingConnections: Array<{ studentAuthUid?: string | null }>,
  nextStudentUid: string,
  cap = MAX_PENDING_STUDENTS
): boolean {
  const pendingStudentUids = new Set(
    pendingConnections
      .map((connection) => connection.studentAuthUid)
      .filter((uid): uid is string => typeof uid === 'string' && uid.length > 0)
  );
  pendingStudentUids.add(nextStudentUid);
  return pendingStudentUids.size > cap;
}

export function getExistingInviteConnectionConflict(
  connections: Array<{ status?: string | null }>
): 'active' | 'pending' | null {
  if (connections.some((connection) => connection.status === 'active')) return 'active';
  if (connections.some((connection) => connection.status === 'pending_confirmation')) return 'pending';
  return null;
}

type SubmitInviteRequestDeps = {
  getCurrentIdToken: () => Promise<string>;
  getSubmitInviteFunctionUrl: () => string;
  fetchFn: typeof fetch;
};

export async function requestSubmitInviteCode(
  code: string,
  deps: SubmitInviteRequestDeps
): Promise<{ connectionId: string; status: 'pending_confirmation' }> {
  let idToken: string;
  try {
    idToken = await deps.getCurrentIdToken();
  } catch (error) {
    throw normalizeConnectionSourceError(error);
  }

  let response: Response;
  const endpoint = deps.getSubmitInviteFunctionUrl();
  try {
    response = await deps.fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ code }),
    });
  } catch {
    throw new ConnectionSourceError('network', 'Network request to submit invite code failed.');
  }

  let body: { connectionId?: unknown; status?: unknown; error?: unknown } = {};
  try {
    body = (await response.json()) as { connectionId?: unknown; status?: unknown; error?: unknown };
  } catch {
    body = {};
  }

  if (response.status === 200 && typeof body.connectionId === 'string' && body.status === 'pending_confirmation') {
    return { connectionId: body.connectionId, status: 'pending_confirmation' };
  }

  if (body.error === 'not_found') {
    throw new ConnectionSourceError('graphql', 'Invite code not found.');
  }
  if (body.error === 'already_connected') {
    throw new ConnectionSourceError('graphql', 'Already connected.');
  }
  if (body.error === 'pending_already_exists') {
    throw new ConnectionSourceError('graphql', 'Pending request already exists.');
  }
  if (body.error === 'pending_cap_reached') {
    throw new ConnectionSourceError('graphql', 'Pending cap reached.');
  }
  if (response.status === 401 || response.status === 403 || body.error === 'unauthenticated' || body.error === 'forbidden') {
    throw new ConnectionSourceError('graphql', 'Invite submission is not authorized.');
  }

  throw new ConnectionSourceError('invalid_response', `Unexpected invite submission response: ${response.status}.`);
}

export type ConnectionSourceDeps = {
  getFirestoreInstance: () => Firestore;
  getCurrentAuthUid: () => string;
  getCurrentIdToken?: () => Promise<string>;
  getSubmitInviteFunctionUrl?: () => string;
  fetchFn?: typeof fetch;
};

const defaultConnectionSourceDeps: ConnectionSourceDeps = {
  getFirestoreInstance: _getFirestoreInstance,
  getCurrentAuthUid: _getCurrentAuthUid,
  getCurrentIdToken: defaultGetCurrentIdToken,
  getSubmitInviteFunctionUrl: defaultGetSubmitInviteFunctionUrl,
  fetchFn: fetch,
};

function defaultGetSubmitInviteFunctionUrl(): string {
  const url = process.env['EXPO_PUBLIC_SUBMIT_INVITE_FUNCTION_URL'];
  if (!url) {
    throw new ConnectionSourceError(
      'configuration',
      'Invite submission Cloud Function URL is not configured. Set EXPO_PUBLIC_SUBMIT_INVITE_FUNCTION_URL.'
    );
  }
  return url;
}

async function defaultGetCurrentIdToken(): Promise<string> {
  const { getFirebaseAuth } = require('../auth/firebase') as {
    getFirebaseAuth: () => { currentUser: { getIdToken?: () => Promise<string> } | null };
  };
  const user = getFirebaseAuth().currentUser;
  if (!user?.getIdToken) {
    throw new ConnectionSourceError('configuration', 'No authenticated user found.');
  }
  return user.getIdToken();
}

function getTrackingAccessRef(firestore: Firestore, connection: FirestoreConnection) {
  const readerCollection = connection.specialty === 'fitness_coach' ? 'fitnessCoaches' : 'nutritionists';
  return doc(
    firestore,
    'trackingAccess',
    connection.studentAuthUid,
    readerCollection,
    connection.professionalAuthUid
  );
}

function getActiveSpecialtyRef(firestore: Firestore, connection: FirestoreConnection) {
  return doc(
    firestore,
    'trackingAccess',
    connection.studentAuthUid,
    'activeSpecialties',
    connection.specialty
  );
}

function getPendingInviteGuardRef(firestore: Firestore, connection: FirestoreConnection) {
  const specialty = normalizeConnectionSpecialty(connection.specialty);
  if (!specialty) return null;
  return doc(
    firestore,
    'connectionInviteGuards',
    buildPendingInviteGuardId(connection.professionalAuthUid, connection.studentAuthUid, specialty)
  );
}

function getPendingStudentRef(firestore: Firestore, connection: FirestoreConnection) {
  return doc(
    firestore,
    'professionals',
    connection.professionalAuthUid,
    'pendingStudents',
    connection.studentAuthUid
  );
}

function getPendingStudentSlotRef(firestore: Firestore, professionalUid: string, slotId: string) {
  return doc(firestore, 'professionals', professionalUid, 'pendingStudentSlots', slotId);
}

export async function buildPendingInviteRelease(
  firestore: Firestore,
  tx: Transaction,
  connection: FirestoreConnection
): Promise<{
  guardRef: ReturnType<typeof doc> | null;
  pendingStudentRef: ReturnType<typeof doc> | null;
  pendingStudentField: 'nutritionistConnectionId' | 'fitnessCoachConnectionId' | null;
  releaseSlotRef: ReturnType<typeof doc> | null;
}> {
  if (connection.status !== 'pending_confirmation') {
    return { guardRef: null, pendingStudentRef: null, pendingStudentField: null, releaseSlotRef: null };
  }

  const specialty = normalizeConnectionSpecialty(connection.specialty);
  const guardRef = getPendingInviteGuardRef(firestore, connection);
  const guardSnap = guardRef ? await tx.get(guardRef) : null;
  const existingGuardRef = guardSnap?.exists() ? guardRef : null;
  if (!specialty) {
    return { guardRef: existingGuardRef, pendingStudentRef: null, pendingStudentField: null, releaseSlotRef: null };
  }

  const pendingStudentRef = getPendingStudentRef(firestore, connection);
  const pendingStudentSnap = await tx.get(pendingStudentRef);
  if (!pendingStudentSnap.exists()) {
    return { guardRef: existingGuardRef, pendingStudentRef: null, pendingStudentField: null, releaseSlotRef: null };
  }

  const pendingStudent = pendingStudentSnap.data() as PendingStudentOccupancy & { slotId?: string | null };
  const pendingStudentField = getPendingStudentConnectionField(specialty);
  if (pendingStudent[pendingStudentField] !== connection.id) {
    return { guardRef: existingGuardRef, pendingStudentRef: null, pendingStudentField: null, releaseSlotRef: null };
  }

  const slotId = typeof pendingStudent.slotId === 'string' ? pendingStudent.slotId : '';
  const releaseSlotRef = slotId && shouldReleasePendingStudentSlot(pendingStudent, connection.id)
    ? getPendingStudentSlotRef(firestore, connection.professionalAuthUid, slotId)
    : null;

  return { guardRef: existingGuardRef, pendingStudentRef, pendingStudentField, releaseSlotRef };
}

export function applyPendingInviteRelease(
  tx: Transaction,
  release: Awaited<ReturnType<typeof buildPendingInviteRelease>>,
  timestamp: string
) {
  if (release.guardRef) {
    tx.delete(release.guardRef);
  }
  if (release.pendingStudentRef && release.pendingStudentField) {
    tx.update(release.pendingStudentRef, {
      [release.pendingStudentField]: deleteField(),
      updatedAt: timestamp,
    });
  }
  if (release.releaseSlotRef) {
    tx.update(release.releaseSlotRef, {
      studentAuthUid: null,
      updatedAt: timestamp,
    });
  }
}

function getPlanCollectionForSpecialty(connection: FirestoreConnection) {
  return connection.specialty === 'fitness_coach' ? 'trainingPlans' : 'nutritionPlans';
}

function getPlanSortTimestamp(plan: unknown) {
  const data = typeof (plan as { data?: unknown })?.data === 'function'
    ? (plan as { data: () => { updatedAt?: unknown; createdAt?: unknown } }).data()
    : {};
  const updatedAt = typeof data.updatedAt === 'string' ? Date.parse(data.updatedAt) : NaN;
  if (!Number.isNaN(updatedAt)) return updatedAt;

  const createdAt = typeof data.createdAt === 'string' ? Date.parse(data.createdAt) : NaN;
  return Number.isNaN(createdAt) ? 0 : createdAt;
}

function buildTrackingAccessRecord(connection: FirestoreConnection, status: 'active' | 'ended') {
  return {
    connectionId: connection.id,
    studentAuthUid: connection.studentAuthUid,
    professionalAuthUid: connection.professionalAuthUid,
    specialty: connection.specialty,
    status,
    updatedAt: nowIso(),
  };
}

function normalizeConnectionSourceError(error: unknown): ConnectionSourceError {
  if (error instanceof ConnectionSourceError) return error;

  switch (classifyFirestoreError(error)) {
    case 'network':
      return new ConnectionSourceError('network', (error as Error)?.message ?? 'Network error.');
    case 'configuration':
      return new ConnectionSourceError('configuration', (error as Error)?.message ?? 'Configuration error.');
    default:
      return new ConnectionSourceError('invalid_response', (error as Error)?.message ?? 'Unexpected connection source error.');
  }
}

export async function submitInviteCode(
  code: string,
  deps: ConnectionSourceDeps = defaultConnectionSourceDeps
): Promise<{ connectionId: string; status: 'pending_confirmation' }> {
  try {
    return await requestSubmitInviteCode(code.trim(), {
      getCurrentIdToken: deps.getCurrentIdToken ?? defaultGetCurrentIdToken,
      getSubmitInviteFunctionUrl: deps.getSubmitInviteFunctionUrl ?? defaultGetSubmitInviteFunctionUrl,
      fetchFn: deps.fetchFn ?? fetch,
    });
  } catch (error) {
    throw normalizeConnectionSourceError(error);
  }
}

export async function confirmPendingConnection(
  connectionId: string,
  deps: ConnectionSourceDeps = defaultConnectionSourceDeps
): Promise<{ connectionId: string; status: 'active' }> {
  try {
    const firestore = deps.getFirestoreInstance();
    const professionalUid = deps.getCurrentAuthUid();

    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'connections', connectionId);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new ConnectionSourceError('graphql', 'Connection not found.');
      }

      const data = snap.data() as FirestoreConnection;
      if (data.professionalAuthUid !== professionalUid) {
        throw new ConnectionSourceError('graphql', 'Permission denied for connection confirmation.');
      }
      if (data.status !== 'pending_confirmation') {
        throw new ConnectionSourceError('graphql', 'Invalid connection transition.');
      }

      // Archive student self-managed plans for this connection specialty
      const targetCollection = getPlanCollectionForSpecialty(data);
      const selfManagedQuery = query(
        collection(firestore, targetCollection),
        where('studentAuthUid', '==', data.studentAuthUid),
        where('sourceKind', '==', 'self_managed'),
        where('isArchived', '==', false)
      );
      const selfManagedSnaps = await getDocs(selfManagedQuery);
      const timestamp = nowIso();
      const pendingRelease = await buildPendingInviteRelease(firestore, tx, data);

      tx.update(ref, {
        status: 'active',
        canceledReason: null,
        endedAt: null,
        updatedAt: timestamp,
      });
      applyPendingInviteRelease(tx, pendingRelease, timestamp);

      tx.set(getTrackingAccessRef(firestore, data), buildTrackingAccessRecord(data, 'active'), { merge: true });
      tx.set(getActiveSpecialtyRef(firestore, data), buildTrackingAccessRecord(data, 'active'), { merge: true });

      selfManagedSnaps.forEach((docSnap) => {
        tx.update(docSnap.ref, { isArchived: true, updatedAt: timestamp, lifecycleConnectionId: connectionId });
      });
    });


    return { connectionId, status: 'active' };
  } catch (error) {
    throw normalizeConnectionSourceError(error);
  }
}

export async function endConnection(
  connectionId: string,
  deps: ConnectionSourceDeps = defaultConnectionSourceDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();
    const currentUid = deps.getCurrentAuthUid();

    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'connections', connectionId);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new ConnectionSourceError('graphql', 'Connection not found.');
      }

      const data = snap.data() as FirestoreConnection;
      if (data.professionalAuthUid !== currentUid && data.studentAuthUid !== currentUid) {
        throw new ConnectionSourceError('graphql', 'Permission denied for connection end.');
      }

      const targetCollection = getPlanCollectionForSpecialty(data);
      const assignedQuery = query(
        collection(firestore, targetCollection),
        where('studentAuthUid', '==', data.studentAuthUid),
        where('ownerProfessionalUid', '==', data.professionalAuthUid),
        where('sourceKind', '==', 'assigned'),
        where('isArchived', '==', false)
      );
      const selfManagedQuery = query(
        collection(firestore, targetCollection),
        where('studentAuthUid', '==', data.studentAuthUid),
        where('sourceKind', '==', 'self_managed'),
        where('isArchived', '==', true)
      );
      const [assignedSnaps, selfManagedSnaps] = await Promise.all([
        getDocs(assignedQuery),
        getDocs(selfManagedQuery),
      ]);
      const activeSpecialtyRef = getActiveSpecialtyRef(firestore, data);
      const activeSpecialtySnap = await tx.get(activeSpecialtyRef);
      const canEndActiveSpecialty = !activeSpecialtySnap.exists()
        || activeSpecialtySnap.data()?.connectionId === connectionId;
      const timestamp = nowIso();
      const pendingRelease = await buildPendingInviteRelease(firestore, tx, data);

      tx.update(ref, {
        status: 'ended',
        endedAt: timestamp,
        updatedAt: timestamp,
      });
      applyPendingInviteRelease(tx, pendingRelease, timestamp);

      tx.set(getTrackingAccessRef(firestore, data), buildTrackingAccessRecord(data, 'ended'), { merge: true });
      if (canEndActiveSpecialty) {
        tx.set(activeSpecialtyRef, buildTrackingAccessRecord(data, 'ended'), { merge: true });
      }

      assignedSnaps.forEach((docSnap) => {
        tx.update(docSnap.ref, { isArchived: true, updatedAt: timestamp, lifecycleConnectionId: connectionId });
      });

      const latestSelfManagedSnap = [...selfManagedSnaps.docs]
        .filter((docSnap) => docSnap.data()?.lifecycleConnectionId === connectionId)
        .sort((a, b) => getPlanSortTimestamp(b) - getPlanSortTimestamp(a))[0];

      if (latestSelfManagedSnap) {
        tx.update(latestSelfManagedSnap.ref, { isArchived: false, updatedAt: timestamp, lifecycleConnectionId: connectionId });
      }
    });
  } catch (error) {
    throw normalizeConnectionSourceError(error);
  }
}

export async function getMyConnections(
  deps: ConnectionSourceDeps = defaultConnectionSourceDeps
): Promise<ConnectionRecord[]> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();

    const [studentSide, professionalSide] = await Promise.all([
      getDocs(query(collection(firestore, 'connections'), where('studentAuthUid', '==', uid))),
      getDocs(query(collection(firestore, 'connections'), where('professionalAuthUid', '==', uid))),
    ]);

    const map = new Map<string, ConnectionRecord>();

    for (const snap of [...studentSide.docs, ...professionalSide.docs]) {
      const data = snap.data() as Partial<FirestoreConnection>;
      const id = typeof data.id === 'string' ? data.id : snap.id;
      const status = normalizeConnectionStatus(data.status);
      const specialty = normalizeConnectionSpecialty(data.specialty);

      if (!id || !status || !specialty) continue;

      map.set(id, {
        id,
        status,
        canceledReason: normalizeCanceledReason(data.canceledReason ?? null),
        specialty,
        professionalAuthUid: String(data.professionalAuthUid ?? ''),
      });
    }

    return [...map.values()];
  } catch (error) {
    throw normalizeConnectionSourceError(error);
  }
}
