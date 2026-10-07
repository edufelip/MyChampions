import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createAndroidColdResetBoundary } from './android-detox-camera-cold-reset-boundary';
import { readAndroidDetoxCameraPromptEvidence } from './native-detox-camera-android-bridge';
import {
  buildAndroidCameraPermissionCommands,
  parseAndroidCameraPermissionFlags,
  parseAndroidCameraPermissionStatus,
} from './native-camera-android-contract';
import {
  ANDROID_DETOX_CAMERA_APP_ID,
  type AndroidDetoxCameraLocale,
  type AndroidDetoxCameraAdbTarget,
  type AndroidDetoxCameraBridgeRead,
  type AndroidDetoxCameraInstrumentationBinding,
} from './native-detox-camera-android-contract';
import {
  requireAndroidDetoxCameraIdentityBoundary,
  requireAndroidDetoxCameraRunId,
} from './native-detox-camera-android-identity';
import {
  androidCameraSelectionHash,
  androidMetroPreference,
  assertAndroidReverseMappings,
  buildDetoxVerifiedBinaryEnvironment,
  createAndroidDetoxSessionOwnedChildDirectory,
  createOwnedAndroidDetoxConnectionProducer,
  ownedDetoxBaselineFactories,
  readOwnedAndroidBoundedFile,
  readOwnedDetoxConnectionFile,
  readNativeEvidenceObservation,
  requireAndroidCameraSqlEvidence,
  requireAndroidDetoxCleanupResult,
  requireConnectionSnapshot,
  requireDetoxBuildInstrumentation,
  inspectProcessIdentity,
  runDetoxConnectionDriverCleanup,
  startOwnedNativeCommand,
  writeAndroidCameraSqlSourceReceipts,
  writeAtomicDetoxConnectionBytes,
  type ConnectionSnapshotExpectedIdentity,
  type DetoxAndroidSessionStorageBinding,
  type DetoxAndroidSessionStorageTarget,
  type DetoxBaselineBuildInstrumentation,
  type DetoxBaselineFactories,
  type DriverReport,
  type OwnedFixtures,
  type AndroidDetoxConnectionProducer,
} from './native-detox-camera-android-q-adapter';
import {
  readAndroidDetoxCameraResetProof,
  requireAndroidDetoxCameraResetRuntimeMatchIndependent,
  type AndroidDetoxCameraResetBinding,
  type AndroidDetoxCameraResetProof,
} from './native-detox-camera-android-reset-independent';
import {
  produceAndroidColdReset,
  type AndroidColdResetContext,
} from './t15-cold-android-reset-producer';
import type {
  AndroidDetoxCameraFlowReceipt,
  AndroidDetoxCameraProducerContext,
  AndroidDetoxCameraProducerReceipts,
} from './native-detox-camera-android-producer';
import type {
  AndroidDetoxCameraOwnedSessionResult,
  AndroidDetoxCameraSessionRunner,
  AndroidDetoxCameraRuntimeEvidence,
} from './native-detox-camera-android-public-dispatch';

/**
 * This module is the Android Detox owner, not a fixture adapter.  It acquires
 * the same reservation, Android target, Postgres session, proxy and Metro
 * process used by the existing Detox connection driver.  The child is the
 * checked-in Detox test, while the callback only assembles receipts emitted
 * by that child and the already-owned API/session readers.
 */

const RUN_ID = /^[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const MAX_INTENT_BYTES = 16 * 1024;
// Android instrumentation rejects a deadline more than ten minutes away.
// Reserve a full minute for launch and teardown so the argument remains valid
// when the test process reaches the app bridge.
const MAX_ANDROID_CAMERA_BRIDGE_WINDOW_MS = 9 * 60 * 1000;
const SUBMIT_INTENT = 'detox-training-camera-submit-intent.private.json';
const SUBMIT_READY = 'detox-training-camera-submit-ready.private.json';
const TRANSPORT_RECEIPT = 'transport-observations.private.json';

type CameraBuild = DetoxBaselineBuildInstrumentation & {
  dispatchRuntimeInputsHash?: string;
};

type CameraRunnerPaths = Readonly<{
  jestConfigPath: string;
  testPath: string;
}>;

type OwnedSession = Awaited<ReturnType<DetoxBaselineFactories['startOwnedSession']>>;
type OwnedProxy = Awaited<ReturnType<DetoxBaselineFactories['startOwnedApiProxy']>>;
type OwnedReservation = Awaited<ReturnType<DetoxBaselineFactories['reserveOwnedAppPort']>>;
type OwnedChild = Awaited<ReturnType<typeof startOwnedNativeCommand>>;
type OwnedTarget = Awaited<ReturnType<AndroidDetoxConnectionProducer['acquireOwnedTarget']>>;
type OwnedAndroidCommandExecution = Awaited<ReturnType<DetoxAndroidSessionStorageTarget['runAdb']>>;
type ColdResetCommand = AndroidColdResetContext['commandExecutions'][number];

type SubmitIntent = Readonly<{
  schemaVersion: 1;
  kind: 'private-owned-detox-camera-submit-intent';
  captureRunId: string;
  ownerRunId: string;
  sessionRunId: string;
  actor: 'student';
  manualCodeSha256: string;
  actionSha256: string;
}>;

type OwnedChildIdentity = Readonly<{
  pid: number;
  pgid: number;
  started: string;
}>;

function hashText(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function warmAndroidMetroBundle(input: {
  origin: string;
  artifactRoot: string;
  captureRunId: string;
  ownerRunId: string;
  signal: AbortSignal;
  deadlineAt: number;
}): Promise<void> {
  // Expo Router's native dev client resolves this virtual Metro entry rather
  // than the bare /index.bundle endpoint.
  const url = new URL('/.expo/.virtual-metro-entry.bundle', input.origin);
  url.searchParams.set('platform', 'android');
  url.searchParams.set('dev', 'true');
  url.searchParams.set('minify', 'false');
  url.searchParams.set('hot', 'false');
  url.searchParams.set('lazy', 'true');
  url.searchParams.set('transform.engine', 'hermes');
  url.searchParams.set('transform.routerRoot', 'app');
  const timeoutMs = Math.min(180_000, remaining(input.deadlineAt));
  const response = await fetch(url, {
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)]),
  });
  assert.equal(response.ok, true, 'Android Metro bundle warmup failed');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(
    bytes.length > 0 && bytes.length <= 64 * 1024 * 1024,
    'Android Metro bundle warmup size is invalid',
  );
  await writeAtomicDetoxConnectionBytes(
    input.artifactRoot,
    'android-metro-bundle-warmup.private.json',
    Buffer.from(`${JSON.stringify({
      kind: 'private-owned-android-metro-bundle-warmup',
      captureRunId: input.captureRunId,
      ownerRunId: input.ownerRunId,
      bytes: bytes.length,
      sha256: hashText(bytes),
    })}
`),
    16 * 1024,
    { signal: input.signal, deadlineAt: input.deadlineAt },
  );
}

function errorRecord(error: unknown): { name: string; message: string } {
  return {
    name: error instanceof Error ? error.name.slice(0, 128) : 'UnknownError',
    message: (error instanceof Error ? error.message : String(error)).slice(0, 512),
  };
}

function elapsedMs(startedAt: number): number {
  return Math.max(0.001, performance.now() - startedAt);
}

function ownedCommandReason(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const reason = (error as Record<string, unknown>).reason;
  return typeof reason === 'string' ? reason : null;
}

function classifyOwnedCommand(
  child: OwnedChild | undefined,
  waitFailure: unknown,
): AndroidDetoxCameraRuntimeEvidence['childClassification'] {
  if (!child) return null;
  const reason = ownedCommandReason(waitFailure);
  if (reason === 'deadline') return 'deadline';
  if (reason === 'cancelled') return 'cancelled';
  if (reason === 'output-limit') return 'output-limit';
  if (reason === 'output-failed') return 'output-failed';
  const outcome = child.outcome();
  if (outcome.signal || (outcome.code !== null && outcome.code !== 0)) return 'child-failed';
  if (child.censusFailure()) return 'harness-blocked';
  return outcome.code === 0 ? 'completed' : 'harness-blocked';
}

function unrefTimer(timer: unknown): void {
  if (
    typeof timer === 'object' &&
    timer !== null &&
    'unref' in timer &&
    typeof (timer as { unref?: unknown }).unref === 'function'
  ) {
    (timer as { unref: () => void }).unref();
  }
}

function remaining(deadlineAt: number): number {
  const value = Math.ceil(deadlineAt - performance.now());
  if (!Number.isSafeInteger(value) || value < 100)
    throw new Error('Android Detox camera deadline elapsed');
  return Math.min(value, 600_000);
}

function assertRunId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
}

function assertHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && HASH.test(value), `${label} is invalid`);
}

async function privateDirectory(root: string, label: string): Promise<string> {
  const resolved = path.resolve(root);
  assert.equal(await realpath(resolved), resolved, `${label} is not canonical`);
  const metadata = await lstat(resolved);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink(), `${label} is not a directory`);
  assert.equal(metadata.mode & 0o777, 0o700, `${label} is not private`);
  if (typeof process.getuid === 'function') assert.equal(metadata.uid, process.getuid());
  return resolved;
}

