import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidMacroEstimate,
  parseMacroEstimateFromResponse,
  mapMacroEstimateToMealInput,
  normalizePhotoAnalysisError,
  type MacroEstimate,
  type RawAnalysisResponse,
} from './meal-photo-analysis.logic';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const validEstimate: MacroEstimate = {
  calories: 330,
  carbs: 10,
  proteins: 25,
  fats: 8,
  totalGrams: 200,
  confidence: 'high',
};

const validRaw: RawAnalysisResponse = {
  calories: 330,
  carbs: 10,
  proteins: 25,
  fats: 8,
  totalGrams: 200,
  confidence: 'high',
};

// ─── isValidMacroEstimate ─────────────────────────────────────────────────────

test('isValidMacroEstimate returns true for a fully valid estimate', () => {
  assert.equal(isValidMacroEstimate(validEstimate), true);
});

test('isValidMacroEstimate returns true when calories are zero', () => {
  assert.equal(isValidMacroEstimate({ ...validEstimate, calories: 0 }), true);
});

test('isValidMacroEstimate returns false when calories are negative', () => {
  assert.equal(isValidMacroEstimate({ ...validEstimate, calories: -1 }), false);
});

test('isValidMacroEstimate returns false when carbs are negative', () => {
  assert.equal(isValidMacroEstimate({ ...validEstimate, carbs: -0.5 }), false);
});

test('isValidMacroEstimate returns false when proteins are negative', () => {
  assert.equal(isValidMacroEstimate({ ...validEstimate, proteins: -5 }), false);
});

test('isValidMacroEstimate returns false when fats are negative', () => {
  assert.equal(isValidMacroEstimate({ ...validEstimate, fats: -1 }), false);
});

test('isValidMacroEstimate returns false when totalGrams is zero', () => {
  assert.equal(isValidMacroEstimate({ ...validEstimate, totalGrams: 0 }), false);
});

test('isValidMacroEstimate returns false when totalGrams is negative', () => {
  assert.equal(isValidMacroEstimate({ ...validEstimate, totalGrams: -100 }), false);
});

test('isValidMacroEstimate returns false for NaN values', () => {
  assert.equal(isValidMacroEstimate({ ...validEstimate, calories: NaN }), false);
});

test('isValidMacroEstimate returns false for Infinity values', () => {
  assert.equal(isValidMacroEstimate({ ...validEstimate, fats: Infinity }), false);
});

// ─── parseMacroEstimateFromResponse ──────────────────────────────────────────

test('parseMacroEstimateFromResponse parses a valid response', () => {
  const result = parseMacroEstimateFromResponse(validRaw);
  assert.ok(result !== null);
  assert.equal(result.calories, 330);
  assert.equal(result.carbs, 10);
  assert.equal(result.proteins, 25);
  assert.equal(result.fats, 8);
  assert.equal(result.totalGrams, 200);
  assert.equal(result.confidence, 'high');
});

test('parseMacroEstimateFromResponse rounds to 1 decimal place', () => {
  const result = parseMacroEstimateFromResponse({ ...validRaw, calories: 330.456 });
  assert.ok(result !== null);
  assert.equal(result.calories, 330.5);
});

test('parseMacroEstimateFromResponse returns null when error field is present', () => {
  assert.equal(
    parseMacroEstimateFromResponse({ ...validRaw, error: 'unrecognizable_image' }),
    null,
  );
});

test('parseMacroEstimateFromResponse returns null when calories is missing', () => {
  const { calories: _c, ...rest } = validRaw;
  assert.equal(parseMacroEstimateFromResponse(rest), null);
});

test('parseMacroEstimateFromResponse returns null when calories is negative', () => {
  assert.equal(parseMacroEstimateFromResponse({ ...validRaw, calories: -1 }), null);
});

test('parseMacroEstimateFromResponse returns null when totalGrams is zero', () => {
  assert.equal(parseMacroEstimateFromResponse({ ...validRaw, totalGrams: 0 }), null);
});

test('parseMacroEstimateFromResponse returns null when a field is a string', () => {
  assert.equal(
    parseMacroEstimateFromResponse({ ...validRaw, carbs: '10' as unknown as number }),
    null,
  );
});

test('parseMacroEstimateFromResponse defaults confidence to low for unknown value', () => {
  const result = parseMacroEstimateFromResponse({ ...validRaw, confidence: 'extreme' });
  assert.ok(result !== null);
  assert.equal(result.confidence, 'low');
});

