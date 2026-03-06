/**
 * React hook for custom meal CRUD and recipe sharing operations.
 * Wraps custom-meal-source for UI consumption.
 * No Firebase/Data Connect concerns in screen components.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  getMyCustomMeals,
  createCustomMeal,
  updateCustomMeal,
  deleteCustomMeal,
  createMealShareLink,
  previewSharedMeal,
  importSharedMeal,
  logPortionFromSource,
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
  create: (
    input: CustomMealInput,
    options?: { imageUrl?: string | null }
  ) => Promise<MealActionErrorReason | null>;
  update: (
    id: string,
    input: CustomMealInput,
    options?: { imageUrl?: string | null }
  ) => Promise<MealActionErrorReason | null>;
  remove: (id: string) => Promise<MealActionErrorReason | null>;
  shareLink: (mealId: string) => Promise<{ shareLinkId: string } | MealActionErrorReason>;
  previewImport: (shareToken: string) => Promise<SharedMealSnapshot | MealActionErrorReason>;
  importMeal: (shareToken: string) => Promise<MealActionErrorReason | null>;
  logPortion: (mealId: string, grams: number) => Promise<MealActionErrorReason | null>;
};

export function useCustomMeals(isAuthenticated: boolean): UseCustomMealsResult {
  const [state, setState] = useState<CustomMealsLoadState>({ kind: 'idle' });

  const load = useCallback(() => {
    if (!isAuthenticated) {
      setState({ kind: 'idle' });
      return;
    }

    setState({ kind: 'loading' });

    void getMyCustomMeals()
      .then((meals) => setState({ kind: 'ready', meals }))
      .catch((err: Error) => setState({ kind: 'error', message: err.message }));
  }, [isAuthenticated]);

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
    async (
      input: CustomMealInput,
      options?: { imageUrl?: string | null }
    ): Promise<MealActionErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      const errors = validateCustomMealInput(input);
      if (Object.keys(errors).length > 0) return 'validation';

      try {
        await createCustomMeal({
          name: input.name.trim(),
          totalGrams: parseFloat(input.totalGrams),
          calories: parseFloat(input.calories),
          carbs: parseFloat(input.carbs),
          proteins: parseFloat(input.proteins),
          fats: parseFloat(input.fats),
          ingredientCost: input.ingredientCost ? parseFloat(input.ingredientCost) : null,
          imageUrl: options?.imageUrl ?? null,
        });
        load();
        return null;
      } catch (err) {
        return normalizeMealActionError(err);
      }
    },
    [isAuthenticated, load]
  );

  const update = useCallback(
    async (
      id: string,
      input: CustomMealInput,
      options?: { imageUrl?: string | null }
    ): Promise<MealActionErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      const errors = validateCustomMealInput(input);
      if (Object.keys(errors).length > 0) return 'validation';

      try {
        let resolvedImageUrl = options?.imageUrl;

        if (resolvedImageUrl === undefined) {
          if (state.kind === 'ready') {
            resolvedImageUrl = state.meals.find((meal) => meal.id === id)?.imageUrl ?? null;
          } else {
            const meals = await getMyCustomMeals();
            resolvedImageUrl = meals.find((meal) => meal.id === id)?.imageUrl ?? null;
          }
        }

        await updateCustomMeal(id, {
          name: input.name.trim(),
          totalGrams: parseFloat(input.totalGrams),
          calories: parseFloat(input.calories),
          carbs: parseFloat(input.carbs),
          proteins: parseFloat(input.proteins),
          fats: parseFloat(input.fats),
          ingredientCost: input.ingredientCost ? parseFloat(input.ingredientCost) : null,
          imageUrl: resolvedImageUrl,
        });
        load();
        return null;
      } catch (err) {
        return normalizeMealActionError(err);
      }
    },
    [isAuthenticated, load, state]
  );

  const remove = useCallback(
    async (id: string): Promise<MealActionErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      try {
        await deleteCustomMeal(id);
        load();
        return null;
      } catch (err) {
        return normalizeMealActionError(err);
      }
    },
    [isAuthenticated, load]
  );

  const shareLink = useCallback(
    async (mealId: string): Promise<{ shareLinkId: string } | MealActionErrorReason> => {
      if (!isAuthenticated) return 'unknown';

      try {
        return await createMealShareLink(mealId);
      } catch (err) {
        return normalizeMealActionError(err);
      }
    },
    [isAuthenticated]
  );

  const previewImport = useCallback(
    async (shareToken: string): Promise<SharedMealSnapshot | MealActionErrorReason> => {
      if (!isAuthenticated) return 'unknown';

      try {
        return await previewSharedMeal(shareToken);
      } catch (err) {
        return normalizeMealActionError(err);
      }
    },
    [isAuthenticated]
  );

  const importMeal = useCallback(
    async (shareToken: string): Promise<MealActionErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      try {
        await importSharedMeal(shareToken);
        load();
        return null;
      } catch (err) {
        return normalizeMealActionError(err);
      }
    },
    [isAuthenticated, load]
  );

  const logPortion = useCallback(
    async (mealId: string, grams: number): Promise<MealActionErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      try {
        await logPortionFromSource(mealId, grams);
        return null;
      } catch (err) {
        return normalizeMealActionError(err);
      }
    },
    [isAuthenticated]
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
    logPortion,
  };
}
