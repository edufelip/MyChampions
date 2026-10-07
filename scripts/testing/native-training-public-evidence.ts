import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { readOwnedDetoxConnectionEvidence } from './detox-connection-evidence';
import { revalidateDetoxRuntimeBuildMetadata } from './detox-runtime-build-metadata';
import {
  assertDetoxTrainingPublicFinalizationCandidate,
  type DetoxTrainingPublicFinalizationCandidate,
} from './native-detox-training-public-finalization-contract';
import { requireNativePilotAssertions } from './native-pilot-contract';
import { readNativeTrainingAttemptBinding } from './native-training-attempt-binding';
import {
  normalizeNativeCommandDiagnostic,
  requireSuccessfulNativeCommandDiagnostics,
} from './native-training-attempt-outcome';
import { requireFullAndroidTrainingCleanupEvidence } from './native-training-pilot-evidence';
import { readNativeEvidence } from './native-view-evidence';
import { assertArtifactPath } from './schema-validation';
import type { NativePilotSelection } from './native-pilot-contract';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
type Binding = {
  id: string;
  requirementRefs: string[];
  evidencePaths: string[];
};

export type NativeTrainingPublicEvidenceLifecycle = Readonly<{
  signal: AbortSignal;
  deadlineAtMs: number;
  /** Resource-free race seam; production callers do not provide it. */
  onMutationBoundary?: (label: string) => void;
  /** Test-only contention seam; production callers leave it unset. */
  beforeMutationBoundary?: (label: string) => void | Promise<void>;
  /** Test-only seam fired before waiting on another staging mutation. */
  onMutationQueued?: (label: string) => void;
  /** Test-only writer failure seam, invoked after O_EXCL has created a file. */
  afterFileOpened?: (relative: string) => void;
  /** Test-only rollback seam; cleanup remains independent of caller cancellation. */
  onRollbackBoundary?: (label: string, path: string) => void;
  /** Test-only seam immediately before the final identity recheck/unlink. */
  beforeRollbackUnlink?: (path: string) => void;
  /** Test-only seam after the final identity recheck and before quarantine rename. */
  beforeRollbackRename?: (path: string) => void;
  /** Test-only seam after quarantine bytes are checked and before its unlink fence. */
  beforeRollbackQuarantineUnlink?: (path: string) => void;
  /** Test-only seam after a directory is quarantined and before its final rmdir fence. */
  beforeRollbackQuarantineRmdir?: (path: string) => void;
}>;

type StageLifecycle = NativeTrainingPublicEvidenceLifecycle | undefined;
type StageStat = Awaited<ReturnType<typeof lstat>>;
type StageIdentity = {
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};
type OwnedStageEntry = {
  path: string;
  kind: 'file' | 'directory';
  identity: StageIdentity;
  sha256?: string;
};

type StageRecoveryStatus = 'cleaned' | 'failed-recovery-ledger-retained';

/** Safe stage failure metadata consumed by the public runner; no private error text is exposed. */
export class NativeTrainingPublicEvidenceStageError extends Error {
  constructor(
    readonly recoveryStatus: StageRecoveryStatus,
    readonly recoveryRecordPath: string | null,
    readonly recoveryFailures: readonly string[],
    detail: string,
    cause?: unknown,
  ) {
    super(detail, cause === undefined ? undefined : { cause });
    this.name = 'NativeTrainingPublicEvidenceStageError';
  }
}

function stageFence(lifecycle: StageLifecycle, label: string): void {
  if (!lifecycle) return;
  lifecycle.signal.throwIfAborted();
  assert(
    Number.isFinite(lifecycle.deadlineAtMs),
    `Native training staging deadline is invalid: ${label}`,
  );
  if (performance.now() >= lifecycle.deadlineAtMs)
    throw new Error(`Native training staging deadline expired: ${label}`);
}

async function stageAwait<T>(
  lifecycle: StageLifecycle,
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  stageFence(lifecycle, `${label}:before`);
  const value = await operation();
  stageFence(lifecycle, `${label}:after`);
  return value;
}

function stageIdentity(stat: StageStat): StageIdentity {
  return {
    dev: Number(stat.dev),
    ino: Number(stat.ino),
    uid: Number(stat.uid),
    gid: Number(stat.gid),
    mode: Number(stat.mode),
    nlink: Number(stat.nlink),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    ctimeMs: Number(stat.ctimeMs),
  };
}

function sameStageIdentity(
  left: StageIdentity,
  right: StageIdentity,
  kind: OwnedStageEntry['kind'],
): boolean {
  const stable =
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.mode === right.mode;
  if (!stable || kind === 'directory') return stable;
  return (
    stable &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function sameStageInode(left: StageIdentity, right: StageIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.mode === right.mode
  );
}

/**
 * Path based mkdir/write/unlink calls are unsafe after an ancestor is swapped
 * between the ownership check and the mutation.  Stage mutations therefore
 * run in one synchronous cwd critical section.  A directory opened as the
 * process cwd remains attached to that inode even when its pathname is
 * renamed; the final file open also uses O_NOFOLLOW/O_EXCL.  The module lock
 * prevents two staging calls from changing the process cwd concurrently.
 */
let stageMutationTail = Promise.resolve();

function requireStageDirectorySync(directory: string, label: string): StageIdentity {
  const canonical = realpathSync(directory);
  assert.equal(canonical, path.resolve(directory), `${label} is not canonical`);
  const stat = lstatSync(canonical);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `${label} is not an owned directory`);
  assert.equal(stat.uid, process.getuid?.(), `${label} owner changed`);
  assert.equal(stat.mode & 0o777, 0o700, `${label} mode changed`);
  return stageIdentity(stat);
}

function requireStageIdentitySync(directory: string, expected: StageIdentity, label: string): void {
  const current = requireStageDirectorySync(directory, label);
  assert(
    sameStageIdentity(expected, current, 'directory'),
    `${label} identity changed before mutation`,
  );
}

function trackedStageParentIdentity(
  parent: string,
  outputRoot: string,
  outputRootIdentity: StageIdentity,
  observedParents: ReadonlyMap<string, StageIdentity>,
  owned: readonly OwnedStageEntry[],
): StageIdentity {
  const resolved = path.resolve(parent);
  if (resolved === path.resolve(outputRoot)) return outputRootIdentity;
  const observed = observedParents.get(resolved);
  if (observed) return observed;
  const entry = owned.find(
    (candidate) => candidate.kind === 'directory' && candidate.path === resolved,
  );
  assert(entry, `Native training stage parent is not owned: ${parent}`);
  return entry.identity;
}

