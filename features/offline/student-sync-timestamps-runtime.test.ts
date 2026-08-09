import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const projectRoot = process.cwd();

function readProjectFile(path: string): string {
  return readFileSync(join(projectRoot, path), 'utf8');
}

test('student screens feed real server-backed sync timestamps into offline display state', () => {
  for (const path of [
    'app/student/home.tsx',
    'app/student/nutrition.tsx',
    'app/student/training.tsx',
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

test('shared server-backed load states expose lastSyncedAtIso for offline freshness', () => {
  const waterHook = readProjectFile('features/nutrition/use-water-tracking.ts');
  const connectionsHook = readProjectFile('features/connections/use-connections.ts');
  const plansStore = readProjectFile('features/plans/plans-store.ts');

  assert.match(waterHook, /lastSyncedAtIso: string/);
  assert.match(connectionsHook, /lastSyncedAtIso: string/);
  assert.match(plansStore, /lastSyncedAtIso: string/);
});
