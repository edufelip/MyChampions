import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeT15AndroidDetoxSessionLifecycle,
  type T15AndroidSessionLifecycleNormalizationInput,
} from '../../scripts/testing/t15-detox-android-session-normalization';
import type { DetoxBaselineReport } from '../../scripts/testing/detox-integrated-session-baseline';

const ids = {
  requested: 'a'.repeat(24),
  capture: 'b'.repeat(24),
  owner: 'c'.repeat(24),
  target: 'd'.repeat(24),
  backend: 'e'.repeat(24),
};
const hash = 'f'.repeat(64);
const startedAt = '2026-10-05T06:00:00.000Z';
const releasedAt = '2026-10-05T06:01:00.000Z';
const captureRoot = `/private/q/.qa/artifacts/native-pilot/${ids.capture}`;
const resetPath = `${captureRoot}/reset-original.private.json`;

function baseInput(): T15AndroidSessionLifecycleNormalizationInput {
  const report = {
    result: 'passed',
    captureRunId: ids.capture,
    backendRunId: ids.backend,
    backendAttemptId: `${ids.backend}:first`,
    target: { platform: 'android', deviceId: 'emulator-5554' },
    fixture: { runId: ids.backend, fixtureHash: hash },
    coldReset: {
      status: 'fresh',
      requestedRunId: ids.requested,
      requestedAttemptId: `${ids.requested}:first`,
      ownerRunId: ids.owner,
      receiptPath: resetPath,
      receiptHash: hash,
      target: null,
      backend: null,
      fixture: null,
      originalResetBinding: null,
      blocker: null,
    },
  } as unknown as DetoxBaselineReport;
  const target = {
    platform: 'android',
    deviceId: 'emulator-5554',
    targetRunId: ids.target,
    ownerRunId: ids.owner,
  };
  const backend = {
    runId: ids.backend,
    ownerRunId: ids.owner,
    backendAttemptId: `${ids.backend}:first`,
  };
  const fixture = { runId: ids.backend, fixtureSha256: hash };
  const resetReceipt = {
    kind: 'private-t15-cold-reset-original-from-owned-android-session',
    status: 'fresh',
    requestedRunId: ids.requested,
    requestedAttemptId: `${ids.requested}:first`,
    captureRunId: ids.capture,
    ownerRunId: ids.owner,
    fixtureResetId: 'fixture-reset-a',
    cleanupStatus: 'cleaned',
    resourceCleanupStatus: 'deferred-to-capture-finalizer',
    cohortFixtureFingerprint: hash,
    sourceFingerprint: hash,
    helperFingerprint: hash,
    startedAt,
    finishedAt: '2026-10-05T06:00:01.000Z',
    target,
    backend,
    fixture,
    receiptHash: hash,
    originalResetBinding: {
      status: 'verified',
      receiptPath: resetPath,
      artifactRoot: captureRoot,
      receiptHash: hash,
    },
  };
  const ownershipWindows = [
    {
      resourceType: 'process',
      resourceId: '8200',
      ownerRunId: ids.owner,
      processStartIdentity: startedAt,
      acquiredAt: startedAt,
      releasedAt,
    },
    {
      resourceType: 'port',
      resourceId: '41002',
      ownerRunId: ids.owner,
      processStartIdentity: null,
      acquiredAt: startedAt,
      releasedAt,
    },
  ] as const;
  return {
    requestedRunId: ids.requested,
    requestedAttemptId: `${ids.requested}:first`,
    captureRunId: ids.capture,
    resourceOwnerRunId: ids.owner,
    expectation: {
      requestedRunId: ids.requested,
      requestedAttemptId: `${ids.requested}:first`,
      fixtureResetId: 'fixture-reset-a',
      cohortFixtureFingerprint: hash,
      sourceFingerprint: hash,
      helperFingerprint: hash,
    },
    report,
    resetReceipt,
    captureLedger: {
      kind: 'private Detox owned-session capture ledger; not a public receipt',
      fileName: 'capture-final.private.json',
      phase: 'final',
      finalized: true,
      result: 'passed',
      cleanup: 'cleaned',
      independentCleanup: 'passed',
      cleanupFinalLedger: 'cleanup-final.private.json',
      requestedRunId: ids.requested,
      requestedAttemptId: `${ids.requested}:first`,
      captureRunId: ids.capture,
      ownerRunId: ids.owner,
    },
    cleanupLedger: {
      kind: 'private Detox cleanup ledger after stopped-resource drain',
      finalized: true,
      independent: 'passed',
      failures: [],
      requestedRunId: ids.requested,
      requestedAttemptId: `${ids.requested}:first`,
      captureRunId: ids.capture,
      ownerRunId: ids.owner,
      ownershipWindows,
    },
    publicReceipt: {
      path: '/private/q/native-terminal.private.json',
      artifactRoot: '/private/q',
      receiptHash: hash,
      receipt: {
        runId: ids.requested,
        attemptId: `${ids.requested}:first`,
        captureRunId: ids.capture,
        ownerRunId: ids.owner,
        backendRunId: ids.backend,
        result: 'passed',
        target: {
          deviceId: 'emulator-5554',
        },
      },
    },
  } as T15AndroidSessionLifecycleNormalizationInput;
}

void test('normalizes actual Android session split IDs only with a terminal receipt and closed windows', () => {
  const result = normalizeT15AndroidDetoxSessionLifecycle(baseInput());
  assert.equal(result.status, 'private-candidate');
  assert.equal(result.owner.status, 'normalized');
  assert.equal(result.publicConsumer.status, 'normalized');
  assert.equal(result.cleanup.status, 'closed');
  assert.equal(result.sharedLifecycle.status, 'split-identity-pending');
  assert.deepEqual(
    result.identity && {
      requestedRunId: result.identity.requestedRunId,
      captureRunId: result.identity.captureRunId,
      resourceOwnerRunId: result.identity.resourceOwnerRunId,
      targetRunId: result.identity.targetRunId,
      backendRunId: result.identity.backendRunId,
    },
    {
      requestedRunId: ids.requested,
      captureRunId: ids.capture,
      resourceOwnerRunId: ids.owner,
      targetRunId: ids.target,
      backendRunId: ids.backend,
    },
  );
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.publicPassingCases, 0);
  assert.equal(result.coldQualifiedAttempts, 0);
});

void test('keeps the Android route blocked when cleanup windows or the public receipt are absent', () => {
  const input = baseInput();
  const cleanupLedger = input.cleanupLedger as Record<string, unknown>;
  const blocked = normalizeT15AndroidDetoxSessionLifecycle({
    ...input,
    publicReceipt: null,
    cleanupLedger: { ...cleanupLedger, ownershipWindows: undefined },
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.owner.status, 'normalized');
  assert.equal(blocked.publicConsumer.status, 'pending');
  assert.equal(blocked.cleanup.status, 'blocked');
  assert.match(blocked.publicConsumer.blockers.join('\n'), /outer-public-receipt/);
  assert.match(blocked.cleanup.blockers.join('\n'), /ownershipWindows/);
});

void test('rejects a reset receipt whose backend crosses the resource owner', () => {
  const input = baseInput();
  const resetReceipt = input.resetReceipt as Record<string, unknown>;
  const backend = { ...(resetReceipt.backend as Record<string, unknown>), ownerRunId: ids.target };
  const blocked = normalizeT15AndroidDetoxSessionLifecycle({
    ...input,
    resetReceipt: { ...resetReceipt, backend },
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.owner.status, 'blocked');
  assert.match(blocked.owner.blockers.join('\n'), /dddd/);
});
