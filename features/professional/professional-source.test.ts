import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInviteCodePath } from './professional-source';

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
