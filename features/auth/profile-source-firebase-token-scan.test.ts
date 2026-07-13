import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('profile source does not read Firebase Auth for default access tokens', () => {
  const source = readFileSync(join(process.cwd(), 'features/auth/profile-source.ts'), 'utf8');

  assert.equal(source.includes('firebase/auth'), false);
  assert.equal(source.includes("require('./firebase')"), false);
  assert.equal(source.includes('require("./firebase")'), false);
  assert.equal(source.includes('getFirebaseAuth'), false);
});
