/**
 * React hook for plan builder operations — nutrition and training.
 * Wraps plan-builder-source for screen consumption.
 * No Firebase/Firestore concerns in screen components.
 * Refs: D-111–D-114, D-126, FR-240–FR-248
 */

import { useCallback, useRef, useState } from 'react';

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
  updateTrainingPlanDraft,
  deleteTrainingPlan,
  getTrainingPlanDetail,
  addTrainingSession,
  removeTrainingSession,
  reorderTrainingSessions,
  addTrainingSessionItem,
  removeTrainingSessionItem,
  reorderTrainingSessionItems,
  getStarterTemplates,
  cloneStarterTemplate,
  searchFoods,
  optimisticUpdatePredefinedPlan,
  optimisticDeletePredefinedPlan,
  type NutritionPlanDetail,
  type TrainingPlanDetail,
  type FoodSearchResult,
} from './plan-builder-source';
import {
  validateNutritionPlanInput,
  validateTrainingPlanInput,
  resolveTrainingDraftCreationInput,
  validateTrainingSessionItemInput,
  normalizePlanBuilderError,
  calculateTotalsFromItems,
  calculateTotalsFromMeals,
  type NutritionPlanInput,
  type NutritionMeal,
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
  type StarterTemplate,
} from './plan-builder.logic';
import type { PlanType } from './plan-change-request.logic';

import {
  getCachedNutritionPlan,
  setCachedNutritionPlan,
  getCachedTrainingPlan,
  setCachedTrainingPlan,
} from './plan-cache';

// ─── State types ──────────────────────────────────────────────────────────────

export type NutritionBuilderState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'ready';
      plan: NutritionPlanDetail;
      isBackgroundUpdating?: boolean;
      backgroundError?: string;
      isMutating?: boolean;
    }
  | { kind: 'saving' }
  | { kind: 'error'; reason: PlanBuilderErrorReason; message: string };

export type TrainingBuilderState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'ready';
      plan: TrainingPlanDetail;
      isBackgroundUpdating?: boolean;
      backgroundError?: string;
      isMutating?: boolean;
    }
  | { kind: 'saving' }
  | { kind: 'error'; reason: PlanBuilderErrorReason; message: string };

export type FoodSearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'done'; results: FoodSearchResult[] }
  | { kind: 'error'; reason: PlanBuilderErrorReason };

export type { FoodSearchResult };

export function markNutritionBuilderMutating(
  state: NutritionBuilderState
): NutritionBuilderState {
  if (state.kind !== 'ready') {
    return state;
  }

  return {
    ...state,
    isMutating: true,
    backgroundError: undefined,
  };
}

export function markTrainingBuilderMutating(
  state: TrainingBuilderState
): TrainingBuilderState {
  if (state.kind !== 'ready') {
    return state;
  }

  return {
    ...state,
    isMutating: true,
    backgroundError: undefined,
  };
}

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

// ─── Nutrition plan builder hook ──────────────────────────────────────────────

export type UseNutritionPlanBuilderResult = {
  state: NutritionBuilderState;
  foodSearchState: FoodSearchState;
  clearFoodSearch: () => void;
  loadPlan: (planId: string) => void;
  initNewPlan: () => void;
  createPlan: (input: NutritionPlanInput) => Promise<{ id: string } | { error: PlanBuilderErrorReason }>;
  savePlan: (planId: string, input: NutritionPlanInput) => Promise<PlanBuilderErrorReason | null>;
  addMeal: (planId: string, meal: NutritionMealInput, planInput?: NutritionPlanInput) => Promise<{ planId: string; error: PlanBuilderErrorReason | null }>;
  removeMeal: (planId: string, mealId: string) => Promise<PlanBuilderErrorReason | null>;
  reorderMeals: (planId: string, mealIds: string[]) => Promise<PlanBuilderErrorReason | null>;
  addItem: (planId: string, mealId: string, item: NutritionMealItemInput, planInput?: NutritionPlanInput) => Promise<{ planId: string; error: PlanBuilderErrorReason | null }>;
  removeItem: (planId: string, mealId: string, itemId: string) => Promise<PlanBuilderErrorReason | null>;
  reorderItems: (planId: string, mealId: string, itemIds: string[]) => Promise<PlanBuilderErrorReason | null>;
  deletePlan: (planId: string) => Promise<PlanBuilderErrorReason | null>;
  searchFoods: (query: string) => void;
  validateInput: (input: NutritionPlanInput) => NutritionPlanValidationErrors;
};

