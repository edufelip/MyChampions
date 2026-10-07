import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureAndroidReadonlyDiagnosticsWithBudget } from '../../scripts/testing/capture-android-testability';
import type { captureAndroidReadonlyDiagnostic } from '../../scripts/testing/native-android-driver-diagnostics';
import type { NativeCommandExecution } from '../../scripts/testing/owned-native-command';

type CaptureInput = Parameters<typeof captureAndroidReadonlyDiagnostic>[0];
type CaptureResult = Awaited<ReturnType<typeof captureAndroidReadonlyDiagnostic>>;

const deviceLabels = [
  'android-driver-instrumentation-inventory',
  'android-driver-device-logcat',
  'android-driver-package-state',
  'android-driver-process-state',
  'android-driver-port-state',
] as const;

const originalExecution: NativeCommandExecution = {
  phase: 'step',
  execution: 'child-failed',
  cleanup: 'cleaned',
  childExitCode: 1,
  childSignal: null,
  pid: 3210,
  pgid: 3210,
  logPath: null,
  stdoutPath: null,
  ownershipPath: null,
  elapsedMs: 120,
  cleanupMs: 15,
  outputFailure: {
    reason: 'limit',
    stream: 'stderr',
    bytes: 1024,
    message: 'bounded output limit',
  },
};

function result(label: CaptureInput['label'], status: 'passed' | 'failed'): CaptureResult {
  return {
    receiptPath: `${label}.receipt.private.json`,
    outputPaths: [],
    receipt: {
      status,
      originalCause: null,
      observedError: null,
      outputLimitExceeded: false,
    },
  } as unknown as CaptureResult;
}

function fakeTarget(
  overrides: {
    verify?: (phaseDeadline?: number) => Promise<void>;
    adbRead?: (argv: string[], timeoutMs?: number, phaseDeadline?: number) => Promise<string>;
  } = {},
) {
  return {
    runId: 'owner-run',
    identity: { serial: 'emulator-5554' },
    slot: { adbServerPort: 31001 },
    verify: overrides.verify ?? (() => Promise.resolve()),
    adbRead: overrides.adbRead ?? (() => Promise.resolve('ok')),
  };
}

void test('verification failure is retained and gates every device query without changing the original outcome', async () => {
  const labels: string[] = [];
  const adbCalls: string[][] = [];
  const report: Record<string, unknown> = {};
  const capture = async (options: CaptureInput) => {
    labels.push(options.label);
    try {
      await options.read();
      return result(options.label, 'passed');
    } catch {
      return result(options.label, 'failed');
    }
  };
  const target = fakeTarget({
    verify: () => Promise.reject(new Error('owned target disappeared')),
    adbRead: (argv) => {
      adbCalls.push(argv);
      return Promise.resolve('unexpected');
    },
  });

  const outcome = await captureAndroidReadonlyDiagnosticsWithBudget({
    artifactRoot: '/private/capture-run',
    trigger: 'maestro-readiness',
    originalExecution,
    target,
    signal: new AbortController().signal,
    report,
    capture,
    now: () => 0,
  });

  assert.deepEqual(labels, ['android-driver-target-verification']);
  assert.deepEqual(adbCalls, []);
  assert.deepEqual(report.androidDriverOriginalExecution, {
    execution: originalExecution.execution,
    cleanup: originalExecution.cleanup,
    childExitCode: originalExecution.childExitCode,
    childSignal: originalExecution.childSignal,
    pid: originalExecution.pid,
    pgid: originalExecution.pgid,
    logPath: originalExecution.logPath,
    stdoutPath: originalExecution.stdoutPath,
    outputFailure: originalExecution.outputFailure,
    censusFailure: null,
  });
  assert.equal((report.androidDriverDiagnosticVerification as { status: string }).status, 'failed');
  assert.deepEqual(outcome.skipped, deviceLabels);
});

