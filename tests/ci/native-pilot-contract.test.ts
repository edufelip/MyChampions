import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertNativePilotCompletion,
  parseNativePilotArguments,
  requireNativePilotAssertions,
  selectNativePilotScenario,
  nativePilotTargetFromCapture,
  nativeConnectionAssertionIds,
  nativeConnectionAssertionSemanticSha256,
  nativeSessionAssertionIds,
  nativeCameraDeniedAssertionIds,
} from '../../scripts/testing/native-pilot-contract';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';
type TestInventory = {
  scenarios: NativePilotSelection['scenario'][];
  sources: { paths: string[]; revision: string }[];
};

const repository = path.resolve(__dirname, '../..');

void test('native target projection preserves actual platform identities without cross-platform fallback', () => {
  const build = {
    profile: 'owned-dev-build',
    binaryHash: 'a'.repeat(64),
    apiOrigin: 'http://127.0.0.1:33123',
  };
  const android = nativePilotTargetFromCapture('android', {
    platform: 'android',
    device: { serial: 'emulator-5554', osVersion: '17', runtime: 'foreign-ios-runtime' },
    build: { ...build, appId: 'com.example.android', bundleId: 'foreign.ios.app' },
  });
  assert.deepEqual(android, {
    deviceId: 'emulator-5554',
    osVersion: '17',
    appId: 'com.example.android',
    buildProfile: build.profile,
    binaryHash: build.binaryHash,
    apiOrigin: build.apiOrigin,
  });
  const ios = nativePilotTargetFromCapture('ios', {
    platform: 'ios',
    device: { udid: 'owned-ios-device', runtime: 'iOS-18-6', serial: 'foreign-android' },
    build: { ...build, bundleId: 'com.example.ios', appId: 'foreign.android.app' },
  });
  assert.deepEqual(ios, {
    deviceId: 'owned-ios-device',
    osVersion: 'iOS-18-6',
    appId: 'com.example.ios',
    buildProfile: build.profile,
    binaryHash: build.binaryHash,
    apiOrigin: build.apiOrigin,
  });
  for (const platform of ['ios', 'android'] as const) {
    const absent = nativePilotTargetFromCapture(platform);
    assert(Object.values(absent).every((value) => value === null));
    const foreignFields =
      platform === 'ios'
        ? { device: { serial: 'foreign', osVersion: '17' }, build: { appId: 'foreign' } }
        : { device: { udid: 'foreign', runtime: 'iOS-18-6' }, build: { bundleId: 'foreign' } };
    assert.deepEqual(
      nativePilotTargetFromCapture(platform, { platform, ...foreignFields }),
      absent,
    );
  }
});

void test('native target projection rejects crossed platforms and malformed original metadata', () => {
  for (const platform of ['ios', 'android'] as const) {
    for (const capture of [
      null,
      [],
      'bad',
      {},
      { platform: platform === 'ios' ? 'android' : 'ios' },
    ])
      assert.throws(() => nativePilotTargetFromCapture(platform, capture));
    for (const partial of [
      { device: [] },
      { build: [] },
      { device: 'bad' },
      { build: { profile: '' } },
      { build: { binaryHash: 'short' } },
      { build: { apiOrigin: 123 } },
      { build: { profile: ' padded ' } },
      { device: platform === 'ios' ? { udid: 123 } : { serial: 123 } },
      { device: platform === 'ios' ? { runtime: '' } : { osVersion: '' } },
    ])
      assert.throws(() => nativePilotTargetFromCapture(platform, { platform, ...partial }));
  }
});

