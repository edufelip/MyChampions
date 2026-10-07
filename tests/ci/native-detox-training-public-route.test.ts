import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  IOS_DETOX_TRAINING_PUBLIC_DISPATCH,
  requireIosDetoxTrainingOwnerSelection,
  requireIosDetoxTrainingPublicSelection,
  runIosDetoxTrainingAttemptForPublicDispatch,
} from '../../scripts/testing/native-detox-training-public-dispatch';
import { nativePilotExecutionAdapter } from '../../scripts/testing/run-native-pilot';
import type {
  NativePilotArguments,
  NativePilotSelection,
} from '../../scripts/testing/native-pilot-contract';

const repositoryRoot = path.resolve(__dirname, '../..');

async function selections(): Promise<{
  training: NativePilotSelection;
  connection: NativePilotSelection;
}> {
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as { scenarios: NativePilotSelection['scenario'][] };
  const trainingScenario = inventory.scenarios.find((row) => row.id === 'SCN-training-ios');
  const connectionScenario = inventory.scenarios.find((row) => row.id === 'SCN-connection-ios');
  assert(trainingScenario);
  assert(connectionScenario);
  return {
    training: {
      arguments: {
        platform: 'ios',
        engine: 'detox',
        scenario: 'SCN-training-ios',
        mode: 'integration',
      },
      scenario: structuredClone(trainingScenario),
      scenarioHash: 'a'.repeat(64),
      requirementHash: 'b'.repeat(64),
    },
    connection: {
      arguments: {
        platform: 'ios',
        engine: 'detox',
        scenario: 'SCN-connection-ios',
        mode: 'integration',
      },
      scenario: structuredClone(connectionScenario),
      scenarioHash: 'c'.repeat(64),
      requirementHash: 'd'.repeat(64),
    },
  };
}

void test('native pilot selects the iOS Detox training route only for its exact cell', () => {
  const training: NativePilotArguments = {
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-training-ios',
    mode: 'integration',
  };
  assert.equal(nativePilotExecutionAdapter(training), IOS_DETOX_TRAINING_PUBLIC_DISPATCH);
  assert.equal(nativePilotExecutionAdapter({ ...training, engine: 'maestro' }), 'training');
  assert.equal(
    nativePilotExecutionAdapter({
      ...training,
      platform: 'android',
      scenario: 'SCN-training-android',
    }),
    null,
  );
  assert.equal(nativePilotExecutionAdapter({ ...training, mode: 'fixture' }), null);
  assert.equal(
    nativePilotExecutionAdapter({ ...training, scenario: 'SCN-training-android' }),
    null,
  );
});

void test('iOS Detox training validates the connection owner and keeps the route source-only', async () => {
  const selected = await selections();
  assert.doesNotThrow(() => requireIosDetoxTrainingPublicSelection(selected.training));
  assert.doesNotThrow(() =>
    requireIosDetoxTrainingOwnerSelection(selected.training, selected.connection),
  );
  assert.throws(() =>
    requireIosDetoxTrainingOwnerSelection(selected.training, {
      ...selected.connection,
      arguments: { ...selected.connection.arguments, platform: 'android' },
    } as NativePilotSelection),
  );

  const input = {
    repositoryRoot,
    serverRoot: path.join(repositoryRoot, '..', 'server'),
    artifactRoot: path.join(repositoryRoot, '.qa/artifacts/private-detox-training-route'),
    requestedRunId: 'a'.repeat(24),
    requestedAttemptId: `${'a'.repeat(24)}:first`,
    selection: selected.training,
    connectionSelection: selected.connection,
    signal: new AbortController().signal,
    deadlineAtMonotonicMs: performance.now() + 30_000,
    buildRunId: 'b'.repeat(24),
  } as const;
  let calls = 0;
  const result = await runIosDetoxTrainingAttemptForPublicDispatch(input, {}, (received) => {
    calls += 1;
    assert.equal(received.selection, input.selection);
    assert.equal(received.connectionSelection, input.connectionSelection);
    assert.equal(received.deadlineAtMonotonicMs, input.deadlineAtMonotonicMs);
    return {
      verificationResult: 'failed',
      nativePassingCases: 0,
      publicPromotionEligible: false,
    } as never;
  });
  assert.equal(calls, 1);
  assert.equal(result.verificationResult, 'failed');
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.publicPromotionEligible, false);
});

void test('run-native-pilot wires the public route to the existing owner and final staging boundary', async () => {
  const source = await readFile(
    path.join(repositoryRoot, 'scripts/testing/run-native-pilot.ts'),
    'utf8',
  );
  assert.match(source, /IOS_DETOX_TRAINING_PUBLIC_DISPATCH/);
  assert.match(source, /runIosDetoxTrainingAttemptForPublicDispatch\(/);
  assert.match(source, /connectionSelection:\s*detoxTrainingConnectionSelection/);
  assert.match(source, /stageNativeTrainingPublicEvidence/);
  assert.match(source, /verifyStagedNativeTrainingEvidence/);
  assert.match(source, /selectVerifiedIosDetoxTrainingPublicFinalization/);
  assert.match(source, /publicFinalization: iosDetoxTrainingPublicFinalization/);
  assert.match(source, /expectedPublicFinalization: iosDetoxTrainingPublicFinalization/);
  assert.match(
    source,
    /iosDetoxTrainingSourceOnly = iosDetoxTrainingPublicFinalization === undefined/,
  );
  assert.match(source, /runtime-source-only/);
});
