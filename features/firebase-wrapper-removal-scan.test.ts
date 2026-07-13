import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('mobile feature tree no longer keeps the dead Firestore wrapper modules', () => {
  const removedWrappers = [
    'features/firestore.ts',
    'features/firestore-error.ts',
  ];

  for (const relativePath of removedWrappers) {
    assert.equal(
      existsSync(join(process.cwd(), relativePath)),
      false,
      `${relativePath} should not exist after Firestore source migration`
    );
  }
});
