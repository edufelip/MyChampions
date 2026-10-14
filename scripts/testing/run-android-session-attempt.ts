import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { resolveAndroidPilotToolchain } from './android-build-identity';
import {
  runOwnedAndroidNativeSession,
  type AndroidOwnedNativeSessionPreparation,
  type OwnedAndroidNativeSessionResult,
} from './capture-android-testability';
import { readOwnedAndroidStableFile } from './native-android-session-adapter';
import {
  androidSessionPublicAssertionIds,
  androidSessionPublicSelection,
  requireAndroidSessionCaptureShape,
  requireAndroidSessionSelectionArguments,
  type AndroidSessionPublicLoad,
} from './native-android-session-public-contract';
import { loadAndroidSessionPublicDependency } from './native-android-session-public-dependency';
import {
  androidSessionSelectionBinding,
  collectAndroidSessionProducerReceipts,
  stageAndroidSessionPublicDependency,
  verifyStagedAndroidSessionDependency,
  type AndroidSessionProducerReceipt,
  type AndroidSessionStageResult,
} from './native-android-session-public-staging';
import { selectNativePilotScenario, type NativePilotSelection } from './native-pilot-contract';
import {
  nativeExecutionDeadlines,
  type NativeExecutionDeadlines,
} from './native-runtime-preflight';
import { requireSuccessfulNativeCommandDiagnostics } from './native-training-attempt-outcome';
import { inspectPrivateAndroidDirectory } from './owned-android-emulator';
import { requireAndroidConnectionRepositoryRoot } from './run-android-connection-attempt';
import {
  projectIosTrainingAttemptTerminalFacts,
  type IosTrainingAttemptProjection,
} from './run-ios-training-attempt';
import { verifyOwnedAndroidCleanup } from './verify-owned-android-cleanup';
import type { normalizeNativeCommandDiagnostic } from './native-training-attempt-outcome';
import type { AndroidMaestroQualifiedBuildReuse } from './t15-cold-android-maestro-build-reuse';

const runId = /^[a-f0-9]{24}$/;

type PostCaptureFailurePhase = 'cleanup' | 'verification' | 'adapter-write';
export type PostCaptureFailure = {
  phase: PostCaptureFailurePhase;
  name: string;
  message: string;
  artifactPath?: string;
  cleanupResult?: string;
  cleanupCensusStatus?: string;
};
type AndroidCaptureCleanup =
  'not-acquired' | 'cleaned' | { status: 'failed-recovery-retained'; resources: string[] } | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(isRecord(value), `${label} must be an object`);
  return value;
}

function nonempty(value: unknown, label: string): string {
  assert(
    typeof value === 'string' && value.length > 0 && value.trim() === value,
    `${label} is invalid`,
  );
  return value;
}

function failure(phase: PostCaptureFailurePhase, error: unknown): PostCaptureFailure {
  return {
    phase,
    name: error instanceof Error ? error.name : 'UnknownError',
    message:
      error instanceof Error ? error.message : 'Android session post-capture processing failed',
  };
}

function captureDeadline(value: unknown): { step: string; deadlineMs: number } | null {
  if (!isRecord(value) || typeof value.step !== 'string' || typeof value.deadlineMs !== 'number')
    return null;
  if (!Number.isFinite(value.deadlineMs) || value.deadlineMs <= 0) return null;
  return { step: value.step, deadlineMs: value.deadlineMs };
}

function requireAndroidSelection(selection: NativePilotSelection): void {
  assert.deepEqual(selection.arguments, androidSessionPublicSelection);
  assert.equal(selection.scenario.id, 'SCN-session-android');
  assert.equal(selection.scenario.platform, 'android');
  assert.equal(selection.scenario.flowId, 'FLW-session');
  assert.equal(selection.scenario.dataMode, 'postgres');
  assert.equal(selection.scenario.fixtureRef, 'owned-postgres:SCN-session-android:fresh-attempt');
  assert.equal(selection.scenarioHash.length, 64);
  assert.equal(selection.requirementHash.length, 64);
}

