import path from 'node:path';
import { coldResetFinalReceiptName, type ColdResetHandoff } from './t15-cold-reset-handoff';
import type { NativeEvidenceIdentity } from './native-view-evidence';
import type { ChildColdResetBinding } from './t15-cold-reset-child-consumption';

const HASH64 = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[a-f0-9]{24}$/u;
const ATTEMPT_ID = /^[a-f0-9]{24}:first$/u;

type RecordValue = Record<string, unknown>;

export type ColdResetRuntimeLinkBinding = Readonly<{
  source: Readonly<{
    status: 'verified';
    artifactRoot: string;
    receiptPath: string;
    receiptHash: string;
    identity: NativeEvidenceIdentity;
  }>;
  final: Readonly<{
    status: 'verified';
    artifactRoot: string;
    receiptPath: string;
    receiptHash: string;
    identity: NativeEvidenceIdentity;
  }>;
  finalRelativePath: string;
  captureRoot: string;
  captureRunId: string;
  requestedRunId: string;
  requestedAttemptId: string;
  target: RecordValue;
  backend: RecordValue;
}>;

function requireRunId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !RUN_ID.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireAttemptId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ATTEMPT_ID.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireAbsoluteNormalizedPath(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    value.includes('\0') ||
    path.normalize(value) !== value ||
    value !== value.replace(/\/+/gu, '/')
  )
    throw new Error(`${label} is not an absolute normalized path`);
  return value;
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH64.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireIdentity(value: unknown, label: string): NativeEvidenceIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} is invalid`);
  const identity = value as Partial<NativeEvidenceIdentity>;
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
  ] as const)
    if (typeof identity[field] !== 'number' || !Number.isFinite(identity[field]))
      throw new Error(`${label}.${field} is invalid`);
  if (identity.nlink !== 1 || (identity.mode! & 0o777) !== 0o600 || identity.size! <= 0)
    throw new Error(`${label} is not one owned immutable 0600 file`);
  return identity as NativeEvidenceIdentity;
}

function requireRecord(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} is invalid`);
  return value as RecordValue;
}

function assertRow(value: unknown, expected: string, label: string): void {
  if (value !== expected) throw new Error(`${label} is not bound to ${expected}`);
}

/**
 * Build the cold-reset portion of the generic runtime link only after the
 * protected handoff has verified source/final bytes and both file descriptors.
 * This pure production helper is used by run-native-pilot and by its bounded
 * resource-free composition control; it never claims native qualification.
 */
export function buildColdResetRuntimeLinkBinding(input: {
  requestedRunId: string;
  requestedAttemptId: string;
  captureRoot: string;
  captureRunId: string;
  outputRoot: string;
  child: Pick<ChildColdResetBinding, 'ownerRunId' | 'attemptId' | 'target' | 'backend'>;
  handoff: ColdResetHandoff;
}): ColdResetRuntimeLinkBinding {
  const requestedRunId = requireRunId(input.requestedRunId, 'requestedRunId');
  const requestedAttemptId = requireAttemptId(input.requestedAttemptId, 'requestedAttemptId');
  if (requestedAttemptId !== `${requestedRunId}:first`)
    throw new Error('requestedAttemptId is not bound to requestedRunId');
  const captureRoot = requireAbsoluteNormalizedPath(input.captureRoot, 'captureRoot');
  const captureRunId = requireRunId(input.captureRunId, 'captureRunId');
  const outputRoot = requireAbsoluteNormalizedPath(input.outputRoot, 'outputRoot');
  if (path.basename(captureRoot) !== captureRunId)
    throw new Error('captureRoot is not bound to captureRunId');
  assertRow(input.child.ownerRunId, requestedRunId, 'child ownerRunId');
  assertRow(input.child.attemptId, requestedAttemptId, 'child attemptId');
  const source = input.handoff.source;
  const final = input.handoff.final;
  if (source.status !== 'verified' || final.status !== 'verified')
    throw new Error('cold reset handoff is not verified');
  const sourceRoot = requireAbsoluteNormalizedPath(source.artifactRoot, 'source artifactRoot');
  const sourcePath = requireAbsoluteNormalizedPath(source.receiptPath, 'source receiptPath');
  const finalRoot = requireAbsoluteNormalizedPath(final.artifactRoot, 'final artifactRoot');
  const finalPath = requireAbsoluteNormalizedPath(final.receiptPath, 'final receiptPath');
  const finalRelativePath = input.handoff.finalRelativePath;
  if (finalRelativePath !== coldResetFinalReceiptName)
    throw new Error('cold reset finalRelativePath is not the immutable receipt name');
  if (
    sourceRoot !== captureRoot ||
    finalRoot !== outputRoot ||
    path.dirname(sourcePath) !== sourceRoot ||
    finalPath !== path.join(outputRoot, finalRelativePath) ||
    path.basename(sourcePath) !== finalRelativePath ||
    !pathInside(sourceRoot, sourcePath) ||
    !pathInside(finalRoot, finalPath)
  )
    throw new Error('cold reset handoff roots or relative paths are not bound');
  const sourceHash = requireHash(source.receiptHash, 'source receiptHash');
  const finalHash = requireHash(final.receiptHash, 'final receiptHash');
  if (sourceHash !== finalHash) throw new Error('cold reset source/final receipt hashes differ');
  const sourceIdentity = requireIdentity(input.handoff.sourceIdentity, 'source identity');
  const finalIdentity = requireIdentity(input.handoff.finalIdentity, 'final identity');
  const target = requireRecord(input.child.target, 'child target');
  const backend = requireRecord(input.child.backend, 'child backend');
  assertRow(target.ownerRunId, requestedRunId, 'target ownerRunId');
  assertRow(backend.ownerRunId, requestedRunId, 'backend ownerRunId');
  assertRow(target.captureRunId, captureRunId, 'target captureRunId');
  assertRow(backend.captureRunId, captureRunId, 'backend captureRunId');
  return Object.freeze({
    source: Object.freeze({
      status: 'verified',
      artifactRoot: sourceRoot,
      receiptPath: sourcePath,
      receiptHash: sourceHash,
      identity: Object.freeze(sourceIdentity),
    }),
    final: Object.freeze({
      status: 'verified',
      artifactRoot: finalRoot,
      receiptPath: finalPath,
      receiptHash: finalHash,
      identity: Object.freeze(finalIdentity),
    }),
    finalRelativePath,
    captureRoot,
    captureRunId,
    requestedRunId,
    requestedAttemptId,
    target: Object.freeze({ ...target }),
    backend: Object.freeze({ ...backend }),
  });
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
