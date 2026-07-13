import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('connection invite submission does not use provider-token function fallback', () => {
  const source = readFileSync(join(process.cwd(), 'features/connections/connection-source.ts'), 'utf8');
  const legacyTokenProperty = ['get', 'Current', 'Id', 'Token'].join('');
  const legacyFunctionUrlProperty = ['get', 'Submit', 'Invite', 'Function', 'Url'].join('');
  const legacyEnvVar = ['EXPO_PUBLIC', 'SUBMIT_INVITE', 'FUNCTION_URL'].join('_');
  const legacyFirebaseAuth = ['get', 'Firebase', 'Auth'].join('');
  const legacyRequestHelper = ['request', 'Submit', 'Invite', 'Code'].join('');

  assert.equal(source.includes(legacyTokenProperty), false);
  assert.equal(source.includes(legacyFunctionUrlProperty), false);
  assert.equal(source.includes(legacyEnvVar), false);
  assert.equal(source.includes(legacyFirebaseAuth), false);
  assert.equal(source.includes(legacyRequestHelper), false);
});