export function useNutritionPlanBuilder(isAuthenticated: boolean): UseNutritionPlanBuilderResult {
  const [state, setState] = useState<NutritionBuilderState>({ kind: 'idle' });
  const [foodSearchState, setFoodSearchState] = useState<FoodSearchState>({ kind: 'idle' });

  const loadPlan = useCallback(
    (planId: string) => {
      if (!isAuthenticated) {
        setState({ kind: 'error', reason: 'unknown', message: 'Not authenticated.' });
        return;
      }

      async function execute() {
        // 1. Check cache first
        const cached = await getCachedNutritionPlan(planId);
        
        if (cached) {
          // Accessing for subsequent time: show cache immediately, then bg update
          setState({ kind: 'ready', plan: cached, isBackgroundUpdating: true });
          
          try {
            const updated = await getNutritionPlanDetail(planId);
            await setCachedNutritionPlan(updated);
            setState({ kind: 'ready', plan: updated, isBackgroundUpdating: false });
          } catch (err) {
            // Background update failed: show warning banner but keep cached data
            setState({ 
              kind: 'ready', 
              plan: cached, 
              isBackgroundUpdating: false, 
              backgroundError: (err as Error).message 
            });
          }
        } else {
          // Accessing for the first time: show loading for at least 300ms
          setState({ kind: 'loading' });
          const startTime = Date.now();
          
          try {
            const plan = await getNutritionPlanDetail(planId);
            const elapsed = Date.now() - startTime;
            if (elapsed < 300) {
              await new Promise(resolve => setTimeout(resolve, 300 - elapsed));
            }
            
            await setCachedNutritionPlan(plan);
            setState({ kind: 'ready', plan });
          } catch (err: any) {
            setState({
              kind: 'error',
              reason: normalizePlanBuilderError(err),
              message: err.message,
            });
          }
        }
      }

      void execute();
    },
    [isAuthenticated]
  );

  const initNewPlan = useCallback(() => {
    setState({
      kind: 'ready',
      plan: {
        id: 'new',
        name: '',
        caloriesTarget: 0,
        carbsTarget: 0,
        proteinsTarget: 0,
        fatsTarget: 0,
        meals: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }, []);

  const createPlan = useCallback(
    async (input: NutritionPlanInput): Promise<{ id: string } | { error: PlanBuilderErrorReason }> => {
      if (!isAuthenticated) return { error: 'unknown' };

      const errors = validateNutritionPlanInput(input);
      if (Object.keys(errors).length > 0) return { error: 'validation' };

      setState({ kind: 'saving' });
      try {
        const plan = await createNutritionPlan(input);
        setState({ kind: 'ready', plan });
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
        setState({ kind: 'error', reason, message: (err as Error).message });
        return { error: reason };
      }
    },
    [isAuthenticated]
  );

  const savePlan = useCallback(
    async (planId: string, input: NutritionPlanInput): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      const errors = validateNutritionPlanInput(input);
      if (Object.keys(errors).length > 0) return 'validation';

      const previousState = state;
      setState((prev) => markNutritionBuilderMutating(prev));

      try {
        await updateNutritionPlan(planId, input);
        // Reload to get authoritative state from server
        const updated = await getNutritionPlanDetail(planId);
        setState({ kind: 'ready', plan: updated });

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
        setState(buildNutritionMutationErrorState(previousState, err));
        return reason;
      }
    },
    [isAuthenticated, state]
  );

  const deletePlan = useCallback(
    async (planId: string): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      const previousState = state;
      try {
        await deleteNutritionPlan(planId);
        optimisticDeletePredefinedPlan(planId);
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState(buildNutritionMutationErrorState(previousState, err));
        return reason;
      }
    },
    [isAuthenticated, state]
  );

  const addMeal = useCallback(
    async (planId: string, meal: NutritionMealInput, planInput?: NutritionPlanInput): Promise<{ planId: string; error: PlanBuilderErrorReason | null }> => {
      if (!isAuthenticated) return { planId, error: 'unknown' };
      
      const previousState = state;
      setState((prev) => markNutritionBuilderMutating(prev));
      
      try {
        let currentPlanId = planId;
        if (planId === 'new') {
          const res = await createPlan(planInput ?? { name: 'Untitled' });
          if ('error' in res) {
            // Error already set by createPlan
            return { planId, error: res.error };
          }
          currentPlanId = res.id;
        }

        const newMeal = await addNutritionMeal(currentPlanId, meal);
        const updated = await getNutritionPlanDetail(currentPlanId);
        await setCachedNutritionPlan(updated);
        setState({ kind: 'ready', plan: updated });

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
        setState(buildNutritionMutationErrorState(previousState, err));
        return { planId, error: reason };
      }
    },
    [isAuthenticated, createPlan, state]
  );

  const removeMeal = useCallback(
    async (planId: string, mealId: string): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      if (planId === 'new') return null;

      const previousState = state;
      setState((prev) => markNutritionBuilderMutating(prev));

      try {
        await removeNutritionMeal(planId, mealId);
        const updated = await getNutritionPlanDetail(planId);
        await setCachedNutritionPlan(updated);
        setState({ kind: 'ready', plan: updated });

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
        setState(buildNutritionMutationErrorState(previousState, err));
        return reason;
      }
    },
    [isAuthenticated, state]
  );

  const reorderMeals = useCallback(
    async (planId: string, mealIds: string[]): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      if (planId === 'new') return null;

      const previousState = state;
      setState((prev) => markNutritionBuilderMutating(prev));

      try {
        await reorderNutritionMeals(planId, mealIds);
        const updated = await getNutritionPlanDetail(planId);
        await setCachedNutritionPlan(updated);
        setState({ kind: 'ready', plan: updated });

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
        setState(buildNutritionMutationErrorState(previousState, err));
        return reason;
      }
    },
    [isAuthenticated, state]
  );

  const addItem = useCallback(
    async (planId: string, mealId: string, item: NutritionMealItemInput, planInput?: NutritionPlanInput): Promise<{ planId: string; error: PlanBuilderErrorReason | null }> => {
      if (!isAuthenticated) return { planId, error: 'unknown' };

      const previousState = state;
      let currentPlanId = planId;
      setState((prev) => markNutritionBuilderMutating(prev));

      try {
        if (planId === 'new') {
          const res = await createPlan(planInput ?? { name: 'Untitled' });
          if ('error' in res) return { planId, error: res.error };
          currentPlanId = res.id;
        }

        await addNutritionMealItem(currentPlanId, mealId, item);
        const updated = await getNutritionPlanDetail(currentPlanId);
        await setCachedNutritionPlan(updated);
        setState({ kind: 'ready', plan: updated });
        
        return { planId: currentPlanId, error: null };
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState(buildNutritionMutationErrorState(previousState, err));
        return { planId: currentPlanId, error: reason };
      }
    },
    [isAuthenticated, createPlan, state]
  );

  const removeItem = useCallback(
    async (planId: string, mealId: string, itemId: string): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      if (planId === 'new') return null;

      const previousState = state;
      setState((prev) => markNutritionBuilderMutating(prev));

      try {
        await removeNutritionMealItem(planId, mealId, itemId);
        const updated = await getNutritionPlanDetail(planId);
        await setCachedNutritionPlan(updated);
        setState({ kind: 'ready', plan: updated });
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState(buildNutritionMutationErrorState(previousState, err));
        return reason;
      }
    },
    [isAuthenticated, state]
  );

  const reorderItems = useCallback(
    async (planId: string, mealId: string, itemIds: string[]): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      if (planId === 'new') return null;

      const previousState = state;
      setState((prev) => markNutritionBuilderMutating(prev));

      try {
        await reorderNutritionMealItems(planId, mealId, itemIds);
        const updated = await getNutritionPlanDetail(planId);
        await setCachedNutritionPlan(updated);
        setState({ kind: 'ready', plan: updated });
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState(buildNutritionMutationErrorState(previousState, err));
        return reason;
      }
    },
    [isAuthenticated, state]
  );

  const activeSearchQuery = useRef<string | null>(null);

  const runFoodSearch = useCallback((query: string) => {
    if (!isAuthenticated) return;
    const trimmed = query.trim();
    activeSearchQuery.current = trimmed;

    if (!trimmed) {
      setFoodSearchState({ kind: 'idle' });
      return;
    }

    setFoodSearchState({ kind: 'searching' });
    void searchFoods(trimmed)
      .then((results) => {
        if (activeSearchQuery.current !== trimmed) return;
        console.log('[useNutritionPlanBuilder] searchFoods results count:', results.length);
        setFoodSearchState({ kind: 'done', results });
      })
      .catch((err: unknown) => {
        if (activeSearchQuery.current !== trimmed) return;
        console.error('[useNutritionPlanBuilder] searchFoods error:', err);
        setFoodSearchState({ kind: 'error', reason: normalizePlanBuilderError(err) });
      });
  }, [isAuthenticated]);

  const clearFoodSearch = useCallback(() => {
    activeSearchQuery.current = null;
    setFoodSearchState({ kind: 'idle' });
  }, []);

  const validateInput = useCallback(
    (input: NutritionPlanInput) => validateNutritionPlanInput(input),
    []
  );

  return {
    state,
    foodSearchState,
    clearFoodSearch,
    loadPlan,
    initNewPlan,
    createPlan,
    savePlan,
    addMeal,
    removeMeal,
    reorderMeals,
    addItem,
    removeItem,
    reorderItems,
    deletePlan,
    searchFoods: runFoodSearch,
    validateInput,
  };
}

