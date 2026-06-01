import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPendingConnectionFromInvite, isSpecialtyScopedInviteCodePath } from './connection-source';

test('submitInviteCode creates a pending connection with the specialty from the invite code', () => {
  const connection = buildPendingConnectionFromInvite({
    connectionId: 'conn-1',
    studentUid: 'student-uid',
    inviteDocId: 'fitness_coach',
    invite: {
      professionalAuthUid: 'professional-uid',
      codeValue: 'FIT123',
      specialty: 'fitness_coach',
    },
    timestamp: '2026-06-01T00:00:00.000Z',
  });

  assert.equal(connection.specialty, 'fitness_coach');
  assert.equal(connection.sourceInviteCodeId, 'fitness_coach');
  assert.equal(connection.sourceInviteCodeValue, 'FIT123');
  assert.equal(connection.professionalAuthUid, 'professional-uid');
  assert.equal(connection.studentAuthUid, 'student-uid');
  assert.equal(connection.status, 'pending_confirmation');
});

test('submitInviteCode accepts only professional specialty-scoped invite code paths', () => {
  assert.equal(
    isSpecialtyScopedInviteCodePath(
      'professionals/professional-uid/inviteCodes/fitness_coach',
      'professional-uid',
      'fitness_coach'
    ),
    true
  );
  assert.equal(
    isSpecialtyScopedInviteCodePath('inviteCodes/professional-uid', 'professional-uid', 'fitness_coach'),
    false
  );
});