void test('a failed read remains in its receipt while later fixed queries continue exactly once', async () => {
  const labels: string[] = [];
  const adbCalls: string[][] = [];
  const queryPhaseDeadlines: number[] = [];
  const verifyPhaseDeadlines: number[] = [];
  const report: Record<string, unknown> = {};
  const capture = async (options: CaptureInput) => {
    labels.push(options.label);
    try {
      await options.read();
      return result(options.label, 'passed');
    } catch {
      return result(options.label, 'failed');
    }
  };
  const target = fakeTarget({
    verify: (phaseDeadline) => {
      verifyPhaseDeadlines.push(phaseDeadline ?? -1);
      return Promise.resolve();
    },
    adbRead: (argv, timeoutMs, phaseDeadline) => {
      adbCalls.push(argv);
      assert.equal(timeoutMs, 5_000);
      queryPhaseDeadlines.push(phaseDeadline ?? -1);
      return adbCalls.length === 1
        ? Promise.reject(new Error('inventory read failed'))
        : Promise.resolve('ok');
    },
  });

  const outcome = await captureAndroidReadonlyDiagnosticsWithBudget({
    artifactRoot: '/private/capture-run',
    trigger: 'maestro-readiness',
    originalExecution,
    target,
    signal: new AbortController().signal,
    report,
    capture,
    now: () => 0,
  });

  assert.deepEqual(labels, ['android-driver-target-verification', ...deviceLabels]);
  assert.deepEqual(adbCalls, [
    ['shell', 'pm', 'list', 'instrumentation'],
    ['logcat', '-d', '-v', 'threadtime', '-t', '1000'],
    ['shell', 'pm', 'list', 'packages', '--user', '0', 'dev.mobile.maestro'],
    ['shell', 'ps', '-A'],
    ['shell', 'cat', '/proc/net/tcp'],
  ]);
  assert.equal(new Set(labels).size, labels.length);
  assert.deepEqual(verifyPhaseDeadlines, [5_000, 5_000, 5_000, 5_000, 5_000, 5_000]);
  assert.deepEqual(queryPhaseDeadlines, [5_000, 5_000, 5_000, 5_000, 5_000]);
  assert.deepEqual(queryPhaseDeadlines, [5_000, 5_000, 5_000, 5_000, 5_000]);
  assert.deepEqual(outcome.skipped, []);
  assert.equal(
    (report.androidDriverDiagnostics as Record<string, { status: string }>)[
      'android-driver-instrumentation-inventory'
    ].status,
    'failed',
  );
  assert.deepEqual(report.androidDriverDiagnosticPublicationErrors, {});
});

void test('the total diagnostic deadline marks remaining queries skipped without another read', async () => {
  const labels: string[] = [];
  const adbCalls: string[][] = [];
  const report: Record<string, unknown> = {};
  let clock = 0;
  const capture = async (options: CaptureInput) => {
    labels.push(options.label);
    await options.read();
    clock = 30_001;
    return result(options.label, 'passed');
  };
  const target = fakeTarget({
    adbRead: (argv) => {
      adbCalls.push(argv);
      return Promise.resolve('unexpected');
    },
  });

  const outcome = await captureAndroidReadonlyDiagnosticsWithBudget({
    artifactRoot: '/private/capture-run',
    trigger: 'maestro-readiness',
    originalExecution,
    target,
    signal: new AbortController().signal,
    report,
    capture,
    now: () => clock,
  });

  assert.deepEqual(labels, ['android-driver-target-verification']);
  assert.deepEqual(adbCalls, []);
  assert.deepEqual(outcome.skipped, deviceLabels);
  assert.deepEqual(report.androidDriverDiagnosticSkipped, deviceLabels);
  assert.deepEqual(report.androidDriverDiagnosticCollection, {
    status: 'budget-exhausted',
    reason: 'total-deadline',
    elapsedMs: 30_001,
    overrunMs: 1,
  });
});

