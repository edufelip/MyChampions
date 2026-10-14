import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { Stats } from 'node:fs';

const READ_CHUNK_BYTES = 64 * 1024;
const MAX_SIDECAR_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_SIDECAR_FRAME_BYTES = 16 * 1024 * 1024;
// Existing Detox callers declare the 16 MiB screenshot/protocol bound. The
// sidecar still caps the bytes actually accepted by this writer at the
// smaller payload bound above; the wider value is only a caller declaration.
const MAX_SIDECAR_DECLARED_PAYLOAD_BYTES = MAX_SIDECAR_FRAME_BYTES;
const MAX_SIDECAR_STDERR_BYTES = 64 * 1024;
const DEFAULT_SIDECAR_WALL_MS = 15_000;
const SIDECAR_KILL_GRACE_MS = 500;
// Android camera captures (hierarchy/screenshot) are saved as opaque
// `.private.bin` files by the owned adb reader; their hashes are verified by
// the producer before staging copies them.
const CONNECTION_FILE_NAME =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:(?:private\.)?(?:json|xml|png)|private\.bin)$/;

export type DetoxConnectionEvidenceStat = Readonly<{
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}>;

/**
 * Identity of a directory already owned by the caller. This is checked again
 * inside the descriptor-backed writer before recovery publication.
 */
export type DetoxConnectionEvidenceDirectoryIdentity = Readonly<{
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
}>;

export type DetoxConnectionEvidenceRead = Readonly<{
  bytes: Buffer;
  metadata: DetoxConnectionEvidenceStat;
  realpath: string;
  writer?: DetoxConnectionEvidenceWriterReceipt;
}>;

export type DetoxConnectionEvidenceWriterReceipt = Readonly<{
  pid: number;
  pgid: number;
  startedAt: string;
  startedMonotonicMs: number;
  startIdentity: string;
  commandHash: string;
  sourcePin: Readonly<{ path: string; sha256: string; bytes: number }>;
  exitCode: number | null;
  signal: string | null;
  killed: boolean;
  timedOut: boolean;
  reaped: boolean;
  spawnError?: string;
  stdinError?: string;
}>;

export type DetoxConnectionEvidenceLifecycle = Readonly<{
  signal?: AbortSignal;
  deadlineAt?: number;
  checkLive?: () => void | Promise<void>;
  beforePublish?: (input: { temporary: string; final: string }) => void | Promise<void>;
  afterPublish?: (input: { temporary: string; final: string }) => void | Promise<void>;
  beforeRecoveryUnlink?: (input: { target: string; recovery: string }) => void | Promise<void>;
}>;

export type DetoxConnectionEvidenceRemoval = 'absent' | 'retained';

export class DetoxConnectionEvidenceRecoveryError extends Error {
  readonly code = 'DETOX_CONNECTION_EVIDENCE_RECOVERY';

  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DetoxConnectionEvidenceRecoveryError';
  }
}

function statIdentity(metadata: Stats): DetoxConnectionEvidenceStat {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    mode: metadata.mode,
    nlink: metadata.nlink,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
  };
}

function sameStat(
  left: Stats | DetoxConnectionEvidenceStat,
  right: Stats | DetoxConnectionEvidenceStat,
): boolean {
  const a = statIdentityLike(left);
  const b = statIdentityLike(right);
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameRootIdentity(
  left: Stats | DetoxConnectionEvidenceStat,
  right: Stats | DetoxConnectionEvidenceStat,
): boolean {
  const a = statIdentityLike(left);
  const b = statIdentityLike(right);
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.uid === b.uid &&
    a.gid === b.gid &&
    (a.mode & 0o777) === (b.mode & 0o777)
  );
}

function statIdentityLike(value: Stats | DetoxConnectionEvidenceStat): DetoxConnectionEvidenceStat {
  return {
    dev: value.dev,
    ino: value.ino,
    uid: value.uid,
    gid: value.gid,
    mode: value.mode,
    nlink: value.nlink,
    size: value.size,
    mtimeMs: value.mtimeMs,
    ctimeMs: value.ctimeMs,
  };
}

function sameDirectoryIdentity(
  left: Stats | DetoxConnectionEvidenceStat,
  right: DetoxConnectionEvidenceDirectoryIdentity,
): boolean {
  const a = statIdentityLike(left);
  return (
    a.dev === right.dev &&
    a.ino === right.ino &&
    a.uid === right.uid &&
    a.gid === right.gid &&
    (a.mode & 0o777) === (right.mode & 0o777)
  );
}

async function checkLive(options: DetoxConnectionEvidenceLifecycle = {}): Promise<void> {
  if (options.signal?.aborted)
    throw options.signal.reason ?? new Error('Detox connection evidence operation cancelled');
  if (Number.isFinite(options.deadlineAt) && performance.now() >= Number(options.deadlineAt))
    throw new Error('Detox connection evidence operation deadline elapsed');
  await options.checkLive?.();
  if (options.signal?.aborted)
    throw options.signal.reason ?? new Error('Detox connection evidence operation cancelled');
  if (Number.isFinite(options.deadlineAt) && performance.now() >= Number(options.deadlineAt))
    throw new Error('Detox connection evidence operation deadline elapsed');
}

function assertName(name: string): void {
  if (!CONNECTION_FILE_NAME.test(name))
    throw new Error(`Detox connection evidence filename is unsafe: ${name}`);
}

