import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { requireAndroidDetoxCameraIdentityBoundary } from './native-detox-camera-android-identity';
import {
  readNativeEvidenceObservation,
  type NativeEvidenceIdentity,
} from './native-detox-camera-android-q-adapter';
import type {
  AndroidDetoxCameraResetBinding,
  AndroidDetoxCameraResetExpectation,
  AndroidDetoxCameraResetProof,
} from './native-detox-camera-android-reset';
export type {
  AndroidDetoxCameraResetBinding,
  AndroidDetoxCameraResetExpectation,
  AndroidDetoxCameraResetProof,
} from './native-detox-camera-android-reset';

const HASH64 = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[a-f0-9]{24}$/u;
const ATTEMPT_ID = /^[a-f0-9]{24}:first$/u;
const RESET_RECEIPT = 'reset-original.private.json' as const;

type Row = Record<string, unknown>;

const TARGET_FIELDS = [
  'platform',
  'deviceId',
  'osVersion',
  'appId',
  'binaryHash',
  'apiOrigin',
  'buildProfile',
  'captureRunId',
  'ownerRunId',
  'phase',
] as const;
const BACKEND_FIELDS = [
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

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function record(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Row;
}

function stringValue(value: unknown, label: string, max = 4096): string {
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

function hashValue(value: unknown, label: string): string {
  const result = stringValue(value, label, 128);
  if (!HASH64.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function requireIdentity(value: unknown, label: string): NativeEvidenceIdentity {
  const identity = record(value, label) as Partial<NativeEvidenceIdentity>;
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
    assert(
      typeof identity[field] === 'number' && Number.isFinite(identity[field]),
      `${label}.${field} is invalid`,
    );
  }
  assert.equal(identity.nlink, 1, `${label} is not a single file`);
  assert.equal(Number(identity.mode) & 0o777, 0o600, `${label} is not private`);
  assert(Number(identity.size) > 0, `${label} is empty`);
  return identity as NativeEvidenceIdentity;
}

function runId(value: unknown, label: string): string {
  const result = stringValue(value, label, 64);
  if (!RUN_ID.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function attemptId(value: unknown, label: string): string {
  const result = stringValue(value, label, 64);
  if (!ATTEMPT_ID.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function absoluteNormalized(value: unknown, label: string): string {
  const result = stringValue(value, label, 4096);
  if (!path.isAbsolute(result) || path.normalize(result) !== result)
    throw new Error(`${label} must be an absolute normalized path`);
  return result;
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
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
    assert.equal(actual[field], expected[field], `${label}.${field} changed`);
  }
}

function selectedRowIdentity(
  actual: Row,
  expected: Row,
  fields: readonly string[],
  label: string,
): void {
  for (const field of fields) {
    assert.equal(actual[field], expected[field], `${label}.${field} is foreign`);
  }
}

function isoTimestamp(value: unknown, label: string): number {
  const result = stringValue(value, label, 128);
  const parsed = Date.parse(result);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
}

function requireIndependentBinding(
  value: unknown,
  expected: AndroidDetoxCameraResetExpectation,
): AndroidDetoxCameraResetBinding {
  const row = record(value, 'Android Detox camera cold-reset binding');
  const binding = {
    artifactRoot: absoluteNormalized(row.artifactRoot, 'cold-reset source artifactRoot'),
    receiptPath: absoluteNormalized(row.receiptPath, 'cold-reset source receiptPath'),
    receiptHash: hashValue(row.receiptHash, 'cold-reset source receiptHash'),
    fixtureResetId: stringValue(row.fixtureResetId, 'cold-reset fixtureResetId', 256),
    ownerRunId: runId(row.ownerRunId, 'cold-reset ownerRunId'),
    attemptId: attemptId(row.attemptId, 'cold-reset attemptId'),
    cohortFixtureFingerprint: hashValue(
      row.cohortFixtureFingerprint,
      'cold-reset cohortFixtureFingerprint',
    ),
    appStateFingerprint: hashValue(row.appStateFingerprint, 'cold-reset appStateFingerprint'),
    fixtureStateFingerprint: hashValue(
      row.fixtureStateFingerprint,
      'cold-reset fixtureStateFingerprint',
    ),
    sourceFingerprint: hashValue(row.sourceFingerprint, 'cold-reset sourceFingerprint'),
    helperFingerprint: hashValue(row.helperFingerprint, 'cold-reset helperFingerprint'),
    cleanupStatus: row.cleanupStatus,
    target: record(row.target, 'cold-reset target'),
    backend: record(row.backend, 'cold-reset backend'),
    sourceIdentity: requireIdentity(row.sourceIdentity, 'cold-reset source identity'),
  } as AndroidDetoxCameraResetBinding;
  assert.equal(binding.cleanupStatus, 'cleaned');
  assert.notEqual(
    binding.ownerRunId,
    expected.requestedRunId,
    'cold-reset resource owner aliases the outer attempt',
  );
  assert.equal(binding.attemptId, expected.requestedAttemptId);
  assert.equal(binding.fixtureResetId, expected.fixtureResetId);
  assert.equal(binding.cohortFixtureFingerprint, expected.cohortFixtureFingerprint);
  assert.equal(binding.sourceFingerprint, expected.sourceFingerprint);
  assert.equal(binding.helperFingerprint, expected.helperFingerprint);
  assert.equal(binding.attemptId, `${expected.requestedRunId}:first`);
  return binding;
}

function readProtectedJson(
  root: string,
  relative: string,
  label: string,
): {
  bytes: Buffer;
  hash: string;
  identity: NativeEvidenceIdentity;
  value: Row;
} {
  const observation = readNativeEvidenceObservation(root, relative, true);
  let value: unknown;
  try {
    value = JSON.parse(observation.bytes.toString('utf8'));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`,
    );
  }
  return {
    bytes: Buffer.from(observation.bytes),
    hash: sha256(observation.bytes),
    identity: observation.identity,
    value: record(value, label),
  };
}

function validateResetRow(
  row: Row,
  expected: AndroidDetoxCameraResetExpectation,
  binding: AndroidDetoxCameraResetBinding,
): { target: Row; backend: Row; fixture: Row } {
  assert.equal(row.status, 'fresh');
  assert.equal(row.requestedRunId, expected.requestedRunId);
  assert.equal(row.requestedAttemptId, expected.requestedAttemptId);
  runId(row.captureRunId, 'cold-reset captureRunId');
  assert.notEqual(row.captureRunId, expected.requestedRunId);
  assert.equal(row.ownerRunId, binding.ownerRunId);
  assert.equal(row.fixtureResetId, expected.fixtureResetId);
  assert.equal(row.cohortFixtureFingerprint, expected.cohortFixtureFingerprint);
  assert.equal(row.sourceFingerprint, expected.sourceFingerprint);
  assert.equal(row.helperFingerprint, expected.helperFingerprint);
  assert.equal(row.cleanupStatus, 'cleaned');
  assert.equal(row.blocker, null);
  const started = isoTimestamp(row.startedAt, 'cold-reset startedAt');
  const finished = isoTimestamp(row.finishedAt, 'cold-reset finishedAt');
  assert(finished > started, 'cold-reset interval is not closed');
  assert.equal(
    hashValue(row.appStateFingerprint, 'cold-reset appStateFingerprint'),
    binding.appStateFingerprint,
  );
  assert.equal(
    hashValue(row.fixtureStateFingerprint, 'cold-reset fixtureStateFingerprint'),
    binding.fixtureStateFingerprint,
  );
  const target = record(row.target, 'cold-reset target row');
  const backend = record(row.backend, 'cold-reset backend row');
  const fixture = record(row.fixture, 'cold-reset fixture row');
  assert.equal(target.platform, 'android');
  runId(target.targetRunId, 'cold-reset targetRunId');
  assert.notEqual(target.targetRunId, binding.ownerRunId);
  assert.equal(target.phase, 'installed-before-ui');
  assert.equal(fixture.scope, 'native-entry-android');
  runId(stringValue(fixture.runId, 'cold-reset fixture runId'), 'cold-reset fixture runId');
  hashValue(fixture.fixtureSha256, 'cold-reset fixtureSha256');
  hashValue(fixture.snapshotSha256, 'cold-reset snapshotSha256');
  hashValue(fixture.snapshotReceiptSha256, 'cold-reset snapshotReceiptSha256');
  selectedRowIdentity(target, binding.target, TARGET_FIELDS, 'cold-reset target');
  selectedRowIdentity(backend, binding.backend, BACKEND_FIELDS, 'cold-reset backend');
  return { target, backend, fixture };
}

/**
 * Read the final receipt only after the owner has acquired its Android target,
 * backend, proxy and private output namespace. The source receipt is read
 * through the same descriptor-bound reader and its bytes must equal the final
 * handoff. A missing binding, iOS receipt, stale receipt, or foreign row is a
 * hard block; it is never downgraded to source-only success.
 */
export function readAndroidDetoxCameraResetProof(input: {
  artifactRoot: string;
  expectation: AndroidDetoxCameraResetExpectation;
  binding: unknown;
}): AndroidDetoxCameraResetProof {
  const expectation = input.expectation;
  const requestedRunId = runId(expectation.requestedRunId, 'cold-reset requestedRunId');
  const requestedAttemptId = attemptId(
    expectation.requestedAttemptId,
    'cold-reset requestedAttemptId',
  );
  assert.equal(requestedAttemptId, `${requestedRunId}:first`);
  const binding = requireIndependentBinding(input.binding, expectation);
  const finalRoot = absoluteNormalized(input.artifactRoot, 'Android Detox camera final root');
  const sourceRoot = absoluteNormalized(binding.artifactRoot, 'cold-reset source root');
  const sourcePath = absoluteNormalized(binding.receiptPath, 'cold-reset source path');
  assert(pathInside(sourceRoot, sourcePath), 'cold-reset source receipt escaped its root');
  assert.equal(path.basename(sourcePath), RESET_RECEIPT);
  assert.equal(
    path.dirname(sourcePath),
    sourceRoot,
    'cold-reset source receipt is not a direct child of its source root',
  );
  assert(
    sourceRoot !== finalRoot &&
      !pathInside(sourceRoot, finalRoot) &&
      !pathInside(finalRoot, sourceRoot),
    'cold-reset source and final namespaces are not disjoint',
  );
  const source = readProtectedJson(
    sourceRoot,
    path.relative(sourceRoot, sourcePath),
    'cold-reset source receipt',
  );
  assertIdentityEqual(source.identity, binding.sourceIdentity, 'cold-reset source identity');
  assert.equal(source.hash, binding.receiptHash, 'cold-reset source receipt hash changed');
  const final = readProtectedJson(finalRoot, RESET_RECEIPT, 'cold-reset final receipt');
  assert.equal(final.hash, source.hash, 'cold-reset final receipt hash differs from source');
  assert(final.bytes.equals(source.bytes), 'cold-reset handoff changed receipt bytes');
  const rows = validateResetRow(final.value, expectation, binding);
  return Object.freeze({
    status: 'verified',
    requestedRunId,
    requestedAttemptId,
    fixtureResetId: expectation.fixtureResetId,
    cohortFixtureFingerprint: expectation.cohortFixtureFingerprint,
    sourceFingerprint: expectation.sourceFingerprint,
    helperFingerprint: expectation.helperFingerprint,
    appStateFingerprint: binding.appStateFingerprint,
    fixtureStateFingerprint: binding.fixtureStateFingerprint,
    receiptPath: path.join(finalRoot, RESET_RECEIPT),
    receiptHash: final.hash,
    originalReceiptBinding: Object.freeze({
      status: 'verified' as const,
      artifactRoot: sourceRoot,
      receiptPath: sourcePath,
      receiptHash: source.hash,
      identity: Object.freeze(source.identity),
    }),
    sourceReceiptPath: sourcePath,
    sourceReceiptHash: source.hash,
    sourceIdentity: Object.freeze(source.identity),
    finalIdentity: Object.freeze(final.identity),
    target: Object.freeze({ ...rows.target }),
    backend: Object.freeze({ ...rows.backend }),
    fixture: Object.freeze({ ...rows.fixture }),
  });
}

/**
 * Bind the cold receipt to the exact runtime acquired by the Android owner.
 * These fields intentionally include both listeners: the target uses the
 * owned proxy origin while the backend row uses the owned server API origin.
 */
export function requireAndroidDetoxCameraResetRuntimeMatchIndependent(input: {
  proof: AndroidDetoxCameraResetProof;
  runtime: Readonly<{
    requestedRunId: string;
    captureRunId: string;
    ownerRunId: string;
    targetRunId: string;
    fixtureRunId: string;
    target: Readonly<{
      deviceId: string;
      osVersion: string;
      appId: string;
      buildProfile: string;
      binaryHash: string;
      apiOrigin: string;
    }>;
    build: Readonly<{
      sourceTreeHash: string;
      helperInputsHash: string;
      binaryHash: string;
    }>;
    backend: Readonly<{
      runId: string;
      artifactRoot: string;
      apiOrigin: string;
      apiPid: number;
      apiStarted: string;
      apiScript: string;
      backendAttemptId: string;
      manifestSha256: string;
    }>;
  }>;
}): void {
  const { proof, runtime } = input;
  runId(runtime.requestedRunId, 'Android reset runtime requestedRunId');
  const target = proof.target;
  const backend = proof.backend;
  requireAndroidDetoxCameraIdentityBoundary({
    requestedRunId: runtime.requestedRunId,
    captureRunId: runtime.captureRunId,
    ownerRunId: runtime.ownerRunId,
    backendRunId: runtime.backend.runId,
  });
  assert.equal(proof.requestedRunId, runtime.requestedRunId);
  assert.equal(target.platform, 'android');
  assert.equal(target.deviceId, runtime.target.deviceId);
  assert.equal(target.osVersion, runtime.target.osVersion);
  assert.equal(target.appId, runtime.target.appId);
  assert.equal(target.buildProfile, runtime.target.buildProfile);
  assert.equal(target.binaryHash, runtime.target.binaryHash);
  assert.equal(target.apiOrigin, runtime.target.apiOrigin);
  assert.equal(target.captureRunId, runtime.captureRunId);
  assert.equal(target.ownerRunId, runtime.ownerRunId);
  assert.equal(target.targetRunId, runtime.targetRunId);
  assert.notEqual(runtime.targetRunId, runtime.requestedRunId);
  assert.notEqual(runtime.targetRunId, runtime.captureRunId);
  assert.notEqual(runtime.targetRunId, runtime.ownerRunId);
  assert.notEqual(runtime.targetRunId, backend.runId);
  assert.equal(target.phase, 'installed-before-ui');
  assert.equal(backend.runId, runtime.backend.runId);
  assert.equal(backend.ownerRunId, runtime.ownerRunId);
  assert.equal(backend.captureRunId, runtime.captureRunId);
  assert.equal(backend.artifactRoot, runtime.backend.artifactRoot);
  assert.equal(backend.apiOrigin, runtime.backend.apiOrigin);
  assert.equal(backend.apiPid, runtime.backend.apiPid);
  assert.equal(backend.apiStarted, runtime.backend.apiStarted);
  assert.equal(backend.apiScript, runtime.backend.apiScript);
  assert.equal(backend.backendAttemptId, runtime.backend.backendAttemptId);
  assert.equal(backend.manifestSha256, runtime.backend.manifestSha256);
  assert.equal(runtime.backend.runId, runtime.fixtureRunId);
  assert.notEqual(target.apiOrigin, backend.apiOrigin);
  assert.equal(proof.sourceFingerprint, runtime.build.sourceTreeHash);
  assert.equal(proof.helperFingerprint, runtime.build.helperInputsHash);
  assert.equal(target.binaryHash, runtime.build.binaryHash);
  assert.equal(proof.fixture.runId, runtime.fixtureRunId);
  assert.equal(proof.fixture.scope, 'native-entry-android');
}

export { RESET_RECEIPT as ANDROID_DETOX_CAMERA_RESET_RECEIPT_NAME_INDEPENDENT };
