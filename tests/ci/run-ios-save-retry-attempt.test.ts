import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { selectNativePilotScenario } from '../../scripts/testing/native-pilot-contract';
import {
  projectIosSaveRetryAttemptTerminalFacts,
  requireIosSuccessfulSaveRetryCommandDiagnostics,
  runIosSaveRetryAttempt,
} from '../../scripts/testing/run-ios-save-retry-attempt';

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
  label: 'ios-save-retry',
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

void test('iOS save/retry command diagnostics retain clean facts and block late failures', () => {
  const history = [command()];
  const projection = projectIosSaveRetryAttemptTerminalFacts({
    commandExecutions: history,
    callbackCompleted: true,
    captureResult: 'observed',
    captureExitCode: 0,
    captureCleanup: 'cleaned',
  });
  assert.equal(projection.historyKnown, true);
  assert.equal(projection.childExitCode, 0);
  assert.equal(projection.childClassification, 'completed');
  assert.deepEqual(
    requireIosSuccessfulSaveRetryCommandDiagnostics(history),
    projection.commandDiagnostics,
  );

  const lateCensus = [command({ censusFailure: { kind: 'late-publication-failure' } })];
  assert.equal(
    projectIosSaveRetryAttemptTerminalFacts({
      commandExecutions: lateCensus,
      callbackCompleted: true,
      captureResult: 'observed',
      captureExitCode: 0,
      captureCleanup: 'cleaned',
    }).childExitCode,
    0,
  );
  assert.throws(
    () => requireIosSuccessfulSaveRetryCommandDiagnostics(lateCensus),
    /census failure/,
  );

  const outputFailure = [
    command({
      execution: 'harness-blocked',
      outputFailure: { reason: 'io', stream: 'stderr', bytes: 3, message: 'EIO' },
    }),
  ];
  const outputProjection = projectIosSaveRetryAttemptTerminalFacts({
    commandExecutions: outputFailure,
    callbackCompleted: true,
    captureResult: 'harness-blocked',
    captureExitCode: 2,
    captureCleanup: 'cleaned',
  });
  assert.equal(outputProjection.childExitCode, 0);
  assert.equal(outputProjection.childClassification, 'output-failed');
  assert.throws(
    () => requireIosSuccessfulSaveRetryCommandDiagnostics(outputFailure),
    /not completed|output failure/,
  );
});

void test('iOS save/retry terminal projection preserves cancellation and malformed history', () => {
  const cancelled = projectIosSaveRetryAttemptTerminalFacts({
    commandExecutions: [
      command({ execution: 'cancelled', childExitCode: null, childSignal: 'SIGTERM' }),
    ],
    callbackCompleted: false,
    captureResult: 'cancelled',
    captureExitCode: 143,
    captureCleanup: 'cleaned',
    cancellation: 'SIGTERM',
  });
  assert.equal(cancelled.childClassification, 'cancelled');
  assert.equal(cancelled.childSignal, 'SIGTERM');
  assert.equal(cancelled.cancellation, 'SIGTERM');
  const malformed = projectIosSaveRetryAttemptTerminalFacts({
    commandExecutions: [{ label: 42 }],
    callbackCompleted: true,
    captureResult: 'observed',
    captureExitCode: 0,
    captureCleanup: 'cleaned',
  });
  assert.equal(malformed.historyKnown, false);
  assert.equal(malformed.childExitCode, null);
  assert.equal(malformed.childClassification, 'harness-blocked');
  const bootstrapFailure = {
    phase: 'bootstatus',
    failureReason: 'deadline',
    deadlineMs: 180000,
    elapsedMs: 180001,
  };
  const bootstrap = projectIosSaveRetryAttemptTerminalFacts({
    commandExecutions: [],
    callbackCompleted: false,
    captureResult: 'harness-blocked',
    captureExitCode: 2,
    captureCleanup: 'cleaned',
    simulatorBootstrapFailure: bootstrapFailure,
  });
  assert.deepEqual(bootstrap.simulatorBootstrapFailure, bootstrapFailure);
  assert.equal(bootstrap.childExitCode, null);
  assert.equal(cancelled.simulatorBootstrapFailure, null);
});

void test('owned iOS save/retry adapter rejects cancelled, stale and wrong-platform requests before acquisition', async () => {
  const repositoryRoot = await realpath(path.resolve(__dirname, '../..'));
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  const selection = await selectNativePilotScenario(
    { platform: 'ios', engine: 'maestro', scenario: 'SCN-save-retry-ios', mode: 'integration' },
    inventory,
    repositoryRoot,
  );
  const controller = new AbortController();
  controller.abort('SIGINT');
  await assert.rejects(
    runIosSaveRetryAttempt({
      repositoryRoot,
      requestedRunId: 'a'.repeat(24),
      selection,
      signal: controller.signal,
    }),
    (reason) => reason === 'SIGINT',
  );
  const signal = new AbortController().signal;
  await assert.rejects(
    runIosSaveRetryAttempt({
      repositoryRoot,
      requestedRunId: 'invalid',
      selection,
      signal,
    }),
  );
  await assert.rejects(
    runIosSaveRetryAttempt({
      repositoryRoot,
      requestedRunId: 'a'.repeat(24),
      selection,
      signal,
      bootstatusDeadlineMs: 180001,
    }),
    /Invalid simulator bootstatus deadline/,
  );
  const stale = structuredClone(selection);
  stale.requirementHash = '0'.repeat(64);
  await assert.rejects(
    runIosSaveRetryAttempt({
      repositoryRoot,
      requestedRunId: 'a'.repeat(24),
      selection: stale,
      signal,
    }),
    /changed before acquisition/,
  );
  const android = await selectNativePilotScenario(
    {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-save-retry-android',
      mode: 'integration',
    },
    inventory,
    repositoryRoot,
  );
  await assert.rejects(
    runIosSaveRetryAttempt({
      repositoryRoot,
      requestedRunId: 'a'.repeat(24),
      selection: android,
      signal,
    }),
  );
});
