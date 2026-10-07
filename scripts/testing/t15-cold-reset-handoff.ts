import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  writeNativePilotPrivateFile,
  type ResolvedNativePilotInvocation,
  type NativePilotColdResetBinding,
} from './native-pilot-invocation';
import { readNativeEvidenceObservation, type NativeEvidenceIdentity } from './native-view-evidence';
import type {
  NativeComparisonAttemptExpectation,
  NativeComparisonCohortExpectation,
  NativeComparisonOriginalReceiptBinding,
} from './compare-native-pilot';
import type { FreshColdReset } from './t15-cold-dispatcher';

const hash64 = /^[a-f0-9]{64}$/u;

/** The final reset receipt is a direct child so the runner's namespace writer can fence it. */
export const coldResetFinalReceiptName = 'reset-original.private.json' as const;

type RecordValue = Record<string, unknown>;

const TARGET_IDENTITY_FIELDS = [
  'platform',
  'deviceId',
  'appId',
  'binaryHash',
  'apiOrigin',
  'captureRunId',
  'ownerRunId',
  'phase',
] as const;
const BACKEND_IDENTITY_FIELDS = [
  'runId',
  'ownerRunId',
  'captureRunId',
  'artifactRoot',
  'apiOrigin',
  'apiPid',
  'apiStarted',
  'apiScript',
  'backendAttemptId',
  'manifestSha256',
] as const;

type ReceiptBindingWithIdentity = NativeComparisonOriginalReceiptBinding & {
  identity: NativeEvidenceIdentity;
};

export type ColdResetHandoff = {
  readonly source: NativeComparisonOriginalReceiptBinding;
  readonly final: NativeComparisonOriginalReceiptBinding;
  readonly finalRelativePath: typeof coldResetFinalReceiptName;
  readonly sourceIdentity: NativeEvidenceIdentity;
  readonly finalIdentity: NativeEvidenceIdentity;
};

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function disjointNamespaces(left: string, right: string): boolean {
  return left !== right && !pathInside(left, right) && !pathInside(right, left);
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertEvidenceIdentityEqual(
  actual: NativeEvidenceIdentity,
  expected: NativeEvidenceIdentity,
  label: string,
): void {
  for (const field of [
    'dev',
    'ino',
    'uid',
    'gid',
    'mode',
    'nlink',
    'size',
    'mtimeMs',
    'ctimeMs',
  ] as const) {
    if (actual[field] !== expected[field]) throw new Error(`${label}.${field} changed`);
  }
}

function asRecord(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as RecordValue;
}

function assertSelectedRowIdentity(
  actual: RecordValue,
  expected: RecordValue,
  fields: readonly string[],
  label: string,
  attemptId: string,
): void {
  for (const field of fields) {
    if (actual[field] !== expected[field])
      throw new Error(`T15 cold reset ${label}.${field} is foreign for ${attemptId}`);
  }
}

async function requireOwnedCanonicalDirectory(input: string, label: string): Promise<string> {
  if (!path.isAbsolute(input) || input.includes('\0')) throw new Error(`${label} must be absolute`);
  const resolved = path.resolve(input);
  const entry = await lstat(resolved);
  const canonical = await realpath(resolved);
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    canonical !== resolved ||
    (entry.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === 'function' && entry.uid !== process.getuid())
  )
    throw new Error(`${label} must be an owned canonical 0700 directory`);
  return canonical;
}

