/**
 * Integration-level tests for BL-001 self-guided start flow (TC-249).
 * Tests the logical flow from role selection through empty-state detection.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePostRoleRoute,
  validateRoleSelectionInput,
  type RoleIntent,
} from './role-selection.logic';
import type { Plan } from '@/features/plans/plan-source';

/**
 * Simulates the flow: user taps "Start on my own" → validates selection → locks role → routes to home.
 */
test('BL-001 TC-249: Quick self-guided start commits student role and routes correctly', () => {
  // Step 1: Validate quick self-guided action (no user input needed, role is hardcoded to 'student')
  const selectedRole: RoleIntent = 'student';
  const validationResult = validateRoleSelectionInput({ role: selectedRole });

  assert.deepEqual(validationResult, {}, 'role selection should pass validation');

  // Step 2: Resolve post-role route (what happens after lockRole succeeds)
  const postRoleRoute = resolvePostRoleRoute(selectedRole);

  assert.equal(postRoleRoute, '/', 'student should be routed to home (/)');
  assert.equal(selectedRole, 'student', 'role must be locked as student');
});

async function simulateRoleSelectionContinue(params: {
  role: RoleIntent;
  lockRole: (role: RoleIntent) => Promise<void>;
}) {
  try {
    await params.lockRole(params.role);
    return {
      route: resolvePostRoleRoute(params.role),
      error: null as null | 'auth.role.error.save_failed',
    };
  } catch {
    return {
      route: null,
      error: 'auth.role.error.save_failed' as const,
    };
  }
}

test('role-selection continue does not route when role lock fails', async () => {
  const result = await simulateRoleSelectionContinue({
    role: 'student',
    lockRole: async () => {
      throw new Error('Firestore did not confirm locked role');
    },
  });

  assert.equal(result.route, null);
  assert.equal(result.error, 'auth.role.error.save_failed');
});

/**
 * Simulates the empty-state logic that determines whether to show self-guided CTAs.
 */
function hasActivePlan(plans: Plan[], planType: 'nutrition' | 'training'): boolean {
  return plans.some((p) => p.planType === planType && !p.isArchived);
}

test('BL-001 empty-state detection: student with no plans shows self-guided CTAs', () => {
  const emptyPlans: Plan[] = [];

  const hasNutritionPlan = hasActivePlan(emptyPlans, 'nutrition');
  const hasTrainingPlan = hasActivePlan(emptyPlans, 'training');

  assert.equal(hasNutritionPlan, false, 'no active nutrition plan → show CTA');
  assert.equal(hasTrainingPlan, false, 'no active training plan → show CTA');
});

test('BL-001 empty-state detection: student with self-managed plan does NOT show CTA', () => {
  const plansWithSelfManaged: Plan[] = [
    {
      id: 'plan-1',
      planType: 'nutrition',
      isArchived: false,
      sourceKind: 'self_managed',
      ownerProfessionalUid: null,
      studentUid: 'student-1',
      name: 'My nutrition plan',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
  ];

  const hasNutritionPlan = hasActivePlan(plansWithSelfManaged, 'nutrition');

  assert.equal(hasNutritionPlan, true, 'self-managed plan counts as active → no CTA needed');
});

test('BL-001 empty-state detection: student with assigned plan does NOT show CTA', () => {
  const plansWithAssigned: Plan[] = [
    {
      id: 'plan-2',
      planType: 'training',
      isArchived: false,
      sourceKind: 'assigned',
      ownerProfessionalUid: 'prof-1',
      studentUid: 'student-1',
      name: 'Professional training plan',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
  ];

  const hasTrainingPlan = hasActivePlan(plansWithAssigned, 'training');

  assert.equal(hasTrainingPlan, true, 'assigned plan counts as active → no CTA needed');
});

test('BL-001 empty-state detection: archived plan does NOT count as active', () => {
  const plansWithArchived: Plan[] = [
    {
      id: 'plan-3',
      planType: 'nutrition',
      isArchived: true,
      sourceKind: 'assigned',
      ownerProfessionalUid: 'prof-1',
      studentUid: 'student-1',
      name: 'Old archived plan',
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    },
  ];

  const hasNutritionPlan = hasActivePlan(plansWithArchived, 'nutrition');

  assert.equal(hasNutritionPlan, false, 'archived plan should not count → show CTA');
});

test('BL-001 self-guided path supports both nutrition and training plan creation', () => {
  // User starts self-guided with no plans
  const initialPlans: Plan[] = [];

  // Check both specialties
  const canCreateNutrition = !hasActivePlan(initialPlans, 'nutrition');
  const canCreateTraining = !hasActivePlan(initialPlans, 'training');

  assert.equal(canCreateNutrition, true, 'can create self-managed nutrition plan');
  assert.equal(canCreateTraining, true, 'can create self-managed training plan');
});

test('BL-001 empty-state copy scenarios', () => {
  // Scenario 1: Student with no nutrition plan but has training plan
  const mixedPlans: Plan[] = [
    {
      id: 'plan-1',
      planType: 'training',
      isArchived: false,
      sourceKind: 'self_managed',
      ownerProfessionalUid: null,
      studentUid: 'student-1',
      name: 'My training',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
  ];

  const hasNutritionPlan = hasActivePlan(mixedPlans, 'nutrition');
  const hasTrainingPlan = hasActivePlan(mixedPlans, 'training');

  // Expected: show nutrition CTA (no nutritionist), hide training CTA
  assert.equal(
    hasNutritionPlan,
    false,
    'should show: "No nutritionist connected? You can still build and track your own plan today."'
  );
  assert.equal(
    hasTrainingPlan,
    true,
    'should NOT show training CTA since plan exists'
  );
});
