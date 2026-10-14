import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { mkdtemp, lstat, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  readOwnedAndroidBoundedFile,
  type AndroidStorageFileKind,
  type AndroidOwnedFileIdentity,
} from './native-android-session-adapter';
import {
  ANDROID_CAMERA_ASSERTION_IDS,
  androidCameraSelectionHash,
} from './native-camera-android-contract';
import {
  requireAndroidCameraTransport,
  type AndroidCameraApiIdentity,
} from './native-camera-android-observation';
import {
  requireAndroidCameraIsolationFixtureBinding,
  requireAndroidCameraProducerOutput,
  type AndroidCameraProducerReceipts,
} from './native-camera-android-producer';
import { requireNativePilotAssertions, type NativePilotSelection } from './native-pilot-contract';
import { nativeCommandDeadline, parseNativeExecutionDeadlines } from './native-runtime-preflight';
import { executeOwnedNativeCommand, type NativeCommandExecution } from './owned-native-command';
import type { ProxyObservation } from './owned-api-proxy';

const RUN_ID = /^[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;

export type AndroidCameraPublicSourceFile = {
  path: string;
  kind: AndroidStorageFileKind;
  bytes: number;
  sha256: string;
  ownerUid: number;
  mode: number;
};

type SourceFile = AndroidCameraPublicSourceFile;

type EntryIdentity = {
  path: string;
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
};

type CreatedDirectory = {
  path: string;
  parent: string;
  name: string;
  identity: EntryIdentity;
  parentIdentity: EntryIdentity;
};

type CreatedFile = {
  root: string;
  absolutePath: string;
  parent: string;
  name: string;
  source: SourceFile;
  identity: EntryIdentity;
  parentIdentity: EntryIdentity;
};

type AndroidCameraStageRecoveryStatus = 'cleaned' | 'failed-recovery-ledger-retained';

/**
 * A camera stage failure is terminal for source-only finalization.  The
 * caller receives the bounded recovery ledger and every path whose ownership
 * could not be atomically removed; those facts must remain attached to the
 * blocked runner receipt.
 */
export class AndroidCameraPublicStageError extends Error {
  constructor(
    readonly recoveryStatus: AndroidCameraStageRecoveryStatus,
    readonly recoveryRecordPath: string | null,
    readonly recoveryFailures: readonly string[],
    readonly retainedPaths: readonly string[],
    detail: string,
    cause?: unknown,
  ) {
    super(detail, cause === undefined ? undefined : { cause });
    this.name = 'AndroidCameraPublicStageError';
  }
}

const PRIVATE_FILE_MAX_BYTES = 32 * 1024 * 1024;

export type AndroidCameraPublicSelectionBinding = {
  arguments: NativePilotSelection['arguments'];
  scenario: NativePilotSelection['scenario'];
  scenarioHash: string;
  requirementHash: string;
  assertionIds: readonly string[];
};

export type AndroidCameraPublicStagedManifest = {
  kind: 'private-owned-android-camera-public-staging-not-public-outcome';
  status: 'validated-source-only';
  platform: 'android';
  engine: 'maestro';
  requestedRunId: string;
  captureRunId: string;
  backendRunId: string;
  assertionIds: readonly string[];
  selectionBinding: AndroidCameraPublicSelectionBinding;
  selectionBindingSha256: string;
  files: readonly SourceFile[];
  publicPromotionEligible: false;
  nativePassingCases: 0;
  publicPassingCases: 0;
};

export type AndroidCameraPublicStageResult = {
  copyManifest: { path: string; sha256: string };
  artifacts: readonly string[];
  assertions: readonly [];
  status: 'validated-source-only';
  assertionIds: readonly string[];
  nativePassingCases: 0;
  publicPassingCases: 0;
  publicPromotionEligible: false;
  selectionBinding: AndroidCameraPublicSelectionBinding;
};

export type AndroidCameraPublicSourceBundle = {
  files: readonly { bytes: Buffer; source: AndroidCameraPublicSourceFile }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(isRecord(value), `${label} is not an object`);
  return value;
}

async function privateRoot(value: string, label: string): Promise<string> {
  const resolved = await realpath(value);
  assert.equal(resolved, path.resolve(value), `${label} is not canonical`);
  const info = await lstat(resolved);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a regular directory`);
  assert.equal(info.uid, process.getuid?.(), `${label} is not owned`);
  assert.equal(info.mode & 0o777, 0o700, `${label} is not private`);
  return resolved;
}

function entryIdentity(
  value: string,
  info: {
    dev: number;
    ino: number;
    uid: number;
    gid: number;
    mode: number;
    nlink: number;
  },
): EntryIdentity {
  return {
    path: path.resolve(value),
    dev: info.dev,
    ino: info.ino,
    uid: info.uid,
    gid: info.gid,
    mode: info.mode & 0o777,
    nlink: info.nlink,
  };
}

function sameEntryIdentity(
  expected: EntryIdentity,
  actual: {
    dev: number;
    ino: number;
    uid: number;
    gid: number;
    mode: number;
    nlink?: number;
  },
  requireSingleLink = false,
): boolean {
  return (
    expected.dev === actual.dev &&
    expected.ino === actual.ino &&
    expected.uid === actual.uid &&
    expected.gid === actual.gid &&
    expected.mode === (actual.mode & 0o777) &&
    (!requireSingleLink || actual.nlink === 1)
  );
}

async function privateDirectoryIdentity(value: string, label: string): Promise<EntryIdentity> {
  const resolved = await privateRoot(value, label);
  return entryIdentity(resolved, await lstat(resolved));
}

/**
 * Node does not expose mkdirat/fchdir on Darwin. Run the short descriptor-
 * anchored mutation in a disposable child so the caller process never changes
 * cwd and never restores through a replaceable pathname. The child opens and
 * checks the parent, anchors its own cwd, performs one direct-child mutation,
 * and exits with the resulting inode identity.
 */
const ANCHORED_OPERATION_SCRIPT = String.raw`
  const fs = require('node:fs');
  const path = require('node:path');
  const input = JSON.parse(process.argv[1]);
  const directoryFlags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;
  const childFileFlags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
  const statValue = (value) => ({
    dev: value.dev,
    ino: value.ino,
    uid: value.uid,
    gid: value.gid,
    mode: value.mode & 0o777,
    nlink: value.nlink,
  });
  const same = (expected, actual, singleLink = false) =>
    expected.dev === actual.dev && expected.ino === actual.ino &&
    expected.uid === actual.uid && expected.gid === actual.gid &&
    expected.mode === (actual.mode & 0o777) && (!singleLink || actual.nlink === 1);
  const fail = (message) => { throw new Error(message); };
  const delay = (ms) => {
    if (!Number.isSafeInteger(ms) || ms <= 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  };
  const abortRequested = () => {
    if (!input.abortMarkerPath) return false;
    let markerFd;
    try {
      markerFd = fs.openSync(input.abortMarkerPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const marker = fs.fstatSync(markerFd);
      return marker.isFile() && marker.uid === process.getuid() && marker.nlink === 1;
    } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw error;
    } finally {
      if (markerFd !== undefined) fs.closeSync(markerFd);
    }
  };
  const rejectAbort = () => {
    if (abortRequested()) fail('Android camera anchored operation cancelled before publication');
  };
  const replacement = input.testReplacement;
  const replacementMatches = (value) =>
    replacement && path.resolve(replacement.current) === path.resolve(value);
  const replacePath = (value) => {
    if (!replacementMatches(value)) return;
    fs.renameSync(value, replacement.moved);
    if (replacement.kind === 'file')
      fs.writeFileSync(value, Buffer.from('foreign camera entry\n'), { flag: 'wx', mode: replacement.replacementMode });
    else
      fs.mkdirSync(value, { mode: replacement.replacementMode, recursive: false });
  };
  const readInput = () => {
    const fd = fs.openSync(input.inputPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.uid !== process.getuid() || before.nlink !== 1 || (before.mode & 0o777) !== 0o600)
        fail('Android camera operation input is not a private regular file');
      if (before.size > input.maxBytes) fail('Android camera operation input exceeds its bound');
      const data = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < data.byteLength) {
        const count = fs.readSync(fd, data, offset, data.byteLength - offset, offset);
        if (count <= 0) fail('Android camera operation input ended before its receipt size');
        offset += count;
      }
      const after = fs.fstatSync(fd);
      if (!same(statValue(before), after, true)) fail('Android camera operation input identity changed');
      return data;
    } finally {
      fs.closeSync(fd);
    }
  };
  let anchorFd;
  try {
    anchorFd = fs.openSync(input.parent, directoryFlags);
    const anchorStat = fs.fstatSync(anchorFd);
    if (!anchorStat.isDirectory() || !same(input.parentIdentity, anchorStat))
      fail('Android camera anchored parent identity changed before mutation');
    // Node on Darwin exposes /dev/fd for descriptor reads, but does not allow
    // directory traversal through that path. Change cwd only in this
    // disposable child (the caller's cwd is untouched); the open descriptor
    // keeps the original directory alive while the child uses '.' as its
    // mutation anchor. Do this before the deterministic delay/replacement hook
    // so a pathname replacement cannot redirect the cwd between validation and
    // the first mutation. Linux and other POSIX hosts can traverse /proc/self/fd.
    let anchorPath;
    if (process.platform === 'darwin') {
      process.chdir(input.parent);
      const cwdIdentity = fs.lstatSync('.');
      if (!cwdIdentity.isDirectory() || !same(input.parentIdentity, cwdIdentity))
        fail('Android camera anchored child cwd identity changed');
      anchorPath = '.';
    } else {
      anchorPath = '/proc/self/fd/' + anchorFd;
    }
    delay(input.delayMs);
    // The parent writes this marker synchronously when its AbortSignal fires.
    // Check it after the deterministic delay and immediately before the one
    // direct-child mutation, so a cancellation cannot turn a delayed control
    // into an apparently successful publication.
    rejectAbort();
    replacePath(input.parent);
    const parentAfter = fs.lstatSync(input.parent);
    if (!parentAfter.isDirectory() || !same(input.parentIdentity, parentAfter))
      fail('Android camera anchored parent identity changed during mutation');
    const childPath = path.join(anchorPath, input.name);
    if (input.operation === 'create-directory') {
      try {
        rejectAbort();
        fs.mkdirSync(childPath, { recursive: false, mode: 0o700 });
        const child = fs.lstatSync(childPath);
        if (!child.isDirectory() || child.isSymbolicLink())
          fail('Android camera created child directory is unsafe');
        process.stdout.write(JSON.stringify({ stat: statValue(child) }));
      } catch (error) {
        // A final lstat followed by rmdir is not an atomic ownership test:
        // even an equal-byte replacement can arrive between those syscalls.
        // Retain the uncertain directory for the caller's recovery ledger.
        throw error;
      }
    } else if (input.operation === 'write-file') {
      const data = readInput();
      let childFd;
      try {
        rejectAbort();
        childFd = fs.openSync(childPath, childFileFlags, 0o600);
        const opened = fs.fstatSync(childFd);
        if (!opened.isFile() || opened.uid !== process.getuid() || opened.nlink !== 1 || (opened.mode & 0o777) !== 0o600)
          fail('Android camera staged child has unsafe ownership or mode');
        let offset = 0;
        rejectAbort();
        while (offset < data.byteLength)
          offset += fs.writeSync(childFd, data, offset, data.byteLength - offset, offset);
        fs.fsyncSync(childFd);
        const child = fs.fstatSync(childFd);
        if (!child.isFile() || child.uid !== process.getuid() || child.nlink !== 1 || (child.mode & 0o777) !== 0o600)
          fail('Android camera staged child has unsafe ownership or mode after fsync');
        const identity = statValue(child);
        fs.closeSync(childFd);
        childFd = undefined;
        const reread = fs.lstatSync(childPath);
        if (!reread.isFile() || !same(identity, reread, true))
          fail('Android camera staged child identity changed during publication');
        process.stdout.write(JSON.stringify({ stat: identity }));
      } catch (error) {
        if (childFd !== undefined) {
          try { fs.closeSync(childFd); } catch { /* retain the first publication failure */ }
          childFd = undefined;
        }
        // Do not conditionally unlink after an identity check. POSIX has no
        // portable compare-and-unlink primitive, so retain the uncertain file
        // for the caller's recovery ledger instead of risking a foreign delete.
        throw error;
      } finally {
        if (childFd !== undefined) fs.closeSync(childFd);
      }
    } else if (input.operation === 'remove-file' || input.operation === 'remove-directory') {
      rejectAbort();
      const current = fs.lstatSync(childPath);
      if (!same(input.childIdentity, current, input.operation === 'remove-file')) {
        process.stdout.write(JSON.stringify({ removed: false, reason: 'identity-mismatch' }));
      } else {
        // The replacement hook is retained for the deterministic control, but
        // no final unlink/rmdir is attempted. A final identity observation
        // followed by a conditional deletion remains vulnerable to a same-byte
        // replacement in the syscall gap. Retention is the only truthful
        // portable result when ownership cannot be proven atomically.
        if (replacementMatches(path.join(input.parent, input.name)) && replacement.when === 'after-remove-identity')
          replacePath(path.join(input.parent, input.name));
        process.stdout.write(JSON.stringify({ removed: false, reason: 'conditional-removal-retained' }));
      }
    } else {
      fail('Android camera anchored operation is unknown');
    }
  } finally {
    if (anchorFd !== undefined) fs.closeSync(anchorFd);
  }
`;

type AnchoredChildInput = {
  operation: 'create-directory' | 'write-file' | 'remove-file' | 'remove-directory';
  parent: string;
  name: string;
  parentIdentity: EntryIdentity;
  childIdentity?: EntryIdentity;
  maxBytes: number;
  abortMarkerPath?: string;
  testReplacement?: {
    current: string;
    moved: string;
    replacementMode: number;
    kind?: 'file' | 'directory';
    when?: 'before-mutation' | 'after-remove-identity';
  };
  delayMs?: number;
};

type AnchoredChildResult = {
  stat?: {
    dev: number;
    ino: number;
    uid: number;
    gid: number;
    mode: number;
    nlink: number;
  };
  removed?: boolean;
  reason?: string;
};

type AnchoredCommandStatus = Pick<
  NativeCommandExecution,
  'execution' | 'cleanup' | 'pid' | 'pgid' | 'childExitCode' | 'childSignal'
>;

export class AndroidCameraAnchoredOperationError extends Error {
  readonly operationRoot: string;
  readonly command: AnchoredCommandStatus;

  constructor(message: string, operationRoot: string, command: AnchoredCommandStatus) {
    super(message);
    this.name = 'AndroidCameraAnchoredOperationError';
    this.operationRoot = operationRoot;
    this.command = command;
  }
}

function commandStatus(value: NativeCommandExecution | undefined): AnchoredCommandStatus {
  return value
    ? {
        execution: value.execution,
        cleanup: value.cleanup,
        pid: value.pid,
        pgid: value.pgid,
        childExitCode: value.childExitCode,
        childSignal: value.childSignal,
      }
    : {
        execution: 'harness-blocked',
        cleanup: 'unknown',
        pid: null,
        pgid: null,
        childExitCode: null,
        childSignal: null,
      };
}

async function runAnchoredOperation(
  input: AnchoredChildInput,
  bytes: Buffer | undefined,
  signal: AbortSignal | undefined,
  deadlineAt: number,
): Promise<AnchoredChildResult> {
  signal?.throwIfAborted();
  // macOS exposes the temporary directory through /var while realpath() uses
  // its /private target. The owned-command helper deliberately requires the
  // artifact root to already be canonical, so create the disposable operation
  // root below the canonical temporary directory before acquisition.
  const canonicalTempRoot = await realpath(tmpdir());
  const operationRoot = await mkdtemp(path.join(canonicalTempRoot, 'mc-camera-anchor-'));
  if (!Number.isFinite(deadlineAt)) {
    throw new AndroidCameraAnchoredOperationError(
      'Android camera anchored operation deadline must be finite',
      operationRoot,
      commandStatus(undefined),
    );
  }
  const inputPath = path.join(operationRoot, 'input.private.bin');
  const resultPath = path.join(operationRoot, 'result.private.json');
  const payload = bytes ?? Buffer.alloc(0);
  const maxBytes = input.maxBytes;
  const abortMarkerPath = path.join(operationRoot, 'abort.private.marker');
  let abortMarker: (() => void) | undefined;
  if (signal) {
    abortMarker = () => {
      try {
        writeFileSync(abortMarkerPath, 'abort\n', { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
          throw error;
      }
    };
    if (signal.aborted) abortMarker();
    else signal.addEventListener('abort', abortMarker, { once: true });
  }
  await writeFile(inputPath, payload, { flag: 'wx', mode: 0o600 });
  const testReplacementValue = process.env.MYCHAMPIONS_CAMERA_TEST_REPLACE_PARENT;
  const testReplacement = testReplacementValue
    ? (JSON.parse(testReplacementValue) as AnchoredChildInput['testReplacement'])
    : undefined;
  // The caller owns one absolute whole-run deadline. Each anchored child gets
  // a fresh step budget that can only shorten that deadline; it must never
  // receive the whole-run remainder as its relative command budget.
  const operationStartedAtMonotonicMs = performance.now();
  const remainingMs = Math.floor(deadlineAt - operationStartedAtMonotonicMs);
  if (remainingMs < 100) {
    throw new AndroidCameraAnchoredOperationError(
      'Android camera anchored operation deadline elapsed before acquisition',
      operationRoot,
      commandStatus(undefined),
    );
  }
  const deadlines = parseNativeExecutionDeadlines(process.env);
  const commandDeadlineMs = nativeCommandDeadline(
    Math.min(remainingMs, deadlines.stepMs),
    'step',
    deadlines,
  );
  const commandDeadlineAtMonotonicMs = Math.min(
    deadlineAt,
    operationStartedAtMonotonicMs + commandDeadlineMs,
  );
  const commandInput = JSON.stringify({
    ...input,
    inputPath,
    abortMarkerPath,
    maxBytes,
    testReplacement,
    delayMs: Number(process.env.MYCHAMPIONS_CAMERA_TEST_CHILD_DELAY_MS ?? 0),
  });
  let execution: NativeCommandExecution | undefined;
  try {
    execution = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', ANCHORED_OPERATION_SCRIPT, commandInput],
      artifactRoot: operationRoot,
      label: 'android-camera-anchor',
      env: {
        PATH: process.env.PATH ?? '',
        NODE_PATH: process.env.NODE_PATH ?? '',
        NODE_ENV: process.env.NODE_ENV ?? 'test',
      },
      stdoutPath: resultPath,
      deadlineMs: commandDeadlineMs,
      deadlineAtMonotonicMs: commandDeadlineAtMonotonicMs,
      phase: 'step',
      signal,
    });
    const status = commandStatus(execution);
    if (execution.execution !== 'completed' || execution.cleanup !== 'cleaned')
      throw new AndroidCameraAnchoredOperationError(
        `Android camera anchored operation ${execution.execution}; cleanup ${execution.cleanup}`,
        operationRoot,
        status,
      );
    const receipt = await readOwnedAndroidBoundedFile({
      artifactRoot: operationRoot,
      filePath: resultPath,
      label: 'Android camera anchored operation receipt',
      maxBytes: 64 * 1024,
      signal,
    });
    const result = JSON.parse(receipt.bytes.toString('utf8')) as AnchoredChildResult;
    await rm(operationRoot, { recursive: true, force: true });
    return result;
  } catch (error) {
    const wrapped =
      error instanceof AndroidCameraAnchoredOperationError
        ? error
        : new AndroidCameraAnchoredOperationError(
            error instanceof Error ? error.message : 'Android camera anchored operation failed',
            operationRoot,
            commandStatus(execution),
          );
    // A completed child-failed operation has no live process and its private
    // command ledger is not needed after the failure. Cancellation, deadline,
    // output failure, or unknown cleanup retain the operation root for truthful
    // recovery inspection by the caller.
    if (wrapped.command.execution === 'child-failed' && wrapped.command.cleanup === 'cleaned')
      await rm(operationRoot, { recursive: true, force: true }).catch(() => undefined);
    throw wrapped;
  } finally {
    if (signal && abortMarker) signal.removeEventListener('abort', abortMarker);
  }
}

function assertChildIdentity(
  value: AnchoredChildResult['stat'],
  label: string,
): asserts value is NonNullable<AnchoredChildResult['stat']> {
  assert(value, `${label} identity is missing`);
  assert(Number.isSafeInteger(value.dev), `${label} device identity is invalid`);
  assert(Number.isSafeInteger(value.ino), `${label} inode identity is invalid`);
  assert(Number.isSafeInteger(value.uid), `${label} owner identity is invalid`);
  assert(Number.isSafeInteger(value.gid), `${label} group identity is invalid`);
  assert(Number.isSafeInteger(value.mode), `${label} mode identity is invalid`);
  assert(Number.isSafeInteger(value.nlink), `${label} link identity is invalid`);
}

async function createAnchoredPrivateDirectory(
  parent: string,
  name: string,
  parentIdentity: EntryIdentity,
  signal: AbortSignal | undefined,
  deadlineAt: number,
): Promise<EntryIdentity> {
  assert(name.length > 0 && name !== '.' && name !== '..' && !name.includes('/'));
  const resolvedParent = path.resolve(parent);
  assert.equal(parentIdentity.path, resolvedParent, 'Android camera parent identity path changed');
  const result = await runAnchoredOperation(
    {
      operation: 'create-directory',
      parent: resolvedParent,
      name,
      parentIdentity,
      maxBytes: 64 * 1024,
    },
    undefined,
    signal,
    deadlineAt,
  );
  assertChildIdentity(result.stat, 'Android camera created directory');
  return entryIdentity(path.join(parent, name), result.stat);
}

export type AndroidCameraAnchoredPrivateFile = {
  absolutePath: string;
  parent: string;
  name: string;
  identity: EntryIdentity;
  parentIdentity: EntryIdentity;
};

/** Write one already-parented private artifact through a child-owned inode. */
export async function writeAndroidCameraAnchoredFile(options: {
  root: string;
  relativePath: string;
  bytes: Buffer;
  signal?: AbortSignal;
  deadlineAt?: number;
}): Promise<AndroidCameraAnchoredPrivateFile> {
  const relativePath = relative(options.relativePath, 'Android camera staged path');
  assert(options.bytes.byteLength <= PRIVATE_FILE_MAX_BYTES);
  options.signal?.throwIfAborted();
  const absolutePath = path.resolve(options.root, relativePath);
  assert(absolutePath.startsWith(`${path.resolve(options.root)}${path.sep}`));
  const parent = path.dirname(absolutePath);
  const name = path.basename(absolutePath);
  const parentIdentity = await privateDirectoryIdentity(parent, 'Android camera write parent');
  const result = await runAnchoredOperation(
    {
      operation: 'write-file',
      parent,
      name,
      parentIdentity,
      maxBytes: PRIVATE_FILE_MAX_BYTES,
    },
    options.bytes,
    options.signal,
    options.deadlineAt ?? performance.now() + 30_000,
  );
  assertChildIdentity(result.stat, 'Android camera anchored file');
  return {
    absolutePath,
    parent,
    name,
    identity: entryIdentity(absolutePath, result.stat),
    parentIdentity,
  };
}

async function ensurePrivateDirectory(
  value: string,
  label: string,
  createdDirectories: CreatedDirectory[],
  signal?: AbortSignal,
  deadlineAt = performance.now() + 30_000,
): Promise<boolean> {
  try {
    await privateRoot(value, label);
    return false;
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  const resolved = path.resolve(value);
  const parent = path.dirname(resolved);
  const name = path.basename(resolved);
  const parentIdentity = await privateDirectoryIdentity(parent, `${label} parent`);
  const createdIdentity = await createAnchoredPrivateDirectory(
    parent,
    name,
    parentIdentity,
    signal,
    deadlineAt,
  );
  const created: CreatedDirectory = {
    path: resolved,
    parent,
    name,
    identity: createdIdentity,
    parentIdentity,
  };
  // Register the child before the post-publication observation. If that
  // observation loses a race or a late abort arrives, the outer recovery
  // ledger still knows the exact inode that was created.
  createdDirectories.push(created);
  const identity = await privateDirectoryIdentity(resolved, label);
  assert(
    sameEntryIdentity(createdIdentity, identity),
    `${label} identity changed during publication`,
  );
  created.identity = identity;
  return true;
}

async function removeAnchoredPrivateFile(
  parent: string,
  name: string,
  parentIdentity: EntryIdentity,
  fileIdentity: EntryIdentity,
  signal?: AbortSignal,
  deadlineAt = performance.now() + 30_000,
): Promise<boolean> {
  const resolvedParent = path.resolve(parent);
  if (parentIdentity.path !== resolvedParent) return false;
  try {
    const result = await runAnchoredOperation(
      {
        operation: 'remove-file',
        parent: resolvedParent,
        name,
        parentIdentity,
        childIdentity: fileIdentity,
        maxBytes: 64 * 1024,
      },
      undefined,
      signal,
      deadlineAt,
    );
    return result.removed === true;
  } catch {
    return false;
  }
}

export async function removeAndroidCameraAnchoredFile(options: {
  parent: string;
  name: string;
  parentIdentity: EntryIdentity;
  identity: EntryIdentity;
  signal?: AbortSignal;
  deadlineAt?: number;
}): Promise<boolean> {
  return removeAnchoredPrivateFile(
    options.parent,
    options.name,
    options.parentIdentity,
    options.identity,
    options.signal,
    options.deadlineAt,
  );
}

async function removeAnchoredPrivateDirectory(
  parent: string,
  name: string,
  parentIdentity: EntryIdentity,
  directoryIdentity: EntryIdentity,
  signal?: AbortSignal,
  deadlineAt = performance.now() + 30_000,
): Promise<boolean> {
  const resolvedParent = path.resolve(parent);
  if (parentIdentity.path !== resolvedParent) return false;
  try {
    const result = await runAnchoredOperation(
      {
        operation: 'remove-directory',
        parent: resolvedParent,
        name,
        parentIdentity,
        childIdentity: directoryIdentity,
        maxBytes: 64 * 1024,
      },
      undefined,
      signal,
      deadlineAt,
    );
    return result.removed === true;
  } catch {
    return false;
  }
}

export async function removeAndroidCameraAnchoredDirectory(options: {
  parent: string;
  name: string;
  parentIdentity: EntryIdentity;
  identity: EntryIdentity;
  signal?: AbortSignal;
  deadlineAt?: number;
}): Promise<boolean> {
  return removeAnchoredPrivateDirectory(
    options.parent,
    options.name,
    options.parentIdentity,
    options.identity,
    options.signal,
    options.deadlineAt,
  );
}

function relative(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is empty`);
  assert(!path.isAbsolute(value), `${label} is absolute`);
  assert(!value.includes('\\'), `${label} contains a backslash`);
  assert(!value.split('/').includes('..'), `${label} escapes the artifact root`);
  assert(!value.includes('\0'), `${label} contains NUL`);
  return value;
}