// ─── Training plan builder hook ───────────────────────────────────────────────

export type UseTrainingPlanBuilderResult = {
  state: TrainingBuilderState;
  loadPlan: (planId: string) => void;
  initNewPlan: () => void;
  createPlan: (input: TrainingPlanInput) => Promise<{ id: string } | { error: PlanBuilderErrorReason }>;
  savePlan: (planId: string, input: TrainingPlanInput) => Promise<PlanBuilderErrorReason | null>;
  savePlanDraft: (
    planId: string,
    input: TrainingPlanInput,
    sessions: TrainingSession[]
  ) => Promise<{ id: string; plan: TrainingPlanDetail } | { error: PlanBuilderErrorReason }>;
  addSession: (
    planId: string,
    session: TrainingSessionInput,
    planInput?: TrainingPlanInput
  ) => Promise<{ planId: string; error: PlanBuilderErrorReason | null }>;
  removeSession: (planId: string, sessionId: string) => Promise<PlanBuilderErrorReason | null>;
  reorderSessions: (planId: string, sessionIds: string[]) => Promise<PlanBuilderErrorReason | null>;
  addSessionItem: (sessionId: string, item: TrainingSessionItemInput) => Promise<PlanBuilderErrorReason | null>;
  removeSessionItem: (sessionId: string, itemId: string) => Promise<PlanBuilderErrorReason | null>;
  reorderSessionItems: (sessionId: string, itemIds: string[]) => Promise<PlanBuilderErrorReason | null>;
  deletePlan: (planId: string) => Promise<PlanBuilderErrorReason | null>;
  validateInput: (input: TrainingPlanInput) => TrainingPlanValidationErrors;
  validateSessionItem: (item: TrainingSessionItemInput) => TrainingSessionItemValidationErrors;
};

