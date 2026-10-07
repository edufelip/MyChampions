import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  requireAndroidConnectionActorIdentity,
  requireAndroidConnectionSignInBoundary,
} from './capture-android-testability';
import {
  requireIosConnectionActorIdentity,
  requireIosConnectionSignInBoundary,
} from './capture-native-testability';
import {
  requireAndroidDetoxConnectionProducer,
  requireAndroidDetoxCleanupResult,
  type AndroidDetoxConnectionProducer,
} from './detox-android-connection-producer';
import { inspectAndroidDetoxBuildArtifacts } from './detox-android-qualified-build';
import {
  ensureDetoxConnectionArtifactRoot,
  readOwnedDetoxConnectionEvidence,
  readDetoxConnectionPath,
  readOwnedDetoxConnectionFile,
  writeAtomicDetoxConnectionBytes,
  type DetoxConnectionEvidenceDirectoryIdentity,
} from './detox-connection-evidence';
import {
  DetoxConnectionIpcClient,
  readOwnedDetoxPrivateFile,
  requireDetoxConnectionCommand,
  requireDetoxConnectionObservation,
  type DetoxConnectionActor as IpcActor,
  type DetoxConnectionActionCleanup,
  type DetoxConnectionCommand,
  type DetoxConnectionOwnedProcessIdentity,
  type DetoxConnectionNavigation as IpcNavigation,
  type DetoxConnectionObservationReceipt,
  type DetoxConnectionPlatform,
  type DetoxConnectionResponse,
} from './detox-connection-ipc';
import { DetoxCleanupRecoveryError, runDetoxCleanupAggregate } from './detox-connection-lifecycle';
import {
  createDetoxConnectionJourneyExecutor,
  requireDetoxConnectionSelection,
  runDetoxIntegratedConnectionBaseline,
  type DetoxConnectionAcquiredSession,
  type DetoxConnectionAttemptResult,
  type DetoxConnectionCleanupReason,
  type DetoxConnectionCleanupResult,
  type DetoxConnectionContextBase,
  type DetoxConnectionFixtureEnvironment,
  type DetoxConnectionLifecycle,
  type DetoxConnectionSessionBinding,
} from './detox-integrated-connection-baseline';
import {
  inspectDetoxBuildInstrumentation,
  ownedDetoxBaselineFactories,
  requireDetoxBuildInstrumentation,
  type DetoxBaselineBuildInstrumentation,
  type DetoxBaselineFactories,
  type DetoxOwnedTarget,
} from './detox-integrated-session-baseline';
import {
  applyDetoxElementAttributeEvidence,
  parseDetoxViewHierarchyXml,
} from './detox-native-hierarchy';
import {
  requireDetoxRuntimeBuildMetadata,
  revalidateDetoxRuntimeBuildMetadata,
  type DetoxRuntimeBuildMetadata,
} from './detox-runtime-build-metadata';
import {
  DetoxSaveRetryChildClient,
  type DetoxSaveRetryTerminalState,
} from './detox-save-retry-child-client';
import {
  createDetoxSaveRetryCleanupFailureTerminal,
  createDetoxSaveRetryOuterFailureTerminal,
  requireDetoxSaveRetrySelection,
  requireFaultIdentity,
  requireFreshDetoxSaveRetrySelection,
  runDetoxSaveRetryOnExistingOwner,
  type DetoxSaveRetryCoachAuthTransition,
} from './detox-save-retry-owned-dispatch';
import { DetoxTrainingChildClient } from './detox-training-child-client';
import {
  requireDetoxTrainingSelection,
  type DetoxTrainingUiBridge,
} from './detox-training-journey';
import {
  observeAndroidConnectionJourney,
  observeIosConnectionJourney,
} from './native-connection-journey';
import {
  requireNativeConnectionTransport,
  type SharedConnectionRuntimeContext,
} from './native-connection-journey-core';
import {
  ANDROID_CONNECTION_PLATFORM,
  CONNECTION_PURPOSE_PLANS,
  IOS_CONNECTION_PLATFORM,
  type ConnectionActor,
  type ConnectionNavigation,
  type ConnectionPlatformProfile,
} from './native-connection-platform-contract';
import { startOwnedNativeCommand } from './owned-native-command';
import type { DetoxConnectionActionRequest } from './detox-connection-actionability';
import type * as DetoxTrainingOwnedDispatch from './detox-training-owned-dispatch';
import type { NativePilotSelection } from './native-pilot-contract';
import type { ProxyObservation, startOwnedApiProxy } from './owned-api-proxy';
import type { OwnedFixtures, startOwnedSession } from './owned-session';

const RUN_ID = /^[a-f0-9]{24}$/;
const MAX_DEADLINE_MS = 600_000;
const CLEANUP_DEADLINE_MS = 30_000;
const CLEANUP_RECOVERY_PUBLICATION_DEADLINE_MS = 5_000;
const IOS_APP_ID = 'com.edufelip.mychampions.dev';
const detoxTrainingOwnedDispatchSpecifier = ['./', 'detox-training-owned-dispatch'].join('/');

async function loadDetoxTrainingOwnedDispatch(): Promise<typeof DetoxTrainingOwnedDispatch> {
  return (await import(detoxTrainingOwnedDispatchSpecifier)) as typeof DetoxTrainingOwnedDispatch;
}

type OwnedSession = Awaited<ReturnType<typeof startOwnedSession>>;
type OwnedProxy = Awaited<ReturnType<typeof startOwnedApiProxy>>;
type OwnedTarget = Awaited<ReturnType<DetoxBaselineFactories['acquireOwnedTarget']>>;
type OwnedReservation = Awaited<ReturnType<DetoxBaselineFactories['reserveOwnedAppPort']>>;
type OwnedChild = Awaited<ReturnType<typeof startOwnedNativeCommand>>;

const DETOX_PRODUCER_TOKEN = Symbol('detox-connection-owned-producer');

type DetoxDriverEvidenceLifecycle = Readonly<{
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
}>;

function evidenceLifecycle(input: DetoxDriverEvidenceLifecycle) {
  return {
    signal: input.signal,
    deadlineAt: input.deadlineAtMonotonicMs,
  };
}

export type DetoxConnectionDriverOptions = Readonly<{
  repositoryRoot: string;
  serverRoot: string;
  artifactRoot: string;
  selection: NativePilotSelection;
  build: DetoxBaselineBuildInstrumentation;
  configuration: DetoxBaselineBuildInstrumentation['configuration'];
  runnerPaths: Readonly<{
    jestConfigPath: string;
    testPath: string;
    saveRetryActionsPath?: string;
  }>;
  parentEnv?: Readonly<Record<string, string | undefined>>;
  signal?: AbortSignal;
  deadlineMs?: number;
  /** Caller-owned aggregate deadline; prevents downstream budget restart. */
  deadlineAtMonotonicMs?: number;
  factories?: DetoxBaselineFactories;
  /** Optional private seam; production keeps the canonical owned command launcher. */
  startOwnedNativeCommand?: typeof startOwnedNativeCommand;
  /** Android must provide the actual owned target and independent cleanup
   * producer before acquisition. A boolean readiness flag is insufficient. */
  androidProducer?: AndroidDetoxConnectionProducer;
  /** Private additive T14-B branch; it reuses the already acquired owner. */
  trainingSelection?: NativePilotSelection;
  /** Private additive T14-E branch; it reuses the already acquired owner. */
  saveRetrySelection?: NativePilotSelection;
}>;

export type DriverReport = Record<string, unknown> & {
  [DETOX_PRODUCER_TOKEN]?: true;
  detoxConnectionObservations?: DetoxConnectionObservationReceipt[];
  observations?: Record<string, unknown>[];
  connectionAccountSwitches?: unknown[];
  connectionInitialAuth?: unknown;
  connectionApiIdentity?: unknown;
  detoxConnectionCommands?: DetoxConnectionCommand[];
  detoxConnectionActionCleanup?: Record<string, DetoxConnectionActionCleanup>;
  detoxChildIdentity?: DetoxConnectionOwnedProcessIdentity;
  detoxProducerReceipt?: DetoxConnectionProducerReceipt;
  detoxTransportSource?: readonly Record<string, unknown>[];
  detoxTransportSourceHash?: string;
  detoxTransportSourceReceipt?: Readonly<{
    path: string;
    sourceBytes: number;
    sourceSha256: string;
  }>;
  /** Producer-measured phase durations consumed by the runtime verifier. */
  detoxRuntimeTimingsMs?: {
    build: number;
    install: number;
    reset: number;
    scenario: number;
    verify: number;
    cleanup: number;
  };
  detoxTraining?: Record<string, unknown>;
  detoxTrainingChildShutdown?: true;
  detoxSaveRetryTerminal?: Record<string, unknown>;
  detoxSaveRetryCoachAuth?: Record<string, unknown>;
  detoxAndroidCleanup?: unknown;
};

type DetoxConnectionProducerReceipt = Readonly<{
  kind: 'private-detox-connection-producer-receipt';
  captureRunId: string;
  platform: DetoxConnectionPlatform;
  childIdentity: DetoxConnectionOwnedProcessIdentity;
  sourceTreeHash: string;
  helperInputsHash: string;
}>;

function requireDeadline(value: number | undefined): number {
  const resolved = value ?? MAX_DEADLINE_MS;
  assert(
    Number.isSafeInteger(resolved) && resolved >= 30_000 && resolved <= MAX_DEADLINE_MS,
    'Detox connection deadline must be between 30000 and 600000 milliseconds',
  );
  return resolved;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('Detox connection operation cancelled');
}

