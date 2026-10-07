import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

/**
 * V6 staging contract for the Android Detox session route.
 *
 * The old V5 implementation inspected a parent by pathname and then called
 * mkdir(outputRoot).  A parent replacement between those syscalls redirected
 * the mkdir into a foreign directory.  All mutating operations below happen
 * relative to a directory descriptor opened with O_NOFOLLOW.  The caller only
 * receives a path after the descriptor operation and the complete identity
 * chain have been checked again.
 */

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MAX_LEDGER_BYTES = 128 * 1024;
const CHILD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;

export type AndroidDetoxSessionDirectoryIdentity = Readonly<{
  path: string;
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
}>;

export type AndroidDetoxSessionStagingLifecycle = Readonly<{
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
  /** Source-only seam used by the real ancestor replacement regression. */
  onBeforeAnchoredCreate?: () => void;
  /** Source-only seam used to fail after the descriptor-bound child exists. */
  onAfterAnchoredCreate?: () => void;
  /** Source-only seam used to force and observe recovery-publication failure. */
  onBeforeRecoveryLedgerWrite?: () => void;
  /** Source-only seam used to prove bounded child reaping on timeout. */
  testWorkerDelayMs?: number;
}>;

export type AndroidDetoxSessionStagingOutput = Readonly<{
  outputRoot: string;
  identity: AndroidDetoxSessionDirectoryIdentity;
}>;

export type AndroidDetoxSessionRecoveryLedger = Readonly<{
  schemaVersion: 1;
  kind: 'private-android-detox-session-staging-recovery-not-public-receipt';
  status: 'blocked-recovery-ledger-retained';
  outputRoot: string;
  parentIdentity: Omit<AndroidDetoxSessionDirectoryIdentity, 'path'> | null;
  retainedPaths: readonly string[];
  recoveryFailures: readonly string[];
  recoveryPublication: 'verified' | 'unknown';
  childLifecycle: AndroidDetoxSessionChildLifecycle | null;
  foreignWriteObserved: false;
  nativePassingCases: 0;
  publicPassingCases: 0;
}>;

export type AndroidDetoxSessionChildLifecycle = Readonly<{
  pid: number | null;
  terminateRequested: boolean;
  killEscalated: boolean;
  closeObserved: boolean;
  closeCode: number | null;
  closeSignal: NodeJS.Signals | null;
  reapStatus: 'reaped' | 'unknown';
  lateCloseObserved: boolean;
}>;

type MutableAndroidDetoxSessionChildLifecycle = {
  -readonly [
    Key in keyof AndroidDetoxSessionChildLifecycle
  ]: AndroidDetoxSessionChildLifecycle[Key];
};

export class AndroidDetoxSessionStagingError extends Error {
  readonly recoveryStatus: 'cleaned' | 'failed-recovery-ledger-retained';

  constructor(
    recoveryStatus: 'cleaned' | 'failed-recovery-ledger-retained',
    readonly recoveryRecordPath: string | null,
    readonly retainedPaths: readonly string[],
    message: string,
    cause?: unknown,
    readonly recoveryPublication: 'verified' | 'unknown' = 'unknown',
    readonly childLifecycle: AndroidDetoxSessionChildLifecycle | null = null,
  ) {
    super(message);
    this.name = 'AndroidDetoxSessionStagingError';
    this.recoveryStatus = recoveryStatus;
    if (cause !== undefined) Object.defineProperty(this, 'cause', { value: cause });
  }
}

type AnchoredOperation =
  | {
      operation: 'create-directory';
      parent: string;
      name: string;
      parentIdentity: StatIdentity;
      testWorkerDelayMs?: number;
    }
  | {
      operation: 'write-file';
      parent: string;
      name: string;
      parentIdentity: StatIdentity;
      contents: string;
      testWorkerDelayMs?: number;
    };

type StatIdentity = Omit<AndroidDetoxSessionDirectoryIdentity, 'path' | 'nlink'> & {
  nlink: number;
};

type AnchoredResult = { stat: StatIdentity };

const CHILD_TERM_GRACE_MS = 250;
const CHILD_KILL_GRACE_MS = 250;

function childLifecycleFromError(value: unknown): AndroidDetoxSessionChildLifecycle | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = (value as { childLifecycle?: unknown }).childLifecycle;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as AndroidDetoxSessionChildLifecycle;
}

