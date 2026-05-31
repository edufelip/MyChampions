/**
 * Workout logging Firestore source operations — daily check-off log creation & queries.
 */

import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore';

import { getCurrentAuthUid as _getCurrentAuthUid, getFirestoreInstance as _getFirestoreInstance, nowIso, generateId } from '../firestore';
import { classifyFirestoreError } from '../firestore-error';

export type FirestoreWorkoutLog = {
  id: string;
  ownerUid: string;
  sessionId: string;
  sessionName: string;
  createdAt: string;
};

type WorkoutLogSourceDeps = {
  getFirestoreInstance: () => Firestore;
  getCurrentAuthUid: () => string;
};

const defaultDeps: WorkoutLogSourceDeps = {
  getFirestoreInstance: _getFirestoreInstance,
  getCurrentAuthUid: _getCurrentAuthUid,
};

export class WorkoutLogSourceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'WorkoutLogSourceError';
  }
}

function normalizeError(error: any): WorkoutLogSourceError {
  const classified = classifyFirestoreError(error);
  return new WorkoutLogSourceError(classified.code, classified.message);
}

export async function logWorkoutSession(
  sessionId: string,
  sessionName: string,
  deps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();
    const id = generateId('workout_log');
    const timestamp = nowIso();

    await setDoc(doc(firestore, 'workoutLogs', id), {
      id,
      ownerUid: uid,
      sessionId,
      sessionName,
      createdAt: timestamp,
    } satisfies FirestoreWorkoutLog);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getTodayWorkoutLogs(deps = defaultDeps): Promise<FirestoreWorkoutLog[]> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartIso = todayStart.toISOString();

    const q = query(
      collection(firestore, 'workoutLogs'),
      where('ownerUid', '==', uid),
      where('createdAt', '>=', todayStartIso)
    );

    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => docSnap.data() as FirestoreWorkoutLog);
  } catch (error) {
    throw normalizeError(error);
  }
}
