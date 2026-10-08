import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants, createReadStream, type Stats } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import {
  ANDROID_PILOT_APP_ID,
  androidMetroPreference,
  androidSourceIdentity,
  assertAndroidReverseMappings,
  inspectOwnedAndroidApk,
  resolveAndroidPilotToolchain,
} from './android-build-identity';
import { createOwnedAndroidInputReader } from './android-native-input-reader';
import {
  androidSessionAssertionSequence,
  androidSessionPrerequisiteContract,
  buildAndroidSessionTerminalQualification,
  androidNativeCaptureExitCode,
  requireAndroidSessionCharter,
  type AndroidSessionAssertionReceipt,
} from './android-session-charter';
import {
  buildDetoxAndroidStorageCommandHash,
  type DetoxAndroidSessionStorageTarget,
} from './detox-android-session-storage-producer';
import { writeAtomicDetoxConnectionBytes } from './detox-connection-evidence';
import { sameNativeLocaleBinding, type NativeLocaleBinding } from './locale-native-observation';
import {
  captureAndroidReadonlyDiagnostic,
  type AndroidDriverDiagnosticLabel,
} from './native-android-driver-diagnostics';
import {
  startAndroidDriverStartupSampling,
  type AndroidDriverStartupSampler,
} from './native-android-driver-startup-sampling';
import {
  androidSessionStorageLimits,
  buildAndroidSessionActionPlans,
  buildAndroidSessionStorageProbePlan,
  parseAndroidSessionStorageObservation,
  redactAndroidSqliteQuery,
  parseAndroidStorageListing,
  requireAndroidPersistedLoginCheckpoint,
  requireAndroidPersistedProfileIdentityHash,
  requireAndroidSessionTransportSlice,
  requireAndroidOwnedApiLifetimeBinding,
  requireAndroidSessionCheckpointSet,
  requireAndroidSessionDomainBinding,
  requireAndroidCancelledConfirmationAbsent,
  requireAndroidRetainedNativeSessionIdentity,
  requireCoherentAndroidDatabaseListing,
  requireSameAndroidDatabaseListing,
  readOwnedAndroidStableFile,
  requireAndroidLocalSessionClear,
  writeOwnedAndroidPrivateFile,
  type AndroidCapturedFrameReceipt,
  type AndroidSessionCheckpointPhase,
  type AndroidSessionCheckpointReceipt,
  type AndroidStorageFileReceipt,
} from './native-android-session-adapter';
import { persistAndroidSessionCheckpointArtifacts } from './native-android-session-checkpoint-copy';
import { androidSessionPublicCommandLabelsByAssertion } from './native-android-session-public-contract';
import { requireAndroidMaestroCommandHashes } from './native-android-session-public-dependency';
import {
  deriveAndroidCameraPromptSpec,
  runAndroidCameraCaptureCallback,
} from './native-camera-android-capture-adapter';
import {
  buildAndroidCameraCommandReceipt,
  type AndroidCameraCaptureBoundary,
} from './native-camera-android-capture-adapter';
import {
  ANDROID_CAMERA_PERMISSION_PROMPT_SELECTOR_IDS,
  androidCameraSelectionHash,
  androidCameraExpectedAppLabel,
  buildAndroidCameraPermissionCommands,
  parseAndroidCameraPermissionStatus,
  parseAndroidCameraPermissionFlags,
  type AndroidCameraCommandReceipt,
  type AndroidCameraFrameSource,
  type AndroidCameraPermissionCheck,
} from './native-camera-android-contract';
import { readAndroidCameraManualRequestBinding } from './native-camera-android-observation';
import { requirePlatformConnectionInviteCode } from './native-connection-journey-core';
import { observeNativeConnectionStates } from './native-connection-observation';
import { ANDROID_CONNECTION_PLATFORM } from './native-connection-platform-contract';
import {
  requireConnectionSnapshot,
  type ConnectionSnapshotExpectedIdentity,
  type OwnedConnectionSnapshot,
} from './native-connection-snapshot';
import { nativeHierarchyHasAttribute, parseNativeHierarchy } from './native-hierarchy';
import {
  requireNativeHostAvailability,
  requireNativeHostAvailabilityAtStep,
} from './native-host-contention';
import {
  buildNativeLocaleBinding,
  normalizeNativeLocaleCommandOutput,
  readAndroidNativeLocaleProperties,
  readOwnedNativeLocaleStdout,
  safelyFinalizeNativeLocaleObservation,
  shouldPropagateAndroidLocaleCommandFailure,
  type AndroidLocalePropertyRead,
} from './native-locale-capture-seam';
import { buildNativeLocaleContextCandidateFromFile } from './native-locale-file-observation';
import {
  findMaestroQuantityFailureCommands,
  recordNativeQuantityFailure,
} from './native-maestro-assertion-failure';
import {
  selectNativePilotScenario,
  type NativePilotSelection,
  type NativePilotTarget,
} from './native-pilot-contract';
import {
  assertNativeBootstrapHealthy,
  inspectNativeMetroEntry,
  nativeExecutionDeadlines,
  nativeCommandDeadline,
  parseNativeExecutionDeadlines,
  NativeExecutionDeadlineError,
} from './native-runtime-preflight';
import {
  requireFinalSessionTransport,
  requireSignedOutSessionTransport,
  verifyNativeSessionProfileCheckpoints,
} from './native-session-profile-checkpoints';
import { observeNativeTrainingLoad } from './native-training-load-observation';
import { observeNativeTrainingDraft } from './native-training-observation';
import {
  acquireAdbServerReference,
  inspectAdbServer,
  requireAdbServerPreserved,
} from './owned-adb-server';
import {
  acquireOwnedAndroidEmulator,
  inspectPrivateAndroidDirectory,
} from './owned-android-emulator';
import { startOwnedApiProxy } from './owned-api-proxy';
import { reserveOwnedAppPort, startOwnedExpo } from './owned-expo';
import { executeOwnedNativeCommand } from './owned-native-command';
import { inspectProcessIdentity } from './owned-process-group';
import {
  OwnedSessionAcquisitionError,
  readOwnedRuntimeDocumentWithReceipt,
  startOwnedSession,
} from './owned-session';
import {
  copyQualifiedAndroidMaestroApk,
  type AndroidMaestroQualifiedBuildReuse,
} from './t15-cold-android-maestro-build-reuse';
import {
  verifyOwnedAndroidCleanupBeforeCapturePublication,
  type AndroidCleanupCapturePublication,
} from './verify-owned-android-cleanup';
import type { AndroidNativeInputObservation } from './android-native-input-reader';
import type {
  AndroidCameraIsolationFixtureBinding,
  AndroidCameraProducerReceipts,
} from './native-camera-android-producer';
import type { NativeExecutionDeadlines } from './native-runtime-preflight';
import type { NativeTrainingObserve } from './native-training-maestro-driver';
import type { AdbServerIdentity } from './owned-adb-server';
import type { NativeAuthIdentityObservation, ProxyObservation } from './owned-api-proxy';
import type { NativeCommandExecution, startOwnedNativeCommand } from './owned-native-command';
import type { OwnedDomainSnapshot, OwnedFixtures } from './owned-session';
const execute = promisify(execFile);
const androidCameraSavedFlowModulePath = './native-camera-android-saved-flow' as const;

async function loadAndroidCameraSavedFlowModule() {
  assert.equal(androidCameraSavedFlowModulePath, './native-camera-android-saved-flow');
  return import('./native-camera-android-saved-flow');
}
const maestroDiagnosticEnvironmentKeys = [
  'MAESTRO_DRIVER_STARTUP_TIMEOUT',
  'MAESTRO_CLI_NO_ANALYTICS',
  'MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED',
] as const;
const androidDriverPortParseLimitBytes = 1024 * 1024;
const androidCameraHelperMaxFileBytes = 16 * 1024 * 1024;
const androidCameraHelperMaxAggregateBytes = 512 * 1024 * 1024;

type AndroidCameraSourceFence = readonly {
  path: string;
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
}[];

function requireAndroidCameraHelperDeadline(
  signal: AbortSignal | undefined,
  deadlineAtMonotonicMs: number,
  label: string,
): void {
  signal?.throwIfAborted();
  if (!Number.isFinite(deadlineAtMonotonicMs) || performance.now() >= deadlineAtMonotonicMs)
    throw new NativeExecutionDeadlineError(
      label,
      Math.max(0, deadlineAtMonotonicMs - performance.now()),
    );
}

async function androidCameraSourceFence(
  root: string,
  relativePath?: string,
): Promise<AndroidCameraSourceFence> {
  const absolute = relativePath ? path.resolve(root, relativePath) : root;
  if (!absolute.startsWith(root + path.sep) && absolute !== root)
    throw new Error('Android camera helper path escaped the source root');
  const ancestors: string[] = [];
  let current = absolute === root ? root : path.dirname(absolute);
  for (;;) {
    ancestors.push(current);
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current || !parent.startsWith(root))
      throw new Error('Android camera helper ancestor escaped the source root');
    current = parent;
  }
  const rows: {
    path: string;
    dev: number;
    ino: number;
    uid: number;
    gid: number;
    mode: number;
    nlink: number;
  }[] = [];
  for (const ancestor of ancestors.reverse()) {
    const info = await lstat(ancestor);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o022) !== 0 ||
      (await realpath(ancestor)) !== ancestor
    )
      throw new Error(`Android camera helper ancestor is not stable: ${ancestor}`);
    rows.push({
      path: ancestor,
      dev: info.dev,
      ino: info.ino,
      uid: info.uid,
      gid: info.gid,
      mode: info.mode & 0o777,
      nlink: info.nlink,
    });
  }
  return rows;
}

type AndroidCameraHelperFileIdentity = {
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  nlink: number;
};

function androidCameraHelperFileIdentity(info: Stats): AndroidCameraHelperFileIdentity {
  return {
    dev: info.dev,
    ino: info.ino,
    uid: info.uid,
    gid: info.gid,
    mode: info.mode & 0o777,
    size: info.size,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
    nlink: info.nlink,
  };
}

function requireSameAndroidCameraHelperIdentity(
  before: AndroidCameraHelperFileIdentity,
  after: AndroidCameraHelperFileIdentity,
  label: string,
): void {
  assert.deepEqual(after, before, `${label} changed while reading`);
}

async function yieldAndroidCameraHelperReadTurn(
  signal: AbortSignal | undefined,
  deadlineAtMonotonicMs: number,
  label: string,
): Promise<void> {
  requireAndroidCameraHelperDeadline(signal, deadlineAtMonotonicMs, label);
  await new Promise<void>((resolve) => setImmediate(resolve));
  requireAndroidCameraHelperDeadline(signal, deadlineAtMonotonicMs, label);
}

/**
 * Read one helper through an owned descriptor in bounded asynchronous chunks.
 * The event-loop yield and the checks on both sides of every chunk are
 * deliberate: a cancellation or expired caller deadline must be observed
 * before a late buffer can enter the helper hash ledger.
 */
async function readAndroidCameraHelperDescriptor(options: {
  repositoryRoot: string;
  relativePath: string;
  signal?: AbortSignal;
  deadlineAtMonotonicMs: number;
}): Promise<{ bytes: Buffer; identity: AndroidCameraHelperFileIdentity }> {
  const label = `Android camera helper ${options.relativePath}`;
  requireAndroidCameraHelperDeadline(
    options.signal,
    options.deadlineAtMonotonicMs,
    'Android camera helper closure',
  );
  const root = options.repositoryRoot;
  const absolute = path.resolve(root, options.relativePath);
  assert(absolute.startsWith(`${root}${path.sep}`), `${label} escaped the source root`);
  const before = await lstat(absolute);
  assert(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1 &&
      before.uid === process.getuid?.() &&
      (before.mode & 0o022) === 0 &&
      before.size > 0 &&
      before.size <= androidCameraHelperMaxFileBytes,
    `${label} is not a bounded owned regular file`,
  );
  const beforeIdentity = androidCameraHelperFileIdentity(before);
  const descriptor = await open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorBefore = androidCameraHelperFileIdentity(await descriptor.stat());
    requireSameAndroidCameraHelperIdentity(descriptorBefore, beforeIdentity, label);
    const targetBytes = Math.min(androidCameraHelperMaxFileBytes + 1, descriptorBefore.size + 1);
    const bytes = Buffer.allocUnsafe(targetBytes);
    let bytesRead = 0;
    while (bytesRead < targetBytes) {
      requireAndroidCameraHelperDeadline(
        options.signal,
        options.deadlineAtMonotonicMs,
        'Android camera helper closure',
      );
      const chunk = await descriptor.read(
        bytes,
        bytesRead,
        Math.min(64 * 1024, targetBytes - bytesRead),
        bytesRead,
      );
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
      await yieldAndroidCameraHelperReadTurn(
        options.signal,
        options.deadlineAtMonotonicMs,
        'Android camera helper closure',
      );
    }
    const descriptorAfter = androidCameraHelperFileIdentity(await descriptor.stat());
    const pathAfter = androidCameraHelperFileIdentity(await lstat(absolute));
    requireSameAndroidCameraHelperIdentity(descriptorAfter, descriptorBefore, label);
    requireSameAndroidCameraHelperIdentity(pathAfter, descriptorBefore, label);
    assert.equal(await realpath(absolute), absolute, `${label} path changed while reading`);
    assert.equal(bytesRead, descriptorAfter.size, `${label} byte count changed`);
    assert(bytesRead <= androidCameraHelperMaxFileBytes, `${label} exceeds its bounded size`);
    requireAndroidCameraHelperDeadline(
      options.signal,
      options.deadlineAtMonotonicMs,
      'Android camera helper closure',
    );
    return { bytes: bytes.subarray(0, bytesRead), identity: descriptorAfter };
  } finally {
    await descriptor.close();
  }
}

/**
 * Read the complete Android camera helper closure through the same protected
 * descriptor reader used by runtime eligibility. This source-only seam is
 * intentionally exported so cancellation, expiry, symlink, link-count and
 * aggregate-budget controls can be exercised without acquiring a device.
 */
export async function readAndroidCameraHelperInputs(options: {
  repositoryRoot: string;
  helperPaths: readonly string[];
  signal?: AbortSignal;
  deadlineAtMonotonicMs: number;
}): Promise<readonly { path: string; sha256: string }[]> {
  requireAndroidCameraHelperDeadline(
    options.signal,
    options.deadlineAtMonotonicMs,
    'Android camera helper closure',
  );
  const rootFenceBefore = await androidCameraSourceFence(options.repositoryRoot);
  let aggregateBytes = 0;
  const rows: { path: string; sha256: string }[] = [];
  for (const file of options.helperPaths) {
    requireAndroidCameraHelperDeadline(
      options.signal,
      options.deadlineAtMonotonicMs,
      'Android camera helper closure',
    );
    const relativePath =
      file === 'package.json' || file.startsWith('scripts/') || file.startsWith('.maestro/')
        ? file
        : `scripts/testing/${file}`;
    const sourceFenceBefore = await androidCameraSourceFence(options.repositoryRoot, relativePath);
    const absolutePath = path.join(options.repositoryRoot, relativePath);
    const fileBefore = await lstat(absolutePath);
    if (
      !fileBefore.isFile() ||
      fileBefore.isSymbolicLink() ||
      fileBefore.nlink !== 1 ||
      fileBefore.uid !== process.getuid?.() ||
      (fileBefore.mode & 0o022) !== 0 ||
      fileBefore.size <= 0 ||
      fileBefore.size > androidCameraHelperMaxFileBytes
    )
      throw new Error(`Android camera helper is not a bounded owned regular file: ${relativePath}`);
    aggregateBytes += fileBefore.size;
    if (aggregateBytes > androidCameraHelperMaxAggregateBytes)
      throw new Error('Android camera helper closure exceeds its aggregate byte cap');
    const observation = await readAndroidCameraHelperDescriptor({
      repositoryRoot: options.repositoryRoot,
      relativePath,
      signal: options.signal,
      deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    });
    requireAndroidCameraHelperDeadline(
      options.signal,
      options.deadlineAtMonotonicMs,
      'Android camera helper closure',
    );
    const sourceFenceAfter = await androidCameraSourceFence(options.repositoryRoot, relativePath);
    if (
      JSON.stringify(sourceFenceAfter) !== JSON.stringify(sourceFenceBefore) ||
      JSON.stringify(await androidCameraSourceFence(options.repositoryRoot)) !==
        JSON.stringify(rootFenceBefore)
    )
      throw new Error(
        `Android camera helper root or ancestor changed during read: ${relativePath}`,
      );
    rows.push({
      path: relativePath,
      sha256: createHash('sha256').update(observation.bytes).digest('hex'),
    });
  }
  requireAndroidCameraHelperDeadline(
    options.signal,
    options.deadlineAtMonotonicMs,
    'Android camera helper closure',
  );
  if (
    JSON.stringify(await androidCameraSourceFence(options.repositoryRoot)) !==
    JSON.stringify(rootFenceBefore)
  )
    throw new Error('Android camera helper source root changed during closure read');
  return rows;
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

/**
 * A reused APK keeps the original API URL in its embedded Expo config. The
 * current capture owns a fresh API process, so the device-facing original
 * port is reverse-mapped to the current host port instead of reusing the
 * original listener. This proves both sides of that translation from adb's
 * observed mapping rather than treating the current port as the build input.
 */
function assertAndroidReverseBindings(
  output: string,
  serial: string,
  bindings: readonly { devicePort: number; hostPort: number }[],
): void {
  if (!/^emulator-\d+$/.test(serial) || bindings.length === 0)
    throw new Error('Invalid Android reverse binding expectation');
  const rows = output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/));
  if (
    rows.length !== bindings.length ||
    new Set(rows.map((row) => row[0])).size !== 1 ||
    !rows[0]?.[0] ||
    (rows[0][0] !== serial && !/^host-\d+$/.test(rows[0][0]))
  )
    throw new Error('Android reverse binding is absent or owned by another target');
  for (const binding of bindings) {
    if (
      !Number.isSafeInteger(binding.devicePort) ||
      binding.devicePort < 1024 ||
      binding.devicePort > 65535 ||
      !Number.isSafeInteger(binding.hostPort) ||
      binding.hostPort < 1024 ||
      binding.hostPort > 65535 ||
      !rows.some(
        (row) =>
          row.length === 3 &&
          row[1] === `tcp:${binding.devicePort}` &&
          row[2] === `tcp:${binding.hostPort}`,
      )
    )
      throw new Error('Android reverse binding is absent or points to an unexpected endpoint');
  }
}

function configWithApiOrigin(value: unknown, apiOrigin: string): Record<string, unknown> {
  const config = structuredClone(record(value, 'Android Expo config'));
  const server = record(config.server, 'Android Expo server config');
  server.baseUrl = apiOrigin;
  return config;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

export type AndroidCameraCleanupVerificationResult = {
  capturePublication: AndroidCleanupCapturePublication;
  result: string;
  censusStatus: string;
  androidCleanupReceipt?: unknown;
};

/**
 * The camera finally block must prove its same-attempt cleanup before publishing the
 * capture document. The public inspector normally rereads capture.private.json; this
 * producer-only route supplies a deep-frozen, same-attempt snapshot with the final
 * cleanup status. It rejects a previously published capture to prevent an old/foreign
 * receipt from being promoted.
 */
export async function verifyAndroidCameraCleanupBeforeCapturePublication(options: {
  report: Record<string, unknown>;
  cleanupFailures: readonly string[];
  plannedCleanup: 'cleaned' | 'not-acquired';
  captureRunId: string;
  publication: AndroidCleanupCapturePublication;
  repositoryRoot: string;
  artifactRoot: string;
  androidRuntimeParent: string;
  sdkRoot: string;
}): Promise<AndroidCameraCleanupVerificationResult> {
  assert.equal(
    options.publication,
    'provisional-before-capture-publication',
    'Android camera cleanup publication must be provisional before capture publication',
  );
  assert.match(options.captureRunId, /^[a-f0-9]{24}$/);
  assert.equal(options.report.captureRunId, options.captureRunId);
  const repositoryRoot = await realpath(options.repositoryRoot);
  const artifactRoot = await realpath(options.artifactRoot);
  assert.equal(
    artifactRoot,
    path.join(repositoryRoot, '.qa/artifacts/native-pilot', options.captureRunId),
    'Android camera cleanup capture root does not belong to the requested attempt',
  );
  const capturePath = path.join(artifactRoot, 'capture.private.json');
  try {
    await lstat(capturePath);
    throw new Error('Android camera cleanup provisional view requires an unpublished capture');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const provisionalDocument = deepFreeze({
    ...structuredClone(options.report),
    cleanup: options.cleanupFailures.length ? 'failed-recovery-retained' : options.plannedCleanup,
    cleanupFailures: [...options.cleanupFailures],
  });
  return verifyOwnedAndroidCleanupBeforeCapturePublication({
    repositoryRoot,
    artifactRoot,
    androidRuntimeParent: options.androidRuntimeParent,
    sdkRoot: options.sdkRoot,
    capture: {
      document: provisionalDocument,
      publication: options.publication,
    },
  });
}

function captureMaestroDiagnosticEnvironment(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    maestroDiagnosticEnvironmentKeys.map((key) => [key, env[key] ?? null]),
  ) as Record<(typeof maestroDiagnosticEnvironmentKeys)[number], string | null>;
}

function parseRecordedMaestroDriverPort(log: string, complete: boolean) {
  if (!complete) return null;
  const values = [...log.matchAll(/port\s*\[\s*dadb\.open\(\s*tcp:(\d+)\s*\)\s*\]/gi)].map(
    (match) => Number(match[1]),
  );
  if (
    values.some((port) => !Number.isSafeInteger(port) || port < 1 || port > 65535) ||
    new Set(values).size !== 1
  )
    return null;
  return values[0] ?? null;
}

async function inspectOriginalOwnedCommandLog(filePath: string, artifactRoot: string) {
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) !== path.resolve(artifactRoot))
    throw new Error('Original Android command log must be a direct private artifact child');
  const metadata = await lstat(resolved);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o600 ||
    (await realpath(resolved)) !== resolved
  )
    throw new Error('Original Android command log must remain canonical and private');
  if (metadata.size > androidDriverPortParseLimitBytes)
    return {
      path: resolved,
      sourceKind: 'combined-owned-command-log' as const,
      sizeBytes: metadata.size,
      sha256: null,
      parseWindowBytes: 0,
      parseComplete: false,
      recordedDriverPort: null,
    };
  const hash = createHash('sha256');
  const parseChunks: Buffer[] = [];
  let parseBytes = 0;
  for await (const chunk of createReadStream(resolved, {
    start: 0,
    end: androidDriverPortParseLimitBytes - 1,
  })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(bytes);
    if (parseBytes < androidDriverPortParseLimitBytes) {
      const remaining = androidDriverPortParseLimitBytes - parseBytes;
      const sample = Buffer.from(bytes.subarray(0, remaining));
      parseChunks.push(sample);
      parseBytes += sample.byteLength;
    }
  }
  const parseWindow = Buffer.concat(parseChunks).toString('utf8');
  const parseComplete = parseBytes === metadata.size;
  return {
    path: resolved,
    sourceKind: 'combined-owned-command-log' as const,
    sizeBytes: metadata.size,
    sha256: parseComplete ? hash.digest('hex') : null,
    parseWindowBytes: parseBytes,
    parseComplete,
    recordedDriverPort: parseRecordedMaestroDriverPort(parseWindow, parseComplete),
  };
}

type AndroidReadonlyDiagnosticTarget = {
  runId: string;
  identity: { serial: string };
  slot: { adbServerPort: number };
  verify: (phaseDeadline?: number) => Promise<void>;
  adbRead: (argv: string[], timeoutMs?: number, phaseDeadline?: number) => Promise<string>;
};

type AndroidDiagnosticCaptureOutcome =
  | {
      kind: 'captured';
      result: Awaited<ReturnType<typeof captureAndroidReadonlyDiagnostic>>;
    }
  | { kind: 'publication-failed'; error: { name: string; message: string } }
  | { kind: 'skipped'; reason: string };

/**
 * Capture the bounded, read-only Android driver diagnostics for one original
 * command outcome. The supplied target must already be owned; this function
 * does not acquire, launch, retry or signal native resources.
 *
 * `capture` and `now` are narrow seams for resource-free contract tests. The
 * production path uses the private receipt helper and `performance.now`.
 */
