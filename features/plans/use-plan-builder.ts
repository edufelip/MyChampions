/**
 * React hooks for plan builder operations — nutrition and training.
 * Store-backed adapters over the centralized Zustand plans store.
 */

import { useCallback, useEffect, useLayoutEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  markNutritionBuilderMutating,
  markTrainingBuilderMutating,
  type FoodSearchState,
  type NutritionBuilderState,
  type TrainingBuilderState,
} from './plan-builder-state';
import { usePlansStore } from './plans-store';
import type { TrainingPlanDetail, FoodSearchResult } from './plan-builder-source';
import type {
  NutritionPlanInput,
  NutritionMealInput,
  NutritionMealItemInput,
  NutritionPlanValidationErrors,
  NutritionPlanCreationMode,
  TrainingPlanInput,
  TrainingSession,
  TrainingSessionInput,
  TrainingSessionItemInput,
  TrainingPlanValidationErrors,
  TrainingSessionItemValidationErrors,
  PlanBuilderErrorReason,
  TrainingPlanCreationMode,
} from './plan-builder.logic';
import type { NetworkStatus } from '../offline/offline.logic';

export type { FoodSearchResult, FoodSearchState, NutritionBuilderState, TrainingBuilderState };
export { markNutritionBuilderMutating, markTrainingBuilderMutating };

export type UseNutritionPlanBuilderResult = {
  state: NutritionBuilderState;
  foodSearchState: FoodSearchState;
  clearFoodSearch: () => void;
  loadPlan: (planId: string, networkStatus?: NetworkStatus) => void;
  initNewPlan: () => void;
  createPlan: (
    input: NutritionPlanInput,
    mode?: NutritionPlanCreationMode,
  ) => Promise<{ id: string } | { error: PlanBuilderErrorReason }>;
  savePlan: (
    planId: string,
    input: NutritionPlanInput,
    publish?: boolean,
  ) => Promise<PlanBuilderErrorReason | null>;
  addMeal: (
    planId: string,
    meal: NutritionMealInput,
    planInput?: NutritionPlanInput,
    mode?: NutritionPlanCreationMode,
  ) => Promise<{ planId: string; error: PlanBuilderErrorReason | null }>;
  removeMeal: (planId: string, mealId: string) => Promise<PlanBuilderErrorReason | null>;
  reorderMeals: (planId: string, mealIds: string[]) => Promise<PlanBuilderErrorReason | null>;
  addItem: (
    planId: string,
    mealId: string,
    item: NutritionMealItemInput,
    planInput?: NutritionPlanInput,
    mode?: NutritionPlanCreationMode,
  ) => Promise<{ planId: string; error: PlanBuilderErrorReason | null }>;
  removeItem: (
    planId: string,
    mealId: string,
    itemId: string,
  ) => Promise<PlanBuilderErrorReason | null>;
  reorderItems: (
    planId: string,
    mealId: string,
    itemIds: string[],
  ) => Promise<PlanBuilderErrorReason | null>;
  deletePlan: (planId: string) => Promise<PlanBuilderErrorReason | null>;
  searchFoods: (query: string) => void;
  validateInput: (input: NutritionPlanInput) => NutritionPlanValidationErrors;
};