function withChildLifecycle(
  error: Error,
  childLifecycle: AndroidDetoxSessionChildLifecycle,
): Error {
  Object.defineProperty(error, 'childLifecycle', {
    configurable: true,
    enumerable: false,
    value: childLifecycle,
  });
  return error;
}

function currentUid(): number {
  return process.getuid?.() ?? -1;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sameIdentity(expected: StatIdentity, actual: StatIdentity): boolean {
  return (
    expected.dev === actual.dev &&
    expected.ino === actual.ino &&
    expected.uid === actual.uid &&
    expected.gid === actual.gid &&
    expected.mode === actual.mode
  );
}

function statIdentity(value: {
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
}): StatIdentity {
  return {
    dev: value.dev,
    ino: value.ino,
    uid: value.uid,
    gid: value.gid,
    mode: value.mode & 0o777,
    nlink: value.nlink,
  };
}

function withPath(pathname: string, value: StatIdentity): AndroidDetoxSessionDirectoryIdentity {
  return { path: path.resolve(pathname), ...value };
}

function fence(lifecycle: AndroidDetoxSessionStagingLifecycle, label: string): void {
  lifecycle.signal.throwIfAborted();
  assert(
    Number.isFinite(lifecycle.deadlineAtMonotonicMs),
    'Android Detox session staging deadline is invalid',
  );
  if (performance.now() >= lifecycle.deadlineAtMonotonicMs)
    throw new Error(`Android Detox session staging deadline expired: ${label}`);
}

async function privateDirectoryIdentity(
  value: string,
  label: string,
): Promise<AndroidDetoxSessionDirectoryIdentity> {
  const resolved = path.resolve(value);
  const canonical = await realpath(resolved);
  assert.equal(canonical, resolved, `${label} is not canonical`);
  const metadata = await lstat(resolved);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink(), `${label} is not a directory`);
  assert.equal(metadata.uid, currentUid(), `${label} is not owned`);
  assert.equal(metadata.mode & 0o777, PRIVATE_DIRECTORY_MODE, `${label} is not mode 0700`);
  return withPath(resolved, statIdentity(metadata));
}

function assertChildName(value: string, label: string): void {
  assert(CHILD_NAME.test(value), `${label} is not a direct private child name`);
}

function childPath(parent: string, name: string): string {
  assertChildName(name, 'Android Detox staging child');
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(resolvedParent, name);
  assert.equal(path.dirname(resolvedChild), resolvedParent, 'Android Detox child escaped parent');
  return resolvedChild;
}

/**
 * This helper is intentionally a descriptor operation rather than a pathname
 * mkdir.  It mirrors the already-qualified current-Q camera staging primitive:
 * open the parent with O_NOFOLLOW, check its inode, and mutate through the
 * retained descriptor.  The disposable child avoids changing the caller cwd
 * on Darwin, where Node does not expose mkdirat/fchdir.
 */
