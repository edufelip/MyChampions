import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeAndroidCameraAnchoredFile } from './native-android-camera-public-staging';
import {
  requireAndroidCameraNativeRuntimeDriver,
  type AndroidCameraNativeRuntimeDriverResult,
} from './native-android-camera-runtime-driver';
import {
  parseAndroidCameraSavedFlowRuntimeBinding,
  type AndroidCameraNativeRuntimeProvenance,
  type AndroidCameraSavedFlowRuntimeBinding,
} from './native-android-camera-runtime-eligibility';
import { readOwnedAndroidStableFile } from './native-android-session-adapter';
import { androidCameraSelectionHash } from './native-camera-android-contract';
import {
  requireAndroidCameraProducerOutput,
  type AndroidCameraProducerReceipts,
} from './native-camera-android-producer';
import type { NativePilotSelection, NativePilotTarget } from './native-pilot-contract';

const RUN_ID = /^[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const RECEIPT_PATH = 'android-camera-native-runtime-receipt.private.json';

type JsonRecord = Record<string, unknown>;

export type AndroidCameraNativeRuntimeReceipt = {
  kind: 'private-owned-android-camera-native-runtime-receipt';
  status: 'observed';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  fixtureRunId: string;
  ownerRunId: string;
  selectionHash: string;
  target: NativePilotTarget;
  sourceTreeHash: string;
  helperInputs: readonly { path: string; sha256: string }[];
  savedFlow: AndroidCameraSavedFlowRuntimeBinding;
  deadlineAt: number;
  captureReport: { path: 'capture.private.json'; sha256: string };
  driver: AndroidCameraNativeRuntimeDriverResult;
  frameActions: readonly {
    label: string;
    path: string;
    invocationId: string;
    ordinal: number;
    commandOrdinal: number;
    commandLabel: string;
  }[];
  sqlParents: readonly {
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
  }[];
};

export type AndroidCameraNativeRuntimeReceiptWriterInput = {
  artifactRoot: string;
  driver: AndroidCameraNativeRuntimeDriverResult;
  producer: AndroidCameraProducerReceipts;
  selection: NativePilotSelection;
  deadlineAt: number;
  signal?: AbortSignal;
};

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function record(value: unknown, label: string): JsonRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`);
  return value as JsonRecord;
}

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
  assert(!path.isAbsolute(value), `${label} is absolute`);
  assert(!value.split('/').includes('..'), `${label} escapes its root`);
  assert(path.posix.normalize(value) === value, `${label} is not normalized`);
  return value;
}

function helperInputs(report: JsonRecord): readonly { path: string; sha256: string }[] {
  const before = recordArray(report.helperInputsBefore, 'Android capture helperInputsBefore');
  const after = recordArray(report.helperInputsAfter, 'Android capture helperInputsAfter');
  const normalize = (value: JsonRecord, label: string) => ({
    path: relative(value.path, `${label} path`),
    sha256: requiredHash(value.sha256, `${label} hash`),
  });
  const beforeRows = before.map((value, index) => normalize(value, `Android helper ${index}`));
  const afterRows = after.map((value, index) => normalize(value, `Android helper after ${index}`));
  assert.deepEqual(afterRows, beforeRows, 'Android capture helper inputs changed during capture');
  return beforeRows;
}

function savedFlowBinding(
  report: JsonRecord,
  helpers: readonly { path: string; sha256: string }[],
): AndroidCameraSavedFlowRuntimeBinding {
  const binding = parseAndroidCameraSavedFlowRuntimeBinding(
    report.androidCameraSavedFlow,
    'Android capture saved-flow binding',
  );
  const route = helpers.find((row) => row.path === binding.path);
  assert(route, 'Android saved-flow route is absent from the helper ledger');
  assert.equal(
    route.sha256,
    binding.sha256,
    'Android saved-flow route hash differs from helper ledger',
  );
  return binding;
}

function recordArray(value: unknown, label: string): JsonRecord[] {
  assert(Array.isArray(value), `${label} is missing`);
  return value.map((row, index) => record(row, `${label}[${index}]`));
}

function validateTerminal(
  driver: AndroidCameraNativeRuntimeDriverResult,
  producer: AndroidCameraProducerReceipts,
  selection: NativePilotSelection,
  sourceTreeHash: string,
  helperInputs: readonly { path: string; sha256: string }[],
  captureReportSha256: string,
  deadlineAt: number,
): void {
  requiredRunId(driver.requestedRunId, 'Android native driver requested run ID');
  assert.equal(driver.requestedAttemptId, `${driver.requestedRunId}:first`);
  assert.equal(driver.captureRunId, producer.captureRunId);
  assert.equal(driver.fixtureRunId, producer.identity.backendRunId);
  assert.deepEqual(driver.target, producer.identity.target);
  requireAndroidCameraNativeRuntimeDriver(driver, {
    requestedRunId: driver.requestedRunId,
    captureRunId: driver.captureRunId,
    fixtureRunId: driver.fixtureRunId,
    selection,
    target: driver.target,
    producer,
    sourceTreeHash,
    helperInputs,
    captureReportSha256,
    deadlineAt,
  });
}

function validateCaptureReport(
  report: JsonRecord,
  captureRunId: string,
  producer: AndroidCameraProducerReceipts,
): void {
  assert.equal(report.kind, 'private-owned-native-camera-denied-execution-not-public-receipt');
  assert.equal(report.platform, 'android');
  assert.equal(report.charter, 'camera-denied');
  assert.equal(report.mode, 'integration');
  assert.equal(report.captureRunId, captureRunId);
  assert.equal(report.result, 'observed');
  assert.equal(report.cleanup, 'cleaned');
  assert.equal(report.nativePassingCases, 0);
  assert.equal(report.androidCameraCallbackInvocations, 1);
  assert.equal(report.androidCameraCallbackCompleted, true);
  const backend = record(report.backend, 'Android capture backend');
  assert.equal(backend.runId, producer.identity.backendRunId);
  assert.equal(backend.backendAttemptId, producer.identity.backendAttemptId);
  const apiProcess = record(backend.apiProcess, 'Android capture backend API process');
  assert.equal(apiProcess.pid, producer.identity.apiPid);
  assert.equal(apiProcess.started, producer.identity.apiStarted);
  assert.equal(apiProcess.script, producer.identity.apiScript);
  const device = record(report.device, 'Android capture device');
  assert.equal(device.runId, producer.identity.ownerRunId);
  const producerReport = record(report.androidCameraProducer, 'Android capture producer');
  assert.equal(producerReport.producerStatus, 'receipts-bound');
  assert.equal(producerReport.captureRunId, producer.captureRunId);
  assert.equal(producerReport.sourceSelectionHash, producer.sourceSelectionHash);
  assert.equal(producerReport.localeStatus, 'qualified');
}

function receiptFromActualOutputs(
  report: JsonRecord,
  reportHash: string,
  driver: AndroidCameraNativeRuntimeDriverResult,
  producer: AndroidCameraProducerReceipts,
  selection: NativePilotSelection,
  deadlineAt: number,
): AndroidCameraNativeRuntimeReceipt {
  const source = record(report.source, 'Android capture source identity');
  const sourceTreeHash = requiredHash(source.sourceTreeHash, 'Android capture source tree hash');
  const helpers = helperInputs(report);
  const savedFlow = savedFlowBinding(report, helpers);
  return {
    kind: 'private-owned-android-camera-native-runtime-receipt',
    status: 'observed',
    requestedRunId: driver.requestedRunId,
    requestedAttemptId: driver.requestedAttemptId,
    captureRunId: driver.captureRunId,
    fixtureRunId: producer.identity.backendRunId,
    ownerRunId: producer.identity.ownerRunId,
    selectionHash: androidCameraSelectionHash(selection),
    target: structuredClone(producer.identity.target),
    sourceTreeHash,
    helperInputs: helpers,
    savedFlow,
    deadlineAt,
    captureReport: { path: 'capture.private.json', sha256: reportHash },
    driver,
    frameActions: producer.frames.map((frame) => ({
      label: frame.label,
      path: frame.path,
      invocationId: frame.action.invocationId,
      ordinal: frame.action.ordinal,
      commandOrdinal: frame.action.commandOrdinal,
      commandLabel: frame.action.commandLabel,
    })),
    sqlParents: producer.sqlReceipts.map((receipt) => ({
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
  };
}

/**
 * Persist the runtime provenance sidecar from a distinct acquired native
 * driver result, the capture report, and producer receipts. A source-only
 * public-attempt result cannot enter this writer, so the writer cannot relabel
 * a source fixture as native runtime evidence.
 */
export async function writeAndroidCameraNativeRuntimeReceipt(
  options: AndroidCameraNativeRuntimeReceiptWriterInput,
): Promise<AndroidCameraNativeRuntimeProvenance> {
  options.signal?.throwIfAborted();
  assert(Number.isFinite(options.deadlineAt), 'Android runtime receipt deadline is not finite');
  assert(options.deadlineAt > performance.now(), 'Android runtime receipt deadline has expired');
  const root = await realpath(options.artifactRoot);
  assert.equal(
    root,
    path.resolve(options.artifactRoot),
    'Android runtime receipt root is not canonical',
  );
  assert.equal(options.driver.status, 'native-observed');
  requireAndroidCameraProducerOutput(options.producer, {
    selectionHash: androidCameraSelectionHash(options.selection),
    runId: options.driver.captureRunId,
  });
  const loaded = await readOwnedAndroidStableFile({
    artifactRoot: root,
    filePath: path.join(root, 'capture.private.json'),
    kind: 'sidecar',
    maxBytes: 32 * 1024 * 1024,
    signal: options.signal,
  });
  const report = record(JSON.parse(loaded.bytes.toString('utf8')), 'Android capture report');
  validateCaptureReport(report, options.driver.captureRunId, options.producer);
  const source = record(report.source, 'Android capture source identity');
  const sourceTreeHash = requiredHash(source.sourceTreeHash, 'Android capture source tree hash');
  const helpers = helperInputs(report);
  validateTerminal(
    options.driver,
    options.producer,
    options.selection,
    sourceTreeHash,
    helpers,
    loaded.receipt.sha256,
    options.deadlineAt,
  );
  const receipt = receiptFromActualOutputs(
    report,
    loaded.receipt.sha256,
    options.driver,
    options.producer,
    options.selection,
    options.deadlineAt,
  );
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  const published = await writeAndroidCameraAnchoredFile({
    root,
    relativePath: RECEIPT_PATH,
    bytes,
    signal: options.signal,
    deadlineAt: options.deadlineAt,
  });
  const reread = await readOwnedAndroidStableFile({
    artifactRoot: root,
    filePath: published.absolutePath,
    kind: 'sidecar',
    maxBytes: 512 * 1024,
    signal: options.signal,
  });
  assert.equal(reread.receipt.sha256, sha256(bytes));
  assert.deepEqual(JSON.parse(reread.bytes.toString('utf8')), receipt);
  const identity = published.identity;
  assert.equal(identity.mode & 0o777, 0o600);
  assert.equal(identity.nlink, 1);
  return {
    mode: 'native-runtime',
    receiptPath: RECEIPT_PATH,
    receiptSha256: reread.receipt.sha256,
  };
}
