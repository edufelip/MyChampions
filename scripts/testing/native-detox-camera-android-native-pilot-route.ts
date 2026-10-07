import assert from 'node:assert/strict';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  runAndroidDetoxCameraPublicAttempt,
  type AndroidDetoxCameraPublicResult,
  type AndroidDetoxCameraSessionRunner,
} from './native-detox-camera-android-public-dispatch';
import {
  finalizeAndroidDetoxCameraNativeRuntime,
  type AndroidDetoxCameraNativeFinalizer,
} from './native-detox-camera-android-public-finalizer';
import {
  loadAndroidDetoxQualifiedBuild,
  type DetoxBaselineBuildInstrumentation,
  type NativePilotSelection,
} from './native-detox-camera-android-q-adapter';
import type {
  AndroidDetoxCameraProducerContext,
  AndroidDetoxCameraProducerReceipts,
} from './native-detox-camera-android-producer';
import type {
  AndroidDetoxCameraResetExpectation,
  AndroidDetoxCameraResetProof,
} from './native-detox-camera-android-reset';

const RUN_ID = /^[a-f0-9]{24}$/u;

export type AndroidDetoxCameraNativePilotAttempt = Readonly<{
  kind: 'android-detox-camera';
  requestedRunId: string;
  requestedAttemptId: string;
  deadlineAtMonotonicMs: number;
  captureRunId: string | null;
  targetOwnerRunId: string | null;
  fixtureRunId: string | null;
  backendRunId: string | null;
  backendAttemptId: string | null;
  captureExitCode: number;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  childClassification:
    | 'completed'
    | 'child-failed'
    | 'harness-blocked'
    | 'cancelled'
    | 'deadline'
    | 'output-limit'
    | 'output-failed';
  captureResult: 'observed' | 'harness-blocked' | 'cancelled';
  captureCleanup: 'not-acquired' | 'cleaned' | 'failed-recovery-retained';
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGTERM' | null;
  callbackInvocations: number;
  callbackCompleted: boolean;
  captureInvocation: { count: number; returned: boolean };
  captureCompleted: boolean;
  externalCleanupResult: 'passed' | 'failed';
  verificationResult: 'source-only' | 'verified-native' | 'blocked' | 'not-executed';
  verificationFailure: { name: string; message: string } | null;
  postCaptureFailure: {
    phase: 'verification' | 'cleanup' | 'adapter-write';
    name: string;
    message: string;
  } | null;
  deadline: { step: string; deadlineMs: number } | null;
  commandDiagnostics: readonly unknown[];
  censusFailures: readonly unknown[];
  outputFailures: readonly unknown[];
  assertionBindings: readonly {
    id: string;
    requirementRefs: readonly string[];
    evidencePaths: readonly string[];
  }[];
  assertionContractSha256: string | null;
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
  nativePassingCases: 0 | 4;
  publicPassingCases: 0 | 4;
  publicPromotionEligible: boolean;
  artifactRoot: string;
  buildIdentity: Readonly<{
    sourceTreeHash: string;
    helperInputsHash: string;
    binaryHash: string;
    testBinaryHash: string | null;
    detoxConfigHash: string;
    appId: string;
    buildProfile: string;
    apiOrigin: string;
    environmentHash: string | null;
    toolVersions: Readonly<Record<string, string>>;
  }>;
  cameraProducer: AndroidDetoxCameraPublicResult['producer'];
  cameraStage: AndroidDetoxCameraPublicResult['stage'];
  nativeFinalization: AndroidDetoxCameraPublicResult['nativeFinalization'];
  cleanup: AndroidDetoxCameraPublicResult['cleanup'];
  target: AndroidDetoxCameraPublicResult['target'];
  coldReset?: AndroidDetoxCameraResetProof | null;
}>;

function requireRunId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
}