export function useTrainingPlanBuilder(isAuthenticated: boolean): UseTrainingPlanBuilderResult {
  const [state, setState] = useState<TrainingBuilderState>({ kind: 'idle' });

  const loadPlan = useCallback(
    (planId: string) => {
      if (!isAuthenticated) {
        setState({ kind: 'error', reason: 'unknown', message: 'Not authenticated.' });
        return;
      }

      async function execute() {
        const cached = await getCachedTrainingPlan(planId);
        
        if (cached) {
          setState({ kind: 'ready', plan: cached, isBackgroundUpdating: true });
          try {
            const updated = await getTrainingPlanDetail(planId);
            await setCachedTrainingPlan(updated);
            setState({ kind: 'ready', plan: updated, isBackgroundUpdating: false });
          } catch (err) {
            setState({ 
              kind: 'ready', 
              plan: cached, 
              isBackgroundUpdating: false, 
              backgroundError: (err as Error).message 
            });
          }
        } else {
          setState({ kind: 'loading' });
          const startTime = Date.now();
          try {
            const plan = await getTrainingPlanDetail(planId);
            const elapsed = Date.now() - startTime;
            if (elapsed < 300) {
              await new Promise(resolve => setTimeout(resolve, 300 - elapsed));
            }
            await setCachedTrainingPlan(plan);
            setState({ kind: 'ready', plan });
          } catch (err: any) {
            setState({
              kind: 'error',
              reason: normalizePlanBuilderError(err),
              message: err.message,
            });
          }
        }
      }

      void execute();
    },
    [isAuthenticated]
  );

  const createPlan = useCallback(
    async (input: TrainingPlanInput): Promise<{ id: string } | { error: PlanBuilderErrorReason }> => {
      if (!isAuthenticated) return { error: 'unknown' };

      const errors = validateTrainingPlanInput(input);
      if (Object.keys(errors).length > 0) return { error: 'validation' };

      setState({ kind: 'saving' });
      try {
        const plan = await createTrainingPlan(input);
        setState({ kind: 'ready', plan });
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
        setState({ kind: 'error', reason, message: (err as Error).message });
        return { error: reason };
      }
    },
    [isAuthenticated]
  );

  const initNewPlan = useCallback(() => {
    setState({
      kind: 'ready',
      plan: {
        id: 'new',
        name: '',
        sessions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }, []);

  const savePlan = useCallback(
    async (planId: string, input: TrainingPlanInput): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      const errors = validateTrainingPlanInput(input);
      if (Object.keys(errors).length > 0) return 'validation';

      const previousState = state;
      setState((prev) => markTrainingBuilderMutating(prev));

      try {
        await updateTrainingPlan(planId, input);
        const updated = await getTrainingPlanDetail(planId);
        setState({ kind: 'ready', plan: updated });
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState(buildTrainingMutationErrorState(previousState, err));
        return reason;
      }
    },
    [isAuthenticated, state]
  );

  const savePlanDraft = useCallback(
    async (
      planId: string,
      input: TrainingPlanInput,
      sessions: TrainingSession[]
    ): Promise<{ id: string; plan: TrainingPlanDetail } | { error: PlanBuilderErrorReason }> => {
      if (!isAuthenticated) return { error: 'unknown' };

      const errors = validateTrainingPlanInput(input);
      if (Object.keys(errors).length > 0) return { error: 'validation' };

      const previousState = state;
      setState((prev) => markTrainingBuilderMutating(prev));

      try {
        let currentPlanId = planId;
        if (planId === 'new') {
          const created = await createTrainingPlan(input);
          currentPlanId = created.id;
        }

        await updateTrainingPlanDraft(currentPlanId, input, sessions);
        const updated = await getTrainingPlanDetail(currentPlanId);
        await setCachedTrainingPlan(updated);
        setState({ kind: 'ready', plan: updated });

        // Optimistically update the predefined plans list cache
        if (updated.sourceKind === 'predefined') {
          optimisticUpdatePredefinedPlan({
            id: updated.id,
            name: updated.name,
            planType: 'training',
            ownerProfessionalUid: updated.ownerProfessionalUid ?? '',
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          });
        }
        
        return { id: currentPlanId, plan: updated };
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState(buildTrainingMutationErrorState(previousState, err));
        return { error: reason };
      }
    },
    [isAuthenticated, state]
  );

  const deletePlan = useCallback(
    async (planId: string): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      const previousState = state;
      try {
        await deleteTrainingPlan(planId);
        optimisticDeletePredefinedPlan(planId);
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState(buildTrainingMutationErrorState(previousState, err));
        return reason;
      }
    },
    [isAuthenticated, state]
  );

  const addSession = useCallback(
    async (
      planId: string,
      session: TrainingSessionInput,
      planInput?: TrainingPlanInput
    ): Promise<{ planId: string; error: PlanBuilderErrorReason | null }> => {
      if (!isAuthenticated) return { planId, error: 'unknown' };

      const previousState = state;
      let currentPlanId = planId;
      setState((prev) => markTrainingBuilderMutating(prev));

      try {
        if (planId === 'new') {
          const resolvedInput = resolveTrainingDraftCreationInput(planInput);
          if (resolvedInput.error) {
            // Revert state if possible or handle error
            return { planId, error: resolvedInput.error };
          }

          const res = await createPlan(resolvedInput.input!);
          if ('error' in res) return { planId, error: res.error };
          currentPlanId = res.id;
        }

        await addTrainingSession(currentPlanId, session);
        const updated = await getTrainingPlanDetail(currentPlanId);
        await setCachedTrainingPlan(updated);
        setState({ kind: 'ready', plan: updated });
        
        return { planId: currentPlanId, error: null };
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState(buildTrainingMutationErrorState(previousState, err));
        return { planId, error: reason };
      }
    },
    [isAuthenticated, createPlan, state]
  );

  const removeSession = useCallback(
    async (planId: string, sessionId: string): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      const previousState = state;
      setState((prev) => markTrainingBuilderMutating(prev));

      try {
        await removeTrainingSession(planId, sessionId);
        const updated = await getTrainingPlanDetail(planId);
        await setCachedTrainingPlan(updated);
        setState({ kind: 'ready', plan: updated });
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState(buildTrainingMutationErrorState(previousState, err));
        return reason;
      }
    },
    [isAuthenticated, state]
  );

  const addSessionItem = useCallback(
    async (sessionId: string, item: TrainingSessionItemInput): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      const itemErrors = validateTrainingSessionItemInput(item);
      if (Object.keys(itemErrors).length > 0) return 'validation';

      // Read planId synchronously from the current state snapshot BEFORE calling
      // setState. Capturing it inside a setState updater closure is unreliable —
      // React batches updaters and may run them after the first await suspension
      // point, leaving currentPlanId null when the if-guard would run.
      if (state.kind !== 'ready') return null;
      const previousState = state;
      const currentPlanId = state.plan.id;

      setState((prev) => markTrainingBuilderMutating(prev));

      try {
        await addTrainingSessionItem(sessionId, item);
        const updated = await getTrainingPlanDetail(currentPlanId);
        await setCachedTrainingPlan(updated);
        setState({ kind: 'ready', plan: updated });
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState(buildTrainingMutationErrorState(previousState, err));
        return reason;
      }
    },
    [isAuthenticated, state]
  );

  const removeSessionItem = useCallback(
    async (sessionId: string, itemId: string): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      // Read planId synchronously from the current state snapshot BEFORE calling
      // setState. Capturing it inside a setState updater closure is unreliable —
      // React batches updaters and may run them after the first await suspension
      // point, leaving currentPlanId null when the if-guard below runs.
      if (state.kind !== 'ready') return null;
      const previousState = state;
      const currentPlanId = state.plan.id;

      setState((prev) => markTrainingBuilderMutating(prev));

      try {
        await removeTrainingSessionItem(currentPlanId, sessionId, itemId);
        const updated = await getTrainingPlanDetail(currentPlanId);
        await setCachedTrainingPlan(updated);
        setState({ kind: 'ready', plan: updated });
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState(buildTrainingMutationErrorState(previousState, err));
        return reason;
      }
    },
    [isAuthenticated, state]
  );

  const reorderSessions = useCallback(
    async (planId: string, sessionIds: string[]): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      const previousState = state;
      setState((prev) => markTrainingBuilderMutating(prev));

      try {
        await reorderTrainingSessions(planId, sessionIds);
        const updated = await getTrainingPlanDetail(planId);
        await setCachedTrainingPlan(updated);
        setState({ kind: 'ready', plan: updated });
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState(buildTrainingMutationErrorState(previousState, err));
        return reason;
      }
    },
    [isAuthenticated, state]
  );

  const reorderSessionItems = useCallback(
    async (sessionId: string, itemIds: string[]): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      if (state.kind !== 'ready') return null;
      const previousState = state;
      const currentPlanId = state.plan.id;
      setState((prev) => markTrainingBuilderMutating(prev));

      try {
        await reorderTrainingSessionItems(sessionId, itemIds);
        const updated = await getTrainingPlanDetail(currentPlanId);
        await setCachedTrainingPlan(updated);
        setState({ kind: 'ready', plan: updated });
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState(buildTrainingMutationErrorState(previousState, err));
        return reason;
      }
    },
    [isAuthenticated, state]
  );

  const validateInput = useCallback(
    (input: TrainingPlanInput) => validateTrainingPlanInput(input),
    []
  );

  const validateSessionItem = useCallback(
    (item: TrainingSessionItemInput) => validateTrainingSessionItemInput(item),
    []
  );

  return {
    state,
    loadPlan,
    initNewPlan,
    createPlan,
    savePlan,
    savePlanDraft,
    addSession,
    removeSession,
    reorderSessions,
    addSessionItem,
    removeSessionItem,
    reorderSessionItems,
    deletePlan,
    validateInput,
    validateSessionItem,
  };
}
