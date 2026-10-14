import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { androidSourceIdentity, resolveAndroidPilotToolchain } from './android-build-identity';
import {
  runOwnedAndroidNativeSession,
  type AndroidConnectionRuntimeContext,
  type AndroidOwnedNativeSessionPreparation,
} from './capture-android-testability';
import { observeAndroidConnectionJourney } from './native-connection-journey';
import {
  ANDROID_CONNECTION_PLATFORM,
  buildConnectionJourneyActionPlan,
  buildConnectionJourneyArtifactContract,
  buildConnectionPlatformSelectionContract,
  type ConnectionNavigation,
  type ConnectionPlatformProfile,
} from './native-connection-platform-contract';
import {
  prepareAndroidConnectionPilotEvidence,
  type NativeConnectionAssertionBinding,
} from './native-connection-public-evidence-android';
import {
  nativeConnectionAssertionIds,
  requireNativePilotAssertions,
  selectNativePilotScenario,
} from './native-pilot-contract';
import { nativeExecutionDeadlines } from './native-runtime-preflight';
import {
  normalizeNativeCommandDiagnostic,
  requireSuccessfulNativeCommandDiagnostics,
} from './native-training-attempt-outcome';
import { inspectPrivateAndroidDirectory } from './owned-android-emulator';
import {
  projectIosTrainingAttemptTerminalFacts,
  type IosTrainingAttemptProjection,
} from './run-ios-training-attempt';
import { verifyOwnedAndroidCleanup } from './verify-owned-android-cleanup';
import type { NativeConnectionAttemptBinding } from './native-connection-attempt-binding';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeExecutionDeadlines } from './native-runtime-preflight';
import type { AndroidMaestroQualifiedBuildReuse } from './t15-cold-android-maestro-build-reuse';

const runIdPattern = /^[a-f0-9]{24}$/;

/**
 * Bind the caller to the repository containing this adapter before any
 * inventory, toolchain, emulator, proxy or session acquisition occurs.
 */
export async function requireAndroidConnectionRepositoryRoot(
  repositoryRoot: string,
): Promise<string> {
  const suppliedRoot = await realpath(repositoryRoot);
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const derivedRoot = await realpath(moduleRoot);
  assert.equal(
    suppliedRoot,
    derivedRoot,
    'Android connection adapter repositoryRoot does not match its own source checkout',
  );
  return suppliedRoot;
}

type PostCaptureFailurePhase = 'cleanup' | 'verification' | 'adapter-write';
type PostCaptureFailure = {
  phase: PostCaptureFailurePhase;
  name: string;
  message: string;
};

type ConnectionPreparation = {
  binding?: NativeConnectionAttemptBinding;
  nativePassingCases?: number;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function postCaptureFailure(phase: PostCaptureFailurePhase, error: unknown): PostCaptureFailure {
  return {
    phase,
    name: error instanceof Error ? error.name : 'UnknownError',
    message:
      error instanceof Error ? error.message : 'Android connection post-capture processing failed',
  };
}

function captureDeadline(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.step !== 'string' ||
    typeof value.deadlineMs !== 'number' ||
    !Number.isFinite(value.deadlineMs)
  )
    return null;
  return { step: value.step, deadlineMs: value.deadlineMs };
}

function preparationFromReport(report: Record<string, unknown>): ConnectionPreparation {
  const preparation = report.connectionJourneyPreparation;
  assert(isRecord(preparation), 'Connection journey preparation report is missing');
  assert.equal(preparation.nativePassingCases, 0);
  assert(isRecord(preparation.binding), 'Connection attempt binding is missing');
  return preparation;
}

