import assert from 'node:assert/strict';
import path from 'node:path';
import type {
  NativeComparisonOwnershipWindow,
  NativeComparisonReceiptInput,
} from './compare-native-pilot';
import type { DetoxBaselineReport } from './detox-integrated-session-baseline';

const RUN_ID = /^[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;

type Row = Record<string, unknown>;

export type T15AndroidSessionLifecycleExpectation = Readonly<{
  requestedRunId: string;
  requestedAttemptId: string;
  fixtureResetId: string;
  cohortFixtureFingerprint: string;
  sourceFingerprint: string;
  helperFingerprint: string;
}>;

export type T15AndroidSessionLifecycleNormalizationInput = Readonly<{
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  resourceOwnerRunId: string | null;
  expectation: T15AndroidSessionLifecycleExpectation;
  report: DetoxBaselineReport;
  resetReceipt: unknown;
  captureLedger: unknown;
  cleanupLedger: unknown;
  publicReceipt?: NativeComparisonReceiptInput | null;
}>;

export type T15AndroidSessionLifecycleIdentity = Readonly<{
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  resourceOwnerRunId: string;
  targetRunId: string;
  backendRunId: string;
  backendAttemptId: string;
  fixtureRunId: string;
  fixtureResetId: string;
  target: Row;
  backend: Row;
  fixture: Row;
  originalResetBinding: Row;
}>;

export type T15AndroidSessionLifecycleNormalization = Readonly<{
  schemaVersion: 1;
  kind: 'private-t15-android-detox-session-lifecycle-normalization';
  status: 'private-candidate' | 'blocked' | 'not-requested';
  nativePassingCases: 0;
  publicPassingCases: 0;
  coldQualifiedAttempts: 0;
  sharedLifecycle: {
    status: 'split-identity-pending' | 'sealed-contract-compatible';
    blockers: readonly string[];
  };
  owner: {
    status: 'normalized' | 'blocked' | 'not-requested';
    blockers: readonly string[];
  };
  publicConsumer: {
    status: 'normalized' | 'pending' | 'not-requested';
    blockers: readonly string[];
  };
  cleanup: {
    status: 'closed' | 'blocked' | 'not-requested';
    blockers: readonly string[];
    ownershipWindows: readonly NativeComparisonOwnershipWindow[];
  };
  identity: T15AndroidSessionLifecycleIdentity | null;
}>;

function row(value: unknown, label: string): Row {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is malformed`);
  return value as Row;
}

function text(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is missing`);
  assert(!/[\0\r\n]/u.test(value), `${label} contains a control character`);
  return value;
}

function runId(value: unknown, label: string): string {
  const result = text(value, label);
  assert.match(result, RUN_ID, `${label} is not a run ID`);
  return result;
}

function hash(value: unknown, label: string): string {
  const result = text(value, label);
  assert.match(result, HASH, `${label} is not a SHA-256 hash`);
  return result;
}

function iso(value: unknown, label: string): string {
  const result = text(value, label);
  assert(Number.isFinite(Date.parse(result)), `${label} is not an ISO timestamp`);
  return result;
}

function blocker(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 256);
}

function requireClosedWindows(
  value: unknown,
  ownerRunId: string,
): readonly NativeComparisonOwnershipWindow[] {
  assert(Array.isArray(value), 'cleanup ownershipWindows are missing');
  assert(value.length > 0, 'cleanup ownershipWindows are empty');
  const rows = value.map((entry, index) => {
    const current = row(entry, `cleanup ownershipWindows[${index}]`);
    const resourceType = current.resourceType;
    assert(resourceType === 'process' || resourceType === 'port');
    const resourceId = text(current.resourceId, `cleanup ownershipWindows[${index}].resourceId`);
    const rowOwner = runId(current.ownerRunId, `cleanup ownershipWindows[${index}].ownerRunId`);
    assert.equal(rowOwner, ownerRunId, 'cleanup ownership window belongs to another owner');
    const processStartIdentity =
      current.processStartIdentity === null
        ? null
        : text(
            current.processStartIdentity,
            `cleanup ownershipWindows[${index}].processStartIdentity`,
          );
    if (resourceType === 'process') assert(processStartIdentity !== null);
    else assert.equal(processStartIdentity, null);
    const acquiredAt = iso(current.acquiredAt, `cleanup ownershipWindows[${index}].acquiredAt`);
    const releasedAt = iso(current.releasedAt, `cleanup ownershipWindows[${index}].releasedAt`);
    assert(Date.parse(releasedAt) > Date.parse(acquiredAt));
    return {
      resourceType,
      resourceId,
      ownerRunId,
      processStartIdentity,
      acquiredAt,
      releasedAt,
    } satisfies NativeComparisonOwnershipWindow;
  });
  const keys = rows.map((entry) => `${entry.resourceType}:${entry.resourceId}`);
  assert.equal(new Set(keys).size, keys.length, 'cleanup ownership windows are duplicated');
  assert(rows.some((entry) => entry.resourceType === 'process'));
  assert(rows.some((entry) => entry.resourceType === 'port'));
  return rows;
}