const ANCHORED_OPERATION_SCRIPT = String.raw`
  const fs = require('node:fs');
  const path = require('node:path');
  const input = JSON.parse(process.argv[1]);
  const directoryFlags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;
  const fileFlags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
  const statValue = value => ({
    dev: value.dev,
    ino: value.ino,
    uid: value.uid,
    gid: value.gid,
    mode: value.mode & 0o777,
    nlink: value.nlink,
  });
  const same = (expected, actual) =>
    expected.dev === actual.dev && expected.ino === actual.ino &&
    expected.uid === actual.uid && expected.gid === actual.gid &&
    expected.mode === (actual.mode & 0o777) && expected.nlink === actual.nlink;
  const fail = message => { throw new Error(message); };
  const bytes = input.operation === 'write-file'
    ? Buffer.from(input.contents, 'base64')
    : null;
  if (!input.parent || !path.isAbsolute(input.parent)) fail('Anchored parent is not absolute');
  if (typeof input.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(input.name))
    fail('Anchored child name is invalid');
  if (bytes && bytes.length > 131072) fail('Anchored ledger is too large');
  if (input.testWorkerDelayMs !== undefined) {
    if (!Number.isSafeInteger(input.testWorkerDelayMs) || input.testWorkerDelayMs < 0)
      fail('Anchored test worker delay is invalid');
    if (input.testWorkerDelayMs > 0)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, input.testWorkerDelayMs);
  }
  let parentFd;
  try {
    parentFd = fs.openSync(input.parent, directoryFlags);
    const before = fs.fstatSync(parentFd);
    if (!before.isDirectory() || !same(input.parentIdentity, statValue(before)))
      fail('Anchored parent identity changed before mutation');
    let anchorPath;
    if (process.platform === 'darwin') {
      process.chdir(input.parent);
      const cwd = fs.lstatSync('.');
      if (!cwd.isDirectory() || !same(input.parentIdentity, statValue(cwd)))
        fail('Anchored child cwd identity changed');
      anchorPath = '.';
    } else {
      anchorPath = '/proc/self/fd/' + parentFd;
    }
    if (input.operation === 'create-directory') {
      const target = path.join(anchorPath, input.name);
      fs.mkdirSync(target, { recursive: false, mode: 0o700 });
      const child = fs.lstatSync(target);
      if (!child.isDirectory() || child.isSymbolicLink()) fail('Anchored child directory is unsafe');
      const identity = statValue(child);
      if (identity.mode !== 0o700 || identity.uid !== process.getuid() || identity.nlink < 2)
        fail('Anchored child directory ownership is unsafe');
      process.stdout.write(JSON.stringify({ stat: identity }) + '\n');
    } else {
      const target = path.join(anchorPath, input.name);
      const childFd = fs.openSync(target, fileFlags, 0o600);
      try {
        const child = fs.fstatSync(childFd);
        if (!child.isFile() || child.uid !== process.getuid() || child.nlink !== 1 || (child.mode & 0o777) !== 0o600)
          fail('Anchored ledger file ownership is unsafe');
        let offset = 0;
        while (offset < bytes.length) offset += fs.writeSync(childFd, bytes, offset, bytes.length - offset, offset);
        fs.fsyncSync(childFd);
        const after = fs.fstatSync(childFd);
        if (!after.isFile() || after.uid !== process.getuid() || after.nlink !== 1 || (after.mode & 0o777) !== 0o600)
          fail('Anchored ledger file changed during publication');
        const identity = statValue(after);
        const reread = fs.lstatSync(target);
        if (!reread.isFile() || !same(identity, statValue(reread)))
          fail('Anchored ledger path changed during publication');
        process.stdout.write(JSON.stringify({ stat: identity }) + '\n');
      } finally {
        fs.closeSync(childFd);
      }
    }
  } finally {
    if (parentFd !== undefined) fs.closeSync(parentFd);
  }
`;

