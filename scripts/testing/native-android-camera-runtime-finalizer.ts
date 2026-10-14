import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  requireAndroidCameraCleanupProof,
  readAndroidCameraPublicSourceBundle,
  writeAndroidCameraAnchoredFile,
  type AndroidCameraPublicSelectionBinding,
} from './native-android-camera-public-staging';
import {
  parseAndroidCameraSavedFlowRuntimeBinding,
  requireAndroidCameraCurrentSourceAndHelpers,
  requireAndroidCameraSavedFlowSource,
} from './native-android-camera-runtime-eligibility';
import { readOwnedAndroidStableFile } from './native-android-session-adapter';
import { ANDROID_CAMERA_ASSERTION_IDS } from './native-camera-android-contract';
import type { AndroidCameraNativeRuntimeDriverResult } from './native-android-camera-runtime-driver';
import type {
  AndroidCameraNativeRuntimeProvenance,
  AndroidCameraRuntimeEligibilityResult,
} from './native-android-camera-runtime-eligibility';
import type { AndroidStorageFileKind } from './native-android-session-adapter';
import type { AndroidCameraSqlSourceReceipt } from './native-camera-android-observation';
import type { NativePilotSelection } from './native-pilot-contract';

const RUN_ID = /^[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const FINALIZER_RECEIPT_PATH = 'android-camera-native-runtime-finalization.private.json';

type JsonRecord = Record<string, unknown>;

export type AndroidCameraNativeRuntimeFinalizerReceipt = {
  kind: 'private-owned-android-camera-native-runtime-finalizer-receipt';
  status: 'published-native';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  fixtureRunId: string;
  ownerRunId: string;
  target: AndroidCameraNativeRuntimeDriverResult['target'];
  process: AndroidCameraNativeRuntimeDriverResult['process'];
  driverReceipt: { path: string; sha256: string };
  stageManifest: { path: string; sha256: string };
  retainedSqlParentSidecars: readonly RetainedSqlParentSidecars[];
  savedFlow: AndroidCameraRuntimeEligibilityResult['evidenceProof']['savedFlow'];
  assertionIds: readonly (typeof ANDROID_CAMERA_ASSERTION_IDS)[number][];
  nativePassingCases: 4;
  publicPassingCases: 4;
  publicPromotionEligible: true;
};

export type AndroidCameraNativeRuntimePublicFinalizationResult = {
  kind: 'private-owned-android-camera-native-runtime-finalization-not-public-receipt';
  status: 'validated-native-finalizer';
  verificationMode: 'native-runtime-finalizer';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  fixtureRunId: string;
  nativePassingCases: 4;
  publicPassingCases: 4;
  publicPromotionEligible: true;
  assertionBindings: AndroidCameraRuntimeEligibilityResult['assertionBindings'];
  eligibility: AndroidCameraRuntimeEligibilityResult;
  finalizerReceipt: AndroidCameraNativeRuntimeFinalizerReceipt;
};

export type FinalizeAndroidCameraNativeRuntimeInput = {
  eligibility: AndroidCameraRuntimeEligibilityResult;
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  finalizerReceiptPath?: string;
  signal?: AbortSignal;
  deadlineAt: number;
};

export type PublishAndroidCameraNativeRuntimeFinalizerResult = {
  path: string;
  sha256: string;
  receipt: AndroidCameraNativeRuntimeFinalizerReceipt;
};

type NativeFinalizerInputs = {
  captureRoot: string;
  outputRoot: string;
  provenance: AndroidCameraNativeRuntimeProvenance;
  driver: AndroidCameraNativeRuntimeDriverResult;
  receiptPath: string;
  manifestPath: string;
  manifestSha256: string;
  stagedFiles: readonly NativeFinalizerStageFile[];
  retainedSqlParentSidecars: readonly RetainedSqlParentSidecars[];
};

export type RetainedSqlParentSidecars = {
  parentRoot: string;
  parentSnapshot: {
    path: string;
    sha256: string;
    sizeBytes: number;
    ownerUid: number;
    mode: number;
  };
  parentManifest: {
    path: string;
    sha256: string;
    sizeBytes: number;
    ownerUid: number;
    mode: number;
  };
  apiLedger: {
    path: string;
    sha256: string;
    sizeBytes: number;
    ownerUid: number;
    mode: number;
  };
  apiIdentity: {
    pid: number;
    started: string;
    script: string;
    origin: string;
    attempt: string;
    manifestSha256: string;
    apiLedgerSha256: string;
  };
};

export type NativeFinalizerStageFile = {
  path: string;
  kind: AndroidStorageFileKind;
  bytes: number;
  sha256: string;
  ownerUid: number;
  mode: number;
};

function record(value: unknown, label: string): JsonRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`);
  return value as JsonRecord;
}

function relative(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is missing`);
  assert(!path.isAbsolute(value), `${label} is absolute`);
  assert(!value.split('/').includes('..'), `${label} escapes its root`);
  assert(path.posix.normalize(value) === value, `${label} is not normalized`);
  return value;
}