function assertResetMetadata(
  reset: FreshColdReset,
  expected: NativeComparisonAttemptExpectation,
  cohort: Pick<NativeComparisonCohortExpectation, 'fixtureResetFingerprint' | 'sourceFingerprint'>,
): void {
  if (
    reset.status !== 'fresh' ||
    reset.fixtureResetId !== expected.fixtureResetId ||
    reset.ownerRunId !== expected.runId ||
    reset.cohortFixtureFingerprint !== cohort.fixtureResetFingerprint
  )
    throw new Error(`T15 cold reset is not bound to ${expected.attemptId}`);
  if (
    reset.finishedAt === null ||
    !Number.isFinite(Date.parse(reset.startedAt)) ||
    !Number.isFinite(Date.parse(reset.finishedAt)) ||
    Date.parse(reset.finishedAt) <= Date.parse(reset.startedAt)
  )
    throw new Error(`T15 cold reset is not a closed fresh interval for ${expected.attemptId}`);
  if (
    !reset.appStateFingerprint ||
    !reset.fixtureStateFingerprint ||
    !hash64.test(reset.appStateFingerprint) ||
    !hash64.test(reset.fixtureStateFingerprint) ||
    reset.sourceFingerprint !== cohort.sourceFingerprint ||
    !reset.helperFingerprint ||
    !hash64.test(reset.helperFingerprint) ||
    reset.cleanupStatus !== 'cleaned' ||
    reset.blocker !== null
  )
    throw new Error(`T15 cold reset lacks clean same-attempt evidence for ${expected.attemptId}`);
  if (!reset.target || !reset.backend)
    throw new Error(`T15 cold reset lacks acquired target/backend rows for ${expected.attemptId}`);
}

async function readOriginalResetReceipt(input: {
  reset: FreshColdReset;
  expected: NativeComparisonAttemptExpectation;
  cohort: Pick<NativeComparisonCohortExpectation, 'fixtureResetFingerprint' | 'sourceFingerprint'>;
  finalOutputRoot: string;
}): Promise<{
  binding: NativeComparisonOriginalReceiptBinding;
  bytes: Buffer;
  sourceIdentity: NativeEvidenceIdentity;
}> {
  const binding = input.reset.originalResetBinding as ReceiptBindingWithIdentity;
  if (
    binding.status !== 'verified' ||
    !binding.receiptPath ||
    !binding.artifactRoot ||
    !hash64.test(binding.receiptHash ?? '')
  )
    throw new Error(
      `T15 cold reset has no verified original receipt for ${input.expected.attemptId}`,
    );
  if (!binding.identity)
    throw new Error(
      `T15 cold reset has no acquired source identity for ${input.expected.attemptId}`,
    );
  const artifactRoot = await requireOwnedCanonicalDirectory(
    binding.artifactRoot,
    'T15 cold reset staging root',
  );
  const receiptPath = path.resolve(binding.receiptPath);
  if (
    !pathInside(artifactRoot, receiptPath) ||
    !disjointNamespaces(artifactRoot, input.finalOutputRoot)
  )
    throw new Error(
      `T15 cold reset staging receipt is not isolated for ${input.expected.attemptId}`,
    );
  const relative = path.relative(artifactRoot, receiptPath);
  let observation;
  try {
    observation = readNativeEvidenceObservation(artifactRoot, relative, true);
  } catch (error) {
    throw new Error(
      `T15 cold reset staging receipt is not an owned bounded file for ${input.expected.attemptId}: ${
        error instanceof Error ? error.message : 'read failed'
      }`,
    );
  }
  const sourceIdentity = observation.identity;
  assertEvidenceIdentityEqual(sourceIdentity, binding.identity, 'source receipt identity');
  const bytes = Buffer.from(observation.bytes);
  if (sha256(bytes) !== binding.receiptHash)
    throw new Error(`T15 cold reset staging receipt hash changed for ${input.expected.attemptId}`);
  let row: RecordValue;
  try {
    row = asRecord(JSON.parse(bytes.toString('utf8')), 'cold reset staging receipt');
  } catch (error) {
    throw new Error(
      `T15 cold reset staging receipt is not valid JSON for ${input.expected.attemptId}: ${
        error instanceof Error ? error.message : 'parse failed'
      }`,
    );
  }
  if (
    row.fixtureResetId !== input.expected.fixtureResetId ||
    row.ownerRunId !== input.expected.runId ||
    row.attemptId !== input.expected.attemptId ||
    row.cohortFixtureFingerprint !== input.cohort.fixtureResetFingerprint ||
    row.appStateFingerprint !== input.reset.appStateFingerprint ||
    row.fixtureStateFingerprint !== input.reset.fixtureStateFingerprint ||
    row.sourceFingerprint !== input.cohort.sourceFingerprint ||
    row.helperFingerprint !== input.reset.helperFingerprint ||
    row.cleanupStatus !== input.reset.cleanupStatus
  )
    throw new Error(
      `T15 cold reset staging receipt is foreign or stale for ${input.expected.attemptId}`,
    );
  return {
    binding: { ...binding, artifactRoot, receiptPath },
    bytes,
    sourceIdentity,
  };
}

