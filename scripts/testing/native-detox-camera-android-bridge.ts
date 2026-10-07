import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  requireAndroidDetoxCameraPromptReceipt,
  ANDROID_DETOX_CAMERA_BRIDGE_APP_ID,
  ANDROID_DETOX_CAMERA_APP_ID,
  requireAndroidDetoxCameraQualification,
  requireAndroidDetoxCameraReceiptIdentity,
  type AndroidDetoxCameraAdbTarget,
  type AndroidDetoxCameraBridgeRead,
  type AndroidDetoxCameraCommandExecution,
  type AndroidDetoxCameraFrameHostPair,
  type AndroidDetoxCameraHostFileReceipt,
  type AndroidDetoxCameraInstrumentationBinding,
  type AndroidDetoxCameraPromptReceipt,
} from './native-detox-camera-android-contract';

const MAX_RECEIPT_BYTES = 256 * 1024;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const RUN_ID = /^[a-f0-9]{24}$/u;
function bridgeDevicePath(relativePath: string): string {
  assert(relativePath.startsWith('files/detox-camera/'));
  assert(!relativePath.includes('..') && !relativePath.includes('\\'));
  return relativePath;
}

export type AndroidDetoxCameraBridgeReadInput = Readonly<{
  artifactRoot: string;
  target: AndroidDetoxCameraAdbTarget;
  binding: AndroidDetoxCameraInstrumentationBinding;
  signal: AbortSignal;
  deadlineAtEpochMs: number;
  /** Bounded host read deadline; the instrumentation binding remains immutable. */
  readDeadlineAtEpochMs?: number;
}>;

type StableRead = Readonly<{
  bytes: Buffer;
  receipt: AndroidDetoxCameraHostFileReceipt;
}>;
type PulledFile = StableRead & Readonly<{ execution: AndroidDetoxCameraCommandExecution }>;

function remainingMs(deadlineAtEpochMs: number): number {
  const remaining = deadlineAtEpochMs - Date.now();
  if (!Number.isSafeInteger(remaining) || remaining < 100)
    throw new Error('Android camera bridge deadline elapsed');
  return Math.min(600_000, remaining);
}

function assertAbort(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('Android camera bridge cancelled');
}

async function ownedArtifactRoot(root: string): Promise<string> {
  const resolved = path.resolve(root);
  assert.equal(await realpath(resolved), resolved, 'Android camera artifact root is not canonical');
  const metadata = await lstat(resolved);
  assert(
    metadata.isDirectory() && !metadata.isSymbolicLink(),
    'Android camera artifact root is not a directory',
  );
  assert.equal(metadata.mode & 0o777, 0o700, 'Android camera artifact root is not private');
  if (typeof process.getuid === 'function') assert.equal(metadata.uid, process.getuid());
  return resolved;
}

function childPath(root: string, name: string): string {
  assert(
    name.length > 0 && !path.isAbsolute(name) && !name.split(path.sep).includes('..'),
    'Android camera host path escaped',
  );
  const value = path.resolve(root, name);
  assert(value.startsWith(root + path.sep), 'Android camera host path escaped artifact root');
  return value;
}

