import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export type NativeSourceIdentity = {
  sha: string;
  dirty: boolean;
  sourceTreeHash: string;
};

export type TreeHashOptions = Readonly<{
  signal?: AbortSignal;
  deadlineAtMonotonicMs?: number;
  /** Enable metadata fences around every directory and file read. */
  verifyStableIdentity?: boolean;
  /**
   * Private deterministic race seam used by filesystem mutation controls.
   * Production callers leave this unset; the type checks remain mandatory
   * whenever verifyStableIdentity is enabled.
   */
  testHooks?: TreeHashTestHooks;
}>;

export type TreeHashEntryKind = 'directory' | 'file' | 'symlink';

export type TreeHashTestHooks = Readonly<{
  beforeEntryIdentityCheck?: (input: {
    path: string;
    expected: TreeHashEntryKind;
  }) => void | Promise<void>;
  beforeDirectoryPostCheck?: (path: string) => void | Promise<void>;
  beforeSymlinkPostCheck?: (path: string) => void | Promise<void>;
}>;

type TreeMetadata = Readonly<{
  dev: number;
  ino: number;
  mode: number;
  uid: number;
  gid: number;
  nlink: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}>;

function treeMetadata(value: Awaited<ReturnType<typeof lstat>>): TreeMetadata {
  return {
    dev: Number(value.dev),
    ino: Number(value.ino),
    mode: Number(value.mode),
    uid: Number(value.uid),
    gid: Number(value.gid),
    nlink: Number(value.nlink),
    size: Number(value.size),
    mtimeMs: Number(value.mtimeMs),
    ctimeMs: Number(value.ctimeMs),
  };
}

function sameTreeMetadata(left: TreeMetadata, right: TreeMetadata): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function requireDirectoryIdentity(
  value: Awaited<ReturnType<typeof lstat>>,
  filePath: string,
): TreeMetadata {
  if (!value.isDirectory() || value.isSymbolicLink())
    throw new Error(`Native tree directory changed type before traversal: ${filePath}`);
  return treeMetadata(value);
}

function requireFileIdentity(
  value: Awaited<ReturnType<typeof lstat>>,
  filePath: string,
): TreeMetadata {
  if (!value.isFile() || value.isSymbolicLink())
    throw new Error(`Native tree file changed type before reading: ${filePath}`);
  return treeMetadata(value);
}

function requireSymlinkIdentity(
  value: Awaited<ReturnType<typeof lstat>>,
  filePath: string,
): TreeMetadata {
  if (!value.isSymbolicLink())
    throw new Error(`Native tree symlink changed type before reading: ${filePath}`);
  return treeMetadata(value);
}

function assertTreeHashLive(options: TreeHashOptions | undefined): void {
  options?.signal?.throwIfAborted();
  if (options?.deadlineAtMonotonicMs !== undefined) {
    if (!Number.isFinite(options.deadlineAtMonotonicMs))
      throw new Error('Native tree hash deadline is invalid');
    if (performance.now() >= options.deadlineAtMonotonicMs)
      throw new Error('Native tree hash deadline exceeded');
  }
}

type TreeHashLifecycle = Readonly<{
  signal?: AbortSignal;
  dispose: () => void;
}>;

function treeHashLifecycle(options: TreeHashOptions | undefined): TreeHashLifecycle {
  if (!options?.signal && options?.deadlineAtMonotonicMs === undefined)
    return { signal: undefined, dispose: () => undefined };
  if (
    options?.deadlineAtMonotonicMs !== undefined &&
    !Number.isFinite(options.deadlineAtMonotonicMs)
  )
    throw new Error('Native tree hash deadline is invalid');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = (reason: unknown) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const onAbort = () => abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) abort(options.signal.reason);
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }
  if (options.deadlineAtMonotonicMs !== undefined) {
    const scheduleDeadlineAbort = () => {
      if (controller.signal.aborted) return;
      const remaining = options.deadlineAtMonotonicMs! - performance.now();
      if (remaining <= 0) {
        abort(new Error('Native tree hash deadline exceeded'));
        return;
      }
      timer = setTimeout(scheduleDeadlineAbort, Math.min(remaining, 2_147_483_647));
    };
    scheduleDeadlineAbort();
  }
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    },
  };
}

