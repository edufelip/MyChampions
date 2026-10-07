import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  runOwnedDetoxConnectionAttempt,
  type DetoxConnectionDriverOptions,
} from './detox-integrated-connection-driver';
import {
  requireDetoxBuildInstrumentation,
  type DetoxBaselineBuildInstrumentation,
} from './detox-integrated-session-baseline';
import {
  nativeConnectionAssertionIds,
  requireNativePilotAssertions,
  type NativePilotSelection,
} from './native-pilot-contract';
import type { DetoxConnectionAttemptResult } from './detox-integrated-connection-baseline';

const runIdPattern = /^[a-f0-9]{24}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const gitShaPattern = /^[a-f0-9]{40}$/;

export const DETOX_IOS_CONNECTION_PUBLIC_OWNER = 'detox-driver' as const;

export type DetoxIosConnectionPublicBridgeInput = Readonly<{
  owner: typeof DETOX_IOS_CONNECTION_PUBLIC_OWNER;
  repositoryRoot: string;
  serverRoot: string;
  artifactRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  build: DetoxBaselineBuildInstrumentation;
  runnerPaths: Readonly<{
    jestConfigPath: string;
    testPath: string;
  }>;
  signal: AbortSignal;
  deadlineMs: number;
  /** Aggregate caller deadline; omitted only by legacy resource-free controls. */
  deadlineAtMonotonicMs?: number;
  parentEnv?: Readonly<Record<string, string | undefined>>;
  /**
   * Resource-free source-test seam. Production callers omit it so the
   * existing runOwnedDetoxConnectionAttempt remains the sole owner.
   */
  delegate?: DetoxIosConnectionDriverDelegate;
  /** Resource-free build-shape seam. Production uses the canonical guard. */
  validateBuild?: (
    build: DetoxBaselineBuildInstrumentation,
    repositoryRoot: string,
  ) => void | Promise<void>;
}>;

export type DetoxIosConnectionDriverDelegate = (
  options: DetoxConnectionDriverOptions,
) => Promise<DetoxConnectionAttemptResult>;

export type DetoxIosConnectionPublicBridgeResult = Readonly<{
  kind: 'private-detox-ios-connection-public-bridge-result-not-public-receipt';
  owner: typeof DETOX_IOS_CONNECTION_PUBLIC_OWNER;
  engine: 'detox';
  platform: 'ios';
  requestedRunId: string;
  requestedAttemptId: string;
  selection: Readonly<{
    arguments: NativePilotSelection['arguments'];
    scenarioId: string;
    scenarioHash: string;
    requirementHash: string;
    assertionIds: readonly string[];
  }>;
  declaredBuildIdentity: Readonly<{
    sourceTreeHash: string;
    helperInputsHash: string;
    binaryHash: string;
    detoxConfigHash: string;
  }>;
  attempt: DetoxConnectionAttemptResult;
  nativePassingCases: 0;
  publicPromotionEligible: false;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && hashPattern.test(value), `${label} must be a SHA-256 hash`);
}

function requireRunId(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' && runIdPattern.test(value),
    `${label} must be a 24-character run ID`,
  );
}

