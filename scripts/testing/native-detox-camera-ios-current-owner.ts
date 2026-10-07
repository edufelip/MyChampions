import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { runDetoxCleanupAggregate, runDetoxCleanupStep } from './detox-connection-lifecycle';
import { buildDetoxVerifiedBinaryEnvironment } from './detox-integrated-connection-driver';
import {
  ownedDetoxBaselineFactories,
  type DetoxBaselineBuildInstrumentation,
  type DetoxBaselineFactories,
  type DetoxOwnedTarget,
} from './detox-integrated-session-baseline';
import { requireIntegratedLoopbackOrigin } from './integration-preflight';
import {
  readOwnedIosCameraPermission,
  verifyOwnedIosInstalledApp,
  type IosCameraPermissionObservation,
  type IosInstalledAppObservation,
} from './native-camera-observation';
import {
  DETOX_CAMERA_AUTH_OBSERVATION_PHASES,
  requireDetoxCameraBootstrapEvidence,
  type DetoxCameraAuthObservation,
  type DetoxCameraBootstrapEvidence,
  type DetoxCameraCleanup,
  type DetoxCameraOwnerIdentity,
  type DetoxCameraSqlProjection,
  type DetoxCameraSubmission,
  type DetoxCameraTransportObservation,
} from './native-detox-camera-ios-contract';
import {
  writeOwnedExclusive,
  type DetoxCameraEvidenceLifecycle,
} from './native-detox-camera-ios-evidence';
import {
  IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS,
  readOwnedIosDetoxCameraRunnerInputs,
  rereadOwnedIosDetoxCameraRunnerInputs,
  stageOwnedIosDetoxCameraRunnerInputs,
  type IosDetoxCameraRunnerInputIdentity,
  type IosDetoxCameraRunnerInputPaths,
} from './native-detox-camera-ios-inputs';
import {
  DetoxCameraIpcClient,
  requireDetoxCameraBootstrapResponse,
  requireDetoxCameraBootstrapPendingResponse,
  type DetoxCameraBootstrapReceipt,
  type DetoxCameraChildIdentity,
} from './native-detox-camera-ios-ipc';
import {
  DetoxCameraAcquisitionError,
  type DetoxCameraAcquisitionFailure,
  type DetoxCameraOwner,
  type DetoxCameraAcquiredRuntime,
  type DetoxCameraRuntimeFacts,
  type DetoxCameraJestListTestsFailure,
} from './native-detox-camera-ios-owner';
import {
  runOwnedDetoxCameraRemoteServicePrompt,
  type DetoxCameraRemoteServiceOwnerConfig,
} from './native-detox-camera-ios-remote-service-route';
import { type DetoxRuntimeQualifiedBuild } from './native-detox-connection-public-dispatch';
import {
  executeOwnedNativeCommand,
  OwnedNativeCommandAcquisitionError,
  startOwnedNativeCommand,
  type NativeCommandExecution,
} from './owned-native-command';
import {
  OwnedSessionAcquisitionError,
  type OwnedManifest,
  type OwnedSnapshotReceipt,
} from './owned-session';
import { nativeCameraPublicEvidenceBindings } from './run-native-pilot';
import type { OwnedConnectionSnapshot } from './native-connection-snapshot';
import type {
  NativeAuthIdentityObservation,
  NativeRequestBodyCaptureReceipt,
  ProxyObservation,
} from './owned-api-proxy';

export type CurrentOwnerOptions = Readonly<{
  currentRoot: string;
  repositoryRoot: string;
  serverRoot: string;
  artifactRoot: string;
  stageRoot: string;
  /** Original aggregate deadline in the monotonic clock domain. */
  deadlineAtMonotonicMs: number;
  /** Epoch deadline retained only for legacy child and IPC contracts. */
  deadlineAt: number;
  buildElapsedMs: number;
  signal: AbortSignal;
  build: DetoxRuntimeQualifiedBuild;
  configuration: DetoxBaselineBuildInstrumentation['configuration'];
  detoxBaseConfigPath: string;
  detoxConfigPath: string;
  jestConfigPath: string;
  cameraTestPath: string;
  childSourcePath: string;
  childSourceSha256: string;
  helperInputsHash: string;
  declarationHash: string;
  parentEnv?: Readonly<Record<string, string | undefined>>;
  /** Private failure-injection seam; production uses the guarded defaults. */
  factories?: DetoxBaselineFactories;
  /** Private inventory seam; production reads the real simulator inventory. */
  readSimulatorRuntime?: (deviceId: string, signal: AbortSignal) => Promise<string>;
  /** Optional reviewed XCTest prompt helper, invoked after bootstrap IPC only. */
  remoteServicePrompt?: DetoxCameraRemoteServiceOwnerConfig;
}>;

type ChildLedgerRow = {
  pid: number;
  pgid: number;
  started: string;
};

type ChildLedger = {
  processes?: readonly ChildLedgerRow[];
};

const DETOX_CAMERA_JEST_LIST_TESTS_RECEIPT = 'detox-camera-jest-list-tests.private.json';
const DETOX_CAMERA_JEST_SELECTION_RECEIPT = 'detox-camera-jest-selection.private.json';

type OwnedReservation = Awaited<ReturnType<DetoxBaselineFactories['reserveOwnedAppPort']>>;
type OwnedProxy = Awaited<ReturnType<DetoxBaselineFactories['startOwnedApiProxy']>>;
type OwnedSession = Awaited<ReturnType<DetoxBaselineFactories['startOwnedSession']>>;
type OwnedExpo = Awaited<ReturnType<DetoxBaselineFactories['startOwnedExpo']>>;
type OwnedChild = Awaited<ReturnType<typeof startOwnedNativeCommand>>;

type AcquisitionResourceRecord = {
  resource: string;
  status: 'acquired' | 'unknown';
  identity: Record<string, unknown> | null;
  failure?: DetoxCameraAcquisitionFailure;
};

type DetoxCameraFixtureEvidence = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  source: 'owned-session.fixtures';
  runId: string;
  scope: string;
}>;

type DetoxCameraSnapshotScope = 'native-entry-ios' | 'native-connection-isolation-ios';

function boundedFailureMessage(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .slice(0, 240)
    .replace(/(?:password|token|secret|authorization|cookie|invite)[^\s]*/gi, '[redacted]');
}

async function resolveOwnedYarnCli(): Promise<string> {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'yarn')].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  for (const candidate of candidates) {
    try {
      const canonical = await realpath(candidate);
      const metadata = await lstat(canonical);
      if (metadata.isFile() && !metadata.isSymbolicLink()) return canonical;
    } catch {
      // Try the next installation-local candidate without falling back to a
      // PATH-resolved shebang wrapper.
    }
  }
  throw new Error('Owned Detox requires a canonical Yarn CLI');
}

async function resolveOwnedJestCli(nodeModulesRoot: string): Promise<string> {
  const candidate = join(nodeModulesRoot, 'jest', 'bin', 'jest.js');
  const canonical = await realpath(candidate);
  const relativePath = relative(nodeModulesRoot, canonical);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\') ||
    isAbsolute(relativePath) ||
    canonical !== candidate
  )
    throw new Error('Detox camera Jest CLI is outside the owned node module root');
  const metadata = await lstat(canonical);
  const uid = process.getuid?.();
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (uid !== undefined && metadata.uid !== uid) ||
    (metadata.mode & 0o022) !== 0
  )
    throw new Error('Detox camera Jest CLI is not an owned non-writable file');
  return canonical;
}

function recordFromManifest(manifest: OwnedManifest | undefined): Record<string, unknown> | null {
  if (!manifest) return null;
  return {
    phase: manifest.phase,
    runId: manifest.runId,
    repoRoot: manifest.repoRoot,
    runtimeRoot: manifest.runtimeRoot,
    artifactRoot: manifest.artifactRoot,
    ownerTokenHash: manifest.ownerTokenHash,
    orchestratorPid: manifest.orchestratorPid,
    composeProject: manifest.composeProject,
    port: manifest.port,
    targets: manifest.targets,
    fixtureScopes: manifest.fixtureScopes,
    processes: manifest.processes,
  };
}

type PrivateNativeFailurePaths = Readonly<{
  valid: boolean;
  logPath: string | null;
  stdoutPath: string | null;
  ownershipPath: string | null;
}>;

function projectPrivateNativeFailurePaths(
  artifactRoot: string,
  paths: Readonly<{
    logPath: string | null;
    stdoutPath: string | null;
    ownershipPath: string | null;
  }>,
): PrivateNativeFailurePaths {
  const root = resolve(artifactRoot);
  const project = (candidate: string | null): { valid: boolean; value: string | null } => {
    if (candidate === null) return { valid: true, value: null };
    if (!isAbsolute(candidate) || candidate.includes('\0')) return { valid: false, value: null };
    const value = relative(root, resolve(candidate));
    if (
      !value ||
      value === '.' ||
      value === '..' ||
      value.startsWith('../') ||
      isAbsolute(value) ||
      value.includes('/') ||
      value.includes('\\') ||
      value.length > 160
    )
      return { valid: false, value: null };
    return { valid: true, value };
  };
  const log = project(paths.logPath);
  const stdout = project(paths.stdoutPath);
  const ownership = project(paths.ownershipPath);
  return {
    valid: log.valid && stdout.valid && ownership.valid,
    logPath: log.value,
    stdoutPath: stdout.value,
    ownershipPath: ownership.value,
  };
}

/**
 * Project a failed Jest preflight into the camera acquisition boundary while
 * retaining the command's real execution/cleanup facts. A cleaned preflight
 * is a known-clean subordinate resource; the camera acquisition still fails
 * because no valid selection or Detox child was produced.
 */
export function projectDetoxCameraJestListTestsFailure(
  artifactRoot: string,
  error: DetoxCameraJestListTestsExecutionError,
): DetoxCameraAcquisitionFailure {
  const execution = error.execution;
  const paths = projectPrivateNativeFailurePaths(artifactRoot, execution);
  const projectedExecution: NativeCommandExecution = {
    ...execution,
    logPath: paths.logPath,
    stdoutPath: paths.stdoutPath,
    ownershipPath: paths.ownershipPath,
  };
  const cleanupStatus: DetoxCameraJestListTestsFailure['cleanupStatus'] =
    execution.cleanup === 'cleaned' &&
    error.ownershipProof === 'validated-empty-final-census' &&
    paths.valid
      ? 'cleaned'
      : 'uncertain';
  const diagnostics = error.failure?.message ?? error.message;
  return {
    resource: 'detox',
    acquisitionPhase: execution.pid === null ? 'validation' : 'spawned',
    // The camera resource was never acquired. Keep an actual preflight
    // process failure recovery-retained at the outer boundary even when the
    // subordinate command proves clean; the nested preflight status carries
    // the stronger fact without promoting the camera attempt.
    cleanup:
      execution.pid === null && execution.cleanup === 'not-acquired'
        ? 'not-acquired'
        : 'failed-recovery-ledger-retained',
    childExitCode: execution.childExitCode,
    childSignal: execution.childSignal,
    pid: execution.pid,
    pgid: execution.pgid,
    orchestrator: null,
    manifest: null,
    closed: null,
    diagnostics: boundedFailureMessage(diagnostics),
    unknownHandle: cleanupStatus !== 'cleaned',
    artifactPathsLexicallyValidated: paths.valid,
    logPath: paths.logPath,
    stdoutPath: paths.stdoutPath,
    ownershipPath: paths.ownershipPath,
    preflight: {
      kind: 'detox-ios-camera-jest-list-tests-failure',
      command: {
        command: error.command.command,
        argv: [...error.command.argv],
        cwd: error.command.cwd,
      },
      execution: projectedExecution,
      runnerInputsSha256: error.runnerInputsSha256,
      cameraTestPath: error.cameraTestPath,
      cameraTestSha256: error.cameraTestSha256,
      ownershipProof: error.ownershipProof,
      cleanupStatus,
      artifactPathsLexicallyValidated: paths.valid,
      failure: error.failure,
    },
    error: { name: error.name, message: boundedFailureMessage(error) },
  };
}

function describeAcquisitionFailure(
  resource: string,
  error: unknown,
  artifactRoot: string,
  phase: DetoxCameraAcquisitionFailure['acquisitionPhase'] = 'unknown',
  unknownHandle = true,
): DetoxCameraAcquisitionFailure {
  const message = boundedFailureMessage(error);
  if (error instanceof OwnedSessionAcquisitionError) {
    return {
      resource,
      acquisitionPhase: error.pid === undefined ? 'pre-spawn' : 'spawned',
      cleanup:
        error.cleanup === 'not-acquired' ? 'not-acquired' : 'failed-recovery-ledger-retained',
      childExitCode: error.childExitCode,
      childSignal: null,
      pid: error.pid ?? null,
      pgid: error.pid ?? null,
      orchestrator: error.orchestrator ? { ...error.orchestrator } : null,
      manifest: recordFromManifest(error.manifest),
      closed: error.closed ? { ...error.closed } : null,
      diagnostics: boundedFailureMessage(error.diagnostics),
      unknownHandle: error.pid !== undefined || error.cleanup !== 'not-acquired',
      artifactPathsLexicallyValidated: true,
      logPath: null,
      stdoutPath: null,
      ownershipPath: null,
      error: { name: error.name, message },
    };
  }
  if (error instanceof DetoxCameraJestListTestsExecutionError)
    return projectDetoxCameraJestListTestsFailure(artifactRoot, error);
  if (error instanceof OwnedNativeCommandAcquisitionError) {
    const paths = projectPrivateNativeFailurePaths(artifactRoot, error);
    return {
      resource,
      acquisitionPhase: 'spawned',
      cleanup: 'failed-recovery-ledger-retained',
      childExitCode: null,
      childSignal: null,
      pid: error.pid,
      pgid: error.pgid,
      orchestrator: null,
      manifest: null,
      closed: null,
      diagnostics: paths.valid
        ? message
        : `${message}; native artifact path lexical validation failed`,
      unknownHandle: true,
      artifactPathsLexicallyValidated: paths.valid,
      logPath: paths.logPath,
      stdoutPath: paths.stdoutPath,
      ownershipPath: paths.ownershipPath,
      error: { name: error.name, message },
    };
  }
  return {
    resource,
    acquisitionPhase: phase,
    cleanup: 'failed-recovery-ledger-retained',
    childExitCode: null,
    childSignal: null,
    pid: null,
    pgid: null,
    orchestrator: null,
    manifest: null,
    closed: null,
    diagnostics: message,
    unknownHandle,
    artifactPathsLexicallyValidated: true,
    logPath: null,
    stdoutPath: null,
    ownershipPath: null,
    error: {
      name: error instanceof Error ? error.name : 'UnknownError',
      message,
    },
  };
}

