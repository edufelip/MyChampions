import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { selectNativePilotScenario } from '../../scripts/testing/native-pilot-contract';

type SourceRow = {
  id: string;
  kind: string;
  ref: string;
  paths: string[];
  revision: string;
};
type Inventory = {
  sources: SourceRow[];
  scenarios: {
    id: string;
    ownerPaths?: string[];
    freshnessInputs: { sourceIds?: string[]; ownerPaths?: string[]; requirementPaths: string[] };
    [key: string]: unknown;
  }[];
  [key: string]: unknown;
};

const repositoryRoot = process.cwd();
const staticDispatchPaths = [
  'scripts/testing/android-session-charter.ts',
  'scripts/testing/detox-android-session-storage-producer.ts',
  'scripts/testing/detox-connection-actionability.ts',
  'scripts/testing/detox-connection-evidence.ts',
  'scripts/testing/detox-connection-ipc.ts',
  'scripts/testing/detox-connection-lifecycle.ts',
  'scripts/testing/detox-integrated-connection-baseline.ts',
  'scripts/testing/detox-integrated-connection-driver.ts',
  'scripts/testing/detox-integrated-session-baseline.ts',
  'scripts/testing/detox-native-hierarchy.ts',
  'scripts/testing/detox-session-cache-observation.ts',
  'scripts/testing/detox-session-cancel-evidence.ts',
  'scripts/testing/detox-session-final-transport.ts',
  'scripts/testing/detox-training-child-client.ts',
  'scripts/testing/detox-training-child-protocol.mjs',
  'scripts/testing/detox-training-journey.ts',
  'scripts/testing/detox-training-owned-dispatch.ts',
  'scripts/testing/native-android-session-adapter.ts',
] as const;
// Keep the exact candidate IDs explicit: this is the transfer contract, not a
// permissive path-derived fallback. The generator uses the same stable map.
const staticSourceIds: Record<string, string> = {
  'scripts/testing/android-session-charter.ts': 'SRC-detox-dispatch-android-session-charter-source',
  'scripts/testing/detox-android-session-storage-producer.ts':
    'SRC-detox-dispatch-android-session-storage-producer-source',
  'scripts/testing/detox-connection-actionability.ts':
    'SRC-detox-dispatch-connection-actionability-source',
  'scripts/testing/detox-connection-evidence.ts': 'SRC-detox-dispatch-connection-evidence-source',
  'scripts/testing/detox-connection-ipc.ts': 'SRC-detox-dispatch-connection-ipc-source',
  'scripts/testing/detox-connection-lifecycle.ts': 'SRC-detox-dispatch-connection-lifecycle-source',
  'scripts/testing/detox-integrated-connection-baseline.ts':
    'SRC-detox-dispatch-integrated-connection-baseline-source',
  'scripts/testing/detox-integrated-connection-driver.ts':
    'SRC-detox-dispatch-integrated-connection-driver-source',
  'scripts/testing/detox-integrated-session-baseline.ts':
    'SRC-detox-dispatch-integrated-session-baseline-source',
  'scripts/testing/detox-native-hierarchy.ts': 'SRC-detox-dispatch-native-hierarchy-source',
  'scripts/testing/detox-session-cache-observation.ts':
    'SRC-detox-dispatch-session-cache-observation-source',
  'scripts/testing/detox-session-cancel-evidence.ts':
    'SRC-detox-dispatch-session-cancel-evidence-source',
  'scripts/testing/detox-session-final-transport.ts':
    'SRC-detox-dispatch-session-final-transport-source',
  'scripts/testing/detox-training-child-client.ts':
    'SRC-detox-dispatch-training-child-client-source',
  'scripts/testing/detox-training-child-protocol.mjs':
    'SRC-detox-dispatch-training-child-protocol-source',
  'scripts/testing/detox-training-journey.ts': 'SRC-detox-dispatch-training-journey-source',
  'scripts/testing/detox-training-owned-dispatch.ts':
    'SRC-detox-dispatch-training-owned-dispatch-source',
  'scripts/testing/native-android-session-adapter.ts':
    'SRC-detox-dispatch-native-android-session-adapter-source',
};

