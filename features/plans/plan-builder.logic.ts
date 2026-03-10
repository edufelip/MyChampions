/**
 * Plan builder logic — nutrition and training plan creation/editing,
 * plus pure food-search API response normalization helpers.
 * Pure functions, no Firebase dependencies.
 * Refs: D-111–D-114, FR-240–FR-248, BR-291–BR-296,
 *       AC-207, AC-208, AC-256, AC-264, AC-265,
 *       TC-275–TC-280, TC-281
 */

import type { PlanType } from './plan-change-request.logic';

export type { PlanType };

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_PLAN_NAME_LENGTH = 2;

// ─── Nutrition plan types ─────────────────────────────────────────────────────

export type NutritionMealItemInput = {
  name: string;
  quantity: string; // free-form e.g. "100g" or "1 cup"
  notes: string;
  calories?: number | null;
  carbs?: number | null;
  proteins?: number | null;
  fats?: number | null;
};

export type NutritionMealItem = NutritionMealItemInput & {
  id: string;
};

export type NutritionMealInput = {
  name: string;
};

export type NutritionMeal = NutritionMealInput & {
  id: string;
  items: NutritionMealItem[];
};

export type NutritionPlanInput = {
  name: string;
};

export type NutritionPlanValidationErrors = {
  name?: 'required' | 'too_short';
};

export type NutritionMealValidationErrors = {
  name?: 'required';
};

// ─── Training plan types ──────────────────────────────────────────────────────

export type TrainingSessionItemInput = {
  name: string;
  quantity: string; // optional, e.g. "3 sets x 10 reps"
  notes: string;
  ymoveId?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
};

export type TrainingSessionItem = TrainingSessionItemInput & {
  id: string;
};

export type TrainingSessionInput = {
  name: string;
  notes: string;
};

export type TrainingSession = TrainingSessionInput & {
  id: string;
  items: TrainingSessionItem[];
};

export type TrainingPlanInput = {
  name: string;
};

export type TrainingPlanValidationErrors = {
  name?: 'required' | 'too_short';
};

export type TrainingSessionItemValidationErrors = {
  name?: 'required';
};

// ─── Starter template types ───────────────────────────────────────────────────

export type StarterTemplate = {
  id: string;
  planType: PlanType;
  name: string;
  description?: string;
};

// ─── Starter template source helpers ─────────────────────────────────────────

/**
 * Derives a PlanType from a starter template ID using the canonical prefix convention.
 * Returns null if the prefix cannot be recognised.
 *
 * @example
 *   deriveStarterTemplatePlanType('starter_nutrition_abc') // 'nutrition'
 *   deriveStarterTemplatePlanType('starter_training_xyz')  // 'training'
 *   deriveStarterTemplatePlanType('my_plan')               // null
 *
 * Refs: D-114, BR-295
 */
export function deriveStarterTemplatePlanType(templateId: string): PlanType | null {
  if (templateId.startsWith('starter_nutrition_')) return 'nutrition';
  if (templateId.startsWith('starter_training_')) return 'training';
  return null;
}

/**
 * Coalesces a nullable description string from the SDK to undefined.
 * Ensures the StarterTemplate type contract (description?: string) is satisfied.
 * Refs: D-114
 */
export function coalesceTemplateDescription(
  description: string | null | undefined
): string | undefined {
  return description ?? undefined;
}

// ─── Error types ──────────────────────────────────────────────────────────────

export type PlanBuilderErrorReason =
  | 'validation'
  | 'not_found'
  | 'no_active_assignment'
  | 'quota_exceeded'
  | 'network'
  | 'configuration'
  | 'unknown';

// ─── Nutrition validation ─────────────────────────────────────────────────────

/**
 * Validates the nutrition plan input fields.
 * Returns an error object; empty object means valid.
 * Refs: BR-291, BR-292, TC-276
 */
export function validateNutritionPlanInput(
  input: NutritionPlanInput
): NutritionPlanValidationErrors {
  const errors: NutritionPlanValidationErrors = {};

  const name = input.name.trim();
  if (!name) {
    errors.name = 'required';
  } else if (name.length < MIN_PLAN_NAME_LENGTH) {
    errors.name = 'too_short';
  }

  return errors;
}

// ─── Training validation ──────────────────────────────────────────────────────

