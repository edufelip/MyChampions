import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants as fsConstants, type Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { androidSourceIdentity } from './android-build-identity';
import { qualifyNativeLocaleEvidence } from './locale-native-observation';
import {
  requireAndroidCameraCleanupProof,
  stageAndroidCameraPublicEvidence,
  type AndroidCameraPublicStageResult,
} from './native-android-camera-public-staging';
import {
  requireAndroidCameraNativeRuntimeDriver,
  type AndroidCameraNativeRuntimeDriverResult,
} from './native-android-camera-runtime-driver';
import {
  readOwnedAndroidBoundedFile,
  type AndroidOwnedFileIdentity,
} from './native-android-session-adapter';
import {
  ANDROID_CAMERA_ASSERTION_IDS,
  androidCameraSelectionHash,
  requireAndroidCameraIdentityBoundary,
} from './native-camera-android-contract';
import {
  requireAndroidCameraTransport,
  type AndroidCameraApiIdentity,
  ANDROID_CAMERA_SQL_TABLES,
  type AndroidCameraSqlReceiptPhase,
  type AndroidCameraSqlSourceReceipt,
} from './native-camera-android-observation';
import {
  requireAndroidCameraIsolationFixtureBinding,
  requireAndroidCameraProducerOutput,
  requireAndroidCameraSelectionShape,
  type AndroidCameraProducerReceipts,
} from './native-camera-android-producer';
import {
  loadAndroidCameraSavedFlow,
  type AndroidCameraSavedFlowBinding,
} from './native-camera-android-saved-flow';
import { requireConnectionSnapshot } from './native-connection-snapshot';
import { buildNativeLocaleBinding } from './native-locale-capture-seam';
import {
  requireNativePilotAssertions,
  type NativePilotSelection,
  type NativePilotTarget,
} from './native-pilot-contract';
import { assertTestingDocument } from './schema-validation';
import type { NativeLocaleBinding } from './locale-native-observation';
import type { NativeSourceIdentity } from './native-build-identity';
import type { AndroidCameraPublicAttemptResult } from './run-android-camera-public-attempt';

const RUN_ID = /^[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const LOOPBACK = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+$/u;
const CAMERA_PROFILE = 'dev-debug-arm64';
const CAMERA_BUILD_PROFILE =
  'Metro-attached devDebug arm64; no app-domain instrumentation; optional separately bound read-only input reader; not bundled release qualification';
/**
 * Keep the camera eligibility reader aligned with the Android pilot build
 * contract. The reader remains finite and streams the artifact instead of buffering it.
 */
export const ANDROID_CAMERA_APK_MAX_BYTES = 256 * 1024 * 1024;
const ANDROID_CAMERA_APK_READ_CHUNK_BYTES = 64 * 1024;
const ANDROID_CAMERA_HELPER_MAX_FILE_BYTES = 16 * 1024 * 1024;
const ANDROID_CAMERA_HELPER_MAX_AGGREGATE_BYTES = 512 * 1024 * 1024;
/**
 * The Android camera capture ledger must bind the shared connection-evidence
 * reader it loads before native preparation, so a stale or missing helper
 * cannot pass the camera source gate.
 */
export const ANDROID_CAMERA_DETOX_RUNTIME_HELPER_PATHS = Object.freeze([
  'scripts/testing/detox-connection-evidence.ts',
] as const);
const SQL_PHASES = [
  'before',
  'pending',
  'isolation-before',
  'isolation-after',
  'training-before',
  'training-after',
] as const satisfies readonly AndroidCameraSqlReceiptPhase[];

type JsonRecord = Record<string, unknown>;
type CameraEvidenceKind = 'ui' | 'api' | 'sql';

export type AndroidCameraNativeRuntimeProvenance = {
  mode: 'native-runtime';
  receiptPath: string;
  receiptSha256: string;
};

export type AndroidCameraRuntimeAssertionBinding = {
  id: (typeof ANDROID_CAMERA_ASSERTION_IDS)[number];
  requirementRefs: readonly string[];
  evidenceKinds: readonly CameraEvidenceKind[];
  evidencePaths: readonly string[];
};

export type AndroidCameraSavedFlowRuntimeBinding = AndroidCameraSavedFlowBinding &
  Readonly<{
    runtimeFixtureRef: string;
    runtimeFixtureRunId: string;
    runtimeFixtureScope: string;
  }>;

export type AndroidCameraRuntimeEligibilityInput = {
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  fixtureRunId: string;
  selection: NativePilotSelection;
  target: NativePilotTarget;
  expectedLocale: 'en-US' | 'pt-BR' | 'es-ES';
  runtime: AndroidCameraPublicAttemptResult | null;
  producer: AndroidCameraProducerReceipts;
  signal?: AbortSignal;
  deadlineAt?: number;
  /** Only private fixture controls may set this; it prevents any native claim. */
  sourceOnlyTestLabel?: `sealed-source-control:${string}`;
  /** A real producer must publish and bind this receipt before runtime eligibility. */
  runtimeProvenance?: AndroidCameraNativeRuntimeProvenance;
  /** Native mode requires a distinct acquired-driver result; source attempts cannot be relabeled. */
  nativeDriver?: AndroidCameraNativeRuntimeDriverResult;
};

export type AndroidCameraRuntimeEvidenceProof = {
  kind: 'private-android-camera-runtime-evidence-proof';
  status: 'verified-owned-receipts';
  captureRunId: string;
  fixtureRunId: string;
  source: NativeSourceIdentity;
  helperInputs: readonly { path: string; sha256: string }[];
  savedFlow: AndroidCameraSavedFlowRuntimeBinding;
  target: NativePilotTarget;
  build: {
    path: string;
    sha256: string;
    sizeBytes: number;
    identity: AndroidOwnedFileIdentity;
  };
  localeBinding: NativeLocaleBinding;
  assertionBindings: readonly AndroidCameraRuntimeAssertionBinding[];
  /** Complete producer-bound SQL receipts, including retained provenance sidecars. */
  sqlParents: readonly AndroidCameraSqlSourceReceipt[];
  /** Complete producer receipt graph used to rebuild the terminal stage set. */
  producer?: AndroidCameraProducerReceipts;
  stage: AndroidCameraPublicStageResult;
  nativeDriver?: AndroidCameraNativeRuntimeDriverResult;
  runtimeProvenance:
    | { mode: 'source-only-control'; label: `sealed-source-control:${string}` }
    | AndroidCameraNativeRuntimeProvenance;
};

export type AndroidCameraRuntimeEligibilityResult = {
  kind: 'private-android-camera-runtime-eligibility-not-public-receipt';
  status: 'verified-native-private' | 'validated-source-only';
  verificationMode: 'native-runtime' | 'source-only-control';
  captureRunId: string;
  requestedRunId: string;
  requestedAttemptId: string;
  fixtureRunId: string;
  evidenceProof: AndroidCameraRuntimeEvidenceProof;
  assertionBindings: readonly AndroidCameraRuntimeAssertionBinding[];
  stage: AndroidCameraPublicStageResult;
  nativePassingCases: 0 | 4;
  publicPassingCases: 0;
  publicPromotionEligible: false;
  sourceOnlyTestLabel: string | null;
  runtimeProvenance: AndroidCameraRuntimeEvidenceProof['runtimeProvenance'];
};

function record(value: unknown, label: string): JsonRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`);
  return value as JsonRecord;
}

function stringValue(value: unknown, label: string): string {
  assert(
    typeof value === 'string' && value.length > 0 && value.trim() === value,
    `${label} is invalid`,
  );
  return value;
}

function hash(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function relative(value: unknown, label: string): string {
  const result = stringValue(value, label);
  assert(!path.isAbsolute(result), `${label} is absolute`);
  assert(!result.includes('\\') && !result.split('/').includes('..'), `${label} escapes its root`);
  assert(path.posix.normalize(result) === result, `${label} is not normalized`);
  return result;
}

function requiredHash(value: unknown, label: string): string {
  const result = stringValue(value, label);
  assert.match(result, HASH, `${label} is not a SHA-256`);
  return result;
}

/** Parse the saved-flow binding retained in a capture or terminal receipt. */
export function parseAndroidCameraSavedFlowRuntimeBinding(
  value: unknown,
  label = 'Android camera saved-flow binding',
): AndroidCameraSavedFlowRuntimeBinding {
  const row = record(value, label);
  assert.equal(row.path, '.maestro/flows/camera-denied-android.yaml');
  assert.equal(row.scenarioId, 'SCN-camera-denied-android');
  assert.equal(row.flowId, 'FLW-camera-denied');
  const fixtureRef = stringValue(row.fixtureRef, `${label}.fixtureRef`);
  assert.equal(fixtureRef, 'owned-postgres:SCN-camera-denied-android:fresh-attempt');
  const runtimeFixtureRunId = stringValue(row.runtimeFixtureRunId, `${label}.runtimeFixtureRunId`);
  assert.match(runtimeFixtureRunId, RUN_ID, `${label}.runtimeFixtureRunId is invalid`);
  const runtimeFixtureScope = stringValue(row.runtimeFixtureScope, `${label}.runtimeFixtureScope`);
  const runtimeFixtureRef = stringValue(row.runtimeFixtureRef, `${label}.runtimeFixtureRef`);
  assert.equal(
    runtimeFixtureRef,
    `owned-postgres:native-entry-android:${runtimeFixtureRunId}`,
    `${label}.runtimeFixtureRef is crossed`,
  );
  return Object.freeze({
    path: row.path as AndroidCameraSavedFlowBinding['path'],
    sha256: requiredHash(row.sha256, `${label}.sha256`),
    scenarioId: row.scenarioId as AndroidCameraSavedFlowBinding['scenarioId'],
    flowId: row.flowId as AndroidCameraSavedFlowBinding['flowId'],
    fixtureRef,
    runtimeFixtureRef,
    runtimeFixtureRunId,
    runtimeFixtureScope,
  });
}

function baseSavedFlowBinding(
  value: AndroidCameraSavedFlowRuntimeBinding,
): AndroidCameraSavedFlowBinding {
  return {
    path: value.path,
    sha256: value.sha256,
    scenarioId: value.scenarioId,
    flowId: value.flowId,
    fixtureRef: value.fixtureRef,
  };
}

/** Re-read the checked-in route before eligibility or finalization accepts its hash. */
export async function requireAndroidCameraSavedFlowSource(options: {
  repositoryRoot: string;
  selection: NativePilotSelection;
  expectedBinding: AndroidCameraSavedFlowRuntimeBinding;
  deadlineAtMonotonicMs: number;
  signal?: AbortSignal;
}): Promise<void> {
  const loaded = await loadAndroidCameraSavedFlow({
    repositoryRoot: options.repositoryRoot,
    selection: options.selection,
    deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    signal: options.signal,
  });
  assert.deepEqual(
    loaded.binding,
    baseSavedFlowBinding(options.expectedBinding),
    'Android camera saved-flow source changed before terminal publication',
  );
}

/** Bind the capture report's route identity to the current checked-in route and fixture. */
export async function requireAndroidCameraSavedFlowBinding(options: {
  repositoryRoot: string;
  selection: NativePilotSelection;
  report: JsonRecord;
  expectedFixtureRunId: string;
  expectedFixtureScope: string;
  deadlineAtMonotonicMs: number;
  signal?: AbortSignal;
}): Promise<AndroidCameraSavedFlowRuntimeBinding> {
  const loaded = await loadAndroidCameraSavedFlow({
    repositoryRoot: options.repositoryRoot,
    selection: options.selection,
    deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    signal: options.signal,
  });
  const binding = parseAndroidCameraSavedFlowRuntimeBinding(
    options.report.androidCameraSavedFlow,
    'Android camera capture saved-flow binding',
  );
  assert.deepEqual(
    loaded.binding,
    baseSavedFlowBinding(binding),
    'Android camera capture saved-flow hash is stale',
  );
  assert.equal(binding.runtimeFixtureRunId, options.expectedFixtureRunId);
  assert.equal(binding.runtimeFixtureScope, options.expectedFixtureScope);
  return binding;
}

function throwIfExpired(
  signal: AbortSignal | undefined,
  deadlineAt: number | undefined,
  label: string,
): void {
  signal?.throwIfAborted();
  if (deadlineAt === undefined) return;
  assert(
    Number.isFinite(deadlineAt) && performance.now() < deadlineAt,
    `${label} deadline expired`,
  );
}

type AndroidCameraSourceFenceRow = {
  path: string;
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
};

async function androidCameraSourceFence(
  root: string,
  relativePath?: string,
): Promise<readonly AndroidCameraSourceFenceRow[]> {
  const absolute = relativePath ? path.resolve(root, relativePath) : root;
  assert(
    absolute === root || absolute.startsWith(root + path.sep),
    'Android camera helper path escaped the source root',
  );
  const ancestors: string[] = [];
  let current = absolute === root ? root : path.dirname(absolute);
  for (;;) {
    ancestors.push(current);
    if (current === root) break;
    const parent = path.dirname(current);
    assert(parent !== current && parent.startsWith(root), 'Android helper ancestor escaped root');
    current = parent;
  }
  const rows: AndroidCameraSourceFenceRow[] = [];
  for (const ancestor of ancestors.reverse()) {
    const info = await lstat(ancestor);
    assert(
      info.isDirectory() &&
        !info.isSymbolicLink() &&
        info.uid === process.getuid?.() &&
        (info.mode & 0o022) === 0 &&
        (await realpath(ancestor)) === ancestor,
      `Android camera helper ancestor is not stable: ${ancestor}`,
    );
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

async function privateRoot(value: string, label: string): Promise<string> {
  const canonical = await realpath(value);
  assert.equal(canonical, path.resolve(value), `${label} is not canonical`);
  const info = await lstat(canonical);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a directory`);
  assert.equal(info.uid, process.getuid?.(), `${label} is not owned`);
  assert.equal(info.mode & 0o777, 0o700, `${label} is not private`);
  return canonical;
}

