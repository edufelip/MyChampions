import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { requireAndroidDetoxCameraIdentityBoundary } from './native-detox-camera-android-identity';
import {
  requireAndroidDetoxCameraProducerOutput,
  type AndroidDetoxCameraProducerReceipts,
} from './native-detox-camera-android-producer';
import {
  ANDROID_CAMERA_ASSERTION_IDS,
  androidCameraSelectionHash,
  readOwnedDetoxConnectionEvidence,
  writeAndroidCameraAnchoredFile,
  type NativePilotSelection,
} from './native-detox-camera-android-q-adapter';
import type {
  AndroidDetoxCameraAssertionBinding,
  AndroidDetoxCameraOwnedSessionResult,
  AndroidDetoxCameraStage,
} from './native-detox-camera-android-public-dispatch';

const RUN_ID = /^[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

export const ANDROID_DETOX_CAMERA_FINALIZER_RECEIPT_PATH =
  'detox-camera-native-runtime-finalization.private.json' as const;

export type AndroidDetoxCameraNativeFinalization = Readonly<{
  kind: 'private-owned-android-detox-camera-native-runtime-finalization-not-public-receipt';
  status: 'verified-native';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  fixtureRunId: string;
  backendRunId: string;
  ownerRunId: string;
  targetOwnerRunId: string;
  targetDeviceId: string;
  childCommandIdentity: NonNullable<AndroidDetoxCameraOwnedSessionResult['childCommandIdentity']>;
  stageManifest: { path: string; sha256: string };
  receipt: { path: string; sha256: string };
  assertionBindings: readonly AndroidDetoxCameraAssertionBinding[];
  nativePassingCases: 4;
  publicPassingCases: 4;
  publicPromotionEligible: true;
}>;

export type AndroidDetoxCameraNativeFinalizerInput = Readonly<{
  repositoryRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  build: unknown;
  session: AndroidDetoxCameraOwnedSessionResult;
  producer: AndroidDetoxCameraProducerReceipts;
  stage: AndroidDetoxCameraStage;
  signal: AbortSignal;
  deadlineAt: number;
}>;

export type AndroidDetoxCameraNativeFinalizer = (
  input: AndroidDetoxCameraNativeFinalizerInput,
) => Promise<AndroidDetoxCameraNativeFinalization>;

type StageFile = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  mode: number;
}>;

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`);
  return value as Record<string, unknown>;
}

function requireRunId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && HASH.test(value), `${label} is invalid`);
}

function requireLive(input: AndroidDetoxCameraNativeFinalizerInput, label: string): void {
  input.signal.throwIfAborted();
  assert(Number.isFinite(input.deadlineAt), `${label} deadline is not finite`);
  assert(input.deadlineAt > performance.now(), `${label} deadline expired`);
}

function relative(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is missing`);
  assert(!path.isAbsolute(value), `${label} is absolute`);
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  assert(normalized === value && normalized !== '.', `${label} is not normalized`);
  assert(!normalized.split('/').includes('..'), `${label} escapes its root`);
  assert(path.dirname(normalized) === '.', `${label} must be a direct owned artifact`);
  return normalized;
}

