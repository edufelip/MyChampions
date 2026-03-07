import assert from 'node:assert/strict';
import test from 'node:test';

import { 
  calculateNutritionTotals, 
  isStarterTemplate,
  deriveStarterTemplatePlanType
} from './plan-builder.logic';

test('calculateNutritionTotals parses valid numeric strings', () => {
  const input = {
    name: 'Plan',
    caloriesTarget: '2000',
    carbsTarget: '200',
    proteinsTarget: '150',
    fatsTarget: '70'
  };
  const totals = calculateNutritionTotals(input);
  assert.equal(totals.calories, 2000);
  assert.equal(totals.carbs, 200);
  assert.equal(totals.proteins, 150);
  assert.equal(totals.fats, 70);
});

test('calculateNutritionTotals handles empty and invalid strings as 0', () => {
  const input = {
    name: 'Plan',
    caloriesTarget: '',
    carbsTarget: 'abc',
    proteinsTarget: '-10',
    fatsTarget: ' '
  };
  const totals = calculateNutritionTotals(input);
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
