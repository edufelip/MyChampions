import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidMacroEstimate,
  parseMacroEstimateFromResponse,
  mapMacroEstimateToMealInput,
  normalizePhotoAnalysisError,
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  type MacroEstimate,
  type RawAnalysisResponse,
} from './meal-photo-analysis.logic';

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
    null
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
  assert.equal(parseMacroEstimateFromResponse({ ...validRaw, carbs: '10' as unknown as number }), null);
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

test('normalizePhotoAnalysisError maps code unrecognizable_image', () => {
  assert.equal(
    normalizePhotoAnalysisError({ code: 'unrecognizable_image', message: '' }),
    'unrecognizable_image'
  );
});

test('normalizePhotoAnalysisError maps message containing "unrecognizable"', () => {
  assert.equal(
    normalizePhotoAnalysisError({ message: 'Image is unrecognizable' }),
    'unrecognizable_image'
  );
});

test('normalizePhotoAnalysisError maps code quota_exceeded', () => {
  assert.equal(
    normalizePhotoAnalysisError({ code: 'quota_exceeded', message: '' }),
    'quota_exceeded'
  );
});

test('normalizePhotoAnalysisError maps message containing "rate limit"', () => {
  assert.equal(
    normalizePhotoAnalysisError({ message: 'Rate limit exceeded' }),
    'quota_exceeded'
  );
});

test('normalizePhotoAnalysisError maps code invalid_response', () => {
  assert.equal(
    normalizePhotoAnalysisError({ code: 'invalid_response', message: '' }),
    'invalid_response'
  );
});

test('normalizePhotoAnalysisError maps message containing "parse"', () => {
  assert.equal(
    normalizePhotoAnalysisError({ message: 'Failed to parse response' }),
    'invalid_response'
  );
});

test('normalizePhotoAnalysisError maps code configuration', () => {
  assert.equal(
    normalizePhotoAnalysisError({ code: 'configuration', message: '' }),
    'configuration'
  );
});

test('normalizePhotoAnalysisError maps message containing "endpoint"', () => {
  assert.equal(
    normalizePhotoAnalysisError({ message: 'No endpoint configured' }),
    'configuration'
  );
});

test('normalizePhotoAnalysisError maps message containing "network"', () => {
  assert.equal(
    normalizePhotoAnalysisError({ message: 'Network request failed' }),
    'network'
  );
});

test('normalizePhotoAnalysisError maps message containing "timeout"', () => {
  assert.equal(
    normalizePhotoAnalysisError({ message: 'Request timeout' }),
    'network'
  );
});

test('normalizePhotoAnalysisError maps message containing "fetch"', () => {
  assert.equal(
    normalizePhotoAnalysisError({ message: 'fetch failed' }),
    'network'
  );
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

// ─── buildAnalysisSystemPrompt ────────────────────────────────────────────────

test('buildAnalysisSystemPrompt returns a non-empty string', () => {
  const prompt = buildAnalysisSystemPrompt();
  assert.ok(typeof prompt === 'string' && prompt.length > 0);
});

test('buildAnalysisSystemPrompt includes all required macro field names', () => {
  const prompt = buildAnalysisSystemPrompt();
  assert.ok(prompt.includes('calories'));
  assert.ok(prompt.includes('carbs'));
  assert.ok(prompt.includes('proteins'));
  assert.ok(prompt.includes('fats'));
  assert.ok(prompt.includes('totalGrams'));
  assert.ok(prompt.includes('confidence'));
});

test('buildAnalysisSystemPrompt instructs returning JSON only', () => {
  const prompt = buildAnalysisSystemPrompt();
  assert.ok(prompt.toLowerCase().includes('json'));
});

test('buildAnalysisSystemPrompt includes unrecognizable_image fallback instruction', () => {
  const prompt = buildAnalysisSystemPrompt();
  assert.ok(prompt.includes('unrecognizable_image'));
});

// ─── buildAnalysisUserPrompt ──────────────────────────────────────────────────

test('buildAnalysisUserPrompt returns a non-empty string', () => {
  const prompt = buildAnalysisUserPrompt();
  assert.ok(typeof prompt === 'string' && prompt.length > 0);
});