function validateAndroidConnectionSelection(selection: NativePilotSelection): void {
  assert.deepEqual(selection.arguments, {
    platform: 'android',
    engine: 'maestro',
    scenario: 'SCN-connection-android',
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, 'SCN-connection-android');
  assert.equal(selection.scenario.platform, 'android');
  assert.equal(selection.scenario.flowId, 'FLW-connection');
  assert.equal(selection.scenario.dataMode, 'postgres');
  assert.equal(
    selection.scenario.fixtureRef,
    'owned-postgres:SCN-connection-android:fresh-attempt',
  );
  assert.equal(selection.scenarioHash.length, 64);
  assert.equal(selection.requirementHash.length, 64);
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    nativeConnectionAssertionIds,
    'Android connection assertion order changed before acquisition',
  );
}

export const ANDROID_CONNECTION_ADAPTER_STATUS = 'candidate-only' as const;

export type AndroidConnectionAttemptPlan = Readonly<{
  status: typeof ANDROID_CONNECTION_ADAPTER_STATUS;
  platform: 'android';
  scenarioId: 'SCN-connection-android';
  fixtureScope: 'native-entry-android';
  isolationScope: 'native-conn-isolation-android';
  callback: 'executeConnection';
  actors: readonly ['coach', 'student'];
  navigation: readonly ['none', 'student-professionals-back'];
  assertionIds: readonly string[];
  purposePlan: ReturnType<typeof buildConnectionJourneyActionPlan>;
  artifactContract: ReturnType<typeof buildConnectionJourneyArtifactContract>;
  nativePassingCases: 0;
  runtime: 'pending';
}>;

export function validateAndroidConnectionRuntimeContextShape(
  value: unknown,
): asserts value is AndroidConnectionRuntimeContext {
  assert(isRecord(value), 'Android connection runtime context must be an object');
  for (const key of [
    'output',
    'fixtures',
    'proxy',
    'apiIdentity',
    'observe',
    'snapshot',
    'connectionSnapshot',
    'isolationSnapshot',
    'report',
    'switchAccount',
  ])
    assert(key in value, `Android connection runtime context is missing ${key}`);
  assert(typeof value.output === 'string' && value.output.length > 0);
  assert(typeof value.observe === 'function');
  assert(typeof value.snapshot === 'function');
  assert(typeof value.connectionSnapshot === 'function');
  assert(typeof value.isolationSnapshot === 'function');
  assert(typeof value.switchAccount === 'function');
  const apiIdentity = value.apiIdentity;
  assert(isRecord(apiIdentity), 'Android connection API identity must be an object');
  assert(Number.isSafeInteger(apiIdentity.apiPid) && Number(apiIdentity.apiPid) > 1);
  assert(
    typeof apiIdentity.targetOrigin === 'string' &&
      /^http:\/\/127\.0\.0\.1:\d+$/.test(apiIdentity.targetOrigin),
    'Android connection API identity must be an owned loopback target',
  );
  const report = value.report;
  assert(isRecord(report), 'Android connection report must be an object');
  assert(report.nativePassingCases === undefined || report.nativePassingCases === 0);
}

export function requireAndroidConnectionSelection(
  selection: NativePilotSelection,
): ReturnType<typeof buildConnectionPlatformSelectionContract> {
  validateAndroidConnectionSelection(selection);
  const contract = buildConnectionPlatformSelectionContract(selection, ANDROID_CONNECTION_PLATFORM);
  assert.deepEqual(contract.assertionIds, nativeConnectionAssertionIds);
  return contract;
}

export function requireAndroidConnectionNavigation(value: unknown): ConnectionNavigation {
  assert(
    value === 'none' || value === 'student-professionals-back',
    'Android connection navigation is outside the closed semantic scope',
  );
  return value;
}

export function requireAndroidConnectionProfile(
  profile: ConnectionPlatformProfile,
): ConnectionPlatformProfile {
  assert.equal(profile.platform, 'android');
  assert.equal(profile.scenarioId, 'SCN-connection-android');
  assert.equal(profile.fixtureScope, 'native-entry-android');
  assert.equal(profile.expectedLocale, 'en-US');
  assert.equal(profile.frameTextAttribute, 'accessibilityText');
  return profile;
}