function requireOriginalBinding(value: unknown, captureRunId: string): Row {
  const binding = row(value, 'reset originalReceiptBinding');
  assert.equal(binding.status, 'verified');
  const receiptPath = path.resolve(text(binding.receiptPath, 'reset receiptPath'));
  const artifactRoot = path.resolve(text(binding.artifactRoot, 'reset artifactRoot'));
  assert.equal(
    path.basename(artifactRoot),
    captureRunId,
    'reset artifact root is not bound to the capture namespace',
  );
  assert(path.dirname(receiptPath) === artifactRoot, 'reset receipt escaped its artifact root');
  hash(binding.receiptHash, 'reset receiptHash');
  return binding;
}

function requireReset(
  input: T15AndroidSessionLifecycleNormalizationInput,
): T15AndroidSessionLifecycleIdentity {
  const resourceOwnerRunId = input.resourceOwnerRunId;
  assert(resourceOwnerRunId, 'resourceOwnerRunId is missing');
  const reset = row(input.resetReceipt, 'Android cold reset original receipt');
  assert.equal(reset.kind, 'private-t15-cold-reset-original-from-owned-android-session');
  assert.equal(reset.status, 'fresh');
  assert.equal(reset.requestedRunId, input.requestedRunId);
  assert.equal(reset.requestedAttemptId, input.requestedAttemptId);
  assert.equal(reset.captureRunId, input.captureRunId);
  assert.equal(reset.ownerRunId, input.resourceOwnerRunId);
  assert.equal(reset.fixtureResetId, input.expectation.fixtureResetId);
  assert.equal(reset.cleanupStatus, 'cleaned');
  assert.equal(reset.resourceCleanupStatus, 'deferred-to-capture-finalizer');
  assert.equal(reset.cohortFixtureFingerprint, input.expectation.cohortFixtureFingerprint);
  assert.equal(reset.sourceFingerprint, input.expectation.sourceFingerprint);
  assert.equal(reset.helperFingerprint, input.expectation.helperFingerprint);
  const startedAt = iso(reset.startedAt, 'reset startedAt');
  const finishedAt = iso(reset.finishedAt, 'reset finishedAt');
  assert(Date.parse(finishedAt) > Date.parse(startedAt), 'reset interval is not closed');
  const target = row(reset.target, 'reset target');
  const backend = row(reset.backend, 'reset backend');
  const fixture = row(reset.fixture, 'reset fixture');
  const targetRunId = runId(target.targetRunId, 'reset targetRunId');
  const backendRunId = runId(backend.runId, 'reset backend runId');
  const backendAttemptId = text(backend.backendAttemptId, 'reset backendAttemptId');
  const fixtureRunId = runId(fixture.runId, 'reset fixture runId');
  assert.equal(target.ownerRunId, input.resourceOwnerRunId);
  assert.equal(backend.ownerRunId, input.resourceOwnerRunId);
  assert.equal(fixtureRunId, backendRunId);
  assert.notEqual(input.requestedRunId, input.captureRunId);
  assert.notEqual(input.requestedRunId, input.resourceOwnerRunId);
  assert.notEqual(input.captureRunId, input.resourceOwnerRunId);
  assert.notEqual(targetRunId, input.requestedRunId);
  assert.notEqual(targetRunId, input.captureRunId);
  assert.notEqual(targetRunId, input.resourceOwnerRunId);
  assert.notEqual(targetRunId, backendRunId);
  assert.notEqual(backendRunId, input.requestedRunId);
  assert.notEqual(backendRunId, input.captureRunId);
  assert.notEqual(backendRunId, input.resourceOwnerRunId);
  assert.equal(input.report.captureRunId, input.captureRunId);
  assert.equal(input.report.backendRunId, backendRunId);
  assert.equal(input.report.backendAttemptId, backendAttemptId);
  assert.equal(input.report.coldReset.status, 'fresh');
  assert.equal(input.report.coldReset.requestedRunId, input.requestedRunId);
  assert.equal(input.report.coldReset.requestedAttemptId, input.requestedAttemptId);
  assert.equal(input.report.coldReset.ownerRunId, input.resourceOwnerRunId);
  assert.equal(input.report.fixture?.runId, fixtureRunId);
  assert.equal(input.report.fixture?.fixtureHash, fixture.fixtureSha256);
  assert.equal(input.report.target?.deviceId, target.deviceId);
  const originalBinding = requireOriginalBinding(
    reset.originalResetBinding,
    input.report.captureRunId,
  );
  assert.equal(input.report.coldReset.receiptHash, originalBinding.receiptHash);
  assert.equal(input.report.coldReset.receiptPath, originalBinding.receiptPath);
  return {
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRunId: input.captureRunId,
    resourceOwnerRunId,
    targetRunId,
    backendRunId,
    backendAttemptId,
    fixtureRunId,
    fixtureResetId: input.expectation.fixtureResetId,
    target,
    backend,
    fixture,
    originalResetBinding: originalBinding,
  };
}

