import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInviteCodeLookupPath, buildInviteCodePath } from './professional-source';

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