function assertMetadata(
  metadata: Stats,
  maxBytes: number,
  privateRecord: boolean,
  label: string,
): void {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (privateRecord ? (metadata.mode & 0o777) !== 0o600 : (metadata.mode & 0o022) !== 0) ||
    (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) ||
    metadata.size <= 0 ||
    metadata.size > maxBytes
  )
    throw new Error(`${label} is not an owned bounded immutable file`);
}

async function canonicalOwnedRoot(
  root: string,
  expected?: DetoxConnectionEvidenceDirectoryIdentity,
): Promise<{ path: string; metadata: Stats }> {
  const resolved = path.resolve(root);
  const canonical = await realpath(resolved);
  if (canonical !== resolved) throw new Error('Detox connection artifact root is not canonical');
  const metadata = await lstat(canonical);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
  )
    throw new Error('Detox connection artifact root is not a private owned directory');
  if (expected && !sameDirectoryIdentity(metadata, expected))
    throw new DetoxConnectionEvidenceRecoveryError(
      'Detox connection artifact root identity changed before writer anchoring',
      { expected, observed: statIdentity(metadata) },
    );
  return { path: canonical, metadata };
}

async function readRootIdentity(root: string, expected?: Stats): Promise<Stats> {
  let canonical: string;
  let metadata: Stats;
  try {
    canonical = await realpath(root);
    metadata = await lstat(root);
  } catch (error) {
    throw new DetoxConnectionEvidenceRecoveryError(
      'Detox connection artifact root cannot be inspected',
      {
        cause: error,
      },
    );
  }
  if (
    canonical !== root ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) ||
    (expected && !sameRootIdentity(metadata, expected))
  )
    throw new DetoxConnectionEvidenceRecoveryError(
      'Detox connection artifact root identity changed',
    );
  return metadata;
}

export async function readDetoxConnectionPath(
  file: string,
  maxBytes: number,
  options: DetoxConnectionEvidenceLifecycle & { privateRecord?: boolean } = {},
): Promise<DetoxConnectionEvidenceRead> {
  if (!path.isAbsolute(file) || path.resolve(file) !== file)
    throw new Error('Detox connection evidence path must be absolute and normalized');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new Error('Detox connection evidence byte bound is invalid');
  await checkLive(options);
  const pathBefore = await lstat(file);
  assertMetadata(pathBefore, maxBytes, options.privateRecord === true, 'Detox connection evidence');
  await checkLive(options);
  if ((fsConstants.O_NOFOLLOW ?? 0) === 0)
    throw new Error('Detox connection evidence reader cannot enforce no-follow opens');
  if ((await realpath(file)) !== file)
    throw new Error('Detox connection evidence path is not canonical');
  const handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorBefore = await handle.stat();
    assertMetadata(
      descriptorBefore,
      maxBytes,
      options.privateRecord === true,
      'Detox connection evidence descriptor',
    );
    await checkLive(options);
    if (!sameStat(pathBefore, descriptorBefore))
      throw new Error('Detox connection evidence path changed before descriptor read');
    const bytes = Buffer.allocUnsafe(descriptorBefore.size);
    let offset = 0;
    while (offset < bytes.length) {
      await checkLive(options);
      const result = await handle.read(
        bytes,
        offset,
        Math.min(READ_CHUNK_BYTES, bytes.length - offset),
        null,
      );
      if (result.bytesRead <= 0) throw new Error('Detox connection evidence truncated during read');
      offset += result.bytesRead;
    }
    await checkLive(options);
    const extra = Buffer.allocUnsafe(1);
    const extraResult = await handle.read(extra, 0, 1, null);
    if (extraResult.bytesRead !== 0) throw new Error('Detox connection evidence grew during read');
    await checkLive(options);
    const descriptorAfter = await handle.stat();
    const pathAfter = await lstat(file);
    if (!sameStat(descriptorBefore, descriptorAfter) || !sameStat(descriptorBefore, pathAfter))
      throw new Error('Detox connection evidence identity changed during read');
    if ((await realpath(file)) !== file)
      throw new Error('Detox connection evidence path changed during read');
    await checkLive(options);
    return { bytes, metadata: statIdentity(descriptorAfter), realpath: file };
  } finally {
    await handle.close();
  }
}

export async function readOwnedDetoxConnectionEvidence(
  root: string,
  name: string,
  maxBytes: number,
  options: DetoxConnectionEvidenceLifecycle = {},
): Promise<DetoxConnectionEvidenceRead> {
  assertName(name);
  const ownedRoot = await canonicalOwnedRoot(root);
  await checkLive(options);
  const file = path.join(ownedRoot.path, name);
  if (path.dirname(file) !== ownedRoot.path)
    throw new Error('Detox connection evidence escaped the artifact root');
  return readDetoxConnectionPath(file, maxBytes, {
    ...options,
    privateRecord: true,
  });
}

export async function readOwnedDetoxConnectionFile(
  root: string,
  name: string,
  maxBytes: number,
  options: DetoxConnectionEvidenceLifecycle = {},
): Promise<Buffer> {
  return (await readOwnedDetoxConnectionEvidence(root, name, maxBytes, options)).bytes;
}