export function useNutritionPlanBuilder(
  isAuthenticated: boolean,
  scopeKey = 'default',
): UseNutritionPlanBuilderResult {
  const {
    syncAuthContext,
    state,
    foodSearchState,
    clearFoodSearch,
    resetNutritionBuilder,
    loadPlanFromStore,
    initNewPlan,
    createPlanFromStore,
    savePlanFromStore,
    addMealFromStore,
    removeMealFromStore,
    reorderMealsFromStore,
    addItemFromStore,
    removeItemFromStore,
    reorderItemsFromStore,
    deletePlanFromStore,
    runFoodSearch,
    validateInput,
  } = usePlansStore(
    useShallow((s) => ({
      syncAuthContext: s.syncAuthContext,
      state: s.nutritionBuilderState,
      foodSearchState: s.foodSearchState,
      clearFoodSearch: s.clearFoodSearch,
      resetNutritionBuilder: s.resetNutritionBuilder,
      loadPlanFromStore: s.loadNutritionPlan,
      initNewPlan: s.initNewNutritionPlan,
      createPlanFromStore: s.createNutritionPlanAction,
      savePlanFromStore: s.saveNutritionPlanAction,
      addMealFromStore: s.addNutritionMealAction,
      removeMealFromStore: s.removeNutritionMealAction,
      reorderMealsFromStore: s.reorderNutritionMealsAction,
      addItemFromStore: s.addNutritionItemAction,
      removeItemFromStore: s.removeNutritionItemAction,
      reorderItemsFromStore: s.reorderNutritionItemsAction,
      deletePlanFromStore: s.deleteNutritionPlanAction,
      runFoodSearch: s.runFoodSearch,
      validateInput: s.validateNutritionInput,
    })),
  );

  useEffect(() => {
    syncAuthContext(isAuthenticated);
  }, [isAuthenticated, syncAuthContext]);

  useLayoutEffect(() => {
    resetNutritionBuilder();
    clearFoodSearch();
  }, [scopeKey, resetNutritionBuilder, clearFoodSearch]);

  const loadPlan = useCallback(
    (planId: string, networkStatus?: NetworkStatus) => {
      void loadPlanFromStore(isAuthenticated, planId, networkStatus);
    },
    [isAuthenticated, loadPlanFromStore],
  );

  const createPlan = useCallback(
    (input: NutritionPlanInput, mode?: NutritionPlanCreationMode) =>
      createPlanFromStore(isAuthenticated, input, mode),
    [createPlanFromStore, isAuthenticated],
  );

  const savePlan = useCallback(
    (planId: string, input: NutritionPlanInput, publish?: boolean) =>
      savePlanFromStore(isAuthenticated, planId, input, publish),
    [isAuthenticated, savePlanFromStore],
  );

  const addMeal = useCallback(
    (
      planId: string,
      meal: NutritionMealInput,
      planInput?: NutritionPlanInput,
      mode?: NutritionPlanCreationMode,
    ) => addMealFromStore(isAuthenticated, planId, meal, planInput, mode),
    [addMealFromStore, isAuthenticated],
  );

  const removeMeal = useCallback(
    (planId: string, mealId: string) => removeMealFromStore(isAuthenticated, planId, mealId),
    [isAuthenticated, removeMealFromStore],
  );

  const reorderMeals = useCallback(
    (planId: string, mealIds: string[]) => reorderMealsFromStore(isAuthenticated, planId, mealIds),
    [isAuthenticated, reorderMealsFromStore],
  );

  const addItem = useCallback(
    (
      planId: string,
      mealId: string,
      item: NutritionMealItemInput,
      planInput?: NutritionPlanInput,
      mode?: NutritionPlanCreationMode,
    ) => addItemFromStore(isAuthenticated, planId, mealId, item, planInput, mode),
    [addItemFromStore, isAuthenticated],
  );

  const removeItem = useCallback(
    (planId: string, mealId: string, itemId: string) =>
      removeItemFromStore(isAuthenticated, planId, mealId, itemId),
    [isAuthenticated, removeItemFromStore],
  );

  const reorderItems = useCallback(
    (planId: string, mealId: string, itemIds: string[]) =>
      reorderItemsFromStore(isAuthenticated, planId, mealId, itemIds),
    [isAuthenticated, reorderItemsFromStore],
  );

  const deletePlan = useCallback(
    (planId: string) => deletePlanFromStore(isAuthenticated, planId),
    [deletePlanFromStore, isAuthenticated],
  );

  const searchFoods = useCallback(
    (query: string) => {
      runFoodSearch(isAuthenticated, query);
    },
    [isAuthenticated, runFoodSearch],
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
    searchFoods,
    validateInput,
  };
}

export type UseTrainingPlanBuilderResult = {
  state: TrainingBuilderState;
  loadPlan: (planId: string) => void;
  initNewPlan: () => void;
  createPlan: (
    input: TrainingPlanInput,
    mode?: TrainingPlanCreationMode,
  ) => Promise<{ id: string } | { error: PlanBuilderErrorReason }>;
  savePlan: (
    planId: string,
    input: TrainingPlanInput,
    publish?: boolean,
  ) => Promise<PlanBuilderErrorReason | null>;
  savePlanWithSessions: (
    planId: string,
    input: TrainingPlanInput,
    sessions: TrainingSession[],
    publish?: boolean,
    mode?: TrainingPlanCreationMode,
  ) => Promise<{ id: string; plan: TrainingPlanDetail } | { error: PlanBuilderErrorReason }>;
  addSession: (
    planId: string,
    session: TrainingSessionInput,
    planInput?: TrainingPlanInput,
  ) => Promise<{ planId: string; error: PlanBuilderErrorReason | null }>;
  removeSession: (planId: string, sessionId: string) => Promise<PlanBuilderErrorReason | null>;
  reorderSessions: (planId: string, sessionIds: string[]) => Promise<PlanBuilderErrorReason | null>;
  addSessionItem: (
    sessionId: string,
    item: TrainingSessionItemInput,
  ) => Promise<PlanBuilderErrorReason | null>;
  removeSessionItem: (sessionId: string, itemId: string) => Promise<PlanBuilderErrorReason | null>;
  reorderSessionItems: (
    sessionId: string,
    itemIds: string[],
  ) => Promise<PlanBuilderErrorReason | null>;
  deletePlan: (planId: string) => Promise<PlanBuilderErrorReason | null>;
  validateInput: (input: TrainingPlanInput) => TrainingPlanValidationErrors;
  validateSessionItem: (item: TrainingSessionItemInput) => TrainingSessionItemValidationErrors;
};