export async function treeHash(root: string, options?: TreeHashOptions) {
  const lifecycle = treeHashLifecycle(options);
  const liveOptions = options ? { ...options, signal: lifecycle.signal } : undefined;
  const digest = createHash('sha256');
  const visit = async (directory: string) => {
    assertTreeHashLive(liveOptions);
    const directoryBefore = liveOptions?.verifyStableIdentity
      ? requireDirectoryIdentity(await lstat(directory), directory)
      : undefined;
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    assertTreeHashLive(liveOptions);
    if (directoryBefore) {
      const directoryAfterRead = requireDirectoryIdentity(await lstat(directory), directory);
      if (!sameTreeMetadata(directoryBefore, directoryAfterRead))
        throw new Error('Native tree changed while it was being hashed');
    }
    for (const entry of entries) {
      assertTreeHashLive(liveOptions);
      const file = path.join(directory, entry.name);
      digest.update(path.relative(root, file) + '\0');
      if (entry.isDirectory()) {
        if (liveOptions?.verifyStableIdentity) {
          await liveOptions.testHooks?.beforeEntryIdentityCheck?.({
            path: file,
            expected: 'directory',
          });
          requireDirectoryIdentity(await lstat(file), file);
        }
        await visit(file);
      } else if (entry.isSymbolicLink()) {
        if (liveOptions?.verifyStableIdentity)
          await liveOptions.testHooks?.beforeEntryIdentityCheck?.({
            path: file,
            expected: 'symlink',
          });
        const linkBefore = liveOptions?.verifyStableIdentity
          ? requireSymlinkIdentity(await lstat(file), file)
          : undefined;
        const target = await readlink(file);
        assertTreeHashLive(liveOptions);
        if (liveOptions?.verifyStableIdentity)
          await liveOptions.testHooks?.beforeSymlinkPostCheck?.(file);
        const targetAfter = liveOptions?.verifyStableIdentity ? await readlink(file) : target;
        const linkAfter = liveOptions?.verifyStableIdentity
          ? requireSymlinkIdentity(await lstat(file), file)
          : undefined;
        if (
          target !== targetAfter ||
          (linkBefore && linkAfter && !sameTreeMetadata(linkBefore, linkAfter))
        )
          throw new Error('Native symlink changed while it was being hashed');
        digest.update(target);
      } else if (entry.isFile()) {
        if (liveOptions?.verifyStableIdentity)
          await liveOptions.testHooks?.beforeEntryIdentityCheck?.({
            path: file,
            expected: 'file',
          });
        const fileBefore = liveOptions?.verifyStableIdentity
          ? requireFileIdentity(await lstat(file), file)
          : undefined;
        const contents = await readFile(file, { signal: liveOptions?.signal });
        assertTreeHashLive(liveOptions);
        const fileAfter = liveOptions?.verifyStableIdentity
          ? requireFileIdentity(await lstat(file), file)
          : undefined;
        if (fileBefore && fileAfter && !sameTreeMetadata(fileBefore, fileAfter))
          throw new Error('Native file changed while it was being hashed');
        digest.update(createHash('sha256').update(contents).digest());
      } else if (liveOptions?.verifyStableIdentity)
        throw new Error(`Native tree entry has an unsupported type: ${file}`);
    }
    assertTreeHashLive(liveOptions);
    if (directoryBefore) {
      await liveOptions?.testHooks?.beforeDirectoryPostCheck?.(directory);
      const directoryAfterDescendants = requireDirectoryIdentity(await lstat(directory), directory);
      if (!sameTreeMetadata(directoryBefore, directoryAfterDescendants))
        throw new Error('Native directory changed while its descendants were being hashed');
    }
  };
  try {
    assertTreeHashLive(liveOptions);
    await visit(root);
    assertTreeHashLive(liveOptions);
    return digest.digest('hex');
  } finally {
    lifecycle.dispose();
  }
}

export async function sourceIdentity(root: string): Promise<NativeSourceIdentity> {
  const digest = createHash('sha256');
  for (const name of [
    'app',
    'components',
    'features',
    'constants',
    'localization',
    'assets',
    'ios/mychampions',
    'ios/mychampions.xcodeproj',
  ])
    digest.update(name + ':' + (await treeHash(path.join(root, name))));
  for (const name of [
    'package.json',
    'yarn.lock',
    'app.config.ts',
    'ios/Podfile',
    'ios/Podfile.lock',
  ])
    digest.update(name).update(await readFile(path.join(root, name)));
  return {
    sha: (await execute('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 5000 })).stdout.trim(),
    dirty: true,
    sourceTreeHash: digest.digest('hex'),
  };
}
