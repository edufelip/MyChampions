import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('support source does not use Firebase Auth as a token fallback', () => {
  const source = readFileSync(join(process.cwd(), 'features/support/support-source.ts'), 'utf8');

  assert.equal(source.includes('firebase/auth'), false);
  assert.equal(source.includes('@/features/auth/firebase'), false);
  assert.equal(source.includes('getFirebaseAuth'), false);
});