export type ColdResetStagingValidationInput = {
  reset: FreshColdReset;
  expected: NativeComparisonAttemptExpectation;
  cohort: Pick<NativeComparisonCohortExpectation, 'fixtureResetFingerprint' | 'sourceFingerprint'>;
  finalOutputRoot: string;
};

/** Validate the producer receipt before claiming a runner namespace. */
export async function validateColdResetStagingReceipt(
  input: ColdResetStagingValidationInput,
): Promise<void> {
  assertResetMetadata(input.reset, input.expected, input.cohort);
  await readOriginalResetReceipt(input);
}

/**
 * Publish a verified producer receipt into the namespace already claimed by
 * createNativePilotOutputRoot. The original source remains immutable and is
 * carried alongside the final binding; no pre-existing final namespace is
 * adopted.
 */
export async function handoffColdResetReceipt(input: {
  signal?: AbortSignal;
  reset: FreshColdReset;
  expected: NativeComparisonAttemptExpectation;
  cohort: Pick<NativeComparisonCohortExpectation, 'fixtureResetFingerprint' | 'sourceFingerprint'>;
  prepared: Pick<
    ResolvedNativePilotInvocation,
    'outputParent' | 'outputRoot' | 'requestedRunId' | 'requestedAttemptId' | 'namespaceIdentity'
  >;
}): Promise<ColdResetHandoff> {
  assertResetMetadata(input.reset, input.expected, input.cohort);
  const expectedOutputRoot = path.join(input.prepared.outputParent, input.expected.runId);
  if (
    input.prepared.requestedRunId !== input.expected.runId ||
    input.prepared.requestedAttemptId !== input.expected.attemptId ||
    input.prepared.outputRoot !== expectedOutputRoot
  )
    throw new Error(
      `T15 cold reset handoff has a mismatched runner identity for ${input.expected.attemptId}`,
    );
  const outputRoot = await requireOwnedCanonicalDirectory(
    input.prepared.outputRoot,
    'T15 cold reset final output root',
  );
  input.signal?.throwIfAborted();
  const original = await readOriginalResetReceipt({
    reset: input.reset,
    expected: input.expected,
    cohort: input.cohort,
    finalOutputRoot: outputRoot,
  });
  input.signal?.throwIfAborted();
  const published = await writeNativePilotPrivateFile({
    root: outputRoot,
    relative: coldResetFinalReceiptName,
    contents: original.bytes,
    namespaceIdentity: input.prepared.namespaceIdentity,
    signal: input.signal,
  });
  input.signal?.throwIfAborted();
  const finalObservation = readNativeEvidenceObservation(
    outputRoot,
    coldResetFinalReceiptName,
    true,
  );
  input.signal?.throwIfAborted();
  const finalBytes = Buffer.from(finalObservation.bytes);
  if (sha256(finalBytes) !== original.binding.receiptHash || !finalBytes.equals(original.bytes))
    throw new Error(`T15 cold reset handoff changed receipt bytes for ${input.expected.attemptId}`);
  const final: NativeComparisonOriginalReceiptBinding = {
    status: 'verified',
    artifactRoot: outputRoot,
    receiptPath: published.path,
    receiptHash: original.binding.receiptHash,
  };
  return Object.freeze({
    source: Object.freeze({ ...original.binding }),
    final: Object.freeze(final),
    finalRelativePath: coldResetFinalReceiptName,
    sourceIdentity: Object.freeze(original.sourceIdentity),
    finalIdentity: Object.freeze(finalObservation.identity),
  });
}

