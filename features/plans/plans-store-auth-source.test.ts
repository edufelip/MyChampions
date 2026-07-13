import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePlansAuthUid } from './plans-auth-source';

test('plans auth uid resolver prefers the MyChampions server user without touching Firebase', () => {
  const uid = resolvePlansAuthUid({
    getServerUserUid: () => 'local-server-user',
    getE2EUid: () => 'e2e-user',
  });

  assert.equal(uid, 'local-server-user');
});

test('plans auth uid resolver uses the E2E uid when no server session exists', () => {
  const uid = resolvePlansAuthUid({
    getServerUserUid: () => null,
    getE2EUid: () => 'e2e-user',
  });

  assert.equal(uid, 'e2e-user');
});

test('plans auth uid resolver fails closed when no local auth source exists', () => {
  const uid = resolvePlansAuthUid({
    getServerUserUid: () => null,
    getE2EUid: () => null,
  });

  assert.equal(uid, null);
});
