/**
 * AI meal photo macronutrient analysis logic.
 * Pure functions, no provider or network dependencies.
 * Refs: BL-108, D-106–D-110, FR-229–FR-239
 * BR-286–BR-290, AC-513–AC-519, TC-271–TC-274
 */

import type { CustomMealInput } from './custom-meal.logic';
import { normalizePhotoAnalysisError, type PhotoAnalysisErrorReason } from './photo-analysis-error';

export {
  mapPhotoAnalysisWireCode,
  normalizePhotoAnalysisError,
  type PhotoAnalysisErrorReason,
} from './photo-analysis-error';

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

// Raw shape returned by the server analyzer endpoint; may be untrusted/malformed.
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
    Number.isFinite(calories) &&
    calories >= 0 &&
    Number.isFinite(carbs) &&
    carbs >= 0 &&
    Number.isFinite(proteins) &&
    proteins >= 0 &&
    Number.isFinite(fats) &&
    fats >= 0 &&
    Number.isFinite(totalGrams) &&
    totalGrams > 0
  );
}

// ─── Response parsing ─────────────────────────────────────────────────────────

/**
 * Parses the raw server analyzer response into a typed MacroEstimate.
 * Returns null if the response shape is invalid or contains sentinel error field.
 * Rounds all macro values to 1 decimal place for clean form display.
 */
export function parseMacroEstimateFromResponse(raw: unknown): MacroEstimate | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  if (Object.prototype.hasOwnProperty.call(raw, 'error')) return null;

  const response = raw as RawAnalysisResponse;

  const calories = toNonNegativeNumber(response.calories);
  const carbs = toNonNegativeNumber(response.carbs);
  const proteins = toNonNegativeNumber(response.proteins);
  const fats = toNonNegativeNumber(response.fats);
  const totalGrams = toStrictPositiveNumber(response.totalGrams);
  const confidence = parseConfidence(response.confidence);

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
