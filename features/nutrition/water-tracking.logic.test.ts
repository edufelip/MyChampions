import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveEffectiveWaterGoal,
  resolveWaterDayStatus,
  calculateWaterStreak,
  resolvePlanHydrationGoalContext,
  validateWaterGoalInput,
  validateWaterIntakeInput,
  normalizeWaterTrackingError,
} from './water-tracking.logic';

// --- resolveEffectiveWaterGoal ---

test('resolveEffectiveWaterGoal uses nutritionist goal when assignment is active (D-081)', () => {
  const result = resolveEffectiveWaterGoal({
    studentGoalMl: 2000,
    nutritionistGoalMl: 2500,
    hasActiveNutritionistAssignment: true,
  });
  assert.deepEqual(result, { dailyMl: 2500, owner: 'nutritionist' });
});

test('resolveEffectiveWaterGoal falls back to student goal when no assignment', () => {
  const result = resolveEffectiveWaterGoal({
    studentGoalMl: 2000,
    nutritionistGoalMl: 2500,
    hasActiveNutritionistAssignment: false,
  });
  assert.deepEqual(result, { dailyMl: 2000, owner: 'student' });
});

test('resolveEffectiveWaterGoal returns null when no goals and no assignment', () => {
  const result = resolveEffectiveWaterGoal({
    studentGoalMl: null,
    nutritionistGoalMl: null,
    hasActiveNutritionistAssignment: false,
  });
  assert.equal(result, null);
});

test('resolveEffectiveWaterGoal uses student goal when assignment active but nutritionist goal is null', () => {
  const result = resolveEffectiveWaterGoal({
    studentGoalMl: 1800,
    nutritionistGoalMl: null,
    hasActiveNutritionistAssignment: true,
  });
  assert.deepEqual(result, { dailyMl: 1800, owner: 'student' });
});

test('resolveEffectiveWaterGoal returns null when assignment is active but both goals are null', () => {
  const result = resolveEffectiveWaterGoal({
    studentGoalMl: null,
    nutritionistGoalMl: null,
    hasActiveNutritionistAssignment: true,
  });
  assert.equal(result, null);
});

test('resolvePlanHydrationGoalContext ignores assigned plan when professional assignment is not active', () => {
  const result = resolvePlanHydrationGoalContext({
    currentUserUid: 'student-1',
    activeNutritionistUids: new Set<string>(),
    plans: [
      {
        sourceKind: 'assigned',
        ownerProfessionalUid: 'pro-1',
        hydrationGoalMl: 2600,
        updatedAt: '2026-03-10T10:00:00.000Z',
      },
      {
        sourceKind: 'predefined',
        ownerProfessionalUid: 'student-1',
        hydrationGoalMl: 2100,
        updatedAt: '2026-03-09T10:00:00.000Z',
      },
    ],
  });

  assert.deepEqual(result, {
    studentGoalMl: 2100,
    nutritionistGoalMl: null,
    hasActiveNutritionistAssignment: false,
  });
});

test('resolvePlanHydrationGoalContext uses assigned plan when professional assignment is active', () => {
  const result = resolvePlanHydrationGoalContext({
    currentUserUid: 'student-1',
    activeNutritionistUids: new Set<string>(['pro-1']),
    plans: [
      {
        sourceKind: 'assigned',
        ownerProfessionalUid: 'pro-1',
        hydrationGoalMl: 2600,
        updatedAt: '2026-03-10T10:00:00.000Z',
      },
      {
        sourceKind: 'predefined',
        ownerProfessionalUid: 'student-1',
        hydrationGoalMl: 2100,
        updatedAt: '2026-03-09T10:00:00.000Z',
      },
    ],
  });

  assert.deepEqual(result, {
    studentGoalMl: 2100,
    nutritionistGoalMl: 2600,
    hasActiveNutritionistAssignment: true,
  });
});

test('resolvePlanHydrationGoalContext treats student-owned predefined plan as personal fallback', () => {
  const result = resolvePlanHydrationGoalContext({
    currentUserUid: 'student-1',
    activeNutritionistUids: new Set<string>(),
    plans: [
      {
        sourceKind: 'predefined',
        ownerProfessionalUid: 'student-1',
        hydrationGoalMl: 2050,
        updatedAt: '2026-03-08T10:00:00.000Z',
      },
    ],
  });

  assert.deepEqual(result, {
    studentGoalMl: 2050,
    nutritionistGoalMl: null,
    hasActiveNutritionistAssignment: false,
  });
});

// --- resolveWaterDayStatus ---

test('resolveWaterDayStatus returns goal_met when consumed >= goal', () => {
  assert.equal(resolveWaterDayStatus(2000, 2000), 'goal_met');
  assert.equal(resolveWaterDayStatus(2500, 2000), 'goal_met');
});