export async function readCaptureProducerReceipt(
  captureRoot: string,
  captureRunId: string,
): Promise<AndroidSessionProducerReceipt> {
  const envelopeFile = await readOwnedAndroidStableFile({
    artifactRoot: captureRoot,
    filePath: path.join(captureRoot, 'capture-receipt.private.json'),
    kind: 'sidecar',
    maxBytes: 32 * 1024 * 1024,
  });
  const envelope = JSON.parse(envelopeFile.bytes.toString('utf8')) as Record<string, unknown>;
  assert.equal(envelope.kind, 'private-owned-android-capture-receipt');
  assert.equal(envelope.captureRunId, captureRunId);
  assert.equal(envelopeFile.receipt.kind, 'sidecar');
  const stable = await readOwnedAndroidStableFile({
    artifactRoot: captureRoot,
    filePath: path.join(captureRoot, 'capture.private.json'),
    kind: 'sidecar',
    maxBytes: 32 * 1024 * 1024,
  });
  assert.deepEqual(
    envelope.receipt,
    stable.receipt,
    'Android capture receipt was not read-back bound',
  );
  return stable.receipt;
}

async function currentAndroidSelection(
  repositoryRoot: string,
  selection: NativePilotSelection,
): Promise<NativePilotSelection> {
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  const current = await selectNativePilotScenario(selection.arguments, inventory, repositoryRoot);
  requireAndroidSessionSelectionArguments(current.arguments);
  requireAndroidSelection(current);
  assert.deepEqual(selection, current, 'Android session selection changed before acquisition');
  return current;
}