function requireIosDetoxSelection(selection: NativePilotSelection): void {
  assert.deepEqual(selection.arguments, {
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-connection-ios',
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, 'SCN-connection-ios');
  assert.equal(selection.scenario.platform, 'ios');
  assert.equal(selection.scenario.flowId, 'FLW-connection');
  assert.equal(selection.scenario.dataMode, 'postgres');
  assert.equal(selection.scenario.fixtureRef, 'owned-postgres:SCN-connection-ios:fresh-attempt');
  assert(
    selection.scenario.engine === undefined || selection.scenario.engine === 'detox',
    'Detox selection is bound to an engine-neutral or Detox scenario declaration',
  );
  const rows = requireNativePilotAssertions(selection);
  assert.deepEqual(
    rows.map((row) => row.id),
    [...nativeConnectionAssertionIds],
    'Detox connection assertion order differs from the shared contract',
  );
  requireHash(selection.scenarioHash, 'Detox scenario hash');
  requireHash(selection.requirementHash, 'Detox requirement hash');
}

function requireBuildBridgeShape(
  build: DetoxBaselineBuildInstrumentation,
  repositoryRoot: string,
): void {
  requireDetoxBuildInstrumentation(build, repositoryRoot);
  assert.equal(build.platform, 'ios');
  assert.equal(build.configuration, 'ios.sim.debug');
  assert.equal(build.testBinaryPath, null);
  assert.equal(build.testBinaryHash, null);
  assert.match(build.source.sha, gitShaPattern);
  requireHash(build.source.sourceTreeHash, 'Detox source tree hash');
  requireHash(build.helperInputsHash, 'Detox helper input hash');
  requireHash(build.binaryHash, 'Detox binary hash');
  requireHash(build.detoxConfigHash, 'Detox config hash');
  requireHash(build.embeddedRuntime.configSourceHash, 'Detox runtime config hash');
  assert.equal(
    build.appIdentifier,
    'com.edufelip.mychampions.dev',
    'Detox build app identifier differs from the dev app',
  );
}

function requireBridgePaths(input: DetoxIosConnectionPublicBridgeInput): {
  repositoryRoot: string;
  serverRoot: string;
  artifactRoot: string;
  runnerPaths: DetoxIosConnectionPublicBridgeInput['runnerPaths'];
} {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const serverRoot = path.resolve(input.serverRoot);
  const artifactRoot = path.resolve(input.artifactRoot);
  requireRunId(input.requestedRunId, 'Detox requested run ID');
  assert.equal(
    input.requestedAttemptId,
    `${input.requestedRunId}:first`,
    'Detox public bridge only accepts the original first attempt',
  );
  assert.equal(
    input.owner,
    DETOX_IOS_CONNECTION_PUBLIC_OWNER,
    'Detox bridge owner token differs from the single-owner contract',
  );
  assert.notEqual(repositoryRoot, serverRoot, 'Detox repository and server roots must be distinct');
  assert.equal(
    artifactRoot,
    path.join(repositoryRoot, '.qa/artifacts/native-pilot-attempts', input.requestedRunId),
    'Detox artifact root is outside the public runner attempt namespace',
  );
  assert(input.signal instanceof AbortSignal, 'Detox public bridge signal is invalid');
  assert(
    Number.isSafeInteger(input.deadlineMs) &&
      input.deadlineMs >= 30_000 &&
      input.deadlineMs <= 600_000,
    'Detox public bridge deadline is outside the owned driver range',
  );
  if (input.deadlineAtMonotonicMs !== undefined) {
    assert(
      Number.isFinite(input.deadlineAtMonotonicMs) &&
        input.deadlineAtMonotonicMs > performance.now(),
      'Detox public bridge absolute deadline is invalid or elapsed',
    );
  }
  const runnerPaths = {
    jestConfigPath: path.resolve(input.runnerPaths.jestConfigPath),
    testPath: path.resolve(input.runnerPaths.testPath),
  };
  assert.equal(
    runnerPaths.jestConfigPath,
    path.join(repositoryRoot, 'e2e/jest.detox-integrated-connection-baseline.config.js'),
    'Detox Jest config is outside the checked-in connection runner',
  );
  assert.equal(
    runnerPaths.testPath,
    path.join(repositoryRoot, 'e2e/detox-integrated-connection-baseline.e2e.test.js'),
    'Detox test path is outside the checked-in connection runner',
  );
  return { repositoryRoot, serverRoot, artifactRoot, runnerPaths };
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function requireLoopbackOrigin(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(value),
    `${label} must be an owned loopback origin`,
  );
}

function requireOwnedReportBindings(
  report: Record<string, unknown>,
  input: DetoxIosConnectionPublicBridgeInput,
): void {
  // The embedded runtime talks to the owned in-process proxy. The report's
  // backend/API identity is the separate upstream server process. The driver
  // binds the proxy origin before acquisition; this boundary preserves and
  // rejects a report that collapses the two origins.
  const proxyOrigin = input.build.embeddedRuntime.apiOrigin;
  requireLoopbackOrigin(proxyOrigin, 'Qualified Detox proxy origin');
  const apiIdentity = record(report.connectionApiIdentity, 'Detox API identity');
  const backend = record(report.backend, 'Detox backend identity');
  requireLoopbackOrigin(apiIdentity.targetOrigin, 'Detox backend API origin');
  requireLoopbackOrigin(backend.apiOrigin, 'Detox backend origin');
  assert.notEqual(
    apiIdentity.targetOrigin,
    proxyOrigin,
    'Detox backend API origin must remain distinct from the owned proxy origin',
  );
  assert.notEqual(
    backend.apiOrigin,
    proxyOrigin,
    'Detox backend origin must remain distinct from the owned proxy origin',
  );
  assert.equal(
    apiIdentity.targetOrigin,
    backend.apiOrigin,
    'Detox connection API identity differs from the backend identity',
  );
  assert(
    Number.isSafeInteger(apiIdentity.apiPid) && Number(apiIdentity.apiPid) > 1,
    'Detox report API PID is invalid',
  );
  assert(
    Number.isSafeInteger(backend.apiPid) && Number(backend.apiPid) > 1,
    'Detox backend PID is invalid',
  );
  assert.equal(
    backend.apiPid,
    apiIdentity.apiPid,
    'Detox backend PID differs from the API identity',
  );
  requireRunId(backend.runId, 'Detox backend run ID');
  assert(
    typeof backend.manifestArtifactRoot === 'string' && backend.manifestArtifactRoot.length > 0,
    'Detox backend manifest artifact root is missing',
  );
  const child = record(report.detoxChildIdentity, 'Detox child identity');
  assert(Number.isSafeInteger(child.pid) && Number(child.pid) > 1, 'Detox child PID is invalid');
  assert(Number.isSafeInteger(child.pgid) && Number(child.pgid) > 1, 'Detox child PGID is invalid');
  assert(typeof child.started === 'string' && child.started.length > 0);
  const producer = record(report.detoxProducerReceipt, 'Detox producer receipt');
  assert.deepEqual(producer.childIdentity, child, 'Detox producer child receipt changed');
  assert.equal(producer.captureRunId, input.requestedRunId);
  assert.equal(producer.platform, 'ios');
  const transportSource = report.detoxTransportSource;
  assert(
    Array.isArray(transportSource) && transportSource.length > 0,
    'Detox transport source receipt is missing',
  );
  const transportHash = hashJson(transportSource);
  assert.equal(report.detoxTransportSourceHash, transportHash);
  const sourceReceipt = record(
    report.detoxTransportSourceReceipt,
    'Detox transport source receipt',
  );
  assert.equal(sourceReceipt.path, 'detox-connection-transport-source.private.json');
  assert.equal(sourceReceipt.sourceBytes, Buffer.byteLength(JSON.stringify(transportSource)));
  assert.equal(sourceReceipt.sourceSha256, transportHash);
}

function requireAttemptResult(
  attempt: DetoxConnectionAttemptResult,
  input: DetoxIosConnectionPublicBridgeInput,
  paths: ReturnType<typeof requireBridgePaths>,
): void {
  assert.equal(
    attempt.kind,
    'private-detox-connection-attempt-not-public-receipt',
    'Detox bridge rejected a non-Detox or Maestro-shaped result',
  );
  assert(
    ['source-only', 'blocked', 'cancelled', 'deadline'].includes(attempt.status),
    'Detox attempt status is outside the private result contract',
  );
  assert(
    ['not-acquired', 'cleaned', 'failed'].includes(attempt.cleanup),
    'Detox attempt cleanup status is outside the private result contract',
  );
  assert.equal(attempt.selectionValid, true, 'Detox attempt did not retain a valid selection');
  assert.equal(attempt.nativePassingCases, 0);
  assert.equal(attempt.publicPromotionEligible, false);
  if (attempt.acquired) {
    assert.notEqual(
      attempt.cleanup,
      'not-acquired',
      'An acquired Detox attempt cannot report not-acquired cleanup',
    );
  }
  if (attempt.status === 'source-only' && attempt.cleanup === 'failed')
    throw new Error('Detox source-only result cannot hide a failed cleanup');
  if (attempt.cleanup === 'failed')
    assert.notEqual(
      attempt.recoveryStatus,
      'verified',
      'Failed Detox cleanup cannot report verified recovery',
    );
  if (attempt.recoveryStatus === 'not-verified')
    assert.equal(attempt.cleanup, 'failed', 'Unverified Detox recovery must fail closed');
  if (input.signal.aborted)
    assert(
      attempt.status === 'cancelled' || attempt.status === 'deadline',
      'Detox delegate completed after cancellation without a cancelled/deadline result',
    );
  const eligibleSourceOnly =
    attempt.status === 'source-only' &&
    attempt.acquired &&
    attempt.cleanup === 'cleaned' &&
    attempt.recoveryStatus === 'verified';
  if (attempt.status === 'source-only') {
    assert(eligibleSourceOnly, 'Detox source-only result is not an eligible completed attempt');
    assert(attempt.report !== null, 'Eligible Detox source-only attempt must retain its report');
  }
  if (attempt.report === null) return;
  const report = record(attempt.report, 'Detox producer report');
  assert.equal(
    report.output,
    paths.artifactRoot,
    'Detox report output is not the owned artifact root',
  );
  assert.deepEqual(report.selection, input.selection, 'Detox report selection identity changed');
  // Blocked, cancelled, deadline, or failed-cleanup attempts may stop before
  // child/bootstrap/journey evidence exists. Keep their report and cleanup
  // identity without demanding the success-only producer fields.
  if (!eligibleSourceOnly) return;
  requireOwnedReportBindings(report, input);
  const receipt = record(report.detoxProducerReceipt, 'Detox producer receipt');
  assert.equal(
    receipt.kind,
    'private-detox-connection-producer-receipt',
    'Detox report is missing the owned producer receipt kind',
  );
  assert.equal(receipt.captureRunId, input.requestedRunId);
  assert.equal(receipt.platform, 'ios');
  requireHash(receipt.sourceTreeHash, 'Detox producer source tree hash');
  requireHash(receipt.helperInputsHash, 'Detox producer helper input hash');
  assert.equal(
    receipt.sourceTreeHash,
    input.build.source.sourceTreeHash,
    'Detox producer source tree hash differs from the qualified build',
  );
  assert.equal(
    receipt.helperInputsHash,
    input.build.helperInputsHash,
    'Detox producer helper hash differs from the qualified build',
  );
}

const defaultDelegate: DetoxIosConnectionDriverDelegate = (options) =>
  runOwnedDetoxConnectionAttempt(options);

export async function delegateIosDetoxConnectionAsSingleOwner(
  input: DetoxIosConnectionPublicBridgeInput,
): Promise<DetoxIosConnectionPublicBridgeResult> {
  const paths = requireBridgePaths(input);
  requireIosDetoxSelection(input.selection);
  const validateBuild = input.validateBuild ?? requireBuildBridgeShape;
  await validateBuild(input.build, paths.repositoryRoot);
  input.signal.throwIfAborted();
  const delegate = input.delegate ?? defaultDelegate;
  const attempt = await delegate({
    repositoryRoot: paths.repositoryRoot,
    serverRoot: paths.serverRoot,
    artifactRoot: paths.artifactRoot,
    selection: input.selection,
    build: input.build,
    configuration: input.build.configuration,
    runnerPaths: paths.runnerPaths,
    parentEnv: input.parentEnv,
    signal: input.signal,
    deadlineMs: input.deadlineMs,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
  });
  requireAttemptResult(attempt, input, paths);
  return Object.freeze({
    kind: 'private-detox-ios-connection-public-bridge-result-not-public-receipt',
    owner: DETOX_IOS_CONNECTION_PUBLIC_OWNER,
    engine: 'detox',
    platform: 'ios',
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    selection: Object.freeze({
      arguments: input.selection.arguments,
      scenarioId: input.selection.scenario.id,
      scenarioHash: input.selection.scenarioHash,
      requirementHash: input.selection.requirementHash,
      assertionIds: [...nativeConnectionAssertionIds],
    }),
    declaredBuildIdentity: Object.freeze({
      sourceTreeHash: input.build.source.sourceTreeHash,
      helperInputsHash: input.build.helperInputsHash,
      binaryHash: input.build.binaryHash,
      detoxConfigHash: input.build.detoxConfigHash,
    }),
    attempt,
    nativePassingCases: 0,
    publicPromotionEligible: false,
  });
}
