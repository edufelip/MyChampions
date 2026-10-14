import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { selectNativePilotScenario } from '../../scripts/testing/native-pilot-contract';
import {
  isQualifiedIosApplicationFailureCommandHistory,
  projectIosTrainingAttemptTerminalFacts,
  projectIosTrainingAttemptRuntimeDiagnostics,
  projectIosTrainingCommandDiagnostics,
  requireIosSuccessfulTrainingCommandDiagnostics,
  runIosTrainingAttempt,
  trainingAttemptChildExitCode,
} from '../../scripts/testing/run-ios-training-attempt';

void test('engine child status remains distinct from an interrupted controller or failed cleanup', () => {
  assert.equal(trainingAttemptChildExitCode([{ childExitCode: 0 }], false), null);
  assert.equal(trainingAttemptChildExitCode([{ childExitCode: 0 }], true), 0);
  assert.equal(trainingAttemptChildExitCode([{ childExitCode: 7 }], false), 7);
  assert.equal(trainingAttemptChildExitCode([{ childExitCode: null }], false), null);
});

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
  label: 'ios-training',
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

void test('iOS command projection preserves clean completion and gates public success', () => {
  const history = [command()];
  const projection = projectIosTrainingCommandDiagnostics(history, true);
  assert.equal(projection.historyKnown, true);
  assert.equal(projection.childExitCode, 0);
  assert.equal(projection.childClassification, 'completed');
  assert.deepEqual(projection.censusFailures, []);
  assert.deepEqual(projection.outputFailures, []);
  assert.deepEqual(
    requireIosSuccessfulTrainingCommandDiagnostics(history),
    projection.commandDiagnostics,
  );
});

void test('iOS late census publication failure blocks a zero-child success', () => {
  const history = [command({ censusFailure: { kind: 'late-publication-failure' } })];
  const projection = projectIosTrainingCommandDiagnostics(history, true);
  assert.equal(projection.childExitCode, 0);
  assert.equal(projection.childClassification, 'completed');
  assert.equal(projection.censusFailures.length, 1);
  assert.throws(() => requireIosSuccessfulTrainingCommandDiagnostics(history), /census failure/);
});

void test('iOS output failure stays distinct from the original zero child exit', () => {
  const history = [
    command({
      execution: 'harness-blocked',
      outputFailure: { reason: 'io', stream: 'stderr', bytes: 3, message: 'EIO' },
    }),
  ];
  const projection = projectIosTrainingCommandDiagnostics(history, true);
  assert.equal(projection.childExitCode, 0);
  assert.equal(projection.childClassification, 'output-failed');
  assert.equal(projection.outputFailures.length, 1);
  assert.throws(
    () => requireIosSuccessfulTrainingCommandDiagnostics(history),
    /not completed|output failure/,
  );
});

void test('iOS application failure requires a known clean child-one history', () => {
  const failed = [command({ execution: 'child-failed', childExitCode: 1 })];
  assert.equal(isQualifiedIosApplicationFailureCommandHistory(failed), true);
  assert.equal(
    isQualifiedIosApplicationFailureCommandHistory([
      command({ execution: 'child-failed', childExitCode: 1 }),
      command(),
    ]),
    true,
  );
  assert.equal(
    isQualifiedIosApplicationFailureCommandHistory([
      command({ execution: 'child-failed', childExitCode: 1, censusFailure: { kind: 'late' } }),
    ]),
    false,
  );
  assert.equal(
    isQualifiedIosApplicationFailureCommandHistory([
      command({ execution: 'child-failed', childExitCode: 1, childSignal: 'SIGTERM' }),
    ]),
    false,
  );
  assert.equal(
    isQualifiedIosApplicationFailureCommandHistory([
      command({ execution: 'child-failed', childExitCode: 1, cleanup: 'unknown' }),
    ]),
    false,
  );
  assert.equal(
    isQualifiedIosApplicationFailureCommandHistory([
      command({ execution: 'child-failed', childExitCode: 1 }),
      command({ execution: 'harness-blocked', childExitCode: null }),
    ]),
    false,
  );
  const { childSignal: _missingSignal, ...missingSignal } = command();
  assert.equal(isQualifiedIosApplicationFailureCommandHistory([missingSignal]), false);
  const { childExitCode: _missingExit, ...missingExit } = command();
  assert.equal(isQualifiedIosApplicationFailureCommandHistory([missingExit]), false);
  assert.equal(
    isQualifiedIosApplicationFailureCommandHistory([
      command({ execution: 'child-failed', childExitCode: 1, phase: 'build' }),
    ]),
    false,
  );
});

