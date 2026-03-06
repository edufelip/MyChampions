/**
 * Plan builder Firestore source — nutrition/training CRUD,
 * starter templates, and food search proxy integration.
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

import { getCurrentAuthUid as _getCurrentAuthUid, getFirestoreInstance as _getFirestoreInstance, nowIso, generateId } from '../firestore';
import { classifyFirestoreError } from '../firestore-error';
import { getFirebaseAuth } from '../auth/firebase';
import { searchFoodsFromSource } from '../nutrition/food-search-source';

import type {
  NutritionPlanInput,
  NutritionMealItem,
  NutritionMealItemInput,
  TrainingPlanInput,
  TrainingSession,
  TrainingSessionInput,
  TrainingSessionItem,
  TrainingSessionItemInput,
  StarterTemplate,
  FoodSearchResult,
} from './plan-builder.logic';
import {
  deriveStarterTemplatePlanType,
  coalesceTemplateDescription,
} from './plan-builder.logic';
import type { PlanType } from './plan-change-request.logic';

// ─── Error types ──────────────────────────────────────────────────────────────

type PlanBuilderSourceErrorCode =
  | 'configuration'
  | 'network'
  | 'graphql'
  | 'invalid_response';

export class PlanBuilderSourceError extends Error {
  code: PlanBuilderSourceErrorCode;

  constructor(code: PlanBuilderSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PlanBuilderSourceError';
  }
}

export type NutritionPlanDetail = {
  id: string;
  name: string;
  caloriesTarget: number;
  carbsTarget: number;
  proteinsTarget: number;
  fatsTarget: number;
  items: NutritionMealItem[];
  createdAt: string;
  updatedAt: string;
};

export type TrainingPlanDetail = {
  id: string;
  name: string;
  sessions: TrainingSession[];
  createdAt: string;
  updatedAt: string;
};

export type { FoodSearchResult } from './plan-builder.logic';

type FirestoreNutritionPlan = {
  id: string;
  ownerProfessionalUid: string | null;
  studentAuthUid: string;
  sourceKind: 'predefined' | 'assigned' | 'self_managed';
  isArchived: boolean;
  isDraft: boolean;
  name: string;
  caloriesTarget: number;
  carbsTarget: number;
  proteinsTarget: number;
  fatsTarget: number;
  items: Array<{ id: string; foodName: string }>;
  createdAt: string;
  updatedAt: string;
};

type FirestoreTrainingPlan = {
  id: string;
  ownerProfessionalUid: string | null;
  studentAuthUid: string;
  sourceKind: 'predefined' | 'assigned' | 'self_managed';
  isArchived: boolean;
  isDraft: boolean;
  name: string;
  sessions: Array<{ id: string; sessionName: string; items: Array<{ id: string; exerciseName: string }> }>;
  createdAt: string;
  updatedAt: string;
};

type FirestoreStarterTemplate = {
  id: string;
  planType: PlanType;
  name: string;
  description: string | null;
  nutritionDefaults?: {
    caloriesTarget: number;
    carbsTarget: number;
    proteinsTarget: number;
    fatsTarget: number;
    items: Array<{ id: string; foodName: string }>;
  };
  trainingDefaults?: {
    sessions: Array<{ id: string; sessionName: string; items: Array<{ id: string; exerciseName: string }> }>;
  };
};

export type PlanBuilderSourceDeps = {
  getFirestoreInstance: () => Firestore;
  getCurrentAuthUid: () => string;
};

export type StarterTemplateDeps = PlanBuilderSourceDeps;

const defaultDeps: PlanBuilderSourceDeps = {
  getFirestoreInstance: _getFirestoreInstance,
  getCurrentAuthUid: _getCurrentAuthUid,
};

const FALLBACK_STARTER_TEMPLATES: FirestoreStarterTemplate[] = [
  {
    id: 'starter_nutrition_default_balance',
    planType: 'nutrition',
    name: 'Balanced Starter',
    description: 'Balanced calories and macros for kickoff.',
    nutritionDefaults: {
      caloriesTarget: 2000,
      carbsTarget: 220,
      proteinsTarget: 140,
      fatsTarget: 70,
      items: [
        { id: 'item_1', foodName: 'Oats + banana breakfast' },
        { id: 'item_2', foodName: 'Chicken + rice lunch' },
      ],
    },
  },
  {
    id: 'starter_training_default_fullbody',
    planType: 'training',
    name: 'Full Body Starter',
    description: 'Simple full-body 3-day split.',
    trainingDefaults: {
      sessions: [
        {
          id: 'session_1',
          sessionName: 'Day A',
          items: [{ id: 'exercise_1', exerciseName: 'Squat 3x8' }],
        },
      ],
    },
  },
];

function normalizePlanBuilderSourceError(error: unknown): PlanBuilderSourceError {
  if (error instanceof PlanBuilderSourceError) return error;

  switch (classifyFirestoreError(error)) {
    case 'network':
      return new PlanBuilderSourceError('network', (error as Error)?.message ?? 'Network error.');
    case 'configuration':
      return new PlanBuilderSourceError('configuration', (error as Error)?.message ?? 'Configuration error.');
    default:
      return new PlanBuilderSourceError('invalid_response', (error as Error)?.message ?? 'Unexpected plan builder source error.');
  }
}

function mapNutritionPlanDetail(raw: FirestoreNutritionPlan | null | undefined): NutritionPlanDetail {
  if (!raw) {
    throw new PlanBuilderSourceError('invalid_response', 'getNutritionPlanDetail returned no plan.');
  }

  const items: NutritionMealItem[] = (raw.items ?? []).map((meal) => ({
    id: meal.id,
    name: meal.foodName,
    quantity: '',
    notes: '',
  }));

  return {
    id: raw.id,
    name: raw.name,
    caloriesTarget: raw.caloriesTarget ?? 0,
    carbsTarget: raw.carbsTarget ?? 0,
    proteinsTarget: raw.proteinsTarget ?? 0,
    fatsTarget: raw.fatsTarget ?? 0,
    items,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function mapTrainingPlanDetail(raw: FirestoreTrainingPlan | null | undefined): TrainingPlanDetail {
  if (!raw) {
    throw new PlanBuilderSourceError('invalid_response', 'getTrainingPlanDetail returned no plan.');
  }

  const sessions: TrainingSession[] = (raw.sessions ?? []).map((s) => {
    const items: TrainingSessionItem[] = (s.items ?? []).map((item) => ({
      id: item.id,
      name: item.exerciseName,
      quantity: '',
      notes: '',
    }));
    return { id: s.id, name: s.sessionName, notes: '', items };
  });

  return {
    id: raw.id,
    name: raw.name,
    sessions,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function createNutritionPlan(
  input: NutritionPlanInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<NutritionPlanDetail> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();
    const id = generateId('nutrition_plan');
    const timestamp = nowIso();

    const plan: FirestoreNutritionPlan = {
      id,
      ownerProfessionalUid: uid,
      studentAuthUid: uid,
      sourceKind: 'predefined',
      isArchived: false,
      isDraft: false,
      name: input.name.trim(),
      caloriesTarget: parseFloat(input.caloriesTarget) || 0,
      carbsTarget: parseFloat(input.carbsTarget) || 0,
      proteinsTarget: parseFloat(input.proteinsTarget) || 0,
      fatsTarget: parseFloat(input.fatsTarget) || 0,
      items: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await runTransaction(firestore, async (tx) => {
      tx.set(doc(firestore, 'nutritionPlans', id), plan);
    });

    return mapNutritionPlanDetail(plan);
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function updateNutritionPlan(
  planId: string,
  input: NutritionPlanInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();

    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'nutritionPlans', planId);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
      }

      tx.update(ref, {
        name: input.name.trim(),
        caloriesTarget: parseFloat(input.caloriesTarget) || 0,
        carbsTarget: parseFloat(input.carbsTarget) || 0,
        proteinsTarget: parseFloat(input.proteinsTarget) || 0,
        fatsTarget: parseFloat(input.fatsTarget) || 0,
        updatedAt: nowIso(),
      });
    });
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function getNutritionPlanDetail(
  planId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<NutritionPlanDetail> {
  try {
    const firestore = deps.getFirestoreInstance();
    const snapshot = await getDoc(doc(firestore, 'nutritionPlans', planId));
    return mapNutritionPlanDetail(snapshot.exists() ? (snapshot.data() as FirestoreNutritionPlan) : null);
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function addNutritionMealItem(
  planId: string,
  item: NutritionMealItemInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<NutritionMealItem> {
  try {
    const firestore = deps.getFirestoreInstance();
    const insertedId = generateId('nutrition_item');

    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'nutritionPlans', planId);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
      }
      const current = snap.data() as FirestoreNutritionPlan;
      const items = current.items ?? [];
      items.push({ id: insertedId, foodName: item.name.trim() });
      tx.update(ref, {
        items,
        updatedAt: nowIso(),
      });
    });

    return { id: insertedId, name: item.name.trim(), quantity: '', notes: '' };
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function removeNutritionMealItem(
  _planId: string,
  itemId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();

    const plans = await getDocs(query(collection(firestore, 'nutritionPlans'), where('items', '!=', null)));
    const target = plans.docs.find((snap) => {
      const raw = snap.data() as FirestoreNutritionPlan;
      return (raw.items ?? []).some((item) => item.id === itemId);
    });

    if (!target) return;

    await runTransaction(firestore, async (tx) => {
      const raw = target.data() as FirestoreNutritionPlan;
      const filtered = (raw.items ?? []).filter((item) => item.id !== itemId);
      tx.update(target.ref, {
        items: filtered,
        updatedAt: nowIso(),
      });
    });
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function createTrainingPlan(
  input: TrainingPlanInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<TrainingPlanDetail> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();
    const id = generateId('training_plan');
    const timestamp = nowIso();

    const plan: FirestoreTrainingPlan = {
      id,
      ownerProfessionalUid: uid,
      studentAuthUid: uid,
      sourceKind: 'predefined',
      isArchived: false,
      isDraft: false,
      name: input.name.trim(),
      sessions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await runTransaction(firestore, async (tx) => {
      tx.set(doc(firestore, 'trainingPlans', id), plan);
    });

    return mapTrainingPlanDetail(plan);
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function updateTrainingPlan(
  planId: string,
  input: TrainingPlanInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();

    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'trainingPlans', planId);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new PlanBuilderSourceError('graphql', 'Training plan not found.');
      }

      tx.update(ref, {
        name: input.name.trim(),
        updatedAt: nowIso(),
      });
    });
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function getTrainingPlanDetail(
  planId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<TrainingPlanDetail> {
  try {
    const firestore = deps.getFirestoreInstance();
    const snapshot = await getDoc(doc(firestore, 'trainingPlans', planId));
    return mapTrainingPlanDetail(snapshot.exists() ? (snapshot.data() as FirestoreTrainingPlan) : null);
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function addTrainingSession(
  planId: string,
  session: TrainingSessionInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<TrainingSession> {
  try {
    const firestore = deps.getFirestoreInstance();
    const insertedId = generateId('training_session');

    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'trainingPlans', planId);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new PlanBuilderSourceError('graphql', 'Training plan not found.');
      }
      const current = snap.data() as FirestoreTrainingPlan;
      const sessions = current.sessions ?? [];
      sessions.push({ id: insertedId, sessionName: session.name.trim(), items: [] });
      tx.update(ref, {
        sessions,
        updatedAt: nowIso(),
      });
    });

    return { id: insertedId, name: session.name.trim(), notes: '', items: [] };
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function removeTrainingSession(
  _planId: string,
  sessionId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();

    const plans = await getDocs(query(collection(firestore, 'trainingPlans'), where('sessions', '!=', null)));
    const target = plans.docs.find((snap) => {
      const raw = snap.data() as FirestoreTrainingPlan;
      return (raw.sessions ?? []).some((s) => s.id === sessionId);
    });

    if (!target) return;

    await runTransaction(firestore, async (tx) => {
      const raw = target.data() as FirestoreTrainingPlan;
      tx.update(target.ref, {
        sessions: (raw.sessions ?? []).filter((s) => s.id !== sessionId),
        updatedAt: nowIso(),
      });
    });
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function addTrainingSessionItem(
  sessionId: string,
  item: TrainingSessionItemInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<TrainingSessionItem> {
  try {
    const firestore = deps.getFirestoreInstance();
    const insertedId = generateId('training_item');

    const plans = await getDocs(query(collection(firestore, 'trainingPlans'), where('sessions', '!=', null)));
    const target = plans.docs.find((snap) => {
      const raw = snap.data() as FirestoreTrainingPlan;
      return (raw.sessions ?? []).some((s) => s.id === sessionId);
    });

    if (!target) {
      throw new PlanBuilderSourceError('graphql', 'Training session not found.');
    }

    await runTransaction(firestore, async (tx) => {
      const raw = target.data() as FirestoreTrainingPlan;
      const sessions = (raw.sessions ?? []).map((session) => {
        if (session.id !== sessionId) return session;
        return {
          ...session,
          items: [...(session.items ?? []), { id: insertedId, exerciseName: item.name.trim() }],
        };
      });
      tx.update(target.ref, {
        sessions,
        updatedAt: nowIso(),
      });
    });

    return { id: insertedId, name: item.name.trim(), quantity: '', notes: '' };
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function removeTrainingSessionItem(
  _sessionId: string,
  itemId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();

    const plans = await getDocs(query(collection(firestore, 'trainingPlans'), where('sessions', '!=', null)));
    const target = plans.docs.find((snap) => {
      const raw = snap.data() as FirestoreTrainingPlan;
      return (raw.sessions ?? []).some((s) => (s.items ?? []).some((it) => it.id === itemId));
    });

    if (!target) return;

    await runTransaction(firestore, async (tx) => {
      const raw = target.data() as FirestoreTrainingPlan;
      const sessions = (raw.sessions ?? []).map((session) => ({
        ...session,
        items: (session.items ?? []).filter((it) => it.id !== itemId),
      }));
      tx.update(target.ref, {
        sessions,
        updatedAt: nowIso(),
      });
    });
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

async function loadStarterTemplatesFromFirestore(
  planType: PlanType,
  deps: PlanBuilderSourceDeps
): Promise<FirestoreStarterTemplate[]> {
  const firestore = deps.getFirestoreInstance();
  const snapshots = await getDocs(query(collection(firestore, 'starterTemplates'), where('planType', '==', planType)));
  return snapshots.docs.map((snap) => snap.data() as FirestoreStarterTemplate);
}

export async function getStarterTemplates(
  planType: PlanType,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<StarterTemplate[]> {
  try {
    const firestoreTemplates = await loadStarterTemplatesFromFirestore(planType, deps);
    const templates = firestoreTemplates.length > 0
      ? firestoreTemplates
      : FALLBACK_STARTER_TEMPLATES.filter((t) => t.planType === planType);

    return templates.map((t) => ({
      id: t.id,
      planType,
      name: t.name,
      description: coalesceTemplateDescription(t.description),
    }));
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function cloneStarterTemplate(
  user: { uid: string },
  templateId: string,
  name: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<{ id: string; planType: PlanType; name: string }> {
  try {
    const planType = deriveStarterTemplatePlanType(templateId);
    if (!planType) {
      throw new PlanBuilderSourceError('invalid_response', `Cannot derive planType from templateId: ${templateId}`);
    }

    const firestore = deps.getFirestoreInstance();
    const professionalId = user.uid || deps.getCurrentAuthUid();

    const templateSnap = await getDoc(doc(firestore, 'starterTemplates', templateId));
    const template = (templateSnap.exists() ? templateSnap.data() : null) as FirestoreStarterTemplate | null;
    const fallback = FALLBACK_STARTER_TEMPLATES.find((t) => t.id === templateId) ?? null;
    const sourceTemplate = template ?? fallback;

    const timestamp = nowIso();

    if (planType === 'nutrition') {
      const id = generateId('nutrition_plan');
      const defaults = sourceTemplate?.nutritionDefaults;
      const nutritionPlan: FirestoreNutritionPlan = {
        id,
        ownerProfessionalUid: professionalId,
        studentAuthUid: professionalId,
        sourceKind: 'predefined',
        isArchived: false,
        isDraft: true,
        name,
        caloriesTarget: defaults?.caloriesTarget ?? 0,
        carbsTarget: defaults?.carbsTarget ?? 0,
        proteinsTarget: defaults?.proteinsTarget ?? 0,
        fatsTarget: defaults?.fatsTarget ?? 0,
        items: defaults?.items ?? [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await runTransaction(firestore, async (tx) => {
        tx.set(doc(firestore, 'nutritionPlans', id), nutritionPlan);
      });

      return { id, planType, name };
    }

    const id = generateId('training_plan');
    const defaults = sourceTemplate?.trainingDefaults;
    const trainingPlan: FirestoreTrainingPlan = {
      id,
      ownerProfessionalUid: professionalId,
      studentAuthUid: professionalId,
      sourceKind: 'predefined',
      isArchived: false,
      isDraft: true,
      name,
      sessions: defaults?.sessions ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await runTransaction(firestore, async (tx) => {
      tx.set(doc(firestore, 'trainingPlans', id), trainingPlan);
    });

    return { id, planType, name };
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function searchFoods(query: string): Promise<FoodSearchResult[]> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error('No authenticated user for food search.');
  }
  return searchFoodsFromSource(user, query);
}