void test('an aborted diagnostic window records not-run verification and performs no device read', async () => {
  const controller = new AbortController();
  controller.abort(new Error('original command cancelled'));
  const report: Record<string, unknown> = {};
  let captureCalls = 0;
  let verifyCalls = 0;
  let adbCalls = 0;
  const capture = async (options: CaptureInput) => {
    captureCalls += 1;
    await options.read();
    return result(options.label, 'passed');
  };
  const target = fakeTarget({
    verify: () => {
      verifyCalls += 1;
      return Promise.resolve();
    },
    adbRead: () => {
      adbCalls += 1;
      return Promise.resolve('unexpected');
    },
  });

  const outcome = await captureAndroidReadonlyDiagnosticsWithBudget({
    artifactRoot: '/private/capture-run',
    trigger: 'maestro-readiness',
    originalExecution,
    target,
    signal: controller.signal,
    report,
    capture,
    now: () => 0,
  });

  assert.equal(captureCalls, 0);
  assert.equal(verifyCalls, 0);
  assert.equal(adbCalls, 0);
  assert.deepEqual(outcome.skipped, deviceLabels);
  assert.equal(
    (report.androidDriverDiagnostics as Record<string, { skippedReason: string }>)[
      'android-driver-target-verification'
    ].skippedReason,
    'android-driver-diagnostic-signal-aborted',
  );
  assert.deepEqual(report.androidDriverDiagnosticCollection, {
    status: 'interrupted',
    reason: 'signal-aborted',
    elapsedMs: 0,
    overrunMs: 0,
  });
});

void test('one publication failure is recorded separately while independent reads remain eligible', async () => {
  const labels: string[] = [];
  const report: Record<string, unknown> = {};
  const capture = async (options: CaptureInput) => {
    labels.push(options.label);
    if (options.label === 'android-driver-device-logcat') {
      const error = new Error('receipt write failed');
      error.name = 'N'.repeat(256);
      throw error;
    }
    await options.read();
    return result(options.label, 'passed');
  };
  const target = fakeTarget();

  await captureAndroidReadonlyDiagnosticsWithBudget({
    artifactRoot: '/private/capture-run',
    trigger: 'maestro-readiness',
    originalExecution,
    target,
    signal: new AbortController().signal,
    report,
    capture,
    now: () => 0,
  });

  assert.deepEqual(labels, ['android-driver-target-verification', ...deviceLabels]);
  assert.deepEqual(report.androidDriverDiagnosticPublicationErrors, {
    'android-driver-device-logcat': {
      name: 'N'.repeat(128),
      message: 'receipt write failed',
    },
  });
  assert.equal(
    (report.androidDriverDiagnostics as Record<string, { status: string }>)[
      'android-driver-device-logcat'
    ].status,
    'blocked',
  );
});

void test('the original combined command log is referenced privately and only an unambiguous recorded port is parsed', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-android-driver-capture-')));
  await chmod(root, 0o700);
  try {
    const repeatedLine =
      'Maestro Android driver did not start up in time: port [ dadb.open( tcp:62774 ) ]';
    const cases = [
      {
        name: 'repeated-identical',
        content: `startup\n${repeatedLine}\n${repeatedLine}\n`,
        expected: 62774,
      },
      {
        name: 'conflicting',
        content: `${repeatedLine}\n${repeatedLine.replace('62774', '62775')}\n`,
        expected: null,
      },
      {
        name: 'truncated',
        content: `${repeatedLine}\n${'x'.repeat(1024 * 1024)}`,
        expected: null,
      },
    ] as const;
    for (const testCase of cases) {
      const logPath = path.join(root, `${testCase.name}.private.log`);
      await writeFile(logPath, testCase.content, { mode: 0o600 });
      const report: Record<string, unknown> = {};
      const capture = async (options: CaptureInput) => {
        try {
          await options.read();
          return result(options.label, 'passed');
        } catch {
          return result(options.label, 'failed');
        }
      };
      await captureAndroidReadonlyDiagnosticsWithBudget({
        artifactRoot: root,
        trigger: 'maestro-readiness',
        originalExecution: { ...originalExecution, logPath },
        target: fakeTarget({
          verify: () => Promise.reject(new Error('verification failed')),
        }),
        signal: new AbortController().signal,
        report,
        capture,
        now: () => 0,
      });
      assert.equal(report.originalMaestroDriverPort, testCase.expected, testCase.name);
      assert.equal(
        (report.androidDriverOriginalOutput as { sourceKind: string }).sourceKind,
        'combined-owned-command-log',
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
