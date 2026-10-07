import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  nativePilotExecutionAdapter,
  resolveAndroidDetoxConnectionDeadlineMs,
  runAndroidDetoxConnectionAttemptForPublicDispatch,
} from '../../scripts/testing/run-native-pilot';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

type Inventory = { scenarios: NativePilotSelection['scenario'][] };
const runId = 'a'.repeat(24);

async function selection(): Promise<NativePilotSelection> {
  const inventory = JSON.parse(
    await readFile(
      process.env.MYCHAMPIONS_Q_INVENTORY ??
        '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/docs/qa/native-pilot/inventory.json',
      'utf8',
    ),
  ) as Inventory;
  const scenario = inventory.scenarios.find((row) => row.id === 'SCN-connection-android');
  assert(scenario, 'The reviewed Android Detox scenario is absent from the inventory');
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

void test('outer native pilot selects the Android Detox route without broadening engine/platform', () => {
  assert.equal(
    nativePilotExecutionAdapter({
      platform: 'android',
      engine: 'detox',
      scenario: 'SCN-connection-android',
      mode: 'integration',
    }),
    'android-detox-connection',
  );
  assert.equal(
    nativePilotExecutionAdapter({
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-connection-android',
      mode: 'integration',
    }),
    'connection',
  );
  assert.equal(
    nativePilotExecutionAdapter({
      platform: 'ios',
      engine: 'detox',
      scenario: 'SCN-connection-ios',
      mode: 'integration',
    }),
    'ios-detox-connection',
  );
});

void test('outer Android Detox route forwards the real dispatch options exactly once', async () => {
  const current = await selection();
  const signal = new AbortController().signal;
  let calls = 0;
  const expected = { kind: 'private-test-android-detox-result' } as never;
  const result = await runAndroidDetoxConnectionAttemptForPublicDispatch(
    {
      repositoryRoot: '/tmp/repository',
      serverRoot: '/tmp/server',
      artifactRoot: `/tmp/repository/.qa/artifacts/native-pilot-attempts/${runId}`,
      requestedRunId: runId,
      requestedAttemptId: `${runId}:first`,
      selection: current,
      signal,
      deadlineMs: 30_000,
      deadlineAtMonotonicMs: performance.now() + 30_000,
      buildRunId: 'd'.repeat(24),
      parentEnv: {},
    },
    (options) => {
      calls++;
      assert.equal(options.selection, current);
      assert.equal(options.requestedRunId, runId);
      assert.equal(options.requestedAttemptId, `${runId}:first`);
      assert.equal(options.buildRunId, 'd'.repeat(24));
      assert.equal(options.signal, signal);
      return Promise.resolve(expected);
    },
  );
  assert.equal(calls, 1);
  assert.equal(result, expected);
});

void test('outer Android Detox route rejects wrong attempt and malformed qualified build IDs before dispatch', async () => {
  const current = await selection();
  const base = {
    repositoryRoot: '/tmp/repository',
    serverRoot: '/tmp/server',
    artifactRoot: `/tmp/repository/.qa/artifacts/native-pilot-attempts/${runId}`,
    requestedRunId: runId,
    requestedAttemptId: `${runId}:first`,
    selection: current,
    signal: new AbortController().signal,
    deadlineMs: 30_000,
    buildRunId: 'd'.repeat(24),
    parentEnv: {},
  } as Parameters<typeof runAndroidDetoxConnectionAttemptForPublicDispatch>[0];
  let calls = 0;
  const runner = () => {
    calls++;
    return Promise.resolve({} as never);
  };
  assert.throws(
    () =>
      runAndroidDetoxConnectionAttemptForPublicDispatch(
        { ...base, requestedAttemptId: `${runId}:second` },
        runner,
      ),
    /strictly equal|first/,
  );
  assert.throws(
    () => runAndroidDetoxConnectionAttemptForPublicDispatch({ ...base, buildRunId: 'bad' }, runner),
    /buildRunId/,
  );
  assert.equal(calls, 0);
});

void test('Android Detox dispatch deadline retains the owned lower bound', () => {
  assert.equal(
    resolveAndroidDetoxConnectionDeadlineMs({
      runStartedMs: 1_000,
      nowMs: 2_000,
      wholeRunMs: 300_000,
      stepMs: 60_000,
    }),
    60_000,
  );
  assert.throws(
    () =>
      resolveAndroidDetoxConnectionDeadlineMs({
        runStartedMs: 1_000,
        nowMs: 290_500,
        wholeRunMs: 300_000,
        stepMs: 60_000,
      }),
    /30-second/,
  );
});
