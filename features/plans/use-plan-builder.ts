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
  | { kind: 'ready'; plan: NutritionPlanDetail; isBackgroundUpdating?: boolean; backgroundError?: string }
  | { kind: 'saving' }
  | { kind: 'error'; reason: PlanBuilderErrorReason; message: string };

export type TrainingBuilderState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; plan: TrainingPlanDetail; isBackgroundUpdating?: boolean; backgroundError?: string }
  | { kind: 'saving' }
  | { kind: 'error'; reason: PlanBuilderErrorReason; message: string };

export type TemplatePickerState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; templates: StarterTemplate[] }
  | { kind: 'error'; reason: PlanBuilderErrorReason };

export type FoodSearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'done'; results: FoodSearchResult[] }
  | { kind: 'error'; reason: PlanBuilderErrorReason };

export type { FoodSearchResult };

// ─── Nutrition plan builder hook ──────────────────────────────────────────────

export type UseNutritionPlanBuilderResult = {
  state: NutritionBuilderState;
  templatePickerState: TemplatePickerState;
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
  loadTemplates: () => void;
  cloneTemplate: (templateId: string, name: string) => Promise<{ id: string; planType: PlanType } | { error: PlanBuilderErrorReason }>;
  searchFoods: (query: string) => void;
  validateInput: (input: NutritionPlanInput) => NutritionPlanValidationErrors;
};

