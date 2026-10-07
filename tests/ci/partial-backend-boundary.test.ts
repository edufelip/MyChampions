import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluatePartialBackendIosCleanup,
  processCensusFailureReason,
  requireNotAcquiredBackendIosAcquisition,
  requirePartialBackendIosAcquisition,
} from '../../scripts/testing/partial-backend-boundary';

const runId = '0123456789abcdef01234567';
const serverRoot = '/owned/server';
const owner = {
  pid: 4123,
  started: 'Mon Oct 02 10:00:00 2026',
  script: `${serverRoot}/scripts/testing/session.ts`,
  status: 'verified' as const,
};
const intents = ['adb', 'simulator', 'backend'].map((resource, index) => ({
  schemaVersion: 1,
  kind: 'owned iOS acquisition intent',
  runId,
  resource,
  previous: ['adb', 'simulator'].slice(0, index),
  startedAt: '2026-10-02T10:00:00.000Z',
}));
const failure = {
  acquisitionPhase: 'spawned' as const,
  cleanup: 'failed-recovery-ledger-retained',
  pid: owner.pid,
  orchestrator: owner,
  manifest: null,
  closed: null,
};
const preSpawnFailure = {
  acquisitionPhase: 'pre-spawn' as const,
  cleanup: 'not-acquired',
  childExitCode: null,
  pid: null,
  orchestrator: null,
  manifest: null,
  closed: null,
};
const capture = {
  acquisitionIntents: ['adb', 'simulator', 'backend'],
  backend: undefined,
  backendAcquisitionFailure: failure,
  commandExecutions: [],
  cleanup: {
    status: 'failed-recovery-retained',
    resources: ['backend-acquisition'],
  },
};
const files = [
  'acquisition-adb.private.json',
  'acquisition-simulator.private.json',
  'acquisition-backend.private.json',
  'backend-acquisition.private.log',
  'adb-server.ownership.json',
];

const preSpawnCapture = {
  acquisitionIntents: ['adb', 'simulator', 'backend'],
  backend: undefined,
  backendAcquisitionFailure: preSpawnFailure,
  commandExecutions: [],
  cleanup: 'cleaned',
};
const preSpawnFiles = [
  'acquisition-adb.private.json',
  'acquisition-simulator.private.json',
  'acquisition-backend.private.json',
  'backend-acquisition.private.log',
  'adb-server.ownership.json',
];
const preSpawnIntents = ['adb', 'simulator', 'backend'].map((resource, index) => ({
  schemaVersion: 1,
  kind: 'owned iOS acquisition intent',
  runId,
  resource,
  previous: ['adb', 'simulator'].slice(0, index),
  startedAt: '2026-10-02T10:00:00.000Z',
}));

void test('partial backend boundary retains exact direct-child identity', () => {
  assert.deepEqual(
    requirePartialBackendIosAcquisition(capture, files, intents, runId, serverRoot),
    { pid: owner.pid, started: owner.started, script: owner.script },
  );
});

void test('pre-spawn prepare failure preserves the real three-intent boundary without a child', () => {
  assert.doesNotThrow(() =>
    requireNotAcquiredBackendIosAcquisition(preSpawnCapture, preSpawnFiles, preSpawnIntents, runId),
  );
});

void test('pre-spawn boundary rejects fabricated missing-backend intent rows', () => {
  assert.throws(() =>
    requireNotAcquiredBackendIosAcquisition(
      preSpawnCapture,
      preSpawnFiles.filter((name) => name !== 'acquisition-backend.private.json'),
      preSpawnIntents.slice(0, 2),
      runId,
    ),
  );
});

void test('legacy before-backend shape is rejected instead of misclassified', () => {
  assert.throws(() =>
    requirePartialBackendIosAcquisition(
      {
        ...capture,
        acquisitionIntents: ['adb', 'simulator'],
        backendAcquisitionFailure: undefined,
      },
      files.filter((name) => !name.includes('backend')),
      intents.slice(0, 2),
      runId,
      serverRoot,
    ),
  );
});

void test('missing start identity is recovery unknown and cannot qualify partial cleanup', () => {
  assert.throws(() =>
    requirePartialBackendIosAcquisition(
      {
        ...capture,
        backendAcquisitionFailure: {
          ...failure,
          orchestrator: { ...owner, started: null, status: 'unavailable' },
        },
      },
      files,
      intents,
      runId,
      serverRoot,
    ),
  );
});

void test('foreign or PID-reused process never becomes an owned survivor', () => {
  const result = evaluatePartialBackendIosCleanup({
    runId,
    captureResult: 'harness-blocked',
    captureCleanup: 'failed-recovery-retained',
    owner: { pid: owner.pid, started: owner.started, script: owner.script },
    processCensus: {
      status: 'observed',
      liveProcesses: [{ pid: owner.pid, started: 'Tue Oct 03 10:00:00 2026' }],
    },
    previousDevices: { devices: { 'iOS 26.5': [] } },
    currentDevices: { devices: { 'iOS 26.5': [] } },
    ownedDeviceId: '00000000-0000-0000-0000-000000000001',
    adbPreserved: true,
    unavailablePorts: [],
  });
  assert.equal(result.result, 'failed');
  assert.equal(result.captureCleanupClean, false);
  assert.equal(result.recoveryVerified, false);
  assert.deepEqual(result.survivors, []);
  assert.deepEqual(result.samePidDifferentStart, [owner.pid]);
});

void test('unavailable process census remains unknown recovery instead of empty-query evidence', () => {
  const result = evaluatePartialBackendIosCleanup({
    runId,
    captureResult: 'harness-blocked',
    captureCleanup: 'failed-recovery-retained',
    owner: { pid: owner.pid, started: owner.started, script: owner.script },
    processCensus: {
      status: 'unknown',
      reason: 'Independent process census unavailable',
    },
    previousDevices: { devices: { 'iOS 26.5': [] } },
    currentDevices: { devices: { 'iOS 26.5': [] } },
    ownedDeviceId: '00000000-0000-0000-0000-000000000001',
    adbPreserved: true,
    unavailablePorts: [],
  });
  assert.equal(result.result, 'failed');
  assert.equal(result.processCensusStatus, 'unknown');
  assert.equal(result.processCensusError, 'Independent process census unavailable');
  assert.deepEqual(result.unknownProcessQueries, [owner.pid]);
  assert.deepEqual(result.survivors, []);
});

void test('process census diagnostics are bounded before private publication', () => {
  assert.equal(processCensusFailureReason(new Error('x'.repeat(512))).length, 256);
});

void test('closed or downstream evidence cannot be smuggled into partial boundary', () => {
  assert.throws(() =>
    requirePartialBackendIosAcquisition(
      {
        ...capture,
        backendAcquisitionFailure: { ...failure, closed: { event: 'closed' } },
      },
      [...files, 'proxy-ownership.json'],
      intents,
      runId,
      serverRoot,
    ),
  );
});