function requireCapture(
  input: T15AndroidSessionLifecycleNormalizationInput,
  identity: T15AndroidSessionLifecycleIdentity,
): void {
  const capture = row(input.captureLedger, 'Detox capture-final ledger');
  assert.equal(capture.kind, 'private Detox owned-session capture ledger; not a public receipt');
  assert.equal(capture.fileName, 'capture-final.private.json');
  assert.equal(capture.phase, 'final');
  assert.equal(capture.finalized, true);
  assert.equal(capture.result, input.report.result);
  assert.equal(capture.cleanup, 'cleaned');
  assert.equal(capture.independentCleanup, 'passed');
  assert.equal(capture.cleanupFinalLedger, 'cleanup-final.private.json');
  assert.equal(capture.requestedRunId, identity.requestedRunId);
  assert.equal(capture.requestedAttemptId, identity.requestedAttemptId);
  assert.equal(capture.captureRunId, identity.captureRunId);
  assert.equal(capture.ownerRunId, identity.resourceOwnerRunId);
}

function requireCleanup(
  input: T15AndroidSessionLifecycleNormalizationInput,
  identity: T15AndroidSessionLifecycleIdentity,
): readonly NativeComparisonOwnershipWindow[] {
  const cleanup = row(input.cleanupLedger, 'Detox cleanup-final ledger');
  assert.equal(cleanup.kind, 'private Detox cleanup ledger after stopped-resource drain');
  assert.equal(cleanup.finalized, true);
  assert.equal(cleanup.independent, 'passed');
  assert(Array.isArray(cleanup.failures) && cleanup.failures.length === 0);
  assert.equal(cleanup.requestedRunId, identity.requestedRunId);
  assert.equal(cleanup.requestedAttemptId, identity.requestedAttemptId);
  assert.equal(cleanup.captureRunId, identity.captureRunId);
  assert.equal(cleanup.ownerRunId, identity.resourceOwnerRunId);
  return requireClosedWindows(cleanup.ownershipWindows, identity.resourceOwnerRunId);
}

function requirePublic(
  receipt: NativeComparisonReceiptInput,
  identity: T15AndroidSessionLifecycleIdentity,
): void {
  const receiptPath = path.resolve(text(receipt.path, 'public receipt path'));
  const artifactRoot = path.resolve(text(receipt.artifactRoot, 'public receipt artifactRoot'));
  assert(path.dirname(receiptPath) === artifactRoot);
  hash(receipt.receiptHash, 'public receipt hash');
  const value = row(receipt.receipt, 'public receipt');
  assert.equal(value.runId, identity.requestedRunId);
  assert.equal(value.attemptId, identity.requestedAttemptId);
  // The public-receipt schema intentionally has no capture/resource-owner/
  // backend fields. Those namespaces are bound by the private reset/capture/
  // cleanup ledgers and the outer bridge, so tolerate only optional legacy
  // fields when a source-only fixture supplies them.
  if (value.captureRunId !== undefined) assert.equal(value.captureRunId, identity.captureRunId);
  if (value.ownerRunId !== undefined) assert.equal(value.ownerRunId, identity.resourceOwnerRunId);
  if (value.backendRunId !== undefined) assert.equal(value.backendRunId, identity.backendRunId);
  const target = row(value.target, 'public receipt target');
  for (const field of [
    'deviceId',
    'osVersion',
    'appId',
    'buildProfile',
    'binaryHash',
    'apiOrigin',
  ] as const)
    if (identity.target[field] !== undefined && identity.target[field] !== null)
      assert.equal(target[field], identity.target[field], `public receipt target.${field}`);
  assert(
    ['passed', 'application-failed', 'harness-blocked', 'cancelled'].includes(String(value.result)),
  );
}