export function useNutritionPlanBuilder(isAuthenticated: boolean): UseNutritionPlanBuilderResult {
  const [state, setState] = useState<NutritionBuilderState>({ kind: 'idle' });
  const [templatePickerState, setTemplatePickerState] = useState<TemplatePickerState>({ kind: 'idle' });
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

      setState((prev) => {
        if (prev.kind === 'ready') return { kind: 'saving' };
        return prev;
      });

      try {
        await updateNutritionPlan(planId, input);
        // Reload to get authoritative state from server
        const updated = await getNutritionPlanDetail(planId);
        setState({ kind: 'ready', plan: updated });
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState({ kind: 'error', reason, message: (err as Error).message });
        return reason;
      }
    },
    [isAuthenticated]
  );

  const deletePlan = useCallback(
    async (planId: string): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      setState({ kind: 'saving' });
      try {
        await deleteNutritionPlan(planId);
        setState({ kind: 'idle' });
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState({ kind: 'error', reason, message: (err as Error).message });
        return reason;
      }
    },
    [isAuthenticated]
  );

  const addMeal = useCallback(
    async (planId: string, meal: NutritionMealInput, planInput?: NutritionPlanInput): Promise<{ planId: string; error: PlanBuilderErrorReason | null }> => {
      if (!isAuthenticated) return { planId, error: 'unknown' };
      try {
        let currentPlanId = planId;
        if (planId === 'new') {
          const res = await createPlan(planInput ?? { name: 'Untitled' });
          if ('error' in res) return { planId, error: res.error };
          currentPlanId = res.id;
        }

        const newMeal = await addNutritionMeal(currentPlanId, meal);
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          return {
            ...prev,
            plan: {
              ...prev.plan,
              meals: [...prev.plan.meals, newMeal],
            },
          };
        });
        return { planId: currentPlanId, error: null };
      } catch (err) {
        return { planId, error: normalizePlanBuilderError(err) };
      }
    },
    [isAuthenticated, createPlan]
  );

  const removeMeal = useCallback(
    async (planId: string, mealId: string): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      if (planId === 'new') return null;
      try {
        await removeNutritionMeal(planId, mealId);
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          const newMeals = prev.plan.meals.filter((m) => m.id !== mealId);
          const totals = calculateTotalsFromMeals(newMeals);
          return {
            ...prev,
            plan: {
              ...prev.plan,
              meals: newMeals,
              caloriesTarget: totals.calories,
              carbsTarget: totals.carbs,
              proteinsTarget: totals.proteins,
              fatsTarget: totals.fats,
            },
          };
        });
        return null;
      } catch (err) {
        return normalizePlanBuilderError(err);
      }
    },
    [isAuthenticated]
  );

  const reorderMeals = useCallback(
    async (planId: string, mealIds: string[]): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      if (planId === 'new') return null;

      // Optimistic update
      let previousState: NutritionBuilderState | null = null;
      setState((prev) => {
        if (prev.kind !== 'ready') return prev;
        previousState = prev;
        const reorderedMeals = mealIds
          .map((id) => prev.plan.meals.find((m) => m.id === id))
          .filter(Boolean) as NutritionMeal[];
        return {
          ...prev,
          plan: { ...prev.plan, meals: reorderedMeals },
        };
      });

      try {
        await reorderNutritionMeals(planId, mealIds);
        return null;
      } catch (err) {
        // Rollback
        if (previousState) setState(previousState);
        return normalizePlanBuilderError(err);
      }
    },
    [isAuthenticated]
  );

  const addItem = useCallback(
    async (planId: string, mealId: string, item: NutritionMealItemInput, planInput?: NutritionPlanInput): Promise<{ planId: string; error: PlanBuilderErrorReason | null }> => {
      if (!isAuthenticated) return { planId, error: 'unknown' };
      try {
        let currentPlanId = planId;
        if (planId === 'new') {
          const res = await createPlan(planInput ?? { name: 'Untitled' });
          if ('error' in res) return { planId, error: res.error };
          currentPlanId = res.id;
        }

        const newItem = await addNutritionMealItem(currentPlanId, mealId, item);
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          const meals = prev.plan.meals.map((m) => {
            if (m.id !== mealId) return m;
            return { ...m, items: [...m.items, newItem] };
          });
          const totals = calculateTotalsFromMeals(meals);
          return {
            ...prev,
            plan: {
              ...prev.plan,
              meals,
              caloriesTarget: totals.calories,
              carbsTarget: totals.carbs,
              proteinsTarget: totals.proteins,
              fatsTarget: totals.fats,
            },
          };
        });
        return { planId: currentPlanId, error: null };
      } catch (err) {
        return { planId, error: normalizePlanBuilderError(err) };
      }
    },
    [isAuthenticated, createPlan]
  );

  const removeItem = useCallback(
    async (planId: string, mealId: string, itemId: string): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      if (planId === 'new') return null;
      try {
        await removeNutritionMealItem(planId, mealId, itemId);
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          const meals = prev.plan.meals.map((m) => {
            if (m.id !== mealId) return m;
            return { ...m, items: m.items.filter((i) => i.id !== itemId) };
          });
          const totals = calculateTotalsFromMeals(meals);
          return {
            ...prev,
            plan: {
              ...prev.plan,
              meals,
              caloriesTarget: totals.calories,
              carbsTarget: totals.carbs,
              proteinsTarget: totals.proteins,
              fatsTarget: totals.fats,
            },
          };
        });
        return null;
      } catch (err) {
        return normalizePlanBuilderError(err);
      }
    },
    [isAuthenticated]
  );

  const reorderItems = useCallback(
    async (planId: string, mealId: string, itemIds: string[]): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      if (planId === 'new') return null;

      // Optimistic update
      let previousState: NutritionBuilderState | null = null;
      setState((prev) => {
        if (prev.kind !== 'ready') return prev;
        previousState = prev;
        const meals = prev.plan.meals.map((m) => {
          if (m.id !== mealId) return m;
          const reorderedItems = itemIds
            .map((id) => m.items.find((it) => it.id === id))
            .filter(Boolean) as any[];
          return { ...m, items: reorderedItems };
        });
        return {
          ...prev,
          plan: { ...prev.plan, meals },
        };
      });

      try {
        await reorderNutritionMealItems(planId, mealId, itemIds);
        return null;
      } catch (err) {
        // Rollback
        if (previousState) setState(previousState);
        return normalizePlanBuilderError(err);
      }
    },
    [isAuthenticated]
  );

  const loadTemplates = useCallback(() => {
    setTemplatePickerState({ kind: 'loading' });
    void getStarterTemplates('nutrition')
      .then((templates) => setTemplatePickerState({ kind: 'ready', templates }))
      .catch((err: unknown) =>
        setTemplatePickerState({ kind: 'error', reason: normalizePlanBuilderError(err) })
      );
  }, []);

  const cloneTemplate = useCallback(
    async (templateId: string, name: string): Promise<{ id: string; planType: PlanType } | { error: PlanBuilderErrorReason }> => {
      if (!isAuthenticated) return { error: 'unknown' };
      try {
        // cloneStarterTemplate still requires a user.uid for the professionalId in the SDK call.
        // The SDK itself handles auth; uid is used only for the clone vars.
        // Pass a sentinel object — the DC instance carries the real auth token.
        const result = await cloneStarterTemplate({ uid: '' }, templateId, name);
        return { id: result.id, planType: result.planType };
      } catch (err) {
        return { error: normalizePlanBuilderError(err) };
      }
    },
    [isAuthenticated]
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
    templatePickerState,
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
    loadTemplates,
    cloneTemplate,
    searchFoods: runFoodSearch,
    validateInput,
  };
}

