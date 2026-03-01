/**
 * Tests for student home empty-state detection logic (BL-001).
 * Covers the logic that determines when to show self-guided CTAs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Plan } from '@/features/plans/plan-source';

// Pure helper extracted from app/student/home.tsx
function hasActivePlanForType(plans: Plan[], planType: string): boolean {
  return plans.some((p) => p.planType === planType && !p.isArchived);
}

test('hasActivePlanForType returns false for empty plans array', () => {
  assert.equal(hasActivePlanForType([], 'nutrition'), false);
  assert.equal(hasActivePlanForType([], 'training'), false);
});

test('hasActivePlanForType returns false when no matching planType exists', () => {
  const plans: Plan[] = [
    {
      id: '1',
      planType: 'nutrition',
      isArchived: false,
      sourceKind: 'assigned',
      ownerProfessionalUid: 'prof-123',
      studentUid: 'student-456',
      name: 'Calorie deficit',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
  ];

  assert.equal(hasActivePlanForType(plans, 'training'), false);
});

test('hasActivePlanForType returns false when matching plan is archived', () => {
  const plans: Plan[] = [
    {
      id: '1',
      planType: 'nutrition',
      isArchived: true,
      sourceKind: 'assigned',
      ownerProfessionalUid: 'prof-123',
      studentUid: 'student-456',
      name: 'Calorie deficit',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
  ];

  assert.equal(hasActivePlanForType(plans, 'nutrition'), false);
});

test('hasActivePlanForType returns true when active plan exists', () => {
  const plans: Plan[] = [
    {
      id: '1',
      planType: 'nutrition',
      isArchived: false,
      sourceKind: 'assigned',
      ownerProfessionalUid: 'prof-123',
      studentUid: 'student-456',
      name: 'Calorie deficit',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
  ];

  assert.equal(hasActivePlanForType(plans, 'nutrition'), true);
});

test('hasActivePlanForType returns true with multiple plans when one matches', () => {
  const plans: Plan[] = [
    {
      id: '1',
      planType: 'nutrition',
      isArchived: true,
      sourceKind: 'assigned',
      ownerProfessionalUid: 'prof-123',
      studentUid: 'student-456',
      name: 'Old plan',
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    },
    {
      id: '2',
      planType: 'training',
      isArchived: false,
      sourceKind: 'assigned',
      ownerProfessionalUid: 'prof-123',
      studentUid: 'student-456',
      name: 'HIIT Program',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
    {
      id: '3',
      planType: 'nutrition',
      isArchived: false,
      sourceKind: 'self_managed',
      ownerProfessionalUid: null,
      studentUid: 'student-456',
      name: 'My custom plan',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
  ];

  assert.equal(hasActivePlanForType(plans, 'nutrition'), true);
  assert.equal(hasActivePlanForType(plans, 'training'), true);
});

test('hasActivePlanForType ignores sourceKind (self-managed and assigned both count as active)', () => {
  const selfManagedPlan: Plan[] = [
    {
      id: '1',
      planType: 'nutrition',
      isArchived: false,
      sourceKind: 'self_managed',
      ownerProfessionalUid: null,
      studentUid: 'student-456',
      name: 'My plan',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
  ];

  const assignedPlan: Plan[] = [
    {
      id: '2',
      planType: 'nutrition',
      isArchived: false,
      sourceKind: 'assigned',
      ownerProfessionalUid: 'prof-123',
      studentUid: 'student-456',
      name: 'Pro plan',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
  ];

  assert.equal(hasActivePlanForType(selfManagedPlan, 'nutrition'), true);
  assert.equal(hasActivePlanForType(assignedPlan, 'nutrition'), true);
});

test('hasActivePlanForType distinguishes between nutrition and training correctly', () => {
  const plans: Plan[] = [
    {
      id: '1',
      planType: 'nutrition',
      isArchived: false,
      sourceKind: 'assigned',
      ownerProfessionalUid: 'prof-123',
      studentUid: 'student-456',
      name: 'Diet plan',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
    {
      id: '2',
      planType: 'training',
      isArchived: true,
      sourceKind: 'assigned',
      ownerProfessionalUid: 'prof-123',
      studentUid: 'student-456',
      name: 'Old training',
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    },
  ];

  assert.equal(hasActivePlanForType(plans, 'nutrition'), true);
  assert.equal(hasActivePlanForType(plans, 'training'), false);
});
