import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInviteCodeLookupPath,
  buildInviteCodePath,
  ProfessionalSourceError,
  requestRemoveSpecialty,
} from './professional-source';

test('getOrCreateActiveInviteCode nutritionist path uses professional invite subcollection', () => {
  assert.deepEqual(buildInviteCodePath('professional-uid', 'nutritionist'), [
    'professionals',
    'professional-uid',
    'inviteCodes',
    'nutritionist',
  ]);
});

test('getOrCreateActiveInviteCode fitness_coach path uses professional invite subcollection', () => {
  assert.deepEqual(buildInviteCodePath('professional-uid', 'fitness_coach'), [
    'professionals',
    'professional-uid',
    'inviteCodes',
    'fitness_coach',
  ]);
});

test('invite code lookup path uses code value as direct lookup id', () => {
  assert.deepEqual(buildInviteCodeLookupPath('FIT123'), ['inviteCodeLookups', 'FIT123']);
});

test('requestRemoveSpecialty calls governed backend endpoint with auth token', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;

  await requestRemoveSpecialty('professional-uid_nutritionist', {
    getCurrentIdToken: async () => 'id-token',
    getRemoveSpecialtyFunctionUrl: () => 'https://example.com/removeProfessionalSpecialty',
    fetchFn: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(capturedUrl, 'https://example.com/removeProfessionalSpecialty');
  assert.equal(capturedInit?.method, 'POST');
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, 'Bearer id-token');
  assert.equal(capturedInit?.body, JSON.stringify({ specialtyId: 'professional-uid_nutritionist' }));
});

test('requestRemoveSpecialty maps backend removal blocker', async () => {
  await assert.rejects(
    () => requestRemoveSpecialty('professional-uid_nutritionist', {
      getCurrentIdToken: async () => 'id-token',
      getRemoveSpecialtyFunctionUrl: () => 'https://example.com/removeProfessionalSpecialty',
      fetchFn: async () => new Response(JSON.stringify({ error: 'removal_blocked' }), { status: 409 }),
    }),
    (error: unknown) => error instanceof ProfessionalSourceError &&
      error.code === 'graphql' &&
      error.message.includes('active/pending students')
  );
});

test('requestRemoveSpecialty maps backend last-specialty blocker', async () => {
  await assert.rejects(
    () => requestRemoveSpecialty('professional-uid_nutritionist', {
      getCurrentIdToken: async () => 'id-token',
      getRemoveSpecialtyFunctionUrl: () => 'https://example.com/removeProfessionalSpecialty',
      fetchFn: async () => new Response(JSON.stringify({ error: 'last_specialty' }), { status: 409 }),
    }),
    (error: unknown) => error instanceof ProfessionalSourceError &&
      error.code === 'graphql' &&
      error.message.includes('last active Specialty')
  );
});
