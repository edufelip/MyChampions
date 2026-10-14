import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  nativeConnectionAssertionIds,
  nativeConnectionAssertionSemanticSha256,
  nativeSessionAssertionIds,
  nativeCameraDeniedAssertionIds,
} from '../../scripts/testing/native-pilot-contract';
import { validateNativeInventory } from '../../scripts/testing/validate-native-inventory.mjs';

const root = path.resolve(__dirname, '../..');
type TestDeclaration = {
  views: { captureStatus: string; receiptIds: string[]; conditions?: { platforms: string[] } }[];
  transitions: { toViewId: string }[];
  flows: { transitionIds: string[] }[];
  scenarios: {
    id: string;
    platform: 'ios' | 'android';
    flowId: string;
    dataMode: string;
    fixtureRef: string;
    ownerPaths: string[];
    requirementRefs: string[];
    freshnessInputs: {
      sourceIds: string[];
      requirementPaths: string[];
      ownerPaths: string[];
    };
    pilotAssertions?: {
      id: string;
      requirementRefs: string[];
      evidenceKinds: string[];
    }[];
    pilotAssertionContract?: {
      count: number;
      dataMode: string;
      sha256: string;
      semanticSha256?: string;
    };
  }[];
  receipts: Record<string, unknown>[];
};
const declaration = async () => {
  const value: unknown = JSON.parse(
    readFileSync(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  );
  await validateNativeInventory(value, root);
  // The repository schema/graph has been validated before tests mutate a clone.
  return value as TestDeclaration;
};

void test('native source declaration keeps every platform cell and unknown runtime evidence in denominators', async () => {
  const metrics = await validateNativeInventory(await declaration(), root);
  assert.equal(metrics.views.captured.length, 0);
  assert.equal(metrics.views.denominator.length, 23);
  assert.equal(metrics.transitions.denominator.length, 40);
  assert.equal(metrics.byPlatform.ios.views.denominator.length, 23);
  assert.equal(metrics.byPlatform.android.views.denominator.length, 22);
  assert.equal(metrics.byPlatform.ios.transitions.denominator.length, 40);
  assert.equal(metrics.byPlatform.android.transitions.denominator.length, 38);
  assert.equal(metrics.byPlatform.ios.views.captured.length, 0);
  assert.equal(metrics.byPlatform.android.views.captured.length, 0);
  assert.equal(metrics.behavior.coverage, 'n/a');
  assert.deepEqual(metrics.disposition, { passing: 0, denominator: 10, untested: 10 });
  for (const scenario of (await declaration()).scenarios) {
    assert.ok(scenario.ownerPaths.includes('scripts/testing/native-host-contention.ts'));
    assert.ok(scenario.freshnessInputs.sourceIds.includes('SRC-host-preflight-source'));
    assert.ok(
      scenario.freshnessInputs.ownerPaths.includes('scripts/testing/native-host-contention.ts'),
    );
  }
});

void test('connection declaration carries the same ordered seven-row contract for both platforms and both engine cells', async () => {
  const declared = await declaration();
  const scenarios = (['ios', 'android'] as const).map((platform) => {
    const scenario = declared.scenarios.find((row) => row.id === `SCN-connection-${platform}`);
    assert.ok(scenario);
    assert.equal(scenario.platform, platform);
    assert.equal(scenario.flowId, 'FLW-connection');
    assert.equal(scenario.dataMode, 'postgres');
    assert.equal(scenario.fixtureRef, `owned-postgres:SCN-connection-${platform}:fresh-attempt`);
    assert.deepEqual(
      scenario.pilotAssertions?.map((row) => row.id),
      nativeConnectionAssertionIds,
    );
    assert.equal(scenario.pilotAssertionContract?.count, nativeConnectionAssertionIds.length);
    assert.equal(scenario.pilotAssertionContract?.dataMode, 'postgres');
    assert.match(scenario.pilotAssertionContract?.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(
      scenario.pilotAssertionContract?.semanticSha256,
      nativeConnectionAssertionSemanticSha256,
    );
    assert.ok(scenario.ownerPaths.includes('scripts/testing/native-connection-observation.ts'));
    assert.ok(scenario.ownerPaths.includes('scripts/testing/native-view-evidence.ts'));
    assert.ok(scenario.ownerPaths.includes('app/professional/home.tsx'));
    assert.ok(
      scenario.ownerPaths.includes('docs/plans/2026-09-29-testing-modernization-start-here.md'),
    );
    assert.ok(
      scenario.ownerPaths.includes(
        'docs/plans/2026-09-29-testing-modernization-implementation-handoff.md',
      ),
    );
    assert.ok(scenario.freshnessInputs.sourceIds.includes('SRC-connection-observation-source'));
    assert.ok(scenario.freshnessInputs.sourceIds.includes('SRC-connection-view-verifier-source'));
    assert.ok(scenario.freshnessInputs.sourceIds.includes('SRC-home-source'));
    assert.ok(scenario.freshnessInputs.sourceIds.includes('SRC-testing-start-here-source'));
    assert.ok(scenario.freshnessInputs.sourceIds.includes('SRC-testing-handoff-source'));
    assert.ok(scenario.freshnessInputs.sourceIds.includes('SRC-pro-doc'));
    for (const assertion of scenario.pilotAssertions ?? []) {
      assert(
        assertion.requirementRefs.every((ref) => scenario.requirementRefs.includes(ref)),
        `Assertion ${assertion.id} references an undeclared requirement`,
      );
    }
    assert.ok(
      scenario.freshnessInputs.requirementPaths.includes(
        'docs/screens/v2/SC-204-professional-home-dashboard.md',
      ),
    );
    return scenario;
  });
  assert.deepEqual(scenarios[1].pilotAssertions, scenarios[0].pilotAssertions);
  assert.deepEqual(scenarios[1].pilotAssertionContract, scenarios[0].pilotAssertionContract);
});

void test('session and camera declarations carry identical ordered contracts for both platforms and both engine cells', async () => {
  const declared = await declaration();
  const expected = {
    session: nativeSessionAssertionIds,
    'camera-denied': nativeCameraDeniedAssertionIds,
  } as const;
  for (const family of ['session', 'camera-denied'] as const) {
    const scenarios = (['ios', 'android'] as const).map((platform) => {
      const scenario = declared.scenarios.find((row) => row.id === `SCN-${family}-${platform}`);
      assert.ok(scenario);
      assert.equal(scenario.platform, platform);
      assert.equal(scenario.flowId, `FLW-${family}`);
      assert.equal(scenario.dataMode, 'postgres');
      assert.equal(scenario.fixtureRef, `owned-postgres:SCN-${family}-${platform}:fresh-attempt`);
      assert.deepEqual(
        scenario.pilotAssertions?.map((row) => row.id),
        expected[family],
      );
      assert.equal(scenario.pilotAssertionContract?.count, expected[family].length);
      assert.equal(scenario.pilotAssertionContract?.dataMode, 'postgres');
      assert.match(scenario.pilotAssertionContract?.sha256 ?? '', /^[a-f0-9]{64}$/);
      for (const assertion of scenario.pilotAssertions ?? [])
        assert(
          assertion.requirementRefs.every((ref) => scenario.requirementRefs.includes(ref)),
          `Assertion ${assertion.id} references an undeclared requirement`,
        );
      return scenario;
    });
    assert.deepEqual(scenarios[1].pilotAssertions, scenarios[0].pilotAssertions);
    assert.deepEqual(scenarios[1].pilotAssertionContract, scenarios[0].pilotAssertionContract);
  }
});

void test('native declaration rejects missing cells, broken traceability and paths outside the owner repository', async () => {
  const missing = await declaration();
  missing.scenarios.pop();
  await assert.rejects(() => validateNativeInventory(missing, root), /cell missing/);
  const broken = await declaration();
  broken.transitions[0].toViewId = 'SCR-does-not-exist';
  await assert.rejects(() => validateNativeInventory(broken, root), /Unknown views/);
  const escaped = await declaration();
  escaped.scenarios[0].ownerPaths = ['../server/package.json'];
  await assert.rejects(() => validateNativeInventory(escaped, root), /owner path/);
  const disconnected = await declaration();
  disconnected.flows[0].transitionIds.reverse();
  await assert.rejects(() => validateNativeInventory(disconnected, root), /disconnected/);
  const wrongPlatform = await declaration();
  wrongPlatform.views[0].conditions = { platforms: ['web'] };
  await assert.rejects(
    () => validateNativeInventory(wrongPlatform, root),
    /invalid platform scope/,
  );
});

void test('native declarations cannot claim capture or passing behavior without corresponding target receipts', async () => {
  const captured = await declaration();
  captured.views[0].captureStatus = 'runtime-captured';
  await assert.rejects(() => validateNativeInventory(captured, root), /receipts links/);
  const tested = await declaration();
  Object.assign(tested.scenarios[0], {
    behaviorStatus: 'tested',
    freshness: 'current',
    readiness: 'ready',
    receiptIds: ['REC-fake'],
  });
  tested.receipts.push({
    id: 'REC-fake',
    timestamp: '2026-09-28T00:00:00Z',
    commit: 'fake',
    target: 'ios',
    result: 'passed',
    scenarioIds: [tested.scenarios[0].id],
    platform: 'android',
    build: 'unknown',
    device: 'unknown',
    inputFingerprint: 'a'.repeat(64),
    evidencePaths: [],
  });
  await assert.rejects(
    () => validateNativeInventory(tested, root),
    /exact target passing evidence/,
  );
  const linked = await declaration();
  linked.views[0].captureStatus = 'runtime-captured';
  linked.views[0].receiptIds = ['REC-linked'];
  linked.receipts.push({
    id: 'REC-linked',
    timestamp: '2026-09-29T00:00:00Z',
    commit: 'a'.repeat(40),
    target: 'ios',
    result: 'observed',
    scenarioIds: ['SCN-session-ios'],
    platform: 'ios',
    build: 'b'.repeat(64),
    device: 'unit-test-device',
    fixtureRef: 'unit-fixture',
    inputFingerprint: 'c'.repeat(64),
    artifactRoot: '.qa/artifacts/native-pilot/' + '0'.repeat(24),
    evidencePaths: ['nonexistent.png'],
  });
  await assert.rejects(() => validateNativeInventory(linked, root), /ENOENT/);
});