export function buildAndroidConnectionAttemptPlan(input: {
  selection: NativePilotSelection;
  contextShape?: unknown;
}): AndroidConnectionAttemptPlan {
  const contract = requireAndroidConnectionSelection(input.selection);
  if (input.contextShape !== undefined)
    validateAndroidConnectionRuntimeContextShape(input.contextShape);
  const purposePlan = buildConnectionJourneyActionPlan(ANDROID_CONNECTION_PLATFORM);
  const artifactContract = buildConnectionJourneyArtifactContract(ANDROID_CONNECTION_PLATFORM);
  assert.deepEqual(contract.assertionIds, nativeConnectionAssertionIds);
  assert.deepEqual(artifactContract.purposeIds, nativeConnectionAssertionIds);
  return Object.freeze({
    status: ANDROID_CONNECTION_ADAPTER_STATUS,
    platform: 'android',
    scenarioId: 'SCN-connection-android',
    fixtureScope: 'native-entry-android',
    isolationScope: 'native-conn-isolation-android',
    callback: 'executeConnection',
    actors: Object.freeze(['coach', 'student'] as const),
    navigation: Object.freeze(['none', 'student-professionals-back'] as const),
    assertionIds: Object.freeze([...nativeConnectionAssertionIds]),
    purposePlan,
    artifactContract,
    nativePassingCases: 0,
    runtime: 'pending',
  });
}

function requireAndroidConnectionBinding(
  value: NativeConnectionAttemptBinding,
  options: { requestedRunId: string; captureRunId: string; backendRunId: string },
  selection: NativePilotSelection,
): NativeConnectionAttemptBinding {
  assert.equal(value.requestedRunId, options.requestedRunId);
  assert.equal(value.requestedAttemptId, `${options.requestedRunId}:first`);
  assert.equal(value.captureRunId, options.captureRunId);
  assert.equal(value.backendRunId, options.backendRunId);
  assert.equal(value.backendAttemptId, `${options.backendRunId}:first`);
  assert.equal(value.fixtureScope, 'native-entry-android');
  assert.equal(value.scenarioId, selection.scenario.id);
  assert.deepEqual(value.selection, {
    arguments: selection.arguments,
    scenarioHash: selection.scenarioHash,
    requirementHash: selection.requirementHash,
  });
  assert.deepEqual(value.assertionIds, nativeConnectionAssertionIds);
  assert.equal(value.nativePassingCases, 0);
  return value;
}

function requireAndroidSuccessfulConnectionCommandDiagnostics(value: unknown) {
  return requireSuccessfulNativeCommandDiagnostics(value);
}

export function projectAndroidConnectionAttemptTerminalFacts(
  input: Parameters<typeof projectIosTrainingAttemptTerminalFacts>[0],
): IosTrainingAttemptProjection {
  return projectIosTrainingAttemptTerminalFacts(input);
}

export type AndroidConnectionAttemptResult = {
  kind: 'private-owned-android-connection-attempt-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  backendRunId: string | null;
  backendAttemptId: string | null;
  captureExitCode: number;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  childClassification:
    | 'completed'
    | 'child-failed'
    | 'deadline'
    | 'cancelled'
    | 'output-limit'
    | 'output-failed'
    | 'harness-blocked'
    | null;
  captureResult: string;
  captureCleanup:
    'not-acquired' | 'cleaned' | { status: 'failed-recovery-retained'; resources: string[] } | null;
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGINT' | 'SIGTERM' | null;
  callbackInvocations: number;
  callbackCompleted: boolean;
  externalCleanupResult: 'passed' | 'failed';
  verificationResult: 'passed' | 'failed' | 'not-executed';
  applicationFailure: null;
  applicationFailureCandidate: null;
  verificationFailure: { name: string; message: string } | null;
  postCaptureFailure: PostCaptureFailure | null;
  deadline: { step: string; deadlineMs: number } | null;
  commandDiagnostics: ReturnType<typeof normalizeNativeCommandDiagnostic>[];
  censusFailures: unknown[];
  outputFailures: unknown[];
  assertionBindings: NativeConnectionAssertionBinding[];
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
  nativePassingCases: 0;
  artifactRoot: string;
};

