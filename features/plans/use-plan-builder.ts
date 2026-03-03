/**
 * React hook for plan builder operations — nutrition and training.
 * Wraps plan-builder-source for screen consumption.
 * No Firebase/Data Connect concerns in screen components.
 * Refs: D-111–D-114, D-126, FR-240–FR-248
 */

import { useCallback, useState } from 'react';

import {
  createNutritionPlan,
  updateNutritionPlan,
  getNutritionPlanDetail,
  addNutritionMealItem,
  removeNutritionMealItem,
  createTrainingPlan,
  updateTrainingPlan,
  getTrainingPlanDetail,
  addTrainingSession,
  removeTrainingSession,
  addTrainingSessionItem,
  removeTrainingSessionItem,
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
  validateTrainingSessionItemInput,
  normalizePlanBuilderError,
  type NutritionPlanInput,
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

// ─── State types ──────────────────────────────────────────────────────────────

export type NutritionBuilderState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; plan: NutritionPlanDetail }
  | { kind: 'saving' }
  | { kind: 'error'; reason: PlanBuilderErrorReason; message: string };

export type TrainingBuilderState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; plan: TrainingPlanDetail }
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

// ─── Nutrition plan builder hook ──────────────────────────────────────────────

export type UseNutritionPlanBuilderResult = {
  state: NutritionBuilderState;
  templatePickerState: TemplatePickerState;
  foodSearchState: FoodSearchState;
  loadPlan: (planId: string) => void;
  createPlan: (input: NutritionPlanInput) => Promise<{ id: string } | { error: PlanBuilderErrorReason }>;
  savePlan: (planId: string, input: NutritionPlanInput) => Promise<PlanBuilderErrorReason | null>;
  addItem: (planId: string, item: NutritionMealItemInput) => Promise<PlanBuilderErrorReason | null>;
  removeItem: (planId: string, itemId: string) => Promise<PlanBuilderErrorReason | null>;
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
      setState({ kind: 'loading' });
      void getNutritionPlanDetail(planId)
        .then((plan) => setState({ kind: 'ready', plan }))
        .catch((err: Error) => {
          setState({
            kind: 'error',
            reason: normalizePlanBuilderError(err),
            message: err.message,
          });
        });
    },
    [isAuthenticated]
  );

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

  const addItem = useCallback(
    async (planId: string, item: NutritionMealItemInput): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      try {
        const newItem = await addNutritionMealItem(planId, item);
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          return { ...prev, plan: { ...prev.plan, items: [...prev.plan.items, newItem] } };
        });
        return null;
      } catch (err) {
        return normalizePlanBuilderError(err);
      }
    },
    [isAuthenticated]
  );

  const removeItem = useCallback(
    async (planId: string, itemId: string): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      try {
        await removeNutritionMealItem(planId, itemId);
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          return {
            ...prev,
            plan: { ...prev.plan, items: prev.plan.items.filter((i) => i.id !== itemId) },
          };
        });
        return null;
      } catch (err) {
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

  const runFoodSearch = useCallback((query: string) => {
    if (!query.trim()) {
      setFoodSearchState({ kind: 'idle' });
      return;
    }
    setFoodSearchState({ kind: 'searching' });
    void searchFoods(query)
      .then((results) => setFoodSearchState({ kind: 'done', results }))
      .catch((err: unknown) =>
        setFoodSearchState({ kind: 'error', reason: normalizePlanBuilderError(err) })
      );
  }, []);

  const validateInput = useCallback(
    (input: NutritionPlanInput) => validateNutritionPlanInput(input),
    []
  );

  return {
    state,
    templatePickerState,
    foodSearchState,
    loadPlan,
    createPlan,
    savePlan,
    addItem,
    removeItem,
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
  createPlan: (input: TrainingPlanInput) => Promise<{ id: string } | { error: PlanBuilderErrorReason }>;
  savePlan: (planId: string, input: TrainingPlanInput) => Promise<PlanBuilderErrorReason | null>;
  addSession: (planId: string, session: TrainingSessionInput) => Promise<PlanBuilderErrorReason | null>;
  removeSession: (planId: string, sessionId: string) => Promise<PlanBuilderErrorReason | null>;
  addSessionItem: (sessionId: string, item: TrainingSessionItemInput) => Promise<PlanBuilderErrorReason | null>;
  removeSessionItem: (sessionId: string, itemId: string) => Promise<PlanBuilderErrorReason | null>;
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
      setState({ kind: 'loading' });
      void getTrainingPlanDetail(planId)
        .then((plan) => setState({ kind: 'ready', plan }))
        .catch((err: Error) => {
          setState({
            kind: 'error',
            reason: normalizePlanBuilderError(err),
            message: err.message,
          });
        });
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

  const addSession = useCallback(
    async (planId: string, session: TrainingSessionInput): Promise<PlanBuilderErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';
      try {
        const newSession = await addTrainingSession(planId, session);
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          return { ...prev, plan: { ...prev.plan, sessions: [...prev.plan.sessions, newSession] } };
        });
        return null;
      } catch (err) {
        return normalizePlanBuilderError(err);
      }
    },
    [isAuthenticated]
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
    createPlan,
    savePlan,
    addSession,
    removeSession,
    addSessionItem,
    removeSessionItem,
    loadTemplates,
    cloneTemplate,
    validateInput,
    validateSessionItem,
  };
}
