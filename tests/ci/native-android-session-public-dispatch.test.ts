import assert from 'node:assert/strict';
import test from 'node:test';
import { androidSessionPublicSelection } from '../../scripts/testing/native-android-session-public-contract';
import {
  androidSessionExecutionAdapter,
  nativePilotExecutionAdapterWithAndroid,
  requireAndroidSessionDispatchSelection,
  runAndroidSessionAttemptForPublicDispatch,
} from '../../scripts/testing/native-android-session-public-dispatch';
import type {
  NativePilotArguments,
  NativePilotSelection,
} from '../../scripts/testing/native-pilot-contract';

const args: NativePilotArguments = { ...androidSessionPublicSelection };
const selection: NativePilotSelection = {
  arguments: args,
  scenario: {
    id: 'SCN-session-android',
    platform: 'android',
    engine: 'maestro',
    flowId: 'FLW-session',
    transitionIds: [],
    requirementRefs: [],
    dataMode: 'postgres',
    fixtureRef: 'owned-postgres:SCN-session-android:fresh-attempt',
    freshnessInputs: { requirementPaths: [] },
  },
  scenarioHash: 'a'.repeat(64),
  requirementHash: 'b'.repeat(64),
};

void test('Android public dispatch selects only the exact reviewed Maestro cell', () => {
  assert.equal(androidSessionExecutionAdapter(args), 'android-session');
  assert.equal(androidSessionExecutionAdapter({ ...args, engine: 'detox' as never }), null);
  assert.equal(androidSessionExecutionAdapter({ ...args, mode: 'fixture' }), null);
  assert.equal(androidSessionExecutionAdapter({ ...args, scenario: 'SCN-session-ios' }), null);
  assert.equal(nativePilotExecutionAdapterWithAndroid(args, 'training'), 'android-session');
  assert.equal(
    nativePilotExecutionAdapterWithAndroid({ ...args, platform: 'ios' }, 'training'),
    'training',
  );
});

void test('Android public dispatch requires the complete selection identity', () => {
  requireAndroidSessionDispatchSelection(selection);
  assert.throws(
    () => requireAndroidSessionDispatchSelection({ ...selection, scenarioHash: 'c'.repeat(63) }),
    /scenarioHash|64/,
  );
  assert.throws(
    () =>
      requireAndroidSessionDispatchSelection({
        ...selection,
        arguments: { ...args, mode: 'fixture' },
      }),
    /Maestro integration|Expected values/,
  );
});

void test('Android public dispatch forwards the owned runner and retains source-only status', async () => {
  let called = 0;
  const result = await runAndroidSessionAttemptForPublicDispatch(
    {
      repositoryRoot: '/qualified/repository',
      requestedRunId: 'a'.repeat(24),
      selection,
      signal: new AbortController().signal,
    },
    async (input) => {
      await Promise.resolve();
      called++;
      assert.equal(input.selection, selection);
      return {
        kind: 'private-owned-android-session-attempt-not-public-receipt',
        requestedRunId: input.requestedRunId,
        requestedAttemptId: `${input.requestedRunId}:first`,
        captureRunId: 'b'.repeat(24),
        backendRunId: 'c'.repeat(24),
        backendAttemptId: `${'c'.repeat(24)}:first`,
        captureExitCode: 0,
        childExitCode: 0,
        childSignal: null,
        childClassification: 'completed',
        captureResult: 'observed',
        captureCleanup: 'cleaned',
        captureTimeout: null,
        cancellation: null,
        captureInvocation: { count: 1, returned: true, exitCode: 0, result: 'observed' },
        captureCompleted: true,
        externalCleanupResult: 'passed',
        verificationResult: 'source-only',
        verificationFailure: null,
        postCaptureFailure: null,
        dependencyStatus: 'validated-source-only',
        publicPromotionEligible: false,
        nativePassingCases: 0,
        publicPassingCases: 0,
        staged: null,
        deadline: null,
        commandDiagnostics: [],
        censusFailures: [],
        outputFailures: [],
        fixtureRunId: 'c'.repeat(24),
        fixtureHash: 'd'.repeat(64),
        flagsHash: 'e'.repeat(64),
        toolVersions: { maestro: '2.6.1' },
        timingsMs: { build: 1, install: 1, reset: 1, scenario: 1, verify: 1, cleanup: 1 },
        artifactRoot: '/qualified/repository/.qa/artifacts/native-pilot/bbbbbbbbbbbbbbbbbbbbbbbb',
      };
    },
  );
  assert.equal(called, 1);
  assert.equal(result.verificationResult, 'source-only');
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.publicPassingCases, 0);
  assert.equal(result.publicPromotionEligible, false);
});