export function useTrainingPlanBuilder(
  isAuthenticated: boolean,
  scopeKey = 'default',
): UseTrainingPlanBuilderResult {
  const {
    syncAuthContext,
    state,
    resetTrainingBuilder,
    loadPlanFromStore,
    initNewPlan,
    createPlanFromStore,
    savePlanFromStore,
    savePlanWithSessionsFromStore,
    addSessionFromStore,
    removeSessionFromStore,
    reorderSessionsFromStore,
    addSessionItemFromStore,
    removeSessionItemFromStore,
    reorderSessionItemsFromStore,
    deletePlanFromStore,
    validateInput,
    validateSessionItem,
  } = usePlansStore(
    useShallow((s) => ({
      syncAuthContext: s.syncAuthContext,
      state: s.trainingBuilderState,
      resetTrainingBuilder: s.resetTrainingBuilder,
      loadPlanFromStore: s.loadTrainingPlan,
      initNewPlan: s.initNewTrainingPlan,
      createPlanFromStore: s.createTrainingPlanAction,
      savePlanFromStore: s.saveTrainingPlanAction,
      savePlanWithSessionsFromStore: s.saveTrainingPlanWithSessionsAction,
      addSessionFromStore: s.addTrainingSessionAction,
      removeSessionFromStore: s.removeTrainingSessionAction,
      reorderSessionsFromStore: s.reorderTrainingSessionsAction,
      addSessionItemFromStore: s.addTrainingSessionItemAction,
      removeSessionItemFromStore: s.removeTrainingSessionItemAction,
      reorderSessionItemsFromStore: s.reorderTrainingSessionItemsAction,
      deletePlanFromStore: s.deleteTrainingPlanAction,
      validateInput: s.validateTrainingInput,
      validateSessionItem: s.validateTrainingSessionItem,
    })),
  );

  useEffect(() => {
    syncAuthContext(isAuthenticated);
  }, [isAuthenticated, syncAuthContext]);

  useLayoutEffect(() => {
    resetTrainingBuilder();
  }, [scopeKey, resetTrainingBuilder]);

  const loadPlan = useCallback(
    (planId: string) => {
      void loadPlanFromStore(isAuthenticated, planId);
    },
    [isAuthenticated, loadPlanFromStore],
  );

  const createPlan = useCallback(
    (input: TrainingPlanInput, mode?: TrainingPlanCreationMode) =>
      createPlanFromStore(isAuthenticated, input, mode),
    [createPlanFromStore, isAuthenticated],
  );

  const savePlan = useCallback(
    (planId: string, input: TrainingPlanInput, publish?: boolean) =>
      savePlanFromStore(isAuthenticated, planId, input, publish),
    [isAuthenticated, savePlanFromStore],
  );

  const savePlanWithSessions = useCallback(
    (
      planId: string,
      input: TrainingPlanInput,
      sessions: TrainingSession[],
      publish?: boolean,
      mode?: TrainingPlanCreationMode,
    ) => savePlanWithSessionsFromStore(isAuthenticated, planId, input, sessions, publish, mode),
    [isAuthenticated, savePlanWithSessionsFromStore],
  );

  const addSession = useCallback(
    (planId: string, session: TrainingSessionInput, planInput?: TrainingPlanInput) =>
      addSessionFromStore(isAuthenticated, planId, session, planInput),
    [addSessionFromStore, isAuthenticated],
  );

  const removeSession = useCallback(
    (planId: string, sessionId: string) =>
      removeSessionFromStore(isAuthenticated, planId, sessionId),
    [isAuthenticated, removeSessionFromStore],
  );

  const reorderSessions = useCallback(
    (planId: string, sessionIds: string[]) =>
      reorderSessionsFromStore(isAuthenticated, planId, sessionIds),
    [isAuthenticated, reorderSessionsFromStore],
  );

  const addSessionItem = useCallback(
    (sessionId: string, item: TrainingSessionItemInput) =>
      addSessionItemFromStore(isAuthenticated, sessionId, item),
    [addSessionItemFromStore, isAuthenticated],
  );

  const removeSessionItem = useCallback(
    (sessionId: string, itemId: string) =>
      removeSessionItemFromStore(isAuthenticated, sessionId, itemId),
    [isAuthenticated, removeSessionItemFromStore],
  );

  const reorderSessionItems = useCallback(
    (sessionId: string, itemIds: string[]) =>
      reorderSessionItemsFromStore(isAuthenticated, sessionId, itemIds),
    [isAuthenticated, reorderSessionItemsFromStore],
  );

  const deletePlan = useCallback(
    (planId: string) => deletePlanFromStore(isAuthenticated, planId),
    [deletePlanFromStore, isAuthenticated],
  );

  return {
    state,
    loadPlan,
    initNewPlan,
    createPlan,
    savePlan,
    savePlanWithSessions,
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
