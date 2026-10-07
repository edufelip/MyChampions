import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, open, readdir, realpath, unlink } from 'node:fs/promises';
/* global Buffer */
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const TRAINING_PROTOCOL_SCHEMA = 1;
export const MAX_COMMAND_BYTES = 128 * 1024;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_XML_BYTES = 4 * 1024 * 1024;
export const MAX_SCREENSHOT_BYTES = 16 * 1024 * 1024;
export const MAX_ATTRIBUTES_BYTES = 256 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[a-f0-9]{24}$/;
const NAME = /^detox-training-[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.private\.json$/;
const EVIDENCE_NAME = /^detox-training-[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:json|xml|png)$/;
const READ_CHUNK_BYTES = 64 * 1024;
const RECOVERY_BUDGET_MS = 5_000;

export class TrainingPublicationRecoveryError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TrainingPublicationRecoveryError';
    this.code = 'TRAINING_PUBLICATION_RECOVERY';
    this.details = details;
  }
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function hashJson(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function hashBytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}

function assertLive(options = {}) {
  if (options.signal?.aborted)
    throw options.signal.reason ?? new Error('Detox training operation cancelled');
  if (Number.isFinite(options.deadlineAt) && performance.now() >= options.deadlineAt)
    throw new Error('Detox training operation deadline elapsed');
}

async function ownedRoot(root) {
  // Normalize parent components for portable callers, but never accept a
  // caller-supplied leaf symlink as the owned artifact root. A leaf alias
  // could otherwise pass realpath() and cause writes to mutate an unrelated
  // directory while appearing to be inside the caller's namespace.
  const suppliedRoot = path.resolve(root);
  const suppliedMetadata = await lstat(suppliedRoot);
  if (
    suppliedMetadata.isSymbolicLink() ||
    !suppliedMetadata.isDirectory() ||
    (suppliedMetadata.mode & 0o777) !== 0o700
  )
    throw new Error('training artifact root is not a private directory');
  if (typeof process.getuid === 'function' && suppliedMetadata.uid !== process.getuid())
    throw new Error('training artifact root owner changed');
  const canonicalRoot = await realpath(suppliedRoot);
  const metadata = await lstat(canonicalRoot);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o700 ||
    !sameDirectoryIdentity(suppliedMetadata, metadata)
  )
    throw new Error('training artifact root identity changed during normalization');
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    throw new Error('training artifact root owner changed');
  return canonicalRoot;
}

function directoryIdentity(meta) {
  return {
    dev: meta.dev,
    ino: meta.ino,
    uid: meta.uid,
    gid: meta.gid,
    mode: meta.mode & 0o777,
  };
}

function sameDirectoryIdentity(left, right) {
  return JSON.stringify(directoryIdentity(left)) === JSON.stringify(directoryIdentity(right));
}

async function readOwnedRootIdentity(root, expected) {
  let resolved;
  let metadata;
  try {
    resolved = await realpath(root);
    metadata = await lstat(root);
  } catch (error) {
    throw new TrainingPublicationRecoveryError('training artifact root cannot be inspected', {
      cause: error,
    });
  }
  if (resolved !== root)
    throw new TrainingPublicationRecoveryError('training artifact root realpath changed');
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) ||
    (expected && !sameDirectoryIdentity(metadata, expected))
  )
    throw new TrainingPublicationRecoveryError('training artifact root identity changed', {
      expected: expected ? directoryIdentity(expected) : undefined,
      observed: directoryIdentity(metadata),
    });
  return metadata;
}

function text(value, label, pattern) {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value)))
    throw new Error(`${label} is invalid`);
  return value;
}

function identity(value, label = 'child identity') {
  const row = record(value, label);
  if (!Number.isSafeInteger(row.pid) || row.pid <= 1) throw new Error(`${label} pid is invalid`);
  if (!Number.isSafeInteger(row.pgid) || row.pgid <= 1) throw new Error(`${label} pgid is invalid`);
  text(row.started, `${label} started`);
  return { pid: row.pid, pgid: row.pgid, started: row.started };
}

