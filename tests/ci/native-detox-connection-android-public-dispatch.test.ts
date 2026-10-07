import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  requireAndroidDetoxCleanupResult,
  requireAndroidDetoxConnectionProducer,
  type AndroidDetoxConnectionProducer,
} from '../../scripts/testing/detox-android-connection-producer';
import { runOwnedDetoxConnectionAttempt } from '../../scripts/testing/detox-integrated-connection-driver';
import { requireNativeConnectionEngineForPlatform } from '../../scripts/testing/native-connection-engine-contract';
import {
  androidDetoxConnectionDefaultDelegate,
  androidDetoxConnectionExecutionAdapter,
  requireAndroidDetoxConnectionPublicSelection,
  runAndroidDetoxConnectionPublicAttempt,
} from '../../scripts/testing/native-detox-connection-android-public-dispatch';
import {
  requireAndroidDetoxAttemptArtifactRoot,
  isAndroidDetoxOwnedReceiptName,
  verifyOwnedAndroidDetoxConnectionCleanup,
} from '../../scripts/testing/verify-owned-android-detox-connection-cleanup';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const runId = 'a'.repeat(24);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const selectionRoot = `${repositoryRoot}/.qa/artifacts/native-pilot-attempts/${runId}`;

async function selection(): Promise<NativePilotSelection> {
  const inventory = JSON.parse(
    await readFile(
      process.env.MYCHAMPIONS_Q_INVENTORY ??
        '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/docs/qa/native-pilot/inventory.json',
      'utf8',
    ),
  ) as { scenarios: NativePilotSelection['scenario'][] };
  const scenario = inventory.scenarios.find((row) => row.id === 'SCN-connection-android');
  assert(scenario, 'The reviewed Android connection scenario is absent from the inventory');
  return {
    arguments: {
      platform: 'android',
      engine: 'detox',
      scenario: 'SCN-connection-android',
      mode: 'integration',
    },
    scenario: structuredClone(scenario),
    scenarioHash: 'b'.repeat(64),
    requirementHash: 'c'.repeat(64),
  };
}

function producer(): AndroidDetoxConnectionProducer {
  return {
    kind: 'owned-android-detox-connection-producer',
    acquireOwnedTarget: () =>
      Promise.reject(new Error('test producer must not acquire native resources')),
    verifyOwnedAndroidCleanup: () =>
      Promise.resolve({
        kind: 'private-owned-android-detox-connection-cleanup' as const,
        result: 'failed',
        censusStatus: 'unavailable',
        nativePassingCases: 0,
        runId,
        pidStartPairs: 0,
        scope: 'android-detox-target-only' as const,
        processSurvivors: [],
        unavailablePorts: [],
        deletedDirectories: [],
      }),
  };
}

void test('Android Detox selection is exact and never broadens to iOS or Maestro', async () => {
  const current = await selection();
  requireAndroidDetoxConnectionPublicSelection(current);
  assert.equal(
    androidDetoxConnectionExecutionAdapter(current.arguments),
    'android-detox-connection',
  );
  assert.equal(
    androidDetoxConnectionExecutionAdapter({ ...current.arguments, engine: 'maestro' }),
    null,
  );
  assert.equal(
    androidDetoxConnectionExecutionAdapter({ ...current.arguments, platform: 'ios' }),
    null,
  );
  assert.equal(
    androidDetoxConnectionExecutionAdapter({
      ...current.arguments,
      scenario: 'SCN-training-android',
    }),
    null,
  );
  assert.throws(
    () =>
      requireAndroidDetoxConnectionPublicSelection({
        ...current,
        arguments: { ...current.arguments, mode: 'fixture' },
      }),
    /Expected values|integration/,
  );
});

void test('Android producer capability fails closed before acquisition', () => {
  assert.throws(
    () => requireAndroidDetoxConnectionProducer(undefined),
    /missing before acquisition/,
  );
  assert.throws(
    () =>
      requireAndroidDetoxConnectionProducer({ kind: 'owned-android-detox-connection-producer' }),
    /target factory/,
  );
  const current = producer();
  assert.equal(requireAndroidDetoxConnectionProducer(current), current);
});