export async function captureAndroidReadonlyDiagnosticsWithBudget(options: {
  artifactRoot: string;
  trigger: string;
  originalExecution: NativeCommandExecution;
  target: AndroidReadonlyDiagnosticTarget;
  signal: AbortSignal;
  report: Record<string, unknown>;
  capture?: typeof captureAndroidReadonlyDiagnostic;
  now?: () => number;
}) {
  const { artifactRoot, originalExecution, target, signal, report } = options;
  const capture = options.capture ?? captureAndroidReadonlyDiagnostic;
  const now = options.now ?? (() => performance.now());
  report.androidDriverDiagnosticTrigger = options.trigger;
  report.androidDriverOriginalExecution = {
    execution: originalExecution.execution,
    cleanup: originalExecution.cleanup,
    childExitCode: originalExecution.childExitCode,
    childSignal: originalExecution.childSignal,
    pid: originalExecution.pid,
    pgid: originalExecution.pgid,
    logPath: originalExecution.logPath,
    stdoutPath: originalExecution.stdoutPath,
    outputFailure: originalExecution.outputFailure ?? null,
    censusFailure: originalExecution.censusFailure ?? null,
  };
  const targetIdentity = {
    captureRunId: path.basename(artifactRoot),
    ownerRunId: target.runId,
    serial: target.identity.serial,
    adbServerPort: target.slot.adbServerPort,
  };
  const diagnostics: Record<string, unknown> = {};
  report.androidDriverDiagnostics = diagnostics;
  const publicationErrors: Record<string, { name: string; message: string }> = {};
  report.androidDriverDiagnosticPublicationErrors = publicationErrors;
  const diagnosticDeadline = now() + 30_000;
  const diagnosticStartedAt = diagnosticDeadline - 30_000;
  let diagnosticBudgetExhausted = false;
  const skipped: string[] = [];
  const deviceDiagnosticLabels: readonly AndroidDriverDiagnosticLabel[] = [
    'android-driver-instrumentation-inventory',
    'android-driver-device-logcat',
    'android-driver-package-state',
    'android-driver-process-state',
    'android-driver-port-state',
  ];
  report.originalMaestroDriverPort = null;
  report.androidDriverDiagnosticBudget = {
    totalMs: 30_000,
    perQueryMs: 5_000,
    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
  };
  const boundedError = (error: unknown, fallbackMessage: string) =>
    error instanceof Error
      ? { name: error.name.slice(0, 128), message: error.message.slice(0, 512) }
      : { name: 'UnknownError', message: fallbackMessage };
  const markCollectionStatus = () => {
    const currentTime = now();
    const elapsedMs = Math.max(0, Math.floor(currentTime - diagnosticStartedAt));
    const overrunMs = Math.max(0, elapsedMs - 30_000);
    report.androidDriverDiagnosticCollection = signal.aborted
      ? {
          status: 'interrupted',
          reason: 'signal-aborted',
          elapsedMs,
          overrunMs,
        }
      : diagnosticBudgetExhausted || currentTime >= diagnosticDeadline
        ? {
            status: 'budget-exhausted',
            reason: 'total-deadline',
            elapsedMs,
            overrunMs,
          }
        : { status: 'complete', elapsedMs, overrunMs };
  };
  const remainingTimeout = () => {
    const remaining = Math.floor(diagnosticDeadline - now());
    if (remaining <= 0) {
      diagnosticBudgetExhausted = true;
      throw new Error('Android driver diagnostic total deadline');
    }
    return Math.min(5_000, remaining);
  };
  const labels = new Set<AndroidDriverDiagnosticLabel>();
  const captureOne = async (
    label: AndroidDriverDiagnosticLabel,
    read: () => Promise<string | Buffer | undefined>,
  ): Promise<AndroidDiagnosticCaptureOutcome> => {
    if (labels.has(label)) return { kind: 'skipped', reason: 'already-attempted' };
    labels.add(label);
    if (signal.aborted) {
      diagnostics[label] = {
        status: 'blocked',
        skippedReason: 'android-driver-diagnostic-signal-aborted',
      };
      return {
        kind: 'skipped',
        reason: 'android-driver-diagnostic-signal-aborted',
      };
    }
    let timeoutMs: number;
    try {
      timeoutMs = remainingTimeout();
    } catch {
      diagnostics[label] = {
        status: 'blocked',
        skippedReason: 'android-driver-diagnostic-total-deadline-expired',
      };
      return {
        kind: 'skipped',
        reason: 'android-driver-diagnostic-total-deadline-expired',
      };
    }
    try {
      const result = await capture({
        artifactRoot,
        label,
        read,
        timeoutMs,
        target: targetIdentity,
      });
      diagnostics[label] = {
        status: result.receipt.status,
        receiptPath: result.receiptPath,
        outputPaths: result.outputPaths,
        originalCause: result.receipt.originalCause,
        observedError: result.receipt.observedError,
        outputLimitExceeded: result.receipt.outputLimitExceeded,
      };
      return { kind: 'captured', result };
    } catch (error) {
      const detail = boundedError(error, 'Android driver diagnostic persistence failed');
      publicationErrors[label] = detail;
      diagnostics[label] = {
        status: 'blocked',
        publicationError: detail,
      };
      return { kind: 'publication-failed', error: detail };
    }
  };

  if (originalExecution.logPath && !originalExecution.stdoutPath) {
    try {
      const originalOutput = await inspectOriginalOwnedCommandLog(
        originalExecution.logPath,
        artifactRoot,
      );
      report.androidDriverOriginalOutput = {
        status: 'observed',
        ...originalOutput,
      };
      report.originalMaestroDriverPort = originalOutput.recordedDriverPort;
    } catch (error) {
      report.androidDriverOriginalOutput = {
        status: 'unknown',
        path: originalExecution.logPath,
        sourceKind: 'combined-owned-command-log',
        error: boundedError(error, 'Original Android command log unavailable'),
      };
    }
  } else if (originalExecution.stdoutPath || originalExecution.logPath) {
    report.androidDriverOriginalOutput = {
      status: 'unknown',
      path: originalExecution.stdoutPath ?? originalExecution.logPath,
      sourceKind: 'owned-command-streams-not-combined',
    };
  } else {
    report.androidDriverOriginalOutput = {
      status: 'unknown',
      path: null,
      sourceKind: 'combined-owned-command-log',
    };
  }

  const verification = await captureOne('android-driver-target-verification', async () => {
    const timeoutMs = remainingTimeout();
    await target.verify(Math.min(diagnosticDeadline, now() + timeoutMs));
    return 'verified';
  });
  if (verification.kind !== 'captured' || verification.result.receipt.status !== 'passed') {
    report.androidDriverDiagnosticVerification = {
      status: verification.kind === 'captured' ? verification.result.receipt.status : 'blocked',
      receiptPath: verification.kind === 'captured' ? verification.result.receiptPath : null,
    };
    report.androidDriverDiagnosticSkipped = [...deviceDiagnosticLabels];
    markCollectionStatus();
    return {
      attemptedLabels: [...labels],
      skipped: [...deviceDiagnosticLabels],
    };
  }
  report.androidDriverDiagnosticVerification = {
    status: 'passed',
    receiptPath: verification.result.receiptPath,
  };
  const fixedQueries: readonly [AndroidDriverDiagnosticLabel, readonly string[]][] = [
    ['android-driver-instrumentation-inventory', ['shell', 'pm', 'list', 'instrumentation']],
    ['android-driver-device-logcat', ['logcat', '-d', '-v', 'threadtime', '-t', '1000']],
    [
      'android-driver-package-state',
      ['shell', 'pm', 'list', 'packages', '--user', '0', 'dev.mobile.maestro'],
    ],
    ['android-driver-process-state', ['shell', 'ps', '-A']],
    ['android-driver-port-state', ['shell', 'cat', '/proc/net/tcp']],
  ];
  for (const [label, argv] of fixedQueries) {
    if (signal.aborted) {
      skipped.push(label);
      continue;
    }
    const outcome = await captureOne(label, async () => {
      const readTimeoutMs = remainingTimeout();
      const queryDeadline = Math.min(diagnosticDeadline, now() + readTimeoutMs);
      await target.verify(queryDeadline);
      return target.adbRead([...argv], readTimeoutMs, queryDeadline);
    });
    if (outcome.kind === 'skipped' && outcome.reason !== 'already-attempted') {
      skipped.push(
        label,
        ...fixedQueries
          .slice(fixedQueries.findIndex(([row]) => row === label) + 1)
          .map(([row]) => row),
      );
      break;
    }
  }
  if (skipped.length) report.androidDriverDiagnosticSkipped = [...new Set(skipped)];
  markCollectionStatus();
  return { attemptedLabels: [...labels], skipped: [...new Set(skipped)] };
}

export const androidInventoryCharters = [
  'entry-and-login',
  'training-draft',
  'training-load',
  'connection-states',
] as const;
export type AndroidInventoryCharter = (typeof androidInventoryCharters)[number];
export const androidSessionCharters = ['session-account', 'auth-account'] as const;
export type AndroidNativeSessionCharter =
  | AndroidInventoryCharter
  | (typeof androidSessionCharters)[number]
  | 'training-journey'
  | 'connection-journey'
  | 'save-retry'
  | 'camera-denied';
export type AndroidTrainingRuntimeContext = {
  output: string;
  fixtures: OwnedFixtures;
  proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>;
  signal: AbortSignal;
  observe: NativeTrainingObserve;
  snapshot: () => ReturnType<Awaited<ReturnType<typeof startOwnedSession>>['snapshot']>;
  restartRuntime: () => Promise<void>;
  readAndroidTitle: (label: string) => Promise<AndroidNativeInputObservation>;
};
export type AndroidSaveRetryRuntimeContext = Pick<
  AndroidTrainingRuntimeContext,
  'output' | 'fixtures' | 'proxy' | 'signal' | 'observe' | 'snapshot'
> & {
  accountUid: string;
  /** The owned capture report; the save observer appends raw preparation facts here. */
  report: Record<string, unknown>;
};
export type AndroidConnectionAccount = 'coach' | 'student';
export type AndroidConnectionNavigation = 'none' | 'student-professionals-back';
export type AndroidConnectionApiIdentity = {
  apiPid: number;
  targetOrigin: string;
};
export type AndroidConnectionAccountSwitchResult = {
  actor: AndroidConnectionAccount;
  beforeRequestId: number;
  authRequestId: number;
  afterRequestId: number;
  actorAuthUid: string;
};
export type AndroidConnectionRuntimeContext = {
  output: string;
  fixtures: OwnedFixtures;
  proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>;
  apiIdentity: AndroidConnectionApiIdentity;
  observe: AndroidTrainingRuntimeContext['observe'];
  snapshot: () => Promise<OwnedDomainSnapshot>;
  connectionSnapshot: () => Promise<OwnedConnectionSnapshot>;
  isolationSnapshot: () => Promise<OwnedConnectionSnapshot>;
  report: Record<string, unknown>;
  switchAccount: (
    actor: AndroidConnectionAccount,
    navigation?: AndroidConnectionNavigation,
  ) => Promise<AndroidConnectionAccountSwitchResult>;
};
export type OwnedAndroidNativeSessionOptions = {
  charter: AndroidNativeSessionCharter;
  signal?: AbortSignal;
  deadlines?: NativeExecutionDeadlines;
  deadlineAtMonotonicMs?: number;
  coldResetOwnerRunId?: string;
  coldResetFixtureResetId?: string;
  prepareColdReset?: AndroidOwnedNativeSessionPreparation;
  selection?: NativePilotSelection;
  expectedLocale?: 'en-US' | 'pt-BR' | 'es-ES';
  executeTraining?: (context: AndroidTrainingRuntimeContext) => Promise<void>;
  executeSaveRetry?: (context: AndroidSaveRetryRuntimeContext) => Promise<void>;
  executeConnection?: (context: AndroidConnectionRuntimeContext) => Promise<void>;
  executeCamera?: (context: AndroidCameraCaptureBoundary) => Promise<AndroidCameraProducerReceipts>;
  /** Optional immutable APK bytes qualified for this exact Android/Maestro cohort. */
  qualifiedBuild?: AndroidMaestroQualifiedBuildReuse;
};
export type OwnedAndroidNativeSessionResult = {
  artifactRoot: string;
  exitCode: number;
  report: Record<string, unknown>;
};

/**
 * The one preparation seam used by the T15 cold owner. It is exposed only
 * after the Android target, backend, proxy, build, install and reverse/prefs
 * setup are already owned by this capture. The callback cannot acquire a
 * second resource namespace or provide a caller-shaped target.
 */
export type AndroidOwnedNativeSessionPreparationContext = {
  output: string;
  captureRunId: string;
  ownerRunId: string;
  target: Awaited<ReturnType<typeof acquireOwnedAndroidEmulator>> & {
    androidSessionStorage: DetoxAndroidSessionStorageTarget;
  };
  session: Awaited<ReturnType<typeof startOwnedSession>>;
  proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>;
  proxyProcess: { pid: number; started: string; script: string };
  fixtures: OwnedFixtures & { resetId: string };
  build: {
    appId: string;
    buildProfile: string;
    binaryHash: string;
    apiOrigin: string;
    sourceTreeHash?: string;
    helperInputsHash?: string;
    flagsFingerprint?: string;
    environmentHash?: string;
    qualifiedReuse?: {
      buildId: string;
      binaryHash: string;
      originalPorts: AndroidMaestroQualifiedBuildReuse['originalPorts'];
      originalOrigins: AndroidMaestroQualifiedBuildReuse['originalOrigins'];
    };
  };
  installedApk: { path: string; sha256: string; sizeBytes: number };
  commandExecutions: readonly (NativeCommandExecution & { label: string; deadlineMs: number })[];
  signal: AbortSignal;
  deadlineAtMonotonicMs?: number;
  report: Record<string, unknown>;
};

/** Return a producer-owned, protected cold-reset result to persist in the capture report. */
export type AndroidOwnedNativeSessionPreparation = (
  context: AndroidOwnedNativeSessionPreparationContext,
) => Promise<Record<string, unknown>>;

type AndroidCameraPromptReadinessInput = {
  tree: unknown;
  requiredSelectors: readonly string[];
  kind: 'id' | 'text';
  serial: string;
  apiLevel: number;
  locale: 'en-US' | 'pt-BR' | 'es-ES';
  expectedAppLabel: string;
};

/**
 * Keep Maestro readiness alternatives separate from hierarchy evidence. The
 * readiness tuple is closed and bounded; once the tree is captured, the
 * existing prompt adapter selects one concrete controller package and checks
 * duplicates, mixed packages, locale, app label, bounds, enabled state, and
 * deny clickability before exact resource IDs become descriptor selectors.
 */
export function requireAndroidCameraPromptHierarchy(input: AndroidCameraPromptReadinessInput): {
  spec: ReturnType<typeof deriveAndroidCameraPromptSpec>;
  selectors: readonly [string, string];
} {
  assert.equal(input.kind, 'id', 'Android camera prompt readiness must use resource IDs');
  assert.deepEqual(
    [...input.requiredSelectors],
    [...ANDROID_CAMERA_PERMISSION_PROMPT_SELECTOR_IDS],
    'Android camera prompt readiness selectors are outside the bounded contract',
  );
  assert(/^emulator-[0-9]+$/u.test(input.serial), 'Android camera prompt serial is invalid');
  assert(Number.isSafeInteger(input.apiLevel) && input.apiLevel > 0);
  const spec = deriveAndroidCameraPromptSpec({
    source: { label: 'prompt' } as AndroidCameraFrameSource,
    tree: input.tree,
    serial: input.serial,
    apiLevel: input.apiLevel,
    locale: input.locale,
    expectedAppLabel: input.expectedAppLabel,
  });
  const selectors = [spec.title.value, spec.deny.value] as const;
  assert(
    selectors.every((value) => nativeHierarchyHasAttribute(input.tree, 'resource-id', value)),
    'Android actual hierarchy lacks exact required selector',
  );
  return { spec, selectors };
}

export type AndroidConnectionBackendProcess = {
  role: string;
  pid: number;
  started: string;
  script: string;
};

export type AndroidConnectionBackendProvenance = {
  backendAttemptId: string;
  apiOrigin: string;
  apiProcess: Pick<AndroidConnectionBackendProcess, 'pid' | 'started' | 'script'>;
};

/** Bind the Android connection lane to the API process already owned by the session. */
export function buildAndroidConnectionBackendProvenance(input: {
  runId: string;
  apiOrigin: string;
  apiPid: number;
  processes: readonly AndroidConnectionBackendProcess[];
}): AndroidConnectionBackendProvenance {
  if (!/^[a-f0-9]{24}$/.test(input.runId))
    throw new Error('Connection backend run identity is invalid');
  if (typeof input.apiOrigin !== 'string' || input.apiOrigin.length === 0)
    throw new Error('Connection backend API origin is missing');
  if (!Number.isSafeInteger(input.apiPid) || input.apiPid <= 1)
    throw new Error('Connection backend API PID is invalid');
  const apiRows = input.processes.filter((row) => row.role === 'api');
  if (apiRows.length !== 1) throw new Error('Connection backend API process is not unique');
  const apiProcess = apiRows[0];
  if (apiProcess.pid !== input.apiPid)
    throw new Error('Connection backend API process PID differs from session identity');
  if (
    !Number.isSafeInteger(apiProcess.pid) ||
    apiProcess.pid <= 1 ||
    typeof apiProcess.started !== 'string' ||
    apiProcess.started.length === 0 ||
    typeof apiProcess.script !== 'string' ||
    apiProcess.script.length === 0
  )
    throw new Error('Connection backend API process identity is incomplete');
  return {
    backendAttemptId: `${input.runId}:first`,
    apiOrigin: input.apiOrigin,
    apiProcess: {
      pid: apiProcess.pid,
      started: apiProcess.started,
      script: apiProcess.script,
    },
  };
}

const nativeConnectionSignInPathHash = createHash('sha256')
  .update('/auth/email/sign-in')
  .digest('hex');

function requireAndroidConnectionAuthIdentityCapture(
  proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>,
): asserts proxy is Awaited<ReturnType<typeof startOwnedApiProxy>> & {
  enableNativeAuthIdentityCapture: (fixtureAuthUids: readonly string[]) => void;
  nativeAuthIdentities: readonly NativeAuthIdentityObservation[];
} {
  const candidate = proxy as unknown as {
    enableNativeAuthIdentityCapture?: unknown;
    nativeAuthIdentities?: unknown;
  };
  if (
    typeof candidate.enableNativeAuthIdentityCapture !== 'function' ||
    !Array.isArray(candidate.nativeAuthIdentities)
  )
    throw new Error('Android connection journey requires owned native auth identity capture');
}

export function requireAndroidConnectionAccount(value: unknown): AndroidConnectionAccount {
  if (value !== 'coach' && value !== 'student')
    throw new Error('Invalid Android connection account actor');
  return value;
}

export function requireAndroidConnectionSignInBoundary(
  observations: readonly ProxyObservation[],
  identities: readonly NativeAuthIdentityObservation[],
  expected: {
    beforeRequestId: number;
    apiIdentity: AndroidConnectionApiIdentity;
  },
): { authRequestId: number; afterRequestId: number } {
  const { beforeRequestId, apiIdentity } = expected;
  if (!Number.isSafeInteger(beforeRequestId) || beforeRequestId < 0)
    throw new Error('Invalid Android connection sign-in observation boundary');
  const afterRequestId = observations.reduce(
    (maximum, row) => Math.max(maximum, row.requestId),
    beforeRequestId,
  );
  const matches = observations.filter(
    (row) =>
      row.requestId > beforeRequestId &&
      row.method === 'POST' &&
      row.pathHash === nativeConnectionSignInPathHash,
  );
  if (matches.length !== 1)
    throw new Error('Android connection account switch lacks exactly one new native sign-in route');
  const match = matches[0];
  if (
    match.status !== 201 ||
    match.outcome !== 'forwarded' ||
    match.requestProfile !== 'native' ||
    match.requestOrigin !== null ||
    match.faultAttemptId !== null ||
    match.targetOrigin !== apiIdentity.targetOrigin
  )
    throw new Error('Android connection sign-in route crossed the strict native boundary');
  const identityMatches = identities.filter((row) => row.requestId === match.requestId);
  if (identityMatches.length !== 1)
    throw new Error('Android connection sign-in lacks one principal identity record');
  const identity = identityMatches[0];
  if (
    identity.status !== 201 ||
    identity.verification !== 'verified' ||
    identity.verificationReason !== 'verified' ||
    identity.targetOrigin !== apiIdentity.targetOrigin ||
    identity.apiPid !== apiIdentity.apiPid
  )
    throw new Error('Android connection sign-in principal identity crossed the strict boundary');
  return { authRequestId: match.requestId, afterRequestId };
}

export function requireAndroidConnectionActorIdentity(
  identities: readonly NativeAuthIdentityObservation[],
  expected: {
    actorAuthUid: string;
    authRequestId: number;
    apiIdentity: AndroidConnectionApiIdentity;
    fixtureAuthUids: readonly string[];
  },
): string {
  const fixtureAuthUids = [...expected.fixtureAuthUids].sort();
  if (
    fixtureAuthUids.length === 0 ||
    fixtureAuthUids.some((value) => typeof value !== 'string' || value.length === 0) ||
    new Set(fixtureAuthUids).size !== fixtureAuthUids.length
  )
    throw new Error('Android connection fixture actor allowlist is invalid');
  const allowlistHash = createHash('sha256').update(JSON.stringify(fixtureAuthUids)).digest('hex');
  const requestIds = new Set<number>();
  const ordinals = new Set<number>();
  for (const identity of identities) {
    if (
      !Number.isSafeInteger(identity.requestId) ||
      identity.requestId < 1 ||
      requestIds.has(identity.requestId) ||
      !Number.isSafeInteger(identity.ordinal) ||
      identity.ordinal < 1 ||
      ordinals.has(identity.ordinal) ||
      typeof identity.targetOrigin !== 'string' ||
      identity.targetOrigin.length === 0 ||
      !Number.isSafeInteger(identity.apiPid) ||
      identity.apiPid < 1 ||
      !Number.isSafeInteger(identity.status) ||
      (identity.authUid !== null &&
        (typeof identity.authUid !== 'string' || !fixtureAuthUids.includes(identity.authUid))) ||
      (identity.verification !== 'verified' && identity.verification !== 'unverified') ||
      typeof identity.verificationReason !== 'string' ||
      identity.fixtureAuthUidAllowlistHash !== allowlistHash
    )
      throw new Error('Android connection native auth identity evidence is malformed');
    requestIds.add(identity.requestId);
    ordinals.add(identity.ordinal);
  }
  const matches = identities.filter((identity) => identity.requestId === expected.authRequestId);
  if (matches.length !== 1)
    throw new Error('Android connection sign-in request identity is not unique');
  const matched = matches[0];
  if (
    matched.status !== 201 ||
    matched.verification !== 'verified' ||
    matched.verificationReason !== 'verified' ||
    matched.authUid !== expected.actorAuthUid ||
    matched.apiPid !== expected.apiIdentity.apiPid ||
    matched.targetOrigin !== expected.apiIdentity.targetOrigin
  )
    throw new Error('Android connection sign-in lacks one verified owned actor identity');
  if (!matched || typeof matched.authUid !== 'string')
    throw new Error('Android connection sign-in lacks one verified owned actor identity');
  return matched.authUid;
}

export function buildAndroidConnectionBackActions(
  navigation: AndroidConnectionNavigation = 'none',
): string {
  if (!['none', 'student-professionals-back'].includes(navigation))
    throw new Error('Invalid Android connection account navigation');
  if (navigation === 'none') return '';
  return [
    '- scrollUntilVisible:',
    '    element:',
    '      id: student.professionals.backButton',
    '    direction: UP',
    '    timeout: 30000',
    '    centerElement: true',
    '- tapOn:',
    '    id: student.professionals.backButton',
  ].join('\n');
}

export type AndroidConnectionEvidenceAvailability =
  | { status: 'available' }
  | {
      status: 'unavailable';
      reason: 'proxy-shutdown-failed' | 'persistence-failed';
    };

export function buildAndroidConnectionEvidenceAvailability(
  proxyStopSucceeded: boolean,
): AndroidConnectionEvidenceAvailability {
  return proxyStopSucceeded
    ? { status: 'available' }
    : { status: 'unavailable', reason: 'proxy-shutdown-failed' };
}

export type AndroidConnectionEvidenceReceipts = {
  transportReceipt: AndroidStorageFileReceipt;
  nativeAuthIdentitiesReceipt: AndroidStorageFileReceipt;
};

/** Persist connection observations only after app/proxy shutdown has drained late records. */
export async function persistAndroidConnectionEvidence(
  output: string,
  evidence: {
    readonly observations: readonly ProxyObservation[];
    readonly nativeAuthIdentities: readonly NativeAuthIdentityObservation[];
  },
  options: {
    signal?: AbortSignal;
    writeOwnedFile?: typeof writeOwnedAndroidPrivateFile;
  } = {},
): Promise<AndroidConnectionEvidenceReceipts> {
  const writeOwnedFile = options.writeOwnedFile ?? writeOwnedAndroidPrivateFile;
  options.signal?.throwIfAborted();
  const transportReceipt = await writeOwnedFile({
    artifactRoot: output,
    relativePath: 'transport-observations.private.json',
    bytes: JSON.stringify(evidence.observations, null, 2),
    kind: 'transport',
    signal: options.signal,
  });
  options.signal?.throwIfAborted();
  const nativeAuthIdentitiesReceipt = await writeOwnedFile({
    artifactRoot: output,
    relativePath: 'native-auth-identities.private.json',
    bytes: JSON.stringify(evidence.nativeAuthIdentities, null, 2),
    kind: 'auth',
    signal: options.signal,
  });
  return { transportReceipt, nativeAuthIdentitiesReceipt };
}

/** Parse only the owned inventory lane or the exact Android camera charter. */
export function parseAndroidNativeCaptureArguments(args: readonly string[]) {
  const charterArg = args.find((arg) => arg.startsWith('--charter='));
  const charter = charterArg?.slice('--charter='.length) ?? 'entry-and-login';
  if (charterArg && charter === 'camera-denied') {
    const expectedLocaleArg = args.find((arg) => arg.startsWith('--locale='));
    const expectedLocale = expectedLocaleArg?.slice('--locale='.length);
    const expected = [
      '--platform=android',
      '--engine=maestro',
      '--scenario=SCN-camera-denied-android',
      '--mode=integration',
      '--charter=camera-denied',
      expectedLocaleArg ?? '',
    ];
    if (
      !expectedLocale ||
      !['en-US', 'pt-BR', 'es-ES'].includes(expectedLocale) ||
      new Set(args).size !== args.length ||
      args.length !== expected.length ||
      expected.some((value) => !args.includes(value))
    )
      throw new Error('Invalid Android camera native capture arguments');
    return {
      charter: 'camera-denied' as const,
      expectedLocale: expectedLocale as 'en-US' | 'pt-BR' | 'es-ES',
    };
  }
  if (
    !args.includes('--platform=android') ||
    !args.includes('--mode=inventory') ||
    new Set(args).size !== args.length ||
    args.length !== 2 + Number(Boolean(charterArg)) ||
    !androidInventoryCharters.includes(charter as AndroidInventoryCharter) ||
    charterArg === '--charter=entry-and-login'
  )
    throw new Error('Invalid Android native capture arguments');
  return { charter: charter as AndroidInventoryCharter };
}

/**
 * Build the authenticated coach-home observation used by the camera and
 * connection producers. The invite value is rendered in the secondary
 * column below the initial viewport, so those producers must scroll to the
 * exact value before the owned hierarchy command and frame receipt are
 * recorded. Other inventory charters retain the existing screen-only
 * observation and do not acquire invite evidence.
 */
export function buildAndroidCoachHomeObservation(input: {
  email: string;
  password: string;
  requireInviteCode: boolean;
}): { actions: string; selectors: string[] } {
  const actions = [
    '- tapOn:\n    id: auth.signIn.emailInput',
    `- inputText: ${JSON.stringify(input.email)}`,
    '- tapOn:\n    id: auth.signIn.passwordInput',
    `- inputText: ${JSON.stringify(input.password)}`,
    '- hideKeyboard',
    '- assertVisible:\n    id: auth.signIn.submitButton',
    '- tapOn:\n    id: auth.signIn.submitButton',
  ];
  if (input.requireInviteCode)
    actions.push(
      '- extendedWaitUntil:\n    visible:\n      id: pro.home.screen\n    timeout: 30000',
      '- scrollUntilVisible:\n    element:\n      id: pro.home.inviteCodeValue\n    direction: DOWN\n    timeout: 30000\n    centerElement: true',
    );
  return {
    actions: actions.join('\n'),
    selectors: input.requireInviteCode
      ? ['pro.home.screen', 'pro.home.inviteCodeValue']
      : ['pro.home.screen'],
  };
}

