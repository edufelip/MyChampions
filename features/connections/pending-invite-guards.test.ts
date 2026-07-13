import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPendingInviteGuardId,
  getPendingStudentConnectionField,
  shouldReleasePendingStudentSlot,
} from './pending-invite-guards';

test('buildPendingInviteGuardId matches backend duplicate guard identity', () => {
  assert.equal(
    buildPendingInviteGuardId('professional-uid', 'student-uid', 'fitness_coach'),
    'professional-uid_student-uid_fitness_coach'
  );
});

test('getPendingStudentConnectionField maps specialties to occupancy fields', () => {
  assert.equal(getPendingStudentConnectionField('nutritionist'), 'nutritionistConnectionId');
  assert.equal(getPendingStudentConnectionField('fitness_coach'), 'fitnessCoachConnectionId');
});

test('shouldReleasePendingStudentSlot keeps slot when another specialty remains pending', () => {
  assert.equal(
    shouldReleasePendingStudentSlot({
      nutritionistConnectionId: 'nutrition-connection',
      fitnessCoachConnectionId: 'fitness-connection',
    }, 'nutrition-connection'),
    false
  );
});

test('shouldReleasePendingStudentSlot frees slot when released connection was the last pending specialty', () => {
  assert.equal(
    shouldReleasePendingStudentSlot({
      nutritionistConnectionId: 'nutrition-connection',
      fitnessCoachConnectionId: null,
    }, 'nutrition-connection'),
    true
  );
});
