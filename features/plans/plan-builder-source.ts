/**
 * Plan builder Firestore source — nutrition/training CRUD,
 * starter templates, and food search service integration.
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
  NutritionMeal,
  NutritionMealInput,
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
  calculateTotalsFromItems,
  calculateTotalsFromMeals,
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
  sourceKind: 'predefined' | 'assigned' | 'self_managed';
  ownerProfessionalUid: string | null;
  studentAuthUid: string;
  hydrationGoalMl: number | null;
  caloriesTarget: number;
  carbsTarget: number;
  proteinsTarget: number;
  fatsTarget: number;
  meals: NutritionMeal[];
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

type FirestoreNutritionItem = {
  id: string;
  foodName: string;
  quantity: string;
  notes: string;
  calories?: number;
  carbs?: number;
  proteins?: number;
  fats?: number;
};

type FirestoreNutritionMeal = {
  id: string;
  mealName: string;
  items: FirestoreNutritionItem[];
};

type FirestoreNutritionPlan = {
  id: string;
  ownerProfessionalUid: string | null;
  studentAuthUid: string;
  sourceKind: 'predefined' | 'assigned' | 'self_managed';
  isArchived: boolean;
  isDraft: boolean;
  name: string;
  hydrationGoalMl: number | null;
  caloriesTarget: number;
  carbsTarget: number;
  proteinsTarget: number;
  fatsTarget: number;
  meals: FirestoreNutritionMeal[];
  createdAt: string;
  updatedAt: string;
};

/** Firestore shape for a single exercise item in a training session. */
type FirestoreTrainingItem = {
  id: string;
  exerciseName: string;
  quantity?: string;
  notes?: string;
  /**
   * Stable exercise UUID persisted by the app.
   * Video/thumbnail URLs expire after 48 h and must be fetched fresh.
   */
  exerciseId?: string;
  /**
   * @deprecated read-compatibility with pre-migration records.
   */
  ymoveId?: string;
};