async function readStableHostFile(input: {
  root: string;
  filePath: string;
  kind: 'receipt' | 'frame';
  signal: AbortSignal;
  allowEmpty?: boolean;
}): Promise<StableRead> {
  assertAbort(input.signal);
  const maximum = input.kind === 'receipt' ? MAX_RECEIPT_BYTES : MAX_FRAME_BYTES;
  const resolved = path.resolve(input.filePath);
  assert(
    resolved.startsWith(input.root + path.sep),
    'Android camera host output escaped artifact root',
  );
  assert.equal(await realpath(resolved), resolved, 'Android camera host output is not canonical');
  const before = await lstat(resolved);
  assert(
    before.isFile() && !before.isSymbolicLink(),
    'Android camera host output is not a regular file',
  );
  assert.equal(before.nlink, 1, 'Android camera host output has multiple links');
  assert.equal(before.mode & 0o777, 0o600, 'Android camera host output is not private');
  if (typeof process.getuid === 'function') assert.equal(before.uid, process.getuid());
  assert(
    (input.allowEmpty || before.size > 0) && before.size <= maximum,
    'Android camera host output exceeds its cap',
  );
  const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  const descriptorBefore = await handle.stat();
  const hash = createHash('sha256');
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      assertAbort(input.signal);
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maximum - total + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximum) throw new Error('Android camera host output grew beyond its cap');
      const bytes = chunk.subarray(0, bytesRead);
      chunks.push(bytes);
      hash.update(bytes);
    }
    const descriptorAfter = await handle.stat();
    assert.equal(
      descriptorAfter.uid,
      descriptorBefore.uid,
      'Android camera host output owner changed',
    );
    assert.equal(
      descriptorAfter.gid,
      descriptorBefore.gid,
      'Android camera host output group changed',
    );
    assert.equal(
      descriptorAfter.dev,
      descriptorBefore.dev,
      'Android camera host output device changed',
    );
    assert.equal(
      descriptorAfter.ino,
      descriptorBefore.ino,
      'Android camera host output inode changed',
    );
    assert.equal(
      descriptorAfter.uid,
      descriptorBefore.uid,
      'Android camera host output owner changed',
    );
    assert.equal(
      descriptorAfter.mode,
      descriptorBefore.mode,
      'Android camera host output mode changed',
    );
    assert.equal(
      descriptorAfter.nlink,
      descriptorBefore.nlink,
      'Android camera host output links changed',
    );
    assert.equal(
      descriptorAfter.size,
      descriptorBefore.size,
      'Android camera host output size changed',
    );
    assert.equal(
      descriptorAfter.mtimeMs,
      descriptorBefore.mtimeMs,
      'Android camera host output mtime changed',
    );
    assert.equal(
      descriptorAfter.ctimeMs,
      descriptorBefore.ctimeMs,
      'Android camera host output ctime changed',
    );
  } finally {
    await handle.close();
  }
  const after = await lstat(resolved);
  assert(
    after.isFile() && !after.isSymbolicLink(),
    'Android camera host output was replaced with a non-file',
  );
  assert.equal(after.dev, before.dev, 'Android camera host output changed after read');
  assert.equal(after.ino, before.ino, 'Android camera host output was replaced after read');
  assert.equal(after.uid, before.uid, 'Android camera host output owner changed after read');
  assert.equal(after.gid, before.gid, 'Android camera host output group changed after read');
  assert.equal(after.mode, before.mode, 'Android camera host output mode changed after read');
  assert.equal(after.nlink, before.nlink, 'Android camera host output links changed after read');
  assert.equal(after.size, before.size, 'Android camera host output size changed after read');
  assert.equal(
    after.mtimeMs,
    before.mtimeMs,
    'Android camera host output mtime changed after read',
  );
  assert.equal(
    after.ctimeMs,
    before.ctimeMs,
    'Android camera host output ctime changed after read',
  );
  assert.equal(total, before.size, 'Android camera host output bytes are incomplete');
  return {
    bytes: Buffer.concat(chunks),
    receipt: {
      path: path.relative(input.root, resolved),
      sizeBytes: total,
      sha256: hash.digest('hex'),
      ownerUid: before.uid,
      mode: before.mode & 0o777,
      verification: 'owned-stable-reader-v6',
    },
  };
}

function requireExecution(
  execution: AndroidDetoxCameraCommandExecution,
  stdoutPath: string,
  expectedArgv: readonly string[],
): void {
  assert.equal(execution.execution.phase, 'step', 'Android camera bridge ADB phase is invalid');
  assert.equal(
    execution.execution.execution,
    'completed',
    'Android camera bridge ADB did not complete',
  );
  assert.equal(execution.execution.cleanup, 'cleaned', 'Android camera bridge ADB cleanup failed');
  assert.equal(
    execution.execution.childExitCode,
    0,
    'Android camera bridge ADB exited unsuccessfully',
  );
  assert.equal(
    execution.execution.childSignal,
    null,
    'Android camera bridge ADB received a signal',
  );
  assert(
    Number.isSafeInteger(execution.execution.pid) && execution.execution.pid > 0,
    'Android camera bridge ADB PID is missing',
  );
  assert(
    Number.isSafeInteger(execution.execution.pgid) && execution.execution.pgid > 0,
    'Android camera bridge ADB PGID is missing',
  );
  assert.equal(
    execution.stdoutPath,
    stdoutPath,
    'Android camera bridge ADB stdout path was changed',
  );
  assert.deepEqual(execution.argv, expectedArgv, 'Android camera bridge ADB argv was changed');
  assert(
    !execution.argv.includes('sh') && !execution.argv.includes('-c'),
    'Android camera bridge used shell text',
  );
}

