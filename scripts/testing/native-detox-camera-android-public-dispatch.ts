import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { requireAndroidDetoxCameraIdentityBoundary } from './native-detox-camera-android-identity';
import { runAndroidDetoxCameraOwnedSession } from './native-detox-camera-android-owned-session';
import {
  buildAndroidDetoxCameraProducer,
  requireAndroidDetoxCameraProducerOutput,
  type AndroidDetoxCameraProducerContext,
  type AndroidDetoxCameraProducerReceipts,
} from './native-detox-camera-android-producer';
import {
  ANDROID_CAMERA_ASSERTION_IDS,
  ANDROID_CAMERA_SCENARIO,
  androidCameraSelectionHash,
  readOwnedDetoxConnectionEvidence,
  writeAtomicDetoxConnectionBytes,
  writeAndroidCameraAnchoredFile,
} from './native-detox-camera-android-q-adapter';
import {
  requireNativePilotAssertions,
  type NativePilotSelection,
} from './native-detox-camera-android-q-adapter';
import type {
  AndroidDetoxCameraNativeFinalization,
  AndroidDetoxCameraNativeFinalizer,
} from './native-detox-camera-android-public-finalizer';
import type {
  AndroidDetoxCameraResetExpectation,
  AndroidDetoxCameraResetProof,
} from './native-detox-camera-android-reset';

const RUN_ID = /^[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 512 * 1024;

export const ANDROID_DETOX_CAMERA_PUBLIC_OWNER = 'detox-camera-driver' as const;
export const ANDROID_DETOX_CAMERA_PUBLIC_DISPATCH = 'android-detox-camera' as const;
export const ANDROID_DETOX_CAMERA_PUBLIC_KIND =
  'private-owned-android-detox-camera-public-attempt-not-public-receipt' as const;

export type AndroidDetoxCameraCleanup = Readonly<{
  status: 'cleaned' | 'failed-recovery-retained' | 'not-acquired';
  independentCensus: 'passed' | 'failed' | 'not-executed';
  retainedPaths: readonly string[];
}>;

export type AndroidDetoxCameraRuntimeEvidence = Readonly<{
  backendAttemptId: string | null;
  fixtureHash: string | null;
  flagsHash: string | null;
  toolVersions: Readonly<Record<string, string>>;
  timingsMs: Readonly<{
    build: number;
    install: number;
    reset: number;
    scenario: number;
    verify: number;
    cleanup: number;
  }>;
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
  captureResult: 'observed' | 'harness-blocked' | 'cancelled';
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGINT' | 'SIGTERM' | null;
  callbackInvocations: number;
  callbackCompleted: boolean;
  captureInvocation: { count: number; returned: boolean };
  captureCompleted: boolean;
  externalCleanupResult: 'passed' | 'failed';
  verificationResult: 'passed' | 'blocked' | 'not-executed';
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
}>;

/**
 * This is the one parent-owned Android Detox lifecycle handoff. The owner must
 * acquire the host lock, target, Detox debug build, backend/proxy and fixture
 * session before calling executeCamera. It must also stop/drain the child and
 * return the independent cleanup result before this route can publish a stage.
 * It is deliberately receipt-shaped, rather than a boolean “ready” flag.
 */
export type AndroidDetoxCameraOwnedSessionResult = Readonly<{
  captureRoot: string;
  outputRoot: string;
  captureRunId: string;
  fixtureRunId: string;
  ownerRunId: string;
  targetOwnerRunId: string;
  targetDeviceId: string;
  producer: AndroidDetoxCameraProducerReceipts | null;
  cleanup: AndroidDetoxCameraCleanup;
  runtime: AndroidDetoxCameraRuntimeEvidence;
  target: {
    deviceId: string | null;
    osVersion: string | null;
    appId: string | null;
    buildProfile: string | null;
    binaryHash: string | null;
    apiOrigin: string | null;
  };
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
  /** Source/runtime identity from the same owner that produced the receipts. */
  sourceTreeHash: string | null;
  helperInputsHash: string | null;
  buildHash: string | null;
  coldReset?: AndroidDetoxCameraResetProof | null;
  childReceiptPath: string;
  flowReceiptPath: string;
  failure: { name: string; message: string } | null;
  childCommandIdentity: Readonly<{
    pid: number;
    pgid: number;
    started: string;
    argvSha256: string;
    cwd: string;
    deadlineAtEpochMs: number;
  }> | null;
}>;

export type AndroidDetoxCameraSessionRunner = (
  input: Readonly<{
    repositoryRoot: string;
    serverRoot: string;
    artifactRoot: string;
    requestedRunId: string;
    captureRunId: string;
    selection: NativePilotSelection;
    expectedLocale: 'en-US' | 'pt-BR' | 'es-ES';
    signal: AbortSignal;
    deadlineAt: number;
    build?: unknown;
    runnerPaths?: Readonly<{ jestConfigPath: string; testPath: string }>;
    parentEnv?: Readonly<Record<string, string | undefined>>;
    coldReset?: AndroidDetoxCameraResetExpectation;
    coldResetBinding?: unknown;
    executeCamera: (
      context: AndroidDetoxCameraProducerContext,
    ) => Promise<AndroidDetoxCameraProducerReceipts>;
  }>,
) => Promise<AndroidDetoxCameraOwnedSessionResult>;

export type AndroidDetoxCameraAssertionBinding = Readonly<{
  id: (typeof ANDROID_CAMERA_ASSERTION_IDS)[number];
  evidenceKinds: readonly ('ui' | 'api' | 'sql')[];
  evidencePaths: readonly string[];
  status: 'validated-source-only' | 'verified-native';
}>;

export type AndroidDetoxCameraStage = Readonly<{
  status: 'validated-source-only';
  engine: 'detox';
  manifestPath: string;
  manifestSha256: string;
  assertionBindings: readonly AndroidDetoxCameraAssertionBinding[];
  files: readonly {
    path: string;
    bytes: number;
    sha256: string;
    mode: number;
  }[];
  publicPromotionEligible: false;
  nativePassingCases: 0;
  publicPassingCases: 0;
}>;

export type AndroidDetoxCameraPublicResult = Readonly<{
  kind: typeof ANDROID_DETOX_CAMERA_PUBLIC_KIND;
  owner: typeof ANDROID_DETOX_CAMERA_PUBLIC_OWNER;
  dispatch: typeof ANDROID_DETOX_CAMERA_PUBLIC_DISPATCH;
  status: 'source-only' | 'verified-native' | 'harness-blocked' | 'cancelled';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string | null;
  fixtureRunId: string | null;
  targetDeviceId: string | null;
  targetOwnerRunId: string | null;
  producer: AndroidDetoxCameraProducerReceipts | null;
  stage: AndroidDetoxCameraStage | null;
  cleanup: AndroidDetoxCameraCleanup;
  runtime: AndroidDetoxCameraRuntimeEvidence;
  target: {
    deviceId: string | null;
    osVersion: string | null;
    appId: string | null;
    buildProfile: string | null;
    binaryHash: string | null;
    apiOrigin: string | null;
  };
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
  assertionBindings: readonly AndroidDetoxCameraAssertionBinding[];
  failure: { name: string; message: string } | null;
  sourceTreeHash: string | null;
  helperInputsHash: string | null;
  buildHash: string | null;
  coldReset?: AndroidDetoxCameraResetProof | null;
  nativePassingCases: 0 | 4;
  publicPassingCases: 0 | 4;
  publicPromotionEligible: boolean;
  nativeFinalization: AndroidDetoxCameraNativeFinalization | null;
}>;

type SourceFile = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  mode: number;
}>;