async function runAnchoredOperation(
  operation: AnchoredOperation,
  signal: AbortSignal | undefined,
  deadlineAtMonotonicMs: number,
): Promise<AnchoredResult> {
  signal?.throwIfAborted();
  const remaining = Math.floor(deadlineAtMonotonicMs - performance.now());
  if (remaining < 100) throw new Error('Anchored Android Detox staging deadline elapsed');
  const child = spawn(
    process.execPath,
    ['-e', ANCHORED_OPERATION_SCRIPT, JSON.stringify(operation)],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' },
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (value: string) => {
    stdout = `${stdout}${value}`.slice(-256 * 1024);
  });
  child.stderr.on('data', (value: string) => {
    stderr = `${stderr}${value}`.slice(-256 * 1024);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let escalationTimer: ReturnType<typeof setTimeout> | undefined;
  let reapTimer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const childLifecycle: MutableAndroidDetoxSessionChildLifecycle = {
    pid: child.pid ?? null,
    terminateRequested: false,
    killEscalated: false,
    closeObserved: false,
    closeCode: null,
    closeSignal: null,
    reapStatus: 'unknown',
    lateCloseObserved: false,
  };
  const result = await new Promise<AnchoredResult>((resolve, reject) => {
    let settled = false;
    let terminationError: Error | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (escalationTimer) clearTimeout(escalationTimer);
      if (reapTimer) clearTimeout(reapTimer);
      if (abortListener) signal?.removeEventListener('abort', abortListener);
    };
    const finish = (error?: Error, value?: AnchoredResult) => {
      if (settled) {
        if (childLifecycle.closeObserved) childLifecycle.lateCloseObserved = true;
        return;
      }
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value as AnchoredResult);
    };
    const requestTermination = (error: Error) => {
      if (terminationError || childLifecycle.closeObserved) return;
      terminationError = error;
      childLifecycle.terminateRequested = true;
      child.kill('SIGTERM');
      escalationTimer = setTimeout(() => {
        if (childLifecycle.closeObserved) return;
        childLifecycle.killEscalated = true;
        child.kill('SIGKILL');
        reapTimer = setTimeout(() => {
          if (childLifecycle.closeObserved) return;
          childLifecycle.reapStatus = 'unknown';
          finish(
            withChildLifecycle(
              new Error(
                `Anchored Android Detox staging child ${childLifecycle.pid ?? 'unknown'} was not reaped after SIGKILL`,
              ),
              childLifecycle,
            ),
          );
        }, CHILD_KILL_GRACE_MS);
      }, CHILD_TERM_GRACE_MS);
    };
    timer = setTimeout(
      () => {
        requestTermination(new Error('Anchored Android Detox staging operation deadline elapsed'));
      },
      Math.max(1, remaining),
    );
    abortListener = () => {
      requestTermination(
        signal?.reason instanceof Error ? signal.reason : new Error('staging cancelled'),
      );
    };
    signal?.addEventListener('abort', abortListener, { once: true });
    if (signal?.aborted) abortListener();
    child.once('error', (error) => requestTermination(error));
    child.once('close', (code, childSignal) => {
      if (settled) childLifecycle.lateCloseObserved = true;
      childLifecycle.closeObserved = true;
      childLifecycle.closeCode = code;
      childLifecycle.closeSignal = childSignal;
      childLifecycle.reapStatus = 'reaped';
      if (terminationError) return finish(withChildLifecycle(terminationError, childLifecycle));
      if (code !== 0)
        return finish(
          withChildLifecycle(
            new Error(
              `Anchored Android Detox staging operation failed (${code ?? childSignal ?? 'unknown'}): ${stderr.trim().slice(0, 240)}`,
            ),
            childLifecycle,
          ),
        );
      try {
        const line = stdout.trim().split('\n').filter(Boolean).at(-1);
        assert(line, 'Anchored Android Detox staging operation returned no receipt');
        const parsed = JSON.parse(line) as AnchoredResult;
        assert(
          parsed && typeof parsed === 'object' && parsed.stat,
          'Anchored operation receipt is malformed',
        );
        finish(undefined, parsed);
      } catch (error) {
        finish(
          withChildLifecycle(
            error instanceof Error ? error : new Error(String(error)),
            childLifecycle,
          ),
        );
      }
    });
  });
  return result;
}

async function createAnchoredDirectory(
  parent: AndroidDetoxSessionDirectoryIdentity,
  name: string,
  signal: AbortSignal | undefined,
  deadlineAtMonotonicMs: number,
  testWorkerDelayMs?: number,
): Promise<AndroidDetoxSessionDirectoryIdentity> {
  assertChildName(name, 'Android Detox staging directory');
  const result = await runAnchoredOperation(
    {
      operation: 'create-directory',
      parent: parent.path,
      name,
      parentIdentity: parent,
      testWorkerDelayMs,
    },
    signal,
    deadlineAtMonotonicMs,
  );
  const child = result.stat;
  assert.equal(child.uid, currentUid(), 'Android Detox staging child is not owned');
  assert.equal(child.mode, PRIVATE_DIRECTORY_MODE, 'Android Detox staging child is not mode 0700');
  assert(child.nlink >= 2, 'Android Detox staging child has an invalid directory link count');
  return withPath(childPath(parent.path, name), child);
}

async function writeAnchoredFile(
  parent: AndroidDetoxSessionDirectoryIdentity,
  name: string,
  contents: Buffer,
  signal: AbortSignal | undefined,
  deadlineAtMonotonicMs: number,
  testWorkerDelayMs?: number,
): Promise<AndroidDetoxSessionDirectoryIdentity> {
  assertChildName(name, 'Android Detox recovery ledger');
  assert(contents.byteLength <= MAX_LEDGER_BYTES, 'Android Detox recovery ledger is too large');
  const result = await runAnchoredOperation(
    {
      operation: 'write-file',
      parent: parent.path,
      name,
      parentIdentity: parent,
      contents: contents.toString('base64'),
      testWorkerDelayMs,
    },
    signal,
    deadlineAtMonotonicMs,
  );
  const child = result.stat;
  assert.equal(child.uid, currentUid(), 'Android Detox recovery ledger is not owned');
  assert.equal(child.mode, PRIVATE_FILE_MODE, 'Android Detox recovery ledger is not mode 0600');
  assert.equal(child.nlink, 1, 'Android Detox recovery ledger is not singly linked');
  return withPath(childPath(parent.path, name), child);
}

