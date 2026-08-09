import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('water tracking source does not keep a Firebase Firestore fallback', () => {
  const source = readFileSync(
    join(process.cwd(), 'features/nutrition/water-tracking-source.ts'),
    'utf8',
  );

  assert.equal(source.includes('firebase/firestore'), false);
  assert.equal(source.includes("require('../firestore')"), false);
  assert.equal(source.includes('getFirestoreInstance'), false);
  assert.equal(source.includes('getCurrentAuthUid'), false);
  assert.equal(source.includes('FirestoreWater'), false);
  assert.equal(source.includes('waterLogs'), false);
  assert.equal(source.includes('waterGoals'), false);
  assert.equal(source.includes('nutritionPlans'), false);
  assert.equal(source.includes('connections'), false);
});