function action(value, index) {
  const row = record(value, `training action ${index}`);
  const kind = text(row.kind, `training action ${index} kind`);
  if (
    ![
      'wait-visible',
      'tap',
      'assert-visible',
      'assert-not-visible',
      'replace-text',
      'scroll',
      'dismiss-keyboard',
    ].includes(kind)
  )
    throw new Error(`training action ${index} kind is unsupported`);
  if (kind === 'dismiss-keyboard') return { kind };
  if (kind === 'scroll') {
    text(row.container, `training action ${index} container`);
    text(row.selector, `training action ${index} selector`);
    if (row.direction !== 'up' && row.direction !== 'down')
      throw new Error(`training action ${index} direction is invalid`);
    return { kind, container: row.container, selector: row.selector, direction: row.direction };
  }
  text(row.selector, `training action ${index} selector`);
  if (kind === 'replace-text') text(row.value, `training action ${index} value`);
  if (row.selectorKind !== undefined && row.selectorKind !== 'id' && row.selectorKind !== 'text')
    throw new Error(`training action ${index} selector kind is invalid`);
  return { ...row, kind };
}

function step(value) {
  const row = record(value, 'training step');
  text(row.id, 'training step id', /^[a-z0-9-]{1,120}$/);
  text(row.assertionId, 'training assertion id', /^NAT-training-[a-z-]+$/);
  if (row.platform !== 'ios' && row.platform !== 'android')
    throw new Error('training step platform is invalid');
  text(row.viewId, 'training step view id');
  if (!Array.isArray(row.selectors) || row.selectors.length === 0)
    throw new Error('training step selectors are invalid');
  const selectors = row.selectors.map((selector, index) =>
    text(selector, `training step selector ${index}`),
  );
  if (new Set(selectors).size !== selectors.length)
    throw new Error('training step selectors are duplicated');
  if (!Array.isArray(row.actions) || row.actions.length === 0)
    throw new Error('training step actions are invalid');
  const actions = row.actions.map(action);
  const rendered = record(row.expectedRendered ?? {}, 'training expected rendered');
  for (const [key, value] of Object.entries(rendered)) {
    text(key, 'rendered selector');
    text(value, `rendered value for ${key}`);
  }
  return { ...row, selectors, actions, expectedRendered: rendered };
}

export function assertTrainingCommand(value) {
  const row = record(value, 'Detox training command');
  if (row.schemaVersion !== TRAINING_PROTOCOL_SCHEMA)
    throw new Error('training command schema is unsupported');
  if (row.kind !== 'private-detox-training-command')
    throw new Error('training command kind is invalid');
  if (!Number.isSafeInteger(row.commandId) || row.commandId <= 0)
    throw new Error('training command id is invalid');
  text(row.runId, 'training command run id', RUN_ID);
  text(row.attemptId, 'training command attempt id', new RegExp(`^${row.runId}:first$`));
  if (row.platform !== 'ios' && row.platform !== 'android')
    throw new Error('training command platform is invalid');
  if (!Number.isSafeInteger(row.timeoutMs) || row.timeoutMs < 1_000 || row.timeoutMs > 600_000)
    throw new Error('training command timeout is invalid');
  if (!['training-step', 'restart-app', 'shutdown'].includes(row.commandKind))
    throw new Error('training command kind is unsupported');
  if (row.commandKind === 'training-step') step(row.step);
  if (row.commandKind === 'restart-app') {
    text(row.appIdentifier, 'training restart app identifier');
    if (!Number.isSafeInteger(row.launchCount) || row.launchCount <= 0 || row.launchCount > 100)
      throw new Error('training restart launch count is invalid');
  } else if (row.appIdentifier !== undefined || row.launchCount !== undefined) {
    throw new Error('non-restart command carries restart inputs');
  }
  if (row.commandKind !== 'training-step' && row.step !== undefined)
    throw new Error('non-step command carries a step');
  const withoutHash = { ...row, commandHash: undefined };
  if (
    typeof row.commandHash !== 'string' ||
    !SHA256.test(row.commandHash) ||
    hashJson(withoutHash) !== row.commandHash
  )
    throw new Error('training command hash is invalid');
  return row;
}

