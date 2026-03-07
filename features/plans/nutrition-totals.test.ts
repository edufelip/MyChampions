import assert from 'node:assert/strict';
import test from 'node:test';

import { 
  calculateTotalsFromItems,
  calculateTotalsFromMeals,
  validateNutritionPlanInput
} from './plan-builder.logic';

test('calculateTotalsFromItems sums up macros and calories correctly', () => {
  const items = [
    { name: 'Item 1', quantity: '100g', notes: '', calories: 100, carbs: 10, proteins: 5, fats: 2 },
    { name: 'Item 2', quantity: '200g', notes: '', calories: 250, carbs: 20, proteins: 10, fats: 15 },
    { name: 'Item 3', quantity: '1 cup', notes: '', calories: 0, carbs: 0, proteins: 0, fats: 0 },
    { name: 'Item 4', quantity: 'None', notes: '' } // should handle missing fields
  ];
  const totals = calculateTotalsFromItems(items);
  assert.equal(totals.calories, 350);
  assert.equal(totals.carbs, 30);
  assert.equal(totals.proteins, 15);
  assert.equal(totals.fats, 17);
});

test('calculateTotalsFromItems handles decimals and rounding correctly', () => {
  const items = [
    { name: 'Item 1', quantity: '100g', notes: '', calories: 100.1, carbs: 10.1, proteins: 5.1, fats: 2.1 },
    { name: 'Item 2', quantity: '200g', notes: '', calories: 100.2, carbs: 10.2, proteins: 5.2, fats: 2.2 }
  ];
  const totals = calculateTotalsFromItems(items);
  assert.equal(totals.calories, 200.3);
  assert.equal(totals.carbs, 20.3);
  assert.equal(totals.proteins, 10.3);
  assert.equal(totals.fats, 4.3);
});

test('calculateTotalsFromMeals sums up across multiple meals', () => {
  const meals = [
    {
      id: 'm1',
      name: 'Meal 1',
      items: [
        { id: 'i1', name: 'Food 1', quantity: '100g', notes: '', calories: 100, carbs: 10, proteins: 5, fats: 2 },
      ]
    },
    {
      id: 'm2',
      name: 'Meal 2',
      items: [
        { id: 'i2', name: 'Food 2', quantity: '200g', notes: '', calories: 200, carbs: 20, proteins: 10, fats: 4 },
      ]
    }
  ] as any;
  const totals = calculateTotalsFromMeals(meals);
  assert.equal(totals.calories, 300);
  assert.equal(totals.carbs, 30);
  assert.equal(totals.proteins, 15);
  assert.equal(totals.fats, 6);
});

test('validateNutritionPlanInput no longer cares about targets', () => {
  const input = {
    name: 'Valid Name',
    caloriesTarget: 'invalid', // Should be ignored
    carbsTarget: '-10',       // Should be ignored
    proteinsTarget: 'abc',    // Should be ignored
    fatsTarget: ' '           // Should be ignored
  };
  const errors = validateNutritionPlanInput(input);
  assert.equal(Object.keys(errors).length, 0);
});

test('validateNutritionPlanInput still validates name', () => {
  const input = {
    name: 'A', // too short
    caloriesTarget: '',
    carbsTarget: '',
    proteinsTarget: '',
    fatsTarget: ''
  };
  const errors = validateNutritionPlanInput(input);
  assert.equal(errors.name, 'too_short');
});
