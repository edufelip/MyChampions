import assert from 'node:assert/strict';
import test from 'node:test';

import { 
  calculateTotalsFromItems,
  isStarterTemplate,
  deriveStarterTemplatePlanType,
  resolveNutritionPlanCreationMetadata,
  buildNutritionMealItemInputFromCustomMealSnapshot,
} from './plan-builder.logic';
import type { CustomMeal } from '../nutrition/custom-meal.logic';

test('calculateTotalsFromItems sums numeric macros', () => {
  const totals = calculateTotalsFromItems([
    { name: 'Chicken', quantity: '100g', notes: '', calories: 165, carbs: 0, proteins: 31, fats: 3.6 },
    { name: 'Rice', quantity: '100g', notes: '', calories: 130, carbs: 28, proteins: 2.7, fats: 0.3 },
  ]);
  assert.equal(totals.calories, 295);
  assert.equal(totals.carbs, 28);
  assert.equal(totals.proteins, 33.7);
  assert.equal(totals.fats, 3.9);
});

test('calculateTotalsFromItems treats missing macros as 0', () => {
  const totals = calculateTotalsFromItems([
    { name: 'Unknown', quantity: '', notes: '' },
  ]);
  assert.equal(totals.calories, 0);
  assert.equal(totals.carbs, 0);
  assert.equal(totals.proteins, 0);
  assert.equal(totals.fats, 0);
});

test('isStarterTemplate detects starter prefix', () => {
  assert.equal(isStarterTemplate('starter_nutrition_123'), true);
  assert.equal(isStarterTemplate('starter_training_123'), true);
  assert.equal(isStarterTemplate('my_plan_123'), false);
});

test('deriveStarterTemplatePlanType identifies plan types correctly', () => {
  assert.equal(deriveStarterTemplatePlanType('starter_nutrition_abc'), 'nutrition');
  assert.equal(deriveStarterTemplatePlanType('starter_training_xyz'), 'training');
  assert.equal(deriveStarterTemplatePlanType('my_plan'), null);
});

test('resolveNutritionPlanCreationMetadata returns Professional Library Plan metadata for professional builder mode', () => {
  assert.deepEqual(resolveNutritionPlanCreationMetadata('pro-1', 'professional_library'), {
    ownerProfessionalUid: 'pro-1',
    studentAuthUid: 'pro-1',
    sourceKind: 'predefined',
    isDraft: false,
  });
});

test('resolveNutritionPlanCreationMetadata returns Self-Managed Plan metadata for student builder mode', () => {
  assert.deepEqual(resolveNutritionPlanCreationMetadata('student-1', 'self_managed'), {
    ownerProfessionalUid: null,
    studentAuthUid: 'student-1',
    sourceKind: 'self_managed',
    isDraft: false,
  });
});

test('buildNutritionMealItemInputFromCustomMealSnapshot keeps a stable custom meal snapshot after the source meal changes', () => {
  const sourceMeal: CustomMeal = {
    id: 'meal-1',
    name: 'Turkey Bowl',
    totalGrams: 350,
    calories: 620,
    carbs: 68,
    proteins: 42,
    fats: 18,
    ingredientCost: 12,
    imageUrl: 'https://example.com/turkey.jpg',
    ownerUid: 'owner-1',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
  };

  const item = buildNutritionMealItemInputFromCustomMealSnapshot(sourceMeal);

  sourceMeal.name = 'Edited Turkey Bowl';
  sourceMeal.calories = 700;
  sourceMeal.carbs = 80;

  assert.deepEqual(item, {
    name: 'Turkey Bowl',
    quantity: '350g',
    notes: '',
    calories: 620,
    carbs: 68,
    proteins: 42,
    fats: 18,
    sourceKind: 'custom_meal',
    customMealSnapshot: {
      name: 'Turkey Bowl',
      servingGrams: 350,
      calories: 620,
      carbs: 68,
      proteins: 42,
      fats: 18,
      sourceKind: 'custom_meal',
    },
  });
  assert.equal('customMealId' in item, false);
});