function ledgerParentIdentity(
  value: AndroidDetoxSessionDirectoryIdentity | undefined,
): Omit<AndroidDetoxSessionDirectoryIdentity, 'path'> | null {
  if (!value) return null;
  return {
    dev: value.dev,
    ino: value.ino,
    uid: value.uid,
    gid: value.gid,
    mode: value.mode,
    nlink: value.nlink,
  };
}

async function writeRecoveryLedger(options: {
  recoveryRoot: AndroidDetoxSessionDirectoryIdentity;
  outputRoot: string;
  parentIdentity?: AndroidDetoxSessionDirectoryIdentity;
  retainedPaths: readonly string[];
  recoveryFailures: readonly string[];
  lifecycle: AndroidDetoxSessionStagingLifecycle;
  childLifecycle: AndroidDetoxSessionChildLifecycle | null;
}): Promise<string | null> {
  const name = `android-detox-session-staging-recovery-${digest(options.outputRoot).slice(0, 24)}.private.json`;
  const value: AndroidDetoxSessionRecoveryLedger = {
    schemaVersion: 1,
    kind: 'private-android-detox-session-staging-recovery-not-public-receipt',
    status: 'blocked-recovery-ledger-retained',
    outputRoot: options.outputRoot,
    parentIdentity: ledgerParentIdentity(options.parentIdentity),
    retainedPaths: [...new Set(options.retainedPaths)].sort(),
    recoveryFailures: [...new Set(options.recoveryFailures)].slice(0, 64),
    recoveryPublication: 'verified',
    childLifecycle: options.childLifecycle,
    foreignWriteObserved: false,
    nativePassingCases: 0,
    publicPassingCases: 0,
  };
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    fence(options.lifecycle, 'recovery ledger:before-write');
    options.lifecycle.onBeforeRecoveryLedgerWrite?.();
    const opened = await writeAnchoredFile(
      options.recoveryRoot,
      name,
      bytes,
      options.lifecycle.signal,
      options.lifecycle.deadlineAtMonotonicMs,
      options.lifecycle.testWorkerDelayMs,
    );
    const ledgerPath = path.join(options.recoveryRoot.path, name);
    assert.equal(
      await realpath(ledgerPath),
      ledgerPath,
      'Android Detox recovery ledger is not canonical',
    );
    const metadata = await lstat(ledgerPath);
    assert(metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1);
    assert(
      sameIdentity(opened, statIdentity(metadata)),
      'Android Detox recovery ledger identity changed',
    );
    fence(options.lifecycle, 'recovery ledger:before-reread');
    const reread = await readFile(ledgerPath);
    assert.deepEqual(reread, bytes, 'Android Detox recovery ledger reread changed');
    fence(options.lifecycle, 'recovery ledger:after-reread');
    return name;
  } catch {
    return null;
  }
}

/**
 * Create one direct private child under an already-owned parent.  This is the
 * V6 replacement for the V5 finalization helper's path-based mkdir call.
 */
export async function createAndroidDetoxSessionOwnedChildDirectory(input: {
  parent: string;
  name: string;
  expectedParentIdentity: AndroidDetoxSessionDirectoryIdentity;
  lifecycle: AndroidDetoxSessionStagingLifecycle;
}): Promise<AndroidDetoxSessionDirectoryIdentity> {
  fence(input.lifecycle, `create child ${input.name}:start`);
  const parent = await privateDirectoryIdentity(input.parent, 'Android Detox owned child parent');
  assert(
    sameIdentity(parent, input.expectedParentIdentity),
    'Android Detox child parent identity changed',
  );
  fence(input.lifecycle, `create child ${input.name}:before`);
  const created = await createAnchoredDirectory(
    parent,
    input.name,
    input.lifecycle.signal,
    input.lifecycle.deadlineAtMonotonicMs,
    input.lifecycle.testWorkerDelayMs,
  );
  fence(input.lifecycle, `create child ${input.name}:after`);
  const afterParent = await privateDirectoryIdentity(
    input.parent,
    'Android Detox owned child parent',
  );
  assert(
    sameIdentity(afterParent, parent),
    'Android Detox child parent identity changed after creation',
  );
  const afterChild = await privateDirectoryIdentity(created.path, 'Android Detox owned child');
  assert(sameIdentity(afterChild, created), 'Android Detox child identity changed after creation');
  return afterChild;
}