export async function isDetoxConnectionPublicationPending(
  root: string,
  name: string,
  observedPublication?: DetoxConnectionEvidenceStat,
): Promise<boolean> {
  assertName(name);
  let ownedRoot: { path: string; metadata: Stats };
  try {
    ownedRoot = await canonicalOwnedRoot(root);
  } catch {
    return false;
  }
  const file = path.join(ownedRoot.path, name);
  if (path.dirname(file) !== ownedRoot.path) return false;
  if (await hasPendingPublication(ownedRoot.path, name, observedPublication)) return true;
  let finalMetadata: Stats;
  try {
    finalMetadata = await lstat(file);
  } catch {
    return false;
  }
  if (
    observedPublication &&
    finalMetadata.isFile() &&
    !finalMetadata.isSymbolicLink() &&
    finalMetadata.nlink === 1 &&
    (finalMetadata.mode & 0o777) === 0o600 &&
    (typeof process.getuid !== 'function' || finalMetadata.uid === process.getuid()) &&
    samePublicationIdentity(observedPublication, finalMetadata)
  )
    return true;
  if (
    !finalMetadata.isFile() ||
    finalMetadata.isSymbolicLink() ||
    finalMetadata.nlink !== 2 ||
    (finalMetadata.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === 'function' && finalMetadata.uid !== process.getuid())
  )
    return false;
  if (observedPublication && !samePublicationIdentity(observedPublication, finalMetadata))
    return false;
  let names: string[];
  try {
    names = await readdir(ownedRoot.path);
  } catch {
    return false;
  }
  for (const candidate of names) {
    if (!candidate.startsWith(`${name}.tmp-`)) continue;
    try {
      const temporaryMetadata = await lstat(path.join(ownedRoot.path, candidate));
      if (
        temporaryMetadata.isFile() &&
        !temporaryMetadata.isSymbolicLink() &&
        temporaryMetadata.nlink === 2 &&
        temporaryMetadata.dev === finalMetadata.dev &&
        temporaryMetadata.ino === finalMetadata.ino
      )
        return true;
    } catch {
      // The publisher may have completed its temporary unlink between the reads.
    }
  }
  // The temporary entry may disappear between the first final lstat and the
  // directory scan. Retry only when a second lstat proves that the same
  // observed owned inode completed publication with nlink=1. An unrelated
  // hardlink remains rejected and is never classified as atomic publication.
  if (!observedPublication) return false;
  try {
    const completedMetadata = await lstat(file);
    if (
      completedMetadata.isFile() &&
      !completedMetadata.isSymbolicLink() &&
      completedMetadata.nlink === 1 &&
      (completedMetadata.mode & 0o777) === 0o600 &&
      (typeof process.getuid !== 'function' || completedMetadata.uid === process.getuid()) &&
      samePublicationIdentity(observedPublication, completedMetadata)
    )
      return true;
  } catch {
    // The publisher may have removed the final path while recovering.
  }
  return false;
}

function samePublicationIdentity(
  left: Stats | DetoxConnectionEvidenceStat,
  right: Stats | DetoxConnectionEvidenceStat,
): boolean {
  const a = statIdentityLike(left);
  const b = statIdentityLike(right);
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.uid === b.uid &&
    a.gid === b.gid &&
    (a.mode & 0o777) === (b.mode & 0o777) &&
    a.size === b.size
  );
}

function recovery(
  message: string,
  details: Record<string, unknown> = {},
): DetoxConnectionEvidenceRecoveryError {
  return new DetoxConnectionEvidenceRecoveryError(message, details);
}

