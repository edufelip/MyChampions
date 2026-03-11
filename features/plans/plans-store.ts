import { create } from 'zustand';

import {
  getMyPlans,
  getMyPredefinedPlans,
  bulkAssignPredefinedPlan,
  submitPlanChangeRequest,
  reviewPlanChangeRequest,
  getStudentPlanChangeRequests,
  getCachedPlans,
  getCachedPredefinedPlans,
  getCachedPlansOwnerUid,
  clearPlanCaches,
  optimisticUpdatePredefinedPlan,
  optimisticDeletePredefinedPlan,
  type Plan,
  type PredefinedPlan,
} from './plan-source';
import {
  createNutritionPlan,
  updateNutritionPlan,
  deleteNutritionPlan,
  getNutritionPlanDetail,
  addNutritionMeal,
  removeNutritionMeal,
  reorderNutritionMeals,
  addNutritionMealItem,
  removeNutritionMealItem,
  reorderNutritionMealItems,
  createTrainingPlan,
  updateTrainingPlan,
  updateTrainingPlanWithSessions,
  deleteTrainingPlan,
  getTrainingPlanDetail,
  addTrainingSession,
  removeTrainingSession,
  reorderTrainingSessions,
  addTrainingSessionItem,
  removeTrainingSessionItem,
  reorderTrainingSessionItems,
  searchFoods,
  type TrainingPlanDetail,
} from './plan-builder-source';
import {
  validatePlanChangeRequestInput,
  normalizePlanChangeRequestError,
  type PlanType,
  type PlanChangeRequest,
  type PlanChangeRequestInput,
  type PlanChangeRequestValidationErrors,
  type PlanChangeRequestErrorReason,
} from './plan-change-request.logic';
import {
  validateNutritionPlanInput,
  validateTrainingPlanInput,
  resolveTrainingDraftCreationInput,
  validateTrainingSessionItemInput,
  normalizePlanBuilderError,
  type NutritionPlanInput,
  type NutritionMealInput,
  type NutritionMealItemInput,
  type NutritionPlanValidationErrors,
  type TrainingPlanInput,
  type TrainingSession,
  type TrainingSessionInput,
  type TrainingSessionItemInput,
  type TrainingPlanValidationErrors,
  type TrainingSessionItemValidationErrors,
  type PlanBuilderErrorReason,
} from './plan-builder.logic';
import {
  getCachedNutritionPlan,
  setCachedNutritionPlan,
  getCachedTrainingPlan,
  setCachedTrainingPlan,
} from './plan-cache';
import {
  markNutritionBuilderMutating,
  markTrainingBuilderMutating,
  type FoodSearchState,
  type NutritionBuilderState,
  type TrainingBuilderState,
} from './plan-builder-state';
import { getFirebaseAuth } from '../auth/firebase';

export type PlansLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; plans: Plan[]; predefinedPlans: PredefinedPlan[] };

function buildNutritionMutationErrorState(
  previousState: NutritionBuilderState,
  err: unknown
): NutritionBuilderState {
  if (previousState.kind === 'ready') {
    return {
      ...previousState,
      isMutating: false,
      backgroundError: (err as Error).message,
    };
  }

  return {
    kind: 'error',
    reason: normalizePlanBuilderError(err),
    message: (err as Error).message,
  };
}

function buildTrainingMutationErrorState(
  previousState: TrainingBuilderState,
  err: unknown
): TrainingBuilderState {
  if (previousState.kind === 'ready') {
    return {
      ...previousState,
      isMutating: false,
      backgroundError: (err as Error).message,
    };
  }

  return {
    kind: 'error',
    reason: normalizePlanBuilderError(err),
    message: (err as Error).message,
  };
}

type InvalidationState = {
  plans: number;
};

