import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  buildCallerOutputRootBindingReceipt,
  buildCallerOutputRootBindingSidecar,
  type IosCameraRuntimeContext,
} from '../../scripts/testing/capture-native-testability';
import { normalizeAndroidCommandDiagnostic } from '../../scripts/testing/run-android-training-attempt';
import {
  requireCameraCallerOutputRootBinding,
  type IosCameraAttemptDependencies,
} from '../../scripts/testing/run-ios-camera-attempt';
import {
  nativePilotCleanupStatus,
  nativePilotExecutionAdapter,
  nativeCameraPublicEvidenceBindings,
  readRepositorySourcesBestEffort,
  runIosCameraAttemptForPublicDispatch,
  resolveIosCameraDiagnosticOption,
  resolveNativePilotTerminalDecision,
  type NativePilotRuntimeTerminalFacts,
} from '../../scripts/testing/run-native-pilot';
import { assertPublicReceipt } from '../../scripts/testing/schema-validation';
import { repositoryIdentity } from '../../scripts/testing/testing-repository-identity';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const execute = promisify(execFile);
const repository = path.resolve(__dirname, '../..');
// Receipts record both repositories, so the real entry point needs the paired ../server checkout.
const pairedServerCheckout = existsSync(path.join(repository, '../server'));

async function createCommittedRepository(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  const git = (...args: string[]) => execute('git', ['-C', root, ...args]);
  await git('init', '-q');
  await writeFile(path.join(root, 'tracked.txt'), `${prefix} fixture bytes`);
  await git('add', 'tracked.txt');
  await git(
    '-c',
    'user.name=Testing fixture',
    '-c',
    'user.email=testing@example.invalid',
    'commit',
    '-q',
    '-m',
    'test fixture',
  );
  return root;
}

async function requirePreflightSidecar(root: string, artifact: string, runId: string) {
  const file = path.join(root, artifact);
  assert.equal(await realpath(file), file);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const value = JSON.parse(await readFile(file, 'utf8')) as {
    requestedRunId: unknown;
    requestedAttemptId?: unknown;
    outputRoot?: unknown;
    outputParent?: unknown;
    kind: unknown;
  };
  assert.equal(value.requestedRunId, runId);
  if (artifact === 'attempt-identity.private.json') {
    assert.ok(
      value.kind ===
        'private native pilot requested identity and output binding; not passing evidence' ||
        value.kind === 'private blocked native pilot preflight identity; not passing evidence',
    );
    assert.equal(value.requestedAttemptId, `${runId}:first`);
    assert.equal(value.outputRoot, root);
    assert.equal(value.outputParent, path.dirname(root));
  } else {
    assert.equal(artifact, 'execution-deadlines.private.json');
    assert.equal(value.kind, 'resolved public native execution bounds; not behavioral evidence');
  }
}

type PreflightReceipt = {
  runId: string;
  result: string;
  exitCode: number;
  childExitCode: number | null;
  scenarioId: string;
  engine: string;
  platform: string;
  dataMode: string;
  repositories: { name: string; sha: string; dirty: boolean; workingTreeHash: string | null }[];
  repositoryEvidence?: { status: string; missing: readonly string[]; reason: string | null };
  blocker: { code: string };
  cleanup: { status: string; ownedResourceIds: string[] };
  assertions: unknown[];
  artifacts: string[];
};

void test('native dispatch admits only reviewed integration cells', () => {
  const base = {
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-save-retry-ios',
    mode: 'integration',
  } as const;
  assert.equal(nativePilotExecutionAdapter(base), 'ios-save-retry');
  assert.equal(
    nativePilotExecutionAdapter({
      ...base,
      platform: 'android',
      scenario: 'SCN-save-retry-android',
    }),
    'android-save-retry',
  );
  assert.equal(nativePilotExecutionAdapter({ ...base, engine: 'detox' as never }), null);
  assert.equal(nativePilotExecutionAdapter({ ...base, mode: 'fixture' }), null);
  assert.equal(nativePilotExecutionAdapter({ ...base, platform: 'android' }), null);
  for (const platform of ['ios', 'android'] as const) {
    assert.equal(
      nativePilotExecutionAdapter({ ...base, platform, scenario: `SCN-training-${platform}` }),
      'training',
    );
    assert.equal(
      nativePilotExecutionAdapter({
        ...base,
        platform,
        engine: 'detox' as never,
        scenario: `SCN-training-${platform}`,
      }),
      null,
    );
    assert.equal(
      nativePilotExecutionAdapter({
        ...base,
        platform,
        scenario: `SCN-session-${platform}`,
      }),
      platform === 'ios' ? 'ios-session' : 'android-session',
    );
    assert.equal(
      nativePilotExecutionAdapter({
        ...base,
        platform,
        engine: 'detox' as never,
        scenario: `SCN-session-${platform}`,
      }),
      null,
    );
    assert.equal(
      nativePilotExecutionAdapter({
        ...base,
        platform,
        mode: 'fixture',
        scenario: `SCN-session-${platform}`,
      }),
      null,
    );
    assert.equal(
      nativePilotExecutionAdapter({
        ...base,
        platform,
        scenario: `SCN-session-${platform === 'ios' ? 'android' : 'ios'}`,
      }),
      null,
    );
  }
  const camera = {
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-camera-denied-ios',
    mode: 'integration',
  } as const;
  assert.equal(nativePilotExecutionAdapter(camera), 'camera');
  assert.equal(nativePilotExecutionAdapter({ ...camera, engine: 'detox' as never }), null);
  assert.equal(nativePilotExecutionAdapter({ ...camera, mode: 'fixture' }), null);
  assert.equal(
    nativePilotExecutionAdapter({
      ...camera,
      platform: 'android',
      scenario: 'SCN-camera-denied-android',
    }),
    'camera',
  );
});

void test('connection dispatch accepts only the matching integrated Maestro platform', () => {
  for (const platform of ['ios', 'android'] as const) {
    const args = {
      platform,
      engine: 'maestro',
      scenario: `SCN-connection-${platform}`,
      mode: 'integration',
    } as const;
    assert.equal(nativePilotExecutionAdapter(args), 'connection');
    assert.equal(nativePilotExecutionAdapter({ ...args, engine: 'detox' as never }), null);
    assert.equal(nativePilotExecutionAdapter({ ...args, mode: 'fixture' }), null);
    assert.equal(
      nativePilotExecutionAdapter({
        ...args,
        platform: platform === 'ios' ? 'android' : 'ios',
      }),
      null,
    );
  }
});

