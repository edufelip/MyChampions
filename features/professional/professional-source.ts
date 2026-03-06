/**
 * Professional Firestore source — invite code and specialty operations.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';

import { getFirestoreInstance as _getFirestoreInstance, getCurrentAuthUid as _getCurrentAuthUid, nowIso, generateId } from '../firestore';
import { classifyFirestoreError } from '../firestore-error';
import {
  normalizeInviteCodeStatus,
  type InviteCode,
} from './connection-invite.logic';
import {
  normalizeSpecialty,
  type Specialty,
  type SpecialtyRecord,
  type Credential,
} from './specialty.logic';
import {
  normalizeConnectionSpecialty,
  normalizeConnectionStatus,
  type ConnectionSpecialty,
  type ConnectionStatus,
} from '../connections/connection.logic';

// ─── Error class ──────────────────────────────────────────────────────────────

type ProfessionalSourceErrorCode =
  | 'configuration'
  | 'network'
  | 'graphql'
  | 'invalid_response';

export class ProfessionalSourceError extends Error {
  code: ProfessionalSourceErrorCode;

  constructor(code: ProfessionalSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ProfessionalSourceError';
  }
}

type FirestoreInviteCode = {
  professionalAuthUid: string;
  codeValue: string;
  status: 'active' | 'rotated' | 'revoked';
  rotatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type FirestoreSpecialty = {
  id: string;
  professionalAuthUid: string;
  specialty: Specialty;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type FirestoreCredential = {
  id: string;
  specialtyId: string;
  professionalAuthUid: string;
  specialty: Specialty;
  credentialType: 'professional_registry';
  registryId: string;
  authority: string;
  country: string;
  createdAt: string;
  updatedAt: string;
};

type FirestoreConnection = {
  id: string;
  status: string;
  specialty: string;
  professionalAuthUid: string;
  studentAuthUid: string;
};

type FirestoreUserProfile = {
  displayName: string;
};

export type ProfessionalStudentRosterItem = {
  studentAuthUid: string;
  displayName: string;
  specialty: ConnectionSpecialty;
  assignmentStatus: 'active' | 'pending';
};

export type ProfessionalStudentAssignmentSnapshot = {
  studentAuthUid: string;
  displayName: string;
  nutritionStatus: 'active' | 'pending' | 'none';
  trainingStatus: 'active' | 'pending' | 'none';
  activeConnectionIds: string[];
};

export type SpecialtyBlockerCounts = {
  activeCount: number;
  pendingCount: number;
};

export type ProfessionalSourceDeps = {
  getFirestoreInstance: () => Firestore;
  getCurrentAuthUid: () => string;
  generateInviteCode: () => string;
};

const defaultDeps: ProfessionalSourceDeps = {
  getFirestoreInstance: _getFirestoreInstance,
  getCurrentAuthUid: _getCurrentAuthUid,
  generateInviteCode: () => Math.random().toString(36).slice(2, 8).toUpperCase(),
};

function summarizeStudentConnections(
  rows: Array<{ status: ConnectionStatus; specialty: ConnectionSpecialty }>
): {
  assignmentStatus: 'active' | 'pending' | null;
  representativeSpecialty: ConnectionSpecialty;
  nutritionStatus: 'active' | 'pending' | 'none';
  trainingStatus: 'active' | 'pending' | 'none';
} {
  let nutritionStatus: 'active' | 'pending' | 'none' = 'none';
  let trainingStatus: 'active' | 'pending' | 'none' = 'none';

  for (const row of rows) {
    const nextStatus = row.status === 'active' ? 'active' : row.status === 'pending_confirmation' ? 'pending' : 'none';
    if (nextStatus === 'none') continue;

    if (row.specialty === 'nutritionist') {
      if (nutritionStatus !== 'active') nutritionStatus = nextStatus;
      continue;
    }

    if (trainingStatus !== 'active') trainingStatus = nextStatus;
  }

  const assignmentStatus = nutritionStatus === 'active' || trainingStatus === 'active'
    ? 'active'
    : nutritionStatus === 'pending' || trainingStatus === 'pending'
      ? 'pending'
      : null;

  const representativeSpecialty =
    nutritionStatus !== 'none' ? 'nutritionist' : 'fitness_coach';

  return { assignmentStatus, representativeSpecialty, nutritionStatus, trainingStatus };
}

function normalizeProfessionalSourceError(error: unknown): ProfessionalSourceError {
  if (error instanceof ProfessionalSourceError) return error;

  switch (classifyFirestoreError(error)) {
    case 'network':
      return new ProfessionalSourceError('network', (error as Error)?.message ?? 'Network error.');
    case 'configuration':
      return new ProfessionalSourceError('configuration', (error as Error)?.message ?? 'Configuration error.');
    default:
      return new ProfessionalSourceError('invalid_response', (error as Error)?.message ?? 'Unexpected professional source error.');
  }
}

function inviteRef(firestore: Firestore, professionalUid: string) {
  return doc(firestore, 'inviteCodes', professionalUid);
}

export async function getOrCreateActiveInviteCode(
  deps = defaultDeps
): Promise<InviteCode | null> {
  try {
    const firestore = deps.getFirestoreInstance();
    const professionalUid = deps.getCurrentAuthUid();

    const ref = inviteRef(firestore, professionalUid);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
      const timestamp = nowIso();
      const created: FirestoreInviteCode = {
        professionalAuthUid: professionalUid,
        codeValue: deps.generateInviteCode(),
        status: 'active',
        rotatedAt: null,
        expiresAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await runTransaction(firestore, async (tx) => {
        tx.set(ref, created);
      });
      return {
        id: professionalUid,
        codeValue: created.codeValue,
        status: 'active',
        rotatedAt: null,
        expiresAt: null,
        createdAt: timestamp,
      };
    }

    const data = snapshot.data() as FirestoreInviteCode;
    const status = normalizeInviteCodeStatus(data.status);
    if (!status) return null;

    return {
      id: snapshot.id,
      codeValue: data.codeValue,
      status,
      rotatedAt: data.rotatedAt ?? null,
      expiresAt: data.expiresAt ?? null,
      createdAt: data.createdAt,
    };
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function rotateInviteCode(deps = defaultDeps): Promise<InviteCode> {
  try {
    const firestore = deps.getFirestoreInstance();
    const professionalUid = deps.getCurrentAuthUid();

    const ref = inviteRef(firestore, professionalUid);
    const now = nowIso();

    await runTransaction(firestore, async (tx) => {
      const currentSnap = await tx.get(ref);
      if (!currentSnap.exists()) {
        tx.set(ref, {
          professionalAuthUid: professionalUid,
          codeValue: deps.generateInviteCode(),
          status: 'active',
          rotatedAt: now,
          expiresAt: null,
          createdAt: now,
          updatedAt: now,
        } satisfies FirestoreInviteCode);
      } else {
        tx.update(ref, {
          codeValue: deps.generateInviteCode(),
          status: 'active',
          rotatedAt: now,
          updatedAt: now,
        });
      }

      const pending = await getDocs(query(
        collection(firestore, 'connections'),
        where('professionalAuthUid', '==', professionalUid),
        where('status', '==', 'pending_confirmation')
      ));

      for (const pendingDoc of pending.docs) {
        tx.update(pendingDoc.ref, {
          status: 'ended',
          canceledReason: 'code_rotated',
          endedAt: now,
          updatedAt: now,
        });
      }
    });

    const code = await getOrCreateActiveInviteCode(deps);
    if (!code) {
      throw new ProfessionalSourceError('invalid_response', 'rotateInviteCode succeeded but fetch returned no code.');
    }
    return code;
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function getProfessionalSpecialties(deps = defaultDeps): Promise<SpecialtyRecord[]> {
  try {
    const firestore = deps.getFirestoreInstance();
    const professionalUid = deps.getCurrentAuthUid();

    const [specialtyDocs, credentialDocs] = await Promise.all([
      getDocs(query(collection(firestore, 'specialties'), where('professionalAuthUid', '==', professionalUid))),
      getDocs(query(collection(firestore, 'credentials'), where('professionalAuthUid', '==', professionalUid))),
    ]);

    const credentialsBySpecialtyId = new Map<string, Credential>();
    for (const docSnap of credentialDocs.docs) {
      const raw = docSnap.data() as FirestoreCredential;
      const specialty = normalizeSpecialty(raw.specialty);
      if (!specialty) continue;
      credentialsBySpecialtyId.set(raw.specialtyId, {
        id: raw.id,
        specialty,
        credentialType: 'professional_registry',
        registryId: raw.registryId,
        authority: raw.authority,
        country: raw.country,
      });
    }

    return specialtyDocs.docs.flatMap((item) => {
      const raw = item.data() as FirestoreSpecialty;
      const specialty = normalizeSpecialty(raw.specialty);
      if (!specialty) return [];
      return [{
        id: raw.id,
        specialty,
        isActive: raw.isActive,
        credential: credentialsBySpecialtyId.get(raw.id) ?? null,
      } satisfies SpecialtyRecord];
    });
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function addProfessionalSpecialty(
  specialty: Specialty,
  deps = defaultDeps
): Promise<{ id: string; specialty: Specialty }> {
  try {
    const firestore = deps.getFirestoreInstance();
    const professionalUid = deps.getCurrentAuthUid();

    const existing = await getDocs(query(
      collection(firestore, 'specialties'),
      where('professionalAuthUid', '==', professionalUid),
      where('specialty', '==', specialty),
      limit(1)
    ));

    if (!existing.empty) {
      const docSnap = existing.docs[0];
      const data = docSnap.data() as FirestoreSpecialty;
      if (!data.isActive) {
        await runTransaction(firestore, async (tx) => {
          tx.update(docSnap.ref, { isActive: true, updatedAt: nowIso() });
        });
      }
      return { id: docSnap.id, specialty };
    }

    const id = generateId('specialty');
    const timestamp = nowIso();
    await runTransaction(firestore, async (tx) => {
      tx.set(doc(firestore, 'specialties', id), {
        id,
        professionalAuthUid: professionalUid,
        specialty,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies FirestoreSpecialty);
    });

    return { id, specialty };
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function removeProfessionalSpecialty(
  specialtyId: string,
  deps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();
    const professionalUid = deps.getCurrentAuthUid();
    const specialtySnapshot = await getDoc(doc(firestore, 'specialties', specialtyId));
    if (!specialtySnapshot.exists()) {
      throw new ProfessionalSourceError('graphql', 'Specialty not found.');
    }
    const specialtyDoc = specialtySnapshot.data() as FirestoreSpecialty;

    const [active, pending] = await Promise.all([
      getDocs(query(
        collection(firestore, 'connections'),
        where('professionalAuthUid', '==', professionalUid),
        where('specialty', '==', specialtyDoc.specialty),
        where('status', '==', 'active')
      )),
      getDocs(query(
        collection(firestore, 'connections'),
        where('professionalAuthUid', '==', professionalUid),
        where('specialty', '==', specialtyDoc.specialty),
        where('status', '==', 'pending_confirmation')
      )),
    ]);

    if (active.size > 0 || pending.size > 0) {
      throw new ProfessionalSourceError('graphql', 'Specialty removal blocked by active/pending students.');
    }

    await runTransaction(firestore, async (tx) => {
      tx.delete(doc(firestore, 'specialties', specialtyId));
    });
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function getSpecialtyBlockerCounts(
  specialty: Specialty,
  deps = defaultDeps
): Promise<SpecialtyBlockerCounts> {
  try {
    const firestore = deps.getFirestoreInstance();
    const professionalUid = deps.getCurrentAuthUid();
    const [active, pending] = await Promise.all([
      getDocs(
        query(
          collection(firestore, 'connections'),
          where('professionalAuthUid', '==', professionalUid),
          where('specialty', '==', specialty),
          where('status', '==', 'active')
        )
      ),
      getDocs(
        query(
          collection(firestore, 'connections'),
          where('professionalAuthUid', '==', professionalUid),
          where('specialty', '==', specialty),
          where('status', '==', 'pending_confirmation')
        )
      ),
    ]);

    return {
      activeCount: active.size,
      pendingCount: pending.size,
    };
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function upsertProfessionalCredential(
  specialtyId: string,
  input: { registryId: string; authority: string; country: string },
  deps = defaultDeps
): Promise<{ id: string }> {
  try {
    const firestore = deps.getFirestoreInstance();
    const professionalUid = deps.getCurrentAuthUid();

    const specialtySnap = await getDoc(doc(firestore, 'specialties', specialtyId));
    if (!specialtySnap.exists()) {
      throw new ProfessionalSourceError('graphql', 'Specialty not found for credential upsert.');
    }
    const specialtyRaw = specialtySnap.data() as FirestoreSpecialty;

    const credentialId = specialtyId;
    const timestamp = nowIso();
    await runTransaction(firestore, async (tx) => {
      tx.set(doc(firestore, 'credentials', credentialId), {
        id: credentialId,
        specialtyId,
        professionalAuthUid: professionalUid,
        specialty: specialtyRaw.specialty,
        credentialType: 'professional_registry',
        registryId: input.registryId,
        authority: input.authority,
        country: input.country,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies FirestoreCredential, { merge: true });
    });

    return { id: credentialId };
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function getProfessionalStudentRoster(
  deps = defaultDeps
): Promise<ProfessionalStudentRosterItem[]> {
  try {
    const firestore = deps.getFirestoreInstance();
    const professionalUid = deps.getCurrentAuthUid();
    const snapshot = await getDocs(
      query(collection(firestore, 'connections'), where('professionalAuthUid', '==', professionalUid))
    );

    const byStudent = new Map<string, Array<{ status: ConnectionStatus; specialty: ConnectionSpecialty }>>();
    for (const item of snapshot.docs) {
      const raw = item.data() as Partial<FirestoreConnection>;
      const status = normalizeConnectionStatus(raw.status);
      const specialty = normalizeConnectionSpecialty(raw.specialty);
      const studentAuthUid = typeof raw.studentAuthUid === 'string' ? raw.studentAuthUid : '';
      if (!status || !specialty || !studentAuthUid) continue;
      if (status !== 'active' && status !== 'pending_confirmation') continue;
      const current = byStudent.get(studentAuthUid) ?? [];
      current.push({ status, specialty });
      byStudent.set(studentAuthUid, current);
    }

    const entries = [...byStudent.entries()];
    const rows = await Promise.all(
      entries.map(async ([studentAuthUid, connections]) => {
        const summary = summarizeStudentConnections(connections);
        if (!summary.assignmentStatus) return null;

        const profileSnap = await getDoc(doc(firestore, 'userProfiles', studentAuthUid));
        const displayNameRaw = profileSnap.exists()
          ? ((profileSnap.data() as Partial<FirestoreUserProfile>).displayName ?? '')
          : '';
        const displayName = String(displayNameRaw).trim() || studentAuthUid;

        return {
          studentAuthUid,
          displayName,
          specialty: summary.representativeSpecialty,
          assignmentStatus: summary.assignmentStatus,
        } satisfies ProfessionalStudentRosterItem;
      })
    );

    return rows
      .filter((item): item is ProfessionalStudentRosterItem => item !== null)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function getProfessionalStudentAssignmentSnapshot(
  studentAuthUid: string,
  deps = defaultDeps
): Promise<ProfessionalStudentAssignmentSnapshot> {
  try {
    const firestore = deps.getFirestoreInstance();
    const professionalUid = deps.getCurrentAuthUid();
    const snapshot = await getDocs(
      query(collection(firestore, 'connections'), where('professionalAuthUid', '==', professionalUid))
    );

    const relevantRows: Array<{
      id: string;
      status: ConnectionStatus;
      specialty: ConnectionSpecialty;
    }> = [];

    for (const item of snapshot.docs) {
      const raw = item.data() as Partial<FirestoreConnection>;
      const status = normalizeConnectionStatus(raw.status);
      const specialty = normalizeConnectionSpecialty(raw.specialty);
      if (!status || !specialty) continue;
      if (raw.studentAuthUid !== studentAuthUid) continue;
      relevantRows.push({ id: item.id, status, specialty });
    }

    const summarized = summarizeStudentConnections(
      relevantRows.map((row) => ({ status: row.status, specialty: row.specialty }))
    );

    const profileSnap = await getDoc(doc(firestore, 'userProfiles', studentAuthUid));
    const displayNameRaw = profileSnap.exists()
      ? ((profileSnap.data() as Partial<FirestoreUserProfile>).displayName ?? '')
      : '';
    const displayName = String(displayNameRaw).trim() || studentAuthUid;

    return {
      studentAuthUid,
      displayName,
      nutritionStatus: summarized.nutritionStatus,
      trainingStatus: summarized.trainingStatus,
      activeConnectionIds: relevantRows
        .filter((row) => row.status === 'active')
        .map((row) => row.id),
    };
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function unbindStudentConnections(
  studentAuthUid: string,
  deps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();
    const professionalUid = deps.getCurrentAuthUid();
    const snapshot = await getDocs(
      query(
        collection(firestore, 'connections'),
        where('professionalAuthUid', '==', professionalUid),
        where('studentAuthUid', '==', studentAuthUid),
        where('status', '==', 'active')
      )
    );

    if (snapshot.empty) return;
    const timestamp = nowIso();
    await Promise.all(
      snapshot.docs.map((item) =>
        updateDoc(item.ref, {
          status: 'ended',
          endedAt: timestamp,
          updatedAt: timestamp,
        })
      )
    );
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}
