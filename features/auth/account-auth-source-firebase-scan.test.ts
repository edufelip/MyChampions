import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('account auth source does not call Firebase Auth fallbacks', () => {
  const source = readFileSync(join(process.cwd(), 'features/auth/account-auth-source.ts'), 'utf8');

  assert.equal(source.includes('firebase/auth'), false);
  assert.equal(source.includes("require('./firebase')"), false);
  assert.equal(source.includes('require("./firebase")'), false);
  assert.equal(source.includes('getFirebaseAuth'), false);
});