void test('Android independent cleanup gate requires an available owned census', () => {
  assert.deepEqual(
    requireAndroidDetoxCleanupResult({
      kind: 'private-owned-android-detox-connection-cleanup',
      result: 'passed',
      censusStatus: 'available',
      nativePassingCases: 0,
      runId,
      scope: 'android-detox-target-only',
      processSurvivors: [],
      unavailablePorts: [],
      pidStartPairs: 1,
      deletedDirectories: ['avd', 'user', 'recovery', 'logs', 'tmp', 'locks'],
    }),
    {
      kind: 'private-owned-android-detox-connection-cleanup',
      result: 'passed',
      censusStatus: 'available',
      nativePassingCases: 0,
      runId,
      scope: 'android-detox-target-only',
      processSurvivors: [],
      unavailablePorts: [],
      pidStartPairs: 1,
      deletedDirectories: ['avd', 'user', 'recovery', 'logs', 'tmp', 'locks'],
    },
  );
  for (const value of [
    {
      kind: 'private-owned-android-detox-connection-cleanup',
      result: 'failed',
      censusStatus: 'available',
      nativePassingCases: 0,
      runId,
      scope: 'android-detox-target-only',
      processSurvivors: [],
      unavailablePorts: [],
      pidStartPairs: 1,
      deletedDirectories: ['avd', 'user', 'recovery', 'logs', 'tmp', 'locks'],
    },
    {
      kind: 'private-owned-android-detox-connection-cleanup',
      result: 'passed',
      censusStatus: 'available',
      nativePassingCases: 0,
      runId,
      scope: 'android-detox-target-only',
      processSurvivors: [],
      unavailablePorts: [],
      pidStartPairs: 1,
      deletedDirectories: ['avd'],
    },
    {
      kind: 'private-owned-android-detox-connection-cleanup',
      result: 'passed',
      censusStatus: 'unavailable',
      nativePassingCases: 0,
      runId,
      scope: 'android-detox-target-only',
      processSurvivors: [],
      unavailablePorts: [],
    },
    {
      kind: 'private-owned-android-detox-connection-cleanup',
      result: 'passed',
      censusStatus: 'available',
      nativePassingCases: 1,
      runId,
      scope: 'android-detox-target-only',
      processSurvivors: [],
      unavailablePorts: [],
    },
    {
      kind: 'private-owned-android-detox-connection-cleanup',
      result: 'passed',
      censusStatus: 'available',
      nativePassingCases: 0,
      runId,
      scope: 'android-detox-target-only',
      processSurvivors: [123],
      unavailablePorts: [],
    },
    null,
  ])
    assert.throws(() => requireAndroidDetoxCleanupResult(value), /Android independent cleanup/);
});

void test('Android Detox cleanup accepts direct and camera-capture attempt namespaces only', () => {
  const root = '/private/repository';
  const attempts = `${root}/.qa/artifacts/native-pilot-attempts`;
  const outer = 'a'.repeat(24);
  const capture = 'b'.repeat(24);
  assert.equal(requireAndroidDetoxAttemptArtifactRoot(root, `${attempts}/${outer}`), outer);
  assert.equal(
    requireAndroidDetoxAttemptArtifactRoot(root, `${attempts}/${outer}/${capture}`),
    capture,
  );
  for (const invalid of [
    `${attempts}/${outer}/foreign`,
    `${attempts}/${outer}/${capture}/extra`,
    `${root}/foreign/${capture}`,
  ])
    assert.throws(() => requireAndroidDetoxAttemptArtifactRoot(root, invalid));
});

void test('Android Detox cleanup accepts only owned private or ownership receipt names', () => {
  for (const name of ['android-target.private.json', 'android-emulator.ownership.json'])
    assert.equal(isAndroidDetoxOwnedReceiptName(name), true);
  for (const name of ['android-target.json', '../android-target.private.json', 'expo.log'])
    assert.equal(isAndroidDetoxOwnedReceiptName(name), false);
});

