import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  writeAtomicDetoxConnectionBytes,
  type DetoxConnectionEvidenceDirectoryIdentity,
  type DetoxConnectionEvidenceStat,
  type DetoxConnectionEvidenceWriterReceipt,
} from './detox-connection-evidence';
import { createNativePilotOutputRoot, type NativePilotInvocation } from './native-pilot-invocation';
import type { Stats } from 'node:fs';

const RUN_ID = /^[a-f0-9]{24}$/;
const RECOVERY_FILE = 'detox-connection-root-recovery.private.json';
const DEFAULT_CLEANUP_DEADLINE_MS = 30_000;
type RootOwnership = 'caller-bound' | 'outer-ownership-unknown';

type RootIdentity = DetoxConnectionEvidenceDirectoryIdentity;

export type DetoxConnectionArtifactRootRecovery = Readonly<{
  path: string;
  sha256: string;
  metadata: DetoxConnectionEvidenceStat;
  writer: DetoxConnectionEvidenceWriterReceipt;
}>;

type RecoveryLifecycle = Readonly<{
  signal?: AbortSignal;
  deadlineAt?: number;
}>;

export type DetoxConnectionArtifactRootCleanup = Readonly<{
  status: 'retained' | 'unknown';
  ownership: RootOwnership;
  reason: string;
  root: string;
  createdByCaller: boolean;
  recoveryPath: string | null;
}>;

export type DetoxConnectionArtifactRootLease = Readonly<{
  root: string;
  createdByCaller: boolean;
  ownership: RootOwnership;
  identity: RootIdentity;
  markTransferred(): void;
  isTransferred(): boolean;
  cleanupBeforeDriver(input: {
    reason: string;
    deadlineAt?: number;
    signal?: AbortSignal;
  }): Promise<DetoxConnectionArtifactRootCleanup>;
  retainRecovery(
    cleanup: DetoxConnectionArtifactRootCleanup,
    reason: string,
    input?: RecoveryLifecycle,
  ): Promise<string | null>;
  retainRecoveryEvidence(
    cleanup: DetoxConnectionArtifactRootCleanup,
    reason: string,
    input?: RecoveryLifecycle,
  ): Promise<DetoxConnectionArtifactRootRecovery | null>;
}>;

function currentUid(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

function boundedReason(reason: string): string {
  return reason.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 256);
}

function checkLive(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function checkDeadline(deadlineAt: number): void {
  if (!Number.isFinite(deadlineAt) || performance.now() >= deadlineAt)
    throw new Error('Detox artifact-root cleanup deadline elapsed');
}

function rootPath(root: string): string {
  const resolved = path.resolve(root);
  assert(
    RUN_ID.test(path.basename(resolved)),
    'Detox connection artifact root must end in a 24-character run ID',
  );
  assert(
    resolved.includes(`${path.sep}.qa${path.sep}artifacts${path.sep}`),
    'Detox connection artifact root must remain under .qa/artifacts',
  );
  return resolved;
}

function identity(metadata: Stats): RootIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    mode: metadata.mode & 0o777,
  };
}

function sameIdentity(left: RootIdentity, right: RootIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.mode === right.mode
  );
}

async function inspectOwnedRoot(root: string): Promise<RootIdentity> {
  const canonical = await realpath(root);
  assert.equal(canonical, root, 'Detox connection artifact root is not canonical');
  const metadata = await lstat(root);
  assert(
    metadata.isDirectory() && !metadata.isSymbolicLink(),
    'Detox connection artifact root is not a directory',
  );
  assert.equal(metadata.mode & 0o777, 0o700, 'Detox connection artifact root must be mode 0700');
  const uid = currentUid();
  if (uid !== undefined)
    assert.equal(metadata.uid, uid, 'Detox connection artifact root owner changed');
  return identity(metadata);
}

async function inspectSafeParent(root: string): Promise<void> {
  const parent = path.dirname(root);
  const canonical = await realpath(parent);
  assert.equal(canonical, parent, 'Detox connection artifact parent is not canonical');
  const metadata = await lstat(parent);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink());
  assert.equal(
    metadata.mode & 0o022,
    0,
    'Detox connection artifact parent must not be writable by group or other users',
  );
  const uid = currentUid();
  if (uid !== undefined) assert(metadata.uid === uid || metadata.uid === 0);
}

