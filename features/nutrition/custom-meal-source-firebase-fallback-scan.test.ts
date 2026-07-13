import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('custom meal source does not keep a Firebase Firestore fallback', () => {
  const source = readFileSync(join(__dirname, 'custom-meal-source.ts'), 'utf8');

  assert.equal(source.includes('firebase/firestore'), false);
  assert.equal(source.includes("require('../firestore')"), false);
  assert.equal(source.includes('classifyFirestoreError'), false);
  assert.equal(source.includes('CustomMealFirestore'), false);
  assert.equal(source.includes('FirestoreCustomMeal'), false);
  assert.equal(source.includes('FirestoreMealShareLink'), false);
  assert.equal(source.includes('FirestorePortionLog'), false);
  assert.equal(source.includes('getFirestoreInstance'), false);
  assert.equal(source.includes('getCurrentAuthUid'), false);
});