function projectResult(
  result: AndroidDetoxCameraPublicResult,
  artifactRoot: string,
  build: DetoxBaselineBuildInstrumentation,
  selection: NativePilotSelection,
  deadlineAtMonotonicMs: number,
): AndroidDetoxCameraNativePilotAttempt {
  const completed =
    (result.status === 'source-only' || result.status === 'verified-native') &&
    result.cleanup.status === 'cleaned';
  const cancelled = result.status === 'cancelled';
  const failure = result.failure;
  return {
    kind: result.dispatch,
    requestedRunId: result.requestedRunId,
    requestedAttemptId: result.requestedAttemptId,
    deadlineAtMonotonicMs,
    captureRunId: result.captureRunId,
    targetOwnerRunId: result.targetOwnerRunId,
    fixtureRunId: result.fixtureRunId,
    backendRunId: result.producer?.backendRunId ?? null,
    backendAttemptId: result.runtime.backendAttemptId,
    captureExitCode: result.runtime.captureExitCode,
    childExitCode: result.runtime.childExitCode,
    childSignal: result.runtime.childSignal,
    childClassification:
      result.runtime.childClassification ?? (cancelled ? 'cancelled' : 'harness-blocked'),
    captureResult: result.runtime.captureResult,
    captureCleanup:
      result.cleanup.status === 'cleaned'
        ? 'cleaned'
        : result.cleanup.status === 'not-acquired'
          ? 'not-acquired'
          : 'failed-recovery-retained',
    captureTimeout: result.runtime.captureTimeout,
    cancellation: result.runtime.cancellation,
    callbackInvocations: result.runtime.callbackInvocations,
    callbackCompleted: result.runtime.callbackCompleted,
    captureInvocation: result.runtime.captureInvocation,
    captureCompleted: result.runtime.captureCompleted,
    externalCleanupResult: result.runtime.externalCleanupResult,
    verificationResult:
      result.runtime.verificationResult === 'passed'
        ? completed
          ? result.status === 'verified-native'
            ? 'verified-native'
            : 'source-only'
          : 'blocked'
        : result.runtime.verificationResult,
    verificationFailure: result.runtime.verificationFailure ?? failure,
    postCaptureFailure: result.runtime.postCaptureFailure,
    deadline: result.runtime.deadline,
    commandDiagnostics: result.runtime.commandDiagnostics,
    censusFailures: result.runtime.censusFailures,
    outputFailures: result.runtime.outputFailures,
    assertionBindings: result.assertionBindings.map((binding) => ({
      id: binding.id,
      requirementRefs: [],
      evidencePaths: [...binding.evidencePaths],
    })),
    assertionContractSha256: selection.scenario.pilotAssertionContract?.sha256 ?? null,
    fixtureHash: result.runtime.fixtureHash,
    flagsHash: result.runtime.flagsHash,
    toolVersions: { ...result.runtime.toolVersions },
    timingsMs: {
      ...result.runtime.timingsMs,
      build: result.runtime.timingsMs.build,
    },
    nativePassingCases: result.nativePassingCases,
    publicPassingCases: result.publicPassingCases,
    publicPromotionEligible: result.publicPromotionEligible,
    artifactRoot,
    cameraProducer: result.producer,
    cameraStage: result.stage,
    nativeFinalization: result.nativeFinalization,
    cleanup: result.cleanup,
    target: result.target,
    coldReset: result.coldReset ?? null,
    // Preserve the qualified descriptor identity for the terminal to compare
    // against the original producer, rather than allowing a placeholder build.
    buildIdentity: {
      sourceTreeHash: build.source.sourceTreeHash,
      helperInputsHash: build.helperInputsHash,
      binaryHash: build.binaryHash,
      testBinaryHash: build.testBinaryHash,
      detoxConfigHash: build.detoxConfigHash,
      appId: build.embeddedRuntime.appIdentifier || build.appIdentifier,
      buildProfile: build.configuration,
      apiOrigin: build.embeddedRuntime.apiOrigin,
      environmentHash: build.environmentHash ?? null,
      toolVersions: { ...(build.toolVersions ?? {}) },
    },
  } as AndroidDetoxCameraNativePilotAttempt;
}