async function publicationPathIdentity(
  file: string,
  label: string,
  expectedNlink: number | readonly number[],
): Promise<Stats> {
  let canonical: string;
  let metadata: Stats;
  try {
    canonical = await realpath(file);
    metadata = await lstat(file);
  } catch (error) {
    throw recovery(`${label} cannot be inspected`, { cause: error });
  }
  const links = Array.isArray(expectedNlink) ? expectedNlink : [expectedNlink];
  if (
    canonical !== file ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !links.includes(metadata.nlink) ||
    (metadata.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
  )
    throw recovery(`${label} is not the owned private publication inode`);
  return metadata;
}

/**
 * Retain one previously published inode without attempting a
 * check-then-unlink rollback. POSIX has no portable atomic
 * compare-and-delete primitive, so a present inode remains actionable
 * evidence even when its identity was observed before this function ran.
 */
export async function removeOwnedDetoxConnectionFile(
  root: string,
  name: string,
  expected: DetoxConnectionEvidenceStat,
  options: DetoxConnectionEvidenceLifecycle = {},
): Promise<DetoxConnectionEvidenceRemoval> {
  assertName(name);
  const ownedRoot = await canonicalOwnedRoot(root);
  await checkLive(options);
  const file = path.join(ownedRoot.path, name);
  if (path.dirname(file) !== ownedRoot.path)
    throw new Error('Detox connection evidence escaped the artifact root');
  const rootIdentity = await readRootIdentity(ownedRoot.path, ownedRoot.metadata);
  let observed: Stats;
  try {
    observed = await publicationPathIdentity(file, 'Detox connection action file', 1);
  } catch (error) {
    const cause =
      error instanceof DetoxConnectionEvidenceRecoveryError ? error.details.cause : undefined;
    if ((cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return 'absent';
    throw error;
  }
  if (!sameStat(observed, expected))
    throw recovery('Detox connection action file ownership is uncertain; retained', {
      status: 'retained',
      recovery: 'retention-only-no-conditional-unlink',
      expected,
      observed,
    });
  // Never unlink here. A replacement can occur after the identity check and
  // POSIX does not provide an inode-compare-and-delete primitive.
  await checkLive(options);
  await readRootIdentity(ownedRoot.path, rootIdentity);
  return 'retained';
}

export async function writeAtomicDetoxConnectionBytes(
  root: string,
  name: string,
  bytes: Buffer,
  maxBytes: number,
  options: DetoxConnectionEvidenceDirectoryLifecycle = {},
): Promise<DetoxConnectionEvidenceRead> {
  // This is the production export used by the driver and IPC layers. Keep the
  // descriptor-backed implementation as the only writer path so tests cannot
  // accidentally qualify an additive helper while callers still use the old
  // pathname implementation.
  return writeAtomicDetoxConnectionBytesDescriptorSafe(root, name, bytes, maxBytes, options);
}

export async function ensureDetoxConnectionArtifactRoot(
  root: string,
  options: DetoxConnectionEvidenceLifecycle = {},
): Promise<void> {
  const resolved = path.resolve(root);
  try {
    // Root creation is deliberately outside this helper. The caller must
    // supply a separately owned, canonical mkdtemp/private directory. This
    // prevents recursive path mkdir/chmod from mutating a replaced ancestor
    // before the descriptor-backed sidecar can bind its root identity.
    await checkLive(options);
    const ownedRoot = await canonicalOwnedRoot(resolved);
    await checkLive(options);
    await readRootIdentity(ownedRoot.path, ownedRoot.metadata);
    await checkLive(options);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT')
      throw recovery('Detox connection artifact root must be pre-created by its owner', {
        status: 'root-not-created',
        recovery: 'creation-disabled-no-path-mutation',
        root: resolved,
      });
    throw error;
  }
}

export type DetoxConnectionEvidenceDirectoryLifecycle = DetoxConnectionEvidenceLifecycle & {
  /** The caller's already-verified root identity, when writing recovery data. */
  expectedRootIdentity?: DetoxConnectionEvidenceDirectoryIdentity;
  afterDirectoryOpen?: (input: { root: string }) => void | Promise<void>;
};

type AncestorSafeMessage = Readonly<{
  type:
    | 'opened'
    | 'temp-ready'
    | 'published'
    | 'result'
    | 'error'
    | 'outer-recovery'
    | 'before-recovery-unlink';
  rootIdentity?: Record<string, unknown>;
  tempName?: string;
  finalName?: string;
  target?: string;
  recoveryName?: string;
  tempIdentity?: Record<string, unknown>;
  finalIdentity?: Record<string, unknown>;
  publicationMethod?: string;
  bytesBase64?: string;
  metadata?: Record<string, unknown>;
  sourcePin?: { path?: string; sha256?: string; bytes?: number };
  stage?: string;
  error?: string;
  cleanup?: readonly unknown[];
}>;

type PendingPublicationStage =
  | 'starting'
  | 'opened'
  | 'temp-ready'
  | 'published'
  | 'before-recovery-unlink'
  | 'result'
  | 'error'
  | 'outer-recovery';

type PendingPublication = {
  root: string;
  name: string;
  stage: PendingPublicationStage;
  tempName?: string;
  tempIdentity?: DetoxConnectionEvidenceStat;
  finalIdentity?: DetoxConnectionEvidenceStat;
};

// Publication state is process-local and is removed only after the owned sidecar
// has been reaped. The final inode checks below keep this registry from turning
// an unrelated file with the same name into publication evidence.
const pendingPublications = new Map<string, Set<PendingPublication>>();

function pendingPublicationKey(root: string, name: string): string {
  return `${root}\0${name}`;
}

function registerPendingPublication(root: string, name: string): PendingPublication {
  const entry: PendingPublication = { root, name, stage: 'starting' };
  const key = pendingPublicationKey(root, name);
  const entries = pendingPublications.get(key) ?? new Set<PendingPublication>();
  entries.add(entry);
  pendingPublications.set(key, entries);
  return entry;
}

function updatePendingPublication(entry: PendingPublication, message: AncestorSafeMessage): void {
  if (message.type === 'opened') entry.stage = 'opened';
  else if (message.type === 'temp-ready') entry.stage = 'temp-ready';
  else if (message.type === 'published') entry.stage = 'published';
  else if (message.type === 'result') entry.stage = 'result';
  else if (message.type === 'before-recovery-unlink') entry.stage = 'before-recovery-unlink';
  else if (message.type === 'outer-recovery') entry.stage = 'outer-recovery';
  else if (message.type === 'error') entry.stage = 'error';

  if (message.tempName) entry.tempName = message.tempName;
  const tempIdentity = messageIdentity(message.tempIdentity);
  if (tempIdentity) entry.tempIdentity = tempIdentity;
  const finalIdentity = messageIdentity(message.finalIdentity);
  if (finalIdentity) entry.finalIdentity = finalIdentity;
}

function unregisterPendingPublication(entry: PendingPublication): void {
  const key = pendingPublicationKey(entry.root, entry.name);
  const entries = pendingPublications.get(key);
  if (!entries) return;
  entries.delete(entry);
  if (entries.size === 0) pendingPublications.delete(key);
}

async function pendingPublicationMatches(
  entry: PendingPublication,
  root: string,
  name: string,
  observedPublication?: DetoxConnectionEvidenceStat,
): Promise<boolean> {
  if (entry.stage === 'error' || entry.stage === 'outer-recovery') return false;
  if (
    observedPublication &&
    (!entry.finalIdentity || !samePublicationIdentity(entry.finalIdentity, observedPublication))
  )
    return false;

  if (entry.finalIdentity) {
    try {
      const finalPath = path.join(root, name);
      const metadata = await lstat(finalPath);
      if (
        metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        (metadata.mode & 0o777) === 0o600 &&
        (typeof process.getuid !== 'function' || metadata.uid === process.getuid()) &&
        samePublicationIdentity(entry.finalIdentity, metadata) &&
        (!observedPublication || samePublicationIdentity(observedPublication, metadata))
      )
        return true;
    } catch {
      // The owned inode may have moved into bounded recovery.
    }
  }

  if (entry.tempIdentity && entry.tempName) {
    const temporaryPath = path.join(root, entry.tempName);
    if (path.dirname(temporaryPath) !== root) return false;
    try {
      const metadata = await lstat(temporaryPath);
      if (
        metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        (metadata.mode & 0o777) === 0o600 &&
        (typeof process.getuid !== 'function' || metadata.uid === process.getuid()) &&
        samePublicationIdentity(entry.tempIdentity, metadata)
      )
        return true;
    } catch {
      // Publication may have advanced between protocol and path inspection.
    }
  }

  // Before the sidecar reports an inode, the owned process itself is the only
  // proof available. Do not use this branch once an inode identity was reported.
  return (entry.stage === 'starting' || entry.stage === 'opened') && !observedPublication;
}

async function hasPendingPublication(
  root: string,
  name: string,
  observedPublication?: DetoxConnectionEvidenceStat,
): Promise<boolean> {
  const entries = pendingPublications.get(pendingPublicationKey(root, name));
  if (!entries) return false;
  for (const entry of entries) {
    if (await pendingPublicationMatches(entry, root, name, observedPublication)) return true;
  }
  return false;
}

type SidecarSourcePin = Readonly<{
  path: string;
  sha256: string;
  bytes: number;
}>;
type MutableDetoxConnectionEvidenceWriterReceipt = {
  pid: number;
  pgid: number;
  startedAt: string;
  startedMonotonicMs: number;
  startIdentity: string;
  commandHash: string;
  sourcePin: Readonly<{ path: string; sha256: string; bytes: number }>;
  exitCode: number | null;
  signal: string | null;
  killed: boolean;
  timedOut: boolean;
  reaped: boolean;
  spawnError?: string;
  stdinError?: string;
};

const ANCESTOR_SAFE_WRITER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'detox-connection-ancestor-safe.py',
);

type SidecarSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions & { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcess;

let spawnSidecar: SidecarSpawn = (command, args, options) => spawn(command, args, options);

/** @internal Source-only control seam; production callers never replace this. */
export function __setDetoxConnectionEvidenceSpawnForTests(next: SidecarSpawn): () => void {
  const previous = spawnSidecar;
  spawnSidecar = next;
  return () => {
    spawnSidecar = previous;
  };
}

function redactedWriterReason(reason: unknown): string {
  const value = reason instanceof Error ? reason.message : String(reason);
  return value.replace(/[\r\n\t]/g, ' ').slice(0, 256);
}

async function readSidecarSourcePin(): Promise<SidecarSourcePin> {
  const resolved = path.resolve(ANCESTOR_SAFE_WRITER);
  const canonical = await realpath(resolved);
  if (canonical !== resolved) throw new Error('Detox connection sidecar source is not canonical');
  const metadata = await lstat(canonical);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) ||
    (metadata.mode & 0o022) !== 0
  )
    throw new Error('Detox connection sidecar source is not an owned immutable file');
  if (metadata.size <= 0 || metadata.size > 2 * 1024 * 1024)
    throw new Error('Detox connection sidecar source exceeds its bound');
  const source = await readFile(canonical);
  if (source.byteLength !== metadata.size)
    throw new Error('Detox connection sidecar source changed while being pinned');
  return {
    path: canonical,
    bytes: source.byteLength,
    sha256: createHash('sha256').update(source).digest('hex'),
  };
}

function messageIdentity(
  value: Record<string, unknown> | undefined,
): DetoxConnectionEvidenceStat | undefined {
  if (!value) return undefined;
  const numeric = (key: string): number | undefined => {
    const candidate = value[key];
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
  };
  const dev = numeric('dev');
  const ino = numeric('ino');
  const uid = numeric('uid');
  const gid = numeric('gid');
  const mode = numeric('mode');
  const nlink = numeric('nlink');
  const size = numeric('size');
  const mtimeMs = numeric('mtimeMs');
  const ctimeMs = numeric('ctimeMs');
  if (
    dev === undefined ||
    ino === undefined ||
    uid === undefined ||
    gid === undefined ||
    mode === undefined ||
    nlink === undefined ||
    size === undefined ||
    mtimeMs === undefined ||
    ctimeMs === undefined
  )
    return undefined;
  return { dev, ino, uid, gid, mode, nlink, size, mtimeMs, ctimeMs };
}

function sameMessageIdentity(
  left: Record<string, unknown> | undefined,
  right: DetoxConnectionEvidenceStat,
): boolean {
  const actual = messageIdentity(left);
  return (
    actual !== undefined &&
    actual.dev === right.dev &&
    actual.ino === right.ino &&
    actual.uid === right.uid &&
    actual.gid === right.gid &&
    actual.mode === right.mode &&
    actual.nlink === right.nlink &&
    actual.size === right.size
  );
}

function rawControlMessage(child: ReturnType<typeof spawn>, value: Record<string, unknown>): void {
  const stdin = child.stdin;
  if (!stdin || stdin.destroyed || stdin.writableEnded || stdin.writableFinished || !stdin.writable)
    return;
  const line = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(line) > MAX_SIDECAR_FRAME_BYTES) return;
  try {
    stdin.write(line);
  } catch {
    // A closed child stdin is a recovery observation. The child error listener
    // records asynchronous EPIPE; abort/termination must remain bounded.
  }
}