/**
 * Convert the producer-side reset object into the bounded value carried in a
 * child process argv. The child still re-reads the original descriptor-backed
 * receipt; this object is an expected binding, not a receipt replacement.
 */
export async function createColdResetProcessBinding(input: {
  reset: FreshColdReset;
  expected: NativeComparisonAttemptExpectation;
  cohort: Pick<NativeComparisonCohortExpectation, 'fixtureResetFingerprint' | 'sourceFingerprint'>;
  finalOutputRoot: string;
}): Promise<NativePilotColdResetBinding> {
  assertResetMetadata(input.reset, input.expected, input.cohort);
  if (!input.reset.target || !input.reset.backend)
    throw new Error(
      `T15 cold reset has no acquired target/backend rows for ${input.expected.attemptId}`,
    );
  const original = await readOriginalResetReceipt(input);
  return Object.freeze({
    artifactRoot: original.binding.artifactRoot as string,
    receiptPath: original.binding.receiptPath as string,
    receiptHash: original.binding.receiptHash as string,
    fixtureResetId: input.reset.fixtureResetId,
    ownerRunId: input.reset.ownerRunId,
    attemptId: input.expected.attemptId,
    cohortFixtureFingerprint: input.reset.cohortFixtureFingerprint,
    appStateFingerprint: input.reset.appStateFingerprint as string,
    fixtureStateFingerprint: input.reset.fixtureStateFingerprint as string,
    sourceFingerprint: input.reset.sourceFingerprint as string,
    helperFingerprint: input.reset.helperFingerprint as string,
    cleanupStatus: 'cleaned',
    target: structuredClone(input.reset.target),
    backend: structuredClone(input.reset.backend),
    sourceIdentity: Object.freeze(original.sourceIdentity),
  });
}

/**
 * Runner-side handoff used after the child has exclusively allocated its own
 * output root. Every field in the argv binding is checked against the original
 * private receipt before one byte is copied into the final namespace.
 */
