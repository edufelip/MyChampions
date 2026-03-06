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

      tx.update(ref, {
        status: 'active',
        canceledReason: null,
        endedAt: null,
        updatedAt: nowIso(),
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

      tx.update(ref, {
        status: 'ended',
        endedAt: nowIso(),
        updatedAt: nowIso(),
      });
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