void test('camera public dispatch forwards only the reviewed iOS selection to an injected runner', async () => {
  const selection = {
    arguments: {
      platform: 'ios',
      engine: 'maestro',
      scenario: 'SCN-camera-denied-ios',
      mode: 'integration',
    },
  } as NativePilotSelection;
  const options = {
    repositoryRoot: repository,
    requestedRunId: 'a'.repeat(24),
    selection,
    signal: new AbortController().signal,
    outputRoot: path.join(repository, '.qa/artifacts/native-pilot-attempts', 'a'.repeat(24)),
    deadlineAt: performance.now() + 120_000,
  } satisfies Parameters<typeof runIosCameraAttemptForPublicDispatch>[0];
  let calls = 0;
  const sentinel = { kind: 'injected-camera-result' };
  const result = await runIosCameraAttemptForPublicDispatch(options, (received) => {
    calls += 1;
    assert.deepEqual(received, options);
    return Promise.resolve(sentinel as never);
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, sentinel);

  let expiredCalls = 0;
  await assert.rejects(
    runIosCameraAttemptForPublicDispatch({ ...options, deadlineAt: performance.now() - 1 }, () => {
      expiredCalls++;
      return Promise.resolve(sentinel as never);
    }),
    /deadline must remain in the original future window/,
  );
  assert.equal(expiredCalls, 0, 'Expired public deadline must reject before capture dispatch');

  const diagnosticOptions = { ...options, credentialInteractionDiagnostic: true };
  assert.equal(resolveIosCameraDiagnosticOption({ requested: true, selection }), true);
  assert.equal(resolveIosCameraDiagnosticOption({ requested: undefined, selection }), undefined);
  assert.throws(
    () =>
      resolveIosCameraDiagnosticOption({
        requested: true,
        selection: {
          ...selection,
          arguments: { ...selection.arguments, engine: 'detox' as never },
        },
      }),
    /requires the iOS Maestro camera integration selection/,
  );
  const diagnosticResult = await runIosCameraAttemptForPublicDispatch(
    diagnosticOptions,
    (received) => {
      assert.deepEqual(received, diagnosticOptions);
      return Promise.resolve(sentinel as never);
    },
  );
  assert.deepEqual(diagnosticResult, sentinel);

  await assert.rejects(
    runIosCameraAttemptForPublicDispatch(
      {
        ...options,
        selection: {
          ...selection,
          arguments: { ...selection.arguments, platform: 'android' },
        },
      },
      () => Promise.resolve(sentinel as never),
    ),
    /reviewed iOS Maestro integration selection/,
  );
  await assert.rejects(
    runIosCameraAttemptForPublicDispatch(
      {
        ...diagnosticOptions,
        selection: {
          ...selection,
          arguments: { ...selection.arguments, scenario: 'SCN-session-ios' },
        },
      },
      () => Promise.resolve(sentinel as never),
    ),
    /reviewed iOS Maestro integration selection/,
  );
});

void test('camera public receipt bindings cover every declared UI/API/SQL kind', () => {
  assert.deepEqual(nativeCameraPublicEvidenceBindings['NAT-camera-normal-entry'], {
    ui: ['camera-prompt.png', 'camera-prompt-hierarchy.json'],
    api: ['transport-observations.private.json'],
    sql: ['camera-connection-before.private.json'],
  });
  assert.deepEqual(nativeCameraPublicEvidenceBindings['NAT-camera-denial-guidance'], {
    ui: ['camera-guidance.png', 'camera-guidance-hierarchy.json'],
  });
  assert.deepEqual(nativeCameraPublicEvidenceBindings['NAT-camera-manual-submit'], {
    ui: [
      'camera-manual.png',
      'camera-manual-hierarchy.json',
      'camera-pending.png',
      'camera-pending-hierarchy.json',
    ],
    api: ['transport-observations.private.json'],
    sql: ['camera-connection-pending.private.json'],
  });
  assert.deepEqual(nativeCameraPublicEvidenceBindings['NAT-camera-unrelated-state'], {
    sql: [
      'camera-isolation-before.private.json',
      'camera-isolation-after.private.json',
      'camera-training-before.private.json',
      'camera-training-after.private.json',
    ],
  });
  const all = Object.values(nativeCameraPublicEvidenceBindings).flatMap((kinds) =>
    Object.values(kinds).flat(),
  );
  assert.equal(all.includes('camera-training-before.private.json'), true);
  assert.equal(all.includes('camera-training-after.private.json'), true);
  assert.equal(all.includes('transport-observations.private.json'), true);
});

void test('camera producer receipt binds the separate caller root and original deadline', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'camera-binding-')));
  const captureRoot = path.join(parent, 'capture-root');
  const requestedRunId = 'b'.repeat(24);
  const outputRoot = path.join(parent, requestedRunId);
  const captureRunId = 'c'.repeat(24);
  const deadlineAt = performance.now() + 120_000;
  await mkdir(captureRoot, { mode: 0o700 });
  await mkdir(outputRoot, { mode: 0o700 });
  try {
    const metadata = await stat(outputRoot);
    const binding = {
      path: outputRoot,
      identity: {
        dev: metadata.dev,
        ino: metadata.ino,
        mode: metadata.mode & 0o777,
        uid: metadata.uid,
        nlink: metadata.nlink,
      },
    };
    const report = {
      ...buildCallerOutputRootBindingReceipt({
        requestedRunId,
        captureRunId,
        binding,
        deadlineAtMonotonicMs: deadlineAt,
      }),
      budget: { callerDeadlineAtMonotonicMs: deadlineAt },
    };
    await writeFile(
      path.join(captureRoot, 'caller-output-root-binding.private.json'),
      JSON.stringify(
        buildCallerOutputRootBindingSidecar({
          requestedRunId,
          captureRunId,
          binding,
          deadlineAtMonotonicMs: deadlineAt,
        }),
        null,
        2,
      ),
      { mode: 0o600, flag: 'wx' },
    );
    await requireCameraCallerOutputRootBinding({
      captureRoot,
      outputRoot,
      requestedRunId,
      captureRunId,
      deadlineAt,
      report,
    });

    await assert.rejects(
      requireCameraCallerOutputRootBinding({
        captureRoot,
        outputRoot,
        requestedRunId,
        captureRunId,
        deadlineAt: deadlineAt + 1,
        report,
      }),
      /strictEqual|Expected values|AssertionError/,
      'A deadline changed after capture must not be accepted',
    );
    const legacyBudgetOnly = {
      ...report,
      callerOutputRootBinding: undefined,
    };
    await assert.rejects(
      requireCameraCallerOutputRootBinding({
        captureRoot,
        outputRoot,
        requestedRunId,
        captureRunId,
        deadlineAt,
        report: legacyBudgetOnly,
      }),
      /binding is missing/,
      'A budget-only binding must not stand in for the producer receipt',
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('public camera dispatch reaches the actual adapter chain without acquisition', async () => {
  const inventory = JSON.parse(
    await readFile(path.join(repository, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as { scenarios: NativePilotSelection['scenario'][] };
  const scenario = inventory.scenarios.find((row) => row.id === 'SCN-camera-denied-ios');
  assert(scenario, 'camera scenario is missing from the candidate inventory');
  const selection = {
    arguments: {
      platform: 'ios',
      engine: 'maestro',
      scenario: 'SCN-camera-denied-ios',
      mode: 'integration',
    },
    scenario,
    scenarioHash: 'a'.repeat(64),
    requirementHash: 'b'.repeat(64),
  } satisfies NativePilotSelection;
  type Mode = 'positive' | 'binding-tamper' | 'deadline-tamper' | 'missing-binding' | 'cancel';
  const runAttempt = async (mode: Mode) => {
    const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'camera-chain-')));
    const modeNumber: Record<Mode, string> = {
      positive: '1',
      'binding-tamper': '2',
      'deadline-tamper': '3',
      'missing-binding': '4',
      cancel: '5',
    };
    const requestedRunId = modeNumber[mode].repeat(24);
    const captureRunId = `c${modeNumber[mode]}`.repeat(12);
    const fixtureRunId = `f${modeNumber[mode]}`.repeat(12);
    const captureRoot = path.join(parent, captureRunId);
    const outputRoot = path.join(parent, requestedRunId);
    const deadlineAt = performance.now() + 120_000;
    const controller = new AbortController();
    const trace: string[] = [];
    await mkdir(captureRoot, { mode: 0o700 });
    await mkdir(outputRoot, { mode: 0o700 });
    const dependencies: Partial<IosCameraAttemptDependencies> = {
      selectNativePilotScenario: async () => {
        await Promise.resolve();
        return selection;
      },
      runOwnedIosNativeSession: async (captureOptions) => {
        assert.equal(captureOptions.requestedRunId, requestedRunId);
        assert.equal(captureOptions.callerOutputRoot, outputRoot);
        assert.equal(captureOptions.deadlineAtMonotonicMs, deadlineAt);
        assert.equal(captureOptions.signal, controller.signal);
        assert.equal(captureOptions.credentialInteractionDiagnostic, true);
        trace.push(`capture:${captureRoot}`);
        const metadata = await stat(outputRoot);
        const binding = {
          path: outputRoot,
          identity: {
            dev: metadata.dev,
            ino: metadata.ino,
            mode: metadata.mode & 0o777,
            uid: metadata.uid,
            nlink: metadata.nlink,
          },
        };
        const persistedBinding =
          mode === 'binding-tamper'
            ? { ...binding, identity: { ...binding.identity, ino: binding.identity.ino + 1 } }
            : binding;
        const persistedDeadline = mode === 'deadline-tamper' ? deadlineAt + 1 : deadlineAt;
        const report: Record<string, unknown> = {
          ...buildCallerOutputRootBindingReceipt({
            requestedRunId,
            captureRunId,
            binding: mode === 'missing-binding' ? null : persistedBinding,
            deadlineAtMonotonicMs: persistedDeadline,
          }),
          budget: { callerDeadlineAtMonotonicMs: persistedDeadline },
          result: 'observed',
          cleanup: 'cleaned',
          nativePassingCases: 0,
          commandExecutions: [
            {
              label: 'camera-chain-control',
              phase: 'step',
              execution: 'completed',
              cleanup: 'cleaned',
              childExitCode: 0,
              childSignal: null,
              deadlineMs: 1_000,
              censusFailure: null,
              outputFailure: null,
            },
          ],
          backend: { runId: fixtureRunId },
          build: { environmentHash: 'e'.repeat(64) },
          connectionApiIdentity: { targetOrigin: 'http://127.0.0.1:19001' },
          timingsMs: { build: 0, install: 0, reset: 0, scenario: 0, verify: 0, cleanup: 0 },
          cameraSubmissionPreparation: { nativePassingCases: 0 },
        };
        await writeFile(
          path.join(captureRoot, 'caller-output-root-binding.private.json'),
          JSON.stringify(
            buildCallerOutputRootBindingSidecar({
              requestedRunId,
              captureRunId,
              binding,
              deadlineAtMonotonicMs: persistedDeadline,
            }),
            null,
            2,
          ),
          { mode: 0o600, flag: 'wx' },
        );
        await writeFile(path.join(captureRoot, 'transport-observations.private.json'), '[]\n', {
          mode: 0o600,
          flag: 'wx',
        });
        const executeCamera = captureOptions.executeCamera;
        assert(executeCamera, 'actual adapter did not provide its camera callback');
        await executeCamera({
          output: captureRoot,
          report,
          signal: captureOptions.signal,
          fixtures: { scope: 'native-entry-ios', runId: fixtureRunId },
        } as unknown as IosCameraRuntimeContext);
        return { artifactRoot: captureRoot, exitCode: 0, report };
      },
      observeIosCameraDeniedManualSubmit: async (input) => {
        trace.push('observe');
        if (mode === 'cancel') controller.abort(new Error('source-control cancellation'));
        assert.equal(input.signal, controller.signal);
        await Promise.resolve();
      },
      verifyOwnedIosCleanup: async (input) => {
        trace.push(`cleanup:${input.artifactRoot}`);
        await Promise.resolve();
        return { result: 'passed' } as Awaited<
          ReturnType<IosCameraAttemptDependencies['verifyOwnedIosCleanup']>
        >;
      },
      validateIosCameraSubmissionPreparation: () => {
        trace.push('validate');
      },
    };
    try {
      const result = await runIosCameraAttemptForPublicDispatch({
        repositoryRoot: repository,
        requestedRunId,
        selection,
        signal: controller.signal,
        outputRoot,
        deadlineAt,
        credentialInteractionDiagnostic: true,
        dependencies,
      });
      return { result, trace, captureRoot, outputRoot, parent };
    } catch (error) {
      await rm(parent, { recursive: true, force: true });
      throw error;
    }
  };

  const passed = await runAttempt('positive');
  assert.equal(passed.result.verificationResult, 'passed');
  assert.equal(passed.result.artifactRoot, passed.captureRoot);
  assert.equal(passed.result.stagedManifestPath, null);
  assert.deepEqual(passed.trace, [
    `capture:${passed.captureRoot}`,
    'observe',
    `cleanup:${passed.captureRoot}`,
    'validate',
  ]);
  assert.notEqual(passed.captureRoot, passed.outputRoot);
  const terminalSidecar = path.join(passed.captureRoot, 'camera-runtime-adapter.private.json');
  assert.equal((await stat(terminalSidecar)).mode & 0o777, 0o600);
  const terminalReport = JSON.parse(await readFile(terminalSidecar, 'utf8')) as {
    verificationResult: string;
    stagedManifestPath: string | null;
    nativePassingCases: number;
  };
  assert.equal(terminalReport.verificationResult, 'passed');
  assert.equal(terminalReport.stagedManifestPath, null);
  assert.equal(terminalReport.nativePassingCases, 0);
  await rm(passed.parent, { recursive: true, force: true });

  for (const mode of ['binding-tamper', 'deadline-tamper', 'missing-binding'] as const) {
    const rejected = await runAttempt(mode);
    assert.equal(rejected.result.verificationResult, 'failed');
    assert.equal(rejected.result.stagedManifestPath, null);
    assert.deepEqual(rejected.trace, [
      `capture:${rejected.captureRoot}`,
      'observe',
      `cleanup:${rejected.captureRoot}`,
    ]);
    await rm(rejected.parent, { recursive: true, force: true });
  }

  const cancelled = await runAttempt('cancel');
  assert.equal(cancelled.result.verificationResult, 'not-executed');
  assert.equal(cancelled.result.stagedManifestPath, null);
  assert.deepEqual(cancelled.trace, [
    `capture:${cancelled.captureRoot}`,
    'observe',
    `cleanup:${cancelled.captureRoot}`,
  ]);
  await rm(cancelled.parent, { recursive: true, force: true });
});

void test('public cleanup retains a verified zero-acquisition boundary and blocks unavailable proof', () => {
  assert.equal(
    nativePilotCleanupStatus({
      runtime: { externalCleanupResult: 'passed', captureCleanup: 'not-acquired' },
      stage: 'runtime-execution-failed',
    }),
    'not-acquired',
  );
  for (const externalCleanupResult of ['failed', 'unknown'])
    assert.equal(
      nativePilotCleanupStatus({
        runtime: { externalCleanupResult, captureCleanup: 'not-acquired' },
        stage: 'runtime-execution-failed',
      }),
      'failed-recovery-ledger-retained',
    );
  assert.equal(
    nativePilotCleanupStatus({
      runtime: { externalCleanupResult: 'passed', captureCleanup: 'cleaned' },
      stage: 'passed',
    }),
    'cleaned',
  );
  for (const captureCleanup of [
    undefined,
    null,
    'unknown',
    { status: 'failed-recovery-retained', resources: ['owned-device'] },
  ])
    assert.equal(
      nativePilotCleanupStatus({
        runtime: { externalCleanupResult: 'passed', captureCleanup },
        stage: 'runtime-cleanup-failed',
      }),
      'failed-recovery-ledger-retained',
    );
  assert.equal(nativePilotCleanupStatus({ stage: 'invalid-environment' }), 'not-acquired');
  assert.equal(
    nativePilotCleanupStatus({ stage: 'runtime-execution-failed' }),
    'failed-recovery-ledger-retained',
  );
});

void test('late terminal signals preserve the original Android runtime failure precedence', () => {
  const base: NativePilotRuntimeTerminalFacts = {
    captureResult: 'harness-blocked',
    captureTimeout: null,
    cancellation: null,
    childExitCode: 1,
    childSignal: null,
    childClassification: 'child-failed',
    censusFailureCount: 0,
    deadline: null,
    externalCleanupResult: 'passed',
    postCaptureFailurePhase: null,
    verificationResult: 'not-executed',
  };
  const childFailure = resolveNativePilotTerminalDecision({
    runtime: base,
    signalCode: 143,
    deadlineExpired: false,
    stage: 'runtime-execution-failed',
  });
  assert.equal(childFailure?.result, 'harness-blocked');
  assert.equal(childFailure?.exitCode, 2);
  assert.equal(childFailure?.blockerCode, 'runtime-execution-failed');

  const classifiedChildFailure = resolveNativePilotTerminalDecision({
    runtime: { ...base, childExitCode: null },
    signalCode: 143,
    deadlineExpired: false,
    stage: 'runtime-execution-failed',
  });
  assert.equal(classifiedChildFailure?.blockerCode, 'runtime-execution-failed');
  assert.match(classifiedChildFailure?.detail ?? '', /child-failed/);

  const outputLimitDiagnostic = normalizeAndroidCommandDiagnostic({
    execution: 'harness-blocked',
    cleanup: 'cleaned',
    childExitCode: 0,
    outputFailure: {
      reason: 'limit',
      stream: 'stdout',
      bytes: 42,
      message: 'bounded stdout exceeded its configured limit',
    },
  });
  assert.equal(outputLimitDiagnostic.execution, 'output-limit');
  assert.deepEqual(outputLimitDiagnostic.outputFailure, {
    reason: 'limit',
    stream: 'stdout',
    bytes: 42,
    message: 'bounded stdout exceeded its configured limit',
  });
  const outputFailureDiagnostic = normalizeAndroidCommandDiagnostic({
    outputFailure: {
      reason: 'io',
      stream: 'stderr',
      bytes: 7,
      message: 'bounded stderr capture failed',
    },
  });
  assert.equal(outputFailureDiagnostic.execution, 'output-failed');
  const censusPreservesPrecedence = normalizeAndroidCommandDiagnostic({
    execution: 'harness-blocked',
    censusFailure: { kind: 'original native command census failure' },
    outputFailure: outputLimitDiagnostic.outputFailure,
  });
  assert.equal(censusPreservesPrecedence.execution, 'harness-blocked');
  const outputDecision = resolveNativePilotTerminalDecision({
    runtime: {
      ...base,
      childExitCode: null,
      childClassification: outputLimitDiagnostic.execution,
      captureResult: 'harness-blocked',
    },
    signalCode: 143,
    deadlineExpired: false,
    stage: 'runtime-execution-failed',
  });
  assert.equal(outputDecision?.blockerCode, 'runtime-execution-failed');
  assert.match(outputDecision?.detail ?? '', /output-limit/);
  const outputDoesNotReplaceDeadline = resolveNativePilotTerminalDecision({
    runtime: {
      ...base,
      childExitCode: null,
      childClassification: outputLimitDiagnostic.execution,
      deadline: { step: 'android-build', deadlineMs: 900_000 },
    },
    signalCode: 143,
    deadlineExpired: false,
    stage: 'runtime-execution-failed',
  });
  assert.equal(outputDoesNotReplaceDeadline?.blockerCode, 'native-command-deadline');

  const censusFailure = resolveNativePilotTerminalDecision({
    runtime: {
      ...base,
      childExitCode: null,
      childClassification: null,
      censusFailureCount: 1,
    },
    signalCode: 143,
    deadlineExpired: false,
    stage: 'runtime-execution-failed',
  });
  assert.equal(censusFailure?.blockerCode, 'runtime-verification-failed');
  assert.match(censusFailure?.detail ?? '', /1 original native census diagnostic/);

  const cleanupFailure = resolveNativePilotTerminalDecision({
    runtime: { ...base, childExitCode: null, externalCleanupResult: 'failed' },
    signalCode: 130,
    deadlineExpired: false,
    stage: 'runtime-cleanup-failed',
  });
  assert.equal(cleanupFailure?.blockerCode, 'runtime-cleanup-failed');
  assert.equal(cleanupFailure?.exitCode, 2);

  const commandDeadline = resolveNativePilotTerminalDecision({
    runtime: {
      ...base,
      childExitCode: 0,
      deadline: { step: 'android-build', deadlineMs: 900_000 },
    },
    signalCode: 143,
    deadlineExpired: false,
    stage: 'runtime-bootstrap-deadline',
  });
  assert.equal(commandDeadline?.blockerCode, 'native-command-deadline');
  assert.equal(commandDeadline?.exitCode, 2);

  const bootstrapDeadline = resolveNativePilotTerminalDecision({
    runtime: {
      ...base,
      childExitCode: null,
      childClassification: null,
      captureResult: 'harness-blocked',
    },
    signalCode: 143,
    deadlineExpired: false,
    stage: 'runtime-bootstrap-deadline',
  });
  assert.equal(bootstrapDeadline?.blockerCode, 'runtime-bootstrap-deadline');
  assert.equal(bootstrapDeadline?.exitCode, 2);
  const bootstrapWithUnknownChild = resolveNativePilotTerminalDecision({
    runtime: {
      ...base,
      childExitCode: null,
      childClassification: 'harness-blocked',
      captureResult: 'harness-blocked',
    },
    signalCode: 143,
    deadlineExpired: false,
    stage: 'runtime-bootstrap-deadline',
  });
  assert.equal(bootstrapWithUnknownChild?.blockerCode, 'runtime-bootstrap-deadline');
  const bootstrapWithOutputFailure = resolveNativePilotTerminalDecision({
    runtime: { ...base, childExitCode: null, childClassification: 'output-failed' },
    deadlineExpired: false,
    stage: 'runtime-bootstrap-deadline',
  });
  assert.equal(bootstrapWithOutputFailure?.blockerCode, 'runtime-execution-failed');

  const postCaptureFailure = resolveNativePilotTerminalDecision({
    runtime: {
      ...base,
      childExitCode: 0,
      childClassification: 'completed',
      captureResult: 'observed',
      verificationResult: 'passed',
      postCaptureFailurePhase: 'adapter-write',
    },
    signalCode: 143,
    deadlineExpired: false,
    stage: 'runtime-verification-failed',
  });
  assert.equal(postCaptureFailure?.blockerCode, 'runtime-post-capture-failed');
  assert.equal(postCaptureFailure?.exitCode, 2);

  const wholeCaptureDeadline = resolveNativePilotTerminalDecision({
    runtime: { ...base, childExitCode: 0, captureTimeout: 'whole-capture' },
    signalCode: 130,
    deadlineExpired: false,
    stage: 'runtime-execution-failed',
  });
  assert.equal(wholeCaptureDeadline?.blockerCode, 'native-whole-capture-deadline');
  assert.equal(wholeCaptureDeadline?.exitCode, 2);

  const cancellation = resolveNativePilotTerminalDecision({
    runtime: {
      ...base,
      captureResult: 'cancelled',
      cancellation: 'SIGTERM',
      childExitCode: null,
      childClassification: null,
      verificationResult: 'not-executed',
    },
    signalCode: 143,
    deadlineExpired: false,
    stage: 'runtime-execution-failed',
  });
  assert.equal(cancellation?.result, 'cancelled');
  assert.equal(cancellation?.exitCode, 143);
  assert.equal(cancellation?.blockerCode, 'cancelled-runtime');
});

void test('SIGINT/SIGTERM during actual preflight retain cancellation receipts without native acquisition', async () => {
  for (const [signal, exitCode] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/testing/run-native-pilot.ts',
        '--platform=ios',
        '--engine=maestro',
        '--scenario=SCN-save-retry-ios',
        '--mode=integration',
      ],
      {
        cwd: repository,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          NODE_ENV: 'test',
          APP_VARIANT: 'dev',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    let signalled = false;
    const completion = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 30_000);
    child.stdout.on('data', (bytes: Buffer) => {
      stdout += bytes.toString();
      if (!signalled && stdout.includes('Native pilot preflight artifacts:')) {
        signalled = true;
        assert.ok(child.kill(signal));
      }
    });
    child.stderr.on('data', (bytes: Buffer) => {
      stderr += bytes.toString();
    });
    let code: number | null;
    try {
      code = await completion;
    } finally {
      clearTimeout(watchdog);
    }
    assert.equal(timedOut, false, 'owned preflight subprocess exceeded 30 seconds');
    assert.equal(code, exitCode);
    assert.equal(signalled, true);
    assert.equal(stderr, '');
    const match = /receipt: (.+\/receipt\.json)\n$/.exec(stdout);
    assert.ok(match);
    const file = match[1];
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    assertPublicReceipt(value, path.dirname(file));
    const row = value as PreflightReceipt;
    assert.equal(row.result, 'cancelled');
    assert.equal(row.exitCode, exitCode);
    assert.equal(row.blocker.code, 'cancelled-preflight');
    assert.equal(row.childExitCode, null);
    assert.deepEqual(row.cleanup, {
      status: 'not-acquired',
      ownedResourceIds: [],
      recoveryRecordPath: null,
    });
    assert.deepEqual(row.assertions, []);
    assert(row.artifacts.length <= 2);
    assert.equal(new Set(row.artifacts).size, row.artifacts.length);
    for (const artifact of row.artifacts) {
      assert.ok(
        artifact === 'attempt-identity.private.json' ||
          artifact === 'execution-deadlines.private.json',
      );
      await requirePreflightSidecar(path.dirname(file), artifact, row.runId);
    }
  }
});

void test(
  'real native entry point blocks before acquisition and writes redacted immutable schema-valid receipts',
  { skip: !pairedServerCheckout && 'needs the paired ../server checkout' },
  async () => {
    const privateValue = 'synthetic-private-argument-value';
    const defaults = [
      '--platform',
      'ios',
      '--engine',
      'maestro',
      '--scenario',
      'SCN-save-retry-ios',
      '--mode',
      'integration',
    ];
    const androidTraining = [
      '--platform',
      'android',
      '--engine',
      'maestro',
      '--scenario',
      'SCN-training-android',
      '--mode',
      'integration',
    ];
    const cases = [
      { args: defaults, code: 'native-host-lock-required', env: {} },
      ...(['ios', 'android'] as const).flatMap((platform) => {
        const args = defaults.map((value) =>
          value === 'ios'
            ? platform
            : value === 'SCN-save-retry-ios'
              ? `SCN-connection-${platform}`
              : value,
        );
        return [
          { args, code: 'native-host-lock-required', env: {} },
          {
            args: args.map((value) => (value === 'maestro' ? 'detox' : value)),
            code: 'invalid-cli-arguments',
            env: {},
          },
          {
            args,
            code: 'invalid-environment',
            env: { EXPO_PUBLIC_E2E_AUTH_SESSION: 'true' },
          },
        ];
      }),
      {
        args: defaults.map((value) =>
          value === 'ios'
            ? 'android'
            : value === 'SCN-save-retry-ios'
              ? 'SCN-save-retry-android'
              : value,
        ),
        code: 'native-host-lock-required',
        env: {},
      },
      {
        args: defaults.map((value) => (value === 'maestro' ? 'detox' : value)),
        code: 'invalid-cli-arguments',
        env: {},
      },
      {
        args: defaults.map((value) => (value === 'integration' ? 'fixture' : value)),
        code: 'missing-assertion-ledger',
        env: {},
      },
      {
        args: defaults.map((value) => (value === 'SCN-save-retry-ios' ? 'SCN-session-ios' : value)),
        code: 'native-host-lock-required',
        env: {},
      },
      {
        args: defaults.map((value) =>
          value === 'SCN-save-retry-ios' ? 'SCN-camera-denied-ios' : value,
        ),
        code: 'native-host-lock-required',
        env: {},
      },
      {
        args: [
          '--platform=android',
          '--engine=maestro',
          '--scenario=SCN-session-android',
          '--mode=fixture',
        ],
        code: 'missing-assertion-ledger',
        env: {},
      },
      { args: [...defaults, '--secret', privateValue], code: 'invalid-cli-arguments', env: {} },
      {
        args: defaults.map((value) => (value === 'maestro' ? 'unknown' : value)),
        code: 'invalid-cli-arguments',
        env: {},
      },
      {
        args: defaults.map((value) => (value === 'ios' ? 'android' : value)),
        code: 'invalid-inventory',
        env: {},
      },
      {
        args: defaults.map((value) =>
          value === 'SCN-save-retry-ios' ? `SCN-${privateValue}` : value,
        ),
        code: 'invalid-inventory',
        env: {},
      },
      {
        args: defaults,
        code: 'invalid-environment',
        env: { EXPO_PUBLIC_E2E_AUTH_SESSION: 'true' },
      },
      { args: defaults, code: 'invalid-environment', env: { APP_VARIANT: 'prod' } },
      ...['SCN-training-ios', 'SCN-save-retry-ios', 'SCN-connection-ios'].flatMap((scenario) =>
        ['', '1000.0', '180001', privateValue].map((deadline) => ({
          args: defaults.map((value) => (value === 'SCN-save-retry-ios' ? scenario : value)),
          code: 'invalid-environment',
          env: { MYCHAMPIONS_NATIVE_BOOTSTATUS_DEADLINE_MS: deadline },
        })),
      ),
      ...['SCN-training-ios', 'SCN-save-retry-ios', 'SCN-connection-ios'].flatMap((scenario) =>
        [
          ['MYCHAMPIONS_NATIVE_BUILD_DEADLINE_MS', '900001'],
          ['MYCHAMPIONS_NATIVE_STEP_DEADLINE_MS', '600001'],
          ['MYCHAMPIONS_NATIVE_WHOLE_DEADLINE_MS', '2400001'],
          ['MYCHAMPIONS_NATIVE_WHOLE_DEADLINE_MS', privateValue],
        ].map(([name, value]) => ({
          args: defaults.map((arg) => (arg === 'SCN-save-retry-ios' ? scenario : arg)),
          code: 'invalid-environment',
          env: { [name]: value },
        })),
      ),
      ...['SCN-training-ios', 'SCN-save-retry-ios', 'SCN-connection-ios'].flatMap((scenario) =>
        ['', '../escape', privateValue, '0'.repeat(24), '8e08d5cf2bd1f02eb274914c'].map(
          (value) => ({
            args: defaults.map((arg) => (arg === 'SCN-save-retry-ios' ? scenario : arg)),
            code: 'invalid-build-reuse',
            env: { MYCHAMPIONS_NATIVE_REUSE_BUILD_RUN_ID: value },
          }),
        ),
      ),
      {
        args: androidTraining,
        code: 'invalid-environment',
        env: { MYCHAMPIONS_NATIVE_BOOTSTATUS_DEADLINE_MS: '1000' },
      },
      {
        args: androidTraining,
        code: 'invalid-environment',
        env: { MYCHAMPIONS_NATIVE_REUSE_BUILD_RUN_ID: 'a'.repeat(24) },
      },
      {
        args: androidTraining.map((value) => (value === 'maestro' ? 'detox' : value)),
        code: 'invalid-cli-arguments',
        env: {},
      },
    ];
    const ids: string[] = [];
    for (const item of cases) {
      const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
        (resolve, reject) => {
          execFile(
            process.execPath,
            ['--import', 'tsx', 'scripts/testing/run-native-pilot.ts', ...item.args],
            {
              cwd: repository,
              timeout: 30_000,
              encoding: 'utf8',
              env: {
                PATH: process.env.PATH,
                HOME: process.env.HOME,
                TMPDIR: process.env.TMPDIR,
                APP_VARIANT: 'dev',
                NODE_ENV: 'test',
                ...item.env,
              },
            },
            (error, stdout, stderr) => {
              if (error && (error.killed || typeof error.code !== 'number'))
                reject(
                  new Error('Native preflight subprocess did not return an exit code', {
                    cause: error,
                  }),
                );
              else
                resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
            },
          );
        },
      );
      assert.equal(result.code, 2);
      assert.equal(result.stderr, '');
      assert.ok(!result.stdout.includes(privateValue));
      const match = /receipt: (.+\/receipt\.json)\n$/.exec(result.stdout);
      assert.ok(match);
      const file = match[1];
      const root = path.dirname(file);
      assert.ok(
        file.startsWith(path.join(repository, '.qa/artifacts/native-pilot-attempts') + path.sep),
      );
      assert.equal(await realpath(file), file);
      assert.equal((await stat(root)).mode & 0o777, 0o700);
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      const bytes = await readFile(file, 'utf8');
      const receipt: unknown = JSON.parse(bytes);
      assertPublicReceipt(receipt, root, [privateValue]);
      const row = receipt as PreflightReceipt;
      assert.equal(row.blocker.code, item.code);
      assert.equal(row.result, 'harness-blocked');
      assert.equal(row.exitCode, 2);
      assert.equal(row.childExitCode, null);
      assert.equal(row.cleanup.status, 'not-acquired');
      assert.deepEqual(row.cleanup.ownedResourceIds, []);
      assert.deepEqual(row.assertions, []);
      assert.deepEqual(
        row.artifacts,
        item.code === 'native-host-lock-required'
          ? ['attempt-identity.private.json', 'execution-deadlines.private.json']
          : ['attempt-identity.private.json'],
      );
      for (const artifact of row.artifacts) {
        await requirePreflightSidecar(root, artifact, row.runId);
      }
      assert.deepEqual(
        row.repositories.map((source) => source.name),
        ['client', 'server'],
      );
      if (row.repositoryEvidence !== undefined)
        assert.deepEqual(row.repositoryEvidence, { status: 'observed', missing: [], reason: null });
      for (const source of row.repositories) {
        assert.match(source.sha, /^[a-f0-9]{40}$/);
        assert.match(source.workingTreeHash!, /^[a-f0-9]{64}$/);
      }
      if (item.code === 'invalid-selection' || item.code === 'invalid-inventory')
        assert.equal(row.scenarioId, 'invalid-selection');
      assert.ok(!bytes.includes(privateValue));
      await assert.rejects(writeFile(file, 'must not overwrite', { flag: 'wx' }), {
        code: 'EEXIST',
      });
      assert.equal(await readFile(file, 'utf8'), bytes);
      ids.push(row.runId);
    }
    assert.equal(new Set(ids).size, cases.length);
  },
);

