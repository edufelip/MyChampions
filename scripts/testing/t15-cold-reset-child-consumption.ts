import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { NativeEvidenceIdentity } from './native-view-evidence';

const HASH64 = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[a-f0-9]{24}$/u;
const ATTEMPT_ID = /^[a-f0-9]{24}:first$/u;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

type RecordValue = Record<string, unknown>;

export type OwnedChildCaptureRead = Readonly<{
  capture: RecordValue;
  capturePath: string;
  captureHash: string;
  rootIdentity: Readonly<{
    dev: number;
    ino: number;
    uid: number;
    gid: number;
    mode: number;
  }>;
  fileIdentity: Readonly<{
    dev: number;
    ino: number;
    uid: number;
    gid: number;
    mode: number;
    size: number;
  }>;
}>;

function assertPrivateOwnedDirectory(
  value: Awaited<ReturnType<typeof lstat>>,
  label: string,
): void {
  if (
    value.isSymbolicLink() ||
    !value.isDirectory() ||
    (Number(value.mode) & 0o777) !== 0o700 ||
    (typeof process.getuid === 'function' && value.uid !== process.getuid())
  )
    throw new Error(`${label} is not a canonical owned 0700 directory`);
}

function assertPrivateOwnedFile(value: Awaited<ReturnType<typeof lstat>>, label: string): void {
  if (
    value.isSymbolicLink() ||
    !value.isFile() ||
    (Number(value.mode) & 0o777) !== 0o600 ||
    (typeof process.getuid === 'function' && value.uid !== process.getuid())
  )
    throw new Error(`${label} is not a canonical owned 0600 file`);
}

function sameFileIdentity(
  left: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['stat']>>,
  right: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['stat']>>,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

/**
 * Read the child capture through one protected descriptor and bind the parsed
 * bytes to the returned 0700 namespace. The caller never supplies a `..`
 * receipt path and no path-only JSON read is accepted as a child handoff.
 */
export async function readChildCaptureFromOwnedRoot(input: {
  captureRoot: string;
  expectedCaptureRunId: string;
}): Promise<OwnedChildCaptureRead> {
  const captureRoot = requireAbsolutePath(input.captureRoot, 'captureRoot');
  const expectedCaptureRunId = requireRunId(input.expectedCaptureRunId, 'expectedCaptureRunId');
  if (path.basename(captureRoot) !== expectedCaptureRunId)
    throw new Error('captureRoot basename differs from expected captureRunId');
  const rootBefore = await lstat(captureRoot);
  assertPrivateOwnedDirectory(rootBefore, 'child capture root');
  if ((await realpath(captureRoot)) !== captureRoot)
    throw new Error('child capture root realpath changed');
  const capturePath = path.join(captureRoot, 'capture.private.json');
  if (path.dirname(capturePath) !== captureRoot)
    throw new Error('child capture path escaped the returned root');
  const pathBefore = await lstat(capturePath);
  assertPrivateOwnedFile(pathBefore, 'child capture file');
  if (pathBefore.size > MAX_CAPTURE_BYTES)
    throw new Error('child capture exceeds the bounded read limit');
  const handle = await open(capturePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const fileBefore = await handle.stat();
    if (!sameFileIdentity(pathBefore, fileBefore))
      throw new Error('child capture file identity changed before read');
    const bytes = Buffer.alloc(Number(fileBefore.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) throw new Error('child capture ended before its declared size');
      offset += result.bytesRead;
    }
    const fileAfter = await handle.stat();
    if (!sameFileIdentity(fileBefore, fileAfter))
      throw new Error('child capture file changed during protected read');
    const rootAfter = await lstat(captureRoot);
    if (!sameFileIdentity(rootBefore, rootAfter))
      throw new Error('child capture root changed during protected read');
    if ((await realpath(capturePath)) !== capturePath)
      throw new Error('child capture file realpath changed');
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error('child capture is not valid JSON');
    }
    const capture = requireRecord(parsed, 'child capture');
    if (capture.captureRoot !== captureRoot || capture.captureRunId !== expectedCaptureRunId)
      throw new Error('child capture JSON identity differs from its protected namespace');
    return Object.freeze({
      capture,
      capturePath,
      captureHash: createHash('sha256').update(bytes).digest('hex'),
      rootIdentity: {
        dev: rootAfter.dev,
        ino: rootAfter.ino,
        uid: rootAfter.uid,
        gid: rootAfter.gid,
        mode: Number(rootAfter.mode) & 0o777,
      },
      fileIdentity: {
        dev: fileAfter.dev,
        ino: fileAfter.ino,
        uid: fileAfter.uid,
        gid: fileAfter.gid,
        mode: Number(fileAfter.mode) & 0o777,
        size: fileAfter.size,
      },
    });
  } finally {
    await handle.close();
  }
}