function requireDeviceRelativePath(value: string, runId: string): string {
  assert(typeof value === 'string' && value.length > 0, 'Android camera device path is missing');
  assert(
    !path.isAbsolute(value) && !value.split(/[\\/]/u).includes('..'),
    'Android camera device path escaped',
  );
  assert(value === value.trim(), 'Android camera device path is not normalized');
  assert(!value.includes('\\'), 'Android camera device path uses a backslash');
  assert(
    value === `${value.split('/').filter(Boolean).join('/')}`,
    'Android camera device path is not canonical',
  );
  assert(RUN_ID.test(runId));
  return value;
}

async function pullDeviceFile(
  input: AndroidDetoxCameraBridgeReadInput,
  label: string,
  relativePath: string,
  kind: 'receipt' | 'frame',
): Promise<PulledFile> {
  assertAbort(input.signal);
  await input.target.verify();
  const root = await ownedArtifactRoot(input.artifactRoot);
  const stdoutPath = childPath(
    root,
    `detox-camera-${label}.private.${kind === 'receipt' ? 'json' : 'bin'}`,
  );
  const execution = await input.target.runAdb({
    label: `detox-camera-${label}`,
    argv: ['shell', 'run-as', ANDROID_DETOX_CAMERA_APP_ID, 'cat', bridgeDevicePath(relativePath)],
    artifactRoot: root,
    stdoutPath,
    deadlineMs: remainingMs(input.readDeadlineAtEpochMs ?? input.deadlineAtEpochMs),
    signal: input.signal,
  });
  const expectedArgv = [
    'shell',
    'run-as',
    ANDROID_DETOX_CAMERA_APP_ID,
    'cat',
    bridgeDevicePath(relativePath),
  ] as const;
  requireExecution(execution, stdoutPath, expectedArgv);
  const stable = await readStableHostFile({
    root,
    filePath: stdoutPath,
    kind,
    signal: input.signal,
  });
  return { ...stable, execution };
}

type DeviceFileProbe = Readonly<{
  exists: boolean;
  execution: AndroidDetoxCameraCommandExecution;
}>;

/**
 * `adb exec-out` does not inherit the same package-data working directory as
 * the owner-proven `adb shell run-as` path. Use that same non-interactive shell
 * transport for the fixed-argv reader. Probe with `find` first: its empty
 * result is a valid, zero-exit absence signal and uses no remote shell text.
 */
async function probeDeviceFile(
  input: AndroidDetoxCameraBridgeReadInput,
  label: string,
  relativePath: string,
): Promise<DeviceFileProbe> {
  assert(relativePath.startsWith('files/detox-camera/'));
  const devicePath = bridgeDevicePath(relativePath);
  const root = await ownedArtifactRoot(input.artifactRoot);
  const stdoutPath = childPath(root, `detox-camera-${label}-exists.private.json`);
  const execution = await input.target.runAdb({
    label: `detox-camera-${label}-exists`,
    argv: [
      'shell',
      'run-as',
      ANDROID_DETOX_CAMERA_APP_ID,
      'find',
      'files',
      '-maxdepth',
      '3',
      '-type',
      'f',
      '-name',
      relativePath.slice(relativePath.lastIndexOf('/') + 1),
    ],
    artifactRoot: root,
    stdoutPath,
    deadlineMs: remainingMs(input.readDeadlineAtEpochMs ?? input.deadlineAtEpochMs),
    signal: input.signal,
  });
  const expectedArgv = [
    'shell',
    'run-as',
    ANDROID_DETOX_CAMERA_APP_ID,
    'find',
    'files',
    '-maxdepth',
    '3',
    '-type',
    'f',
    '-name',
    relativePath.slice(relativePath.lastIndexOf('/') + 1),
  ] as const;
  requireExecution(execution, stdoutPath, expectedArgv);
  const stable = await readStableHostFile({
    root,
    filePath: stdoutPath,
    kind: 'receipt',
    signal: input.signal,
    allowEmpty: true,
  });
  const output = stable.bytes.toString('utf8');
  if (output.length === 0) return { exists: false, execution };
  assert.equal(
    output,
    `${devicePath}\n`,
    'Android camera device-file probe returned an unexpected path',
  );
  return { exists: true, execution };
}