void test('shared repository identity detects dirty tracked/untracked bytes and deletion in a disposable Git fixture', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-repo-identity-')));
  const git = (...args: string[]) => execute('git', ['-C', root, ...args]);
  try {
    await git('init', '-q');
    await assert.rejects(repositoryIdentity(root, 'fixture'));
    await writeFile(path.join(root, 'tracked.txt'), 'baseline');
    await git('add', 'tracked.txt');
    await git(
      '-c',
      'user.name=Testing fixture',
      '-c',
      'user.email=testing@example.invalid',
      'commit',
      '-q',
      '-m',
      'test fixture',
    );
    const clean = await repositoryIdentity(root, 'fixture');
    assert.equal(clean.name, 'fixture');
    assert.equal(clean.dirty, false);
    await writeFile(path.join(root, 'untracked.txt'), 'first');
    const first = await repositoryIdentity(root, 'fixture');
    assert.equal(first.dirty, true);
    assert.notEqual(first.workingTreeHash, clean.workingTreeHash);
    await writeFile(path.join(root, 'untracked.txt'), 'second');
    const second = await repositoryIdentity(root, 'fixture');
    assert.equal(second.sha, clean.sha);
    assert.notEqual(second.workingTreeHash, first.workingTreeHash);
    await writeFile(path.join(root, 'tracked.txt'), 'modified');
    const modified = await repositoryIdentity(root, 'fixture');
    assert.notEqual(modified.workingTreeHash, second.workingTreeHash);
    await rm(path.join(root, 'tracked.txt'));
    const deleted = await repositoryIdentity(root, 'fixture');
    assert.equal(deleted.dirty, true);
    assert.notEqual(deleted.workingTreeHash, modified.workingTreeHash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('repository identity stops git and descriptor walks when the caller cancels', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-repo-abort-')));
  const git = (...args: string[]) => execute('git', ['-C', root, ...args]);
  try {
    await git('init', '-q');
    await writeFile(path.join(root, 'tracked.txt'), 'fixture bytes');
    await git('add', 'tracked.txt');
    await git(
      '-c',
      'user.name=Testing fixture',
      '-c',
      'user.email=testing@example.invalid',
      'commit',
      '-q',
      '-m',
      'test fixture',
    );

    const beforeGit = new AbortController();
    beforeGit.abort('cancel-before-git');
    await assert.rejects(repositoryIdentity(root, 'fixture', { signal: beforeGit.signal }));

    const afterRead = new AbortController();
    await assert.rejects(
      repositoryIdentity(root, 'fixture', {
        signal: afterRead.signal,
        afterFirstRead: () => afterRead.abort('cancel-after-first-read'),
      }),
    );
    assert.equal(afterRead.signal.aborted, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('repository identity closes a descriptor when cancellation lands immediately after open', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-repo-open-abort-')));
  const git = (...args: string[]) => execute('git', ['-C', root, ...args]);
  try {
    await git('init', '-q');
    await writeFile(path.join(root, 'tracked.txt'), 'fixture bytes');
    await git('add', 'tracked.txt');
    await git(
      '-c',
      'user.name=Testing fixture',
      '-c',
      'user.email=testing@example.invalid',
      'commit',
      '-q',
      '-m',
      'test fixture',
    );
    const controller = new AbortController();
    let descriptorClosed = false;
    await assert.rejects(
      repositoryIdentity(root, 'fixture', {
        signal: controller.signal,
        afterOpen: () => controller.abort('cancel-after-open'),
        afterDescriptorClose: () => {
          descriptorClosed = true;
        },
      }),
    );
    assert.equal(descriptorClosed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('runner preflight identity publication uses the live signal and opaque observation', async () => {
  const runner = await readFile(
    path.join(__dirname, '../../scripts/testing/run-native-pilot.ts'),
    'utf8',
  );
  assert.match(runner, /readRepositoryIdentityWithSignal/);
  assert.match(runner, /interruptedBeforeIdentity/);
  assert.match(runner, /createRepositoryObservation/);
  assert.match(runner, /repositoryObservation/);
  assert.match(runner, /repositoryEvidenceForReceipt/);
  assert.match(runner, /repositoryRootsBefore/);
});

void test('terminal repository observation retains a real client row when the server read fails', async () => {
  const clientRoot = await createCommittedRepository('mc-native-terminal-client-');
  const serverRoot = await createCommittedRepository('mc-native-terminal-server-');
  try {
    const observation = await readRepositorySourcesBestEffort(
      clientRoot,
      new AbortController().signal,
      {
        readServerRoot: () => Promise.resolve(serverRoot),
        readIdentity: async (root, name, signal) => {
          if (name === 'server') throw new Error('injected server identity failure');
          return repositoryIdentity(root, name, { signal });
        },
      },
    );
    assert.equal(observation.evidence.status, 'partial');
    assert.deepEqual(observation.evidence.missing, ['server']);
    assert.deepEqual(
      observation.sources.map((source) => source.name),
      ['client'],
    );
    assert.equal(observation.roots.client, clientRoot);
    assert.equal(observation.roots.server, serverRoot);
    assert.equal(
      observation.sources.some((source) => source.name === 'server'),
      false,
    );
  } finally {
    await Promise.all([
      rm(clientRoot, { recursive: true, force: true }),
      rm(serverRoot, { recursive: true, force: true }),
    ]);
  }
});

void test('terminal repository observation retains a real server row when the client read fails', async () => {
  const clientRoot = await createCommittedRepository('mc-native-terminal-client-failure-');
  const serverRoot = await createCommittedRepository('mc-native-terminal-server-retained-');
  try {
    const observation = await readRepositorySourcesBestEffort(
      clientRoot,
      new AbortController().signal,
      {
        readServerRoot: () => Promise.resolve(serverRoot),
        readIdentity: async (root, name, signal) => {
          if (name === 'client') throw new Error('injected client identity failure');
          return repositoryIdentity(root, name, { signal });
        },
      },
    );
    assert.equal(observation.evidence.status, 'partial');
    assert.deepEqual(observation.evidence.missing, ['client']);
    assert.deepEqual(
      observation.sources.map((source) => source.name),
      ['server'],
    );
    assert.equal(observation.roots.client, clientRoot);
    assert.equal(observation.roots.server, serverRoot);
  } finally {
    await Promise.all([
      rm(clientRoot, { recursive: true, force: true }),
      rm(serverRoot, { recursive: true, force: true }),
    ]);
  }
});

void test('terminal repository observation records unknown on client cancellation and closes the opened descriptor', async () => {
  const clientRoot = await createCommittedRepository('mc-native-terminal-cancel-client-');
  const serverRoot = await createCommittedRepository('mc-native-terminal-cancel-server-');
  const controller = new AbortController();
  let descriptorClosed = false;
  let serverReadCalled = false;
  try {
    const observation = await readRepositorySourcesBestEffort(clientRoot, controller.signal, {
      readServerRoot: () => Promise.resolve(serverRoot),
      readIdentity: (root, name, signal) =>
        repositoryIdentity(root, name, {
          signal,
          afterOpen: () => controller.abort('terminal cancellation after descriptor open'),
          afterDescriptorClose: () => {
            descriptorClosed = true;
          },
        }).finally(() => {
          if (name === 'server') serverReadCalled = true;
        }),
    });
    assert.equal(observation.evidence.status, 'unknown');
    assert.deepEqual(observation.evidence.missing, ['client', 'server']);
    assert.deepEqual(observation.sources, []);
    assert.equal(descriptorClosed, true);
    assert.equal(serverReadCalled, false);
  } finally {
    await Promise.all([
      rm(clientRoot, { recursive: true, force: true }),
      rm(serverRoot, { recursive: true, force: true }),
    ]);
  }
});

void test('terminal repository observation closes its descriptor when a deadline aborts an in-flight read', async () => {
  const clientRoot = await createCommittedRepository('mc-native-terminal-deadline-client-');
  const serverRoot = await createCommittedRepository('mc-native-terminal-deadline-server-');
  const controller = new AbortController();
  let descriptorClosed = false;
  try {
    const observation = await readRepositorySourcesBestEffort(clientRoot, controller.signal, {
      readServerRoot: () => Promise.resolve(serverRoot),
      readIdentity: (root, name, signal) =>
        repositoryIdentity(root, name, {
          signal,
          afterOpen: () => controller.abort('terminal deadline exceeded'),
          afterDescriptorClose: () => {
            descriptorClosed = true;
          },
        }),
    });
    assert.equal(observation.evidence.status, 'unknown');
    assert.deepEqual(observation.evidence.missing, ['client', 'server']);
    assert.equal(descriptorClosed, true);
  } finally {
    await Promise.all([
      rm(clientRoot, { recursive: true, force: true }),
      rm(serverRoot, { recursive: true, force: true }),
    ]);
  }
});

void test('terminal finalization uses best-effort repository evidence and blocks source-unknown output', async () => {
  const runner = await readFile(
    path.join(__dirname, '../../scripts/testing/run-native-pilot.ts'),
    'utf8',
  );
  assert.match(runner, /readRepositorySourcesBestEffort\(root, controller\.signal\)/);
  assert.match(runner, /repositoryEvidenceForReceipt && !signalCode && !deadlineExpired/);
  assert.match(runner, /no source rows were synthesized/);
  assert.match(runner, /code: 'runtime-verification-failed'/);
});