export type ColdResetChildExpectation = Readonly<{
  requestedRunId: string;
  requestedAttemptId: string;
  fixtureResetId: string;
  cohortFixtureFingerprint: string;
  sourceFingerprint: string;
  helperFingerprint: string;
  target: RecordValue;
  backend: RecordValue;
  sourceIdentity: NativeEvidenceIdentity;
}>;

export type ChildColdResetBinding = Readonly<{
  artifactRoot: string;
  receiptPath: string;
  receiptHash: string;
  fixtureResetId: string;
  ownerRunId: string;
  attemptId: string;
  cohortFixtureFingerprint: string;
  appStateFingerprint: string;
  fixtureStateFingerprint: string;
  sourceFingerprint: string;
  helperFingerprint: string;
  cleanupStatus: 'cleaned';
  target: RecordValue;
  backend: RecordValue;
  sourceIdentity: NativeEvidenceIdentity;
}>;

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

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): RecordValue {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireString(value: unknown, label: string, max = 4096): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    value.includes('\0') ||
    /[\r\n]/u.test(value)
  )
    throw new Error(`${label} is invalid`);
  return value;
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH64.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireRunId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !RUN_ID.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireAttemptId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ATTEMPT_ID.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireAbsolutePath(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (
    !result.startsWith('/') ||
    path.normalize(result) !== result ||
    result !== result.replace(/\/+/gu, '/')
  )
    throw new Error(`${label} must be an absolute normalized path`);
  return result;
}

