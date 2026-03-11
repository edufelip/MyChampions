import assert from 'node:assert/strict';
import test from 'node:test';

import { isSelfGuidedPlan, type PlanOwnershipSnapshot } from './plan-ownership.logic';

const base = (partial: Partial<PlanOwnershipSnapshot>): PlanOwnershipSnapshot => ({
  sourceKind: 'assigned',
  ownerProfessionalUid: 'pro-1',
  studentUid: 'student-1',
  ...partial,
});

test('isSelfGuidedPlan returns true for explicit self_managed source kind', () => {
  assert.equal(isSelfGuidedPlan(base({ sourceKind: 'self_managed' }), 'student-1'), true);
});

test('isSelfGuidedPlan returns true for predefined plan owned by same student', () => {
  assert.equal(
    isSelfGuidedPlan(
      base({
        sourceKind: 'predefined',
        ownerProfessionalUid: 'student-1',
        studentUid: 'student-1',
      }),
      'student-1'
    ),
    true
  );
});

test('isSelfGuidedPlan returns false for predefined plan owned by professional', () => {
  assert.equal(
    isSelfGuidedPlan(
      base({
        sourceKind: 'predefined',
        ownerProfessionalUid: 'pro-1',
        studentUid: 'student-1',
      }),
      'student-1'
    ),
    false
  );
});

test('isSelfGuidedPlan returns false when current user uid is missing', () => {
  assert.equal(isSelfGuidedPlan(base({ sourceKind: 'self_managed' }), null), false);
});
