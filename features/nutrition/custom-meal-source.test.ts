import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAssignedMealPortionLog } from './custom-meal-source';

test('buildAssignedMealPortionLog includes assigned plan and connection provenance when available', () => {
  const log = buildAssignedMealPortionLog({
    id: 'portion-log-1',
    ownerUid: 'student-uid',
    mealId: 'meal-1',
    snapshot: {
      calories: 420,
      carbs: 50,
      proteins: 32,
      fats: 12,
    },
    loggedAt: '2026-06-01T12:00:00.000Z',
    provenance: {
      planId: 'nutrition-plan-1',
      planType: 'nutrition',
      sourceKind: 'assigned',
      ownerProfessionalUid: 'nutritionist-uid',
      connectionId: 'connection-1',
    },
  });

  assert.equal(log.planId, 'nutrition-plan-1');
  assert.equal(log.planType, 'nutrition');
  assert.equal(log.sourceKind, 'assigned');
  assert.equal(log.ownerProfessionalUid, 'nutritionist-uid');
  assert.equal(log.connectionId, 'connection-1');
});

test('buildAssignedMealPortionLog keeps unavailable provenance as null', () => {
  const log = buildAssignedMealPortionLog({
    id: 'portion-log-2',
    ownerUid: 'student-uid',
    mealId: 'meal-2',
    snapshot: {
      calories: 300,
      carbs: 30,
      proteins: 20,
      fats: 10,
    },
    loggedAt: '2026-06-01T13:00:00.000Z',
  });

  assert.equal(log.planId, null);
  assert.equal(log.planType, null);
  assert.equal(log.sourceKind, null);
  assert.equal(log.ownerProfessionalUid, null);
  assert.equal(log.connectionId, null);
});