async function sendAncestorSafeMessage(
  child: ReturnType<typeof spawn>,
  value: Record<string, unknown>,
  stopped: Promise<never>,
): Promise<void> {
  const stdin = child.stdin;
  if (!stdin || stdin.destroyed || stdin.writableEnded || stdin.writableFinished || !stdin.writable)
    throw new DetoxConnectionEvidenceRecoveryError('Writer stdin closed');
  const line = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(line) > MAX_SIDECAR_FRAME_BYTES)
    throw new DetoxConnectionEvidenceRecoveryError('Writer protocol frame exceeds its bound');
  let accepted: boolean;
  try {
    accepted = stdin.write(line);
  } catch (error) {
    throw new DetoxConnectionEvidenceRecoveryError('Writer stdin closed during protocol write', {
      cause: redactedWriterReason(error),
    });
  }
  if (accepted) return;
  let onDrain: (() => void) | undefined;
  let onError: ((error: Error) => void) | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        onDrain = resolve;
        onError = reject;
        stdin.once('drain', onDrain);
        stdin.once('error', onError);
      }),
      stopped,
    ]);
  } finally {
    if (onDrain) stdin.removeListener('drain', onDrain);
    if (onError) stdin.removeListener('error', onError);
  }
}

function signalOwnedChild(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): boolean {
  const pid = child.pid;
  if (!pid || pid <= 1 || pid === process.pid) return false;
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      // Detached process groups are preferred; fall through to the direct child.
    }
  }
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