void test('Connection binding accepts Android Detox only and preserves iOS Maestro', () => {
  assert.equal(requireNativeConnectionEngineForPlatform('android', 'maestro'), 'maestro');
  assert.equal(requireNativeConnectionEngineForPlatform('android', 'detox'), 'detox');
  assert.equal(requireNativeConnectionEngineForPlatform('ios', 'maestro'), 'maestro');
  assert.throws(
    () => requireNativeConnectionEngineForPlatform('ios', 'detox'),
    /not enabled for iOS/,
  );
});

void test('Android Detox cleanup refuses a root without actual owner receipts', async () => {
  const repositoryRoot = await mkdtemp('/tmp/android-detox-cleanup-repository-');
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  const artifactRoot = `${canonicalRepositoryRoot}/.qa/artifacts/native-pilot-attempts/${runId}`;
  const runtimeParent = `${artifactRoot}/android-runtime`;
  const sdkRoot = `${canonicalRepositoryRoot}/android-sdk`;
  await mkdir(runtimeParent, { recursive: true, mode: 0o700 });
  await mkdir(sdkRoot, { recursive: true, mode: 0o700 });
  try {
    await assert.rejects(
      verifyOwnedAndroidDetoxConnectionCleanup({
        repositoryRoot: canonicalRepositoryRoot,
        artifactRoot,
        target: {
          platform: 'android',
          deviceId: 'emulator-5554',
          androidRuntimeParent: runtimeParent,
          androidSdkRoot: sdkRoot,
          ownership: {
            artifactRoot,
            hostLockRequired: true,
            cleanupAuthorized: true,
          },
        },
        signal: new AbortController().signal,
        deadlineAt: performance.now() + 10_000,
      }),
      /android-acquisition-owner/,
    );
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

void test('Android Detox adapter defaults to the owned driver and fails before acquisition on invalid build input', async () => {
  const current = await selection();
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  const canonicalSelectionRoot = `${canonicalRepositoryRoot}/.qa/artifacts/native-pilot-attempts/${runId}`;
  await mkdir(canonicalSelectionRoot, { recursive: true, mode: 0o700 });
  let acquireCalls = 0;
  const ownedProducer = producer();
  const guardedProducer = {
    ...ownedProducer,
    acquireOwnedTarget: () => {
      acquireCalls++;
      return Promise.reject(new Error('native acquisition must not run for invalid build input'));
    },
  } satisfies AndroidDetoxConnectionProducer;
  assert.equal(androidDetoxConnectionDefaultDelegate, runOwnedDetoxConnectionAttempt);
  await assert.rejects(
    androidDetoxConnectionDefaultDelegate({
      repositoryRoot: canonicalRepositoryRoot,
      serverRoot: '/tmp/android-detox-connection-server',
      artifactRoot: canonicalSelectionRoot,
      selection: current,
      build: {} as never,
      configuration: 'android.emu.debug',
      runnerPaths: {
        jestConfigPath: `${repositoryRoot}/e2e/jest.detox-integrated-connection-baseline.config.js`,
        testPath: `${repositoryRoot}/e2e/detox-integrated-connection-baseline.e2e.test.js`,
      },
      signal: new AbortController().signal,
      deadlineMs: 30_000,
      androidProducer: guardedProducer,
    } as never),
    /Unsupported Detox platform|Detox (build|source|binary|helper|config)/,
  );
  assert.equal(acquireCalls, 0);
});

void test('Android Detox public adapter forwards one owned producer and keeps source-only status', async () => {
  const current = await selection();
  const ownedProducer = producer();
  let calls = 0;
  const result = await runAndroidDetoxConnectionPublicAttempt({
    owner: 'detox-driver',
    repositoryRoot,
    serverRoot: '/tmp/android-detox-connection-server',
    artifactRoot: selectionRoot,
    requestedRunId: runId,
    requestedAttemptId: `${runId}:first`,
    selection: current,
    build: {
      source: { sourceTreeHash: 'd'.repeat(64) },
      helperInputsHash: 'e'.repeat(64),
      binaryHash: 'f'.repeat(64),
      testBinaryHash: '1'.repeat(64),
      detoxConfigHash: '2'.repeat(64),
    } as never,
    runnerPaths: {
      jestConfigPath: `${repositoryRoot}/e2e/jest.detox-integrated-connection-baseline.config.js`,
      testPath: `${repositoryRoot}/e2e/detox-integrated-connection-baseline.e2e.test.js`,
    },
    signal: new AbortController().signal,
    deadlineMs: 30_000,
    deadlineAtMonotonicMs: performance.now() + 30_000,
    producer: ownedProducer,
    validateBuild: () => undefined,
    delegate: (options) => {
      calls++;
      assert.equal(options.androidProducer, ownedProducer);
      return Promise.resolve({
        kind: 'private-detox-connection-attempt-not-public-receipt',
        status: 'source-only',
        selectionValid: true,
        acquired: true,
        cleanup: 'cleaned',
        recoveryStatus: 'verified',
        report: {
          selection: current,
          output: selectionRoot,
          detoxAndroidCleanup: {
            kind: 'private-owned-android-detox-connection-cleanup',
            result: 'passed',
            censusStatus: 'available',
            nativePassingCases: 0,
            runId,
            scope: 'android-detox-target-only',
            processSurvivors: [],
            unavailablePorts: [],
            pidStartPairs: 1,
            deletedDirectories: ['avd', 'user', 'recovery', 'logs', 'tmp', 'locks'],
          },
        },
        ledger: [],
        failures: [],
        deadlineAccounting: null,
        nativePassingCases: 0,
        publicPromotionEligible: false,
      } as never);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.platform, 'android');
  assert.equal(result.engine, 'detox');
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.publicPromotionEligible, false);
});

void test('Android Detox public adapter rejects cleanup from a different attempt', async () => {
  const current = await selection();
  const differentRunId = 'b'.repeat(24);
  await assert.rejects(
    runAndroidDetoxConnectionPublicAttempt({
      owner: 'detox-driver',
      repositoryRoot,
      serverRoot: '/tmp/android-detox-connection-server',
      artifactRoot: selectionRoot,
      requestedRunId: runId,
      requestedAttemptId: `${runId}:first`,
      selection: current,
      build: {
        source: { sourceTreeHash: 'd'.repeat(64) },
        helperInputsHash: 'e'.repeat(64),
        binaryHash: 'f'.repeat(64),
        testBinaryHash: '1'.repeat(64),
        detoxConfigHash: '2'.repeat(64),
      } as never,
      runnerPaths: {
        jestConfigPath: `${repositoryRoot}/e2e/jest.detox-integrated-connection-baseline.config.js`,
        testPath: `${repositoryRoot}/e2e/detox-integrated-connection-baseline.e2e.test.js`,
      },
      signal: new AbortController().signal,
      deadlineMs: 30_000,
      deadlineAtMonotonicMs: performance.now() + 30_000,
      producer: producer(),
      validateBuild: () => undefined,
      delegate: () =>
        Promise.resolve({
          kind: 'private-detox-connection-attempt-not-public-receipt',
          status: 'source-only',
          selectionValid: true,
          acquired: true,
          cleanup: 'cleaned',
          recoveryStatus: 'verified',
          report: {
            selection: current,
            output: selectionRoot,
            detoxAndroidCleanup: {
              kind: 'private-owned-android-detox-connection-cleanup',
              result: 'passed',
              censusStatus: 'available',
              nativePassingCases: 0,
              runId: differentRunId,
              scope: 'android-detox-target-only',
              processSurvivors: [],
              unavailablePorts: [],
              pidStartPairs: 1,
              deletedDirectories: ['avd', 'user', 'recovery', 'logs', 'tmp', 'locks'],
            },
          },
          ledger: [],
          failures: [],
          deadlineAccounting: null,
          nativePassingCases: 0,
          publicPromotionEligible: false,
        } as never),
    }),
    /different attempt/,
  );
});
