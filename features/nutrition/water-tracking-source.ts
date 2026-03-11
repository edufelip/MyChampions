/**
 * Water tracking Firestore source — intake logging + effective goal context.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
  type Firestore,
} from 'firebase/firestore';

import { getFirestoreInstance as _getFirestoreInstance, getCurrentAuthUid as _getCurrentAuthUid, nowIso } from '../firestore';
import { classifyFirestoreError } from '../firestore-error';
import { resolvePlanHydrationGoalContext, type PlanHydrationSnapshot, type WaterIntakeLog } from './water-tracking.logic';

type WaterSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

export class WaterTrackingSourceError extends Error {
  code: WaterSourceErrorCode;

  constructor(code: WaterSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'WaterTrackingSourceError';
  }
}

type FirestoreWaterLog = {
  id: string;
  ownerUid: string;
  dateKey: string;
  totalMl: number;
  loggedAt: string;
};

type FirestoreWaterGoal = {
  ownerUid: string;
  personalDailyMl: number | null;
  nutritionistDailyMl: number | null;
  nutritionistAuthUid: string | null;
  updatedAt: string;
};

type FirestoreNutritionPlanHydration = PlanHydrationSnapshot & { isArchived: boolean };

type FirestoreConnectionAssignment = {
  professionalAuthUid: string;
};

export type WaterTrackingSourceDeps = {
  getFirestoreInstance: () => Firestore;
  getCurrentAuthUid: () => string;
};

const defaultDeps: WaterTrackingSourceDeps = {
  getFirestoreInstance: _getFirestoreInstance,
  getCurrentAuthUid: _getCurrentAuthUid,
};

function normalizeWaterSourceError(error: unknown): WaterTrackingSourceError {
  if (error instanceof WaterTrackingSourceError) return error;

  switch (classifyFirestoreError(error)) {
    case 'network':
      return new WaterTrackingSourceError('network', (error as Error)?.message ?? 'Network error.');
    case 'configuration':
      return new WaterTrackingSourceError('configuration', (error as Error)?.message ?? 'Configuration error.');
    default:
      return new WaterTrackingSourceError('invalid_response', (error as Error)?.message ?? 'Unexpected water source error.');
  }
}

export async function getMyWaterLogs(deps = defaultDeps): Promise<WaterIntakeLog[]> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();

    const snapshots = await getDocs(query(collection(firestore, 'waterLogs'), where('ownerUid', '==', uid)));

    return snapshots.docs
      .map((snap) => snap.data() as FirestoreWaterLog)
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
      .map((raw) => ({
        id: raw.id,
        dateKey: raw.dateKey,
        totalMl: raw.totalMl,
        loggedAt: raw.loggedAt,
      }));
  } catch (error) {
    throw normalizeWaterSourceError(error);
  }
}

export async function logWaterIntake(
  amountMl: number,
  dateKey: string,
  deps = defaultDeps
): Promise<string> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();
    const id = `${uid}_${dateKey}`;

    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'waterLogs', id);
      const snap = await tx.get(ref);
      const current = snap.exists() ? (snap.data() as FirestoreWaterLog).totalMl : 0;
      tx.set(ref, {
        id,
        ownerUid: uid,
        dateKey,
        totalMl: current + amountMl,
        loggedAt: nowIso(),
      } satisfies FirestoreWaterLog, { merge: true });
    });

    return id;
  } catch (error) {
    throw normalizeWaterSourceError(error);
  }
}

export async function getMyWaterGoalContext(deps = defaultDeps): Promise<{
  studentGoalMl: number | null;
  nutritionistGoalMl: number | null;
  hasActiveNutritionistAssignment: boolean;
}> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();

    const plansSnap = await getDocs(
      query(
        collection(firestore, 'nutritionPlans'),
        where('studentAuthUid', '==', uid),
        where('isArchived', '==', false)
      )
    );

    const plans = plansSnap.docs.map((d) => d.data() as FirestoreNutritionPlanHydration);

    const activeAssignmentsSnap = await getDocs(query(
      collection(firestore, 'connections'),
      where('studentAuthUid', '==', uid),
      where('specialty', '==', 'nutritionist'),
      where('status', '==', 'active')
    ));
    const activeNutritionistUids = new Set<string>(
      activeAssignmentsSnap.docs
        .map((d) => (d.data() as FirestoreConnectionAssignment).professionalAuthUid)
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
    );

    const planContext = resolvePlanHydrationGoalContext({
      plans,
      activeNutritionistUids,
      currentUserUid: uid,
    });

    if (planContext) {
      return planContext;
    }

    // Backward-compatibility fallback while existing users still have waterGoals records.
    const snap = await getDoc(doc(firestore, 'waterGoals', uid));
    const raw = snap.exists() ? (snap.data() as FirestoreWaterGoal) : null;

    let hasActiveNutritionistAssignment = false;
    if (raw?.nutritionistAuthUid) {
      const activeAssignments = await getDocs(query(
        collection(firestore, 'connections'),
        where('professionalAuthUid', '==', raw.nutritionistAuthUid),
        where('studentAuthUid', '==', uid),
        where('specialty', '==', 'nutritionist'),
        where('status', '==', 'active')
      ));
      hasActiveNutritionistAssignment = !activeAssignments.empty;
    }

    return {
      studentGoalMl: raw?.personalDailyMl ?? null,
      nutritionistGoalMl: raw?.nutritionistDailyMl ?? null,
      hasActiveNutritionistAssignment,
    };
  } catch (error) {
    throw normalizeWaterSourceError(error);
  }
}