function parseReceipt(bytes: Buffer): AndroidDetoxCameraPromptReceipt {
  assert(bytes.byteLength <= MAX_RECEIPT_BYTES, 'Android camera receipt exceeds its cap');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error('Android camera receipt is not JSON', { cause: error });
  }
  return requireAndroidDetoxCameraPromptReceipt(parsed);
}

function requireReceiptFailureDiagnostic(
  bytes: Buffer,
  binding: AndroidDetoxCameraInstrumentationBinding,
): { bridgeStage: string; bridgeErrorClass: string; failureCode: string } {
  assert(
    bytes.byteLength > 0 && bytes.byteLength <= 4096,
    'Android camera receipt failure diagnostic exceeds its cap',
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error('Android camera receipt failure diagnostic is not JSON', { cause: error });
  }
  assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  const row = parsed as Record<string, unknown>;
  assert.equal(row.kind, 'private-detox-android-camera-receipt-failure');
  assert.equal(row.schemaVersion, 1);
  assert.equal(row.captureRunId, binding.captureRunId);
  assert.equal(row.ownerRunId, binding.ownerRunId);
  assert.equal(row.attemptId, `${binding.ownerRunId}:first`);
  for (const key of ['bridgeStage', 'bridgeErrorClass', 'failureCode'] as const)
    assert(typeof row[key] === 'string' && /^[A-Za-z0-9-]{1,128}$/u.test(row[key] as string));
  return {
    bridgeStage: row.bridgeStage as string,
    bridgeErrorClass: row.bridgeErrorClass as string,
    failureCode: row.failureCode as string,
  };
}

function hostPair(
  root: string,
  label: string,
  hostHierarchy: AndroidDetoxCameraHostFileReceipt,
  hostScreenshot: AndroidDetoxCameraHostFileReceipt,
): AndroidDetoxCameraFrameHostPair {
  assert(hostHierarchy.path.startsWith(`detox-camera-${label}-hierarchy`));
  assert(hostScreenshot.path.startsWith(`detox-camera-${label}-screenshot`));
  return { hierarchy: hostHierarchy, screenshot: hostScreenshot };
}