/** Import-inert shared lifecycle. A private callback is not a public native result. */
export async function runOwnedAndroidNativeSession(
  options: OwnedAndroidNativeSessionOptions,
): Promise<OwnedAndroidNativeSessionResult> {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) =>
        ![
          'charter',
          'signal',
          'deadlines',
          'deadlineAtMonotonicMs',
          'coldResetOwnerRunId',
          'coldResetFixtureResetId',
          'prepareColdReset',
          'selection',
          'expectedLocale',
          'executeTraining',
          'executeSaveRetry',
          'executeConnection',
          'executeCamera',
          'qualifiedBuild',
        ].includes(key),
    ) ||
    ![
      ...androidInventoryCharters,
      ...androidSessionCharters,
      'training-journey',
      'connection-journey',
      'save-retry',
      'camera-denied',
    ].includes(options.charter) ||
    (options.signal !== undefined && !(options.signal instanceof AbortSignal)) ||
    (options.deadlineAtMonotonicMs !== undefined &&
      (!Number.isFinite(options.deadlineAtMonotonicMs) || options.deadlineAtMonotonicMs <= 0)) ||
    (options.coldResetOwnerRunId !== undefined &&
      (typeof options.coldResetOwnerRunId !== 'string' ||
        !/^[a-f0-9]{24}$/u.test(options.coldResetOwnerRunId))) ||
    (options.coldResetFixtureResetId !== undefined &&
      (typeof options.coldResetFixtureResetId !== 'string' ||
        options.coldResetFixtureResetId.length === 0 ||
        options.coldResetFixtureResetId.length > 256 ||
        /[\0\r\n]/u.test(options.coldResetFixtureResetId))) ||
    (options.prepareColdReset !== undefined &&
      (typeof options.prepareColdReset !== 'function' ||
        options.coldResetOwnerRunId === undefined ||
        options.coldResetFixtureResetId === undefined)) ||
    (options.coldResetOwnerRunId !== undefined && options.prepareColdReset === undefined) ||
    (options.coldResetFixtureResetId !== undefined && options.prepareColdReset === undefined) ||
    (options.selection !== undefined &&
      (!options.selection || typeof options.selection !== 'object')) ||
    (options.expectedLocale !== undefined &&
      !['en-US', 'pt-BR', 'es-ES'].includes(options.expectedLocale)) ||
    (options.charter === 'camera-denied'
      ? options.selection === undefined || options.expectedLocale === undefined
      : options.selection !== undefined || options.expectedLocale !== undefined) ||
    (options.charter === 'training-journey'
      ? typeof options.executeTraining !== 'function' || options.executeConnection !== undefined
      : options.executeTraining !== undefined) ||
    (options.executeSaveRetry !== undefined &&
      (typeof options.executeSaveRetry !== 'function' || options.charter !== 'save-retry')) ||
    (options.executeCamera !== undefined &&
      (typeof options.executeCamera !== 'function' || options.charter !== 'camera-denied')) ||
    (options.charter === 'camera-denied'
      ? typeof options.executeCamera !== 'function'
      : options.executeCamera !== undefined) ||
    (options.charter === 'connection-journey'
      ? typeof options.executeConnection !== 'function'
      : options.executeConnection !== undefined) ||
    (options.charter === 'save-retry'
      ? typeof options.executeSaveRetry !== 'function'
      : options.executeSaveRetry !== undefined) ||
    (options.executeSaveRetry !== undefined &&
      (options.executeTraining !== undefined ||
        options.executeConnection !== undefined ||
        options.executeCamera !== undefined)) ||
    (options.qualifiedBuild !== undefined &&
      (options.qualifiedBuild.kind !== 'qualified-android-maestro-build-reuse' ||
        options.qualifiedBuild.current !== true ||
        options.qualifiedBuild.binaryHash.length !== 64 ||
        options.qualifiedBuild.buildId.length !== 24))
  )
    throw new Error('Invalid owned Android session options');
  nativeExecutionDeadlines(options.deadlines);
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  let cancellation: 'SIGINT' | 'SIGTERM' | undefined;
  const onAbort = () => {
    const reason: unknown = options.signal?.reason;
    cancellation = reason === 'SIGINT' || reason === 'SIGTERM' ? reason : undefined;
    controller.abort(options.signal?.reason);
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await executeOwnedAndroidSession({ ...options }, controller, () => cancellation);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

async function executeOwnedAndroidSession(
  options: OwnedAndroidNativeSessionOptions,
  controller: AbortController,
  cancellation: () => 'SIGINT' | 'SIGTERM' | undefined,
): Promise<OwnedAndroidNativeSessionResult> {
  const { charter } = options;
  const isSessionCharter = charter === 'session-account';
  const isLegacyAuthDiagnostic = charter === 'auth-account';
  const isCameraCharter = charter === 'camera-denied';
  const isAuthSessionFlow = isSessionCharter || isLegacyAuthDiagnostic;
  const deadlines = nativeExecutionDeadlines(options.deadlines);
  const boundedDeadlines = deadlines;
  // This absolute value is established once at owner entry. Helper closure
  // reads at terminal publication must consume this same caller budget rather
  // than manufacturing a fresh budget after capture work has completed.
  const helperDeadlineAtMonotonicMs =
    options.deadlineAtMonotonicMs ?? performance.now() + boundedDeadlines.wholeRunMs;
  controller.signal.throwIfAborted();
  const root = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const savedFlowModule = isCameraCharter ? await loadAndroidCameraSavedFlowModule() : undefined;
  const savedFlow = savedFlowModule
    ? await savedFlowModule.loadAndroidCameraSavedFlow({
        repositoryRoot: root,
        selection: options.selection!,
        deadlineAtMonotonicMs: helperDeadlineAtMonotonicMs,
        signal: controller.signal,
      })
    : undefined;
  const hostRoot = process.env.MYCHAMPIONS_NATIVE_STATE_ROOT;
  if (!hostRoot) throw new Error('Use the shared native host-lock wrapper');
  await inspectPrivateAndroidDirectory(hostRoot);
  const sdkRoot = '/Users/eduwaldo/Library/Android/sdk';
  const maestro = '/Users/eduwaldo/.maestro/bin/maestro';
  if (
    (
      await execute(maestro, ['--version'], {
        timeout: 30000,
        // Without the analytics opt-out the CLI can block ~55 s on a network call.
        env: {
          ...process.env,
          MAESTRO_CLI_NO_ANALYTICS: 'true',
          MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
        },
      })
    ).stdout.trim() !== '2.6.1'
  )
    throw new Error('Android pilot requires Maestro 2.6.1');
  const output = path.join(root, '.qa/artifacts/native-pilot', randomBytes(12).toString('hex'));
  await mkdir(output, { recursive: true, mode: 0o700 });
  process.stdout.write(
    `${isSessionCharter ? 'Owned Android native session execution' : isLegacyAuthDiagnostic ? 'Legacy Android auth-account diagnostic' : isCameraCharter ? 'Owned Android camera-denied execution' : options.executeTraining || options.executeConnection || options.executeCamera ? 'Owned Android native execution' : 'Android app inventory'} artifacts: ${output}\n`,
  );
  const timingsMs = {
    build: 0,
    install: 0,
    reset: 0,
    scenario: 0,
    verify: 0,
    cleanup: 0,
  };
  let timedPhase: keyof typeof timingsMs | undefined = 'reset';
  let phaseStarted = performance.now();
  const beginPhase = (next?: keyof typeof timingsMs) => {
    const now = performance.now();
    if (timedPhase) timingsMs[timedPhase] += now - phaseStarted;
    timedPhase = next;
    phaseStarted = now;
  };
  const beforeSource = await androidSourceIdentity(root);
  const captureRunId = path.basename(output);
  const existingApk = path.join(root, 'android/app/build/outputs/apk/dev/debug/app-dev-debug.apk');
  const existingApkIdentity = async () => {
    try {
      const metadata = await lstat(existingApk);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new Error('Existing workspace APK is not a regular file');
      return {
        dev: metadata.dev,
        ino: metadata.ino,
        sha256: createHash('sha256')
          .update(await readFile(existingApk))
          .digest('hex'),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };
  const beforeApk = await existingApkIdentity();
  const listAvds = async () =>
    (
      await execute(path.join(sdkRoot, 'emulator/emulator'), ['-list-avds'], {
        timeout: 10000,
      })
    ).stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .sort();
  const beforeAvds = await listAvds();
  const beforeIos = (
    await execute('xcrun', ['simctl', 'list', 'devices', '--json'], {
      timeout: 15000,
    })
  ).stdout;
  await writeFile(path.join(output, 'previous-ios-devices.private.json'), beforeIos, {
    flag: 'wx',
    mode: 0o600,
  });
  const helperPaths = [
    'capture-android-testability.ts',
    't15-cold-android-maestro-build-reuse.ts',
    't15-cold-android-maestro-family-attempt.ts',
    't15-cold-android-maestro-public-finalizer.ts',
    't15-cold-android-maestro-public-consumer.ts',
    't15-cold-android-reset-producer.ts',
    'run-android-camera-public-attempt.ts',
    'native-android-camera-runtime-finalizer.ts',
    'native-android-camera-runtime-eligibility.ts',
    'native-android-camera-runtime-driver.ts',
    'native-android-camera-runtime-collector.ts',
    'native-android-camera-runtime-receipt.ts',
    'native-android-camera-runtime-dispatch.ts',
    'native-android-camera-public-staging.ts',
    'android-build-identity.ts',
    'native-build-identity.ts',
    'native-build-reuse.ts',
    'native-ios-incremental-build-cache.ts',
    'native-pilot-contract.ts',
    'native-save-retry-observation.ts',
    'native-save-retry-attempt-binding.ts',
    'schema-validation.ts',
    'validate-native-inventory.mjs',
    'owned-android-emulator.ts',
    'owned-android-port.ts',
    'owned-adb-server.ts',
    'owned-native-command.ts',
    'owned-process-group.ts',
    'owned-expo.ts',
    'owned-api-proxy.ts',
    'owned-session.ts',
    'native-android-driver-diagnostics.ts',
    'native-android-driver-startup-sampling.ts',
    'native-camera-observation.ts',
    'native-camera-android-capture-adapter.ts',
    'native-camera-android-contract.ts',
    'native-camera-android-saved-flow.ts',
    '.maestro/flows/camera-denied-android.yaml',
    'native-camera-android-observation.ts',
    'native-camera-android-producer.ts',
    'native-camera-android-runtime-locale.ts',
    'native-camera-android-sql-source.ts',
    'run-android-camera-attempt-core.ts',
    'run-android-camera-attempt.ts',
    'integration-preflight.ts',
    'native-hierarchy.ts',
    'native-host-contention.ts',
    'native-training-observation.ts',
    'native-training-load-observation.ts',
    'native-training-maestro-driver.ts',
    'native-training-journey.ts',
    'native-training-quantity-contract.ts',
    'native-maestro-assertion-failure.ts',
    'native-training-edit-observation.ts',
    'android-native-input-reader.ts',
    'android-input-reader/InputReader.java',
    'android-input-reader/AndroidManifest.xml',
    'native-connection-observation.ts',
    'native-connection-snapshot.ts',
    'native-session-profile-checkpoints.ts',
    'native-connection-platform-contract.ts',
    'schemas/connection-snapshot-v1.schema.json',
    'native-connection-checkpoints.ts',
    'native-connection-hierarchy.ts',
    'native-connection-attempt-binding.ts',
    'native-connection-journey.ts',
    'native-connection-journey-core.ts',
    'detox-connection-actionability.ts',
    'detox-native-hierarchy.ts',
    'native-connection-hierarchy-android.ts',
    'native-connection-public-evidence.ts',
    'native-connection-public-evidence-core.ts',
    'native-connection-public-evidence-android.ts',
    'native-detox-dispatch-lifecycle.ts',
    // The iOS ledger still treats this public connection seam as a shared
    // source input. Keep its bytes in the Android freshness fingerprint while
    // the Android runtime reaches only the neutral lifecycle module.
    'native-detox-connection-public-dispatch.ts',
    'run-android-connection-attempt.ts',
    'android-session-charter.ts',
    'native-runtime-preflight.ts',
    'native-cleanup-evidence.ts',
    'verify-owned-android-cleanup.ts',
    'native-view-evidence.ts',
    'ios-locale-capture-wiring.ts',
    'ios-locale-runtime-adapter.ts',
    'ios-locale-storage.ts',
    'ios-locale-quiescence.ts',
    'locale-native-observation.ts',
    'locale-context-validator.ts',
    'native-locale-file-observation.ts',
    'native-locale-capture-seam.ts',
    'native-training-pilot-evidence.ts',
    'native-training-attempt-binding.ts',
    'native-training-attempt-outcome.ts',
    'run-android-training-attempt.ts',
    'run-android-save-retry-attempt.ts',
    'native-android-save-retry-public-evidence.ts',
    'native-training-public-evidence.ts',
    'native-detox-training-public-finalization-contract.ts',
    'run-ios-training-attempt.ts',
    'scripts/ci/android-runner-slot.ts',
    'capture-native-testability.ts',
    'native-auth-observation.ts',
    'ios-credential-entry-diagnostic.ts',
    'ios-credential-entry-owned-seam.ts',
    'native-android-session-adapter.ts',
    'native-android-session-checkpoint-copy.ts',
    'native-android-session-public-contract.ts',
    'native-android-session-public-dependency.ts',
    'native-android-session-public-dispatch.ts',
    'native-android-session-public-staging.ts',
    'run-android-session-attempt.ts',
    'native-connection-password-offer-witness.ts',
    'native-training-discard-observation.ts',
    'owned-ios-simulator-app.ts',
    'owned-ios-simulator.ts',
    'verify-owned-ios-cleanup.ts',
    // The Android producer shares the iOS session public finalizer source
    // boundary through the common pilot; retain every ledger/finalizer input
    // so a changed iOS source cannot leave Android freshness stale.
    'run-ios-save-retry-attempt.ts',
    'native-save-retry-public-evidence.ts',
    'native-session-public-dependency.ts',
    'native-session-public-staging.ts',
    'native-session-public-finalization.ts',
    'native-session-helper-ledger.ts',
    'detox-android-session-producer.ts',
    'native-detox-android-session-native-pilot-route.ts',
    'native-detox-android-session-public-adapter.ts',
    'native-detox-android-session-public-finalization.ts',
    'native-detox-android-session-public-staging.ts',
    'ios-session-post-tap-diagnostic.ts',
    'partial-backend-boundary.ts',
    'verify-owned-android-detox-connection-cleanup.ts',
    // The Android Detox dispatch imports the save/retry owner and its
    // producer receipt finalizer transitively. Keep both bytes in the same
    // capture helper ledger so a fresh camera source cannot omit a module
    // that is loaded before native preparation starts.
    'detox-android-connection-producer.ts',
    'detox-android-qualified-build.ts',
    'detox-connection-artifact-root.ts',
    'detox-connection-evidence.ts',
    'detox-connection-ancestor-safe.py',
    'detox-connection-ipc.ts',
    'detox-integrated-connection-baseline.ts',
    'detox-integrated-connection-driver.ts',
    'detox-integrated-session-baseline.ts',
    'detox-runtime-build-metadata.ts',
    'detox-save-retry-child-client.ts',
    'detox-save-retry-child-protocol.mjs',
    'detox-save-retry-driver.ts',
    'detox-save-retry-owned-dispatch.ts',
    'detox-save-retry-runtime-finalizer.ts',
    'run-native-pilot.ts',
    'run-ios-session-attempt.ts',
    'run-ios-connection-attempt.ts',
    'native-camera-submission-evidence.ts',
    'run-ios-camera-attempt.ts',
    // Mirror the shared iOS ledger V4 Detox dispatch helpers so Android
    // session freshness cannot omit a cross-platform producer input.
    'detox-connection-result-writer.ts',
    'native-pilot-invocation.ts',
    't15-cold-ios-reset-producer.ts',
    't15-cold-reset-child-consumption.ts',
    't15-cold-reset-handoff.ts',
    't15-cold-runtime-link.ts',
    't15-cold-dispatcher.ts',
    'compare-native-pilot.ts',
    'testing-repository-identity.ts',
    'scripts/testing/t15-cold-owned-lifecycle.ts',
    'scripts/testing/t15-cold-production-runner.ts',
    'scripts/testing/t15-cold-ios-family-attempt.ts',
    'scripts/testing/t16b-owned-ios-native-entrypoint.ts',
    'scripts/testing/t16b-owned-maestro-bootstrap.ts',
    'scripts/testing/t16b-owned-maestro-runtime.ts',
    'scripts/testing/t16b-owned-maestro-mcp-connector.ts',
    'scripts/testing/t16b-owned-exploration-controller.ts',
    'scripts/testing/t16b-outer-cleanup-binding.ts',
    'scripts/testing/run-t16-owned-exploration.ts',
    'package.json',
    'scripts/testing/prepare-exploration.ts',
    'scripts/testing/exploration-budget-policy.ts',
    'scripts/testing/owned-maestro-mcp-stdio.ts',
    // Keep the complete imported runtime closure in the helper ledger. The
    // Android source fingerprint intentionally excludes scripts, so a missing
    // imported producer/finalizer byte must invalidate qualified-build reuse.
    'detox-android-session-storage-producer.ts',
    'detox-session-cache-observation.ts',
    'native-detox-training-public-types.ts',
    'detox-session-cancel-evidence.ts',
    'detox-session-final-transport.ts',
    'native-detox-camera-android-identity.ts',
    't15-detox-android-session-reset-preparation.ts',
    'native-connection-engine-contract.ts',
    'detox-connection-lifecycle.ts',
    'detox-training-child-client.ts',
    'detox-training-child-protocol.mjs',
    'detox-training-journey.ts',
    'native-detox-connection-runtime-producer.ts',
    'native-detox-connection-runtime-verification.ts',
    'native-detox-connection-public-staging.ts',
    'native-detox-connection-android-public-dispatch.ts',
    't15-detox-android-session-normalization.ts',
    'native-detox-camera-android-native-pilot-route.ts',
    'native-detox-camera-android-public-dispatch.ts',
    'native-detox-camera-android-owned-session.ts',
    'android-detox-camera-cold-reset-boundary.ts',
    'native-detox-camera-android-bridge.ts',
    'native-detox-camera-android-contract.ts',
    'native-detox-camera-android-q-adapter.ts',
    'native-detox-camera-android-reset-independent.ts',
    'native-detox-camera-android-reset.ts',
    'native-detox-camera-android-producer.ts',
    'native-detox-camera-android-public-finalizer.ts',
    'native-detox-camera-ios-verifier.ts',
    'native-detox-camera-ios-contract.ts',
    'native-detox-camera-ios-evidence.ts',
    'native-detox-camera-ios-owner.ts',
    'native-detox-camera-ios-producer.ts',
    'native-detox-camera-ios-ipc.ts',
    'native-detox-camera-ios-stage.ts',
    'native-detox-connection-android-public-staging.ts',
    'native-detox-session-public-adapter.ts',
    'native-detox-session-public-staging.ts',
    'native-pilot-preflight.ts',
    'native-detox-camera-ios-current-owner.ts',
    'native-detox-camera-ios-inputs.ts',
    't15-detox-android-session-cold-route.ts',
    't15-detox-android-session-public-receipt-bridge.ts',
    't15-detox-cold-lifecycle.ts',
  ];
  const helperIdentity = async () =>
    readAndroidCameraHelperInputs({
      repositoryRoot: root,
      helperPaths,
      signal: options.signal,
      deadlineAtMonotonicMs: helperDeadlineAtMonotonicMs,
    });
  const beforeHelpers = await helperIdentity();
  const helperInputsHash = createHash('sha256').update(JSON.stringify(beforeHelpers)).digest('hex');
  if (options.qualifiedBuild) {
    if (options.qualifiedBuild.sourceFingerprint !== beforeSource.sourceTreeHash)
      throw new Error('Android qualified build source fingerprint differs from current capture');
    if (options.qualifiedBuild.helperFingerprint !== helperInputsHash)
      throw new Error('Android qualified build helper fingerprint differs from current capture');
  }
  const report: Record<string, unknown> = {
    kind: isSessionCharter
      ? 'private-owned-native-session-execution-not-public-receipt'
      : isLegacyAuthDiagnostic
        ? 'private-legacy-auth-account-diagnostic-not-public-receipt'
        : options.executeConnection
          ? 'private-owned-native-connection-execution-not-public-receipt'
          : options.executeSaveRetry
            ? 'private-owned-native-save-retry-execution-not-public-receipt'
            : options.executeCamera
              ? 'private-owned-native-camera-denied-execution-not-public-receipt'
              : options.executeTraining
                ? 'private-owned-native-training-execution-not-public-receipt'
                : 'private-native-inventory-observation-not-behavior-attempt',
    mode:
      isAuthSessionFlow ||
      options.executeTraining ||
      options.executeSaveRetry ||
      options.executeConnection ||
      options.executeCamera
        ? 'integration'
        : 'inventory',
    platform: 'android',
    charter,
    startedAt: new Date().toISOString(),
    captureRunId,
    captureRoot: output,
    androidCameraSavedFlow: savedFlow?.binding ?? null,
    result: 'harness-blocked',
    nativePassingCases: 0,
    observedOsLocale: null,
    localeBinding: null,
    localeExpectedBinding: null,
    localeContextCandidate: null,
    viewIds: [],
    source: beforeSource,
    workspaceApkBefore: beforeApk,
    originalAvds: beforeAvds,
    helperInputsBefore: beforeHelpers,
    cleanup: 'pending',
    timingsMs,
    toolVersions: { node: process.version, maestro: '2.6.1' },
    budget: {
      execution: boundedDeadlines,
      backendMs: boundedDeadlines.wholeRunMs + 300000,
    },
    androidSessionPrerequisites: isAuthSessionFlow
      ? {
          ...androidSessionPrerequisiteContract,
          status: 'pending-runtime-verification',
        }
      : null,
  };
  let target: Awaited<ReturnType<typeof acquireOwnedAndroidEmulator>> | undefined;
  let defaultAdb: Awaited<ReturnType<typeof acquireAdbServerReference>> | undefined;
  let reservation: Awaited<ReturnType<typeof reserveOwnedAppPort>> | undefined;
  let session: Awaited<ReturnType<typeof startOwnedSession>> | undefined;
  let proxy: Awaited<ReturnType<typeof startOwnedApiProxy>> | undefined;
  let app: Awaited<ReturnType<typeof startOwnedExpo>> | undefined;
  const commands: Awaited<ReturnType<typeof startOwnedNativeCommand>>[] = [];
  let passedHostPreflight = false;
  const commandCleanupFailures: string[] = [];
  const commandExecutions: (NativeCommandExecution & {
    label: string;
    deadlineMs: number;
  })[] = [];
  const commandArgvByLabel = new Map<string, readonly string[]>();
  report.commandExecutions = commandExecutions;
  let localeExpectedBindingInputs:
    | {
        sourceTreeHash: string;
        helperInputs: typeof beforeHelpers;
        target: NativeLocaleBinding['target'];
      }
    | undefined;
  let localeInputsStable = true;
  let authDomainBefore: OwnedDomainSnapshot | undefined;
  let authDomainAfterLogin: OwnedDomainSnapshot | undefined;
  let authDomainAfterRestore: OwnedDomainSnapshot | undefined;
  let authDomainAfterSignedOutRelaunch: OwnedDomainSnapshot | undefined;
  let authDomainAfter: OwnedDomainSnapshot | undefined;
  let authConnectionBefore: OwnedConnectionSnapshot | undefined;
  let authConnectionAfterLogin: OwnedConnectionSnapshot | undefined;
  let authConnectionAfterRestore: OwnedConnectionSnapshot | undefined;
  let authConnectionAfterSignedOutRelaunch: OwnedConnectionSnapshot | undefined;
  let androidSessionAfterCancel:
    ReturnType<typeof requireAndroidRetainedNativeSessionIdentity> | undefined;
  const authSessionCheckpointReceipts: Partial<
    Record<AndroidSessionCheckpointPhase, AndroidSessionCheckpointReceipt>
  > = {};
  let authSessionCharterResult: Record<string, unknown> | undefined;
  let authBackendProvenance:
    | {
        backendAttemptId: string;
        apiOrigin: string;
        apiProcess: { pid: number; started: string; script: string };
      }
    | undefined;
  let verified: Awaited<ReturnType<typeof inspectOwnedAndroidApk>>;
  let nativeEnv: NodeJS.ProcessEnv = { ...process.env };
  const observedTrees = new Map<string, unknown>();
  const observedAndroidCameraPromptSelectors = new Map<string, readonly [string, string]>();
  const observedFrameReceipts = new Map<
    string,
    {
      hierarchySource: AndroidCapturedFrameReceipt;
      hierarchy: AndroidCapturedFrameReceipt;
      screenshot: AndroidCapturedFrameReceipt;
    }
  >();
  let localeCapture:
    | {
        persisted: AndroidLocalePropertyRead;
        productDefault: AndroidLocalePropertyRead | null;
        selected: AndroidLocalePropertyRead;
        selectedProperty: 'persist.sys.locale' | 'ro.product.locale' | null;
        hierarchyPath: string;
      }
    | undefined;
  const acquisitionIntents: string[] = [];
  report.acquisitionIntents = acquisitionIntents;
  const declareAcquisition = async (
    resource: 'adb' | 'emulator' | 'backend' | 'proxy' | 'expo',
  ) => {
    if (acquisitionIntents.includes(resource))
      throw new Error('Duplicate Android acquisition intent');
    controller.signal.throwIfAborted();
    await writeFile(
      path.join(output, `acquisition-${resource}.private.json`),
      JSON.stringify({
        kind: 'owned android capture acquisition intent',
        captureRunId: path.basename(output),
        resource,
      }),
      { flag: 'wx', mode: 0o600 },
    );
    acquisitionIntents.push(resource);
  };
  let androidReadonlyDiagnosticAttempted = false;
  const captureAndroidReadonlyDiagnostics = async (
    trigger: string,
    originalExecution: NativeCommandExecution,
  ) => {
    if (androidReadonlyDiagnosticAttempted || !target || controller.signal.aborted) return;
    androidReadonlyDiagnosticAttempted = true;
    try {
      await captureAndroidReadonlyDiagnosticsWithBudget({
        artifactRoot: output,
        trigger,
        originalExecution,
        target,
        signal: controller.signal,
        report,
      });
    } catch (error) {
      // Diagnostics are evidence only; preserve the original Maestro outcome.
      report.androidDriverDiagnosticError =
        error instanceof Error
          ? {
              name: error.name.slice(0, 128),
              message: error.message.slice(0, 512),
            }
          : {
              name: 'UnknownError',
              message: 'Android driver diagnostics failed',
            };
    }
  };
  let readinessSampler:
    { label: string; promise: Promise<AndroidDriverStartupSampler> } | undefined;
  const startupSamplingReports: Record<string, unknown> = {};
  report.androidDriverStartupSampling = startupSamplingReports;
  const stopReadinessSampler = async (label: string, originalResult: NativeCommandExecution) => {
    const pending = readinessSampler;
    if (!pending || pending.label !== label) return originalResult;
    readinessSampler = undefined;
    let blocked = false;
    try {
      const sampler = await pending.promise;
      const sampling = await sampler.stop();
      startupSamplingReports[label] = {
        status: sampling.blocked ? 'blocked' : sampling.receipt.status,
        blocked: sampling.blocked,
        outputPath: sampling.outputPath,
        receiptPath: sampling.receiptPath,
        sampleCount: sampling.receipt.sampleCount,
      };
      blocked = sampling.blocked;
    } catch (error) {
      blocked = true;
      startupSamplingReports[label] = {
        status: 'blocked',
        blocked: true,
        error:
          error instanceof Error
            ? {
                name: error.name.slice(0, 128),
                message: error.message.slice(0, 512),
              }
            : {
                name: 'UnknownError',
                message: 'Android startup sampling failed',
              },
      };
    }
    if (
      blocked &&
      originalResult.execution === 'completed' &&
      originalResult.cleanup === 'cleaned'
    ) {
      report.androidDriverStartupSamplingEngineOutcome = {
        label,
        execution: originalResult.execution,
        cleanup: originalResult.cleanup,
        childExitCode: originalResult.childExitCode,
        childSignal: originalResult.childSignal,
      };
      return { ...originalResult, execution: 'harness-blocked' as const };
    }
    return originalResult;
  };
  const run = async (
    label: string,
    command: string,
    argv: string[],
    env: NodeJS.ProcessEnv,
    deadlineMs: number,
    input?: string,
    stdoutPath?: string,
  ) => {
    controller.signal.throwIfAborted();
    if (commandArgvByLabel.has(label)) throw new Error(`Duplicate owned command label: ${label}`);
    commandArgvByLabel.set(label, [...argv]);
    await requireNativeHostAvailabilityAtStep(output, label);
    await defaultAdb?.assertAlive(`before-${label}`);
    controller.signal.throwIfAborted();
    const phase = label === 'android-build' ? 'build' : 'step';
    const resolvedDeadlineMs = nativeCommandDeadline(deadlineMs, phase, deadlines);
    // Keep sampler census settling inside the same absolute command budget.
    // This only settles Darwin argv-unavailable observations; it does not
    // retry Maestro, accept unknown ownership, or grant signal authority.
    const commandDeadlineAtMonotonicMs = Math.min(
      performance.now() + resolvedDeadlineMs,
      wholeCaptureDeadlineAtMonotonicMs,
    );
    const result = await executeOwnedNativeCommand({
      command,
      argv,
      env,
      artifactRoot: output,
      label,
      cwd: root,
      input,
      stdoutPath,
      deadlineMs: resolvedDeadlineMs,
      phase,
      signal: controller.signal,
      // Android one-shot commands opt into the same-PID exec gate. The shared
      // command helper remains unchanged for iOS and generic callers.
      leaderHandshake: true,
      onStarted: (child) => {
        commands.push(child);
        if (
          path.basename(command) === 'maestro' &&
          label.endsWith('-readiness') &&
          target &&
          !controller.signal.aborted
        ) {
          const samplerPromise = startAndroidDriverStartupSampling({
            artifactRoot: output,
            readinessLabel: label,
            target: {
              captureRunId: path.basename(output),
              ownerRunId: target.runId,
              serial: target.identity.serial,
              adbServerPort: target.slot.adbServerPort,
            },
            ownedProcesses: async () =>
              (
                await child.capture(true, {
                  untilMonotonicMs: commandDeadlineAtMonotonicMs,
                  signal: controller.signal,
                  delayMs: 50,
                  maxRequeries: 8,
                })
              ).map((row) => ({
                pid: row.pid,
                started: row.started,
              })),
          });
          readinessSampler = { label, promise: samplerPromise };
          void samplerPromise.catch(() => undefined);
        }
      },
    });
    const effectiveResult = await stopReadinessSampler(label, result);
    commandExecutions.push({
      label,
      deadlineMs: resolvedDeadlineMs,
      ...effectiveResult,
    });
    const readinessIncomplete =
      effectiveResult.execution !== 'completed' ||
      effectiveResult.cleanup !== 'cleaned' ||
      !(effectiveResult.stdoutPath ?? effectiveResult.logPath);
    if (
      path.basename(command) === 'maestro' &&
      label.endsWith('-readiness') &&
      readinessIncomplete &&
      target &&
      !controller.signal.aborted
    ) {
      try {
        await captureAndroidReadonlyDiagnostics(label, result);
      } catch (error) {
        // Diagnostics are evidence only; preserve the original Maestro outcome.
        report.androidDriverDiagnosticError =
          error instanceof Error
            ? {
                name: error.name.slice(0, 128),
                message: error.message.slice(0, 512),
              }
            : {
                name: 'UnknownError',
                message: 'Android driver diagnostics failed',
              };
      }
    }
    if (effectiveResult.execution === 'deadline')
      report.deadline = { step: label, deadlineMs: resolvedDeadlineMs };
    if (effectiveResult.cleanup !== 'cleaned' && effectiveResult.cleanup !== 'not-acquired')
      commandCleanupFailures.push(label);
    try {
      await defaultAdb?.assertAlive(`after-${label}`);
    } catch (error) {
      if (effectiveResult.execution === 'completed' && effectiveResult.cleanup === 'cleaned')
        throw error;
      report.postCommandHostVerificationError =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : {
              name: 'UnknownError',
              message: 'Owned ADB post-command verification failed',
            };
    }
    if (
      options.executeTraining &&
      path.basename(command) === 'maestro' &&
      label.endsWith('-readiness') &&
      effectiveResult.execution === 'child-failed' &&
      effectiveResult.childExitCode === 1 &&
      effectiveResult.childSignal === null &&
      effectiveResult.cleanup === 'cleaned' &&
      !controller.signal.aborted
    ) {
      const stepLabel = label.slice(0, -'-readiness'.length);
      try {
        const commandsPath = await findMaestroQuantityFailureCommands(output, stepLabel);
        if (!target || !proxy) throw new Error('Owned Android failure runtime unavailable');
        const deviceHealth = async (phase: 'before' | 'after') => {
          await target!.verify();
          const boot = await adb(`${stepLabel}-failure-device-${phase}-boot`, [
            'shell',
            'getprop',
            'sys.boot_completed',
          ]);
          const state = await adb(`${stepLabel}-failure-device-${phase}-state`, ['get-state']);
          if (
            (await readFile(boot, 'utf8')).trim() !== '1' ||
            (await readFile(state, 'utf8')).trim() !== 'device'
          )
            throw new Error('Owned Android failure diagnostic target is not booted and ready');
          await target!.verify();
          return {
            serial: target!.identity.serial,
            avd: target!.identity.avd,
            ownerRunId: target!.runId,
            bootCompleted: '1',
            state: 'device',
          };
        };
        const before = await deviceHealth('before');
        const healthy = await fetch(`${proxy.origin}/health`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]),
        });
        if (healthy.status !== 200) throw new Error('Owned failure diagnostic API is unavailable');
        await writeFile(
          path.join(output, `${stepLabel}-failure-health.private.json`),
          JSON.stringify({
            kind: 'owned native failure diagnostic API health',
            captureRunId: path.basename(output),
            apiOrigin: proxy.origin,
            status: healthy.status,
          }),
          { flag: 'wx', mode: 0o600 },
        );
        const testIndex = argv.indexOf('test');
        if (testIndex < 1) throw new Error('Original Android Maestro target arguments unavailable');
        const hierarchyStdoutPath = path.join(output, `${stepLabel}-failure-hierarchy.stdout`);
        const hierarchyLog = await run(
          `${stepLabel}-failure-hierarchy`,
          command,
          [...argv.slice(0, testIndex), 'hierarchy'],
          env,
          120000,
          undefined,
          hierarchyStdoutPath,
        );
        const hierarchyExecution = commandExecutions.find(
          (entry) => entry.label === `${stepLabel}-failure-hierarchy`,
        );
        if (hierarchyExecution?.stdoutPath !== hierarchyStdoutPath)
          throw new Error('Android failure hierarchy stdout was not captured separately');
        const after = await deviceHealth('after');
        const hierarchyPath = `${stepLabel}-failure-hierarchy.json`;
        await writeFile(
          path.join(output, hierarchyPath),
          JSON.stringify(parseNativeHierarchy(await readFile(hierarchyLog, 'utf8'))),
          { flag: 'wx', mode: 0o600 },
        );
        await screenshot(`${stepLabel}-failure`);
        await writeFile(
          path.join(output, `${stepLabel}-failure-device-health.private.json`),
          JSON.stringify({
            kind: 'owned Android failure diagnostic device health',
            captureRunId: path.basename(output),
            before,
            after,
          }),
          { flag: 'wx', mode: 0o600 },
        );
        report.deviceHealthOnFailure = after;
        await recordNativeQuantityFailure({
          root: output,
          label: stepLabel,
          commandsPath,
          hierarchyPath,
          screenshotPath: `${stepLabel}-failure.png`,
        });
        report.applicationFailureCandidate = 'native-application-failure.private.json';
      } catch (error) {
        // Preserve the original failed command; ambiguous diagnostics remain a harness block.
        report.applicationFailureCandidateUnavailable = true;
        report.applicationFailureDiagnosticError =
          error instanceof Error
            ? { name: error.name, message: error.message }
            : {
                name: 'UnknownError',
                message: 'Android failure diagnostic rejected',
              };
      }
    }
    const capturePath = effectiveResult.stdoutPath ?? effectiveResult.logPath;
    if (
      effectiveResult.execution !== 'completed' ||
      effectiveResult.cleanup !== 'cleaned' ||
      !capturePath
    )
      throw new Error(
        `Native ${label} execution=${effectiveResult.execution} cleanup=${effectiveResult.cleanup}; inspect command execution record`,
      );
    return capturePath;
  };
  const adb = async (
    label: string,
    argv: readonly string[],
    input?: string,
    stdoutPath?: string,
  ) => {
    if (!target) throw new Error('Owned Android target unavailable');
    await target.verify();
    return run(
      label,
      path.join(sdkRoot, 'platform-tools/adb'),
      [
        '-H',
        '127.0.0.1',
        '-P',
        String(target.slot.adbServerPort),
        '-s',
        target.slot.emulatorSerial,
        ...argv,
      ],
      target.env,
      60000,
      input,
      stdoutPath,
    );
  };
  const sessionStoragePlan = buildAndroidSessionStorageProbePlan(ANDROID_PILOT_APP_ID);
  const sessionStorageObservations: Record<string, unknown> = {};
  report.androidSessionStorage = sessionStorageObservations;
  const captureAndroidSessionStorage = async (label: string) => {
    if (
      !/^auth-(?:before-relaunch|after-restore|after-cancel|after-signout|after-signed-out-relaunch)$/.test(
        label,
      )
    )
      throw new Error('Invalid Android session storage checkpoint');
    controller.signal.throwIfAborted();
    if (isAuthSessionFlow) {
      if (!proxy) throw new Error('Android session storage capture lacks the owned API proxy');
      await proxy.waitForQuiescence();
    }
    await target!.verify();
    // Force-stop before every snapshot so RKStorage plus WAL/SHM is quiescent.
    // The caller relaunches explicitly before the next UI action.
    await adb(`${label}-quiesce`, ['shell', 'am', 'force-stop', verified.appId]);
    controller.signal.throwIfAborted();
    const databasePath = path.join(output, `${label}-async-storage.db`);
    const queryPath = path.join(output, `${label}-async-storage-query.json`);
    const rawQueryPath = path.join(output, `${label}-async-storage-query.raw.private`);
    const secureStorePath = path.join(output, `${label}-secure-store.xml`);
    const databaseListingPath = path.join(output, `${label}-async-directory.stdout`);
    const databaseAfterListingPath = path.join(output, `${label}-async-directory-after.stdout`);
    const secureStoreListingPath = path.join(output, `${label}-secure-presence.stdout`);
    const databaseDirectoryLog = await adb(
      `${label}-async-directory`,
      sessionStoragePlan.databaseDirectoryArgv,
      undefined,
      databaseListingPath,
    );
    const databaseListing = await readOwnedAndroidStableFile({
      artifactRoot: output,
      filePath: databaseDirectoryLog,
      kind: 'listing',
      maxBytes: androidSessionStorageLimits.listingBytes,
      signal: controller.signal,
    });
    const databaseNames = parseAndroidStorageListing(
      databaseListing.bytes.toString('utf8'),
      'Android AsyncStorage database',
    );
    // TRUNCATE/PERSIST journal modes keep RKStorage-journal after commit; it
    // is only an uncommitted write when its header carries the journal magic.
    const journalCommitted = async (suffix: string) => {
      const journalPath = await adb(
        `${label}-journal-${suffix}`,
        ['exec-out', 'run-as', verified.appId, 'cat', 'databases/RKStorage-journal'],
        undefined,
        path.join(output, `${label}-journal-${suffix}.stdout`),
      );
      const bytes = await readFile(journalPath);
      return (
        bytes.length === 0 || (bytes.length >= 8 && bytes.subarray(0, 8).every((b) => b === 0))
      );
    };
    const rollbackJournalVerifiedEmpty = databaseNames.includes('RKStorage-journal')
      ? await journalCommitted('capture')
      : false;
    const coherence = requireCoherentAndroidDatabaseListing(databaseNames, {
      rollbackJournalVerifiedEmpty,
    });
    const databaseSidecars: AndroidStorageFileReceipt[] = [];
    let databaseReceipt: AndroidStorageFileReceipt | undefined;
    for (const relativePath of sessionStoragePlan.databaseRelativePaths) {
      controller.signal.throwIfAborted();
      const fileName = path.basename(relativePath);
      if (!databaseNames.includes(fileName)) continue;
      const artifactPath =
        fileName === 'RKStorage'
          ? databasePath
          : path.join(output, `${databasePath}${fileName.slice('RKStorage'.length)}`);
      await adb(
        // Owned command labels must be lowercase ([a-z0-9-]).
        `${label}-${fileName.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-capture`,
        sessionStoragePlan.databaseCaptureArgv(relativePath),
        undefined,
        artifactPath,
      );
      const captured = await readOwnedAndroidStableFile({
        artifactRoot: output,
        filePath: artifactPath,
        kind: fileName === 'RKStorage' ? 'database' : 'sidecar',
        maxBytes:
          fileName === 'RKStorage'
            ? androidSessionStorageLimits.databaseBytes
            : androidSessionStorageLimits.sidecarBytes,
        signal: controller.signal,
      });
      if (fileName === 'RKStorage') databaseReceipt = captured.receipt;
      else databaseSidecars.push(captured.receipt);
    }
    if (!databaseReceipt) throw new Error('Android AsyncStorage database capture is missing');
    if (rollbackJournalVerifiedEmpty && !(await journalCommitted('recheck')))
      throw new Error('Android AsyncStorage database changed during capture');
    const databaseAfterDirectoryLog = await adb(
      `${label}-async-directory-after`,
      sessionStoragePlan.databaseDirectoryArgv,
      undefined,
      databaseAfterListingPath,
    );
    const databaseAfterListing = await readOwnedAndroidStableFile({
      artifactRoot: output,
      filePath: databaseAfterDirectoryLog,
      kind: 'listing',
      maxBytes: androidSessionStorageLimits.listingBytes,
      signal: controller.signal,
    });
    const databaseNamesAfter = parseAndroidStorageListing(
      databaseAfterListing.bytes.toString('utf8'),
      'Android AsyncStorage database after capture',
    );
    requireCoherentAndroidDatabaseListing(databaseNamesAfter, { rollbackJournalVerifiedEmpty });
    requireSameAndroidDatabaseListing(databaseNames, databaseNamesAfter);
    let queryCapture: AndroidStorageFileReceipt | undefined;
    let querySourceReceipt:
      | {
          path: string;
          kind: 'query';
          sizeBytes: number;
          sha256: string;
          ownerUid: number;
          mode: number;
          retained: false;
          databaseSha256: string;
          databaseSidecarSha256: readonly string[];
          verification: 'owned-query-source-v6';
        }
      | undefined;
    let rawQueryJson = '';
    let queryProfileAuthUidHash: string | null = null;
    let queryFailure: unknown;
    let queryCleanupFailure: unknown;
    try {
      const queryExecution = await run(
        `${label}-async-query`,
        '/usr/bin/sqlite3',
        ['-readonly', '-json', databasePath, sessionStoragePlan.sqliteQuery],
        nativeEnv,
        15000,
        undefined,
        rawQueryPath,
      );
      // sqlite3 -json prints nothing for zero rows (the signed-out state); the
      // projection parser's canonical empty result is "[]".
      if ((await lstat(queryExecution)).size === 0)
        await writeFile(queryExecution, '[]\n', { flag: 'w' });
      const rawQueryCapture = await readOwnedAndroidStableFile({
        artifactRoot: output,
        filePath: queryExecution,
        kind: 'query',
        maxBytes: androidSessionStorageLimits.queryBytes,
        signal: controller.signal,
      });
      rawQueryJson = rawQueryCapture.bytes.toString('utf8');
      const redactedQuery = redactAndroidSqliteQuery(rawQueryJson);
      queryProfileAuthUidHash = redactedQuery.profileAuthUidHash;
      querySourceReceipt = {
        path: rawQueryCapture.receipt.path,
        kind: 'query',
        sizeBytes: rawQueryCapture.receipt.sizeBytes,
        sha256: rawQueryCapture.receipt.sha256,
        ownerUid: rawQueryCapture.receipt.ownerUid,
        mode: rawQueryCapture.receipt.mode,
        retained: false,
        databaseSha256: databaseReceipt.sha256,
        databaseSidecarSha256: databaseSidecars.map((receipt) => receipt.sha256),
        verification: 'owned-query-source-v6',
      };
      queryCapture = await writeOwnedAndroidPrivateFile({
        artifactRoot: output,
        relativePath: path.basename(queryPath),
        bytes: redactedQuery.redactedJson,
        kind: 'query',
        signal: controller.signal,
      });
    } catch (error) {
      queryFailure = error;
    } finally {
      try {
        await rm(rawQueryPath, { force: true });
      } catch (error) {
        queryCleanupFailure = error;
      }
    }
    if (queryFailure)
      throw queryFailure instanceof Error
        ? queryFailure
        : new Error('Android query failed', { cause: queryFailure });
    if (queryCleanupFailure)
      throw queryCleanupFailure instanceof Error
        ? queryCleanupFailure
        : new Error('Android query cleanup failed', {
            cause: queryCleanupFailure,
          });
    if (!queryCapture || !querySourceReceipt)
      throw new Error('Android query redaction receipts are incomplete');
    const secureStoreDirectoryLog = await adb(
      `${label}-secure-presence`,
      sessionStoragePlan.secureStorePresenceArgv,
      undefined,
      secureStoreListingPath,
    );
    const secureStoreListing = await readOwnedAndroidStableFile({
      artifactRoot: output,
      filePath: secureStoreDirectoryLog,
      kind: 'listing',
      maxBytes: androidSessionStorageLimits.listingBytes,
      signal: controller.signal,
    });
    const secureStoreNames = parseAndroidStorageListing(
      secureStoreListing.bytes.toString('utf8'),
      'Android SecureStore directory',
    );
    const securePreferences = secureStoreNames.includes('SecureStore.xml') ? 'present' : 'absent';
    let secureStore: Awaited<ReturnType<typeof readOwnedAndroidStableFile>> | null = null;
    if (securePreferences === 'present') {
      const secureExecution = await adb(
        `${label}-secure-capture`,
        sessionStoragePlan.secureStoreCaptureArgv,
        undefined,
        secureStorePath,
      );
      secureStore = await readOwnedAndroidStableFile({
        artifactRoot: output,
        filePath: secureExecution,
        kind: 'xml',
        maxBytes: androidSessionStorageLimits.xmlBytes,
        signal: controller.signal,
      });
    }
    controller.signal.throwIfAborted();
    const observation = parseAndroidSessionStorageObservation({
      database: 'present',
      sqliteJson: rawQueryJson,
      securePreferences,
      secureStoreXml: secureStore?.bytes.toString('utf8') ?? null,
      sessionKeyHash: createHash('sha256').update(sessionStoragePlan.sessionKey).digest('hex'),
    });
    if (observation.asyncStorage.profileAuthUidHash !== queryProfileAuthUidHash)
      throw new Error('Android session profile identity hash changed during query redaction');
    const checkpoint = {
      ...observation,
      coherence,
      privateArtifacts: {
        database: databaseReceipt,
        databaseSidecars,
        query: queryCapture,
        querySource: querySourceReceipt,
        secureStore: secureStore?.receipt ?? null,
        databaseListing: databaseListing.receipt,
        secureStoreListing: secureStoreListing.receipt,
      },
    };
    await writeOwnedAndroidPrivateFile({
      artifactRoot: output,
      relativePath: `${label}-storage-observation.private.json`,
      bytes: JSON.stringify(checkpoint, null, 2),
      kind: 'query',
      signal: controller.signal,
    });
    controller.signal.throwIfAborted();
    sessionStorageObservations[label] = checkpoint;
    return checkpoint;
  };
  const relaunchAndroidApp = async (label: string) => {
    controller.signal.throwIfAborted();
    await adb(`${label}-launch`, [
      'shell',
      'am',
      'start',
      '-W',
      '-n',
      `${verified.appId}/${verified.launcher}`,
    ]);
  };
  const readAndroidLocaleProperty = async (
    property: string,
    observationScope: 'startup' | 'camera-student' = 'startup',
  ): Promise<AndroidLocalePropertyRead> => {
    if (!target) throw new Error('Android locale read target unavailable');
    await target.verify();
    const baseLabel =
      property === 'persist.sys.locale' ? 'locale-os-read-persisted' : 'locale-os-read-default';
    const label = observationScope === 'startup' ? baseLabel : `${observationScope}-${baseLabel}`;
    const stdoutPath = path.join(output, `${label}.stdout`);
    let record: (NativeCommandExecution & { label: string; deadlineMs: number }) | undefined;
    try {
      await run(
        label,
        path.join(sdkRoot, 'platform-tools/adb'),
        [
          '-H',
          '127.0.0.1',
          '-P',
          String(target.slot.adbServerPort),
          '-s',
          target.slot.emulatorSerial,
          'shell',
          'getprop',
          property,
        ],
        target.env,
        15_000,
        undefined,
        stdoutPath,
      );
    } catch (error) {
      record = [...commandExecutions].reverse().find((row) => row.label === label);
      if (
        !record ||
        shouldPropagateAndroidLocaleCommandFailure(record, controller.signal.aborted) ||
        (record.execution === 'completed' && record.cleanup === 'cleaned')
      )
        throw error;
    }
    record ??= [...commandExecutions].reverse().find((row) => row.label === label);
    if (!record) throw new Error(`Android locale command record missing: ${label}`);
    let stdoutText: string | null = null;
    if (record.stdoutPath) {
      try {
        stdoutText = readOwnedNativeLocaleStdout(output, path.basename(record.stdoutPath));
      } catch {
        stdoutText = null;
      }
    }
    const attempted = record.pid !== null;
    const status =
      record.execution === 'completed' && record.cleanup === 'cleaned'
        ? 'completed'
        : attempted
          ? 'read-error'
          : 'not-attempted';
    return {
      execution: record.execution,
      cleanup: record.cleanup,
      attempted,
      stdoutText,
      childExitCode: record.childExitCode,
      childSignal: record.childSignal,
      pid: record.pid,
      pgid: record.pgid,
      logPath: record.logPath,
      stdoutPath: record.stdoutPath,
      status,
      value: stdoutText,
    };
  };
  const screenshot = async (label: string): Promise<AndroidCapturedFrameReceipt> => {
    if (!target) throw new Error('Android screenshot target unavailable');
    await target.verify();
    // Keep the binary capture inside the owned command ledger for census,
    // cancellation, cleanup and the configured step deadline.
    const imagePath = path.join(output, `${label}.png`);
    const capturePath = await run(
      label,
      path.join(sdkRoot, 'platform-tools/adb'),
      [
        '-H',
        '127.0.0.1',
        '-P',
        String(target.slot.adbServerPort),
        '-s',
        target.slot.emulatorSerial,
        'exec-out',
        'screencap',
        '-p',
      ],
      target.env,
      30_000,
      undefined,
      imagePath,
    );
    const captured = await readOwnedAndroidStableFile({
      artifactRoot: output,
      filePath: capturePath,
      kind: 'frame',
      maxBytes: 16 * 1024 * 1024,
      signal: controller.signal,
    });
    if (captured.bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
      throw new Error('Android screenshot is not PNG');
    return {
      path: captured.receipt.path,
      sizeBytes: captured.receipt.sizeBytes,
      sha256: captured.receipt.sha256,
      ownerUid: captured.receipt.ownerUid,
      mode: captured.receipt.mode,
      contentKind: 'png',
      verification: 'owned-stable-reader-v6',
    };
  };
  const wholeCaptureDeadlineAtMonotonicMs = performance.now() + boundedDeadlines.wholeRunMs;
  const wholeTimer = setTimeout(() => {
    report.budgetTimeout = 'whole-capture';
    controller.abort(
      new NativeExecutionDeadlineError('whole-capture', boundedDeadlines.wholeRunMs),
    );
  }, boundedDeadlines.wholeRunMs);
  try {
    report.metroEntryPreflight = inspectNativeMetroEntry(root, 'android');
    report.hostPreflight = await requireNativeHostAvailability(output);
    passedHostPreflight = true;
    const dockerVersion = (
      await execute('docker', ['info', '--format', '{{.ServerVersion}}'], {
        timeout: 10000,
      })
    ).stdout.trim();
    if (!dockerVersion) throw new Error('Disposable backend Docker preflight unavailable');
    report.backendPreflight = {
      serverVersion: dockerVersion,
      at: new Date().toISOString(),
    };
    const runtimeParent = path.join(path.dirname(hostRoot), 'mychampions-android-pilot');
    await inspectPrivateAndroidDirectory(runtimeParent);
    await declareAcquisition('adb');
    defaultAdb = await acquireAdbServerReference({
      artifactRoot: output,
      mode: 'own-or-borrow',
      signal: controller.signal,
    });
    report.adbServer = defaultAdb.report;
    await declareAcquisition('emulator');
    target = await acquireOwnedAndroidEmulator({
      runtimeParent,
      artifactRoot: output,
      sdkRoot,
      systemImage: 'system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a',
      signal: controller.signal,
      stepDeadlineMs: deadlines.stepMs,
    });
    report.device = {
      serial: target.identity.serial,
      avd: target.identity.avd,
      osVersion: target.osVersion,
      runId: target.runId,
      slot: target.slot,
    };
    await target.releaseMetroReservation();
    reservation = await reserveOwnedAppPort(target.slot.metroPort);
    report.reservedAppPort = reservation.port;
    await declareAcquisition('backend');
    session = await startOwnedSession({
      serverRoot: path.resolve(root, '../server'),
      appOrigin: reservation.origin,
      signal: controller.signal,
      deadlineMs: boundedDeadlines.wholeRunMs + 300000,
    });
    const ownedSession = session;
    if (!ownedSession) throw new Error('Owned Android session was not acquired');
    const backendProcesses = structuredClone(ownedSession.manifest.processes);
    const backendReport: Record<string, unknown> = {
      runId: ownedSession.manifest.runId,
      composeProject: ownedSession.manifest.composeProject,
      artifactRoot: ownedSession.manifest.artifactRoot,
      repositories: ownedSession.manifest.repositories,
      processes: backendProcesses,
    };
    if (charter === 'connection-journey' || isAuthSessionFlow || isCameraCharter) {
      authBackendProvenance = buildAndroidConnectionBackendProvenance({
        runId: ownedSession.manifest.runId,
        apiOrigin: ownedSession.apiOrigin,
        apiPid: ownedSession.apiPid,
        processes: backendProcesses,
      });
      Object.assign(backendReport, authBackendProvenance);
    }
    report.backend = backendReport;
    await declareAcquisition('proxy');
    proxy = await startOwnedApiProxy({
      session: ownedSession,
      appOrigin: reservation.origin,
      requestProfile: 'native',
    });
    const ownedProxy = proxy;
    if (!ownedProxy) throw new Error('Owned Android API proxy was not acquired');
    report.proxyOrigin = proxy.origin;
    const sessionDirectIo = async <T>(
      label: string,
      operation: () => T | PromiseLike<T>,
    ): Promise<T> => {
      controller.signal.throwIfAborted();
      const value = await operation();
      controller.signal.throwIfAborted();
      void label;
      return value;
    };
    const fixtures = await sessionDirectIo('fixtures', () =>
      ownedSession.fixtures('native-entry-android', controller.signal),
    );
    const fixtureAuthUidAllowlistHash = createHash('sha256')
      .update(
        JSON.stringify(
          Object.values(fixtures.accounts)
            .map((account) => account.authUid)
            .sort(),
        ),
      )
      .digest('hex');
    const captureAuthSessionCheckpoint = async (
      phase: 'before-login' | 'after-login' | 'after-restoration' | 'after-signed-out-relaunch',
    ) => {
      if (!isAuthSessionFlow)
        throw new Error('Auth session checkpoint is outside the session charter');
      const beforeApi = await sessionDirectIo('checkpoint-before-api', () =>
        ownedSession.probeApiLifetime(controller.signal),
      );
      const profileEvidence = await sessionDirectIo('checkpoint-profile', () =>
        ownedSession.connectionSnapshotWithEvidence('native-entry-android', controller.signal),
      );
      const domainEvidence = await sessionDirectIo('checkpoint-domain', () =>
        ownedSession.snapshotWithEvidence('native-entry-android', controller.signal),
      );
      const afterApi = await sessionDirectIo('checkpoint-after-api', () =>
        ownedSession.probeApiLifetime(controller.signal),
      );
      const apiLifetime = requireAndroidOwnedApiLifetimeBinding({
        before: {
          ...beforeApi,
          proxyRunId: ownedProxy.runId,
          proxyOrigin: ownedProxy.origin,
        },
        after: {
          ...afterApi,
          proxyRunId: ownedProxy.runId,
          proxyOrigin: ownedProxy.origin,
        },
        expectedRunId: ownedSession.manifest.runId,
        expectedProxyRunId: ownedProxy.runId,
        expectedProxyOrigin: ownedProxy.origin,
      });
      if (
        profileEvidence.receipt.runId !== ownedSession.manifest.runId ||
        domainEvidence.receipt.runId !== ownedSession.manifest.runId ||
        profileEvidence.receipt.scope !== 'native-entry-android' ||
        domainEvidence.receipt.scope !== 'native-entry-android' ||
        profileEvidence.receipt.apiOrigin !== apiLifetime.apiOrigin ||
        domainEvidence.receipt.apiOrigin !== apiLifetime.apiOrigin ||
        profileEvidence.receipt.apiPid !== apiLifetime.apiPid ||
        domainEvidence.receipt.apiPid !== apiLifetime.apiPid ||
        profileEvidence.receipt.manifestSha256 !== apiLifetime.manifestSha256 ||
        domainEvidence.receipt.manifestSha256 !== apiLifetime.manifestSha256 ||
        profileEvidence.receipt.fixtureAuthUidAllowlistHash !== fixtureAuthUidAllowlistHash ||
        domainEvidence.receipt.fixtureAuthUidAllowlistHash !== fixtureAuthUidAllowlistHash
      )
        throw new Error('Android session snapshot receipts are not bound to the current owned API');
      const receipt = {
        phase,
        runId: ownedSession.manifest.runId,
        scope: 'native-entry-android',
        apiOrigin: apiLifetime.apiOrigin,
        apiPid: apiLifetime.apiPid,
        backendAttemptId: apiLifetime.backendAttemptId,
        manifestSha256: apiLifetime.manifestSha256,
        fixtureAuthUidAllowlistHash,
        profile: profileEvidence.receipt,
        domain: domainEvidence.receipt,
      };
      authSessionCheckpointReceipts[phase] = receipt;
      return {
        profile: profileEvidence.value,
        domain: domainEvidence.value,
        receipt,
        apiLifetime,
      };
    };
    const rereadAndroidSessionCheckpoint = async (
      label: string,
      expected: {
        profile: unknown;
        domain: unknown;
        receipt: AndroidSessionCheckpointReceipt;
      },
    ) => {
      for (const [kind, value, source, schema] of [
        ['profile', expected.profile, expected.receipt.profile, 'connection-snapshot-v1'],
        ['domain', expected.domain, expected.receipt.domain, 'domain-snapshot-v1'],
      ] as const) {
        const reread = await sessionDirectIo(`${label}-${kind}-reread`, () =>
          readOwnedRuntimeDocumentWithReceipt(
            path.join(ownedSession.manifest.artifactRoot, source.path),
            ownedSession.manifest.artifactRoot,
            source.path,
            schema,
            controller.signal,
          ),
        );
        if (
          JSON.stringify(reread.value) !== JSON.stringify(value) ||
          reread.receipt.path !== source.path ||
          reread.receipt.schema !== schema ||
          reread.receipt.sizeBytes !== source.sizeBytes ||
          reread.receipt.sha256 !== source.sha256 ||
          reread.receipt.ownerUid !== source.ownerUid ||
          reread.receipt.mode !== source.mode
        )
          throw new Error(`Android ${label} ${kind} checkpoint changed after capture`);
      }
    };
    if (isAuthSessionFlow) {
      const beforeCheckpoint = await captureAuthSessionCheckpoint('before-login');
      authDomainBefore = beforeCheckpoint.domain;
      authConnectionBefore = beforeCheckpoint.profile;
      report.androidSessionDomainScope = {
        runId: authDomainBefore.runId,
        scope: authDomainBefore.scope,
        trainingPlans: authDomainBefore.trainingPlans.length,
        connections: authDomainBefore.connections.length,
      };
      report.androidSessionConnectionScope = {
        runId: authConnectionBefore.runId,
        scope: authConnectionBefore.scope,
        profiles: authConnectionBefore.rows.userProfiles.length,
        connections: authConnectionBefore.rows.connections.length,
      };
      report.androidSessionConnectionSnapshots = {
        beforeLogin: {
          runId: authConnectionBefore.runId,
          scope: authConnectionBefore.scope,
          rowCounts: authConnectionBefore.rowCounts,
          profilesSha256: createHash('sha256')
            .update(JSON.stringify(authConnectionBefore.rows.userProfiles))
            .digest('hex'),
          connectionsSha256: createHash('sha256')
            .update(JSON.stringify(authConnectionBefore.rows.connections))
            .digest('hex'),
        },
      };
      report.androidSessionCheckpointReceipts = authSessionCheckpointReceipts;
    }
    const authApiIdentity: AndroidConnectionApiIdentity | undefined =
      charter === 'connection-journey' || isAuthSessionFlow || isCameraCharter
        ? { apiPid: ownedSession.apiPid, targetOrigin: ownedSession.apiOrigin }
        : undefined;
    if (isAuthSessionFlow || isCameraCharter) {
      requireAndroidConnectionAuthIdentityCapture(proxy);
      proxy.enableNativeAuthIdentityCapture(
        Object.values(fixtures.accounts).map((account) => account.authUid),
      );
    }
    const connectionIsolationScope = 'native-conn-isolation-android' as const;
    let connectionIsolationFixtures: OwnedFixtures | undefined;
    let connectionIsolationFixtureBinding: AndroidCameraIsolationFixtureBinding | undefined;
    const connectionApiIdentity: AndroidConnectionApiIdentity | undefined =
      charter === 'connection-journey'
        ? { apiPid: ownedSession.apiPid, targetOrigin: ownedSession.apiOrigin }
        : undefined;
    if (charter === 'connection-journey' || isCameraCharter) {
      connectionIsolationFixtures = await sessionDirectIo('connection-isolation-fixtures', () =>
        ownedSession.fixtures(connectionIsolationScope, controller.signal),
      );
      if (isCameraCharter) {
        const primaryFixtureAuthUids = Object.values(fixtures.accounts)
          .map((account) => account.authUid)
          .sort();
        const isolationFixtureAuthUids = Object.values(connectionIsolationFixtures.accounts)
          .map((account) => account.authUid)
          .sort();
        if (
          new Set(isolationFixtureAuthUids).size !== isolationFixtureAuthUids.length ||
          isolationFixtureAuthUids.some((uid) => primaryFixtureAuthUids.includes(uid)) ||
          connectionIsolationFixtures.accounts.coach.role !== 'professional' ||
          connectionIsolationFixtures.accounts.student.role !== 'student' ||
          connectionIsolationFixtures.accounts.coach.authUid ===
            connectionIsolationFixtures.accounts.student.authUid
        )
          throw new Error('Android camera isolation fixture identities overlap or are ambiguous');
        const isolationFixturePath = 'fixtures-native-connection-isolation-android.private.json';
        const isolationFixtureBytes = Buffer.from(JSON.stringify(connectionIsolationFixtures));
        const outputIdentity = await lstat(output);
        await writeAtomicDetoxConnectionBytes(
          output,
          isolationFixturePath,
          isolationFixtureBytes,
          1 * 1024 * 1024,
          {
            signal: controller.signal,
            deadlineAt: wholeCaptureDeadlineAtMonotonicMs,
            expectedRootIdentity: {
              dev: outputIdentity.dev,
              ino: outputIdentity.ino,
              uid: outputIdentity.uid,
              gid: outputIdentity.gid,
              mode: outputIdentity.mode,
            },
          },
        );
        const isolationFixtureFile = await readOwnedAndroidStableFile({
          artifactRoot: output,
          filePath: path.join(output, isolationFixturePath),
          kind: 'sidecar',
          maxBytes: 1 * 1024 * 1024,
          signal: controller.signal,
        });
        connectionIsolationFixtureBinding = {
          ...isolationFixtureFile.receipt,
          source: 'owned-session.fixtures',
          runId: connectionIsolationFixtures.runId,
          scope: connectionIsolationFixtures.scope,
          fixtureAuthUids: isolationFixtureAuthUids,
          target: {
            professionalAuthUid: connectionIsolationFixtures.accounts.coach.authUid,
            studentAuthUid: connectionIsolationFixtures.accounts.student.authUid,
            specialty: 'fitness_coach',
          },
        };
        report.connectionIsolationFixtureEvidence = structuredClone(
          connectionIsolationFixtureBinding,
        );
      }
    }
    if (charter === 'connection-journey') {
      const connectionProxy = proxy;
      if (!connectionProxy)
        throw new Error('Owned API proxy unavailable for Android connection fixtures');
      requireAndroidConnectionAuthIdentityCapture(connectionProxy);
      connectionProxy.enableNativeAuthIdentityCapture(
        Object.values(fixtures.accounts).map((account) => account.authUid),
      );
      report.connectionIsolationScope = connectionIsolationScope;
    }
    report.fixtureHash = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex');
    report.fixtureRef = `owned-postgres:native-entry-android:${ownedSession.manifest.runId}`;
    if (isCameraCharter && savedFlow) {
      report.androidCameraSavedFlow = {
        ...savedFlow.binding,
        runtimeFixtureRef: report.fixtureRef,
        runtimeFixtureRunId: fixtures.runId,
        runtimeFixtureScope: fixtures.scope,
      };
    }
    await declareAcquisition('expo');
    app = await startOwnedExpo({
      clientRoot: root,
      artifactRoot: output,
      reservation,
      apiOrigin: proxy.origin,
      surface: 'native',
      signal: controller.signal,
    });
    const toolchain = await resolveAndroidPilotToolchain();
    if (toolchain.sdkRoot !== sdkRoot) throw new Error('Android SDK configuration changed');
    report.androidToolchain = toolchain;
    const { javaHome } = toolchain;
    nativeEnv = {
      ...app.environment,
      ANDROID_HOME: sdkRoot,
      ANDROID_SDK_ROOT: sdkRoot,
      JAVA_HOME: javaHome,
      GRADLE_USER_HOME: '/Users/eduwaldo/.gradle',
      JAVA_TOOL_OPTIONS: `-Dmychampions.native.owner=${path.basename(output)}`,
    };
    const buildDir = path.join(output, 'android-app-build');
    const initFile = path.join(output, 'android-output.init.gradle');
    await writeFile(
      initFile,
      `gradle.beforeProject { p ->\n  if (p.path == ':app' && p.projectDir.canonicalPath == System.getProperty('mychampions.android.project')) {\n    p.layout.buildDirectory.set(new File(System.getProperty('mychampions.android.output')))\n  }\n}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    const buildArgv = [
      '-p',
      'android',
      '--no-daemon',
      '--console=plain',
      '--project-cache-dir',
      path.join(output, 'gradle-project-cache'),
      '--init-script',
      initFile,
      `-Dmychampions.android.project=${path.join(root, 'android/app')}`,
      `-Dmychampions.android.output=${buildDir}`,
      `-PdetoxMetroPort=${reservation.port}`,
      '-PreactNativeArchitectures=arm64-v8a',
      'app:assembleDevDebug',
    ];
    beginPhase('build');
    let reusedBuildCopy:
      | { path: string; sha256: string; sizeBytes: number; identity: Record<string, unknown> }
      | undefined;
    if (options.qualifiedBuild) {
      const currentApiOrigin = ownedSession.apiOrigin;
      const currentApiPort = Number(new URL(currentApiOrigin).port);
      const currentMetroPort = reservation.port;
      const currentProxyPort = Number(new URL(proxy.origin).port);
      if (
        options.qualifiedBuild.originalPorts.api === currentApiPort ||
        options.qualifiedBuild.originalPorts.metro === currentMetroPort ||
        options.qualifiedBuild.originalPorts.proxy === currentProxyPort ||
        options.qualifiedBuild.originalOrigins.api === currentApiOrigin ||
        options.qualifiedBuild.originalOrigins.metro === app.origin ||
        options.qualifiedBuild.originalOrigins.proxy === proxy.origin
      )
        throw new Error('Android qualified build attempted to reuse current API or Metro identity');
      const binaryPath = path.join(buildDir, 'outputs/apk/dev/debug/app-dev-debug.apk');
      await mkdir(path.dirname(binaryPath), { recursive: true, mode: 0o700 });
      reusedBuildCopy = await copyQualifiedAndroidMaestroApk({
        reuse: options.qualifiedBuild,
        destination: binaryPath,
        signal: controller.signal,
        deadlineAtMonotonicMs: wholeCaptureDeadlineAtMonotonicMs,
      });
      report.buildCommand = {
        kind: 'qualified-android-maestro-build-reuse',
        buildId: options.qualifiedBuild.buildId,
        binaryPath,
        binaryHash: reusedBuildCopy.sha256,
        originalPorts: options.qualifiedBuild.originalPorts,
        originalOrigins: options.qualifiedBuild.originalOrigins,
        currentPorts: {
          api: currentApiPort,
          metro: currentMetroPort,
          proxy: currentProxyPort,
        },
        currentOrigins: { api: currentApiOrigin, metro: app.origin, proxy: proxy.origin },
      };
    } else {
      report.buildCommand = { command: 'android/gradlew', argv: buildArgv };
      await run(
        'android-build',
        path.join(root, 'android/gradlew'),
        buildArgv,
        nativeEnv,
        deadlines.buildMs,
      );
    }
    beginPhase('verify');
    const binaryPath = path.join(buildDir, 'outputs/apk/dev/debug/app-dev-debug.apk');
    const embeddedApiOrigin = options.qualifiedBuild?.originalOrigins.api ?? proxy.origin;
    verified = await inspectOwnedAndroidApk({
      binaryPath,
      artifactRoot: output,
      sdkRoot,
      apiOrigin: embeddedApiOrigin,
    });
    if (options.qualifiedBuild) {
      if (verified.appId !== options.qualifiedBuild.appId)
        throw new Error('Android qualified build app identity changed during capture');
      if (verified.launcher !== options.qualifiedBuild.launcher)
        throw new Error('Android qualified build launcher identity changed during capture');
      if (verified.environmentHash !== options.qualifiedBuild.environmentHash)
        throw new Error('Android qualified build environment identity changed during capture');
    }
    const environmentConfig = options.qualifiedBuild
      ? configWithApiOrigin(app.configExtra, embeddedApiOrigin)
      : app.configExtra;
    if (
      verified.environmentHash !==
      createHash('sha256').update(JSON.stringify(environmentConfig)).digest('hex')
    )
      throw new Error('APK and running Metro resolved configuration differ');
    localeExpectedBindingInputs = {
      sourceTreeHash: beforeSource.sourceTreeHash,
      helperInputs: structuredClone(beforeHelpers),
      target: {
        platform: 'android',
        deviceId: target.identity.serial,
        osVersion: target.osVersion,
        appId: verified.appId,
        binaryHash: verified.binaryHash,
        apiOrigin: proxy.origin,
      },
    };
    report.build = {
      ...verified,
      // Same runtime identity the iOS capture records; public evidence requires it.
      node: process.version,
      sourceTreeHash: beforeSource.sourceTreeHash,
      helperInputsHash: options.qualifiedBuild?.helperFingerprint ?? helperInputsHash,
      flagsFingerprint: options.qualifiedBuild?.flagsFingerprint ?? verified.environmentHash,
      environmentHash: verified.environmentHash,
      qualifiedReuse: options.qualifiedBuild
        ? {
            buildId: options.qualifiedBuild.buildId,
            binaryHash: options.qualifiedBuild.binaryHash,
            originalPorts: options.qualifiedBuild.originalPorts,
            originalOrigins: options.qualifiedBuild.originalOrigins,
          }
        : undefined,
      profile:
        'Metro-attached devDebug arm64; no app-domain instrumentation; optional separately bound read-only input reader; not bundled release qualification',
      apiOrigin: proxy.origin,
      metroOrigin: app.origin,
    };
    beginPhase('install');
    await adb('android-install', ['install', binaryPath]);
    const packagePath = await target.adbRead(['shell', 'pm', 'path', ANDROID_PILOT_APP_ID]);
    const installedPath = /^package:(\/data\/app\/[A-Za-z0-9_~+=/.-]+\/base\.apk)$/.exec(
      packagePath,
    )?.[1];
    if (!installedPath) throw new Error('Installed APK path cannot be bound');
    const installedCopy = path.join(output, 'installed-base.apk');
    await adb('android-installed-build', ['pull', installedPath, installedCopy]);
    await chmod(installedCopy, 0o600);
    if (
      createHash('sha256')
        .update(await readFile(installedCopy))
        .digest('hex') !== verified.binaryHash
    )
      throw new Error('Installed APK bytes differ from inspected build');
    beginPhase('reset');
    const apiPort = Number(new URL(proxy.origin).port);
    const deviceApiPort = options.qualifiedBuild?.originalPorts.api ?? apiPort;
    for (const [label, devicePort, hostPort] of [
      ['metro', reservation.port, reservation.port],
      ['api', deviceApiPort, apiPort],
    ] as const)
      await adb(`android-reverse-${label}`, [
        'reverse',
        '--no-rebind',
        `tcp:${devicePort}`,
        `tcp:${hostPort}`,
      ]);
    const reverseMappings = await target.adbRead(['reverse', '--list']);
    await writeFile(path.join(output, 'android-reverse.private.log'), reverseMappings, {
      flag: 'wx',
      mode: 0o600,
    });
    if (options.qualifiedBuild)
      assertAndroidReverseBindings(reverseMappings, target.identity.serial, [
        { devicePort: reservation.port, hostPort: reservation.port },
        { devicePort: deviceApiPort, hostPort: apiPort },
      ]);
    else
      assertAndroidReverseMappings(reverseMappings, target.identity.serial, [
        reservation.port,
        apiPort,
      ]);
    const preference = androidMetroPreference(verified.appId, reservation.port);
    await adb('android-prefs-directory', [
      'shell',
      'run-as',
      verified.appId,
      'mkdir',
      '-p',
      'shared_prefs',
    ]);
    await adb(
      'android-metro-prefs',
      ['shell', 'run-as', verified.appId, 'tee', preference.relativePath],
      preference.xml,
    );
    if (
      (await target.adbRead([
        'shell',
        'run-as',
        verified.appId,
        'cat',
        preference.relativePath,
      ])) !== preference.xml.trim()
    )
      throw new Error('Android debug Metro preference was not persisted exactly');
    report.network = {
      apiOrigin: proxy.origin,
      metroOrigin: app.origin,
      reversePorts: [reservation.port, deviceApiPort],
      reverseHostPorts: [reservation.port, apiPort],
      debugServerHost: `localhost:${reservation.port}`,
    };
    if (options.prepareColdReset) {
      if (!target || !ownedSession || !proxy || !verified || !options.coldResetOwnerRunId)
        throw new Error('Android cold reset preparation runtime is unavailable');
      const coldResetFixtureResetId = options.coldResetFixtureResetId;
      if (!coldResetFixtureResetId)
        throw new Error('Android cold reset preparation fixture identity is unavailable');
      if (!defaultAdb)
        throw new Error('Android cold reset preparation ADB ownership is unavailable');
      const proxyProcess = await inspectProcessIdentity(process.pid);
      if (!proxyProcess)
        throw new Error('Android cold reset preparation process ownership is unavailable');
      const installedInfo = await lstat(installedCopy);
      if (
        installedInfo.isSymbolicLink() ||
        !installedInfo.isFile() ||
        installedInfo.nlink !== 1 ||
        installedInfo.size <= 0
      )
        throw new Error('Android cold reset installed APK is not a private regular file');
      const androidSessionStorage: DetoxAndroidSessionStorageTarget = {
        appId: ANDROID_PILOT_APP_ID,
        serial: target.identity.serial,
        adbServerPort: target.slot.adbServerPort,
        verify: async () => {
          controller.signal.throwIfAborted();
          await defaultAdb!.assertAlive('android-cold-reset-storage');
          await target!.verify();
        },
        runAdb: async (input) => {
          const command = path.join(sdkRoot, 'platform-tools/adb');
          const argv = [
            '-H',
            '127.0.0.1',
            '-P',
            String(input.target.adbServerPort),
            '-s',
            input.target.serial,
            ...input.argv,
          ];
          const cwd = root;
          const inputSha256 =
            input.input !== undefined
              ? createHash('sha256').update(input.input).digest('hex')
              : undefined;
          const execution = await executeOwnedNativeCommand({
            command,
            argv,
            env: target!.env,
            cwd,
            input: input.input,
            artifactRoot: input.artifactRoot,
            label: input.label,
            deadlineMs: input.deadlineMs,
            phase: 'step',
            signal: input.signal,
            stdoutPath: input.stdoutPath,
            leaderHandshake: true,
          });
          return {
            ...execution,
            command,
            argv,
            cwd,
            deadlineMs: input.deadlineMs,
            ...(inputSha256 ? { inputSha256 } : {}),
            commandHash: buildDetoxAndroidStorageCommandHash({
              command,
              argv,
              cwd,
              deadlineMs: input.deadlineMs,
              ...(inputSha256 ? { inputSha256 } : {}),
              phase: 'step',
              target: input.target,
              binding: input.binding,
            }),
            target: input.target,
            binding: input.binding,
          };
        },
        runHostSqlite: async (input) => {
          const command = '/usr/bin/sqlite3';
          const argv = [...input.argv];
          const cwd = root;
          const inputSha256 =
            input.input !== undefined
              ? createHash('sha256').update(input.input).digest('hex')
              : undefined;
          const execution = await executeOwnedNativeCommand({
            command,
            argv,
            env: { ...process.env },
            cwd,
            input: input.input,
            artifactRoot: input.artifactRoot,
            label: input.label,
            deadlineMs: input.deadlineMs,
            phase: 'step',
            signal: input.signal,
            stdoutPath: input.stdoutPath,
            leaderHandshake: true,
          });
          return {
            ...execution,
            command,
            argv,
            cwd,
            deadlineMs: input.deadlineMs,
            ...(inputSha256 ? { inputSha256 } : {}),
            commandHash: buildDetoxAndroidStorageCommandHash({
              command,
              argv,
              cwd,
              deadlineMs: input.deadlineMs,
              ...(inputSha256 ? { inputSha256 } : {}),
              phase: 'step',
              target: input.target,
              binding: input.binding,
            }),
            target: input.target,
            binding: input.binding,
          };
        },
      };
      const coldReset = await options.prepareColdReset({
        output,
        captureRunId,
        ownerRunId: options.coldResetOwnerRunId,
        target: { ...target, androidSessionStorage },
        session: ownedSession,
        proxy,
        proxyProcess: {
          pid: proxyProcess.pid,
          started: proxyProcess.started,
          script: proxyProcess.command,
        },
        fixtures: {
          ...fixtures,
          resetId: coldResetFixtureResetId,
        },
        build: {
          appId: verified.appId,
          buildProfile: String(
            report.build && typeof report.build === 'object' && !Array.isArray(report.build)
              ? (report.build as Record<string, unknown>).profile
              : 'android-owned-maestro-build',
          ),
          binaryHash: verified.binaryHash,
          apiOrigin: proxy.origin,
          sourceTreeHash: beforeSource.sourceTreeHash,
          helperInputsHash: options.qualifiedBuild?.helperFingerprint ?? helperInputsHash,
          flagsFingerprint: options.qualifiedBuild?.flagsFingerprint ?? verified.environmentHash,
          environmentHash: verified.environmentHash,
          qualifiedReuse: options.qualifiedBuild
            ? {
                buildId: options.qualifiedBuild.buildId,
                binaryHash: options.qualifiedBuild.binaryHash,
                originalPorts: options.qualifiedBuild.originalPorts,
                originalOrigins: options.qualifiedBuild.originalOrigins,
              }
            : undefined,
        },
        installedApk: {
          path: installedCopy,
          sha256: verified.binaryHash,
          sizeBytes: installedInfo.size,
        },
        commandExecutions,
        signal: controller.signal,
        deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
        report,
      });
      if (!coldReset || typeof coldReset !== 'object' || Array.isArray(coldReset))
        throw new Error('Android cold reset preparation returned no protected result');
      report.coldReset = structuredClone(coldReset);
    }
    const localeProperties = await readAndroidNativeLocaleProperties(readAndroidLocaleProperty);
    const localeCommandMetadata = (read: AndroidLocalePropertyRead | null) =>
      read
        ? {
            status: read.status,
            execution: read.execution,
            cleanup: read.cleanup,
            attempted: read.attempted,
            childExitCode: read.childExitCode ?? null,
            childSignal: read.childSignal ?? null,
            pid: read.pid ?? null,
            pgid: read.pgid ?? null,
            logPath: read.logPath ?? null,
            stdoutPath: read.stdoutPath ?? null,
          }
        : null;
    report.localeProperties = {
      persisted: localeCommandMetadata(localeProperties.persisted),
      productDefault: localeCommandMetadata(localeProperties.productDefault),
      selectedProperty: localeProperties.selectedProperty,
    };
    report.locale = null;
    localeCapture = {
      persisted: localeProperties.persisted,
      productDefault: localeProperties.productDefault,
      selected: localeProperties.selected,
      selectedProperty: localeProperties.selectedProperty,
      hierarchyPath: 'entry-hierarchy.json',
    };
    await adb('android-launch', [
      'shell',
      'am',
      'start',
      '-W',
      '-n',
      `${verified.appId}/${verified.launcher}`,
    ]);
    const maestroArgs = [
      '--no-ansi',
      '--platform',
      'android',
      '--host',
      '127.0.0.1',
      '--port',
      String(target.slot.emulatorPort + 1),
    ];
    const maestroEnv: NodeJS.ProcessEnv = {
      ...target.env,
      MAESTRO_CLI_NO_ANALYTICS: 'true',
      MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
    };
    const setCameraInviteCode = (value: string): void => {
      assert(isCameraCharter, 'Android camera invite injection is outside the camera charter');
      assert(savedFlowModule, 'Android camera saved-flow loader is unavailable');
      savedFlowModule.setAndroidCameraInviteCode(maestroEnv, value);
    };
    report.maestroEnvironment = captureMaestroDiagnosticEnvironment(maestroEnv);
    // The Maestro CLI target port is not evidence of the driver port. The
    // diagnostic phase may fill this only from one unambiguous recorded value
    // in the private combined command log.
    report.originalMaestroDriverPort = null;
    const frames: {
      viewId: string;
      hierarchyPath: string;
      screenshotPath: string;
    }[] = [];
    report.observations = frames;
    const observe: NativeTrainingObserve = async (
      label,
      actions,
      viewId,
      selectors,
      kind = 'id',
    ) => {
      const required = typeof selectors === 'string' ? [selectors] : selectors;
      if (
        !['id', 'text'].includes(kind) ||
        !required.length ||
        required.some((value) => !value.trim())
      )
        throw new Error('Invalid Android native observation selectors');
      const selector = (value: string) =>
        `${kind}: ${JSON.stringify(kind === 'text' ? '^' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$' : value)}`;
      const flow = path.join(output, `${label}.yaml`);
      await writeFile(
        flow,
        `appId: ${verified.appId}\nname: Android inventory ${label}\n---\n${actions}\n- extendedWaitUntil:\n    visible:\n      ${selector(required[0])}\n    timeout: 90000\n${required
          .slice(1)
          // Every required selector must become visible; an instant assert
          // races elements that render a moment after the first one.
          .map(
            (value) =>
              `- extendedWaitUntil:\n    visible:\n      ${selector(value)}\n    timeout: 30000\n`,
          )
          .join('')}`,
        { flag: 'wx', mode: 0o600 },
      );
      await run(
        `${label}-readiness`,
        maestro,
        [
          ...maestroArgs,
          'test',
          '--debug-output',
          path.join(output, `${label}-debug`),
          '--test-output-dir',
          path.join(output, `${label}-artifacts`),
          flow,
        ],
        maestroEnv,
        180000,
      );
      const hierarchyStdoutPath = path.join(output, `${label}-hierarchy.stdout`);
      const log = await run(
        `${label}-hierarchy`,
        maestro,
        [...maestroArgs, 'hierarchy'],
        maestroEnv,
        120000,
        undefined,
        hierarchyStdoutPath,
      );
      const hierarchyExecution = commandExecutions.find(
        (entry) => entry.label === `${label}-hierarchy`,
      );
      if (hierarchyExecution?.stdoutPath !== hierarchyStdoutPath)
        throw new Error('Android hierarchy stdout was not captured separately');
      const hierarchySource = await readOwnedAndroidStableFile({
        artifactRoot: output,
        filePath: log,
        kind: 'frame',
        maxBytes: 16 * 1024 * 1024,
        signal: controller.signal,
      });
      const tree = parseNativeHierarchy(hierarchySource.bytes.toString('utf8'));
      observedTrees.set(label, tree);
      const cameraPromptReadiness =
        label === 'camera-prompt'
          ? requireAndroidCameraPromptHierarchy({
              tree,
              requiredSelectors: required,
              kind,
              serial: target!.identity.serial,
              apiLevel: Number(target!.osVersion.match(/\d+/u)?.[0] ?? 0),
              locale:
                options.expectedLocale ??
                (() => {
                  throw new Error('Android camera prompt locale is unavailable');
                })(),
              expectedAppLabel: androidCameraExpectedAppLabel(verified.appId),
            })
          : undefined;
      if (cameraPromptReadiness) {
        observedAndroidCameraPromptSelectors.set(label, cameraPromptReadiness.selectors);
      }
      const hierarchySelectors = cameraPromptReadiness?.selectors ?? required;
      if (
        !hierarchySelectors.every((value) =>
          kind === 'text'
            ? nativeHierarchyHasAttribute(tree, 'text', value) ||
              nativeHierarchyHasAttribute(tree, 'accessibilityText', value)
            : nativeHierarchyHasAttribute(tree, 'resource-id', value) ||
              nativeHierarchyHasAttribute(tree, 'resource-id', `${verified.appId}:id/${value}`),
        )
      )
        throw new Error('Android actual hierarchy lacks exact required selector');
      await writeFile(path.join(output, `${label}-hierarchy.json`), JSON.stringify(tree), {
        flag: 'wx',
        mode: 0o600,
      });
      const hierarchy = await readOwnedAndroidStableFile({
        artifactRoot: output,
        filePath: path.join(output, `${label}-hierarchy.json`),
        kind: 'frame',
        maxBytes: 16 * 1024 * 1024,
        signal: controller.signal,
      });
      const screenshotReceipt = await screenshot(label);
      observedFrameReceipts.set(label, {
        hierarchySource: {
          path: hierarchySource.receipt.path,
          sizeBytes: hierarchySource.receipt.sizeBytes,
          sha256: hierarchySource.receipt.sha256,
          ownerUid: hierarchySource.receipt.ownerUid,
          mode: hierarchySource.receipt.mode,
          contentKind: 'hierarchy-source',
          verification: 'owned-stable-reader-v6',
        },
        hierarchy: {
          path: hierarchy.receipt.path,
          sizeBytes: hierarchy.receipt.sizeBytes,
          sha256: hierarchy.receipt.sha256,
          ownerUid: hierarchy.receipt.ownerUid,
          mode: hierarchy.receipt.mode,
          contentKind: 'hierarchy-json',
          verification: 'owned-stable-reader-v6',
        },
        screenshot: screenshotReceipt,
      });
      assertNativeBootstrapHealthy(app!.diagnostics);
      frames.push({
        viewId,
        hierarchyPath: `${label}-hierarchy.json`,
        screenshotPath: `${label}.png`,
      });
      report.viewIds = [...new Set(frames.map((row) => row.viewId))];
    };
    const executeActions: NativeTrainingObserve = async (
      label,
      actions,
      _viewId,
      selectors,
      kind = 'id',
    ) => {
      const required = typeof selectors === 'string' ? [selectors] : selectors;
      if (
        !['id', 'text'].includes(kind) ||
        !required.length ||
        required.some((value) => !value.trim())
      )
        throw new Error('Invalid Android native action selectors');
      const selector = (value: string) =>
        `${kind}: ${JSON.stringify(kind === 'text' ? '^' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$' : value)}`;
      const flow = path.join(output, `${label}.yaml`);
      await writeFile(
        flow,
        `appId: ${verified.appId}\nname: Android action ${label}\n---\n${actions}\n- extendedWaitUntil:\n    visible:\n      ${selector(required[0])}\n    timeout: 90000\n${required
          .slice(1)
          // Every required selector must become visible; an instant assert
          // races elements that render a moment after the first one.
          .map(
            (value) =>
              `- extendedWaitUntil:\n    visible:\n      ${selector(value)}\n    timeout: 30000\n`,
          )
          .join('')}`,
        { flag: 'wx', mode: 0o600 },
      );
      await run(
        `${label}-readiness`,
        maestro,
        [
          ...maestroArgs,
          'test',
          '--debug-output',
          path.join(output, `${label}-debug`),
          '--test-output-dir',
          path.join(output, `${label}-artifacts`),
          flow,
        ],
        maestroEnv,
        180000,
      );
    };
    await observe('entry', '', 'SCR-sign-in', [
      'auth.signIn.emailInput',
      'auth.signIn.passwordInput',
      'auth.signIn.submitButton',
    ]);
    beginPhase('scenario');
    const coachHomeObservation = buildAndroidCoachHomeObservation({
      email: fixtures.accounts.coach.email,
      password: fixtures.accounts.coach.password,
      requireInviteCode: charter === 'connection-journey' || isCameraCharter,
    });
    await observe(
      'coach-home',
      coachHomeObservation.actions,
      'SCR-pro-home',
      coachHomeObservation.selectors,
    );
    const pathHash = createHash('sha256').update('/auth/email/sign-in').digest('hex');
    if (
      !proxy.observations.some(
        (row) =>
          row.pathHash === pathHash &&
          row.status === 201 &&
          row.outcome === 'forwarded' &&
          row.requestProfile === 'native',
      )
    )
      throw new Error('Android sign-in did not reach the owned normal API');
    if (charter === 'connection-journey') {
      const authenticatedProxy = proxy;
      if (!authenticatedProxy || !connectionApiIdentity)
        throw new Error(
          'Android connection journey API identity is unavailable after coach sign-in',
        );
      requireAndroidConnectionAuthIdentityCapture(authenticatedProxy);
      const coachBoundary = requireAndroidConnectionSignInBoundary(
        authenticatedProxy.observations,
        authenticatedProxy.nativeAuthIdentities,
        { beforeRequestId: 0, apiIdentity: connectionApiIdentity },
      );
      const coachAuthUid = requireAndroidConnectionActorIdentity(
        authenticatedProxy.nativeAuthIdentities,
        {
          actorAuthUid: fixtures.accounts.coach.authUid,
          authRequestId: coachBoundary.authRequestId,
          apiIdentity: connectionApiIdentity,
          fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
        },
      );
      report.connectionInitialAuth = {
        actor: 'coach',
        actorAuthUid: coachAuthUid,
        ...coachBoundary,
      };
      report.connectionApiIdentity = { ...connectionApiIdentity };
    }
    if (isAuthSessionFlow) {
      const authenticatedProxy = proxy;
      if (!authenticatedProxy || !authApiIdentity || !authBackendProvenance)
        throw new Error('Android auth-account API identity is unavailable after backend setup');
      requireAndroidConnectionAuthIdentityCapture(authenticatedProxy);
      const coachBoundary = requireAndroidConnectionSignInBoundary(
        authenticatedProxy.observations,
        authenticatedProxy.nativeAuthIdentities,
        { beforeRequestId: 0, apiIdentity: authApiIdentity },
      );
      const coachAuthUid = requireAndroidConnectionActorIdentity(
        authenticatedProxy.nativeAuthIdentities,
        {
          actorAuthUid: fixtures.accounts.coach.authUid,
          authRequestId: coachBoundary.authRequestId,
          apiIdentity: authApiIdentity,
          fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
        },
      );
      const coachIdentity = authenticatedProxy.nativeAuthIdentities.find(
        (identity) => identity.requestId === coachBoundary.authRequestId,
      );
      if (!coachIdentity) throw new Error('Android auth-account native coach identity is missing');
      const afterLoginCheckpoint = await captureAuthSessionCheckpoint('after-login');
      authConnectionAfterLogin = afterLoginCheckpoint.profile;
      authDomainAfterLogin = afterLoginCheckpoint.domain;
      (report.androidSessionConnectionSnapshots as Record<string, unknown>).afterLogin = {
        runId: authConnectionAfterLogin.runId,
        scope: authConnectionAfterLogin.scope,
        rowCounts: authConnectionAfterLogin.rowCounts,
        profilesSha256: createHash('sha256')
          .update(JSON.stringify(authConnectionAfterLogin.rows.userProfiles))
          .digest('hex'),
        connectionsSha256: createHash('sha256')
          .update(JSON.stringify(authConnectionAfterLogin.rows.connections))
          .digest('hex'),
      };
      const beforeRelaunch = await captureAndroidSessionStorage('auth-before-relaunch');
      report.androidSessionLoginCheckpoint = requireAndroidPersistedLoginCheckpoint({
        beforeRelaunch,
        signInBoundary: coachBoundary,
        actorIdentity: {
          actor: 'coach',
          actorAuthUid: coachAuthUid,
          authRequestId: coachBoundary.authRequestId,
          afterRequestId: coachBoundary.afterRequestId,
          apiPid: afterLoginCheckpoint.apiLifetime.apiPid,
          targetOrigin: afterLoginCheckpoint.apiLifetime.apiOrigin,
          fixtureAuthUidAllowlistHash: coachIdentity.fixtureAuthUidAllowlistHash,
        },
        apiIdentity: authApiIdentity,
        expectedRunId: ownedSession.manifest.runId,
        backendProvenance: authBackendProvenance,
      });
      const afterLoginProfileAuthUidHash = (
        report.androidSessionLoginCheckpoint as ReturnType<
          typeof requireAndroidPersistedLoginCheckpoint
        >
      ).persistedProfileAuthUidHash;
      report.androidSessionAuthIdentity = {
        actor: 'coach',
        actorAuthUidHash: createHash('sha256').update(coachAuthUid).digest('hex'),
        authRequestId: coachBoundary.authRequestId,
        afterRequestId: coachBoundary.afterRequestId,
        apiPid: afterLoginCheckpoint.apiLifetime.apiPid,
        targetOrigin: afterLoginCheckpoint.apiLifetime.apiOrigin,
        backendAttemptId: afterLoginCheckpoint.apiLifetime.backendAttemptId,
        fixtureAuthUidAllowlistHash: coachIdentity.fixtureAuthUidAllowlistHash,
      };
      await authenticatedProxy.waitForQuiescence();
      const beforeRestoreApi = await sessionDirectIo('restore-before-api', () =>
        ownedSession.probeApiLifetime(controller.signal),
      );
      const beforeRestoreRequestId = authenticatedProxy.requestIdFence;
      await relaunchAndroidApp('auth-restore');
      await observe('auth-restored-home', '', 'SCR-pro-home', ['pro.home.screen']);
      await authenticatedProxy.waitForQuiescence();
      const afterRestoreApi = await sessionDirectIo('restore-after-api', () =>
        ownedSession.probeApiLifetime(controller.signal),
      );
      const afterRestoreRequestId = authenticatedProxy.requestIdFence;
      const restoreApiLifetime = requireAndroidOwnedApiLifetimeBinding({
        before: {
          ...beforeRestoreApi,
          proxyRunId: authenticatedProxy.runId,
          proxyOrigin: authenticatedProxy.origin,
        },
        after: {
          ...afterRestoreApi,
          proxyRunId: authenticatedProxy.runId,
          proxyOrigin: authenticatedProxy.origin,
        },
        expectedRunId: ownedSession.manifest.runId,
        expectedProxyRunId: authenticatedProxy.runId,
        expectedProxyOrigin: authenticatedProxy.origin,
      });
      const restoreTransport = requireAndroidSessionTransportSlice({
        observations: authenticatedProxy.observations,
        beforeRequestId: beforeRestoreRequestId,
        afterRequestId: afterRestoreRequestId,
        phase: 'restore',
        targetOrigin: authApiIdentity.targetOrigin,
        apiLifetime: restoreApiLifetime,
        expectedRunId: ownedSession.manifest.runId,
        expectedProxyRunId: authenticatedProxy.runId,
        expectedProxyOrigin: authenticatedProxy.origin,
      });
      report.androidSessionRestoreTransport = restoreTransport;
      const afterRestorationCheckpoint = await captureAuthSessionCheckpoint('after-restoration');
      authConnectionAfterRestore = afterRestorationCheckpoint.profile;
      authDomainAfterRestore = afterRestorationCheckpoint.domain;
      (report.androidSessionConnectionSnapshots as Record<string, unknown>).afterRestoration = {
        runId: authConnectionAfterRestore.runId,
        scope: authConnectionAfterRestore.scope,
        rowCounts: authConnectionAfterRestore.rowCounts,
        profilesSha256: createHash('sha256')
          .update(JSON.stringify(authConnectionAfterRestore.rows.userProfiles))
          .digest('hex'),
        connectionsSha256: createHash('sha256')
          .update(JSON.stringify(authConnectionAfterRestore.rows.connections))
          .digest('hex'),
      };
      const afterRestore = await captureAndroidSessionStorage('auth-after-restore');
      const afterRestorationProfileAuthUidHash = requireAndroidPersistedProfileIdentityHash({
        observation: afterRestore,
        expectedAuthUid: coachAuthUid,
      });
      report.androidSessionProfileCache = {
        afterLoginAuthUidHash: afterLoginProfileAuthUidHash,
        afterRestorationAuthUidHash: afterRestorationProfileAuthUidHash,
      };
      const sessionActions = buildAndroidSessionActionPlans();
      const sessionRelaunchWindows: { afterRequestId: number; throughRequestId: number }[] = [];
      // The after-restore storage snapshot force-stopped the app; relaunch it
      // (state preserved) before the next UI action, per the snapshot contract.
      // A signed-in relaunch hydrates once, so its request span is declared.
      const beforeAccountRelaunchRequestId = authenticatedProxy.requestIdFence;
      await relaunchAndroidApp('auth-account-relaunch');
      await observe('auth-account', sessionActions.account, 'SCR-account', [
        'settings.account.screen',
      ]);
      await authenticatedProxy.waitForQuiescence();
      sessionRelaunchWindows.push({
        afterRequestId: beforeAccountRelaunchRequestId,
        throughRequestId: authenticatedProxy.requestIdFence,
      });
      await observe(
        'auth-account-identity',
        '',
        'SCR-account',
        [fixtures.accounts.coach.email],
        'text',
      );
      await observe('auth-signout-open', sessionActions.openConfirm, 'STATE-signout-confirm', [
        'settings.account.signOutConfirm',
        'settings.account.signOutCancelCta',
        'settings.account.signOutConfirmCta',
      ]);
      await observe('auth-signout-cancelled', sessionActions.cancel, 'SCR-account', [
        'settings.account.screen',
        'settings.account.signOutCta',
      ]);
      const cancelledTree = observedTrees.get('auth-signout-cancelled');
      const cancelledFrames = observedFrameReceipts.get('auth-signout-cancelled');
      const cancelledCommand = [...commandExecutions]
        .reverse()
        .find((execution) => execution.label === 'auth-signout-cancelled-readiness');
      if (!cancelledFrames)
        throw new Error('Android cancelled sign-out hierarchy and screenshot receipts are missing');
      const cancelledConfirmationEvidence = requireAndroidCancelledConfirmationAbsent({
        hierarchyObserved: cancelledTree !== undefined,
        hierarchyPath: 'auth-signout-cancelled-hierarchy.json',
        screenshotPath: 'auth-signout-cancelled.png',
        hierarchySourcePath: cancelledFrames.hierarchySource.path,
        hierarchySourceReceipt: cancelledFrames.hierarchySource,
        hierarchyReceipt: cancelledFrames.hierarchy,
        screenshotReceipt: cancelledFrames.screenshot,
        modalPresent:
          nativeHierarchyHasAttribute(
            cancelledTree,
            'resource-id',
            'settings.account.signOutConfirm',
          ) ||
          nativeHierarchyHasAttribute(
            cancelledTree,
            'resource-id',
            `${verified.appId}:id/settings.account.signOutConfirm`,
          ),
        confirmCtaPresent:
          nativeHierarchyHasAttribute(
            cancelledTree,
            'resource-id',
            'settings.account.signOutConfirmCta',
          ) ||
          nativeHierarchyHasAttribute(
            cancelledTree,
            'resource-id',
            `${verified.appId}:id/settings.account.signOutConfirmCta`,
          ),
        commandExecution: cancelledCommand,
      });
      const afterCancel = await captureAndroidSessionStorage('auth-after-cancel');
      androidSessionAfterCancel = requireAndroidRetainedNativeSessionIdentity({
        before: afterRestore,
        after: afterCancel,
        expectedAuthUidHash: afterRestorationProfileAuthUidHash,
      });
      report.androidSessionCancelStorage = afterCancel;
      report.androidSessionCancelIdentity = androidSessionAfterCancel;
      // The after-cancel snapshot force-stopped the app: relaunch and return to
      // Account before reopening the sign-out confirmation.
      const beforeReopenRelaunchRequestId = authenticatedProxy.requestIdFence;
      await relaunchAndroidApp('auth-signout-reopen-relaunch');
      await observe(
        'auth-signout-reopen',
        `${sessionActions.account}${sessionActions.reopenConfirm}`,
        'STATE-signout-confirm',
        ['settings.account.signOutConfirm'],
      );
      await authenticatedProxy.waitForQuiescence();
      sessionRelaunchWindows.push({
        afterRequestId: beforeReopenRelaunchRequestId,
        throughRequestId: authenticatedProxy.requestIdFence,
      });
      await observe('auth-signed-out', sessionActions.confirm, 'SCR-sign-in', [
        'auth.signIn.emailInput',
        'auth.signIn.passwordInput',
        'auth.signIn.submitButton',
      ]);
      const afterSignOut = await captureAndroidSessionStorage('auth-after-signout');
      await authenticatedProxy.waitForQuiescence();
      const beforeSignedOutRelaunchApi = await sessionDirectIo('signed-out-before-api', () =>
        ownedSession.probeApiLifetime(controller.signal),
      );
      const beforeSignedOutRelaunchRequestId = authenticatedProxy.requestIdFence;
      await relaunchAndroidApp('auth-signed-out-relaunch');
      await observe('auth-signed-out-relaunch', '', 'SCR-sign-in', [
        'auth.signIn.emailInput',
        'auth.signIn.passwordInput',
        'auth.signIn.submitButton',
      ]);
      await authenticatedProxy.waitForQuiescence();
      const afterSignedOutRelaunchApi = await sessionDirectIo('signed-out-after-api', () =>
        ownedSession.probeApiLifetime(controller.signal),
      );
      const afterSignedOutRelaunchRequestId = authenticatedProxy.requestIdFence;
      const signedOutApiLifetime = requireAndroidOwnedApiLifetimeBinding({
        before: {
          ...beforeSignedOutRelaunchApi,
          proxyRunId: authenticatedProxy.runId,
          proxyOrigin: authenticatedProxy.origin,
        },
        after: {
          ...afterSignedOutRelaunchApi,
          proxyRunId: authenticatedProxy.runId,
          proxyOrigin: authenticatedProxy.origin,
        },
        expectedRunId: ownedSession.manifest.runId,
        expectedProxyRunId: authenticatedProxy.runId,
        expectedProxyOrigin: authenticatedProxy.origin,
      });
      await authenticatedProxy.stop();
      const signedOutThroughRequestId = authenticatedProxy.requestIdFence;
      if (signedOutThroughRequestId !== afterSignedOutRelaunchRequestId)
        throw new Error('Android signed-out transport changed after proxy drain');
      const signedOutRows = requireSignedOutSessionTransport({
        observations: authenticatedProxy.observations,
        window: {
          afterRequestId: beforeSignedOutRelaunchRequestId,
          throughRequestId: signedOutThroughRequestId,
        },
        expectedTargetOrigin: authApiIdentity.targetOrigin,
      });
      report.androidSessionSignedOutTransport = {
        status: 'verified',
        phase: 'signed-out-relaunch',
        beforeRequestId: beforeSignedOutRelaunchRequestId,
        afterRequestId: signedOutThroughRequestId,
        rows: signedOutRows,
        apiLifetime: signedOutApiLifetime,
      };
      const afterSignedOutRelaunch = await captureAndroidSessionStorage(
        'auth-after-signed-out-relaunch',
      );
      const afterSignedOutCheckpoint = await captureAuthSessionCheckpoint(
        'after-signed-out-relaunch',
      );
      authDomainAfterSignedOutRelaunch = afterSignedOutCheckpoint.domain;
      authConnectionAfterSignedOutRelaunch = afterSignedOutCheckpoint.profile;
      if (
        !authConnectionBefore ||
        !authDomainBefore ||
        !authConnectionAfterLogin ||
        !authDomainAfterLogin ||
        !authConnectionAfterRestore ||
        !authDomainAfterRestore ||
        !authConnectionAfterSignedOutRelaunch ||
        !authDomainAfterSignedOutRelaunch ||
        !authSessionCheckpointReceipts['before-login'] ||
        !authSessionCheckpointReceipts['after-login'] ||
        !authSessionCheckpointReceipts['after-restoration']
      )
        throw new Error('Android session checkpoint values are incomplete before re-read');
      await rereadAndroidSessionCheckpoint('before-login', {
        profile: authConnectionBefore,
        domain: authDomainBefore,
        receipt: authSessionCheckpointReceipts['before-login'],
      });
      await rereadAndroidSessionCheckpoint('after-login', {
        profile: authConnectionAfterLogin,
        domain: authDomainAfterLogin,
        receipt: authSessionCheckpointReceipts['after-login'],
      });
      await rereadAndroidSessionCheckpoint('after-restoration', {
        profile: authConnectionAfterRestore,
        domain: authDomainAfterRestore,
        receipt: authSessionCheckpointReceipts['after-restoration'],
      });
      await rereadAndroidSessionCheckpoint('after-signed-out-relaunch', {
        profile: authConnectionAfterSignedOutRelaunch,
        domain: authDomainAfterSignedOutRelaunch,
        receipt: authSessionCheckpointReceipts['after-signed-out-relaunch']!,
      });
      report.androidSessionCheckpointArtifactsReread = {
        status: 'verified',
        count: 8,
      };
      (report.androidSessionConnectionSnapshots as Record<string, unknown>).afterSignedOutRelaunch =
        {
          runId: authConnectionAfterSignedOutRelaunch.runId,
          scope: authConnectionAfterSignedOutRelaunch.scope,
          rowCounts: authConnectionAfterSignedOutRelaunch.rowCounts,
          profilesSha256: createHash('sha256')
            .update(JSON.stringify(authConnectionAfterSignedOutRelaunch.rows.userProfiles))
            .digest('hex'),
          connectionsSha256: createHash('sha256')
            .update(JSON.stringify(authConnectionAfterSignedOutRelaunch.rows.connections))
            .digest('hex'),
        };
      authDomainAfter = authDomainAfterSignedOutRelaunch;
      if (!authDomainBefore) throw new Error('Android auth-account before snapshot is missing');
      if (
        !authConnectionBefore ||
        !authConnectionAfterLogin ||
        !authConnectionAfterRestore ||
        !authConnectionAfterSignedOutRelaunch ||
        !authDomainAfterLogin ||
        !authDomainAfterRestore ||
        !authDomainAfterSignedOutRelaunch ||
        !coachIdentity
      )
        throw new Error('Android auth-account connection snapshots are incomplete');
      const checkpointBackendProvenance = authBackendProvenance;
      if (!checkpointBackendProvenance)
        throw new Error('Android session backend provenance is missing before checkpoint copy');
      const beforeCheckpointReceipt = authSessionCheckpointReceipts['before-login'];
      if (!beforeCheckpointReceipt)
        throw new Error(
          'Android before-login checkpoint receipt is missing before checkpoint copy',
        );
      const sessionCheckpointSet = requireAndroidSessionCheckpointSet({
        checkpoints: [
          authSessionCheckpointReceipts['before-login'],
          authSessionCheckpointReceipts['after-login'],
          authSessionCheckpointReceipts['after-restoration'],
          authSessionCheckpointReceipts['after-signed-out-relaunch']!,
        ],
        expectedRunId: ownedSession.manifest.runId,
        expectedScope: 'native-entry-android',
        expectedApiOrigin: authApiIdentity.targetOrigin,
        expectedApiPid: authApiIdentity.apiPid,
        expectedBackendAttemptId: checkpointBackendProvenance.backendAttemptId,
        expectedManifestSha256: beforeCheckpointReceipt.manifestSha256,
        expectedFixtureAuthUidAllowlistHash: fixtureAuthUidAllowlistHash,
      });
      report.androidSessionCheckpointReceipts = sessionCheckpointSet;
      report.androidSessionCheckpointArtifacts = await sessionDirectIo(
        'android-session-checkpoint-copy',
        () =>
          persistAndroidSessionCheckpointArtifacts({
            outputRoot: output,
            sourceRoot: ownedSession.manifest.artifactRoot,
            checkpoints: sessionCheckpointSet,
            expectedRunId: ownedSession.manifest.runId,
            expectedScope: 'native-entry-android',
            expectedApiOrigin: authApiIdentity.targetOrigin,
            expectedApiPid: authApiIdentity.apiPid,
            expectedBackendAttemptId: checkpointBackendProvenance.backendAttemptId,
            expectedManifestSha256: beforeCheckpointReceipt.manifestSha256,
            expectedFixtureAuthUidAllowlistHash: fixtureAuthUidAllowlistHash,
            expectedApiStarted: checkpointBackendProvenance.apiProcess.started,
            expectedApiScript: checkpointBackendProvenance.apiProcess.script,
            probeApiLifetime: () => ownedSession.probeApiLifetime(controller.signal),
            signal: controller.signal,
          }),
      );
      if (isSessionCharter) {
        const receiptHash = (value: unknown) =>
          createHash('sha256').update(JSON.stringify(value)).digest('hex');
        const commandHashes = requireAndroidMaestroCommandHashes(output, report);
        const commandHashesFor = (assertionIndex: number): string[] =>
          androidSessionPublicCommandLabelsByAssertion[assertionIndex].flatMap((label) => {
            const hashes = commandHashes.get(label);
            if (!hashes) throw new Error(`Android command hashes are missing: ${label}`);
            return [...hashes];
          });
        const assertions: AndroidSessionAssertionReceipt[] = [
          {
            id: androidSessionAssertionSequence[0],
            order: 1,
            status: 'verified',
            phase: 'before-login',
            sourceReceiptHashes: [
              sessionCheckpointSet[0].profile.sha256,
              sessionCheckpointSet[0].domain.sha256,
              ...commandHashesFor(0),
            ],
          },
          {
            id: androidSessionAssertionSequence[1],
            order: 2,
            status: 'verified',
            phase: 'coach-sign-in',
            sourceReceiptHashes: [
              receiptHash({
                requestId: coachBoundary.authRequestId,
                status: coachIdentity.status,
                targetOrigin: coachIdentity.targetOrigin,
                runId: ownedSession.manifest.runId,
                fixtureAuthUidAllowlistHash,
              }),
              ...commandHashesFor(1),
            ],
          },
          {
            id: androidSessionAssertionSequence[2],
            order: 3,
            status: 'verified',
            phase: 'after-login-persisted-cache',
            sourceReceiptHashes: [
              sessionCheckpointSet[1].profile.sha256,
              sessionCheckpointSet[1].domain.sha256,
              beforeRelaunch.privateArtifacts.database.sha256,
              beforeRelaunch.privateArtifacts.query.sha256,
              beforeRelaunch.privateArtifacts.querySource.sha256,
              ...commandHashesFor(2),
            ],
          },
          {
            id: androidSessionAssertionSequence[3],
            order: 4,
            status: 'verified',
            phase: 'after-restoration',
            sourceReceiptHashes: [
              receiptHash(restoreTransport),
              sessionCheckpointSet[2].profile.sha256,
              sessionCheckpointSet[2].domain.sha256,
              afterRestore.privateArtifacts.database.sha256,
              afterRestore.privateArtifacts.query.sha256,
              afterRestore.privateArtifacts.querySource.sha256,
              ...commandHashesFor(3),
            ],
          },
          {
            id: androidSessionAssertionSequence[4],
            order: 5,
            status: 'verified',
            phase: 'cancelled-sign-out',
            sourceReceiptHashes: [
              receiptHash(cancelledConfirmationEvidence),
              cancelledFrames.hierarchySource.sha256,
              cancelledFrames.hierarchy.sha256,
              cancelledFrames.screenshot.sha256,
              afterCancel.privateArtifacts.database.sha256,
              afterCancel.privateArtifacts.query.sha256,
              afterCancel.privateArtifacts.querySource.sha256,
              receiptHash(androidSessionAfterCancel),
              ...commandHashesFor(4),
            ],
          },
          {
            id: androidSessionAssertionSequence[5],
            order: 6,
            status: 'verified',
            phase: 'signed-out-relaunch',
            sourceReceiptHashes: [
              receiptHash(report.androidSessionSignedOutTransport),
              sessionCheckpointSet[3].profile.sha256,
              sessionCheckpointSet[3].domain.sha256,
              afterSignedOutRelaunch.privateArtifacts.database.sha256,
              afterSignedOutRelaunch.privateArtifacts.query.sha256,
              afterSignedOutRelaunch.privateArtifacts.querySource.sha256,
              ...commandHashesFor(5),
            ],
          },
        ];
        authSessionCharterResult = requireAndroidSessionCharter({
          assertionReceipts: assertions,
          restorationCount: 1,
        });
        report.androidSessionCharter = authSessionCharterResult;
      } else {
        report.androidSessionLegacyDiagnostic = {
          status: 'observed',
          charter: 'auth-account',
          source: 'legacy-auth-account-diagnostic-preserved',
          sessionCheckpointReceipts: sessionCheckpointSet,
        };
      }
      report.androidSessionRelaunchWindows = sessionRelaunchWindows;
      try {
        report.androidSessionProfileCheckpoint = verifyNativeSessionProfileCheckpoints({
          platform: 'android',
          backendRunId: ownedSession.manifest.runId,
          fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
          coachAuthUid,
          studentAuthUid: fixtures.accounts.student.authUid,
          expectedApiIdentity: authApiIdentity,
          profiles: {
            beforeLogin: authConnectionBefore,
            afterLogin: authConnectionAfterLogin,
            afterRestoration: authConnectionAfterRestore,
            afterSignedOutRelaunch: authConnectionAfterSignedOutRelaunch,
          },
          domain: {
            beforeLogin: authDomainBefore,
            afterLogin: authDomainAfterLogin,
            afterRestoration: authDomainAfterRestore,
            afterSignedOutRelaunch: authDomainAfterSignedOutRelaunch,
          },
          observations: authenticatedProxy.observations,
          authIdentities: authenticatedProxy.nativeAuthIdentities,
          loginWindow: {
            afterRequestId: 0,
            throughRequestId: coachBoundary.afterRequestId,
          },
          restorationWindow: {
            afterRequestId: beforeRestoreRequestId,
            throughRequestId: afterRestoreRequestId,
          },
          relaunchWindows: sessionRelaunchWindows,
          persistedCoachIdentity: {
            afterLoginAuthUidHash: afterLoginProfileAuthUidHash,
            afterRestorationAuthUidHash: afterRestorationProfileAuthUidHash,
          },
        });
      } catch (error) {
        report.androidSessionProfileCheckpoint = {
          status: 'blocked',
          reason: 'native-session-profile-checkpoint-verification-failed',
          error:
            error instanceof Error
              ? {
                  name: error.name.slice(0, 128),
                  message: error.message.slice(0, 512),
                }
              : {
                  name: 'UnknownError',
                  message: 'Android session profile verification failed',
                },
        };
        throw error;
      }
      report.androidSessionDomain = requireAndroidSessionDomainBinding({
        before: authDomainBefore,
        after: authDomainAfter,
        beforeStorage: beforeRelaunch,
        afterStorage: afterSignedOutRelaunch,
      });
      report.nativeSessionContract = {
        requirementRefs: ['FR-270', 'BR-342', 'SC-217', 'SC-213', 'TC-296'],
        scope: 'local-native-session-clear; server revocation is not qualified',
        ...requireAndroidLocalSessionClear({
          beforeRelaunch,
          afterRestore,
          afterSignOut,
          afterSignedOutRelaunch,
          cancelledSessionIdentity: androidSessionAfterCancel,
          cancelledConfirmationEvidence,
        }),
      };
    }
    if (isCameraCharter) {
      const authenticatedProxy = proxy;
      if (!authenticatedProxy || !authApiIdentity)
        throw new Error('Android camera API identity is unavailable after coach sign-in');
      requireAndroidConnectionAuthIdentityCapture(authenticatedProxy);
      const coachBoundary = requireAndroidConnectionSignInBoundary(
        authenticatedProxy.observations,
        authenticatedProxy.nativeAuthIdentities,
        { beforeRequestId: 0, apiIdentity: authApiIdentity },
      );
      const coachAuthUid = requireAndroidConnectionActorIdentity(
        authenticatedProxy.nativeAuthIdentities,
        {
          actorAuthUid: fixtures.accounts.coach.authUid,
          authRequestId: coachBoundary.authRequestId,
          apiIdentity: authApiIdentity,
          fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
        },
      );
      report.androidCameraInitialAuth = {
        actor: 'coach',
        actorAuthUid: coachAuthUid,
        ...coachBoundary,
      };
    }
    if (options.executeTraining) {
      await options.executeTraining({
        output,
        fixtures,
        proxy,
        signal: controller.signal,
        observe,
        readAndroidTitle: createOwnedAndroidInputReader({
          repositoryRoot: root,
          artifactRoot: output,
          sdkRoot,
          javaHome,
          env: nativeEnv,
          signal: controller.signal,
          run,
          adb,
        }),
        snapshot: () => session!.snapshot('native-entry-android'),
        restartRuntime: async () => {
          await adb('android-journey-force-stop', ['shell', 'am', 'force-stop', verified.appId]);
          controller.signal.throwIfAborted();
          await target!.verify();
          await proxy!.restartApi();
          controller.signal.throwIfAborted();
          await adb('android-journey-relaunch', [
            'shell',
            'am',
            'start',
            '-W',
            '-n',
            `${verified.appId}/${verified.launcher}`,
          ]);
        },
      });
    }
    if (options.executeSaveRetry) {
      await options.executeSaveRetry({
        output,
        fixtures,
        proxy,
        signal: controller.signal,
        observe,
        snapshot: () => session!.snapshot('native-entry-android'),
        accountUid: fixtures.accounts.coach.authUid,
        report,
      });
    }
    if (isCameraCharter) {
      const selection = options.selection;
      const expectedLocale = options.expectedLocale;
      if (!selection || !expectedLocale || !localeExpectedBindingInputs)
        throw new Error('Android camera selection, locale and binding inputs are required');
      if (!target || !verified || !proxy || !session)
        throw new Error('Android camera owned runtime is unavailable');
      if (selection.arguments.scenario !== 'SCN-camera-denied-android')
        throw new Error('Android camera selection scenario is not the declared camera scenario');

      // Camera starts from the already-owned coach sign-in above. Keep the
      // account switch inside the one capture owner so the producer never
      // acquires a second session or writes an unbound credential flow.
      const cameraStudentPreparation = async () => {
        const tap = (id: string) => `- tapOn:\n    id: ${JSON.stringify(id)}\n`;
        const scroll = (id: string) =>
          `- scrollUntilVisible:\n    element:\n      id: ${JSON.stringify(id)}\n    direction: DOWN\n    timeout: 30000\n    centerElement: true\n`;
        const beforeRequestId = proxy!.requestIdFence;
        await observe(
          'camera-student-home',
          tap('tabs.account') +
            scroll('settings.account.signOutCta') +
            tap('settings.account.signOutCta') +
            scroll('settings.account.signOutConfirmCta') +
            tap('settings.account.signOutConfirmCta') +
            tap('auth.signIn.emailInput') +
            `- inputText: ${JSON.stringify(fixtures.accounts.student.email)}\n` +
            tap('auth.signIn.passwordInput') +
            `- inputText: ${JSON.stringify(fixtures.accounts.student.password)}\n` +
            '- hideKeyboard\n' +
            tap('auth.signIn.submitButton'),
          'SCR-student-home',
          ['student.home.screen'],
        );
        await proxy!.waitForQuiescence();
        const signInPathHash = createHash('sha256').update('/auth/email/sign-in').digest('hex');
        const rows = proxy!.observations.filter(
          (row) => row.requestId > beforeRequestId && row.pathHash === signInPathHash,
        );
        if (
          rows.length !== 1 ||
          rows[0].method !== 'POST' ||
          rows[0].status !== 201 ||
          rows[0].outcome !== 'forwarded' ||
          rows[0].requestProfile !== 'native' ||
          rows[0].requestOrigin !== null ||
          rows[0].targetOrigin !== ownedSession.apiOrigin
        )
          throw new Error('Android camera student sign-in is not exactly one owned POST 201');
        const studentBoundary = requireAndroidConnectionSignInBoundary(
          proxy!.observations,
          proxy!.nativeAuthIdentities,
          {
            beforeRequestId,
            apiIdentity: {
              apiPid: ownedSession.apiPid,
              targetOrigin: ownedSession.apiOrigin,
            },
          },
        );
        const studentAuthUid = requireAndroidConnectionActorIdentity(proxy!.nativeAuthIdentities, {
          actorAuthUid: fixtures.accounts.student.authUid,
          authRequestId: studentBoundary.authRequestId,
          apiIdentity: {
            apiPid: ownedSession.apiPid,
            targetOrigin: ownedSession.apiOrigin,
          },
          fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
        });
        report.androidCameraStudentAuth = {
          actor: 'student',
          actorAuthUid: studentAuthUid,
          ...studentBoundary,
        };
      };

      const frameDescriptors = new Map<
        'entry' | 'prompt' | 'denied' | 'manual' | 'pending',
        {
          source: AndroidCameraFrameSource;
          tree: unknown;
        }
      >();
      let cameraObservationOrdinal = 0;
      const cameraObserve: NativeTrainingObserve = async (
        label,
        actions,
        viewId,
        selectors,
        kind = 'id',
      ) => {
        const frameLabel = label as 'entry' | 'prompt' | 'denied' | 'manual' | 'pending';
        if (!['entry', 'prompt', 'denied', 'manual', 'pending'].includes(frameLabel))
          throw new Error(`Android camera callback emitted an unknown frame label: ${label}`);
        // The outer capture already owns an `entry` inventory frame. Camera
        // frames use a distinct physical prefix so the callback cannot
        // overwrite that file or reuse its command label after the student
        // actor switch. The logical label remains the five-purpose camera
        // contract key in the descriptor.
        const physicalLabel = `camera-${frameLabel}`;
        await observe(physicalLabel, actions, viewId, selectors, kind);
        const receipts = observedFrameReceipts.get(physicalLabel);
        const execution = commandExecutions.find(
          (row) => row.label === `${physicalLabel}-hierarchy`,
        );
        const argv = commandArgvByLabel.get(`${physicalLabel}-hierarchy`);
        const tree = observedTrees.get(physicalLabel);
        if (!receipts || !execution || !argv || tree === undefined)
          throw new Error(`Android camera descriptor is missing after ${frameLabel} observation`);
        const commandOrdinal = commandExecutions.indexOf(execution);
        if (commandOrdinal < 0)
          throw new Error(
            `Android camera descriptor command is not in the owned ledger: ${frameLabel}`,
          );
        const ordinal = ++cameraObservationOrdinal;
        const selectorValues =
          frameLabel === 'prompt'
            ? [
                ...(observedAndroidCameraPromptSelectors.get(physicalLabel) ??
                  (() => {
                    throw new Error('Android camera prompt concrete selectors are missing');
                  })()),
              ]
            : typeof selectors === 'string'
              ? [selectors]
              : [...selectors];
        frameDescriptors.set(frameLabel, {
          source: {
            label: frameLabel,
            captureRunId,
            ownerRunId: target!.runId,
            serial: target!.identity.serial,
            appId: verified!.appId,
            attemptId: `${ownedSession.manifest.runId}:first`,
            command: buildAndroidCameraCommandReceipt({
              label: `${physicalLabel}-hierarchy`,
              captureRunId,
              ownerRunId: target!.runId,
              serial: target!.identity.serial,
              appId: verified!.appId,
              attemptId: `${ownedSession.manifest.runId}:first`,
              argv,
              execution,
              stdout: null,
            }),
            receipt: receipts.hierarchySource,
            action: {
              invocationId: `${captureRunId}:camera:${ordinal}`,
              ordinal,
              label: frameLabel,
              actionsSha256: createHash('sha256').update(actions).digest('hex'),
              viewId,
              selectorKind: kind,
              selectors: selectorValues,
              commandLabel: `${physicalLabel}-hierarchy`,
              commandOrdinal,
            },
          },
          tree,
        });
      };

      const commandReceipt = async (
        label: string,
        argv: readonly string[],
        stdoutPath?: string,
      ): Promise<AndroidCameraCommandReceipt> => {
        const commandOutput = await adb(label, argv, undefined, stdoutPath);
        const execution = commandExecutions.find((row) => row.label === label);
        if (!execution) throw new Error(`Android camera command record is missing: ${label}`);
        let stdout: AndroidStorageFileReceipt | null = null;
        if (stdoutPath) {
          stdout = (
            await readOwnedAndroidStableFile({
              artifactRoot: output,
              filePath: commandOutput,
              kind: 'sidecar',
              maxBytes: 1024 * 1024,
              signal: controller.signal,
            })
          ).receipt;
        }
        return buildAndroidCameraCommandReceipt({
          label,
          captureRunId,
          ownerRunId: target!.runId,
          serial: target!.identity.serial,
          appId: verified!.appId,
          attemptId: `${ownedSession.manifest.runId}:first`,
          argv,
          execution,
          stdout,
        });
      };
      const permissionCommands = buildAndroidCameraPermissionCommands(verified.appId);
      const cameraCommands = {
        run: (label: string, argv: readonly string[]) => commandReceipt(label, argv),
        check: async (
          label: string,
          argv: readonly string[],
        ): Promise<AndroidCameraPermissionCheck> => {
          const stdoutPath = path.join(output, `${label}.stdout`);
          const receipt = await commandReceipt(label, argv, stdoutPath);
          const flagsLabel = `${label}-flags`;
          const flagsPath = path.join(output, `${flagsLabel}.stdout`);
          const flagsReceipt = await commandReceipt(
            flagsLabel,
            permissionCommands.checkFlags,
            flagsPath,
          );
          const status = parseAndroidCameraPermissionStatus(
            (
              await readOwnedAndroidStableFile({
                artifactRoot: output,
                filePath: stdoutPath,
                kind: 'sidecar',
                maxBytes: 1024 * 1024,
                signal: controller.signal,
              })
            ).bytes.toString('utf8'),
            verified!.appId,
          );
          const decisionFlags = parseAndroidCameraPermissionFlags(
            (
              await readOwnedAndroidStableFile({
                artifactRoot: output,
                filePath: flagsPath,
                kind: 'sidecar',
                maxBytes: 1024 * 1024,
                signal: controller.signal,
              })
            ).bytes.toString('utf8'),
            verified!.appId,
          );
          return {
            ...receipt,
            state: { status, decisionFlags },
            flagsCommand: flagsReceipt,
          };
        },
        readLocaleProperty: (property: string) =>
          readAndroidLocaleProperty(property, 'camera-student'),
      };
      const beforeEvidence = await ownedSession.connectionSnapshotWithEvidence(
        'native-entry-android',
        controller.signal,
      );
      const expected: ConnectionSnapshotExpectedIdentity = {
        runId: ownedSession.manifest.runId,
        scope: 'native-entry-android',
        fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
        target: {
          professionalAuthUid: fixtures.accounts.coach.authUid,
          studentAuthUid: fixtures.accounts.student.authUid,
          specialty: 'fitness_coach',
        },
      };
      const before = requireConnectionSnapshot(beforeEvidence.value, expected);
      if (!connectionIsolationFixtures || !connectionIsolationFixtureBinding)
        throw new Error('Android camera isolation fixture binding is unavailable');
      const isolationExpected: ConnectionSnapshotExpectedIdentity = {
        runId: connectionIsolationFixtures.runId,
        scope: connectionIsolationFixtures.scope,
        fixtureAuthUids: Object.values(connectionIsolationFixtures.accounts).map(
          (account) => account.authUid,
        ),
        target: {
          professionalAuthUid: connectionIsolationFixtures.accounts.coach.authUid,
          studentAuthUid: connectionIsolationFixtures.accounts.student.authUid,
          specialty: 'fitness_coach',
        },
      };
      assert.deepEqual(
        isolationExpected.fixtureAuthUids?.slice().sort(),
        connectionIsolationFixtureBinding.fixtureAuthUids.slice().sort(),
      );
      assert.equal(isolationExpected.runId, connectionIsolationFixtureBinding.runId);
      assert.equal(isolationExpected.scope, connectionIsolationFixtureBinding.scope);
      assert.equal(
        isolationExpected.target?.professionalAuthUid,
        connectionIsolationFixtureBinding.target.professionalAuthUid,
      );
      assert.equal(
        isolationExpected.target?.studentAuthUid,
        connectionIsolationFixtureBinding.target.studentAuthUid,
      );
      const isolationBeforeEvidence = await ownedSession.connectionSnapshotWithEvidence(
        'native-conn-isolation-android',
        controller.signal,
      );
      const isolation = requireConnectionSnapshot(isolationBeforeEvidence.value, isolationExpected);
      const trainingBeforeEvidence = await ownedSession.snapshotWithEvidence(
        'native-entry-android',
        controller.signal,
      );
      const trainingBefore = trainingBeforeEvidence.value;
      const expectedBinding = buildNativeLocaleBinding({
        captureRunId,
        sourceTreeHash: localeExpectedBindingInputs.sourceTreeHash,
        helperInputs: localeExpectedBindingInputs.helperInputs,
        target: localeExpectedBindingInputs.target,
      });
      const cameraTarget: NativePilotTarget = {
        deviceId: target.identity.serial,
        osVersion: target.osVersion,
        appId: verified.appId,
        buildProfile: 'dev-debug-arm64',
        binaryHash: verified.binaryHash,
        apiOrigin: proxy.origin,
      };
      const cameraBoundary: AndroidCameraCaptureBoundary = {
        output,
        fixtures,
        selection,
        selectionHash: androidCameraSelectionHash(selection),
        captureRunId,
        ownerRunId: target.runId,
        backendRunId: ownedSession.manifest.runId,
        backendAttemptId: `${ownedSession.manifest.runId}:first`,
        target: cameraTarget,
        serial: target.identity.serial,
        appId: verified.appId,
        expectedAppLabel: androidCameraExpectedAppLabel(verified.appId),
        binaryHash: verified.binaryHash,
        buildProfile: 'dev-debug-arm64',
        apiOrigin: ownedSession.apiOrigin,
        apiPid: ownedSession.apiPid,
        apiStarted:
          ownedSession.manifest.processes.find((row) => row.role === 'api')?.started ?? '',
        apiScript: ownedSession.manifest.processes.find((row) => row.role === 'api')?.script ?? '',
        expectedLocale,
        expectedLocaleBinding: expectedBinding,
        localeProperties,
        signal: controller.signal,
        commands: cameraCommands,
        observe: cameraObserve,
        execute: executeActions,
        frameDescriptors,
        savedFlow: savedFlow!,
        setInviteCode: setCameraInviteCode,
        proxy: {
          get observations() {
            return proxy!.observations;
          },
          get requestIdFence() {
            return proxy!.requestIdFence;
          },
          targetOrigin: ownedSession.apiOrigin,
          waitForQuiescence: async () => {
            await proxy!.waitForQuiescence();
          },
          enableNativeRequestBodyCapture: (input) => proxy!.enableNativeRequestBodyCapture(input),
          get nativeRequestBodyCapture() {
            return proxy!.nativeRequestBodyCapture;
          },
        },
        snapshots: {
          before,
          beforeEvidence,
          read: () => ownedSession.connectionSnapshot('native-entry-android', controller.signal),
          readEvidence: () =>
            ownedSession.connectionSnapshotWithEvidence('native-entry-android', controller.signal),
          expected,
          isolationExpected,
          isolationFixture: connectionIsolationFixtureBinding,
          isolationBefore: isolation,
          isolationBeforeEvidence,
          readIsolationAfter: () =>
            ownedSession.connectionSnapshot('native-conn-isolation-android', controller.signal),
          readIsolationAfterEvidence: () =>
            ownedSession.connectionSnapshotWithEvidence(
              'native-conn-isolation-android',
              controller.signal,
            ),
          trainingBefore,
          trainingBeforeEvidence,
          readTrainingAfter: () => ownedSession.snapshot('native-entry-android', controller.signal),
          readTrainingAfterEvidence: () =>
            ownedSession.snapshotWithEvidence('native-entry-android', controller.signal),
          isolationScope: 'native-conn-isolation-android',
          trainingScope: 'native-entry-android',
        },
        probeApiLifetime: (signal) => ownedSession.probeApiLifetime(signal ?? controller.signal),
        readManualCodeReceipt: async () => {
          const coachTree = observedTrees.get('coach-home');
          if (coachTree === undefined)
            throw new Error('Android camera coach hierarchy is unavailable for invite binding');
          const observed = observedFrameReceipts.get('coach-home');
          const execution = commandExecutions.find((row) => row.label === 'coach-home-hierarchy');
          const argv = commandArgvByLabel.get('coach-home-hierarchy');
          if (!observed || !execution || !argv)
            throw new Error('Android camera coach hierarchy ownership receipt is unavailable');
          if (execution.execution !== 'completed' || execution.cleanup !== 'cleaned')
            throw new Error('Android camera coach hierarchy command did not cleanly complete');
          if (execution.pid === null || execution.pgid === null)
            throw new Error('Android camera coach hierarchy process identity is unavailable');
          const source = await readOwnedAndroidStableFile({
            artifactRoot: output,
            filePath: path.join(output, observed.hierarchySource.path),
            kind: 'frame',
            maxBytes: 16 * 1024 * 1024,
            signal: controller.signal,
          });
          if (
            source.receipt.path !== observed.hierarchySource.path ||
            source.receipt.sha256 !== observed.hierarchySource.sha256 ||
            source.receipt.sizeBytes !== observed.hierarchySource.sizeBytes
          )
            throw new Error('Android camera coach hierarchy source changed after observation');
          const code = requirePlatformConnectionInviteCode(
            parseNativeHierarchy(source.bytes.toString('utf8')),
            ANDROID_CONNECTION_PLATFORM,
          );
          return {
            value: code,
            receipt: {
              source: 'owned-android-coach-hierarchy' as const,
              frameLabel: 'coach-home' as const,
              sourcePath: source.receipt.path,
              sourceSha256: source.receipt.sha256,
              sourceSizeBytes: source.receipt.sizeBytes,
              sourceOwnerUid: source.receipt.ownerUid,
              sourceMode: source.receipt.mode,
              sourceVerification: 'owned-stable-reader-v6' as const,
              commandLabel: 'coach-home-hierarchy' as const,
              commandOrdinal: commandExecutions.indexOf(execution),
              commandPid: execution.pid,
              commandPgid: execution.pgid,
              commandExecution: 'completed' as const,
              commandCleanup: 'cleaned' as const,
              commandArgvSha256: createHash('sha256').update(JSON.stringify(argv)).digest('hex'),
              captureRunId,
              ownerRunId: target!.runId,
              actor: 'coach' as const,
              actorAuthUidSha256: createHash('sha256')
                .update(fixtures.accounts.coach.authUid)
                .digest('hex'),
              codeSha256: createHash('sha256').update(code).digest('hex'),
            },
          };
        },
        readSubmissionBinding: async () => {
          await proxy!.waitForQuiescence();
          const captured = proxy!.nativeRequestBodyCapture;
          if (!captured)
            throw new Error('Android camera owned request body receipt is unavailable');
          return readAndroidCameraManualRequestBinding({
            artifactRoot: output,
            capture: captured,
            targetOrigin: ownedSession.apiOrigin,
            apiPid: ownedSession.apiPid,
            sessionRunId: ownedSession.manifest.runId,
            backendAttemptId: `${ownedSession.manifest.runId}:first`,
            signal: controller.signal,
          });
        },
        prepareStudent: cameraStudentPreparation,
      };
      await cameraBoundary.prepareStudent();
      if (!options.executeCamera)
        throw new Error('Android camera callback is unavailable after owned setup');
      // The runner owns the producer callback. This outer capture only
      // supplies the already-owned boundary, so a missing callback cannot be
      // mistaken for a camera pass or a metadata-only result.
      report.androidCameraCallbackInvocations = 1;
      try {
        const producer = await options.executeCamera(cameraBoundary);
        report.androidCameraProducer = {
          producerStatus: producer.producerStatus,
          captureRunId: producer.captureRunId,
          sourceSelectionHash: producer.sourceSelectionHash,
          localeStatus: producer.localeStatus,
          pendingConnectionId: producer.pendingConnectionId,
          submissionRequestId: producer.submissionRequestId,
          manualCodeSha256: producer.manualCodeSha256,
          manualCodeSource: { ...producer.manualCodeSource },
          submission: { ...producer.submission },
          primaryFixtureAuthUids: [...producer.primaryFixtureAuthUids],
          primaryExpected: structuredClone(producer.primaryExpected),
          isolationExpected: structuredClone(producer.isolationExpected),
          isolationFixture: structuredClone(producer.isolationFixture),
          sqlReceiptCount: producer.sqlReceipts.length,
          sqlReceiptPhases: [...new Set(producer.sqlReceipts.map((row) => row.phase))].sort(),
          sqlReceipts: producer.sqlReceipts.map((receipt) => ({ ...receipt })),
          permissionCommandLabels: [...producer.permissionCommandLabels],
          frames: producer.frames.map((frame) => ({ ...frame })),
        };
        report.androidCameraCallbackCompleted = true;
      } catch (error) {
        report.androidCameraCallbackCompleted = false;
        report.androidCameraCallbackFailure =
          error instanceof Error
            ? {
                name: error.name.slice(0, 128),
                message: error.message.slice(0, 512),
              }
            : {
                name: 'UnknownError',
                message: 'Android camera callback failed',
              };
        // Keep the failing frame locations privately; the report keeps name/message.
        await writeFile(
          path.join(output, 'android-camera-callback-failure-stack.private.log'),
          `${error instanceof Error ? (error.stack ?? '').split('\n').slice(0, 12).join('\n') : String(error)}\n`,
          { flag: 'wx', mode: 0o600 },
        ).catch(() => undefined);
        throw error;
      }
    }
    if (charter === 'connection-journey') {
      if (!options.executeConnection)
        throw new Error('Android connection journey requires its owned execution callback');
      const activeProxy = proxy;
      if (!activeProxy || !connectionApiIdentity)
        throw new Error('Android connection journey API identity is unavailable');
      requireAndroidConnectionAuthIdentityCapture(activeProxy);
      let switchOrdinal = 0;
      const tap = (id: string) => `- tapOn:\n    id: ${JSON.stringify(id)}\n`;
      const scroll = (id: string) =>
        `- scrollUntilVisible:\n    element:\n      id: ${JSON.stringify(id)}\n    direction: DOWN\n    timeout: 30000\n    centerElement: true\n`;
      const signOutActions =
        scroll('settings.account.signOutCta') +
        tap('settings.account.signOutCta') +
        scroll('settings.account.signOutConfirmCta') +
        tap('settings.account.signOutConfirmCta');
      const context: AndroidConnectionRuntimeContext = {
        output,
        fixtures,
        proxy: activeProxy,
        apiIdentity: connectionApiIdentity,
        observe,
        report,
        snapshot: () => session!.snapshot('native-entry-android'),
        connectionSnapshot: () => session!.connectionSnapshot('native-entry-android'),
        isolationSnapshot: () => session!.connectionSnapshot(connectionIsolationScope),
        switchAccount: async (actor, navigation = 'none') => {
          const selectedActor = requireAndroidConnectionAccount(actor);
          const prefix = buildAndroidConnectionBackActions(navigation);
          const ordinal = ++switchOrdinal;
          const label = `connection-switch-${ordinal}-${selectedActor}`;
          await observe(
            `${label}-account`,
            `${prefix ? `${prefix}\n` : ''}${tap('tabs.account')}`,
            'SCR-account',
            ['settings.account.screen'],
          );
          await observe(`${label}-signed-out`, signOutActions, 'SCR-sign-in', [
            'auth.signIn.emailInput',
            'auth.signIn.passwordInput',
            'auth.signIn.submitButton',
          ]);
          const beforeRequestId = activeProxy.observations.reduce(
            (maximum, row) => Math.max(maximum, row.requestId),
            0,
          );
          const credentials = fixtures.accounts[selectedActor];
          await observe(
            `${label}-home`,
            tap('auth.signIn.emailInput') +
              '- eraseText: 200\n' +
              `- inputText: ${JSON.stringify(credentials.email)}\n` +
              tap('auth.signIn.passwordInput') +
              '- eraseText: 200\n' +
              `- inputText: ${JSON.stringify(credentials.password)}\n` +
              '- hideKeyboard\n' +
              '- assertVisible:\n    id: auth.signIn.submitButton\n' +
              tap('auth.signIn.submitButton'),
            selectedActor === 'coach' ? 'SCR-pro-home' : 'SCR-student-home',
            selectedActor === 'coach' ? ['pro.home.screen'] : ['student.home.screen'],
          );
          const boundary = requireAndroidConnectionSignInBoundary(
            activeProxy.observations,
            activeProxy.nativeAuthIdentities,
            { beforeRequestId, apiIdentity: connectionApiIdentity },
          );
          const actorAuthUid = requireAndroidConnectionActorIdentity(
            activeProxy.nativeAuthIdentities,
            {
              actorAuthUid: credentials.authUid,
              authRequestId: boundary.authRequestId,
              apiIdentity: connectionApiIdentity,
              fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
            },
          );
          const result: AndroidConnectionAccountSwitchResult = {
            actor: selectedActor,
            beforeRequestId,
            actorAuthUid,
            ...boundary,
          };
          const previous = Array.isArray(report.connectionAccountSwitches)
            ? (report.connectionAccountSwitches as unknown[])
            : [];
          report.connectionAccountSwitches = [...previous, result];
          return result;
        },
      };
      report.nativeLogoutContract = {
        requirementRefs: ['FR-270', 'BR-342'],
        scope: 'local-native-session-clear for Android connection journey account switches',
        serverRevocationQualified: false,
      };
      await options.executeConnection(context);
    }
    if (charter === 'training-load')
      await observeNativeTrainingLoad({
        platform: 'android',
        output,
        savedPlanId: fixtures.savedPlanId,
        accountUid: fixtures.accounts.coach.authUid,
        report,
        snapshot: () => session!.snapshot('native-entry-android'),
        proxy,
        observe,
      });
    if (charter === 'training-draft')
      await observeNativeTrainingDraft({
        platform: 'android',
        output,
        savedPlanId: fixtures.savedPlanId,
        report,
        snapshot: () => session!.snapshot('native-entry-android'),
        observations: () => proxy!.observations,
        observe,
      });
    if (charter === 'connection-states') {
      const tap = (id: string) => `- tapOn:\n    id: ${JSON.stringify(id)}\n`;
      const scroll = (id: string) =>
        `- scrollUntilVisible:\n    element:\n      id: ${JSON.stringify(id)}\n    direction: DOWN\n    timeout: 20000\n    centerElement: true\n`;
      await observeNativeConnectionStates({
        platform: 'android',
        output,
        fixtures,
        report,
        snapshot: () => session!.snapshot('native-entry-android'),
        observations: () => proxy!.observations,
        observe,
        switchAccount: async (account) => {
          await observe(
            `${account}-account`,
            (account === 'active-student'
              ? '- scrollUntilVisible:\n    element:\n      id: student.professionals.backButton\n    direction: UP\n    timeout: 20000\n    centerElement: true\n' +
                tap('student.professionals.backButton')
              : '') + tap('tabs.account'),
            'SCR-account',
            ['settings.account.screen'],
          );
          await observe(
            `${account}-signout-confirm`,
            scroll('settings.account.signOutCta') + tap('settings.account.signOutCta'),
            'STATE-signout-confirm',
            ['settings.account.signOutConfirm'],
          );
          await observe(
            `${account}-signed-out`,
            scroll('settings.account.signOutConfirmCta') +
              tap('settings.account.signOutConfirmCta'),
            'SCR-sign-in',
            ['auth.signIn.emailInput', 'auth.signIn.passwordInput', 'auth.signIn.submitButton'],
          );
          await observe(
            `${account}-home`,
            tap('auth.signIn.emailInput') +
              '- eraseText: 200\n' +
              `- inputText: ${JSON.stringify(fixtures.accounts[account].email)}\n` +
              tap('auth.signIn.passwordInput') +
              '- eraseText: 200\n' +
              `- inputText: ${JSON.stringify(fixtures.accounts[account].password)}\n- hideKeyboard\n` +
              tap('auth.signIn.submitButton'),
            'SCR-student-home',
            ['student.home.screen'],
          );
        },
      });
      report.nativeLogoutContract = {
        requirementRefs: ['FR-270', 'BR-342'],
        scope:
          'local clearing only for normal account switches; no server revocation qualification',
        serverRevocationQualified: false,
      };
    }
    beginPhase('verify');
    report.sourceAfter = await androidSourceIdentity(root);
    report.helperInputsAfter = await helperIdentity();
    if (
      JSON.stringify(report.sourceAfter) !== JSON.stringify(beforeSource) ||
      JSON.stringify(report.helperInputsAfter) !== JSON.stringify(beforeHelpers)
    )
      throw new Error('Android capture inputs changed during execution');
    report.result = 'observed';
  } catch (error) {
    if (error instanceof OwnedSessionAcquisitionError)
      report.backendAcquisitionFailure = {
        cleanup: error.cleanup,
        childExitCode: error.childExitCode,
        pid: error.pid ?? null,
        manifest: error.manifest ?? null,
        closed: error.closed ?? null,
        diagnosticsHash: createHash('sha256').update(error.diagnostics).digest('hex'),
      };
    report.result = cancellation() ? 'cancelled' : 'harness-blocked';
    report.error = (error as Error).message;
  } finally {
    beginPhase('cleanup');
    const errors = [...commandCleanupFailures];
    if (target) {
      if (report.result !== 'observed' && !androidReadonlyDiagnosticAttempted) {
        try {
          const lastExecution = commandExecutions[commandExecutions.length - 1];
          const fallbackExecution: NativeCommandExecution = lastExecution ?? {
            phase: 'step',
            execution: 'harness-blocked',
            cleanup: 'unknown',
            childExitCode: null,
            childSignal: null,
            pid: null,
            pgid: null,
            logPath: null,
            stdoutPath: null,
            ownershipPath: null,
            elapsedMs: 0,
            cleanupMs: 0,
          };
          await captureAndroidReadonlyDiagnostics('final-failure', fallbackExecution);
        } catch (error) {
          report.androidDriverDiagnosticError =
            error instanceof Error
              ? {
                  name: error.name.slice(0, 128),
                  message: error.message.slice(0, 512),
                }
              : {
                  name: 'UnknownError',
                  message: 'Android driver diagnostics failed',
                };
        }
      }
      try {
        await writeFile(
          path.join(output, 'android-runtime.private.log'),
          await target.adbRead([
            'logcat',
            '-d',
            '-v',
            'brief',
            'AndroidRuntime:E',
            'ReactNativeJS:E',
            '*:S',
          ]),
          { mode: 0o600 },
        );
      } catch (error) {
        report.diagnosticError = (error as Error).message;
      }
      try {
        await screenshot('final-state');
      } catch (error) {
        report.screenshotError = (error as Error).message;
      }
    }
    if (app) {
      try {
        await writeFile(path.join(output, 'bootstrap.private.log'), app.diagnostics, {
          mode: 0o600,
        });
        assertNativeBootstrapHealthy(app.diagnostics);
      } catch (error) {
        report.result = 'harness-blocked';
        report.error ??= (error as Error).message;
      }
    }
    if (proxy && charter !== 'connection-journey' && !isAuthSessionFlow) {
      try {
        await writeFile(
          path.join(output, 'transport-observations.private.json'),
          JSON.stringify(proxy.observations, null, 2),
          { mode: 0o600 },
        );
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    for (const command of [...commands].reverse())
      try {
        await command.stop();
      } catch (error) {
        errors.push((error as Error).message);
      }
    let proxyStopSucceeded = true;
    for (const resource of [app, proxy, session, target, defaultAdb])
      try {
        await resource?.stop();
      } catch (error) {
        if (resource === proxy) proxyStopSucceeded = false;
        errors.push((error as Error).message);
      }
    if (proxy && (charter === 'connection-journey' || isAuthSessionFlow)) {
      const evidenceAvailability = buildAndroidConnectionEvidenceAvailability(proxyStopSucceeded);
      if (charter === 'connection-journey') report.connectionEvidence = evidenceAvailability;
      else report.androidSessionAuthEvidence = evidenceAvailability;
      if (evidenceAvailability.status === 'available') {
        try {
          const evidenceReceipts = await persistAndroidConnectionEvidence(output, proxy, {
            signal: controller.signal,
          });
          const transport = await readOwnedAndroidStableFile({
            artifactRoot: output,
            filePath: path.join(output, 'transport-observations.private.json'),
            kind: 'transport',
            maxBytes: 1_048_576,
            signal: controller.signal,
          });
          const identities = await readOwnedAndroidStableFile({
            artifactRoot: output,
            filePath: path.join(output, 'native-auth-identities.private.json'),
            kind: 'auth',
            maxBytes: 1_048_576,
            signal: controller.signal,
          });
          requireFinalSessionTransport(
            transport.bytes,
            {
              bytes: transport.receipt.sizeBytes,
              sha256: transport.receipt.sha256,
            },
            proxy.observations,
          );
          requireFinalSessionTransport(
            identities.bytes,
            {
              bytes: identities.receipt.sizeBytes,
              sha256: identities.receipt.sha256,
            },
            proxy.nativeAuthIdentities,
          );
          if (isAuthSessionFlow) {
            report.androidSessionAuthEvidence = {
              ...evidenceAvailability,
              transportPath: 'transport-observations.private.json',
              nativeAuthIdentitiesPath: 'native-auth-identities.private.json',
              transportReceipt: evidenceReceipts.transportReceipt,
              nativeAuthIdentitiesReceipt: evidenceReceipts.nativeAuthIdentitiesReceipt,
            };
          } else if (charter === 'connection-journey') {
            report.connectionEvidence = {
              ...evidenceAvailability,
              transportPath: 'transport-observations.private.json',
              nativeAuthIdentitiesPath: 'native-auth-identities.private.json',
              transportReceipt: evidenceReceipts.transportReceipt,
              nativeAuthIdentitiesReceipt: evidenceReceipts.nativeAuthIdentitiesReceipt,
            };
          }
        } catch (error) {
          const unavailable = {
            status: 'unavailable',
            reason: 'persistence-failed',
          } as const;
          if (charter === 'connection-journey') report.connectionEvidence = unavailable;
          else report.androidSessionAuthEvidence = unavailable;
          errors.push((error as Error).message);
        }
      }
    }
    if (acquisitionIntents.includes('adb') && !defaultAdb) {
      try {
        const baseline = JSON.parse(
          await readFile(path.join(output, 'adb-server-before.private.json'), 'utf8'),
        ) as { identity: AdbServerIdentity | null };
        const current = await inspectAdbServer();
        if (baseline.identity) requireAdbServerPreserved(baseline.identity, current);
        else if (current) throw new Error('Unreturned default ADB reference requires recovery');
        try {
          const ledger = JSON.parse(
            await readFile(path.join(output, 'adb-server.ownership.json'), 'utf8'),
          ) as { cleanup: string };
          if (ledger.cleanup !== 'cleaned')
            throw new Error('Default ADB acquisition cleanup requires recovery');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    try {
      await reservation?.release();
    } catch (error) {
      errors.push((error as Error).message);
    }
    if (!target) {
      try {
        await lstat(path.join(output, 'android-cleanup-failure.private.json'));
        errors.push('Android acquisition cleanup requires recovery');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          errors.push((error as Error).message);
      }
    }
    try {
      report.sourceAfter = await androidSourceIdentity(root);
      report.helperInputsAfter = await helperIdentity();
      if (
        JSON.stringify(report.sourceAfter) !== JSON.stringify(beforeSource) ||
        JSON.stringify(report.helperInputsAfter) !== JSON.stringify(beforeHelpers)
      ) {
        errors.push('Android capture inputs changed during execution');
        localeInputsStable = false;
      }
      report.workspaceApkAfter = await existingApkIdentity();
      if (JSON.stringify(beforeApk) !== JSON.stringify(report.workspaceApkAfter))
        errors.push('Existing workspace APK changed during capture');
      report.avdsAfter = await listAvds();
      if (JSON.stringify(beforeAvds) !== JSON.stringify(report.avdsAfter))
        errors.push('Previously available Android AVD inventory changed');
      const afterIos = (
        await execute('xcrun', ['simctl', 'list', 'devices', '--json'], {
          timeout: 15000,
        })
      ).stdout;
      await writeFile(path.join(output, 'after-ios-devices.private.json'), afterIos, {
        flag: 'wx',
        mode: 0o600,
      });
      const deviceStates = (json: string) => {
        const parsed = JSON.parse(json) as {
          devices: Record<string, { udid: string; state: string }[]>;
        };
        return Object.values(parsed.devices)
          .flat()
          .map(({ udid, state }) => ({ udid, state }))
          .sort((a, b) => a.udid.localeCompare(b.udid));
      };
      if (JSON.stringify(deviceStates(beforeIos)) !== JSON.stringify(deviceStates(afterIos)))
        errors.push('Previous iOS device IDs or states changed');
    } catch (error) {
      errors.push((error as Error).message);
      localeInputsStable = false;
    }
    const localeFinalization = await safelyFinalizeNativeLocaleObservation(() => {
      if (!localeCapture || !localeInputsStable || !localeExpectedBindingInputs) return;
      const capturedSource = report.sourceAfter as { sourceTreeHash: string };
      const capturedHelpers = report.helperInputsAfter as typeof beforeHelpers;
      const capturedDevice = report.device as {
        serial: string;
        osVersion: string;
      };
      const capturedBuild = report.build as {
        appId: string;
        binaryHash: string;
        apiOrigin: string;
      };
      const capturedBinding = buildNativeLocaleBinding({
        captureRunId,
        sourceTreeHash: capturedSource.sourceTreeHash,
        helperInputs: capturedHelpers,
        target: {
          platform: 'android',
          deviceId: capturedDevice.serial,
          osVersion: capturedDevice.osVersion,
          appId: capturedBuild.appId,
          binaryHash: capturedBuild.binaryHash,
          apiOrigin: capturedBuild.apiOrigin,
        },
      });
      const expectedBinding = buildNativeLocaleBinding({
        captureRunId,
        sourceTreeHash: localeExpectedBindingInputs.sourceTreeHash,
        helperInputs: localeExpectedBindingInputs.helperInputs,
        target: localeExpectedBindingInputs.target,
      });
      const normalized = normalizeNativeLocaleCommandOutput({
        binding: capturedBinding,
        command: localeCapture.selected,
      });
      report.localeBinding = capturedBinding;
      report.localeExpectedBinding = expectedBinding;
      report.observedOsLocale = normalized.observedOsLocale;
      report.localeObservationBlocker = normalized.blocker;
      if (!sameNativeLocaleBinding(capturedBinding, expectedBinding)) {
        report.result = 'harness-blocked';
        report.localeBindingMismatch = true;
      }
      report.localeContextCandidate = buildNativeLocaleContextCandidateFromFile({
        artifactRoot: output,
        hierarchyPath: localeCapture.hierarchyPath,
        binding: capturedBinding,
        expectedBinding,
        observedOsLocale: normalized.observedOsLocale,
      });
    });
    if (localeFinalization.status === 'blocked') {
      report.result = 'harness-blocked';
      report.localeBinding = null;
      report.localeExpectedBinding = null;
      report.observedOsLocale = null;
      report.localeContextCandidate = null;
      report.localeObservationBlocker = 'locale-observation-finalization-failed';
      report.localeObservationError = localeFinalization.error;
    }
    if (isCameraCharter) {
      let cleanupLink: Record<string, unknown>;
      try {
        const independent = await verifyAndroidCameraCleanupBeforeCapturePublication({
          report,
          cleanupFailures: errors,
          plannedCleanup: passedHostPreflight ? 'cleaned' : 'not-acquired',
          captureRunId,
          publication: 'provisional-before-capture-publication',
          repositoryRoot: root,
          artifactRoot: output,
          androidRuntimeParent: path.join(path.dirname(hostRoot), 'mychampions-android-pilot'),
          sdkRoot,
        });
        cleanupLink = {
          kind: 'private-owned-android-camera-independent-cleanup-link',
          captureRunId,
          inspector: 'verifyOwnedAndroidCleanup',
          capturePublication: independent.capturePublication,
          result: independent.result,
          censusStatus: independent.censusStatus,
          cleanupReceipt: independent.androidCleanupReceipt ?? null,
          nativePassingCases: 0,
          runtimeQualification: 'Pending',
          publicPromotionEligible: false,
        };
        if (independent.result !== 'passed' || independent.censusStatus !== 'available')
          errors.push('Android camera independent cleanup did not prove owned-resource absence');
      } catch (error) {
        cleanupLink = {
          kind: 'private-owned-android-camera-independent-cleanup-link',
          captureRunId,
          inspector: 'verifyOwnedAndroidCleanup',
          capturePublication: 'provisional-before-capture-publication',
          result: 'failed',
          censusStatus: 'unavailable',
          cleanupReceipt: null,
          nativePassingCases: 0,
          runtimeQualification: 'Pending',
          publicPromotionEligible: false,
          error:
            error instanceof Error
              ? {
                  name: error.name.slice(0, 128),
                  message: error.message.slice(0, 512),
                }
              : {
                  name: 'UnknownError',
                  message: 'Independent Android cleanup failed',
                },
        };
        errors.push('Android camera independent cleanup failed');
      }
      report.androidCameraIndependentCleanup = cleanupLink;
      try {
        await writeFile(
          path.join(output, 'camera-independent-cleanup-link.private.json'),
          JSON.stringify(cleanupLink, null, 2),
          { flag: 'wx', mode: 0o600 },
        );
        await readOwnedAndroidStableFile({
          artifactRoot: output,
          filePath: path.join(output, 'camera-independent-cleanup-link.private.json'),
          kind: 'sidecar',
          maxBytes: 1024 * 1024,
          signal: undefined,
        });
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    report.cleanup = errors.length
      ? 'failed-recovery-retained'
      : passedHostPreflight
        ? 'cleaned'
        : 'not-acquired';
    report.cleanupFailures = errors;
    const authEvidenceStatus = (
      report.androidSessionAuthEvidence as { status?: string } | undefined
    )?.status;
    const connectionEvidenceStatus = (report.connectionEvidence as { status?: string } | undefined)
      ?.status;
    if (
      errors.length > 0 ||
      authEvidenceStatus === 'unavailable' ||
      connectionEvidenceStatus === 'unavailable'
    ) {
      report.result = 'harness-blocked';
      report.error ??= 'Cleanup or evidence persistence did not complete';
    }
    clearTimeout(wholeTimer);
    if (controller.signal.aborted || report.deadline || report.budgetTimeout)
      report.result = cancellation() ? 'cancelled' : 'harness-blocked';
    report.cancellation = cancellation() ?? null;
    if (isAuthSessionFlow) {
      report.androidSessionTerminalQualification = buildAndroidSessionTerminalQualification({
        result: String(report.result),
        cleanup: String(report.cleanup),
        evidenceStatus: authEvidenceStatus,
      });
      report.androidSessionFrameReceipts = Object.fromEntries(
        [...observedFrameReceipts.entries()].map(([label, receipts]) => [label, receipts]),
      );
    }
    beginPhase();
    report.finishedAt = new Date().toISOString();
    const capturePath = path.join(output, 'capture.private.json');
    await writeFile(capturePath, JSON.stringify(report, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
    const captureReceipt = await readOwnedAndroidStableFile({
      artifactRoot: output,
      filePath: capturePath,
      kind: 'sidecar',
      maxBytes: 32 * 1024 * 1024,
      signal: controller.signal,
    });
    await writeFile(
      path.join(output, 'capture-receipt.private.json'),
      JSON.stringify(
        {
          kind: 'private-owned-android-capture-receipt',
          captureRunId,
          receipt: captureReceipt.receipt,
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
    const captureReceiptSidecar = await readOwnedAndroidStableFile({
      artifactRoot: output,
      filePath: path.join(output, 'capture-receipt.private.json'),
      kind: 'sidecar',
      maxBytes: 1024 * 1024,
      signal: controller.signal,
    });
    const captureReceiptEnvelope = JSON.parse(
      captureReceiptSidecar.bytes.toString('utf8'),
    ) as Record<string, unknown>;
    assert.equal(captureReceiptEnvelope.kind, 'private-owned-android-capture-receipt');
    assert.equal(captureReceiptEnvelope.captureRunId, captureRunId);
    assert.deepEqual(captureReceiptEnvelope.receipt, captureReceipt.receipt);
  }
  return {
    artifactRoot: output,
    exitCode: androidNativeCaptureExitCode({
      cancellation: cancellation() ?? null,
      result: report.result,
      cleanup: report.cleanup,
      isAuthSessionFlow,
      sessionQualification: report.androidSessionTerminalQualification,
    }),
    report,
  };
}

async function main() {
  process.umask(0o077);
  const controller = new AbortController();
  const onInt = () => controller.abort('SIGINT');
  const onTerm = () => controller.abort('SIGTERM');
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  try {
    const parsed = parseAndroidNativeCaptureArguments(process.argv.slice(2));
    if (parsed.charter === 'camera-denied') {
      const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
      const inventory = JSON.parse(
        await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
      ) as unknown;
      const selection = await selectNativePilotScenario(
        {
          platform: 'android',
          engine: 'maestro',
          scenario: 'SCN-camera-denied-android',
          mode: 'integration',
        },
        inventory,
        root,
      );
      const result = await runOwnedAndroidNativeSession({
        ...parsed,
        selection,
        executeCamera: async (boundary) => runAndroidCameraCaptureCallback(boundary),
        deadlines: parseNativeExecutionDeadlines(process.env),
        signal: controller.signal,
      });
      process.exitCode = result.exitCode;
      return;
    }
    const result = await runOwnedAndroidNativeSession({
      ...parsed,
      deadlines: parseNativeExecutionDeadlines(process.env),
      signal: controller.signal,
    });
    process.exitCode = result.exitCode;
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch(() => {
    process.stderr.write('Android native capture startup blocked before observation.\n');
    process.exitCode = 2;
  });