type StableFile = Readonly<{ bytes: Buffer; source: SourceFile }>;

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorRecord(error: unknown): { name: string; message: string } {
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as Record<string, unknown>).name === 'string' &&
    typeof (error as Record<string, unknown>).message === 'string'
  ) {
    return {
      name: String((error as Record<string, unknown>).name).slice(0, 128),
      message: String((error as Record<string, unknown>).message).slice(0, 512),
    };
  }
  return {
    name: error instanceof Error ? error.name.slice(0, 128) : 'UnknownError',
    message: (error instanceof Error ? error.message : String(error)).slice(0, 512),
  };
}

function requireRunId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && HASH.test(value), `${label} is invalid`);
}

function safeRelative(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is missing`);
  assert(!path.isAbsolute(value), `${label} is absolute`);
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  assert(
    normalized === value && normalized !== '.' && !normalized.startsWith('../'),
    `${label} escapes`,
  );
  assert(!normalized.split('/').includes('..'), `${label} escapes`);
  return normalized;
}

async function privateRoot(value: string, label: string): Promise<string> {
  const resolved = path.resolve(value);
  assert.equal(await realpath(resolved), resolved, `${label} is not canonical`);
  const info = await lstat(resolved);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a regular directory`);
  assert.equal(info.uid, process.getuid?.(), `${label} is not owned`);
  assert.equal(info.mode & 0o777, 0o700, `${label} must be mode 0700`);
  return resolved;
}

