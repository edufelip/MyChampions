import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants, type Stats } from 'node:fs';
import { lstat, open, readlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const deletedEntry = Buffer.from('deleted\0');
const regularEntry = Buffer.from('entry:regular\0');
const symlinkEntry = Buffer.from('entry:symlink\0');
const directoryEntry = Buffer.from('entry:directory\0');
const unknownEntry = Buffer.from('entry:unknown\0');
const repositoryIdentityReadChunkBytes = 64 * 1024;
const repositoryIdentityLengthBytes = 8;
const repositoryIdentityDigestBytes = 32;
const repositoryIdentityStatFields = [
  'dev',
  'ino',
  'uid',
  'gid',
  'mode',
  'nlink',
  'size',
  'mtimeMs',
  'ctimeMs',
] as const;

const repositoryIdentityObjects = new WeakSet<object>();
const repositoryObservationObjects = new WeakSet<object>();
const repositoryIdentityRoots = new WeakMap<object, string>();

export type RepositoryIdentity = {
  name: string;
  sha: string;
  dirty: boolean;
  workingTreeHash: string;
};

export type RepositoryEvidence = {
  status: 'observed' | 'partial' | 'unknown';
  missing: readonly string[];
  reason: string | null;
};

export type RepositoryObservation = {
  repositories: readonly RepositoryIdentity[];
  evidence: RepositoryEvidence;
};

export type RepositoryIdentityReadHooks = {
  /** Abort the git/file walk without leaving a raced Promise behind. */
  signal?: AbortSignal;
  beforeOpen?: (file: string) => void | Promise<void>;
  beforeReadlink?: (file: string) => void | Promise<void>;
  afterReadlink?: (file: string) => void | Promise<void>;
  /** Test-only boundary seam to abort after an owned descriptor is opened. */
  afterOpen?: (file: string) => void | Promise<void>;
  /** Test-only close acknowledgement for the descriptor finally block. */
  afterDescriptorClose?: (file: string) => void | Promise<void>;
  afterFirstRead?: (file: string) => void | Promise<void>;
};

export function isRepositoryIdentity(value: unknown): value is RepositoryIdentity {
  return typeof value === 'object' && value !== null && repositoryIdentityObjects.has(value);
}

export function isRepositoryObservation(value: unknown): value is RepositoryObservation {
  return typeof value === 'object' && value !== null && repositoryObservationObjects.has(value);
}

export function createRepositoryObservation(
  repositories: readonly RepositoryIdentity[],
  missing: readonly string[],
  expectedRoots: Readonly<Record<string, string>>,
): RepositoryObservation {
  if (expectedRoots === null || typeof expectedRoots !== 'object')
    throw new Error('Native pilot repository observation requires expected roots');
  if (!repositories.every(isRepositoryIdentity))
    throw new Error('Native pilot repository observation contains an unbound identity');
  const allowedNames = new Set(['client', 'server']);
  const names = new Set<string>();
  for (const repository of repositories) {
    if (!allowedNames.has(repository.name))
      throw new Error(`Native pilot repository observation has an invalid ${repository.name} name`);
    if (names.has(repository.name))
      throw new Error(`Native pilot repository observation repeats ${repository.name}`);
    names.add(repository.name);
    const observedRoot = repositoryIdentityRoots.get(repository);
    const expectedRoot = expectedRoots[repository.name];
    if (
      observedRoot === undefined ||
      typeof expectedRoot !== 'string' ||
      path.resolve(observedRoot) !== path.resolve(expectedRoot)
    )
      throw new Error(`Native pilot repository observation has an unbound ${repository.name} root`);
  }
  const uniqueMissing = [...new Set(missing)];
  if (uniqueMissing.some((name) => !allowedNames.has(name) || names.has(name)))
    throw new Error('Native pilot repository observation has invalid missing names');
  const expectedNames = new Set(Object.keys(expectedRoots));
  if ([...expectedNames].some((name) => !allowedNames.has(name)))
    throw new Error('Native pilot repository observation has invalid expected root names');
  if ([...expectedNames].some((name) => !names.has(name) && !uniqueMissing.includes(name)))
    throw new Error('Native pilot repository observation has an unreported expected root');
  if (repositories.length === 0 && uniqueMissing.length === 0)
    throw new Error('Native pilot unknown repository observation must name missing repositories');
  const status =
    repositories.length === 0 ? 'unknown' : uniqueMissing.length === 0 ? 'observed' : 'partial';
  const frozenMissing = Object.freeze([...new Set(missing)]);
  const evidence: RepositoryEvidence = Object.freeze({
    status,
    missing: frozenMissing,
    reason:
      status === 'observed'
        ? null
        : status === 'partial'
          ? 'repository identity was only partially available before the preflight receipt'
          : 'repository identity was unavailable before the preflight receipt',
  });
  const observation: RepositoryObservation = Object.freeze({
    repositories: Object.freeze([...repositories]),
    evidence,
  });
  repositoryObservationObjects.add(observation);
  return observation;
}

function checkReadSignal(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function statIdentity(stat: Stats): string {
  return repositoryIdentityStatFields.map((field) => String(stat[field])).join(':');
}

function appendMode(fingerprint: ReturnType<typeof createHash>, mode: number): void {
  fingerprint.update(Buffer.from(`${mode.toString(8)}\0`));
}

function appendLength(fingerprint: ReturnType<typeof createHash>, length: number): void {
  if (!Number.isSafeInteger(length) || length < 0)
    throw new Error(`repository identity entry length is invalid: ${length}`);
  const encoded = Buffer.alloc(repositoryIdentityLengthBytes);
  encoded.writeBigUInt64BE(BigInt(length));
  fingerprint.update(encoded);
}

function appendFramedBytes(
  fingerprint: ReturnType<typeof createHash>,
  entry: Buffer,
  bytes: Buffer,
): void {
  fingerprint.update(entry);
  appendLength(fingerprint, bytes.length);
  fingerprint.update(bytes);
}

function appendFramedDigest(
  fingerprint: ReturnType<typeof createHash>,
  entry: Buffer,
  size: number,
  digest: Buffer,
): void {
  if (digest.length !== repositoryIdentityDigestBytes)
    throw new Error(`repository identity digest length is invalid: ${digest.length}`);
  fingerprint.update(entry);
  appendLength(fingerprint, size);
  fingerprint.update(digest);
}

async function appendWorkingTreeEntry(
  fingerprint: ReturnType<typeof createHash>,
  root: string,
  file: string,
  hooks: RepositoryIdentityReadHooks,
): Promise<void> {
  const target = path.join(root, file);
  try {
    checkReadSignal(hooks.signal);
    const metadata = await lstat(target);
    checkReadSignal(hooks.signal);
    if (metadata.isSymbolicLink()) {
      if (hooks.beforeReadlink) await hooks.beforeReadlink(file);
      checkReadSignal(hooks.signal);
      const linkTarget = await readlink(target);
      checkReadSignal(hooks.signal);
      if (hooks.afterReadlink) await hooks.afterReadlink(file);
      checkReadSignal(hooks.signal);
      const metadataAfterFirstRead = await lstat(target);
      checkReadSignal(hooks.signal);
      const linkTargetAfter = await readlink(target);
      checkReadSignal(hooks.signal);
      const metadataAfterSecondRead = await lstat(target);
      checkReadSignal(hooks.signal);
      if (
        !metadataAfterFirstRead.isSymbolicLink() ||
        !metadataAfterSecondRead.isSymbolicLink() ||
        statIdentity(metadata) !== statIdentity(metadataAfterFirstRead) ||
        statIdentity(metadata) !== statIdentity(metadataAfterSecondRead) ||
        linkTarget !== linkTargetAfter
      )
        throw new Error(`working-tree symlink changed while reading ${file}`);
      appendFramedBytes(fingerprint, symlinkEntry, Buffer.from(linkTarget, 'utf8'));
      return;
    }
    if (metadata.isFile()) {
      if (typeof fsConstants.O_NOFOLLOW !== 'number')
        throw new Error('repository identity reader cannot enforce no-follow opens');
      if (hooks.beforeOpen) await hooks.beforeOpen(file);
      checkReadSignal(hooks.signal);
      const descriptor = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const contentDigest = createHash('sha256');
      let contentSize = 0;
      try {
        checkReadSignal(hooks.signal);
        if (hooks.afterOpen) await hooks.afterOpen(file);
        checkReadSignal(hooks.signal);
        const descriptorBefore = await descriptor.stat();
        checkReadSignal(hooks.signal);
        if (!descriptorBefore.isFile() || statIdentity(metadata) !== statIdentity(descriptorBefore))
          throw new Error(`working-tree file changed before descriptor read ${file}`);
        const chunk = Buffer.allocUnsafe(repositoryIdentityReadChunkBytes);
        contentSize = descriptorBefore.size;
        let remaining = contentSize;
        let readHookCalled = false;
        while (remaining > 0) {
          checkReadSignal(hooks.signal);
          const result = await descriptor.read(chunk, 0, Math.min(chunk.length, remaining), null);
          checkReadSignal(hooks.signal);
          if (result.bytesRead <= 0)
            throw new Error(`working-tree file truncated while reading ${file}`);
          contentDigest.update(chunk.subarray(0, result.bytesRead));
          remaining -= result.bytesRead;
          if (!readHookCalled && hooks.afterFirstRead) {
            readHookCalled = true;
            await hooks.afterFirstRead(file);
            checkReadSignal(hooks.signal);
          }
        }
        if (!readHookCalled && hooks.afterFirstRead) {
          await hooks.afterFirstRead(file);
          checkReadSignal(hooks.signal);
        }
        checkReadSignal(hooks.signal);
        const extra = await descriptor.read(chunk, 0, 1, null);
        checkReadSignal(hooks.signal);
        if (extra.bytesRead !== 0) throw new Error(`working-tree file grew while reading ${file}`);
        const descriptorAfter = await descriptor.stat();
        checkReadSignal(hooks.signal);
        const metadataAfter = await lstat(target);
        checkReadSignal(hooks.signal);
        if (
          statIdentity(descriptorBefore) !== statIdentity(descriptorAfter) ||
          statIdentity(descriptorBefore) !== statIdentity(metadataAfter) ||
          !metadataAfter.isFile()
        )
          throw new Error(`working-tree file changed while reading ${file}`);
      } finally {
        await descriptor.close();
        if (hooks.afterDescriptorClose) await hooks.afterDescriptorClose(file);
      }
      appendFramedDigest(fingerprint, regularEntry, contentSize, contentDigest.digest());
      return;
    }
    if (metadata.isDirectory()) {
      checkReadSignal(hooks.signal);
      fingerprint.update(directoryEntry);
      appendMode(fingerprint, metadata.mode & 0o7777);
      return;
    }
    // Git can expose an index path whose working-tree node is a FIFO or another
    // non-regular type. Record its type/mode without opening or draining it.
    checkReadSignal(hooks.signal);
    fingerprint.update(unknownEntry);
    appendMode(fingerprint, metadata.mode & 0o170000);
    appendMode(fingerprint, metadata.mode & 0o7777);
  } catch (error) {
    checkReadSignal(hooks.signal);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fingerprint.update(deletedEntry);
      return;
    }
    throw error;
  }
}

export async function repositoryIdentity(
  root: string,
  name = 'client',
  hooks: RepositoryIdentityReadHooks = {},
) {
  checkReadSignal(hooks.signal);
  const sha = (
    await execute('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      timeout: 5000,
      signal: hooks.signal,
    })
  ).stdout.trim();
  checkReadSignal(hooks.signal);
  const status = (
    await execute('git', ['status', '--porcelain'], {
      cwd: root,
      timeout: 5000,
      signal: hooks.signal,
    })
  ).stdout;
  checkReadSignal(hooks.signal);
  const fingerprint = createHash('sha256').update(status);
  const files = (
    await execute('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
      signal: hooks.signal,
    })
  ).stdout
    .split('\0')
    .filter(Boolean)
    .sort();
  checkReadSignal(hooks.signal);
  for (const file of files) {
    checkReadSignal(hooks.signal);
    fingerprint.update(file).update('\0');
    await appendWorkingTreeEntry(fingerprint, root, file, hooks);
  }
  checkReadSignal(hooks.signal);
  const identity: RepositoryIdentity = {
    name,
    sha,
    dirty: Boolean(status),
    workingTreeHash: fingerprint.digest('hex'),
  };
  Object.freeze(identity);
  repositoryIdentityObjects.add(identity);
  repositoryIdentityRoots.set(identity, path.resolve(root));
  return identity;
}