/**
 * Validates the training plan input fields.
 * Returns an error object; empty object means valid.
 * Refs: BR-293, TC-279
 */
export function validateTrainingPlanInput(
  input: TrainingPlanInput
): TrainingPlanValidationErrors {
  const errors: TrainingPlanValidationErrors = {};

  const name = input.name.trim();
  if (!name) {
    errors.name = 'required';
  } else if (name.length < MIN_PLAN_NAME_LENGTH) {
    errors.name = 'too_short';
  }

  return errors;
}

export function resolveTrainingDraftCreationInput(
  input?: TrainingPlanInput
): { input?: TrainingPlanInput; error?: 'validation' } {
  if (!input) return { error: 'validation' };
  const errors = validateTrainingPlanInput(input);
  if (Object.keys(errors).length > 0) return { error: 'validation' };
  return { input };
}

/**
 * Validates a single training session item input.
 * Name is required; quantity and notes are optional (BR-294).
 */
export function validateTrainingSessionItemInput(
  input: TrainingSessionItemInput
): TrainingSessionItemValidationErrors {
  const errors: TrainingSessionItemValidationErrors = {};

  if (!input.name.trim()) {
    errors.name = 'required';
  }

  return errors;
}

// ─── Nutrition totals calculation ─────────────────────────────────────────────

export type NutritionTotals = {
  calories: number;
  carbs: number;
  proteins: number;
  fats: number;
};

/**
 * Calculates totals from a list of meal items.
 * Refs: AC-207
 */
export function calculateTotalsFromItems(items: (NutritionMealItem | NutritionMealItemInput)[]): NutritionTotals {
  return items.reduce(
    (acc, item) => {
      const safeVal = (v: number | null | undefined) => {
        if (v == null || isNaN(v)) return 0;
        return v;
      };
      return {
        calories: Math.round((acc.calories + safeVal(item.calories)) * 10) / 10,
        carbs: Math.round((acc.carbs + safeVal(item.carbs)) * 10) / 10,
        proteins: Math.round((acc.proteins + safeVal(item.proteins)) * 10) / 10,
        fats: Math.round((acc.fats + safeVal(item.fats)) * 10) / 10,
      };
    },
    { calories: 0, carbs: 0, proteins: 0, fats: 0 }
  );
}

/**
 * Calculates totals across all meals in a plan.
 */
export function calculateTotalsFromMeals(meals: NutritionMeal[]): NutritionTotals {
  return meals.reduce(
    (acc, meal) => {
      const mealTotals = calculateTotalsFromItems(meal.items);
      return {
        calories: Math.round((acc.calories + mealTotals.calories) * 10) / 10,
        carbs: Math.round((acc.carbs + mealTotals.carbs) * 10) / 10,
        proteins: Math.round((acc.proteins + mealTotals.proteins) * 10) / 10,
        fats: Math.round((acc.fats + mealTotals.fats) * 10) / 10,
      };
    },
    { calories: 0, carbs: 0, proteins: 0, fats: 0 }
  );
}

/**
 * Sanitizes and parses raw input values for a nutrition meal item.
 * Trims strings and converts numeric inputs into valid numbers or null.
 * Specifically handles solitary decimal points ('.') and empty strings by returning null.
 */
export function sanitizeNutritionMealItemInput(input: {
  name: string;
  quantity?: string;
  notes?: string;
  calories?: string | number | null;
  carbs?: string | number | null;
  proteins?: string | number | null;
  fats?: string | number | null;
}): NutritionMealItemInput {
  const parse = (v: string | number | null | undefined): number | null => {
    if (v == null) return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const trimmed = v.trim();
    if (trimmed === '' || trimmed === '.') return null;
    const n = parseFloat(trimmed);
    return isNaN(n) ? null : n;
  };

  const name = input.name.trim();
  const quantity = (input.quantity || '').trim();
  const notes = (input.notes || '').trim();

  const c = parse(input.carbs);
  const p = parse(input.proteins);
  const f = parse(input.fats);
  let cal = parse(input.calories);

  // Auto-calculate calories if missing but macros are provided
  if (cal === null && (c !== null || p !== null || f !== null)) {
    cal = Math.round(((c ?? 0) * 4 + (p ?? 0) * 4 + (f ?? 0) * 9) * 10) / 10;
  }

  return {
    name,
    quantity,
    notes,
    calories: cal,
    carbs: c,
    proteins: p,
    fats: f,
  };
}

