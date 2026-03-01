/**
 * AI meal photo macronutrient analysis logic.
 * Pure functions, no Firebase or network dependencies.
 * Refs: BL-108, D-106–D-110, FR-229–FR-239
 * BR-286–BR-290, AC-513–AC-519, TC-271–TC-274
 */

import type { CustomMealInput } from './custom-meal.logic';

// ─── Types ───────────────────────────────────────────────────────────────────

export type MacroEstimateConfidence = 'high' | 'medium' | 'low';

export type MacroEstimate = {
  calories: number;
  carbs: number;
  proteins: number;
  fats: number;
  totalGrams: number;
  confidence: MacroEstimateConfidence;
};

export type PhotoAnalysisErrorReason =
  | 'unrecognizable_image'
  | 'quota_exceeded'
  | 'network'
  | 'invalid_response'
  | 'configuration'
  | 'unknown';

// Raw shape returned by Cloud Function — may be untrusted/malformed
export type RawAnalysisResponse = {
  calories?: unknown;
  carbs?: unknown;
  proteins?: unknown;
  fats?: unknown;
  totalGrams?: unknown;
  confidence?: unknown;
  error?: unknown;
};

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Returns true if the MacroEstimate has valid, non-negative numeric values.
 * All fields must be finite numbers ≥ 0; totalGrams must be > 0.
 * BR-286: result is advisory — validation guards against corrupt/negative AI output.
 */
export function isValidMacroEstimate(estimate: MacroEstimate): boolean {
  const { calories, carbs, proteins, fats, totalGrams } = estimate;
  return (
    Number.isFinite(calories) && calories >= 0 &&
    Number.isFinite(carbs) && carbs >= 0 &&
    Number.isFinite(proteins) && proteins >= 0 &&
    Number.isFinite(fats) && fats >= 0 &&
    Number.isFinite(totalGrams) && totalGrams > 0
  );
}

// ─── Response parsing ─────────────────────────────────────────────────────────

/**
 * Parses the raw Cloud Function response into a typed MacroEstimate.
 * Returns null if the response shape is invalid or contains sentinel error field.
 * Rounds all macro values to 1 decimal place for clean form display.
 */
export function parseMacroEstimateFromResponse(raw: RawAnalysisResponse): MacroEstimate | null {
  if (raw.error !== undefined) return null;

  const calories = toNonNegativeNumber(raw.calories);
  const carbs = toNonNegativeNumber(raw.carbs);
  const proteins = toNonNegativeNumber(raw.proteins);
  const fats = toNonNegativeNumber(raw.fats);
  const totalGrams = toStrictPositiveNumber(raw.totalGrams);
  const confidence = parseConfidence(raw.confidence);

  if (
    calories === null ||
    carbs === null ||
    proteins === null ||
    fats === null ||
    totalGrams === null
  ) {
    return null;
  }

  return {
    calories,
    carbs,
    proteins,
    fats,
    totalGrams,
    confidence,
  };
}

/** Accepts 0 and positive finite numbers; rejects negative, NaN, Infinity, non-numbers. */
function toNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return round1(value);
}

/** Accepts strictly positive finite numbers; rejects 0, negative, NaN, Infinity, non-numbers. */
function toStrictPositiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return round1(value);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function parseConfidence(value: unknown): MacroEstimateConfidence {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'low'; // default to most conservative when unknown
}

// ─── Form pre-fill ────────────────────────────────────────────────────────────

/**
 * Converts a MacroEstimate into CustomMealInput string fields ready for form pre-fill.
 * All values are stringified to 1 decimal place.
 * BR-286: user always reviews before saving.
 */
export function mapMacroEstimateToMealInput(estimate: MacroEstimate): Partial<CustomMealInput> {
  return {
    totalGrams: String(estimate.totalGrams),
    calories: String(estimate.calories),
    carbs: String(estimate.carbs),
    proteins: String(estimate.proteins),
    fats: String(estimate.fats),
  };
}

// ─── Error normalization ──────────────────────────────────────────────────────

/**
 * Maps any thrown error or raw response error field to a PhotoAnalysisErrorReason.
 * Used by the source layer to produce typed errors for the hook.
 */
export function normalizePhotoAnalysisError(error: unknown): PhotoAnalysisErrorReason {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? String((error as { code: unknown }).code) : null;
    const msg =
      'message' in error
        ? String((error as { message: unknown }).message).toLowerCase()
        : null;

    if (
      code === 'unrecognizable_image' ||
      msg?.includes('unrecognizable') ||
      msg?.includes('not a meal') ||
      msg?.includes('no meal')
    ) {
      return 'unrecognizable_image';
    }
    if (
      code === 'quota_exceeded' ||
      msg?.includes('quota') ||
      msg?.includes('rate limit') ||
      msg?.includes('too many')
    ) {
      return 'quota_exceeded';
    }
    if (
      code === 'invalid_response' ||
      msg?.includes('invalid response') ||
      msg?.includes('parse')
    ) {
      return 'invalid_response';
    }
    if (
      code === 'configuration' ||
      msg?.includes('endpoint') ||
      msg?.includes('config') ||
      msg?.includes('not configured')
    ) {
      return 'configuration';
    }
    if (
      msg?.includes('network') ||
      msg?.includes('fetch') ||
      msg?.includes('timeout') ||
      msg?.includes('connect')
    ) {
      return 'network';
    }
  }
  return 'unknown';
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Returns the system prompt sent to GPT-4o Vision via the Cloud Function.
 * Keeping this pure and testable allows changing the prompt without touching
 * the source/network layer.
 */
export function buildAnalysisSystemPrompt(): string {
  return (
    'You are a professional nutritionist. ' +
    'Given a photo of a meal, estimate the macronutrients with high accuracy. ' +
    'Respond ONLY with valid JSON matching this exact shape: ' +
    '{ "calories": number, "carbs": number, "proteins": number, "fats": number, ' +
    '"totalGrams": number, "confidence": "high" | "medium" | "low" }. ' +
    'All values must be non-negative numbers. totalGrams must be positive. ' +
    'If the image does not contain a recognizable meal, respond: { "error": "unrecognizable_image" }.'
  );
}

/**
 * Returns the user-facing prompt text paired with the image attachment.
 */
export function buildAnalysisUserPrompt(): string {
  return 'Analyze this meal photo and estimate its macronutrients.';
}
