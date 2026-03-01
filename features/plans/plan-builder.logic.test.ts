/**
 * Unit tests for plan-builder.logic.ts
 * Runner: node:test + node:assert/strict (npm run test:unit)
 * Refs: D-111, FR-240–FR-248, BR-291–BR-296, TC-275–TC-280
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateNutritionPlanInput,
  validateTrainingPlanInput,
  validateTrainingSessionItemInput,
  calculateNutritionTotals,
  isStarterTemplate,
  normalizePlanBuilderError,
  type NutritionPlanInput,
  type TrainingPlanInput,
  type TrainingSessionItemInput,
} from './plan-builder.logic';

// ─── validateNutritionPlanInput ───────────────────────────────────────────────

describe('validateNutritionPlanInput', () => {
  const base: NutritionPlanInput = {
    name: 'Caloric Deficit A',
    caloriesTarget: '2000',
    carbsTarget: '250',
    proteinsTarget: '160',
    fatsTarget: '60',
  };

  it('returns empty errors for fully valid input', () => {
    const errors = validateNutritionPlanInput(base);
    assert.deepEqual(errors, {});
  });

  it('returns name=required when name is empty', () => {
    const errors = validateNutritionPlanInput({ ...base, name: '' });
    assert.equal(errors.name, 'required');
  });

  it('returns name=required when name is whitespace only', () => {
    const errors = validateNutritionPlanInput({ ...base, name: '   ' });
    assert.equal(errors.name, 'required');
  });

  it('returns name=too_short when name is one character', () => {
    const errors = validateNutritionPlanInput({ ...base, name: 'A' });
    assert.equal(errors.name, 'too_short');
  });

  it('accepts name of exactly 2 characters', () => {
    const errors = validateNutritionPlanInput({ ...base, name: 'AB' });
    assert.equal(errors.name, undefined);
  });

  it('returns caloriesTarget=non_negative for negative calories', () => {
    const errors = validateNutritionPlanInput({ ...base, caloriesTarget: '-1' });
    assert.equal(errors.caloriesTarget, 'non_negative');
  });

  it('accepts zero calories', () => {
    const errors = validateNutritionPlanInput({ ...base, caloriesTarget: '0' });
    assert.equal(errors.caloriesTarget, undefined);
  });

  it('accepts empty caloriesTarget (not required)', () => {
    const errors = validateNutritionPlanInput({ ...base, caloriesTarget: '' });
    assert.equal(errors.caloriesTarget, undefined);
  });

  it('returns carbsTarget=non_negative for negative carbs', () => {
    const errors = validateNutritionPlanInput({ ...base, carbsTarget: '-5' });
    assert.equal(errors.carbsTarget, 'non_negative');
  });

  it('returns proteinsTarget=non_negative for negative proteins', () => {
    const errors = validateNutritionPlanInput({ ...base, proteinsTarget: '-3' });
    assert.equal(errors.proteinsTarget, 'non_negative');
  });

  it('returns fatsTarget=non_negative for negative fats', () => {
    const errors = validateNutritionPlanInput({ ...base, fatsTarget: '-0.5' });
    assert.equal(errors.fatsTarget, 'non_negative');
  });

  it('returns non_negative for non-numeric macro value', () => {
    const errors = validateNutritionPlanInput({ ...base, carbsTarget: 'abc' });
    assert.equal(errors.carbsTarget, 'non_negative');
  });

  it('can return multiple errors simultaneously', () => {
    const errors = validateNutritionPlanInput({
      name: '',
      caloriesTarget: '-100',
      carbsTarget: '-10',
      proteinsTarget: '',
      fatsTarget: '',
    });
    assert.equal(errors.name, 'required');
    assert.equal(errors.caloriesTarget, 'non_negative');
    assert.equal(errors.carbsTarget, 'non_negative');
    assert.equal(errors.proteinsTarget, undefined);
    assert.equal(errors.fatsTarget, undefined);
  });
});

// ─── validateTrainingPlanInput ────────────────────────────────────────────────

describe('validateTrainingPlanInput', () => {
  const base: TrainingPlanInput = { name: 'Strength Phase 1' };

  it('returns empty errors for valid input', () => {
    assert.deepEqual(validateTrainingPlanInput(base), {});
  });

  it('returns name=required for empty name', () => {
    assert.equal(validateTrainingPlanInput({ name: '' }).name, 'required');
  });

  it('returns name=required for whitespace name', () => {
    assert.equal(validateTrainingPlanInput({ name: '  ' }).name, 'required');
  });

  it('returns name=too_short for single character', () => {
    assert.equal(validateTrainingPlanInput({ name: 'X' }).name, 'too_short');
  });

  it('accepts name of exactly 2 characters', () => {
    assert.equal(validateTrainingPlanInput({ name: 'AB' }).name, undefined);
  });
});

// ─── validateTrainingSessionItemInput ────────────────────────────────────────

describe('validateTrainingSessionItemInput', () => {
  const base: TrainingSessionItemInput = {
    name: 'Bench Press',
    quantity: '3x10',
    notes: '',
  };

  it('returns empty errors for valid input', () => {
    assert.deepEqual(validateTrainingSessionItemInput(base), {});
  });

  it('returns name=required when name is empty', () => {
    assert.equal(
      validateTrainingSessionItemInput({ ...base, name: '' }).name,
      'required'
    );
  });

  it('returns name=required when name is whitespace only', () => {
    assert.equal(
      validateTrainingSessionItemInput({ ...base, name: '   ' }).name,
      'required'
    );
  });

  it('accepts empty quantity and notes (optional fields)', () => {
    const errors = validateTrainingSessionItemInput({
      name: 'Squat',
      quantity: '',
      notes: '',
    });
    assert.deepEqual(errors, {});
  });
});

// ─── calculateNutritionTotals ─────────────────────────────────────────────────

describe('calculateNutritionTotals', () => {
  it('parses valid numeric strings correctly', () => {
    const totals = calculateNutritionTotals({
      name: 'Test',
      caloriesTarget: '2000',
      carbsTarget: '250',
      proteinsTarget: '160',
      fatsTarget: '60',
    });
    assert.equal(totals.calories, 2000);
    assert.equal(totals.carbs, 250);
    assert.equal(totals.proteins, 160);
    assert.equal(totals.fats, 60);
  });

  it('returns 0 for empty string fields', () => {
    const totals = calculateNutritionTotals({
      name: '',
      caloriesTarget: '',
      carbsTarget: '',
      proteinsTarget: '',
      fatsTarget: '',
    });
    assert.equal(totals.calories, 0);
    assert.equal(totals.carbs, 0);
    assert.equal(totals.proteins, 0);
    assert.equal(totals.fats, 0);
  });

  it('returns 0 for non-numeric strings', () => {
    const totals = calculateNutritionTotals({
      name: '',
      caloriesTarget: 'abc',
      carbsTarget: 'xyz',
      proteinsTarget: '--',
      fatsTarget: 'n/a',
    });
    assert.equal(totals.calories, 0);
    assert.equal(totals.carbs, 0);
    assert.equal(totals.proteins, 0);
    assert.equal(totals.fats, 0);
  });

  it('returns 0 for negative values', () => {
    const totals = calculateNutritionTotals({
      name: '',
      caloriesTarget: '-100',
      carbsTarget: '-10',
      proteinsTarget: '-20',
      fatsTarget: '-5',
    });
    assert.equal(totals.calories, 0);
    assert.equal(totals.carbs, 0);
    assert.equal(totals.proteins, 0);
    assert.equal(totals.fats, 0);
  });

  it('handles decimal values', () => {
    const totals = calculateNutritionTotals({
      name: '',
      caloriesTarget: '1850.5',
      carbsTarget: '230.25',
      proteinsTarget: '145.75',
      fatsTarget: '55.5',
    });
    assert.equal(totals.calories, 1850.5);
    assert.equal(totals.carbs, 230.25);
    assert.equal(totals.proteins, 145.75);
    assert.equal(totals.fats, 55.5);
  });

  it('handles zero values', () => {
    const totals = calculateNutritionTotals({
      name: '',
      caloriesTarget: '0',
      carbsTarget: '0',
      proteinsTarget: '0',
      fatsTarget: '0',
    });
    assert.equal(totals.calories, 0);
    assert.equal(totals.carbs, 0);
    assert.equal(totals.proteins, 0);
    assert.equal(totals.fats, 0);
  });
});

// ─── isStarterTemplate ────────────────────────────────────────────────────────

describe('isStarterTemplate', () => {
  it('returns true for ids prefixed with starter_', () => {
    assert.equal(isStarterTemplate('starter_nutrition_basic'), true);
    assert.equal(isStarterTemplate('starter_training_upper_lower'), true);
    assert.equal(isStarterTemplate('starter_'), true);
  });

  it('returns false for regular plan ids', () => {
    assert.equal(isStarterTemplate('abc123'), false);
    assert.equal(isStarterTemplate('plan-uuid-here'), false);
    assert.equal(isStarterTemplate(''), false);
  });

  it('returns false for ids that contain but do not start with starter_', () => {
    assert.equal(isStarterTemplate('my_starter_plan'), false);
    assert.equal(isStarterTemplate('clone_of_starter_abc'), false);
  });
});

// ─── normalizePlanBuilderError ────────────────────────────────────────────────

describe('normalizePlanBuilderError', () => {
  it('returns not_found for PLAN_NOT_FOUND code', () => {
    assert.equal(normalizePlanBuilderError({ code: 'PLAN_NOT_FOUND' }), 'not_found');
  });

  it('returns not_found for message containing plan not found', () => {
    assert.equal(
      normalizePlanBuilderError({ message: 'plan not found in database' }),
      'not_found'
    );
  });

  it('returns no_active_assignment for NO_ACTIVE_ASSIGNMENT code', () => {
    assert.equal(
      normalizePlanBuilderError({ code: 'NO_ACTIVE_ASSIGNMENT' }),
      'no_active_assignment'
    );
  });

  it('returns no_active_assignment for message containing no active assignment', () => {
    assert.equal(
      normalizePlanBuilderError({ message: 'no active assignment exists' }),
      'no_active_assignment'
    );
  });

  it('returns validation for VALIDATION code', () => {
    assert.equal(normalizePlanBuilderError({ code: 'VALIDATION' }), 'validation');
  });

  it('returns network for NETWORK_ERROR code', () => {
    assert.equal(normalizePlanBuilderError({ code: 'NETWORK_ERROR' }), 'network');
  });

  it('returns network for message containing network', () => {
    assert.equal(
      normalizePlanBuilderError({ message: 'network request failed' }),
      'network'
    );
  });

  it('returns configuration for message containing endpoint', () => {
    assert.equal(
      normalizePlanBuilderError({ message: 'endpoint is not configured' }),
      'configuration'
    );
  });

  it('returns configuration for message containing config', () => {
    assert.equal(
      normalizePlanBuilderError({ message: 'missing config value' }),
      'configuration'
    );
  });

  it('returns unknown for null', () => {
    assert.equal(normalizePlanBuilderError(null), 'unknown');
  });

  it('returns unknown for string error', () => {
    assert.equal(normalizePlanBuilderError('some error'), 'unknown');
  });

  it('returns unknown for empty object', () => {
    assert.equal(normalizePlanBuilderError({}), 'unknown');
  });

  it('returns unknown for unrecognized error object', () => {
    assert.equal(normalizePlanBuilderError({ code: 'MYSTERY' }), 'unknown');
  });
});