/** The existing writer export delegates here; this is the one production path. */
async function writeAtomicDetoxConnectionBytesDescriptorSafe(
  root: string,
  name: string,
  bytes: Buffer,
  maxBytes: number,
  options: DetoxConnectionEvidenceDirectoryLifecycle = {},
): Promise<DetoxConnectionEvidenceRead> {
  assertName(name);
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length === 0 ||
    bytes.length > maxBytes ||
    bytes.length > MAX_SIDECAR_PAYLOAD_BYTES ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > MAX_SIDECAR_DECLARED_PAYLOAD_BYTES
  )
    throw new Error('Detox connection evidence payload is empty or exceeds its bound');

  const resolvedRoot = path.resolve(root);
  const initialRoot = await canonicalOwnedRoot(resolvedRoot, options.expectedRootIdentity);
  await checkLive(options);
  const sourcePin = await readSidecarSourcePin();
  const payloadBase64 = bytes.toString('base64');
  const commandHash = createHash('sha256')
    .update(
      JSON.stringify({
        executable: '/usr/bin/python3',
        script: sourcePin,
        detached: true,
      }),
    )
    .digest('hex');
  const child = spawnSidecar('/usr/bin/python3', [sourcePin.path], {
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      NODE_ENV: 'production',
      PATH: '/usr/bin:/bin',
      LC_ALL: 'C',
      LANG: 'C',
      PYTHONNOUSERSITE: '1',
      PYTHONUNBUFFERED: '1',
    },
  });
  const startedAt = new Date().toISOString();
  const startedMonotonicMs = performance.now();
  const writer: MutableDetoxConnectionEvidenceWriterReceipt = {
    pid: child.pid ?? 0,
    pgid: child.pid ?? 0,
    startedAt,
    startedMonotonicMs,
    startIdentity: '',
    commandHash,
    sourcePin,
    exitCode: null,
    signal: null,
    killed: false,
    timedOut: false,
    reaped: false,
  };
  const onStdinError = (error: Error): void => {
    writer.stdinError = redactedWriterReason(error);
  };
  child.stdin?.on('error', onStdinError);
  let closeSettled = false;
  let spawnError: Error | undefined;
  const childClosed = new Promise<void>((resolve) => {
    child.once('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error));
      writer.spawnError = redactedWriterReason(spawnError);
    });
    child.once('close', (code, signal) => {
      writer.exitCode = code;
      writer.signal = signal;
      writer.reaped = true;
      closeSettled = true;
      resolve();
    });
  });
  if (!writer.pid || writer.pid === process.pid) {
    await Promise.race([childClosed, delay(SIDECAR_KILL_GRACE_MS)]);
    if (!closeSettled) signalOwnedChild(child, 'SIGKILL');
    await Promise.race([childClosed, delay(SIDECAR_KILL_GRACE_MS)]);
    throw new DetoxConnectionEvidenceRecoveryError('Writer child identity was not acquired', {
      writer,
      childPid: child.pid ?? null,
      spawnError: spawnError?.message,
      recovery: 'owned-spawn-failure-with-reaped-child-listener',
    });
  }
  writer.startIdentity = `${writer.pid}:${writer.pgid}:${writer.startedAt}:${writer.startedMonotonicMs}:${writer.commandHash}`;
  const pendingPublication = registerPendingPublication(resolvedRoot, name);
  const protocol: Record<string, unknown>[] = [];
  const stderrParts: Buffer[] = [];
  let stderrBytes = 0;
  let stdoutBytes = 0;
  let stopReason: unknown;
  let stopReject: ((reason?: unknown) => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    stopReject = reject;
  });
  void stopped.catch(() => undefined);
  let terminationPromise: Promise<void> | undefined;
  const terminateChild = (reason: unknown, timedOut = false, sendAbort = true): Promise<void> => {
    if (terminationPromise) return terminationPromise;
    stopReason ??= reason;
    writer.timedOut ||= timedOut;
    writer.killed = true;
    stopReject?.(reason);
    terminationPromise = (async () => {
      if (sendAbort) {
        rawControlMessage(child, {
          ...(protocol.some((message) => message.type === 'result')
            ? { outerAbort: true }
            : { abort: true }),
          reason: redactedWriterReason(reason),
        });
      }
      signalOwnedChild(child, 'SIGTERM');
      await Promise.race([childClosed, delay(SIDECAR_KILL_GRACE_MS)]);
      if (!closeSettled) signalOwnedChild(child, 'SIGKILL');
      await Promise.race([childClosed, delay(1_000)]);
    })();
    return terminationPromise;
  };
  const abortListener = () => {
    void terminateChild(
      options.signal?.reason ?? new Error('Detox connection evidence operation cancelled'),
    );
  };
  options.signal?.addEventListener('abort', abortListener, { once: true });
  const wallRemaining = Number.isFinite(options.deadlineAt)
    ? Math.max(0, Number(options.deadlineAt) - performance.now())
    : DEFAULT_SIDECAR_WALL_MS;
  const wallTimer = setTimeout(
    () => {
      void terminateChild(new Error('Detox connection evidence sidecar deadline elapsed'), true);
    },
    Math.min(DEFAULT_SIDECAR_WALL_MS, wallRemaining),
  );
  const runBounded = async <T>(work: () => Promise<T> | T): Promise<T> =>
    await Promise.race([Promise.resolve().then(work), stopped]);
  const record = (message: AncestorSafeMessage): void => {
    updatePendingPublication(pendingPublication, message);
    protocol.push({
      type: message.type,
      stage: message.stage,
      tempName: message.tempName,
      finalName: message.finalName,
      target: message.target,
      recoveryName: message.recoveryName,
      tempIdentity: message.tempIdentity,
      finalIdentity: message.finalIdentity,
      publicationMethod: message.publicationMethod,
      sourcePin: message.sourcePin,
      cleanup: message.cleanup,
    });
  };
  const request = {
    op: 'publish',
    root: resolvedRoot,
    name,
    payloadBase64,
    maxBytes,
    sourcePin,
    expectedRootIdentity: {
      dev: initialRoot.metadata.dev,
      ino: initialRoot.metadata.ino,
      uid: initialRoot.metadata.uid,
      gid: initialRoot.metadata.gid,
      mode: initialRoot.metadata.mode,
    },
    pauseAfterOpen: true,
    pauseAtTempReady: true,
    pauseAtPublished: true,
    awaitOuterAck: true,
    pauseBeforeRecoveryUnlink: true,
  };
  let observedResult: AncestorSafeMessage | undefined;
  let outerAck = false;
  let outerAbortSent = false;
  let outerReadbackFailure: Error | undefined;
  let readback: DetoxConnectionEvidenceRead | undefined;
  const sendOuterAbort = (reason: unknown): void => {
    if (outerAbortSent) return;
    outerAbortSent = true;
    rawControlMessage(child, {
      outerAbort: true,
      reason: redactedWriterReason(reason),
    });
  };
  try {
    await runBounded(() => sendAncestorSafeMessage(child, request, stopped));
    if (!child.stdout || !child.stderr) throw new Error('Writer pipes were not acquired');
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_SIDECAR_FRAME_BYTES) {
        void terminateChild(new Error('Writer stdout exceeded its bound'));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrParts.reduce((sum, part) => sum + part.byteLength, 0) < MAX_SIDECAR_STDERR_BYTES)
        stderrParts.push(
          Buffer.from(chunk).subarray(
            0,
            MAX_SIDECAR_STDERR_BYTES - Math.max(0, stderrBytes - chunk.byteLength),
          ),
        );
      if (stderrBytes > MAX_SIDECAR_STDERR_BYTES)
        void terminateChild(new Error('Writer stderr exceeded its bound'));
    });
    const lines = createInterface({ input: child.stdout });
    for await (const line of lines) {
      if (Buffer.byteLength(line) > MAX_SIDECAR_FRAME_BYTES) {
        throw new DetoxConnectionEvidenceRecoveryError('Writer output frame exceeds its bound', {
          writer,
        });
      }
      if (!line.trim()) continue;
      let message: AncestorSafeMessage;
      try {
        message = JSON.parse(line) as AncestorSafeMessage;
      } catch (error) {
        throw new DetoxConnectionEvidenceRecoveryError('Writer emitted malformed protocol JSON', {
          cause: redactedWriterReason(error),
          writer,
        });
      }
      record(message);
      if (message.type === 'opened') {
        await runBounded(() => checkLive(options));
        await runBounded(() => options.afterDirectoryOpen?.({ root: resolvedRoot }));
        await runBounded(() => sendAncestorSafeMessage(child, { continue: true }, stopped));
      } else if (message.type === 'temp-ready') {
        await runBounded(() => checkLive(options));
        await runBounded(() =>
          options.beforePublish?.({
            temporary: path.join(resolvedRoot, message.tempName ?? ''),
            final: path.join(resolvedRoot, name),
          }),
        );
        await runBounded(() => sendAncestorSafeMessage(child, { continue: true }, stopped));
      } else if (message.type === 'published') {
        await runBounded(() => checkLive(options));
        await runBounded(() =>
          options.afterPublish?.({
            temporary: path.join(resolvedRoot, message.tempName ?? ''),
            final: path.join(resolvedRoot, name),
          }),
        );
        await runBounded(() => sendAncestorSafeMessage(child, { continue: true }, stopped));
      } else if (message.type === 'before-recovery-unlink') {
        await runBounded(() => checkLive(options));
        await runBounded(() =>
          options.beforeRecoveryUnlink?.({
            target: message.target ?? '',
            recovery: path.join(resolvedRoot, message.recoveryName ?? ''),
          }),
        );
        await runBounded(() => sendAncestorSafeMessage(child, { continue: true }, stopped));
      } else if (message.type === 'error') {
        throw new DetoxConnectionEvidenceRecoveryError(
          `Descriptor-safe Detox connection publication failed: ${redactedWriterReason(message.error ?? 'unknown error')}`,
          {
            stage: message.stage,
            cleanup: message.cleanup ?? [],
            writer,
            protocol,
            outerReadbackFailure: outerReadbackFailure
              ? redactedWriterReason(outerReadbackFailure)
              : undefined,
          },
        );
      } else if (message.type === 'result') {
        observedResult = message;
        try {
          if (
            message.bytesBase64 !== payloadBase64 ||
            !message.sourcePin ||
            message.sourcePin.path !== sourcePin.path ||
            message.sourcePin.sha256 !== sourcePin.sha256 ||
            message.sourcePin.bytes !== sourcePin.bytes ||
            (() => {
              const finalIdentity = messageIdentity(message.finalIdentity);
              const metadata = messageIdentity(message.metadata);
              return (
                finalIdentity === undefined ||
                metadata === undefined ||
                !sameStat(finalIdentity, metadata)
              );
            })()
          )
            throw new DetoxConnectionEvidenceRecoveryError(
              'Writer result identity or source pin changed',
              {
                writer,
                protocol,
                finalIdentity: message.finalIdentity,
                metadata: message.metadata,
              },
            );
          await runBounded(() => checkLive(options));
          await runBounded(() => readRootIdentity(initialRoot.path, initialRoot.metadata));
          readback = await runBounded(() =>
            readOwnedDetoxConnectionEvidence(resolvedRoot, name, maxBytes, options),
          );
          if (
            !readback.bytes.equals(bytes) ||
            !sameMessageIdentity(message.finalIdentity, readback.metadata)
          )
            throw new DetoxConnectionEvidenceRecoveryError(
              'Writer outer readback is not sidecar identity-bound',
              {
                writer,
                protocol,
                sidecarFinalIdentity: message.finalIdentity,
                readback: readback.metadata,
              },
            );
          await runBounded(() => sendAncestorSafeMessage(child, { outerAck: true }, stopped));
          outerAck = true;
        } catch (error) {
          outerReadbackFailure =
            error instanceof Error ? error : new Error(redactedWriterReason(error));
          sendOuterAbort(outerReadbackFailure);
        }
      } else if (message.type === 'outer-recovery') {
        record(message);
      }
    }
    await runBounded(() => childClosed);
    if (
      !observedResult ||
      !readback ||
      !outerAck ||
      spawnError ||
      writer.exitCode !== 0 ||
      !writer.reaped
    )
      throw new DetoxConnectionEvidenceRecoveryError(
        'Writer exited without a reaped acknowledged result',
        {
          writer,
          observed: observedResult,
          spawnError: spawnError?.message,
          protocol,
        },
      );
    return { ...readback, writer };
  } catch (error) {
    const original = error instanceof Error ? error : new Error(redactedWriterReason(error));
    if (observedResult && !outerAck) {
      sendOuterAbort(outerReadbackFailure ?? original);
      await Promise.race([childClosed, delay(SIDECAR_KILL_GRACE_MS)]);
    }
    await terminateChild(original, writer.timedOut, !observedResult);
    const cause = redactedWriterReason(original);
    throw new DetoxConnectionEvidenceRecoveryError(
      `Descriptor-safe Detox connection publication failed: ${cause}`,
      {
        cause,
        writer,
        protocol,
        stdoutBytes,
        stderrBytes,
        stderr: Buffer.concat(stderrParts).toString('utf8').slice(0, MAX_SIDECAR_STDERR_BYTES),
        recovery: 'bounded-owned-child-termination-and-sidecar-recovery',
        stopReason: stopReason ? redactedWriterReason(stopReason) : undefined,
      },
    );
  } finally {
    clearTimeout(wallTimer);
    options.signal?.removeEventListener('abort', abortListener);
    if (!closeSettled)
      await terminateChild(new Error('Writer finalization'), false, !observedResult);
    child.stdin?.removeListener('error', onStdinError);
    unregisterPendingPublication(pendingPublication);
  }
}
