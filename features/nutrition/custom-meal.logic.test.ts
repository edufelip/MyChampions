import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateCustomMealInput,
  validatePortionLogInput,
  calculatePortionNutrition,
  buildSharedMealSnapshot,
  normalizeMealActionError,
  type CustomMeal,
} from './custom-meal.logic';

// --- validateCustomMealInput ---

const validInput = {
  name: 'Chicken breast',
  totalGrams: '200',
  calories: '330',
  carbs: '0',
  proteins: '62',
  fats: '7.2',
};

test('validateCustomMealInput returns no errors for valid input', () => {
  assert.deepEqual(validateCustomMealInput(validInput), {});
});

test('validateCustomMealInput requires name', () => {
  const errors = validateCustomMealInput({ ...validInput, name: '' });
  assert.equal(errors.name, 'required');
});

test('validateCustomMealInput requires totalGrams', () => {
  const errors = validateCustomMealInput({ ...validInput, totalGrams: '' });
  assert.equal(errors.totalGrams, 'required');
});

test('validateCustomMealInput rejects non-positive totalGrams', () => {
  assert.equal(
    validateCustomMealInput({ ...validInput, totalGrams: '0' }).totalGrams,
    'must_be_positive'
  );
  assert.equal(
    validateCustomMealInput({ ...validInput, totalGrams: '-10' }).totalGrams,
    'must_be_positive'
  );
});

test('validateCustomMealInput requires calories', () => {
  const errors = validateCustomMealInput({ ...validInput, calories: '' });
  assert.equal(errors.calories, 'required');
});

test('validateCustomMealInput allows zero calories', () => {
  assert.equal(validateCustomMealInput({ ...validInput, calories: '0' }).calories, undefined);
});

test('validateCustomMealInput rejects negative calories', () => {
  assert.equal(
    validateCustomMealInput({ ...validInput, calories: '-1' }).calories,
    'must_be_non_negative'
  );
});

test('validateCustomMealInput requires carbs, proteins, fats', () => {
  assert.equal(validateCustomMealInput({ ...validInput, carbs: '' }).carbs, 'required');
  assert.equal(validateCustomMealInput({ ...validInput, proteins: '' }).proteins, 'required');
  assert.equal(validateCustomMealInput({ ...validInput, fats: '' }).fats, 'required');
});

test('validateCustomMealInput rejects negative macro values', () => {
  assert.equal(validateCustomMealInput({ ...validInput, carbs: '-0.1' }).carbs, 'must_be_non_negative');
  assert.equal(validateCustomMealInput({ ...validInput, proteins: '-5' }).proteins, 'must_be_non_negative');
  assert.equal(validateCustomMealInput({ ...validInput, fats: '-2' }).fats, 'must_be_non_negative');
});

test('validateCustomMealInput rejects negative ingredientCost', () => {
  const errors = validateCustomMealInput({ ...validInput, ingredientCost: '-1' });
  assert.equal(errors.ingredientCost, 'must_be_non_negative');
});

test('validateCustomMealInput allows zero ingredientCost', () => {
  const errors = validateCustomMealInput({ ...validInput, ingredientCost: '0' });
  assert.equal(errors.ingredientCost, undefined);
});

test('validateCustomMealInput allows absent ingredientCost', () => {
  const errors = validateCustomMealInput(validInput); // no ingredientCost field
  assert.equal(errors.ingredientCost, undefined);
});

// --- validatePortionLogInput ---

test('validatePortionLogInput returns no errors for valid input', () => {
  assert.deepEqual(validatePortionLogInput({ consumedGrams: '150' }), {});
});

test('validatePortionLogInput requires consumedGrams', () => {
  assert.equal(validatePortionLogInput({ consumedGrams: '' }).consumedGrams, 'required');
});

test('validatePortionLogInput rejects non-positive consumedGrams', () => {
  assert.equal(validatePortionLogInput({ consumedGrams: '0' }).consumedGrams, 'must_be_positive');
  assert.equal(validatePortionLogInput({ consumedGrams: '-5' }).consumedGrams, 'must_be_positive');
});

// --- calculatePortionNutrition ---

const baseMeal = {
  totalGrams: 200,
  calories: 200,
  carbs: 20,
  proteins: 40,
  fats: 10,
};

