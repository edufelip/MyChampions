import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { selectNativePilotScenario } from '../../scripts/testing/native-pilot-contract';
import {
  projectIosConnectionAttemptTerminalFacts,
  projectIosConnectionAttemptTerminalFacts as projectTerminal,
  requireIosSuccessfulConnectionCommandDiagnostics,
  runIosConnectionAttempt,
} from '../../scripts/testing/run-ios-connection-attempt';

const command = (
  patch: Partial<{
    label: string;
    phase: 'build' | 'step';
    execution:
      | 'completed'
      | 'child-failed'
      | 'deadline'
      | 'cancelled'
      | 'output-limit'
      | 'output-failed'
      | 'harness-blocked';
    cleanup: 'not-acquired' | 'cleaned' | 'failed-recovery-ledger-retained' | 'unknown';
    childExitCode: number | null;
    childSignal: string | null;
    deadlineMs: number;
    censusFailure: unknown;
    outputFailure: unknown;
  }> = {},
) => ({
  label: 'ios-connection',
  phase: 'step' as const,
  execution: 'completed' as const,
  cleanup: 'cleaned' as const,
  childExitCode: 0,
  childSignal: null,
  deadlineMs: 600_000,
  censusFailure: null,
  outputFailure: null,
  ...patch,
});

void test('iOS connection adapter keeps clean command facts and terminal projection unchanged', () => {
  const history = [command()];
  const projection = projectIosConnectionAttemptTerminalFacts({
    commandExecutions: history,
    callbackCompleted: true,
    captureResult: 'observed',
    captureExitCode: 0,
    captureCleanup: 'cleaned',
  });
  assert.equal(projection.historyKnown, true);
  assert.equal(projection.childExitCode, 0);
  assert.equal(projection.childClassification, 'completed');
  assert.deepEqual(projection.censusFailures, []);
  assert.deepEqual(projection.outputFailures, []);
  assert.deepEqual(
    requireIosSuccessfulConnectionCommandDiagnostics(history),
    projection.commandDiagnostics,
  );
  assert.deepEqual(
    projectTerminal({
      commandExecutions: history,
      callbackCompleted: true,
      captureResult: 'observed',
      captureExitCode: 0,
      captureCleanup: 'cleaned',
    }),
    projection,
  );
});

void test('iOS connection adapter blocks late census, output failure and cancellation facts', () => {
  const census = [command({ censusFailure: { kind: 'late-publication-failure' } })];
  const censusProjection = projectIosConnectionAttemptTerminalFacts({
    commandExecutions: census,
    callbackCompleted: true,
    captureResult: 'observed',
    captureExitCode: 0,
    captureCleanup: 'cleaned',
  });
  assert.equal(censusProjection.childExitCode, 0);
  assert.equal(censusProjection.censusFailures.length, 1);
  assert.throws(() => requireIosSuccessfulConnectionCommandDiagnostics(census), /census failure/);

  const outputFailure = [
    command({
      execution: 'harness-blocked',
      outputFailure: { reason: 'io', stream: 'stderr', bytes: 3, message: 'EIO' },
    }),
  ];
  const outputProjection = projectIosConnectionAttemptTerminalFacts({
    commandExecutions: outputFailure,
    callbackCompleted: true,
    captureResult: 'harness-blocked',
    captureExitCode: 2,
    captureCleanup: 'cleaned',
  });
  assert.equal(outputProjection.childExitCode, 0);
  assert.equal(outputProjection.childClassification, 'output-failed');
  assert.equal(outputProjection.outputFailures.length, 1);
  assert.throws(
    () => requireIosSuccessfulConnectionCommandDiagnostics(outputFailure),
    /not completed|output failure/,
  );

  const cancelled = projectIosConnectionAttemptTerminalFacts({
    commandExecutions: [
      command({ execution: 'cancelled', childExitCode: null, childSignal: 'SIGTERM' }),
    ],
    callbackCompleted: false,
    captureResult: 'cancelled',
    captureExitCode: 143,
    captureCleanup: 'cleaned',
  });
  assert.equal(cancelled.childClassification, 'cancelled');
  assert.equal(cancelled.childSignal, 'SIGTERM');
  assert.equal(cancelled.cancellation, 'SIGTERM');
});

void test('owned iOS connection adapter rejects cancelled, stale and wrong-platform requests before acquisition', async () => {
  const repositoryRoot = await realpath(path.resolve(__dirname, '../..'));
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  const selection = await selectNativePilotScenario(
    { platform: 'ios', engine: 'maestro', scenario: 'SCN-connection-ios', mode: 'integration' },
    inventory,
    repositoryRoot,
  );
  const controller = new AbortController();
  controller.abort('SIGINT');
  await assert.rejects(
    runIosConnectionAttempt({
      repositoryRoot,
      requestedRunId: 'a'.repeat(24),
      selection,
      signal: controller.signal,
    }),
    (reason) => reason === 'SIGINT',
  );
  await assert.rejects(
    runIosConnectionAttempt({
      repositoryRoot,
      requestedRunId: 'a'.repeat(24),
      selection,
      signal: new AbortController().signal,
      bootstatusDeadlineMs: 180001,
    }),
    /Invalid simulator bootstatus deadline/,
  );
  const stale = structuredClone(selection);
  stale.requirementHash = '0'.repeat(64);
  await assert.rejects(
    runIosConnectionAttempt({
      repositoryRoot,
      requestedRunId: 'a'.repeat(24),
      selection: stale,
      signal: new AbortController().signal,
    }),
    /changed before acquisition/,
  );
  const android = await selectNativePilotScenario(
    {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-connection-android',
      mode: 'integration',
    },
    inventory,
    repositoryRoot,
  );
  await assert.rejects(
    runIosConnectionAttempt({
      repositoryRoot,
      requestedRunId: 'a'.repeat(24),
      selection: android,
      signal: new AbortController().signal,
    }),
  );
});

void test('iOS connection adapter rejects malformed or empty command history', () => {
  assert.throws(() => requireIosSuccessfulConnectionCommandDiagnostics(undefined), /non-empty/);
  const malformed = projectIosConnectionAttemptTerminalFacts({
    commandExecutions: [{ label: 42 }],
    callbackCompleted: true,
    captureResult: 'observed',
    captureExitCode: 0,
    captureCleanup: 'cleaned',
  });
  assert.equal(malformed.historyKnown, false);
  assert.equal(malformed.childExitCode, null);
  assert.equal(malformed.childClassification, 'harness-blocked');
});