export type PlansStoreState = {
  authUid: string | null;
  plansState: PlansLoadState;
  nutritionBuilderState: NutritionBuilderState;
  trainingBuilderState: TrainingBuilderState;
  foodSearchState: FoodSearchState;
  foodSearchRequestId: number;
  nutritionLoadRequestId: number;
  trainingLoadRequestId: number;
  invalidation: InvalidationState;
  syncAuthContext: (isAuthenticated: boolean) => void;
  resetNutritionBuilder: () => void;
  resetTrainingBuilder: () => void;
  loadPlans: (isAuthenticated: boolean) => Promise<void>;
  validateChangeRequest: (input: PlanChangeRequestInput) => PlanChangeRequestValidationErrors;
  submitChangeRequest: (
    isAuthenticated: boolean,
    planId: string,
    planType: PlanType,
    requestText: string
  ) => Promise<{ data: PlanChangeRequest } | { error: PlanChangeRequestErrorReason }>;
  reviewChangeRequest: (
    isAuthenticated: boolean,
    requestId: string,
    action: 'reviewed' | 'dismissed'
  ) => Promise<PlanChangeRequestErrorReason | null>;
  getChangeRequestsForStudent: (
    isAuthenticated: boolean,
    studentUid: string
  ) => Promise<{ data: PlanChangeRequest[] } | { error: PlanChangeRequestErrorReason }>;
  bulkAssign: (
    isAuthenticated: boolean,
    predefinedPlanId: string,
    studentUids: string[]
  ) => Promise<{ assignedCount: number } | { error: PlanChangeRequestErrorReason }>;
  clearFoodSearch: () => void;
  loadNutritionPlan: (isAuthenticated: boolean, planId: string) => Promise<void>;
  initNewNutritionPlan: () => void;
  createNutritionPlanAction: (
    isAuthenticated: boolean,
    input: NutritionPlanInput
  ) => Promise<{ id: string } | { error: PlanBuilderErrorReason }>;
  saveNutritionPlanAction: (
    isAuthenticated: boolean,
    planId: string,
    input: NutritionPlanInput
  ) => Promise<PlanBuilderErrorReason | null>;
  addNutritionMealAction: (
    isAuthenticated: boolean,
    planId: string,
    meal: NutritionMealInput,
    planInput?: NutritionPlanInput
  ) => Promise<{ planId: string; error: PlanBuilderErrorReason | null }>;
  removeNutritionMealAction: (
    isAuthenticated: boolean,
    planId: string,
    mealId: string
  ) => Promise<PlanBuilderErrorReason | null>;
  reorderNutritionMealsAction: (
    isAuthenticated: boolean,
    planId: string,
    mealIds: string[]
  ) => Promise<PlanBuilderErrorReason | null>;
  addNutritionItemAction: (
    isAuthenticated: boolean,
    planId: string,
    mealId: string,
    item: NutritionMealItemInput,
    planInput?: NutritionPlanInput
  ) => Promise<{ planId: string; error: PlanBuilderErrorReason | null }>;
  removeNutritionItemAction: (
    isAuthenticated: boolean,
    planId: string,
    mealId: string,
    itemId: string
  ) => Promise<PlanBuilderErrorReason | null>;
  reorderNutritionItemsAction: (
    isAuthenticated: boolean,
    planId: string,
    mealId: string,
    itemIds: string[]
  ) => Promise<PlanBuilderErrorReason | null>;
  deleteNutritionPlanAction: (
    isAuthenticated: boolean,
    planId: string
  ) => Promise<PlanBuilderErrorReason | null>;
  runFoodSearch: (isAuthenticated: boolean, query: string) => void;
  validateNutritionInput: (input: NutritionPlanInput) => NutritionPlanValidationErrors;
  loadTrainingPlan: (isAuthenticated: boolean, planId: string) => Promise<void>;
  initNewTrainingPlan: () => void;
  createTrainingPlanAction: (
    isAuthenticated: boolean,
    input: TrainingPlanInput
  ) => Promise<{ id: string } | { error: PlanBuilderErrorReason }>;
  saveTrainingPlanAction: (
    isAuthenticated: boolean,
    planId: string,
    input: TrainingPlanInput
  ) => Promise<PlanBuilderErrorReason | null>;
  saveTrainingPlanWithSessionsAction: (
    isAuthenticated: boolean,
    planId: string,
    input: TrainingPlanInput,
    sessions: TrainingSession[]
  ) => Promise<{ id: string; plan: TrainingPlanDetail } | { error: PlanBuilderErrorReason }>;
  addTrainingSessionAction: (
    isAuthenticated: boolean,
    planId: string,
    session: TrainingSessionInput,
    planInput?: TrainingPlanInput
  ) => Promise<{ planId: string; error: PlanBuilderErrorReason | null }>;
  removeTrainingSessionAction: (
    isAuthenticated: boolean,
    planId: string,
    sessionId: string
  ) => Promise<PlanBuilderErrorReason | null>;
  reorderTrainingSessionsAction: (
    isAuthenticated: boolean,
    planId: string,
    sessionIds: string[]
  ) => Promise<PlanBuilderErrorReason | null>;
  addTrainingSessionItemAction: (
    isAuthenticated: boolean,
    sessionId: string,
    item: TrainingSessionItemInput
  ) => Promise<PlanBuilderErrorReason | null>;
  removeTrainingSessionItemAction: (
    isAuthenticated: boolean,
    sessionId: string,
    itemId: string
  ) => Promise<PlanBuilderErrorReason | null>;
  reorderTrainingSessionItemsAction: (
    isAuthenticated: boolean,
    sessionId: string,
    itemIds: string[]
  ) => Promise<PlanBuilderErrorReason | null>;
  deleteTrainingPlanAction: (
    isAuthenticated: boolean,
    planId: string
  ) => Promise<PlanBuilderErrorReason | null>;
  validateTrainingInput: (input: TrainingPlanInput) => TrainingPlanValidationErrors;
  validateTrainingSessionItem: (
    item: TrainingSessionItemInput
  ) => TrainingSessionItemValidationErrors;
};

