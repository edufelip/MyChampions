import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createCurrentDetoxIosCameraOwner } from './native-detox-camera-ios-current-owner';
import {
  IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS,
  readOwnedIosDetoxCameraRunnerInputs,
  type IosDetoxCameraRunnerInputPaths,
} from './native-detox-camera-ios-inputs';
import {
  runOwnedDetoxIosCameraAttempt,
  type DetoxCameraRuntimeFacts,
  type DetoxCameraOwnerResult,
} from './native-detox-camera-ios-owner';
import {
  requireDetoxCameraRemoteServiceOwnerConfig,
  type DetoxCameraRemoteServiceOwnerConfig,
} from './native-detox-camera-ios-remote-service-route';
import {
  loadIosDetoxQualifiedBuild,
  type DetoxRuntimeQualifiedBuild,
} from './native-detox-connection-public-dispatch';
import { nativePilotDefaultOutputParent } from './native-pilot-invocation';
import type { NativePilotSelection } from './native-pilot-contract';

export const IOS_DETOX_CAMERA_PUBLIC_DISPATCH = 'ios-detox-camera' as const;

export function expectedIosDetoxCameraArtifactRoot(
  repositoryRoot: string,
  requestedRunId: string,
): string {
  return path.join(
    nativePilotDefaultOutputParent(path.resolve(repositoryRoot), {
      platform: 'ios',
      engine: 'detox',
      scenario: 'SCN-camera-denied-ios',
      mode: 'integration',
    }),
    requestedRunId,
  );
}

export function requireIosDetoxCameraArtifactRoot(input: {
  repositoryRoot: string;
  artifactRoot: string;
  requestedRunId: string;
}): void {
  assert.equal(
    path.resolve(input.artifactRoot),
    expectedIosDetoxCameraArtifactRoot(input.repositoryRoot, input.requestedRunId),
    'iOS Detox camera owner must use the canonical native-pilot cleanup namespace',
  );
}

export type DetoxCameraAssertionBinding = Readonly<{
  id: string;
  requirementRefs: string[];
  evidencePaths: string[];
}>;

export type CameraDispatchOptions = Readonly<{
  repositoryRoot: string;
  serverRoot: string;
  artifactRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
  buildRunId: string;
  reuseBuildSourceRoot?: string;
  parentEnv?: Readonly<Record<string, string | undefined>>;
  /** Qualified helper/xctestrun inputs; owner supplies target/deadline identity. */
  remoteServicePrompt?: DetoxCameraRemoteServiceOwnerConfig;
}>;

export type CameraRuntimeResult = Readonly<{
  kind: 'private-owned-ios-detox-camera-attempt-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  backendRunId: string | null;
  backendAttemptId: string | null;
  captureExitCode: number;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  childClassification:
    'completed' | 'child-failed' | 'deadline' | 'cancelled' | 'harness-blocked' | null;
  captureResult: string;
  captureCleanup: 'not-acquired' | 'cleaned' | 'failed';
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGTERM' | null;
  callbackInvocations: number;
  callbackCompleted: boolean;
  externalCleanupResult: 'passed' | 'failed';
  verificationResult: 'passed' | 'not-executed';
  applicationFailure: null;
  applicationFailureCandidate: null;
  verificationFailure: { name: string; message: string } | null;
  postCaptureFailure: null;
  deadline: { step: string; deadlineMs: number } | null;
  commandDiagnostics: unknown[];
  censusFailures: unknown[];
  outputFailures: unknown[];
  assertionBindings: readonly DetoxCameraAssertionBinding[];
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
  runtimeFacts: DetoxCameraRuntimeFacts | null;
  nativePassingCases: 0;
  artifactRoot: string;
  publicFinalization: null;
  publicFinalizationInput: null;
  publicDependency: null;
  captureInvocation: { count: number; returned: boolean };
  captureCompleted: boolean;
  censusFailureCount: number;
  staged: null;
  faultAttemptId: null;
  target: {
    deviceId: string | null;
    osVersion: string | null;
    appId: string | null;
    buildProfile: string | null;
    binaryHash: string | null;
    apiOrigin: string | null;
  };
  detoxCameraResult: DetoxCameraOwnerResult;
  publicPromotionEligible: false;
}>;

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadQualifiedBuild(
  input: CameraDispatchOptions,
): Promise<DetoxRuntimeQualifiedBuild> {
  return loadIosDetoxQualifiedBuild({
    repositoryRoot: input.repositoryRoot,
    buildRunId: input.buildRunId,
    reuseBuildSourceRoot: input.reuseBuildSourceRoot,
    signal: input.signal,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    now: () => performance.now(),
  });
}