function outputRelativePath(outputRoot: string, absolutePath: string, label: string): string {
  const resolvedRoot = path.resolve(outputRoot);
  const resolvedPath = path.resolve(absolutePath);
  assert(resolvedPath.startsWith(`${resolvedRoot}${path.sep}`), `${label} escaped the output root`);
  return relative(path.relative(resolvedRoot, resolvedPath), label);
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function selectionBinding(selection: NativePilotSelection): AndroidCameraPublicSelectionBinding {
  const rows = requireNativePilotAssertions(selection);
  assert.deepEqual(
    rows.map((row) => row.id),
    [...ANDROID_CAMERA_ASSERTION_IDS],
  );
  assert.equal(selection.arguments.platform, 'android');
  assert.equal(selection.arguments.engine, 'maestro');
  assert.equal(selection.arguments.scenario, 'SCN-camera-denied-android');
  assert.equal(selection.arguments.mode, 'integration');
  assert.match(selection.scenarioHash, HASH);
  assert.match(selection.requirementHash, HASH);
  return {
    arguments: structuredClone(selection.arguments),
    scenario: structuredClone(selection.scenario),
    scenarioHash: selection.scenarioHash,
    requirementHash: selection.requirementHash,
    assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
  };
}

function bindingHash(binding: AndroidCameraPublicSelectionBinding): string {
  return digest(Buffer.from(JSON.stringify(binding), 'utf8'));
}

function emptyArray(value: unknown, label: string): void {
  assert(Array.isArray(value), `${label} is not an array`);
  assert.equal(value.length, 0, `${label} contains an unresolved item`);
}

/** Require the actual verifyOwnedAndroidCleanup receipt, not a reduced status projection. */
export function requireAndroidCameraCleanupProof(
  value: unknown,
  captureRunId: string,
): Record<string, unknown> {
  const cleanup = record(value, 'Android camera independent cleanup proof');
  assert.equal(cleanup.kind, 'independent android native cleanup proof');
  assert.equal(cleanup.result, 'passed');
  assert.equal(cleanup.runId, captureRunId);
  assert.equal(cleanup.captureResult, 'observed');
  assert.equal(cleanup.captureCleanupClean, true);
  assert(Array.isArray(cleanup.acquisitions), 'Android cleanup acquisition list is missing');
  const acquisitionResources = ['adb', 'emulator', 'backend', 'proxy', 'expo'];
  assert(
    cleanup.acquisitions.every(
      (item) => typeof item === 'string' && acquisitionResources.includes(item),
    ),
    'Android cleanup acquisition list contains an unknown resource',
  );
  const acquisitionPrefix = acquisitionResources.slice(0, cleanup.acquisitions.length);
  assert.deepEqual(
    cleanup.acquisitions,
    acquisitionPrefix,
    'Android cleanup acquisition list is not the ordered owner prefix',
  );
  assert(Number.isSafeInteger(cleanup.pidStartPairs) && (cleanup.pidStartPairs as number) >= 0);
  emptyArray(cleanup.survivors, 'Android cleanup process survivors');
  emptyArray(cleanup.unknownProcessQueries, 'Android cleanup unknown process queries');
  emptyArray(cleanup.missingForeignDevices, 'Android cleanup missing foreign devices');
  emptyArray(cleanup.addedForeignDevices, 'Android cleanup added foreign devices');
  const recordedForeign = record(
    cleanup.recordedForeignDeviceChanges,
    'Android cleanup recorded foreign-device census',
  );
  emptyArray(recordedForeign.missingOrChanged, 'Android cleanup recorded missing devices');
  emptyArray(recordedForeign.added, 'Android cleanup recorded added devices');
  assert.equal(cleanup.ownedDeviceAbsent, true);
  assert(cleanup.cacheAbsent === true || cleanup.cacheAbsent === null);
  assert.equal(cleanup.defaultAdbPreserved, true);
  assert.equal(cleanup.foreignAvdsPreserved, true);
  emptyArray(cleanup.unavailablePorts, 'Android cleanup unavailable ports');
  assert.equal(cleanup.nativePassingCases, 0);
  if (cleanup.docker === null) {
    // An unacquired backend is represented by null and cannot claim Docker rows.
  } else {
    const docker = record(cleanup.docker, 'Android cleanup Docker census');
    for (const kind of ['container', 'network', 'volume'])
      emptyArray(docker[kind], `Android cleanup Docker ${kind}`);
  }
  assert.equal(cleanup.censusStatus, 'available');
  assert.equal(cleanup.originalCaptureCleanup, 'cleaned');
  emptyArray(cleanup.originalCaptureCleanupFailures, 'Android original cleanup failures');
  assert(Number.isSafeInteger(cleanup.deletedOwnedDirectories));
  assert(typeof cleanup.scope === 'string' && cleanup.scope.length > 0);
  assert(typeof cleanup.finishedAt === 'string' && !Number.isNaN(Date.parse(cleanup.finishedAt)));
  return cleanup;
}

async function requireAndroidCameraTransportReceipt(options: {
  artifactRoot: string;
  bytes: Buffer;
  producer: AndroidCameraProducerReceipts;
}): Promise<void> {
  let observations: ProxyObservation[];
  try {
    const value: unknown = JSON.parse(options.bytes.toString('utf8'));
    assert(Array.isArray(value), 'Android camera transport receipt is not an array');
    observations = value as ProxyObservation[];
  } catch (error) {
    throw new Error('Android camera transport receipt is invalid JSON', {
      cause: error,
    });
  }
  const window = options.producer.transportRequestWindow;
  assert(window, 'Android camera transport request window is missing');
  const identity: AndroidCameraApiIdentity = {
    runId: options.producer.identity.backendRunId,
    attemptId: options.producer.identity.backendAttemptId,
    apiOrigin: options.producer.identity.apiOrigin,
    apiPid: options.producer.identity.apiPid,
    apiStarted: options.producer.identity.apiStarted,
    apiScript: options.producer.identity.apiScript,
    backendAttemptId: options.producer.identity.backendAttemptId,
  };
  const result = await requireAndroidCameraTransport({
    artifactRoot: options.artifactRoot,
    observations,
    beforeRequestId: window.beforeRequestId,
    throughRequestId: window.throughRequestId,
    allowedRoutes: ['/connections', '/connections/invite-submissions', '/analytics/events'],
    targetOrigin: options.producer.identity.apiOrigin,
    identity,
    request: options.producer.submission,
  });
  assert.equal(result.requestId, options.producer.submissionRequestId);
  assert.equal(window.requestId, options.producer.submissionRequestId);
}

function sourceKind(
  relativePath: string,
  declared?: AndroidStorageFileKind,
): AndroidStorageFileKind {
  if (declared) return declared;
  if (relativePath === 'transport-observations.private.json') return 'transport';
  if (relativePath.endsWith('.png') || relativePath.endsWith('.stdout')) return 'frame';
  return 'sidecar';
}

function maxBytes(kind: AndroidStorageFileKind): number {
  return kind === 'frame'
    ? 16 * 1024 * 1024
    : kind === 'transport' || kind === 'auth'
      ? 1 * 1024 * 1024
      : kind === 'query'
        ? 256 * 1024
        : 32 * 1024 * 1024;
}

function addPath(
  paths: Map<
    string,
    {
      kind?: AndroidStorageFileKind;
      sha256?: string;
      bytes?: number;
      ownerUid?: number;
      mode?: number;
    }
  >,
  value: unknown,
  label: string,
  declared?: Partial<SourceFile>,
): void {
  const relativePath = relative(value, label);
  const existing = paths.get(relativePath);
  const current = {
    kind: declared?.kind,
    sha256: declared?.sha256,
    bytes: declared?.bytes,
    ownerUid: declared?.ownerUid,
    mode: declared?.mode,
  };
  if (!existing) {
    paths.set(relativePath, current);
    return;
  }
  for (const key of ['kind', 'sha256', 'bytes', 'ownerUid', 'mode'] as const)
    if (existing[key] !== undefined && current[key] !== undefined)
      assert.equal(
        existing[key],
        current[key],
        `Conflicting Android camera source receipt for ${relativePath}`,
      );
  paths.set(relativePath, {
    kind: existing.kind ?? current.kind,
    sha256: existing.sha256 ?? current.sha256,
    bytes: existing.bytes ?? current.bytes,
    ownerUid: existing.ownerUid ?? current.ownerUid,
    mode: existing.mode ?? current.mode,
  });
}

async function requireCaptureReport(
  report: Record<string, unknown>,
  options: {
    artifactRoot: string;
    requestedRunId: string;
    captureRunId: string;
    producer: AndroidCameraProducerReceipts;
    selection: NativePilotSelection;
    signal?: AbortSignal;
  },
): Promise<void> {
  assert.equal(report.kind, 'private-owned-native-camera-denied-execution-not-public-receipt');
  assert.equal(report.platform, 'android');
  assert.equal(report.charter, 'camera-denied');
  assert.equal(report.mode, 'integration');
  assert.equal(report.captureRunId, options.captureRunId);
  assert.equal(report.result, 'observed');
  assert.equal(report.cleanup, 'cleaned');
  assert.equal(report.nativePassingCases, 0);
  assert.equal(report.androidCameraCallbackInvocations, 1);
  assert.equal(report.androidCameraCallbackCompleted, true);
  const cleanupLink = record(report.androidCameraIndependentCleanup, 'Android camera cleanup link');
  assert.equal(cleanupLink.captureRunId, options.captureRunId);
  assert.equal(cleanupLink.result, 'passed');
  assert.equal(cleanupLink.censusStatus, 'available');
  const producer = record(report.androidCameraProducer, 'Android camera producer report');
  assert.equal(producer.producerStatus, 'receipts-bound');
  assert.equal(producer.captureRunId, options.captureRunId);
  assert.equal(producer.sourceSelectionHash, androidCameraSelectionHash(options.selection));
  assert.equal(producer.localeStatus, 'qualified');
  assert.deepEqual(
    producer.primaryFixtureAuthUids,
    options.producer.primaryFixtureAuthUids,
    'Android persisted primary fixture identities differ from the producer binding',
  );
  assert.deepEqual(
    producer.primaryExpected,
    options.producer.primaryExpected,
    'Android persisted primary expected identity differs from the producer binding',
  );
  assert.deepEqual(
    producer.frames && (producer.frames as unknown[]).map((row) => record(row, 'frame').label),
    ['entry', 'prompt', 'denied', 'manual', 'pending'],
  );
  requireAndroidCameraProducerOutput(options.producer, {
    selectionHash: androidCameraSelectionHash(options.selection),
    runId: options.captureRunId,
  });
  assert.equal(options.producer.identity.captureRunId, options.captureRunId);
  assert.equal(
    options.producer.identity.backendRunId,
    record(report.backend, 'Android backend').runId,
  );
  assert.equal(
    options.producer.identity.backendAttemptId,
    record(report.backend, 'Android backend').backendAttemptId,
  );
  assert.equal(
    options.producer.identity.backendAttemptId,
    `${options.producer.identity.backendRunId}:first`,
  );
  assert.equal(options.producer.identity.ownerRunId, record(report.device, 'Android device').runId);
  assert.equal(options.producer.sqlReceipts.length > 0, true);
  const isolationEvidence = record(
    report.connectionIsolationFixtureEvidence,
    'Android camera isolation fixture evidence',
  );
  assert.deepEqual(isolationEvidence, options.producer.isolationFixture);
  const persistedIsolationFixture = record(
    producer.isolationFixture,
    'persisted isolation fixture',
  );
  assert.deepEqual(persistedIsolationFixture, options.producer.isolationFixture);
  assert.deepEqual(
    record(producer.isolationExpected, 'persisted isolation expected identity'),
    options.producer.isolationExpected,
  );
  await requireAndroidCameraIsolationFixtureBinding(options.producer.isolationFixture, {
    artifactRoot: options.artifactRoot,
    backendRunId: options.producer.identity.backendRunId,
    primaryFixtureAuthUids: options.producer.primaryFixtureAuthUids,
    isolationExpected: options.producer.isolationExpected,
    signal: options.signal,
  });
}

async function readSource(
  root: string,
  relativePath: string,
  kind: AndroidStorageFileKind,
  signal?: AbortSignal,
): Promise<{
  bytes: Buffer;
  source: SourceFile;
  identity: AndroidOwnedFileIdentity;
}> {
  const loaded = await readOwnedAndroidBoundedFile({
    artifactRoot: root,
    filePath: path.join(root, relativePath),
    label: `Android ${kind} source`,
    maxBytes: maxBytes(kind),
    signal,
  });
  assert.equal(loaded.identity.mode & 0o777, 0o600, `${relativePath} is not private`);
  return {
    bytes: loaded.bytes,
    identity: loaded.identity,
    source: {
      path: relativePath,
      kind,
      bytes: loaded.bytes.byteLength,
      sha256: digest(loaded.bytes),
      ownerUid: loaded.identity.uid,
      mode: loaded.identity.mode & 0o777,
    },
  };
}

async function writeStagedSource(options: {
  stageRoot: string;
  relativePath: string;
  loaded: { bytes: Buffer; source: SourceFile };
  signal?: AbortSignal;
  deadlineAt: number;
  createdDirectories: CreatedDirectory[];
  createdFiles: CreatedFile[];
  onStagedFileWritten?: (relativePath: string) => void;
}): Promise<void> {
  const parent = path.dirname(options.relativePath);
  if (parent !== '.') {
    let current = options.stageRoot;
    for (const segment of parent.split('/')) {
      current = path.join(current, segment);
      await ensurePrivateDirectory(
        current,
        `Android staged parent ${current}`,
        options.createdDirectories,
        options.signal,
        options.deadlineAt,
      );
    }
  }
  options.signal?.throwIfAborted();
  const destination = path.resolve(options.stageRoot, options.relativePath);
  assert(destination.startsWith(`${path.resolve(options.stageRoot)}${path.sep}`));
  assert(options.loaded.bytes.byteLength <= PRIVATE_FILE_MAX_BYTES);
  const parentPath = path.dirname(destination);
  const name = path.basename(destination);
  const opened = await writeAndroidCameraAnchoredFile({
    root: options.stageRoot,
    relativePath: options.relativePath,
    bytes: options.loaded.bytes,
    signal: options.signal,
    deadlineAt: options.deadlineAt,
  });
  const tracked: CreatedFile = {
    root: options.stageRoot,
    absolutePath: destination,
    parent: parentPath,
    name,
    source: { ...options.loaded.source, path: options.relativePath },
    identity: opened.identity,
    parentIdentity: opened.parentIdentity,
  };
  // The child has published an owned inode. Register it before any signal,
  // lstat, reread, or caller callback can fail so finalization cannot lose a
  // partial stage from the recovery ledger.
  options.createdFiles.push(tracked);
  options.onStagedFileWritten?.(options.relativePath);
  options.signal?.throwIfAborted();
  const final = await lstat(destination);
  assert(
    final.isFile() &&
      final.uid === process.getuid?.() &&
      final.nlink === 1 &&
      (final.mode & 0o777) === 0o600 &&
      sameEntryIdentity(opened.identity, final, true),
    `${options.relativePath} staged file identity changed`,
  );
  const reread = await readSource(
    options.stageRoot,
    options.relativePath,
    options.loaded.source.kind,
    options.signal,
  );
  assert.deepEqual(
    reread.source,
    {
      ...options.loaded.source,
      path: options.relativePath,
    },
    `${options.relativePath} staged bytes changed`,
  );
  tracked.source = { ...reread.source, path: options.relativePath };
}

async function rollbackStagedEvidence(options: {
  outputRoot: string;
  stageRoot: string;
  createdFiles: CreatedFile[];
  createdDirectories: CreatedDirectory[];
}): Promise<{ failures: string[]; remaining: string[] }> {
  const failures: string[] = [];
  const remaining: string[] = [];
  const recoveryController = new AbortController();
  const recoveryDeadlineAt = performance.now() + 5_000;
  const recoveryTimer = setTimeout(() => {
    recoveryController.abort(new Error('Android camera recovery deadline elapsed'));
  }, 5_000);
  try {
    for (const created of [...options.createdFiles].reverse()) {
      let relativePath = 'android-camera-recovery-file';
      try {
        relativePath = outputRelativePath(
          options.outputRoot,
          created.absolutePath,
          'Android camera retained file',
        );
        const observed = await readSource(
          created.root,
          relative(path.relative(created.root, created.absolutePath), 'Android camera source file'),
          created.source.kind,
          recoveryController.signal,
        );
        if (
          observed.source.sha256 === created.source.sha256 &&
          observed.source.bytes === created.source.bytes &&
          observed.source.ownerUid === created.source.ownerUid &&
          observed.source.mode === created.source.mode &&
          sameEntryIdentity(created.identity, observed.identity, true)
        ) {
          const removed = await removeAnchoredPrivateFile(
            created.parent,
            created.name,
            created.parentIdentity,
            created.identity,
            recoveryController.signal,
            recoveryDeadlineAt,
          );
          if (!removed) {
            failures.push(`${relativePath}:ownership-retained`);
            remaining.push(relativePath);
          }
        } else {
          failures.push(`${relativePath}:identity-changed`);
          remaining.push(relativePath);
        }
      } catch (error) {
        failures.push(`${relativePath}:${error instanceof Error ? error.name : 'rollback-error'}`);
        remaining.push(relativePath);
      }
    }
    for (const directory of [...options.createdDirectories].reverse()) {
      let relativePath = 'android-camera-recovery-directory';
      try {
        relativePath = outputRelativePath(
          options.outputRoot,
          directory.path,
          'Android camera retained directory',
        );
        const removed = await removeAnchoredPrivateDirectory(
          directory.parent,
          directory.name,
          directory.parentIdentity,
          directory.identity,
          recoveryController.signal,
          recoveryDeadlineAt,
        );
        if (!removed) {
          failures.push(`${relativePath}:ownership-retained`);
          remaining.push(relativePath);
        }
      } catch (error) {
        failures.push(`${relativePath}:${error instanceof Error ? error.name : 'rollback-error'}`);
        remaining.push(relativePath);
      }
    }
    return { failures, remaining };
  } finally {
    clearTimeout(recoveryTimer);
  }
}

function safeStageErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : 'validation-error';
  return message
    .replace(/\/(?:Users|private|tmp|var|home|root)\b[^\s'"`]*/gu, '<private-path>')
    .slice(0, 240);
}

async function writeStageRecoveryLedger(options: {
  outputRoot: string;
  requestedRunId: string;
  captureRunId: string;
  recoveryFailures: readonly string[];
  remaining: readonly string[];
}): Promise<string | null> {
  const relativePath = 'android-camera-staging-recovery.private.json';
  const bytes = Buffer.from(
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'private android camera staging recovery, not public receipt',
        requestedRunId: options.requestedRunId,
        captureRunId: options.captureRunId,
        status: 'blocked-recovery',
        recoveryFailures: [...options.recoveryFailures].slice(0, 64),
        remaining: [...options.remaining].slice(0, 64),
        nativePassingCases: 0,
        publicPromotionEligible: false,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  assert(bytes.byteLength <= 128 * 1024, 'Android camera recovery ledger is too large');
  const recoveryController = new AbortController();
  const recoveryDeadlineAt = performance.now() + 5_000;
  const recoveryTimer = setTimeout(() => {
    recoveryController.abort(new Error('Android camera recovery ledger deadline elapsed'));
  }, 5_000);
  try {
    const opened = await writeAndroidCameraAnchoredFile({
      root: options.outputRoot,
      relativePath,
      bytes,
      signal: recoveryController.signal,
      deadlineAt: recoveryDeadlineAt,
    });
    const reread = await readSource(
      options.outputRoot,
      relativePath,
      'sidecar',
      recoveryController.signal,
    );
    assert.equal(reread.source.sha256, digest(bytes));
    assert.equal(reread.source.bytes, bytes.byteLength);
    assert(sameEntryIdentity(opened.identity, reread.identity, true));
    return relativePath;
  } catch {
    return null;
  } finally {
    clearTimeout(recoveryTimer);
  }
}

/**
 * Re-read and validate the complete producer/staging graph.  This is shared
 * by staging and terminal finalization so the finalizer never treats the
 * caller-provided manifest as the source of truth for which artifacts exist.
 */
export async function readAndroidCameraPublicSourceBundle(options: {
  captureRoot: string;
  requestedRunId: string;
  captureRunId: string;
  fixtureRunId: string;
  selection: NativePilotSelection;
  producer: AndroidCameraProducerReceipts;
  signal?: AbortSignal;
}): Promise<AndroidCameraPublicSourceBundle> {
  options.signal?.throwIfAborted();
  const captureRoot = await privateRoot(options.captureRoot, 'Android camera capture root');
  assert.match(options.requestedRunId, RUN_ID);
  assert.match(options.captureRunId, RUN_ID);
  assert.equal(path.basename(captureRoot), options.captureRunId);
  assert.equal(options.fixtureRunId, options.producer.identity.backendRunId);

  const reportFile = await readSource(
    captureRoot,
    'capture.private.json',
    'sidecar',
    options.signal,
  );
  const report = record(JSON.parse(reportFile.bytes.toString('utf8')), 'Android camera capture');
  await requireCaptureReport(report, {
    ...options,
    artifactRoot: captureRoot,
  });
  const receiptFile = await readSource(
    captureRoot,
    'capture-receipt.private.json',
    'sidecar',
    options.signal,
  );
  const receiptEnvelope = record(JSON.parse(receiptFile.bytes.toString('utf8')), 'capture receipt');
  assert.equal(receiptEnvelope.kind, 'private-owned-android-capture-receipt');
  assert.equal(receiptEnvelope.captureRunId, options.captureRunId);
  const captureReceipt = record(receiptEnvelope.receipt, 'capture receipt source');
  assert.equal(captureReceipt.path, reportFile.source.path);
  assert.equal(captureReceipt.sizeBytes, reportFile.source.bytes);
  assert.equal(captureReceipt.sha256, reportFile.source.sha256);
  assert.equal(captureReceipt.ownerUid, reportFile.source.ownerUid);
  assert.equal(captureReceipt.mode, reportFile.source.mode);
  const cleanupFile = await readSource(
    captureRoot,
    'camera-independent-cleanup-link.private.json',
    'sidecar',
    options.signal,
  );
  const cleanup = record(JSON.parse(cleanupFile.bytes.toString('utf8')), 'Android camera cleanup');
  assert.equal(cleanup.captureRunId, options.captureRunId);
  assert.equal(cleanup.result, 'passed');
  assert.equal(cleanup.censusStatus, 'available');
  const cleanupReceipt = record(cleanup.cleanupReceipt, 'Android external cleanup receipt');
  assert.equal(cleanupReceipt.path, 'external-cleanup.private.json');
  assert.equal(cleanupReceipt.kind, 'sidecar');
  assert.equal(cleanupReceipt.verification, 'owned-stable-reader-v6');
  const externalCleanupFile = await readSource(
    captureRoot,
    relative(cleanupReceipt.path, 'Android external cleanup path'),
    'sidecar',
    options.signal,
  );
  assert.equal(externalCleanupFile.source.sha256, cleanupReceipt.sha256);
  assert.equal(externalCleanupFile.source.bytes, cleanupReceipt.sizeBytes);
  assert.equal(externalCleanupFile.source.ownerUid, cleanupReceipt.ownerUid);
  assert.equal(externalCleanupFile.source.mode, cleanupReceipt.mode);
  requireAndroidCameraCleanupProof(
    JSON.parse(externalCleanupFile.bytes.toString('utf8')),
    options.captureRunId,
  );
  const cleanupReceiptFile = await readSource(
    captureRoot,
    'external-cleanup-receipt.private.json',
    'sidecar',
    options.signal,
  );
  const cleanupEnvelope = record(
    JSON.parse(cleanupReceiptFile.bytes.toString('utf8')),
    'Android external cleanup receipt envelope',
  );
  assert.equal(cleanupEnvelope.kind, 'private-owned-android-cleanup-receipt');
  assert.equal(cleanupEnvelope.runId, options.captureRunId);
  assert.deepEqual(cleanupEnvelope.receipt, cleanupReceipt);
  const transportFile = await readSource(
    captureRoot,
    'transport-observations.private.json',
    'transport',
    options.signal,
  );
  await requireAndroidCameraTransportReceipt({
    artifactRoot: captureRoot,
    bytes: transportFile.bytes,
    producer: options.producer,
  });

  const paths = new Map<
    string,
    {
      kind?: AndroidStorageFileKind;
      sha256?: string;
      bytes?: number;
      ownerUid?: number;
      mode?: number;
    }
  >();
  for (const required of [
    'capture.private.json',
    'capture-receipt.private.json',
    'camera-independent-cleanup-link.private.json',
    'external-cleanup.private.json',
    'external-cleanup-receipt.private.json',
    'transport-observations.private.json',
  ])
    addPath(paths, required, `Android camera required artifact ${required}`);
  addPath(paths, 'external-cleanup.private.json', 'Android external cleanup proof', {
    kind: 'sidecar',
    sha256: externalCleanupFile.source.sha256,
    bytes: externalCleanupFile.source.bytes,
    ownerUid: externalCleanupFile.source.ownerUid,
    mode: externalCleanupFile.source.mode,
  });
  addPath(paths, 'external-cleanup-receipt.private.json', 'Android external cleanup receipt', {
    kind: 'sidecar',
    sha256: cleanupReceiptFile.source.sha256,
    bytes: cleanupReceiptFile.source.bytes,
    ownerUid: cleanupReceiptFile.source.ownerUid,
    mode: cleanupReceiptFile.source.mode,
  });
  for (const frame of options.producer.frames)
    addPath(paths, frame.path, `Android camera frame ${frame.label}`, {
      kind: 'frame',
      sha256: frame.sha256,
      bytes: frame.sizeBytes,
      mode: 0o600,
    });
  const observations = Array.isArray(report.observations) ? report.observations : [];
  for (const row of observations) {
    const observation = record(row, 'Android camera observation');
    addPath(paths, observation.hierarchyPath, 'Android camera hierarchy path', {
      kind: 'frame',
    });
    addPath(paths, observation.screenshotPath, 'Android camera screenshot path', { kind: 'frame' });
  }
  for (const receipt of options.producer.sqlReceipts)
    addPath(paths, receipt.path, `Android camera SQL ${receipt.phase}`, {
      kind: 'query',
      sha256: receipt.sha256,
      bytes: receipt.sizeBytes,
      ownerUid: receipt.ownerUid,
      mode: receipt.mode,
    });
  // Server cleanup removes the original runtime snapshots, manifest and API
  // ledger. Stage each authenticated sidecar so terminal rereads remain
  // independent of the cleaned server runtime root.
  for (const receipt of options.producer.sqlReceipts) {
    addPath(paths, receipt.parentSnapshotRetainedPath, 'Android retained SQL parent snapshot', {
      kind: 'sidecar',
      sha256: receipt.parentSnapshotRetainedSha256,
      bytes: receipt.parentSnapshotRetainedSizeBytes,
      ownerUid: receipt.parentSnapshotRetainedOwnerUid,
      mode: receipt.parentSnapshotRetainedMode,
    });
    addPath(paths, receipt.parentManifestRetainedPath, 'Android retained SQL parent manifest', {
      kind: 'sidecar',
      sha256: receipt.parentManifestRetainedSha256,
      bytes: receipt.parentManifestRetainedSizeBytes,
      ownerUid: receipt.parentManifestRetainedOwnerUid,
      mode: receipt.parentManifestRetainedMode,
    });
    addPath(paths, receipt.parentApiLedgerRetainedPath, 'Android retained SQL parent API ledger', {
      kind: 'sidecar',
      sha256: receipt.parentApiLedgerRetainedSha256,
      bytes: receipt.parentApiLedgerRetainedSizeBytes,
      ownerUid: receipt.parentApiLedgerRetainedOwnerUid,
      mode: receipt.parentApiLedgerRetainedMode,
    });
  }
  addPath(
    paths,
    options.producer.isolationFixture.path,
    'Android camera isolation fixture evidence',
    {
      kind: 'sidecar',
      sha256: options.producer.isolationFixture.sha256,
      bytes: options.producer.isolationFixture.sizeBytes,
      ownerUid: options.producer.isolationFixture.ownerUid,
      mode: options.producer.isolationFixture.mode,
    },
  );
  addPath(paths, options.producer.manualCodeSource.sourcePath, 'Android manual code hierarchy', {
    kind: 'frame',
    sha256: options.producer.manualCodeSource.sourceSha256,
    bytes: options.producer.manualCodeSource.sourceSizeBytes,
    ownerUid: options.producer.manualCodeSource.sourceOwnerUid,
    mode: options.producer.manualCodeSource.sourceMode,
  });
  addPath(paths, options.producer.submission.sourcePath, 'Android submission request body', {
    kind: 'transport',
    sha256: options.producer.submission.sourceSha256,
  });
  addPath(paths, options.producer.submission.descriptorPath, 'Android submission descriptor', {
    kind: 'sidecar',
  });

  const sourceFiles = new Map<string, { bytes: Buffer; source: SourceFile }>();
  for (const [relativePath, declaration] of paths) {
    options.signal?.throwIfAborted();
    const loaded = await readSource(
      captureRoot,
      relativePath,
      sourceKind(relativePath, declaration.kind),
      options.signal,
    );
    if (declaration.sha256 !== undefined)
      assert.equal(loaded.source.sha256, declaration.sha256, `${relativePath} hash changed`);
    if (declaration.bytes !== undefined)
      assert.equal(loaded.source.bytes, declaration.bytes, `${relativePath} size changed`);
    if (declaration.ownerUid !== undefined)
      assert.equal(loaded.source.ownerUid, declaration.ownerUid, `${relativePath} owner changed`);
    if (declaration.mode !== undefined)
      assert.equal(loaded.source.mode, declaration.mode, `${relativePath} mode changed`);
    if (sourceKind(relativePath, declaration.kind) === 'frame' && relativePath.endsWith('.png')) {
      assert(
        loaded.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        `${relativePath} is not a PNG frame`,
      );
    }
    sourceFiles.set(relativePath, loaded);
  }
  return { files: [...sourceFiles.values()] };
}

/** Copy the real camera producer bundle while keeping native/public promotion separate. */
export async function stageAndroidCameraPublicEvidence(options: {
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  captureRunId: string;
  fixtureRunId: string;
  selection: NativePilotSelection;
  producer: AndroidCameraProducerReceipts;
  signal?: AbortSignal;
  deadlineAt?: number;
  /** Resource-free control fired after an actual staged inode is published. */
  onStagedFileWritten?: (relativePath: string) => void;
}): Promise<AndroidCameraPublicStageResult> {
  options.signal?.throwIfAborted();
  const deadlineAt = options.deadlineAt ?? performance.now() + 30_000;
  assert(
    Number.isFinite(deadlineAt) && deadlineAt > performance.now(),
    'Android camera staging deadline is invalid',
  );
  const captureRoot = await privateRoot(options.captureRoot, 'Android camera capture root');
  const outputRoot = await privateRoot(options.outputRoot, 'Android camera output root');
  assert.match(options.requestedRunId, RUN_ID);
  assert.match(options.captureRunId, RUN_ID);
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  assert.equal(path.basename(captureRoot), options.captureRunId);
  assert.notEqual(captureRoot, outputRoot);
  assert.equal(options.fixtureRunId, options.producer.identity.backendRunId);
  const binding = selectionBinding(options.selection);
  const sourceBundle = await readAndroidCameraPublicSourceBundle(options);
  const sourceFiles = new Map(
    sourceBundle.files.map((loaded) => [loaded.source.path, loaded] as const),
  );

  const prefix = `evidence/${options.captureRunId}`;
  const stageRoot = path.join(outputRoot, prefix);
  const createdDirectories: CreatedDirectory[] = [];
  const createdFiles: CreatedFile[] = [];
  let stageCreated = false;
  try {
    await ensurePrivateDirectory(
      path.join(outputRoot, 'evidence'),
      'Android camera evidence output directory',
      createdDirectories,
      options.signal,
      deadlineAt,
    );
    stageCreated = await ensurePrivateDirectory(
      stageRoot,
      'Android camera staged evidence directory',
      createdDirectories,
      options.signal,
      deadlineAt,
    );
    assert(stageCreated, 'Android camera staged evidence directory already exists');
    for (const [relativePath, loaded] of sourceFiles) {
      await writeStagedSource({
        stageRoot,
        relativePath,
        loaded,
        signal: options.signal,
        deadlineAt,
        createdDirectories,
        createdFiles,
        onStagedFileWritten: options.onStagedFileWritten,
      });
    }
    const staged = createdFiles
      .filter((file) => file.root === stageRoot)
      .map((file) => file.source)
      .sort((left, right) => left.path.localeCompare(right.path));
    const manifest: AndroidCameraPublicStagedManifest = {
      kind: 'private-owned-android-camera-public-staging-not-public-outcome',
      status: 'validated-source-only',
      platform: 'android',
      engine: 'maestro',
      requestedRunId: options.requestedRunId,
      captureRunId: options.captureRunId,
      backendRunId: options.fixtureRunId,
      assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
      selectionBinding: binding,
      selectionBindingSha256: bindingHash(binding),
      files: staged,
      publicPromotionEligible: false,
      nativePassingCases: 0,
      publicPassingCases: 0,
    };
    const manifestPath = `${prefix}/copy-manifest.private.json`;
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    options.signal?.throwIfAborted();
    const manifestAbsolute = path.resolve(outputRoot, manifestPath);
    const manifestParent = path.dirname(manifestAbsolute);
    const manifestName = path.basename(manifestAbsolute);
    const manifestOpened = await writeAndroidCameraAnchoredFile({
      root: outputRoot,
      relativePath: manifestPath,
      bytes: manifestBytes,
      signal: options.signal,
      deadlineAt,
    });
    const manifestTracked: CreatedFile = {
      root: outputRoot,
      absolutePath: manifestAbsolute,
      parent: manifestParent,
      name: manifestName,
      source: {
        path: manifestPath,
        kind: 'sidecar',
        bytes: manifestBytes.byteLength,
        sha256: digest(manifestBytes),
        ownerUid: process.getuid?.() ?? -1,
        mode: 0o600,
      },
      identity: manifestOpened.identity,
      parentIdentity: manifestOpened.parentIdentity,
    };
    createdFiles.push(manifestTracked);
    options.signal?.throwIfAborted();
    const manifestStat = await lstat(manifestAbsolute);
    assert(
      manifestStat.isFile() &&
        manifestStat.uid === process.getuid?.() &&
        manifestStat.nlink === 1 &&
        (manifestStat.mode & 0o777) === 0o600 &&
        sameEntryIdentity(manifestOpened.identity, manifestStat, true),
      'Android camera manifest identity changed during publication',
    );
    const manifestReadback = await readSource(outputRoot, manifestPath, 'sidecar', options.signal);
    assert.equal(manifestReadback.source.sha256, digest(manifestBytes));
    assert.equal(manifestReadback.source.bytes, manifestBytes.byteLength);
    assert(sameEntryIdentity(manifestOpened.identity, manifestReadback.identity, true));
    manifestTracked.source = manifestReadback.source;
    options.signal?.throwIfAborted();
    const manifestSha256 = digest(manifestBytes);
    const assertions = requireNativePilotAssertions(options.selection);
    assert.deepEqual(
      assertions.map((row) => row.id),
      [...ANDROID_CAMERA_ASSERTION_IDS],
    );
    // This result is intentionally never an assertion pass. The copied bundle
    // proves source reread/staging only; an independently produced native gate
    // is required before any caller may emit public assertions.
    return {
      copyManifest: { path: manifestPath, sha256: manifestSha256 },
      artifacts: [manifestPath],
      assertions: [],
      status: 'validated-source-only',
      assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
      nativePassingCases: 0,
      publicPassingCases: 0,
      publicPromotionEligible: false,
      selectionBinding: binding,
    };
  } catch (error) {
    if (stageCreated || createdDirectories.length > 0 || createdFiles.length > 0) {
      const rollback = await rollbackStagedEvidence({
        outputRoot,
        stageRoot,
        createdFiles,
        createdDirectories,
      });
      const recoveryFailures = [...rollback.failures];
      const remaining = [...new Set(rollback.remaining)];
      const recoveryRecordPath = await writeStageRecoveryLedger({
        outputRoot,
        requestedRunId: options.requestedRunId,
        captureRunId: options.captureRunId,
        recoveryFailures,
        remaining,
      });
      const detail =
        recoveryRecordPath === null
          ? `Android camera evidence staging was blocked (${safeStageErrorReason(error)}); owned output recovery could not be verified.`
          : `Android camera evidence staging was blocked (${safeStageErrorReason(error)}); an owned recovery ledger was retained.`;
      throw new AndroidCameraPublicStageError(
        'failed-recovery-ledger-retained',
        recoveryRecordPath,
        recoveryFailures,
        remaining,
        detail,
        error,
      );
    }
    throw new AndroidCameraPublicStageError(
      'cleaned',
      null,
      [],
      [],
      `Android camera evidence staging was blocked (${safeStageErrorReason(error)}); no owned output was published.`,
      error,
    );
  }
}

export function androidCameraPublicStageMustRemainBlocked(value: {
  status: 'validated-source-only' | 'native-qualified';
  publicPromotionEligible: boolean;
  nativePassingCases: number;
}): boolean {
  return (
    value.status === 'validated-source-only' &&
    value.publicPromotionEligible === false &&
    value.nativePassingCases === 0
  );
}