function runId(value: unknown, label: string): string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
  return value;
}

function sha(value: unknown, label: string): string {
  assert(typeof value === 'string' && HASH.test(value), `${label} is invalid`);
  return value;
}

async function privateRoot(value: string, label: string): Promise<string> {
  const canonical = await realpath(value);
  assert.equal(canonical, path.resolve(value), `${label} is not canonical`);
  const stat = await lstat(canonical);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `${label} is not a directory`);
  assert.equal(stat.uid, process.getuid?.(), `${label} is not owned`);
  assert.equal(stat.mode & 0o777, 0o700, `${label} is not private`);
  return canonical;
}

function requireDeadline(signal: AbortSignal | undefined, deadlineAt: number): void {
  signal?.throwIfAborted();
  assert(
    Number.isFinite(deadlineAt) && performance.now() < deadlineAt,
    'Android native finalizer deadline expired',
  );
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function stageFileKind(value: unknown, label: string): AndroidStorageFileKind {
  assert(
    value === 'sidecar' || value === 'frame' || value === 'query' || value === 'transport',
    `${label} kind is invalid`,
  );
  return value;
}

function stageFiles(value: unknown): NativeFinalizerStageFile[] {
  assert(Array.isArray(value), 'native stage manifest files are missing');
  const seen = new Set<string>();
  return value.map((item, index) => {
    const row = record(item, `native stage manifest file ${index}`);
    const filePath = relative(row.path, `native stage manifest file ${index} path`);
    assert(!seen.has(filePath), `native stage manifest repeats ${filePath}`);
    seen.add(filePath);
    const bytes = row.bytes;
    assert(Number.isSafeInteger(bytes) && Number(bytes) >= 0, `${filePath} byte count is invalid`);
    const ownerUid = row.ownerUid;
    assert(Number.isSafeInteger(ownerUid) && Number(ownerUid) >= 0, `${filePath} owner is invalid`);
    const mode = row.mode;
    assert(Number.isSafeInteger(mode) && Number(mode) === 0o600, `${filePath} mode is not private`);
    return {
      path: filePath,
      kind: stageFileKind(row.kind, `native stage manifest file ${index}`),
      bytes: Number(bytes),
      sha256: sha(row.sha256, `${filePath} hash`),
      ownerUid: Number(ownerUid),
      mode: Number(mode),
    };
  });
}

function requireCanonicalStageFiles(
  actual: readonly NativeFinalizerStageFile[],
  expected: readonly {
    path: string;
    kind: AndroidStorageFileKind;
    bytes: number;
    sha256: string;
    ownerUid: number;
    mode: number;
  }[],
): void {
  const expectedByPath = new Map(expected.map((file) => [file.path, file]));
  assert.equal(
    expectedByPath.size,
    expected.length,
    'canonical Android camera source graph repeats a path',
  );
  const actualByPath = new Map(actual.map((file) => [file.path, file]));
  assert.equal(actualByPath.size, actual.length, 'native stage manifest repeats a path');
  assert.equal(
    actualByPath.size,
    expectedByPath.size,
    'native stage manifest artifact set differs from the canonical source graph',
  );
  for (const [filePath, expectedFile] of expectedByPath) {
    const actualFile = actualByPath.get(filePath);
    assert(actualFile, `native stage manifest omits canonical artifact ${filePath}`);
    assert.deepEqual(
      actualFile,
      expectedFile,
      `native stage manifest metadata changed for canonical artifact ${filePath}`,
    );
  }
  for (const filePath of actualByPath.keys())
    assert(
      expectedByPath.has(filePath),
      `native stage manifest contains an unrecognized artifact ${filePath}`,
    );
}

function buildRetainedSqlParentSidecars(
  parents: readonly AndroidCameraSqlSourceReceipt[],
): RetainedSqlParentSidecars[] {
  assert(parents.length > 0, 'native finalizer retained SQL parent provenance is missing');
  const canonical = parents[0];
  assert(canonical, 'native finalizer SQL parent canonical receipt is missing');
  for (const receipt of parents) {
    assert.equal(
      receipt.parentSnapshotRoot,
      canonical.parentSnapshotRoot,
      'native finalizer SQL parent runtime root changed',
    );
    assert.equal(
      receipt.parentApiOrigin,
      canonical.parentApiOrigin,
      'native finalizer SQL parent API origin changed',
    );
    assert.equal(
      receipt.parentApiPid,
      canonical.parentApiPid,
      'native finalizer SQL parent API PID changed',
    );
    assert.equal(
      receipt.parentApiStarted,
      canonical.parentApiStarted,
      'native finalizer SQL parent API start changed',
    );
    assert.equal(
      receipt.parentApiScript,
      canonical.parentApiScript,
      'native finalizer SQL parent API script changed',
    );
    assert.equal(
      receipt.parentApiAttempt,
      canonical.parentApiAttempt,
      'native finalizer SQL parent API attempt changed',
    );
    assert.equal(
      receipt.parentManifestSha256,
      canonical.parentManifestSha256,
      'native finalizer SQL parent manifest hash changed',
    );
    assert.equal(
      receipt.parentApiLedgerSha256,
      canonical.parentApiLedgerSha256,
      'native finalizer SQL parent API ledger hash changed',
    );
  }
  return parents.map((receipt) => ({
    parentRoot: receipt.parentSnapshotRoot,
    parentSnapshot: {
      path: receipt.parentSnapshotRetainedPath,
      sha256: receipt.parentSnapshotRetainedSha256,
      sizeBytes: receipt.parentSnapshotRetainedSizeBytes,
      ownerUid: receipt.parentSnapshotRetainedOwnerUid,
      mode: receipt.parentSnapshotRetainedMode,
    },
    parentManifest: {
      path: receipt.parentManifestRetainedPath,
      sha256: receipt.parentManifestRetainedSha256,
      sizeBytes: receipt.parentManifestRetainedSizeBytes,
      ownerUid: receipt.parentManifestRetainedOwnerUid,
      mode: receipt.parentManifestRetainedMode,
    },
    apiLedger: {
      path: receipt.parentApiLedgerRetainedPath,
      sha256: receipt.parentApiLedgerRetainedSha256,
      sizeBytes: receipt.parentApiLedgerRetainedSizeBytes,
      ownerUid: receipt.parentApiLedgerRetainedOwnerUid,
      mode: receipt.parentApiLedgerRetainedMode,
    },
    apiIdentity: {
      pid: receipt.parentApiPid,
      started: receipt.parentApiStarted,
      script: receipt.parentApiScript,
      origin: receipt.parentApiOrigin,
      attempt: receipt.parentApiAttempt,
      manifestSha256: receipt.parentManifestSha256,
      apiLedgerSha256: receipt.parentApiLedgerSha256,
    },
  }));
}

export function requireRetainedSqlParentStageFiles(
  files: readonly NativeFinalizerStageFile[],
  parents: readonly RetainedSqlParentSidecars[],
): void {
  assert(parents.length > 0, 'native stage manifest has no retained SQL parent provenance');
  const byPath = new Map(files.map((file) => [file.path, file]));
  assert.equal(
    byPath.size,
    files.length,
    'native stage manifest repeats a retained SQL or other file path',
  );
  const expected = new Map<
    string,
    { label: string; value: RetainedSqlParentSidecars['parentSnapshot'] }
  >();
  for (const parent of parents) {
    assert.equal(
      parent.apiIdentity.manifestSha256,
      parent.parentManifest.sha256,
      'retained SQL parent manifest hash is not bound to API identity',
    );
    assert.equal(
      parent.apiIdentity.apiLedgerSha256,
      parent.apiLedger.sha256,
      'retained SQL API ledger hash is not bound to API identity',
    );
    for (const [label, entry] of [
      ['parent snapshot', parent.parentSnapshot],
      ['parent manifest', parent.parentManifest],
      ['API ledger', parent.apiLedger],
    ] as const) {
      const existing = expected.get(entry.path);
      if (existing) {
        assert.deepEqual(
          existing.value,
          entry,
          `retained SQL ${label} metadata changed across parent receipts`,
        );
      } else {
        expected.set(entry.path, { label, value: entry });
      }
      const staged = byPath.get(entry.path);
      assert(staged, `native stage manifest omits retained SQL ${label}`);
      assert.equal(staged.kind, 'sidecar', `retained SQL ${label} is not a sidecar`);
      assert.equal(staged.sha256, entry.sha256, `retained SQL ${label} hash changed`);
      assert.equal(staged.bytes, entry.sizeBytes, `retained SQL ${label} size changed`);
      assert.equal(staged.ownerUid, entry.ownerUid, `retained SQL ${label} owner changed`);
      assert.equal(staged.mode, entry.mode, `retained SQL ${label} mode changed`);
    }
  }
  const retainedPrefixes = ['camera-sql-parent-', 'camera-sql-manifest-', 'camera-sql-api-ledger-'];
  const stagedRetainedPaths = new Set(
    files
      .map((file) => file.path)
      .filter(
        (filePath) =>
          expected.has(filePath) ||
          retainedPrefixes.some((prefix) => path.posix.basename(filePath).startsWith(prefix)),
      ),
  );
  assert.deepEqual(
    [...stagedRetainedPaths].sort(),
    [...expected.keys()].sort(),
    'native stage manifest retained SQL sidecar expected set changed',
  );
}

export function parseRetainedSqlParentSidecars(value: unknown): RetainedSqlParentSidecars[] {
  assert(Array.isArray(value), 'native finalizer retained SQL sidecars are missing');
  assert(value.length > 0, 'native finalizer retained SQL sidecars are empty');
  return value.map((item, index) => {
    const row = record(item, `native finalizer retained SQL parent ${index}`);
    const parentRoot = row.parentRoot;
    assert(
      typeof parentRoot === 'string' &&
        path.isAbsolute(parentRoot) &&
        path.resolve(parentRoot) === parentRoot,
      `native finalizer retained SQL parent ${index} root is invalid`,
    );
    const file = (input: unknown, label: string) => {
      const entry = record(input, label);
      return {
        path: relative(entry.path, `${label} path`),
        sha256: sha(entry.sha256, `${label} hash`),
        sizeBytes: Number(entry.sizeBytes),
        ownerUid: Number(entry.ownerUid),
        mode: Number(entry.mode),
      };
    };
    const parentSnapshot = file(
      row.parentSnapshot,
      `native finalizer SQL parent ${index} snapshot`,
    );
    const parentManifest = file(
      row.parentManifest,
      `native finalizer SQL parent ${index} manifest`,
    );
    const apiLedger = file(row.apiLedger, `native finalizer SQL parent ${index} API ledger`);
    for (const [label, entry] of [
      ['snapshot', parentSnapshot],
      ['manifest', parentManifest],
      ['API ledger', apiLedger],
    ] as const) {
      assert(Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes > 0);
      assert(Number.isSafeInteger(entry.ownerUid) && entry.ownerUid >= 0);
      assert.equal(
        entry.mode,
        0o600,
        `native finalizer SQL parent ${index} ${label} mode is invalid`,
      );
    }
    const identity = record(row.apiIdentity, `native finalizer SQL parent ${index} API identity`);
    assert(Number.isSafeInteger(identity.pid) && Number(identity.pid) > 1);
    assert(typeof identity.started === 'string' && identity.started.length > 0);
    assert(typeof identity.script === 'string' && identity.script.length > 0);
    assert(typeof identity.origin === 'string' && identity.origin.length > 0);
    assert(typeof identity.attempt === 'string' && /^[a-z0-9-]{1,48}$/u.test(identity.attempt));
    const manifestSha256 = sha(identity.manifestSha256, 'native finalizer manifest hash');
    const apiLedgerSha256 = sha(identity.apiLedgerSha256, 'native finalizer API ledger hash');
    assert.equal(
      manifestSha256,
      parentManifest.sha256,
      `native finalizer SQL parent ${index} manifest identity hash changed`,
    );
    assert.equal(
      apiLedgerSha256,
      apiLedger.sha256,
      `native finalizer SQL parent ${index} API ledger identity hash changed`,
    );
    return {
      parentRoot,
      parentSnapshot,
      parentManifest,
      apiLedger,
      apiIdentity: {
        pid: Number(identity.pid),
        started: identity.started,
        script: identity.script,
        origin: identity.origin,
        attempt: identity.attempt,
        manifestSha256,
        apiLedgerSha256,
      },
    };
  });
}

function stageFileMaxBytes(kind: AndroidStorageFileKind): number {
  return kind === 'frame'
    ? 16 * 1024 * 1024
    : kind === 'transport' || kind === 'auth'
      ? 1 * 1024 * 1024
      : kind === 'query'
        ? 256 * 1024
        : 32 * 1024 * 1024;
}

async function rereadStagedOriginalBundle(options: {
  captureRoot: string;
  outputRoot: string;
  manifestPath: string;
  files: readonly NativeFinalizerStageFile[];
  signal?: AbortSignal;
  deadlineAt: number;
}): Promise<void> {
  const stagePrefix = path.posix.dirname(options.manifestPath);
  for (const file of options.files) {
    requireDeadline(options.signal, options.deadlineAt);
    const original = await readOwnedAndroidStableFile({
      artifactRoot: options.captureRoot,
      filePath: path.join(options.captureRoot, file.path),
      kind: file.kind,
      maxBytes: stageFileMaxBytes(file.kind),
      signal: options.signal,
    });
    requireDeadline(options.signal, options.deadlineAt);
    assert.equal(original.receipt.path, file.path, `${file.path} original path changed`);
    assert.equal(original.receipt.sha256, file.sha256, `${file.path} original bytes changed`);
    assert.equal(original.receipt.sizeBytes, file.bytes, `${file.path} original size changed`);
    assert.equal(original.receipt.ownerUid, file.ownerUid, `${file.path} original owner changed`);
    assert.equal(original.receipt.mode, file.mode, `${file.path} original mode changed`);

    const stagedPath = path.posix.join(stagePrefix, file.path);
    const staged = await readOwnedAndroidStableFile({
      artifactRoot: options.outputRoot,
      filePath: path.join(options.outputRoot, stagedPath),
      kind: file.kind,
      maxBytes: stageFileMaxBytes(file.kind),
      signal: options.signal,
    });
    requireDeadline(options.signal, options.deadlineAt);
    assert.equal(staged.receipt.path, stagedPath, `${file.path} staged path changed`);
    assert.equal(staged.receipt.sha256, file.sha256, `${file.path} staged bytes changed`);
    assert.equal(staged.receipt.sizeBytes, file.bytes, `${file.path} staged size changed`);
    assert.equal(staged.receipt.ownerUid, file.ownerUid, `${file.path} staged owner changed`);
    assert.equal(staged.receipt.mode, file.mode, `${file.path} staged mode changed`);
  }
}

async function rereadCurrentInputAndCleanupProof(
  options: FinalizeAndroidCameraNativeRuntimeInput,
): Promise<void> {
  await requireAndroidCameraCurrentSourceAndHelpers({
    repositoryRoot: options.repositoryRoot,
    expectedSource: options.eligibility.evidenceProof.source,
    expectedHelperInputs: options.eligibility.evidenceProof.helperInputs,
    signal: options.signal,
    deadlineAt: options.deadlineAt,
  });
  await requireAndroidCameraSavedFlowSource({
    repositoryRoot: options.repositoryRoot,
    selection: selectionFromBinding(options.eligibility.stage.selectionBinding),
    expectedBinding: options.eligibility.evidenceProof.savedFlow,
    deadlineAtMonotonicMs: options.deadlineAt,
    signal: options.signal,
  });
  const cleanup = await readOwnedAndroidStableFile({
    artifactRoot: options.captureRoot,
    filePath: path.join(options.captureRoot, 'external-cleanup.private.json'),
    kind: 'sidecar',
    maxBytes: 32 * 1024 * 1024,
    signal: options.signal,
  });
  requireAndroidCameraCleanupProof(
    JSON.parse(cleanup.bytes.toString('utf8')),
    options.eligibility.captureRunId,
  );
  requireDeadline(options.signal, options.deadlineAt);
}

function nativeProvenance(
  eligibility: AndroidCameraRuntimeEligibilityResult,
): AndroidCameraNativeRuntimeProvenance {
  const provenance = eligibility.runtimeProvenance;
  assert(
    provenance.mode === 'native-runtime',
    'source-only eligibility cannot enter native finalization',
  );
  assert.equal(eligibility.verificationMode, 'native-runtime');
  assert.equal(eligibility.status, 'verified-native-private');
  assert.equal(eligibility.nativePassingCases, 4);
  assert.equal(eligibility.publicPassingCases, 0);
  assert.equal(eligibility.publicPromotionEligible, false);
  assert(
    eligibility.evidenceProof.nativeDriver,
    'native finalization requires the acquired driver proof',
  );
  return provenance;
}

function selectionFromBinding(binding: AndroidCameraPublicSelectionBinding): NativePilotSelection {
  return {
    arguments: structuredClone(binding.arguments),
    scenario: structuredClone(binding.scenario),
    scenarioHash: binding.scenarioHash,
    requirementHash: binding.requirementHash,
  };
}

function parseReceipt(value: unknown): AndroidCameraNativeRuntimeFinalizerReceipt {
  const row = record(value, 'Android native finalizer receipt');
  assert.equal(row.kind, 'private-owned-android-camera-native-runtime-finalizer-receipt');
  assert.equal(row.status, 'published-native');
  const requestedRunId = runId(row.requestedRunId, 'finalizer requested run');
  const requestedAttemptId =
    typeof row.requestedAttemptId === 'string' ? row.requestedAttemptId : '';
  assert.equal(requestedAttemptId, `${requestedRunId}:first`);
  const captureRunId = runId(row.captureRunId, 'finalizer capture run');
  const fixtureRunId = runId(row.fixtureRunId, 'finalizer fixture run');
  const ownerRunId = runId(row.ownerRunId, 'finalizer owner run');
  const target = record(row.target, 'finalizer target');
  assert(
    typeof target.deviceId === 'string' && target.deviceId.length > 0,
    'finalizer target device is invalid',
  );
  const processRow = record(row.process, 'finalizer process');
  assert(Number.isSafeInteger(processRow.apiPid) && Number(processRow.apiPid) > 1);
  assert(Number.isSafeInteger(processRow.pgid) && Number(processRow.pgid) > 1);
  assert(typeof processRow.apiStarted === 'string' && processRow.apiStarted.length > 0);
  assert(typeof processRow.apiOrigin === 'string' && processRow.apiOrigin.length > 0);
  runId(processRow.ownerRunId, 'finalizer process owner run');
  assert(typeof processRow.targetDeviceId === 'string' && processRow.targetDeviceId.length > 0);
  const driverReceipt = record(row.driverReceipt, 'finalizer driver receipt');
  const driverPath = relative(driverReceipt.path, 'finalizer driver receipt path');
  const stageManifest = record(row.stageManifest, 'finalizer stage manifest');
  const stagePath = relative(stageManifest.path, 'finalizer stage manifest path');
  const driverSha = sha(driverReceipt.sha256, 'finalizer driver receipt hash');
  const stageSha = sha(stageManifest.sha256, 'finalizer stage manifest hash');
  const retainedSqlParentSidecars = parseRetainedSqlParentSidecars(row.retainedSqlParentSidecars);
  const savedFlow = parseAndroidCameraSavedFlowRuntimeBinding(
    row.savedFlow,
    'Android native finalizer saved-flow binding',
  );
  assert.deepEqual(row.assertionIds, [...ANDROID_CAMERA_ASSERTION_IDS]);
  assert.equal(row.nativePassingCases, 4);
  assert.equal(row.publicPassingCases, 4);
  assert.equal(row.publicPromotionEligible, true);
  return {
    kind: 'private-owned-android-camera-native-runtime-finalizer-receipt',
    status: 'published-native',
    requestedRunId,
    requestedAttemptId,
    captureRunId,
    fixtureRunId,
    ownerRunId,
    target: target as unknown as AndroidCameraNativeRuntimeDriverResult['target'],
    process: processRow as unknown as AndroidCameraNativeRuntimeDriverResult['process'],
    driverReceipt: { path: driverPath, sha256: driverSha },
    stageManifest: { path: stagePath, sha256: stageSha },
    retainedSqlParentSidecars,
    savedFlow,
    assertionIds: row.assertionIds,
    nativePassingCases: 4,
    publicPassingCases: 4,
    publicPromotionEligible: true,
  };
}

async function loadNativeFinalizerInputs(
  options: FinalizeAndroidCameraNativeRuntimeInput,
): Promise<NativeFinalizerInputs> {
  requireDeadline(options.signal, options.deadlineAt);
  const captureRoot = await privateRoot(
    options.captureRoot,
    'Android native finalizer capture root',
  );
  const outputRoot = await privateRoot(options.outputRoot, 'Android native finalizer output root');
  await rereadCurrentInputAndCleanupProof(options);
  assert.notEqual(captureRoot, outputRoot);
  const provenance = nativeProvenance(options.eligibility);
  const driver = options.eligibility.evidenceProof.nativeDriver!;
  const receiptPath = relative(provenance.receiptPath, 'native driver receipt path');
  const loadedDriver = await readOwnedAndroidStableFile({
    artifactRoot: captureRoot,
    filePath: path.join(captureRoot, receiptPath),
    kind: 'sidecar',
    maxBytes: 512 * 1024,
    signal: options.signal,
  });
  requireDeadline(options.signal, options.deadlineAt);
  assert.equal(loadedDriver.receipt.sha256, provenance.receiptSha256);
  const driverReceipt = record(
    JSON.parse(loadedDriver.bytes.toString('utf8')),
    'native driver receipt',
  );
  assert.equal(driverReceipt.kind, 'private-owned-android-camera-native-runtime-receipt');
  assert.deepEqual(driverReceipt.driver, driver);
  assert.equal(driverReceipt.requestedRunId, options.eligibility.requestedRunId);
  assert.equal(driverReceipt.captureRunId, options.eligibility.captureRunId);
  assert.equal(driverReceipt.fixtureRunId, options.eligibility.fixtureRunId);

  const manifestPath = relative(
    options.eligibility.stage.copyManifest.path,
    'native stage manifest path',
  );
  const loadedManifest = await readOwnedAndroidStableFile({
    artifactRoot: outputRoot,
    filePath: path.join(outputRoot, manifestPath),
    kind: 'sidecar',
    maxBytes: 32 * 1024 * 1024,
    signal: options.signal,
  });
  requireDeadline(options.signal, options.deadlineAt);
  assert.equal(loadedManifest.receipt.sha256, options.eligibility.stage.copyManifest.sha256);
  const manifest = record(
    JSON.parse(loadedManifest.bytes.toString('utf8')),
    'native stage manifest',
  );
  assert.equal(manifest.kind, 'private-owned-android-camera-public-staging-not-public-outcome');
  assert.equal(manifest.status, 'validated-source-only');
  assert.deepEqual(manifest.assertionIds, [...ANDROID_CAMERA_ASSERTION_IDS]);
  assert.equal(manifest.nativePassingCases, 0);
  assert.equal(manifest.publicPassingCases, 0);
  assert.equal(manifest.publicPromotionEligible, false);
  const stagedFiles = stageFiles(manifest.files);
  const retainedSqlParentSidecars = buildRetainedSqlParentSidecars(
    options.eligibility.evidenceProof.sqlParents,
  );
  const producer = options.eligibility.evidenceProof.producer;
  assert(producer, 'native finalizer producer receipt graph is missing');
  const sourceBundle = await readAndroidCameraPublicSourceBundle({
    captureRoot,
    requestedRunId: options.eligibility.requestedRunId,
    captureRunId: options.eligibility.captureRunId,
    fixtureRunId: options.eligibility.fixtureRunId,
    selection: selectionFromBinding(options.eligibility.stage.selectionBinding),
    producer,
    signal: options.signal,
  });
  requireDeadline(options.signal, options.deadlineAt);
  requireCanonicalStageFiles(
    stagedFiles,
    sourceBundle.files.map((loaded) => loaded.source),
  );
  requireRetainedSqlParentStageFiles(stagedFiles, retainedSqlParentSidecars);
  const manifestBinding = record(manifest.selectionBinding, 'native stage selection binding');
  assert.deepEqual(
    manifestBinding,
    options.eligibility.stage.selectionBinding,
    'native stage selection binding changed after eligibility',
  );
  const manifestBindingHash = sha256(Buffer.from(JSON.stringify(manifestBinding), 'utf8'));
  assert.equal(
    manifest.selectionBindingSha256,
    manifestBindingHash,
    'native stage selection binding hash changed',
  );
  await rereadStagedOriginalBundle({
    captureRoot,
    outputRoot,
    manifestPath,
    files: stagedFiles,
    signal: options.signal,
    deadlineAt: options.deadlineAt,
  });
  await rereadCurrentInputAndCleanupProof(options);
  return {
    captureRoot,
    outputRoot,
    provenance,
    driver,
    receiptPath,
    manifestPath,
    manifestSha256: loadedManifest.receipt.sha256,
    stagedFiles,
    retainedSqlParentSidecars,
  };
}

function finalizerReceiptFromInputs(
  options: FinalizeAndroidCameraNativeRuntimeInput,
  inputs: NativeFinalizerInputs,
): AndroidCameraNativeRuntimeFinalizerReceipt {
  return {
    kind: 'private-owned-android-camera-native-runtime-finalizer-receipt',
    status: 'published-native',
    requestedRunId: options.eligibility.requestedRunId,
    requestedAttemptId: options.eligibility.requestedAttemptId,
    captureRunId: options.eligibility.captureRunId,
    fixtureRunId: options.eligibility.fixtureRunId,
    ownerRunId: inputs.driver.ownerRunId,
    target: inputs.driver.target,
    process: inputs.driver.process,
    driverReceipt: {
      path: inputs.receiptPath,
      sha256: inputs.provenance.receiptSha256,
    },
    stageManifest: { path: inputs.manifestPath, sha256: inputs.manifestSha256 },
    retainedSqlParentSidecars: inputs.retainedSqlParentSidecars,
    savedFlow: options.eligibility.evidenceProof.savedFlow,
    assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
    nativePassingCases: 4,
    publicPassingCases: 4,
    publicPromotionEligible: true,
  };
}

/**
 * Publish the native finalizer receipt only after rereading the producer-owned
 * driver receipt and the staged original-byte manifest. The subsequent
 * finalizer still rereads this anchored file before exposing its private
 * four-case result.
 */
export async function publishAndroidCameraNativeRuntimeFinalizerReceipt(
  options: FinalizeAndroidCameraNativeRuntimeInput,
): Promise<PublishAndroidCameraNativeRuntimeFinalizerResult> {
  const inputs = await loadNativeFinalizerInputs(options);
  const receipt = finalizerReceiptFromInputs(options, inputs);
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  const published = await writeAndroidCameraAnchoredFile({
    root: inputs.outputRoot,
    relativePath: FINALIZER_RECEIPT_PATH,
    bytes,
    signal: options.signal,
    deadlineAt: options.deadlineAt,
  });
  requireDeadline(options.signal, options.deadlineAt);
  const reread = await readOwnedAndroidStableFile({
    artifactRoot: inputs.outputRoot,
    filePath: published.absolutePath,
    kind: 'sidecar',
    maxBytes: 512 * 1024,
    signal: options.signal,
  });
  assert.equal(reread.receipt.sha256, sha256(bytes));
  assert.deepEqual(parseReceipt(JSON.parse(reread.bytes.toString('utf8'))), receipt);
  assert.equal(published.identity.mode & 0o777, 0o600);
  assert.equal(published.identity.nlink, 1);
  return {
    path: FINALIZER_RECEIPT_PATH,
    sha256: reread.receipt.sha256,
    receipt,
  };
}

/**
 * Consume private native evidence only after a distinct native driver has
 * acquired the target and the private stager has written its original-byte
 * manifest. This is the sole source of a four-case/promotion result; the
 * verifier above deliberately returns zero public cases.
 */
export async function finalizeAndroidCameraNativeRuntime(
  options: FinalizeAndroidCameraNativeRuntimeInput,
): Promise<AndroidCameraNativeRuntimePublicFinalizationResult> {
  const inputs = await loadNativeFinalizerInputs(options);
  const { outputRoot, driver, provenance, receiptPath, manifestPath, manifestSha256 } = inputs;

  const finalizerPath = relative(
    options.finalizerReceiptPath ?? FINALIZER_RECEIPT_PATH,
    'native finalizer receipt path',
  );
  assert.equal(finalizerPath, FINALIZER_RECEIPT_PATH);
  const loadedFinalizer = await readOwnedAndroidStableFile({
    artifactRoot: outputRoot,
    filePath: path.join(outputRoot, finalizerPath),
    kind: 'sidecar',
    maxBytes: 512 * 1024,
    signal: options.signal,
  });
  requireDeadline(options.signal, options.deadlineAt);
  const finalizerReceipt = parseReceipt(JSON.parse(loadedFinalizer.bytes.toString('utf8')));
  assert.equal(finalizerReceipt.requestedRunId, options.eligibility.requestedRunId);
  assert.equal(finalizerReceipt.requestedAttemptId, options.eligibility.requestedAttemptId);
  assert.equal(finalizerReceipt.captureRunId, options.eligibility.captureRunId);
  assert.equal(finalizerReceipt.fixtureRunId, options.eligibility.fixtureRunId);
  assert.equal(finalizerReceipt.ownerRunId, driver.ownerRunId);
  assert.deepEqual(finalizerReceipt.target, driver.target);
  assert.deepEqual(finalizerReceipt.process, driver.process);
  assert.deepEqual(finalizerReceipt.driverReceipt, {
    path: receiptPath,
    sha256: provenance.receiptSha256,
  });
  assert.deepEqual(finalizerReceipt.stageManifest, {
    path: manifestPath,
    sha256: manifestSha256,
  });
  assert.deepEqual(
    finalizerReceipt.retainedSqlParentSidecars,
    inputs.retainedSqlParentSidecars,
    'native finalizer retained SQL provenance changed after publication',
  );
  assert.deepEqual(
    finalizerReceipt.savedFlow,
    options.eligibility.evidenceProof.savedFlow,
    'native finalizer saved-flow binding changed after publication',
  );
  // The finalizer receipt is not a substitute for the protected original
  // bundle. Re-read every original and staged byte at the terminal boundary
  // so a same-shape staged edit after the first pass cannot become four
  // promoted assertions.
  await rereadStagedOriginalBundle({
    captureRoot: inputs.captureRoot,
    outputRoot: inputs.outputRoot,
    manifestPath: inputs.manifestPath,
    files: inputs.stagedFiles,
    signal: options.signal,
    deadlineAt: options.deadlineAt,
  });
  return {
    kind: 'private-owned-android-camera-native-runtime-finalization-not-public-receipt',
    status: 'validated-native-finalizer',
    verificationMode: 'native-runtime-finalizer',
    requestedRunId: options.eligibility.requestedRunId,
    requestedAttemptId: options.eligibility.requestedAttemptId,
    captureRunId: options.eligibility.captureRunId,
    fixtureRunId: options.eligibility.fixtureRunId,
    nativePassingCases: 4,
    publicPassingCases: 4,
    publicPromotionEligible: true,
    assertionBindings: options.eligibility.assertionBindings,
    eligibility: options.eligibility,
    finalizerReceipt,
  };
}

export { FINALIZER_RECEIPT_PATH };
