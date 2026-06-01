/**
 * Connection Firestore source — invite submit, confirm, end, list.
 */

import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  where,
  type Firestore,
} from 'firebase/firestore';

import { getFirestoreInstance as _getFirestoreInstance, getCurrentAuthUid as _getCurrentAuthUid, nowIso, generateId } from '../firestore';
import { classifyFirestoreError } from '../firestore-error';
import {
  normalizeConnectionStatus,
  normalizeCanceledReason,
  normalizeConnectionSpecialty,
  type ConnectionRecord,
} from './connection.logic';

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
  createdAt: string;
  updatedAt: string;
  endedAt?: string | null;
};

type FirestoreInviteCode = {
  professionalAuthUid: string;
  codeValue: string;
  status: 'active' | 'rotated' | 'revoked';
  createdAt: string;
  updatedAt: string;
  rotatedAt?: string | null;
};

export type ConnectionSourceDeps = {
  getFirestoreInstance: () => Firestore;
  getCurrentAuthUid: () => string;
};

const defaultConnectionSourceDeps: ConnectionSourceDeps = {
  getFirestoreInstance: _getFirestoreInstance,
  getCurrentAuthUid: _getCurrentAuthUid,
};

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
    const firestore = deps.getFirestoreInstance();
    const studentUid = deps.getCurrentAuthUid();

    const inviteSnapshot = await getDocs(
      query(
        collection(firestore, 'inviteCodes'),
        where('codeValue', '==', code.trim()),
        where('status', '==', 'active'),
        limit(1)
      )
    );

    if (inviteSnapshot.empty) {
      throw new ConnectionSourceError('graphql', 'Invite code not found.');
    }

    const inviteDoc = inviteSnapshot.docs[0];
    const invite = inviteDoc.data() as FirestoreInviteCode;
    const professionalUid = invite.professionalAuthUid;

    if (!professionalUid) {
      throw new ConnectionSourceError('invalid_response', 'Invite code has no professional owner.');
    }

    const existing = await getDocs(
      query(
        collection(firestore, 'connections'),
        where('studentAuthUid', '==', studentUid),
        where('professionalAuthUid', '==', professionalUid),
        where('specialty', '==', 'nutritionist')
      )
    );

    const hasActive = existing.docs.some((d) => (d.data() as FirestoreConnection).status === 'active');
    if (hasActive) {
      throw new ConnectionSourceError('graphql', 'Already connected.');
    }

    const pendingCount = (await getDocs(
      query(
        collection(firestore, 'connections'),
        where('professionalAuthUid', '==', professionalUid),
        where('status', '==', 'pending_confirmation')
      )
    )).size;

    if (pendingCount >= 10) {
      throw new ConnectionSourceError('graphql', 'Pending cap reached.');
    }

    const connectionId = generateId('conn');
    const timestamp = nowIso();

    await runTransaction(firestore, async (tx) => {
      tx.set(doc(firestore, 'connections', connectionId), {
        id: connectionId,
        studentAuthUid: studentUid,
        professionalAuthUid: professionalUid,
        specialty: 'nutritionist',
        status: 'pending_confirmation',
        canceledReason: null,
        sourceInviteCodeId: inviteDoc.id,
        createdAt: timestamp,
        updatedAt: timestamp,
        endedAt: null,
      } satisfies FirestoreConnection);
    });

    return { connectionId, status: 'pending_confirmation' };
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

      tx.update(ref, {
        status: 'active',
        canceledReason: null,
        endedAt: null,
        updatedAt: nowIso(),
      });

      tx.set(getTrackingAccessRef(firestore, data), buildTrackingAccessRecord(data, 'active'), { merge: true });
      tx.set(getActiveSpecialtyRef(firestore, data), buildTrackingAccessRecord(data, 'active'), { merge: true });

      selfManagedSnaps.forEach((docSnap) => {
        tx.update(docSnap.ref, { isArchived: true, updatedAt: nowIso(), lifecycleConnectionId: connectionId });
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

      tx.update(ref, {
        status: 'ended',
        endedAt: nowIso(),
        updatedAt: nowIso(),
      });

      tx.set(getTrackingAccessRef(firestore, data), buildTrackingAccessRecord(data, 'ended'), { merge: true });
      tx.set(getActiveSpecialtyRef(firestore, data), buildTrackingAccessRecord(data, 'ended'), { merge: true });

      assignedSnaps.forEach((docSnap) => {
        tx.update(docSnap.ref, { isArchived: true, updatedAt: nowIso(), lifecycleConnectionId: connectionId });
      });

      const latestSelfManagedSnap = [...selfManagedSnaps.docs]
        .filter((docSnap) => docSnap.data()?.lifecycleConnectionId === connectionId)
        .sort((a, b) => getPlanSortTimestamp(b) - getPlanSortTimestamp(a))[0];

      if (latestSelfManagedSnap) {
        tx.update(latestSelfManagedSnap.ref, { isArchived: false, updatedAt: nowIso(), lifecycleConnectionId: connectionId });
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