export function assertTrainingResponse(value, command, expectedChild, deadlineAt = Infinity) {
  const row = record(value, 'Detox training response');
  if (
    row.schemaVersion !== TRAINING_PROTOCOL_SCHEMA ||
    row.kind !== 'private-detox-training-response'
  )
    throw new Error('training response envelope is invalid');
  if (
    row.commandId !== command.commandId ||
    row.commandHash !== command.commandHash ||
    row.commandKind !== command.commandKind
  )
    throw new Error('training response command identity changed');
  if (
    row.runId !== command.runId ||
    row.attemptId !== command.attemptId ||
    row.platform !== command.platform
  )
    throw new Error('training response run identity changed');
  if (!['completed', 'failed', 'cancelled'].includes(row.status))
    throw new Error('training response status is invalid');
  const child = identity(row.childIdentity, 'training response child identity');
  if (
    expectedChild &&
    (child.pid !== expectedChild.pid ||
      child.pgid !== expectedChild.pgid ||
      child.started !== expectedChild.started)
  )
    throw new Error('training response child identity changed');
  if (
    !Number.isFinite(row.startedMonotonicMs) ||
    !Number.isFinite(row.finishedMonotonicMs) ||
    row.finishedMonotonicMs < row.startedMonotonicMs
  )
    throw new Error('training response timing is invalid');
  if (row.finishedMonotonicMs > deadlineAt)
    throw new Error('training response arrived after deadline');
  if (command.commandKind === 'training-step' && row.status === 'completed' && !row.stepReceipt)
    throw new Error('completed training step response lacks receipt');
  if (command.commandKind === 'restart-app' && row.status === 'completed' && !row.restartReceipt)
    throw new Error('completed training restart response lacks receipt');
  return { ...row, childIdentity: child };
}

export function evidenceFileName(name) {
  if (typeof name !== 'string' || !EVIDENCE_NAME.test(name))
    throw new Error('training evidence filename is unsafe');
  return name;
}

function statIdentity(meta) {
  return {
    dev: meta.dev,
    ino: meta.ino,
    uid: meta.uid,
    gid: meta.gid,
    mode: meta.mode,
    nlink: meta.nlink,
    size: meta.size,
    mtimeMs: meta.mtimeMs,
    ctimeMs: meta.ctimeMs,
  };
}

function sameStat(left, right) {
  return JSON.stringify(statIdentity(left)) === JSON.stringify(statIdentity(right));
}

function validateStat(meta, maxBytes, privateRecord, label) {
  if (
    !meta.isFile() ||
    meta.isSymbolicLink() ||
    meta.nlink !== 1 ||
    (privateRecord ? (meta.mode & 0o777) !== 0o600 : (meta.mode & 0o022) !== 0) ||
    (typeof process.getuid === 'function' && meta.uid !== process.getuid()) ||
    meta.size <= 0 ||
    meta.size > maxBytes
  )
    throw new Error(`${label} is not an owned bounded immutable file`);
}

async function readBoundedPath(file, maxBytes, options = {}) {
  assertLive(options);
  const canonicalFile = path.resolve(file);
  if (!path.isAbsolute(file) || canonicalFile !== file)
    throw new Error('training evidence path must be absolute and normalized');
  const pathBefore = await lstat(canonicalFile);
  assertLive(options);
  validateStat(pathBefore, maxBytes, options.privateRecord === true, 'training evidence file');
  if ((fsConstants.O_NOFOLLOW ?? 0) === 0)
    throw new Error('training evidence reader cannot enforce no-follow opens');
  if ((await realpath(canonicalFile)) !== canonicalFile)
    throw new Error('training evidence path is not canonical');
  assertLive(options);
  const handle = await open(canonicalFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let closed = false;
  try {
    const descriptorBefore = await handle.stat();
    assertLive(options);
    validateStat(
      descriptorBefore,
      maxBytes,
      options.privateRecord === true,
      'training evidence descriptor',
    );
    if (!sameStat(pathBefore, descriptorBefore))
      throw new Error('training evidence path changed before descriptor read');
    const bytes = Buffer.allocUnsafe(descriptorBefore.size);
    let offset = 0;
    while (offset < bytes.length) {
      assertLive(options);
      const result = await handle.read(
        bytes,
        offset,
        Math.min(READ_CHUNK_BYTES, bytes.length - offset),
        null,
      );
      if (result.bytesRead <= 0) throw new Error('training evidence truncated during read');
      offset += result.bytesRead;
    }
    assertLive(options);
    const extra = Buffer.allocUnsafe(1);
    const extraResult = await handle.read(extra, 0, 1, null);
    if (extraResult.bytesRead !== 0) throw new Error('training evidence grew during read');
    assertLive(options);
    const descriptorAfter = await handle.stat();
    const pathAfter = await lstat(canonicalFile);
    if (!sameStat(descriptorBefore, descriptorAfter) || !sameStat(descriptorBefore, pathAfter))
      throw new Error('training evidence identity changed during read');
    if ((await realpath(canonicalFile)) !== canonicalFile)
      throw new Error('training evidence path changed during read');
    assertLive(options);
    return { bytes, metadata: descriptorAfter, realpath: canonicalFile };
  } finally {
    if (!closed) {
      closed = true;
      await handle.close();
    }
  }
}

export async function readOwnedTrainingPath(file, maxBytes, options = {}) {
  return readBoundedPath(file, maxBytes, options);
}

async function ownedFile(root, name, maxBytes, options = {}) {
  evidenceFileName(name);
  const canonicalRoot = await ownedRoot(root);
  assertLive(options);
  const file = path.join(canonicalRoot, name);
  if (path.dirname(file) !== canonicalRoot)
    throw new Error('training evidence escaped artifact root');
  return (await readBoundedPath(file, maxBytes, { ...options, privateRecord: true })).bytes;
}

export async function readOwnedTrainingFile(root, name, maxBytes, options = {}) {
  return ownedFile(root, name, maxBytes, options);
}

function samePublicationInode(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    (left.mode & 0o777) === (right.mode & 0o777) &&
    left.size === right.size
  );
}

