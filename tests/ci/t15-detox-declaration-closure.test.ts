import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repositoryRootValue: unknown = process.env.T15_DECLARATION_ROOT;
const repositoryRoot =
  typeof repositoryRootValue === 'string' ? repositoryRootValue : process.cwd();

async function readInventory(): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function scenario(
  inventory: Record<string, unknown>,
  id = 'SCN-connection-ios',
): Record<string, unknown> {
  const scenariosValue: unknown = inventory.scenarios;
  assert(Array.isArray(scenariosValue), 'declaration scenarios are missing');
  const scenarios = scenariosValue as unknown[];
  const result = scenarios.find(
    (value) =>
      Boolean(value) && typeof value === 'object' && (value as Record<string, unknown>).id === id,
  );
  assert(result && typeof result === 'object', `${id} is missing`);
  return result as Record<string, unknown>;
}

void test('generated iOS connection declaration binds the public Detox route closure', async () => {
  const row = scenario(await readInventory());
  const ownerPaths = row.ownerPaths;
  const freshness = row.freshnessInputs;
  assert(Array.isArray(ownerPaths), 'SCN-connection-ios ownerPaths are missing');
  assert(freshness && typeof freshness === 'object', 'SCN-connection-ios freshness is missing');
  const freshnessOwnerPaths = (freshness as Record<string, unknown>).ownerPaths;
  assert(Array.isArray(freshnessOwnerPaths), 'SCN-connection-ios freshness ownerPaths are missing');
  for (const expected of [
    'scripts/testing/native-detox-connection-public-bridge.ts',
    'scripts/testing/native-detox-connection-public-dispatch.ts',
    'scripts/testing/native-detox-connection-public-staging.ts',
  ]) {
    assert(ownerPaths.includes(expected), `${expected} is missing from ownerPaths`);
    assert(
      freshnessOwnerPaths.includes(expected),
      `${expected} is missing from freshness ownerPaths`,
    );
  }
});

void test('generated iOS training declaration binds its selected Detox runtime closure', async () => {
  const row = scenario(await readInventory(), 'SCN-training-ios');
  const ownerPaths = row.ownerPaths;
  const freshness = row.freshnessInputs;
  assert(Array.isArray(ownerPaths), 'SCN-training-ios ownerPaths are missing');
  assert(freshness && typeof freshness === 'object', 'SCN-training-ios freshness is missing');
  const freshnessOwnerPaths = (freshness as Record<string, unknown>).ownerPaths;
  assert(Array.isArray(freshnessOwnerPaths), 'SCN-training-ios freshness ownerPaths are missing');
  for (const expected of [
    'scripts/testing/native-detox-training-public-dispatch.ts',
    'scripts/testing/native-detox-training-public-finalization.ts',
    'scripts/testing/detox-training-child-client.ts',
    'scripts/testing/detox-training-owned-dispatch.ts',
    'scripts/testing/run-native-pilot.ts',
  ]) {
    assert(ownerPaths.includes(expected), `${expected} is missing from training ownerPaths`);
    assert(
      freshnessOwnerPaths.includes(expected),
      `${expected} is missing from training freshness ownerPaths`,
    );
  }
});

void test('every generated scenario owner has a source revision and consistent ownership binding', async () => {
  const inventory = await readInventory();
  const sources = inventory.sources;
  const scenarios = inventory.scenarios;
  assert(Array.isArray(sources), 'source revisions are missing');
  assert(Array.isArray(scenarios), 'scenario declarations are missing');
  for (const value of scenarios as unknown[]) {
    assert(value && typeof value === 'object');
    const row = value as Record<string, unknown>;
    const owners = row.ownerPaths;
    const freshness = row.freshnessInputs;
    assert(Array.isArray(owners));
    assert(freshness && typeof freshness === 'object');
    const input = freshness as Record<string, unknown>;
    assert.deepEqual(input.ownerPaths, owners);
    assert(Array.isArray(input.sourceIds));
    for (const owner of owners as unknown[]) {
      if (owner === 'docs/qa/native-pilot/inventory.json') continue;
      const matching = (sources as unknown[]).filter((source) => {
        if (!source || typeof source !== 'object') return false;
        const paths = (source as Record<string, unknown>).paths;
        return Array.isArray(paths) && paths.includes(owner);
      });
      assert(
        matching.length > 0,
        `${String(row.id)} owner lacks a source revision: ${String(owner)}`,
      );
      for (const source of matching) {
        const declared = source as Record<string, unknown>;
        assert.match(String(declared.revision), /^[a-f0-9]{64}$/);
      }
    }
  }
});
