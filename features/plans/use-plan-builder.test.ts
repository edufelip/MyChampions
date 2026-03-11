import assert from 'node:assert/strict';
import test from 'node:test';

import {
  markNutritionBuilderMutating,
  markTrainingBuilderMutating,
  type NutritionBuilderState,
  type TrainingBuilderState,
} from './plan-builder-state';

test('markTrainingBuilderMutating keeps current plan visible while mutation runs', () => {
  const state: TrainingBuilderState = {
    kind: 'ready',
    plan: {
      id: 'plan_1',
      name: 'Strength',
      sessions: [
        {
          id: 'session_1',
          name: 'Day A',
          notes: '',
          items: [],
        },
      ],
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    },
  };

  const result = markTrainingBuilderMutating(state);

  assert.equal(result.kind, 'ready');
  assert.equal(result.plan.sessions.length, 1);
  assert.equal(result.isMutating, true);
});

test('markNutritionBuilderMutating keeps current plan visible while mutation runs', () => {
  const state: NutritionBuilderState = {
    kind: 'ready',
    plan: {
      id: 'plan_1',
      name: 'Cutting',
      sourceKind: 'predefined',
      ownerProfessionalUid: 'pro_1',
      studentAuthUid: 'pro_1',
      hydrationGoalMl: 2200,
      caloriesTarget: 2100,
      carbsTarget: 180,
      proteinsTarget: 160,
      fatsTarget: 60,
      meals: [
        {
          id: 'meal_1',
          name: 'Breakfast',
          items: [],
        },
      ],
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    },
  };

  const result = markNutritionBuilderMutating(state);

  assert.equal(result.kind, 'ready');
  assert.equal(result.plan.meals.length, 1);
  assert.equal(result.isMutating, true);
});
