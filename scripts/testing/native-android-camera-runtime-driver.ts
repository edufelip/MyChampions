import assert from 'node:assert/strict';
import {
  androidCameraSelectionHash,
  requireAndroidCameraIdentityBoundary,
} from './native-camera-android-contract';
import type { AndroidCameraProducerReceipts } from './native-camera-android-producer';
import type { NativePilotSelection, NativePilotTarget } from './native-pilot-contract';

const RUN_ID = /^[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;

type RuntimeCommand = {
  label: string;
  pid: number;
  pgid: number;
  startedAt: string;
  execution: 'completed';
  cleanup: 'cleaned';
};

type RuntimeFrame = {
  label: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  invocationId: string;
  ordinal: number;
  commandOrdinal: number;
  commandLabel: string;
};

type RuntimeSqlParent = {
  parentRoot: string;
  parentManifestPath: 'manifest.json';
  parentManifestRetainedPath: string;
  parentManifestRetainedKind: 'sidecar';
  parentManifestRetainedSha256: string;
  parentManifestRetainedSizeBytes: number;
  parentManifestRetainedOwnerUid: number;
  parentManifestRetainedMode: number;
  parentManifestRetainedVerification: 'owned-stable-reader-v6';
  parentManifestSizeBytes: number;
  retainedPath: string;
  retainedKind: 'sidecar';
  retainedSha256: string;
  retainedSizeBytes: number;
  retainedOwnerUid: number;
  retainedMode: number;
  retainedVerification: 'owned-stable-reader-v6';
  parentApiLedgerPath: string;
  parentApiLedgerRetainedPath: string;
  parentApiLedgerRetainedKind: 'sidecar';
  parentApiLedgerRetainedSha256: string;
  parentApiLedgerRetainedSizeBytes: number;
  parentApiLedgerRetainedOwnerUid: number;
  parentApiLedgerRetainedMode: number;
  parentApiLedgerRetainedVerification: 'owned-stable-reader-v6';
  parentApiLedgerSizeBytes: number;
  path: string;
  sha256: string;
  runId: string;
  attemptId: string;
  apiOrigin: string;
  apiPid: number;
  apiStarted: string;
  apiScript: string;
  manifestSha256: string;
  apiAttempt: string;
  apiLedgerSha256: string;
};

export type AndroidCameraNativeRuntimeDriverResult = {
  kind: 'private-owned-android-camera-native-runtime-driver-result-not-public-receipt';
  status: 'native-observed';
  platform: 'android';
  engine: 'maestro';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  fixtureRunId: string;
  ownerRunId: string;
  target: NativePilotTarget;
  process: {
    apiPid: number;
    pgid: number;
    apiStarted: string;
    apiOrigin: string;
    ownerRunId: string;
    targetDeviceId: string;
  };
  acquisition: {
    status: 'acquired';
    result: 'observed';
    cleanup: 'cleaned';
    externalCleanup: 'passed';
    commandDiagnostics: readonly RuntimeCommand[];
  };
  sourceTreeHash: string;
  helperInputs: readonly { path: string; sha256: string }[];
  captureReport: { path: 'capture.private.json'; sha256: string };
  frames: readonly RuntimeFrame[];
  sqlParents: readonly RuntimeSqlParent[];
  deadlineAt: number;
};

export type AndroidCameraNativeRuntimeDriverExpectation = {
  requestedRunId: string;
  captureRunId: string;
  fixtureRunId: string;
  selection: NativePilotSelection;
  target: NativePilotTarget;
  producer: AndroidCameraProducerReceipts;
  sourceTreeHash: string;
  helperInputs: readonly { path: string; sha256: string }[];
  captureReportSha256: string;
  deadlineAt: number;
};

function requiredRunId(value: unknown, label: string): string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
  return value;
}

function requiredHash(value: unknown, label: string): string {
  assert(typeof value === 'string' && HASH.test(value), `${label} is invalid`);
  return value;
}

