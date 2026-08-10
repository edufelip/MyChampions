import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('plan source does not keep Firebase Firestore fallback code', () => {
  const source = readFileSync(join(__dirname, 'plan-source.ts'), 'utf8');
  const forbiddenSnippets = [
    'firebase/firestore',
    "require('../firestore')",
    'classifyFirestoreError',
    'PlanFirestore',
    'FirestoreNutritionPlan',
    'FirestoreTrainingPlan',
    'FirestorePlanChangeRequest',
    'FirestorePlanVisibilityInput',
    'getFirestoreInstance',
    'getCurrentAuthUid',
  ];

  for (const snippet of forbiddenSnippets) {
    assert.equal(
      source.includes(snippet),
      false,
      `Unexpected plan-source Firebase fallback snippet: ${snippet}`,
    );
  }
});