type FirestoreTrainingPlan = {
  id: string;
  ownerProfessionalUid: string | null;
  studentAuthUid: string;
  sourceKind: 'predefined' | 'assigned' | 'self_managed';
  isArchived: boolean;
  isDraft: boolean;
  name: string;
  sessions: Array<{ id: string; sessionName: string; notes?: string; items: FirestoreTrainingItem[] }>;
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
    meals: FirestoreNutritionMeal[];
  };
  trainingDefaults?: {
    sessions: Array<{ id: string; sessionName: string; notes?: string; items: FirestoreTrainingItem[] }>;
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
      meals: [
        { 
          id: 'meal_1', 
          mealName: 'Breakfast', 
          items: [
            { id: 'item_1', foodName: 'Oats + banana breakfast', quantity: '1 bowl', notes: 'Morning' }
          ] 
        },
        { 
          id: 'meal_2', 
          mealName: 'Lunch', 
          items: [
            { id: 'item_2', foodName: 'Chicken + rice lunch', quantity: '1 plate', notes: 'Post-workout' }
          ] 
        },
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

  const meals: NutritionMeal[] = (raw.meals ?? []).map((meal) => ({
    id: meal.id,
    name: meal.mealName,
    items: (meal.items ?? []).map((item) => ({
      id: item.id,
      name: item.foodName,
      quantity: item.quantity ?? '',
      notes: item.notes ?? '',
      calories: item.calories,
      carbs: item.carbs,
      proteins: item.proteins,
      fats: item.fats,
    })),
  }));

  return {
    id: raw.id,
    name: raw.name,
    sourceKind: raw.sourceKind,
    ownerProfessionalUid: raw.ownerProfessionalUid ?? null,
    studentAuthUid: raw.studentAuthUid,
    hydrationGoalMl: raw.hydrationGoalMl ?? null,
    caloriesTarget: raw.caloriesTarget ?? 0,
    carbsTarget: raw.carbsTarget ?? 0,
    proteinsTarget: raw.proteinsTarget ?? 0,
    fatsTarget: raw.fatsTarget ?? 0,
    meals,
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
      quantity: item.quantity ?? '',
      notes: item.notes ?? '',
      exerciseId: item.exerciseId ?? item.ymoveId,
    }));
    return { id: s.id, name: s.sessionName, notes: s.notes ?? '', items };
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

    const hydrationGoalMl = parseInt(input.hydrationGoalMl.trim(), 10);
    const plan: FirestoreNutritionPlan = {
      id,
      ownerProfessionalUid: uid,
      studentAuthUid: uid,
      sourceKind: 'predefined',
      isArchived: false,
      isDraft: false,
      name: input.name.trim(),
      hydrationGoalMl: Number.isFinite(hydrationGoalMl) && hydrationGoalMl > 0 ? hydrationGoalMl : null,
      caloriesTarget: 0,
      carbsTarget: 0,
      proteinsTarget: 0,
      fatsTarget: 0,
      meals: [],
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
        hydrationGoalMl: parseInt(input.hydrationGoalMl.trim(), 10),
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

export async function addNutritionMeal(
  planId: string,
  meal: NutritionMealInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<NutritionMeal> {
  try {
    const firestore = deps.getFirestoreInstance();
    const insertedId = generateId('nutrition_meal');

    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'nutritionPlans', planId);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
      }
      const current = snap.data() as FirestoreNutritionPlan;
      const meals = current.meals ?? [];
      meals.push({
        id: insertedId,
        mealName: meal.name.trim(),
        items: [],
      });
      tx.update(ref, {
        meals,
        updatedAt: nowIso(),
      });
    });

    return {
      id: insertedId,
      name: meal.name.trim(),
      items: [],
    };
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function removeNutritionMeal(
  planId: string,
  mealId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();
    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'nutritionPlans', planId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Plan not found');
      
      const current = snap.data() as FirestoreNutritionPlan;
      const filtered = (current.meals ?? []).filter((m) => m.id !== mealId);
      
      // Map Firestore meals to NutritionMeal to use calculateTotalsFromMeals
      const mappedMeals: NutritionMeal[] = filtered.map(m => ({
        id: m.id,
        name: m.mealName,
        items: (m.items ?? []).map(i => ({
          id: i.id,
          name: i.foodName,
          quantity: i.quantity,
          notes: i.notes,
          calories: i.calories,
          carbs: i.carbs,
          proteins: i.proteins,
          fats: i.fats
        }))
      }));

      const totals = calculateTotalsFromMeals(mappedMeals);

      tx.update(ref, {
        meals: filtered,
      caloriesTarget: totals.calories,
      carbsTarget: totals.carbs,
      proteinsTarget: totals.proteins,
      fatsTarget: totals.fats,
      hydrationGoalMl: current.hydrationGoalMl ?? null,
      updatedAt: nowIso(),
      });
    });
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function reorderNutritionMeals(
  planId: string,
  mealIds: string[],
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();
    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'nutritionPlans', planId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Plan not found');
      
      const current = snap.data() as FirestoreNutritionPlan;
      const meals = current.meals ?? [];
      const reordered = mealIds.map(id => meals.find(m => m.id === id)).filter(Boolean) as FirestoreNutritionMeal[];
      
      tx.update(ref, {
        meals: reordered,
        updatedAt: nowIso(),
      });
    });
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function addNutritionMealItem(
  planId: string,
  mealId: string,
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
      let itemAdded = false;
      const meals = (current.meals ?? []).map((meal) => {
        if (meal.id !== mealId) return meal;

        // Strip undefined/null values to keep Firestore happy
        const newItem: any = {
          id: insertedId,
          foodName: item.name.trim(),
          quantity: item.quantity || '',
          notes: item.notes || '',
        };
        if (item.calories != null) newItem.calories = item.calories;
        if (item.carbs != null) newItem.carbs = item.carbs;
        if (item.proteins != null) newItem.proteins = item.proteins;
        if (item.fats != null) newItem.fats = item.fats;

        itemAdded = true;
        return {
          ...meal,
          items: [...(meal.items ?? []), newItem],
        };
      });

      if (!itemAdded) {
        throw new PlanBuilderSourceError('graphql', `Meal with ID ${mealId} not found in this plan.`);
      }

      // Recalculate plan totals
      const mappedMeals: NutritionMeal[] = meals.map(m => ({
        id: m.id,
        name: m.mealName,
        items: (m.items ?? []).map(i => ({
          id: i.id,
          name: i.foodName,
          quantity: i.quantity,
          notes: i.notes,
          calories: i.calories,
          carbs: i.carbs,
          proteins: i.proteins,
          fats: i.fats
        }))
      }));

      const totals = calculateTotalsFromMeals(mappedMeals);

      tx.update(ref, {
        meals,
      caloriesTarget: totals.calories,
      carbsTarget: totals.carbs,
      proteinsTarget: totals.proteins,
      fatsTarget: totals.fats,
      hydrationGoalMl: current.hydrationGoalMl ?? null,
      updatedAt: nowIso(),
      });
    });

    return {
      id: insertedId,
      name: item.name.trim(),
      quantity: item.quantity,
      notes: item.notes,
      calories: item.calories,
      carbs: item.carbs,
      proteins: item.proteins,
      fats: item.fats,
    };
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function removeNutritionMealItem(
  planId: string,
  mealId: string,
  itemId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();

    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'nutritionPlans', planId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Plan not found');
      
      const current = snap.data() as FirestoreNutritionPlan;
      const meals = (current.meals ?? []).map((meal) => {
        if (meal.id !== mealId) return meal;
        return {
          ...meal,
          items: (meal.items ?? []).filter((it) => it.id !== itemId),
        };
      });

      // Recalculate plan totals
      const mappedMeals: NutritionMeal[] = meals.map(m => ({
        id: m.id,
        name: m.mealName,
        items: (m.items ?? []).map(i => ({
          id: i.id,
          name: i.foodName,
          quantity: i.quantity,
          notes: i.notes,
          calories: i.calories,
          carbs: i.carbs,
          proteins: i.proteins,
          fats: i.fats
        }))
      }));

      const totals = calculateTotalsFromMeals(mappedMeals);

      tx.update(ref, {
        meals,
      caloriesTarget: totals.calories,
      carbsTarget: totals.carbs,
      proteinsTarget: totals.proteins,
      fatsTarget: totals.fats,
      hydrationGoalMl: current.hydrationGoalMl ?? null,
      updatedAt: nowIso(),
      });
    });
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function reorderNutritionMealItems(
  planId: string,
  mealId: string,
  itemIds: string[],
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();
    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'nutritionPlans', planId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Plan not found');
      
      const current = snap.data() as FirestoreNutritionPlan;
      const meals = (current.meals ?? []).map((meal) => {
        if (meal.id !== mealId) return meal;
        const reorderedItems = itemIds.map(id => meal.items.find(it => it.id === id)).filter(Boolean) as FirestoreNutritionItem[];
        return { ...meal, items: reorderedItems };
      });
      
      tx.update(ref, {
        meals,
        updatedAt: nowIso(),
      });
    });
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function deleteNutritionPlan(
  planId: string,
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
      tx.delete(ref);
    });
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function deleteTrainingPlan(
  planId: string,
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
      tx.delete(ref);
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

function mapTrainingSessionsToFirestore(
  sessions: TrainingSession[]
): FirestoreTrainingPlan['sessions'] {
  return sessions.map((session) => ({
    id: session.id,
    sessionName: session.name.trim(),
    notes: session.notes.trim(),
    items: session.items.map((item) => ({
      id: item.id,
      exerciseName: item.name.trim(),
      quantity: item.quantity ?? '',
      notes: item.notes ?? '',
      ...(item.exerciseId ?? item.ymoveId
        ? { exerciseId: item.exerciseId ?? item.ymoveId }
        : {}),
    })),
  }));
}

export async function updateTrainingPlanWithSessions(
  planId: string,
  input: TrainingPlanInput,
  sessions: TrainingSession[],
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
        sessions: mapTrainingSessionsToFirestore(sessions),
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
      sessions.push({ id: insertedId, sessionName: session.name.trim(), notes: session.notes.trim(), items: [] });
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
  planId: string,
  sessionId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();
    // Direct document lookup — O(1), consistent, no collection scan.
    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'trainingPlans', planId);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new PlanBuilderSourceError('graphql', 'Training plan not found.');
      }
      const raw = snap.data() as FirestoreTrainingPlan;
      tx.update(ref, {
        sessions: (raw.sessions ?? []).filter((s) => s.id !== sessionId),
        updatedAt: nowIso(),
      });
    });
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function reorderTrainingSessions(
  planId: string,
  sessionIds: string[],
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();
    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'trainingPlans', planId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Plan not found');
      
      const current = snap.data() as FirestoreTrainingPlan;
      const sessions = current.sessions ?? [];
      
      const reordered = sessionIds.map(id => sessions.find(s => s.id === id)).filter(Boolean) as FirestoreTrainingPlan['sessions'];
      
      tx.update(ref, {
        sessions: reordered,
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
      // Re-read the document inside the transaction for a consistent snapshot.
      // Using target.data() from the outer getDocs snapshot is a stale read —
      // another writer could have modified the document between getDocs and here.
      const freshSnap = await tx.get(target.ref);
      const raw = freshSnap.data() as FirestoreTrainingPlan;
      const newItem: FirestoreTrainingItem = {
        id: insertedId,
        exerciseName: item.name.trim(),
        quantity: item.quantity || '',
        notes: item.notes || '',
        // Only store exerciseId — never thumbnail/video URLs (they expire after 48 h).
        ...(item.exerciseId ?? item.ymoveId
          ? { exerciseId: item.exerciseId ?? item.ymoveId }
          : {}),
      };
      const sessions = (raw.sessions ?? []).map((session) => {
        if (session.id !== sessionId) return session;
        return {
          ...session,
          items: [...(session.items ?? []), newItem],
        };
      });
      tx.update(target.ref, {
        sessions,
        updatedAt: nowIso(),
      });
    });

    return {
      id: insertedId,
      name: item.name.trim(),
      quantity: item.quantity ?? '',
      notes: item.notes ?? '',
      exerciseId: item.exerciseId ?? item.ymoveId,
    };
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function removeTrainingSessionItem(
  planId: string,
  _sessionId: string,
  itemId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();
    // Direct document lookup — O(1), consistent, no collection scan.
    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'trainingPlans', planId);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new PlanBuilderSourceError('graphql', 'Training plan not found.');
      }
      const raw = snap.data() as FirestoreTrainingPlan;
      const sessions = (raw.sessions ?? []).map((session) => ({
        ...session,
        items: (session.items ?? []).filter((it) => it.id !== itemId),
      }));
      tx.update(ref, {
        sessions,
        updatedAt: nowIso(),
      });
    });
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function reorderTrainingSessionItems(
  sessionId: string,
  itemIds: string[],
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();
    const plans = await getDocs(query(collection(firestore, 'trainingPlans'), where('sessions', '!=', null)));
    const target = plans.docs.find((snap) => {
      const raw = snap.data() as FirestoreTrainingPlan;
      return (raw.sessions ?? []).some((s) => s.id === sessionId);
    });

    if (!target) throw new Error('Session not found');

    await runTransaction(firestore, async (tx) => {
      const raw = target.data() as FirestoreTrainingPlan;
      const sessions = (raw.sessions ?? []).map((session) => {
        if (session.id !== sessionId) return session;
        const items = session.items ?? [];
        const reordered = itemIds.map(id => items.find(it => it.id === id)).filter(Boolean) as FirestoreTrainingItem[];
        return { ...session, items: reordered };
      });
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
        hydrationGoalMl: null,
        meals: defaults?.meals ?? [],
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
  const user = getFirebaseAuth().currentUser;
  return searchFoodsFromSource(user, query);
}