export function observeDetoxCameraChildOutcome(
  child: OwnedChild | undefined,
): Record<string, unknown> {
  if (!child) return { status: 'unknown', reason: 'no-owned-child-handle' };
  try {
    const outcome = child.outcome();
    if (outcome.code === null && outcome.signal === null)
      return { status: 'unknown', reason: 'child-exit-not-observed' };
    return {
      status: 'observed',
      code: outcome.code,
      signal: outcome.signal,
    };
  } catch (error) {
    return { status: 'unknown', reason: boundedFailureMessage(error) };
  }
}

const execute = promisify(execFile);

const CREATE_PRIVATE_STAGE_DIRECTORY_SCRIPT = String.raw`
import json
import os
import stat
import sys

root = sys.argv[2]
name = sys.argv[3]
expected = json.loads(sys.argv[4])
if not name or '/' in name or name in ('.', '..'):
    raise RuntimeError('stage directory name is not a direct child')
flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_NOFOLLOW', 0)
if not getattr(os, 'O_DIRECTORY', 0) or not getattr(os, 'O_NOFOLLOW', 0):
    raise RuntimeError('descriptor directory flags are unavailable')

def identity(value):
    return {
        'dev': value.st_dev,
        'ino': value.st_ino,
        'uid': value.st_uid,
        'gid': value.st_gid,
        'mode': stat.S_IMODE(value.st_mode),
    }

root_fd = os.open(root, flags)
try:
    opened = identity(os.fstat(root_fd))
    if opened != expected:
        raise RuntimeError('opened artifact root identity differs from preflight')
    try:
        os.mkdir(name, 0o700, dir_fd=root_fd)
    except FileExistsError:
        pass
    if identity(os.fstat(root_fd)) != opened:
        raise RuntimeError('artifact root changed during stage directory creation')
finally:
    os.close(root_fd)
`;

async function readSimulatorRuntime(deviceId: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const { stdout } = await execute('xcrun', ['simctl', 'list', 'devices', '--json'], {
    timeout: 15_000,
    signal,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed: unknown = JSON.parse(stdout);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Detox camera simulator inventory is malformed');
  const devices = (parsed as { devices?: unknown }).devices;
  if (!devices || typeof devices !== 'object' || Array.isArray(devices))
    throw new Error('Detox camera simulator inventory is unavailable');
  for (const [runtime, rows] of Object.entries(devices)) {
    if (!Array.isArray(rows)) throw new Error('Detox camera simulator inventory rows are invalid');
    if (
      rows.some(
        (row) =>
          row &&
          typeof row === 'object' &&
          !Array.isArray(row) &&
          (row as { udid?: unknown }).udid === deviceId,
      )
    ) {
      return runtime;
    }
  }
  throw new Error('Detox camera simulator runtime was not found for the owned target');
}

async function captureIosDevices(
  artifactRoot: string,
  signal: AbortSignal,
  lifecycle: DetoxCameraEvidenceLifecycle,
): Promise<void> {
  signal.throwIfAborted();
  const remainingMs = Math.max(1, Math.ceil(lifecycle.deadlineAtMonotonicMs - performance.now()));
  const { stdout } = await execute('xcrun', ['simctl', 'list', 'devices', '--json'], {
    timeout: Math.min(15_000, remainingMs),
    maxBuffer: 4 * 1024 * 1024,
    signal,
  });
  const parsed = JSON.parse(stdout) as { devices?: unknown };
  if (!parsed.devices || typeof parsed.devices !== 'object' || Array.isArray(parsed.devices))
    throw new Error('Detox camera iOS device inventory is invalid');
  await writeOwnedExclusive(
    artifactRoot,
    'after-ios-devices.private.json',
    Buffer.from(stdout),
    lifecycle,
  );
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function detoxCameraCaptureNamespace(artifactRoot: string): {
  platform: 'ios';
  mode: 'integration';
  captureRunId: string;
  captureRoot: string;
} {
  const captureRoot = resolve(artifactRoot);
  return {
    platform: 'ios',
    mode: 'integration',
    captureRunId: basename(captureRoot),
    captureRoot,
  };
}

function hashBytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function assertLive(signal: AbortSignal, deadlineAt: number): void {
  signal.throwIfAborted();
  if (Date.now() >= deadlineAt) throw new Error('Detox camera owner deadline exceeded');
}

function assertMonotonicLive(signal: AbortSignal, deadlineAtMonotonicMs: number): void {
  signal.throwIfAborted();
  if (!Number.isFinite(deadlineAtMonotonicMs) || performance.now() >= deadlineAtMonotonicMs)
    throw new Error('Detox camera owner monotonic deadline exceeded');
}

function detoxChildCensusSettle(untilMonotonicMs: number, signal: AbortSignal) {
  return {
    untilMonotonicMs,
    signal,
    delayMs: 50,
    maxRequeries: 1,
  } as const;
}

function remainingDeadlineMs(deadlineAt: number): number {
  const remaining = Math.ceil(deadlineAt - Date.now());
  if (!Number.isSafeInteger(remaining) || remaining < 1000)
    throw new Error('Detox camera owner aggregate deadline is exhausted');
  return Math.min(600_000, remaining);
}

export function resolveDetoxCameraNodeEnvironment(
  value: string | undefined,
): 'development' | 'production' | 'test' {
  if (value === undefined) return 'test';
  if (value === 'development' || value === 'production' || value === 'test') return value;
  throw new Error('Detox camera owner requires NODE_ENV to be development, production, or test');
}

type PrivateDirectoryIdentity = Readonly<{
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
}>;

function directoryIdentity(metadata: {
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
}): PrivateDirectoryIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    mode: metadata.mode,
  };
}

function samePrivateDirectoryIdentity(
  left: PrivateDirectoryIdentity,
  right: PrivateDirectoryIdentity,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    (left.mode & 0o777) === (right.mode & 0o777)
  );
}

function requirePrivateDirectory(
  metadata: {
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    dev: number;
    ino: number;
    gid: number;
    mode: number;
    uid: number;
  },
  label: string,
): PrivateDirectoryIdentity {
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
  )
    throw new Error(`${label} is not an owned private 0700 directory`);
  return directoryIdentity(metadata);
}

async function requireOwnedNodeModulesRoot(repositoryRoot: string): Promise<string> {
  const nodeModulesRoot = join(repositoryRoot, 'node_modules');
  if ((await realpath(nodeModulesRoot)) !== nodeModulesRoot)
    throw new Error('Detox camera node module root is not canonical');
  const metadata = await lstat(nodeModulesRoot);
  const uid = process.getuid?.();
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (uid !== undefined && metadata.uid !== uid) ||
    (metadata.mode & 0o022) !== 0
  )
    throw new Error('Detox camera node module root is not an owned non-writable directory');
  return nodeModulesRoot;
}

export type PrepareDetoxCameraStageDirectoryOptions = Readonly<{
  artifactRoot: string;
  stageRoot: string;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
  /** Test-only fence used to exercise ancestor replacement after mkdir. */
  afterStageDirectoryCreate?: () => void | Promise<void>;
}>;

/**
 * Validate the pre-created artifact root, then create and bind its direct
 * stage child without recursive pathname mkdir/chmod. The descriptor-backed
 * writer performs the final root check before every publication; this helper
 * closes the creation race and fails closed if the root path is swapped.
 */
export async function prepareDetoxCameraStageDirectory(
  options: PrepareDetoxCameraStageDirectoryOptions,
): Promise<{ artifactRoot: string; stageRoot: string }> {
  assertMonotonicLive(options.signal, options.deadlineAtMonotonicMs);
  const artifactRoot = resolve(options.artifactRoot);
  const stageRoot = resolve(options.stageRoot);
  if (dirname(stageRoot) !== artifactRoot)
    throw new Error('Detox camera stage root must be an owned direct child of the artifact root');
  const directoryFlags =
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0);
  if ((constants.O_DIRECTORY ?? 0) === 0 || (constants.O_NOFOLLOW ?? 0) === 0)
    throw new Error('Detox camera stage directory cannot enforce descriptor no-follow opens');
  const canonicalArtifactRoot = await realpath(artifactRoot);
  assertMonotonicLive(options.signal, options.deadlineAtMonotonicMs);
  if (canonicalArtifactRoot !== artifactRoot)
    throw new Error('Detox camera artifact root is not canonical');
  const artifactMetadata = await lstat(artifactRoot);
  assertMonotonicLive(options.signal, options.deadlineAtMonotonicMs);
  const expectedArtifact = requirePrivateDirectory(artifactMetadata, 'Detox camera artifact root');
  const artifactHandle = await open(artifactRoot, directoryFlags);
  try {
    assertMonotonicLive(options.signal, options.deadlineAtMonotonicMs);
    const openedArtifact = directoryIdentity(await artifactHandle.stat());
    if (!samePrivateDirectoryIdentity(openedArtifact, expectedArtifact))
      throw new Error('Detox camera artifact root changed before stage binding');
    const remainingMs = Math.max(1, Math.ceil(options.deadlineAtMonotonicMs - performance.now()));
    await execute(
      '/usr/bin/python3',
      [
        '-c',
        CREATE_PRIVATE_STAGE_DIRECTORY_SCRIPT,
        'detox-camera-stage-directory',
        artifactRoot,
        basename(stageRoot),
        JSON.stringify({
          ...expectedArtifact,
          mode: expectedArtifact.mode & 0o777,
        }),
      ],
      {
        timeout: Math.min(5_000, remainingMs),
        maxBuffer: 64 * 1024,
        signal: options.signal,
      },
    );
    assertMonotonicLive(options.signal, options.deadlineAtMonotonicMs);
    await options.afterStageDirectoryCreate?.();
    assertMonotonicLive(options.signal, options.deadlineAtMonotonicMs);
    const currentArtifactRoot = await realpath(artifactRoot);
    const currentArtifactMetadata = await lstat(artifactRoot);
    assertMonotonicLive(options.signal, options.deadlineAtMonotonicMs);
    if (
      currentArtifactRoot !== artifactRoot ||
      !samePrivateDirectoryIdentity(directoryIdentity(currentArtifactMetadata), openedArtifact)
    )
      throw new Error('Detox camera artifact root changed during stage binding');
    const canonicalStageRoot = await realpath(stageRoot);
    assertMonotonicLive(options.signal, options.deadlineAtMonotonicMs);
    if (canonicalStageRoot !== stageRoot || dirname(canonicalStageRoot) !== artifactRoot)
      throw new Error('Detox camera stage root is not a canonical direct child');
    const stageMetadata = await lstat(stageRoot);
    assertMonotonicLive(options.signal, options.deadlineAtMonotonicMs);
    const expectedStage = requirePrivateDirectory(stageMetadata, 'Detox camera stage root');
    const stageHandle = await open(stageRoot, directoryFlags);
    try {
      assertMonotonicLive(options.signal, options.deadlineAtMonotonicMs);
      const openedStage = directoryIdentity(await stageHandle.stat());
      if (!samePrivateDirectoryIdentity(openedStage, expectedStage))
        throw new Error('Detox camera stage root changed before use');
      const finalArtifactRoot = await realpath(artifactRoot);
      const finalArtifactMetadata = await lstat(artifactRoot);
      assertMonotonicLive(options.signal, options.deadlineAtMonotonicMs);
      if (
        finalArtifactRoot !== artifactRoot ||
        !samePrivateDirectoryIdentity(directoryIdentity(finalArtifactMetadata), openedArtifact)
      )
        throw new Error('Detox camera artifact root changed after stage binding');
    } finally {
      await stageHandle.close();
    }
    return { artifactRoot, stageRoot };
  } finally {
    await artifactHandle.close();
  }
}

async function readPrivateJson(filePath: string): Promise<unknown> {
  const metadata = await lstat(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.size > 1024 * 1024
  )
    throw new Error(`Detox camera owner receipt is not a bounded private file: ${filePath}`);
  const fd = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await fd.stat();
    if (
      opened.dev !== metadata.dev ||
      opened.ino !== metadata.ino ||
      opened.uid !== metadata.uid ||
      opened.gid !== metadata.gid ||
      opened.mode !== metadata.mode ||
      opened.nlink !== metadata.nlink ||
      opened.size !== metadata.size
    )
      throw new Error(`Detox camera owner receipt changed before reading: ${filePath}`);
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await fd.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0)
        throw new Error(`Detox camera owner receipt ended early: ${filePath}`);
      offset += read.bytesRead;
    }
    const after = await fd.stat();
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    )
      throw new Error(`Detox camera owner receipt changed while reading: ${filePath}`);
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } finally {
    await fd.close();
  }
}

async function readPrivateBytes(filePath: string): Promise<Buffer> {
  const metadata = await lstat(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.size > 16 * 1024 * 1024
  )
    throw new Error(`Detox camera owner output is not a bounded private file: ${filePath}`);
  const fd = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await fd.stat();
    if (
      opened.dev !== metadata.dev ||
      opened.ino !== metadata.ino ||
      opened.uid !== metadata.uid ||
      opened.gid !== metadata.gid ||
      opened.mode !== metadata.mode ||
      opened.nlink !== metadata.nlink ||
      opened.size !== metadata.size
    )
      throw new Error(`Detox camera owner output changed before reading: ${filePath}`);
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await fd.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0)
        throw new Error(`Detox camera owner output ended early: ${filePath}`);
      offset += read.bytesRead;
    }
    const after = await fd.stat();
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    )
      throw new Error(`Detox camera owner output changed while reading: ${filePath}`);
    return bytes;
  } finally {
    await fd.close();
  }
}