function isAlreadyExistingRoot(error: unknown): boolean {
  return (
    (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST' ||
    (error instanceof Error && /\bEEXIST\b/.test(error.message))
  );
}

function rootInvocation(
  root: string,
  selection: NativePilotInvocation['selection'] = {
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-connection-ios',
    mode: 'integration',
  },
): NativePilotInvocation {
  const runId = path.basename(root);
  return {
    selection,
    requestedRunId: runId,
    requestedAttemptId: `${runId}:first`,
    outputParent: path.dirname(root),
  };
}

function rootIdentityFromNativePilot(
  root: string,
  prepared: Awaited<ReturnType<typeof createNativePilotOutputRoot>>,
): RootIdentity {
  const output = prepared.namespaceIdentity.output.entries.at(-1);
  assert(output && output.path === root, 'Native pilot returned an unexpected artifact root');
  return {
    dev: output.dev,
    ino: output.ino,
    uid: output.uid,
    gid: output.gid,
    mode: output.mode & 0o777,
  };
}

async function retainOwnedRoot(
  root: string,
  expected: RootIdentity,
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<Pick<DetoxConnectionArtifactRootCleanup, 'status' | 'reason'>> {
  try {
    checkLive(signal);
    checkDeadline(deadlineAt);
    const observed = await inspectOwnedRoot(root);
    if (!sameIdentity(observed, expected))
      return {
        status: 'unknown',
        reason: 'artifact root identity changed before cleanup',
      };
    checkLive(signal);
    checkDeadline(deadlineAt);
    const entries = await readdir(root);
    if (entries.length !== 0)
      return {
        status: 'retained',
        reason: 'artifact root contains retained preflight evidence',
      };
    checkDeadline(deadlineAt);
    return {
      status: 'retained',
      reason: 'owned empty artifact root retained; conditional deletion is unavailable',
    };
  } catch (error) {
    return {
      status: 'unknown',
      reason: boundedReason(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function writeRecoveryRecordForRoot(
  root: string,
  expected: RootIdentity,
  cleanup: DetoxConnectionArtifactRootCleanup,
  reason: string,
  input: RecoveryLifecycle = {},
): Promise<DetoxConnectionArtifactRootRecovery | null> {
  try {
    const observed = await inspectOwnedRoot(root);
    if (!sameIdentity(observed, expected)) return null;
    const destination = path.join(root, RECOVERY_FILE);
    const bytes = Buffer.from(
      `${JSON.stringify(
        {
          kind: 'private-detox-connection-artifact-root-preflight-recovery-not-public-receipt',
          owner: 'detox-driver',
          root,
          createdByCaller: true,
          ownership: cleanup.ownership,
          cleanup,
          reason: boundedReason(reason),
        },
        null,
        2,
      )}\n`,
    );
    // Reuse the descriptor-backed writer so a late root replacement cannot
    // redirect recovery evidence into a foreign directory.
    const published = await writeAtomicDetoxConnectionBytes(root, RECOVERY_FILE, bytes, 64 * 1024, {
      signal: input.signal,
      deadlineAt: input.deadlineAt ?? performance.now() + DEFAULT_CLEANUP_DEADLINE_MS,
      expectedRootIdentity: expected,
    });
    if (published.realpath !== destination || !published.writer) return null;
    return {
      path: destination,
      sha256: createHash('sha256').update(published.bytes).digest('hex'),
      metadata: published.metadata,
      writer: published.writer,
    };
  } catch {
    return null;
  }
}

async function writeRecoveryRecord(
  lease: DetoxConnectionArtifactRootLease,
  cleanup: DetoxConnectionArtifactRootCleanup,
  reason: string,
  input: RecoveryLifecycle = {},
): Promise<DetoxConnectionArtifactRootRecovery | null> {
  if (!lease.createdByCaller || lease.isTransferred()) return null;
  return writeRecoveryRecordForRoot(lease.root, lease.identity, cleanup, reason, input);
}

export async function acquireDetoxConnectionArtifactRoot(input: {
  root: string;
  selection?: NativePilotInvocation['selection'];
  signal?: AbortSignal;
  deadlineAt?: number;
  /** Source-only fault seam for descriptor-worker boundary controls. */
  testWorkerDelayMs?: number;
  /** Source-only race seam: pause after parent identity, before mkdirat. */
  testWorkerDelayBeforeCreateMs?: number;
  /** Source-only race seam; production callers leave this unset. */
  testBeforeCreate?: () => void;
}): Promise<DetoxConnectionArtifactRootLease> {
  const root = rootPath(input.root);
  const acquisitionDeadlineAt = input.deadlineAt ?? performance.now() + DEFAULT_CLEANUP_DEADLINE_MS;
  checkLive(input.signal);
  checkDeadline(acquisitionDeadlineAt);
  await inspectSafeParent(root);
  checkLive(input.signal);
  checkDeadline(acquisitionDeadlineAt);
  let createdByCaller = false;
  let createdIdentity: RootIdentity | undefined;
  try {
    const prepared = await createNativePilotOutputRoot({
      invocation: rootInvocation(root, input.selection),
      defaultOutputParent: path.dirname(root),
      signal: input.signal,
      deadlineAt: acquisitionDeadlineAt,
      testWorkerDelayMs: input.testWorkerDelayMs ?? input.testWorkerDelayBeforeCreateMs,
      onOutputRootBeforeCreate: () => input.testBeforeCreate?.(),
      onOutputRootCreated: (outputRoot, namespaceIdentity) => {
        if (outputRoot !== root || !namespaceIdentity) return;
        const output = namespaceIdentity.output.entries.at(-1);
        if (output && output.path === root)
          createdIdentity = {
            dev: output.dev,
            ino: output.ino,
            uid: output.uid,
            gid: output.gid,
            mode: output.mode & 0o777,
          };
      },
    });
    createdIdentity = rootIdentityFromNativePilot(root, prepared);
    createdByCaller = true;
  } catch (error) {
    if (createdIdentity) {
      const provisional = await retainOwnedRoot(
        root,
        createdIdentity,
        acquisitionDeadlineAt,
        input.signal,
      );
      const cleanup: DetoxConnectionArtifactRootCleanup = {
        ...provisional,
        ownership: 'caller-bound',
        reason: `acquire preflight failed: ${provisional.reason}`,
        root,
        createdByCaller: true,
        recoveryPath: null,
      };
      const recovery = await writeRecoveryRecordForRoot(
        root,
        createdIdentity,
        cleanup,
        'acquire preflight failed',
        {
          signal: input.signal,
          deadlineAt: acquisitionDeadlineAt,
        },
      );
      throw new Error(
        `Detox artifact root preflight failed and cleanup is ${provisional.status}${
          recovery
            ? `; recovery retained at ${recovery.path}`
            : '; recovery publication unavailable'
        }`,
        { cause: error },
      );
    }
    if (!isAlreadyExistingRoot(error)) throw error;
    checkLive(input.signal);
    checkDeadline(acquisitionDeadlineAt);
  }

  let observed: RootIdentity;
  if (createdByCaller && createdIdentity) {
    observed = createdIdentity;
  } else {
    // A pre-existing root has no caller binding. UID/mode validation makes it
    // safe to inspect, but it cannot prove that this caller owns the namespace.
    checkDeadline(acquisitionDeadlineAt);
    observed = await inspectOwnedRoot(root);
    checkLive(input.signal);
    checkDeadline(acquisitionDeadlineAt);
  }

  let transferred = false;
  const lease = {
    root,
    createdByCaller,
    ownership: createdByCaller ? ('caller-bound' as const) : ('outer-ownership-unknown' as const),
    identity: observed,
    markTransferred(): void {
      transferred = true;
    },
    isTransferred(): boolean {
      return transferred;
    },
    async cleanupBeforeDriver(input: {
      reason: string;
      deadlineAt?: number;
      signal?: AbortSignal;
    }): Promise<DetoxConnectionArtifactRootCleanup> {
      assert(!transferred, 'Detox artifact root ownership already transferred to the driver');
      if (!createdByCaller)
        return {
          status: 'unknown',
          ownership: 'outer-ownership-unknown',
          reason:
            'pre-existing artifact root has no binding evidence; retained for its outer owner',
          root,
          createdByCaller: false,
          recoveryPath: null,
        };
      const result = await retainOwnedRoot(
        root,
        observed,
        input.deadlineAt ?? performance.now() + DEFAULT_CLEANUP_DEADLINE_MS,
        input.signal,
      );
      return {
        ...result,
        ownership: 'caller-bound',
        reason: `${boundedReason(input.reason)}: ${result.reason}`,
        root,
        createdByCaller: true,
        recoveryPath: null,
      };
    },
    async retainRecovery(
      cleanup: DetoxConnectionArtifactRootCleanup,
      reason: string,
      input: RecoveryLifecycle = {},
    ): Promise<string | null> {
      const recovery = await writeRecoveryRecord(lease, cleanup, reason, input);
      return recovery?.path ?? null;
    },
    async retainRecoveryEvidence(
      cleanup: DetoxConnectionArtifactRootCleanup,
      reason: string,
      input: RecoveryLifecycle = {},
    ): Promise<DetoxConnectionArtifactRootRecovery | null> {
      return writeRecoveryRecord(lease, cleanup, reason, input);
    },
  } satisfies DetoxConnectionArtifactRootLease;
  return Object.freeze(lease);
}