export function requireCameraSelection(input: CameraDispatchOptions): void {
  assert.deepEqual(input.selection.arguments, {
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-camera-denied-ios',
    mode: 'integration',
  });
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.match(input.buildRunId, /^[a-f0-9]{24}$/);
  assert(input.signal instanceof AbortSignal);
  const now = performance.now();
  assert(Number.isFinite(input.deadlineAtMonotonicMs));
  assert(
    input.deadlineAtMonotonicMs > now,
    'Detox camera absolute deadline must remain in the future',
  );
}

function projection(
  input: CameraDispatchOptions,
  build: DetoxRuntimeQualifiedBuild,
  result: DetoxCameraOwnerResult,
  buildElapsedMs: number,
): CameraRuntimeResult {
  const report = result.report;
  const error = result.error;
  const owner = report?.owner;
  const cleanup = result.cleanup;
  const privateVerified = Boolean(
    report &&
    !error &&
    result.runtimeFacts?.childClassification === 'completed' &&
    result.runtimeFacts.childExitCode === 0 &&
    result.runtimeFacts.childSignal === null &&
    result.terminal?.result === 'verified-private' &&
    result.stage?.assertionIds.length === 4 &&
    cleanup.captureCleanup === 'cleaned' &&
    cleanup.independentCleanup === 'cleaned' &&
    cleanup.terminal === 'complete',
  );
  const runtimeFacts = result.runtimeFacts;
  const target = {
    deviceId: owner?.target.deviceId ?? null,
    osVersion: owner?.target.osVersion ?? null,
    appId: owner?.build.appIdentifier ?? build.appIdentifier ?? null,
    buildProfile: owner?.build.configuration ?? build.configuration ?? null,
    binaryHash: owner?.build.binarySha256 ?? build.binaryHash ?? null,
    apiOrigin: owner?.backend.apiOrigin ?? build.embeddedRuntime?.apiOrigin ?? null,
  };
  const failure = error ? { name: 'DetoxCameraOwnerError', message: error.message } : null;
  const elapsed = Math.max(1, runtimeFacts?.timingsMs.scenario ?? 0);
  const inventoryAssertions = new Map(
    (input.selection.scenario.pilotAssertions ?? []).map((assertion) => [assertion.id, assertion]),
  );
  const assertionBindings: DetoxCameraAssertionBinding[] = result.stage
    ? result.stage.assertionIds.map((id) => ({
        id,
        requirementRefs: [...(inventoryAssertions.get(id)?.requirementRefs ?? [])],
        evidencePaths: [...(result.stage?.evidence[id] ?? [])],
      }))
    : [];
  return {
    kind: 'private-owned-ios-detox-camera-attempt-not-public-receipt',
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRunId: path.basename(input.artifactRoot),
    backendRunId: owner?.backend.runId ?? null,
    backendAttemptId: owner?.backend.apiAttemptId ?? null,
    captureExitCode: privateVerified ? 0 : (runtimeFacts?.childExitCode ?? 2),
    childExitCode: runtimeFacts?.childExitCode ?? null,
    childSignal: runtimeFacts?.childSignal ?? null,
    childClassification: error
      ? error.code === 'cancelled'
        ? 'cancelled'
        : error.code === 'deadline'
          ? 'deadline'
          : 'harness-blocked'
      : (runtimeFacts?.childClassification ?? 'harness-blocked'),
    captureResult: privateVerified ? 'observed' : 'blocked',
    captureCleanup:
      cleanup.captureCleanup === 'cleaned'
        ? 'cleaned'
        : cleanup.captureCleanup === 'not-acquired'
          ? 'not-acquired'
          : 'failed',
    captureTimeout: error?.code === 'deadline' ? 'whole-capture' : null,
    cancellation: error?.code === 'cancelled' ? 'SIGTERM' : null,
    callbackInvocations: report ? 1 : 0,
    callbackCompleted: Boolean(report && runtimeFacts?.childClassification === 'completed'),
    externalCleanupResult: cleanup.independentCleanup === 'cleaned' ? 'passed' : 'failed',
    verificationResult: privateVerified ? 'passed' : 'not-executed',
    applicationFailure: null,
    applicationFailureCandidate: null,
    verificationFailure:
      failure ??
      (runtimeFacts && runtimeFacts.childClassification !== 'completed'
        ? {
            name: 'DetoxCameraChildOutcome',
            message: 'Detox camera child did not complete successfully',
          }
        : null),
    postCaptureFailure: null,
    deadline: error?.code === 'deadline' ? { step: 'detox-camera', deadlineMs: elapsed } : null,
    commandDiagnostics: [],
    censusFailures: [],
    outputFailures: [],
    assertionBindings,
    fixtureRunId: owner?.fixture.runId ?? null,
    fixtureHash: owner?.fixture.fixtureHash ?? null,
    flagsHash: runtimeFacts?.flagsHash ?? build.environmentHash ?? null,
    toolVersions: owner?.build.toolchain ? { ...owner.build.toolchain } : {},
    timingsMs: {
      build: buildElapsedMs,
      install: runtimeFacts?.timingsMs.install ?? 0,
      reset: runtimeFacts?.timingsMs.reset ?? 0,
      scenario: elapsed,
      verify: runtimeFacts?.timingsMs.verify ?? 0,
      cleanup: runtimeFacts?.timingsMs.cleanup ?? 0,
    },
    runtimeFacts,
    nativePassingCases: 0,
    artifactRoot: input.artifactRoot,
    publicFinalization: null,
    publicFinalizationInput: null,
    publicDependency: null,
    captureInvocation: { count: report ? 1 : 0, returned: Boolean(report) },
    captureCompleted: Boolean(report && runtimeFacts?.childClassification === 'completed'),
    censusFailureCount: 0,
    staged: null,
    faultAttemptId: null,
    target,
    detoxCameraResult: result,
    publicPromotionEligible: false,
  };
}

