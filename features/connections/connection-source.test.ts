import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPendingConnectionFromInvite,
  getExistingInviteConnectionConflict,
  isPendingStudentCapReached,
  requestSubmitInviteCode,
} from './connection-source';

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

test('existing invite connection conflict treats active and pending as blockers', () => {
  assert.equal(getExistingInviteConnectionConflict([{ status: 'pending_confirmation' }]), 'pending');
  assert.equal(getExistingInviteConnectionConflict([{ status: 'active' }]), 'active');
  assert.equal(getExistingInviteConnectionConflict([{ status: 'ended' }]), null);
});

test('requestSubmitInviteCode calls governed backend endpoint with auth token', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;

  const result = await requestSubmitInviteCode('NUT123', {
    getCurrentIdToken: async () => 'id-token',
    getSubmitInviteFunctionUrl: () => 'https://example.com/submitInviteCode',
    fetchFn: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ connectionId: 'conn-1', status: 'pending_confirmation' }), { status: 200 });
    },
  });

  assert.deepEqual(result, { connectionId: 'conn-1', status: 'pending_confirmation' });
  assert.equal(capturedUrl, 'https://example.com/submitInviteCode');
  assert.equal(capturedInit?.method, 'POST');
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, 'Bearer id-token');
  assert.equal(capturedInit?.body, JSON.stringify({ code: 'NUT123' }));
});

test('requestSubmitInviteCode maps backend duplicate pending response', async () => {
  await assert.rejects(
    () => requestSubmitInviteCode('NUT123', {
      getCurrentIdToken: async () => 'id-token',
      getSubmitInviteFunctionUrl: () => 'https://example.com/submitInviteCode',
      fetchFn: async () => new Response(JSON.stringify({ error: 'pending_already_exists' }), { status: 409 }),
    }),
    (error: unknown) => error instanceof Error && error.message.includes('Pending request already exists')
  );
});

test('requestSubmitInviteCode preserves missing endpoint as configuration error', async () => {
  await assert.rejects(
    () => requestSubmitInviteCode('NUT123', {
      getCurrentIdToken: async () => 'id-token',
      getSubmitInviteFunctionUrl: () => {
        throw new Error('Invite submission endpoint is not configured.');
      },
      fetchFn: async () => new Response(null, { status: 204 }),
    }),
    (error: unknown) => error instanceof Error && error.message.includes('not configured')
  );
});