function buildInitialPlansState(): PlansLoadState {
  const uid = resolveCurrentAuthUid();
  const plans = getCachedPlans();
  const predefinedPlans = getCachedPredefinedPlans();
  const cacheOwnerUid = getCachedPlansOwnerUid();
  if (uid && cacheOwnerUid && uid === cacheOwnerUid && plans && predefinedPlans) {
    return { kind: 'ready', plans, predefinedPlans };
  }
  return { kind: 'idle' };
}

function resolveCurrentAuthUid(): string | null {
  try {
    return getFirebaseAuth().currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

export const usePlansStore = create<PlansStoreState>((set, get) => ({
  authUid: resolveCurrentAuthUid(),
  plansState: buildInitialPlansState(),
  nutritionBuilderState: { kind: 'idle' },
  trainingBuilderState: { kind: 'idle' },
  foodSearchState: { kind: 'idle' },
  foodSearchRequestId: 0,
  nutritionLoadRequestId: 0,
  trainingLoadRequestId: 0,
  invalidation: {
    plans: 0,
  },

  syncAuthContext: (isAuthenticated) => {
    const uid = isAuthenticated ? resolveCurrentAuthUid() : null;
    const previousUid = get().authUid;

    if (!uid) {
      clearPlanCaches();
      set({
        authUid: null,
        plansState: { kind: 'idle' },
        nutritionBuilderState: { kind: 'idle' },
        trainingBuilderState: { kind: 'idle' },
        foodSearchState: { kind: 'idle' },
        foodSearchRequestId: 0,
        nutritionLoadRequestId: 0,
        trainingLoadRequestId: 0,
      });
      return;
    }

    if (previousUid !== uid) {
      clearPlanCaches();
      set({
        authUid: uid,
        plansState: { kind: 'idle' },
        nutritionBuilderState: { kind: 'idle' },
        trainingBuilderState: { kind: 'idle' },
        foodSearchState: { kind: 'idle' },
        foodSearchRequestId: 0,
        nutritionLoadRequestId: 0,
        trainingLoadRequestId: 0,
      });
    }
  },

  resetNutritionBuilder: () => {
    set({ nutritionBuilderState: { kind: 'idle' } });
  },

  resetTrainingBuilder: () => {
    set({ trainingBuilderState: { kind: 'idle' } });
  },

  loadPlans: async (isAuthenticated) => {
    get().syncAuthContext(isAuthenticated);
    const uid = get().authUid;
    if (!uid) {
      set({ plansState: { kind: 'idle' } });
      return;
    }
    if (get().plansState.kind !== 'ready') {
      set({ plansState: { kind: 'loading' } });
    }

    try {
      const [plans, predefinedPlans] = await Promise.all([getMyPlans(), getMyPredefinedPlans()]);
      if (get().authUid !== uid) {
        return;
      }
      set({ plansState: { kind: 'ready', plans, predefinedPlans } });
    } catch (err) {
      set({ plansState: { kind: 'error', message: (err as Error).message } });
    }
  },

  validateChangeRequest: (input) => validatePlanChangeRequestInput(input),

  submitChangeRequest: async (isAuthenticated, planId, planType, requestText) => {
    if (!isAuthenticated) return { error: 'unknown' };

    const errors = validatePlanChangeRequestInput({ requestText });
    if (Object.keys(errors).length > 0) return { error: 'validation' };

    try {
      const data = await submitPlanChangeRequest(planId, planType, requestText);
      return { data };
    } catch (err) {
      return { error: normalizePlanChangeRequestError(err) };
    }
  },

  reviewChangeRequest: async (isAuthenticated, requestId, action) => {
    if (!isAuthenticated) return 'unknown';

    try {
      await reviewPlanChangeRequest(requestId, action);
      return null;
    } catch (err) {
      return normalizePlanChangeRequestError(err);
    }
  },

  getChangeRequestsForStudent: async (isAuthenticated, studentUid) => {
    if (!isAuthenticated) return { error: 'unknown' };

    try {
      const data = await getStudentPlanChangeRequests(studentUid);
      return { data };
    } catch (err) {
      return { error: normalizePlanChangeRequestError(err) };
    }
  },

  bulkAssign: async (isAuthenticated, predefinedPlanId, studentUids) => {
    if (!isAuthenticated) return { error: 'unknown' };

    try {
      const result = await bulkAssignPredefinedPlan(predefinedPlanId, studentUids);
      await get().loadPlans(isAuthenticated);
      return result;
    } catch (err) {
      return { error: normalizePlanChangeRequestError(err) };
    }
  },

  clearFoodSearch: () => {
    set({ foodSearchState: { kind: 'idle' }, foodSearchRequestId: 0 });
  },

  loadNutritionPlan: async (isAuthenticated, planId) => {
    get().syncAuthContext(isAuthenticated);
    if (!get().authUid) {
      set({ nutritionBuilderState: { kind: 'error', reason: 'unknown', message: 'Not authenticated.' } });
      return;
    }

    const requestId = get().nutritionLoadRequestId + 1;
    set({ nutritionLoadRequestId: requestId, nutritionBuilderState: { kind: 'loading' } });

    const cached = await getCachedNutritionPlan(planId);
    if (cached) {
      if (get().nutritionLoadRequestId !== requestId) return;
      set({ nutritionBuilderState: { kind: 'ready', plan: cached, isBackgroundUpdating: true } });
      try {
        const updated = await getNutritionPlanDetail(planId);
        if (get().nutritionLoadRequestId !== requestId) return;
        await setCachedNutritionPlan(updated);
        set({ nutritionBuilderState: { kind: 'ready', plan: updated, isBackgroundUpdating: false } });
      } catch (err) {
        if (get().nutritionLoadRequestId !== requestId) return;
        set({
          nutritionBuilderState: {
            kind: 'ready',
            plan: cached,
            isBackgroundUpdating: false,
            backgroundError: (err as Error).message,
          },
        });
      }
      return;
    }
    const startTime = Date.now();
    try {
      const plan = await getNutritionPlanDetail(planId);
      const elapsed = Date.now() - startTime;
      if (elapsed < 300) {
        await new Promise((resolve) => setTimeout(resolve, 300 - elapsed));
      }
      if (get().nutritionLoadRequestId !== requestId) return;
      await setCachedNutritionPlan(plan);
      set({ nutritionBuilderState: { kind: 'ready', plan } });
    } catch (err) {
      if (get().nutritionLoadRequestId !== requestId) return;
      set({
        nutritionBuilderState: {
          kind: 'error',
          reason: normalizePlanBuilderError(err),
          message: (err as Error).message,
        },
      });
    }
  },

  initNewNutritionPlan: () => {
    set({
      nutritionBuilderState: {
        kind: 'ready',
        plan: {
          id: 'new',
          name: '',
          sourceKind: 'self_managed',
          ownerProfessionalUid: null,
          studentAuthUid: '',
          hydrationGoalMl: null,
          caloriesTarget: 0,
          carbsTarget: 0,
          proteinsTarget: 0,
          fatsTarget: 0,
          meals: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });
  },

  createNutritionPlanAction: async (isAuthenticated, input) => {
    if (!isAuthenticated) return { error: 'unknown' };

    const errors = validateNutritionPlanInput(input);
    if (Object.keys(errors).length > 0) {
      return { error: 'validation' };
    }

    set({ nutritionBuilderState: { kind: 'saving' } });
    try {
      const plan = await createNutritionPlan(input);
      set((state) => ({
        nutritionBuilderState: { kind: 'ready', plan },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));
      optimisticUpdatePredefinedPlan({
        id: plan.id,
        name: plan.name,
        planType: 'nutrition',
        ownerProfessionalUid: plan.ownerProfessionalUid ?? '',
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      });
      return { id: plan.id };
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ nutritionBuilderState: { kind: 'error', reason, message: (err as Error).message } });
      return { error: reason };
    }
  },

  saveNutritionPlanAction: async (isAuthenticated, planId, input) => {
    if (!isAuthenticated) return 'unknown';

    const errors = validateNutritionPlanInput(input);
    if (Object.keys(errors).length > 0) {
      return 'validation';
    }

    const previousState = get().nutritionBuilderState;
    set({ nutritionBuilderState: markNutritionBuilderMutating(previousState) });

    try {
      await updateNutritionPlan(planId, input);
      const updated = await getNutritionPlanDetail(planId);
      set((state) => ({
        nutritionBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));

      if (updated.sourceKind === 'predefined') {
        optimisticUpdatePredefinedPlan({
          id: updated.id,
          name: updated.name,
          planType: 'nutrition',
          ownerProfessionalUid: updated.ownerProfessionalUid ?? '',
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      }

      return null;
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ nutritionBuilderState: buildNutritionMutationErrorState(previousState, err) });
      return reason;
    }
  },

  addNutritionMealAction: async (isAuthenticated, planId, meal, planInput) => {
    if (!isAuthenticated) return { planId, error: 'unknown' };

    const previousState = get().nutritionBuilderState;
    set({ nutritionBuilderState: markNutritionBuilderMutating(previousState) });

    try {
      let currentPlanId = planId;
      if (planId === 'new') {
        const res = await get().createNutritionPlanAction(
          isAuthenticated,
          planInput ?? { name: 'Untitled', hydrationGoalMl: '' }
        );
        if ('error' in res) {
          return { planId, error: res.error };
        }
        currentPlanId = res.id;
      }

      await addNutritionMeal(currentPlanId, meal);
      const updated = await getNutritionPlanDetail(currentPlanId);
      await setCachedNutritionPlan(updated);

      set((state) => ({
        nutritionBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));

      if (updated.sourceKind === 'predefined') {
        optimisticUpdatePredefinedPlan({
          id: updated.id,
          name: updated.name,
          planType: 'nutrition',
          ownerProfessionalUid: updated.ownerProfessionalUid ?? '',
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      }

      return { planId: currentPlanId, error: null };
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ nutritionBuilderState: buildNutritionMutationErrorState(previousState, err) });
      return { planId, error: reason };
    }
  },

  removeNutritionMealAction: async (isAuthenticated, planId, mealId) => {
    if (!isAuthenticated) return 'unknown';
    if (planId === 'new') return null;

    const previousState = get().nutritionBuilderState;
    set({ nutritionBuilderState: markNutritionBuilderMutating(previousState) });

    try {
      await removeNutritionMeal(planId, mealId);
      const updated = await getNutritionPlanDetail(planId);
      await setCachedNutritionPlan(updated);

      set((state) => ({
        nutritionBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));

      if (updated.sourceKind === 'predefined') {
        optimisticUpdatePredefinedPlan({
          id: updated.id,
          name: updated.name,
          planType: 'nutrition',
          ownerProfessionalUid: updated.ownerProfessionalUid ?? '',
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      }

      return null;
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ nutritionBuilderState: buildNutritionMutationErrorState(previousState, err) });
      return reason;
    }
  },

  reorderNutritionMealsAction: async (isAuthenticated, planId, mealIds) => {
    if (!isAuthenticated) return 'unknown';
    if (planId === 'new') return null;

    const previousState = get().nutritionBuilderState;
    set({ nutritionBuilderState: markNutritionBuilderMutating(previousState) });

    try {
      await reorderNutritionMeals(planId, mealIds);
      const updated = await getNutritionPlanDetail(planId);
      await setCachedNutritionPlan(updated);

      set((state) => ({
        nutritionBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));

      if (updated.sourceKind === 'predefined') {
        optimisticUpdatePredefinedPlan({
          id: updated.id,
          name: updated.name,
          planType: 'nutrition',
          ownerProfessionalUid: updated.ownerProfessionalUid ?? '',
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      }

      return null;
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ nutritionBuilderState: buildNutritionMutationErrorState(previousState, err) });
      return reason;
    }
  },

  addNutritionItemAction: async (isAuthenticated, planId, mealId, item, planInput) => {
    if (!isAuthenticated) return { planId, error: 'unknown' };

    const previousState = get().nutritionBuilderState;
    set({ nutritionBuilderState: markNutritionBuilderMutating(previousState) });

    try {
      let currentPlanId = planId;
      if (planId === 'new') {
        const res = await get().createNutritionPlanAction(
          isAuthenticated,
          planInput ?? { name: 'Untitled', hydrationGoalMl: '' }
        );
        if ('error' in res) return { planId, error: res.error };
        currentPlanId = res.id;
      }

      await addNutritionMealItem(currentPlanId, mealId, item);
      const updated = await getNutritionPlanDetail(currentPlanId);
      await setCachedNutritionPlan(updated);

      set((state) => ({
        nutritionBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));

      return { planId: currentPlanId, error: null };
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ nutritionBuilderState: buildNutritionMutationErrorState(previousState, err) });
      return { planId, error: reason };
    }
  },

  removeNutritionItemAction: async (isAuthenticated, planId, mealId, itemId) => {
    if (!isAuthenticated) return 'unknown';
    if (planId === 'new') return null;

    const previousState = get().nutritionBuilderState;
    set({ nutritionBuilderState: markNutritionBuilderMutating(previousState) });

    try {
      await removeNutritionMealItem(planId, mealId, itemId);
      const updated = await getNutritionPlanDetail(planId);
      await setCachedNutritionPlan(updated);

      set((state) => ({
        nutritionBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));

      return null;
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ nutritionBuilderState: buildNutritionMutationErrorState(previousState, err) });
      return reason;
    }
  },

  reorderNutritionItemsAction: async (isAuthenticated, planId, mealId, itemIds) => {
    if (!isAuthenticated) return 'unknown';
    if (planId === 'new') return null;

    const previousState = get().nutritionBuilderState;
    set({ nutritionBuilderState: markNutritionBuilderMutating(previousState) });

    try {
      await reorderNutritionMealItems(planId, mealId, itemIds);
      const updated = await getNutritionPlanDetail(planId);
      await setCachedNutritionPlan(updated);

      set((state) => ({
        nutritionBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));

      return null;
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ nutritionBuilderState: buildNutritionMutationErrorState(previousState, err) });
      return reason;
    }
  },

  deleteNutritionPlanAction: async (isAuthenticated, planId) => {
    if (!isAuthenticated) return 'unknown';

    const previousState = get().nutritionBuilderState;
    try {
      await deleteNutritionPlan(planId);
      optimisticDeletePredefinedPlan(planId);

      set((state) => ({
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));
      return null;
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ nutritionBuilderState: buildNutritionMutationErrorState(previousState, err) });
      return reason;
    }
  },

  runFoodSearch: (isAuthenticated, query) => {
    if (!isAuthenticated) return;

    const trimmed = query.trim();
    const requestId = get().foodSearchRequestId + 1;
    set({ foodSearchRequestId: requestId });

    if (!trimmed) {
      set({ foodSearchState: { kind: 'idle' } });
      return;
    }

    set({ foodSearchState: { kind: 'searching' } });
    void searchFoods(trimmed)
      .then((results) => {
        if (get().foodSearchRequestId !== requestId) return;
        set({ foodSearchState: { kind: 'done', results } });
      })
      .catch((err: unknown) => {
        if (get().foodSearchRequestId !== requestId) return;
        set({ foodSearchState: { kind: 'error', reason: normalizePlanBuilderError(err) } });
      });
  },

  validateNutritionInput: (input) => validateNutritionPlanInput(input),

  loadTrainingPlan: async (isAuthenticated, planId) => {
    get().syncAuthContext(isAuthenticated);
    if (!get().authUid) {
      set({ trainingBuilderState: { kind: 'error', reason: 'unknown', message: 'Not authenticated.' } });
      return;
    }

    const requestId = get().trainingLoadRequestId + 1;
    set({ trainingLoadRequestId: requestId, trainingBuilderState: { kind: 'loading' } });

    const cached = await getCachedTrainingPlan(planId);
    if (cached) {
      if (get().trainingLoadRequestId !== requestId) return;
      set({ trainingBuilderState: { kind: 'ready', plan: cached, isBackgroundUpdating: true } });
      try {
        const updated = await getTrainingPlanDetail(planId);
        if (get().trainingLoadRequestId !== requestId) return;
        await setCachedTrainingPlan(updated);
        set({ trainingBuilderState: { kind: 'ready', plan: updated, isBackgroundUpdating: false } });
      } catch (err) {
        if (get().trainingLoadRequestId !== requestId) return;
        set({
          trainingBuilderState: {
            kind: 'ready',
            plan: cached,
            isBackgroundUpdating: false,
            backgroundError: (err as Error).message,
          },
        });
      }
      return;
    }
    const startTime = Date.now();
    try {
      const plan = await getTrainingPlanDetail(planId);
      const elapsed = Date.now() - startTime;
      if (elapsed < 300) {
        await new Promise((resolve) => setTimeout(resolve, 300 - elapsed));
      }
      if (get().trainingLoadRequestId !== requestId) return;
      await setCachedTrainingPlan(plan);
      set({ trainingBuilderState: { kind: 'ready', plan } });
    } catch (err) {
      if (get().trainingLoadRequestId !== requestId) return;
      set({
        trainingBuilderState: {
          kind: 'error',
          reason: normalizePlanBuilderError(err),
          message: (err as Error).message,
        },
      });
    }
  },

  initNewTrainingPlan: () => {
    set({
      trainingBuilderState: {
        kind: 'ready',
        plan: {
          id: 'new',
          name: '',
          sessions: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });
  },

  createTrainingPlanAction: async (isAuthenticated, input) => {
    if (!isAuthenticated) return { error: 'unknown' };

    const errors = validateTrainingPlanInput(input);
    if (Object.keys(errors).length > 0) return { error: 'validation' };

    set({ trainingBuilderState: { kind: 'saving' } });
    try {
      const plan = await createTrainingPlan(input);
      set((state) => ({
        trainingBuilderState: { kind: 'ready', plan },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));
      optimisticUpdatePredefinedPlan({
        id: plan.id,
        name: plan.name,
        planType: 'training',
        ownerProfessionalUid: plan.ownerProfessionalUid ?? '',
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      });
      return { id: plan.id };
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ trainingBuilderState: { kind: 'error', reason, message: (err as Error).message } });
      return { error: reason };
    }
  },

  saveTrainingPlanAction: async (isAuthenticated, planId, input) => {
    if (!isAuthenticated) return 'unknown';

    const errors = validateTrainingPlanInput(input);
    if (Object.keys(errors).length > 0) return 'validation';

    const previousState = get().trainingBuilderState;
    set({ trainingBuilderState: markTrainingBuilderMutating(previousState) });

    try {
      await updateTrainingPlan(planId, input);
      const updated = await getTrainingPlanDetail(planId);
      set((state) => ({
        trainingBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));
      return null;
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ trainingBuilderState: buildTrainingMutationErrorState(previousState, err) });
      return reason;
    }
  },

  saveTrainingPlanWithSessionsAction: async (isAuthenticated, planId, input, sessions) => {
    if (!isAuthenticated) return { error: 'unknown' };

    const errors = validateTrainingPlanInput(input);
    if (Object.keys(errors).length > 0) return { error: 'validation' };

    const previousState = get().trainingBuilderState;
    set({ trainingBuilderState: markTrainingBuilderMutating(previousState) });

    try {
      let currentPlanId = planId;
      if (planId === 'new') {
        const created = await createTrainingPlan(input);
        currentPlanId = created.id;
      }

      await updateTrainingPlanWithSessions(currentPlanId, input, sessions);
      const updated = await getTrainingPlanDetail(currentPlanId);
      await setCachedTrainingPlan(updated);
      set((state) => ({
        trainingBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));

      optimisticUpdatePredefinedPlan({
        id: updated.id,
        name: updated.name,
        planType: 'training',
        ownerProfessionalUid: updated.ownerProfessionalUid ?? '',
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      });

      return { id: currentPlanId, plan: updated };
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ trainingBuilderState: buildTrainingMutationErrorState(previousState, err) });
      return { error: reason };
    }
  },

  addTrainingSessionAction: async (isAuthenticated, planId, session, planInput) => {
    if (!isAuthenticated) return { planId, error: 'unknown' };

    const previousState = get().trainingBuilderState;
    let currentPlanId = planId;
    set({ trainingBuilderState: markTrainingBuilderMutating(previousState) });

    try {
      if (planId === 'new') {
        const resolvedInput = resolveTrainingDraftCreationInput(planInput);
        if (resolvedInput.error) {
          return { planId, error: resolvedInput.error };
        }

        const res = await get().createTrainingPlanAction(isAuthenticated, resolvedInput.input!);
        if ('error' in res) return { planId, error: res.error };
        currentPlanId = res.id;
      }

      await addTrainingSession(currentPlanId, session);
      const updated = await getTrainingPlanDetail(currentPlanId);
      await setCachedTrainingPlan(updated);
      set((state) => ({
        trainingBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));

      return { planId: currentPlanId, error: null };
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ trainingBuilderState: buildTrainingMutationErrorState(previousState, err) });
      return { planId: currentPlanId, error: reason };
    }
  },

  removeTrainingSessionAction: async (isAuthenticated, planId, sessionId) => {
    if (!isAuthenticated) return 'unknown';

    const previousState = get().trainingBuilderState;
    set({ trainingBuilderState: markTrainingBuilderMutating(previousState) });

    try {
      await removeTrainingSession(planId, sessionId);
      const updated = await getTrainingPlanDetail(planId);
      await setCachedTrainingPlan(updated);
      set((state) => ({
        trainingBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));
      return null;
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ trainingBuilderState: buildTrainingMutationErrorState(previousState, err) });
      return reason;
    }
  },

  reorderTrainingSessionsAction: async (isAuthenticated, planId, sessionIds) => {
    if (!isAuthenticated) return 'unknown';

    const previousState = get().trainingBuilderState;
    set({ trainingBuilderState: markTrainingBuilderMutating(previousState) });

    try {
      await reorderTrainingSessions(planId, sessionIds);
      const updated = await getTrainingPlanDetail(planId);
      await setCachedTrainingPlan(updated);
      set((state) => ({
        trainingBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));
      return null;
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ trainingBuilderState: buildTrainingMutationErrorState(previousState, err) });
      return reason;
    }
  },

  addTrainingSessionItemAction: async (isAuthenticated, sessionId, item) => {
    if (!isAuthenticated) return 'unknown';
    const itemErrors = validateTrainingSessionItemInput(item);
    if (Object.keys(itemErrors).length > 0) return 'validation';

    const currentState = get().trainingBuilderState;
    if (currentState.kind !== 'ready') return null;
    const currentPlanId = currentState.plan.id;

    set({ trainingBuilderState: markTrainingBuilderMutating(currentState) });

    try {
      await addTrainingSessionItem(sessionId, item);
      const updated = await getTrainingPlanDetail(currentPlanId);
      await setCachedTrainingPlan(updated);
      set((state) => ({
        trainingBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));
      return null;
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ trainingBuilderState: buildTrainingMutationErrorState(currentState, err) });
      return reason;
    }
  },

  removeTrainingSessionItemAction: async (isAuthenticated, sessionId, itemId) => {
    if (!isAuthenticated) return 'unknown';

    const currentState = get().trainingBuilderState;
    if (currentState.kind !== 'ready') return null;
    const currentPlanId = currentState.plan.id;

    set({ trainingBuilderState: markTrainingBuilderMutating(currentState) });

    try {
      await removeTrainingSessionItem(currentPlanId, sessionId, itemId);
      const updated = await getTrainingPlanDetail(currentPlanId);
      await setCachedTrainingPlan(updated);
      set((state) => ({
        trainingBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));
      return null;
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ trainingBuilderState: buildTrainingMutationErrorState(currentState, err) });
      return reason;
    }
  },

  reorderTrainingSessionItemsAction: async (isAuthenticated, sessionId, itemIds) => {
    if (!isAuthenticated) return 'unknown';

    const currentState = get().trainingBuilderState;
    if (currentState.kind !== 'ready') return null;
    const currentPlanId = currentState.plan.id;

    set({ trainingBuilderState: markTrainingBuilderMutating(currentState) });

    try {
      await reorderTrainingSessionItems(sessionId, itemIds);
      const updated = await getTrainingPlanDetail(currentPlanId);
      await setCachedTrainingPlan(updated);
      set((state) => ({
        trainingBuilderState: { kind: 'ready', plan: updated },
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));
      return null;
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ trainingBuilderState: buildTrainingMutationErrorState(currentState, err) });
      return reason;
    }
  },

  deleteTrainingPlanAction: async (isAuthenticated, planId) => {
    if (!isAuthenticated) return 'unknown';

    const previousState = get().trainingBuilderState;
    try {
      await deleteTrainingPlan(planId);
      optimisticDeletePredefinedPlan(planId);
      set((state) => ({
        invalidation: {
          ...state.invalidation,
          plans: state.invalidation.plans + 1,
        },
      }));
      return null;
    } catch (err) {
      const reason = normalizePlanBuilderError(err);
      set({ trainingBuilderState: buildTrainingMutationErrorState(previousState, err) });
      return reason;
    }
  },

  validateTrainingInput: (input) => validateTrainingPlanInput(input),
  validateTrainingSessionItem: (item) => validateTrainingSessionItemInput(item),
}));