function restoreStageCwdSync(originalCwd: string, expected: StageIdentity): void {
  let failure: unknown;
  const candidates = [originalCwd];
  try {
    const parent = path.dirname(originalCwd);
    const canonicalParent = realpathSync(parent);
    const parentStat = lstatSync(canonicalParent);
    if (parentStat.isDirectory() && !parentStat.isSymbolicLink()) {
      for (const entry of readdirSync(canonicalParent, {
        withFileTypes: true,
      })) {
        if (entry.isDirectory() && !entry.isSymbolicLink())
          candidates.push(path.join(canonicalParent, entry.name));
      }
    }
  } catch (error) {
    failure = error;
  }
  for (const candidate of candidates) {
    let fd: number | undefined;
    try {
      fd = openSync(
        candidate,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
      );
      assert(sameStageIdentity(expected, stageIdentity(fstatSync(fd)), 'directory'));
      process.chdir(candidate);
      assert(sameStageIdentity(expected, stageIdentity(lstatSync('.')), 'directory'));
      return;
    } catch (error) {
      failure = error;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  // Never leave the process in a possibly foreign staging directory when its
  // original inode cannot be found. Root is a stable last-resort cwd; the
  // caller still receives a blocked error and must retain recovery facts.
  try {
    process.chdir('/');
  } catch (fallbackError) {
    failure = fallbackError;
  }
  throw new Error('Native training staging cwd restoration failed', {
    cause: failure,
  });
}

async function withAnchoredStageMutation<T>(
  parent: string,
  childName: string,
  outputRoot: string,
  outputRootIdentity: StageIdentity,
  observedParents: ReadonlyMap<string, StageIdentity>,
  owned: readonly OwnedStageEntry[],
  label: string,
  lifecycle: StageLifecycle,
  mutation: (basename: string) => T,
): Promise<T> {
  let release!: () => void;
  const previous = stageMutationTail;
  stageMutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  let originalCwd: string | undefined;
  let originalCwdIdentity: StageIdentity | undefined;
  try {
    lifecycle?.onMutationQueued?.(label);
    await previous;
    stageFence(lifecycle, `${label}:after-lock`);
    await lifecycle?.beforeMutationBoundary?.(label);
    stageFence(lifecycle, `${label}:before-mutation`);
    originalCwd = process.cwd();
    originalCwdIdentity = stageIdentity(lstatSync(originalCwd));
    const resolvedParent = path.resolve(parent);
    const expected = trackedStageParentIdentity(
      resolvedParent,
      outputRoot,
      outputRootIdentity,
      observedParents,
      owned,
    );
    requireStageIdentitySync(resolvedParent, expected, label);
    process.chdir(resolvedParent);
    const cwdIdentity = stageIdentity(lstatSync('.'));
    assert(
      sameStageIdentity(expected, cwdIdentity, 'directory'),
      `${label} cwd identity changed before mutation`,
    );
    lifecycle?.onMutationBoundary?.(label);
    // The seam above can emulate an ancestor replacement without yielding to
    // another staging call. Recheck before the synchronous mutation so the
    // operation cannot follow the replacement pathname.
    requireStageIdentitySync(resolvedParent, expected, label);
    return mutation(childName);
  } finally {
    try {
      if (originalCwd !== undefined && originalCwdIdentity !== undefined)
        restoreStageCwdSync(originalCwd, originalCwdIdentity);
    } finally {
      release();
    }
  }
}

function readDescriptorBytesSync(fd: number, label: string, expectedSize?: number): Buffer {
  const stat = fstatSync(fd);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Staged file is not regular: ${label}`);
  if (expectedSize !== undefined) assert.equal(stat.size, expectedSize);
  assert(stat.size >= 0 && stat.size <= 8 * 1024 * 1024, `Staged file is too large: ${label}`);
  const bytes = Buffer.alloc(Number(stat.size));
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
    assert(count > 0, `Staged file truncated during read: ${label}`);
    offset += count;
  }
  const extra = Buffer.alloc(1);
  assert.equal(
    readSync(fd, extra, 0, 1, bytes.length),
    0,
    `Staged file grew during read: ${label}`,
  );
  const after = fstatSync(fd);
  assert.equal(stageIdentity(after).dev, stageIdentity(stat).dev);
  assert.equal(stageIdentity(after).ino, stageIdentity(stat).ino);
  assert.equal(stageIdentity(after).size, stageIdentity(stat).size);
  return bytes;
}

function writeAnchoredFileSync(
  name: string,
  bytes: Buffer,
  onOpened?: (fd: number) => void,
): StageIdentity {
  const fd = openSync(
    name,
    fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    onOpened?.(fd);
    let offset = 0;
    while (offset < bytes.length) {
      const count = writeSync(fd, bytes, offset, bytes.length - offset, offset);
      assert(count > 0, `Staged file write made no progress: ${name}`);
      offset += count;
    }
    fsyncSync(fd);
    const stat = fstatSync(fd);
    assert(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.uid, process.getuid?.());
    assert.equal(stat.mode & 0o777, 0o600);
    assert.deepEqual(readDescriptorBytesSync(fd, name, bytes.length), bytes);
    const after = fstatSync(fd);
    assert(sameStageIdentity(stageIdentity(stat), stageIdentity(after), 'file'));
    return stageIdentity(after);
  } finally {
    closeSync(fd);
  }
}

async function requireOwnedStageDirectory(directory: string): Promise<StageIdentity> {
  const stat = await lstat(directory);
  assert(
    stat.isDirectory() && !stat.isSymbolicLink(),
    `Native training stage directory is not a regular directory: ${directory}`,
  );
  assert.equal(stat.uid, process.getuid?.(), 'Native training stage directory owner changed');
  assert.equal(stat.mode & 0o777, 0o700, 'Native training stage directory mode changed');
  return stageIdentity(stat);
}

async function createOwnedStageDirectory(
  outputRoot: string,
  relative: string,
  owned: OwnedStageEntry[],
  unverified: string[],
  lifecycle: StageLifecycle,
  outputRootIdentity: StageIdentity,
  observedParents: Map<string, StageIdentity>,
): Promise<string> {
  const directory = assertArtifactPath(outputRoot, relative);
  const parent = path.dirname(directory);
  const basename = path.basename(directory);
  if (parent !== path.resolve(outputRoot)) {
    const parentRelative = path.relative(outputRoot, parent);
    await ensureOwnedStageParents(
      outputRoot,
      parentRelative,
      owned,
      unverified,
      lifecycle,
      outputRootIdentity,
      observedParents,
    );
  }
  stageFence(lifecycle, `create directory ${relative}:before`);
  let created = false;
  try {
    const identity = await withAnchoredStageMutation(
      parent,
      basename,
      outputRoot,
      outputRootIdentity,
      observedParents,
      owned,
      `create directory ${relative}`,
      lifecycle,
      (name) => {
        mkdirSync(name, { mode: 0o700 });
        created = true;
        return requireStageDirectorySync(name, `created stage directory ${relative}`);
      },
    );
    owned.push({ path: directory, kind: 'directory', identity });
    observedParents.set(path.resolve(directory), identity);
    stageFence(lifecycle, `create directory ${relative}:after`);
  } catch (error) {
    if (
      (created || (error as NodeJS.ErrnoException).code === 'EEXIST') &&
      !owned.some((entry) => entry.path === directory) &&
      !unverified.includes(directory)
    )
      unverified.push(directory);
    throw error;
  }
  return directory;
}

async function ensureOwnedStageParents(
  outputRoot: string,
  relative: string,
  owned: OwnedStageEntry[],
  unverified: string[],
  lifecycle: StageLifecycle,
  outputRootIdentity: StageIdentity,
  observedParents: Map<string, StageIdentity>,
): Promise<void> {
  const segments = relative.split('/').filter(Boolean);
  let current = path.resolve(outputRoot);
  for (const segment of segments) {
    current = path.join(current, segment);
    assertArtifactPath(outputRoot, path.relative(outputRoot, current));
    try {
      const existingIdentity = await stageAwait(
        lifecycle,
        () => requireOwnedStageDirectory(current),
        `inspect directory ${segment}`,
      );
      observedParents.set(path.resolve(current), existingIdentity);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      stageFence(lifecycle, `create directory ${segment}:before`);
      let created = false;
      try {
        const parent = path.dirname(current);
        const basename = path.basename(current);
        const identity = await withAnchoredStageMutation(
          parent,
          basename,
          outputRoot,
          outputRootIdentity,
          observedParents,
          owned,
          `create directory ${segment}`,
          lifecycle,
          (name) => {
            mkdirSync(name, { mode: 0o700 });
            created = true;
            return requireStageDirectorySync(name, `created stage directory ${segment}`);
          },
        );
        owned.push({ path: current, kind: 'directory', identity });
        observedParents.set(path.resolve(current), identity);
        stageFence(lifecycle, `create directory ${segment}:after`);
      } catch (creationError) {
        if (
          (created || (creationError as NodeJS.ErrnoException).code === 'EEXIST') &&
          !owned.some((entry) => entry.path === current) &&
          !unverified.includes(current)
        )
          unverified.push(current);
        throw creationError;
      }
    }
  }
}

async function writeOwnedStageFile(
  outputRoot: string,
  relative: string,
  bytes: Buffer,
  owned: OwnedStageEntry[],
  unverified: string[],
  lifecycle: StageLifecycle,
  outputRootIdentity: StageIdentity,
  observedParents: Map<string, StageIdentity>,
): Promise<void> {
  const destination = assertArtifactPath(outputRoot, relative);
  const parent = path.dirname(destination);
  const basename = path.basename(destination);
  await ensureOwnedStageParents(
    outputRoot,
    path.relative(outputRoot, parent),
    owned,
    unverified,
    lifecycle,
    outputRootIdentity,
    observedParents,
  );
  stageFence(lifecycle, `write ${relative}:before`);
  let created = false;
  let trackedEntry: OwnedStageEntry | undefined;
  try {
    const identity = await withAnchoredStageMutation(
      parent,
      basename,
      outputRoot,
      outputRootIdentity,
      observedParents,
      owned,
      `write ${relative}`,
      lifecycle,
      (name) => {
        const written = writeAnchoredFileSync(name, bytes, (fd) => {
          created = true;
          try {
            trackedEntry = {
              path: destination,
              kind: 'file',
              identity: stageIdentity(fstatSync(fd)),
              sha256: hash(bytes),
            };
            owned.push(trackedEntry);
          } catch {
            if (!unverified.includes(destination)) unverified.push(destination);
            throw new Error(
              `Native training staged file identity could not be recorded: ${relative}`,
            );
          }
          lifecycle?.afterFileOpened?.(relative);
        });
        created = true;
        return written;
      },
    );
    assert(trackedEntry, `Native training staged file was not tracked: ${relative}`);
    trackedEntry.identity = identity;
    stageFence(lifecycle, `write ${relative}:after`);
  } catch (error) {
    if (created && !trackedEntry && !unverified.includes(destination)) unverified.push(destination);
    throw error;
  }
}

function rollbackOwnedFileSync(
  name: string,
  entry: OwnedStageEntry,
  beforeUnlink?: (path: string) => void,
  beforeRename?: (path: string) => void,
  beforeQuarantineUnlink?: (path: string) => void,
): {
  status: 'missing' | 'removed' | 'ownership-changed' | 'bytes-changed';
  retainedPath?: string;
} {
  let fd: number | undefined;
  try {
    try {
      fd = openSync(name, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
      throw error;
    }
    const opened = stageIdentity(fstatSync(fd));
    if (!sameStageIdentity(entry.identity, opened, 'file')) return { status: 'ownership-changed' };
    const bytes = readDescriptorBytesSync(fd, name, entry.identity.size);
    if (entry.sha256 !== undefined && hash(bytes) !== entry.sha256)
      return { status: 'bytes-changed' };
    const descriptorBeforeUnlink = stageIdentity(fstatSync(fd));
    const pathnameBeforeUnlink = stageIdentity(lstatSync(name));
    if (
      !sameStageIdentity(entry.identity, descriptorBeforeUnlink, 'file') ||
      !sameStageIdentity(entry.identity, pathnameBeforeUnlink, 'file')
    )
      return { status: 'ownership-changed' };
    beforeUnlink?.(name);
    const descriptorAtUnlink = stageIdentity(fstatSync(fd));
    const pathnameAtUnlink = stageIdentity(lstatSync(name));
    if (
      !sameStageIdentity(entry.identity, descriptorAtUnlink, 'file') ||
      !sameStageIdentity(entry.identity, pathnameAtUnlink, 'file')
    )
      return { status: 'ownership-changed' };
    beforeRename?.(name);

    // Node has no descriptor-relative unlink primitive. Atomically move the
    // current basename into an owned, private quarantine directory so a
    // replacement that wins the race after the last lstat is revalidated and
    // retained instead of being deleted by pathname.
    const quarantineDirectory = `.native-training-rollback-${randomUUID()}`;
    const quarantineName = path.join(quarantineDirectory, path.basename(name));
    const retainedPath = path.resolve(process.cwd(), quarantineName);
    let moved = false;
    try {
      mkdirSync(quarantineDirectory, { mode: 0o700 });
      renameSync(name, quarantineName);
      moved = true;
      let quarantineFd: number | undefined;
      try {
        quarantineFd = openSync(quarantineName, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const quarantinedIdentity = stageIdentity(fstatSync(quarantineFd));
        // Rename legitimately updates ctime/nlink metadata. The inode, owner,
        // mode, and bounded bytes are the identity facts that must survive
        // our own quarantine move.
        if (!sameStageInode(entry.identity, quarantinedIdentity))
          return { status: 'ownership-changed', retainedPath };
        const quarantinedBytes = readDescriptorBytesSync(
          quarantineFd,
          quarantineName,
          entry.identity.size,
        );
        if (entry.sha256 !== undefined && hash(quarantinedBytes) !== entry.sha256)
          return { status: 'bytes-changed', retainedPath };
      } finally {
        if (quarantineFd !== undefined) closeSync(quarantineFd);
      }
      beforeQuarantineUnlink?.(quarantineName);
      let finalQuarantineFd: number | undefined;
      try {
        finalQuarantineFd = openSync(quarantineName, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const finalQuarantineIdentity = stageIdentity(fstatSync(finalQuarantineFd));
        if (!sameStageInode(entry.identity, finalQuarantineIdentity))
          return { status: 'ownership-changed', retainedPath };
        const finalQuarantineBytes = readDescriptorBytesSync(
          finalQuarantineFd,
          quarantineName,
          entry.identity.size,
        );
        if (entry.sha256 !== undefined && hash(finalQuarantineBytes) !== entry.sha256)
          return { status: 'bytes-changed', retainedPath };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          return { status: 'ownership-changed', retainedPath };
        throw error;
      } finally {
        if (finalQuarantineFd !== undefined) closeSync(finalQuarantineFd);
      }
      // The public Node fs API has no inode-conditional unlink primitive.
      // A final descriptor/path check followed by unlinkSync is still a
      // check-then-delete race: a same-byte replacement can win between the
      // check and the pathname mutation. Retain the private quarantine and
      // publish the bounded recovery record instead of claiming cleanup or
      // risking deletion of an unrelated inode.
      return { status: 'ownership-changed', retainedPath };
    } catch (error) {
      if (!moved) {
        // No inode-conditional directory removal exists in Node's public fs
        // API. If quarantine creation failed, its pathname may already have
        // been created or replaced by another actor; retain it and preserve
        // the original rollback error for the recovery record.
        throw error;
      }
      return { status: 'ownership-changed', retainedPath };
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function rollbackOwnedDirectorySync(
  name: string,
  entry: OwnedStageEntry,
  beforeQuarantineRmdir?: (path: string) => void,
): {
  status: 'missing' | 'removed' | 'ownership-changed';
  retainedPath?: string;
} {
  let current;
  try {
    current = lstatSync(name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    throw error;
  }
  if (!sameStageIdentity(entry.identity, stageIdentity(current), 'directory'))
    return { status: 'ownership-changed' };
  const beforeQuarantine = stageIdentity(lstatSync(name));
  if (!sameStageIdentity(entry.identity, beforeQuarantine, 'directory'))
    return { status: 'ownership-changed' };
  // A non-empty directory may contain an owned file whose rollback was
  // retained, or a foreign child that was never in this call's ledger. Keep
  // that directory in place so recovery paths remain stable; moving the
  // container would obscure the child ownership boundary.
  if (readdirSync(name).length > 0) return { status: 'ownership-changed' };

  // Node has no descriptor-relative rmdir primitive. Move the directory into
  // one private quarantine, then perform one final inode fence before deciding
  // whether removal is safe. V6 retains the quarantine because the remaining
  // pathname operation cannot prove inode ownership.
  const quarantineDirectory = `.native-training-directory-rollback-${randomUUID()}`;
  const quarantineName = path.join(quarantineDirectory, 'entry');
  const retainedPath = path.resolve(process.cwd(), quarantineName);
  let moved = false;
  try {
    mkdirSync(quarantineDirectory, { mode: 0o700 });
    renameSync(name, quarantineName);
    moved = true;
    const quarantined = lstatSync(quarantineName);
    if (!sameStageInode(entry.identity, stageIdentity(quarantined)))
      return { status: 'ownership-changed', retainedPath };
    beforeQuarantineRmdir?.(quarantineName);
    const finalQuarantined = lstatSync(quarantineName);
    if (!sameStageInode(entry.identity, stageIdentity(finalQuarantined)))
      return { status: 'ownership-changed', retainedPath };
    // Node has no inode-conditional rmdir primitive. Retain this private
    // quarantine when the only available removal would be a path-based
    // check-then-delete operation.
    return { status: 'ownership-changed', retainedPath };
  } catch (error) {
    if (!moved) {
      // Do not remove an unowned or partially-created quarantine path. Node's
      // public fs API cannot make that pathname operation inode-conditional;
      // preserve the original error for the bounded recovery record.
      throw error;
    }
    return { status: 'ownership-changed', retainedPath };
  }
}

async function rollbackOwnedStageEntries(
  owned: readonly OwnedStageEntry[],
  outputRoot: string,
  outputRootIdentity: StageIdentity,
  observedParents: ReadonlyMap<string, StageIdentity>,
  onRollbackBoundary?: (label: string, path: string) => void,
  beforeRollbackUnlink?: (path: string) => void,
  beforeRollbackRename?: (path: string) => void,
  beforeRollbackQuarantineUnlink?: (path: string) => void,
  beforeRollbackQuarantineRmdir?: (path: string) => void,
): Promise<{ failures: string[]; remaining: string[] }> {
  const failures: string[] = [];
  const remaining: string[] = [];
  const files = owned.filter((entry) => entry.kind === 'file').reverse();
  const directories = owned
    .filter((entry) => entry.kind === 'directory')
    .sort((left, right) => right.path.length - left.path.length);
  for (const entry of [...files, ...directories]) {
    const parent = path.dirname(entry.path);
    const basename = path.basename(entry.path);
    try {
      const result = await withAnchoredStageMutation(
        parent,
        basename,
        outputRoot,
        outputRootIdentity,
        observedParents,
        owned,
        `rollback ${entry.path}`,
        undefined,
        (name) => {
          onRollbackBoundary?.(`rollback ${entry.path}`, entry.path);
          return entry.kind === 'file'
            ? {
                ...rollbackOwnedFileSync(
                  name,
                  entry,
                  beforeRollbackUnlink,
                  beforeRollbackRename,
                  beforeRollbackQuarantineUnlink,
                ),
              }
            : {
                ...rollbackOwnedDirectorySync(name, entry, beforeRollbackQuarantineRmdir),
              };
        },
      );
      if (result.status === 'missing' || result.status === 'removed') continue;
      failures.push(`${entry.path}:${result.status}`);
      remaining.push(entry.path);
      if ('retainedPath' in result && result.retainedPath !== undefined)
        remaining.push(result.retainedPath);
    } catch (error) {
      failures.push(`${entry.path}:${error instanceof Error ? error.name : 'rollback-error'}`);
      remaining.push(entry.path);
    }
  }
  return { failures, remaining };
}

async function writeStageRecoveryLedger(
  outputRoot: string,
  outputRootIdentity: StageIdentity,
  requestedRunId: string,
  captureRunId: string,
  recoveryFailures: string[],
  remaining: readonly string[],
): Promise<string | null> {
  const relative = 'training-staging-recovery.private.json';
  let opened = false;
  try {
    const bytes = Buffer.from(
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'private native training staging recovery, not public receipt',
          requestedRunId,
          captureRunId,
          status: 'blocked-recovery',
          recoveryFailures: [...recoveryFailures].slice(0, 32),
          remaining: [...remaining].slice(0, 64),
        },
        null,
        2,
      ) + '\n',
    );
    assert(bytes.byteLength <= 128 * 1024, 'Native training staging recovery ledger is too large');
    await withAnchoredStageMutation(
      outputRoot,
      relative,
      outputRoot,
      outputRootIdentity,
      new Map([[path.resolve(outputRoot), outputRootIdentity]]),
      [],
      'write staging recovery ledger',
      undefined,
      (name) =>
        writeAnchoredFileSync(name, bytes, () => {
          opened = true;
        }),
    );
    return relative;
  } catch {
    if (opened) recoveryFailures.push(`${relative}:ledger-write-unverified`);
    return null;
  }
}

async function privateRoot(value: string) {
  const canonical = await realpath(value);
  assert.equal(canonical, path.resolve(value));
  const info = await lstat(canonical);
  assert(info.isDirectory() && info.uid === process.getuid?.());
  assert.equal(info.mode & 0o777, 0o700);
  return canonical;
}

/** A sidecar is an original failed observation even if it is not attached to a command row. */
async function requireNoNativeCensusFailure(root: string) {
  const names = await readdir(root);
  assert(
    !names.some((name) => name.endsWith('.census-failure.private.json')),
    'Native census failure diagnostic prevents evidence finalization',
  );
}

async function revalidateTrainingOriginalReceipts(
  captureRoot: string,
  candidate: DetoxTrainingPublicFinalizationCandidate,
  lifecycle: StageLifecycle,
  repositoryRoot?: string,
): Promise<void> {
  for (const receipt of [
    candidate.originalReceipts.build,
    candidate.originalReceipts.command,
  ] as const) {
    stageFence(lifecycle, `revalidate original ${receipt.fileName}:before`);
    const observed = await stageAwait(
      lifecycle,
      () =>
        readOwnedDetoxConnectionEvidence(
          captureRoot,
          receipt.fileName,
          16 * 1024 * 1024,
          lifecycle ? { signal: lifecycle.signal, deadlineAt: lifecycle.deadlineAtMs } : undefined,
        ),
      `revalidate original ${receipt.fileName}`,
    );
    assert.equal(observed.realpath, receipt.realpath, 'Detox original receipt realpath changed');
    assert.deepEqual(
      observed.metadata,
      receipt.metadata,
      'Detox original receipt identity changed',
    );
    assert.equal(hash(observed.bytes), receipt.sha256, 'Detox original receipt bytes changed');
    assert.deepEqual(
      JSON.parse(observed.bytes.toString('utf8')),
      receipt.value,
      'Detox original receipt semantics changed',
    );
  }
  if (repositoryRoot)
    await revalidateDetoxRuntimeBuildMetadata(repositoryRoot, candidate.runtimeMetadata, () =>
      stageFence(lifecycle, 'revalidate Detox runtime descriptor'),
    );
}

type StageContext = {
  captureRoot?: string;
  outputRoot?: string;
  outputRootIdentity?: StageIdentity;
  observedParents: Map<string, StageIdentity>;
  owned: OwnedStageEntry[];
  unverified: string[];
};

function safeStageRunId(value: string): string {
  return /^[a-f0-9]{24}$/.test(value) ? value : 'unknown';
}

function safeStageErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : 'validation-error';
  return message
    .replace(/\/(?:Users|private|tmp|var|home|root)\b[^\s'"`]*/g, '<private-path>')
    .slice(0, 240);
}