async function readPrivateJson<T>(
  root: string,
  relative: string,
  maxBytes: number,
  lifecycle: { signal?: AbortSignal; deadlineAt?: number } = {},
): Promise<T> {
  assert(!relative.includes('/'), 'camera child artifact must be direct');
  const bytes = await readOwnedDetoxConnectionFile(root, relative, maxBytes, lifecycle);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(
      `Camera child artifact is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'camera child JSON is malformed',
  );
  return value as T;
}

async function readLatestAndroidCameraStage(
  root: string,
  expected: { captureRunId: string; ownerRunId: string },
  lifecycle: { signal?: AbortSignal; deadlineAt?: number },
): Promise<string | null> {
  const names = await readdir(await privateDirectory(root, 'camera child artifact root'));
  const candidates = names
    .map((name) => {
      const match = /^detox-training-camera-stage-([1-9][0-9]*)\.private\.json$/u.exec(name);
      return match ? { name, sequence: Number(match[1]) } : null;
    })
    .filter((value): value is { name: string; sequence: number } => value !== null)
    .sort((left, right) => right.sequence - left.sequence);
  if (candidates.length === 0 || candidates.length > 16) return null;
  const stage = await readPrivateJson<Record<string, unknown>>(
    root,
    candidates[0].name,
    4 * 1024,
    lifecycle,
  );
  if (
    stage.kind !== 'private-owned-android-detox-camera-stage' ||
    stage.captureRunId !== expected.captureRunId ||
    stage.ownerRunId !== expected.ownerRunId ||
    stage.attemptId !== `${expected.ownerRunId}:first` ||
    stage.sequence !== candidates[0].sequence ||
    typeof stage.stage !== 'string' ||
    !/^[a-z-]{1,64}$/u.test(stage.stage)
  )
    return null;
  return stage.stage;
}

function requireSubmitIntent(
  value: unknown,
  expected: { captureRunId: string; ownerRunId: string; sessionRunId: string },
): SubmitIntent {
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'camera submit intent is malformed',
  );
  const row = value as Record<string, unknown>;
  assert.equal(row.schemaVersion, 1);
  assert.equal(row.kind, 'private-owned-detox-camera-submit-intent');
  assert.equal(row.captureRunId, expected.captureRunId);
  assert.equal(row.ownerRunId, expected.ownerRunId);
  assert.equal(row.sessionRunId, expected.sessionRunId);
  assert.equal(row.actor, 'student');
  assertHash(row.manualCodeSha256, 'camera submit manual-code hash');
  assertHash(row.actionSha256, 'camera submit action hash');
  return row as unknown as SubmitIntent;
}

function requireInviteCodeReceipt(
  value: unknown,
  expected: { captureRunId: string; ownerRunId: string; sessionRunId: string },
): { value: string; sha256: string } {
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'camera invite code receipt is malformed',
  );
  const row = value as Record<string, unknown>;
  assert.equal(row.schemaVersion, 1);
  assert.equal(row.kind, 'private-owned-android-detox-camera-invite-code');
  assert.equal(row.captureRunId, expected.captureRunId);
  assert.equal(row.ownerRunId, expected.ownerRunId);
  assert.equal(row.sessionRunId, expected.sessionRunId);
  assert.equal(row.actor, 'coach');
  assert(
    typeof row.value === 'string' && /^[A-F0-9]{8}$/u.test(row.value),
    'camera invite code value is invalid',
  );
  assertHash(row.sha256, 'camera invite code hash');
  assert.equal(
    row.sha256,
    hashText(row.value),
    'camera invite code hash does not match its private value',
  );
  return { value: row.value, sha256: row.sha256 };
}

async function waitForSubmitIntent(input: {
  root: string;
  expected: { captureRunId: string; ownerRunId: string; sessionRunId: string };
  child: OwnedChild;
  signal: AbortSignal;
  deadlineAt: number;
  proxy: OwnedProxy;
  fixtures: OwnedFixtures;
  session: OwnedSession;
}): Promise<SubmitIntent> {
  while (true) {
    input.signal.throwIfAborted();
    if (performance.now() >= input.deadlineAt)
      throw new Error('Camera submit intent deadline elapsed');
    try {
      const intent = requireSubmitIntent(
        await readPrivateJson<unknown>(input.root, SUBMIT_INTENT, MAX_INTENT_BYTES, {
          signal: input.signal,
          deadlineAt: input.deadlineAt,
        }),
        input.expected,
      );
      // The app may still have a background request in flight; arming requires
      // an idle proxy. The child waits for SUBMIT_READY, so this drains safely.
      await input.proxy.waitForQuiescence(
        Math.max(1, Math.min(5_000, Math.floor(input.deadlineAt - performance.now()))),
        input.signal,
      );
      input.proxy.enableNativeRequestBodyCapture({
        artifactRoot: input.root,
        captureRunId: input.expected.captureRunId,
        sessionRunId: input.expected.sessionRunId,
        backendAttemptId: `${input.expected.sessionRunId}:first`,
        actorAuthUidSha256: hashText(input.fixtures.accounts.student.authUid),
        targetOrigin: input.session.apiOrigin,
        apiPid: input.session.apiPid,
        manualCodeSha256: intent.manualCodeSha256,
        actionSha256: intent.actionSha256,
      });
      // The child must not submit until the owner has armed its body capture.
      // The intent is the immutable request binding; this acknowledgement closes
      // the otherwise unavoidable intent-to-submit race without exposing data.
      await writeAtomicDetoxConnectionBytes(
        input.root,
        SUBMIT_READY,
        Buffer.from(
          `${JSON.stringify({
            schemaVersion: 1,
            kind: 'private-owned-android-detox-camera-submit-ready',
            captureRunId: input.expected.captureRunId,
            ownerRunId: input.expected.ownerRunId,
            sessionRunId: input.expected.sessionRunId,
          })}\n`,
        ),
        4096,
        { signal: input.signal, deadlineAt: input.deadlineAt },
      );
      return intent;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const message = error instanceof Error ? error.message : String(error);
        if (!/ENOENT|no such file|cannot find/i.test(message)) throw error;
      }
    }
    const outcome = input.child.outcome();
    if (outcome.code !== null || outcome.signal !== null)
      throw new Error('Detox camera child exited before its owned submit intent');
    const members = await input.child.capture(false);
    if (!members.some((member) => member.pgid === input.child.pgid))
      throw new Error(
        'Detox camera child process group disappeared before its owned submit intent',
      );
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

async function readOwnedChildIdentity(
  root: string,
  child: OwnedChild,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<OwnedChildIdentity> {
  for (;;) {
    signal.throwIfAborted();
    try {
      const value = await readPrivateJson<Record<string, unknown>>(
        root,
        'detox-camera-child.ownership.json',
        4 * 1024 * 1024,
        { signal, deadlineAt },
      );
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (performance.now() >= deadlineAt)
      throw new Error('Owned Detox camera child identity was not published');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function buildStorageBinding(
  session: OwnedSession,
  fixtures: OwnedFixtures,
  probe: Awaited<ReturnType<OwnedSession['probeApiLifetime']>>,
  proxy: OwnedProxy,
): DetoxAndroidSessionStorageBinding {
  const allowlistHash = hashJson(
    Object.values(fixtures.accounts)
      .map((account) => account.authUid)
      .sort(),
  );
  return {
    runId: fixtures.runId,
    scope: 'native-entry-android',
    apiOrigin: probe.apiOrigin,
    apiPid: probe.apiPid,
    backendAttemptId: probe.backendAttemptId,
    manifestSha256: probe.manifestSha256,
    fixtureAuthUidAllowlistHash: allowlistHash,
    waitForQuiescence: async () => {
      await proxy.waitForQuiescence();
    },
  };
}

function bridgeTarget(
  storage: DetoxAndroidSessionStorageTarget,
  binding: DetoxAndroidSessionStorageBinding,
): AndroidDetoxCameraAdbTarget {
  return {
    appId: ANDROID_DETOX_CAMERA_APP_ID,
    serial: storage.serial,
    adbServerPort: storage.adbServerPort,
    verify: storage.verify,
    runAdb: async (input) => {
      const execution = await storage.runAdb({
        ...input,
        target: {
          serial: storage.serial,
          adbServerPort: storage.adbServerPort,
        },
        binding,
      });
      assert.equal(execution.phase, 'step');
      assert.equal(execution.execution, 'completed');
      assert.equal(execution.cleanup, 'cleaned');
      assert.equal(execution.childExitCode, 0);
      assert.equal(execution.childSignal, null);
      const pid = execution.pid;
      const pgid = execution.pgid;
      if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0)
        throw new Error('Android command PID is missing');
      if (typeof pgid !== 'number' || !Number.isSafeInteger(pgid) || pgid <= 0)
        throw new Error('Android command PGID is missing');
      return {
        execution: {
          phase: 'step',
          execution: 'completed',
          cleanup: 'cleaned',
          childExitCode: 0,
          childSignal: null,
          pid: pid,
          pgid: pgid,
        },
        stdoutPath: execution.stdoutPath ?? input.stdoutPath,
        command: 'adb',
        argv: [...input.argv],
      };
    },
  };
}

type AndroidCameraBridgePreference = Readonly<{
  relativePath: 'shared_prefs/detox.camera.bridge.v1.xml';
  xml: string;
}>;

function androidCameraBridgePreference(input: {
  captureRunId: string;
  ownerRunId: string;
  serial: string;
  locale: AndroidDetoxCameraLocale;
  deadlineAtEpochMs: number;
}): AndroidCameraBridgePreference {
  requireAndroidDetoxCameraRunId(input.captureRunId, 'Android camera bridge capture run ID');
  requireAndroidDetoxCameraRunId(input.ownerRunId, 'Android camera bridge owner run ID');
  assert.match(input.serial, /^(?:emulator-[0-9]+|[A-Za-z0-9._:-]{1,127})$/u);
  assert(Number.isSafeInteger(input.deadlineAtEpochMs));
  assert(input.deadlineAtEpochMs > Date.now());
  const values = [
    ['detoxCameraBridge', 'enabled'],
    ['detoxCameraCaptureRunId', input.captureRunId],
    ['detoxCameraOwnerRunId', input.ownerRunId],
    ['detoxCameraAttemptId', `${input.ownerRunId}:first`],
    ['detoxCameraSerial', input.serial],
    ['detoxCameraAppId', ANDROID_DETOX_CAMERA_APP_ID],
    ['detoxCameraLocale', input.locale],
    ['detoxCameraDeadlineAtEpochMs', String(input.deadlineAtEpochMs)],
    ['detoxCameraCancelRelativePath', 'cancel.signal'],
  ] as const;
  for (const [key, value] of values) {
    assert.match(key, /^[A-Za-z][A-Za-z0-9]*$/u);
    assert.match(value, /^[A-Za-z0-9._:-]+$/u);
  }
  return {
    relativePath: 'shared_prefs/detox.camera.bridge.v1.xml',
    xml: `<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>\n${values
      .map(([key, value]) => `    <string name="${key}">${value}</string>`)
      .join('\n')}\n</map>\n`,
  };
}

async function persistAndroidCameraBridgePreference(input: {
  storage: DetoxAndroidSessionStorageTarget;
  target: OwnedTarget;
  binding: DetoxAndroidSessionStorageBinding;
  artifactRoot: string;
  ownerRunId: string;
  captureRunId: string;
  locale: AndroidDetoxCameraLocale;
  deadlineAtEpochMs: number;
  signal: AbortSignal;
  deadlineAt: number;
  commandExecutions: ColdResetCommand[];
}): Promise<void> {
  const preference = androidCameraBridgePreference({
    captureRunId: input.captureRunId,
    ownerRunId: input.ownerRunId,
    serial: input.storage.serial,
    locale: input.locale,
    deadlineAtEpochMs: input.deadlineAtEpochMs,
  });
  await runAndroidColdPreparationCommand({
    ...input,
    label: 'android-camera-bridge-prefs-directory',
    argv: ['shell', 'run-as', ANDROID_DETOX_CAMERA_APP_ID, 'mkdir', '-p', 'shared_prefs'],
  });
  const encoded = Buffer.from(preference.xml).toString('base64');
  await runAndroidColdPreparationCommand({
    ...input,
    label: 'android-camera-bridge-prefs',
    argv: [
      'shell',
      'run-as',
      ANDROID_DETOX_CAMERA_APP_ID,
      'sh',
      '-c',
      `'printf %s ${encoded} | base64 -d > ${preference.relativePath}'`,
    ],
  });
  assert.equal(
    await input.target.adbRead(
      ['shell', 'run-as', ANDROID_DETOX_CAMERA_APP_ID, 'cat', preference.relativePath],
      10_000,
      input.deadlineAt,
    ),
    preference.xml.trim(),
    'Android camera bridge configuration was not persisted exactly',
  );
}

async function readAndroidPropertyReceipt(input: {
  root: string;
  storage: DetoxAndroidSessionStorageTarget;
  binding: DetoxAndroidSessionStorageBinding;
  signal: AbortSignal;
  deadlineAt: number;
  relative: string;
  label: string;
  property: string;
}): Promise<{ path: string; sha256: string; value: string }> {
  // The protected connection reader only accepts its private JSON/XML/PNG
  // publication names.  The bytes remain the actual bounded adb stdout; the
  // private suffix is a storage contract, not a parsed or rewritten property.
  const execution = await input.storage.runAdb({
    label: input.label,
    argv: ['shell', 'getprop', input.property],
    artifactRoot: input.root,
    stdoutPath: path.join(input.root, input.relative),
    deadlineMs: remaining(input.deadlineAt),
    signal: input.signal,
    target: {
      serial: input.storage.serial,
      adbServerPort: input.storage.adbServerPort,
    },
    binding: input.binding,
  });
  assert.equal(execution.execution, 'completed');
  assert.equal(execution.cleanup, 'cleaned');
  assert.equal(execution.childExitCode, 0);
  const loaded = await readOwnedAndroidBoundedFile({
    artifactRoot: input.root,
    filePath: path.join(input.root, input.relative),
    label: input.label,
    maxBytes: 16 * 1024,
    signal: input.signal,
  });
  return {
    path: input.relative,
    sha256: hashText(loaded.bytes),
    value: loaded.bytes.toString('utf8').trim(),
  };
}

async function readLocaleReceipt(input: {
  root: string;
  storage: DetoxAndroidSessionStorageTarget;
  binding: DetoxAndroidSessionStorageBinding;
  signal: AbortSignal;
  deadlineAt: number;
  expectedLocale: AndroidDetoxCameraLocale;
}): Promise<{ path: string; sha256: string }> {
  let receipt = await readAndroidPropertyReceipt({
    ...input,
    relative: 'android-locale.private.json',
    label: 'android-camera-locale',
    property: 'persist.sys.locale',
  });
  if (!receipt.value)
    receipt = await readAndroidPropertyReceipt({
      ...input,
      relative: 'android-product-locale.private.json',
      label: 'android-camera-product-locale',
      property: 'ro.product.locale',
    });
  const observed = receipt.value.replace('_', '-');
  assert.equal(
    observed,
    input.expectedLocale,
    'Android OS locale does not match the selected locale',
  );
  return { path: receipt.path, sha256: receipt.sha256 };
}

async function readOsVersionReceipt(input: {
  root: string;
  storage: DetoxAndroidSessionStorageTarget;
  binding: DetoxAndroidSessionStorageBinding;
  signal: AbortSignal;
  deadlineAt: number;
}): Promise<string> {
  const receipt = await readAndroidPropertyReceipt({
    ...input,
    relative: 'android-os-version.private.json',
    label: 'android-camera-os-version',
    property: 'ro.build.version.release',
  });
  assert(
    /^\d+(?:\.\d+){0,2}(?:[-.][A-Za-z0-9._-]+)?$/u.test(receipt.value),
    'Android OS version output is not a bounded version identity',
  );
  return receipt.value;
}

async function runAndroidColdPreparationCommand(input: {
  storage: DetoxAndroidSessionStorageTarget;
  binding: DetoxAndroidSessionStorageBinding;
  artifactRoot: string;
  ownerRunId: string;
  label: string;
  argv: string[];
  signal: AbortSignal;
  deadlineAt: number;
  commandExecutions: ColdResetCommand[];
}): Promise<OwnedAndroidCommandExecution> {
  const execution = await input.storage.runAdb({
    label: input.label,
    argv: input.argv,
    artifactRoot: input.artifactRoot,
    deadlineMs: remaining(input.deadlineAt),
    signal: input.signal,
    stdoutPath: path.join(input.artifactRoot, `${input.label}.stdout`),
    target: {
      serial: input.storage.serial,
      adbServerPort: input.storage.adbServerPort,
    },
    binding: input.binding,
  });
  assert.equal(execution.execution, 'completed');
  assert.equal(execution.cleanup, 'cleaned');
  assert.equal(execution.childExitCode, 0);
  assert.equal(execution.childSignal, null);
  const pid = execution.pid;
  const pgid = execution.pgid;
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 1)
    throw new Error(`Android preparation command ${input.label} has no owned PID`);
  if (typeof pgid !== 'number' || !Number.isSafeInteger(pgid) || pgid <= 1)
    throw new Error(`Android preparation command ${input.label} has no owned PGID`);
  input.commandExecutions.push({
    label: input.label,
    execution: execution.execution,
    cleanup: execution.cleanup,
    pid,
    pgid,
    commandHash: execution.commandHash,
    ownerRunId: input.ownerRunId,
    ownershipPath: execution.ownershipPath,
  });
  return execution;
}

async function readInstalledAndroidApk(input: {
  artifactRoot: string;
  expectedHash: string;
}): Promise<{ path: string; sha256: string; sizeBytes: number }> {
  const apkPath = path.join(input.artifactRoot, 'installed-base.apk');
  const metadata = await lstat(apkPath);
  assert(metadata.isFile() && !metadata.isSymbolicLink());
  assert.equal(metadata.nlink, 1);
  assert.equal(metadata.mode & 0o077, 0);
  if (typeof process.getuid === 'function') assert.equal(metadata.uid, process.getuid());
  assert.equal(await realpath(apkPath), apkPath);
  const bytes = await readFile(apkPath);
  const sha256 = hashText(bytes);
  assert.equal(sha256, input.expectedHash, 'Installed APK bytes differ from the qualified build');
  assert(bytes.length > 0);
  assert.equal(metadata.size, bytes.length);
  return { path: apkPath, sha256, sizeBytes: bytes.length };
}

async function createAndroidColdResetSourceRoot(
  artifactRoot: string,
  captureRunId: string,
): Promise<string> {
  const parent = path.join(path.dirname(artifactRoot), '.t15-android-reset-sources');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  assert.equal(await realpath(parent), parent);
  const parentInfo = await lstat(parent);
  assert(parentInfo.isDirectory() && !parentInfo.isSymbolicLink());
  assert.equal(parentInfo.mode & 0o777, 0o700);
  if (typeof process.getuid === 'function') assert.equal(parentInfo.uid, process.getuid());
  const sourceRoot = path.join(parent, captureRunId);
  await mkdir(sourceRoot, { mode: 0o700 });
  return privateDirectory(sourceRoot, 'Android Detox camera cold-reset source root');
}

function buildHash(build: CameraBuild): string {
  return hashJson({
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
  });
}

async function writeChildReceipt(
  root: string,
  child: OwnedChild,
  captureRunId: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<string> {
  const relative = 'detox-camera-child.private.json';
  await writeAtomicDetoxConnectionBytes(
    root,
    relative,
    Buffer.from(
      `${JSON.stringify({
        kind: 'private-owned-detox-camera-child-receipt',
        captureRunId,
        pid: child.pid,
        pgid: child.pgid,
        outcome: child.outcome(),
        logPath: path.basename(child.logPath),
        stdoutPath: child.stdoutPath ? path.basename(child.stdoutPath) : null,
        censusFailure: child.censusFailure(),
        outputFailure: child.outputFailure(),
      })}\n`,
    ),
    MAX_INTENT_BYTES,
    { signal, deadlineAt },
  );
  return relative;
}

function expectedSnapshotIdentity(
  fixtures: OwnedFixtures,
  runId: string,
  scope: string,
): ConnectionSnapshotExpectedIdentity {
  return {
    runId,
    scope,
    fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
    target: {
      professionalAuthUid: fixtures.accounts.coach.authUid,
      studentAuthUid: fixtures.accounts.student.authUid,
      specialty: 'fitness_coach',
    },
  };
}

function reportForCleanup(captureRunId: string): DriverReport {
  return {
    kind: 'private-detox-android-camera-owner-report',
    captureRunId,
    nativePassingCases: 0,
    publicPromotionEligible: false,
    commandExecutions: [],
  } as DriverReport;
}

export const runAndroidDetoxCameraOwnedSession: AndroidDetoxCameraSessionRunner = async (input) => {
  assertRunId(input.requestedRunId, 'Android Detox camera requested run ID');
  assertRunId(input.captureRunId, 'Android Detox camera capture run ID');
  assert.notEqual(
    input.captureRunId,
    input.requestedRunId,
    'Android Detox camera capture namespace aliases outer attempt',
  );
  const root = await realpath(input.repositoryRoot);
  assert.equal(
    root,
    path.resolve(input.repositoryRoot),
    'Android Detox repository root is not canonical',
  );
  const build = input.build as CameraBuild | undefined;
  if (!build)
    throw new Error('Android Detox camera build provenance is required before acquisition');
  requireDetoxBuildInstrumentation(build, root);
  const runnerPaths = input.runnerPaths as CameraRunnerPaths | undefined;
  if (!runnerPaths?.jestConfigPath || !runnerPaths.testPath)
    throw new Error('Android Detox camera runner paths are required before acquisition');
  const outputRoot = await privateDirectory(input.artifactRoot, 'Android Detox camera output root');
  // Allocate the capture namespace as an anchored private child of the
  // caller-owned output root. The child name is the independently produced
  // captureRunId used by Detox, reset receipts and the staged handoff.
  const outputIdentity = await lstat(outputRoot);
  const captureIdentity = await createAndroidDetoxSessionOwnedChildDirectory({
    parent: outputRoot,
    name: input.captureRunId,
    expectedParentIdentity: {
      path: outputRoot,
      dev: outputIdentity.dev,
      ino: outputIdentity.ino,
      uid: outputIdentity.uid,
      gid: outputIdentity.gid,
      mode: outputIdentity.mode & 0o777,
      nlink: outputIdentity.nlink,
    },
    lifecycle: {
      signal: input.signal,
      deadlineAtMonotonicMs: input.deadlineAt,
    },
  });
  const artifactRoot = captureIdentity.path;
  const producer = createOwnedAndroidDetoxConnectionProducer();
  // The generic baseline factory has no Android target identity or independent
  // emulator census. Reuse the same producer used by the existing Android
  // Detox connection owner so reset, camera capture, and cleanup share one
  // target reservation and one process/port ownership ledger.
  const factories = {
    ...ownedDetoxBaselineFactories,
    acquireOwnedTarget: producer.acquireOwnedTarget,
  };
  let reservation: OwnedReservation | undefined;
  let target: OwnedTarget | undefined;
  let session: OwnedSession | undefined;
  let proxy: OwnedProxy | undefined;
  let expo: Awaited<ReturnType<DetoxBaselineFactories['startOwnedExpo']>> | undefined;
  let child: OwnedChild | undefined;
  let childIdentity: OwnedChildIdentity | undefined;
  let childCommand: { command: string; argv: string[] } | undefined;
  let childDeadlineAtEpochMs = 0;
  let childReceiptPath = 'detox-camera-child.private.json';
  let producerResult: AndroidDetoxCameraProducerReceipts | undefined;
  // Preserve a bounded failed receipt so terminal qualification errors retain
  // their actual Android child diagnosis instead of an assertion-only shell.
  let failedBridge: AndroidDetoxCameraBridgeRead | undefined;
  let producerAttempted = false;
  let childWaitFailure: unknown = null;
  let backendAttemptId: string | null = null;
  let fixtureHash: string | null = null;
  let coldResetProof: AndroidDetoxCameraResetProof | null = null;
  let targetOsVersion: string | null = null;
  let coldResetStartedIso: string | null = null;
  const coldResetCommandExecutions: ColdResetCommand[] = [];
  const timingsMs = {
    // The current-Q build receipt does not publish elapsed timing. Keep this
    // source-only projection explicitly unqualified until a runtime owner
    // records the measurement.
    build: 0,
    install: 0,
    reset: 0,
    scenario: 0,
    verify: 0,
    cleanup: 0,
  };
  let installStartedAt: number | null = null;
  let resetStartedAt: number | null = null;
  let scenarioStartedAt: number | null = null;
  let verifyStartedAt: number | null = null;
  let cleanupStartedAt: number | null = null;
  let expoCleanupFailure: { name: string; message: string } | undefined;
  let producerFailure: { name: string; message: string } | null = null;
  let cleanup: AndroidDetoxCameraOwnedSessionResult['cleanup'] = {
    status: 'not-acquired',
    independentCensus: 'not-executed',
    retainedPaths: [],
  };
  const resourceOwnerRunId = randomBytes(12).toString('hex');
  requireAndroidDetoxCameraRunId(resourceOwnerRunId, 'Android Detox camera resource owner run ID');
  assert.notEqual(resourceOwnerRunId, input.requestedRunId);
  assert.notEqual(resourceOwnerRunId, input.captureRunId);
  const report = reportForCleanup(input.captureRunId);
  (report as DriverReport & { ownerRunId?: string }).ownerRunId = resourceOwnerRunId;
  try {
    input.signal.throwIfAborted();
    if (
      input.parentEnv?.MYCHAMPIONS_NATIVE_HOST_LOCK_HELD !== '1' &&
      process.env.MYCHAMPIONS_NATIVE_HOST_LOCK_HELD !== '1'
    )
      throw new Error('Android Detox camera requires the existing native host lock');
    installStartedAt = performance.now();
    await factories.requireNativeHostAvailability(artifactRoot);
    reservation = await factories.reserveOwnedAppPort(build.metroPort);
    const metroPort = reservation.port;
    target = await factories.acquireOwnedTarget({
      platform: 'android',
      artifactRoot,
      signal: input.signal,
      deadlineAtMonotonicMs: input.deadlineAt,
    });
    assert(target, 'Android Detox acquired target is missing');
    await target.verify();
    assert.equal(target.platform, 'android');
    requireAndroidDetoxCameraRunId(target.runId, 'Android Detox acquired target run ID');
    assert(target.androidSessionStorage, 'Android Detox camera target lacks owned session storage');
    timingsMs.install = elapsedMs(installStartedAt);
    resetStartedAt = performance.now();
    session = await factories.startOwnedSession({
      serverRoot: input.serverRoot,
      appOrigin: reservation.origin,
      signal: input.signal,
      deadlineMs: remaining(input.deadlineAt),
    });
    proxy = await factories.startOwnedApiProxy({
      session,
      appOrigin: reservation.origin,
      requestProfile: 'native',
      requestedPort: Number(new URL(build.embeddedRuntime.apiOrigin).port),
    });
    assert.equal(proxy.origin, build.embeddedRuntime.apiOrigin);
    expo = await factories.startOwnedExpo({
      clientRoot: root,
      artifactRoot: path.join(artifactRoot, 'expo'),
      reservation,
      apiOrigin: proxy.origin,
      parentEnv: input.parentEnv,
      deadlineMs: remaining(input.deadlineAt),
      signal: input.signal,
      surface: 'native',
    });
    await warmAndroidMetroBundle({
      origin: expo.origin,
      artifactRoot,
      captureRunId: input.captureRunId,
      ownerRunId: resourceOwnerRunId,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
    });
    reservation = undefined;
    const fixtures = await session.fixtures('native-entry-android', input.signal);
    const coldResetExpectation = input.coldReset;
    fixtureHash = hashJson(fixtures);
    const isolationFixtures = await session.fixtures('native-conn-isolation-android', input.signal);
    proxy.enableNativeAuthIdentityCapture(
      Object.values(fixtures.accounts).map((account) => account.authUid),
    );
    const probe = await session.probeApiLifetime(input.signal);
    backendAttemptId = probe.backendAttemptId;
    const storage = target.androidSessionStorage;
    assert(storage, 'Android Detox camera target lacks owned session storage');
    const binding = buildStorageBinding(session, fixtures, probe, proxy);
    targetOsVersion = await readOsVersionReceipt({
      root: artifactRoot,
      storage,
      binding,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
    });
    assert.equal(targetOsVersion, target.osVersion);
    // android.attached deliberately does not own app provisioning in the
    // Detox driver. Provision both qualified APKs through this run's owned
    // ADB server, then prove their exact package identities before Detox can
    // launch the app.
    const appId = build.embeddedRuntime.appIdentifier || build.appIdentifier;
    assert.equal(appId, ANDROID_DETOX_CAMERA_APP_ID);
    assert(path.isAbsolute(build.binaryPath), 'Android qualified APK path is not absolute');
    assert(
      path.isAbsolute(build.testBinaryPath || ''),
      'Android qualified test APK path is not absolute',
    );
    await runAndroidColdPreparationCommand({
      storage,
      binding,
      artifactRoot,
      ownerRunId: resourceOwnerRunId,
      label: 'android-detox-app-install',
      argv: ['install', '-r', '-d', build.binaryPath],
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      commandExecutions: coldResetCommandExecutions,
    });
    await runAndroidColdPreparationCommand({
      storage,
      binding,
      artifactRoot,
      ownerRunId: resourceOwnerRunId,
      label: 'android-detox-test-install',
      argv: ['install', '-r', '-d', build.testBinaryPath!],
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      commandExecutions: coldResetCommandExecutions,
    });
    assert.match(
      await target.adbRead(['shell', 'pm', 'path', appId], 10_000, input.deadlineAt),
      /^package:\/data\/app\//u,
    );
    assert.match(
      await target.adbRead(['shell', 'pm', 'path', `${appId}.test`], 10_000, input.deadlineAt),
      /^package:\/data\/app\//u,
    );
    // The camera fixture owns provisioning. Detox's normal reinstall uses
    // `adb install -g`, which would grant CAMERA after this reset and bypass
    // the real permission-controller prompt that this scenario verifies.
    const cameraPermission = buildAndroidCameraPermissionCommands(appId);
    const cameraPermissionResetCommands: Array<[string, string[]]> = [
      ['android-camera-clear-permission-flags', [...cameraPermission.clearUserDecision]],
      ['android-camera-revoke-permission', [...cameraPermission.revoke]],
    ];
    for (const [label, argv] of cameraPermissionResetCommands)
      await runAndroidColdPreparationCommand({
        storage,
        binding,
        artifactRoot,
        ownerRunId: resourceOwnerRunId,
        label,
        argv,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        commandExecutions: coldResetCommandExecutions,
      });
    const permissionCheckPath = path.join(
      artifactRoot,
      'android-camera-permission-before.private.txt',
    );
    const permissionCheck = await storage.runAdb({
      label: 'android-camera-permission-before',
      argv: cameraPermission.check,
      artifactRoot,
      stdoutPath: permissionCheckPath,
      deadlineMs: remaining(input.deadlineAt),
      signal: input.signal,
      target: { serial: storage.serial, adbServerPort: storage.adbServerPort },
      binding,
    });
    assert.equal(permissionCheck.execution, 'completed');
    assert.equal(permissionCheck.cleanup, 'cleaned');
    assert.equal(permissionCheck.childExitCode, 0);
    const permissionBefore = await readOwnedAndroidBoundedFile({
      artifactRoot,
      filePath: permissionCheckPath,
      label: 'Android camera permission before child',
      maxBytes: 1024 * 1024,
      signal: input.signal,
    });
    assert.equal(
      parseAndroidCameraPermissionStatus(permissionBefore.bytes.toString('utf8'), appId),
      'denied',
    );
    const permissionFlags = parseAndroidCameraPermissionFlags(
      permissionBefore.bytes.toString('utf8'),
      appId,
    );
    assert(!permissionFlags.includes('USER_SET') && !permissionFlags.includes('USER_FIXED'));
    // A normal integration replay does not carry a cold-reset binding, but it
    // still launches a development APK. Configure the owned emulator's
    // loopback routes and React Native host preference before Detox can start
    // the app. The cold-reset path performs and proves the same setup below.
    if (!coldResetExpectation) {
      assert(proxy, 'Android Detox proxy is unavailable for runtime configuration');
      const apiPort = Number(new URL(proxy.origin).port);
      assert(Number.isSafeInteger(apiPort) && apiPort > 0);
      for (const [label, port] of [
        ['metro', metroPort],
        ['api', apiPort],
      ] as const)
        await runAndroidColdPreparationCommand({
          storage,
          binding,
          artifactRoot,
          ownerRunId: resourceOwnerRunId,
          label: `android-reverse-${label}`,
          argv: ['reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`],
          signal: input.signal,
          deadlineAt: input.deadlineAt,
          commandExecutions: coldResetCommandExecutions,
        });
      const reverseMappings = await target.adbRead(['reverse', '--list'], 10_000, input.deadlineAt);
      await writeAtomicDetoxConnectionBytes(
        artifactRoot,
        'android-reverse.private.json',
        Buffer.from(reverseMappings),
        16 * 1024,
        { signal: input.signal, deadlineAt: input.deadlineAt },
      );
      assertAndroidReverseMappings(reverseMappings, target.identity.serial, [metroPort, apiPort]);
      const preference = androidMetroPreference(appId, metroPort);
      await runAndroidColdPreparationCommand({
        storage,
        binding,
        artifactRoot,
        ownerRunId: resourceOwnerRunId,
        label: 'android-prefs-directory',
        argv: ['shell', 'run-as', appId, 'mkdir', '-p', 'shared_prefs'],
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        commandExecutions: coldResetCommandExecutions,
      });
      const encodedPreference = Buffer.from(preference.xml).toString('base64');
      await runAndroidColdPreparationCommand({
        storage,
        binding,
        artifactRoot,
        ownerRunId: resourceOwnerRunId,
        label: 'android-metro-prefs',
        argv: [
          'shell',
          'run-as',
          appId,
          'sh',
          '-c',
          `'mkdir -p shared_prefs && printf %s ${encodedPreference} | base64 -d > ${preference.relativePath}'`,
        ],
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        commandExecutions: coldResetCommandExecutions,
      });
      assert.equal(
        await target.adbRead(
          ['shell', 'run-as', appId, 'cat', preference.relativePath],
          10_000,
          input.deadlineAt,
        ),
        preference.xml.trim(),
        'Android Metro preference was not persisted exactly',
      );
    }
    if (coldResetExpectation) {
      const resetStartedAt = new Date().toISOString();
      coldResetStartedIso = resetStartedAt;
      if (!targetOsVersion)
        throw new Error('Android Detox camera cold reset target OS identity is unavailable');
      assert(coldResetStartedIso);
      const coldResetBoundary = createAndroidColdResetBoundary({
        targetOsVersion,
        resetStartedAt: coldResetStartedIso,
      });
      assert.equal(storage.appId, appId);
      assert(path.isAbsolute(build.binaryPath), 'Android qualified APK path is not absolute');
      const sourceRoot = await createAndroidColdResetSourceRoot(artifactRoot, input.captureRunId);
      const resetTarget = target;
      assert(resetTarget, 'Android Detox reset target is missing');
      await coldResetBoundary.runInstall(() =>
        runAndroidColdPreparationCommand({
          storage,
          binding,
          artifactRoot,
          ownerRunId: resourceOwnerRunId,
          label: 'android-install',
          argv: ['install', build.binaryPath],
          signal: input.signal,
          deadlineAt: input.deadlineAt,
          commandExecutions: coldResetCommandExecutions,
        }),
      );
      const packagePath = await target.adbRead(
        ['shell', 'pm', 'path', appId],
        10_000,
        input.deadlineAt,
      );
      const installedPath = /^package:(\/data\/app\/[A-Za-z0-9_~+=/.-]+\/base\.apk)$/u.exec(
        packagePath,
      )?.[1];
      if (!installedPath) throw new Error('Installed Android APK path cannot be bound');
      await runAndroidColdPreparationCommand({
        storage,
        binding,
        artifactRoot,
        ownerRunId: resourceOwnerRunId,
        label: 'android-installed-build',
        argv: ['pull', installedPath, path.join(artifactRoot, 'installed-base.apk')],
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        commandExecutions: coldResetCommandExecutions,
      });
      await chmod(path.join(artifactRoot, 'installed-base.apk'), 0o600);
      const installedApk = await readInstalledAndroidApk({
        artifactRoot,
        expectedHash: build.binaryHash,
      });
      const apiPort = Number(new URL(proxy.origin).port);
      assert(Number.isSafeInteger(apiPort) && apiPort > 0);
      for (const [label, port] of [
        ['metro', metroPort],
        ['api', apiPort],
      ] as const)
        await runAndroidColdPreparationCommand({
          storage,
          binding,
          artifactRoot,
          ownerRunId: resourceOwnerRunId,
          label: `android-reverse-${label}`,
          argv: ['reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`],
          signal: input.signal,
          deadlineAt: input.deadlineAt,
          commandExecutions: coldResetCommandExecutions,
        });
      const reverseMappings = await target.adbRead(['reverse', '--list'], 10_000, input.deadlineAt);
      await writeAtomicDetoxConnectionBytes(
        artifactRoot,
        'android-reverse.private.json',
        Buffer.from(reverseMappings),
        16 * 1024,
        { signal: input.signal, deadlineAt: input.deadlineAt },
      );
      assertAndroidReverseMappings(reverseMappings, target.identity.serial, [metroPort, apiPort]);
      const preference = androidMetroPreference(appId, metroPort);
      await runAndroidColdPreparationCommand({
        storage,
        binding,
        artifactRoot,
        ownerRunId: resourceOwnerRunId,
        label: 'android-prefs-directory',
        argv: ['shell', 'run-as', appId, 'mkdir', '-p', 'shared_prefs'],
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        commandExecutions: coldResetCommandExecutions,
      });
      const encodedPreference = Buffer.from(preference.xml).toString('base64');
      await runAndroidColdPreparationCommand({
        storage,
        binding,
        artifactRoot,
        ownerRunId: resourceOwnerRunId,
        label: 'android-metro-prefs',
        argv: [
          'shell',
          'run-as',
          appId,
          'sh',
          '-c',
          `'mkdir -p shared_prefs && printf %s ${encodedPreference} | base64 -d > ${preference.relativePath}'`,
        ],
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        commandExecutions: coldResetCommandExecutions,
      });
      assert.equal(
        await target.adbRead(
          ['shell', 'run-as', appId, 'cat', preference.relativePath],
          10_000,
          input.deadlineAt,
        ),
        preference.xml.trim(),
        'Android Metro preference was not persisted exactly',
      );
      const proxyProcess = await inspectProcessIdentity(process.pid);
      if (!proxyProcess) throw new Error('Android capture process ownership could not be observed');
      if (!session || !proxy) throw new Error('Android reset session ownership is incomplete');
      const resetSession = session;
      const resetProxy = proxy;
      const resetFixtures = {
        ...fixtures,
        resetId: coldResetExpectation.fixtureResetId,
      };
      const reset = await coldResetBoundary.runReset((startedAt) =>
        produceAndroidColdReset({
          expectation: coldResetExpectation,
          outputRoot: sourceRoot,
          captureRunId: input.captureRunId,
          ownerRunId: resourceOwnerRunId,
          resetStartedAt: startedAt,
          deadlineAtMonotonicMs: input.deadlineAt,
          target: {
            identity: { serial: resetTarget.identity.serial },
            osVersion: resetTarget.osVersion,
            runId: resetTarget.runId,
            verify: async () => resetTarget.verify(),
            androidSessionStorage: storage,
          },
          session: resetSession,
          proxy: resetProxy,
          proxyProcess: {
            pid: proxyProcess.pid,
            started: proxyProcess.started,
            script: proxyProcess.command,
          },
          fixtures: resetFixtures,
          build: {
            appId,
            buildProfile: build.configuration,
            binaryHash: build.binaryHash,
            apiOrigin: resetProxy.origin,
          },
          installedApk,
          commandExecutions: coldResetCommandExecutions,
          signal: input.signal,
        }),
      );
      const sourceObservation = readNativeEvidenceObservation(
        sourceRoot,
        'reset-original.private.json',
        true,
      );
      assert.equal(hashText(sourceObservation.bytes), reset.receiptHash);
      await writeAtomicDetoxConnectionBytes(
        artifactRoot,
        'reset-original.private.json',
        Buffer.from(sourceObservation.bytes),
        1024 * 1024,
        { signal: input.signal, deadlineAt: input.deadlineAt },
      );
      const sourceBinding: AndroidDetoxCameraResetBinding = {
        artifactRoot: sourceRoot,
        receiptPath: reset.receiptPath,
        receiptHash: reset.receiptHash,
        fixtureResetId: reset.fixtureResetId,
        ownerRunId: reset.ownerRunId,
        attemptId: reset.requestedAttemptId,
        cohortFixtureFingerprint: reset.cohortFixtureFingerprint,
        appStateFingerprint: reset.appStateFingerprint,
        fixtureStateFingerprint: reset.fixtureStateFingerprint,
        sourceFingerprint: reset.sourceFingerprint,
        helperFingerprint: reset.helperFingerprint,
        cleanupStatus: 'cleaned',
        target: reset.target,
        backend: reset.backend,
        sourceIdentity: sourceObservation.identity,
      };
      coldResetProof = readAndroidDetoxCameraResetProof({
        artifactRoot,
        expectation: input.coldReset,
        binding: sourceBinding,
      });
      requireAndroidDetoxCameraResetRuntimeMatchIndependent({
        proof: coldResetProof,
        runtime: {
          requestedRunId: input.requestedRunId,
          captureRunId: input.captureRunId,
          ownerRunId: resourceOwnerRunId,
          targetRunId: target.runId,
          fixtureRunId: session.manifest.runId,
          target: {
            deviceId: target.deviceId,
            osVersion: targetOsVersion,
            appId,
            buildProfile: build.configuration,
            binaryHash: build.binaryHash,
            apiOrigin: proxy.origin,
          },
          build: {
            sourceTreeHash: build.source.sourceTreeHash,
            helperInputsHash: build.helperInputsHash,
            binaryHash: build.binaryHash,
          },
          backend: {
            runId: session.manifest.runId,
            artifactRoot: session.manifest.artifactRoot,
            apiOrigin: probe.apiOrigin,
            apiPid: probe.apiPid,
            apiStarted: probe.apiStarted,
            apiScript: probe.apiScript,
            backendAttemptId: probe.backendAttemptId,
            manifestSha256: probe.manifestSha256,
          },
        },
      });
    }
    const locale = await readLocaleReceipt({
      root: artifactRoot,
      storage,
      binding,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      expectedLocale: input.expectedLocale,
    });
    const beforeEvidence = await session.connectionSnapshotWithEvidence(
      'native-entry-android',
      input.signal,
    );
    const isolationBeforeEvidence = await session.connectionSnapshotWithEvidence(
      'native-conn-isolation-android',
      input.signal,
    );
    const trainingBeforeEvidence = await session.snapshotWithEvidence(
      'native-entry-android',
      input.signal,
    );
    const expected = expectedSnapshotIdentity(
      fixtures,
      session.manifest.runId,
      'native-entry-android',
    );
    const isolationExpected = expectedSnapshotIdentity(
      isolationFixtures,
      session.manifest.runId,
      'native-conn-isolation-android',
    );
    const before = requireConnectionSnapshot(beforeEvidence.value, expected);
    requireConnectionSnapshot(isolationBeforeEvidence.value, isolationExpected);
    timingsMs.reset = elapsedMs(resetStartedAt);
    const ownerRunId = resourceOwnerRunId;
    requireAndroidDetoxCameraIdentityBoundary({
      requestedRunId: input.requestedRunId,
      captureRunId: input.captureRunId,
      ownerRunId,
      backendRunId: session.manifest.runId,
    });
    for (const [label, value] of [
      ['requested outer attempt', input.requestedRunId],
      ['capture artifact', input.captureRunId],
      ['resource owner', ownerRunId],
      ['backend session', session.manifest.runId],
    ] as const)
      assert.notEqual(target.runId, value, `Android Detox target run aliases ${label}`);
    // The owned target is already booted by this runner.  Running Detox through
    // an `android.emulator` configuration makes it discover an AVD by name,
    // which can select an unrelated host emulator.  Keep the qualified build
    // profile as android.emu.debug, but execute it through the attached-device
    // profile bound to this run's exact serial.
    const detoxConfiguration =
      build.configuration === 'android.emu.debug' ? 'android.att.debug' : build.configuration;
    childDeadlineAtEpochMs =
      Date.now() +
      Math.min(
        MAX_ANDROID_CAMERA_BRIDGE_WINDOW_MS,
        Math.max(1, Math.ceil(input.deadlineAt - performance.now())),
      );
    await persistAndroidCameraBridgePreference({
      storage,
      target,
      binding,
      artifactRoot,
      ownerRunId,
      captureRunId: input.captureRunId,
      locale: input.expectedLocale,
      deadlineAtEpochMs: childDeadlineAtEpochMs,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      commandExecutions: coldResetCommandExecutions,
    });
    const bridgeTargetValue = bridgeTarget(storage, binding);
    const bridgeBinding: AndroidDetoxCameraInstrumentationBinding = {
      captureRunId: input.captureRunId,
      ownerRunId,
      serial: storage.serial,
      locale: input.expectedLocale,
      deadlineAtEpochMs: childDeadlineAtEpochMs,
      appId: ANDROID_DETOX_CAMERA_APP_ID,
      cancelRelativePath: 'cancel.signal',
    };
    const readBridgeAfterChildExit = () =>
      readAndroidDetoxCameraPromptEvidence({
        artifactRoot,
        target: bridgeTargetValue,
        binding: bridgeBinding,
        signal: input.signal,
        deadlineAtEpochMs: bridgeBinding.deadlineAtEpochMs,
        readDeadlineAtEpochMs: Math.min(bridgeBinding.deadlineAtEpochMs, Date.now() + 30_000),
      });
    const command = {
      // Do not place Yarn between the owned controller and Detox. Yarn can
      // retain the controller's stdio after its detached Detox group exits,
      // which leaves no trustworthy `exit`/`close` lifecycle event for the
      // owner despite a completed test. The checked-in local CLI executes the
      // same Detox version and preserves one directly owned process boundary.
      command: path.join(root, 'node_modules', '.bin', 'detox'),
      argv: [
        'test',
        '-C',
        path.join(root, '.detoxrc.js'),
        '-c',
        detoxConfiguration,
        '--headless',
        // The owner installed the exact qualified APK pair and reset CAMERA
        // immediately beforehand; reinstallation would grant CAMERA again.
        '--reuse',
        '--artifacts-location',
        path.join(artifactRoot, 'detox-artifacts'),
        '--record-logs',
        'none',
      ],
    };
    childCommand = command;
    const childCommandHash = hashJson(command);
    scenarioStartedAt = performance.now();
    child = await startOwnedNativeCommand({
      ...command,
      artifactRoot,
      label: 'detox-camera-child',
      cwd: root,
      phase: 'step',
      env: {
        ...(input.parentEnv ?? process.env),
        ...buildDetoxVerifiedBinaryEnvironment(build),
        NODE_ENV: 'test',
        // The camera child writes its hierarchy and screenshot receipts through
        // an ESM protocol module. Jest's VM loader requires this opt-in for
        // dynamic import from the CommonJS Detox test file.
        NODE_OPTIONS:
          `${input.parentEnv?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? ''} --experimental-vm-modules`.trim(),
        DETOX_BASELINE_TEST_PATH: runnerPaths.testPath,
        DETOX_JEST_CONFIG: runnerPaths.jestConfigPath,
        DETOX_CONNECTION_PLATFORM: 'android',
        DETOX_ANDROID_CAMERA_SCENARIO: 'denied',
        DETOX_ANDROID_CAMERA_ARTIFACT_ROOT: artifactRoot,
        DETOX_ANDROID_CAMERA_CAPTURE_RUN_ID: input.captureRunId,
        DETOX_ANDROID_CAMERA_OWNER_RUN_ID: ownerRunId,
        DETOX_ANDROID_CAMERA_TARGET_RUN_ID: target.runId,
        DETOX_ANDROID_CAMERA_BACKEND_RUN_ID: session.manifest.runId,
        DETOX_ANDROID_CAMERA_ATTEMPT_ID: `${ownerRunId}:first`,
        DETOX_ANDROID_CAMERA_COMMAND_HASH: childCommandHash,
        DETOX_ANDROID_CAMERA_SERIAL: storage.serial,
        DETOX_ANDROID_DEVICE: storage.serial,
        // The attached Detox driver shells out to adb itself. Bind it to the
        // target's private server as well as its exact serial so it cannot
        // fall back to the machine-wide adb daemon or a foreign emulator.
        ADB_SERVER_SOCKET: `tcp:${storage.adbServerPort}`,
        // Detox shells out to the Android SDK client. Set both accepted client
        // bindings so its attached-device allocation cannot fall back to the
        // machine-wide daemon before Jest global setup runs.
        ANDROID_ADB_SERVER_PORT: String(storage.adbServerPort),
        DETOX_ANDROID_CAMERA_APP_ID: ANDROID_DETOX_CAMERA_APP_ID,
        DETOX_ANDROID_CAMERA_LOCALE: input.expectedLocale,
        DETOX_ANDROID_CAMERA_DEADLINE_AT: String(childDeadlineAtEpochMs),
        DETOX_ANDROID_CAMERA_COACH_EMAIL: fixtures.accounts.coach.email,
        DETOX_ANDROID_CAMERA_COACH_PASSWORD: fixtures.accounts.coach.password,
        DETOX_ANDROID_CAMERA_STUDENT_EMAIL: fixtures.accounts.student.email,
        DETOX_ANDROID_CAMERA_STUDENT_PASSWORD: fixtures.accounts.student.password,
      },
    });
    childIdentity = await readOwnedChildIdentity(
      artifactRoot,
      child,
      input.signal,
      input.deadlineAt,
    );
    report.detoxChildIdentity = childIdentity;
    report.detoxChild = {
      pid: child.pid,
      pgid: child.pgid,
      command,
      cwd: root,
      ownership: 'owned-process-group',
    };
    let intent: SubmitIntent;
    try {
      intent = await waitForSubmitIntent({
        root: artifactRoot,
        expected: {
          captureRunId: input.captureRunId,
          ownerRunId,
          sessionRunId: session.manifest.runId,
        },
        child,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        proxy,
        fixtures,
        session,
      });
    } catch (error) {
      // If the child stopped before it reached its intent, prefer the bridge's
      // bounded target-private receipt over an opaque child-log diagnosis.
      if (child.outcome().code !== null || child.outcome().signal !== null) {
        const bridge = await readBridgeAfterChildExit();
        if (bridge.receipt.childResult === 'failed') {
          failedBridge = bridge;
          const stageName =
            (await readLatestAndroidCameraStage(
              artifactRoot,
              { captureRunId: input.captureRunId, ownerRunId },
              { signal: input.signal, deadlineAt: input.deadlineAt },
            ).catch(() => null)) ?? 'unpublished';
          const bootstrapRaw = await target
            .adbRead(
              [
                'shell',
                'run-as',
                ANDROID_DETOX_CAMERA_APP_ID,
                'cat',
                'shared_prefs/detox.camera.bootstrap.v1.xml',
              ],
              10_000,
              input.deadlineAt,
            )
            .catch(() => '');
          const bootstrapMatch = /<string name="state">([A-Za-z0-9_-]{1,128})<\/string>/u.exec(
            bootstrapRaw,
          );
          const bootstrapState = bootstrapMatch ? bootstrapMatch[1] : 'unpublished';
          const diagnostic = new Error(
            `Android Detox child exited before its owned submit intent (bridgeFailure=${bridge.receipt.childFailureClass}, stage=${stageName}, bootstrap=${bootstrapState})`,
            { cause: error },
          );
          diagnostic.name =
            `AndroidCameraChild_${bridge.receipt.childFailureClass}_${stageName}_${bootstrapState}`.slice(
              0,
              128,
            );
          throw diagnostic;
        }
      }
      throw error;
    }
    try {
      await child.wait(remaining(input.deadlineAt), input.signal);
    } catch (error) {
      childWaitFailure = error;
      // OwnedChild.wait rightfully rejects a non-zero Detox exit. Preserve the
      // target-private bridge receipt before propagating that generic exit.
      const bridge = await readBridgeAfterChildExit().catch(() => null);
      if (bridge?.receipt.childResult === 'failed') failedBridge = bridge;
      throw error;
    }
    timingsMs.scenario = elapsedMs(scenarioStartedAt);
    verifyStartedAt = performance.now();
    // Read the bounded bridge receipt before writeChildReceipt can reject a
    // non-zero child exit. The outer terminal diagnostic can then retain the
    // actual instrumentation failure class and bootstrap position.
    const terminalBridge: AndroidDetoxCameraBridgeRead = await readBridgeAfterChildExit();
    if (terminalBridge.receipt.childResult === 'failed') failedBridge = terminalBridge;
    childReceiptPath = await writeChildReceipt(
      artifactRoot,
      child,
      input.captureRunId,
      input.signal,
      input.deadlineAt,
    );
    await proxy.waitForQuiescence(Math.min(5_000, remaining(input.deadlineAt)), input.signal);
    const flow = await readPrivateJson<AndroidDetoxCameraFlowReceipt>(
      artifactRoot,
      'detox-training-camera-flow.private.json',
      64 * 1024,
      { signal: input.signal, deadlineAt: input.deadlineAt },
    );
    assert.equal(flow.captureRunId, input.captureRunId);
    assert.equal(flow.ownerRunId, ownerRunId);
    assert.equal(flow.serial, storage.serial);
    assert.equal(flow.pendingConnectionIdSha256, hashText(flow.pendingConnectionId));
    const bridge: AndroidDetoxCameraBridgeRead = terminalBridge;
    if (bridge.receipt.childResult === 'failed') failedBridge = bridge;
    const capture = proxy.nativeRequestBodyCapture;
    if (!capture)
      throw new Error(
        `Android Detox camera submission body receipt is missing (seen=${String(
          proxy.nativeRequestBodyCaptureSeen,
        )}, failure=${proxy.nativeRequestBodyCaptureFailure ?? 'none'})`,
      );
    const submission = capture;
    assert.equal(submission.actorAuthUidHash, hashText(fixtures.accounts.student.authUid));
    const pendingEvidence = await session.connectionSnapshotWithEvidence(
      'native-entry-android',
      input.signal,
    );
    const isolationAfterEvidence = await session.connectionSnapshotWithEvidence(
      'native-conn-isolation-android',
      input.signal,
    );
    const trainingAfterEvidence = await session.snapshotWithEvidence(
      'native-entry-android',
      input.signal,
    );
    const activeSession = session;
    assert(activeSession, 'Android Detox camera session disappeared before SQL verification');
    const sqlReceipts = await writeAndroidCameraSqlSourceReceipts({
      artifactRoot,
      before: beforeEvidence,
      pending: pendingEvidence,
      isolationBefore: isolationBeforeEvidence,
      isolationAfter: isolationAfterEvidence,
      trainingBefore: trainingBeforeEvidence,
      trainingAfter: trainingAfterEvidence,
      probeApiLifetime: (signal) => activeSession.probeApiLifetime(signal),
      signal: input.signal,
    });
    const inviteCodeReceipt = await readPrivateJson<unknown>(
      artifactRoot,
      'detox-training-camera-invite-code.private.json',
      MAX_INTENT_BYTES,
      { signal: input.signal, deadlineAt: input.deadlineAt },
    );
    const inviteCode = requireInviteCodeReceipt(inviteCodeReceipt, {
      captureRunId: input.captureRunId,
      ownerRunId,
      sessionRunId: session.manifest.runId,
    });
    assert.equal(inviteCode.sha256, flow.inviteCodeSha256);
    assert.equal(inviteCode.sha256, intent.manualCodeSha256);
    await requireAndroidCameraSqlEvidence({
      artifactRoot,
      before,
      pending: pendingEvidence.value,
      fixtures,
      expected,
      isolationExpected,
      isolationBefore: isolationBeforeEvidence.value,
      isolationAfter: isolationAfterEvidence.value,
      trainingBefore: trainingBeforeEvidence.value,
      trainingAfter: trainingAfterEvidence.value,
      inviteCode: inviteCode.value,
      isolationScope: 'native-conn-isolation-android',
      trainingScope: 'native-entry-android',
      sourceReceipts: sqlReceipts,
      sourceEvidence: {
        before: beforeEvidence.receipt,
        pending: pendingEvidence.receipt,
        'isolation-before': isolationBeforeEvidence.receipt,
        'isolation-after': isolationAfterEvidence.receipt,
        'training-before': trainingBeforeEvidence.receipt,
        'training-after': trainingAfterEvidence.receipt,
      },
      parentEvidence: {
        before: beforeEvidence,
        pending: pendingEvidence,
        'isolation-before': isolationBeforeEvidence,
        'isolation-after': isolationAfterEvidence,
        'training-before': trainingBeforeEvidence,
        'training-after': trainingAfterEvidence,
      },
      signal: input.signal,
    });
    const transport = proxy.observations;
    // The coach and student sign in through the UI (POST /auth/email/sign-in
    // 201), so count only the invite submission and allow no other 201 POST.
    const post = transport.filter((row) => row.method === 'POST' && row.status === 201);
    const submissionPathHash = hashText('/connections/invite-submissions');
    const signInPathHash = hashText('/auth/email/sign-in');
    const submissionPosts = post.filter((row) => row.pathHash === submissionPathHash);
    assert.equal(
      submissionPosts.length,
      1,
      'Android Detox camera must have one forwarded invite-submission POST 201',
    );
    assert.equal(submissionPosts[0].requestId, submission.requestId);
    assert.equal(submissionPosts[0].pathHash, submission.pathHash);
    assert(
      post.every((row) => row.pathHash === submissionPathHash || row.pathHash === signInPathHash),
      'Android Detox camera forwarded an unexpected POST 201',
    );
    await writeAtomicDetoxConnectionBytes(
      artifactRoot,
      TRANSPORT_RECEIPT,
      Buffer.from(`${JSON.stringify(transport)}\n`),
      MAX_INTENT_BYTES * 4,
      { signal: input.signal, deadlineAt: input.deadlineAt },
    );
    const context: AndroidDetoxCameraProducerContext = {
      requestedRunId: input.requestedRunId,
      captureRunId: input.captureRunId,
      backendRunId: session.manifest.runId,
      ownerRunId,
      targetRunId: target.runId,
      serial: storage.serial,
      expectedLocale: input.expectedLocale,
      selectionHash: androidCameraSelectionHash(input.selection),
      bridge,
      flow,
      permission: {
        before: 'denied',
        after: 'denied',
        receiptPath: bridge.receiptHost.path,
        receiptSha256: bridge.receiptHost.sha256,
        executionCount: bridge.executions.length,
      },
      localeReceiptPath: locale.path,
      localeReceiptSha256: locale.sha256,
      studentAuthUidSha256: hashText(fixtures.accounts.student.authUid),
      submission,
      sqlReceipts,
      transport,
      sourceTreeHash: build.source.sourceTreeHash,
      helperInputsHash: build.helperInputsHash,
      buildHash: buildHash(build),
    } as AndroidDetoxCameraProducerContext;
    producerAttempted = true;
    producerResult = await input.executeCamera(context);
    input.signal.throwIfAborted();
    timingsMs.verify = elapsedMs(verifyStartedAt);
  } catch (error) {
    let reportedError = error;
    if (child && (child.outcome().code !== null || child.outcome().signal !== null) && target) {
      // Retain the bounded device-log tail before owned cleanup removes the
      // emulator. It is diagnostic-only and never enters
      // public evidence or qualification.
      const logcat = await target
        .adbRead(['logcat', '-d', '-v', 'brief', '*:V'], 10_000, input.deadlineAt)
        .catch(() => '');
      if (logcat) {
        const bytes = Buffer.from(logcat, 'utf8');
        await writeAtomicDetoxConnectionBytes(
          artifactRoot,
          'android-camera-failure-logcat.private.log',
          bytes.subarray(Math.max(0, bytes.length - 256 * 1024)),
          256 * 1024,
          { signal: input.signal, deadlineAt: input.deadlineAt },
        ).catch(() => undefined);
      }
      const bridgeFailureClass =
        failedBridge?.receipt.childResult === 'failed'
          ? failedBridge.receipt.childFailureClass
          : 'unavailable';
      const stageName =
        (await readLatestAndroidCameraStage(
          artifactRoot,
          { captureRunId: input.captureRunId, ownerRunId: resourceOwnerRunId },
          { signal: input.signal, deadlineAt: input.deadlineAt },
        ).catch(() => null)) ?? 'unpublished';
      const bootstrapRaw = await target
        .adbRead(
          [
            'shell',
            'run-as',
            ANDROID_DETOX_CAMERA_APP_ID,
            'cat',
            'shared_prefs/detox.camera.bootstrap.v1.xml',
          ],
          10_000,
          input.deadlineAt,
        )
        .catch(() => '');
      const bootstrapMatch = /<string name="state">([A-Za-z0-9_-]{1,128})<\/string>/u.exec(
        bootstrapRaw,
      );
      const bootstrapState = bootstrapMatch ? bootstrapMatch[1] : 'unpublished';
      // errorRecord keeps only name/message, so carry the original cause in the
      // message; a completed child can still fail post-capture verification.
      const causeText = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const diagnostic = new Error(
        `Android Detox child failed after submit intent (bridgeFailure=${bridgeFailureClass}, stage=${stageName}, bootstrap=${bootstrapState}); cause: ${causeText}`,
        { cause: error },
      );
      diagnostic.name =
        `AndroidCameraChild_${bridgeFailureClass}_${stageName}_${bootstrapState}`.slice(0, 128);
      reportedError = diagnostic;
    }
    producerFailure = errorRecord(reportedError);
    await writeAtomicDetoxConnectionBytes(
      artifactRoot,
      'detox-camera-owner-failure.private.json',
      Buffer.from(`${JSON.stringify(producerFailure)}\n`),
      16 * 1024,
      { signal: input.signal, deadlineAt: input.deadlineAt },
    ).catch(() => undefined);
  } finally {
    (report.commandExecutions as unknown[]).push(...coldResetCommandExecutions);
    cleanupStartedAt = performance.now();
    try {
      // Expo exposes the same owned process-group stop primitive as the
      // existing baseline.  Keep it inside the caller's remaining budget;
      // the aggregate driver below retains any timeout/error and continues
      // to independent cleanup rather than manufacturing a clean result.
      if (expo) {
        const stop = expo.stop();
        await Promise.race([
          Promise.resolve(stop),
          new Promise<never>((_, reject) => {
            const delay = Math.max(1, Math.ceil(input.deadlineAt - performance.now()));
            const timer = setTimeout(
              () => reject(new Error('Owned Expo cleanup exceeded the aggregate deadline')),
              delay,
            );
            unrefTimer(timer);
          }),
        ]);
      }
    } catch (error) {
      // Keep the failure attached to the same aggregate report that is
      // handed to the driver cleanup.  A clean target census cannot erase
      // an unresolved Expo process-group stop.
      expoCleanupFailure = {
        name: error instanceof Error ? error.name.slice(0, 128) : 'UnknownError',
        message: (error instanceof Error ? error.message : String(error)).slice(0, 512),
      };
      report.detoxExpoCleanup = {
        status: 'failed',
        error: expoCleanupFailure,
      };
    }
    if (reservation || target || session || proxy) {
      try {
        const result = await runDetoxConnectionDriverCleanup({
          artifactRoot,
          repositoryRoot: root,
          report,
          reason: input.signal.aborted
            ? 'cancelled'
            : producerResult
              ? 'completed'
              : 'journey-failed',
          signal: input.signal,
          deadlineAt: input.deadlineAt,
          child,
          childCommand,
          proxy,
          session,
          target,
          reservation,
          androidCleanup:
            target && producer
              ? async ({ signal, deadlineAt, target: owned }) => {
                  assert(owned.platform === 'android');
                  if (!owned.androidRuntimeParent || !owned.androidSdkRoot)
                    throw new Error('Android Detox camera cleanup identity is incomplete');
                  return producer.verifyOwnedAndroidCleanup({
                    repositoryRoot: root,
                    artifactRoot,
                    target: {
                      platform: 'android',
                      deviceId: owned.deviceId,
                      androidRuntimeParent: owned.androidRuntimeParent,
                      androidSdkRoot: owned.androidSdkRoot,
                      ownership: owned.ownership,
                    },
                    signal,
                    deadlineAt,
                  });
                }
              : undefined,
        });
        const independent = requireAndroidDetoxCleanupResult(report.detoxAndroidCleanup);
        cleanup = {
          status:
            result.status === 'cleaned' && !expoCleanupFailure
              ? 'cleaned'
              : 'failed-recovery-retained',
          independentCensus: independent.censusStatus === 'available' ? 'passed' : 'failed',
          retainedPaths:
            result.status === 'cleaned'
              ? []
              : [path.join(artifactRoot, 'detox-connection-cleanup.private.json')],
        };
      } catch (error) {
        cleanup = {
          status: 'failed-recovery-retained',
          independentCensus: 'failed',
          retainedPaths: [
            path.join(artifactRoot, 'detox-connection-cleanup.private.json'),
            error instanceof Error ? error.message.slice(0, 256) : 'cleanup-failed',
          ],
        };
      }
    }
    timingsMs.cleanup = elapsedMs(cleanupStartedAt);
  }
  const childOutcome = child?.outcome() ?? { code: null, signal: null };
  const childClassification = classifyOwnedCommand(child, childWaitFailure);
  const censusFailure = child?.censusFailure() ?? null;
  const outputFailure = child?.outputFailure() ?? null;
  const childDiagnostic = child
    ? {
        phase: 'step' as const,
        execution: childClassification ?? 'harness-blocked',
        cleanup:
          cleanup.status === 'cleaned'
            ? ('cleaned' as const)
            : ('failed-recovery-ledger-retained' as const),
        childExitCode: childOutcome.code,
        childSignal: childOutcome.signal,
        pid: child.pid,
        pgid: child.pgid,
        command: childCommand?.command ?? path.join(root, 'node_modules', '.bin', 'detox'),
        argv: childCommand?.argv ?? [],
        cwd: root,
        deadlineMs: Math.max(
          1,
          Math.ceil(
            childDeadlineAtEpochMs > 0
              ? childDeadlineAtEpochMs - Date.now()
              : input.deadlineAt - performance.now(),
          ),
        ),
        logPath: child.logPath,
        stdoutPath: child.stdoutPath,
        ownershipPath: path.join(artifactRoot, 'detox-camera-child.ownership.json'),
        cleanupMs: timingsMs.cleanup,
        censusFailure,
        outputFailure,
        elapsedMs: scenarioStartedAt ? elapsedMs(scenarioStartedAt) : 0,
      }
    : null;
  const childFailure = childWaitFailure ? errorRecord(childWaitFailure) : null;
  const verificationFailure = producerFailure ?? childFailure ?? expoCleanupFailure ?? null;
  const runtime: AndroidDetoxCameraRuntimeEvidence = {
    backendAttemptId,
    fixtureHash,
    flagsHash: build.environmentHash ?? null,
    toolVersions: build.toolVersions ? { ...build.toolVersions } : {},
    timingsMs: { ...timingsMs },
    captureExitCode: producerResult !== undefined && childClassification === 'completed' ? 0 : 2,
    childExitCode: childOutcome.code,
    childSignal: childOutcome.signal,
    childClassification,
    captureResult:
      producerResult !== undefined
        ? 'observed'
        : input.signal.aborted || childClassification === 'cancelled'
          ? 'cancelled'
          : 'harness-blocked',
    captureTimeout: childClassification === 'deadline' ? 'whole-capture' : null,
    cancellation: input.signal.aborted || childClassification === 'cancelled' ? 'SIGTERM' : null,
    callbackInvocations: producerAttempted ? 1 : 0,
    callbackCompleted: producerResult !== undefined,
    captureInvocation: {
      count: child ? 1 : 0,
      returned:
        child !== undefined &&
        (childOutcome.code !== null ||
          childOutcome.signal !== null ||
          childClassification === 'completed'),
    },
    captureCompleted:
      producerResult !== undefined &&
      childClassification === 'completed' &&
      cleanup.status === 'cleaned',
    externalCleanupResult: cleanup.status === 'cleaned' ? 'passed' : 'failed',
    verificationResult: producerResult !== undefined ? 'passed' : 'blocked',
    verificationFailure,
    postCaptureFailure: verificationFailure
      ? {
          phase: producerFailure || childFailure ? 'verification' : 'cleanup',
          ...verificationFailure,
        }
      : null,
    deadline:
      childClassification === 'deadline'
        ? { step: 'detox-camera-child', deadlineMs: childDeadlineAtEpochMs }
        : null,
    commandDiagnostics: childDiagnostic ? [childDiagnostic] : [],
    censusFailures: censusFailure ? [censusFailure] : [],
    outputFailures: outputFailure ? [outputFailure] : [],
  };
  const targetProjection = {
    deviceId: producerResult?.flow.serial ?? target?.deviceId ?? null,
    osVersion: targetOsVersion,
    appId: build.embeddedRuntime.appIdentifier || build.appIdentifier,
    buildProfile: build.configuration,
    binaryHash: build.binaryHash,
    apiOrigin: proxy?.origin ?? build.embeddedRuntime.apiOrigin ?? null,
  };
  const buildIdentity = {
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
  };
  return {
    captureRoot: artifactRoot,
    outputRoot,
    captureRunId: input.captureRunId,
    fixtureRunId: producerResult?.backendRunId ?? session?.manifest.runId ?? input.requestedRunId,
    ownerRunId: resourceOwnerRunId,
    targetOwnerRunId: target?.runId ?? '',
    targetDeviceId: producerResult?.flow.serial ?? target?.deviceId ?? 'unknown',
    producer: producerResult ?? null,
    cleanup,
    runtime,
    target: targetProjection,
    buildIdentity,
    sourceTreeHash: producerResult?.sourceTreeHash ?? null,
    helperInputsHash: producerResult?.helperInputsHash ?? null,
    buildHash: producerResult?.buildHash ?? null,
    coldReset: coldResetProof,
    childReceiptPath,
    flowReceiptPath: 'detox-training-camera-flow.private.json',
    failure: producerFailure ?? expoCleanupFailure ?? null,
    childCommandIdentity: childIdentity
      ? {
          pid: childIdentity.pid,
          pgid: childIdentity.pgid,
          started: childIdentity.started,
          argvSha256: childCommand ? hashJson(childCommand) : '',
          cwd: root,
          deadlineAtEpochMs: childDeadlineAtEpochMs,
        }
      : null,
  };
};
