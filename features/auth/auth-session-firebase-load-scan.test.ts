import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();

test('auth session does not import or require Firebase auth modules', () => {
  const source = readFileSync(join(root, 'features/auth/auth-session.tsx'), 'utf8');

  const forbidden = [
    ['firebase', '/auth'].join(''),
    ['from ', "'./firebase'"].join(''),
    ['from ', '"./firebase"'].join(''),
    ['require', "('./firebase')"].join(''),
    ['require', '("./firebase")'].join(''),
    ['getLegacy', 'FirebaseAuth'].join(''),
    ['onAuth', 'StateChanged'].join(''),
  ];

  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `unexpected Firebase auth-session fallback token: ${token}`);
  }
});

test('auth session attempts local server auth restore before unauthenticated fallback', () => {
  const source = readFileSync(join(root, 'features/auth/auth-session.tsx'), 'utf8');

  assert.match(source, /restoreServerAuthSession/);
  assert.match(source, /await restoreServerAuthSession\(\)/);
});

test('auth session no longer exposes email/password local dev-session helpers', () => {
  const source = readFileSync(join(root, 'features/auth/auth-session.tsx'), 'utf8');

  const staleEmailDevSessionSurface = [
    'createAccountWithServerEmailPassword',
    'signInWithServerEmailPassword',
  ];

  for (const token of staleEmailDevSessionSurface) {
    assert.equal(source.includes(token), false, `auth session still exposes stale email dev-session helper: ${token}`);
  }
});