// ─── Starter template helpers ─────────────────────────────────────────────────

/**
 * Returns true if the given planId corresponds to a starter template id prefix.
 * Starter template ids are prefixed with "starter_".
 * Refs: BR-270, BR-295, FR-247
 */
export function isStarterTemplate(planId: string): boolean {
  return planId.startsWith('starter_');
}

// ─── Error normalization ──────────────────────────────────────────────────────

/**
 * Normalizes an unknown thrown value into a typed PlanBuilderErrorReason.
 * Follows the same pattern as normalizePlanChangeRequestError.
 */
export function normalizePlanBuilderError(error: unknown): PlanBuilderErrorReason {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? String((error as { code: unknown }).code) : null;
    const msg =
      'message' in error
        ? String((error as { message: unknown }).message).toLowerCase()
        : null;

    if (code === 'PLAN_NOT_FOUND' || msg?.includes('plan not found')) return 'not_found';
    if (
      code === 'NO_ACTIVE_ASSIGNMENT' ||
      msg?.includes('no active assignment')
    )
      return 'no_active_assignment';
    if (code === 'VALIDATION' || msg?.includes('validation')) return 'validation';
    if (code === 'quota' || code === 'QUOTA_EXCEEDED' || msg?.includes('quota') || msg?.includes('rate limit')) return 'quota_exceeded';
    if (code === 'NETWORK_ERROR' || msg?.includes('network')) return 'network';
    if (msg?.includes('endpoint') || msg?.includes('config')) return 'configuration';
  }
  return 'unknown';
}

// ─── food search response normalization ───────────────────────────────────────
// Raw types matching the upstream food-search provider response format.
// Refs: FR-243

export type RawFoodSearchServing = {
  calories?: string;
  carbohydrate?: string;
  protein?: string;
  fat?: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
};

export type RawFoodSearchFood = {
  food_id?: string;
  food_name?: string;
  servings?: {
    serving?: RawFoodSearchServing | RawFoodSearchServing[];
  };
};

export type FoodSearchResult = {
  id: string;
  name: string;
  caloriesPer100g: number;
  carbsPer100g: number;
  proteinsPer100g: number;
  fatsPer100g: number;
};

/**
 * Normalizes the provider `food` field which may be a single object or an
 * array when results > 1.
 * Returns an empty array for any non-object input.
 */
export function normalizeFoodArray(raw: unknown): RawFoodSearchFood[] {
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw)) return raw as RawFoodSearchFood[];
  return [raw as RawFoodSearchFood];
}

/**
 * Normalizes per-serving macro values to per-100g using metric_serving_amount.
 * Returns null when:
 *  - food_id or food_name are missing
 *  - no serving data is available
 *  - metric_serving_unit is not 'g' (cannot safely normalize to per-100g)
 *  - metric_serving_amount is 0 or unparseable
 * Refs: FR-243
 */
export function normalizeFoodSearchResult(raw: RawFoodSearchFood): FoodSearchResult | null {
  if (!raw.food_id || !raw.food_name) return null;

  const servingsField = raw.servings?.serving;
  if (!servingsField) return null;

  // serving may be single object or array; pick first entry
  const serving = Array.isArray(servingsField) ? servingsField[0] : servingsField;
  if (!serving) return null;

  const unit = serving.metric_serving_unit;
  if (unit !== 'g') return null; // cannot normalize non-gram servings to per-100g

  const servingGrams = parseFloat(serving.metric_serving_amount ?? '');
  if (!isFinite(servingGrams) || servingGrams <= 0) return null;

  const scaleFactor = 100 / servingGrams;

  const parse = (s: string | undefined): number => {
    const n = parseFloat(s ?? '0');
    return isFinite(n) && n >= 0 ? n : 0;
  };

  return {
    id: raw.food_id,
    name: raw.food_name,
    caloriesPer100g: Math.round(parse(serving.calories) * scaleFactor * 10) / 10,
    carbsPer100g: Math.round(parse(serving.carbohydrate) * scaleFactor * 10) / 10,
    proteinsPer100g: Math.round(parse(serving.protein) * scaleFactor * 10) / 10,
    fatsPer100g: Math.round(parse(serving.fat) * scaleFactor * 10) / 10,
  };
}