/**
 * Normalize the real Android session route's split IDs without pretending
 * that it satisfies the sealed shared lifecycle. The route is a private
 * candidate until a real outer receipt and closed ownership ledger exist.
 */
export function normalizeT15AndroidDetoxSessionLifecycle(
  input: T15AndroidSessionLifecycleNormalizationInput,
): T15AndroidSessionLifecycleNormalization {
  const base = {
    schemaVersion: 1 as const,
    kind: 'private-t15-android-detox-session-lifecycle-normalization' as const,
    nativePassingCases: 0 as const,
    publicPassingCases: 0 as const,
    coldQualifiedAttempts: 0 as const,
  };
  if (!input.resourceOwnerRunId) {
    return {
      ...base,
      status: 'not-requested',
      sharedLifecycle: { status: 'split-identity-pending', blockers: ['cold-reset-not-requested'] },
      owner: { status: 'not-requested', blockers: [] },
      publicConsumer: { status: 'not-requested', blockers: [] },
      cleanup: { status: 'not-requested', blockers: [], ownershipWindows: [] },
      identity: null,
    };
  }
  const ownerBlockers: string[] = [];
  let identity: T15AndroidSessionLifecycleIdentity | null = null;
  try {
    assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
    runId(input.requestedRunId, 'requestedRunId');
    runId(input.captureRunId, 'captureRunId');
    runId(input.resourceOwnerRunId, 'resourceOwnerRunId');
    identity = requireReset(input);
    requireCapture(input, identity);
  } catch (error) {
    ownerBlockers.push(blocker(error));
  }
  const ownerStatus =
    identity && ownerBlockers.length === 0 ? ('normalized' as const) : ('blocked' as const);
  const cleanupBlockers: string[] = [];
  let ownershipWindows: readonly NativeComparisonOwnershipWindow[] = [];
  if (identity && ownerBlockers.length === 0) {
    try {
      ownershipWindows = requireCleanup(input, identity);
    } catch (error) {
      cleanupBlockers.push(blocker(error));
    }
  } else cleanupBlockers.push('owner-normalization-blocked');
  const publicBlockers: string[] = [];
  let publicStatus: T15AndroidSessionLifecycleNormalization['publicConsumer']['status'] = 'pending';
  if (!input.publicReceipt) publicBlockers.push('outer-public-receipt-not-produced');
  else if (!identity || ownerBlockers.length > 0)
    publicBlockers.push('owner-normalization-blocked');
  else {
    try {
      requirePublic(input.publicReceipt, identity);
      publicStatus = 'normalized';
    } catch (error) {
      publicBlockers.push(blocker(error));
    }
  }
  const sharedBlockers = [
    'sealed-shared-lifecycle-expects-backend-run-to-equal-resource-owner-run',
    'android-route-keeps-request-capture-resource-owner-target-and-backend-identities-distinct',
  ];
  const status =
    ownerStatus === 'normalized' && publicStatus === 'normalized' && cleanupBlockers.length === 0
      ? ('private-candidate' as const)
      : ('blocked' as const);
  return {
    ...base,
    status,
    sharedLifecycle: { status: 'split-identity-pending', blockers: sharedBlockers },
    owner: { status: ownerStatus, blockers: ownerBlockers },
    publicConsumer: { status: publicStatus, blockers: publicBlockers },
    cleanup: {
      status: cleanupBlockers.length === 0 ? 'closed' : 'blocked',
      blockers: cleanupBlockers,
      ownershipWindows,
    },
    identity,
  };
}