type OwnedNativeCommandOwnershipLedger = Readonly<{
  kind: 'private worker process ownership';
  pid: number;
  pgid: number;
  processes: readonly unknown[];
  escapedProcesses?: readonly unknown[];
  escapedSignals?: readonly unknown[];
  cleanupMode: 'step';
  cleanup: 'cleaned';
  rejectedCensus?: unknown;
  latestCensus: Readonly<{
    observedAt: string;
    strict: false;
    groupMembers: readonly unknown[];
    escapedCandidates: readonly unknown[];
  }>;
}>;

export type DetoxCameraJestListTestsOwnershipEvidence = Readonly<{
  schema: 'owned-native-command-ledger-v1';
  ownershipPath: string;
  pid: number;
  pgid: number;
  phase: 'step';
  cleanup: 'cleaned';
  logPath: string;
  stdoutPath: string;
  finalGroupMemberCount: 0;
  finalEscapedCandidateCount: 0;
}>;

function requireOwnershipIdentityRow(value: unknown, label: string): void {
  const commandHash =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as { commandHash?: unknown }).commandHash
      : undefined;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Number.isSafeInteger((value as { pid?: unknown }).pid) ||
    !Number.isSafeInteger((value as { pgid?: unknown }).pgid) ||
    typeof (value as { started?: unknown }).started !== 'string' ||
    !(value as { started: string }).started ||
    typeof commandHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(commandHash)
  )
    throw new Error(`Detox camera Jest list-tests ownership ${label} identity is invalid`);
}

function requirePrivateNativeArtifactPath(
  artifactRoot: string,
  candidate: string,
  expectedName: string,
  label: string,
): string {
  const root = resolve(artifactRoot);
  const expected = join(root, expectedName);
  if (candidate !== expected || !isAbsolute(candidate) || candidate.includes('\0'))
    throw new Error(`Detox camera Jest list-tests ownership ${label} path is not bound to the run`);
  return expected;
}

/**
 * The command helper's in-memory cleanup result is not a receipt. Before a
 * list-tests receipt can be published, descriptor-read the helper ledger and
 * bind its final census, identities, phase, and private output paths to the
 * exact execution that produced the bytes. Any malformed, stale, missing, or
 * symlinked ledger remains available as recovery evidence and fails closed.
 */
export async function validateDetoxCameraJestListTestsOwnership(input: {
  artifactRoot: string;
  execution: Readonly<{
    phase: 'step';
    execution: 'completed';
    cleanup: 'cleaned';
    pid: number;
    pgid: number;
    childExitCode: 0;
    childSignal: null;
    logPath: string;
    stdoutPath: string;
    ownershipPath: string;
  }>;
}): Promise<DetoxCameraJestListTestsOwnershipEvidence> {
  const ownershipPath = requirePrivateNativeArtifactPath(
    input.artifactRoot,
    input.execution.ownershipPath,
    'detox-camera-jest-list-tests.ownership.json',
    'ownership',
  );
  const logPath = requirePrivateNativeArtifactPath(
    input.artifactRoot,
    input.execution.logPath,
    'detox-camera-jest-list-tests.private.log',
    'log',
  );
  const stdoutPath = requirePrivateNativeArtifactPath(
    input.artifactRoot,
    input.execution.stdoutPath,
    'detox-camera-jest-list-tests.stdout.private',
    'stdout',
  );
  const value = await readPrivateJson(ownershipPath);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Detox camera Jest list-tests ownership ledger is malformed');
  const ledger = value as Partial<OwnedNativeCommandOwnershipLedger>;
  if (
    ledger.kind !== 'private worker process ownership' ||
    ledger.pid !== input.execution.pid ||
    ledger.pgid !== input.execution.pgid ||
    ledger.cleanupMode !== input.execution.phase ||
    ledger.cleanup !== input.execution.cleanup ||
    !Array.isArray(ledger.processes) ||
    ledger.processes.length === 0 ||
    !ledger.latestCensus ||
    typeof ledger.latestCensus !== 'object' ||
    Array.isArray(ledger.latestCensus) ||
    ledger.latestCensus.strict !== false ||
    !Array.isArray(ledger.latestCensus.groupMembers) ||
    !Array.isArray(ledger.latestCensus.escapedCandidates) ||
    ledger.latestCensus.groupMembers.length !== 0 ||
    ledger.latestCensus.escapedCandidates.length !== 0 ||
    !Array.isArray(ledger.escapedProcesses ?? []) ||
    (ledger.escapedProcesses ?? []).length !== 0 ||
    !Array.isArray(ledger.escapedSignals ?? []) ||
    (ledger.escapedSignals ?? []).length !== 0 ||
    (ledger.rejectedCensus !== undefined && ledger.rejectedCensus !== null)
  )
    throw new Error(
      'Detox camera Jest list-tests ownership ledger does not prove a cleaned empty final census',
    );
  const latestCensusAt = Date.parse(ledger.latestCensus.observedAt);
  if (
    !/^\d{4}-\d{2}-\d{2}T/.test(ledger.latestCensus.observedAt) ||
    !Number.isFinite(latestCensusAt) ||
    latestCensusAt > Date.now() + 5_000 ||
    Date.now() - latestCensusAt > 10 * 60_000
  )
    throw new Error('Detox camera Jest list-tests ownership census timestamp is invalid');
  let leaderSeen = false;
  for (const row of ledger.processes) {
    requireOwnershipIdentityRow(row, 'process');
    const identity = row as { pid: number; pgid: number };
    if (identity.pgid !== input.execution.pgid)
      throw new Error('Detox camera Jest list-tests ownership process escaped its PGID');
    if (identity.pid === input.execution.pid && identity.pgid === input.execution.pgid)
      leaderSeen = true;
  }
  if (!leaderSeen)
    throw new Error('Detox camera Jest list-tests ownership ledger lost the acquired leader');
  // Validate the output descriptors now, while the ledger path and all three
  // artifacts are still bound to the same private run directory.
  await readPrivateBytes(logPath);
  await readPrivateBytes(stdoutPath);
  return {
    schema: 'owned-native-command-ledger-v1',
    ownershipPath,
    pid: input.execution.pid,
    pgid: input.execution.pgid,
    phase: input.execution.phase,
    cleanup: input.execution.cleanup,
    logPath,
    stdoutPath,
    finalGroupMemberCount: 0,
    finalEscapedCandidateCount: 0,
  };
}
async function waitForChildIdentity(
  filePath: string,
  pid: number,
  pgid: number,
  deadlineAt: number,
  signal: AbortSignal,
): Promise<DetoxCameraChildIdentity> {
  while (Date.now() < deadlineAt) {
    assertLive(signal, deadlineAt);
    try {
      const value = await readPrivateJson(filePath);
      const ledger = parseChildLedger(value);
      const leader = ledger.processes?.find((row) => row.pid === pid && row.pgid === pgid);
      if (leader && leader.started.length > 0) return { pid, pgid, startedAt: leader.started };
    } catch (error: unknown) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
        throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error('Detox camera child ownership ledger did not publish a start identity');
}

function requireOwnedDetoxChildRunning(child: OwnedChild, phase: string): void {
  const outcome = child.outcome();
  if (outcome.code !== null || outcome.signal !== null)
    throw new Error(
      `Detox camera child terminated before ${phase}: code=${outcome.code ?? 'null'}, signal=${outcome.signal ?? 'null'}`,
    );
}

function isMissingPrivateReceipt(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT',
  );
}

async function requirePrivateReceiptAbsent(
  filePath: string,
  label = 'Detox camera Jest selection receipt',
): Promise<void> {
  try {
    await lstat(filePath);
  } catch (error) {
    if (isMissingPrivateReceipt(error)) return;
    throw error;
  }
  throw new Error(`${label} already exists before child launch`);
}

export type DetoxCameraJestListTestsReceipt = Readonly<{
  schema: 'detox-ios-camera-jest-list-tests-v1';
  runnerInputsSha256: string;
  cameraTestPath: string;
  cameraTestSha256: string;
  selectedTestPath: string;
  selectedTestCount: 1;
  stdoutSha256: string;
  stderrSha256: string;
  command: Readonly<{
    command: string;
    argv: readonly string[];
    cwd: string;
  }>;
  execution: Readonly<{
    phase: 'step';
    execution: 'completed';
    cleanup: 'cleaned';
    pid: number;
    pgid: number;
    childExitCode: 0;
    childSignal: null;
    logPath: string;
    stdoutPath: string;
    ownershipPath: string;
  }>;
  ownershipEvidence: DetoxCameraJestListTestsOwnershipEvidence;
}>;

type DetoxCameraJestSelectionReceipt = Readonly<{
  schema: 'detox-ios-camera-jest-selection-v1';
  phase: 'module-executed';
  moduleLoaded: true;
  runnerInputsSha256: string;
  cameraTestPath: string;
  cameraTestSha256: string;
  selectedTestCount: 1;
}>;

type DetoxCameraJestListTestsOutput = Readonly<{
  stdout: string;
  stderr: string;
  command: Readonly<{
    command: string;
    argv: readonly string[];
    cwd: string;
  }>;
  runnerInputsSha256: string;
  cameraTestPath: string;
  cameraTestSha256: string;
  execution: DetoxCameraJestListTestsReceipt['execution'];
  ownershipEvidence: DetoxCameraJestListTestsOwnershipEvidence;
}>;

type DetoxCameraJestListTestsCommand = Readonly<{
  command: string;
  argv: readonly string[];
  cwd: string;
}>;

/**
 * The protected Jest selection command can fail after its owned process has
 * already been started and cleaned. Keep the real command execution receipt
 * attached to the failure so the outer camera owner can distinguish clean
 * preflight teardown from an unknown process handle. This error never carries
 * a selection receipt: callers must still treat the camera attempt as blocked.
 */
export class DetoxCameraJestListTestsExecutionError extends Error {
  readonly command: DetoxCameraJestListTestsCommand;
  readonly execution: NativeCommandExecution;
  readonly runnerInputsSha256: string;
  readonly cameraTestPath: string;
  readonly cameraTestSha256: string;
  readonly ownershipProof: DetoxCameraJestListTestsFailure['ownershipProof'];
  readonly failure: { name: string; message: string } | null;

  constructor(input: {
    command: DetoxCameraJestListTestsCommand;
    execution: NativeCommandExecution;
    runnerInputsSha256: string;
    cameraTestPath: string;
    cameraTestSha256: string;
    ownershipProof?: DetoxCameraJestListTestsFailure['ownershipProof'];
    failure?: unknown;
  }) {
    const failure =
      input.failure === undefined
        ? null
        : {
            name: input.failure instanceof Error ? input.failure.name : 'PreflightValidationError',
            message: boundedFailureMessage(input.failure),
          };
    super(
      `Detox camera Jest --listTests preflight failed: execution=${input.execution.execution}, cleanup=${input.execution.cleanup}${failure ? `; ${failure.message}` : ''}`,
    );
    this.name = 'DetoxCameraJestListTestsExecutionError';
    this.command = input.command;
    this.execution = input.execution;
    this.runnerInputsSha256 = input.runnerInputsSha256;
    this.cameraTestPath = input.cameraTestPath;
    this.cameraTestSha256 = input.cameraTestSha256;
    this.ownershipProof = input.ownershipProof ?? 'unproven';
    this.failure = failure;
  }
}