/**
 * Actual owned Android connection execution. The capture lifecycle owns all
 * resource acquisition. Cleanup and private evidence verification run after
 * capture; public receipt/staging remains a separate checked boundary.
 */
export async function runAndroidConnectionAttempt(options: {
  repositoryRoot: string;
  requestedRunId: string;
  selection: NativePilotSelection;
  signal: AbortSignal;
  deadlines?: NativeExecutionDeadlines;
  deadlineAtMonotonicMs?: number;
  coldResetOwnerRunId?: string;
  coldResetFixtureResetId?: string;
  prepareColdReset?: AndroidOwnedNativeSessionPreparation;
  qualifiedBuild?: AndroidMaestroQualifiedBuildReuse;
}): Promise<AndroidConnectionAttemptResult> {
  assert.match(options.requestedRunId, runIdPattern);
  nativeExecutionDeadlines(options.deadlines);
  assert(options.signal instanceof AbortSignal, 'Android connection signal is invalid');
  options.signal.throwIfAborted();
  const root = await requireAndroidConnectionRepositoryRoot(options.repositoryRoot);
  const current = await selectNativePilotScenario(
    options.selection.arguments,
    JSON.parse(await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8')),
    root,
  );
  assert.deepEqual(
    options.selection,
    current,
    'Public connection selection changed before acquisition',
  );
  requireAndroidConnectionSelection(current);
  options.signal.throwIfAborted();

  const hostRoot = process.env.MYCHAMPIONS_NATIVE_STATE_ROOT;
  assert(hostRoot, 'Use the shared native host-lock wrapper');
  await inspectPrivateAndroidDirectory(hostRoot);
  const androidRuntimeParent = path.join(path.dirname(hostRoot), 'mychampions-android-pilot');
  await inspectPrivateAndroidDirectory(androidRuntimeParent);
  const toolchain = await resolveAndroidPilotToolchain();
  const sourceBefore = await androidSourceIdentity(root);
  options.signal.throwIfAborted();

  let callbackInvocations = 0;
  let callbackCompleted = false;
  const bindingState: { value: NativeConnectionAttemptBinding | null } = { value: null };
  const capture = await runOwnedAndroidNativeSession({
    charter: 'connection-journey',
    signal: options.signal,
    deadlines: options.deadlines,
    deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    coldResetOwnerRunId: options.coldResetOwnerRunId,
    coldResetFixtureResetId: options.coldResetFixtureResetId,
    prepareColdReset: options.prepareColdReset,
    qualifiedBuild: options.qualifiedBuild,
    executeConnection: async (context: AndroidConnectionRuntimeContext) => {
      callbackInvocations++;
      assert.equal(callbackInvocations, 1, 'Connection callback must execute once');
      validateAndroidConnectionRuntimeContextShape(context);
      assert.equal(context.fixtures.scope, 'native-entry-android');
      await observeAndroidConnectionJourney(context, {
        repositoryRoot: root,
        requestedRunId: options.requestedRunId,
        selection: current,
      });
      const preparation = preparationFromReport(context.report);
      const currentBinding = requireAndroidConnectionBinding(
        preparation.binding!,
        {
          requestedRunId: options.requestedRunId,
          captureRunId: path.basename(context.output),
          backendRunId: context.fixtures.runId,
        },
        current,
      );
      bindingState.value = currentBinding;
      await writeFile(
        path.join(context.output, 'connection-runtime-metadata.private.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            kind: 'private-android-connection-runtime-metadata-not-public-receipt',
            requestedRunId: currentBinding.requestedRunId,
            requestedAttemptId: currentBinding.requestedAttemptId,
            captureRunId: currentBinding.captureRunId,
            backendRunId: currentBinding.backendRunId,
            backendAttemptId: currentBinding.backendAttemptId,
            selection: currentBinding.selection,
            assertionIds: currentBinding.assertionIds,
            assertionSemanticSha256: currentBinding.assertionSemanticSha256,
            assertionContractSha256: currentBinding.assertionContractSha256,
            preparation,
            publicNativePassingCases: 0,
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
      callbackCompleted = true;
    },
  });

  let sourceIdentityFailure: unknown = null;
  try {
    const capturedSource = capture.report.source;
    assert.deepEqual(
      capturedSource,
      sourceBefore,
      'Android source identity changed before capture',
    );
    assert.deepEqual(
      capture.report.source,
      capture.report.sourceAfter,
      'Android source changed during capture',
    );
  } catch (error) {
    sourceIdentityFailure = error;
  }

  const cleanupStarted = performance.now();
  let externalCleanupResult: 'passed' | 'failed' = 'failed';
  let postCaptureFailureRecord: PostCaptureFailure | null = null;
  try {
    const externalCleanup = await verifyOwnedAndroidCleanup({
      repositoryRoot: root,
      artifactRoot: capture.artifactRoot,
      androidRuntimeParent,
      sdkRoot: toolchain.sdkRoot,
    });
    externalCleanupResult = externalCleanup.result === 'passed' ? 'passed' : 'failed';
  } catch (error) {
    postCaptureFailureRecord = postCaptureFailure('cleanup', error);
  }
  const cleanupMs = performance.now() - cleanupStarted;
  const verifyStarted = performance.now();
  const terminal = projectAndroidConnectionAttemptTerminalFacts({
    commandExecutions: capture.report.commandExecutions,
    callbackCompleted,
    captureResult: capture.report.result,
    captureExitCode: capture.exitCode,
    captureCleanup: capture.report.cleanup,
    budgetTimeout: capture.report.budgetTimeout,
    cancellation: capture.report.cancellation,
  });
  const captureTimings = (capture.report.timingsMs ?? {}) as Record<string, unknown>;
  const fixture = isRecord(capture.report.backend) ? capture.report.backend : {};
  const build = isRecord(capture.report.build) ? capture.report.build : {};
  const finalBinding = bindingState.value;
  let assertionBindings: NativeConnectionAssertionBinding[] = [];
  let verificationResult: 'passed' | 'failed' | 'not-executed' = 'not-executed';
  let verificationFailure: { name: string; message: string } | null = null;
  if (sourceIdentityFailure !== null) {
    verificationResult = 'failed';
    verificationFailure =
      sourceIdentityFailure instanceof Error
        ? { name: sourceIdentityFailure.name, message: sourceIdentityFailure.message }
        : { name: 'UnknownError', message: 'Android source identity verification rejected' };
    postCaptureFailureRecord ??= postCaptureFailure('verification', sourceIdentityFailure);
  }
  if (
    capture.exitCode === 0 &&
    terminal.captureResult === 'observed' &&
    terminal.captureCleanup === 'cleaned' &&
    terminal.historyKnown &&
    sourceIdentityFailure === null &&
    callbackCompleted &&
    externalCleanupResult === 'passed' &&
    !options.signal.aborted
  ) {
    try {
      requireAndroidSuccessfulConnectionCommandDiagnostics(capture.report.commandExecutions);
      const preparation = preparationFromReport(capture.report);
      const binding = requireAndroidConnectionBinding(
        preparation.binding!,
        {
          requestedRunId: options.requestedRunId,
          captureRunId: path.basename(capture.artifactRoot),
          backendRunId:
            typeof fixture.runId === 'string' ? fixture.runId : (finalBinding?.backendRunId ?? ''),
        },
        current,
      );
      assert.equal(binding, finalBinding, 'Connection binding changed after callback completion');
      const assertionEvidence = await prepareAndroidConnectionPilotEvidence({
        repositoryRoot: root,
        artifactRoot: capture.artifactRoot,
        selection: current,
        requestedRunId: options.requestedRunId,
      });
      assert.equal(assertionEvidence.fixtureRunId, binding.backendRunId);
      assert.equal(assertionEvidence.attemptId, binding.backendAttemptId);
      assert.equal(assertionEvidence.nativePassingCases, 0);
      assertionBindings = assertionEvidence.bindings;
      verificationResult = 'passed';
    } catch (error) {
      verificationResult = 'failed';
      verificationFailure =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: 'UnknownError', message: 'Android connection evidence verification rejected' };
      postCaptureFailureRecord ??= postCaptureFailure('verification', error);
    }
  }

  const commandDiagnostics = (
    Array.isArray(capture.report.commandExecutions) ? capture.report.commandExecutions : []
  ).map(normalizeNativeCommandDiagnostic);
  const outcomeWithoutRoot: Omit<AndroidConnectionAttemptResult, 'artifactRoot'> = {
    kind: 'private-owned-android-connection-attempt-not-public-receipt',
    requestedRunId: options.requestedRunId,
    requestedAttemptId: finalBinding?.requestedAttemptId ?? `${options.requestedRunId}:first`,
    captureRunId: path.basename(capture.artifactRoot),
    backendRunId:
      finalBinding?.backendRunId ?? (typeof fixture.runId === 'string' ? fixture.runId : null),
    backendAttemptId: finalBinding?.backendAttemptId ?? null,
    captureExitCode: capture.exitCode,
    childExitCode: terminal.childExitCode,
    childSignal: terminal.childSignal,
    childClassification: terminal.childClassification,
    captureResult: terminal.captureResult,
    captureCleanup: terminal.captureCleanup,
    captureTimeout: terminal.captureTimeout,
    cancellation: terminal.cancellation,
    callbackInvocations,
    callbackCompleted,
    externalCleanupResult,
    verificationResult,
    applicationFailure: null,
    applicationFailureCandidate: null,
    verificationFailure,
    postCaptureFailure: postCaptureFailureRecord,
    deadline: captureDeadline(capture.report.deadline),
    commandDiagnostics,
    censusFailures: terminal.censusFailures,
    outputFailures: terminal.outputFailures,
    assertionBindings,
    fixtureRunId: typeof fixture.runId === 'string' ? fixture.runId : null,
    fixtureHash: typeof capture.report.fixtureHash === 'string' ? capture.report.fixtureHash : null,
    flagsHash: typeof build.environmentHash === 'string' ? build.environmentHash : null,
    toolVersions: isRecord(capture.report.toolVersions)
      ? (capture.report.toolVersions as Record<string, string>)
      : {},
    timingsMs: {
      build: typeof captureTimings.build === 'number' ? captureTimings.build : 0,
      install: typeof captureTimings.install === 'number' ? captureTimings.install : 0,
      reset: typeof captureTimings.reset === 'number' ? captureTimings.reset : 0,
      scenario: typeof captureTimings.scenario === 'number' ? captureTimings.scenario : 0,
      verify:
        (typeof captureTimings.verify === 'number' ? captureTimings.verify : 0) +
        performance.now() -
        verifyStarted,
      cleanup:
        (typeof captureTimings.cleanup === 'number' ? captureTimings.cleanup : 0) + cleanupMs,
    },
    nativePassingCases: 0,
  };
  const outcome = { ...outcomeWithoutRoot, artifactRoot: capture.artifactRoot };
  try {
    await writeFile(
      path.join(capture.artifactRoot, 'runtime-adapter.private.json'),
      JSON.stringify(outcomeWithoutRoot, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    outcome.postCaptureFailure ??= postCaptureFailure('adapter-write', error);
  }
  return outcome;
}

export { normalizeNativeCommandDiagnostic };
