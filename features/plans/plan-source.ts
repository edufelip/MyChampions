/**
 * Plan Firestore source — plan CRUD, predefined library, bulk assign,
 * and plan-change request operations.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

import { getFirestoreInstance as _getFirestoreInstance, getCurrentAuthUid as _getCurrentAuthUid, nowIso, generateId } from '../firestore';
import { classifyFirestoreError } from '../firestore-error';
import {
  normalizePlanChangeRequestStatus,
  normalizePlanType,
  type PlanType,
  type PlanChangeRequest,
  type PlanChangeRequestStatus,
} from './plan-change-request.logic';

export type PlanSourceKind = 'predefined' | 'assigned' | 'self_managed';

export type Plan = {
  id: string;
  planType: PlanType;
  sourceKind: PlanSourceKind;
  ownerProfessionalUid: string | null;
  studentUid: string;
  isArchived: boolean;
  name: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PredefinedPlan = {
  id: string;
  planType: PlanType;
  name: string;
  ownerProfessionalUid: string;
  createdAt: string;
  updatedAt: string;
};

export type NutritionPlan = Plan & {
  isDraft: boolean;
  hydrationGoalMl: number | null;
  caloriesTarget: number | null;
  carbsTarget: number | null;
  proteinsTarget: number | null;
  fatsTarget: number | null;
};

type FirestoreNutritionPlan = {
  id: string;
  ownerProfessionalUid: string | null;
  studentAuthUid: string;
  sourceKind: PlanSourceKind;
  isArchived: boolean;
  isDraft: boolean;
  name: string;
  hydrationGoalMl: number | null;
  caloriesTarget: number;
  carbsTarget: number;
  proteinsTarget: number;
  fatsTarget: number;
  createdAt: string;
  updatedAt: string;
};

type FirestoreTrainingPlan = {
  id: string;
  ownerProfessionalUid: string | null;
  studentAuthUid: string;
  sourceKind: PlanSourceKind;
  isArchived: boolean;
  isDraft: boolean;
  name: string;
  sessions: Array<{ id: string; sessionName: string; items: Array<{ id: string; exerciseName: string }> }>;
  createdAt: string;
  updatedAt: string;
};

type FirestorePlanChangeRequest = {
  id: string;
  planId: string;
  planType: PlanType;
  studentAuthUid: string;
  requestText: string;
  status: PlanChangeRequestStatus;
  createdAt: string;
  updatedAt: string;
};

type PlanSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

// ─── Global Cache (Optimistic UI) ──────────────────────────────────────────

let globalPlansCache: Plan[] | null = null;
let globalPredefinedPlansCache: PredefinedPlan[] | null = null;

export function getCachedPlans(): Plan[] | null {
  return globalPlansCache;
}

export function getCachedPredefinedPlans(): PredefinedPlan[] | null {
  return globalPredefinedPlansCache;
}

export function setCachedPlans(plans: Plan[]) {
  globalPlansCache = plans;
}

export function setCachedPredefinedPlans(plans: PredefinedPlan[]) {
  globalPredefinedPlansCache = plans;
}

/**
 * Optimistically adds or updates a predefined plan in the global cache.
 * Useful for seamless transitions after a builder save before the next fetch.
 */
export function optimisticUpdatePredefinedPlan(plan: PredefinedPlan) {
  if (!globalPredefinedPlansCache) {
    globalPredefinedPlansCache = [plan];
    return;
  }

  const index = globalPredefinedPlansCache.findIndex((p) => p.id === plan.id);
  if (index >= 0) {
    const next = [...globalPredefinedPlansCache];
    next[index] = plan;
    globalPredefinedPlansCache = next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } else {
    globalPredefinedPlansCache = [plan, ...globalPredefinedPlansCache].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }
}

/**
 * Optimistically removes a predefined plan from the global cache.
 */
export function optimisticDeletePredefinedPlan(planId: string) {
  if (!globalPredefinedPlansCache) return;
  globalPredefinedPlansCache = globalPredefinedPlansCache.filter((p) => p.id !== planId);
}

export class PlanSourceError extends Error {
  code: PlanSourceErrorCode;

  constructor(code: PlanSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PlanSourceError';
  }
}

export type PlanSourceDeps = {
  getFirestoreInstance: () => Firestore;
  getCurrentAuthUid: () => string;
};

const defaultDeps: PlanSourceDeps = {
  getFirestoreInstance: _getFirestoreInstance,
  getCurrentAuthUid: _getCurrentAuthUid,
};