export async function runIosDetoxCameraAttemptForPublicDispatch(
  input: CameraDispatchOptions,
): Promise<CameraRuntimeResult> {
  requireCameraSelection(input);
  requireIosDetoxCameraArtifactRoot(input);
  const runnerInputPaths: IosDetoxCameraRunnerInputPaths = {
    detoxBaseConfigPath: path.join(
      input.repositoryRoot,
      IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS.detoxBaseConfigPath,
    ),
    detoxConfigPath: path.join(
      input.repositoryRoot,
      IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS.detoxConfigPath,
    ),
    jestConfigPath: path.join(
      input.repositoryRoot,
      IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS.jestConfigPath,
    ),
    cameraTestPath: path.join(
      input.repositoryRoot,
      IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS.cameraTestPath,
    ),
    childSourcePath: path.join(
      input.repositoryRoot,
      IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS.childSourcePath,
    ),
    ipcSourcePath: path.join(
      input.repositoryRoot,
      IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS.ipcSourcePath,
    ),
  };
  const runnerInputs = await readOwnedIosDetoxCameraRunnerInputs({
    repositoryRoot: input.repositoryRoot,
    paths: runnerInputPaths,
    signal: input.signal,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
  });
  const buildStarted = performance.now();
  const build = await loadQualifiedBuild(input);
  const buildElapsedMs = performance.now() - buildStarted;
  const declaration = await readFile(
    path.join(input.repositoryRoot, 'docs/qa/native-pilot/inventory.json'),
  );
  const owner = createCurrentDetoxIosCameraOwner({
    currentRoot: input.repositoryRoot,
    repositoryRoot: input.repositoryRoot,
    serverRoot: input.serverRoot,
    artifactRoot: input.artifactRoot,
    stageRoot: path.join(input.artifactRoot, 'detox-camera-stage'),
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    deadlineAt: Date.now() + Math.max(1, input.deadlineAtMonotonicMs - performance.now()),
    buildElapsedMs,
    signal: input.signal,
    build,
    configuration: build.configuration,
    detoxBaseConfigPath: runnerInputPaths.detoxBaseConfigPath,
    detoxConfigPath: runnerInputPaths.detoxConfigPath,
    jestConfigPath: runnerInputPaths.jestConfigPath,
    cameraTestPath: runnerInputPaths.cameraTestPath,
    childSourcePath: runnerInputPaths.childSourcePath,
    childSourceSha256: runnerInputs.files.childSourcePath.sha256,
    helperInputsHash: build.helperInputsHash,
    declarationHash: hashBytes(declaration),
    parentEnv: input.parentEnv,
    remoteServicePrompt:
      input.remoteServicePrompt ??
      requireDetoxCameraRemoteServiceOwnerConfig({
        environment: input.parentEnv ?? process.env,
        artifactRoot: input.artifactRoot,
        reviewedSourceRoot: input.repositoryRoot,
      }),
  });
  const result = await runOwnedDetoxIosCameraAttempt(owner);
  return projection(input, build, result, buildElapsedMs);
}
