import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  ensureDetoxConnectionArtifactRoot,
  writeAtomicDetoxConnectionBytes,
  type DetoxConnectionEvidenceDirectoryIdentity,
  type DetoxConnectionEvidenceDirectoryLifecycle,
  type DetoxConnectionEvidenceLifecycle,
} from './detox-connection-evidence';

const MAX_PRIVATE_BYTES = 8 * 1024 * 1024;

export type DetoxCameraEvidenceLifecycle = Readonly<{
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
  checkLive?: () => void | Promise<void>;
  beforePublish?: DetoxConnectionEvidenceLifecycle['beforePublish'];
  afterPublish?: DetoxConnectionEvidenceLifecycle['afterPublish'];
  beforeRecoveryUnlink?: DetoxConnectionEvidenceLifecycle['beforeRecoveryUnlink'];
  afterDirectoryOpen?: DetoxConnectionEvidenceDirectoryLifecycle['afterDirectoryOpen'];
}>;

export type OwnedExclusiveWriteOptions = DetoxCameraEvidenceLifecycle & {
  expectedRootIdentity?: DetoxConnectionEvidenceDirectoryIdentity;
};

export type OwnedExclusiveWrite = Readonly<{
  path: string;
  sha256: string;
  bytes: number;
  mode: number;
}>;

export async function requireDetoxCameraEvidenceLive(
  options: DetoxCameraEvidenceLifecycle,
): Promise<void> {
  if (options.signal.aborted)
    throw options.signal.reason ?? new Error('Detox camera evidence operation cancelled');
  if (
    !Number.isFinite(options.deadlineAtMonotonicMs) ||
    performance.now() >= options.deadlineAtMonotonicMs
  )
    throw new Error('Detox camera evidence operation deadline elapsed');
  await options.checkLive?.();
  if (options.signal.aborted)
    throw options.signal.reason ?? new Error('Detox camera evidence operation cancelled');
  if (performance.now() >= options.deadlineAtMonotonicMs)
    throw new Error('Detox camera evidence operation deadline elapsed');
}

function connectionLifecycle(
  options: DetoxCameraEvidenceLifecycle,
): DetoxConnectionEvidenceDirectoryLifecycle {
  return {
    signal: options.signal,
    deadlineAt: options.deadlineAtMonotonicMs,
    checkLive: options.checkLive,
    beforePublish: options.beforePublish,
    afterPublish: options.afterPublish,
    beforeRecoveryUnlink: options.beforeRecoveryUnlink,
    afterDirectoryOpen: options.afterDirectoryOpen,
  };
}

/**
 * Publish one private camera receipt through the already-qualified descriptor-
 * relative Detox writer. The root must have been created and owned before this
 * function is called; recursive pathname mkdir is deliberately unavailable.
 */
export async function writeOwnedExclusive(
  root: string,
  name: string,
  bytes: Buffer,
  options: OwnedExclusiveWriteOptions,
): Promise<OwnedExclusiveWrite> {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_PRIVATE_BYTES)
    throw new Error('Detox iOS camera private evidence payload is empty or exceeds its bound');
  await requireDetoxCameraEvidenceLive(options);
  const resolvedRoot = path.resolve(root);
  const canonicalRoot = await realpath(resolvedRoot);
  if (canonicalRoot !== resolvedRoot)
    throw new Error('Detox iOS camera private evidence root is not canonical');
  const rootMetadata = await lstat(canonicalRoot);
  if (
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    (rootMetadata.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === 'function' && rootMetadata.uid !== process.getuid())
  )
    throw new Error('Detox iOS camera private evidence root is not an owned 0700 directory');
  await requireDetoxCameraEvidenceLive(options);
  const lifecycle = connectionLifecycle(options);
  await ensureDetoxConnectionArtifactRoot(resolvedRoot, lifecycle);
  await requireDetoxCameraEvidenceLive(options);
  const written = await writeAtomicDetoxConnectionBytes(
    resolvedRoot,
    name,
    bytes,
    MAX_PRIVATE_BYTES,
    {
      ...options,
      ...lifecycle,
      expectedRootIdentity: options.expectedRootIdentity ?? {
        dev: rootMetadata.dev,
        ino: rootMetadata.ino,
        uid: rootMetadata.uid,
        gid: rootMetadata.gid,
        mode: rootMetadata.mode,
      },
    },
  );
  await requireDetoxCameraEvidenceLive(options);
  const finalCanonicalRoot = await realpath(resolvedRoot);
  const finalRootMetadata = await lstat(resolvedRoot);
  if (
    finalCanonicalRoot !== resolvedRoot ||
    !finalRootMetadata.isDirectory() ||
    finalRootMetadata.isSymbolicLink() ||
    finalRootMetadata.dev !== rootMetadata.dev ||
    finalRootMetadata.ino !== rootMetadata.ino ||
    finalRootMetadata.uid !== rootMetadata.uid ||
    finalRootMetadata.gid !== rootMetadata.gid ||
    (finalRootMetadata.mode & 0o777) !== (rootMetadata.mode & 0o777)
  )
    throw new Error('Detox iOS camera private evidence root changed after publication');
  await requireDetoxCameraEvidenceLive(options);
  const finalPath = path.join(resolvedRoot, name);
  const finalMetadata = await lstat(finalPath);
  if (
    !finalMetadata.isFile() ||
    finalMetadata.isSymbolicLink() ||
    finalMetadata.nlink !== 1 ||
    (finalMetadata.mode & 0o777) !== 0o600 ||
    finalMetadata.size !== bytes.length ||
    (typeof process.getuid === 'function' && finalMetadata.uid !== process.getuid()) ||
    !written.bytes.equals(bytes)
  )
    throw new Error('Detox iOS camera private evidence failed descriptor-bound readback');
  await requireDetoxCameraEvidenceLive(options);
  return {
    path: finalPath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    mode: finalMetadata.mode & 0o777,
  };
}
