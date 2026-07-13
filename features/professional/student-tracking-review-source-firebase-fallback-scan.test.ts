import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('student tracking review source does not keep a Firebase Firestore fallback', () => {
  const source = readFileSync(join(__dirname, 'student-tracking-review-source.ts'), 'utf8');

  assert.equal(source.includes('firebase/firestore'), false);
  assert.equal(source.includes("require('../firestore')"), false);
  assert.equal(source.includes('getStudentTrackingFirestoreModule'), false);
  assert.equal(source.includes('StudentTrackingFirestore'), false);
  assert.equal(source.includes('getFirestoreInstance'), false);
  assert.equal(source.includes('getCurrentAuthUid'), false);
  assert.equal(source.includes('classifyFirestoreError'), false);
  assert.equal(source.includes('FirestorePortionLog'), false);
});
