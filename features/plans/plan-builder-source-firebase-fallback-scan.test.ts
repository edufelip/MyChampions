import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('plan-builder source Firebase fallback guard', () => {
  it('does not keep Firestore fallback imports, helper deps, or data shapes', () => {
    const sourcePath = path.join(__dirname, 'plan-builder-source.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    const forbiddenMarkers = [
      'firebase/firestore',
      "require('../firestore')",
      'classifyFirestoreError',
      'PlanBuilderFirestore',
      'FirestoreNutritionPlan',
      'FirestoreTrainingPlan',
      'FirestoreStarterTemplate',
      'FirestoreNutritionItem',
      'FirestoreTrainingItem',
      'getFirestoreInstance',
      'getCurrentAuthUid',
      'loadStarterTemplatesFromFirestore',
      'resolvePlanBuilderFoodSearchUser',
      'PlanBuilderFoodSearchUser',
    ];

    const presentMarkers = forbiddenMarkers.filter((marker) => source.includes(marker));
    assert.deepEqual(presentMarkers, []);
  });
});