void test('iOS adapter boundary propagates output failures from the terminal projection', () => {
  const outputFailure = { reason: 'io', stream: 'stderr', bytes: 3, message: 'EIO' } as const;
  const terminal = projectIosTrainingAttemptTerminalFacts({
    commandExecutions: [
      command({
        execution: 'harness-blocked',
        outputFailure,
      }),
    ],
    callbackCompleted: false,
    captureResult: 'harness-blocked',
    captureExitCode: 2,
  });
  assert.deepEqual(projectIosTrainingAttemptRuntimeDiagnostics(terminal), {
    commandDiagnostics: terminal.commandDiagnostics,
    censusFailures: [],
    outputFailures: [outputFailure],
  });
});

void test('iOS terminal projection retains cancellation, signal and malformed history facts', () => {
  const cancelled = projectIosTrainingAttemptTerminalFacts({
    commandExecutions: [
      command({ execution: 'cancelled', childExitCode: null, childSignal: 'SIGTERM' }),
    ],
    callbackCompleted: false,
    captureResult: 'cancelled',
    captureExitCode: 143,
    budgetTimeout: undefined,
  });
  assert.equal(cancelled.childClassification, 'cancelled');
  assert.equal(cancelled.childSignal, 'SIGTERM');
  assert.equal(cancelled.cancellation, 'SIGTERM');
  assert.equal(cancelled.captureCleanup, null);
  const originalCleanup = {
    status: 'failed-recovery-retained' as const,
    resources: ['foreign-ios-state-changed'],
  };
  const retainedCleanup = projectIosTrainingAttemptTerminalFacts({
    commandExecutions: [command()],
    callbackCompleted: true,
    captureResult: 'harness-blocked',
    captureExitCode: 2,
    captureCleanup: originalCleanup,
  });
  assert.strictEqual(retainedCleanup.captureCleanup, originalCleanup);
  assert.equal(
    projectIosTrainingAttemptTerminalFacts({
      commandExecutions: [command()],
      callbackCompleted: true,
      captureResult: 'observed',
      captureExitCode: 0,
      captureCleanup: 'not-acquired',
    }).captureCleanup,
    'not-acquired',
  );
  for (const unknownCleanup of [undefined, 'pending', { status: 'cleaned' }, 42]) {
    assert.equal(
      projectIosTrainingAttemptTerminalFacts({
        commandExecutions: [command()],
        callbackCompleted: true,
        captureResult: 'observed',
        captureExitCode: 0,
        captureCleanup: unknownCleanup,
      }).captureCleanup,
      null,
    );
  }
  assert.throws(() => requireIosSuccessfulTrainingCommandDiagnostics(undefined), /non-empty/);
  const malformed = projectIosTrainingCommandDiagnostics([{ label: 42 }], true);
  assert.equal(malformed.historyKnown, false);
  assert.equal(malformed.childExitCode, null);
  assert.equal(malformed.childClassification, 'harness-blocked');
});

void test('owned iOS training adapter rejects cancelled, stale and wrong-platform requests before acquisition', async () => {
  const repositoryRoot = await realpath(path.resolve(__dirname, '../..'));
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  const selection = await selectNativePilotScenario(
    { platform: 'ios', engine: 'maestro', scenario: 'SCN-training-ios', mode: 'integration' },
    inventory,
    repositoryRoot,
  );
  const controller = new AbortController();
  controller.abort('SIGINT');
  await assert.rejects(
    runIosTrainingAttempt({
      repositoryRoot,
      requestedRunId: 'a'.repeat(24),
      selection,
      signal: controller.signal,
    }),
    (reason) => reason === 'SIGINT',
  );
  const signal = new AbortController().signal;
  await assert.rejects(
    runIosTrainingAttempt({
      repositoryRoot,
      requestedRunId: 'a'.repeat(24),
      selection,
      signal,
      bootstatusDeadlineMs: 180001,
    }),
    /Invalid simulator bootstatus deadline/,
  );
  await assert.rejects(
    runIosTrainingAttempt({
      repositoryRoot,
      requestedRunId: 'invalid',
      selection,
      signal,
    }),
  );
  const stale = structuredClone(selection);
  stale.requirementHash = '0'.repeat(64);
  await assert.rejects(
    runIosTrainingAttempt({
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
      scenario: 'SCN-training-android',
      mode: 'integration',
    },
    inventory,
    repositoryRoot,
  );
  await assert.rejects(
    runIosTrainingAttempt({
      repositoryRoot,
      requestedRunId: 'a'.repeat(24),
      selection: android,
      signal,
    }),
  );
});