async function readStable(root: string, relative: string, label: string): Promise<StableFile> {
  const safe = safeRelative(relative, label);
  assert(path.dirname(safe) === '.', `${label} must be a direct artifact`);
  let evidence;
  try {
    evidence = await readOwnedDetoxConnectionEvidence(root, safe, MAX_ARTIFACT_BYTES);
  } catch (error) {
    // errorRecord keeps only name/message; carry the cause in the message.
    const causeText = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} could not be read: ${causeText}`, { cause: error });
  }
  return {
    bytes: evidence.bytes,
    source: {
      path: safe,
      bytes: evidence.bytes.byteLength,
      sha256: hash(evidence.bytes),
      mode: evidence.metadata.mode & 0o777,
    },
  };
}

async function writeStaged(
  root: string,
  relative: string,
  bytes: Buffer,
  signal?: AbortSignal,
  deadlineAt?: number,
): Promise<SourceFile> {
  const safe = safeRelative(relative, 'staged source path');
  assert(path.dirname(safe) === '.', 'staged path must be a direct artifact');
  if (bytes.byteLength === 0) throw new Error(`staged source ${safe} is empty`);
  let published;
  try {
    published = await writeAndroidCameraAnchoredFile({
      root,
      relativePath: safe,
      bytes,
      signal,
      deadlineAt,
    });
  } catch (error) {
    throw new Error(`staged source ${safe} could not be published`, {
      cause: error,
    });
  }
  return {
    path: safe,
    bytes: bytes.byteLength,
    sha256: hash(bytes),
    mode: published.identity.mode & 0o777,
  };
}

function requireDetoxCameraSelection(selection: NativePilotSelection): void {
  assert.deepEqual(selection.arguments, {
    platform: 'android',
    engine: 'detox',
    scenario: ANDROID_CAMERA_SCENARIO,
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, ANDROID_CAMERA_SCENARIO);
  assert.equal(selection.scenario.platform, 'android');
  assert.equal(selection.scenario.flowId, 'FLW-camera-denied');
  assert.equal(selection.scenario.dataMode, 'postgres');
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    [...ANDROID_CAMERA_ASSERTION_IDS],
  );
}

function requireSessionIdentity(
  session: AndroidDetoxCameraOwnedSessionResult,
  requestedRunId: string,
  captureRunId: string,
): void {
  requireRunId(session.captureRunId, 'camera capture run ID');
  requireRunId(session.fixtureRunId, 'camera fixture run ID');
  requireRunId(session.ownerRunId, 'camera resource owner run ID');
  requireRunId(session.targetOwnerRunId, 'camera target owner run ID');
  assert(session.producer, 'camera producer receipts are missing after owned cleanup');
  assert(session.childCommandIdentity, 'camera child command identity is missing');
  assert.equal(session.captureRunId, captureRunId);
  requireAndroidDetoxCameraIdentityBoundary({
    requestedRunId,
    captureRunId: session.captureRunId,
    ownerRunId: session.ownerRunId,
    backendRunId: session.fixtureRunId,
  });
  assert.notEqual(session.targetOwnerRunId, requestedRunId);
  assert.notEqual(session.targetOwnerRunId, session.captureRunId);
  assert.notEqual(session.targetOwnerRunId, session.ownerRunId);
  assert.notEqual(session.targetOwnerRunId, session.fixtureRunId);
  assert.equal(session.producer.targetRunId, session.targetOwnerRunId);
  assert.equal(session.producer.ownerRunId, session.ownerRunId);
  assert(typeof session.targetDeviceId === 'string' && session.targetDeviceId.length > 0);
  assert(typeof session.target.osVersion === 'string' && session.target.osVersion.length > 0);
  assert(typeof session.target.appId === 'string' && session.target.appId.length > 0);
  assert(typeof session.target.buildProfile === 'string' && session.target.buildProfile.length > 0);
  requireHash(session.target.binaryHash, 'camera target binary hash');
  assert(typeof session.target.apiOrigin === 'string' && session.target.apiOrigin.length > 0);
  requireHash(session.sourceTreeHash, 'camera source tree hash');
  requireHash(session.helperInputsHash, 'camera helper inputs hash');
  requireHash(session.buildHash, 'camera build hash');
  requireHash(session.buildIdentity.sourceTreeHash, 'camera build source tree hash');
  requireHash(session.buildIdentity.helperInputsHash, 'camera build helper hash');
  requireHash(session.buildIdentity.binaryHash, 'camera build binary hash');
  requireHash(session.buildIdentity.detoxConfigHash, 'camera build config hash');
  assert.equal(session.buildIdentity.sourceTreeHash, session.sourceTreeHash);
  assert.equal(session.buildIdentity.helperInputsHash, session.helperInputsHash);
  assert.equal(session.buildIdentity.binaryHash, session.target.binaryHash);
  assert.equal(session.buildIdentity.appId, session.target.appId);
  assert.equal(session.buildIdentity.buildProfile, session.target.buildProfile);
  assert.equal(session.buildIdentity.apiOrigin, session.target.apiOrigin);
  assert(session.buildIdentity.appId.length > 0);
  assert(session.buildIdentity.buildProfile.length > 0);
  assert(session.buildIdentity.apiOrigin.length > 0);
  assert(typeof session.childReceiptPath === 'string' && session.childReceiptPath.length > 0);
  assert(typeof session.flowReceiptPath === 'string' && session.flowReceiptPath.length > 0);
  assert.equal(session.cleanup.status, 'cleaned');
  assert.equal(session.cleanup.independentCensus, 'passed');
  assert.deepEqual(session.cleanup.retainedPaths, []);
}

export type AndroidDetoxCameraFlowReceipt = Readonly<{
  schemaVersion: 1;
  kind: 'private-owned-android-detox-camera-flow';
  status: 'observed';
  captureRunId: string;
  ownerRunId: string;
  attemptId: string;
  serial: string;
  appId: 'com.edufelip.mychampions.dev';
  actorRoles: readonly ['coach', 'student'];
  inviteCodeSha256: string;
  pendingConnectionId: string;
  pendingConnectionIdSha256: string;
  source: 'owned-detox-child-native-hierarchy';
  childPid: number;
  commandHash: string;
}>;

async function readAndroidDetoxCameraFlowReceipt(
  input: Readonly<{
    captureRoot: string;
    relativePath: string;
    expected: Pick<
      AndroidDetoxCameraOwnedSessionResult,
      'captureRunId' | 'ownerRunId' | 'targetDeviceId'
    > & {
      childCommandIdentity: NonNullable<
        AndroidDetoxCameraOwnedSessionResult['childCommandIdentity']
      >;
    };
  }>,
): Promise<AndroidDetoxCameraFlowReceipt> {
  const loaded = await readStable(
    input.captureRoot,
    input.relativePath,
    'Detox camera child flow receipt',
  );
  let value: unknown;
  try {
    value = JSON.parse(loaded.bytes.toString('utf8'));
  } catch (error) {
    throw new Error('Detox camera child flow receipt is not JSON', {
      cause: error,
    });
  }
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'Detox camera child flow receipt is malformed',
  );
  const row = value as Record<string, unknown>;
  assert.equal(row.schemaVersion, 1);
  assert.equal(row.kind, 'private-owned-android-detox-camera-flow');
  assert.equal(row.status, 'observed');
  assert.equal(row.captureRunId, input.expected.captureRunId);
  assert.equal(row.ownerRunId, input.expected.ownerRunId);
  assert.equal(row.attemptId, `${input.expected.ownerRunId}:first`);
  assert.equal(row.serial, input.expected.targetDeviceId);
  assert.equal(row.appId, 'com.edufelip.mychampions.dev');
  assert(Number.isSafeInteger(row.childPid) && Number(row.childPid) > 0);
  assert.equal(row.commandHash, input.expected.childCommandIdentity.argvSha256);
  assert.deepEqual(row.actorRoles, ['coach', 'student']);
  requireHash(row.inviteCodeSha256, 'Detox camera invite-code hash');
  requireHash(row.pendingConnectionIdSha256, 'Detox camera pending-connection hash');
  assert(
    typeof row.pendingConnectionId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(row.pendingConnectionId),
  );
  assert.equal(row.pendingConnectionIdSha256, hash(row.pendingConnectionId));
  assert.equal(row.source, 'owned-detox-child-native-hierarchy');
  assert(
    Array.isArray(row.originalActionReceipts) && row.originalActionReceipts.length === 4,
    'Detox camera original action receipts are missing',
  );
  return row as unknown as AndroidDetoxCameraFlowReceipt;
}

function requiredProducerPaths(
  producer: AndroidDetoxCameraProducerReceipts,
  flowReceiptPath: string,
  childReceiptPath: string,
): string[] {
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
    childReceiptPath,
    flowReceiptPath,
  ];
}

function assertionBindings(
  producer: AndroidDetoxCameraProducerReceipts,
): AndroidDetoxCameraAssertionBinding[] {
  const frame = (label: 'entry' | 'prompt' | 'denied' | 'manual') => {
    const item = producer.bridge.frames.find((row) => row.label === label);
    return item
      ? [item.hierarchy.hierarchy.path, item.hierarchy.screenshot.path]
      : [`${label}.missing`];
  };
  const sql = producer.sqlReceipts.map((receipt) => receipt.path);
  return [
    {
      id: 'NAT-camera-normal-entry',
      evidenceKinds: ['ui', 'api', 'sql'],
      evidencePaths: [
        ...frame('entry'),
        producer.bridge.receiptHost.path,
        producer.submission.descriptorPath,
        sql[0],
      ],
      status: 'validated-source-only',
    },
    {
      id: 'NAT-camera-denial-guidance',
      evidenceKinds: ['ui'],
      evidencePaths: [...frame('prompt'), ...frame('denied')],
      status: 'validated-source-only',
    },
    {
      id: 'NAT-camera-manual-submit',
      evidenceKinds: ['ui', 'api', 'sql'],
      evidencePaths: [...frame('manual'), producer.submission.sourcePath, ...sql],
      status: 'validated-source-only',
    },
    {
      id: 'NAT-camera-unrelated-state',
      evidenceKinds: ['sql'],
      evidencePaths: sql.filter((pathValue) => /isolation/u.test(pathValue)),
      status: 'validated-source-only',
    },
  ];
}

/**
 * Stage the original producer bundle only after outer cleanup has passed. The
 * manifest retains four semantic bindings, but all native/public counts stay
 * zero until a separate terminal verifier sees an actual native receipt.
 */
export async function stageAndroidDetoxCameraEvidence(
  input: Readonly<{
    captureRoot: string;
    outputRoot: string;
    requestedRunId: string;
    captureRunId: string;
    fixtureRunId: string;
    targetOwnerRunId: string;
    selection: NativePilotSelection;
    producer: AndroidDetoxCameraProducerReceipts;
    childReceiptPath: string;
    flowReceiptPath: string;
    signal: AbortSignal;
    deadlineAt: number;
  }>,
): Promise<AndroidDetoxCameraStage> {
  input.signal.throwIfAborted();
  assert(performance.now() < input.deadlineAt, 'Android Detox camera staging deadline expired');
  const captureRoot = await privateRoot(input.captureRoot, 'camera capture root');
  const outputRoot = await privateRoot(input.outputRoot, 'camera output root');
  requireDetoxCameraSelection(input.selection);
  requireRunId(input.requestedRunId, 'requested camera run ID');
  requireRunId(input.captureRunId, 'capture camera run ID');
  assert.equal(input.fixtureRunId, input.producer.backendRunId);
  requireRunId(input.targetOwnerRunId, 'target owner run ID');
  assert.equal(input.targetOwnerRunId, input.producer.targetRunId);
  requireAndroidDetoxCameraProducerOutput(input.producer, {
    selectionHash: androidCameraSelectionHash(input.selection),
    requestedRunId: input.requestedRunId,
    runId: input.captureRunId,
    ownerRunId: input.producer.flow.ownerRunId,
    targetRunId: input.targetOwnerRunId,
    serial: input.producer.flow.serial,
    expectedLocale: input.producer.locale,
  });
  const sourcePaths = [
    ...new Set(
      requiredProducerPaths(input.producer, input.flowReceiptPath, input.childReceiptPath),
    ),
  ];
  const loaded = new Map<string, StableFile>();
  for (const relative of sourcePaths) {
    input.signal.throwIfAborted();
    assert(performance.now() < input.deadlineAt, 'Android Detox camera staging deadline expired');
    loaded.set(relative, await readStable(captureRoot, relative, `camera source ${relative}`));
  }
  const files: SourceFile[] = [];
  const writtenPaths: string[] = [];
  const stageName = (relative: string) =>
    `detox-camera-stage-${input.captureRunId}-${hash(relative).slice(0, 12)}-${path.basename(relative)}`;
  try {
    for (const [relative, file] of loaded) {
      input.signal.throwIfAborted();
      const staged = await writeStaged(
        outputRoot,
        stageName(relative),
        file.bytes,
        input.signal,
        input.deadlineAt,
      );
      files.push(staged);
      writtenPaths.push(staged.path);
    }
    const bindings = assertionBindings(input.producer).map((binding) => ({
      ...binding,
      evidencePaths: binding.evidencePaths.map(stageName),
    }));
    const manifestValue = {
      kind: 'private-owned-android-detox-camera-evidence-copy-not-public-outcome',
      status: 'validated-source-only',
      owner: ANDROID_DETOX_CAMERA_PUBLIC_OWNER,
      platform: 'android',
      engine: 'detox',
      requestedRunId: input.requestedRunId,
      captureRunId: input.captureRunId,
      fixtureRunId: input.fixtureRunId,
      targetOwnerRunId: input.targetOwnerRunId,
      selection: {
        arguments: input.selection.arguments,
        scenarioId: input.selection.scenario.id,
        scenarioHash: input.selection.scenarioHash,
        requirementHash: input.selection.requirementHash,
        assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
        selectionHash: androidCameraSelectionHash(input.selection),
      },
      assertionBindings: bindings,
      files,
      publicPromotionEligible: false,
      nativePassingCases: 0,
      publicPassingCases: 0,
    } as const;
    const manifestBytes = Buffer.from(`${JSON.stringify(manifestValue, null, 2)}\n`);
    assert(manifestBytes.byteLength <= MAX_MANIFEST_BYTES, 'camera manifest exceeds its cap');
    const manifestRelative = `detox-camera-stage-${input.captureRunId}-copy-manifest.private.json`;
    const manifest = await writeStaged(
      outputRoot,
      manifestRelative,
      manifestBytes,
      input.signal,
      input.deadlineAt,
    );
    files.push(manifest);
    writtenPaths.push(manifest.path);
    return {
      status: 'validated-source-only',
      engine: 'detox',
      manifestPath: manifest.path,
      manifestSha256: manifest.sha256,
      assertionBindings: bindings,
      files,
      publicPromotionEligible: false,
      nativePassingCases: 0,
      publicPassingCases: 0,
    };
  } catch (error) {
    // Keep a descriptor-backed recovery ledger for every child that was
    // published before the failure.  Recovery never recursively deletes a
    // replaced ancestor or claims a clean stage after a partial publication.
    const ledgerRelative = `detox-camera-stage-${input.captureRunId}-rollback.private.json`;
    try {
      await writeAtomicDetoxConnectionBytes(
        outputRoot,
        ledgerRelative,
        Buffer.from(
          `${JSON.stringify({
            kind: 'private-owned-android-detox-camera-staging-rollback-v1',
            status: 'recovery-required',
            captureRunId: input.captureRunId,
            outputRoot: path.basename(outputRoot),
            writtenPaths: [...writtenPaths],
            failure: errorRecord(error),
          })}\n`,
        ),
        MAX_MANIFEST_BYTES,
        {
          signal: input.signal,
          deadlineAt: input.deadlineAt,
        },
      );
    } catch {
      // The original stage error remains authoritative when recovery evidence
      // itself cannot be published; callers must retain the output namespace.
    }
    throw error;
  }
}

function blockedResult(input: {
  requestedRunId: string;
  status: AndroidDetoxCameraPublicResult['status'];
  failure: unknown;
  cleanup?: AndroidDetoxCameraCleanup;
  session?: AndroidDetoxCameraOwnedSessionResult;
}): AndroidDetoxCameraPublicResult {
  return {
    kind: ANDROID_DETOX_CAMERA_PUBLIC_KIND,
    owner: ANDROID_DETOX_CAMERA_PUBLIC_OWNER,
    dispatch: ANDROID_DETOX_CAMERA_PUBLIC_DISPATCH,
    status: input.status,
    requestedRunId: input.requestedRunId,
    requestedAttemptId: `${input.requestedRunId}:first`,
    captureRunId: input.session?.captureRunId ?? null,
    fixtureRunId: input.session?.fixtureRunId ?? null,
    targetDeviceId: input.session?.targetDeviceId ?? null,
    targetOwnerRunId: input.session?.targetOwnerRunId ?? null,
    producer: input.session?.producer ?? null,
    stage: null,
    runtime: input.session?.runtime ?? {
      backendAttemptId: null,
      fixtureHash: null,
      flagsHash: null,
      toolVersions: {},
      timingsMs: {
        build: 0,
        install: 0,
        reset: 0,
        scenario: 0,
        verify: 0,
        cleanup: 0,
      },
      captureExitCode: input.status === 'cancelled' ? 143 : 2,
      childExitCode: null,
      childSignal: null,
      childClassification: null,
      captureResult: input.status === 'cancelled' ? 'cancelled' : 'harness-blocked',
      captureTimeout: null,
      cancellation: input.status === 'cancelled' ? 'SIGTERM' : null,
      callbackInvocations: 0,
      callbackCompleted: false,
      captureInvocation: { count: 0, returned: false },
      captureCompleted: false,
      externalCleanupResult: 'failed',
      verificationResult: 'blocked',
      verificationFailure: errorRecord(input.failure),
      postCaptureFailure: {
        phase: 'verification',
        ...errorRecord(input.failure),
      },
      deadline: null,
      commandDiagnostics: [],
      censusFailures: [],
      outputFailures: [],
    },
    target: input.session?.target ?? {
      deviceId: null,
      osVersion: null,
      appId: null,
      buildProfile: null,
      binaryHash: null,
      apiOrigin: null,
    },
    buildIdentity: input.session?.buildIdentity ?? {
      sourceTreeHash: '',
      helperInputsHash: '',
      binaryHash: '',
      testBinaryHash: null,
      detoxConfigHash: '',
      appId: '',
      buildProfile: '',
      apiOrigin: '',
      environmentHash: null,
      toolVersions: {},
    },
    cleanup: input.cleanup ??
      input.session?.cleanup ?? {
        status: 'not-acquired',
        independentCensus: 'not-executed',
        retainedPaths: [],
      },
    assertionBindings: [],
    failure: errorRecord(input.failure),
    sourceTreeHash: input.session?.sourceTreeHash ?? null,
    helperInputsHash: input.session?.helperInputsHash ?? null,
    buildHash: input.session?.buildHash ?? null,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    nativeFinalization: null,
    coldReset: input.session?.coldReset ?? null,
  };
}

function requireCompletedRuntimeEvidence(session: AndroidDetoxCameraOwnedSessionResult): void {
  const runtime = session.runtime;
  assert.equal(runtime.captureResult, 'observed');
  assert.equal(runtime.captureExitCode, 0);
  assert.equal(runtime.childExitCode, 0);
  assert.equal(runtime.childSignal, null);
  assert.equal(runtime.childClassification, 'completed');
  assert.equal(runtime.captureTimeout, null);
  assert.equal(runtime.cancellation, null);
  assert.equal(runtime.callbackInvocations, 1);
  assert.equal(runtime.callbackCompleted, true);
  assert.deepEqual(runtime.captureInvocation, { count: 1, returned: true });
  assert.equal(runtime.captureCompleted, true);
  assert.equal(runtime.externalCleanupResult, 'passed');
  assert.equal(runtime.verificationResult, 'passed');
  assert(runtime.backendAttemptId, 'Android Detox camera backend attempt identity is missing');
  assert(runtime.fixtureHash, 'Android Detox camera fixture hash is missing');
  assert(runtime.flagsHash, 'Android Detox camera flags hash is missing');
  assert.equal(runtime.flagsHash, session.buildIdentity.environmentHash);
  assert(
    Object.keys(runtime.toolVersions).length > 0,
    'Android Detox camera tool versions are missing',
  );
  assert.deepEqual(runtime.toolVersions, session.buildIdentity.toolVersions);
  for (const [phase, elapsed] of Object.entries(runtime.timingsMs)) {
    // The camera session only installs an already-qualified APK pair (build
    // reuse with matching inputs), so this attempt's own build phase is 0.
    assert(
      Number.isFinite(elapsed) && (phase === 'build' ? elapsed >= 0 : elapsed > 0),
      `Android Detox camera runtime timing is missing for ${phase}`,
    );
  }
  assert.equal(session.target.apiOrigin !== null, true);
}

function allocateCaptureRunId(requestedRunId: string, supplied?: string): string {
  const captureRunId = supplied ?? randomBytes(12).toString('hex');
  assert(/^[a-f0-9]{24}$/u.test(captureRunId), 'Android Detox camera capture run ID is invalid');
  assert.notEqual(
    captureRunId,
    requestedRunId,
    'Android Detox camera capture run aliases outer attempt',
  );
  return captureRunId;
}

/**
 * Current Android Detox public dispatch. The supplied session runner is the
 * existing owned target/session/child owner; this function performs the real
 * producer, protected stage and terminal cleanup ordering. Source controls
 * stop at a zero-valued stage; the actual native pilot supplies the explicit
 * receipt-backed finalizer below. A missing finalizer is therefore truthful
 * source-only output for controls, while the native pilot cannot accidentally
 * remain private-only because it wires the production finalizer explicitly.
 */
export async function runAndroidDetoxCameraPublicAttempt(
  input: Readonly<{
    repositoryRoot: string;
    serverRoot?: string;
    artifactRoot?: string;
    build?: unknown;
    runnerPaths?: Readonly<{ jestConfigPath: string; testPath: string }>;
    parentEnv?: Readonly<Record<string, string | undefined>>;
    requestedRunId: string;
    captureRunId?: string;
    selection: NativePilotSelection;
    expectedLocale?: 'en-US' | 'pt-BR' | 'es-ES';
    signal: AbortSignal;
    deadlineAt: number;
    sessionRunner?: AndroidDetoxCameraSessionRunner | null;
    nativeFinalizer?: AndroidDetoxCameraNativeFinalizer;
    producerRunner?: (
      context: AndroidDetoxCameraProducerContext,
    ) => Promise<AndroidDetoxCameraProducerReceipts>;
    coldReset?: AndroidDetoxCameraResetExpectation;
    coldResetBinding?: unknown;
  }>,
): Promise<AndroidDetoxCameraPublicResult> {
  requireRunId(input.requestedRunId, 'requested Android Detox camera run ID');
  const captureRunId = allocateCaptureRunId(input.requestedRunId, input.captureRunId);
  requireDetoxCameraSelection(input.selection);
  assert(
    path.isAbsolute(input.repositoryRoot),
    'Android Detox camera repository root is not absolute',
  );
  assert.equal(await realpath(input.repositoryRoot), path.resolve(input.repositoryRoot));
  input.signal.throwIfAborted();
  assert(
    Number.isFinite(input.deadlineAt) && input.deadlineAt > performance.now(),
    'camera deadline expired',
  );
  if (input.sessionRunner === null)
    return blockedResult({
      requestedRunId: input.requestedRunId,
      status: 'harness-blocked',
      failure: new Error('Android Detox camera owned target/session runner is unavailable'),
    });
  let session: AndroidDetoxCameraOwnedSessionResult | undefined;
  try {
    const sessionRunner = input.sessionRunner ?? runAndroidDetoxCameraOwnedSession;
    session = await sessionRunner({
      repositoryRoot: input.repositoryRoot,
      serverRoot: input.serverRoot ?? path.resolve(input.repositoryRoot, '../server'),
      artifactRoot:
        input.artifactRoot ??
        path.join(input.repositoryRoot, '.qa/artifacts/native-pilot', input.requestedRunId),
      requestedRunId: input.requestedRunId,
      captureRunId,
      selection: input.selection,
      expectedLocale: input.expectedLocale ?? 'en-US',
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      build: input.build,
      runnerPaths: input.runnerPaths,
      parentEnv: input.parentEnv,
      coldReset: input.coldReset,
      executeCamera: async (context) => {
        input.signal.throwIfAborted();
        assert(performance.now() < input.deadlineAt, 'camera deadline expired before producer');
        const producer = await (input.producerRunner ?? buildAndroidDetoxCameraProducer)(context);
        return requireAndroidDetoxCameraProducerOutput(producer, {
          selectionHash: androidCameraSelectionHash(input.selection),
          requestedRunId: input.requestedRunId,
          runId: context.captureRunId,
          ownerRunId: context.ownerRunId,
          targetRunId: context.targetRunId,
          serial: context.serial,
          expectedLocale: context.expectedLocale,
        });
      },
    });
    requireSessionIdentity(session, input.requestedRunId, captureRunId);
    if (input.coldReset) {
      assert(
        session.coldReset?.status === 'verified',
        'Android Detox camera cold reset is not verified by the acquired owner',
      );
    }
    assert(session.producer, 'camera producer receipts are missing after owned cleanup');
    requireCompletedRuntimeEvidence(session);
    const childCommandIdentity = session.childCommandIdentity;
    assert(childCommandIdentity, 'camera child command identity is missing');
    const flow = await readAndroidDetoxCameraFlowReceipt({
      captureRoot: session.captureRoot,
      relativePath: session.flowReceiptPath,
      expected: { ...session, childCommandIdentity },
    });
    assert.equal(flow.pendingConnectionId, session.producer.pendingConnectionId);
    input.signal.throwIfAborted();
    assert(performance.now() < input.deadlineAt, 'camera deadline expired before staging');
    const stage = await stageAndroidDetoxCameraEvidence({
      captureRoot: session.captureRoot,
      outputRoot: session.outputRoot,
      requestedRunId: input.requestedRunId,
      captureRunId: session.captureRunId,
      fixtureRunId: session.fixtureRunId,
      targetOwnerRunId: session.targetOwnerRunId,
      selection: input.selection,
      producer: session.producer,
      childReceiptPath: session.childReceiptPath,
      flowReceiptPath: session.flowReceiptPath,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
    });
    let nativeFinalization: AndroidDetoxCameraNativeFinalization | null = null;
    if (input.nativeFinalizer) {
      if (input.coldReset && session.coldReset?.status !== 'verified')
        throw new Error('Android Detox camera native finalization requires a verified cold reset');
      nativeFinalization = await input.nativeFinalizer({
        repositoryRoot: input.repositoryRoot,
        requestedRunId: input.requestedRunId,
        requestedAttemptId: `${input.requestedRunId}:first`,
        selection: input.selection,
        build: input.build,
        session,
        producer: session.producer,
        stage,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
      });
      assert.equal(nativeFinalization.status, 'verified-native');
      assert.equal(nativeFinalization.nativePassingCases, 4);
      assert.equal(nativeFinalization.publicPassingCases, 4);
      assert.equal(nativeFinalization.publicPromotionEligible, true);
      assert.deepEqual(
        nativeFinalization.assertionBindings.map((binding) => binding.id),
        [...ANDROID_CAMERA_ASSERTION_IDS],
      );
    }
    return {
      kind: ANDROID_DETOX_CAMERA_PUBLIC_KIND,
      owner: ANDROID_DETOX_CAMERA_PUBLIC_OWNER,
      dispatch: ANDROID_DETOX_CAMERA_PUBLIC_DISPATCH,
      status: nativeFinalization ? 'verified-native' : 'source-only',
      requestedRunId: input.requestedRunId,
      requestedAttemptId: `${input.requestedRunId}:first`,
      captureRunId: session.captureRunId,
      fixtureRunId: session.fixtureRunId,
      targetDeviceId: session.targetDeviceId,
      targetOwnerRunId: session.targetOwnerRunId,
      producer: session.producer,
      stage,
      runtime: session.runtime,
      target: session.target,
      buildIdentity: session.buildIdentity,
      cleanup: session.cleanup,
      assertionBindings: nativeFinalization
        ? nativeFinalization.assertionBindings
        : stage.assertionBindings,
      failure: null,
      sourceTreeHash: session.sourceTreeHash,
      helperInputsHash: session.helperInputsHash,
      buildHash: session.buildHash,
      coldReset: session.coldReset ?? null,
      nativePassingCases: nativeFinalization ? 4 : 0,
      publicPassingCases: nativeFinalization ? 4 : 0,
      publicPromotionEligible: nativeFinalization !== null,
      nativeFinalization,
    };
  } catch (error) {
    return blockedResult({
      requestedRunId: input.requestedRunId,
      status: input.signal.aborted ? 'cancelled' : 'harness-blocked',
      failure: session?.failure ?? error,
      session,
    });
  }
}

export function androidDetoxCameraExecutionAdapter(
  args: NativePilotSelection['arguments'],
): boolean {
  try {
    assert.deepEqual(args, {
      platform: 'android',
      engine: 'detox',
      scenario: ANDROID_CAMERA_SCENARIO,
      mode: 'integration',
    });
    return true;
  } catch {
    return false;
  }
}