function normalizePlanSourceError(error: unknown): PlanSourceError {
  if (error instanceof PlanSourceError) return error;

  switch (classifyFirestoreError(error)) {
    case 'network':
      return new PlanSourceError('network', (error as Error)?.message ?? 'Network error.');
    case 'configuration':
      return new PlanSourceError('configuration', (error as Error)?.message ?? 'Configuration error.');
    default:
      return new PlanSourceError('invalid_response', (error as Error)?.message ?? 'Unexpected plan source error.');
  }
}

function toNutritionPlan(raw: FirestoreNutritionPlan): NutritionPlan {
  return {
    id: raw.id,
    name: raw.name ?? null,
    planType: 'nutrition',
    sourceKind: raw.sourceKind ?? 'assigned',
    ownerProfessionalUid: raw.ownerProfessionalUid ?? null,
    studentUid: raw.studentAuthUid,
    isArchived: raw.isArchived,
    isDraft: raw.isDraft,
    hydrationGoalMl: raw.hydrationGoalMl ?? null,
    caloriesTarget: raw.caloriesTarget ?? null,
    carbsTarget: raw.carbsTarget ?? null,
    proteinsTarget: raw.proteinsTarget ?? null,
    fatsTarget: raw.fatsTarget ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function toPlanFromTraining(raw: FirestoreTrainingPlan): Plan {
  return {
    id: raw.id,
    name: raw.name ?? null,
    planType: 'training',
    sourceKind: raw.sourceKind ?? 'assigned',
    ownerProfessionalUid: raw.ownerProfessionalUid ?? null,
    studentUid: raw.studentAuthUid,
    isArchived: raw.isArchived,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function getMyPlans(deps = defaultDeps): Promise<Plan[]> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();

    const [asStudentNutrition, asOwnerNutrition, asStudentTraining, asOwnerTraining] = await Promise.all([
      getDocs(query(collection(firestore, 'nutritionPlans'), where('studentAuthUid', '==', uid))),
      getDocs(query(collection(firestore, 'nutritionPlans'), where('ownerProfessionalUid', '==', uid))),
      getDocs(query(collection(firestore, 'trainingPlans'), where('studentAuthUid', '==', uid))),
      getDocs(query(collection(firestore, 'trainingPlans'), where('ownerProfessionalUid', '==', uid))),
    ]);

    const unique = new Map<string, Plan>();
    for (const snap of [...asStudentNutrition.docs, ...asOwnerNutrition.docs]) {
      const raw = snap.data() as FirestoreNutritionPlan;
      unique.set(`nutrition:${snap.id}`, toNutritionPlan(raw));
    }
    for (const snap of [...asStudentTraining.docs, ...asOwnerTraining.docs]) {
      const raw = snap.data() as FirestoreTrainingPlan;
      unique.set(`training:${snap.id}`, toPlanFromTraining(raw));
    }

    const result = [...unique.values()];
    setCachedPlans(result);
    return result;
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}

export async function getMyPredefinedPlans(deps = defaultDeps): Promise<PredefinedPlan[]> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();

    const [nutritionPlans, trainingPlans] = await Promise.all([
      getDocs(query(
        collection(firestore, 'nutritionPlans'),
        where('ownerProfessionalUid', '==', uid),
        where('sourceKind', '==', 'predefined')
      )),
      getDocs(query(
        collection(firestore, 'trainingPlans'),
        where('ownerProfessionalUid', '==', uid),
        where('sourceKind', '==', 'predefined')
      )),
    ]);

    const nutritionPredefined = nutritionPlans.docs.map((snap) => {
      const raw = snap.data() as FirestoreNutritionPlan;
      return {
        id: raw.id ?? snap.id,
        name: raw.name,
        planType: 'nutrition' as PlanType,
        ownerProfessionalUid: uid,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      };
    });
    const trainingPredefined = trainingPlans.docs.map((snap) => {
      const raw = snap.data() as FirestoreTrainingPlan;
      return {
        id: raw.id ?? snap.id,
        name: raw.name,
        planType: 'training' as PlanType,
        ownerProfessionalUid: uid,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      };
    });

    const result = [...nutritionPredefined, ...trainingPredefined].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
    setCachedPredefinedPlans(result);
    return result;
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}

export async function bulkAssignPredefinedPlan(
  predefinedPlanId: string,
  studentUids: string[],
  deps = defaultDeps
): Promise<{ assignedCount: number }> {
  try {
    const firestore = deps.getFirestoreInstance();
    const professionalUid = deps.getCurrentAuthUid();

    const [nutritionSourceSnap, trainingSourceSnap] = await Promise.all([
      getDoc(doc(firestore, 'nutritionPlans', predefinedPlanId)),
      getDoc(doc(firestore, 'trainingPlans', predefinedPlanId)),
    ]);
    if (!nutritionSourceSnap.exists() && !trainingSourceSnap.exists()) {
      throw new PlanSourceError('graphql', 'Predefined plan not found.');
    }
    const sourceKind = (nutritionSourceSnap.exists()
      ? (nutritionSourceSnap.data() as FirestoreNutritionPlan).sourceKind
      : (trainingSourceSnap.data() as FirestoreTrainingPlan).sourceKind);
    if (sourceKind !== 'predefined') {
      throw new PlanSourceError('invalid_response', 'Only predefined plans can be bulk-assigned.');
    }

    const ownerProfessionalUid = (nutritionSourceSnap.exists()
      ? (nutritionSourceSnap.data() as FirestoreNutritionPlan).ownerProfessionalUid
      : (trainingSourceSnap.data() as FirestoreTrainingPlan).ownerProfessionalUid);
    if (ownerProfessionalUid !== professionalUid) {
      throw new PlanSourceError('configuration', 'Cannot bulk-assign a plan owned by another professional.');
    }

    const uniqueStudentUids = [...new Set(studentUids)].filter((uid) => Boolean(uid));
    const timestamp = nowIso();
    let batch = writeBatch(firestore);
    let writesInBatch = 0;
    let assignedCount = 0;

    const flushBatch = async () => {
      if (writesInBatch === 0) return;
      await batch.commit();
      batch = writeBatch(firestore);
      writesInBatch = 0;
    };

    for (const studentUid of uniqueStudentUids) {
      if (nutritionSourceSnap.exists()) {
        const source = nutritionSourceSnap.data() as FirestoreNutritionPlan;
        const id = generateId('nutrition_plan');
        batch.set(doc(firestore, 'nutritionPlans', id), {
          ...source,
          id,
          ownerProfessionalUid: professionalUid,
          studentAuthUid: studentUid,
          sourceKind: 'assigned',
          isArchived: false,
          isDraft: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        } satisfies FirestoreNutritionPlan);
      } else {
        const source = trainingSourceSnap.data() as FirestoreTrainingPlan;
        const id = generateId('training_plan');
        batch.set(doc(firestore, 'trainingPlans', id), {
          ...source,
          id,
          ownerProfessionalUid: professionalUid,
          studentAuthUid: studentUid,
          sourceKind: 'assigned',
          isArchived: false,
          isDraft: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        } satisfies FirestoreTrainingPlan);
      }
      writesInBatch += 1;
      assignedCount += 1;

      if (writesInBatch >= 450) {
        await flushBatch();
      }
    }

    await flushBatch();
    return { assignedCount };
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}

export async function submitPlanChangeRequest(
  planId: string,
  planType: PlanType,
  requestText: string,
  deps = defaultDeps
): Promise<PlanChangeRequest> {
  try {
    const firestore = deps.getFirestoreInstance();
    const studentUid = deps.getCurrentAuthUid();
    const id = generateId('plan_change_request');
    const timestamp = nowIso();

    await runTransaction(firestore, async (tx) => {
      tx.set(doc(firestore, 'planChangeRequests', id), {
        id,
        planId,
        planType,
        studentAuthUid: studentUid,
        requestText,
        status: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies FirestorePlanChangeRequest);
    });

    return {
      id,
      planId,
      planType,
      studentUid,
      requestText,
      status: 'pending',
      createdAt: timestamp,
    };
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}

export async function getStudentPlanChangeRequests(
  studentUid: string,
  deps = defaultDeps
): Promise<PlanChangeRequest[]> {
  try {
    const firestore = deps.getFirestoreInstance();

    const requests = await getDocs(query(
      collection(firestore, 'planChangeRequests'),
      where('studentAuthUid', '==', studentUid)
    ));

    return requests.docs.flatMap((snap) => {
      const raw = snap.data() as FirestorePlanChangeRequest;
      const planType = normalizePlanType(raw.planType);
      const status = normalizePlanChangeRequestStatus(raw.status);
      if (!planType || !status) return [];
      return [{
        id: raw.id,
        planId: raw.planId,
        planType,
        studentUid: raw.studentAuthUid,
        requestText: raw.requestText,
        status,
        createdAt: raw.createdAt,
      } satisfies PlanChangeRequest];
    });
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}

export async function reviewPlanChangeRequest(
  requestId: string,
  status: 'reviewed' | 'dismissed',
  deps = defaultDeps
): Promise<{ id: string; status: PlanChangeRequestStatus }> {
  try {
    const firestore = deps.getFirestoreInstance();
    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'planChangeRequests', requestId);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new PlanSourceError('graphql', 'Plan change request not found.');
      }
      tx.update(ref, {
        status,
        updatedAt: nowIso(),
      });
    });

    return { id: requestId, status };
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}
