/**
 * React hook for custom meal CRUD and recipe sharing operations.
 * Wraps custom-meal-source for UI consumption.
 * No Firebase/Data Connect concerns in screen components.
 */

import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

import {
  getMyCustomMeals,
  createCustomMeal,
  updateCustomMeal,
  deleteCustomMeal,
  createMealShareLink,
  previewSharedMeal,
  importSharedMeal,
} from './custom-meal-source';
import {
  validateCustomMealInput,
  validatePortionLogInput,
  calculatePortionNutrition,
  buildSharedMealSnapshot,
  normalizeMealActionError,
  type CustomMeal,
  type CustomMealInput,
  type CustomMealValidationErrors,
  type PortionLogInput,
  type PortionLogValidationErrors,
  type NutritionSnapshot,
  type SharedMealSnapshot,
  type MealActionErrorReason,
} from './custom-meal.logic';

// ─── State types ──────────────────────────────────────────────────────────────

export type CustomMealsLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; meals: CustomMeal[] };

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type UseCustomMealsResult = {
  state: CustomMealsLoadState;
  reload: () => void;
  validate: (input: CustomMealInput) => CustomMealValidationErrors;
  validatePortion: (input: PortionLogInput) => PortionLogValidationErrors;
  computePortion: (meal: CustomMeal, consumedGrams: number) => NutritionSnapshot;
  getShareSnapshot: (meal: CustomMeal) => SharedMealSnapshot;
  create: (input: CustomMealInput) => Promise<MealActionErrorReason | null>;
  update: (id: string, input: CustomMealInput) => Promise<MealActionErrorReason | null>;
  remove: (id: string) => Promise<MealActionErrorReason | null>;
  shareLink: (mealId: string) => Promise<{ shareToken: string; shareUrl: string } | MealActionErrorReason>;
  previewImport: (shareToken: string) => Promise<SharedMealSnapshot | MealActionErrorReason>;
  importMeal: (shareToken: string) => Promise<MealActionErrorReason | null>;
};

export function useCustomMeals(user: User | null): UseCustomMealsResult {
  const [state, setState] = useState<CustomMealsLoadState>({ kind: 'idle' });

  const load = useCallback(() => {
    if (!user) {
      setState({ kind: 'idle' });
      return;
    }

    setState({ kind: 'loading' });

    void getMyCustomMeals(user)
      .then((meals) => setState({ kind: 'ready', meals }))
      .catch((err: Error) => setState({ kind: 'error', message: err.message }));
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const validate = useCallback(
    (input: CustomMealInput) => validateCustomMealInput(input),
    []
  );

  const validatePortion = useCallback(
    (input: PortionLogInput) => validatePortionLogInput(input),
    []
  );

  const computePortion = useCallback(
    (meal: CustomMeal, consumedGrams: number): NutritionSnapshot =>
      calculatePortionNutrition(meal, consumedGrams),
    []
  );

  const getShareSnapshot = useCallback(
    (meal: CustomMeal): SharedMealSnapshot => buildSharedMealSnapshot(meal),
    []
  );

  const create = useCallback(
    async (input: CustomMealInput): Promise<MealActionErrorReason | null> => {
      if (!user) return 'unknown';

      const errors = validateCustomMealInput(input);
      if (Object.keys(errors).length > 0) return 'validation';

      try {
        await createCustomMeal(user, {
          name: input.name.trim(),
          totalGrams: parseFloat(input.totalGrams),
          calories: parseFloat(input.calories),
          carbs: parseFloat(input.carbs),
          proteins: parseFloat(input.proteins),
          fats: parseFloat(input.fats),
          ingredientCost: input.ingredientCost ? parseFloat(input.ingredientCost) : null,
        });
        load();
        return null;
      } catch (err) {
        return normalizeMealActionError(err);
      }
    },
    [user, load]
  );

  const update = useCallback(
    async (id: string, input: CustomMealInput): Promise<MealActionErrorReason | null> => {
      if (!user) return 'unknown';

      const errors = validateCustomMealInput(input);
      if (Object.keys(errors).length > 0) return 'validation';

      try {
        await updateCustomMeal(user, id, {
          name: input.name.trim(),
          totalGrams: parseFloat(input.totalGrams),
          calories: parseFloat(input.calories),
          carbs: parseFloat(input.carbs),
          proteins: parseFloat(input.proteins),
          fats: parseFloat(input.fats),
          ingredientCost: input.ingredientCost ? parseFloat(input.ingredientCost) : null,
        });
        load();
        return null;
      } catch (err) {
        return normalizeMealActionError(err);
      }
    },
    [user, load]
  );

  const remove = useCallback(
    async (id: string): Promise<MealActionErrorReason | null> => {
      if (!user) return 'unknown';

      try {
        await deleteCustomMeal(user, id);
        load();
        return null;
      } catch (err) {
        return normalizeMealActionError(err);
      }
    },
    [user, load]
  );

  const shareLink = useCallback(
    async (mealId: string): Promise<{ shareToken: string; shareUrl: string } | MealActionErrorReason> => {
      if (!user) return 'unknown';

      try {
        return await createMealShareLink(user, mealId);
      } catch (err) {
        return normalizeMealActionError(err);
      }
    },
    [user]
  );

  const previewImport = useCallback(
    async (shareToken: string): Promise<SharedMealSnapshot | MealActionErrorReason> => {
      if (!user) return 'unknown';

      try {
        return await previewSharedMeal(user, shareToken);
      } catch (err) {
        return normalizeMealActionError(err);
      }
    },
    [user]
  );

  const importMeal = useCallback(
    async (shareToken: string): Promise<MealActionErrorReason | null> => {
      if (!user) return 'unknown';

      try {
        await importSharedMeal(user, shareToken);
        load();
        return null;
      } catch (err) {
        return normalizeMealActionError(err);
      }
    },
    [user, load]
  );

  return {
    state,
    reload: load,
    validate,
    validatePortion,
    computePortion,
    getShareSnapshot,
    create,
    update,
    remove,
    shareLink,
    previewImport,
    importMeal,
  };
}