export async function readAndroidDetoxCameraPromptEvidence(
  input: AndroidDetoxCameraBridgeReadInput,
): Promise<AndroidDetoxCameraBridgeRead> {
  assert(
    input.target.appId === 'com.edufelip.mychampions.dev',
    'Android camera bridge target app is unsupported',
  );
  assert(
    input.target.serial === input.binding.serial,
    'Android camera bridge target serial differs from binding',
  );
  assert(
    Number.isSafeInteger(input.target.adbServerPort) &&
      input.target.adbServerPort > 0 &&
      input.target.adbServerPort <= 65_535,
    'Android camera bridge ADB server port is invalid',
  );
  assert.equal(input.binding.ownerRunId.length, 24, 'Android camera bridge owner run is invalid');
  assert.equal(
    input.binding.captureRunId.length,
    24,
    'Android camera bridge capture run is invalid',
  );
  assert.equal(
    input.binding.deadlineAtEpochMs,
    input.deadlineAtEpochMs,
    'Android camera bridge deadline binding changed',
  );
  const readDeadlineAtEpochMs = input.readDeadlineAtEpochMs ?? input.deadlineAtEpochMs;
  assert(
    Number.isSafeInteger(readDeadlineAtEpochMs) &&
      readDeadlineAtEpochMs > Date.now() &&
      readDeadlineAtEpochMs <= input.deadlineAtEpochMs,
    'Android camera bridge read deadline is outside the instrumentation binding',
  );
  const root = await ownedArtifactRoot(input.artifactRoot);
  const receiptPath = `files/detox-camera/${input.binding.captureRunId}/camera-prompt-observation.private.json`;
  const receiptProbe = await probeDeviceFile(input, 'receipt', receiptPath);
  if (!receiptProbe.exists) {
    const diagnosticPath = `files/detox-camera/${input.binding.captureRunId}/camera-prompt-observation-error.private.json`;
    const diagnosticProbe = await probeDeviceFile(input, 'receipt-failure', diagnosticPath);
    if (!diagnosticProbe.exists)
      throw new Error(
        'Android camera bridge did not publish a terminal receipt or failure diagnostic',
      );
    const diagnosticRead = await pullDeviceFile(
      input,
      'receipt-failure',
      diagnosticPath,
      'receipt',
    );
    const diagnostic = requireReceiptFailureDiagnostic(diagnosticRead.bytes, input.binding);
    throw new Error(
      `Android camera bridge did not publish a terminal receipt (stage=${diagnostic.bridgeStage}, error=${diagnostic.bridgeErrorClass}, failure=${diagnostic.failureCode})`,
    );
  }
  const receiptRead = await pullDeviceFile(input, 'receipt', receiptPath, 'receipt');
  const receipt = parseReceipt(receiptRead.bytes);
  requireAndroidDetoxCameraReceiptIdentity(receipt, input.binding);
  if (receipt.status !== 'observed' || receipt.childResult !== 'completed') {
    return {
      receipt,
      receiptHost: receiptRead.receipt,
      frames: { entry: null, prompt: null, denied: null, manual: null },
      executions: [receiptProbe.execution, receiptRead.execution],
    };
  }
  const qualified = requireAndroidDetoxCameraQualification(receipt);
  const labels = ['entry', 'prompt', 'denied', 'manual'] as const;
  const hostFrames = {} as Record<(typeof labels)[number], AndroidDetoxCameraFrameHostPair>;
  const executions: AndroidDetoxCameraCommandExecution[] = [
    receiptProbe.execution,
    receiptRead.execution,
  ];
  for (const label of labels) {
    const deviceFrame = qualified.frames[label];
    assert(deviceFrame, `Android camera ${label} device frame is missing`);
    const hierarchyPath = requireDeviceRelativePath(
      deviceFrame.hierarchy.path,
      input.binding.captureRunId,
    );
    const screenshotPath = requireDeviceRelativePath(
      deviceFrame.screenshot.path,
      input.binding.captureRunId,
    );
    const hierarchyRead = await pullDeviceFile(
      input,
      `${label}-hierarchy`,
      `files/detox-camera/${input.binding.captureRunId}/${hierarchyPath}`,
      'frame',
    );
    const screenshotRead = await pullDeviceFile(
      input,
      `${label}-screenshot`,
      `files/detox-camera/${input.binding.captureRunId}/${screenshotPath}`,
      'frame',
    );
    executions.push(hierarchyRead.execution, screenshotRead.execution);
    assert.equal(
      hierarchyRead.receipt.sha256,
      deviceFrame.hierarchy.sha256,
      `Android camera ${label} hierarchy hash changed`,
    );
    assert.equal(
      screenshotRead.receipt.sha256,
      deviceFrame.screenshot.sha256,
      `Android camera ${label} screenshot hash changed`,
    );
    assert.equal(
      hierarchyRead.receipt.sizeBytes,
      deviceFrame.hierarchy.sizeBytes,
      `Android camera ${label} hierarchy size changed`,
    );
    assert.equal(
      screenshotRead.receipt.sizeBytes,
      deviceFrame.screenshot.sizeBytes,
      `Android camera ${label} screenshot size changed`,
    );
    hostFrames[label] = hostPair(root, label, hierarchyRead.receipt, screenshotRead.receipt);
  }
  return {
    receipt: qualified,
    receiptHost: receiptRead.receipt,
    frames: hostFrames,
    executions,
  };
}