// ─── Training plan builder hook ───────────────────────────────────────────────

export type UseTrainingPlanBuilderResult = {
  state: TrainingBuilderState;
  templatePickerState: TemplatePickerState;
  loadPlan: (planId: string) => void;
  initNewPlan: () => void;
  createPlan: (input: TrainingPlanInput) => Promise<{ id: string } | { error: PlanBuilderErrorReason }>;
  savePlan: (planId: string, input: TrainingPlanInput) => Promise<PlanBuilderErrorReason | null>;
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
  loadTemplates: () => void;
  cloneTemplate: (templateId: string, name: string) => Promise<{ id: string; planType: PlanType } | { error: PlanBuilderErrorReason }>;
  validateInput: (input: TrainingPlanInput) => TrainingPlanValidationErrors;
  validateSessionItem: (item: TrainingSessionItemInput) => TrainingSessionItemValidationErrors;
};

export function useTrainingPlanBuilder(isAuthenticated: boolean): UseTrainingPlanBuilderResult {
  const [state, setState] = useState<TrainingBuilderState>({ kind: 'idle' });
  const [templatePickerState, setTemplatePickerState] = useState<TemplatePickerState>({ kind: 'idle' });

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

      setState((prev) => {
        if (prev.kind === 'ready') return { kind: 'saving' };
        return prev;
      });

      try {
        await updateTrainingPlan(planId, input);
        const updated = await getTrainingPlanDetail(planId);
        setState({ kind: 'ready', plan: updated });
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState({ kind: 'error', reason, message: (err as Error).message });
        return reason;
      }
    },
    [isAuthenticated]
  );

  const deletePlan = useCallback(
    async (planId: string): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      setState({ kind: 'saving' });
      try {
        await deleteTrainingPlan(planId);
        setState({ kind: 'idle' });
        return null;
      } catch (err) {
        const reason = normalizePlanBuilderError(err);
        setState({ kind: 'error', reason, message: (err as Error).message });
        return reason;
      }
    },
    [isAuthenticated]
  );

  const addSession = useCallback(
    async (
      planId: string,
      session: TrainingSessionInput,
      planInput?: TrainingPlanInput
    ): Promise<{ planId: string; error: PlanBuilderErrorReason | null }> => {
      if (!isAuthenticated) return { planId, error: 'unknown' };
      try {
        let currentPlanId = planId;
        if (planId === 'new') {
          const resolvedInput = resolveTrainingDraftCreationInput(planInput);
          if (resolvedInput.error) return { planId, error: resolvedInput.error };

          const res = await createPlan(resolvedInput.input!);
          if ('error' in res) return { planId, error: res.error };
          currentPlanId = res.id;
        }

        const newSession = await addTrainingSession(currentPlanId, session);
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          return { ...prev, plan: { ...prev.plan, sessions: [...prev.plan.sessions, newSession] } };
        });
        return { planId: currentPlanId, error: null };
      } catch (err) {
        return { planId, error: normalizePlanBuilderError(err) };
      }
    },
    [isAuthenticated, createPlan]
  );

  const removeSession = useCallback(
    async (planId: string, sessionId: string): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      try {
        await removeTrainingSession(planId, sessionId);
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          return {
            ...prev,
            plan: { ...prev.plan, sessions: prev.plan.sessions.filter((s) => s.id !== sessionId) },
          };
        });
        return null;
      } catch (err) {
        return normalizePlanBuilderError(err);
      }
    },
    [isAuthenticated]
  );

  const addSessionItem = useCallback(
    async (sessionId: string, item: TrainingSessionItemInput): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      const itemErrors = validateTrainingSessionItemInput(item);
      if (Object.keys(itemErrors).length > 0) return 'validation';
      try {
        const newItem = await addTrainingSessionItem(sessionId, item);
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          const sessions = prev.plan.sessions.map((s) =>
            s.id === sessionId ? { ...s, items: [...s.items, newItem] } : s
          );
          return { ...prev, plan: { ...prev.plan, sessions } };
        });
        return null;
      } catch (err) {
        return normalizePlanBuilderError(err);
      }
    },
    [isAuthenticated]
  );

  const removeSessionItem = useCallback(
    async (sessionId: string, itemId: string): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      try {
        await removeTrainingSessionItem(sessionId, itemId);
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          const sessions = prev.plan.sessions.map((s) =>
            s.id === sessionId ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s
          );
          return { ...prev, plan: { ...prev.plan, sessions } };
        });
        return null;
      } catch (err) {
        return normalizePlanBuilderError(err);
      }
    },
    [isAuthenticated]
  );

  const reorderSessions = useCallback(
    async (planId: string, sessionIds: string[]): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      // Optimistic update
      let previousState: TrainingBuilderState | null = null;
      setState((prev) => {
        if (prev.kind !== 'ready') return prev;
        previousState = prev;
        const reorderedSessions = sessionIds
          .map((id) => prev.plan.sessions.find((s) => s.id === id))
          .filter(Boolean) as any[];
        return {
          ...prev,
          plan: { ...prev.plan, sessions: reorderedSessions },
        };
      });

      try {
        await reorderTrainingSessions(planId, sessionIds);
        return null;
      } catch (err) {
        // Rollback
        if (previousState) setState(previousState);
        return normalizePlanBuilderError(err);
      }
    },
    [isAuthenticated]
  );

  const reorderSessionItems = useCallback(
    async (sessionId: string, itemIds: string[]): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      // Optimistic update
      let previousState: TrainingBuilderState | null = null;
      setState((prev) => {
        if (prev.kind !== 'ready') return prev;
        previousState = prev;
        const sessions = prev.plan.sessions.map((s) => {
          if (s.id !== sessionId) return s;
          const reorderedItems = itemIds
            .map((id) => s.items.find((it) => it.id === id))
            .filter(Boolean) as any[];
          return { ...s, items: reorderedItems };
        });
        return {
          ...prev,
          plan: { ...prev.plan, sessions },
        };
      });

      try {
        await reorderTrainingSessionItems(sessionId, itemIds);
        return null;
      } catch (err) {
        // Rollback
        if (previousState) setState(previousState);
        return normalizePlanBuilderError(err);
      }
    },
    [isAuthenticated]
  );

  const loadTemplates = useCallback(() => {
    setTemplatePickerState({ kind: 'loading' });
    void getStarterTemplates('training')
      .then((templates) => setTemplatePickerState({ kind: 'ready', templates }))
      .catch((err: unknown) =>
        setTemplatePickerState({ kind: 'error', reason: normalizePlanBuilderError(err) })
      );
  }, []);

  const cloneTemplate = useCallback(
    async (templateId: string, name: string): Promise<{ id: string; planType: PlanType } | { error: PlanBuilderErrorReason }> => {
      if (!isAuthenticated) return { error: 'unknown' };
      try {
        const result = await cloneStarterTemplate({ uid: '' }, templateId, name);
        return { id: result.id, planType: result.planType };
      } catch (err) {
        return { error: normalizePlanBuilderError(err) };
      }
    },
    [isAuthenticated]
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
    templatePickerState,
    loadPlan,
    initNewPlan,
    createPlan,
    savePlan,
    addSession,
    removeSession,
    reorderSessions,
    addSessionItem,
    removeSessionItem,
    reorderSessionItems,
    deletePlan,
    loadTemplates,
    cloneTemplate,
    validateInput,
    validateSessionItem,
  };
}