/**
 * Prepare a fresh staging root.  The recovery ledger is written in the
 * already-owned capture root, so an exchanged output ancestor can never turn
 * recovery into a write through a foreign symlink.
 */
export async function prepareAndroidDetoxSessionPublicOutputRoot(input: {
  captureRoot: string;
  outputRoot: string;
  lifecycle: AndroidDetoxSessionStagingLifecycle;
}): Promise<AndroidDetoxSessionStagingOutput> {
  const captureRoot = await privateDirectoryIdentity(
    input.captureRoot,
    'Android Detox session capture root',
  );
  const outputRoot = path.resolve(input.outputRoot);
  assert.notEqual(captureRoot.path, outputRoot, 'Android Detox staging aliases capture evidence');
  const parentPath = path.dirname(outputRoot);
  const name = path.basename(outputRoot);
  assertChildName(name, 'Android Detox staging output');
  const parent = await privateDirectoryIdentity(parentPath, 'Android Detox staging parent');
  let created: AndroidDetoxSessionDirectoryIdentity | undefined;
  let recoveryRecordPath: string | null = null;
  const recoveryFailures: string[] = [];
  let childLifecycle: AndroidDetoxSessionChildLifecycle | null = null;
  const retainedPaths: string[] = [];
  try {
    fence(input.lifecycle, 'prepare staging output:start');
    fence(input.lifecycle, 'prepare staging output:before-create');
    input.lifecycle.onBeforeAnchoredCreate?.();
    created = await createAnchoredDirectory(
      parent,
      name,
      input.lifecycle.signal,
      input.lifecycle.deadlineAtMonotonicMs,
      input.lifecycle.testWorkerDelayMs,
    );
    input.lifecycle.onAfterAnchoredCreate?.();
    // Record the descriptor-created identity before any observation/fence can
    // fail. A later parent exchange therefore becomes retained evidence rather
    // than an untracked path that a rollback might delete through a symlink.
    fence(input.lifecycle, 'prepare staging output:after-create');
    const afterParent = await privateDirectoryIdentity(parentPath, 'Android Detox staging parent');
    assert(
      sameIdentity(afterParent, parent),
      'Android Detox staging parent identity changed during creation',
    );
    const afterOutput = await privateDirectoryIdentity(outputRoot, 'Android Detox staging output');
    assert(
      sameIdentity(afterOutput, created),
      'Android Detox staging output identity changed during creation',
    );
    assert.deepEqual(
      await readdir(outputRoot),
      [],
      'Android Detox staging output must start empty',
    );
    fence(input.lifecycle, 'prepare staging output:after');
    return { outputRoot, identity: afterOutput };
  } catch (error) {
    if (created) {
      // Recovery intentionally records uncertainty instead of attempting a
      // pathname rmdir. A descriptor-bound compare-and-remove primitive is not
      // available in Node; retaining the exact path is safer than risking a
      // foreign deletion after an ancestor exchange.
      retainedPaths.push(outputRoot);
      recoveryFailures.push(
        error instanceof Error ? error.message.slice(0, 240) : 'staging creation failed',
      );
    } else {
      recoveryFailures.push(
        error instanceof Error ? error.message.slice(0, 240) : 'staging creation failed',
      );
    }
    childLifecycle = childLifecycleFromError(error);
    recoveryRecordPath = await writeRecoveryLedger({
      recoveryRoot: captureRoot,
      outputRoot,
      parentIdentity: parent,
      retainedPaths,
      recoveryFailures,
      lifecycle: input.lifecycle,
      childLifecycle,
    });
    const recoveryPublication = recoveryRecordPath ? 'verified' : 'unknown';
    const status =
      recoveryRecordPath || retainedPaths.length > 0
        ? 'failed-recovery-ledger-retained'
        : 'cleaned';
    throw new AndroidDetoxSessionStagingError(
      status,
      recoveryRecordPath,
      retainedPaths,
      recoveryRecordPath
        ? 'Android Detox staging was blocked; the owned recovery ledger was retained.'
        : 'Android Detox staging was blocked; recovery ledger publication was unavailable.',
      error,
      recoveryPublication,
      childLifecycle,
    );
  }
}