async function readArtifact(
  root: string,
  relativePath: string,
  kind: 'frame' | 'query' | 'transport' | 'sidecar',
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; identity: AndroidOwnedFileIdentity }> {
  const loaded = await readOwnedAndroidBoundedFile({
    artifactRoot: root,
    filePath: path.resolve(root, relativePath),
    label: `Android camera ${kind} ${relativePath}`,
    maxBytes,
    signal,
  });
  return { bytes: loaded.bytes, identity: loaded.identity };
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

async function yieldAndroidCameraHelperReadTurn(
  signal: AbortSignal | undefined,
  deadlineAt: number | undefined,
  label: string,
): Promise<void> {
  throwIfExpired(signal, deadlineAt, label);
  await new Promise<void>((resolve) => setImmediate(resolve));
  throwIfExpired(signal, deadlineAt, label);
}

async function readAndroidCameraHelperDescriptor(options: {
  repositoryRoot: string;
  relativePath: string;
  signal?: AbortSignal;
  deadlineAt?: number;
}): Promise<{ bytes: Buffer; identity: AndroidCameraHelperFileIdentity }> {
  const label = `Android camera helper ${options.relativePath}`;
  throwIfExpired(options.signal, options.deadlineAt, 'Android camera helper closure');
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
      before.size <= ANDROID_CAMERA_HELPER_MAX_FILE_BYTES,
    `${label} is not a bounded owned regular file`,
  );
  const beforeIdentity = androidCameraHelperFileIdentity(before);
  const descriptor = await open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorBefore = androidCameraHelperFileIdentity(await descriptor.stat());
    assert.deepEqual(
      descriptorBefore,
      beforeIdentity,
      `${label} descriptor identity changed before read`,
    );
    const targetBytes = Math.min(
      ANDROID_CAMERA_HELPER_MAX_FILE_BYTES + 1,
      descriptorBefore.size + 1,
    );
    const bytes = Buffer.allocUnsafe(targetBytes);
    let bytesRead = 0;
    while (bytesRead < targetBytes) {
      throwIfExpired(options.signal, options.deadlineAt, 'Android camera helper closure');
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
        options.deadlineAt,
        'Android camera helper closure',
      );
    }
    const descriptorAfter = androidCameraHelperFileIdentity(await descriptor.stat());
    const pathAfter = androidCameraHelperFileIdentity(await lstat(absolute));
    assert.deepEqual(descriptorAfter, descriptorBefore, `${label} changed while reading`);
    assert.deepEqual(pathAfter, descriptorBefore, `${label} path changed while reading`);
    assert.equal(await realpath(absolute), absolute, `${label} path changed while reading`);
    assert.equal(bytesRead, descriptorAfter.size, `${label} byte count changed`);
    assert(bytesRead <= ANDROID_CAMERA_HELPER_MAX_FILE_BYTES, `${label} exceeds its bounded size`);
    throwIfExpired(options.signal, options.deadlineAt, 'Android camera helper closure');
    return { bytes: bytes.subarray(0, bytesRead), identity: descriptorAfter };
  } finally {
    await descriptor.close();
  }
}

