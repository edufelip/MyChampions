import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('exercise service source does not keep the legacy exercise microservice fallback', () => {
  const source = readFileSync(join(process.cwd(), 'features/plans/exercise-service-source.ts'), 'utf8');
  const forbiddenMarkers = [
    'EXPO_PUBLIC_EXERCISE_SERVICE_URL',
    'getServiceBaseUrl',
    'exerciseservice.eduwaldo.com',
    'searchExercise/catalog',
    'legacy exercise microservice',
  ];

  for (const marker of forbiddenMarkers) {
    assert.equal(source.includes(marker), false, `Unexpected legacy exercise fallback marker: ${marker}`);
  }
});
