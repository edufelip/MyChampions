import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('workout log source does not keep a Firebase Firestore fallback', () => {
  const source = readFileSync(join(process.cwd(), 'features/training/workout-log-source.ts'), 'utf8');

  assert.equal(source.includes('firebase/firestore'), false);
  assert.equal(source.includes("require('../firestore')"), false);
  assert.equal(source.includes('getFirestoreInstance'), false);
  assert.equal(source.includes('getCurrentAuthUid'), false);
  assert.equal(source.includes('FirestoreWorkoutLog'), false);
  assert.equal(source.includes('workoutLogs'), false);
});
