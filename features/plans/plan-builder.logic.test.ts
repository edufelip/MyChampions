import assert from 'node:assert/strict';
import test from 'node:test';

import { 
  calculateTotalsFromItems,
  isStarterTemplate,
  deriveStarterTemplatePlanType,
} from './plan-builder.logic';

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
