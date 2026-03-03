/**
 * Plan builder logic — nutrition and training plan creation/editing,
 * plus pure fatsecret API response normalization helpers.
 * Pure functions, no Firebase dependencies.
 * Refs: D-111–D-114, D-127, FR-240–FR-248, BR-291–BR-296,
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
};

export type NutritionMealItem = NutritionMealItemInput & {
  id: string;
};

export type NutritionPlanInput = {
  name: string;
  caloriesTarget: string; // raw string from text field
  carbsTarget: string;
  proteinsTarget: string;
  fatsTarget: string;
};

export type NutritionPlanValidationErrors = {
  name?: 'required' | 'too_short';
  caloriesTarget?: 'non_negative';
  carbsTarget?: 'non_negative';
  proteinsTarget?: 'non_negative';
  fatsTarget?: 'non_negative';
};

// ─── Training plan types ──────────────────────────────────────────────────────

export type TrainingSessionItemInput = {
  name: string;
  quantity: string; // optional, e.g. "3 sets x 10 reps"
  notes: string;
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

  const caloriesNum = parseFloat(input.caloriesTarget);
  if (input.caloriesTarget.trim() !== '' && (isNaN(caloriesNum) || caloriesNum < 0)) {
    errors.caloriesTarget = 'non_negative';
  }

  const carbsNum = parseFloat(input.carbsTarget);
  if (input.carbsTarget.trim() !== '' && (isNaN(carbsNum) || carbsNum < 0)) {
    errors.carbsTarget = 'non_negative';
  }

  const proteinsNum = parseFloat(input.proteinsTarget);
  if (input.proteinsTarget.trim() !== '' && (isNaN(proteinsNum) || proteinsNum < 0)) {
    errors.proteinsTarget = 'non_negative';
  }

  const fatsNum = parseFloat(input.fatsTarget);
  if (input.fatsTarget.trim() !== '' && (isNaN(fatsNum) || fatsNum < 0)) {
    errors.fatsTarget = 'non_negative';
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
 * Calculates parsed numeric totals from raw string inputs.
 * Returns 0 for any field that is empty or unparseable.
 * Refs: BR-210, FR-241
 */
export function calculateNutritionTotals(input: NutritionPlanInput): NutritionTotals {
  const parse = (raw: string): number => {
    const n = parseFloat(raw);
    return isNaN(n) || n < 0 ? 0 : n;
  };

  return {
    calories: parse(input.caloriesTarget),
    carbs: parse(input.carbsTarget),
    proteins: parse(input.proteinsTarget),
    fats: parse(input.fatsTarget),
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
    if (code === 'NETWORK_ERROR' || msg?.includes('network')) return 'network';
    if (msg?.includes('endpoint') || msg?.includes('config')) return 'configuration';
  }
  return 'unknown';
}

// ─── fatsecret response normalization ─────────────────────────────────────────
// Raw types matching the fatsecret Platform API v2 JSON response.
// Refs: D-127, FR-243

export type RawFatsecretServing = {
  calories?: string;
  carbohydrate?: string;
  protein?: string;
  fat?: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
};

export type RawFatsecretFood = {
  food_id?: string;
  food_name?: string;
  servings?: {
    serving?: RawFatsecretServing | RawFatsecretServing[];
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
 * Normalizes the fatsecret `food` field which may be a single object or an
 * array when results > 1.
 * Returns an empty array for any non-object input.
 * Refs: D-127
 */
export function normalizeFoodArray(raw: unknown): RawFatsecretFood[] {
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw)) return raw as RawFatsecretFood[];
  return [raw as RawFatsecretFood];
}

/**
 * Normalizes per-serving macro values to per-100g using metric_serving_amount.
 * Returns null when:
 *  - food_id or food_name are missing
 *  - no serving data is available
 *  - metric_serving_unit is not 'g' (cannot safely normalize to per-100g)
 *  - metric_serving_amount is 0 or unparseable
 * Refs: D-127, FR-243
 */
export function normalizeFoodSearchResult(raw: RawFatsecretFood): FoodSearchResult | null {
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
