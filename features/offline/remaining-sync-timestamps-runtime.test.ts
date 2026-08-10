import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const projectRoot = process.cwd();

function readProjectFile(path: string): string {
  return readFileSync(join(projectRoot, path), 'utf8');
}

test('remaining offline-aware screens feed server-backed sync timestamps into offline display state', () => {
  for (const path of [
    'app/professional/home.tsx',
    'app/professional/pending.tsx',
    'app/professional/specialty.tsx',
    'app/professional/student-profile.tsx',
    'app/professional/students.tsx',
    'app/professional/subscription.tsx',
    'app/settings/account.tsx',
    'app/(tabs)/nutrition/custom-meals/index.tsx',
    'app/(tabs)/nutrition/custom-meals/[mealId].tsx',
    'app/shared/recipes/[shareToken].tsx',
  ]) {
    const source = readProjectFile(path);

    assert.match(source, /resolveLatestSyncTimestamp/, `${path} should derive a sync timestamp`);
    assert.doesNotMatch(
      source,
      /resolveOfflineDisplayState\(\{\s*networkStatus,\s*lastSyncedAtIso:\s*null,/,
      `${path} should not hard-code a null sync timestamp`,
    );
  }
});

test('remaining shared server-backed load states expose lastSyncedAtIso for offline freshness', () => {
  const professionalHook = readProjectFile('features/professional/use-professional.ts');
  const customMealsHook = readProjectFile('features/nutrition/use-custom-meals.ts');
  const subscriptionHook = readProjectFile('features/subscription/use-subscription.ts');

  assert.match(professionalHook, /lastSyncedAtIso: string/);
  assert.match(customMealsHook, /lastSyncedAtIso: string/);
  assert.match(subscriptionHook, /lastSyncedAtIso: string/);
});