function requireAndroidRuntimeIdentity(report: Record<string, unknown>): void {
  requireAndroidSessionCaptureShape(report);
  const source = record(report.source, 'Android source identity');
  const sourceAfter = record(report.sourceAfter, 'Android post-capture source identity');
  assert(Object.keys(source).length > 0 && Object.keys(sourceAfter).length > 0);
  const helperBefore = report.helperInputsBefore;
  const helperAfter = report.helperInputsAfter;
  assert(
    Array.isArray(helperBefore) && helperBefore.length > 0,
    'Android helper input ledger is empty',
  );
  assert(Array.isArray(helperAfter) && helperAfter.length === helperBefore.length);
  assert.deepEqual(helperBefore, helperAfter, 'Android helper identity changed during capture');

  const device = record(report.device, 'Android device identity');
  for (const key of ['serial', 'osVersion', 'runId'])
    nonempty(device[key], `Android device ${key}`);
  const build = record(report.build, 'Android build identity');
  for (const key of ['appId', 'binaryHash', 'environmentHash', 'apiOrigin', 'profile'])
    nonempty(build[key], `Android build ${key}`);
  assert.match(String(build.binaryHash), /^[a-f0-9]{64}$/);
  assert.match(String(build.environmentHash), /^[a-f0-9]{64}$/);
  assert.match(String(build.apiOrigin), /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+$/);

  const backend = record(report.backend, 'Android backend identity');
  const backendRunId = nonempty(backend.runId, 'Android backend runId');
  assert.match(backendRunId, runId);
  const backendAttemptId = nonempty(backend.backendAttemptId, 'Android backend attempt');
  assert.equal(backendAttemptId, `${backendRunId}:first`);
  // The app is built against the owned proxy, which forwards to the owned API.
  const proxyOrigin = nonempty(report.proxyOrigin, 'Android proxy origin');
  assert.equal(build.apiOrigin, proxyOrigin, 'Android app is not bound to the owned proxy');
  assert.match(String(backend.apiOrigin), /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
  assert.notEqual(backend.apiOrigin, proxyOrigin);
  const apiProcess = record(backend.apiProcess, 'Android API process identity');
  assert(Number.isSafeInteger(apiProcess.pid) && Number(apiProcess.pid) > 1);
  nonempty(apiProcess.started, 'Android API process start');
  nonempty(apiProcess.script, 'Android API process script');

  const auth = record(report.androidSessionAuthIdentity, 'Android auth identity');
  assert.equal(auth.targetOrigin, backend.apiOrigin);
  assert.equal(auth.apiPid, apiProcess.pid);
  assert.equal(auth.backendAttemptId, backendAttemptId);
  assert.match(String(report.fixtureHash), /^[a-f0-9]{64}$/);
  const toolVersions = record(report.toolVersions, 'Android tool versions');
  assert.equal(toolVersions.maestro, '2.6.1');

  const timings = record(report.timingsMs, 'Android phase timings');
  for (const key of ['build', 'install', 'reset', 'scenario', 'verify', 'cleanup']) {
    const value = timings[key];
    assert(
      typeof value === 'number' && Number.isFinite(value) && value > 0,
      `Android timing ${key} is unavailable`,
    );
  }
}

function projectAndroidTerminal(
  report: Record<string, unknown>,
  capture: OwnedAndroidNativeSessionResult,
): IosTrainingAttemptProjection {
  return projectIosTrainingAttemptTerminalFacts({
    commandExecutions: report.commandExecutions,
    callbackCompleted: capture.exitCode === 0 && report.result === 'observed',
    captureResult: report.result,
    captureExitCode: capture.exitCode,
    captureCleanup: report.cleanup,
    budgetTimeout: report.budgetTimeout,
    cancellation: report.cancellation,
  });
}

export type AndroidSessionAttemptResult = {
  kind: 'private-owned-android-session-attempt-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  backendRunId: string | null;
  backendAttemptId: string | null;
  captureExitCode: number;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  childClassification: ReturnType<typeof normalizeNativeCommandDiagnostic>['execution'];
  captureResult: string;
  captureCleanup: AndroidCaptureCleanup;
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGINT' | 'SIGTERM' | null;
  captureInvocation: { count: 1; returned: true; exitCode: number; result: string };
  captureCompleted: boolean;
  externalCleanupResult: 'passed' | 'failed';
  verificationResult: 'source-only' | 'blocked' | 'not-executed';
  verificationFailure: PostCaptureFailure | null;
  postCaptureFailure: PostCaptureFailure | null;
  dependencyStatus: AndroidSessionPublicLoad['status'] | 'not-executed';
  publicPromotionEligible: false;
  nativePassingCases: 0;
  publicPassingCases: 0;
  staged: AndroidSessionStageResult | null;
  deadline: { step: string; deadlineMs: number } | null;
  commandDiagnostics: ReturnType<typeof normalizeNativeCommandDiagnostic>[];
  censusFailures: unknown[];
  outputFailures: unknown[];
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
  artifactRoot: string;
};

export type AndroidSessionRuntimeDependencies = {
  capture: typeof runOwnedAndroidNativeSession;
  select: (
    repositoryRoot: string,
    selection: NativePilotSelection,
  ) => Promise<NativePilotSelection>;
  cleanup: (input: {
    repositoryRoot: string;
    artifactRoot: string;
  }) => Promise<Record<string, unknown>>;
  load: typeof loadAndroidSessionPublicDependency;
  stage: (
    input: Parameters<typeof stageAndroidSessionPublicDependency>[0] & {
      producerReceipts: readonly AndroidSessionProducerReceipt[];
    },
  ) => ReturnType<typeof stageAndroidSessionPublicDependency>;
  verifyStage: typeof verifyStagedAndroidSessionDependency;
};

const productionDependencies: AndroidSessionRuntimeDependencies = {
  capture: runOwnedAndroidNativeSession,
  select: currentAndroidSelection,
  cleanup: async ({ repositoryRoot, artifactRoot }) => {
    const hostRoot = process.env.MYCHAMPIONS_NATIVE_STATE_ROOT;
    assert(hostRoot, 'Android cleanup requires the shared native host-lock wrapper');
    await inspectPrivateAndroidDirectory(hostRoot);
    const androidRuntimeParent = path.join(path.dirname(hostRoot), 'mychampions-android-pilot');
    await inspectPrivateAndroidDirectory(androidRuntimeParent);
    const toolchain = await resolveAndroidPilotToolchain();
    const result = await verifyOwnedAndroidCleanup({
      repositoryRoot,
      artifactRoot,
      androidRuntimeParent,
      sdkRoot: toolchain.sdkRoot,
    });
    if (result.result === 'passed') {
      const cleanupReceipt = await readOwnedAndroidStableFile({
        artifactRoot,
        filePath: path.join(artifactRoot, 'external-cleanup.private.json'),
        kind: 'sidecar',
        maxBytes: 32 * 1024 * 1024,
      });
      assert.deepEqual(
        (result as unknown as Record<string, unknown>).androidCleanupReceipt,
        cleanupReceipt.receipt,
        'Android cleanup receipt was not producer-published and read-back bound',
      );
      const cleanupEnvelopeFile = await readOwnedAndroidStableFile({
        artifactRoot,
        filePath: path.join(artifactRoot, 'external-cleanup-receipt.private.json'),
        kind: 'sidecar',
        maxBytes: 32 * 1024 * 1024,
      });
      const cleanupEnvelope = JSON.parse(cleanupEnvelopeFile.bytes.toString('utf8')) as Record<
        string,
        unknown
      >;
      assert.equal(cleanupEnvelope.kind, 'private-owned-android-cleanup-receipt');
      assert.equal(cleanupEnvelope.runId, result.runId);
      assert.deepEqual(cleanupEnvelope.receipt, cleanupReceipt.receipt);
      return result;
    }
    return result;
  },
  load: loadAndroidSessionPublicDependency,
  stage: stageAndroidSessionPublicDependency,
  verifyStage: verifyStagedAndroidSessionDependency,
};

/**
 * Execute the existing Android session-account capture once, then load and
 * stage its private source-only evidence. The candidate never writes a public
 * receipt and never converts source/native evidence into a passing case.
 */
export async function runAndroidSessionAttempt(
  options: {
    repositoryRoot: string;
    requestedRunId: string;
    selection: NativePilotSelection;
    signal: AbortSignal;
    deadlines?: NativeExecutionDeadlines;
    outputRoot?: string;
    deadlineAtMonotonicMs?: number;
    coldResetOwnerRunId?: string;
    coldResetFixtureResetId?: string;
    prepareColdReset?: AndroidOwnedNativeSessionPreparation;
    qualifiedBuild?: AndroidMaestroQualifiedBuildReuse;
  },
  dependencies: AndroidSessionRuntimeDependencies = productionDependencies,
): Promise<AndroidSessionAttemptResult> {
  assert.match(options.requestedRunId, runId);
  assert(options.signal instanceof AbortSignal, 'Android session signal is invalid');
  nativeExecutionDeadlines(options.deadlines);
  options.signal.throwIfAborted();
  const root = await requireAndroidConnectionRepositoryRoot(options.repositoryRoot);
  requireAndroidSelection(options.selection);
  const current = await dependencies.select(root, options.selection);
  requireAndroidSelection(current);
  assert.deepEqual(
    options.selection,
    current,
    'Android session selection changed before acquisition',
  );
  options.signal.throwIfAborted();

  const capture = await dependencies.capture({
    charter: 'session-account',
    signal: options.signal,
    deadlines: options.deadlines,
    deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    coldResetOwnerRunId: options.coldResetOwnerRunId,
    coldResetFixtureResetId: options.coldResetFixtureResetId,
    prepareColdReset: options.prepareColdReset,
    qualifiedBuild: options.qualifiedBuild,
  });
  const captureRunId = path.basename(capture.artifactRoot);
  assert.match(captureRunId, runId);
  const report = record(capture.report, 'Android session capture report');
  let selectionBoundaryFailure: unknown = null;
  try {
    const afterCaptureSelection = await dependencies.select(root, current);
    requireAndroidSelection(afterCaptureSelection);
    assert.deepEqual(
      afterCaptureSelection,
      current,
      'Android session selection changed after capture',
    );
  } catch (error) {
    selectionBoundaryFailure = error;
  }
  const captureInvocation = {
    count: 1 as const,
    returned: true as const,
    exitCode: capture.exitCode,
    result: typeof report.result === 'string' ? report.result : 'unknown',
  };
  const terminal = projectAndroidTerminal(report, capture);
  const captureCompleted =
    capture.exitCode === 0 &&
    terminal.historyKnown &&
    terminal.captureResult === 'observed' &&
    terminal.captureCleanup === 'cleaned';

  const cleanupStarted = performance.now();
  let externalCleanupResult: 'passed' | 'failed' = 'failed';
  let cleanupEvidence: Record<string, unknown> | null = null;
  let postCaptureFailure: PostCaptureFailure | null = null;
  try {
    const cleanup = await dependencies.cleanup({
      repositoryRoot: root,
      artifactRoot: capture.artifactRoot,
    });
    cleanupEvidence = cleanup;
    const cleanupResult = typeof cleanup.result === 'string' ? cleanup.result : 'unknown';
    externalCleanupResult = cleanupResult === 'passed' ? 'passed' : 'failed';
    if (externalCleanupResult !== 'passed') {
      postCaptureFailure = {
        phase: 'cleanup',
        name: 'AndroidCleanupFailure',
        message: 'Independent Android cleanup did not pass; retained cleanup ledger is required',
        artifactPath: 'external-cleanup.private.json',
        cleanupResult,
        cleanupCensusStatus:
          typeof cleanup.censusStatus === 'string' ? cleanup.censusStatus : undefined,
      };
    } else {
      // Independent cleanup is keyed by the capture run (its artifact root),
      // not by the owned backend session run.
      assert.equal(
        cleanup.runId,
        path.basename(capture.artifactRoot),
        'Android cleanup run is not capture-bound',
      );
      assert.equal(cleanup.censusStatus, 'available', 'Android cleanup census is unavailable');
      assert.equal(cleanup.captureResult, 'observed', 'Android cleanup capture is not observed');
      assert.equal(cleanup.captureCleanupClean, true, 'Android cleanup capture is not clean');
      assert.equal(cleanup.cacheAbsent, true, 'Android acquired cache absence is unproven');
      assert.deepEqual(cleanup.survivors, [], 'Android cleanup retained owned survivors');
      assert.deepEqual(
        cleanup.unknownProcessQueries,
        [],
        'Android cleanup has unknown process queries',
      );
      assert.deepEqual(
        cleanup.missingForeignDevices,
        [],
        'Android cleanup has foreign-device drift',
      );
    }
  } catch (error) {
    postCaptureFailure = failure('cleanup', error);
    postCaptureFailure.artifactPath = 'external-cleanup.private.json';
  }
  const cleanupMs = performance.now() - cleanupStarted;
  const verifyStarted = performance.now();
  let verificationResult: AndroidSessionAttemptResult['verificationResult'] = 'not-executed';
  let verificationFailure: PostCaptureFailure | null = null;
  let dependencyResult: AndroidSessionPublicLoad | null = null;
  let staged: AndroidSessionStageResult | null = null;

  if (selectionBoundaryFailure) {
    verificationResult = 'blocked';
    verificationFailure = failure('verification', selectionBoundaryFailure);
    postCaptureFailure ??= verificationFailure;
  } else if (captureCompleted && externalCleanupResult === 'passed' && !options.signal.aborted) {
    try {
      requireAndroidRuntimeIdentity(report);
      requireSuccessfulNativeCommandDiagnostics(report.commandExecutions);
      options.signal.throwIfAborted();
      dependencyResult = await dependencies.load({
        repositoryRoot: root,
        captureRoot: capture.artifactRoot,
        cleanupRoot: capture.artifactRoot,
        signal: options.signal,
        deadlineMs: 60_000,
      });
      if (dependencyResult.status !== 'validated-source-only') {
        verificationFailure = failure(
          'verification',
          new Error(`Android session dependency loader returned ${dependencyResult.status}`),
        );
        postCaptureFailure ??= verificationFailure;
        verificationResult = 'blocked';
      } else {
        assert.deepEqual(
          dependencyResult.selection,
          current.arguments,
          'Android session selection changed after capture',
        );
        assert.deepEqual(dependencyResult.assertionIds, androidSessionPublicAssertionIds);
        options.signal.throwIfAborted();
        if (options.outputRoot === undefined) {
          verificationResult = 'source-only';
        } else {
          const finalSelection = await dependencies.select(root, current);
          requireAndroidSelection(finalSelection);
          assert.deepEqual(
            finalSelection,
            current,
            'Android session selection changed before staging',
          );
          const additionalReceipts: unknown[] = [];
          if (cleanupEvidence?.androidCleanupReceipt)
            additionalReceipts.push(cleanupEvidence.androidCleanupReceipt);
          try {
            additionalReceipts.push(
              await readCaptureProducerReceipt(capture.artifactRoot, captureRunId),
            );
          } catch (error) {
            // An injected stage is allowed to exercise orchestration without a
            // capture tree. The production stager remains fail-closed below.
            if (dependencies.stage === productionDependencies.stage) throw error;
          }
          const producerReceipts = collectAndroidSessionProducerReceipts(
            report,
            additionalReceipts,
          );
          staged = await dependencies.stage({
            dependency: dependencyResult,
            captureRoot: capture.artifactRoot,
            outputRoot: options.outputRoot,
            requestedRunId: options.requestedRunId,
            selection: finalSelection,
            producerReceipts,
          });
          assert.deepEqual(
            staged.selectionBinding,
            androidSessionSelectionBinding(finalSelection),
            'Android staged selection binding changed during staging',
          );
          await dependencies.verifyStage({
            outputRoot: options.outputRoot,
            copyManifest: staged.copyManifest,
            requestedRunId: options.requestedRunId,
            captureRunId,
            captureRoot: capture.artifactRoot,
            dependency: dependencyResult,
            selection: finalSelection,
            producerReceipts,
          });
          options.signal.throwIfAborted();
          const postStageSelection = await dependencies.select(root, current);
          requireAndroidSelection(postStageSelection);
          assert.deepEqual(
            postStageSelection,
            current,
            'Android session selection changed after source staging',
          );
          verificationResult = 'source-only';
        }
      }
    } catch (error) {
      verificationResult = 'blocked';
      verificationFailure = failure('verification', error);
      postCaptureFailure ??= verificationFailure;
    }
  }

  const backend = isRecord(report.backend) ? report.backend : {};
  const build = isRecord(report.build) ? report.build : {};
  const timings = isRecord(report.timingsMs) ? report.timingsMs : {};
  const outcome: AndroidSessionAttemptResult = {
    kind: 'private-owned-android-session-attempt-not-public-receipt',
    requestedRunId: options.requestedRunId,
    requestedAttemptId: `${options.requestedRunId}:first`,
    captureRunId,
    backendRunId: typeof backend.runId === 'string' ? backend.runId : null,
    backendAttemptId:
      typeof backend.backendAttemptId === 'string' ? backend.backendAttemptId : null,
    captureExitCode: capture.exitCode,
    childExitCode: terminal.childExitCode,
    childSignal: terminal.childSignal,
    childClassification: terminal.childClassification,
    captureResult: terminal.captureResult,
    captureCleanup: terminal.captureCleanup,
    captureTimeout: terminal.captureTimeout,
    cancellation: terminal.cancellation,
    captureInvocation,
    captureCompleted,
    externalCleanupResult,
    verificationResult,
    verificationFailure,
    postCaptureFailure,
    dependencyStatus: dependencyResult?.status ?? 'not-executed',
    publicPromotionEligible: false,
    nativePassingCases: 0,
    publicPassingCases: 0,
    staged,
    deadline: captureDeadline(report.deadline),
    commandDiagnostics: terminal.commandDiagnostics,
    censusFailures: terminal.censusFailures,
    outputFailures: terminal.outputFailures,
    fixtureRunId: typeof backend.runId === 'string' ? backend.runId : null,
    fixtureHash: typeof report.fixtureHash === 'string' ? report.fixtureHash : null,
    flagsHash: typeof build.environmentHash === 'string' ? build.environmentHash : null,
    toolVersions: isRecord(report.toolVersions)
      ? (report.toolVersions as Record<string, string>)
      : {},
    timingsMs: {
      build: typeof timings.build === 'number' ? timings.build : 0,
      install: typeof timings.install === 'number' ? timings.install : 0,
      reset: typeof timings.reset === 'number' ? timings.reset : 0,
      scenario: typeof timings.scenario === 'number' ? timings.scenario : 0,
      verify:
        (typeof timings.verify === 'number' ? timings.verify : 0) +
        performance.now() -
        verifyStarted,
      cleanup: (typeof timings.cleanup === 'number' ? timings.cleanup : 0) + cleanupMs,
    },
    artifactRoot: capture.artifactRoot,
  };

  try {
    // Final publication fence: a late abort must block the adapter file.
    options.signal.throwIfAborted();
    await writeFile(
      path.join(capture.artifactRoot, 'android-session-runtime-adapter.private.json'),
      JSON.stringify(
        {
          kind: outcome.kind,
          requestedRunId: outcome.requestedRunId,
          requestedAttemptId: outcome.requestedAttemptId,
          captureRunId: outcome.captureRunId,
          backendRunId: outcome.backendRunId,
          backendAttemptId: outcome.backendAttemptId,
          captureInvocation: outcome.captureInvocation,
          captureCompleted: outcome.captureCompleted,
          dependencyStatus: outcome.dependencyStatus,
          verificationResult: outcome.verificationResult,
          assertionIds: [...androidSessionPublicAssertionIds],
          staged: outcome.staged,
          selectionBinding: androidSessionSelectionBinding(current),
          selectionBindingSha256: createHash('sha256')
            .update(JSON.stringify(androidSessionSelectionBinding(current)))
            .digest('hex'),
          nativePassingCases: 0,
          publicPassingCases: 0,
          publicPromotionEligible: false,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    outcome.postCaptureFailure ??= failure('adapter-write', error);
    outcome.verificationResult = 'blocked';
  }
  return outcome;
}

export function androidSessionAttemptMustRemainBlocked(
  result: Pick<AndroidSessionAttemptResult, 'verificationResult' | 'publicPromotionEligible'>,
): boolean {
  return result.verificationResult === 'source-only' && result.publicPromotionEligible === false;
}

export function androidSessionCaptureResultConsistent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const invocation = value.captureInvocation;
  if (!isRecord(invocation) || invocation.count !== 1 || invocation.returned !== true) return false;
  if (!Number.isSafeInteger(invocation.exitCode) || typeof invocation.result !== 'string')
    return false;
  if (invocation.exitCode !== value.captureExitCode || invocation.result !== value.captureResult)
    return false;
  const expected =
    value.captureExitCode === 0 &&
    value.captureResult === 'observed' &&
    value.captureCleanup === 'cleaned';
  return value.captureCompleted === expected;
}