const argv = [
  '--platform',
  'ios',
  '--engine',
  'maestro',
  '--scenario',
  'SCN-save-retry-ios',
  '--mode',
  'integration',
];
async function inventory(): Promise<TestInventory> {
  return JSON.parse(
    await readFile(path.join(repository, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as TestInventory;
}

void test('native argument parsing rejects ambiguous/incomplete inputs before any acquisition', () => {
  const expected = {
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-save-retry-ios',
    mode: 'integration',
  };
  assert.deepEqual(parseNativePilotArguments(argv), expected);
  assert.deepEqual(
    parseNativePilotArguments(
      Object.entries(expected)
        .reverse()
        .map(([k, v]) => `--${k}=${v}`),
    ),
    expected,
  );
  for (const bad of [
    [],
    argv.slice(0, -2),
    [...argv, '--engine=detox'],
    [...argv, 'extra'],
    [...argv, '--deadline-ms=100'],
    ['--platform'],
    argv.map((v) => (v === 'ios' ? 'web' : v)),
    argv.map((v) => (v === 'maestro' ? 'agent' : v)),
    argv.map((v) => (v === 'integration' ? 'postgres' : v)),
    argv.map((v) => (v === 'ios' ? ' ios' : v)),
    argv.map((v) => (v === 'SCN-save-retry-ios' ? '../secret' : v)),
    argv.map((v) => (v === 'SCN-save-retry-ios' ? '' : v)),
    [...argv, '--'],
    ['--platform=', ...argv.slice(2)],
    ['--platform', '--engine', ...argv.slice(3)],
  ])
    assert.throws(() => parseNativePilotArguments(bad));
});

void test('selection derives all cells from the canonical declaration; unknown/platform/flow/stale declarations block', async () => {
  const declared = await inventory();
  for (const row of declared.scenarios)
    for (const engine of ['maestro'])
      for (const mode of ['fixture', 'integration']) {
        const args = parseNativePilotArguments([
          `--platform=${row.platform}`,
          `--engine=${engine}`,
          `--scenario=${row.id}`,
          `--mode=${mode}`,
        ]);
        const selected = await selectNativePilotScenario(args, declared, repository);
        assert.equal(selected.scenario.id, row.id);
        assert.deepEqual(selected.scenario.transitionIds, row.transitionIds);
        assert.match(selected.scenarioHash, /^[a-f0-9]{64}$/);
        assert.match(selected.requirementHash, /^[a-f0-9]{64}$/);
      }
  const args = parseNativePilotArguments(argv);
  const missingLedger = await selectNativePilotScenario(args, declared, repository);
  delete missingLedger.scenario.pilotAssertions;
  assert.throws(() => requireNativePilotAssertions(missingLedger), /ledger/);
  await assert.rejects(
    selectNativePilotScenario({ ...args, scenario: 'SCN-unknown-ios' }, declared, repository),
  );
  await assert.rejects(
    selectNativePilotScenario({ ...args, platform: 'android' }, declared, repository),
  );
  for (const alter of [
    (x: TestInventory) => x.scenarios.push(structuredClone(x.scenarios[0])),
    (x: TestInventory) => x.scenarios.find((r) => r.id === args.scenario)!.transitionIds.pop(),
    (x: TestInventory) => {
      x.sources[0].revision = '0'.repeat(64);
    },
    (x: TestInventory) => {
      x.sources[0].paths = ['../server/package.json'];
    },
  ]) {
    const bad = structuredClone(declared);
    alter(bad);
    await assert.rejects(selectNativePilotScenario(args, bad, repository));
  }
});

void test('native completion rejects false pass, altered identity, missing core proof and invalid artifacts; synthetic control only', async () => {
  const declared = await inventory();
  const args = parseNativePilotArguments(
    argv.map((value) => (value === 'SCN-save-retry-ios' ? 'SCN-session-ios' : value)),
  );
  const scenario = declared.scenarios.find((r) => r.id === args.scenario);
  assert.ok(scenario);
  assert.ok(scenario.pilotAssertions);
  const selected = await selectNativePilotScenario(args, declared, repository);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-contract-')));
  try {
    for (const kind of ['ui', 'api', 'sql']) await writeFile(path.join(root, `${kind}.json`), '{}');
    const target = {
      deviceId: 'owned-ios-device',
      osVersion: 'test-os',
      appId: 'com.edufelip.mychampions.dev',
      binaryHash: 'c'.repeat(64),
      buildProfile: 'test-debug',
      apiOrigin: 'http://127.0.0.1:42001' as string | null,
    };
    const inputs = {
      scenarioHash: selected.scenarioHash,
      requirementHash: selected.requirementHash,
      fixtureHash: 'd'.repeat(64),
      flagsHash: 'e'.repeat(64),
      toolVersions: { maestro: 'synthetic' } as Record<string, string>,
    };
    const receipt = {
      schemaVersion: 1,
      runId: 'contract-run',
      attemptId: 'contract-run:first',
      scenarioId: args.scenario,
      phase: 'P4',
      layer: 'native',
      engine: args.engine,
      dataMode: 'postgres',
      platform: args.platform,
      locale: 'en-US',
      repositories: [
        { name: 'client', sha: 'b'.repeat(40), dirty: true, workingTreeHash: 'a'.repeat(64) },
      ],
      target,
      inputs,
      command: { executable: 'node', argv: ['run-native-pilot.ts', ...argv] },
      startedAt: '2026-09-29T00:00:00.000Z',
      finishedAt: '2026-09-29T00:00:01.000Z',
      result: 'passed',
      exitCode: 0,
      childExitCode: 0 as number | null,
      assertions: scenario.pilotAssertions.map((row) => ({
        id: row.id,
        requirementRefs: row.requirementRefs,
        outcome: 'passed',
        evidencePaths: row.evidenceKinds.map((kind) => `${kind}.json`),
      })),
      timingsMs: { build: 0, install: 0, reset: 0, scenario: 0, verify: 0, cleanup: 0 },
      cleanup: {
        status: 'cleaned',
        ownedResourceIds: ['contract-owned-device'],
        recoveryRecordPath: null,
      },
      artifacts: ['ui.json', 'api.json', 'sql.json'],
      blocker: null,
    };
    const expected = {
      runId: receipt.runId,
      attemptId: receipt.attemptId,
      target: structuredClone(target),
      inputs: structuredClone(inputs),
    };
    const check = (row: unknown = receipt, ids = [receipt.attemptId], selection = selected) =>
      assertNativePilotCompletion(row, selection, expected, ids, root, [
        'synthetic-private-secret',
      ]);
    assert.doesNotThrow(() => check());
    for (const attemptId of ['contract-run:retry', 'contract-run:second']) {
      const retryReceipt = { ...receipt, attemptId };
      assert.throws(
        () =>
          assertNativePilotCompletion(
            retryReceipt,
            selected,
            { ...expected, attemptId },
            [attemptId],
            root,
          ),
        /attempt identity mismatch/,
      );
    }
    for (const platform of ['ios', 'android'] as const)
      for (const engine of ['maestro'] as const)
        for (const mode of ['integration'] as const) {
          const matrixDeclaration = structuredClone(declared);
          const matrixScenario = matrixDeclaration.scenarios.find(
            (row) => row.id === `SCN-session-${platform}`,
          )!;
          const matrixSelection = await selectNativePilotScenario(
            { platform, engine, mode, scenario: matrixScenario.id },
            matrixDeclaration,
            repository,
          );
          const matrixReceipt = structuredClone(receipt);
          matrixReceipt.platform = platform;
          matrixReceipt.engine = engine;
          matrixReceipt.scenarioId = matrixScenario.id;
          matrixReceipt.dataMode = mode === 'integration' ? 'postgres' : 'fixture';
          matrixReceipt.inputs.scenarioHash = matrixSelection.scenarioHash;
          matrixReceipt.inputs.requirementHash = matrixSelection.requirementHash;
          matrixReceipt.inputs.toolVersions = { [engine]: 'synthetic' };
          assert.doesNotThrow(() =>
            assertNativePilotCompletion(
              matrixReceipt,
              matrixSelection,
              { ...expected, inputs: matrixReceipt.inputs },
              [receipt.attemptId],
              root,
            ),
          );
        }
    for (const absent of [
      'toolVersions',
      'deviceId',
      'osVersion',
      'appId',
      'buildProfile',
      'binaryHash',
      'apiOrigin',
    ]) {
      const bad = structuredClone(receipt);
      const matching = structuredClone(expected);
      if (absent === 'toolVersions') {
        bad.inputs.toolVersions = {};
        matching.inputs.toolVersions = {};
      } else {
        (bad.target as Record<string, unknown>)[absent] = null;
        (matching.target as Record<string, unknown>)[absent] = null;
      }
      assert.throws(() =>
        assertNativePilotCompletion(bad, selected, matching, [receipt.attemptId], root),
      );
    }
    for (const ids of [[], ['foreign'], [receipt.attemptId, receipt.attemptId]])
      assert.throws(() => check(receipt, ids));
    const mutations = [
      (x: typeof receipt) => {
        x.runId = 'foreign';
      },
      (x: typeof receipt) => {
        x.attemptId = 'foreign';
      },
      (x: typeof receipt) => {
        x.scenarioId = 'SCN-training-ios';
      },
      (x: typeof receipt) => {
        x.platform = 'android';
      },
      (x: typeof receipt) => {
        x.engine = 'detox' as never;
      },
      (x: typeof receipt) => {
        x.dataMode = 'fixture';
      },
      (x: typeof receipt) => {
        x.phase = 'P3';
      },
      (x: typeof receipt) => {
        x.layer = 'postgres-ui';
      },
      (x: typeof receipt) => {
        x.childExitCode = null;
      },
      (x: typeof receipt) => {
        x.childExitCode = 1;
      },
      (x: typeof receipt) => {
        x.cleanup.status = 'not-acquired';
      },
      (x: typeof receipt) => {
        x.cleanup.status = 'failed-recovery-ledger-retained';
      },
      (x: typeof receipt) => x.assertions.pop(),
      (x: typeof receipt) => x.assertions.push(structuredClone(x.assertions[0])),
      (x: typeof receipt) => {
        x.assertions[0].outcome = 'not-executed';
      },
      (x: typeof receipt) => {
        x.assertions[0].requirementRefs = ['foreign'];
      },
      (x: typeof receipt) => {
        x.assertions[0].evidencePaths = [];
      },
      (x: typeof receipt) => {
        x.assertions[0].evidencePaths = ['missing.json'];
      },
      (x: typeof receipt) => {
        x.assertions[0].evidencePaths = ['../foreign.json'];
      },
      (x: typeof receipt) => {
        x.inputs.flagsHash = '0'.repeat(64);
      },
      (x: typeof receipt) => {
        x.inputs.fixtureHash = '0'.repeat(64);
      },
      (x: typeof receipt) => {
        x.inputs.scenarioHash = '0'.repeat(64);
      },
      (x: typeof receipt) => {
        x.inputs.requirementHash = '0'.repeat(64);
      },
      (x: typeof receipt) => {
        x.inputs.toolVersions = {};
      },
      (x: typeof receipt) => {
        x.target.binaryHash = '0'.repeat(64);
      },
      (x: typeof receipt) => {
        x.target.deviceId = 'foreign-device';
      },
      (x: typeof receipt) => {
        x.target.apiOrigin = null;
      },
      (x: typeof receipt) => {
        x.command.argv = ['synthetic-private-secret'];
      },
    ];
    for (const alter of mutations) {
      const bad = structuredClone(receipt);
      alter(bad);
      assert.throws(() => check(bad));
    }
    for (const ledger of [
      [],
      [scenario.pilotAssertions[0]],
      [...scenario.pilotAssertions, scenario.pilotAssertions[0]],
      [
        {
          id: 'bad',
          requirementRefs: ['foreign'],
          evidenceKinds: ['ui' as const, 'api' as const, 'sql' as const],
        },
      ],
    ]) {
      const bad = structuredClone(selected);
      bad.scenario.pilotAssertions = ledger;
      assert.throws(() => check(receipt, [receipt.attemptId], bad));
    }
    await writeFile(path.join(root, 'ui.json'), '');
    assert.throws(() => check());
    await rm(path.join(root, 'ui.json'));
    await mkdir(path.join(root, 'ui.json'));
    assert.throws(() => check());
    await rm(path.join(root, 'ui.json'), { recursive: true });
    await symlink(path.join(root, 'api.json'), path.join(root, 'ui.json'));
    assert.throws(() => check());
    await rm(path.join(root, 'ui.json'));
    await writeFile(path.join(root, 'ui.json'), '{}');
    assert.doesNotThrow(() => check());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('canonical native ledgers are equivalent across platforms/engines and reject changed contracts', async () => {
  const declared = await inventory();
  const expectedIds = {
    session: [...nativeSessionAssertionIds],
    training: [
      'NAT-training-normal-entry',
      'NAT-training-local-draft',
      'NAT-training-first-save',
      'NAT-training-edit-draft',
      'NAT-training-edited-save',
      'NAT-training-relaunch-read',
      'NAT-training-unrelated-state',
    ],
    'save-retry': [
      'NAT-save-retry-error',
      'NAT-save-retry-retained-draft',
      'NAT-save-retry-final-save',
      'NAT-save-retry-reopen',
      'NAT-save-retry-unrelated-state',
    ],
    connection: [...nativeConnectionAssertionIds],
    'camera-denied': [...nativeCameraDeniedAssertionIds],
  } as const;
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, child]) => [key, sorted(child)]),
          )
        : value;
  for (const family of [
    'session',
    'training',
    'save-retry',
    'connection',
    'camera-denied',
  ] as const) {
    let baseline: unknown;
    for (const platform of ['ios', 'android'] as const)
      for (const engine of ['maestro'] as const) {
        const selected = await selectNativePilotScenario(
          { platform, engine, scenario: `SCN-${family}-${platform}`, mode: 'integration' },
          declared,
          repository,
        );
        const rows = requireNativePilotAssertions(selected);
        assert.deepEqual(
          rows.map((row) => row.id),
          expectedIds[family],
        );
        if (family === 'connection')
          assert.deepEqual(
            rows.map((row) => row.id),
            nativeConnectionAssertionIds,
          );
        if (family === 'session')
          assert.deepEqual(
            rows.map((row) => row.id),
            nativeSessionAssertionIds,
          );
        if (family === 'camera-denied')
          assert.deepEqual(
            rows.map((row) => row.id),
            nativeCameraDeniedAssertionIds,
          );
        baseline ??= rows;
        assert.deepEqual(rows, baseline);
        const fixture = structuredClone(selected);
        fixture.arguments.mode = 'fixture';
        assert.throws(() => requireNativePilotAssertions(fixture), /integrated Postgres only/);
        if (['session', 'connection', 'camera-denied'].includes(family)) {
          const wrongDataMode = structuredClone(selected);
          wrongDataMode.scenario.dataMode = 'fixture';
          assert.throws(
            () => requireNativePilotAssertions(wrongDataMode),
            /canonical integrated Postgres fresh-attempt fixture/,
          );
          const wrongFixture = structuredClone(selected);
          wrongFixture.scenario.fixtureRef = `owned-postgres:${wrongFixture.scenario.id}:reused`;
          assert.throws(
            () => requireNativePilotAssertions(wrongFixture),
            /canonical integrated Postgres fresh-attempt fixture/,
          );
        }
        const wrongPlatform = structuredClone(selected);
        wrongPlatform.scenario.platform = platform === 'ios' ? 'android' : 'ios';
        assert.throws(() => requireNativePilotAssertions(wrongPlatform), /platform or engine/);
        const wrongEngine = structuredClone(selected);
        wrongEngine.scenario.engine = engine === 'maestro' ? 'detox' : 'maestro';
        assert.throws(() => requireNativePilotAssertions(wrongEngine), /platform or engine/);
        const missing = structuredClone(selected);
        missing.scenario.pilotAssertions!.splice(3, 1);
        assert.throws(() => requireNativePilotAssertions(missing), /complete declared contract/);
        const changed = structuredClone(selected);
        const changedKinds = changed.scenario.pilotAssertions![0].evidenceKinds;
        const sqlIndex = changedKinds.indexOf('sql');
        if (sqlIndex >= 0) changedKinds.splice(sqlIndex, 1);
        else changedKinds.push('sql');
        assert.throws(() => requireNativePilotAssertions(changed), /complete declared contract/);
        const absent = structuredClone(selected);
        delete absent.scenario.pilotAssertionContract;
        assert.throws(() => requireNativePilotAssertions(absent), /complete declared contract/);
        const emptyRecipe = structuredClone(selected);
        emptyRecipe.scenario.pilotAssertions![0].expected = '';
        emptyRecipe.scenario.pilotAssertionContract!.sha256 = createHash('sha256')
          .update(JSON.stringify(sorted(emptyRecipe.scenario.pilotAssertions)))
          .digest('hex');
        assert.throws(() => requireNativePilotAssertions(emptyRecipe), /evidence recipe/);
        const duplicate = structuredClone(selected);
        duplicate.scenario.pilotAssertions!.push(rows[0]);
        assert.throws(() => requireNativePilotAssertions(duplicate), /ledger/);
        if (family === 'connection') {
          const incompleteKinds = structuredClone(selected);
          for (const row of incompleteKinds.scenario.pilotAssertions!) {
            const originalKinds = [...row.evidenceKinds];
            row.evidenceKinds = originalKinds.filter((kind) => kind !== 'api');
            row.evidencePathTemplates = row.evidencePathTemplates?.filter(
              (_, index) => originalKinds[index] !== 'api',
            );
          }
          incompleteKinds.scenario.pilotAssertionContract!.sha256 = createHash('sha256')
            .update(JSON.stringify(sorted(incompleteKinds.scenario.pilotAssertions)))
            .digest('hex');
          assert.throws(
            () => requireNativePilotAssertions(incompleteKinds),
            /required UI\/API\/SQL proof/,
          );
          const semanticMutation = structuredClone(selected);
          semanticMutation.scenario.pilotAssertions![1].action += ' (changed)';
          semanticMutation.scenario.pilotAssertionContract!.sha256 = createHash('sha256')
            .update(JSON.stringify(sorted(semanticMutation.scenario.pilotAssertions)))
            .digest('hex');
          assert.equal(
            semanticMutation.scenario.pilotAssertionContract!.semanticSha256,
            nativeConnectionAssertionSemanticSha256,
          );
          assert.throws(() => requireNativePilotAssertions(semanticMutation), /semantic digest/);
          const forgedSemantic = structuredClone(semanticMutation);
          forgedSemantic.scenario.pilotAssertionContract!.semanticSha256 = createHash('sha256')
            .update(
              JSON.stringify(
                sorted(
                  forgedSemantic.scenario.pilotAssertions!.map((row) =>
                    Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id')),
                  ),
                ),
              ),
            )
            .digest('hex');
          assert.notEqual(
            forgedSemantic.scenario.pilotAssertionContract!.semanticSha256,
            nativeConnectionAssertionSemanticSha256,
          );
          assert.throws(() => requireNativePilotAssertions(forgedSemantic), /semantic digest/);
        }
        if (family === 'session' || family === 'camera-denied') {
          const evidenceMutation = structuredClone(selected);
          const requiredRow = evidenceMutation.scenario.pilotAssertions!.find((row) =>
            family === 'session'
              ? row.id === 'NAT-session-restore'
              : row.id === 'NAT-camera-manual-submit',
          )!;
          requiredRow.evidenceKinds = ['ui'];
          requiredRow.evidencePathTemplates = ['assertions/{attemptId}/mutated-ui.private.json'];
          evidenceMutation.scenario.pilotAssertionContract!.sha256 = createHash('sha256')
            .update(JSON.stringify(sorted(evidenceMutation.scenario.pilotAssertions)))
            .digest('hex');
          assert.throws(
            () => requireNativePilotAssertions(evidenceMutation),
            /unexpected evidence contract/,
          );
        }
        if (family === 'session') {
          const accountKindMutation = structuredClone(selected);
          const accountRow = accountKindMutation.scenario.pilotAssertions!.find(
            (row) => row.id === 'NAT-session-account',
          )!;
          accountRow.evidenceKinds = ['ui', 'api'];
          accountRow.evidencePathTemplates = [
            'assertions/{attemptId}/account-ui.private.json',
            'assertions/{attemptId}/account-api.private.json',
          ];
          accountKindMutation.scenario.pilotAssertionContract!.sha256 = createHash('sha256')
            .update(JSON.stringify(sorted(accountKindMutation.scenario.pilotAssertions)))
            .digest('hex');
          assert.throws(
            () => requireNativePilotAssertions(accountKindMutation),
            /unexpected evidence contract/,
          );
        }
        if (
          family === 'save-retry' ||
          family === 'connection' ||
          family === 'session' ||
          family === 'camera-denied'
        ) {
          // Recomputed hashes/counts must not authorize omitted, renamed or reordered proof.
          const canonicalMessage =
            family === 'save-retry'
              ? /five ordered canonical assertions/
              : family === 'connection'
                ? /seven ordered canonical assertions/
                : family === 'session'
                  ? /six ordered canonical assertions/
                  : /four ordered canonical assertions/;
          for (const alter of [
            (ledger: typeof rows) => ledger.splice(family === 'camera-denied' ? 3 : 4, 1),
            (ledger: typeof rows) =>
              (ledger[0].id =
                family === 'save-retry'
                  ? 'NAT-save-retry-replacement'
                  : family === 'connection'
                    ? 'NAT-connection-replacement'
                    : family === 'session'
                      ? 'NAT-session-replacement'
                      : 'NAT-camera-replacement'),
            (ledger: typeof rows) => ledger.reverse(),
          ]) {
            const rebound = structuredClone(selected);
            alter(rebound.scenario.pilotAssertions!);
            rebound.scenario.pilotAssertionContract!.count =
              rebound.scenario.pilotAssertions!.length;
            rebound.scenario.pilotAssertionContract!.sha256 = createHash('sha256')
              .update(JSON.stringify(sorted(rebound.scenario.pilotAssertions)))
              .digest('hex');
            rebound.scenarioHash = createHash('sha256')
              .update(JSON.stringify(sorted(rebound.scenario)))
              .digest('hex');
            assert.throws(() => requireNativePilotAssertions(rebound), canonicalMessage);
          }
        }
      }
  }
});
