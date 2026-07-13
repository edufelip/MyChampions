import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const source = readFileSync(join(process.cwd(), 'app/settings/account.tsx'), 'utf8');
const complianceBaseline = readFileSync(
  join(process.cwd(), 'docs/compliance/CP-001-store-and-privacy-baseline-2026-02-26.md'),
  'utf8'
);

function functionBody(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n  \\}`));
  assert.ok(match, `${name} should exist`);
  return match[1];
}

function assertSignOutBeforeClearSession(name: string) {
  const body = functionBody(name);
  const signOutIndex = body.indexOf('signOutFromSource()');
  const clearIndex = body.indexOf('clearSession()');

  assert.notEqual(signOutIndex, -1, `${name} should call signOutFromSource()`);
  assert.notEqual(clearIndex, -1, `${name} should call clearSession()`);
  assert.ok(
    signOutIndex < clearIndex,
    `${name} should call signOutFromSource() before clearSession() so local server sessions are cleared through the source boundary first`
  );
}

test('account sign-out preserves the local server token until source sign-out runs', () => {
  assertSignOutBeforeClearSession('submitSignOut');
});

test('account deletion preserves the local server token until source sign-out runs', () => {
  assertSignOutBeforeClearSession('submitDeletionRequest');
});

test('account deletion does not expose provider reauthentication semantics', () => {
  const body = functionBody('submitDeletionRequest');

  assert.equal(source.includes('currentUser.delete'), false);
  assert.equal(source.includes('reauthenticate'), false);
  assert.equal(source.includes('deleteUser('), false);
  assert.equal(body.includes('requires_recent_login'), false);
});

test('store compliance baseline records local server-owned account deletion evidence', () => {
  assert.equal(
    complianceBaseline.includes(
      'Local implementation status: SC-213 now initiates account deletion through the MyChampions server `DELETE /me` boundary'
    ),
    true
  );
  assert.equal(
    complianceBaseline.includes(
      'A236 repository evidence verified removal of direct account-owned rows and pseudonymization of retained relationship/history rows'
    ),
    true
  );
  assert.equal(
    complianceBaseline.includes(
      'Release gate remains open until iOS and Android platform builds verify the flow end to end'
    ),
    true
  );
});