export function parseDetoxCameraJestListTestsOutput(
  input: DetoxCameraJestListTestsOutput,
): DetoxCameraJestListTestsReceipt {
  if (
    !/^[a-f0-9]{64}$/.test(input.runnerInputsSha256) ||
    !/^[a-f0-9]{64}$/.test(input.cameraTestSha256) ||
    !isAbsolute(input.cameraTestPath) ||
    !isAbsolute(input.command.cwd)
  )
    throw new Error('Detox camera Jest list-tests provenance is incomplete');
  const output = input.stdout.trim();
  if (!output) throw new Error('Detox camera Jest --listTests output is missing');
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch {
    throw new Error('Detox camera Jest --listTests output is mixed or invalid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0] !== 'string')
    throw new Error('Detox camera Jest --listTests did not select exactly one test');
  const selectedTestPath = parsed[0];
  if (resolve(selectedTestPath) !== resolve(input.cameraTestPath))
    throw new Error('Detox camera Jest --listTests selected a foreign test path');
  return {
    schema: 'detox-ios-camera-jest-list-tests-v1',
    runnerInputsSha256: input.runnerInputsSha256,
    cameraTestPath: input.cameraTestPath,
    cameraTestSha256: input.cameraTestSha256,
    selectedTestPath,
    selectedTestCount: 1,
    stdoutSha256: hashBytes(Buffer.from(input.stdout)),
    stderrSha256: hashBytes(Buffer.from(input.stderr)),
    command: input.command,
    execution: input.execution,
    ownershipEvidence: input.ownershipEvidence,
  };
}

export async function runDetoxCameraJestListTests(input: {
  nodeModulesRoot: string;
  currentRoot: string;
  artifactRoot: string;
  jestConfigPath: string;
  cameraTestPath: string;
  runnerInputsSha256: string;
  cameraTestSha256: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
}): Promise<DetoxCameraJestListTestsReceipt> {
  assertMonotonicLive(input.signal, input.deadlineAtMonotonicMs);
  const jestCli = await resolveOwnedJestCli(input.nodeModulesRoot);
  const argv = [jestCli, '--config', input.jestConfigPath, '--listTests', '--runInBand', '--json'];
  const command = {
    command: process.execPath,
    argv,
    cwd: input.currentRoot,
  } as const;
  const remainingMs = Math.min(600_000, Math.ceil(input.deadlineAtMonotonicMs - performance.now()));
  if (remainingMs < 100) throw new Error('Detox camera Jest list-tests deadline is exhausted');
  const execution = await executeOwnedNativeCommand({
    command: process.execPath,
    argv,
    cwd: input.currentRoot,
    artifactRoot: input.artifactRoot,
    label: 'detox-camera-jest-list-tests',
    env: input.env,
    phase: 'step',
    stdoutPath: join(input.artifactRoot, 'detox-camera-jest-list-tests.stdout.private'),
    deadlineMs: remainingMs,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    initialOwnershipDeadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    signal: input.signal,
  });
  if (
    execution.execution !== 'completed' ||
    execution.cleanup !== 'cleaned' ||
    execution.pid === null ||
    execution.pgid === null ||
    execution.childExitCode !== 0 ||
    execution.childSignal !== null ||
    execution.logPath === null ||
    execution.stdoutPath === null ||
    execution.ownershipPath === null
  )
    throw new DetoxCameraJestListTestsExecutionError({
      command,
      execution,
      runnerInputsSha256: input.runnerInputsSha256,
      cameraTestPath: input.cameraTestPath,
      cameraTestSha256: input.cameraTestSha256,
    });
  let ownershipProof: DetoxCameraJestListTestsFailure['ownershipProof'] = 'unproven';
  try {
    const ownershipEvidence = await validateDetoxCameraJestListTestsOwnership({
      artifactRoot: input.artifactRoot,
      execution: {
        phase: 'step',
        execution: 'completed',
        cleanup: 'cleaned',
        pid: execution.pid,
        pgid: execution.pgid,
        childExitCode: 0,
        childSignal: null,
        logPath: execution.logPath,
        stdoutPath: execution.stdoutPath,
        ownershipPath: execution.ownershipPath,
      },
    });
    ownershipProof = 'validated-empty-final-census';
    const stdout = await readPrivateBytes(ownershipEvidence.stdoutPath);
    const stderr = await readPrivateBytes(ownershipEvidence.logPath);
    assertMonotonicLive(input.signal, input.deadlineAtMonotonicMs);
    return parseDetoxCameraJestListTestsOutput({
      stdout: stdout.toString('utf8'),
      stderr: stderr.toString('utf8'),
      command,
      runnerInputsSha256: input.runnerInputsSha256,
      cameraTestPath: input.cameraTestPath,
      cameraTestSha256: input.cameraTestSha256,
      execution: {
        phase: 'step',
        execution: 'completed',
        cleanup: 'cleaned',
        pid: execution.pid,
        pgid: execution.pgid,
        childExitCode: 0,
        childSignal: null,
        logPath: ownershipEvidence.logPath,
        stdoutPath: ownershipEvidence.stdoutPath,
        ownershipPath: ownershipEvidence.ownershipPath,
      },
      ownershipEvidence,
    });
  } catch (error) {
    if (error instanceof DetoxCameraJestListTestsExecutionError) throw error;
    throw new DetoxCameraJestListTestsExecutionError({
      command,
      execution,
      runnerInputsSha256: input.runnerInputsSha256,
      cameraTestPath: input.cameraTestPath,
      cameraTestSha256: input.cameraTestSha256,
      ownershipProof,
      failure: error,
    });
  }
}

/**
 * Jest must have executed the one reviewed camera module before the owner can
 * send the first IPC command. The protected --listTests preflight proves
 * selection without running Detox; this receipt separately proves that the
 * real Detox Jest module passed globalSetup and TestEnvironment initialization.
 */
export async function waitForOwnedDetoxCameraJestSelection(input: {
  child: OwnedChild;
  artifactRoot: string;
  runnerInputsSha256: string;
  cameraTestPath: string;
  cameraTestSha256: string;
  deadlineAtMonotonicMs: number;
  signal: AbortSignal;
}): Promise<void> {
  assertMonotonicLive(input.signal, input.deadlineAtMonotonicMs);
  const selectionDeadline = input.deadlineAtMonotonicMs;
  const receiptPath = join(input.artifactRoot, DETOX_CAMERA_JEST_SELECTION_RECEIPT);
  while (performance.now() < selectionDeadline) {
    assertMonotonicLive(input.signal, input.deadlineAtMonotonicMs);
    requireOwnedDetoxChildRunning(input.child, 'Jest test selection');
    try {
      const value = await readPrivateJson(receiptPath);
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        (value as Partial<DetoxCameraJestSelectionReceipt>).schema !==
          'detox-ios-camera-jest-selection-v1' ||
        (value as Partial<DetoxCameraJestSelectionReceipt>).phase !== 'module-executed' ||
        (value as Partial<DetoxCameraJestSelectionReceipt>).moduleLoaded !== true ||
        (value as Partial<DetoxCameraJestSelectionReceipt>).runnerInputsSha256 !==
          input.runnerInputsSha256 ||
        (value as Partial<DetoxCameraJestSelectionReceipt>).cameraTestPath !==
          input.cameraTestPath ||
        (value as Partial<DetoxCameraJestSelectionReceipt>).cameraTestSha256 !==
          input.cameraTestSha256 ||
        (value as Partial<DetoxCameraJestSelectionReceipt>).selectedTestCount !== 1
      )
        throw new Error('Detox camera Jest selection receipt is invalid');
      return;
    } catch (error) {
      if (!isMissingPrivateReceipt(error)) throw error;
    }
    const remaining = Math.min(50, Math.max(1, Math.ceil(selectionDeadline - performance.now())));
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, remaining));
  }
  requireOwnedDetoxChildRunning(input.child, 'Jest bootstrap');
  throw new Error('Detox camera Jest did not publish exactly one selected test before bootstrap');
}

/**
 * Detox launches a short-lived wrapper before it creates its Jest workers. The
 * first ownership ledger publication therefore cannot be treated as the
 * complete child tree. Capture the same owned process group until its
 * membership is stable, using only a bounded slice of the caller's original
 * monotonic deadline. The non-strict captures adopt only same-user members of
 * the already-owned process group; strict stop still revalidates every row.
 */
export async function waitForOwnedDetoxChildStartup(
  child: OwnedChild,
  deadlineAtMonotonicMs: number,
  signal: AbortSignal,
): Promise<void> {
  assertMonotonicLive(signal, deadlineAtMonotonicMs);
  requireOwnedDetoxChildRunning(child, 'startup');
  if (!Number.isFinite(deadlineAtMonotonicMs))
    throw new Error('Detox camera child startup deadline is invalid');
  const settleDeadline = Math.min(deadlineAtMonotonicMs, performance.now() + 5_000);
  // The Detox launcher publishes its leader before Jest workers appear. Keep
  // the startup census open through that known hand-off window even when the
  // first few observations happen to be identical.
  const settleFloor = performance.now() + 1_500;
  const startupDeadline = Math.min(settleDeadline, settleFloor);
  let previous = '';
  let stableObservations = 0;
  while (performance.now() < settleDeadline) {
    assertMonotonicLive(signal, deadlineAtMonotonicMs);
    requireOwnedDetoxChildRunning(child, 'startup');
    const members = (await child.capture(false, detoxChildCensusSettle(settleDeadline, signal)))
      .filter((row) => row.pgid === child.pgid)
      .map((row) => `${row.pid}:${row.pgid}:${row.started}:${row.commandHash}`)
      .sort()
      .join('|');
    assertMonotonicLive(signal, deadlineAtMonotonicMs);
    if (!members) throw new Error('Detox camera child process group disappeared during startup');
    if (members === previous) stableObservations += 1;
    else {
      previous = members;
      stableObservations = 1;
    }
    if (
      stableObservations >= 3 &&
      (performance.now() >= startupDeadline || settleDeadline - performance.now() <= 50)
    ) {
      requireOwnedDetoxChildRunning(child, 'bootstrap');
      return;
    }
    const remaining = Math.min(50, Math.max(1, Math.ceil(settleDeadline - performance.now())));
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, remaining));
  }
  throw new Error('Detox camera child process group did not reach a stable startup census');
}

function parseChildLedger(value: unknown): ChildLedger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as { processes?: unknown };
  if (!Array.isArray(candidate.processes)) return {};
  const processes = candidate.processes.flatMap((row): ChildLedgerRow[] => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
    const value = row as Record<string, unknown>;
    return typeof value.pid === 'number' &&
      Number.isSafeInteger(value.pid) &&
      typeof value.pgid === 'number' &&
      Number.isSafeInteger(value.pgid) &&
      typeof value.started === 'string'
      ? [{ pid: value.pid, pgid: value.pgid, started: value.started }]
      : [];
  });
  return { processes };
}

function snapshotProjection(
  value: OwnedConnectionSnapshot,
  receipt: OwnedSnapshotReceipt,
  phase: 'before' | 'after',
  owner: DetoxCameraOwnerIdentity,
  expectedScope: DetoxCameraSnapshotScope,
): DetoxCameraSqlProjection {
  if (
    !value ||
    value.kind !== 'connection-snapshot-v1' ||
    value.readOnly !== true ||
    value.runId !== owner.runId ||
    value.scope !== expectedScope
  )
    throw new Error('Detox camera SQL snapshot identity is invalid');
  const tableRows: Record<string, { rowCount: number; rowsSha256: string }> = {};
  for (const [name, rows] of Object.entries(value.rows ?? {})) {
    if (!Array.isArray(rows))
      throw new Error(`Detox camera SQL snapshot table is not an array: ${name}`);
    tableRows[name] = { rowCount: rows.length, rowsSha256: hashJson(rows) };
  }
  if (!Number.isSafeInteger(receipt.sizeBytes) || !Number.isSafeInteger(receipt.mode))
    throw new Error('Detox camera SQL snapshot receipt is not descriptor-backed');
  return {
    phase,
    scope: value.scope,
    apiOrigin: owner.backend.apiOrigin,
    runId: value.runId,
    snapshotPath: receipt.path,
    snapshotSha256: receipt.sha256,
    snapshotSource: {
      path: receipt.path,
      sha256: receipt.sha256,
      bytes: receipt.sizeBytes,
      mode: receipt.mode,
      sourceKind: 'owned-detox-snapshot',
    },
    tableRows,
  };
}

function makeTransportRows(
  proxy: OwnedProxy,
  owner: DetoxCameraOwnerIdentity,
  bodyReceipt: NativeRequestBodyCaptureReceipt | null,
  studentAuthUid: string,
): DetoxCameraTransportObservation[] {
  if (
    !bodyReceipt ||
    bodyReceipt.kind !== 'owned-native-request-body-receipt-v1' ||
    bodyReceipt.outcome !== 'forwarded' ||
    bodyReceipt.status !== 201 ||
    bodyReceipt.targetOrigin !== owner.backend.apiOrigin ||
    bodyReceipt.apiPid !== owner.backend.apiPid ||
    bodyReceipt.sessionRunId !== owner.backend.runId ||
    bodyReceipt.backendAttemptId !== owner.backend.apiAttemptId
  )
    throw new Error(
      'Detox camera request body receipt is not bound to the original owned API run and attempt',
    );
  const fence = proxy.requestIdFence;
  if (!Number.isSafeInteger(fence) || fence < bodyReceipt.requestId)
    throw new Error('Detox camera request fence is invalid');
  return proxy.observations.map((row: ProxyObservation) => ({
    requestId: row.requestId,
    method: row.method,
    route:
      row.requestId === bodyReceipt.requestId ? bodyReceipt.route : `path-hash:${row.pathHash}`,
    status: row.status,
    ...(row.requestId === bodyReceipt.requestId ? { responsePrincipalUid: studentAuthUid } : {}),
    requestCredentialPresent: false,
    afterRequestId: fence,
    source: 'owned-detox-api-proxy',
  }));
}

/**
 * Adapter over the already-owned Detox baseline factories. It is intentionally
 * opt-in and private: the checked-in public dispatcher must call this only
 * after its normal selection/build/host-lock gates. No second target, proxy,
 * backend session, or cleanup owner is created here.
 */