test('calculatePortionNutrition returns proportional values for half portion', () => {
  const snap = calculatePortionNutrition(baseMeal, 100);
  assert.equal(snap.calories, 100);
  assert.equal(snap.carbs, 10);
  assert.equal(snap.proteins, 20);
  assert.equal(snap.fats, 5);
});

test('calculatePortionNutrition returns full values for full portion', () => {
  const snap = calculatePortionNutrition(baseMeal, 200);
  assert.equal(snap.calories, 200);
  assert.equal(snap.proteins, 40);
});

test('calculatePortionNutrition allows consumedGrams exceeding totalGrams (BR-306)', () => {
  const snap = calculatePortionNutrition(baseMeal, 400); // double portion
  assert.equal(snap.calories, 400);
  assert.equal(snap.proteins, 80);
});

test('calculatePortionNutrition rounds to 2 decimal places', () => {
  const meal = { totalGrams: 3, calories: 10, carbs: 1, proteins: 2, fats: 0.5 };
  const snap = calculatePortionNutrition(meal, 1);
  assert.equal(snap.calories, 3.33);
  assert.equal(snap.proteins, 0.67);
});

// --- buildSharedMealSnapshot ---

const fullMeal: CustomMeal = {
  id: 'meal-1',
  name: 'Test Meal',
  totalGrams: 200,
  calories: 300,
  carbs: 50,
  proteins: 20,
  fats: 8,
  ingredientCost: 5.99,
  imageUrl: 'https://example.com/img.jpg',
  ownerUid: 'user-1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

test('buildSharedMealSnapshot excludes ingredientCost and imageUrl (D-023)', () => {
  const snap = buildSharedMealSnapshot(fullMeal);
  assert.equal('ingredientCost' in snap, false);
  assert.equal('imageUrl' in snap, false);
  assert.equal('ownerUid' in snap, false);
  assert.equal('id' in snap, false);
});

test('buildSharedMealSnapshot includes all nutrition fields', () => {
  const snap = buildSharedMealSnapshot(fullMeal);
  assert.equal(snap.name, 'Test Meal');
  assert.equal(snap.totalGrams, 200);
  assert.equal(snap.calories, 300);
  assert.equal(snap.carbs, 50);
  assert.equal(snap.proteins, 20);
  assert.equal(snap.fats, 8);
});

// --- normalizeMealActionError ---

test('normalizeMealActionError maps NOT_FOUND', () => {
  assert.equal(normalizeMealActionError({ code: 'NOT_FOUND' }), 'not_found');
  assert.equal(normalizeMealActionError({ message: 'meal not found' }), 'not_found');
});

test('normalizeMealActionError maps VALIDATION', () => {
  assert.equal(normalizeMealActionError({ code: 'VALIDATION' }), 'validation');
});

test('normalizeMealActionError maps RATE_LIMITED', () => {
  assert.equal(normalizeMealActionError({ code: 'RATE_LIMITED' }), 'share_rate_limited');
  assert.equal(normalizeMealActionError({ message: 'too many requests' }), 'share_rate_limited');
});

test('normalizeMealActionError maps INVALID_TOKEN', () => {
  assert.equal(normalizeMealActionError({ code: 'INVALID_TOKEN' }), 'invalid_share_token');
  assert.equal(normalizeMealActionError({ message: 'invalid share link' }), 'invalid_share_token');
});

test('normalizeMealActionError maps ALREADY_IMPORTED', () => {
  assert.equal(normalizeMealActionError({ code: 'ALREADY_IMPORTED' }), 'already_imported');
  assert.equal(normalizeMealActionError({ message: 'already imported' }), 'already_imported');
});

test('normalizeMealActionError maps network and config', () => {
  assert.equal(normalizeMealActionError({ code: 'NETWORK_ERROR' }), 'network');
  assert.equal(normalizeMealActionError({ message: 'endpoint missing' }), 'configuration');
});

test('normalizeMealActionError returns unknown for unrecognized', () => {
  assert.equal(normalizeMealActionError(null), 'unknown');
  assert.equal(normalizeMealActionError({ message: 'weird error' }), 'unknown');
});
