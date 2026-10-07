import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  requireDetoxFinalCaptureQualification,
  type DetoxBaselineBuildInstrumentation,
  type DetoxBaselineReport,
  type DetoxBaselineFactories,
} from './detox-integrated-session-baseline';
import {
  requireDetoxRuntimeBuildMetadata,
  type DetoxRuntimeBuildMetadata,
} from './detox-runtime-build-metadata';
import {
  runAndroidDetoxSessionPublicAdapter,
  type AndroidDetoxSessionPublicAdapterOptions,
  type AndroidDetoxSessionPublicAdapterResult,
} from './native-detox-android-session-public-adapter';
import { loadAndroidDetoxQualifiedBuild } from './native-detox-connection-android-public-dispatch';
import {
  createDetoxDispatchLifecycleAt,
  detoxDispatchFence,
} from './native-detox-dispatch-lifecycle';
import {
  nativePilotTargetFromCapture,
  type NativePilotSelection,
  type NativePilotTarget,
} from './native-pilot-contract';
import { readNativeEvidenceObservation } from './native-view-evidence';
import {
  normalizeT15AndroidDetoxSessionLifecycle,
  type T15AndroidSessionLifecycleNormalization,
} from './t15-detox-android-session-normalization';
import type { AndroidDetoxSessionProducerOverrides } from './detox-android-session-producer';
import type { AndroidDetoxSessionAssertionBinding } from './native-detox-android-session-public-finalization';
import type { ColdResetPreparationExpectation } from './t15-cold-android-reset-producer';

const runIdPattern = /^[a-f0-9]{24}$/u;

type PrivateRecord = Record<string, unknown>;
type CommandClassification =
  | 'completed'
  | 'child-failed'
  | 'deadline'
  | 'cancelled'
  | 'output-limit'
  | 'output-failed'
  | 'harness-blocked';

type RouteDependencies = Readonly<{
  loadBuild?: (
    input: Parameters<typeof loadAndroidDetoxQualifiedBuild>[0],
  ) => Promise<QualifiedDetoxBuild>;
  runAdapter?: (
    options: AndroidDetoxSessionPublicAdapterOptions,
  ) => Promise<AndroidDetoxSessionPublicAdapterResult>;
}>;

type QualifiedDetoxBuild = DetoxBaselineBuildInstrumentation & DetoxRuntimeBuildMetadata;

export type AndroidDetoxSessionNativePilotAttempt = Readonly<
  Omit<AndroidDetoxSessionPublicAdapterResult, 'kind'> & {
    kind: 'private-owned-android-detox-session-attempt-not-public-receipt';
    /** The independently acquired Android resource owner for a cold route. */
    resourceOwnerRunId: string | null;
    /** Split-identity source normalization; never a public or native pass. */
    lifecycleNormalization: T15AndroidSessionLifecycleNormalization;
    artifactRoot: string;
    captureExitCode: number;
    childExitCode: number | null;
    childSignal: NodeJS.Signals | null;
    childClassification: CommandClassification;
    captureResult: string;
    captureCleanup:
      | 'not-acquired'
      | 'cleaned'
      | { status: 'failed-recovery-retained'; resources: string[] }
      | null;
    captureTimeout: 'whole-capture' | null;
    cancellation: 'SIGINT' | 'SIGTERM' | null;
    captureInvocation: {
      count: 1;
      returned: true;
      exitCode: number;
      result: string;
    };
    captureCompleted: boolean;
    externalCleanupResult: 'passed' | 'failed';
    verificationResult: 'passed' | 'blocked' | 'not-executed';
    /** True only when the baseline report contains a completed owned Detox command. */
    nativeExecution: boolean;
    verificationFailure: { name: string; message: string } | null;
    postCaptureFailure: { phase: string; name: string; message: string } | null;
    recoveryLedgerReadFailures: readonly {
      ledger: 'capture-final' | 'cleanup-final';
      name: string;
      message: string;
    }[];
    fixtureRunId: string | null;
    fixtureHash: string | null;
    flagsHash: string | null;
    toolVersions: Record<string, string>;
    timingsMs: {
      build: number;
      install: number;
      reset: number;
      scenario: number;
      verify: number;
      cleanup: number;
    };
    deadline: { step: string; deadlineMs: number } | null;
    commandDiagnostics: readonly unknown[];
    censusFailures: readonly unknown[];
    outputFailures: readonly unknown[];
    target: NativePilotTarget;
    adapterReceiptPath: string;
  }
>;