export function createCurrentDetoxIosCameraOwner(options: CurrentOwnerOptions): DetoxCameraOwner {
  return {
    lifecycle: {
      signal: options.signal,
      deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    },
    async acquire(): Promise<DetoxCameraAcquiredRuntime> {
      const root = await realpath(options.currentRoot);
      if (root !== resolve(options.currentRoot) || root !== resolve(options.repositoryRoot))
        throw new Error('Detox camera current repository root is not canonical');
      const captureNamespace = detoxCameraCaptureNamespace(options.artifactRoot);
      if (!Number.isFinite(options.buildElapsedMs) || options.buildElapsedMs <= 0)
        throw new Error('Detox camera qualified build timing is unavailable');
      const runnerInputPaths: IosDetoxCameraRunnerInputPaths = {
        detoxBaseConfigPath: options.detoxBaseConfigPath,
        detoxConfigPath: options.detoxConfigPath,
        jestConfigPath: options.jestConfigPath,
        cameraTestPath: options.cameraTestPath,
        childSourcePath: options.childSourcePath,
        ipcSourcePath: join(
          options.repositoryRoot,
          IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS.ipcSourcePath,
        ),
      };
      const runnerInputs: IosDetoxCameraRunnerInputIdentity =
        await readOwnedIosDetoxCameraRunnerInputs({
          repositoryRoot: root,
          paths: runnerInputPaths,
          signal: options.signal,
          deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
        });
      const childSourceSha256 = runnerInputs.files.childSourcePath.sha256;
      if (options.childSourceSha256 !== childSourceSha256)
        throw new Error('Detox camera child source hash differs from the owned runner input');
      const factories = options.factories ?? ownedDetoxBaselineFactories;
      const readRuntime = options.readSimulatorRuntime ?? readSimulatorRuntime;
      const parentEnv = options.parentEnv ?? process.env;
      const nodeEnvironment = resolveDetoxCameraNodeEnvironment(parentEnv.NODE_ENV);
      const publicBindings = nativeCameraPublicEvidenceBindings;
      const expectedAssertionIds = [
        'NAT-camera-normal-entry',
        'NAT-camera-denial-guidance',
        'NAT-camera-manual-submit',
        'NAT-camera-unrelated-state',
      ];
      if (
        !publicBindings ||
        JSON.stringify(Object.keys(publicBindings).sort()) !==
          JSON.stringify(expectedAssertionIds.slice().sort())
      )
        throw new Error('Detox camera public binding contract drifted');
      const publicBindingsHash = hashJson(publicBindings);
      const startedAt = new Date().toISOString();
      let reservation: OwnedReservation | undefined;
      let target: DetoxOwnedTarget | undefined;
      let session: OwnedSession | undefined;
      let proxy: OwnedProxy | undefined;
      let expo: OwnedExpo | undefined;
      let child: OwnedChild | undefined;
      let childIdentity: DetoxCameraChildIdentity | undefined;
      let jestListTestsReceipt: DetoxCameraJestListTestsReceipt | undefined;
      let fixtureEvidence: DetoxCameraFixtureEvidence | undefined;
      let connectionIsolationFixtureEvidence: DetoxCameraFixtureEvidence | undefined;
      let simulatorRuntime: string | undefined;
      const acquisitionIntents: string[] = [];
      const acquisitionSequence: string[] = [];
      const resourceRecords: AcquisitionResourceRecord[] = [];
      let activeAcquisitionResource: string | undefined;
      let acquisitionFailure: DetoxCameraAcquisitionFailure | undefined;
      const acquireResource = async <T>(
        resource: string,
        operation: () => Promise<T>,
      ): Promise<T> => {
        acquisitionIntents.push(resource);
        activeAcquisitionResource = resource;
        try {
          const value = await operation();
          acquisitionSequence.push(resource);
          resourceRecords.push({
            resource,
            status: 'acquired',
            identity: null,
          });
          return value;
        } catch (error) {
          const failure = describeAcquisitionFailure(resource, error, options.artifactRoot);
          acquisitionFailure ??= failure;
          resourceRecords.push({
            resource,
            status: 'unknown',
            identity: null,
            failure,
          });
          throw error;
        } finally {
          activeAcquisitionResource = undefined;
        }
      };
      const validateResource = async <T>(
        resource: string,
        operation: () => Promise<T>,
      ): Promise<T> => {
        activeAcquisitionResource = resource;
        try {
          return await operation();
        } catch (error) {
          const failure = describeAcquisitionFailure(
            resource,
            error,
            options.artifactRoot,
            'validation',
            false,
          );
          const record = [...resourceRecords].reverse().find((row) => row.resource === resource);
          if (record) record.failure = failure;
          acquisitionFailure ??= failure;
          throw error;
        } finally {
          activeAcquisitionResource = undefined;
        }
      };
      const updateResourceIdentity = (resource: string, identity: Record<string, unknown>) => {
        const record = [...resourceRecords].reverse().find((row) => row.resource === resource);
        if (record) record.identity = { ...(record.identity ?? {}), ...identity };
      };
      const runtimeFacts: DetoxCameraRuntimeFacts = {
        childExitCode: null,
        childSignal: null,
        childClassification: 'harness-blocked',
        flagsHash: options.build.environmentHash ?? null,
        timingsMs: {
          build: options.buildElapsedMs,
          install: 0,
          reset: 0,
          scenario: 0,
          verify: 0,
          cleanup: 0,
        },
      };
      const yarnCliPath = await resolveOwnedYarnCli();
      const childCommand = {
        command: process.execPath,
        argv: [
          yarnCliPath,
          'detox',
          'test',
          '-C',
          options.detoxConfigPath,
          '-c',
          options.configuration,
          '--headless',
          '--no-start',
          '--artifacts-location',
          join(options.artifactRoot, 'detox-artifacts'),
          '--record-logs',
          'none',
        ],
        cwd: root,
      };

      const cleanupPartiallyAcquired = async (failure: unknown): Promise<DetoxCameraCleanup> => {
        const recoverySignal = new AbortController().signal;
        const cleanupStarted = performance.now();
        const childOutcomeBeforeCleanup = child?.outcome() ?? {
          code: null,
          signal: null,
        };
        const aggregate = await runDetoxCleanupAggregate({
          signal: recoverySignal,
          deadlineAt: options.deadlineAtMonotonicMs,
          steps: [
            ...(child
              ? [
                  {
                    label: 'child-stop',
                    operation: async (remainingMs: number) => {
                      const settle = detoxChildCensusSettle(
                        Math.min(options.deadlineAtMonotonicMs, performance.now() + remainingMs),
                        options.signal,
                      );
                      await child!.capture(false, settle);
                      await child!.stop(settle);
                    },
                  },
                ]
              : []),
            ...(expo
              ? [
                  {
                    label: 'expo-stop',
                    operation: () => expo!.stop(),
                  },
                ]
              : []),
            ...(proxy
              ? [
                  {
                    label: 'proxy-stop',
                    operation: () => proxy!.stop(),
                  },
                ]
              : []),
            ...(session
              ? [
                  {
                    label: 'session-stop',
                    operation: () => session!.stop(),
                  },
                ]
              : []),
            ...(target
              ? [
                  {
                    label: 'target-stop',
                    operation: () => target!.stop(),
                  },
                ]
              : []),
            ...(reservation
              ? [
                  {
                    label: 'app-port-release',
                    operation: () => reservation!.release(),
                  },
                ]
              : []),
          ],
        });
        const lifecycle = {
          signal: recoverySignal,
          deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
        };
        let afterDevices = 'not-written';
        if (target) {
          const after = await runDetoxCleanupStep({
            label: 'after-ios-devices',
            signal: recoverySignal,
            deadlineAt: options.deadlineAtMonotonicMs,
            operation: async () => {
              await captureIosDevices(options.artifactRoot, recoverySignal, lifecycle);
            },
          });
          afterDevices = after.status === 'settled' ? 'written' : 'failed';
        }
        const aggregateSteps = aggregate.stepResults.map((step) => ({
          ...step,
        }));
        const cleanupLabelByResource: Record<string, string> = {
          'app-port': 'app-port-release',
          target: 'target-stop',
          backend: 'session-stop',
          proxy: 'proxy-stop',
          expo: 'expo-stop',
          detox: 'child-stop',
        };
        const preflightFailure = acquisitionFailure?.preflight;
        const preflightCleanupResource = preflightFailure
          ? {
              resource: 'detox-jest-list-tests',
              acquisition: 'unknown' as const,
              identity: {
                pid: preflightFailure.execution.pid,
                pgid: preflightFailure.execution.pgid,
                execution: preflightFailure.execution.execution,
              },
              cleanup:
                preflightFailure.cleanupStatus === 'cleaned' ? 'cleaned' : ('unknown' as const),
              acquisitionFailure,
            }
          : null;
        const cleanupResources = [
          ...resourceRecords.map((record) => {
            const step = aggregateSteps.find(
              (candidate) => candidate.label === cleanupLabelByResource[record.resource],
            );
            return {
              resource: record.resource,
              acquisition: record.status,
              identity: record.identity,
              cleanup: record.status === 'unknown' ? 'unknown' : (step?.status ?? 'not-attempted'),
              acquisitionFailure: record.failure ?? null,
            };
          }),
          ...(preflightCleanupResource ? [preflightCleanupResource] : []),
        ];
        const resourceStates = [
          ...resourceRecords.map((record) => ({ ...record })),
          ...(preflightFailure
            ? [
                {
                  resource: 'detox-jest-list-tests',
                  status: 'unknown' as const,
                  identity: {
                    pid: preflightFailure.execution.pid,
                    pgid: preflightFailure.execution.pgid,
                    cleanup: preflightFailure.cleanupStatus,
                  },
                  failure: acquisitionFailure,
                },
              ]
            : []),
        ];
        const postChild = observeDetoxCameraChildOutcome(child);
        if (
          runtimeFacts.childExitCode === null &&
          runtimeFacts.childSignal === null &&
          (childOutcomeBeforeCleanup.code !== null || childOutcomeBeforeCleanup.signal !== null)
        ) {
          runtimeFacts.childExitCode = childOutcomeBeforeCleanup.code;
          runtimeFacts.childSignal = childOutcomeBeforeCleanup.signal;
          runtimeFacts.childClassification =
            childOutcomeBeforeCleanup.code === 0 && childOutcomeBeforeCleanup.signal === null
              ? 'completed'
              : 'child-failed';
        }
        const failureMessage = boundedFailureMessage(failure);
        const aggregateCleanup = {
          status: aggregate.status,
          recoveryStatus: aggregate.recoveryStatus,
          failures: [...aggregate.failures],
          timedOutLabels: [...aggregate.timedOutLabels],
          skippedLabels: [...aggregate.skippedLabels],
          stepResults: aggregateSteps,
          elapsedMs: aggregate.elapsedMs,
        };
        const cleanupStatus = {
          status: 'failed-recovery-retained' as const,
          resources: cleanupResources,
          aggregate: aggregateCleanup,
          afterDevices,
          postChild,
          unknownResources: cleanupResources
            .filter((resource) => resource.cleanup === 'unknown')
            .map((resource) => resource.resource),
        };
        const partialReceipt = {
          platform: captureNamespace.platform,
          mode: captureNamespace.mode,
          captureRunId: captureNamespace.captureRunId,
          captureRoot: captureNamespace.captureRoot,
          kind: 'private-owned-ios-detox-camera-capture',
          scope: 'cleanup-only',
          assertionsVerified: false,
          publicPromotionEligible: false,
          result: /cancel|abort/i.test(failureMessage) ? 'cancelled' : 'harness-blocked',
          cleanup: cleanupStatus,
          acquisitionIntents: [...acquisitionIntents],
          acquisitionSequence: [...acquisitionSequence],
          reservedPorts: reservation
            ? [reservation.port, ...(proxy ? [Number(new URL(proxy.origin).port)] : [])]
            : [],
          proxyOrigin: proxy?.origin ?? null,
          device: target ? { udid: target.deviceId, runtime: simulatorRuntime ?? null } : null,
          backend: session
            ? {
                runId: session.manifest.runId,
                composeProject: session.manifest.composeProject,
                artifactRoot: session.manifest.artifactRoot,
                processes: session.manifest.processes,
              }
            : null,
          fixtureEvidence: fixtureEvidence ?? null,
          fixtureHash: fixtureEvidence?.sha256 ?? null,
          connectionIsolationFixtureEvidence: connectionIsolationFixtureEvidence ?? null,
          jestListTests: jestListTestsReceipt ?? null,
          preflight: preflightFailure
            ? {
                resource: 'detox-jest-list-tests',
                cleanup: preflightFailure.cleanupStatus,
                execution: preflightFailure.execution,
                command: preflightFailure.command,
              }
            : null,
          commandExecutions: child
            ? [
                {
                  command: childCommand.command,
                  argv: [...childCommand.argv],
                  cwd: childCommand.cwd,
                  pid: child.pid,
                  pgid: child.pgid,
                  startedAt: childIdentity?.startedAt ?? null,
                  exitCode: runtimeFacts.childExitCode,
                  signal: runtimeFacts.childSignal,
                  classification: runtimeFacts.childClassification,
                },
              ]
            : [],
          partialAcquisition: true,
          acquisitionFailure:
            acquisitionFailure ??
            describeAcquisitionFailure(
              activeAcquisitionResource ?? resourceRecords.at(-1)?.resource ?? 'unknown',
              failure,
              options.artifactRoot,
              'validation',
              resourceRecords.length === 0,
            ),
          backendAcquisitionFailure:
            acquisitionFailure?.resource === 'backend' ? acquisitionFailure : undefined,
          resourceStates,
          cleanupAggregate: aggregateCleanup,
          postChild,
          failure: {
            name: failure instanceof Error ? failure.name : 'UnknownError',
            message: failureMessage,
          },
        } as const;
        const ledger = await runDetoxCleanupStep({
          label: 'partial-capture-ledger',
          signal: recoverySignal,
          deadlineAt: options.deadlineAtMonotonicMs,
          operation: async () => {
            await writeOwnedExclusive(
              options.artifactRoot,
              'capture.private.json',
              Buffer.from(JSON.stringify(partialReceipt, null, 2) + '\n'),
              lifecycle,
            );
          },
        });
        let independentCleanup: DetoxCameraCleanup['independentCleanup'] = 'failed';
        if (ledger.status === 'settled') {
          const independent = await runDetoxCleanupStep({
            label: 'partial-independent-cleanup',
            signal: recoverySignal,
            deadlineAt: options.deadlineAtMonotonicMs,
            operation: async () =>
              factories.verifyOwnedIosCleanup({
                repositoryRoot: root,
                artifactRoot: options.artifactRoot,
                signal: recoverySignal,
                deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
              }),
          });
          if (independent.status === 'settled' && independent.value?.result === 'passed')
            independentCleanup = 'cleaned';
        }
        runtimeFacts.timingsMs.cleanup = performance.now() - cleanupStarted;
        const failures = [
          ...aggregate.failures,
          ...(afterDevices === 'failed' ? ['after-ios-devices'] : []),
          ...(ledger.status !== 'settled' ? ['capture-ledger'] : []),
          ...(independentCleanup !== 'cleaned' ? ['independent'] : []),
        ];
        return {
          captureCleanup: 'failed',
          independentCleanup,
          ownedProcessPairs: [
            ...(child && childIdentity
              ? [{ pid: child.pid, startedAt: childIdentity.startedAt }]
              : []),
            ...(session
              ? (() => {
                  const api = session.manifest.processes.find((row) => row.role === 'api');
                  return api ? [{ pid: api.pid, startedAt: api.started }] : [];
                })()
              : []),
          ],
          foreignResourcesPreserved: failures.length === 0,
          terminal: 'blocked',
          error: failures.length > 0 ? failures.join(',') : 'partial-acquisition',
        };
      };
      try {
        assertLive(options.signal, options.deadlineAt);
        assertMonotonicLive(options.signal, options.deadlineAtMonotonicMs);
        if (parentEnv.MYCHAMPIONS_NATIVE_HOST_LOCK_HELD !== '1')
          throw new Error('Detox camera owner requires the existing native host lock');
        await prepareDetoxCameraStageDirectory({
          artifactRoot: options.artifactRoot,
          stageRoot: options.stageRoot,
          signal: options.signal,
          deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
        });
        await factories.requireNativeHostAvailability(options.stageRoot);
        await factories.capturePreviousIosDevices(options.artifactRoot, options.signal);
        reservation = await acquireResource('app-port', () =>
          factories.reserveOwnedAppPort(options.build.metroPort),
        );
        updateResourceIdentity('app-port', {
          port: reservation.port,
          origin: reservation.origin,
        });
        const installStarted = performance.now();
        target = await acquireResource('target', () =>
          factories.acquireOwnedTarget({
            platform: 'ios',
            artifactRoot: options.artifactRoot,
            signal: options.signal,
          }),
        );
        updateResourceIdentity('target', { deviceId: target.deviceId });
        await validateResource('target', async () => {
          await target!.verify(options.signal);
          simulatorRuntime = await readRuntime(target!.deviceId, options.signal);
          await factories.verifyIosSimulatorApp(options.build.binaryPath, options.artifactRoot);
        });
        runtimeFacts.timingsMs.install = performance.now() - installStarted;
        const resetStarted = performance.now();
        session = await acquireResource('backend', () =>
          factories.startOwnedSession({
            serverRoot: options.serverRoot,
            appOrigin: reservation!.origin,
            signal: options.signal,
            deadlineMs: remainingDeadlineMs(options.deadlineAt),
          }),
        );
        updateResourceIdentity('backend', {
          runId: session.manifest.runId,
          artifactRoot: session.manifest.artifactRoot,
          composeProject: session.manifest.composeProject,
          processes: session.manifest.processes,
        });
        const qualifiedApiOrigin = requireIntegratedLoopbackOrigin(
          options.build.embeddedRuntime.apiOrigin,
        );
        const qualifiedApiPort = Number(new URL(qualifiedApiOrigin).port);
        proxy = await acquireResource('proxy', () =>
          factories.startOwnedApiProxy({
            session: session!,
            appOrigin: reservation!.origin,
            requestProfile: 'native',
            requestedPort: qualifiedApiPort,
          }),
        );
        updateResourceIdentity('proxy', { origin: proxy.origin });
        if (
          options.build.embeddedRuntime?.apiOrigin &&
          proxy.origin !== options.build.embeddedRuntime.apiOrigin
        )
          throw new Error('Detox camera proxy origin differs from the embedded app origin');
        const fixtures = await validateResource('backend', () =>
          session!.fixtures('native-entry-ios'),
        );
        // Seed the unrelated connection scope through the same owned session
        // before any connection snapshot can read it.  A primary fixture read
        // must never be treated as an implicit seed for a second scope.
        const connectionIsolationFixtures = await validateResource('backend', () =>
          session!.fixtures('native-connection-isolation-ios'),
        );
        const primaryFixtureAuthUids = Object.values(fixtures.accounts).map(
          (account) => account.authUid,
        );
        const isolationFixtureAuthUids = Object.values(connectionIsolationFixtures.accounts).map(
          (account) => account.authUid,
        );
        if (
          fixtures.scope !== 'native-entry-ios' ||
          fixtures.accounts.coach.role !== 'professional' ||
          fixtures.accounts.student.role !== 'student' ||
          primaryFixtureAuthUids.some(
            (authUid) => typeof authUid !== 'string' || !authUid.trim(),
          ) ||
          new Set(primaryFixtureAuthUids).size !== primaryFixtureAuthUids.length ||
          connectionIsolationFixtures.runId !== fixtures.runId ||
          connectionIsolationFixtures.scope !== 'native-connection-isolation-ios' ||
          connectionIsolationFixtures.accounts.coach.role !== 'professional' ||
          connectionIsolationFixtures.accounts.student.role !== 'student' ||
          isolationFixtureAuthUids.some(
            (authUid) => typeof authUid !== 'string' || !authUid.trim(),
          ) ||
          new Set(isolationFixtureAuthUids).size !== isolationFixtureAuthUids.length ||
          isolationFixtureAuthUids.some((authUid) => primaryFixtureAuthUids.includes(authUid))
        )
          throw new Error('Detox camera connection isolation fixture identity is not independent');
        const backendReceipt = await validateResource('backend', () =>
          session!.probeApiLifetime(options.signal),
        );
        if (
          backendReceipt.runId !== session.manifest.runId ||
          fixtures.runId !== backendReceipt.runId ||
          connectionIsolationFixtures.runId !== backendReceipt.runId ||
          backendReceipt.backendAttemptId === backendReceipt.runId
        )
          throw new Error(
            'Detox camera backend, fixture and original API receipt identities differ',
          );
        const fixtureBytes = Buffer.from(JSON.stringify(fixtures));
        fixtureEvidence = await validateResource('backend', async () => {
          const written = await writeOwnedExclusive(
            options.artifactRoot,
            'fixtures.private.json',
            fixtureBytes,
            {
              signal: options.signal,
              deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
            },
          );
          return {
            path: 'fixtures.private.json',
            bytes: written.bytes,
            sha256: written.sha256,
            source: 'owned-session.fixtures' as const,
            runId: fixtures.runId,
            scope: fixtures.scope,
          };
        });
        const isolationFixtureBytes = Buffer.from(JSON.stringify(connectionIsolationFixtures));
        connectionIsolationFixtureEvidence = await validateResource('backend', async () => {
          const written = await writeOwnedExclusive(
            options.artifactRoot,
            'fixtures-native-connection-isolation-ios.private.json',
            isolationFixtureBytes,
            {
              signal: options.signal,
              deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
            },
          );
          return {
            path: 'fixtures-native-connection-isolation-ios.private.json',
            bytes: written.bytes,
            sha256: written.sha256,
            source: 'owned-session.fixtures' as const,
            runId: connectionIsolationFixtures.runId,
            scope: connectionIsolationFixtures.scope,
          };
        });
        const fixtureAuthUids = [
          fixtures.accounts.coach.authUid,
          fixtures.accounts.student.authUid,
        ];
        await validateResource('proxy', () => {
          proxy!.enableNativeAuthIdentityCapture(fixtureAuthUids);
          return Promise.resolve();
        });
        expo = await acquireResource('expo', () =>
          factories.startOwnedExpo({
            clientRoot: root,
            artifactRoot: options.artifactRoot,
            reservation: reservation!,
            apiOrigin: proxy!.origin,
            parentEnv,
            signal: options.signal,
            deadlineMs: remainingDeadlineMs(options.deadlineAt),
            surface: 'native',
          }),
        );
        updateResourceIdentity('expo', {
          pid: expo.pid,
          pgid: expo.pgid,
          origin: expo.origin,
        });
        const nodeModulesRoot = await requireOwnedNodeModulesRoot(root);
        const childEnv: NodeJS.ProcessEnv = {
          ...parentEnv,
          ...buildDetoxVerifiedBinaryEnvironment(options.build),
          // The staged config and Jest test live outside Q. Keep their runtime
          // module resolution explicitly bound to Q's owned dependency tree
          // while the Detox launcher keeps cwd at Q for relative SDK/profile
          // and binary paths.
          NODE_PATH: nodeModulesRoot,
          DETOX_CAMERA_NODE_MODULES_ROOT: nodeModulesRoot,
          DETOX_CAMERA_WORKING_ROOT: root,
          NODE_ENV: nodeEnvironment,
          DETOX_CONNECTION_PLATFORM: 'ios',
          DETOX_IOS_SIMULATOR_UDID: target.deviceId,
          DETOX_METRO_PORT: String(reservation.port),
          // The qualified iOS port is intentionally carried by the shared
          // DETOX_METRO_PORT after the explicit platform marker above.  An
          // IOS override makes .detoxrc.js apply the shared 49151 ceiling,
          // which rejects valid qualified iOS TCP ports such as 63032.
          // Clear any inherited override so the exact reservation/origin
          // remains the single runtime identity consumed by Expo and Detox.
          DETOX_IOS_METRO_PORT: undefined,
          DETOX_CAMERA_ARTIFACT_ROOT: options.artifactRoot,
          DETOX_CAMERA_CURRENT_ROOT: root,
          DETOX_CAMERA_DETOX_BASE_CONFIG_PATH: options.detoxBaseConfigPath,
          DETOX_CAMERA_DETOX_CONFIG_PATH: options.detoxConfigPath,
          DETOX_CAMERA_JEST_CONFIG_PATH: options.jestConfigPath,
          DETOX_CAMERA_TEST_PATH: options.cameraTestPath,
          DETOX_CAMERA_CHILD_SOURCE_PATH: options.childSourcePath,
          DETOX_CAMERA_DEADLINE_AT: String(options.deadlineAt),
          DETOX_CAMERA_EXPECTED_PID: 'pending',
          DETOX_CAMERA_EXPECTED_PGID: 'pending',
          DETOX_CAMERA_RUNNER_INPUTS_SHA256: runnerInputs.sha256,
          DETOX_CAMERA_DETOX_BASE_CONFIG_SHA256: runnerInputs.files.detoxBaseConfigPath.sha256,
          DETOX_CAMERA_DETOX_CONFIG_SHA256: runnerInputs.files.detoxConfigPath.sha256,
          DETOX_CAMERA_JEST_CONFIG_SHA256: runnerInputs.files.jestConfigPath.sha256,
          DETOX_CAMERA_TEST_SHA256: runnerInputs.files.cameraTestPath.sha256,
          DETOX_CAMERA_CHILD_SOURCE_SHA256: childSourceSha256,
          DETOX_CAMERA_STUDENT_EMAIL: fixtures.accounts.student.email,
          DETOX_CAMERA_STUDENT_PASSWORD: fixtures.accounts.student.password,
          DETOX_CAMERA_COACH_EMAIL: fixtures.accounts.coach.email,
          DETOX_CAMERA_COACH_PASSWORD: fixtures.accounts.coach.password,
        };
        const runnerInputsBeforeChild = await rereadOwnedIosDetoxCameraRunnerInputs({
          repositoryRoot: root,
          paths: runnerInputPaths,
          expected: runnerInputs,
          signal: options.signal,
          deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
        });
        const stagedRunnerInputsBeforeChild = await stageOwnedIosDetoxCameraRunnerInputs({
          repositoryRoot: root,
          stageRoot: options.stageRoot,
          paths: runnerInputPaths,
          expected: runnerInputsBeforeChild,
          signal: options.signal,
          deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
        });
        if (childCommand.argv[3] !== '-C' || childCommand.argv.length <= 4)
          throw new Error('Detox camera child config argument shape is invalid');
        childCommand.argv[4] = stagedRunnerInputsBeforeChild.paths.detoxConfigPath;
        Object.assign(childEnv, {
          DETOX_CAMERA_CURRENT_ROOT: stagedRunnerInputsBeforeChild.staged.root,
          DETOX_CAMERA_DETOX_BASE_CONFIG_PATH:
            stagedRunnerInputsBeforeChild.paths.detoxBaseConfigPath,
          DETOX_CAMERA_DETOX_CONFIG_PATH: stagedRunnerInputsBeforeChild.paths.detoxConfigPath,
          DETOX_CAMERA_JEST_CONFIG_PATH: stagedRunnerInputsBeforeChild.paths.jestConfigPath,
          DETOX_CAMERA_TEST_PATH: stagedRunnerInputsBeforeChild.paths.cameraTestPath,
          DETOX_CAMERA_CHILD_SOURCE_PATH: stagedRunnerInputsBeforeChild.paths.childSourcePath,
          DETOX_CAMERA_REVIEWED_RUNNER_ROOT: runnerInputsBeforeChild.root,
          DETOX_CAMERA_REVIEWED_RUNNER_INPUTS_SHA256: runnerInputsBeforeChild.sha256,
          DETOX_CAMERA_RUNNER_INPUTS_SHA256: stagedRunnerInputsBeforeChild.staged.sha256,
          DETOX_CAMERA_DETOX_BASE_CONFIG_SHA256:
            stagedRunnerInputsBeforeChild.staged.files.detoxBaseConfigPath.sha256,
          DETOX_CAMERA_DETOX_CONFIG_SHA256:
            stagedRunnerInputsBeforeChild.staged.files.detoxConfigPath.sha256,
          DETOX_CAMERA_JEST_CONFIG_SHA256:
            stagedRunnerInputsBeforeChild.staged.files.jestConfigPath.sha256,
          DETOX_CAMERA_TEST_SHA256:
            stagedRunnerInputsBeforeChild.staged.files.cameraTestPath.sha256,
          DETOX_CAMERA_CHILD_SOURCE_SHA256:
            stagedRunnerInputsBeforeChild.staged.files.childSourcePath.sha256,
        });
        await requirePrivateReceiptAbsent(
          join(options.artifactRoot, DETOX_CAMERA_JEST_LIST_TESTS_RECEIPT),
          'Detox camera Jest list-tests receipt',
        );
        await requirePrivateReceiptAbsent(
          join(options.artifactRoot, DETOX_CAMERA_JEST_SELECTION_RECEIPT),
        );
        jestListTestsReceipt = await validateResource('detox', () =>
          runDetoxCameraJestListTests({
            nodeModulesRoot,
            currentRoot: stagedRunnerInputsBeforeChild.staged.root,
            artifactRoot: options.artifactRoot,
            jestConfigPath: stagedRunnerInputsBeforeChild.paths.jestConfigPath,
            cameraTestPath: stagedRunnerInputsBeforeChild.paths.cameraTestPath,
            runnerInputsSha256: stagedRunnerInputsBeforeChild.staged.sha256,
            cameraTestSha256: stagedRunnerInputsBeforeChild.staged.files.cameraTestPath.sha256,
            env: childEnv,
            signal: options.signal,
            deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
          }),
        );
        await validateResource('detox', () =>
          writeOwnedExclusive(
            options.artifactRoot,
            DETOX_CAMERA_JEST_LIST_TESTS_RECEIPT,
            Buffer.from(JSON.stringify(jestListTestsReceipt, null, 2) + '\n'),
            {
              signal: options.signal,
              deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
            },
          ),
        );
        child = await acquireResource('detox', () =>
          startOwnedNativeCommand({
            ...childCommand,
            artifactRoot: options.artifactRoot,
            label: 'detox-camera-child',
            env: childEnv,
            phase: 'step',
          }),
        );
        updateResourceIdentity('detox', {
          pid: child.pid,
          pgid: child.pgid,
          runnerInputs: runnerInputsBeforeChild,
          stagedRunnerInputs: stagedRunnerInputsBeforeChild.staged,
          launchRoot: stagedRunnerInputsBeforeChild.staged.root,
          launchConfigPath: stagedRunnerInputsBeforeChild.paths.detoxConfigPath,
          jestListTests: jestListTestsReceipt,
        });
        const ledger = join(options.artifactRoot, 'detox-camera-child.ownership.json');
        childIdentity = await validateResource('detox', () =>
          waitForChildIdentity(ledger, child!.pid, child!.pgid, options.deadlineAt, options.signal),
        );
        await validateResource('detox', () =>
          waitForOwnedDetoxChildStartup(child!, options.deadlineAtMonotonicMs, options.signal),
        );
        await validateResource('detox', () =>
          waitForOwnedDetoxCameraJestSelection({
            child: child!,
            artifactRoot: options.artifactRoot,
            runnerInputsSha256: stagedRunnerInputsBeforeChild.staged.sha256,
            cameraTestPath: stagedRunnerInputsBeforeChild.paths.cameraTestPath,
            cameraTestSha256: stagedRunnerInputsBeforeChild.staged.files.cameraTestPath.sha256,
            deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
            signal: options.signal,
          }),
        );
        updateResourceIdentity('detox', {
          pid: child.pid,
          pgid: child.pgid,
          started: childIdentity.startedAt,
        });
        await writeOwnedExclusive(
          options.artifactRoot,
          'detox-camera-child-identity.private.json',
          Buffer.from(
            JSON.stringify({
              kind: 'private-detox-camera-child-identity',
              ...childIdentity,
            }),
          ),
          {
            signal: options.signal,
            deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
          },
        );
        const acquiredReservation = reservation;
        const acquiredTarget = target;
        const acquiredSession = session;
        const acquiredProxy = proxy;
        const acquiredExpo = expo;
        const acquiredChild = child;
        if (
          !acquiredReservation ||
          !acquiredTarget ||
          !acquiredSession ||
          !acquiredProxy ||
          !acquiredExpo ||
          !acquiredChild
        )
          throw new Error('Detox camera owner lost an acquired resource handle');
        const ipc = new DetoxCameraIpcClient({
          artifactRoot: options.artifactRoot,
          expectedChild: childIdentity,
          signal: options.signal,
          deadlineAt: options.deadlineAt,
        });
        // The child owns the first app launch. Permission inspection requires
        // the app data container, which does not exist until this bootstrap
        // command has installed/launched the verified binary and signed in.
        const bootstrapResponse = await validateResource('detox', async () => {
          requireOwnedDetoxChildRunning(child!, 'bootstrap');
          return ipc.request({ kind: 'bootstrap', actor: 'student' });
        });
        const bootstrapPending = requireDetoxCameraBootstrapPendingResponse(bootstrapResponse);
        if (!options.remoteServicePrompt)
          throw new Error('Detox camera owner requires the qualified remote-service helper route');
        // Bind the launched app to this owned simulator and qualified binary
        // before starting the separate native helper. The helper must never
        // be the first operation that proves the app identity.
        const installedAppBeforeHelper: IosInstalledAppObservation = await validateResource(
          'detox',
          () =>
            verifyOwnedIosInstalledApp(
              { udid: acquiredTarget.deviceId, verify: acquiredTarget.verify },
              options.build.appIdentifier,
              options.build.binaryHash,
              options.signal,
              options.deadlineAtMonotonicMs,
            ),
        );
        // The login flow has reached the app landing screen, but bootstrap
        // intentionally publishes a pending stage. The owner must resolve the
        // observed native prompt before it can publish authenticated readiness
        // or send any camera-entry command to the child.
        const remoteServicePrompt = await validateResource('detox', async () => {
          requireOwnedDetoxChildRunning(child!, 'remote-service helper entry');
          const result = await runOwnedDetoxCameraRemoteServicePrompt({
            ...options.remoteServicePrompt!,
            artifactRoot: options.artifactRoot,
            deviceUdid: acquiredTarget.deviceId,
            bootstrapChild: bootstrapPending.child,
            bootstrapCommandHash: bootstrapPending.commandHash,
            deadlineAtEpochMs: options.deadlineAt,
            deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
            signal: options.signal,
            bootstrapStagePublished: true,
          });
          requireOwnedDetoxChildRunning(child!, 'remote-service helper completion');
          return result;
        });
        const completedBootstrapResponse = await validateResource('detox', async () => {
          requireOwnedDetoxChildRunning(child!, 'bootstrap completion');
          return ipc.request({
            kind: 'complete-bootstrap',
            promptStatus: remoteServicePrompt.status,
            bootstrapStageToken: bootstrapPending.commandHash,
            promptReceiptSha256: remoteServicePrompt.receiptSha256,
            promptCommandReceiptSha256: remoteServicePrompt.commandReceiptSha256,
          });
        });
        const bootstrapReceipt: DetoxCameraBootstrapReceipt = requireDetoxCameraBootstrapResponse(
          completedBootstrapResponse,
        );
        // The child owns the launch/sign-in, but its readiness receipt alone
        // cannot prove which installed bundle Detox used. Bind the observed
        // app container to the already-owned simulator, exact bundle, and
        // qualified build bytes before any TCC read. This is read-only: no
        // second install or alternate launch is permitted here.
        const installedAppAfterHelper: IosInstalledAppObservation = await validateResource(
          'detox',
          () =>
            verifyOwnedIosInstalledApp(
              { udid: acquiredTarget.deviceId, verify: acquiredTarget.verify },
              options.build.appIdentifier,
              options.build.binaryHash,
              options.signal,
              options.deadlineAtMonotonicMs,
            ),
        );
        updateResourceIdentity('detox', {
          pid: acquiredChild.pid,
          pgid: acquiredChild.pgid,
          started: childIdentity.startedAt,
          installedAppBeforeHelper,
          installedAppAfterHelper,
          remoteServicePrompt: {
            status: remoteServicePrompt.status,
            execution: remoteServicePrompt.execution.execution,
            cleanup: remoteServicePrompt.execution.cleanup,
            commandReceipt: remoteServicePrompt.commandReceipt,
            receiptSha256: remoteServicePrompt.receiptSha256,
            commandReceiptSha256: remoteServicePrompt.commandReceiptSha256,
          },
        });
        const owner: DetoxCameraOwnerIdentity = {
          runId: fixtures.runId,
          attemptId: backendReceipt.backendAttemptId,
          target: {
            platform: 'ios',
            deviceId: acquiredTarget.deviceId,
            osVersion: simulatorRuntime,
            startedAt,
          },
          build: {
            appIdentifier: options.build.appIdentifier,
            binaryPath: options.build.binaryPath,
            binarySha256: options.build.binaryHash,
            configuration: options.configuration,
            toolchain: options.build.toolVersions ?? { node: process.version },
          },
          backend: {
            runId: backendReceipt.runId,
            apiOrigin: backendReceipt.apiOrigin,
            apiPid: backendReceipt.apiPid,
            apiStartedAt: backendReceipt.apiStarted,
            apiAttemptId: backendReceipt.backendAttemptId,
            manifestSha256: backendReceipt.manifestSha256,
          },
          fixture: {
            runId: fixtures.runId,
            studentAuthUid: fixtures.accounts.student.authUid,
            coachAuthUid: fixtures.accounts.coach.authUid,
            fixtureHash: hashJson(fixtures),
          },
        };
        const bootstrapEvidence: DetoxCameraBootstrapEvidence = requireDetoxCameraBootstrapEvidence(
          {
            schema: 'detox-ios-camera-bootstrap-evidence-v1',
            ownerBinding: {
              deviceUdid: acquiredTarget.deviceId,
              appBundleIdentifier: options.build.appIdentifier,
              binarySha256: options.build.binaryHash,
              child: childIdentity,
            },
            pending: bootstrapPending,
            final: bootstrapReceipt,
          },
          owner,
        );
        let latestAfter: OwnedConnectionSnapshot | undefined;
        let latestIsolationBefore: OwnedConnectionSnapshot | undefined;
        let latestIsolationAfter: OwnedConnectionSnapshot | undefined;
        const snapshot = async (phase: 'before' | 'after') => {
          const evidence = await acquiredSession.connectionSnapshotWithEvidence(
            'native-entry-ios',
            options.signal,
          );
          if (phase === 'after') latestAfter = evidence.value;
          return snapshotProjection(
            evidence.value,
            evidence.receipt,
            phase,
            owner,
            'native-entry-ios',
          );
        };
        const isolationSnapshot = async (phase: 'before' | 'after') => {
          const evidence = await acquiredSession.connectionSnapshotWithEvidence(
            'native-connection-isolation-ios',
            options.signal,
          );
          if (phase === 'before') latestIsolationBefore = evidence.value;
          else latestIsolationAfter = evidence.value;
          return snapshotProjection(
            evidence.value,
            evidence.receipt,
            phase,
            owner,
            'native-connection-isolation-ios',
          );
        };
        const verifyIsolationUnchanged = (
          before: DetoxCameraSqlProjection,
          after: DetoxCameraSqlProjection,
        ) =>
          Boolean(
            JSON.stringify(before.tableRows) === JSON.stringify(after.tableRows) &&
            latestIsolationBefore &&
            latestIsolationAfter &&
            JSON.stringify(latestIsolationBefore.rows) ===
              JSON.stringify(latestIsolationAfter.rows),
          );
        const permissionDevice = {
          udid: acquiredTarget.deviceId,
          verify: acquiredTarget.verify,
        };
        const readCameraPermissionState = async (): Promise<
          'not-determined' | 'denied' | 'authorized' | 'unknown'
        > => {
          const observed: IosCameraPermissionObservation = await readOwnedIosCameraPermission(
            permissionDevice,
            options.build.appIdentifier,
            options.signal,
          );
          return observed.rows.length === 0
            ? 'not-determined'
            : observed.rows.every((row) => row.auth_value === 0)
              ? 'denied'
              : 'unknown';
        };
        const permissionBefore: 'not-determined' | 'denied' | 'authorized' | 'unknown' =
          await readCameraPermissionState();
        if (permissionBefore !== 'not-determined')
          throw new Error(
            'Detox camera owner requires an undecided camera permission before the prompt',
          );
        runtimeFacts.timingsMs.reset = performance.now() - resetStarted;
        const readCameraPermission = async (): Promise<'denied' | 'authorized' | 'unknown'> => {
          const state = await readCameraPermissionState();
          if (state === 'not-determined')
            throw new Error('Detox camera permission did not produce a post-prompt decision');
          return state;
        };
        let armed = false;
        const armSubmissionCapture = (inviteCodeSha256: string): Promise<void> => {
          if (armed) throw new Error('Detox camera submission capture was armed twice');
          if (!/^[a-f0-9]{64}$/.test(inviteCodeSha256))
            throw new Error('Detox camera invite hash is invalid');
          const captureRunId = basename(options.artifactRoot);
          if (!/^[a-f0-9]{24}$/.test(captureRunId))
            throw new Error('Detox camera artifact root is not a capture run ID');
          acquiredProxy.enableNativeRequestBodyCapture({
            artifactRoot: options.artifactRoot,
            captureRunId,
            sessionRunId: acquiredSession.manifest.runId,
            backendAttemptId: owner.backend.apiAttemptId,
            actorAuthUidSha256: hashBytes(Buffer.from(owner.fixture.studentAuthUid)),
            targetOrigin: owner.backend.apiOrigin,
            apiPid: owner.backend.apiPid,
            manualCodeSha256: inviteCodeSha256,
            actionSha256: hashBytes(Buffer.from('detox-camera-manual-submit-v1')),
          });
          armed = true;
          return Promise.resolve();
        };
        let authObservationPhaseIndex = 0;
        let previousAuthObservation: DetoxCameraAuthObservation | undefined;
        const verifyAuthActor = (
          expected: 'student' | 'coach',
        ): Promise<DetoxCameraAuthObservation> => {
          const phase = DETOX_CAMERA_AUTH_OBSERVATION_PHASES[authObservationPhaseIndex];
          if (!phase)
            throw new Error('Detox camera native auth observation sequence has extra phases');
          const expectedPhaseActor = phase === 'coach-transition' ? 'coach' : ('student' as const);
          if (expected !== expectedPhaseActor)
            throw new Error(
              `Detox camera auth actor ${expected} arrived during ${phase}; expected ${expectedPhaseActor}`,
            );
          const expectedAuthUid =
            expected === 'student' ? owner.fixture.studentAuthUid : owner.fixture.coachAuthUid;
          const expectedFixtureAuthUidAllowlistHash = hashBytes(
            Buffer.from(
              JSON.stringify([owner.fixture.studentAuthUid, owner.fixture.coachAuthUid].sort()),
            ),
          );
          const previousOrdinal = previousAuthObservation?.ordinal ?? 0;
          const previousRequestId = previousAuthObservation?.requestId ?? 0;
          const rows = acquiredProxy.nativeAuthIdentities
            .filter(
              (row: NativeAuthIdentityObservation) =>
                row.ordinal > previousOrdinal || row.requestId > previousRequestId,
            )
            .sort(
              (left, right) => left.ordinal - right.ordinal || left.requestId - right.requestId,
            );
          if (rows.length < 1)
            throw new Error(
              `Detox camera ${expected} sign-in has no fresh native auth identity for ${phase}`,
            );
          const seenOrdinals = new Set<number>();
          const seenRequestIds = new Set<number>();
          let lastOrdinal = previousOrdinal;
          let lastRequestId = previousRequestId;
          for (const row of rows) {
            if (
              !Number.isSafeInteger(row.ordinal) ||
              !Number.isSafeInteger(row.requestId) ||
              seenOrdinals.has(row.ordinal) ||
              seenRequestIds.has(row.requestId) ||
              row.ordinal <= lastOrdinal ||
              row.requestId <= lastRequestId ||
              row.targetOrigin !== owner.backend.apiOrigin ||
              row.apiPid !== owner.backend.apiPid ||
              row.status !== 201 ||
              row.verification !== 'verified' ||
              row.verificationReason !== 'verified' ||
              row.fixtureAuthUidAllowlistHash !== expectedFixtureAuthUidAllowlistHash ||
              row.authUid !== expectedAuthUid
            )
              throw new Error(
                `Detox camera ${expected} sign-in has an unbound or reordered native auth identity for ${phase}`,
              );
            seenOrdinals.add(row.ordinal);
            seenRequestIds.add(row.requestId);
            lastOrdinal = row.ordinal;
            lastRequestId = row.requestId;
          }
          const selected = rows[rows.length - 1];
          if (!selected)
            throw new Error(
              `Detox camera ${expected} sign-in has no selected native auth identity`,
            );
          const observation: DetoxCameraAuthObservation = {
            phase,
            actor: expected,
            ordinal: selected.ordinal,
            requestId: selected.requestId,
            targetOrigin: selected.targetOrigin,
            apiPid: selected.apiPid,
            status: 201,
            authUidSha256: hashBytes(Buffer.from(selected.authUid ?? '')),
            verification: 'verified',
            verificationReason: 'verified',
            fixtureAuthUidAllowlistHash: selected.fixtureAuthUidAllowlistHash,
          };
          previousAuthObservation = observation;
          authObservationPhaseIndex += 1;
          return Promise.resolve(observation);
        };
        const waitForSubmitTransport = async () => {
          await acquiredProxy.waitForQuiescence(
            Math.min(5_000, Math.max(1, Math.ceil(options.deadlineAt - Date.now()))),
            options.signal,
          );
          const body = acquiredProxy.nativeRequestBodyCapture;
          const rows = makeTransportRows(acquiredProxy, owner, body, owner.fixture.studentAuthUid);
          if (
            rows.filter((row) => row.requestId === body?.requestId && row.status === 201).length !==
            1
          )
            throw new Error(
              'Detox camera submitted request is not present in final proxy observations',
            );
          return rows;
        };
        const readSubmission = (requestId: number): Promise<DetoxCameraSubmission> => {
          if (!latestAfter)
            throw new Error('Detox camera submission readback preceded final SQL snapshot');
          const rows = latestAfter.rows.connections.filter(
            (row) =>
              row.id &&
              row.status === 'pending_confirmation' &&
              row.studentAuthUid === owner.fixture.studentAuthUid &&
              row.professionalAuthUid === owner.fixture.coachAuthUid &&
              row.specialty === 'fitness_coach' &&
              row.sourceInviteCodeId,
          );
          if (rows.length !== 1)
            throw new Error('Detox camera SQL readback did not identify one submitted connection');
          const row = rows[0];
          if (!row || !row.sourceInviteCodeId)
            throw new Error('Detox camera SQL submission row disappeared');
          return Promise.resolve({
            connectionId: row.id,
            specialty: 'fitness',
            sourceInviteCodeId: row.sourceInviteCodeId,
            requestId,
            status: 201,
            studentAuthUid: row.studentAuthUid,
            coachAuthUid: row.professionalAuthUid,
            unchangedOtherScope: Boolean(
              latestIsolationBefore &&
              latestIsolationAfter &&
              JSON.stringify(latestIsolationBefore.rows) ===
                JSON.stringify(latestIsolationAfter.rows),
            ),
          });
        };
        const producer = {
          owner,
          ipc,
          bootstrapReceipt,
          installedApp: installedAppAfterHelper,
          bootstrapEvidence,
          source: {
            repositoryRoot: root,
            sourceRevision: options.build.source?.sourceTreeHash ?? 'unknown',
            helperInputsHash: options.helperInputsHash,
            childSourceHash: childSourceSha256,
            declarationHash: options.declarationHash,
            publicBindingsHash,
          },
          permissionBefore,
          readCameraPermission,
          verifyAuthActor,
          snapshot,
          isolationSnapshot,
          verifyIsolationUnchanged,
          readSubmission,
          armSubmissionCapture,
          transportObservations: () =>
            makeTransportRows(
              acquiredProxy,
              owner,
              acquiredProxy.nativeRequestBodyCapture,
              owner.fixture.studentAuthUid,
            ),
          waitForSubmitTransport,
          shutdown: async () => {
            await ipc.request({ kind: 'shutdown' });
          },
          deadlineAt: options.deadlineAt,
          deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
        };
        return {
          artifactRoot: options.artifactRoot,
          stageRoot: options.stageRoot,
          producer,
          runtimeFacts,
          async cleanup(reason) {
            const recoverySignal = new AbortController().signal;
            const cleanupStarted = performance.now();
            const aggregate = await runDetoxCleanupAggregate({
              signal: recoverySignal,
              deadlineAt: options.deadlineAtMonotonicMs,
              steps: [
                ...(reason === 'completed'
                  ? [
                      {
                        label: 'child-wait',
                        operation: (remainingMs: number, signal: AbortSignal) =>
                          acquiredChild.wait(remainingMs, signal),
                      },
                    ]
                  : []),
                {
                  label: 'child-stop',
                  operation: async (remainingMs: number) => {
                    const settle = detoxChildCensusSettle(
                      Math.min(options.deadlineAtMonotonicMs, performance.now() + remainingMs),
                      options.signal,
                    );
                    await acquiredChild.capture(false, settle);
                    await acquiredChild.stop(settle);
                  },
                },
                {
                  label: 'expo-stop',
                  operation: () => acquiredExpo.stop(),
                },
                {
                  label: 'proxy-quiescence',
                  operation: (remainingMs: number, signal: AbortSignal) => {
                    signal.throwIfAborted();
                    const budgetMs = Math.min(30_000, Math.floor(remainingMs));
                    if (budgetMs < 1) throw new Error('Owned proxy quiescence deadline elapsed');
                    return acquiredProxy.waitForQuiescence(budgetMs, signal);
                  },
                },
                {
                  label: 'proxy-stop',
                  operation: () => acquiredProxy.stop(),
                },
                {
                  label: 'session-stop',
                  operation: () => acquiredSession.stop(),
                },
                {
                  label: 'target-stop',
                  operation: () => acquiredTarget.stop(),
                },
                {
                  label: 'after-ios-devices',
                  operation: () =>
                    captureIosDevices(options.artifactRoot, recoverySignal, {
                      signal: recoverySignal,
                      deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
                    }),
                },
                {
                  label: 'app-port-release',
                  operation: () => acquiredReservation.release(),
                },
              ],
            });
            const failures = [...aggregate.failures];
            const postChild = observeDetoxCameraChildOutcome(acquiredChild);
            if (postChild.status === 'observed') {
              runtimeFacts.childExitCode = postChild.code as number | null;
              runtimeFacts.childSignal = postChild.signal as NodeJS.Signals | null;
              runtimeFacts.childClassification =
                reason === 'aborted'
                  ? 'cancelled'
                  : postChild.code === 0 && postChild.signal === null
                    ? 'completed'
                    : 'child-failed';
            } else {
              failures.push('child-outcome-unknown');
              runtimeFacts.childClassification =
                reason === 'aborted' ? 'cancelled' : 'harness-blocked';
            }
            const cleanupLifecycle = {
              signal: recoverySignal,
              deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
            };
            const cleanupAggregate = {
              status: aggregate.status,
              recoveryStatus: aggregate.recoveryStatus,
              failures: [...aggregate.failures],
              timedOutLabels: [...aggregate.timedOutLabels],
              skippedLabels: [...aggregate.skippedLabels],
              stepResults: aggregate.stepResults.map((step) => ({ ...step })),
              elapsedMs: aggregate.elapsedMs,
            };
            const cleanupLabelByResource: Record<string, string> = {
              'app-port': 'app-port-release',
              target: 'target-stop',
              backend: 'session-stop',
              proxy: 'proxy-stop',
              expo: 'expo-stop',
              detox: 'child-stop',
            };
            const resourceStates = resourceRecords.map((record) => {
              const step = cleanupAggregate.stepResults.find(
                (candidate) => candidate.label === cleanupLabelByResource[record.resource],
              );
              return {
                resource: record.resource,
                acquisition: record.status,
                identity: record.identity,
                cleanup: step?.status ?? 'not-attempted',
                acquisitionFailure: record.failure ?? null,
              };
            });
            try {
              await writeOwnedExclusive(
                options.artifactRoot,
                'capture.private.json',
                Buffer.from(
                  JSON.stringify(
                    {
                      platform: captureNamespace.platform,
                      mode: captureNamespace.mode,
                      captureRunId: captureNamespace.captureRunId,
                      captureRoot: captureNamespace.captureRoot,
                      kind: 'private-owned-ios-detox-camera-capture',
                      scope: 'cleanup-only',
                      assertionsVerified: false,
                      publicPromotionEligible: false,
                      result:
                        failures.length === 0 &&
                        reason === 'completed' &&
                        runtimeFacts.childClassification === 'completed'
                          ? 'owner-completed-unverified'
                          : runtimeFacts.childClassification === 'cancelled'
                            ? 'cancelled'
                            : 'harness-blocked',
                      cleanup: failures.length === 0 ? 'cleaned' : 'failed',
                      acquisitionIntents: [...acquisitionIntents],
                      acquisitionSequence: [...acquisitionSequence],
                      reservedPorts: [
                        acquiredReservation.port,
                        Number(new URL(acquiredProxy.origin).port),
                      ],
                      proxyOrigin: acquiredProxy.origin,
                      device: { udid: acquiredTarget.deviceId },
                      backend: {
                        runId: acquiredSession.manifest.runId,
                        composeProject: acquiredSession.manifest.composeProject,
                        artifactRoot: acquiredSession.manifest.artifactRoot,
                        processes: acquiredSession.manifest.processes,
                      },
                      fixtureEvidence: fixtureEvidence ?? null,
                      fixtureHash: fixtureEvidence?.sha256 ?? null,
                      connectionIsolationFixtureEvidence:
                        connectionIsolationFixtureEvidence ?? null,
                      jestListTests: jestListTestsReceipt ?? null,
                      commandExecutions: [
                        {
                          command: childCommand.command,
                          argv: [...childCommand.argv],
                          cwd: childCommand.cwd,
                          pid: acquiredChild.pid,
                          pgid: acquiredChild.pgid,
                          startedAt: childIdentity?.startedAt ?? null,
                          exitCode: runtimeFacts.childExitCode,
                          signal: runtimeFacts.childSignal,
                          classification: runtimeFacts.childClassification,
                        },
                      ],
                      resourceStates,
                      cleanupAggregate,
                      postChild,
                    },
                    null,
                    2,
                  ) + '\n',
                ),
                cleanupLifecycle,
              );
            } catch {
              failures.push('capture-ledger');
            }
            let independent: 'cleaned' | 'failed' = 'failed';
            try {
              const result = await factories.verifyOwnedIosCleanup({
                repositoryRoot: root,
                artifactRoot: options.artifactRoot,
                signal: recoverySignal,
                deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
              });
              independent = result.result === 'passed' ? 'cleaned' : 'failed';
            } catch {
              failures.push('independent');
            }
            runtimeFacts.timingsMs.cleanup = performance.now() - cleanupStarted;
            return {
              captureCleanup: failures.length === 0 ? 'cleaned' : 'failed',
              independentCleanup: independent,
              ownedProcessPairs: [
                { pid: acquiredChild.pid, startedAt: childIdentity!.startedAt },
                {
                  pid: acquiredSession.apiPid,
                  startedAt: backendReceipt.apiStarted,
                },
              ],
              foreignResourcesPreserved: failures.length === 0,
              terminal:
                failures.length === 0 && reason === 'completed'
                  ? 'complete'
                  : reason === 'aborted'
                    ? 'aborted'
                    : 'blocked',
              error: failures.length ? failures.join(',') : null,
            } as const;
          },
        };
      } catch (error) {
        let partialCleanup: DetoxCameraCleanup;
        const partialCleanupStarted = performance.now();
        try {
          partialCleanup = await cleanupPartiallyAcquired(error);
        } catch (cleanupError) {
          runtimeFacts.timingsMs.cleanup = performance.now() - partialCleanupStarted;
          partialCleanup = {
            captureCleanup: 'failed',
            independentCleanup: 'failed',
            ownedProcessPairs: [],
            foreignResourcesPreserved: false,
            terminal: 'blocked',
            error:
              cleanupError instanceof Error
                ? `partial-cleanup:${cleanupError.message.slice(0, 200)}`
                : 'partial-cleanup:unknown-error',
          };
        }
        const retainedFailure =
          acquisitionFailure ??
          describeAcquisitionFailure(
            activeAcquisitionResource ?? resourceRecords.at(-1)?.resource ?? 'unknown',
            error,
            options.artifactRoot,
            'validation',
            resourceRecords.length === 0,
          );
        throw new DetoxCameraAcquisitionError(
          error instanceof Error ? error.message : 'Detox camera acquisition failed',
          runtimeFacts,
          partialCleanup,
          retainedFailure,
        );
      }
    },
  };
}
