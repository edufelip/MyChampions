/**
 * Custom meal and portion logging logic.
 * Pure functions, no Firebase dependencies.
 * Refs: D-017, D-021, D-027, D-029, FR-137–FR-162
 * BR-301–BR-327
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type CustomMeal = {
  id: string; // UUIDv7
  name: string;
  totalGrams: number;
  calories: number;
  carbs: number;
  proteins: number;
  fats: number;
  ingredientCost: number | null;
  imageUrl: string | null;
  ownerUid: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomMealInput = {
  name: string;
  totalGrams: string; // string so form fields work directly
  calories: string;
  carbs: string;
  proteins: string;
  fats: string;
  ingredientCost?: string;
};

export type CustomMealValidationErrors = {
  name?: 'required';
  totalGrams?: 'required' | 'must_be_positive';
  calories?: 'required' | 'must_be_non_negative';
  carbs?: 'required' | 'must_be_non_negative';
  proteins?: 'required' | 'must_be_non_negative';
  fats?: 'required' | 'must_be_non_negative';
  ingredientCost?: 'must_be_non_negative';
};

export type PortionLogInput = {
  consumedGrams: string; // string so form field works directly
};

export type PortionLogValidationErrors = {
  consumedGrams?: 'required' | 'must_be_positive';
};

export type NutritionSnapshot = {
  calories: number;
  carbs: number;
  proteins: number;
  fats: number;
};

export type PortionLog = {
  id: string;
  mealId: string;
  consumedGrams: number;
  snapshot: NutritionSnapshot; // stored at log time — immutable
  loggedAt: string;
};

/** Share link payload excludes ingredient cost (BR-322, D-023) */
export type SharedMealSnapshot = {
  name: string;
  totalGrams: number;
  calories: number;
  carbs: number;
  proteins: number;
  fats: number;
};

export type MealActionErrorReason =
  | 'not_found'
  | 'validation'
  | 'share_rate_limited'
  | 'invalid_share_token'
  | 'already_imported'
  | 'network'
  | 'configuration'
  | 'unknown';

export type ImageUploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; progressPercent: number }
  | { kind: 'failed'; reason: string }
  | { kind: 'done'; url: string };

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateCustomMealInput(input: CustomMealInput): CustomMealValidationErrors {
  const errors: CustomMealValidationErrors = {};

  if (!input.name.trim()) {
    errors.name = 'required';
  }

  const grams = parseFloat(input.totalGrams);
  if (!input.totalGrams.trim()) {
    errors.totalGrams = 'required';
  } else if (isNaN(grams) || grams <= 0) {
    errors.totalGrams = 'must_be_positive';
  }

  const calories = parseFloat(input.calories);
  if (!input.calories.trim()) {
    errors.calories = 'required';
  } else if (isNaN(calories) || calories < 0) {
    errors.calories = 'must_be_non_negative';
  }

  const carbs = parseFloat(input.carbs);
  if (!input.carbs.trim()) {
    errors.carbs = 'required';
  } else if (isNaN(carbs) || carbs < 0) {
    errors.carbs = 'must_be_non_negative';
  }

  const proteins = parseFloat(input.proteins);
  if (!input.proteins.trim()) {
    errors.proteins = 'required';
  } else if (isNaN(proteins) || proteins < 0) {
    errors.proteins = 'must_be_non_negative';
  }

  const fats = parseFloat(input.fats);
  if (!input.fats.trim()) {
    errors.fats = 'required';
  } else if (isNaN(fats) || fats < 0) {
    errors.fats = 'must_be_non_negative';
  }

  if (input.ingredientCost !== undefined && input.ingredientCost.trim()) {
    const cost = parseFloat(input.ingredientCost);
    if (isNaN(cost) || cost < 0) {
      errors.ingredientCost = 'must_be_non_negative';
    }
  }

  return errors;
}

export function validatePortionLogInput(input: PortionLogInput): PortionLogValidationErrors {
  const errors: PortionLogValidationErrors = {};
  if (!input.consumedGrams.trim()) {
    errors.consumedGrams = 'required';
  } else {
    const grams = parseFloat(input.consumedGrams);
    if (isNaN(grams) || grams <= 0) {
      errors.consumedGrams = 'must_be_positive';
    }
  }
  return errors;
}

// ─── Portion calculation ──────────────────────────────────────────────────────

/**
 * Calculates proportional nutrition for a portion.
 * consumed = (consumedGrams / mealTotalGrams) * mealTotal
 * consumedGrams CAN exceed mealTotalGrams (BR-306).
 */
export function calculatePortionNutrition(
  meal: Pick<CustomMeal, 'totalGrams' | 'calories' | 'carbs' | 'proteins' | 'fats'>,
  consumedGrams: number
): NutritionSnapshot {
  const ratio = consumedGrams / meal.totalGrams;
  return {
    calories: round2(meal.calories * ratio),
    carbs: round2(meal.carbs * ratio),
    proteins: round2(meal.proteins * ratio),
    fats: round2(meal.fats * ratio),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Share snapshot ───────────────────────────────────────────────────────────

/** Extracts the immutable share snapshot, excluding ingredient cost (D-023) */
export function buildSharedMealSnapshot(meal: CustomMeal): SharedMealSnapshot {
  return {
    name: meal.name,
    totalGrams: meal.totalGrams,
    calories: meal.calories,
    carbs: meal.carbs,
    proteins: meal.proteins,
    fats: meal.fats,
  };
}

// ─── Error normalization ──────────────────────────────────────────────────────

export function normalizeMealActionError(error: unknown): MealActionErrorReason {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? String((error as { code: unknown }).code) : null;
    const msg = 'message' in error ? String((error as { message: unknown }).message).toLowerCase() : null;

    if (code === 'NOT_FOUND' || msg?.includes('not found')) return 'not_found';
    if (code === 'VALIDATION' || msg?.includes('validation')) return 'validation';
    if (code === 'RATE_LIMITED' || msg?.includes('rate limit') || msg?.includes('too many')) return 'share_rate_limited';
    if (code === 'INVALID_TOKEN' || msg?.includes('invalid token') || msg?.includes('invalid share')) return 'invalid_share_token';
    if (code === 'ALREADY_IMPORTED' || msg?.includes('already imported') || msg?.includes('already saved')) return 'already_imported';
    if (code === 'NETWORK_ERROR' || msg?.includes('network')) return 'network';
    if (msg?.includes('endpoint') || msg?.includes('config')) return 'configuration';
  }
  return 'unknown';
}
