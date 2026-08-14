import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isReadOnlyForStudentSurface,
  isSelfGuidedPlan,
  type PlanOwnershipSnapshot,
} from './plan-ownership.logic';

const base = (partial: Partial<PlanOwnershipSnapshot>): PlanOwnershipSnapshot => ({
  sourceKind: 'assigned',
  ownerProfessionalUid: 'pro-1',
  studentUid: 'student-1',
  ...partial,
});

test('isSelfGuidedPlan returns true for explicit self_managed source kind', () => {
  assert.equal(isSelfGuidedPlan(base({ sourceKind: 'self_managed' }), 'student-1'), true);
});

test('isSelfGuidedPlan returns false for predefined plan owned by same student', () => {
  assert.equal(
    isSelfGuidedPlan(
      base({
        sourceKind: 'predefined',
        ownerProfessionalUid: 'student-1',
        studentUid: 'student-1',
      }),
      'student-1',
    ),
    false,
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
      'student-1',
    ),
    false,
  );
});

test('isSelfGuidedPlan returns false when current user uid is missing', () => {
  assert.equal(isSelfGuidedPlan(base({ sourceKind: 'self_managed' }), null), false);
});

// ET-107: a Student opening a professionally assigned plan must never see an
// editable builder — the owning Professional is the only writer.
test('isReadOnlyForStudentSurface locks a professionally assigned plan on the Student surface', () => {
  assert.equal(isReadOnlyForStudentSurface({ sourceKind: 'assigned' }, true), true);
});

test('isReadOnlyForStudentSurface fails closed for a predefined plan on the Student surface', () => {
  assert.equal(isReadOnlyForStudentSurface({ sourceKind: 'predefined' }, true), true);
});

test('isReadOnlyForStudentSurface keeps a self-managed plan editable on the Student surface', () => {
  assert.equal(isReadOnlyForStudentSurface({ sourceKind: 'self_managed' }, true), false);
});

test('isReadOnlyForStudentSurface never locks the Professional surface, regardless of source kind', () => {
  assert.equal(isReadOnlyForStudentSurface({ sourceKind: 'assigned' }, false), false);
  assert.equal(isReadOnlyForStudentSurface({ sourceKind: 'predefined' }, false), false);
  assert.equal(isReadOnlyForStudentSurface({ sourceKind: 'self_managed' }, false), false);
});

// Defensive: sourceKind arrives over the wire from untyped server JSON
// (plan-builder-source.ts), so the TypeScript union doesn't guarantee this at
// runtime. Fail-closed must hold for any value that isn't literally
// 'self_managed', including one the client has never seen before.
test('isReadOnlyForStudentSurface fails closed for an unrecognized source kind on the Student surface', () => {
  assert.equal(
    isReadOnlyForStudentSurface({ sourceKind: 'unknown_future_kind' as never }, true),
    true,
  );
});