async function readJsonArtifact(
  root: string,
  relativePath: string,
  kind: 'frame' | 'query' | 'transport' | 'sidecar',
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{
  value: JsonRecord | unknown[];
  bytes: Buffer;
  identity: AndroidOwnedFileIdentity;
}> {
  const loaded = await readArtifact(root, relativePath, kind, maxBytes, signal);
  let value: unknown;
  try {
    value = JSON.parse(loaded.bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Android camera ${relativePath} is not valid JSON`, {
      cause: error,
    });
  }
  assert(value && typeof value === 'object', `Android camera ${relativePath} JSON is malformed`);
  return { value: value as JsonRecord | unknown[], ...loaded };
}

async function readBuildArtifact(
  captureRoot: string,
  absolutePath: string,
  expectedHash: string,
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<AndroidCameraRuntimeEvidenceProof['build']> {
  assert(path.isAbsolute(absolutePath), 'Android APK identity path must be absolute');
  const resolvedRoot = path.resolve(captureRoot);
  const resolvedPath = path.resolve(absolutePath);
  assert(resolvedPath.startsWith(`${resolvedRoot}${path.sep}`), 'Android APK escaped capture root');
  assert.equal(await realpath(resolvedPath), resolvedPath, 'Android APK path is not canonical');
  const before = await lstat(resolvedPath);
  assert(before.isFile() && !before.isSymbolicLink(), 'Android APK is not a regular file');
  assert.equal(before.uid, process.getuid?.(), 'Android APK owner changed');
  assert.equal(before.nlink, 1, 'Android APK must have one link');
  assert.equal(before.mode & 0o022, 0, 'Android APK is group/world writable');
  assert(
    Number.isSafeInteger(before.size) &&
      before.size > 0 &&
      before.size <= ANDROID_CAMERA_APK_MAX_BYTES,
    'Android APK size is invalid or exceeds its bounded build limit',
  );
  throwIfExpired(signal, deadlineAt, 'Android APK read');
  const descriptor = await open(resolvedPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorBefore = await descriptor.stat();
    assert(
      descriptorBefore.isFile() && !descriptorBefore.isSymbolicLink(),
      'Android APK descriptor is not a regular file',
    );
    assert.equal(descriptorBefore.dev, before.dev, 'Android APK descriptor device changed');
    assert.equal(descriptorBefore.ino, before.ino, 'Android APK descriptor inode changed');
    assert.equal(descriptorBefore.uid, before.uid, 'Android APK descriptor owner changed');
    assert.equal(descriptorBefore.gid, before.gid, 'Android APK descriptor group changed');
    assert.equal(
      descriptorBefore.mode & 0o777,
      before.mode & 0o777,
      'Android APK descriptor mode changed',
    );
    assert.equal(descriptorBefore.nlink, before.nlink, 'Android APK descriptor link count changed');
    assert.equal(descriptorBefore.size, before.size, 'Android APK byte count changed before read');
    assert.equal(
      descriptorBefore.mtimeMs,
      before.mtimeMs,
      'Android APK descriptor modified time changed',
    );
    assert.equal(
      descriptorBefore.ctimeMs,
      before.ctimeMs,
      'Android APK descriptor metadata changed',
    );
    assert(
      Number.isSafeInteger(descriptorBefore.size) &&
        descriptorBefore.size > 0 &&
        descriptorBefore.size <= ANDROID_CAMERA_APK_MAX_BYTES,
      'Android APK descriptor size is invalid or exceeds its bounded build limit',
    );
    const digest = createHash('sha256');
    let bytesRead = 0;
    let remaining = descriptorBefore.size;
    while (remaining > 0) {
      throwIfExpired(signal, deadlineAt, 'Android APK read');
      const chunk = Buffer.allocUnsafe(Math.min(ANDROID_CAMERA_APK_READ_CHUNK_BYTES, remaining));
      const result = await descriptor.read(chunk, 0, chunk.length, null);
      assert(result.bytesRead > 0, 'Android APK read made no progress');
      const readBytes = chunk.subarray(0, result.bytesRead);
      digest.update(readBytes);
      bytesRead += result.bytesRead;
      remaining -= result.bytesRead;
      assert(
        bytesRead <= ANDROID_CAMERA_APK_MAX_BYTES,
        'Android APK read exceeded its bounded build limit',
      );
      throwIfExpired(signal, deadlineAt, 'Android APK read');
    }
    throwIfExpired(signal, deadlineAt, 'Android APK read');
    const descriptorAfter = await descriptor.stat();
    const pathAfter = await lstat(resolvedPath);
    assert.equal(
      await realpath(resolvedPath),
      resolvedPath,
      'Android APK path became non-canonical while reading',
    );
    assert(
      descriptorAfter.isFile() && !descriptorAfter.isSymbolicLink(),
      'Android APK changed to a non-file',
    );
    assert(
      pathAfter.isFile() && !pathAfter.isSymbolicLink(),
      'Android APK path changed to a non-file',
    );
    assert.equal(descriptorAfter.dev, descriptorBefore.dev, 'Android APK changed while reading');
    assert.equal(descriptorAfter.ino, descriptorBefore.ino, 'Android APK changed while reading');
    assert.equal(pathAfter.dev, descriptorBefore.dev, 'Android APK path changed while reading');
    assert.equal(pathAfter.ino, descriptorBefore.ino, 'Android APK path changed while reading');
    assert.equal(descriptorAfter.uid, before.uid, 'Android APK owner changed while reading');
    assert.equal(pathAfter.uid, before.uid, 'Android APK path owner changed while reading');
    assert.equal(descriptorAfter.gid, before.gid, 'Android APK group changed while reading');
    assert.equal(pathAfter.gid, before.gid, 'Android APK path group changed while reading');
    assert.equal(
      descriptorAfter.mode & 0o777,
      before.mode & 0o777,
      'Android APK mode changed while reading',
    );
    assert.equal(
      pathAfter.mode & 0o777,
      before.mode & 0o777,
      'Android APK path mode changed while reading',
    );
    assert.equal(
      descriptorAfter.nlink,
      before.nlink,
      'Android APK link count changed while reading',
    );
    assert.equal(
      pathAfter.nlink,
      before.nlink,
      'Android APK path link count changed while reading',
    );
    assert.equal(descriptorAfter.size, before.size, 'Android APK size changed while reading');
    assert.equal(pathAfter.size, before.size, 'Android APK path size changed while reading');
    assert.equal(
      descriptorAfter.mtimeMs,
      before.mtimeMs,
      'Android APK modified time changed while reading',
    );
    assert.equal(
      pathAfter.mtimeMs,
      before.mtimeMs,
      'Android APK path modified time changed while reading',
    );
    assert.equal(
      descriptorAfter.ctimeMs,
      before.ctimeMs,
      'Android APK metadata changed while reading',
    );
    assert.equal(
      pathAfter.ctimeMs,
      before.ctimeMs,
      'Android APK path metadata changed while reading',
    );
    assert.equal(bytesRead, before.size, 'Android APK byte count changed');
    const binaryHash = digest.digest('hex');
    assert.equal(binaryHash, expectedHash, 'Android APK hash differs from build receipt');
    throwIfExpired(signal, deadlineAt, 'Android APK read');
    return {
      path: path.relative(resolvedRoot, resolvedPath),
      sha256: binaryHash,
      sizeBytes: bytesRead,
      identity: {
        dev: pathAfter.dev,
        ino: pathAfter.ino,
        uid: pathAfter.uid,
        gid: pathAfter.gid,
        mode: pathAfter.mode & 0o777,
        size: pathAfter.size,
        mtimeMs: pathAfter.mtimeMs,
        ctimeMs: pathAfter.ctimeMs,
        nlink: pathAfter.nlink,
      },
    };
  } finally {
    await descriptor.close();
  }
}

/** Source controls exercise the same private reader used by production eligibility. */
export const readAndroidCameraBuildArtifact = readBuildArtifact;

function sourceHelperRows(value: unknown, label: string): { path: string; sha256: string }[] {
  assert(Array.isArray(value) && value.length > 0, `${label} are missing`);
  const rows = value.map((item, index) => {
    const row = record(item, `${label}[${index}]`);
    const relativePath = relative(row.path, `${label}[${index}].path`);
    assert(
      relativePath === 'package.json' ||
        relativePath.startsWith('.maestro/') ||
        relativePath.startsWith('scripts/testing/') ||
        relativePath.startsWith('scripts/ci/'),
      `${label}[${index}] is outside the owned source roots`,
    );
    return {
      path: relativePath,
      sha256: requiredHash(row.sha256, `${label}[${index}].sha256`),
    };
  });
  assert.equal(
    new Set(rows.map((row) => row.path)).size,
    rows.length,
    `${label} contain duplicates`,
  );
  return rows;
}

async function verifyCurrentSourceAndHelpers(
  repositoryRoot: string,
  report: JsonRecord,
  signal?: AbortSignal,
  deadlineAt?: number,
): Promise<{
  source: NativeSourceIdentity;
  helperInputs: { path: string; sha256: string }[];
}> {
  const sourceBefore = record(report.source, 'Android camera source before');
  const sourceAfter = record(report.sourceAfter, 'Android camera source after');
  const currentSource = await androidSourceIdentity(repositoryRoot);
  assert.deepEqual(sourceBefore, currentSource, 'Android camera source before is stale');
  assert.deepEqual(sourceAfter, currentSource, 'Android camera source after is stale');
  const before = sourceHelperRows(report.helperInputsBefore, 'Android camera helper inputs before');
  const after = sourceHelperRows(report.helperInputsAfter, 'Android camera helper inputs after');
  assert.deepEqual(before, after, 'Android camera helper inputs changed during capture');
  await requireAndroidCameraCurrentSourceAndHelpers({
    repositoryRoot,
    expectedSource: currentSource,
    expectedHelperInputs: before,
    signal,
    deadlineAt,
  });
  return { source: currentSource, helperInputs: before };
}

async function requireCurrentHelperInputs(options: {
  repositoryRoot: string;
  expectedHelperInputs: readonly { path: string; sha256: string }[];
  signal?: AbortSignal;
  deadlineAt?: number;
}): Promise<void> {
  const deadlineAt = options.deadlineAt;
  const rootFenceBefore = await androidCameraSourceFence(options.repositoryRoot);
  let aggregateBytes = 0;
  for (const requiredPath of ANDROID_CAMERA_DETOX_RUNTIME_HELPER_PATHS)
    assert(
      options.expectedHelperInputs.some((row) => row.path === requiredPath),
      `Android camera helper inputs omit ${requiredPath}`,
    );
  for (const row of options.expectedHelperInputs) {
    throwIfExpired(options.signal, deadlineAt, 'Android camera helper closure');
    const sourceFenceBefore = await androidCameraSourceFence(options.repositoryRoot, row.path);
    const absolute = path.resolve(options.repositoryRoot, row.path);
    assert(
      absolute.startsWith(options.repositoryRoot + path.sep),
      `Android helper ${row.path} escaped the source root`,
    );
    assert.equal(await realpath(absolute), absolute, `Android helper ${row.path} is not canonical`);
    const info = await lstat(absolute);
    assert(
      info.isFile() &&
        !info.isSymbolicLink() &&
        info.uid === process.getuid?.() &&
        info.nlink === 1 &&
        (info.mode & 0o022) === 0 &&
        info.size > 0 &&
        info.size <= ANDROID_CAMERA_HELPER_MAX_FILE_BYTES,
      `Android helper ${row.path} is not a bounded owned file`,
    );
    aggregateBytes += info.size;
    assert(
      aggregateBytes <= ANDROID_CAMERA_HELPER_MAX_AGGREGATE_BYTES,
      'Android camera helper closure exceeds its aggregate byte cap',
    );
    const observation = await readAndroidCameraHelperDescriptor({
      repositoryRoot: options.repositoryRoot,
      relativePath: row.path,
      signal: options.signal,
      deadlineAt,
    });
    throwIfExpired(options.signal, deadlineAt, 'Android camera helper closure');
    const sourceFenceAfter = await androidCameraSourceFence(options.repositoryRoot, row.path);
    assert.deepEqual(
      sourceFenceAfter,
      sourceFenceBefore,
      `Android camera helper root or ancestor changed: ${row.path}`,
    );
    assert.equal(
      observation.identity.size,
      info.size,
      `Android helper ${row.path} size changed during bounded read`,
    );
    assert.equal(hash(observation.bytes), row.sha256, `Android helper ${row.path} is stale`);
  }
  throwIfExpired(options.signal, deadlineAt, 'Android camera helper closure');
  assert.deepEqual(
    await androidCameraSourceFence(options.repositoryRoot),
    rootFenceBefore,
    'Android camera helper source root changed during closure read',
  );
}

/** Re-read source and helper identities immediately before terminal publication. */
export async function requireAndroidCameraCurrentSourceAndHelpers(options: {
  repositoryRoot: string;
  expectedSource: NativeSourceIdentity;
  expectedHelperInputs: readonly { path: string; sha256: string }[];
  signal?: AbortSignal;
  deadlineAt?: number;
}): Promise<void> {
  throwIfExpired(options.signal, options.deadlineAt, 'Android camera source and helper closure');
  const currentSource = await androidSourceIdentity(options.repositoryRoot);
  assert.deepEqual(
    currentSource,
    options.expectedSource,
    'Android camera source changed before finalization',
  );
  await requireCurrentHelperInputs(options);
}

function validateTarget(target: NativePilotTarget): asserts target is NativePilotTarget & {
  deviceId: string;
  osVersion: string;
  appId: string;
  buildProfile: string;
  binaryHash: string;
  apiOrigin: string;
} {
  assert.equal(target.deviceId?.startsWith('emulator-'), true, 'Android target device is invalid');
  assert(typeof target.osVersion === 'string' && target.osVersion.length > 0);
  assert.equal(target.appId, 'com.edufelip.mychampions.dev');
  assert.equal(target.buildProfile, CAMERA_PROFILE);
  assert.match(target.binaryHash ?? '', HASH, 'Android target binary hash is invalid');
  assert.match(target.apiOrigin ?? '', LOOPBACK, 'Android target API origin is not loopback');
}

function validateRuntime(
  runtime: AndroidCameraPublicAttemptResult,
  input: AndroidCameraRuntimeEligibilityInput,
): void {
  assert.equal(runtime.kind, 'private-owned-android-camera-public-attempt-not-public-receipt');
  assert.equal(runtime.requestedRunId, input.requestedRunId);
  assert.equal(runtime.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.equal(runtime.captureRunId, input.captureRunId);
  assert.equal(runtime.fixtureRunId, input.fixtureRunId);
  assert.equal(runtime.captureExitCode, 0);
  assert.equal(runtime.childExitCode, 0);
  assert.equal(runtime.childSignal, null);
  assert.equal(runtime.childClassification, 'completed');
  assert.equal(runtime.captureResult, 'observed');
  assert.equal(runtime.captureCleanup, 'cleaned');
  assert.equal(runtime.captureTimeout, null);
  assert.equal(runtime.cancellation, null);
  assert.equal(runtime.callbackInvocations, 1);
  assert.equal(runtime.callbackCompleted, true);
  assert.deepEqual(runtime.captureInvocation, {
    count: 1,
    returned: true,
    exitCode: 0,
    result: 'observed',
  });
  assert.equal(runtime.captureCompleted, true);
  assert.equal(runtime.externalCleanupResult, 'passed');
  assert.equal(runtime.verificationResult, 'source-only');
  assert.equal(runtime.verificationFailure, null);
  assert.equal(runtime.postCaptureFailure, null);
  assert.equal(runtime.deadline, null);
  assert.equal(runtime.cancellation, null);
  assert.equal(runtime.censusFailures.length, 0);
  assert.equal(runtime.outputFailures.length, 0);
  assert.deepEqual(runtime.assertionIds, [...ANDROID_CAMERA_ASSERTION_IDS]);
  assert.equal(runtime.publicPromotionEligible, false);
  assert.equal(runtime.nativePassingCases, 0);
  assert.equal(runtime.publicPassingCases, 0);
  assert(runtime.cameraProducer, 'Android camera runtime producer receipt is missing');
  assert.equal(
    input.runtimeProvenance,
    undefined,
    'source-only controls cannot carry runtime provenance',
  );
  assert.equal(
    input.nativeDriver,
    undefined,
    'source-only controls cannot carry native driver evidence',
  );
}

function validateCaptureReport(
  report: JsonRecord,
  input: AndroidCameraRuntimeEligibilityInput,
): void {
  assert.equal(report.kind, 'private-owned-native-camera-denied-execution-not-public-receipt');
  assert.equal(report.platform, 'android');
  assert.equal(report.charter, 'camera-denied');
  assert.equal(report.mode, 'integration');
  assert.equal(report.captureRunId, input.captureRunId);
  assert.equal(report.result, 'observed');
  assert.equal(report.cleanup, 'cleaned');
  assert.equal(report.nativePassingCases, 0);
  assert.equal(report.androidCameraCallbackInvocations, 1);
  assert.equal(report.androidCameraCallbackCompleted, true);
  assert.equal(report.error, undefined);
  const backend = record(report.backend, 'Android camera backend');
  assert.equal(backend.runId, input.fixtureRunId);
  assert.equal(backend.backendAttemptId, `${input.fixtureRunId}:first`);
  assert.equal(backend.apiOrigin, input.producer.identity.apiOrigin);
  const apiProcess = record(backend.apiProcess, 'Android camera backend API process');
  assert.equal(apiProcess.pid, input.producer.identity.apiPid);
  assert.equal(apiProcess.started, input.producer.identity.apiStarted);
  assert.equal(apiProcess.script, input.producer.identity.apiScript);
  assert.equal(
    record(report.device, 'Android camera device').runId,
    input.producer.identity.ownerRunId,
  );
  const producer = record(report.androidCameraProducer, 'Android camera producer report');
  assert.equal(producer.producerStatus, 'receipts-bound');
  assert.equal(producer.captureRunId, input.captureRunId);
  assert.equal(producer.sourceSelectionHash, androidCameraSelectionHash(input.selection));
  assert.equal(producer.localeStatus, 'qualified');
  assert.deepEqual(
    producer.primaryFixtureAuthUids,
    input.producer.primaryFixtureAuthUids,
    'Android persisted primary fixture identities differ from the producer binding',
  );
  assert.deepEqual(
    producer.primaryExpected,
    input.producer.primaryExpected,
    'Android persisted primary expected identity differs from the producer binding',
  );
  assert.deepEqual(
    producer.isolationExpected,
    input.producer.isolationExpected,
    'Android persisted isolation expected identity differs from the producer binding',
  );
  assert.deepEqual(
    producer.isolationFixture,
    input.producer.isolationFixture,
    'Android persisted isolation fixture differs from the producer binding',
  );
}

type RuntimeFrameAction = {
  label: string;
  path: string;
  invocationId: string;
  ordinal: number;
  commandOrdinal: number;
  commandLabel: string;
};

type RuntimeSqlParent = {
  parentRoot: string;
  parentManifestPath: 'manifest.json';
  parentManifestRetainedPath: string;
  parentManifestRetainedKind: 'sidecar';
  parentManifestRetainedSha256: string;
  parentManifestRetainedSizeBytes: number;
  parentManifestRetainedOwnerUid: number;
  parentManifestRetainedMode: number;
  parentManifestRetainedVerification: 'owned-stable-reader-v6';
  parentManifestSizeBytes: number;
  retainedPath: string;
  retainedKind: 'sidecar';
  retainedSha256: string;
  retainedSizeBytes: number;
  retainedOwnerUid: number;
  retainedMode: number;
  retainedVerification: 'owned-stable-reader-v6';
  parentApiLedgerPath: string;
  parentApiLedgerRetainedPath: string;
  parentApiLedgerRetainedKind: 'sidecar';
  parentApiLedgerRetainedSha256: string;
  parentApiLedgerRetainedSizeBytes: number;
  parentApiLedgerRetainedOwnerUid: number;
  parentApiLedgerRetainedMode: number;
  parentApiLedgerRetainedVerification: 'owned-stable-reader-v6';
  parentApiLedgerSizeBytes: number;
  path: string;
  sha256: string;
  runId: string;
  attemptId: string;
  apiOrigin: string;
  apiPid: number;
  apiStarted: string;
  apiScript: string;
  manifestSha256: string;
  apiAttempt: string;
  apiLedgerSha256: string;
};

type NativeRuntimeReceipt = {
  kind: 'private-owned-android-camera-native-runtime-receipt';
  status: 'observed';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  fixtureRunId: string;
  ownerRunId: string;
  selectionHash: string;
  target: NativePilotTarget;
  sourceTreeHash: string;
  helperInputs: readonly { path: string; sha256: string }[];
  deadlineAt: number;
  captureReport: { path: 'capture.private.json'; sha256: string };
  driver: AndroidCameraNativeRuntimeDriverResult;
  frameActions: readonly RuntimeFrameAction[];
  sqlParents: readonly RuntimeSqlParent[];
};

function requiredRunId(value: unknown, label: string): string {
  const result = stringValue(value, label);
  assert.match(result, RUN_ID, `${label} is not a run ID`);
  return result;
}

function requireRuntimeHelperRows(
  value: unknown,
  expected: readonly { path: string; sha256: string }[],
): void {
  assert(Array.isArray(value), 'Android native runtime helper inputs are missing');
  for (const requiredPath of ANDROID_CAMERA_DETOX_RUNTIME_HELPER_PATHS)
    assert(
      value.some(
        (row) =>
          row && typeof row === 'object' && (row as { path?: unknown }).path === requiredPath,
      ),
      `Android native runtime helper inputs omit ${requiredPath}`,
    );
  assert.deepEqual(
    value,
    expected,
    'Android native runtime helper inputs are not the captured inputs',
  );
}

function requireRuntimeFrameActions(value: unknown, producer: AndroidCameraProducerReceipts): void {
  assert(Array.isArray(value), 'Android native runtime frame-action provenance is missing');
  const expected = producer.frames.map((frame) => ({
    label: frame.label,
    path: frame.path,
    invocationId: frame.action.invocationId,
    ordinal: frame.action.ordinal,
    commandOrdinal: frame.action.commandOrdinal,
    commandLabel: frame.action.commandLabel,
  }));
  assert.deepEqual(
    value,
    expected,
    'Android native runtime frame-action provenance is not producer-bound',
  );
}

function requireRuntimeSqlParents(value: unknown, producer: AndroidCameraProducerReceipts): void {
  assert(Array.isArray(value), 'Android native runtime SQL-parent provenance is missing');
  const expected = producer.sqlReceipts.map((receipt) => ({
    parentRoot: receipt.parentSnapshotRoot,
    parentManifestPath: receipt.parentManifestPath,
    parentManifestRetainedPath: receipt.parentManifestRetainedPath,
    parentManifestRetainedKind: receipt.parentManifestRetainedKind,
    parentManifestRetainedSha256: receipt.parentManifestRetainedSha256,
    parentManifestRetainedSizeBytes: receipt.parentManifestRetainedSizeBytes,
    parentManifestRetainedOwnerUid: receipt.parentManifestRetainedOwnerUid,
    parentManifestRetainedMode: receipt.parentManifestRetainedMode,
    parentManifestRetainedVerification: receipt.parentManifestRetainedVerification,
    parentManifestSizeBytes: receipt.parentManifestSizeBytes,
    retainedPath: receipt.parentSnapshotRetainedPath,
    retainedKind: receipt.parentSnapshotRetainedKind,
    retainedSha256: receipt.parentSnapshotRetainedSha256,
    retainedSizeBytes: receipt.parentSnapshotRetainedSizeBytes,
    retainedOwnerUid: receipt.parentSnapshotRetainedOwnerUid,
    retainedMode: receipt.parentSnapshotRetainedMode,
    retainedVerification: receipt.parentSnapshotRetainedVerification,
    parentApiLedgerPath: receipt.parentApiLedgerPath,
    parentApiLedgerRetainedPath: receipt.parentApiLedgerRetainedPath,
    parentApiLedgerRetainedKind: receipt.parentApiLedgerRetainedKind,
    parentApiLedgerRetainedSha256: receipt.parentApiLedgerRetainedSha256,
    parentApiLedgerRetainedSizeBytes: receipt.parentApiLedgerRetainedSizeBytes,
    parentApiLedgerRetainedOwnerUid: receipt.parentApiLedgerRetainedOwnerUid,
    parentApiLedgerRetainedMode: receipt.parentApiLedgerRetainedMode,
    parentApiLedgerRetainedVerification: receipt.parentApiLedgerRetainedVerification,
    parentApiLedgerSizeBytes: receipt.parentApiLedgerSizeBytes,
    path: receipt.parentSnapshotPath,
    sha256: receipt.parentSnapshotSha256,
    runId: receipt.parentRunId,
    attemptId: receipt.parentBackendAttemptId,
    apiOrigin: receipt.parentApiOrigin,
    apiPid: receipt.parentApiPid,
    apiStarted: receipt.parentApiStarted,
    apiScript: receipt.parentApiScript,
    manifestSha256: receipt.parentManifestSha256,
    apiAttempt: receipt.parentApiAttempt,
    apiLedgerSha256: receipt.parentApiLedgerSha256,
  }));
  assert.deepEqual(value, expected, 'Android native runtime SQL parents are not producer-bound');
}

async function verifyNativeRuntimeProvenance(
  captureRoot: string,
  reportBytes: Buffer,
  input: AndroidCameraRuntimeEligibilityInput,
  source: NativeSourceIdentity,
  helperInputs: readonly { path: string; sha256: string }[],
  producer: AndroidCameraProducerReceipts,
  sqlPaths: readonly string[],
): Promise<AndroidCameraNativeRuntimeProvenance> {
  const provenance = input.runtimeProvenance;
  assert(provenance, 'native runtime provenance is required before runtime eligibility');
  assert.equal(provenance.mode, 'native-runtime');
  const driver = input.nativeDriver;
  assert(driver, 'native runtime driver evidence is required before eligibility');
  const expectedDriver = requireAndroidCameraNativeRuntimeDriver(driver, {
    requestedRunId: input.requestedRunId,
    captureRunId: input.captureRunId,
    fixtureRunId: input.fixtureRunId,
    selection: input.selection,
    target: input.target,
    producer,
    sourceTreeHash: source.sourceTreeHash,
    helperInputs,
    captureReportSha256: hash(reportBytes),
    deadlineAt: input.deadlineAt!,
  });
  const receiptPath = relative(provenance.receiptPath, 'Android native runtime provenance path');
  assert(
    receiptPath !== 'capture.private.json',
    'native runtime provenance cannot alias the capture report',
  );
  const loaded = await readJsonArtifact(
    captureRoot,
    receiptPath,
    'sidecar',
    512 * 1024,
    input.signal,
  );
  assert.equal(
    hash(loaded.bytes),
    provenance.receiptSha256,
    'native runtime provenance receipt hash changed',
  );
  const receipt = record(
    loaded.value,
    'Android native runtime provenance receipt',
  ) as NativeRuntimeReceipt;
  assert.equal(receipt.kind, 'private-owned-android-camera-native-runtime-receipt');
  assert.equal(receipt.status, 'observed');
  assert.equal(
    requiredRunId(receipt.requestedRunId, 'native runtime requested run'),
    input.requestedRunId,
  );
  assert.equal(receipt.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.equal(receipt.requestedAttemptId, input.requestedAttemptId);
  assert.equal(
    requiredRunId(receipt.captureRunId, 'native runtime capture run'),
    input.captureRunId,
  );
  assert.equal(
    requiredRunId(receipt.fixtureRunId, 'native runtime fixture run'),
    input.fixtureRunId,
  );
  assert.equal(
    requiredRunId(receipt.ownerRunId, 'native runtime owner run'),
    producer.identity.ownerRunId,
    'native runtime owner run is not producer-bound',
  );
  assert.equal(receipt.selectionHash, androidCameraSelectionHash(input.selection));
  assert.deepEqual(receipt.target, input.target, 'native runtime target provenance differs');
  assert.equal(
    receipt.sourceTreeHash,
    source.sourceTreeHash,
    'native runtime source identity differs',
  );
  requireRuntimeHelperRows(receipt.helperInputs, helperInputs);
  assert(Number.isFinite(input.deadlineAt), 'native runtime deadline must be explicit');
  assert.equal(receipt.deadlineAt, input.deadlineAt, 'native runtime deadline is not caller-bound');
  assert.deepEqual(receipt.captureReport, {
    path: 'capture.private.json',
    sha256: hash(reportBytes),
  });
  assert.deepEqual(receipt.driver, expectedDriver, 'native runtime driver provenance changed');
  requireRuntimeFrameActions(receipt.frameActions, producer);
  requireRuntimeSqlParents(receipt.sqlParents, producer);
  assert.deepEqual(
    producer.sqlReceipts.map((receipt) => receipt.path),
    sqlPaths,
    'native runtime SQL receipt order differs',
  );
  return provenance;
}

async function verifyBuildAndTarget(
  captureRoot: string,
  report: JsonRecord,
  target: NativePilotTarget,
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<AndroidCameraRuntimeEvidenceProof['build']> {
  validateTarget(target);
  const build = record(report.build, 'Android camera build');
  const device = record(report.device, 'Android camera device');
  assert.equal(device.serial, target.deviceId);
  assert.equal(device.osVersion, target.osVersion);
  assert.equal(build.appId, target.appId);
  assert.equal(build.profile, CAMERA_BUILD_PROFILE);
  assert.equal(build.launcher, 'com.edufelip.mychampions.MainActivity');
  assert.equal(build.debuggable, true);
  assert.match(
    String(build.signingCertificateHash),
    HASH,
    'Android APK signing identity is missing',
  );
  assert.match(
    String(build.environmentHash),
    HASH,
    'Android embedded environment identity is missing',
  );
  assert.equal(build.binaryHash, target.binaryHash);
  assert.equal(build.apiOrigin, target.apiOrigin);
  const binaryPath = stringValue(build.binaryPath, 'Android camera build binaryPath');
  return readBuildArtifact(captureRoot, binaryPath, target.binaryHash, deadlineAt, signal);
}

function validateProducerIdentity(
  producer: AndroidCameraProducerReceipts,
  input: AndroidCameraRuntimeEligibilityInput,
  localeBinding: NativeLocaleBinding,
): void {
  requireAndroidCameraProducerOutput(producer, {
    selectionHash: androidCameraSelectionHash(input.selection),
    runId: input.captureRunId,
  });
  assert.equal(producer.identity.captureRunId, input.captureRunId);
  assert.equal(producer.identity.backendRunId, input.fixtureRunId);
  assert.equal(producer.identity.backendAttemptId, `${input.fixtureRunId}:first`);
  assert.equal(producer.identity.target.deviceId, input.target.deviceId);
  assert.equal(producer.identity.target.osVersion, input.target.osVersion);
  assert.equal(producer.identity.target.appId, input.target.appId);
  assert.equal(producer.identity.target.buildProfile, input.target.buildProfile);
  assert.equal(producer.identity.target.binaryHash, input.target.binaryHash);
  assert.equal(producer.identity.serial, input.target.deviceId);
  assert.equal(producer.identity.appId, input.target.appId);
  assert.equal(producer.identity.apiPid > 1, true);
  assert.equal(producer.identity.apiStarted.length > 0, true);
  assert.equal(producer.identity.apiScript.length > 0, true);
  assert.equal(producer.identity.target.apiOrigin, input.target.apiOrigin);
  assert.equal(producer.identity.locale.binding.captureRunId, input.captureRunId);
  assert.deepEqual(producer.identity.locale.binding, localeBinding);
  assert.equal(producer.identity.locale.requestedLocale, input.expectedLocale);
  assert.equal(producer.identity.locale.effectiveAppLocale.value, input.expectedLocale);
  assert.equal(producer.identity.locale.effectiveAppLocale.hydration, 'hydrated');
  assert.equal(producer.identity.locale.observedOsLocale.resolved, input.expectedLocale);
  assert.equal(producer.permission.status, 'denied');
  assert.equal(producer.permission.before.status, 'denied');
  assert.equal(producer.permission.after.status, 'denied');
  assert.equal(
    producer.isolationFixture.source,
    'owned-session.fixtures',
    'Android isolation fixture is not owned-session evidence',
  );
  assert.equal(
    producer.isolationFixture.path,
    'fixtures-native-connection-isolation-android.private.json',
  );
  assert.equal(producer.isolationFixture.runId, input.fixtureRunId);
  assert.equal(producer.isolationExpected.runId, input.fixtureRunId);
  assert.equal(producer.isolationExpected.scope, producer.isolationFixture.scope);
  assert.deepEqual(
    [...(producer.isolationExpected.fixtureAuthUids ?? [])].sort(),
    [...producer.isolationFixture.fixtureAuthUids].sort(),
    'Android isolation fixture identities are not producer-bound',
  );
  assert.equal(
    producer.isolationExpected.target?.professionalAuthUid,
    producer.isolationFixture.target.professionalAuthUid,
  );
  assert.equal(
    producer.isolationExpected.target?.studentAuthUid,
    producer.isolationFixture.target.studentAuthUid,
  );
}

async function verifyTransport(
  captureRoot: string,
  producer: AndroidCameraProducerReceipts,
  signal?: AbortSignal,
): Promise<void> {
  const loaded = await readJsonArtifact(
    captureRoot,
    'transport-observations.private.json',
    'transport',
    1 * 1024 * 1024,
    signal,
  );
  assert(Array.isArray(loaded.value), 'Android camera transport rows are not an array');
  const identity: AndroidCameraApiIdentity = {
    runId: producer.identity.backendRunId,
    attemptId: producer.identity.backendAttemptId,
    apiOrigin: producer.identity.apiOrigin,
    apiPid: producer.identity.apiPid,
    apiStarted: producer.identity.apiStarted,
    apiScript: producer.identity.apiScript,
    backendAttemptId: producer.identity.backendAttemptId,
  };
  const result = await requireAndroidCameraTransport({
    artifactRoot: captureRoot,
    observations: loaded.value as never,
    beforeRequestId: producer.transportRequestWindow.beforeRequestId,
    throughRequestId: producer.transportRequestWindow.throughRequestId,
    allowedRoutes: ['/connections', '/connections/invite-submissions', '/analytics/events'],
    targetOrigin: producer.identity.apiOrigin,
    identity,
    request: producer.submission,
  });
  assert.equal(result.requestId, producer.submissionRequestId);
}

function requireReceiptShape(value: JsonRecord, label: string): void {
  assert.equal(value.kind, 'query', `${label} kind is not query`);
  assert(
    typeof value.parentSnapshotRoot === 'string' &&
      path.isAbsolute(value.parentSnapshotRoot) &&
      path.resolve(value.parentSnapshotRoot) === value.parentSnapshotRoot,
    `${label} parent root is invalid`,
  );
  assert.equal(value.parentManifestPath, 'manifest.json', `${label} manifest path is invalid`);
  assert(
    typeof value.parentManifestRetainedPath === 'string' &&
      value.parentManifestRetainedPath.length > 0 &&
      !path.isAbsolute(value.parentManifestRetainedPath) &&
      !value.parentManifestRetainedPath.split(/[\\/]/u).includes('..') &&
      value.parentManifestRetainedPath !== value.parentManifestPath,
    `${label} retained manifest path is invalid`,
  );
  assert.equal(value.parentManifestRetainedKind, 'sidecar');
  assert.match(String(value.parentManifestRetainedSha256), HASH);
  assert(
    Number.isSafeInteger(value.parentManifestRetainedSizeBytes) &&
      Number.isSafeInteger(value.parentManifestSizeBytes) &&
      value.parentManifestRetainedSizeBytes === value.parentManifestSizeBytes,
    `${label} retained manifest size is invalid`,
  );
  assert.equal(value.parentManifestRetainedOwnerUid, process.getuid?.());
  assert.equal(value.parentManifestRetainedMode, 0o600);
  assert.equal(value.parentManifestRetainedVerification, 'owned-stable-reader-v6');
  assert(
    Number.isSafeInteger(value.sizeBytes) && Number(value.sizeBytes) > 0,
    `${label} size is invalid`,
  );
  assert(
    typeof value.parentSnapshotRetainedPath === 'string' &&
      value.parentSnapshotRetainedPath.length > 0 &&
      !path.isAbsolute(value.parentSnapshotRetainedPath) &&
      !value.parentSnapshotRetainedPath.split(/[\\/]/u).includes('..') &&
      value.parentSnapshotRetainedPath !== value.parentSnapshotPath,
    `${label} retained parent path is invalid`,
  );
  assert.equal(value.parentSnapshotRetainedKind, 'sidecar');
  assert.match(String(value.parentSnapshotRetainedSha256), HASH);
  assert(
    Number.isSafeInteger(value.parentSnapshotRetainedSizeBytes) &&
      value.parentSnapshotRetainedSizeBytes === value.parentSnapshotSizeBytes,
    `${label} retained parent size is invalid`,
  );
  assert.equal(value.parentSnapshotRetainedOwnerUid, process.getuid?.());
  assert.equal(value.parentSnapshotRetainedMode, 0o600);
  assert.equal(value.parentSnapshotRetainedVerification, 'owned-stable-reader-v6');
  assert.match(String(value.sha256), HASH, `${label} hash is invalid`);
  assert.equal(value.ownerUid, process.getuid?.(), `${label} owner is invalid`);
  assert.equal(value.mode, 0o600, `${label} mode is invalid`);
  assert.equal(value.verification, 'owned-stable-reader-v6', `${label} reader is invalid`);
  assert(typeof value.scope === 'string' && value.scope.length > 0, `${label} scope is missing`);
  assert(
    typeof value.queryId === 'string' && value.queryId.length > 0,
    `${label} query ID is missing`,
  );
  assert.match(String(value.parentSnapshotSha256), HASH, `${label} parent hash is invalid`);
  assert.equal(value.parentSnapshotMode, 0o600, `${label} parent mode is invalid`);
  assert.equal(value.parentSnapshotVerification, 'owned-runtime-document-v6');
  assert.match(
    String(value.parentManifestSha256),
    HASH,
    `${label} parent manifest hash is invalid`,
  );
  assert(
    typeof value.parentApiAttempt === 'string' && /^[a-z0-9-]{1,48}$/u.test(value.parentApiAttempt),
    `${label} API attempt is invalid`,
  );
  assert.match(String(value.parentApiLedgerSha256), HASH, `${label} API ledger hash is invalid`);
  const expectedApiLedgerPath =
    value.parentApiAttempt === 'session-start'
      ? 'api-session-start.json'
      : `api-${value.parentApiAttempt}.json`;
  assert(
    typeof value.parentApiLedgerPath === 'string' &&
      /^api-[a-z0-9-]+\.json$/u.test(value.parentApiLedgerPath),
    `${label} API ledger path is invalid`,
  );
  assert(
    typeof value.parentApiLedgerRetainedPath === 'string' &&
      value.parentApiLedgerRetainedPath.length > 0 &&
      !path.isAbsolute(value.parentApiLedgerRetainedPath) &&
      !value.parentApiLedgerRetainedPath.split(/[\\/]/u).includes('..') &&
      value.parentApiLedgerRetainedPath !== value.parentApiLedgerPath,
    `${label} retained API ledger path is invalid`,
  );
  assert.equal(value.parentApiLedgerRetainedKind, 'sidecar');
  assert.match(String(value.parentApiLedgerRetainedSha256), HASH);
  assert(
    Number.isSafeInteger(value.parentApiLedgerRetainedSizeBytes) &&
      Number.isSafeInteger(value.parentApiLedgerSizeBytes) &&
      value.parentApiLedgerRetainedSizeBytes === value.parentApiLedgerSizeBytes,
    `${label} retained API ledger size is invalid`,
  );
  assert.equal(value.parentApiLedgerRetainedOwnerUid, process.getuid?.());
  assert.equal(value.parentApiLedgerRetainedMode, 0o600);
  assert.equal(value.parentApiLedgerRetainedVerification, 'owned-stable-reader-v6');
  assert.equal(value.parentApiLedgerPath, expectedApiLedgerPath);
  assert(
    typeof value.parentApiStarted === 'string' && value.parentApiStarted.length > 0,
    `${label} API start is invalid`,
  );
  assert(
    typeof value.parentApiScript === 'string' && value.parentApiScript.length > 0,
    `${label} API script is invalid`,
  );
  assert.match(
    String(value.parentFixtureAuthUidAllowlistHash),
    HASH,
    `${label} fixture hash is invalid`,
  );
  assert(
    value.sourceProjection === 'owned-session.connection-snapshot-v1.rows' ||
      value.sourceProjection === 'owned-session.domain-snapshot-v1.document',
    `${label} source projection is invalid`,
  );
}

function requireRetainedParentProvenance(
  input: {
    manifest: unknown;
    ledger: unknown;
    parentRoot: string;
    runId: string;
    apiPid: number;
    apiStarted: string;
    apiScript: string;
    apiOrigin: string;
    apiAttempt: string;
  },
  label: string,
): void {
  assertTestingDocument('resource-manifest-v1', input.manifest);
  const manifest = record(input.manifest, `${label} manifest`);
  assert.equal(manifest.artifactRoot, input.parentRoot, `${label} manifest root changed`);
  assert.equal(manifest.runId, input.runId, `${label} manifest run changed`);
  assert(typeof manifest.ownerTokenHash === 'string' && HASH.test(manifest.ownerTokenHash));
  assert(Array.isArray(manifest.processes), `${label} manifest process census is missing`);
  const api = manifest.processes.find(
    (row: unknown) => row && typeof row === 'object' && (row as JsonRecord).role === 'api',
  ) as JsonRecord | undefined;
  assert(api, `${label} manifest API process is missing`);
  assert.equal(api.pid, input.apiPid, `${label} manifest API PID changed`);
  assert.equal(api.started, input.apiStarted, `${label} manifest API start changed`);
  assert.equal(api.script, input.apiScript, `${label} manifest API script changed`);
  assertTestingDocument('api-process-v1', input.ledger);
  const ledger = record(input.ledger, `${label} API ledger`);
  assert.equal(ledger.runId, input.runId, `${label} API ledger run changed`);
  assert.equal(ledger.ownerTokenHash, manifest.ownerTokenHash, `${label} API ledger owner changed`);
  assert.equal(ledger.pid, input.apiPid, `${label} API ledger PID changed`);
  assert.equal(ledger.started, input.apiStarted, `${label} API ledger start changed`);
  assert.equal(ledger.script, input.apiScript, `${label} API ledger script changed`);
  assert.equal(ledger.attempt, input.apiAttempt, `${label} API ledger attempt changed`);
  assert.equal(ledger.origin, input.apiOrigin, `${label} API ledger origin changed`);
}

async function verifySql(
  captureRoot: string,
  producer: AndroidCameraProducerReceipts,
  signal?: AbortSignal,
): Promise<string[]> {
  const phaseSet = new Set<string>();
  const tableSet = new Map<string, Set<string>>();
  const paths = new Set<string>();
  const queryIds = new Set<string>();
  const expectedScopes: Record<string, string> = {
    before: 'native-entry-android',
    pending: 'native-entry-android',
    'isolation-before': 'native-conn-isolation-android',
    'isolation-after': 'native-conn-isolation-android',
    'training-before': 'native-entry-android',
    'training-after': 'native-entry-android',
  };
  const canonical = producer.sqlReceipts[0];
  assert(canonical, 'Android camera SQL producer receipts are missing');
  for (const receipt of producer.sqlReceipts) {
    const value = record(receipt, 'Android camera SQL receipt');
    requireReceiptShape(value, `Android camera SQL ${String(value.phase)}`);
    assert(SQL_PHASES.includes(value.phase as (typeof SQL_PHASES)[number]), 'Unknown SQL phase');
    assert.equal(value.scope, expectedScopes[value.phase as string]);
    assert.equal(value.parentRunId, producer.identity.backendRunId);
    assert.equal(value.parentBackendAttemptId, producer.identity.backendAttemptId);
    assert.equal(value.parentApiOrigin, producer.identity.apiOrigin);
    assert.equal(value.parentApiPid, producer.identity.apiPid);
    assert.equal(value.parentApiStarted, producer.identity.apiStarted);
    assert.equal(value.parentApiScript, producer.identity.apiScript);
    assert.equal(value.parentManifestSha256, canonical.parentManifestSha256);
    assert.equal(value.parentApiAttempt, canonical.parentApiAttempt);
    assert.equal(value.parentApiLedgerSha256, canonical.parentApiLedgerSha256);
    assert(!paths.has(String(value.path)), 'Android camera SQL source path is duplicated');
    assert(!queryIds.has(String(value.queryId)), 'Android camera SQL query ID is duplicated');
    paths.add(String(value.path));
    queryIds.add(String(value.queryId));
    const phase = String(value.phase);
    phaseSet.add(phase);
    const tables = tableSet.get(phase) ?? new Set<string>();
    assert(
      value.table === 'domain' ||
        (ANDROID_CAMERA_SQL_TABLES as readonly string[]).includes(String(value.table)),
      'Android camera SQL table is outside the closed projection',
    );
    tables.add(String(value.table));
    tableSet.set(phase, tables);
    const child = await readJsonArtifact(
      captureRoot,
      relative(value.path, 'Android SQL child path'),
      'query',
      256 * 1024,
      signal,
    );
    assert.equal(
      child.bytes.length,
      value.sizeBytes,
      `Android camera SQL ${phase} child byte count changed`,
    );
    assert.equal(hash(child.bytes), value.sha256, `Android camera SQL ${phase} child hash changed`);
    const parentRoot = path.resolve(String(value.parentSnapshotRoot));
    assert.equal(
      parentRoot,
      value.parentSnapshotRoot,
      'Android SQL parent runtime root is not normalized',
    );
    assert.notEqual(
      parentRoot,
      path.resolve(captureRoot),
      'Android SQL parent runtime root must be distinct from the capture root',
    );
    const retained = await readJsonArtifact(
      captureRoot,
      relative(value.parentSnapshotRetainedPath, 'Android SQL retained parent path'),
      'sidecar',
      1 * 1024 * 1024,
      signal,
    );
    assert.equal(retained.bytes.length, value.parentSnapshotRetainedSizeBytes);
    assert.equal(hash(retained.bytes), value.parentSnapshotRetainedSha256);
    assert.equal(retained.identity.uid, value.parentSnapshotRetainedOwnerUid);
    assert.equal(retained.identity.mode & 0o777, value.parentSnapshotRetainedMode);
    assert.equal(retained.identity.nlink, 1);
    assert.equal(retained.bytes.length, value.parentSnapshotSizeBytes);
    assert.equal(hash(retained.bytes), value.parentSnapshotSha256);
    const manifest = await readJsonArtifact(
      captureRoot,
      relative(value.parentManifestRetainedPath, 'Android SQL retained parent manifest path'),
      'sidecar',
      1 * 1024 * 1024,
      signal,
    );
    assert.equal(manifest.bytes.length, value.parentManifestRetainedSizeBytes);
    assert.equal(manifest.bytes.length, value.parentManifestSizeBytes);
    assert.equal(hash(manifest.bytes), value.parentManifestRetainedSha256);
    assert.equal(hash(manifest.bytes), value.parentManifestSha256);
    assert.equal(manifest.identity.uid, value.parentManifestRetainedOwnerUid);
    assert.equal(manifest.identity.mode & 0o777, value.parentManifestRetainedMode);
    assert.equal(manifest.identity.nlink, 1);
    const ledger = await readJsonArtifact(
      captureRoot,
      relative(value.parentApiLedgerRetainedPath, 'Android SQL retained parent API ledger path'),
      'sidecar',
      1 * 1024 * 1024,
      signal,
    );
    assert.equal(ledger.bytes.length, value.parentApiLedgerRetainedSizeBytes);
    assert.equal(ledger.bytes.length, value.parentApiLedgerSizeBytes);
    assert.equal(hash(ledger.bytes), value.parentApiLedgerRetainedSha256);
    assert.equal(hash(ledger.bytes), value.parentApiLedgerSha256);
    assert.equal(ledger.identity.uid, value.parentApiLedgerRetainedOwnerUid);
    assert.equal(ledger.identity.mode & 0o777, value.parentApiLedgerRetainedMode);
    assert.equal(ledger.identity.nlink, 1);
    requireRetainedParentProvenance(
      {
        manifest: manifest.value,
        ledger: ledger.value,
        parentRoot,
        runId: String(value.parentRunId),
        apiPid: Number(value.parentApiPid),
        apiStarted: String(value.parentApiStarted),
        apiScript: String(value.parentApiScript),
        apiOrigin: String(value.parentApiOrigin),
        apiAttempt: String(value.parentApiAttempt),
      },
      `Android camera SQL ${phase}`,
    );
    const parent = retained;
    assert.equal(
      parent.bytes.length,
      value.parentSnapshotSizeBytes,
      `Android camera SQL ${phase} parent byte count changed`,
    );
    assert.equal(
      hash(parent.bytes),
      value.parentSnapshotSha256,
      `Android camera SQL ${phase} parent hash changed`,
    );
    const parentRecord = record(parent.value, 'Android camera SQL parent snapshot');
    assert.equal(parentRecord.readOnly, true);
    assert.equal(parentRecord.runId, producer.identity.backendRunId);
    assert.equal(parentRecord.scope, value.parentScope);
    if (value.phase === 'before' || value.phase === 'pending') {
      requireConnectionSnapshot(parent.value, producer.primaryExpected);
    } else if (value.phase === 'isolation-before' || value.phase === 'isolation-after') {
      requireConnectionSnapshot(parent.value, producer.isolationExpected);
    }
    const projection =
      value.table === 'domain'
        ? parent.value
        : record(parentRecord.rows, 'Android camera SQL parent rows')[String(value.table)];
    assert.notEqual(projection, undefined, 'Android camera SQL parent projection is missing');
    assert.deepEqual(child.bytes, Buffer.from(JSON.stringify(projection), 'utf8'));
  }
  assert.deepEqual(
    [...phaseSet].sort(),
    [...SQL_PHASES].sort(),
    'Android camera SQL phases are incomplete',
  );
  assert(
    tableSet.get('before')?.size === ANDROID_CAMERA_SQL_TABLES.length,
    'Android before SQL inventory is incomplete',
  );
  assert(
    tableSet.get('pending')?.size === ANDROID_CAMERA_SQL_TABLES.length,
    'Android pending SQL inventory is incomplete',
  );
  for (const phase of ['isolation-before', 'isolation-after', 'training-before', 'training-after'])
    assert((tableSet.get(phase)?.size ?? 0) > 0, `Android ${phase} SQL inventory is empty`);
  return [...paths];
}

async function verifyUi(
  captureRoot: string,
  report: JsonRecord,
  producer: AndroidCameraProducerReceipts,
  signal?: AbortSignal,
): Promise<Record<'entry' | 'prompt' | 'denied' | 'manual' | 'pending', string[]>> {
  const observations = report.observations;
  assert(Array.isArray(observations), 'Android camera observation ledger is missing');
  const result = {} as Record<'entry' | 'prompt' | 'denied' | 'manual' | 'pending', string[]>;
  for (const label of ['entry', 'prompt', 'denied', 'manual', 'pending'] as const) {
    const prefix = `camera-${label}`;
    const row: JsonRecord | undefined = observations
      .map((item: unknown) => record(item, 'Android camera observation'))
      .find((item) => String(item.hierarchyPath).startsWith(`${prefix}-`));
    assert(row, `Android camera ${label} observation is missing`);
    const hierarchyPath = relative(row.hierarchyPath, `Android camera ${label} hierarchy path`);
    const screenshotPath = relative(row.screenshotPath, `Android camera ${label} screenshot path`);
    const hierarchy = await readArtifact(
      captureRoot,
      hierarchyPath,
      'frame',
      16 * 1024 * 1024,
      signal,
    );
    const screenshot = await readArtifact(
      captureRoot,
      screenshotPath,
      'frame',
      16 * 1024 * 1024,
      signal,
    );
    assert(
      screenshot.bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
      `Android ${label} screenshot is not PNG`,
    );
    assert(hierarchy.bytes.length > 0, `Android ${label} hierarchy is empty`);
    const producerFrame = producer.frames.find((frame) => frame.label === label);
    assert(producerFrame, `Android ${label} producer frame is missing`);
    const raw = await readArtifact(
      captureRoot,
      producerFrame.path,
      'frame',
      16 * 1024 * 1024,
      signal,
    );
    assert.equal(
      hash(raw.bytes),
      producerFrame.sha256,
      `Android ${label} producer frame hash changed`,
    );
    result[label] = [producerFrame.path, hierarchyPath, screenshotPath];
  }
  return result;
}

function outputPath(prefix: string, relativePath: string): string {
  return `${prefix}/${relativePath}`;
}

async function verifyStageManifest(
  outputRoot: string,
  stage: AndroidCameraPublicStageResult,
  requiredPaths: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  assert.equal(stage.status, 'validated-source-only');
  assert.equal(stage.publicPromotionEligible, false);
  assert.equal(stage.nativePassingCases, 0);
  assert.equal(stage.publicPassingCases, 0);
  const manifestFile = await readJsonArtifact(
    outputRoot,
    stage.copyManifest.path,
    'sidecar',
    32 * 1024 * 1024,
    signal,
  );
  const manifest = record(manifestFile.value, 'Android camera staged manifest');
  const rows = manifest.files;
  assert(Array.isArray(rows), 'Android camera staged manifest files are missing');
  const manifestPaths = new Set(rows.map((row) => String(record(row, 'staged file').path)));
  for (const required of requiredPaths)
    assert(manifestPaths.has(required), `Staged camera evidence omits ${required}`);
  return stage.copyManifest.path.slice(0, stage.copyManifest.path.lastIndexOf('/'));
}

function makeBindings(
  selection: NativePilotSelection,
  ui: Record<'entry' | 'prompt' | 'denied' | 'manual' | 'pending', string[]>,
  sqlPaths: readonly string[],
  prefix: string,
  manifestPaths: ReadonlySet<string>,
): AndroidCameraRuntimeAssertionBinding[] {
  const ledger = requireNativePilotAssertions(selection);
  const map: Record<string, { ui: string[]; api: string[]; sql: string[] }> = {
    'NAT-camera-normal-entry': {
      ui: [...ui.entry, ...ui.prompt],
      api: ['transport-observations.private.json'],
      sql: sqlPaths.filter((value) => value.includes('before')),
    },
    'NAT-camera-denial-guidance': { ui: [...ui.denied], api: [], sql: [] },
    'NAT-camera-manual-submit': {
      ui: [...ui.manual, ...ui.pending],
      api: ['transport-observations.private.json'],
      sql: sqlPaths.filter((value) => value.includes('pending')),
    },
    'NAT-camera-unrelated-state': {
      ui: [],
      api: [],
      sql: sqlPaths.filter((value) => /sql-(?:isolation|training)-/.test(value)),
    },
  };
  return ledger.map((row) => {
    const paths = map[row.id];
    assert(paths, `Camera assertion ${row.id} has no runtime binding`);
    const evidencePaths = [
      ...new Set(
        [...paths.ui, ...paths.api, ...paths.sql].map((value) => outputPath(prefix, value)),
      ),
    ];
    assert(evidencePaths.length > 0, `Camera assertion ${row.id} has no evidence paths`);
    for (const kind of row.evidenceKinds) {
      assert(paths[kind].length > 0, `Camera assertion ${row.id} lacks ${kind} evidence`);
      for (const sourcePath of paths[kind])
        assert(
          manifestPaths.has(sourcePath),
          `Camera assertion ${row.id} source was not staged: ${sourcePath}`,
        );
    }
    return {
      id: row.id as (typeof ANDROID_CAMERA_ASSERTION_IDS)[number],
      requirementRefs: [...row.requirementRefs],
      evidenceKinds: [...row.evidenceKinds],
      evidencePaths,
    };
  });
}

/**
 * Verify and finalize one Android camera capture. Source fixtures must carry a
 * sealed source-only label; runtime eligibility requires a separately emitted,
 * descriptor-bound native runtime provenance receipt. Missing provenance is a
 * hard failure and never implies runtime eligibility.
 */
export async function verifyAndroidCameraRuntimeEligibility(
  input: AndroidCameraRuntimeEligibilityInput,
): Promise<AndroidCameraRuntimeEligibilityResult> {
  const sourceOnly = input.sourceOnlyTestLabel !== undefined;
  assert.equal(
    sourceOnly,
    input.runtimeProvenance === undefined,
    'Android camera eligibility requires exactly one source-only label or native runtime provenance receipt',
  );
  assert.equal(
    sourceOnly,
    input.nativeDriver === undefined,
    'Android camera eligibility requires a native driver only for native runtime provenance',
  );
  if (sourceOnly) {
    const label = input.sourceOnlyTestLabel;
    assert(label, 'source-only label is missing');
    assert.match(label, /^sealed-source-control:[a-z0-9-]+$/u, 'source-only label is invalid');
    assert(input.runtime, 'source-only eligibility requires the source-only public attempt');
  } else {
    assert(
      input.deadlineAt !== undefined,
      'native runtime eligibility requires an explicit deadline',
    );
    assert.equal(
      input.runtime,
      null,
      'native eligibility cannot relabel a source-only public attempt',
    );
    assert(input.nativeDriver, 'native eligibility requires an acquired native driver result');
  }
  const deadlineAt = input.deadlineAt ?? performance.now() + 30_000;
  throwIfExpired(input.signal, deadlineAt, 'Android camera runtime eligibility');
  const repositoryRoot = await realpath(input.repositoryRoot);
  const captureRoot = await privateRoot(input.captureRoot, 'Android camera capture root');
  const outputRoot = await privateRoot(input.outputRoot, 'Android camera output root');
  assert.match(input.requestedRunId, RUN_ID);
  assert.match(input.captureRunId, RUN_ID);
  assert.match(input.fixtureRunId, RUN_ID);
  requireAndroidCameraIdentityBoundary({
    requestedRunId: input.requestedRunId,
    captureRunId: input.captureRunId,
    ownerRunId: input.producer.identity.ownerRunId,
    backendRunId: input.fixtureRunId,
  });
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.equal(path.basename(captureRoot), input.captureRunId);
  assert.equal(path.basename(outputRoot), input.requestedRunId);
  assert.notEqual(captureRoot, outputRoot);
  requireAndroidCameraSelectionShape(input.selection);
  const ledger = requireNativePilotAssertions(input.selection);
  assert.deepEqual(
    ledger.map((row) => row.id),
    [...ANDROID_CAMERA_ASSERTION_IDS],
  );
  validateTarget(input.target);
  if (sourceOnly) {
    validateRuntime(input.runtime!, input);
  }
  const reportFile = await readJsonArtifact(
    captureRoot,
    'capture.private.json',
    'sidecar',
    32 * 1024 * 1024,
    input.signal,
  );
  const report = record(reportFile.value, 'Android camera capture report');
  validateCaptureReport(report, input);
  const expectedFixtureScope = input.producer.primaryExpected.scope;
  if (typeof expectedFixtureScope !== 'string' || expectedFixtureScope.length === 0)
    throw new Error('Android camera primary fixture scope is missing');
  const savedFlow = await requireAndroidCameraSavedFlowBinding({
    repositoryRoot,
    selection: input.selection,
    report,
    expectedFixtureRunId: input.fixtureRunId,
    expectedFixtureScope,
    deadlineAtMonotonicMs: deadlineAt,
    signal: input.signal,
  });
  const sourceAndHelpers = await verifyCurrentSourceAndHelpers(
    repositoryRoot,
    report,
    input.signal,
    deadlineAt,
  );
  const build = await verifyBuildAndTarget(
    captureRoot,
    report,
    input.target,
    deadlineAt,
    input.signal,
  );
  const localeBinding = buildNativeLocaleBinding({
    captureRunId: input.captureRunId,
    sourceTreeHash: sourceAndHelpers.source.sourceTreeHash,
    helperInputs: sourceAndHelpers.helperInputs,
    target: {
      platform: 'android',
      deviceId: input.target.deviceId,
      osVersion: input.target.osVersion,
      appId: input.target.appId,
      binaryHash: input.target.binaryHash,
      apiOrigin: input.target.apiOrigin,
    },
  });
  const locale = qualifyNativeLocaleEvidence(
    input.producer.identity.locale,
    input.expectedLocale,
    localeBinding,
  );
  if (!locale.eligible) throw new Error(`Android camera locale is not qualified: ${locale.detail}`);
  validateProducerIdentity(input.producer, input, localeBinding);
  await requireAndroidCameraIsolationFixtureBinding(input.producer.isolationFixture, {
    artifactRoot: captureRoot,
    backendRunId: input.fixtureRunId,
    primaryFixtureAuthUids: input.producer.primaryFixtureAuthUids,
    isolationExpected: input.producer.isolationExpected,
    signal: input.signal,
  });
  assert.deepEqual(
    record(report.connectionIsolationFixtureEvidence, 'Android isolation fixture evidence'),
    input.producer.isolationFixture,
    'Android capture isolation fixture evidence differs from the producer binding',
  );
  const persistedProducer = record(report.androidCameraProducer, 'Android persisted producer');
  assert.deepEqual(
    persistedProducer.isolationExpected,
    input.producer.isolationExpected,
    'Android persisted isolation expected identity differs from the producer binding',
  );
  assert.deepEqual(
    persistedProducer.isolationFixture,
    input.producer.isolationFixture,
    'Android persisted isolation fixture differs from the producer binding',
  );
  await verifyTransport(captureRoot, input.producer, input.signal);
  const sqlPaths = await verifySql(captureRoot, input.producer, input.signal);
  const ui = await verifyUi(captureRoot, report, input.producer, input.signal);
  const cleanupFile = await readJsonArtifact(
    captureRoot,
    'external-cleanup.private.json',
    'sidecar',
    32 * 1024 * 1024,
    input.signal,
  );
  requireAndroidCameraCleanupProof(cleanupFile.value, input.captureRunId);
  const runtimeProvenance = sourceOnly
    ? ({
        mode: 'source-only-control',
        label: input.sourceOnlyTestLabel!,
      } as const)
    : await verifyNativeRuntimeProvenance(
        captureRoot,
        reportFile.bytes,
        input,
        sourceAndHelpers.source,
        sourceAndHelpers.helperInputs,
        input.producer,
        sqlPaths,
      );
  const stage = await stageAndroidCameraPublicEvidence({
    captureRoot,
    outputRoot,
    requestedRunId: input.requestedRunId,
    captureRunId: input.captureRunId,
    fixtureRunId: input.fixtureRunId,
    selection: input.selection,
    producer: input.producer,
    signal: input.signal,
    deadlineAt,
  });
  throwIfExpired(input.signal, deadlineAt, 'Android camera runtime eligibility after staging');
  const prefix = await verifyStageManifest(
    outputRoot,
    stage,
    [
      ...new Set([
        ...Object.values(ui).flat(),
        'transport-observations.private.json',
        ...sqlPaths,
        input.producer.isolationFixture.path,
      ]),
    ],
    input.signal,
  );
  const manifestFile = await readJsonArtifact(
    outputRoot,
    stage.copyManifest.path,
    'sidecar',
    32 * 1024 * 1024,
    input.signal,
  );
  const manifestRows = record(manifestFile.value, 'Android staged manifest').files;
  const manifestPaths = new Set(
    (Array.isArray(manifestRows) ? manifestRows : []).map((row) =>
      String(record(row, 'staged manifest row').path),
    ),
  );
  const assertionBindings = makeBindings(input.selection, ui, sqlPaths, prefix, manifestPaths);
  const evidenceProof: AndroidCameraRuntimeEvidenceProof = {
    kind: 'private-android-camera-runtime-evidence-proof',
    status: 'verified-owned-receipts',
    captureRunId: input.captureRunId,
    fixtureRunId: input.fixtureRunId,
    source: sourceAndHelpers.source,
    helperInputs: sourceAndHelpers.helperInputs,
    savedFlow,
    target: input.target,
    build,
    localeBinding,
    assertionBindings,
    sqlParents: input.producer.sqlReceipts.map((receipt) => structuredClone(receipt)),
    producer: structuredClone(input.producer),
    stage,
    nativeDriver: sourceOnly ? undefined : input.nativeDriver,
    runtimeProvenance,
  };
  return {
    kind: 'private-android-camera-runtime-eligibility-not-public-receipt',
    status: sourceOnly ? 'validated-source-only' : 'verified-native-private',
    verificationMode: sourceOnly ? 'source-only-control' : 'native-runtime',
    captureRunId: input.captureRunId,
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    fixtureRunId: input.fixtureRunId,
    evidenceProof,
    assertionBindings,
    stage,
    nativePassingCases: sourceOnly ? 0 : 4,
    // This verifier only establishes private evidence.  A separate finalizer
    // may publish a native result after it re-reads the private driver receipt
    // and staged bytes.  In particular, a native verifier result is never a
    // public passing case by itself.
    publicPassingCases: 0,
    publicPromotionEligible: false,
    sourceOnlyTestLabel: input.sourceOnlyTestLabel ?? null,
    runtimeProvenance,
  };
}
