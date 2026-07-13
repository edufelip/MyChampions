import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

function readProjectFile(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

test('root auth guard passes the safe return target from router params', () => {
  const source = readProjectFile('app/_layout.tsx');

  assert.match(source, /useGlobalSearchParams/);
  assert.match(source, /normalizeAuthReturnTo/);
  assert.match(source, /returnTo: authReturnTo/);
});

test('sign-in and create-account screens preserve shared recipe return targets', () => {
  const signIn = readProjectFile('app/auth/sign-in.tsx');
  const createAccount = readProjectFile('app/auth/create-account.tsx');

  assert.match(signIn, /useLocalSearchParams/);
  assert.match(signIn, /normalizeAuthReturnTo/);
  assert.match(signIn, /router\.push\(buildAuthRoute\('\/auth\/create-account'\)/);

  assert.match(createAccount, /useLocalSearchParams/);
  assert.match(createAccount, /normalizeAuthReturnTo/);
  assert.match(createAccount, /router\.replace\(buildAuthRoute\('\/auth\/sign-in'\)/);
});

test('role selection and shared recipe route no longer document deferred resume behavior', () => {
  const roleSelection = readProjectFile('app/auth/role-selection.tsx');
  const sharedRecipe = readProjectFile('app/shared/recipes/[shareToken].tsx');

  assert.match(roleSelection, /returnTo \?\? resolvePostRoleRoute\(role\)/);
  assert.equal(sharedRecipe.includes('redirect-back mechanism (deep-link resume) is deferred'), false);
});