test('resolveWaterDayStatus returns on_track when consumed > 0 but below goal', () => {
  assert.equal(resolveWaterDayStatus(500, 2000), 'on_track');
  assert.equal(resolveWaterDayStatus(1, 2000), 'on_track');
});

test('resolveWaterDayStatus returns below_goal when consumed is 0', () => {
  assert.equal(resolveWaterDayStatus(0, 2000), 'below_goal');
});

// --- calculateWaterStreak ---

test('calculateWaterStreak returns 0 when no logs', () => {
  assert.equal(calculateWaterStreak([], 2000, '2024-01-10'), 0);
});

test('calculateWaterStreak returns 0 when goal is 0', () => {
  assert.equal(calculateWaterStreak([], 0, '2024-01-10'), 0);
});

test('calculateWaterStreak counts consecutive days meeting goal', () => {
  const logs = [
    { dateKey: '2024-01-10', totalMl: 2000 },
    { dateKey: '2024-01-09', totalMl: 2100 },
    { dateKey: '2024-01-08', totalMl: 1900 }, // below goal — streak breaks
    { dateKey: '2024-01-07', totalMl: 2000 },
  ];
  assert.equal(calculateWaterStreak(logs, 2000, '2024-01-10'), 2);
});

test('calculateWaterStreak breaks on missing day', () => {
  const logs = [
    { dateKey: '2024-01-10', totalMl: 2000 },
    // 2024-01-09 missing
    { dateKey: '2024-01-08', totalMl: 2000 },
  ];
  assert.equal(calculateWaterStreak(logs, 2000, '2024-01-10'), 1);
});

test('calculateWaterStreak returns 0 when today is below goal', () => {
  const logs = [{ dateKey: '2024-01-10', totalMl: 1000 }];
  assert.equal(calculateWaterStreak(logs, 2000, '2024-01-10'), 0);
});

// --- validateWaterGoalInput ---

test('validateWaterGoalInput returns no errors for valid input', () => {
  assert.deepEqual(validateWaterGoalInput({ dailyMlString: '2000' }), {});
});

test('validateWaterGoalInput requires dailyMl', () => {
  assert.equal(validateWaterGoalInput({ dailyMlString: '' }).dailyMl, 'required');
  assert.equal(validateWaterGoalInput({ dailyMlString: '   ' }).dailyMl, 'required');
});

test('validateWaterGoalInput rejects non-positive values', () => {
  assert.equal(validateWaterGoalInput({ dailyMlString: '0' }).dailyMl, 'must_be_positive');
  assert.equal(validateWaterGoalInput({ dailyMlString: '-100' }).dailyMl, 'must_be_positive');
  assert.equal(validateWaterGoalInput({ dailyMlString: 'abc' }).dailyMl, 'must_be_positive');
});

// --- validateWaterIntakeInput ---

test('validateWaterIntakeInput returns no errors for valid input', () => {
  assert.deepEqual(validateWaterIntakeInput({ amountMlString: '500' }), {});
});

test('validateWaterIntakeInput requires amountMl', () => {
  assert.equal(validateWaterIntakeInput({ amountMlString: '' }).amountMl, 'required');
});

test('validateWaterIntakeInput rejects non-positive values', () => {
  assert.equal(validateWaterIntakeInput({ amountMlString: '0' }).amountMl, 'must_be_positive');
  assert.equal(validateWaterIntakeInput({ amountMlString: '-1' }).amountMl, 'must_be_positive');
});

// --- normalizeWaterTrackingError ---

test('normalizeWaterTrackingError maps INVALID_AMOUNT', () => {
  assert.equal(normalizeWaterTrackingError({ code: 'INVALID_AMOUNT' }), 'invalid_amount');
  assert.equal(normalizeWaterTrackingError({ message: 'invalid amount provided' }), 'invalid_amount');
});

test('normalizeWaterTrackingError maps network error', () => {
  assert.equal(normalizeWaterTrackingError({ code: 'NETWORK_ERROR' }), 'network');
  assert.equal(normalizeWaterTrackingError({ message: 'network failure' }), 'network');
});

test('normalizeWaterTrackingError maps configuration error', () => {
  assert.equal(normalizeWaterTrackingError({ message: 'endpoint not found' }), 'configuration');
  assert.equal(normalizeWaterTrackingError({ message: 'config error' }), 'configuration');
});

test('normalizeWaterTrackingError returns unknown for unrecognized', () => {
  assert.equal(normalizeWaterTrackingError(null), 'unknown');
  assert.equal(normalizeWaterTrackingError({ message: 'unexpected error' }), 'unknown');
});
