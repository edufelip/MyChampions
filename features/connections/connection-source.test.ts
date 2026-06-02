import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPendingConnectionFromInvite, isPendingStudentCapReached } from './connection-source';

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

test('pending cap counts unique students, not specialty-scoped request documents', () => {
  const pendingConnections = [
    { studentAuthUid: 'student-1' },
    { studentAuthUid: 'student-1' },
    { studentAuthUid: 'student-2' },
    { studentAuthUid: 'student-3' },
    { studentAuthUid: 'student-4' },
    { studentAuthUid: 'student-5' },
    { studentAuthUid: 'student-6' },
    { studentAuthUid: 'student-7' },
    { studentAuthUid: 'student-8' },
    { studentAuthUid: 'student-9' },
  ];

  assert.equal(isPendingStudentCapReached(pendingConnections, 'student-1'), false);
  assert.equal(isPendingStudentCapReached(pendingConnections, 'student-10'), false);
  assert.equal(isPendingStudentCapReached(pendingConnections, 'student-11', 9), true);
});