/**
 * Stage failures are terminal for public qualification.  The rollback runs
 * independently of the caller's deadline/signal so a cancellation cannot
 * skip cleanup; a changed inode is retained and recorded instead of being
 * removed through a path that may now belong to another owner.
 */
export async function stageNativeTrainingPublicEvidence(options: {
  repositoryRoot?: string;
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  fixtureRunId: string;
  selection: NativePilotSelection;
  bindings: Binding[];
  /** Present only after the actual owner has produced all seven original receipts. */
  publicFinalization?: DetoxTrainingPublicFinalizationCandidate;
  lifecycle?: NativeTrainingPublicEvidenceLifecycle;
}) {
  const context: StageContext = {
    observedParents: new Map(),
    owned: [],
    unverified: [],
  };
  try {
    return await stageNativeTrainingPublicEvidenceCore(options, options.lifecycle, context);
  } catch (error) {
    const rollback =
      context.outputRoot && context.outputRootIdentity
        ? await rollbackOwnedStageEntries(
            context.owned,
            context.outputRoot,
            context.outputRootIdentity,
            context.observedParents,
            options.lifecycle?.onRollbackBoundary,
            options.lifecycle?.beforeRollbackUnlink,
            options.lifecycle?.beforeRollbackRename,
            options.lifecycle?.beforeRollbackQuarantineUnlink,
            options.lifecycle?.beforeRollbackQuarantineRmdir,
          )
        : { failures: [], remaining: [] };
    const recoveryFailures = [
      ...rollback.failures,
      ...context.unverified.map((entry) => `${entry}:ownership-unverified`),
    ];
    const remaining = [...rollback.remaining, ...context.unverified];
    let recoveryRecordPath: string | null = null;
    if (rollback.failures.length > 0 || remaining.length > 0) {
      if (context.outputRoot && context.outputRootIdentity) {
        recoveryRecordPath = await writeStageRecoveryLedger(
          context.outputRoot,
          context.outputRootIdentity,
          safeStageRunId(options.requestedRunId),
          context.captureRoot ? safeStageRunId(path.basename(context.captureRoot)) : 'unknown',
          recoveryFailures,
          remaining,
        );
      }
      const detail =
        recoveryRecordPath === null
          ? `Native training evidence staging was blocked (${safeStageErrorReason(error)}); owned output recovery could not be verified.`
          : `Native training evidence staging was blocked (${safeStageErrorReason(error)}); an owned output recovery record was retained.`;
      throw new NativeTrainingPublicEvidenceStageError(
        'failed-recovery-ledger-retained',
        recoveryRecordPath,
        recoveryFailures,
        detail,
        error,
      );
    }
    throw new NativeTrainingPublicEvidenceStageError(
      'cleaned',
      null,
      [],
      `Native training evidence staging was blocked (${safeStageErrorReason(error)}); owned partial output was removed.`,
      error,
    );
  }
}

