import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveStudentNutritionState } from './student-nutrition-state.logic';
import type { Plan } from './plan-source';

function plan(overrides: Partial<Plan>): Plan {
  return {
    id: 'plan-1',
    planType: 'nutrition',
    sourceKind: 'assigned',
    ownerProfessionalUid: 'pro-1',
    studentUid: 'student-1',
    isArchived: false,
    isDraft: false,
    name: 'Plan',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveStudentNutritionState', () => {
  it('returns waiting when an active nutritionist has not sent a plan', () => {
    assert.equal(
      resolveStudentNutritionState({
        currentUserUid: 'student-1',
        hasActiveNutritionistConnection: true,
        plans: [],
      }).kind,
      'waiting'
    );
  });

  it('returns waiting when an active nutritionist only has a draft assigned plan', () => {
    assert.equal(
      resolveStudentNutritionState({
        currentUserUid: 'student-1',
        hasActiveNutritionistConnection: true,
        plans: [plan({ isDraft: true })],
      }).kind,
      'waiting'
    );
  });

  it('returns self-managed when no active nutritionist exists and the student has a self-managed plan', () => {
    assert.equal(
      resolveStudentNutritionState({
        currentUserUid: 'student-1',
        hasActiveNutritionistConnection: false,
        plans: [plan({ sourceKind: 'self_managed', ownerProfessionalUid: null })],
      }).kind,
      'self_managed'
    );
  });

  it('returns empty when no active nutritionist and no nutrition plan exist', () => {
    assert.equal(
      resolveStudentNutritionState({
        currentUserUid: 'student-1',
        hasActiveNutritionistConnection: false,
        plans: [],
      }).kind,
      'empty'
    );
  });
});