function throwIfDriverDeadline(lifecycle: DetoxDriverEvidenceLifecycle, phase: string): void {
  throwIfAborted(lifecycle.signal);
  if (performance.now() >= lifecycle.deadlineAtMonotonicMs)
    throw new Error(`Detox connection deadline elapsed during ${phase}`);
  throwIfAborted(lifecycle.signal);
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function hashBytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readProtectedOriginalBinding(
  output: string,
  name: string,
  maxBytes: number,
  lifecycle: DetoxDriverEvidenceLifecycle,
): Promise<Record<string, unknown>> {
  const observed = await readOwnedDetoxConnectionEvidence(
    output,
    name,
    maxBytes,
    evidenceLifecycle(lifecycle),
  );
  return {
    name,
    bytes: observed.bytes.byteLength,
    sha256: hashBytes(observed.bytes),
    metadata: observed.metadata,
  };
}

function reportObject(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is missing`);
  return value;
}

async function publishDetoxResetReceipt(
  artifactRoot: string,
  platform: DetoxConnectionPlatform,
  targetDeviceId: string,
  lifecycle: DetoxDriverEvidenceLifecycle,
): Promise<Readonly<{ name: string; osVersion: string; resetFingerprint: string }>> {
  assert.equal(platform, 'ios');
  const owner = await readOwnedDetoxConnectionEvidence(
    artifactRoot,
    'simulator-owner.private.json',
    512 * 1024,
    evidenceLifecycle(lifecycle),
  );
  const ownerJson = JSON.parse(owner.bytes.toString('utf8')) as Record<string, unknown>;
  const ownerIdentity = ownerJson.identity;
  assert(ownerJson.state === 'owned', 'Detox target ownership is not complete');
  assert(ownerIdentity && typeof ownerIdentity === 'object');
  const identity = ownerIdentity as Record<string, unknown>;
  assert.equal(identity.udid, targetDeviceId);
  assert(typeof identity.runtime === 'string' && identity.runtime.length > 0);
  const ownerPath = 'simulator-owner.private.json';
  const name = 'detox-reset-original.private.json';
  const reset = {
    kind: 'private-detox-fresh-owned-target-reset-original',
    platform,
    targetDeviceId,
    status: 'verified' as const,
    permissionState: 'not-applicable' as const,
    freshOwnedTarget: true as const,
    resetMethod: 'new-owned-simulator' as const,
    ownerPath,
    ownerSha256: hashBytes(owner.bytes),
    ownerBytes: owner.bytes.byteLength,
    ownerMetadata: owner.metadata,
    osVersion: identity.runtime,
  };
  const bytes = Buffer.from(`${JSON.stringify(reset)}\n`);
  await writeAtomicDetoxConnectionBytes(
    artifactRoot,
    name,
    bytes,
    512 * 1024,
    evidenceLifecycle(lifecycle),
  );
  return {
    name,
    osVersion: identity.runtime,
    resetFingerprint: hashBytes(bytes),
  };
}

function snapshotTransportSource(
  observations: readonly ProxyObservation[],
): readonly ProxyObservation[] {
  return observations.map((row) => structuredClone(row));
}

async function publishTransportSource(
  output: string,
  observations: readonly ProxyObservation[],
  report: DriverReport,
  lifecycle: DetoxDriverEvidenceLifecycle,
): Promise<void> {
  const source = snapshotTransportSource(observations);
  const bytes = Buffer.from(JSON.stringify(source));
  const sourcePath = 'detox-connection-transport-source.private.json';
  await writeAtomicDetoxConnectionBytes(
    output,
    sourcePath,
    bytes,
    4 * 1024 * 1024,
    evidenceLifecycle(lifecycle),
  );
  report.detoxTransportSource = source;
  report.detoxTransportSourceHash = hashJson(source);
  report.detoxTransportSourceReceipt = {
    path: sourcePath,
    sourceBytes: bytes.byteLength,
    sourceSha256: hashBytes(bytes),
  };
}

/**
 * Persist the original runtime inputs from the owned driver after the actual
 * connection journey and UI ledger have completed.  The runtime producer
 * only rereads these files; it must never manufacture them from its report.
 * Keeping this writer on the driver side also binds every original to the
 * child identity and the command IDs that produced the observations.
 */
export async function publishDetoxRuntimeOriginals(
  report: DriverReport,
  lifecycle: DetoxDriverEvidenceLifecycle,
): Promise<void> {
  assert(report[DETOX_PRODUCER_TOKEN] === true, 'Detox originals require an owned driver report');
  assert.equal(report.platform, 'ios');
  const output = String(report.output);
  const runId = path.basename(output);
  const attemptId = `${runId}:first`;
  const childIdentity = assertChildIdentity(report);
  const build = report.build;
  assert(build && typeof build === 'object' && !Array.isArray(build));
  const buildRecord = build as Record<string, unknown>;
  const runtimeMetadata = {
    environmentHash: buildRecord.environmentHash,
    toolVersions: buildRecord.toolVersions,
    toolVersionEvidence: buildRecord.toolVersionEvidence,
  };
  requireDetoxRuntimeBuildMetadata(runtimeMetadata, 'Detox driver runtime metadata');
  const child = reportObject(report.detoxChild, 'Detox owned child report');
  const repositoryRoot = requiredString(child.cwd, 'Detox owned child repository root');
  await revalidateDetoxRuntimeBuildMetadata(repositoryRoot, runtimeMetadata, () => {
    throwIfAborted(lifecycle.signal);
    assert(
      performance.now() < lifecycle.deadlineAtMonotonicMs,
      'Detox runtime metadata reread exceeded its evidence deadline',
    );
  });
  const source = buildRecord.source;
  assert(source && typeof source === 'object' && !Array.isArray(source));
  const sourceRecord = source as Record<string, unknown>;
  const dispatchRuntimeInputsHash = buildRecord.dispatchRuntimeInputsHash;
  assert(
    typeof dispatchRuntimeInputsHash === 'string' &&
      /^[a-f0-9]{64}$/.test(dispatchRuntimeInputsHash),
    'Detox qualified build is missing its dispatch runtime closure hash',
  );
  const target = reportObject(report.target, 'Detox runtime target');
  const backend = reportObject(report.backend, 'Detox runtime backend');
  const api = reportObject(report.connectionApiIdentity, 'Detox runtime API');
  const preparation = reportObject(
    report.connectionJourneyPreparation,
    'Detox runtime journey preparation',
  );
  const snapshots = reportObject(preparation.snapshots, 'Detox runtime snapshots');
  const sourceRows = report.detoxTransportSource;
  assert(Array.isArray(sourceRows) && sourceRows.length > 0);
  const commands = report.detoxConnectionCommands;
  assert(Array.isArray(commands) && commands.length > 0);
  const commandIds = commands.map((command) => command.commandId);
  const commandHashes = commands.map((command) => command.commandHash);
  const ledgerValue: unknown = report.detoxConnectionLedger;
  assert(Array.isArray(ledgerValue) && ledgerValue.length === 7);
  const ledger = ledgerValue as readonly Record<string, unknown>[];
  const requestIds = sourceRows.map((row) => {
    const requestId: unknown = (row as Record<string, unknown>).requestId;
    assert(Number.isSafeInteger(requestId), 'Detox original transport request identity is missing');
    return requestId as number;
  });
  const transportWindows = preparation.transportWindows;
  assert(Array.isArray(transportWindows) && transportWindows.length >= 9);
  const snapshotNames = Object.values(snapshots).map((value) => {
    const row = reportObject(value, 'Detox runtime snapshot');
    assert(typeof row.path === 'string' && /^[a-z0-9-]+\.private\.json$/.test(row.path));
    return row.path;
  });
  const ownerEvidence = await readProtectedOriginalBinding(
    output,
    'simulator-owner.private.json',
    512 * 1024,
    lifecycle,
  );
  const resetEvidence = await readProtectedOriginalBinding(
    output,
    'detox-reset-original.private.json',
    512 * 1024,
    lifecycle,
  );
  const transportSourceEvidence = await readProtectedOriginalBinding(
    output,
    requiredString(report.detoxTransportSourceReceipt?.path, 'Detox transport source path'),
    4 * 1024 * 1024,
    lifecycle,
  );
  const snapshotEvidence = await Promise.all(
    snapshotNames.map((name) =>
      readProtectedOriginalBinding(output, name, 4 * 1024 * 1024, lifecycle),
    ),
  );
  const publicObservations = report.observations;
  assert(Array.isArray(publicObservations) && publicObservations.length >= ledger.length);
  const uiEvidence = await Promise.all(
    publicObservations.flatMap((value) => {
      const row = reportObject(value, 'Detox runtime UI observation');
      const screenshotPath = requiredString(row.screenshotPath, 'Detox screenshot path');
      const hierarchyPath = requiredString(row.hierarchyPath, 'Detox hierarchy path');
      return [
        readProtectedOriginalBinding(output, screenshotPath, 8 * 1024 * 1024, lifecycle),
        readProtectedOriginalBinding(output, hierarchyPath, 4 * 1024 * 1024, lifecycle),
      ];
    }),
  );
  const originalHeader = {
    owner: 'detox-driver' as const,
    requestedRunId: runId,
    requestedAttemptId: attemptId,
    captureRunId: runId,
    childIdentity,
    commandIds,
    commandHashes,
  };
  const originals: Record<string, unknown> = {
    'detox-source-original.private.json': {
      kind: 'private-detox-qualified-source-original',
      ...originalHeader,
      sourceTreeHash: sourceRecord.sourceTreeHash,
      helperInputsHash: buildRecord.helperInputsHash,
      detoxConfigHash: buildRecord.detoxConfigHash,
      dispatchRuntimeInputsHash,
    },
    // Keep command identity in its own original receipt. The finalizer rereads
    // this driver-owned file instead of trusting a projected report array.
    'detox-command-original.private.json': {
      kind: 'private-detox-command-original',
      ...originalHeader,
      commands,
    },
    'detox-build-original.private.json': {
      kind: 'private-detox-qualified-build-original',
      ...originalHeader,
      configuration: buildRecord.configuration,
      sourceTreeHash: sourceRecord.sourceTreeHash,
      helperInputsHash: buildRecord.helperInputsHash,
      binaryHash: buildRecord.binaryHash,
      detoxConfigHash: buildRecord.detoxConfigHash,
      environmentHash: buildRecord.environmentHash,
      toolVersions: buildRecord.toolVersions,
      toolVersionEvidence: buildRecord.toolVersionEvidence,
    },
    'detox-target-original.private.json': {
      kind: 'private-detox-owned-target-original',
      ...originalHeader,
      platform: target.platform,
      deviceId: target.deviceId,
      osVersion: target.osVersion,
      appId: target.appId,
      ownership: target.ownership,
      apiOrigin: target.apiOrigin,
      evidence: { owner: ownerEvidence, reset: resetEvidence },
    },
    'detox-transport-original.private.json': {
      kind: 'private-detox-transport-original',
      ...originalHeader,
      sourceName: 'detox-connection-transport-source.private.json',
      sourceEvidence: transportSourceEvidence,
      windows: transportWindows,
    },
    'detox-api-original.private.json': {
      kind: 'private-detox-api-original',
      ...originalHeader,
      apiPid: api.apiPid,
      targetOrigin: api.targetOrigin,
      requestIds,
      backendRunId: backend.runId,
      transportSourceEvidence,
    },
    'detox-sql-original.private.json': {
      kind: 'private-detox-sql-original',
      ...originalHeader,
      snapshotNames,
      snapshotEvidence,
      isolationUnchanged: preparation.isolationUnchanged,
      trainingPlansUnchanged: preparation.trainingPlansUnchanged,
    },
    'detox-ui-original.private.json': {
      kind: 'private-detox-ui-original',
      ...originalHeader,
      assertionIds: ledger.map((row) => row.id),
      observationLabels: ledger.flatMap((row) =>
        Array.isArray(row.observationLabels) ? row.observationLabels.map(String) : [],
      ),
      evidence: uiEvidence,
    },
  };
  await Promise.all(
    Object.entries(originals).map(async ([name, value]) => {
      await writeAtomicDetoxConnectionBytes(
        output,
        name,
        Buffer.from(`${JSON.stringify(value)}\n`),
        4 * 1024 * 1024,
        evidenceLifecycle(lifecycle),
      );
    }),
  );
}

function markOwnedProducerReport(report: DriverReport): DriverReport {
  Object.defineProperty(report, DETOX_PRODUCER_TOKEN, {
    value: true,
    enumerable: false,
  });
  return report;
}

export function createDetoxConnectionProducerReport(input: {
  platform: DetoxConnectionPlatform;
  artifactRoot: string;
  childIdentity: DetoxConnectionOwnedProcessIdentity;
  sourceTreeHash: string;
  helperInputsHash: string;
  transportSource: readonly Record<string, unknown>[];
}): DriverReport {
  assert(RUN_ID.test(path.basename(input.artifactRoot)));
  assert(/^[a-f0-9]{64}$/.test(input.sourceTreeHash));
  assert(/^[a-f0-9]{64}$/.test(input.helperInputsHash));
  const report = markOwnedProducerReport({
    kind: 'private-detox-connection-capture-not-public-receipt',
    nativePassingCases: 0,
    publicPromotionEligible: false,
    platform: input.platform,
    output: input.artifactRoot,
    observations: [],
    detoxConnectionObservations: [],
    detoxConnectionCommands: [],
    detoxChildIdentity: input.childIdentity,
    detoxTransportSource: input.transportSource,
    detoxTransportSourceHash: hashJson(input.transportSource),
    detoxProducerReceipt: {
      kind: 'private-detox-connection-producer-receipt',
      captureRunId: path.basename(input.artifactRoot),
      platform: input.platform,
      childIdentity: input.childIdentity,
      sourceTreeHash: input.sourceTreeHash,
      helperInputsHash: input.helperInputsHash,
    },
  });
  return report;
}

async function requireRunnerFile(repositoryRoot: string, value: string, label: string) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const resolved = path.resolve(value);
  const relative = path.relative(resolvedRoot, resolved);
  assert(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    `${label} escaped repository root`,
  );
  const observed = await readDetoxConnectionPath(resolved, 8 * 1024 * 1024, {
    privateRecord: false,
  });
  return { path: resolved, sha256: hashBytes(observed.bytes) };
}

export async function validateDetoxConnectionRunnerPaths(
  repositoryRoot: string,
  paths: DetoxConnectionDriverOptions['runnerPaths'],
) {
  return {
    jestConfig: await requireRunnerFile(repositoryRoot, paths.jestConfigPath, 'Detox Jest config'),
    test: await requireRunnerFile(repositoryRoot, paths.testPath, 'Detox Jest test'),
    actionability: await requireRunnerFile(
      repositoryRoot,
      path.join(repositoryRoot, 'scripts/testing/detox-connection-actionability.ts'),
      'Detox actionability source',
    ),
    hierarchy: await requireRunnerFile(
      repositoryRoot,
      path.join(repositoryRoot, 'scripts/testing/detox-native-hierarchy.ts'),
      'Detox hierarchy source',
    ),
    saveRetryActions: await requireRunnerFile(
      repositoryRoot,
      paths.saveRetryActionsPath ??
        path.join(repositoryRoot, 'scripts/testing/detox-save-retry-child-actions.js'),
      'Detox save/retry child actions source',
    ),
    saveRetryProtocol: await requireRunnerFile(
      repositoryRoot,
      path.join(repositoryRoot, 'scripts/testing/detox-save-retry-child-protocol.mjs'),
      'Detox save/retry child protocol source',
    ),
  };
}

async function readOwnedChildIdentity(
  artifactRoot: string,
  child: OwnedChild,
  deadlineAt: number,
): Promise<DetoxConnectionOwnedProcessIdentity> {
  for (;;) {
    const bytes = await readOwnedDetoxConnectionFile(
      artifactRoot,
      'detox-connection-child.ownership.json',
      4 * 1024 * 1024,
      { deadlineAt },
    );
    const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    assert.equal(value.kind, 'private worker process ownership');
    assert.equal(value.pid, child.pid);
    assert.equal(value.pgid, child.pgid);
    const processes = Array.isArray(value.processes) ? value.processes : [];
    const leader = processes.find(
      (row) =>
        row &&
        typeof row === 'object' &&
        (row as Record<string, unknown>).pid === child.pid &&
        (row as Record<string, unknown>).pgid === child.pgid,
    ) as Record<string, unknown> | undefined;
    if (leader && typeof leader.started === 'string' && leader.started.length > 0)
      return { pid: child.pid, pgid: child.pgid, started: leader.started };
    if (performance.now() >= deadlineAt)
      throw new Error(`Owned Detox child identity was not published in the owned artifact root`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function requireArtifactRoot(root: string): string {
  const resolved = path.resolve(root);
  assert(RUN_ID.test(path.basename(resolved)), 'Detox connection artifact root must be a run ID');
  assert(
    resolved.includes(`${path.sep}.qa${path.sep}artifacts${path.sep}`),
    'Detox connection artifact root is outside QA artifacts',
  );
  return resolved;
}

async function readArtifactRootIdentity(
  root: string,
): Promise<DetoxConnectionEvidenceDirectoryIdentity> {
  const canonical = await realpath(root);
  assert.equal(canonical, root, 'Detox connection artifact root is not canonical');
  const metadata = await lstat(root);
  assert(
    metadata.isDirectory() && !metadata.isSymbolicLink(),
    'Detox connection artifact root is not a directory',
  );
  assert.equal(metadata.mode & 0o777, 0o700, 'Detox connection artifact root must be mode 0700');
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    mode: metadata.mode,
  };
}

function profile(platform: DetoxConnectionPlatform): ConnectionPlatformProfile {
  return platform === 'ios' ? IOS_CONNECTION_PLATFORM : ANDROID_CONNECTION_PLATFORM;
}

function expectedLabels(
  platform: DetoxConnectionPlatform,
): Readonly<Record<string, readonly string[]>> {
  profile(platform);
  return Object.freeze({
    'NAT-connection-normal-entry': Object.freeze([
      'connection-coach-invite',
      'connection-normal-coach-pending',
      'connection-normal-coach-roster',
    ]),
    'NAT-connection-submit-pending': Object.freeze([
      'connection-student-entry',
      'connection-submit',
      'connection-student-pending',
    ]),
    'NAT-connection-pending-state': Object.freeze([
      'connection-coach-pending-roster',
      'connection-coach-no-active-roster',
      'connection-coach-return-home',
      'connection-coach-pending',
    ]),
    'NAT-connection-confirm-active': Object.freeze(['connection-confirm']),
    'NAT-connection-active-student': Object.freeze(['connection-student-active']),
    'NAT-connection-active-roster': Object.freeze(['connection-coach-roster']),
    'NAT-connection-unrelated-state': Object.freeze([]),
  });
}

async function consumeObservation(
  output: string,
  report: DriverReport,
  command: DetoxConnectionCommand,
  response: DetoxConnectionResponse,
): Promise<void> {
  if (response.status !== 'completed') {
    appendFailureObservation(report, response);
    const error = response.error;
    throw new Error(
      error
        ? `Detox child ${response.status}: ${error.name}: ${error.message}`
        : `Detox child ${response.status} the owned command`,
    );
  }
  assert(response.observations.length === 1, 'Detox connection step must publish one observation');
  const { observation, hierarchy } = await requireDetoxConnectionObservation(
    output,
    command,
    response.observations[0],
    assertChildIdentity(report),
    response.actionCleanup,
  );
  const tree = parseDetoxViewHierarchyXml(hierarchy as string, command.platform);
  applyDetoxElementAttributeEvidence(
    tree,
    observation.selectors.map((selector) => selector.after),
  );
  await writeAtomicDetoxConnectionBytes(
    output,
    `${command.label}-hierarchy.json`,
    Buffer.from(JSON.stringify(tree)),
    4 * 1024 * 1024,
  );
  const screenshotBytes = await readOwnedDetoxConnectionFile(
    output,
    observation.screenshotFile,
    16 * 1024 * 1024,
  );
  await writeAtomicDetoxConnectionBytes(
    output,
    `${command.label}.png`,
    screenshotBytes,
    16 * 1024 * 1024,
  );
  const observations = (report.detoxConnectionObservations ??= []);
  observations.push(observation);
  const commands = (report.detoxConnectionCommands ??= []);
  commands.push(command);
  if (response.actionCleanup) {
    const actionCleanup = (report.detoxConnectionActionCleanup ??= {});
    actionCleanup[command.label] = response.actionCleanup;
  }
  const publicObservations = (report.observations ??= []);
  publicObservations.push({
    label: command.label,
    viewId: observation.viewId,
    screenshotPath: `${command.label}.png`,
    hierarchyPath: `${command.label}-hierarchy.json`,
    screenshotHash: observation.screenshotSha256,
    hierarchyHash: hashJson(tree),
    commandId: observation.commandId,
    commandHash: observation.commandHash,
    actor: observation.actor,
    reviewed: false,
  });
}

function assertChildIdentity(report: DriverReport): DetoxConnectionOwnedProcessIdentity {
  const value = report.detoxChildIdentity;
  assert(value, 'Detox producer report is missing owned child identity');
  assert(Number.isSafeInteger(value.pid) && value.pid > 1);
  assert(Number.isSafeInteger(value.pgid) && value.pgid > 1);
  assert(typeof value.started === 'string' && value.started.length > 0);
  return value;
}

function appendFailureObservation(report: DriverReport, response: DetoxConnectionResponse): void {
  if (!response.observations.length) return;
  const rows = (report.detoxConnectionObservations ??= []);
  rows.push(...response.observations);
}

async function requireUniqueSnapshotReferences(
  output: string,
  preparation: Record<string, unknown>,
): Promise<void> {
  const snapshots = preparation.snapshots;
  assert(
    snapshots && typeof snapshots === 'object' && !Array.isArray(snapshots),
    'Detox journey snapshots are missing',
  );
  const entries = Object.entries(snapshots as Record<string, unknown>);
  assert.equal(entries.length, 12, 'Detox journey must retain all twelve SQL snapshots');
  const paths = new Set<string>();
  for (const [label, raw] of entries) {
    const row = raw as Record<string, unknown>;
    assert(
      row && typeof row === 'object' && !Array.isArray(row),
      `Detox snapshot ${label} is malformed`,
    );
    assert(typeof row.path === 'string' && /^[a-z0-9-]+\.private\.json$/.test(row.path));
    assert(typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256));
    assert(!paths.has(row.path), 'Detox SQL snapshot path is duplicated');
    paths.add(row.path);
    const bytes = await readOwnedDetoxPrivateFile(output, row.path, 4 * 1024 * 1024);
    assert.equal(hashBytes(bytes), row.sha256, `Detox SQL snapshot hash changed: ${label}`);
  }
}

/**
 * Derive the seven-purpose ledger from the actual shared controller report and
 * IPC observations. This producer never accepts a caller-supplied ledger and
 * cannot turn a synthetic transport list into a completed journey.
 */
export async function buildDetoxConnectionLedgerFromActualReport(
  report: DriverReport,
  platform: DetoxConnectionPlatform,
): Promise<readonly Record<string, unknown>[]> {
  assert(report[DETOX_PRODUCER_TOKEN] === true, 'Detox ledger requires an owned producer report');
  const producer = report.detoxProducerReceipt;
  const childIdentity = assertChildIdentity(report);
  assert(producer, 'Detox producer receipt is missing');
  assert.equal(producer.platform, platform);
  assert.deepEqual(producer.childIdentity, childIdentity);
  assert.equal(report.detoxConnectionObservations?.length, report.detoxConnectionCommands?.length);
  assert(Array.isArray(report.detoxConnectionObservations));
  assert(Array.isArray(report.detoxConnectionCommands));
  const transportSource = report.detoxTransportSource;
  assert(
    Array.isArray(transportSource) && transportSource.length > 0,
    'Detox transport source is missing',
  );
  assert.equal(report.detoxTransportSourceHash, hashJson(transportSource));
  const sourceReceipt = report.detoxTransportSourceReceipt;
  assert(sourceReceipt, 'Detox transport source receipt is missing');
  assert.equal(sourceReceipt.path, 'detox-connection-transport-source.private.json');
  assert(Number.isSafeInteger(sourceReceipt.sourceBytes) && sourceReceipt.sourceBytes > 0);
  assert.match(sourceReceipt.sourceSha256, /^[a-f0-9]{64}$/);
  const sourceBytes = await readOwnedDetoxPrivateFile(
    String(report.output),
    sourceReceipt.path,
    4 * 1024 * 1024,
  );
  assert.equal(sourceBytes.byteLength, sourceReceipt.sourceBytes);
  assert.equal(hashBytes(sourceBytes), sourceReceipt.sourceSha256);
  assert.deepEqual(JSON.parse(sourceBytes.toString('utf8')), transportSource);
  for (const source of transportSource as Record<string, unknown>[]) {
    assert(
      Number.isSafeInteger(source.requestId) && Number(source.requestId) > 0,
      'Detox transport request identity is missing',
    );
    assert(
      typeof source.method === 'string' && /^[A-Z]+$/.test(source.method),
      'Detox transport method is missing',
    );
    assert(
      typeof source.pathHash === 'string' && /^[a-f0-9]{64}$/.test(source.pathHash),
      'Detox transport path hash is missing',
    );
    assert(
      source.requestProfile === 'native',
      'Detox transport is not from the native proxy profile',
    );
    assert(
      typeof source.targetOrigin === 'string' && source.targetOrigin.length > 0,
      'Detox transport target origin is missing',
    );
    assert(
      typeof source.status === 'number' && Number.isSafeInteger(source.status),
      'Detox transport status is missing',
    );
    assert(source.outcome === 'forwarded', 'Detox transport outcome is not an owned forward');
    assert.equal(source.requestOrigin, null, 'Detox transport request origin must be null');
    assert.equal(source.faultAttemptId, null, 'Detox transport fault identity must be null');
    assert(
      typeof source.elapsedMs === 'number' &&
        Number.isFinite(source.elapsedMs) &&
        source.elapsedMs >= 0,
      'Detox transport timing is missing',
    );
  }
  const preparation = report.connectionJourneyPreparation;
  assert(
    preparation && typeof preparation === 'object' && !Array.isArray(preparation),
    'Detox journey report is missing',
  );
  const journey = preparation as Record<string, unknown>;
  assert.equal(journey.nativePassingCases, 0);
  const connectionId = journey.connectionId;
  assert(
    typeof connectionId === 'string' && /^[a-f0-9-]{36}$/.test(connectionId),
    'Detox connection ID is not an owned runtime ID',
  );
  await requireUniqueSnapshotReferences(String(report.output), journey);
  assert.equal(journey.transportSourceHash, report.detoxTransportSourceHash);
  const transportWindows = journey.transportWindows;
  assert(
    Array.isArray(transportWindows) && transportWindows.length >= 9,
    'Detox transport windows are incomplete',
  );
  const transports = transportWindows as Record<string, unknown>[];
  for (const row of transports) {
    const afterRequestId = Number(row.afterRequestId);
    const throughRequestId = Number(row.throughRequestId);
    assert(Number.isSafeInteger(afterRequestId) && Number.isSafeInteger(throughRequestId));
    assert(throughRequestId > afterRequestId);
    assert(typeof row.unique === 'boolean');
  }
  const sourceRows = transportSource as ProxyObservation[];
  const targetOrigin = (report.connectionApiIdentity as Record<string, unknown> | undefined)
    ?.targetOrigin;
  assert(typeof targetOrigin === 'string' && targetOrigin.length > 0);
  const hasWindow = (method: 'POST' | 'GET', route: string, status: number, unique?: boolean) =>
    transports
      .filter(
        (row) =>
          row.method === method &&
          row.route === route &&
          row.status === status &&
          (unique === undefined || row.unique === unique),
      )
      .some((row) => {
        try {
          return (
            requireNativeConnectionTransport({
              observations: sourceRows,
              method,
              route,
              status,
              targetOrigin,
              afterRequestId: Number(row.afterRequestId),
              throughRequestId: Number(row.throughRequestId),
              unique: unique ?? false,
            }).length > 0
          );
        } catch {
          return false;
        }
      });
  assert(
    hasWindow('POST', '/connections/invite-submissions', 201, true),
    'Detox submission transport is missing',
  );
  assert(
    hasWindow('POST', `/connections/${connectionId}/confirm`, 200, true),
    'Detox confirmation transport is missing',
  );
  assert(hasWindow('GET', '/connections', 200));
  assert(hasWindow('GET', '/professional/students', 200));
  const observations = report.detoxConnectionObservations ?? [];
  const commands = report.detoxConnectionCommands ?? [];
  const byLabel = new Map<string, DetoxConnectionObservationReceipt>();
  for (const observation of observations) {
    assert(!byLabel.has(observation.label), `Detox observation ${observation.label} is duplicated`);
    byLabel.set(observation.label, observation);
  }
  const commandByLabel = new Map<string, DetoxConnectionCommand>();
  for (const command of commands) {
    assert(!commandByLabel.has(command.label), `Detox command ${command.label} is duplicated`);
    commandByLabel.set(command.label, command);
  }
  for (const observation of observations) {
    const command = commandByLabel.get(observation.label);
    assert(command, `Detox observation ${observation.label} lacks its producer command`);
    await requireDetoxConnectionObservation(
      String(report.output),
      command,
      observation,
      childIdentity,
      report.detoxConnectionActionCleanup?.[observation.label],
    );
  }
  const labels = expectedLabels(platform);
  return CONNECTION_PURPOSE_PLANS.map((purpose) => {
    const required = labels[purpose.id] ?? [];
    const rows = required.map((label) => byLabel.get(label));
    assert(rows.every(Boolean), `Detox purpose ${purpose.id} lacks actual UI observations`);
    assert(
      rows.every(
        (row) => row?.actionCompleted === true && row.hierarchyCaptured && row.screenshotCaptured,
      ),
      `Detox purpose ${purpose.id} has incomplete UI evidence`,
    );
    for (const label of required) {
      const command = commandByLabel.get(label);
      const observation = byLabel.get(label);
      assert(command && observation, `Detox purpose ${purpose.id} lacks producer command evidence`);
      assert.equal(command.kind, 'observe');
      assert.equal(command.platform, platform);
      assert.equal(command.label, label);
    }
    const targetConnectionId = purpose.id === 'NAT-connection-normal-entry' ? null : connectionId;
    return {
      id: purpose.id,
      actor: purpose.actor,
      navigation: purpose.navigation,
      status: 'passed',
      evidenceKinds: [...purpose.requiredEvidence],
      targetConnectionId,
      bound: true,
      phase: `detox:${platform}:${purpose.id}:actual-owned-controller`,
      observationLabels: required,
    };
  });
}

function mapAccountSwitchNavigation(value: ConnectionNavigation): IpcNavigation {
  return value;
}

function contextWithDetoxIpc(input: {
  base: DetoxConnectionContextBase;
  client: DetoxConnectionIpcClient;
  platform: DetoxConnectionPlatform;
  signal: AbortSignal;
  report: DriverReport;
}): SharedConnectionRuntimeContext {
  const { base, client, platform, signal, report } = input;
  let currentActor: IpcActor = 'coach';
  const observe = async (
    label: string,
    semanticActions: string,
    viewId: string,
    selectors: string | string[],
    kind: 'id' | 'text' = 'id',
    action?: DetoxConnectionActionRequest,
  ) => {
    throwIfAborted(signal);
    const response = await client.request({
      kind: 'observe',
      actor: currentActor,
      navigation: 'none',
      label,
      semanticActions,
      viewId,
      selectors,
      selectorKind: kind,
      ...(action ? { action } : {}),
    });
    await consumeObservation(
      base.output,
      report,
      requireDetoxConnectionCommand({
        schemaVersion: 1,
        commandId: response.commandId,
        kind: 'observe',
        platform,
        actor: currentActor,
        navigation: 'none',
        label,
        semanticActions,
        viewId,
        selectors,
        selectorKind: kind,
        ...(action ? { action } : {}),
        commandHash: response.commandHash,
      }),
      response,
    );
  };
  return {
    ...base,
    observe,
    switchAccount: async (actor: ConnectionActor, navigation: ConnectionNavigation = 'none') => {
      throwIfAborted(signal);
      const beforeRequestId = base.proxy.observations.reduce(
        (max, row) => Math.max(max, row.requestId),
        0,
      );
      const switchInput = {
        kind: 'switch-account',
        actor,
        navigation: mapAccountSwitchNavigation(navigation),
        label: `connection-switch-${actor}-${beforeRequestId + 1}`,
        semanticActions: 'owned-detox-account-switch',
        viewId: actor === 'coach' ? 'SCR-pro-home' : 'SCR-student-home',
        selectors: actor === 'coach' ? 'pro.home.screen' : 'student.home.screen',
        selectorKind: 'id',
      } as const;
      const response = await client.request(switchInput);
      const switchCommand = requireDetoxConnectionCommand({
        schemaVersion: 1,
        commandId: response.commandId,
        platform,
        ...switchInput,
        commandHash: response.commandHash,
      });
      await consumeObservation(base.output, report, switchCommand, response);
      assert(response.accountSwitch, 'Detox account switch omitted its owned auth boundary');
      const fixtureUids = Object.values(base.fixtures.accounts).map((account) => account.authUid);
      const apiIdentity = base.apiIdentity;
      const boundary =
        platform === 'ios'
          ? requireIosConnectionSignInBoundary(base.proxy.observations, beforeRequestId)
          : requireAndroidConnectionSignInBoundary(
              base.proxy.observations,
              base.proxy.nativeAuthIdentities,
              {
                beforeRequestId,
                apiIdentity,
              },
            );
      const actorAuthUid =
        platform === 'ios'
          ? requireIosConnectionActorIdentity(base.proxy.nativeAuthIdentities, {
              actorAuthUid: base.fixtures.accounts[actor].authUid,
              authRequestId: boundary.authRequestId,
              apiIdentity,
              fixtureAuthUids: fixtureUids,
            })
          : requireAndroidConnectionActorIdentity(base.proxy.nativeAuthIdentities, {
              actorAuthUid: base.fixtures.accounts[actor].authUid,
              authRequestId: boundary.authRequestId,
              apiIdentity,
              fixtureAuthUids: fixtureUids,
            });
      const result = { actor, beforeRequestId, actorAuthUid, ...boundary };
      assert.equal(response.accountSwitch.actor, actor);
      assert.equal(response.accountSwitch.navigation, navigation);
      currentActor = actor;
      report.connectionAccountSwitches = [...(report.connectionAccountSwitches ?? []), result];
      return result;
    },
  };
}

async function waitForReady(
  root: string,
  signal: AbortSignal,
  deadlineAt: number,
  expectedChild: DetoxConnectionOwnedProcessIdentity,
): Promise<void> {
  for (;;) {
    throwIfAborted(signal);
    try {
      const value = JSON.parse(
        (
          await readOwnedDetoxPrivateFile(root, 'detox-connection-ready.private.json', 64 * 1024)
        ).toString('utf8'),
      ) as Record<string, unknown>;
      assert.equal(value.kind, 'private-detox-connection-ready');
      assert.equal(
        value.childIdentity && typeof value.childIdentity === 'object'
          ? (value.childIdentity as Record<string, unknown>).pid
          : undefined,
        expectedChild.pid,
      );
      assert.equal(
        value.childIdentity && typeof value.childIdentity === 'object'
          ? (value.childIdentity as Record<string, unknown>).pgid
          : undefined,
        expectedChild.pgid,
      );
      assert.equal(
        value.childIdentity && typeof value.childIdentity === 'object'
          ? (value.childIdentity as Record<string, unknown>).started
          : undefined,
        expectedChild.started,
      );
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
        throw error;
    }
    if (performance.now() >= deadlineAt) throw new Error('Detox child readiness deadline elapsed');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function buildCommand(options: DetoxConnectionDriverOptions, artifactRoot: string) {
  return {
    command: 'yarn',
    argv: [
      'detox',
      'test',
      '-C',
      options.runnerPaths.jestConfigPath,
      '-c',
      options.configuration,
      '--headless',
      '--no-start',
      '--artifacts-location',
      path.join(artifactRoot, 'detox-artifacts'),
      '--record-logs',
      'none',
    ],
  };
}

/**
 * Bind a qualified reuse descriptor to the environment consumed by the
 * checked-in Detox config.  The empty values deliberately clear inherited
 * overrides so an ordinary checked-in build cannot be redirected by a parent
 * process.
 */
export function buildDetoxVerifiedBinaryEnvironment(
  build: DetoxBaselineBuildInstrumentation,
): Readonly<Record<string, string | undefined>> {
  const empty = {
    DETOX_IOS_VERIFIED_BINARY_PATH: undefined,
    DETOX_IOS_VERIFIED_BINARY_HASH: undefined,
    DETOX_IOS_VERIFIED_BINARY_RUN_ID: undefined,
    DETOX_IOS_VERIFIED_BINARY_PROFILE_PATH: undefined,
    DETOX_IOS_VERIFIED_BINARY_IDENTITY: undefined,
    DETOX_ANDROID_VERIFIED_BINARY_PATH: undefined,
    DETOX_ANDROID_VERIFIED_BINARY_HASH: undefined,
    DETOX_ANDROID_VERIFIED_BINARY_RUN_ID: undefined,
    DETOX_ANDROID_VERIFIED_BINARY_PROFILE_PATH: undefined,
    DETOX_ANDROID_VERIFIED_BINARY_IDENTITY: undefined,
    DETOX_ANDROID_VERIFIED_TEST_BINARY_PATH: undefined,
    DETOX_ANDROID_VERIFIED_TEST_BINARY_HASH: undefined,
    DETOX_ANDROID_VERIFIED_TEST_BINARY_PROFILE_PATH: undefined,
    DETOX_ANDROID_VERIFIED_TEST_BINARY_IDENTITY: undefined,
  };
  if (!build.binaryReuse) return empty;
  if (build.binaryReuse.kind === 'qualified-ios-build-reuse') {
    assert.equal(build.platform, 'ios');
    assert.equal(build.binaryPath, build.binaryReuse.binaryPath);
    assert.equal(build.binaryHash, build.binaryReuse.binaryHash);
    return {
      ...empty,
      DETOX_IOS_VERIFIED_BINARY_PATH: build.binaryReuse.binaryPath,
      DETOX_IOS_VERIFIED_BINARY_HASH: build.binaryReuse.binaryHash,
      DETOX_IOS_VERIFIED_BINARY_RUN_ID: build.binaryReuse.runId,
      DETOX_IOS_VERIFIED_BINARY_PROFILE_PATH: build.binaryReuse.checkedInBinaryPath,
      DETOX_IOS_VERIFIED_BINARY_IDENTITY: JSON.stringify(build.binaryReuse.binaryIdentity),
    };
  }
  assert.equal(build.platform, 'android');
  assert.equal(build.binaryPath, build.binaryReuse.binaryPath);
  assert.equal(build.binaryHash, build.binaryReuse.binaryHash);
  assert.equal(build.testBinaryPath, build.binaryReuse.testBinaryPath);
  assert.equal(build.testBinaryHash, build.binaryReuse.testBinaryHash);
  return {
    ...empty,
    DETOX_ANDROID_VERIFIED_BINARY_PATH: build.binaryReuse.binaryPath,
    DETOX_ANDROID_VERIFIED_BINARY_HASH: build.binaryReuse.binaryHash,
    DETOX_ANDROID_VERIFIED_BINARY_RUN_ID: build.binaryReuse.runId,
    DETOX_ANDROID_VERIFIED_BINARY_PROFILE_PATH: build.binaryReuse.checkedInBinaryPath,
    DETOX_ANDROID_VERIFIED_BINARY_IDENTITY: JSON.stringify(build.binaryReuse.binaryIdentity),
    DETOX_ANDROID_VERIFIED_TEST_BINARY_PATH: build.binaryReuse.testBinaryPath,
    DETOX_ANDROID_VERIFIED_TEST_BINARY_HASH: build.binaryReuse.testBinaryHash,
    DETOX_ANDROID_VERIFIED_TEST_BINARY_PROFILE_PATH: build.binaryReuse.checkedInTestBinaryPath,
    DETOX_ANDROID_VERIFIED_TEST_BINARY_IDENTITY: JSON.stringify(
      build.binaryReuse.testBinaryIdentity,
    ),
  };
}

async function inspectDetoxBuildForDriver(
  build: DetoxBaselineBuildInstrumentation,
  repositoryRoot: string,
): Promise<DetoxBaselineBuildInstrumentation> {
  if (build.platform === 'android' && build.binaryReuse?.kind === 'qualified-android-build-reuse')
    return inspectAndroidDetoxBuildArtifacts({ repositoryRoot, build });
  return inspectDetoxBuildInstrumentation({ repositoryRoot, build });
}

type DetoxDriverCleanupClient = Readonly<{
  request(
    command: Omit<
      DetoxConnectionCommand,
      'schemaVersion' | 'commandId' | 'platform' | 'commandHash'
    >,
    options?: { signal?: AbortSignal; deadlineAt?: number },
  ): Promise<DetoxConnectionResponse>;
  close(): void;
}>;

type DetoxSaveRetryDrainUncertainty = Readonly<{
  kind: 'drain-throw-before-result' | 'drain-timeout-before-result';
  pendingCommandIdsKnown: false;
  terminalStateObserved: boolean;
  error: Readonly<{ name: string; message: string }>;
}>;

type DetoxDriverCleanupSaveRetryDrain = Readonly<{
  status: 'verified' | 'not-verified';
  pendingCommandIds: readonly number[];
  terminalCommandIds: readonly number[];
  failures: readonly string[];
  uncertainty?: DetoxSaveRetryDrainUncertainty;
}>;

type DetoxDriverCleanupSaveRetryClient = Readonly<{
  identity?: DetoxConnectionOwnedProcessIdentity;
  close(): void;
  terminalState?: () => readonly DetoxSaveRetryTerminalState[];
  drain(input: {
    signal?: AbortSignal;
    deadlineAt: number;
  }): Promise<DetoxDriverCleanupSaveRetryDrain>;
}>;

function readSaveRetryTerminalState(
  client: DetoxDriverCleanupSaveRetryClient,
): readonly DetoxSaveRetryTerminalState[] | undefined {
  try {
    return client.terminalState?.();
  } catch {
    return undefined;
  }
}

type DetoxDriverCleanupChild = Readonly<{
  pid: number;
  pgid: number;
  wait(deadlineMs: number, signal?: AbortSignal): Promise<unknown>;
  stop(): Promise<unknown>;
  outcome(): { code: number | null; signal: NodeJS.Signals | null };
  censusFailure(): unknown;
  outputFailure(): unknown;
}>;

export type DetoxDriverCleanupInput = Readonly<{
  artifactRoot: string;
  /** Identity captured by the owning artifact-root lease before acquisition. */
  artifactRootIdentity?: DetoxConnectionEvidenceDirectoryIdentity;
  repositoryRoot: string;
  report: DriverReport;
  reason: DetoxConnectionCleanupReason;
  signal: AbortSignal;
  deadlineAt: number;
  client?: DetoxDriverCleanupClient;
  saveRetryClient?: DetoxDriverCleanupSaveRetryClient;
  child?: DetoxDriverCleanupChild;
  childCommand?: ReturnType<typeof buildCommand>;
  proxy?: Readonly<{
    stop(): Promise<unknown>;
    observations?: readonly { requestId: number }[];
    faultState?: unknown;
  }>;
  session?: Readonly<{ stop(): Promise<unknown>; manifest: { runId: string } }>;
  target?: Readonly<{ stop(): Promise<unknown> }>;
  reservation?: Readonly<{ release(): Promise<unknown> }>;
  androidCleanup?: (input: {
    remainingMs: number;
    signal: AbortSignal;
    deadlineAt: number;
    target: DetoxOwnedTarget;
    report: DriverReport;
  }) => Promise<unknown>;
}>;

/**
 * The driver owns one aggregate cleanup fence. The baseline passes its
 * absolute deadline into this function, so child, proxy, backend, target and
 * port cleanup cannot each receive a fresh budget. This is also the exact
 * production wiring seam exercised by the injected resource controls.
 */
export async function runDetoxConnectionDriverCleanup(
  input: DetoxDriverCleanupInput,
): Promise<DetoxConnectionCleanupResult> {
  const saveRetryDrainFence = { late: false, sealed: false };
  const saveRetryClient = input.saveRetryClient;
  const cleanupSteps: {
    label: string;
    operation: (remainingMs: number, signal: AbortSignal) => Promise<unknown>;
  }[] = [];
  if (saveRetryClient?.drain) {
    cleanupSteps.push({
      label: 'save-retry-child-drain',
      operation: async (remainingMs, signal) => {
        let drain: DetoxDriverCleanupSaveRetryDrain;
        let thrownDrainError: Error | undefined;
        let thrownDrainTerminalState: readonly DetoxSaveRetryTerminalState[] | undefined;
        try {
          drain = await saveRetryClient.drain({
            signal,
            deadlineAt: input.deadlineAt,
          });
        } catch (error) {
          const normalized = error instanceof Error ? error : new Error(String(error));
          if (saveRetryDrainFence.sealed || performance.now() >= input.deadlineAt) {
            saveRetryDrainFence.late = true;
            throw new DetoxCleanupRecoveryError(
              'Detox save/retry child drain settled after the aggregate cleanup deadline',
            );
          }
          thrownDrainError = normalized;
          thrownDrainTerminalState = readSaveRetryTerminalState(saveRetryClient);
          const message = normalized.message.slice(0, 1_000);
          drain = {
            status: 'not-verified',
            pendingCommandIds: (thrownDrainTerminalState ?? [])
              .filter((row) => row.status === 'pending')
              .map((row) => row.commandId),
            terminalCommandIds: (thrownDrainTerminalState ?? [])
              .filter((row) => row.status !== 'pending')
              .map((row) => row.commandId),
            failures: [`drain-threw-before-result:${normalized.name}: ${message}`],
            uncertainty: {
              kind: 'drain-throw-before-result',
              pendingCommandIdsKnown: false,
              terminalStateObserved: thrownDrainTerminalState !== undefined,
              error: { name: normalized.name, message },
            },
          };
        }
        if (saveRetryDrainFence.sealed || performance.now() >= input.deadlineAt) {
          saveRetryDrainFence.late = true;
          throw new DetoxCleanupRecoveryError(
            'Detox save/retry child drain settled after the aggregate cleanup deadline',
          );
        }
        if (drain.status !== 'verified') {
          const terminal = input.report.detoxSaveRetryTerminal;
          const observedTerminalState =
            thrownDrainTerminalState ?? readSaveRetryTerminalState(saveRetryClient);
          const drainError =
            thrownDrainError ??
            new Error(
              `Detox save/retry child drain was not verified: ${drain.failures.join('; ')}`,
            );
          input.report.detoxSaveRetryTerminal = terminal
            ? {
                ...terminal,
                cleanup: {
                  owner: 'existing-detox-connection-driver-aggregate',
                  status: 'not-verified',
                },
                drain,
                ...(observedTerminalState ? { childTerminalState: observedTerminalState } : {}),
              }
            : input.report.detoxSaveRetry
              ? createDetoxSaveRetryCleanupFailureTerminal({
                  error: drainError,
                  signal,
                  deadlineAt: input.deadlineAt,
                  report: input.report,
                  ownedChild: input.child,
                  childTerminalState: observedTerminalState,
                  faultState: input.proxy?.faultState ?? null,
                  proxyObservations: input.proxy?.observations ?? [],
                  drain,
                })
              : {
                  cleanup: {
                    owner: 'existing-detox-connection-driver-aggregate',
                    status: 'not-verified' as const,
                  },
                  drain,
                  childIdentity:
                    input.report.detoxChildIdentity ?? saveRetryClient.identity ?? null,
                  childTerminalState: observedTerminalState ?? [],
                };
          throw new DetoxCleanupRecoveryError(
            `Detox save/retry child drain was not verified: ${drain.failures.join('; ')}`,
          );
        }
      },
    });
  }
  if (input.client && input.child) {
    if (input.report.detoxTrainingChildShutdown !== true)
      cleanupSteps.push({
        label: 'child-shutdown',
        operation: async (remainingMs, signal) => {
          const shutdown = await input.client!.request(
            {
              kind: 'shutdown',
              actor: 'coach',
              navigation: 'none',
              label: 'connection-shutdown',
              semanticActions: 'owned-detox-shutdown',
              viewId: 'SCR-pro-home',
              selectors: 'pro.home.screen',
              selectorKind: 'id',
            },
            { signal, deadlineAt: input.deadlineAt },
          );
          if (shutdown.status !== 'completed') {
            appendFailureObservation(input.report, shutdown);
            const error = shutdown.error;
            throw new Error(
              error
                ? `Detox child ${shutdown.status}: ${error.name}: ${error.message}`
                : `Detox child ${shutdown.status} the shutdown command`,
            );
          }
        },
      });
    cleanupSteps.push({
      label: 'child-wait',
      operation: (remainingMs, signal) => input.child!.wait(remainingMs, signal),
    });
    cleanupSteps.push({
      label: 'child-stop',
      operation: () => input.child!.stop(),
    });
  } else if (input.child) {
    // Callers without a command client (the Android camera session) still own
    // the child group. stop() also clears its census interval, which otherwise
    // keeps the runner and the native host lock alive until the run deadline.
    cleanupSteps.push({
      label: 'child-stop',
      operation: () => input.child!.stop(),
    });
  }
  if (input.proxy) cleanupSteps.push({ label: 'proxy', operation: () => input.proxy!.stop() });
  if (input.session)
    cleanupSteps.push({
      label: 'backend',
      operation: () => input.session!.stop(),
    });
  if (input.target)
    cleanupSteps.push({
      label: 'target',
      operation: () => input.target!.stop(),
    });
  if (input.androidCleanup)
    cleanupSteps.push({
      label: 'android-independent-cleanup',
      operation: async (remainingMs, signal) => {
        assert(input.target, 'Android cleanup was scheduled without an owned target');
        const result = await input.androidCleanup!({
          remainingMs,
          signal,
          deadlineAt: input.deadlineAt,
          target: input.target as DetoxOwnedTarget,
          report: input.report,
        });
        input.report.detoxAndroidCleanup = result;
        const cleanup = requireAndroidDetoxCleanupResult(result);
        assert.equal(
          cleanup.runId,
          path.basename(input.artifactRoot),
          'Android independent cleanup is bound to a different attempt',
        );
      },
    });
  if (input.reservation)
    cleanupSteps.push({
      label: 'app-port',
      operation: () => input.reservation!.release(),
    });

  let aggregate: Awaited<ReturnType<typeof runDetoxCleanupAggregate>>;
  try {
    aggregate = await runDetoxCleanupAggregate({
      deadlineAt: input.deadlineAt,
      signal: input.signal,
      steps: cleanupSteps,
    });
  } finally {
    // Once the aggregate has returned (including a timeout or unexpected
    // rejection), no detached drain continuation may mutate the report.
    saveRetryDrainFence.sealed = true;
  }
  if (
    saveRetryClient?.drain &&
    (aggregate.timedOutLabels.includes('save-retry-child-drain') || saveRetryDrainFence.late) &&
    performance.now() >= input.deadlineAt &&
    !input.report.detoxSaveRetryTerminal
  ) {
    const observedTerminalState = readSaveRetryTerminalState(saveRetryClient);
    const timeoutError = {
      name: 'DetoxCleanupDeadlineError',
      message: 'Save/retry child drain exceeded the aggregate cleanup deadline',
    } as const;
    const drain: DetoxDriverCleanupSaveRetryDrain = {
      status: 'not-verified',
      pendingCommandIds: (observedTerminalState ?? [])
        .filter((row) => row.status === 'pending')
        .map((row) => row.commandId),
      terminalCommandIds: (observedTerminalState ?? [])
        .filter((row) => row.status !== 'pending')
        .map((row) => row.commandId),
      failures: ['save-retry-child-drain: aggregate cleanup deadline elapsed before result'],
      uncertainty: {
        kind: 'drain-timeout-before-result',
        pendingCommandIdsKnown: false,
        terminalStateObserved: observedTerminalState !== undefined,
        error: timeoutError,
      },
    };
    const drainError = new Error(timeoutError.message);
    input.report.detoxSaveRetryTerminal = input.report.detoxSaveRetry
      ? createDetoxSaveRetryCleanupFailureTerminal({
          error: drainError,
          signal: input.signal,
          deadlineAt: input.deadlineAt,
          report: input.report,
          ownedChild: input.child,
          childTerminalState: observedTerminalState,
          faultState: input.proxy?.faultState ?? null,
          proxyObservations: input.proxy?.observations ?? [],
          drain,
        })
      : {
          cleanup: {
            owner: 'existing-detox-connection-driver-aggregate',
            status: 'not-verified' as const,
          },
          drain,
          childIdentity: input.report.detoxChildIdentity ?? saveRetryClient.identity ?? null,
          childTerminalState: observedTerminalState ?? [],
        };
  }
  const failures = [...aggregate.failures];
  const outcome = input.child?.outcome();
  if (input.child && outcome && outcome.code === null && outcome.signal === null)
    failures.push('child-termination:unknown');
  try {
    input.saveRetryClient?.close();
    input.client?.close();
  } catch (error) {
    failures.push(`child-client-close:${error instanceof Error ? error.message : String(error)}`);
  }
  if (input.child && input.childCommand) {
    const executions = (input.report.commandExecutions ??= []) as unknown[];
    executions.push({
      phase: 'step',
      execution: outcome?.code === 0 && outcome.signal === null ? 'completed' : 'failed',
      command: input.childCommand.command,
      argv: input.childCommand.argv,
      cwd: input.repositoryRoot,
      pid: input.child.pid,
      pgid: input.child.pgid,
      childExitCode: outcome?.code ?? null,
      childSignal: outcome?.signal ?? null,
      censusFailure: input.child.censusFailure(),
      outputFailure: input.child.outputFailure(),
    });
  }
  let recoveryStatus = aggregate.recoveryStatus;
  let cleanupStatus: DetoxConnectionCleanupResult['status'] =
    failures.length === 0 && recoveryStatus === 'verified' ? 'cleaned' : 'failed';
  const receipt = {
    kind: 'private-detox-connection-cleanup',
    reason: input.reason,
    captureRunId: path.basename(input.artifactRoot),
    backendRunId: input.session?.manifest.runId ?? null,
    status: cleanupStatus,
    recoveryStatus,
    cleanupDeadlineAt: input.deadlineAt,
    elapsedMs: aggregate.elapsedMs,
    timedOutLabels: aggregate.timedOutLabels,
    failures,
    child: input.child
      ? {
          pid: input.child.pid,
          pgid: input.child.pgid,
          outcome: input.child.outcome(),
          censusFailure: input.child.censusFailure(),
          outputFailure: input.child.outputFailure(),
        }
      : null,
    finishedAt: new Date().toISOString(),
  };
  try {
    const canonicalArtifactRoot = await realpath(input.artifactRoot);
    const recoveryPublicationController = new AbortController();
    const recoveryPublicationDeadlineAt =
      performance.now() + CLEANUP_RECOVERY_PUBLICATION_DEADLINE_MS;
    const recoveryPublicationTimer = setTimeout(() => {
      recoveryPublicationController.abort(
        new Error('Detox cleanup recovery-record publication deadline elapsed'),
      );
    }, CLEANUP_RECOVERY_PUBLICATION_DEADLINE_MS) as unknown as NodeJS.Timeout;
    recoveryPublicationTimer.unref?.();
    try {
      await writeAtomicDetoxConnectionBytes(
        canonicalArtifactRoot,
        'detox-connection-cleanup.private.json',
        Buffer.from(JSON.stringify(receipt, null, 2)),
        4 * 1024 * 1024,
        {
          signal: recoveryPublicationController.signal,
          deadlineAt: recoveryPublicationDeadlineAt,
          expectedRootIdentity: input.artifactRootIdentity,
        },
      );
      if (performance.now() >= recoveryPublicationDeadlineAt)
        throw new Error('Detox cleanup recovery-record publication exceeded its bounded window');
    } finally {
      clearTimeout(recoveryPublicationTimer);
    }
  } catch (error) {
    recoveryStatus = 'not-verified';
    failures.push(`cleanup-receipt:${error instanceof Error ? error.message : String(error)}`);
    cleanupStatus = 'failed';
  }
  if (recoveryStatus === 'not-verified') cleanupStatus = 'failed';
  return {
    status: cleanupStatus,
    recoveryStatus,
    failures,
    recoveryRecordPath: path.join(input.artifactRoot, 'detox-connection-cleanup.private.json'),
  };
}
function childEnv(
  options: DetoxConnectionDriverOptions,
  artifactRoot: string,
  platform: DetoxConnectionPlatform,
  fixtures: OwnedFixtures,
  runnerFiles: Awaited<ReturnType<typeof validateDetoxConnectionRunnerPaths>>,
) {
  const env = { ...(options.parentEnv ?? process.env) };
  for (const key of Object.keys(env)) if (key.startsWith('EXPO_PUBLIC_E2E_')) env[key] = undefined;
  const nodeEnv: 'development' | 'production' | 'test' =
    env.NODE_ENV === 'development' || env.NODE_ENV === 'production' || env.NODE_ENV === 'test'
      ? env.NODE_ENV
      : 'test';
  return {
    ...env,
    ...buildDetoxVerifiedBinaryEnvironment(options.build),
    NODE_ENV: nodeEnv,
    DETOX_CONNECTION_PLATFORM: platform,
    DETOX_CONNECTION_ARTIFACT_ROOT: artifactRoot,
    DETOX_CONNECTION_TEST_PATH: options.runnerPaths.testPath,
    DETOX_CONNECTION_TEST_SHA256: runnerFiles.test.sha256,
    DETOX_CONNECTION_JEST_CONFIG_PATH: options.runnerPaths.jestConfigPath,
    DETOX_CONNECTION_JEST_CONFIG_SHA256: runnerFiles.jestConfig.sha256,
    DETOX_CONNECTION_ACTIONABILITY_PATH: runnerFiles.actionability.path,
    DETOX_CONNECTION_ACTIONABILITY_SHA256: runnerFiles.actionability.sha256,
    DETOX_CONNECTION_HIERARCHY_PATH: runnerFiles.hierarchy.path,
    DETOX_CONNECTION_HIERARCHY_SHA256: runnerFiles.hierarchy.sha256,
    DETOX_SAVE_RETRY_ACTIONS_PATH: runnerFiles.saveRetryActions.path,
    DETOX_SAVE_RETRY_ACTIONS_SHA256: runnerFiles.saveRetryActions.sha256,
    DETOX_SAVE_RETRY_PROTOCOL_PATH: runnerFiles.saveRetryProtocol.path,
    DETOX_SAVE_RETRY_PROTOCOL_SHA256: runnerFiles.saveRetryProtocol.sha256,
    DETOX_CONNECTION_APP_ID: IOS_APP_ID,
    DETOX_CONNECTION_COACH_EMAIL: fixtures.accounts.coach.email,
    DETOX_CONNECTION_COACH_PASSWORD: fixtures.accounts.coach.password,
    DETOX_CONNECTION_STUDENT_EMAIL: fixtures.accounts.student.email,
    DETOX_CONNECTION_STUDENT_PASSWORD: fixtures.accounts.student.password,
  };
}

function baseContext(input: {
  output: string;
  fixtures: OwnedFixtures;
  proxy: OwnedProxy;
  session: OwnedSession;
  report: DriverReport;
}): DetoxConnectionContextBase {
  const scope = input.fixtures.scope;
  const isolationScope =
    scope === 'native-entry-ios'
      ? 'native-connection-isolation-ios'
      : 'native-conn-isolation-android';
  return {
    output: input.output,
    fixtures: input.fixtures,
    proxy: input.proxy,
    apiIdentity: {
      apiPid: input.session.apiPid,
      targetOrigin: input.session.apiOrigin,
    },
    snapshot: () => input.session.snapshot(scope),
    connectionSnapshot: () => input.session.connectionSnapshot(scope),
    isolationSnapshot: () => input.session.connectionSnapshot(isolationScope),
    report: input.report,
  };
}

function buildBinding(
  artifactRoot: string,
  backendRunId: string,
  build: DetoxBaselineBuildInstrumentation,
): DetoxConnectionSessionBinding {
  const captureRunId = path.basename(artifactRoot);
  assert(RUN_ID.test(captureRunId));
  return {
    captureRunId,
    backendRunId,
    sourceIdentity: {
      sourceTreeHash: build.source.sourceTreeHash,
      helperInputsHash: build.helperInputsHash,
    },
  };
}

export type DetoxSaveRetryExistingConnectionOwnerInput = Readonly<{
  context: SharedConnectionRuntimeContext;
  repositoryRoot: string;
  output: string;
  selection: NativePilotSelection;
  session: OwnedSession;
  proxy: OwnedProxy;
  saveRetryClient: DetoxSaveRetryChildClient;
  ownerChild: OwnedChild;
  childIdentity: DetoxConnectionOwnedProcessIdentity;
  signal: AbortSignal;
  deadlineAt: number;
  producerContext: Readonly<{
    build: unknown;
    runtimeMetadata: unknown;
  }>;
}>;

/**
 * Run T14-E from the already-observed connection owner.  The account switch
 * and the outer terminal fallback stay in this production callback seam so a
 * caller test cannot prove the fallback with a constructor-only fixture.
 */
export async function runDetoxSaveRetryOnExistingConnectionOwner(
  input: DetoxSaveRetryExistingConnectionOwnerInput,
): Promise<void> {
  const actualReport = input.context.report as DriverReport;
  const platform = input.context.fixtures.scope === 'native-entry-ios' ? 'ios' : 'android';
  assert.equal(input.selection.arguments.platform, platform);
  assert(input.context.switchAccount, 'Save/retry owner is missing the account-switch seam');
  assert(input.ownerChild, 'Save/retry owner is missing the existing Detox process handle');
  const saveFixtures = await input.session.fixtures(`native-entry-${platform}`);
  const faultIdentity = requireFaultIdentity(
    saveFixtures,
    path.basename(input.output),
    path.basename(input.output),
  );
  let coachAuthTransition: DetoxSaveRetryCoachAuthTransition | undefined;
  try {
    const rawCoachAuthTransition = await input.context.switchAccount(
      'coach',
      'student-professionals-back',
    );
    coachAuthTransition = {
      ...rawCoachAuthTransition,
      actor: 'coach' as const,
    };
    actualReport.detoxSaveRetryCoachAuth = coachAuthTransition;
    await runDetoxSaveRetryOnExistingOwner({
      repositoryRoot: input.repositoryRoot,
      output: input.output,
      selection: input.selection,
      fixtures: saveFixtures,
      session: input.session,
      proxy: input.proxy,
      child: input.saveRetryClient,
      childIdentity: input.childIdentity,
      coachAuthTransition,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      producerContext: input.producerContext,
      report: actualReport,
    });
  } catch (error) {
    if (!actualReport.detoxSaveRetryTerminal) {
      actualReport.detoxSaveRetryTerminal = createDetoxSaveRetryOuterFailureTerminal({
        error,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        report: actualReport,
        faultIdentity,
        coachAuthTransition,
        childIdentity: input.childIdentity,
        childTerminalState: input.saveRetryClient.terminalState?.(),
        faultState: input.proxy.faultState,
        proxyObservations: input.proxy.observations,
        evidenceRefs: [],
      });
    }
    throw error;
  }
}

/**
 * The normal caller path: owned app-port/target/backend/proxy, an owned Detox
 * process group, file IPC to the actual Jest child, then the shared connection
 * controller. Android must supply its real target producer and independent
 * cleanup ledger before any acquisition; iOS keeps the existing factories.
 */
export async function runOwnedDetoxConnectionAttempt(
  options: DetoxConnectionDriverOptions,
): Promise<DetoxConnectionAttemptResult> {
  const artifactRoot = requireArtifactRoot(options.artifactRoot);
  const artifactRootIdentity = await readArtifactRootIdentity(artifactRoot);
  const selection = requireDetoxConnectionSelection(options.selection);
  const signal = options.signal ?? new AbortController().signal;
  const deadlineMs = requireDeadline(options.deadlineMs);
  const attemptStartedAt = performance.now();
  const attemptDeadlineAt = options.deadlineAtMonotonicMs ?? attemptStartedAt + deadlineMs;
  assert(
    Number.isFinite(attemptDeadlineAt) && attemptDeadlineAt > attemptStartedAt,
    'Detox connection absolute deadline is invalid or elapsed',
  );
  const platform = selection.arguments.platform;
  if (options.trainingSelection) {
    requireDetoxTrainingSelection(options.trainingSelection);
    assert.equal(
      platform,
      'ios',
      'Detox training additive owner is iOS-only; Android uses its Maestro training producer',
    );
    assert.equal(
      options.trainingSelection.arguments.platform,
      platform,
      'Training and connection owner platforms differ',
    );
  }
  if (options.saveRetrySelection) {
    const freshSaveRetrySelection = await requireFreshDetoxSaveRetrySelection(
      options.repositoryRoot,
      requireDetoxSaveRetrySelection(options.saveRetrySelection),
    );
    assert.deepEqual(freshSaveRetrySelection, options.saveRetrySelection);
    assert.equal(
      freshSaveRetrySelection.arguments.platform,
      platform,
      'Save/retry and connection owner platforms differ',
    );
  }
  const androidProducer =
    platform === 'android'
      ? requireAndroidDetoxConnectionProducer(options.androidProducer)
      : undefined;
  const runtimeTimings = {
    build: 0,
    install: 0,
    reset: 0,
    scenario: 0,
    verify: 0,
    cleanup: 0,
  };
  const phaseElapsed = (startedAt: number): number =>
    Math.max(1, Math.ceil(performance.now() - startedAt));
  const buildStartedAt = performance.now();
  requireDetoxBuildInstrumentation(options.build, options.repositoryRoot);
  await inspectDetoxBuildForDriver(options.build, options.repositoryRoot);
  runtimeTimings.build = phaseElapsed(buildStartedAt);
  const runnerFiles = await validateDetoxConnectionRunnerPaths(
    options.repositoryRoot,
    options.runnerPaths,
  );
  const factories: DetoxBaselineFactories =
    platform === 'android'
      ? {
          ...(options.factories ?? ownedDetoxBaselineFactories),
          acquireOwnedTarget: androidProducer!.acquireOwnedTarget,
        }
      : (options.factories ?? ownedDetoxBaselineFactories);
  let reservation: OwnedReservation | undefined;
  let target: OwnedTarget | undefined;
  let session: OwnedSession | undefined;
  let proxy: OwnedProxy | undefined;
  let child: OwnedChild | undefined;
  let childCommand: ReturnType<typeof buildCommand> | undefined;
  let client: DetoxConnectionIpcClient | undefined;
  let trainingClient: DetoxTrainingChildClient | undefined;
  let saveRetryClient: DetoxSaveRetryChildClient | undefined;
  let ownedChildIdentity: DetoxConnectionOwnedProcessIdentity | undefined;
  const report = markOwnedProducerReport({
    kind: 'private-detox-connection-capture-not-public-receipt',
    nativePassingCases: 0,
    publicPromotionEligible: false,
    platform,
    output: artifactRoot,
    selection,
    observations: [],
    detoxConnectionObservations: [],
    detoxConnectionCommands: [],
    detoxRuntimeTimingsMs: runtimeTimings,
  });
  const cleanupResources = (
    reason: DetoxConnectionCleanupReason,
    cleanupSignal: AbortSignal,
    suppliedDeadlineAt?: number,
  ): Promise<DetoxConnectionCleanupResult> => {
    trainingClient?.close();
    const cleanupStartedAt = performance.now();
    return runDetoxConnectionDriverCleanup({
      artifactRoot,
      artifactRootIdentity,
      repositoryRoot: options.repositoryRoot,
      report,
      reason,
      signal: cleanupSignal,
      deadlineAt: suppliedDeadlineAt ?? performance.now() + CLEANUP_DEADLINE_MS,
      client,
      saveRetryClient,
      child,
      childCommand,
      proxy,
      session,
      target,
      reservation,
      androidCleanup:
        platform === 'android' && androidProducer && target
          ? async ({ signal: cleanupSignal, deadlineAt: cleanupDeadlineAt }) => {
              const acquiredTarget = target;
              if (
                !acquiredTarget?.androidRuntimeParent ||
                !acquiredTarget.androidSdkRoot ||
                acquiredTarget.platform !== 'android'
              )
                throw new Error('Android target cleanup identity is unavailable');
              const androidTarget = {
                platform: 'android' as const,
                deviceId: acquiredTarget.deviceId,
                androidRuntimeParent: acquiredTarget.androidRuntimeParent,
                androidSdkRoot: acquiredTarget.androidSdkRoot,
                ownership: acquiredTarget.ownership,
              };
              return androidProducer.verifyOwnedAndroidCleanup({
                repositoryRoot: options.repositoryRoot,
                artifactRoot,
                target: androidTarget,
                signal: cleanupSignal,
                deadlineAt: cleanupDeadlineAt,
              });
            }
          : undefined,
    }).then((result) => {
      runtimeTimings.cleanup = phaseElapsed(cleanupStartedAt);
      return result;
    });
  };
  const lifecycle: DetoxConnectionLifecycle = {
    acquire: async ({ signal: acquireSignal }): Promise<DetoxConnectionAcquiredSession> => {
      try {
        throwIfAborted(acquireSignal);
        if (
          options.parentEnv?.MYCHAMPIONS_NATIVE_HOST_LOCK_HELD !== '1' &&
          process.env.MYCHAMPIONS_NATIVE_HOST_LOCK_HELD !== '1'
        )
          throw new Error('Detox connection requires the existing native host lock');
        await ensureDetoxConnectionArtifactRoot(artifactRoot);
        await factories.requireNativeHostAvailability(artifactRoot);
        const acquiredReservation = await factories.reserveOwnedAppPort(options.build.metroPort);
        reservation = acquiredReservation;
        const resetStartedAt = performance.now();
        const acquiredTarget = await factories.acquireOwnedTarget({
          platform,
          artifactRoot,
          signal: acquireSignal,
        });
        target = acquiredTarget;
        await acquiredTarget.verify();
        runtimeTimings.reset = phaseElapsed(resetStartedAt);
        const resetReceipt =
          platform === 'ios'
            ? await publishDetoxResetReceipt(artifactRoot, platform, acquiredTarget.deviceId, {
                signal: acquireSignal,
                deadlineAtMonotonicMs: attemptDeadlineAt,
              })
            : undefined;
        report.target = {
          platform: acquiredTarget.platform,
          deviceId: acquiredTarget.deviceId,
          ownership: acquiredTarget.ownership,
          appId: options.build.appIdentifier,
          ...(resetReceipt
            ? {
                osVersion: resetReceipt.osVersion,
                reset: {
                  name: resetReceipt.name,
                  status: 'verified',
                  targetDeviceId: acquiredTarget.deviceId,
                  permissionState: 'not-applicable',
                  resetFingerprint: resetReceipt.resetFingerprint,
                },
              }
            : {}),
        };
        const installStartedAt = performance.now();
        if (platform === 'ios')
          await factories.verifyIosSimulatorApp(options.build.binaryPath, artifactRoot);
        runtimeTimings.install = phaseElapsed(installStartedAt);
        const acquiredSession = await factories.startOwnedSession({
          serverRoot: options.serverRoot,
          appOrigin: acquiredReservation.origin,
          signal: acquireSignal,
          deadlineMs,
        });
        session = acquiredSession;
        report.backend = {
          runId: acquiredSession.manifest.runId,
          apiOrigin: acquiredSession.apiOrigin,
          apiPid: acquiredSession.apiPid,
          manifestArtifactRoot: acquiredSession.manifest.artifactRoot,
        };
        const acquiredProxy = await factories.startOwnedApiProxy({
          session: acquiredSession,
          appOrigin: acquiredReservation.origin,
          requestProfile: 'native',
        });
        proxy = acquiredProxy;
        if (acquiredProxy.origin !== options.build.embeddedRuntime.apiOrigin)
          throw new Error('Detox embedded API origin differs from the owned proxy');
        const fixtures = await acquiredSession.fixtures(`native-entry-${platform}`);
        acquiredProxy.enableNativeAuthIdentityCapture(
          Object.values(fixtures.accounts).map((account) => account.authUid),
        );
        const command = buildCommand(options, artifactRoot);
        childCommand = command;
        child = await (options.startOwnedNativeCommand ?? startOwnedNativeCommand)({
          ...command,
          artifactRoot,
          label: 'detox-connection-child',
          env: childEnv(options, artifactRoot, platform, fixtures, runnerFiles),
          cwd: options.repositoryRoot,
          phase: 'step',
        });
        const childIdentity = await readOwnedChildIdentity(artifactRoot, child, attemptDeadlineAt);
        ownedChildIdentity = childIdentity;
        await writeAtomicDetoxConnectionBytes(
          artifactRoot,
          'detox-connection-child-identity.private.json',
          Buffer.from(
            JSON.stringify({
              kind: 'private-detox-connection-child-identity',
              ...childIdentity,
            }) + '\n',
          ),
          64 * 1024,
        );
        report.detoxChildIdentity = childIdentity;
        report.detoxProducerReceipt = {
          kind: 'private-detox-connection-producer-receipt',
          captureRunId: path.basename(artifactRoot),
          platform,
          childIdentity,
          sourceTreeHash: options.build.source.sourceTreeHash,
          helperInputsHash: options.build.helperInputsHash,
        };
        report.detoxTransportSource = [];
        report.detoxTransportSourceHash = hashJson([]);
        client = new DetoxConnectionIpcClient({
          artifactRoot,
          platform,
          signal: acquireSignal,
          deadlineMs,
          deadlineAtMonotonicMs: attemptDeadlineAt,
          expectedChild: childIdentity,
        });
        if (options.saveRetrySelection) {
          const saveRetryDeadlineMs = Math.ceil(attemptDeadlineAt - performance.now());
          assert(
            saveRetryDeadlineMs >= 1_000,
            'Detox save/retry deadline elapsed before the existing owner was ready',
          );
          saveRetryClient = new DetoxSaveRetryChildClient({
            artifactRoot,
            platform,
            signal: acquireSignal,
            deadlineMs: saveRetryDeadlineMs,
            deadlineAt: attemptDeadlineAt,
            expectedChild: childIdentity,
          });
        }
        if (options.trainingSelection) {
          trainingClient = new DetoxTrainingChildClient({
            artifactRoot,
            platform,
            runId: acquiredSession.manifest.runId,
            attemptId: `${acquiredSession.manifest.runId}:first`,
            signal: acquireSignal,
            deadlineAt: attemptDeadlineAt,
            deadlineMs,
            expectedChild: childIdentity,
          });
        }
        report.detoxChild = {
          pid: child.pid,
          pgid: child.pgid,
          command,
          cwd: options.repositoryRoot,
          ownership: 'owned-process-group',
        };
        const runtimeMetadata =
          options.build.environmentHash &&
          options.build.toolVersions &&
          options.build.toolVersionEvidence
            ? ({
                environmentHash: options.build.environmentHash,
                toolVersions: options.build.toolVersions,
                toolVersionEvidence: options.build.toolVersionEvidence,
              } satisfies DetoxRuntimeBuildMetadata)
            : null;
        report.build = {
          platform: options.build.platform,
          configuration: options.build.configuration,
          binaryPath: options.build.binaryPath,
          binaryHash: options.build.binaryHash,
          source: options.build.source,
          helperInputsHash: options.build.helperInputsHash,
          detoxConfigPath: options.build.detoxConfigPath,
          detoxConfigHash: options.build.detoxConfigHash,
          binaryReuse: options.build.binaryReuse,
          runnerPaths: options.runnerPaths,
          runnerPathHashes: {
            jestConfig: runnerFiles.jestConfig,
            test: runnerFiles.test,
            actionability: runnerFiles.actionability,
            hierarchy: runnerFiles.hierarchy,
            saveRetryActions: runnerFiles.saveRetryActions,
            saveRetryProtocol: runnerFiles.saveRetryProtocol,
          },
          dispatchRuntimeInputsHash: (
            options.build as DetoxBaselineBuildInstrumentation & {
              dispatchRuntimeInputsHash?: string;
            }
          ).dispatchRuntimeInputsHash,
          ...(runtimeMetadata ?? {}),
        };
        await waitForReady(artifactRoot, acquireSignal, attemptDeadlineAt, childIdentity);
        const context = contextWithDetoxIpc({
          base: baseContext({
            output: artifactRoot,
            fixtures,
            proxy: acquiredProxy,
            session: acquiredSession,
            report,
          }),
          client,
          platform,
          signal: acquireSignal,
          report,
        });
        report.fixtureHash = hashJson(fixtures);
        report.connectionApiIdentity = context.apiIdentity;
        report.target = {
          ...((report.target ?? {}) as Record<string, unknown>),
          apiOrigin: context.apiIdentity.targetOrigin,
        };
        const bootstrapCommand = {
          kind: 'bootstrap' as const,
          actor: 'coach' as const,
          navigation: 'none' as const,
          label: 'connection-bootstrap-coach',
          semanticActions: 'owned-detox-bootstrap-coach-sign-in',
          viewId: 'SCR-pro-home',
          selectors: 'pro.home.screen',
          selectorKind: 'id' as const,
        };
        const bootstrapResponse = await client.request(bootstrapCommand);
        const bootstrapFullCommand = requireDetoxConnectionCommand({
          schemaVersion: 1,
          commandId: bootstrapResponse.commandId,
          platform,
          ...bootstrapCommand,
          commandHash: bootstrapResponse.commandHash,
        });
        await consumeObservation(artifactRoot, report, bootstrapFullCommand, bootstrapResponse);
        const coachBoundary =
          platform === 'ios'
            ? requireIosConnectionSignInBoundary(acquiredProxy.observations, 0)
            : requireAndroidConnectionSignInBoundary(
                acquiredProxy.observations,
                acquiredProxy.nativeAuthIdentities,
                {
                  beforeRequestId: 0,
                  apiIdentity: context.apiIdentity,
                },
              );
        const fixtureAuthUids = Object.values(fixtures.accounts).map((account) => account.authUid);
        const coachAuthUid =
          platform === 'ios'
            ? requireIosConnectionActorIdentity(acquiredProxy.nativeAuthIdentities, {
                actorAuthUid: fixtures.accounts.coach.authUid,
                authRequestId: coachBoundary.authRequestId,
                apiIdentity: context.apiIdentity,
                fixtureAuthUids,
              })
            : requireAndroidConnectionActorIdentity(acquiredProxy.nativeAuthIdentities, {
                actorAuthUid: fixtures.accounts.coach.authUid,
                authRequestId: coachBoundary.authRequestId,
                apiIdentity: context.apiIdentity,
                fixtureAuthUids,
              });
        report.connectionInitialAuth = {
          actor: 'coach',
          actorAuthUid: coachAuthUid,
          ...coachBoundary,
        };
        const binding = buildBinding(artifactRoot, acquiredSession.manifest.runId, options.build);
        return {
          context,
          binding,
          cleanup: ({ reason, signal: cleanupSignal, deadlineAt }) =>
            cleanupResources(reason, cleanupSignal, deadlineAt),
        };
      } catch (error) {
        const cleanupController = new AbortController();
        let cleanup: DetoxConnectionCleanupResult;
        try {
          cleanup = await cleanupResources(
            acquireSignal.aborted ? 'cancelled' : 'acquisition-failed',
            cleanupController.signal,
            performance.now() + CLEANUP_DEADLINE_MS,
          );
        } catch (cleanupError) {
          cleanup = {
            status: 'failed',
            recoveryStatus: 'not-verified',
            failures: [cleanupError instanceof Error ? cleanupError.message : String(cleanupError)],
            recoveryRecordPath: path.join(artifactRoot, 'detox-connection-cleanup.private.json'),
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        const cleanupMessage = cleanup.failures.join('; ');
        const wrappedError = new Error(
          cleanupMessage
            ? `Detox acquisition failed; partial cleanup ${cleanup.status}: ${message}; ${cleanupMessage}`
            : `Detox acquisition failed; partial cleanup ${cleanup.status}: ${message}`,
          { cause: error },
        );
        Object.assign(wrappedError, { detoxCleanupStatus: cleanup.status });
        throw wrappedError;
      }
    },
  };
  const executeJourney = createDetoxConnectionJourneyExecutor({
    repositoryRoot: options.repositoryRoot,
    requestedRunId: path.basename(artifactRoot),
    observeConnectionJourney: async (context, journeyOptions) => {
      const journeyLifecycle = {
        signal: journeyOptions.signal,
        deadlineAtMonotonicMs: journeyOptions.deadlineAtMonotonicMs,
      };
      throwIfDriverDeadline(journeyLifecycle, 'journey observer start');
      const scenarioStartedAt = performance.now();
      if (platform === 'ios') await observeIosConnectionJourney(context as never, journeyOptions);
      else await observeAndroidConnectionJourney(context as never, journeyOptions);
      throwIfDriverDeadline(journeyLifecycle, 'journey observer completion');
      runtimeTimings.scenario = phaseElapsed(scenarioStartedAt);
      const actualReport = context.report as DriverReport;
      const acquiredProxy = context.proxy as OwnedProxy;
      await publishTransportSource(
        actualReport.output as string,
        acquiredProxy.observations,
        actualReport,
        journeyLifecycle,
      );
      throwIfDriverDeadline(journeyLifecycle, 'transport publication');
      const preparation = actualReport.connectionJourneyPreparation as Record<string, unknown>;
      actualReport.connectionJourneyPreparation = {
        ...preparation,
        transportSourceHash: actualReport.detoxTransportSourceHash,
      };
      const verifyStartedAt = performance.now();
      actualReport.detoxConnectionLedger = await buildDetoxConnectionLedgerFromActualReport(
        actualReport,
        platform,
      );
      if (platform === 'ios') await publishDetoxRuntimeOriginals(actualReport, journeyLifecycle);
      throwIfDriverDeadline(journeyLifecycle, 'runtime originals publication');
      runtimeTimings.verify = phaseElapsed(verifyStartedAt);
      if (options.saveRetrySelection) {
        assert(
          saveRetryClient && session && proxy && child && ownedChildIdentity,
          'Save/retry dispatch lost its existing owner handles',
        );
        await runDetoxSaveRetryOnExistingConnectionOwner({
          context,
          repositoryRoot: options.repositoryRoot,
          output: artifactRoot,
          selection: options.saveRetrySelection,
          session,
          proxy,
          saveRetryClient,
          ownerChild: child,
          childIdentity: ownedChildIdentity,
          signal: journeyOptions.signal,
          deadlineAt: journeyOptions.deadlineAtMonotonicMs,
          producerContext: {
            build: actualReport.build,
            runtimeMetadata: {
              environmentHash: (actualReport.build as Record<string, unknown>)?.environmentHash,
              toolVersions: (actualReport.build as Record<string, unknown>)?.toolVersions,
              toolVersionEvidence: (actualReport.build as Record<string, unknown>)
                ?.toolVersionEvidence,
            },
          },
        });
      }
      if (options.trainingSelection) {
        const trainingOwnedDispatch = await loadDetoxTrainingOwnedDispatch();
        assert(trainingClient, 'Training dispatch was selected without an existing child client');
        assert(session && proxy && child, 'Training dispatch lost its existing owner handles');
        const bridge: DetoxTrainingUiBridge = {
          runTrainingStep: (step, requestOptions) =>
            trainingClient!.runTrainingStep(step, requestOptions),
          restartApp: (restartOptions) => trainingClient!.restartApp(restartOptions),
          shutdown: async (shutdownOptions) => {
            await trainingClient!.shutdown(shutdownOptions);
            actualReport.detoxTrainingChildShutdown = true;
          },
        };
        await trainingOwnedDispatch.runDetoxTrainingOnExistingOwner({
          repositoryRoot: options.repositoryRoot,
          output: artifactRoot,
          selection: options.trainingSelection,
          fixtures: await session.fixtures(`native-entry-${platform}`),
          session,
          proxy,
          child: bridge,
          childIdentity: ownedChildIdentity as DetoxConnectionOwnedProcessIdentity,
          signal: journeyOptions.signal,
          deadlineAt: journeyOptions.deadlineAtMonotonicMs,
          report: actualReport,
        });
        throwIfDriverDeadline(journeyLifecycle, 'additive journey publication');
      }
      throwIfDriverDeadline(journeyLifecycle, 'journey publication');
    },
  });
  return runDetoxIntegratedConnectionBaseline({
    repositoryRoot: options.repositoryRoot,
    selection,
    environment: Object.fromEntries(
      [
        'EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE',
        'EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD',
        'EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE',
        'EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE',
        'EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE',
      ].map((key) => [key, (options.parentEnv ?? process.env)[key]]),
    ) as DetoxConnectionFixtureEnvironment,
    signal,
    deadlineMs,
    deadlineAtMonotonicMs: attemptDeadlineAt,
    lifecycle,
    executeJourney,
  });
}