/** Copy verified private proof under the public receipt root; no receipt or public pass is emitted. */
async function stageNativeTrainingPublicEvidenceCore(
  options: {
    repositoryRoot?: string;
    captureRoot: string;
    outputRoot: string;
    requestedRunId: string;
    fixtureRunId: string;
    selection: NativePilotSelection;
    bindings: Binding[];
    publicFinalization?: DetoxTrainingPublicFinalizationCandidate;
  },
  lifecycle: StageLifecycle,
  context: StageContext,
) {
  const captureRoot = await stageAwait(
    lifecycle,
    () => privateRoot(options.captureRoot),
    'inspect capture root',
  );
  context.captureRoot = captureRoot;
  const outputRoot = await stageAwait(
    lifecycle,
    () => privateRoot(options.outputRoot),
    'inspect output root',
  );
  context.outputRoot = outputRoot;
  context.outputRootIdentity = await stageAwait(
    lifecycle,
    () => requireOwnedStageDirectory(outputRoot),
    'bind output root identity',
  );
  const outputRootIdentity = context.outputRootIdentity;
  assert(outputRootIdentity, 'Native training output root identity is unavailable');
  context.observedParents.set(path.resolve(outputRoot), outputRootIdentity);
  assert.match(options.requestedRunId, /^[a-f0-9]{24}$/);
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  assert.notEqual(captureRoot, outputRoot);
  await stageAwait(
    lifecycle,
    () => requireNoNativeCensusFailure(captureRoot),
    'inspect capture census',
  );
  await stageAwait(
    lifecycle,
    () => requireNoNativeCensusFailure(outputRoot),
    'inspect output census',
  );
  stageFence(lifecycle, 'validate training identity');
  const binding = readNativeTrainingAttemptBinding({
    artifactRoot: captureRoot,
    requestedRunId: options.requestedRunId,
    backendRunId: options.fixtureRunId,
    selection: options.selection,
  });
  const ledger = requireNativePilotAssertions(options.selection);
  assert.equal(options.bindings.length, ledger.length);
  assert.equal(new Set(options.bindings.map((row) => row.id)).size, ledger.length);
  if (options.publicFinalization) {
    assertDetoxTrainingPublicFinalizationCandidate(options.publicFinalization, {
      requestedRunId: options.requestedRunId,
      requestedAttemptId: binding.requestedAttemptId,
      captureRunId: binding.captureRunId,
      fixtureRunId: binding.backendRunId,
    });
    assert.deepEqual(
      options.publicFinalization.assertionBindings,
      options.bindings,
      'Training public finalization bindings differ from staged bindings',
    );
    assert.equal(
      options.publicFinalization.scenarioHash,
      options.selection.scenarioHash,
      'Training public finalization scenario hash differs',
    );
    assert.equal(
      options.publicFinalization.requirementHash,
      options.selection.requirementHash,
      'Training public finalization requirement hash differs',
    );
  }
  const json = (relative: string): Record<string, unknown> => {
    stageFence(lifecycle, `read ${relative}`);
    const value: unknown = JSON.parse(readNativeEvidence(captureRoot, relative, true).toString());
    assert(value && typeof value === 'object' && !Array.isArray(value));
    return value as Record<string, unknown>;
  };
  const adapter = json('runtime-adapter.private.json');
  const capture = json('capture.private.json');
  const platform = options.selection.arguments.platform;
  assert.equal(adapter.kind, `private-owned-${platform}-training-attempt-not-public-receipt`);
  assert.equal(adapter.requestedRunId, binding.requestedRunId);
  assert.equal(adapter.requestedAttemptId, binding.requestedAttemptId);
  assert.equal(adapter.captureRunId, binding.captureRunId);
  assert.equal(adapter.captureExitCode, 0);
  assert.equal(adapter.childExitCode, 0);
  assert.equal(adapter.callbackInvocations, 1);
  assert.equal(adapter.callbackCompleted, true);
  assert.equal(adapter.externalCleanupResult, 'passed');
  assert.equal(adapter.verificationResult, 'passed');
  assert.deepEqual(adapter.assertionBindings, options.bindings);
  assert(Array.isArray(adapter.outputFailures), 'Adapter output failure projection is missing');
  const captureOutputFailures = Array.isArray(capture.commandExecutions)
    ? capture.commandExecutions
        .map((row) => normalizeNativeCommandDiagnostic(row).outputFailure)
        .filter((failure): failure is NonNullable<typeof failure> => failure !== null)
    : [];
  assert.deepEqual(
    adapter.outputFailures,
    captureOutputFailures,
    'Adapter output failure projection differs from original capture',
  );
  const adapterCommands = requireSuccessfulNativeCommandDiagnostics(adapter.commandDiagnostics);
  assert.deepEqual(adapter.censusFailures, [], 'Retained command census failure prevents staging');
  const cleanup = json('external-cleanup.private.json');
  assert.equal(cleanup.runId, binding.captureRunId);
  assert.equal(cleanup.result, 'passed');
  if (platform === 'android') {
    stageFence(lifecycle, 'validate Android cleanup evidence');
    requireFullAndroidTrainingCleanupEvidence(captureRoot, cleanup);
  }
  assert.equal(capture.kind, 'private-owned-native-training-execution-not-public-receipt');
  assert.equal(capture.platform, platform);
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  if (platform === 'ios') assert.equal(adapter.captureCleanup, capture.cleanup);
  const captureCommands = requireSuccessfulNativeCommandDiagnostics(capture.commandExecutions);
  assert.deepEqual(
    adapterCommands,
    captureCommands,
    'Adapter command diagnostics differ from original capture',
  );
  assert.equal((capture.backend as { runId: string }).runId, binding.backendRunId);
  const metadata = json('training-runtime-metadata.private.json');
  assert.equal(metadata.requestedAttemptId, binding.requestedAttemptId);
  assert.deepEqual(metadata.selection, binding.selection);
  const input = metadata.input as {
    runId: string;
    attemptId: string;
    platform: string;
  };
  assert.equal(input.runId, binding.backendRunId);
  assert.equal(input.attemptId, binding.backendAttemptId);
  assert.equal(input.platform, platform);
  for (const flag of [
    'sixSqlCheckpoints',
    'threeAuthenticatedApiReads',
    'savedPlanDurableAfterRestart',
  ])
    assert.equal(metadata[flag], true);
  assert.equal(metadata.publicNativePassingCases, 0);
  const files = new Map<string, Buffer>();
  const add = (relative: string, expectedHash?: string) => {
    stageFence(lifecycle, `read evidence ${relative}`);
    const bytes = readNativeEvidence(captureRoot, relative, !relative.endsWith('.png'));
    if (expectedHash) assert.equal(hash(bytes), expectedHash, 'Referenced native evidence changed');
    const prior = files.get(relative);
    if (prior) assert.deepEqual(prior, bytes, 'Native evidence changed while staging');
    files.set(relative, bytes);
  };
  for (const required of ledger) {
    stageFence(lifecycle, `validate assertion ${required.id}`);
    const row = options.bindings.find((candidate) => candidate.id === required.id);
    assert(row, 'Missing native assertion binding');
    assert.deepEqual(row.requirementRefs, required.requirementRefs);
    const expectedPaths = required.evidencePathTemplates!.map((template) =>
      template.replace('{attemptId}', binding.backendAttemptId),
    );
    assert.deepEqual(row.evidencePaths, expectedPaths, 'Native assertion evidence paths differ');
    for (const [index, relative] of row.evidencePaths.entries()) {
      add(relative);
      const proof = JSON.parse(files.get(relative)!.toString()) as {
        schemaVersion: number;
        kind: string;
        purpose: string;
        assertionId: string;
        evidenceKind: string;
        requirementRefs: string[];
        fixtureRunId: string;
        attemptId: string;
        scenarioHash: string;
        requirementHash: string;
        nativePassingCases: number;
        references: { path: string; sha256: string }[];
      };
      assert.equal(proof.schemaVersion, 1);
      assert.equal(proof.kind, 'native-training-assertion-evidence-preparation');
      assert.equal(proof.purpose, 'runtime');
      assert.equal(proof.assertionId, row.id);
      assert.equal(proof.evidenceKind, required.evidenceKinds[index]);
      assert.deepEqual(proof.requirementRefs, required.requirementRefs);
      assert.equal(proof.fixtureRunId, binding.backendRunId);
      assert.equal(proof.attemptId, binding.backendAttemptId);
      assert.equal(proof.scenarioHash, options.selection.scenarioHash);
      assert.equal(proof.requirementHash, options.selection.requirementHash);
      assert.equal(proof.nativePassingCases, 0);
      assert(Array.isArray(proof.references) && proof.references.length > 0);
      assert.equal(new Set(proof.references.map((ref) => ref.path)).size, proof.references.length);
      if (
        platform === 'android' &&
        row.id === 'NAT-training-edit-draft' &&
        proof.evidenceKind === 'ui'
      )
        for (const relative of [
          'android-input-reader-identity.private.json',
          'android-input-reader/input-reader.apk',
          'journey-edit-title-cleared-native-input.private.json',
          'android-input-reader-journey-edit-title-cleared-read.private.log',
        ])
          assert(
            proof.references.some((ref) => ref.path === relative),
            'Android edit lacks original reader evidence',
          );
      for (const ref of proof.references) {
        stageFence(lifecycle, `validate referenced evidence ${ref.path}`);
        assert.match(ref.sha256, /^[a-f0-9]{64}$/);
        add(ref.path, ref.sha256);
      }
    }
  }
  for (const relative of [
    'training-attempt-binding.private.json',
    'training-runtime-metadata.private.json',
    'training-journey-runtime-frames.private.json',
    'external-cleanup.private.json',
    'runtime-adapter.private.json',
    'capture.private.json',
  ])
    add(relative);
  // Recheck after async validation and before writing any staged evidence.
  await stageAwait(
    lifecycle,
    () => requireNoNativeCensusFailure(captureRoot),
    'recheck capture census',
  );
  await stageAwait(
    lifecycle,
    () => requireNoNativeCensusFailure(outputRoot),
    'recheck output census',
  );
  if (options.publicFinalization && options.captureRoot)
    await revalidateTrainingOriginalReceipts(
      captureRoot,
      options.publicFinalization,
      lifecycle,
      options.repositoryRoot,
    );
  // Validate every source before creating output. Failed or duplicate copies cannot replace proof.
  const parent = assertArtifactPath(outputRoot, 'evidence');
  await ensureOwnedStageParents(
    outputRoot,
    'evidence',
    context.owned,
    context.unverified,
    lifecycle,
    outputRootIdentity,
    context.observedParents,
  );
  await stageAwait(lifecycle, () => privateRoot(parent), 'verify evidence directory');
  const prefix = `evidence/${binding.captureRunId}`;
  await createOwnedStageDirectory(
    outputRoot,
    prefix,
    context.owned,
    context.unverified,
    lifecycle,
    outputRootIdentity,
    context.observedParents,
  );
  for (const [relative, bytes] of files) {
    stageFence(lifecycle, `copy evidence ${relative}`);
    await writeOwnedStageFile(
      outputRoot,
      `${prefix}/${relative}`,
      bytes,
      context.owned,
      context.unverified,
      lifecycle,
      outputRootIdentity,
      context.observedParents,
    );
  }
  const manifestPath = `${prefix}/copy-manifest.private.json`;
  const manifest = options.publicFinalization
    ? {
        kind: 'private native training public outcome candidate',
        status: 'eligible' as const,
        requestedRunId: binding.requestedRunId,
        captureRunId: binding.captureRunId,
        fixtureRunId: binding.backendRunId,
        nativePassingCases: options.publicFinalization.nativePassingCases,
        publicPassingCases: options.publicFinalization.publicPassingCases,
        publicPromotionEligible: options.publicFinalization.publicPromotionEligible,
        toolVersions: options.publicFinalization.toolVersions,
        sourceIdentity: options.publicFinalization.sourceIdentity,
        assertionBindings: options.publicFinalization.assertionBindings,
        files: [...files].map(([relative, bytes]) => ({
          path: relative,
          sha256: hash(bytes),
        })),
      }
    : {
        kind: 'private native evidence copy, not public outcome',
        requestedRunId: binding.requestedRunId,
        captureRunId: binding.captureRunId,
        fixtureRunId: binding.backendRunId,
        files: [...files].map(([relative, bytes]) => ({
          path: relative,
          sha256: hash(bytes),
        })),
      };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  await writeOwnedStageFile(
    outputRoot,
    manifestPath,
    manifestBytes,
    context.owned,
    context.unverified,
    lifecycle,
    outputRootIdentity,
    context.observedParents,
  );
  if (options.publicFinalization && options.captureRoot)
    await revalidateTrainingOriginalReceipts(
      captureRoot,
      options.publicFinalization,
      lifecycle,
      options.repositoryRoot,
    );
  await stageAwait(
    lifecycle,
    () => requireNoNativeCensusFailure(captureRoot),
    'final capture census',
  );
  await stageAwait(
    lifecycle,
    () => requireNoNativeCensusFailure(outputRoot),
    'final output census',
  );
  return {
    copyManifest: { path: manifestPath, sha256: hash(manifestBytes) },
    assertions: options.bindings.map((row) => ({
      id: row.id,
      requirementRefs: row.requirementRefs,
      outcome: 'passed' as const,
      evidencePaths: row.evidencePaths.map((relative) => `${prefix}/${relative}`),
    })),
    artifacts: [
      manifestPath,
      `${prefix}/training-attempt-binding.private.json`,
      `${prefix}/training-runtime-metadata.private.json`,
      `${prefix}/external-cleanup.private.json`,
      `${prefix}/training-journey-runtime-frames.private.json`,
      `${prefix}/runtime-adapter.private.json`,
      `${prefix}/capture.private.json`,
    ],
  };
}