test('parseMacroEstimateFromResponse defaults confidence to low when omitted', () => {
  const { confidence: _conf, ...rest } = validRaw;
  const result = parseMacroEstimateFromResponse(rest);
  assert.ok(result !== null);
  assert.equal(result.confidence, 'low');
});

test('parseMacroEstimateFromResponse accepts zero for carbs/proteins/fats', () => {
  const result = parseMacroEstimateFromResponse({
    ...validRaw,
    carbs: 0,
    proteins: 0,
    fats: 0,
  });
  assert.ok(result !== null);
  assert.equal(result.carbs, 0);
  assert.equal(result.proteins, 0);
  assert.equal(result.fats, 0);
});

// ─── mapMacroEstimateToMealInput ──────────────────────────────────────────────

test('mapMacroEstimateToMealInput converts all numeric fields to strings', () => {
  const input = mapMacroEstimateToMealInput(validEstimate);
  assert.equal(input.totalGrams, '200');
  assert.equal(input.calories, '330');
  assert.equal(input.carbs, '10');
  assert.equal(input.proteins, '25');
  assert.equal(input.fats, '8');
});

test('mapMacroEstimateToMealInput does not include name or ingredientCost', () => {
  const input = mapMacroEstimateToMealInput(validEstimate);
  assert.equal('name' in input, false);
  assert.equal('ingredientCost' in input, false);
});

test('mapMacroEstimateToMealInput preserves decimal string representation', () => {
  const input = mapMacroEstimateToMealInput({ ...validEstimate, fats: 8.5 });
  assert.equal(input.fats, '8.5');
});

// ─── normalizePhotoAnalysisError ──────────────────────────────────────────────

test('normalizePhotoAnalysisError maps every exact domain code with empty or foreign messages', () => {
  const cases = [
    ['permission_denied', 'permission_denied'],
    ['photo_permission_denied', 'permission_denied'],
    ['file_too_large', 'file_too_large'],
    ['unrecognizable_image', 'unrecognizable_image'],
    ['quota_exceeded', 'quota_exceeded'],
    ['network', 'network'],
    ['invalid_response', 'invalid_response'],
    ['configuration', 'configuration'],
    ['unauthenticated', 'unauthenticated'],
    ['unknown', 'unknown'],
    ['NETWORK_ERROR', 'network'],
  ] as const;

  for (const [code, expected] of cases) {
    assert.equal(
      normalizePhotoAnalysisError({ code, message: code === 'network' ? '日本語' : '' }),
      expected,
    );
  }
});

test('normalizePhotoAnalysisError ignores message-only and foreign authorization hints', () => {
  assert.equal(normalizePhotoAnalysisError({ message: 'Image is unrecognizable' }), 'unknown');
  assert.equal(normalizePhotoAnalysisError({ message: 'No endpoint configured' }), 'unknown');
  assert.equal(normalizePhotoAnalysisError({ code: 'unauthorized' }), 'unknown');
  assert.equal(
    normalizePhotoAnalysisError({ code: 'future_provider_code', message: 'network' }),
    'unknown',
  );
});

test('normalizePhotoAnalysisError handles malformed values without coercion', () => {
  assert.equal(normalizePhotoAnalysisError({ code: 20, message: 'network' }), 'unknown');
  assert.equal(normalizePhotoAnalysisError({ code: '' }), 'unknown');
  assert.equal(normalizePhotoAnalysisError({ code: 'x'.repeat(129) }), 'unknown');
});

test('normalizePhotoAnalysisError survives a revoked proxy', () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(normalizePhotoAnalysisError(revoked.proxy), 'unknown');
});

test('normalizePhotoAnalysisError returns unknown for unrecognized errors', () => {
  assert.equal(normalizePhotoAnalysisError(new Error('something weird')), 'unknown');
});

test('normalizePhotoAnalysisError returns unknown for null', () => {
  assert.equal(normalizePhotoAnalysisError(null), 'unknown');
});

test('normalizePhotoAnalysisError returns unknown for primitive', () => {
  assert.equal(normalizePhotoAnalysisError(42), 'unknown');
});

test('mobile meal-photo logic does not own analyzer prompt text', () => {
  const source = readFileSync(
    join(process.cwd(), 'features/nutrition/meal-photo-analysis.logic.ts'),
    'utf8',
  );

  for (const token of [
    'buildAnalysisSystemPrompt',
    'buildAnalysisUserPrompt',
    'professional nutritionist',
    'Analyze this meal photo and estimate its macronutrients',
  ]) {
    assert.equal(
      source.includes(token),
      false,
      `mobile logic still owns analyzer prompt token: ${token}`,
    );
  }
});