function requireIso(value: unknown, label: string): string {
  const result = requireString(value, label, 128);
  const parsed = Date.parse(result);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid`);
  return result;
}

function requirePositivePid(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 1)
    throw new Error(`${label} is invalid`);
  return value as number;
}

function requireObjectArray(value: unknown, label: string): RecordValue[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isRecord))
    throw new Error(`${label} must contain owned rows`);
  return value;
}

function requireNativeEvidenceIdentity(value: unknown, label: string): NativeEvidenceIdentity {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
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
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field]))
      throw new Error(`${label}.${field} is invalid`);
  }
  if (
    typeof value.mode !== 'number' ||
    typeof value.size !== 'number' ||
    value.nlink !== 1 ||
    (value.mode & 0o777) !== 0o600 ||
    value.size <= 0
  )
    throw new Error(`${label} is not a single owned 0600 file`);
  return value as NativeEvidenceIdentity;
}

function assertIdentityEqual(
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

function assertSelectedRowIdentity(
  actual: RecordValue,
  expected: RecordValue,
  fields: readonly string[],
  label: string,
): void {
  for (const field of fields) {
    if (actual[field] !== expected[field]) throw new Error(`${label}.${field} is foreign`);
  }
}

function assertOwner(value: unknown, expected: string, label: string): void {
  if (value !== expected) throw new Error(`${label} is not bound to the requested owner`);
}

function assertActualTargetAndBackend(
  reset: RecordValue,
  captureRoot: string,
  expected: ColdResetChildExpectation,
): { target: RecordValue; backend: RecordValue } {
  const target = requireRecord(reset.target, 'child reset target');
  const backend = requireRecord(reset.backend, 'child reset backend');
  const ownership = requireRecord(reset.ownership, 'child reset ownership');
  const targetCaptureRunId = requireString(target.captureRunId, 'child target captureRunId', 256);
  if (targetCaptureRunId !== captureRoot.split('/').at(-1))
    throw new Error('child reset target is not bound to the returned capture root');
  assertOwner(target.ownerRunId, expected.requestedRunId, 'child reset target ownerRunId');
  assertOwner(backend.ownerRunId, expected.requestedRunId, 'child reset backend ownerRunId');
  assertOwner(backend.captureRunId, targetCaptureRunId, 'child reset backend captureRunId');
  requireString(target.deviceId, 'child reset target deviceId', 256);
  requireString(target.appId, 'child reset target appId', 256);
  requireHash(target.binaryHash, 'child reset target binaryHash');
  const targetApiOrigin = requireString(target.apiOrigin, 'child reset target apiOrigin', 256);
  if (target.phase !== 'installed-before-ui')
    throw new Error('child reset target was not captured before UI launch');
  requireString(backend.runId, 'child reset backend runId', 256);
  requirePositivePid(backend.apiPid, 'child reset backend apiPid');
  const backendApiOrigin = requireString(backend.apiOrigin, 'child reset backend apiOrigin', 256);
  if (targetApiOrigin === backendApiOrigin)
    throw new Error('child reset target and backend listeners are not distinct');
  assertSelectedRowIdentity(target, expected.target, TARGET_IDENTITY_FIELDS, 'child reset target');
  assertSelectedRowIdentity(
    backend,
    expected.backend,
    BACKEND_IDENTITY_FIELDS,
    'child reset backend',
  );
  const backendApiStarted = requireString(
    backend.apiStarted,
    'child reset backend apiStarted',
    128,
  );
  const backendApiScript = requireString(backend.apiScript, 'child reset backend apiScript', 512);
  requireAbsolutePath(backend.artifactRoot, 'child reset backend artifactRoot');
  const backendProcesses = requireObjectArray(backend.processes, 'child reset backend processes');
  const apiProcesses = backendProcesses.filter(
    (process) =>
      process.role === 'api' &&
      process.pid === backend.apiPid &&
      process.started === backendApiStarted &&
      process.script === backendApiScript,
  );
  if (apiProcesses.length !== 1)
    throw new Error('child reset backend API process is not uniquely bound');
  const listeners = requireObjectArray(ownership.listeners, 'child reset listeners');
  if (listeners.length < 2) throw new Error('child reset must retain backend and proxy listeners');
  const listenerIds = new Set<string>();
  for (const listener of listeners) {
    if (listener.state !== 'active') throw new Error('child reset listener is not active');
    assertOwner(listener.ownerRunId, expected.requestedRunId, 'child reset listener ownerRunId');
    requireString(listener.resourceId, 'child reset listener resourceId', 128);
    if (listenerIds.has(listener.resourceId as string))
      throw new Error('child reset listener resource IDs are not unique');
    listenerIds.add(listener.resourceId as string);
    const process = requireRecord(listener.process, 'child reset listener process');
    requirePositivePid(process.pid, 'child reset listener process pid');
    requireString(process.started, 'child reset listener process started', 128);
  }
  const namespaces = requireRecord(ownership.namespaces, 'child reset namespaces');
  const captureNamespace = requireRecord(namespaces.capture, 'child reset capture namespace');
  const backendNamespace = requireRecord(namespaces.backend, 'child reset backend namespace');
  if (
    requireAbsolutePath(captureNamespace.path, 'child reset capture namespace path') !== captureRoot
  )
    throw new Error('child reset capture namespace is not the returned capture root');
  const backendNamespacePath = requireAbsolutePath(
    backendNamespace.path,
    'child reset backend namespace path',
  );
  if (
    backendNamespacePath === captureRoot ||
    backendNamespacePath.startsWith(`${captureRoot}/`) ||
    captureRoot.startsWith(`${backendNamespacePath}/`)
  )
    throw new Error('child reset capture and backend namespaces are not disjoint');
  const captureIdentity = requireRecord(captureNamespace, 'child reset capture namespace identity');
  const backendIdentity = requireRecord(backendNamespace, 'child reset backend namespace identity');
  for (const [label, identity] of [
    ['child reset capture namespace', captureIdentity],
    ['child reset backend namespace', backendIdentity],
  ] as const) {
    for (const key of ['dev', 'ino', 'uid', 'gid', 'mode'])
      if (!Number.isSafeInteger(identity[key])) throw new Error(`${label}.${key} is invalid`);
    if (identity.realpath !== identity.path || identity.mode !== 0o700)
      throw new Error(`${label} is not a canonical owned 0700 directory`);
  }
  return { target, backend };
}

/**
 * Convert the child capture's actual cold-reset report into the process-bound
 * handoff input. No path or target/backend field comes from the pre-child
 * invocation: every receipt path/hash and runtime identity is read from the
 * returned capture report and validated against the returned artifact root.
 */
export function consumeChildColdReset(input: {
  capture: unknown;
  captureRoot: string;
  expectation: ColdResetChildExpectation;
}): ChildColdResetBinding {
  const captureRoot = requireAbsolutePath(input.captureRoot, 'captureRoot');
  const expected = input.expectation;
  requireRunId(expected.requestedRunId, 'requestedRunId');
  requireAttemptId(expected.requestedAttemptId, 'requestedAttemptId');
  if (expected.requestedAttemptId !== `${expected.requestedRunId}:first`)
    throw new Error('requestedAttemptId is not bound to requestedRunId');
  requireString(expected.fixtureResetId, 'fixtureResetId', 256);
  requireHash(expected.cohortFixtureFingerprint, 'cohortFixtureFingerprint');
  requireHash(expected.sourceFingerprint, 'sourceFingerprint');
  requireHash(expected.helperFingerprint, 'helperFingerprint');
  const capture = requireRecord(input.capture, 'child capture');
  if (capture.platform !== 'ios' || capture.mode !== 'integration')
    throw new Error('child capture is not an iOS integration capture');
  if (capture.captureRoot !== captureRoot || capture.captureRunId !== captureRoot.split('/').at(-1))
    throw new Error('child capture identity is not bound to the returned capture root');
  const reset = requireRecord(capture.coldReset, 'child cold reset');
  if (reset.status !== 'fresh' || reset.cleanupStatus !== 'cleaned' || reset.blocker !== null)
    throw new Error('child cold reset is not a clean fresh preparation');
  assertOwner(reset.ownerRunId, expected.requestedRunId, 'child reset ownerRunId');
  if (
    reset.requestedRunId !== expected.requestedRunId ||
    reset.requestedAttemptId !== expected.requestedAttemptId
  )
    throw new Error('child reset requested identity differs from the requested attempt');
  if (reset.fixtureResetId !== expected.fixtureResetId)
    throw new Error('child reset fixtureResetId differs from requested attempt');
  if (reset.cohortFixtureFingerprint !== expected.cohortFixtureFingerprint)
    throw new Error('child reset cohort fingerprint differs from requested attempt');
  if (reset.sourceFingerprint !== expected.sourceFingerprint)
    throw new Error('child reset source fingerprint differs from requested attempt');
  if (reset.helperFingerprint !== expected.helperFingerprint)
    throw new Error('child reset helper fingerprint differs from requested attempt');
  const startedAt = requireIso(reset.startedAt, 'child reset startedAt');
  const finishedAt = requireIso(reset.finishedAt, 'child reset finishedAt');
  if (Date.parse(finishedAt) <= Date.parse(startedAt))
    throw new Error('child reset interval is not closed');
  const runtimeRows = assertActualTargetAndBackend(reset, captureRoot, expected);
  const fixture = requireRecord(reset.fixture, 'child reset fixture');
  if (fixture.scope !== 'native-entry-ios')
    throw new Error('child reset fixture scope is not the owned iOS entry scope');
  requireString(fixture.runId, 'child reset fixture runId', 256);
  requireHash(fixture.fixtureSha256, 'child reset fixtureSha256');
  requireHash(fixture.snapshotSha256, 'child reset snapshotSha256');
  requireHash(fixture.snapshotReceiptSha256, 'child reset snapshotReceiptSha256');
  const original = requireRecord(reset.originalResetBinding, 'child original reset binding');
  if (original.status !== 'verified')
    throw new Error('child original reset receipt is not verified');
  const artifactRoot = requireAbsolutePath(original.artifactRoot, 'child original artifactRoot');
  const receiptPath = requireAbsolutePath(original.receiptPath, 'child original receiptPath');
  if (
    artifactRoot !== captureRoot ||
    !receiptPath.startsWith(`${captureRoot}/`) ||
    !receiptPath.endsWith('/reset-original.private.json')
  )
    throw new Error('child original reset receipt is outside the returned capture root');
  const receiptHash = requireHash(original.receiptHash, 'child original receiptHash');
  const sourceIdentity = requireNativeEvidenceIdentity(
    original.identity,
    'child original source identity',
  );
  assertIdentityEqual(sourceIdentity, expected.sourceIdentity, 'child original source identity');
  if (reset.receiptPath !== original.receiptPath || reset.receiptHash !== receiptHash)
    throw new Error('child reset receipt binding is internally inconsistent');
  const appStateFingerprint = requireHash(reset.appStateFingerprint, 'child appStateFingerprint');
  const fixtureStateFingerprint = requireHash(
    reset.fixtureStateFingerprint,
    'child fixtureStateFingerprint',
  );
  return Object.freeze({
    artifactRoot,
    receiptPath,
    receiptHash,
    fixtureResetId: expected.fixtureResetId,
    ownerRunId: expected.requestedRunId,
    attemptId: expected.requestedAttemptId,
    cohortFixtureFingerprint: expected.cohortFixtureFingerprint,
    appStateFingerprint,
    fixtureStateFingerprint,
    sourceFingerprint: expected.sourceFingerprint,
    helperFingerprint: expected.helperFingerprint,
    cleanupStatus: 'cleaned',
    target: runtimeRows.target,
    backend: runtimeRows.backend,
    sourceIdentity: Object.freeze(sourceIdentity),
  });
}