/** Recheck every copied byte against the copy-time fingerprint immediately before receipt validation. */
export async function verifyStagedNativeTrainingEvidence(options: {
  outputRoot: string;
  copyManifest: { path: string; sha256: string };
  requestedRunId: string;
  captureRunId: string;
  fixtureRunId: string;
  /** Present during live finalization; omitted for later portable copy verification. */
  captureRoot?: string;
  expectedPublicFinalization?: DetoxTrainingPublicFinalizationCandidate;
  lifecycle?: NativeTrainingPublicEvidenceLifecycle;
}) {
  const root = await stageAwait(
    options.lifecycle,
    () => privateRoot(options.outputRoot),
    'verify staged output root',
  );
  await stageAwait(
    options.lifecycle,
    () => requireNoNativeCensusFailure(root),
    'verify staged output census',
  );
  if (options.captureRoot !== undefined) {
    const captureRoot = await stageAwait(
      options.lifecycle,
      () => privateRoot(options.captureRoot!),
      'verify staged capture root',
    );
    assert.equal(path.basename(captureRoot), options.captureRunId);
    await stageAwait(
      options.lifecycle,
      () => requireNoNativeCensusFailure(captureRoot),
      'verify staged capture census',
    );
  }
  assert.equal(path.basename(root), options.requestedRunId);
  const prefix = `evidence/${options.captureRunId}`;
  assert.equal(options.copyManifest.path, `${prefix}/copy-manifest.private.json`);
  stageFence(options.lifecycle, 'read staged copy manifest');
  const bytes = readNativeEvidence(root, options.copyManifest.path, true);
  assert.equal(hash(bytes), options.copyManifest.sha256, 'Staged native manifest changed');
  const manifest = JSON.parse(bytes.toString()) as {
    kind: string;
    status?: string;
    requestedRunId: string;
    captureRunId: string;
    fixtureRunId: string;
    nativePassingCases?: number;
    publicPassingCases?: number;
    publicPromotionEligible?: boolean;
    toolVersions?: Record<string, string>;
    sourceIdentity?: Record<string, string>;
    assertionBindings?: Binding[];
    files: { path: string; sha256: string }[];
  };
  if (manifest.kind === 'private native training public outcome candidate') {
    assert(
      options.expectedPublicFinalization,
      'Public training outcome lacks its finalization candidate',
    );
    assert.equal(manifest.status, 'eligible');
    assert.equal(manifest.nativePassingCases, 7);
    assert.equal(manifest.publicPassingCases, 7);
    assert.equal(manifest.publicPromotionEligible, true);
    assert.deepEqual(manifest.toolVersions, options.expectedPublicFinalization.toolVersions);
    assert.deepEqual(manifest.sourceIdentity, options.expectedPublicFinalization.sourceIdentity);
    assert.deepEqual(
      manifest.assertionBindings,
      options.expectedPublicFinalization.assertionBindings,
    );
  } else assert.equal(manifest.kind, 'private native evidence copy, not public outcome');
  assert.equal(manifest.requestedRunId, options.requestedRunId);
  assert.equal(manifest.captureRunId, options.captureRunId);
  assert.equal(manifest.fixtureRunId, options.fixtureRunId);
  assert(Array.isArray(manifest.files) && manifest.files.length > 0);
  assert.equal(new Set(manifest.files.map((row) => row.path)).size, manifest.files.length);
  const directory = await stageAwait(
    options.lifecycle,
    () => privateRoot(assertArtifactPath(root, prefix)),
    'verify staged evidence directory',
  );
  await stageAwait(
    options.lifecycle,
    () => requireNoNativeCensusFailure(directory),
    'verify staged evidence directory census',
  );
  for (const file of manifest.files) {
    stageFence(options.lifecycle, `verify staged file ${file.path}`);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      hash(readNativeEvidence(directory, file.path, true)),
      file.sha256,
      'Staged native evidence changed',
    );
  }
  stageFence(options.lifecycle, 'verify staged evidence complete');
}