function relative(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is missing`);
  assert(!value.startsWith('/') && !value.split('/').includes('..'), `${label} escapes its root`);
  return value;
}

function requireCommand(value: RuntimeCommand, index: number): void {
  assert(
    typeof value.label === 'string' && value.label.length > 0,
    `native command ${index} label is missing`,
  );
  assert(
    Number.isSafeInteger(value.pid) && value.pid > 1,
    `native command ${index} PID is invalid`,
  );
  assert(
    Number.isSafeInteger(value.pgid) && value.pgid > 1,
    `native command ${index} PGID is invalid`,
  );
  assert(
    typeof value.startedAt === 'string' && value.startedAt.length > 0,
    `native command ${index} start is missing`,
  );
  assert.equal(value.execution, 'completed');
  assert.equal(value.cleanup, 'cleaned');
}

/**
 * Validate the distinct native-driver envelope. It cannot be constructed by
 * relabeling the source-only public-attempt result: acquisition, target/process
 * identity, real frame actions, SQL parents, and cleanup are all required.
 */
export function requireAndroidCameraNativeRuntimeDriver(
  value: AndroidCameraNativeRuntimeDriverResult,
  expected: AndroidCameraNativeRuntimeDriverExpectation,
): AndroidCameraNativeRuntimeDriverResult {
  assert.equal(
    value.kind,
    'private-owned-android-camera-native-runtime-driver-result-not-public-receipt',
  );
  assert.equal(value.status, 'native-observed');
  assert.equal(value.platform, 'android');
  assert.equal(value.engine, 'maestro');
  assert.equal(
    requiredRunId(value.requestedRunId, 'native driver requested run'),
    expected.requestedRunId,
  );
  assert.equal(value.requestedAttemptId, `${expected.requestedRunId}:first`);
  assert.equal(
    requiredRunId(value.captureRunId, 'native driver capture run'),
    expected.captureRunId,
  );
  assert.equal(
    requiredRunId(value.fixtureRunId, 'native driver fixture run'),
    expected.fixtureRunId,
  );
  assert.equal(
    requiredRunId(value.ownerRunId, 'native driver owner run'),
    expected.producer.identity.ownerRunId,
  );
  requireAndroidCameraIdentityBoundary({
    requestedRunId: expected.requestedRunId,
    captureRunId: expected.captureRunId,
    ownerRunId: expected.producer.identity.ownerRunId,
    backendRunId: expected.fixtureRunId,
  });
  assert.deepEqual(value.target, expected.target);
  assert.equal(value.process.apiPid, expected.producer.identity.apiPid);
  assert(Number.isSafeInteger(value.process.apiPid) && value.process.apiPid > 1);
  assert(Number.isSafeInteger(value.process.pgid) && value.process.pgid > 1);
  assert.equal(value.process.apiStarted, expected.producer.identity.apiStarted);
  assert.equal(value.process.apiOrigin, expected.producer.identity.apiOrigin);
  assert.equal(value.process.ownerRunId, expected.producer.identity.ownerRunId);
  assert.equal(value.process.targetDeviceId, expected.target.deviceId);
  assert.equal(value.acquisition.status, 'acquired');
  assert.equal(value.acquisition.result, 'observed');
  assert.equal(value.acquisition.cleanup, 'cleaned');
  assert.equal(value.acquisition.externalCleanup, 'passed');
  assert(
    value.acquisition.commandDiagnostics.length > 0,
    'native driver command history is missing',
  );
  value.acquisition.commandDiagnostics.forEach(requireCommand);
  assert.equal(
    requiredHash(value.sourceTreeHash, 'native driver source tree hash'),
    expected.sourceTreeHash,
  );
  assert.deepEqual(value.helperInputs, expected.helperInputs);
  assert.deepEqual(value.captureReport, {
    path: 'capture.private.json',
    sha256: expected.captureReportSha256,
  });
  assert.equal(value.deadlineAt, expected.deadlineAt);
  assert(Number.isFinite(value.deadlineAt) && value.deadlineAt > 0);
  assert.deepEqual(
    value.frames,
    expected.producer.frames.map((frame) => ({
      label: frame.label,
      path: relative(frame.path, `native frame ${frame.label} path`),
      sha256: frame.sha256,
      sizeBytes: frame.sizeBytes,
      invocationId: frame.action.invocationId,
      ordinal: frame.action.ordinal,
      commandOrdinal: frame.action.commandOrdinal,
      commandLabel: frame.action.commandLabel,
    })),
  );
  assert.deepEqual(
    value.sqlParents,
    expected.producer.sqlReceipts.map((receipt) => ({
      parentRoot: receipt.parentSnapshotRoot,
      parentManifestPath: receipt.parentManifestPath,
      parentManifestRetainedPath: receipt.parentManifestRetainedPath,
      parentManifestRetainedKind: receipt.parentManifestRetainedKind,
      parentManifestRetainedSha256: receipt.parentManifestRetainedSha256,
      parentManifestRetainedSizeBytes: receipt.parentManifestRetainedSizeBytes,
      parentManifestRetainedOwnerUid: receipt.parentManifestRetainedOwnerUid,
      parentManifestRetainedMode: receipt.parentManifestRetainedMode,
      parentManifestRetainedVerification: receipt.parentManifestRetainedVerification,
      parentManifestSizeBytes: receipt.parentManifestSizeBytes,
      retainedPath: receipt.parentSnapshotRetainedPath,
      retainedKind: receipt.parentSnapshotRetainedKind,
      retainedSha256: receipt.parentSnapshotRetainedSha256,
      retainedSizeBytes: receipt.parentSnapshotRetainedSizeBytes,
      retainedOwnerUid: receipt.parentSnapshotRetainedOwnerUid,
      retainedMode: receipt.parentSnapshotRetainedMode,
      retainedVerification: receipt.parentSnapshotRetainedVerification,
      parentApiLedgerPath: receipt.parentApiLedgerPath,
      parentApiLedgerRetainedPath: receipt.parentApiLedgerRetainedPath,
      parentApiLedgerRetainedKind: receipt.parentApiLedgerRetainedKind,
      parentApiLedgerRetainedSha256: receipt.parentApiLedgerRetainedSha256,
      parentApiLedgerRetainedSizeBytes: receipt.parentApiLedgerRetainedSizeBytes,
      parentApiLedgerRetainedOwnerUid: receipt.parentApiLedgerRetainedOwnerUid,
      parentApiLedgerRetainedMode: receipt.parentApiLedgerRetainedMode,
      parentApiLedgerRetainedVerification: receipt.parentApiLedgerRetainedVerification,
      parentApiLedgerSizeBytes: receipt.parentApiLedgerSizeBytes,
      path: receipt.parentSnapshotPath,
      sha256: receipt.parentSnapshotSha256,
      runId: receipt.parentRunId,
      attemptId: receipt.parentBackendAttemptId,
      apiOrigin: receipt.parentApiOrigin,
      apiPid: receipt.parentApiPid,
      apiStarted: receipt.parentApiStarted,
      apiScript: receipt.parentApiScript,
      manifestSha256: receipt.parentManifestSha256,
      apiAttempt: receipt.parentApiAttempt,
      apiLedgerSha256: receipt.parentApiLedgerSha256,
    })),
  );
  assert.equal(value.captureReport.sha256, expected.captureReportSha256);
  assert.equal(
    androidCameraSelectionHash(expected.selection),
    expected.producer.sourceSelectionHash,
    'native driver selection is not producer-bound',
  );
  return value;
}