export function isAndroidDetoxCameraPublicArguments(
  args: NativePilotSelection['arguments'],
): boolean {
  return (
    args.platform === 'android' &&
    args.engine === 'detox' &&
    args.scenario === 'SCN-camera-denied-android' &&
    args.mode === 'integration'
  );
}

export async function runAndroidDetoxCameraAttemptForNativePilot(
  input: Readonly<{
    repositoryRoot: string;
    serverRoot: string;
    artifactRoot: string;
    requestedRunId: string;
    captureRunId?: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    signal: AbortSignal;
    deadlineAt: number;
    parentEnv?: Readonly<Record<string, string | undefined>>;
    expectedLocale?: 'en-US' | 'pt-BR' | 'es-ES';
    loadBuild?: typeof loadAndroidDetoxQualifiedBuild;
    sessionRunner?: AndroidDetoxCameraSessionRunner | null;
    producerRunner?: (
      context: AndroidDetoxCameraProducerContext,
    ) => Promise<AndroidDetoxCameraProducerReceipts>;
    nativeFinalizer?: AndroidDetoxCameraNativeFinalizer;
    coldReset?: AndroidDetoxCameraResetExpectation;
    coldResetBinding?: unknown;
  }>,
): Promise<AndroidDetoxCameraNativePilotAttempt> {
  requireRunId(input.requestedRunId, 'Android Detox camera run ID');
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  assert(isAndroidDetoxCameraPublicArguments(input.selection.arguments));
  input.signal.throwIfAborted();
  assert(performance.now() < input.deadlineAt, 'Android Detox camera deadline expired');
  const buildRunId = input.parentEnv?.MYCHAMPIONS_NATIVE_ANDROID_DETOX_BUILD_RUN_ID;
  requireRunId(buildRunId, 'Android Detox camera qualified build run ID');
  const build = await (input.loadBuild ?? loadAndroidDetoxQualifiedBuild)({
    repositoryRoot: input.repositoryRoot,
    buildRunId,
    signal: input.signal,
    deadlineAtMonotonicMs: input.deadlineAt,
  });
  // Injected runners are source controls only. They are useful for proving
  // ordering and failure semantics, but they cannot earn native/public credit
  // through the canonical terminal. The production route reaches this point
  // with the default owner and producer; only that path receives the native
  // receipt finalizer.
  const sourceControlOnly = input.sessionRunner !== undefined || input.producerRunner !== undefined;
  const result = await runAndroidDetoxCameraPublicAttempt({
    repositoryRoot: input.repositoryRoot,
    serverRoot: input.serverRoot,
    artifactRoot: input.artifactRoot,
    build,
    runnerPaths: {
      jestConfigPath: path.join(
        input.repositoryRoot,
        'e2e/jest.detox-integrated-connection-baseline.config.js',
      ),
      testPath: path.join(input.repositoryRoot, 'e2e/detox-android-camera-denied.e2e.test.js'),
    },
    parentEnv: {
      ...input.parentEnv,
      DETOX_CONNECTION_TEST_PATH: path.join(
        input.repositoryRoot,
        'e2e/detox-android-camera-denied.e2e.test.js',
      ),
    },
    requestedRunId: input.requestedRunId,
    captureRunId: input.captureRunId,
    selection: input.selection,
    expectedLocale: input.expectedLocale ?? 'en-US',
    signal: input.signal,
    deadlineAt: input.deadlineAt,
    nativeFinalizer: sourceControlOnly
      ? undefined
      : (input.nativeFinalizer ?? finalizeAndroidDetoxCameraNativeRuntime),
    sessionRunner: input.sessionRunner,
    producerRunner: input.producerRunner,
    coldReset: input.coldReset,
  });
  return projectResult(
    {
      ...result,
      runtime: result.runtime,
    },
    input.artifactRoot,
    build,
    input.selection,
    input.deadlineAt,
  );
}