function samePublicationOwner(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    (left.mode & 0o777) === (right.mode & 0o777)
  );
}

function recovery(message, details = {}) {
  return new TrainingPublicationRecoveryError(message, details);
}

function createRecoveryBudget() {
  return { deadlineAt: performance.now() + RECOVERY_BUDGET_MS };
}

function assertRecoveryBudget(budget) {
  if (performance.now() >= budget.deadlineAt)
    throw recovery('training publication recovery deadline elapsed', {
      recoveryDeadlineAt: budget.deadlineAt,
    });
}

async function publicationPathIdentity(file, label, expectedNlink) {
  let resolved;
  let metadata;
  try {
    resolved = await realpath(file);
    metadata = await lstat(file);
  } catch (error) {
    throw recovery(`${label} cannot be inspected`, { cause: error });
  }
  if (resolved !== file) throw recovery(`${label} realpath changed`);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !(Array.isArray(expectedNlink) ? expectedNlink : [expectedNlink]).includes(metadata.nlink) ||
    (metadata.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
  )
    throw recovery(`${label} is not the owned private publication inode`, {
      observed: statIdentity(metadata),
      expectedNlink,
    });
  return metadata;
}

async function unlinkExactOwnedPath(root, rootIdentity, file, expected, label, budget) {
  budget && assertRecoveryBudget(budget);
  await readOwnedRootIdentity(root, rootIdentity);
  budget && assertRecoveryBudget(budget);
  const observed = await publicationPathIdentity(file, label, expected.nlink);
  budget && assertRecoveryBudget(budget);
  if (!samePublicationInode(observed, expected))
    throw recovery(`${label} inode changed before rollback`, {
      expected: statIdentity(expected),
      observed: statIdentity(observed),
    });
  budget && assertRecoveryBudget(budget);
  try {
    await unlink(file);
  } catch (error) {
    throw recovery(`${label} unlink failed`, { cause: error });
  }
  try {
    await lstat(file);
    throw recovery(`${label} remained after rollback`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  budget && assertRecoveryBudget(budget);
  await readOwnedRootIdentity(root, rootIdentity);
  budget && assertRecoveryBudget(budget);
}

async function cleanupUnpublishedTemporary(
  root,
  rootIdentity,
  temporary,
  temporaryIdentity,
  budget,
) {
  budget && assertRecoveryBudget(budget);
  if (!temporaryIdentity) {
    try {
      await lstat(temporary);
      throw recovery('temporary publication ownership could not be proven');
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
  await unlinkExactOwnedPath(
    root,
    rootIdentity,
    temporary,
    temporaryIdentity,
    'temporary publication',
    budget,
  );
}

async function cleanupPublishedPaths(
  root,
  rootIdentity,
  temporary,
  temporaryIdentity,
  final,
  finalIdentity,
  temporaryUnlinked,
  budget,
) {
  const failures = [];
  if (!temporaryUnlinked) {
    try {
      assertRecoveryBudget(budget);
      await unlinkExactOwnedPath(
        root,
        rootIdentity,
        temporary,
        temporaryIdentity,
        'temporary publication link',
        budget,
      );
      temporaryUnlinked = true;
    } catch (error) {
      failures.push(error);
    }
  }
  if (temporaryUnlinked) {
    try {
      assertRecoveryBudget(budget);
      const expectedFinal = { ...finalIdentity, nlink: 1 };
      await unlinkExactOwnedPath(
        root,
        rootIdentity,
        final,
        expectedFinal,
        'final publication',
        budget,
      );
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

function withRecoveryFailures(original, failures) {
  if (failures.length === 0) return original;
  return new AggregateError([original, ...failures], 'training publication recovery failed');
}

export async function writeAtomicTrainingBytes(root, name, bytes, maxBytes, options = {}) {
  if (!EVIDENCE_NAME.test(name)) throw new Error('training evidence filename is unsafe');
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0)
    throw new Error('training evidence payload is empty');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || bytes.byteLength > maxBytes)
    throw new Error('training evidence payload exceeds bound');
  const canonicalRoot = await ownedRoot(root);
  assertLive(options);
  const rootIdentity = await readOwnedRootIdentity(canonicalRoot);
  const file = path.join(canonicalRoot, name);
  if (path.dirname(file) !== canonicalRoot)
    throw new Error('training evidence escaped artifact root');
  try {
    await lstat(file);
    throw new Error(`training evidence already exists: ${name}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temporary = `${file}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  let handle;
  let temporaryOwnerIdentity;
  let temporaryIdentity;
  let finalIdentity;
  let published = false;
  let temporaryUnlinked = false;
  try {
    assertLive(options);
    await readOwnedRootIdentity(canonicalRoot, rootIdentity);
    handle = await open(
      temporary,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.chmod(0o600);
    temporaryOwnerIdentity = await handle.stat();
    if (
      !temporaryOwnerIdentity.isFile() ||
      temporaryOwnerIdentity.nlink !== 1 ||
      (temporaryOwnerIdentity.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === 'function' && temporaryOwnerIdentity.uid !== process.getuid())
    )
      throw recovery('temporary publication inode is not private and owned');
    let offset = 0;
    while (offset < bytes.length) {
      assertLive(options);
      const result = await handle.write(
        bytes,
        offset,
        Math.min(READ_CHUNK_BYTES, bytes.length - offset),
        null,
      );
      if (result.bytesWritten <= 0) throw new Error('training evidence write made no progress');
      offset += result.bytesWritten;
    }
    assertLive(options);
    await handle.sync();
    assertLive(options);
    const descriptorAfterWrite = await handle.stat();
    if (!samePublicationOwner(temporaryOwnerIdentity, descriptorAfterWrite))
      throw recovery('temporary publication descriptor changed while writing');
    if (
      descriptorAfterWrite.nlink !== 1 ||
      (descriptorAfterWrite.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === 'function' && descriptorAfterWrite.uid !== process.getuid())
    )
      throw recovery('temporary publication descriptor ownership changed while writing');
    temporaryIdentity = descriptorAfterWrite;
    const pathAfterWrite = await publicationPathIdentity(temporary, 'temporary publication', 1);
    if (!samePublicationInode(temporaryIdentity, pathAfterWrite))
      throw recovery('temporary publication path changed while writing');
    await handle.close();
    handle = undefined;
    assertLive(options);
    await readOwnedRootIdentity(canonicalRoot, rootIdentity);
    await options.beforePublish?.({ temporary, final: file });
    assertLive(options);
    await readOwnedRootIdentity(canonicalRoot, rootIdentity);
    try {
      await lstat(file);
      throw new Error(`training evidence already exists: ${name}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const temporaryBeforeLink = await publicationPathIdentity(
      temporary,
      'temporary publication',
      1,
    );
    if (!samePublicationInode(temporaryIdentity, temporaryBeforeLink))
      throw recovery('temporary publication identity changed before link');
    await link(temporary, file);
    published = true;
    finalIdentity = await publicationPathIdentity(file, 'final publication', 2);
    const temporaryAfterLink = await publicationPathIdentity(
      temporary,
      'temporary publication link',
      2,
    );
    if (!samePublicationInode(finalIdentity, temporaryAfterLink))
      throw recovery('final publication inode does not match the owned temporary inode');
    await readOwnedRootIdentity(canonicalRoot, rootIdentity);
    await options.afterPublish?.({ temporary, final: file });
    assertLive(options);
    await readOwnedRootIdentity(canonicalRoot, rootIdentity);
    await unlinkExactOwnedPath(
      canonicalRoot,
      rootIdentity,
      temporary,
      temporaryAfterLink,
      'temporary publication link',
    );
    temporaryUnlinked = true;
    await options.afterTemporaryUnlink?.({ temporary, final: file });
    assertLive(options);
    const finalAfterTemporary = await publicationPathIdentity(file, 'final publication', 1);
    if (!samePublicationInode(finalIdentity, finalAfterTemporary))
      throw recovery('final publication inode changed after temporary unlink');
    assertLive(options);
    const readback = await readBoundedPath(file, maxBytes, {
      ...options,
      privateRecord: true,
    });
    assertLive(options);
    if (!readback.bytes.equals(bytes) || hashBytes(readback.bytes) !== hashBytes(bytes))
      throw recovery('final publication bytes failed owned readback');
    const finalAfterReadback = await publicationPathIdentity(file, 'final publication readback', 1);
    if (!samePublicationInode(finalIdentity, finalAfterReadback))
      throw recovery('final publication inode changed after readback');
    await readOwnedRootIdentity(canonicalRoot, rootIdentity);
    assertLive(options);
  } catch (error) {
    const failures = [];
    const recoveryBudget = createRecoveryBudget();
    if (handle) {
      if (!temporaryIdentity) {
        try {
          temporaryIdentity = await handle.stat();
        } catch (statError) {
          failures.push(
            recovery('temporary publication descriptor stat failed during recovery', {
              cause: statError,
            }),
          );
        }
      }
      try {
        await handle.close();
      } catch (closeError) {
        failures.push(
          recovery('temporary publication descriptor close failed', { cause: closeError }),
        );
      }
    }
    if (published && finalIdentity) {
      failures.push(
        ...(await cleanupPublishedPaths(
          canonicalRoot,
          rootIdentity,
          temporary,
          { ...finalIdentity, nlink: [1, 2] },
          file,
          finalIdentity,
          temporaryUnlinked,
          recoveryBudget,
        )),
      );
    } else {
      try {
        await cleanupUnpublishedTemporary(
          canonicalRoot,
          rootIdentity,
          temporary,
          temporaryIdentity,
          recoveryBudget,
        );
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    }
    throw withRecoveryFailures(error, failures);
  }
}

export async function writeAtomicTrainingJson(root, name, value, options = {}) {
  if (!NAME.test(name)) throw new Error('training protocol filename is unsafe');
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  await writeAtomicTrainingBytes(root, name, bytes, MAX_RESPONSE_BYTES, options);
}

export async function publishTrainingCancellation(root, command, options = {}) {
  await writeAtomicTrainingJson(
    root,
    `detox-training-cancel-${command.commandId}.private.json`,
    {
      schemaVersion: TRAINING_PROTOCOL_SCHEMA,
      kind: 'private-detox-training-cancel',
      commandId: command.commandId,
      commandHash: command.commandHash,
    },
    options,
  );
}

export async function waitForTrainingCommand({ root, afterCommandId = 0, signal, deadlineAt }) {
  const canonicalRoot = await ownedRoot(root);
  for (;;) {
    assertLive({ signal, deadlineAt });
    const names = (await readdir(canonicalRoot)).filter((name) =>
      /^detox-training-command-[1-9][0-9]*\.private\.json$/.test(name),
    );
    assertLive({ signal, deadlineAt });
    const ids = names
      .map((name) => Number(name.match(/(\d+)/)?.[1]))
      .filter((id) => Number.isSafeInteger(id) && id > afterCommandId)
      .sort((left, right) => left - right);
    if (ids.length) {
      const id = ids[0];
      const bytes = await ownedFile(
        canonicalRoot,
        `detox-training-command-${id}.private.json`,
        MAX_COMMAND_BYTES,
        { signal, deadlineAt },
      );
      assertLive({ signal, deadlineAt });
      const command = assertTrainingCommand(JSON.parse(bytes.toString('utf8')));
      assertLive({ signal, deadlineAt });
      return command;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(25, Math.max(1, deadlineAt - performance.now()))),
    );
  }
}

export async function publishTrainingResponse(root, response, options = {}) {
  await writeAtomicTrainingJson(
    root,
    `detox-training-response-${response.commandId}.private.json`,
    response,
    options,
  );
}