function inventoryWithDispatchRows(): Inventory {
  return JSON.parse(
    readFileSync(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as Inventory;
}
function connectionScenario(inventory: Inventory) {
  const scenario = inventory.scenarios.find((row) => row.id === 'SCN-connection-ios');
  assert(scenario?.ownerPaths && scenario.freshnessInputs.ownerPaths);
  return scenario;
}
async function select(inventory: Inventory, root = repositoryRoot) {
  return selectNativePilotScenario(
    { platform: 'ios', engine: 'detox', scenario: 'SCN-connection-ios', mode: 'integration' },
    inventory,
    root,
  );
}

void test('pre-repair inventory rejects unbound static dispatch inputs before acquisition', async () => {
  const inventory = inventoryWithDispatchRows();
  const staticIds = new Set(staticDispatchPaths.map((relative) => staticSourceIds[relative]));
  inventory.sources = inventory.sources.filter((source) => !staticIds.has(source.id));
  const scenario = connectionScenario(inventory);
  scenario.freshnessInputs.sourceIds = scenario.freshnessInputs.sourceIds!.filter(
    (id) => !staticIds.has(id),
  );
  await assert.rejects(select(inventory), /Unknown sources link|lacks a source revision/);
});

void test('connection dispatch selection accepts complete source rows and owner/source bindings', async () => {
  const selection = await select(inventoryWithDispatchRows());
  assert.equal(selection.scenario.id, 'SCN-connection-ios');
});

void test('selection rejects an omitted dispatch owner path before runtime acquisition', async () => {
  const inventory = inventoryWithDispatchRows();
  const scenario = connectionScenario(inventory);
  scenario.ownerPaths = scenario.ownerPaths!.filter(
    (relative) => relative !== staticDispatchPaths[0],
  );
  scenario.freshnessInputs.ownerPaths = scenario.freshnessInputs.ownerPaths!.filter(
    (relative) => relative !== staticDispatchPaths[0],
  );
  await assert.rejects(select(inventory), /omits Detox dispatch owner path|omits producer helper/);
});

void test('selection rejects a swapped dispatch owner path before runtime acquisition', async () => {
  const inventory = inventoryWithDispatchRows();
  const scenario = connectionScenario(inventory);
  const index = scenario.ownerPaths!.indexOf(staticDispatchPaths[0]);
  scenario.ownerPaths![index] = 'app/auth/sign-in.tsx';
  scenario.freshnessInputs.ownerPaths![index] = 'app/auth/sign-in.tsx';
  await assert.rejects(select(inventory), /omits Detox dispatch owner path|omits producer helper/);
});

void test('selection rejects omitted or swapped dispatch source IDs', async () => {
  const omitted = inventoryWithDispatchRows();
  const omittedScenario = connectionScenario(omitted);
  omittedScenario.freshnessInputs.sourceIds = omittedScenario.freshnessInputs.sourceIds!.filter(
    (id) => id !== staticSourceIds[staticDispatchPaths[0]],
  );
  await assert.rejects(select(omitted), /Detox dispatch source link is missing/);

  const swapped = inventoryWithDispatchRows();
  const swappedScenario = connectionScenario(swapped);
  const sourceIds = swappedScenario.freshnessInputs.sourceIds!;
  const index = sourceIds.indexOf(staticSourceIds[staticDispatchPaths[0]]);
  sourceIds[index] = 'SRC-auth-source';
  await assert.rejects(select(swapped), /Detox dispatch source link is missing/);
});

void test('selection rejects a removed dispatch revision row', async () => {
  const inventory = inventoryWithDispatchRows();
  const removedId = staticSourceIds[staticDispatchPaths[0]];
  inventory.sources = inventory.sources.filter((source) => source.id !== removedId);
  await assert.rejects(select(inventory), /Unknown sources link|lacks a source revision/);
});

void test('selection rejects changed dependency bytes in a real isolated source tree', async () => {
  const inventory = inventoryWithDispatchRows();
  const isolatedRoot = mkdtempSync(path.join(tmpdir(), 'mc-dispatch-freshness-'));
  try {
    for (const relative of new Set([
      ...inventory.sources.flatMap((row) => row.paths),
      'docs/qa/native-pilot/inventory.json',
    ])) {
      const destination = path.join(isolatedRoot, relative);
      mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      copyFileSync(path.join(repositoryRoot, relative), destination);
      chmodSync(destination, 0o600);
    }
    await select(inventory, isolatedRoot);
    const changed = path.join(isolatedRoot, staticDispatchPaths[0]);
    writeFileSync(changed, readFileSync(changed, 'utf8') + '\n');
    await assert.rejects(select(inventory, isolatedRoot), /stale governing inputs/);
  } finally {
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
});

void test('selection rejects freshness owner arrays that drift from the selected owner set', async () => {
  const inventory = inventoryWithDispatchRows();
  const scenario = connectionScenario(inventory);
  scenario.freshnessInputs.ownerPaths![0] = 'app/auth/sign-in.tsx';
  await assert.rejects(select(inventory), /freshness owner paths do not bind/);
});
