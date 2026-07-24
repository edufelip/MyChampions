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

  it('keeps browser fetch receiver-safe for default and fallback dependencies', () => {
    const sourcePath = path.join(__dirname, 'plan-builder-source.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /fetchFn: globalThis\.fetch\.bind\(globalThis\)/);
    assert.match(source, /const sourceFetch = deps\.fetchFn \?\? globalThis\.fetch/);
    assert.match(
      source,
      /Reflect\.apply\(sourceFetch, globalThis, \[input, init\]\)/
    );
    assert.doesNotMatch(source, /fetchFn: fetch[,;]/);
    assert.doesNotMatch(source, /deps\.fetchFn \?\? fetch/);
  });
});