async function privateRoot(value: string, label: string): Promise<string> {
  const resolved = path.resolve(value);
  assert.equal(await realpath(resolved), resolved, `${label} is not canonical`);
  const info = await lstat(resolved);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a private directory`);
  if (typeof process.getuid === 'function') assert.equal(info.uid, process.getuid());
  assert.equal(info.mode & 0o777, 0o700, `${label} is not mode 0700`);
  return resolved;
}

function stageName(captureRunId: string, sourcePath: string): string {
  const safe = relative(sourcePath, 'camera source path');
  return `detox-camera-stage-${captureRunId}-${hash(safe).slice(0, 12)}-${path.basename(safe)}`;
}

function requiredSourcePaths(
  producer: AndroidDetoxCameraProducerReceipts,
  session: AndroidDetoxCameraOwnedSessionResult,
): readonly string[] {
  return [
    producer.bridge.receiptHost.path,
    ...producer.bridge.frames.flatMap((frame) => [
      frame.hierarchy.hierarchy.path,
      frame.hierarchy.screenshot.path,
    ]),
    producer.submission.sourcePath,
    producer.submission.descriptorPath,
    producer.localeReceiptPath,
    ...producer.sqlReceipts.map((receipt) => receipt.path),
    ...producer.flow.originalActionReceipts.flatMap((action) => [
      action.frame.hierarchyPath,
      action.frame.attributesPath,
      action.frame.screenshotPath,
    ]),
    'transport-observations.private.json',
    session.childReceiptPath,
    session.flowReceiptPath,
  ].map((value) => relative(value, 'camera source path'));
}

function stageFiles(value: unknown): StageFile[] {
  const rows = record(value, 'camera stage manifest').files;
  assert(Array.isArray(rows), 'camera stage manifest files are missing');
  const seen = new Set<string>();
  return rows.map((entry, index) => {
    const row = record(entry, `camera stage file ${index}`);
    const filePath = relative(row.path, `camera stage file ${index} path`);
    assert(!seen.has(filePath), `camera stage file ${filePath} is duplicated`);
    seen.add(filePath);
    assert(Number.isSafeInteger(row.bytes) && Number(row.bytes) > 0);
    requireHash(row.sha256, `camera stage file ${index} hash`);
    assert(row.mode === 0o600, `camera stage file ${index} is not private`);
    return {
      path: filePath,
      bytes: Number(row.bytes),
      sha256: row.sha256,
      mode: Number(row.mode),
    };
  });
}

async function readArtifact(
  root: string,
  relativePath: string,
  signal: AbortSignal,
  deadlineAt: number,
) {
  return readOwnedDetoxConnectionEvidence(
    root,
    relative(relativePath, 'camera artifact'),
    MAX_ARTIFACT_BYTES,
    {
      signal,
      deadlineAt,
    },
  );
}

function buildIdentity(value: unknown): {
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
} {
  const build = record(value, 'Android Detox build');
  const source = record(build.source, 'Android Detox build source');
  requireHash(source.sourceTreeHash, 'Android Detox build source hash');
  requireHash(build.helperInputsHash, 'Android Detox build helper hash');
  requireHash(build.binaryHash, 'Android Detox build binary hash');
  assert(
    build.testBinaryHash === null ||
      (typeof build.testBinaryHash === 'string' && HASH.test(build.testBinaryHash)),
    'Android Detox test build hash is invalid',
  );
  requireHash(build.detoxConfigHash, 'Android Detox build config hash');
  const embeddedRuntime = record(build.embeddedRuntime, 'Android Detox embedded runtime');
  assert(typeof build.appIdentifier === 'string' && build.appIdentifier.length > 0);
  assert(typeof build.configuration === 'string' && build.configuration.length > 0);
  assert(
    typeof embeddedRuntime.appIdentifier === 'string' && embeddedRuntime.appIdentifier.length > 0,
  );
  assert(typeof embeddedRuntime.apiOrigin === 'string' && embeddedRuntime.apiOrigin.length > 0);
  const environmentHash = build.environmentHash;
  assert(
    environmentHash === undefined ||
      (typeof environmentHash === 'string' && HASH.test(environmentHash)),
    'Android Detox environment hash is invalid',
  );
  const toolVersionsValue = build.toolVersions;
  assert(
    toolVersionsValue === undefined ||
      (toolVersionsValue &&
        typeof toolVersionsValue === 'object' &&
        !Array.isArray(toolVersionsValue)),
  );
  const toolVersions: Record<string, string> = {};
  for (const [name, version] of Object.entries(toolVersionsValue ?? {})) {
    assert(typeof name === 'string' && typeof version === 'string' && version.length > 0);
    toolVersions[name] = version;
  }
  return {
    sourceTreeHash: source.sourceTreeHash,
    helperInputsHash: build.helperInputsHash,
    binaryHash: build.binaryHash,
    testBinaryHash: build.testBinaryHash,
    detoxConfigHash: build.detoxConfigHash,
    appId: embeddedRuntime.appIdentifier || build.appIdentifier,
    buildProfile: build.configuration,
    apiOrigin: embeddedRuntime.apiOrigin,
    environmentHash: environmentHash ?? null,
    toolVersions,
  };
}

function aggregateBuildHash(value: unknown): string {
  const build = record(value, 'Android Detox build');
  return hash(
    JSON.stringify({
      platform: build.platform,
      configuration: build.configuration,
      binaryPath: build.binaryPath,
      binaryHash: build.binaryHash,
      testBinaryPath: build.testBinaryPath,
      testBinaryHash: build.testBinaryHash,
      detoxConfigPath: build.detoxConfigPath,
      detoxConfigHash: build.detoxConfigHash,
      embeddedRuntime: build.embeddedRuntime,
      environmentHash: build.environmentHash,
      toolVersions: build.toolVersions,
    }),
  );
}

async function requireChildAndFlowReceipts(
  input: AndroidDetoxCameraNativeFinalizerInput,
  captureRoot: string,
): Promise<void> {
  const child = record(
    JSON.parse(
      (
        await readArtifact(
          captureRoot,
          input.session.childReceiptPath,
          input.signal,
          input.deadlineAt,
        )
      ).bytes.toString('utf8'),
    ),
    'Detox camera child receipt',
  );
  assert.equal(child.kind, 'private-owned-detox-camera-child-receipt');
  assert.equal(child.captureRunId, input.session.captureRunId);
  assert.equal(child.pid, input.session.childCommandIdentity?.pid);
  assert.equal(child.pgid, input.session.childCommandIdentity?.pgid);
  const outcome = record(child.outcome, 'Detox camera child outcome');
  assert.equal(outcome.code, 0);
  assert.equal(outcome.signal, null);

  const flow = record(
    JSON.parse(
      (
        await readArtifact(
          captureRoot,
          input.session.flowReceiptPath,
          input.signal,
          input.deadlineAt,
        )
      ).bytes.toString('utf8'),
    ),
    'Detox camera flow receipt',
  );
  assert.equal(flow.kind, 'private-owned-android-detox-camera-flow');
  assert.equal(flow.captureRunId, input.session.captureRunId);
  assert.equal(flow.ownerRunId, input.session.ownerRunId);
  // `detox test` runs the spec in a Jest worker, so the flow records the
  // worker PID. Accept it only when the owned child's process census recorded
  // it inside the same launcher-owned process group.
  const childIdentity = input.session.childCommandIdentity;
  assert(childIdentity, 'Detox camera child command identity is missing');
  const ownership = record(
    JSON.parse(
      (
        await readArtifact(
          captureRoot,
          'detox-camera-child.ownership.json',
          input.signal,
          input.deadlineAt,
        )
      ).bytes.toString('utf8'),
    ),
    'Detox camera child ownership census',
  );
  assert.equal(ownership.pid, childIdentity.pid);
  assert.equal(ownership.pgid, childIdentity.pgid);
  assert(Array.isArray(ownership.processes), 'Detox camera child census processes are missing');
  const flowPidOwned =
    flow.childPid === childIdentity.pid ||
    ownership.processes.some((entry: unknown) => {
      const member = record(entry, 'Detox camera child census process');
      return member.pid === flow.childPid && member.pgid === childIdentity.pgid;
    });
  assert(flowPidOwned, 'Detox camera flow PID is not a member of the owned child group');
  assert.equal(flow.commandHash, childIdentity.argvSha256);
  assert(Array.isArray(flow.originalActionReceipts));
  assert.equal(flow.originalActionReceipts.length, 4);
  for (const [index, action] of flow.originalActionReceipts.entries()) {
    const row = record(action, `Detox camera action ${index}`);
    const command = record(row.command, `Detox camera action ${index} command`);
    assert.equal(command.pid, flow.childPid);
    assert.equal(command.argvSha256, input.session.childCommandIdentity?.argvSha256);
    assert.equal(command.commandId, index + 1);
    const frame = record(row.frame, `Detox camera action ${index} frame`);
    requireHash(frame.hierarchySha256, `Detox camera action ${index} hierarchy hash`);
    requireHash(frame.screenshotSha256, `Detox camera action ${index} screenshot hash`);
    requireHash(
      frame.originalScreenshotSha256,
      `Detox camera action ${index} original screenshot hash`,
    );
    assert.equal(frame.screenshotSha256, frame.originalScreenshotSha256);
  }
}

async function rereadStagedBundle(
  input: AndroidDetoxCameraNativeFinalizerInput,
  captureRoot: string,
  outputRoot: string,
  manifestFiles: readonly StageFile[],
): Promise<void> {
  const filesByPath = new Map(manifestFiles.map((file) => [file.path, file]));
  for (const source of requiredSourcePaths(input.producer, input.session)) {
    requireLive(input, 'camera finalization');
    const stagedPath = stageName(input.session.captureRunId, source);
    const staged = filesByPath.get(stagedPath);
    assert(staged, `camera staged source ${source} is missing from the manifest`);
    const original = await readArtifact(captureRoot, source, input.signal, input.deadlineAt);
    const copy = await readArtifact(outputRoot, stagedPath, input.signal, input.deadlineAt);
    assert.equal(original.metadata.mode & 0o777, 0o600, `${source} source is not private`);
    assert.equal(copy.metadata.mode & 0o777, 0o600, `${source} staged copy is not private`);
    assert.equal(hash(original.bytes), staged.sha256, `${source} source changed after staging`);
    assert.equal(hash(copy.bytes), staged.sha256, `${source} staged bytes changed`);
    assert.equal(original.bytes.byteLength, staged.bytes, `${source} source size changed`);
    assert.equal(copy.bytes.byteLength, staged.bytes, `${source} staged size changed`);
  }
}

function verifiedBindings(
  bindings: readonly AndroidDetoxCameraAssertionBinding[],
): readonly AndroidDetoxCameraAssertionBinding[] {
  assert.deepEqual(
    bindings.map((binding) => binding.id),
    [...ANDROID_CAMERA_ASSERTION_IDS],
    'Android Detox camera assertion order changed before finalization',
  );
  return bindings.map((binding) => ({
    ...binding,
    status: 'verified-native' as const,
  }));
}

/**
 * The sole native/public promotion boundary for the Detox camera route.
 * Source staging remains zero-valued; this function is called by the actual
 * native pilot only after the owned child, cleanup census, original command
 * identities, and descriptor-bound copies have completed. It rereads the
 * original bundle and the copy manifest before publishing a distinct receipt.
 */
export const finalizeAndroidDetoxCameraNativeRuntime: AndroidDetoxCameraNativeFinalizer = async (
  input,
) => {
  requireLive(input, 'Android Detox camera finalization');
  requireRunId(input.requestedRunId, 'Android Detox requested run ID');
  assert.match(
    input.requestedAttemptId,
    new RegExp(`^${input.requestedRunId}:first$`),
    'Android Detox requested attempt ID is not bound to the run',
  );
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  assert(path.isAbsolute(input.repositoryRoot));
  assert.equal(await realpath(input.repositoryRoot), path.resolve(input.repositoryRoot));
  const captureRoot = await privateRoot(input.session.captureRoot, 'camera capture root');
  const outputRoot = await privateRoot(input.session.outputRoot, 'camera output root');
  requireRunId(input.session.captureRunId, 'Android Detox capture run ID');
  requireRunId(input.session.fixtureRunId, 'Android Detox backend run ID');
  requireRunId(input.session.ownerRunId, 'Android Detox resource owner run ID');
  requireRunId(input.session.targetOwnerRunId, 'Android Detox target owner run ID');
  requireAndroidDetoxCameraIdentityBoundary({
    requestedRunId: input.requestedRunId,
    captureRunId: input.session.captureRunId,
    ownerRunId: input.session.ownerRunId,
    backendRunId: input.session.fixtureRunId,
  });
  assert.notEqual(input.session.targetOwnerRunId, input.requestedRunId);
  assert.notEqual(input.session.targetOwnerRunId, input.session.captureRunId);
  assert.notEqual(input.session.targetOwnerRunId, input.session.ownerRunId);
  assert.notEqual(input.session.targetOwnerRunId, input.session.fixtureRunId);
  assert.equal(input.session.fixtureRunId, input.producer.backendRunId);
  assert.equal(input.session.ownerRunId, input.producer.flow.ownerRunId);
  assert.equal(input.session.targetOwnerRunId, input.producer.targetRunId);
  assert.equal(input.session.targetDeviceId, input.producer.flow.serial);
  assert(
    typeof input.session.target.osVersion === 'string' && input.session.target.osVersion.length > 0,
  );
  assert(typeof input.session.target.appId === 'string' && input.session.target.appId.length > 0);
  assert(
    typeof input.session.target.buildProfile === 'string' &&
      input.session.target.buildProfile.length > 0,
  );
  requireHash(input.session.target.binaryHash, 'camera target binary hash');
  assert(
    typeof input.session.target.apiOrigin === 'string' && input.session.target.apiOrigin.length > 0,
  );
  assert.equal(input.session.cleanup.status, 'cleaned');
  assert.equal(input.session.cleanup.independentCensus, 'passed');
  assert.deepEqual(input.session.cleanup.retainedPaths, []);
  assert(input.session.childCommandIdentity, 'camera child command identity is missing');
  requireHash(input.session.childCommandIdentity.argvSha256, 'camera child command hash');
  assert(Number.isSafeInteger(input.session.childCommandIdentity.pid));
  assert(Number.isSafeInteger(input.session.childCommandIdentity.pgid));
  assert(input.session.childCommandIdentity.deadlineAtEpochMs > Date.now());
  requireAndroidDetoxCameraProducerOutput(input.producer, {
    selectionHash: androidCameraSelectionHash(input.selection),
    requestedRunId: input.requestedRunId,
    runId: input.session.captureRunId,
    ownerRunId: input.session.ownerRunId,
    targetRunId: input.session.targetOwnerRunId,
    serial: input.session.targetDeviceId,
    expectedLocale: input.producer.locale,
  });
  requireHash(input.session.sourceTreeHash, 'camera session source hash');
  requireHash(input.session.helperInputsHash, 'camera session helper hash');
  requireHash(input.session.buildHash, 'camera session build hash');
  assert.equal(input.session.sourceTreeHash, input.producer.sourceTreeHash);
  assert.equal(input.session.helperInputsHash, input.producer.helperInputsHash);
  assert.equal(input.session.buildHash, input.producer.buildHash);
  const build = buildIdentity(input.build);
  assert.equal(build.sourceTreeHash, input.producer.sourceTreeHash);
  assert.equal(build.helperInputsHash, input.producer.helperInputsHash);
  assert.deepEqual(input.session.buildIdentity, build);
  assert.equal(input.session.target.binaryHash, build.binaryHash);
  assert.equal(input.session.target.appId, build.appId);
  assert.equal(input.session.target.buildProfile, build.buildProfile);
  assert.equal(input.session.target.apiOrigin, build.apiOrigin);
  assert.equal(input.session.runtime.flagsHash, build.environmentHash);
  assert.deepEqual(input.session.runtime.toolVersions, build.toolVersions);
  assert.equal(aggregateBuildHash(input.build), input.session.buildHash);
  assert.equal(aggregateBuildHash(input.build), input.producer.buildHash);
  assert.equal(input.stage.status, 'validated-source-only');
  assert.equal(input.stage.publicPromotionEligible, false);
  assert.equal(input.stage.nativePassingCases, 0);
  assert.equal(input.stage.publicPassingCases, 0);
  assert.deepEqual(
    input.stage.assertionBindings.map((binding) => binding.id),
    [...ANDROID_CAMERA_ASSERTION_IDS],
  );
  const manifest = await readArtifact(
    outputRoot,
    input.stage.manifestPath,
    input.signal,
    input.deadlineAt,
  );
  assert.equal(hash(manifest.bytes), input.stage.manifestSha256);
  const manifestValue = record(
    JSON.parse(manifest.bytes.toString('utf8')),
    'Android Detox camera stage manifest',
  );
  assert.equal(
    manifestValue.kind,
    'private-owned-android-detox-camera-evidence-copy-not-public-outcome',
  );
  assert.equal(manifestValue.status, 'validated-source-only');
  assert.equal(manifestValue.requestedRunId, input.requestedRunId);
  assert.equal(manifestValue.captureRunId, input.session.captureRunId);
  assert.equal(manifestValue.fixtureRunId, input.session.fixtureRunId);
  assert.equal(manifestValue.targetOwnerRunId, input.session.targetOwnerRunId);
  const selection = record(manifestValue.selection, 'Android Detox camera stage selection');
  assert.deepEqual(selection.assertionIds, [...ANDROID_CAMERA_ASSERTION_IDS]);
  const files = stageFiles(manifestValue);
  await requireChildAndFlowReceipts(input, captureRoot);
  await rereadStagedBundle(input, captureRoot, outputRoot, files);
  requireLive(input, 'Android Detox camera finalization receipt');
  const bindings = verifiedBindings(input.stage.assertionBindings);
  const receiptValue = {
    kind: 'private-owned-android-detox-camera-native-runtime-finalization-receipt',
    status: 'published-native',
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRunId: input.session.captureRunId,
    fixtureRunId: input.session.fixtureRunId,
    backendRunId: input.producer.backendRunId,
    ownerRunId: input.session.ownerRunId,
    targetOwnerRunId: input.session.targetOwnerRunId,
    targetDeviceId: input.session.targetDeviceId,
    childCommandIdentity: input.session.childCommandIdentity,
    deadlineAtMonotonicMs: input.deadlineAt,
    stageManifest: {
      path: input.stage.manifestPath,
      sha256: input.stage.manifestSha256,
    },
    assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
    nativePassingCases: 4,
    publicPassingCases: 4,
    publicPromotionEligible: true,
  } as const;
  const receiptBytes = Buffer.from(`${JSON.stringify(receiptValue, null, 2)}\n`);
  const published = await writeAndroidCameraAnchoredFile({
    root: outputRoot,
    relativePath: ANDROID_DETOX_CAMERA_FINALIZER_RECEIPT_PATH,
    bytes: receiptBytes,
    signal: input.signal,
    deadlineAt: input.deadlineAt,
  });
  assert.equal(published.identity.mode & 0o777, 0o600);
  assert.equal(published.identity.nlink, 1);
  requireLive(input, 'Android Detox camera finalization reread');
  const reread = await readArtifact(
    outputRoot,
    ANDROID_DETOX_CAMERA_FINALIZER_RECEIPT_PATH,
    input.signal,
    input.deadlineAt,
  );
  assert.equal(reread.metadata.mode & 0o777, 0o600);
  assert.equal(hash(reread.bytes), hash(receiptBytes));
  assert.deepEqual(JSON.parse(reread.bytes.toString('utf8')), receiptValue);
  return {
    kind: 'private-owned-android-detox-camera-native-runtime-finalization-not-public-receipt',
    status: 'verified-native',
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRunId: input.session.captureRunId,
    fixtureRunId: input.session.fixtureRunId,
    backendRunId: input.producer.backendRunId,
    ownerRunId: input.session.ownerRunId,
    targetOwnerRunId: input.session.targetOwnerRunId,
    targetDeviceId: input.session.targetDeviceId,
    childCommandIdentity: input.session.childCommandIdentity,
    stageManifest: {
      path: input.stage.manifestPath,
      sha256: input.stage.manifestSha256,
    },
    receipt: {
      path: ANDROID_DETOX_CAMERA_FINALIZER_RECEIPT_PATH,
      sha256: hash(reread.bytes),
    },
    assertionBindings: bindings,
    nativePassingCases: 4,
    publicPassingCases: 4,
    publicPromotionEligible: true,
  };
};
