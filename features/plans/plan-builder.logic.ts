/**
 * Plan builder logic — nutrition and training plan creation/editing.
 * Pure functions, no Firebase dependencies.
 * Refs: D-111–D-114, FR-240–FR-248, BR-291–BR-296,
 *       AC-207, AC-208, AC-256, AC-264, AC-265,
 *       TC-275–TC-280
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
};

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
