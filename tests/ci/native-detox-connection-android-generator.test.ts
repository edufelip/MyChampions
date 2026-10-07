import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

type SourceRow = { id: string; paths: string[]; revision: string };
type Scenario = {
  id: string;
  ownerPaths: string[];
  freshnessInputs: { ownerPaths: string[]; sourceIds: string[] };
};
type Inventory = { sources: SourceRow[]; scenarios: Scenario[] };

const candidatePaths = [
  'scripts/testing/native-detox-connection-android-public-dispatch.ts',
  'scripts/testing/native-detox-connection-android-public-staging.ts',
  'scripts/testing/detox-android-connection-producer.ts',
  'scripts/testing/verify-owned-android-detox-connection-cleanup.ts',
  'scripts/testing/native-connection-engine-contract.ts',
] as const;

async function inventory(): Promise<Inventory> {
  const source = await readFile(path.join('docs/qa/native-pilot', 'inventory.json'), 'utf8');
  return JSON.parse(source) as Inventory;
}

void test('generated Android Detox declaration binds every public route source to owner and freshness ledgers', async () => {
  const value = await inventory();
  const connection = value.scenarios.find((row) => row.id === 'SCN-connection-android');
  assert(connection, 'Android connection scenario is absent from generated declaration');
  assert.deepEqual(connection.freshnessInputs.ownerPaths, connection.ownerPaths);
  const sourceByPath = new Map(
    value.sources.flatMap((row) => row.paths.map((path) => [path, row] as const)),
  );
  const sourceIds = new Set(connection.freshnessInputs.sourceIds);
  for (const relative of candidatePaths) {
    assert(connection.ownerPaths.includes(relative), `owner path missing ${relative}`);
    const row = sourceByPath.get(relative);
    assert(row, `source row missing ${relative}`);
    assert.equal(row.paths.length, 1);
    assert(sourceIds.has(row.id), `freshness source link missing ${row.id}`);
    const bytes: Buffer = await readFile(relative);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      row.revision,
      `generated revision is stale for ${relative}`,
    );
  }
});

void test('generated Android Detox route retains the shared connection assertion contract', async () => {
  const value = await inventory();
  const connection = value.scenarios.find((row) => row.id === 'SCN-connection-android');
  assert(connection);
  assert(connection.ownerPaths.includes('scripts/testing/run-native-pilot.ts'));
  assert(connection.ownerPaths.includes('scripts/testing/detox-integrated-connection-driver.ts'));
  assert(
    connection.ownerPaths.includes('scripts/testing/native-detox-connection-public-dispatch.ts'),
  );
});
