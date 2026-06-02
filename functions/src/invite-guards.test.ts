import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPendingInviteGuardId,
  PENDING_STUDENT_SLOT_IDS,
  selectPendingStudentSlot,
} from './invite-guards';

test('buildPendingInviteGuardId scopes duplicate pending guard by professional student and specialty', () => {
  assert.equal(
    buildPendingInviteGuardId('professional-uid', 'student-uid', 'nutritionist'),
    'professional-uid_student-uid_nutritionist'
  );
});

test('selectPendingStudentSlot reuses occupied student slot for second specialty request', () => {
  const selected = selectPendingStudentSlot({
    currentOccupancy: {
      slotId: 'slot_03',
      nutritionistConnectionId: 'nutrition-connection',
      fitnessCoachConnectionId: null,
    },
    slots: PENDING_STUDENT_SLOT_IDS.map((slotId) => ({
      slotId,
      studentAuthUid: slotId === 'slot_03' ? 'student-uid' : null,
    })),
  });

  assert.equal(selected, 'slot_03');
});

test('selectPendingStudentSlot chooses the first empty slot for a new pending student', () => {
  const selected = selectPendingStudentSlot({
    currentOccupancy: null,
    slots: PENDING_STUDENT_SLOT_IDS.map((slotId, index) => ({
      slotId,
      studentAuthUid: index < 4 ? `student-${index}` : null,
    })),
  });

  assert.equal(selected, 'slot_05');
});

test('selectPendingStudentSlot returns null when ten unique pending students occupy all slots', () => {
  const selected = selectPendingStudentSlot({
    currentOccupancy: null,
    slots: PENDING_STUDENT_SLOT_IDS.map((slotId, index) => ({
      slotId,
      studentAuthUid: `student-${index}`,
    })),
  });

  assert.equal(selected, null);
});