export async function handoffColdResetReceiptFromProcessBinding(input: {
  signal: AbortSignal;
  binding: NativePilotColdResetBinding;
  prepared: Pick<
    ResolvedNativePilotInvocation,
    'outputParent' | 'outputRoot' | 'requestedRunId' | 'requestedAttemptId' | 'namespaceIdentity'
  >;
}): Promise<ColdResetHandoff> {
  input.signal.throwIfAborted();
  const binding = input.binding;
  const expectedOutputRoot = path.join(input.prepared.outputParent, binding.ownerRunId);
  if (
    input.prepared.requestedRunId !== binding.ownerRunId ||
    input.prepared.requestedAttemptId !== binding.attemptId ||
    input.prepared.outputRoot !== expectedOutputRoot
  )
    throw new Error(
      `T15 cold reset subprocess handoff has a mismatched runner identity for ${binding.attemptId}`,
    );
  const stagingRoot = await requireOwnedCanonicalDirectory(
    binding.artifactRoot,
    'T15 cold reset subprocess staging root',
  );
  input.signal.throwIfAborted();
  const finalOutputRoot = await requireOwnedCanonicalDirectory(
    input.prepared.outputRoot,
    'T15 cold reset subprocess final output root',
  );
  input.signal.throwIfAborted();
  const receiptPath = path.resolve(binding.receiptPath);
  const relative = path.relative(stagingRoot, receiptPath);
  if (!pathInside(stagingRoot, receiptPath) || !disjointNamespaces(stagingRoot, finalOutputRoot))
    throw new Error(
      `T15 cold reset subprocess receipt path is not isolated for ${binding.attemptId}`,
    );
  let observation;
  try {
    observation = readNativeEvidenceObservation(stagingRoot, relative, true);
  } catch (error) {
    throw new Error(
      `T15 cold reset subprocess receipt is not an owned bounded file for ${binding.attemptId}: ${
        error instanceof Error ? error.message : 'read failed'
      }`,
    );
  }
  const sourceIdentity = observation.identity;
  assertEvidenceIdentityEqual(
    sourceIdentity,
    binding.sourceIdentity,
    'subprocess source receipt identity',
  );
  input.signal.throwIfAborted();
  const bytes = Buffer.from(observation.bytes);
  if (sha256(bytes) !== binding.receiptHash)
    throw new Error(`T15 cold reset subprocess receipt hash changed for ${binding.attemptId}`);
  let row: RecordValue;
  try {
    row = asRecord(JSON.parse(bytes.toString('utf8')), 'cold reset subprocess receipt');
  } catch (error) {
    throw new Error(
      `T15 cold reset subprocess receipt is not valid JSON for ${binding.attemptId}: ${
        error instanceof Error ? error.message : 'parse failed'
      }`,
    );
  }
  const attemptMatches =
    row.attemptId === binding.attemptId || row.requestedAttemptId === binding.attemptId;
  if (!attemptMatches)
    throw new Error(
      `T15 cold reset subprocess receipt attempt is foreign for ${binding.attemptId}`,
    );
  const expectedRows: Record<string, unknown> = {
    fixtureResetId: binding.fixtureResetId,
    ownerRunId: binding.ownerRunId,
    cohortFixtureFingerprint: binding.cohortFixtureFingerprint,
    appStateFingerprint: binding.appStateFingerprint,
    fixtureStateFingerprint: binding.fixtureStateFingerprint,
    sourceFingerprint: binding.sourceFingerprint,
    helperFingerprint: binding.helperFingerprint,
    cleanupStatus: binding.cleanupStatus,
  };
  for (const [key, value] of Object.entries(expectedRows)) {
    if (row[key] !== value)
      throw new Error(
        `T15 cold reset subprocess receipt field ${key} is foreign for ${binding.attemptId}`,
      );
  }
  assertSelectedRowIdentity(
    asRecord(row.target, 'cold reset subprocess target row'),
    binding.target,
    TARGET_IDENTITY_FIELDS,
    'target',
    binding.attemptId,
  );
  assertSelectedRowIdentity(
    asRecord(row.backend, 'cold reset subprocess backend row'),
    binding.backend,
    BACKEND_IDENTITY_FIELDS,
    'backend',
    binding.attemptId,
  );
  input.signal.throwIfAborted();
  const published = await writeNativePilotPrivateFile({
    root: finalOutputRoot,
    relative: coldResetFinalReceiptName,
    contents: bytes,
    namespaceIdentity: input.prepared.namespaceIdentity,
    signal: input.signal,
  });
  input.signal.throwIfAborted();
  const finalObservation = readNativeEvidenceObservation(
    finalOutputRoot,
    coldResetFinalReceiptName,
    true,
  );
  input.signal.throwIfAborted();
  const finalBytes = Buffer.from(finalObservation.bytes);
  if (sha256(finalBytes) !== binding.receiptHash || !finalBytes.equals(bytes))
    throw new Error(
      `T15 cold reset subprocess handoff changed receipt bytes for ${binding.attemptId}`,
    );
  for (const field of ['dev', 'ino', 'uid', 'gid', 'mode'] as const) {
    if (published.identity[field] !== finalObservation.identity[field])
      throw new Error(
        `T15 cold reset subprocess final descriptor changed for ${binding.attemptId}`,
      );
  }
  return Object.freeze({
    source: Object.freeze({
      status: 'verified',
      artifactRoot: stagingRoot,
      receiptPath,
      receiptHash: binding.receiptHash,
    }),
    final: Object.freeze({
      status: 'verified',
      artifactRoot: finalOutputRoot,
      receiptPath: published.path,
      receiptHash: binding.receiptHash,
    }),
    finalRelativePath: coldResetFinalReceiptName,
    sourceIdentity: Object.freeze(sourceIdentity),
    finalIdentity: Object.freeze(finalObservation.identity),
  });
}
