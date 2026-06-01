import {
  collection,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';

import { getCurrentAuthUid as _getCurrentAuthUid, getFirestoreInstance as _getFirestoreInstance } from '../firestore';
import { classifyFirestoreError } from '../firestore-error';
import type { FirestorePortionLog } from '../nutrition/custom-meal-source';
import type { WaterIntakeLog } from '../nutrition/water-tracking.logic';

import { buildStudentTrackingReview, type StudentTrackingReview } from './student-tracking-review.logic';

export type { StudentTrackingReview };

export type StudentTrackingReviewSourceErrorCode = 'configuration' | 'network' | 'invalid_response';

export class StudentTrackingReviewSourceError extends Error {
  code: StudentTrackingReviewSourceErrorCode;

  constructor(code: StudentTrackingReviewSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'StudentTrackingReviewSourceError';
  }
}

export type StudentTrackingReviewSourceDeps = {
  getFirestoreInstance: () => Firestore;
  getCurrentAuthUid: () => string;
};

const defaultDeps: StudentTrackingReviewSourceDeps = {
  getFirestoreInstance: _getFirestoreInstance,
  getCurrentAuthUid: _getCurrentAuthUid,
};

export function buildStudentTrackingReviewDateWindow(todayKey: string): {
  startDateKey: string;
  endDateKey: string;
  startLoggedAtIso: string;
} {
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const start = new Date(today.getTime() - 6 * 86_400_000);
  const startDateKey = start.toISOString().slice(0, 10);
  return {
    startDateKey,
    endDateKey: todayKey,
    startLoggedAtIso: `${startDateKey}T00:00:00.000Z`,
  };
}

export function normalizeStudentTrackingReviewError(error: unknown): StudentTrackingReviewSourceError {
  if (error instanceof StudentTrackingReviewSourceError) return error;

  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '').toLowerCase()
    : '';
  if (message.includes('firebase') && message.includes('initialized')) {
    return new StudentTrackingReviewSourceError('configuration', (error as Error).message);
  }

  switch (classifyFirestoreError(error)) {
    case 'network':
      return new StudentTrackingReviewSourceError('network', (error as Error)?.message ?? 'Network error.');
    case 'configuration':
      return new StudentTrackingReviewSourceError('configuration', (error as Error)?.message ?? 'Configuration error.');
    default:
      return new StudentTrackingReviewSourceError(
        'invalid_response',
        (error as Error)?.message ?? 'Unexpected student tracking review source error.'
      );
  }
}

export async function getStudentTrackingReview(
  studentUid: string,
  input: { todayKey: string; waterGoalMl: number | null },
  deps = defaultDeps
): Promise<StudentTrackingReview> {
  try {
    const firestore = deps.getFirestoreInstance();
    deps.getCurrentAuthUid();
    const dateWindow = buildStudentTrackingReviewDateWindow(input.todayKey);

    const [waterSnap, portionSnap] = await Promise.all([
      getDocs(query(
        collection(firestore, 'waterLogs'),
        where('ownerUid', '==', studentUid),
        where('dateKey', '>=', dateWindow.startDateKey),
        where('dateKey', '<=', dateWindow.endDateKey)
      )),
      getDocs(query(
        collection(firestore, 'portionLogs'),
        where('ownerUid', '==', studentUid),
        where('loggedAt', '>=', dateWindow.startLoggedAtIso)
      )),
    ]);

    const waterLogs = waterSnap.docs.map((snap) => {
      const raw = snap.data() as { id: string; dateKey: string; totalMl: number; loggedAt: string };
      return {
        id: raw.id,
        dateKey: raw.dateKey,
        totalMl: raw.totalMl,
        loggedAt: raw.loggedAt,
      } satisfies WaterIntakeLog;
    });
    const portionLogs = portionSnap.docs.map((snap) => snap.data() as FirestorePortionLog);

    return buildStudentTrackingReview({
      todayKey: input.todayKey,
      waterGoalMl: input.waterGoalMl,
      waterLogs,
      portionLogs,
    });
  } catch (error) {
    throw normalizeStudentTrackingReviewError(error);
  }
}