function record(value: unknown, label: string): PrivateRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is malformed`);
  return value as PrivateRecord;
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

type OwnedJson = Readonly<{
  value: PrivateRecord;
  bytes: Buffer;
  sha256: string;
}>;

type AndroidDetoxSessionLedgerReadFailure = Readonly<{
  ledger: 'capture-final' | 'cleanup-final';
  name: string;
  message: string;
}>;

function readOwnedJson(root: string, file: string, label: string): OwnedJson {
  assert(path.isAbsolute(root), 'Detox artifact root must be absolute');
  assert(path.isAbsolute(file), `${label} path must be absolute`);
  const relative = path.relative(root, file);
  assert(
    relative !== '' &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    `${label} path escaped the owned artifact root`,
  );
  const observation = readNativeEvidenceObservation(root, relative, true, 'private-artifact');
  const bytes = observation.bytes;
  return {
    value: record(JSON.parse(bytes.toString('utf8')), label),
    bytes,
    sha256: hashBytes(bytes),
  };
}

function commandClassification(value: unknown): CommandClassification {
  return value === 'completed' ||
    value === 'child-failed' ||
    value === 'deadline' ||
    value === 'cancelled' ||
    value === 'output-limit' ||
    value === 'output-failed'
    ? value
    : 'harness-blocked';
}

function targetFromReport(
  report: DetoxBaselineReport,
  requireComplete: boolean,
): NativePilotTarget {
  if (requireComplete) {
    assert(report.target && report.target.deviceId, 'Detox baseline target identity is missing');
    assert(report.apiOrigin, 'Detox baseline API origin is missing');
    assert(
      report.apiPid && Number.isSafeInteger(report.apiPid),
      'Detox baseline API PID is missing',
    );
  }
  return {
    ...nativePilotTargetFromCapture('android'),
    deviceId: report.target?.deviceId ?? null,
    appId: report.build.appIdentifier,
    buildProfile: report.build.configuration,
    binaryHash: report.build.binaryHash,
    apiOrigin: report.apiOrigin,
  };
}

function cleanupStatus(value: unknown): AndroidDetoxSessionNativePilotAttempt['captureCleanup'] {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value === 'not-acquired') return 'not-acquired';
  if (value === 'cleaned') return 'cleaned';
  const row = record(value, 'Detox capture cleanup');
  assert.equal(row.status, 'failed-recovery-retained');
  assert(Array.isArray(row.resources));
  assert(row.resources.every((item) => typeof item === 'string'));
  return { status: 'failed-recovery-retained', resources: [...row.resources] };
}

function nodeSignal(value: unknown): NodeJS.Signals | null {
  if (value === null || value === undefined) return null;
  assert(
    typeof value === 'string' && /^SIG[A-Z0-9]+$/u.test(value),
    'Detox child signal is malformed',
  );
  return value as NodeJS.Signals;
}

/** Distinguish a completed owned Detox command from source-only fixture bytes. */
export function hasAndroidDetoxSessionNativeExecution(
  report: Pick<DetoxBaselineReport, 'childExecution'>,
): boolean {
  const childExecution = report.childExecution;
  return (
    childExecution !== null &&
    childExecution !== undefined &&
    childExecution.execution === 'completed' &&
    childExecution.cleanup === 'cleaned' &&
    childExecution.childExitCode === 0 &&
    childExecution.childSignal === null &&
    childExecution.censusFailure === null &&
    childExecution.outputFailure === null
  );
}

function projectAttempt(
  adapter: AndroidDetoxSessionPublicAdapterResult,
  report: DetoxBaselineReport,
  capture: PrivateRecord,
  cleanup: PrivateRecord,
  recoveryLedgerReadFailures: readonly AndroidDetoxSessionLedgerReadFailure[],
  resourceOwnerRunId: string | null,
  lifecycleNormalization: T15AndroidSessionLifecycleNormalization,
): AndroidDetoxSessionNativePilotAttempt {
  const command =
    capture.command === undefined ? {} : record(capture.command, 'Detox capture command');
  const result = typeof capture.result === 'string' ? capture.result : 'harness-blocked';
  const cleanupValue = cleanupStatus(capture.cleanup);
  const independent = cleanup.independent === 'passed' ? 'passed' : 'failed';
  const privateVerified =
    adapter.terminal === 'private-verified' &&
    adapter.terminalReceiptBound &&
    adapter.verificationResult === 'passed' &&
    recoveryLedgerReadFailures.length === 0;
  const captureExitCode = privateVerified ? 0 : 2;
  const nativeExecution =
    adapter.executionProvenance === 'source-only-control'
      ? false
      : hasAndroidDetoxSessionNativeExecution(report);
  const commandExit = command.childExitCode;
  const childExitCode = typeof commandExit === 'number' ? commandExit : null;
  const childSignal = nodeSignal(command.childSignal);
  const cancellation =
    report.cancellation === 'SIGINT' || report.cancellation === 'SIGTERM'
      ? report.cancellation
      : null;
  const captureTimeout = report.cancellation === 'deadline' ? 'whole-capture' : null;
  const failure = adapter.baselineError
    ? {
        phase: 'verification',
        name: adapter.baselineError.name,
        message: adapter.baselineError.message,
      }
    : null;
  assert.equal(
    path.resolve(adapter.reportPath),
    path.join(path.dirname(adapter.reportPath), 'detox-integrated-session-baseline.private.json'),
  );
  const artifactRoot = path.dirname(adapter.reportPath);
  assert.equal(
    path.resolve(adapter.receiptPath),
    path.join(artifactRoot, 'detox-android-session-public-adapter.private.json'),
  );
  return {
    ...adapter,
    kind: 'private-owned-android-detox-session-attempt-not-public-receipt',
    resourceOwnerRunId,
    lifecycleNormalization,
    artifactRoot,
    captureExitCode,
    childExitCode,
    childSignal,
    childClassification: commandClassification(command.execution),
    captureResult: privateVerified && result === 'passed' ? 'observed' : result,
    captureCleanup: cleanupValue,
    captureTimeout,
    cancellation,
    captureInvocation: {
      count: 1,
      returned: true,
      exitCode: captureExitCode,
      result,
    },
    captureCompleted: privateVerified && result === 'passed' && cleanupValue === 'cleaned',
    externalCleanupResult: independent,
    verificationResult: privateVerified ? 'passed' : 'blocked',
    nativeExecution,
    verificationFailure: failure,
    postCaptureFailure: failure,
    recoveryLedgerReadFailures,
    fixtureRunId: adapter.fixtureHash ? (report.fixture?.runId ?? report.backendRunId) : null,
    fixtureHash: adapter.fixtureHash,
    flagsHash: adapter.flagsHash,
    toolVersions: { ...adapter.toolVersions },
    timingsMs: { ...adapter.timingsMs },
    deadline:
      typeof (report as unknown as Record<string, unknown>).deadline === 'object' &&
      (report as unknown as Record<string, unknown>).deadline
        ? ((report as unknown as Record<string, unknown>).deadline as {
            step: string;
            deadlineMs: number;
          })
        : null,
    commandDiagnostics: command.execution === undefined ? [] : [command],
    censusFailures:
      command.censusFailure === null
        ? []
        : [
            command.censusFailure ?? {
              kind: 'unknown',
              reason: 'missing-census-failure-field',
            },
          ],
    outputFailures:
      command.outputFailure === null
        ? []
        : [
            command.outputFailure ?? {
              kind: 'unknown',
              reason: 'missing-output-failure-field',
            },
          ],
    assertionBindings: [
      ...adapter.assertionBindings,
    ] as readonly AndroidDetoxSessionAssertionBinding[],
    target: targetFromReport(report, privateVerified),
    adapterReceiptPath: adapter.receiptPath,
  };
}

/**
 * Production run-native-pilot bridge. It obtains the qualified immutable build
 * through the existing loader, invokes the retained baseline, and projects
 * only facts reread from the baseline's original report/ledgers. The returned
 * route is a private terminal candidate; public promotion remains disabled
 * until the outer native-pilot finalizer validates the staged evidence.
 */
export async function runAndroidDetoxSessionAttemptForNativePilot(
  input: Readonly<{
    repositoryRoot: string;
    serverRoot: string;
    artifactRoot: string;
    requestedRunId: string;
    captureRunId?: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    signal: AbortSignal;
    deadlineMs: number;
    deadlineAtMonotonicMs?: number;
    buildRunId: string;
    parentEnv?: Readonly<Record<string, string | undefined>>;
    /** Private source-only control seam; production omits these fields. */
    baselineFactories?: DetoxBaselineFactories;
    sourceOnlyProducerOverrides?: AndroidDetoxSessionProducerOverrides;
    sourceOnlyControl?: true;
    coldReset?: Readonly<{
      expectation: ColdResetPreparationExpectation;
      ownerRunId: string;
    }>;
  }>,
  dependencies: RouteDependencies = {},
): Promise<AndroidDetoxSessionNativePilotAttempt> {
  assert.deepEqual(input.selection.arguments, {
    platform: 'android',
    engine: 'detox',
    scenario: 'SCN-session-android',
    mode: 'integration',
  });
  assert.match(input.requestedRunId, runIdPattern);
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.match(input.buildRunId, runIdPattern);
  assert(input.signal instanceof AbortSignal);
  assert(Number.isSafeInteger(input.deadlineMs) && input.deadlineMs >= 30_000);
  const lifecycle = createDetoxDispatchLifecycleAt(
    input.deadlineAtMonotonicMs ?? performance.now() + input.deadlineMs,
    input.signal,
  );
  detoxDispatchFence(lifecycle, 'session route selection');
  const loadBuild =
    dependencies.loadBuild ??
    (loadAndroidDetoxQualifiedBuild as unknown as RouteDependencies['loadBuild']);
  const build: QualifiedDetoxBuild = await loadBuild!({
    repositoryRoot: input.repositoryRoot,
    buildRunId: input.buildRunId,
    signal: lifecycle.signal,
    deadlineAtMonotonicMs: lifecycle.deadlineAtMonotonicMs,
  });
  requireDetoxRuntimeBuildMetadata(build, 'Qualified Android Detox build');
  detoxDispatchFence(lifecycle, 'session qualified build');
  const runAdapter = dependencies.runAdapter ?? runAndroidDetoxSessionPublicAdapter;
  const adapter = await runAdapter({
    repositoryRoot: input.repositoryRoot,
    serverRoot: input.serverRoot,
    artifactRoot: input.artifactRoot,
    requestedRunId: input.requestedRunId,
    captureRunId: input.captureRunId,
    selection: input.selection,
    build,
    runnerPaths: {
      entryPath: path.join(
        input.repositoryRoot,
        'scripts/run-detox-integrated-session-baseline.ts',
      ),
      jestConfigPath: path.join(
        input.repositoryRoot,
        'e2e/jest.detox-integrated-session-baseline.config.js',
      ),
      testPath: path.join(
        input.repositoryRoot,
        'e2e/detox-integrated-session-baseline.e2e.test.js',
      ),
    },
    signal: lifecycle.signal,
    deadlineMs: Math.max(30_000, Math.floor(lifecycle.deadlineAtMonotonicMs - lifecycle.now())),
    deadlineAtMonotonicMs: lifecycle.deadlineAtMonotonicMs,
    parentEnv: input.parentEnv,
    baselineFactories: input.baselineFactories,
    sourceOnlyProducerOverrides: input.sourceOnlyProducerOverrides,
    sourceOnlyControl: input.sourceOnlyControl,
    coldReset: input.coldReset,
  });
  detoxDispatchFence(lifecycle, 'session adapter result');
  const artifactRoot = path.resolve(input.artifactRoot);
  assert.equal(
    path.resolve(adapter.reportPath),
    path.join(artifactRoot, 'detox-integrated-session-baseline.private.json'),
    'Detox baseline report escaped the requested artifact root',
  );
  detoxDispatchFence(lifecycle, 'session report read:before');
  const reportJson = readOwnedJson(artifactRoot, adapter.reportPath, 'Detox baseline report');
  detoxDispatchFence(lifecycle, 'session report read:after');
  assert.equal(
    adapter.reportSha256,
    reportJson.sha256,
    'Detox adapter report hash differs from the reread terminal report',
  );
  detoxDispatchFence(lifecycle, 'session adapter receipt read:before');
  const adapterReceipt = readOwnedJson(
    artifactRoot,
    adapter.receiptPath,
    'Detox adapter receipt',
  ).value;
  detoxDispatchFence(lifecycle, 'session adapter receipt read:after');
  assert.equal(
    adapterReceipt.kind,
    'private-android-detox-session-public-adapter-not-public-receipt',
    'Detox adapter receipt kind changed',
  );
  assert.equal(adapterReceipt.requestedRunId, input.requestedRunId);
  assert.equal(adapterReceipt.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.equal(adapterReceipt.reportSha256, adapter.reportSha256);
  assert.equal(adapterReceipt.terminal, adapter.terminal);
  assert.equal(adapterReceipt.terminalReceiptBound, adapter.terminalReceiptBound);
  const report = reportJson.value as unknown as DetoxBaselineReport;
  let capture: PrivateRecord = {};
  let cleanup: PrivateRecord = {};
  const recoveryLedgerReadFailures: AndroidDetoxSessionLedgerReadFailure[] = [];
  try {
    detoxDispatchFence(lifecycle, 'session capture ledger read:before');
    capture = readOwnedJson(
      artifactRoot,
      path.join(path.dirname(adapter.reportPath), 'capture-final.private.json'),
      'Detox final capture ledger',
    ).value;
  } catch (error) {
    const failure: AndroidDetoxSessionLedgerReadFailure = {
      ledger: 'capture-final',
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message.slice(0, 240) : 'Capture ledger read failed',
    };
    recoveryLedgerReadFailures.push(failure);
    // A pre-acquisition or failed baseline may have only its report and
    // adapter receipt. Preserve the typed read failure as blocked evidence;
    // never manufacture capture or cleanup facts to satisfy the outer route.
    capture = { result: report.result, cleanup: null, recoveryLedgerReadFailure: failure };
    cleanup = { independent: 'not-executed', recoveryLedgerReadFailure: failure };
  }
  if (recoveryLedgerReadFailures.length === 0) {
    try {
      detoxDispatchFence(lifecycle, 'session cleanup ledger read:before');
      cleanup = readOwnedJson(
        artifactRoot,
        path.join(path.dirname(adapter.reportPath), 'cleanup-final.private.json'),
        'Detox final cleanup ledger',
      ).value;
      detoxDispatchFence(lifecycle, 'session ledgers read:after');
    } catch (error) {
      const failure: AndroidDetoxSessionLedgerReadFailure = {
        ledger: 'cleanup-final',
        name: error instanceof Error ? error.name : 'UnknownError',
        message:
          error instanceof Error ? error.message.slice(0, 240) : 'Cleanup ledger read failed',
      };
      recoveryLedgerReadFailures.push(failure);
      cleanup = { independent: 'not-executed', recoveryLedgerReadFailure: failure };
    }
  }
  if (
    adapter.terminal === 'private-verified' &&
    adapter.terminalReceiptBound &&
    recoveryLedgerReadFailures.length === 0
  ) {
    requireDetoxFinalCaptureQualification({
      capture,
      cleanupFinal: cleanup,
      report,
    });
    const command = record(capture.command, 'Detox capture command');
    assert.equal(command.execution, 'completed', 'Detox capture command did not complete');
    assert.equal(command.cleanup, 'cleaned', 'Detox capture command cleanup is not clean');
    assert.equal(command.childExitCode, 0, 'Detox capture child exit was not zero');
    assert.equal(command.childSignal, null, 'Detox capture child received a signal');
    assert.equal(command.censusFailure, null, 'Detox capture census diagnostics are not clean');
    assert.equal(command.outputFailure, null, 'Detox capture output diagnostics are not clean');
  }
  const resourceOwnerRunId = input.coldReset?.ownerRunId ?? null;
  if (resourceOwnerRunId !== null) {
    assert.equal(
      report.coldReset.ownerRunId,
      resourceOwnerRunId,
      'Android cold route resource owner differs from the baseline reset receipt',
    );
    assert.equal(
      report.coldReset.requestedRunId,
      input.requestedRunId,
      'Android cold route reset receipt requested run differs from the outer request',
    );
    assert.equal(
      report.captureRunId,
      input.captureRunId ?? report.captureRunId,
      'Android cold route capture differs from the allocated capture namespace',
    );
  }
  let resetReceipt: unknown = null;
  if (resourceOwnerRunId !== null && report.coldReset.receiptPath !== null) {
    try {
      resetReceipt = readOwnedJson(
        artifactRoot,
        report.coldReset.receiptPath,
        'Android cold reset original receipt',
      ).value;
    } catch {
      resetReceipt = null;
    }
  }
  const lifecycleNormalization = normalizeT15AndroidDetoxSessionLifecycle({
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRunId: report.captureRunId,
    resourceOwnerRunId,
    expectation: input.coldReset?.expectation ?? {
      requestedRunId: input.requestedRunId,
      requestedAttemptId: input.requestedAttemptId,
      fixtureResetId: 'not-requested',
      cohortFixtureFingerprint: '0'.repeat(64),
      sourceFingerprint: '0'.repeat(64),
      helperFingerprint: '0'.repeat(64),
    },
    report,
    resetReceipt,
    captureLedger: capture,
    cleanupLedger: cleanup,
  });
  detoxDispatchFence(lifecycle, 'session route publication');
  return projectAttempt(
    adapter,
    report,
    capture,
    cleanup,
    recoveryLedgerReadFailures,
    resourceOwnerRunId,
    lifecycleNormalization,
  );
}

export function requireAndroidDetoxSessionNativePilotRouteSelection(
  selection: NativePilotSelection,
): void {
  assert.deepEqual(selection.arguments, {
    platform: 'android',
    engine: 'detox',
    scenario: 'SCN-session-android',
    mode: 'integration',
  });
}
