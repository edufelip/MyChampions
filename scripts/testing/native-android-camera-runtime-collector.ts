import assert from 'node:assert/strict';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  requireAndroidCameraNativeRuntimeDriver,
  type AndroidCameraNativeRuntimeDriverResult,
} from './native-android-camera-runtime-driver';
import {
  verifyAndroidCameraRuntimeEligibility,
  type AndroidCameraNativeRuntimeProvenance,
  type AndroidCameraRuntimeEligibilityResult,
} from './native-android-camera-runtime-eligibility';
import {
  writeAndroidCameraNativeRuntimeReceipt,
  type AndroidCameraNativeRuntimeReceiptWriterInput,
} from './native-android-camera-runtime-receipt';
import { readOwnedAndroidStableFile } from './native-android-session-adapter';
import {
  ANDROID_CAMERA_ASSERTION_IDS,
  androidCameraSelectionHash,
  requireAndroidCameraIdentityBoundary,
} from './native-camera-android-contract';
import {
  requireAndroidCameraProducerOutput,
  type AndroidCameraProducerReceipts,
} from './native-camera-android-producer';
import type { OwnedAndroidNativeSessionResult } from './capture-android-testability';
import type { NativePilotSelection, NativePilotTarget } from './native-pilot-contract';

const HASH = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[a-f0-9]{24}$/u;
const MAX_OWNERSHIP_BYTES = 2 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;

export type AndroidCameraNativeRuntimeTerminal = {
  kind: 'private-owned-android-camera-native-runtime-terminal-not-public-receipt';
  status: 'verified-native-private';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  fixtureRunId: string;
  driverReceipt: { path: string; sha256: string };
  stageManifest: { path: string; sha256: string };
  assertionIds: readonly (typeof ANDROID_CAMERA_ASSERTION_IDS)[number][];
  nativePassingCases: 4;
  publicPassingCases: 0;
  publicPromotionEligible: false;
};

export type AndroidCameraNativeRuntimeCollection = {
  driver: AndroidCameraNativeRuntimeDriverResult;
  provenance: AndroidCameraNativeRuntimeProvenance;
  eligibility: AndroidCameraRuntimeEligibilityResult;
  terminal: AndroidCameraNativeRuntimeTerminal;
};

export type CollectAndroidCameraNativeRuntimeInput = {
  capture: OwnedAndroidNativeSessionResult;
  producer: AndroidCameraProducerReceipts;
  repositoryRoot: string;
  outputRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  /** The public caller supplies this; older private fixtures derive it from the bound producer. */
  captureRunId?: string;
  selection: NativePilotSelection;
  deadlineAt: number;
  signal?: AbortSignal;
};

function record(value: unknown, label: string): JsonRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`);
  return value as JsonRecord;
}

function digest(value: unknown, label: string): string {
  assert(typeof value === 'string' && HASH.test(value), `${label} is invalid`);
  return value;
}

function relative(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is missing`);
  assert(!path.isAbsolute(value), `${label} must be relative`);
  assert(!value.split(/[\\/]/u).includes('..'), `${label} escapes the capture root`);
  assert(path.posix.normalize(value) === value, `${label} is not normalized`);
  return value;
}

function requireDeadline(input: CollectAndroidCameraNativeRuntimeInput): void {
  input.signal?.throwIfAborted();
  assert(
    Number.isFinite(input.deadlineAt) && input.deadlineAt > performance.now(),
    'Android camera native collection deadline expired',
  );
}

function capturedRunId(input: CollectAndroidCameraNativeRuntimeInput): string {
  const value = input.captureRunId ?? input.producer.captureRunId;
  assert(RUN_ID.test(value), 'Android capture run ID is invalid');
  return value;
}

async function privateRoot(value: string, label: string): Promise<string> {
  const resolved = await realpath(value);
  assert.equal(resolved, path.resolve(value), `${label} is not canonical`);
  const info = await lstat(resolved);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a private directory`);
  assert.equal(info.uid, process.getuid?.(), `${label} is not owned`);
  assert.equal(info.mode & 0o777, 0o700, `${label} is not private`);
  return resolved;
}

async function readOwnership(
  root: string,
  value: unknown,
  label: string,
  expectedLabel: string,
  signal?: AbortSignal,
): Promise<{ pid: number; pgid: number; started: string }> {
  assert(
    typeof value === 'string' && path.isAbsolute(value) && value.length > 0,
    `${label} ownership path is missing or not absolute`,
  );
  const absolute = path.resolve(value);
  assert(path.dirname(absolute) === root, `${label} ownership path is outside capture root`);
  assert.equal(
    path.basename(absolute),
    `${expectedLabel}.ownership.json`,
    `${label} ownership basename is not bound to command label`,
  );
  const loaded = await readOwnedAndroidStableFile({
    artifactRoot: root,
    filePath: absolute,
    kind: 'sidecar',
    maxBytes: MAX_OWNERSHIP_BYTES,
    signal,
  });
  const envelope = record(JSON.parse(loaded.bytes.toString('utf8')), label);
  assert.equal(
    envelope.kind,
    'private worker process ownership',
    `${label} ownership kind is invalid`,
  );
  assert.equal(envelope.cleanup, 'cleaned', `${label} ownership cleanup is not clean`);
  const rows = envelope.processes;
  assert(Array.isArray(rows) && rows.length > 0, `${label} ownership processes are missing`);
  const first = record(rows[0], `${label} ownership process`);
  assert(Number.isSafeInteger(first.pid) && Number(first.pid) > 1, `${label} PID is invalid`);
  assert(Number.isSafeInteger(first.pgid) && Number(first.pgid) > 1, `${label} PGID is invalid`);
  assert(
    typeof first.started === 'string' && first.started.length > 0,
    `${label} start is missing`,
  );
  assert.equal(envelope.pid, first.pid, `${label} leader PID differs from ownership envelope`);
  assert.equal(envelope.pgid, first.pgid, `${label} leader PGID differs from ownership envelope`);
  assert.match(String(first.commandHash), HASH, `${label} command hash is missing`);
  return {
    pid: first.pid as number,
    pgid: first.pgid as number,
    started: first.started,
  };
}

async function readCommandArtifact(
  root: string,
  value: unknown,
  label: string,
  commandLabel: string,
  role: 'log' | 'stdout',
  signal?: AbortSignal,
): Promise<void> {
  assert(
    typeof value === 'string' && path.isAbsolute(value) && value.length > 0,
    `${label} path is missing or not absolute`,
  );
  const absolute = path.resolve(value);
  assert(path.dirname(absolute) === root, `${label} path is outside capture root`);
  const basename = path.basename(absolute);
  const kind =
    role === 'log'
      ? basename === `${commandLabel}.private.log`
        ? 'sidecar'
        : null
      : basename === `${commandLabel}.stdout`
        ? 'sidecar'
        : basename === `${commandLabel}.png`
          ? 'frame'
          : null;
  assert(kind, `${label} basename is not command-bound`);
  const loaded = await readOwnedAndroidStableFile({
    artifactRoot: root,
    filePath: absolute,
    kind,
    maxBytes: kind === 'frame' ? 16 * 1024 * 1024 : 8 * 1024 * 1024,
    signal,
  });
  if (kind === 'frame')
    assert(
      loaded.bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
      `${label} binary stdout is not PNG`,
    );
}

function helperInputs(report: JsonRecord): readonly { path: string; sha256: string }[] {
  const before = report.helperInputsBefore;
  const after = report.helperInputsAfter;
  assert(
    Array.isArray(before) && Array.isArray(after),
    'Android helper input receipts are missing',
  );
  const normalize = (value: unknown, label: string) => {
    const row = record(value, label);
    return {
      path: relative(row.path, `${label} path`),
      sha256: digest(row.sha256, `${label} hash`),
    };
  };
  const beforeRows = before.map((value, index) =>
    normalize(value, `Android helper before ${index}`),
  );
  const afterRows = after.map((value, index) => normalize(value, `Android helper after ${index}`));
  assert.deepEqual(afterRows, beforeRows, 'Android helper inputs changed during capture');
  return beforeRows;
}

type ConcreteAndroidTarget = NativePilotTarget & {
  deviceId: string;
  osVersion: string;
  appId: string;
  buildProfile: string;
  binaryHash: string;
  apiOrigin: string;
};

function targetFromReport(
  report: JsonRecord,
  producer: AndroidCameraProducerReceipts,
): ConcreteAndroidTarget {
  const device = record(report.device, 'Android capture device');
  const build = record(report.build, 'Android capture build');
  const target = producer.identity.target;
  assert.equal(device.serial, target.deviceId, 'Android target device differs from producer');
  assert.equal(device.osVersion, target.osVersion, 'Android target OS differs from producer');
  assert.equal(build.appId, target.appId, 'Android build app differs from producer');
  assert.equal(build.binaryHash, target.binaryHash, 'Android build bytes differ from producer');
  assert.equal(build.apiOrigin, target.apiOrigin, 'Android build API differs from producer');
  assert(typeof target.deviceId === 'string' && target.deviceId.length > 0);
  assert(typeof target.osVersion === 'string' && target.osVersion.length > 0);
  assert(typeof target.appId === 'string' && target.appId.length > 0);
  assert(typeof target.buildProfile === 'string' && target.buildProfile.length > 0);
  assert(typeof target.binaryHash === 'string' && HASH.test(target.binaryHash));
  assert(typeof target.apiOrigin === 'string' && target.apiOrigin.length > 0);
  return structuredClone(target) as ConcreteAndroidTarget;
}

function expectedLocale(
  value: AndroidCameraProducerReceipts['identity']['locale']['requestedLocale'],
): 'en-US' | 'pt-BR' | 'es-ES' {
  assert(
    value === 'en-US' || value === 'pt-BR' || value === 'es-ES',
    'Android producer locale is invalid',
  );
  return value;
}

async function collectDriver(
  input: CollectAndroidCameraNativeRuntimeInput,
  captureRoot: string,
): Promise<{ driver: AndroidCameraNativeRuntimeDriverResult }> {
  requireDeadline(input);
  assert(RUN_ID.test(input.requestedRunId), 'Android requested run ID is invalid');
  const captureRunId = capturedRunId(input);
  assert.equal(
    path.basename(captureRoot),
    captureRunId,
    'Android capture root differs from captured run',
  );
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.equal(
    input.producer.captureRunId,
    captureRunId,
    'Android producer capture run is not bound to the captured run',
  );
  assert.equal(
    input.producer.identity.captureRunId,
    captureRunId,
    'Android producer identity capture run is not bound to the captured run',
  );
  requireAndroidCameraIdentityBoundary({
    requestedRunId: input.requestedRunId,
    captureRunId,
    ownerRunId: input.producer.identity.ownerRunId,
    backendRunId: input.producer.identity.backendRunId,
  });
  assert.equal(input.capture.exitCode, 0, 'Android capture did not exit successfully');
  const loaded = await readOwnedAndroidStableFile({
    artifactRoot: captureRoot,
    filePath: path.join(captureRoot, 'capture.private.json'),
    kind: 'sidecar',
    maxBytes: 32 * 1024 * 1024,
    signal: input.signal,
  });
  const report = record(
    JSON.parse(loaded.bytes.toString('utf8')),
    'Android persisted capture report',
  );
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
  const cleanup = record(report.androidCameraIndependentCleanup, 'Android independent cleanup');
  assert.equal(cleanup.result, 'passed');
  assert.equal(cleanup.censusStatus, 'available');
  const producerReport = record(report.androidCameraProducer, 'Android persisted producer summary');
  assert.equal(producerReport.producerStatus, 'receipts-bound');
  assert.equal(producerReport.captureRunId, input.producer.captureRunId);
  assert.equal(producerReport.sourceSelectionHash, input.producer.sourceSelectionHash);
  assert.equal(producerReport.localeStatus, 'qualified');
  const reportFrames = producerReport.frames;
  assert(Array.isArray(reportFrames), 'Android persisted producer frame summary is missing');
  assert.deepEqual(
    reportFrames.map((value) => record(value, 'Android persisted frame').label),
    input.producer.frames.map((frame) => frame.label),
    'Android persisted producer did not retain every observed frame',
  );
  const source = record(report.source, 'Android persisted source');
  const sourceAfter = record(report.sourceAfter, 'Android persisted source after');
  assert.deepEqual(sourceAfter, source, 'Android source changed during capture');
  const sourceTreeHash = digest(source.sourceTreeHash, 'Android source tree hash');
  const helpers = helperInputs(report);
  const target = targetFromReport(report, input.producer);
  assert.equal(
    report.backend && record(report.backend, 'Android backend').runId,
    input.producer.identity.backendRunId,
  );
  const backend = record(report.backend, 'Android backend');
  assert.equal(backend.backendAttemptId, input.producer.identity.backendAttemptId);
  const apiProcess = record(backend.apiProcess, 'Android backend API process');
  assert.equal(apiProcess.pid, input.producer.identity.apiPid);
  assert.equal(apiProcess.started, input.producer.identity.apiStarted);
  assert.equal(apiProcess.script, input.producer.identity.apiScript);
  assert.equal(backend.apiOrigin, input.producer.identity.apiOrigin);

  const rows = report.commandExecutions;
  assert(Array.isArray(rows) && rows.length > 0, 'Android persisted command history is missing');
  const commands: AndroidCameraNativeRuntimeDriverResult['acquisition']['commandDiagnostics'][number][] =
    [];
  let group: { pid: number; pgid: number; started: string } | undefined;
  for (const [index, value] of rows.entries()) {
    const row = record(value, `Android command ${index}`);
    assert(
      typeof row.label === 'string' && row.label.length > 0,
      `Android command ${index} label is missing`,
    );
    assert(/^[a-z0-9-]+$/u.test(row.label), `Android command ${index} label is unsafe`);
    assert.equal(row.execution, 'completed', `Android command ${index} did not complete`);
    assert.equal(row.cleanup, 'cleaned', `Android command ${index} was not cleaned`);
    assert.equal(row.censusFailure, null, `Android command ${index} has a census failure`);
    assert.equal(row.outputFailure, null, `Android command ${index} has an output failure`);
    assert(
      Number.isSafeInteger(row.pid) && Number(row.pid) > 1,
      `Android command ${index} PID is missing`,
    );
    assert(
      Number.isSafeInteger(row.pgid) && Number(row.pgid) > 1,
      `Android command ${index} PGID is missing`,
    );
    const commandLabel = row.label;
    await readCommandArtifact(
      captureRoot,
      row.logPath,
      `Android command ${index} log`,
      commandLabel,
      'log',
      input.signal,
    );
    if (row.stdoutPath !== null && row.stdoutPath !== undefined)
      await readCommandArtifact(
        captureRoot,
        row.stdoutPath,
        `Android command ${index} stdout`,
        commandLabel,
        'stdout',
        input.signal,
      );
    const owned = await readOwnership(
      captureRoot,
      row.ownershipPath,
      `Android command ${index}`,
      commandLabel,
      input.signal,
    );
    assert.equal(owned.pid, row.pid, `Android command ${index} PID changed in ownership ledger`);
    assert.equal(owned.pgid, row.pgid, `Android command ${index} PGID changed in ownership ledger`);
    group ??= owned;
    commands.push({
      label: commandLabel,
      pid: owned.pid,
      pgid: owned.pgid,
      startedAt: owned.started,
      execution: 'completed',
      cleanup: 'cleaned',
    });
  }
  assert(group, 'Android command group identity is missing');
  const driver: AndroidCameraNativeRuntimeDriverResult = {
    kind: 'private-owned-android-camera-native-runtime-driver-result-not-public-receipt',
    status: 'native-observed',
    platform: 'android',
    engine: 'maestro',
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRunId,
    fixtureRunId: input.producer.identity.backendRunId,
    ownerRunId: input.producer.identity.ownerRunId,
    target,
    process: {
      apiPid: input.producer.identity.apiPid,
      pgid: group.pgid,
      apiStarted: input.producer.identity.apiStarted,
      apiOrigin: input.producer.identity.apiOrigin,
      ownerRunId: input.producer.identity.ownerRunId,
      targetDeviceId: target.deviceId,
    },
    acquisition: {
      status: 'acquired',
      result: 'observed',
      cleanup: 'cleaned',
      externalCleanup: 'passed',
      commandDiagnostics: commands,
    },
    sourceTreeHash,
    helperInputs: helpers,
    captureReport: {
      path: 'capture.private.json',
      sha256: loaded.receipt.sha256,
    },
    frames: input.producer.frames.map((frame) => ({
      label: frame.label,
      path: relative(frame.path, `Android frame ${frame.label} path`),
      sha256: digest(frame.sha256, `Android frame ${frame.label} hash`),
      sizeBytes: frame.sizeBytes,
      invocationId: frame.action.invocationId,
      ordinal: frame.action.ordinal,
      commandOrdinal: frame.action.commandOrdinal,
      commandLabel: frame.action.commandLabel,
    })),
    sqlParents: input.producer.sqlReceipts.map((receipt) => ({
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
      path: relative(receipt.parentSnapshotPath, 'Android SQL parent path'),
      sha256: digest(receipt.parentSnapshotSha256, 'Android SQL parent hash'),
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
    deadlineAt: input.deadlineAt,
  };
  requireAndroidCameraNativeRuntimeDriver(driver, {
    requestedRunId: input.requestedRunId,
    captureRunId,
    fixtureRunId: input.producer.identity.backendRunId,
    selection: input.selection,
    target,
    producer: input.producer,
    sourceTreeHash,
    helperInputs: helpers,
    captureReportSha256: loaded.receipt.sha256,
    deadlineAt: input.deadlineAt,
  });
  return { driver };
}

/**
 * Compose the existing owned Android capture with the native runtime writer and
 * verifier.  The persisted capture report and ownership ledgers are the only
 * source of driver facts; the result intentionally remains public-zero until
 * the canonical public receipt terminal is wired and independently validated.
 */
export async function collectAndVerifyAndroidCameraNativeRuntime(
  input: CollectAndroidCameraNativeRuntimeInput,
): Promise<AndroidCameraNativeRuntimeCollection> {
  requireDeadline(input);
  // The outer runner owns one absolute monotonic deadline.  Do not renew or
  // shorten it after acquisition: a late native proof must fail closed rather
  // than receive a fresh budget after the child has already completed.
  const deadlineAt = input.deadlineAt;
  const boundedInput = { ...input, deadlineAt };
  const captureRoot = await privateRoot(boundedInput.capture.artifactRoot, 'Android capture root');
  const captureRunId = capturedRunId(boundedInput);
  assert(RUN_ID.test(boundedInput.requestedRunId), 'Android requested run ID is invalid');
  assert.equal(
    path.basename(captureRoot),
    captureRunId,
    'Android capture root differs from captured run',
  );
  assert.equal(
    boundedInput.producer.captureRunId,
    captureRunId,
    'Android producer capture run is not bound to the captured run',
  );
  assert.equal(
    boundedInput.producer.identity.captureRunId,
    captureRunId,
    'Android producer identity capture run is not bound to the captured run',
  );
  requireAndroidCameraIdentityBoundary({
    requestedRunId: boundedInput.requestedRunId,
    captureRunId,
    ownerRunId: boundedInput.producer.identity.ownerRunId,
    backendRunId: boundedInput.producer.identity.backendRunId,
  });
  requireAndroidCameraProducerOutput(boundedInput.producer, {
    selectionHash: androidCameraSelectionHash(boundedInput.selection),
    runId: captureRunId,
  });
  const driverInputs = await collectDriver(boundedInput, captureRoot);
  const outputRoot = await privateRoot(boundedInput.outputRoot, 'Android output root');
  assert.notEqual(captureRoot, outputRoot);
  const writerInput: AndroidCameraNativeRuntimeReceiptWriterInput = {
    artifactRoot: captureRoot,
    driver: driverInputs.driver,
    producer: boundedInput.producer,
    selection: boundedInput.selection,
    deadlineAt,
    signal: boundedInput.signal,
  };
  const provenance = await writeAndroidCameraNativeRuntimeReceipt(writerInput);
  requireDeadline(boundedInput);
  const eligibility = await verifyAndroidCameraRuntimeEligibility({
    repositoryRoot: boundedInput.repositoryRoot,
    captureRoot,
    outputRoot,
    requestedRunId: boundedInput.requestedRunId,
    requestedAttemptId: boundedInput.requestedAttemptId,
    captureRunId,
    fixtureRunId: boundedInput.producer.identity.backendRunId,
    selection: boundedInput.selection,
    target: boundedInput.producer.identity.target,
    expectedLocale: expectedLocale(boundedInput.producer.identity.locale.requestedLocale),
    runtime: null,
    producer: boundedInput.producer,
    nativeDriver: driverInputs.driver,
    runtimeProvenance: provenance,
    deadlineAt,
    signal: boundedInput.signal,
  });
  assert.equal(eligibility.nativePassingCases, 4);
  assert.equal(eligibility.publicPassingCases, 0);
  assert.equal(eligibility.publicPromotionEligible, false);
  return {
    driver: driverInputs.driver,
    provenance,
    eligibility,
    terminal: {
      kind: 'private-owned-android-camera-native-runtime-terminal-not-public-receipt',
      status: 'verified-native-private',
      requestedRunId: input.requestedRunId,
      requestedAttemptId: input.requestedAttemptId,
      captureRunId,
      fixtureRunId: input.producer.identity.backendRunId,
      driverReceipt: {
        path: provenance.receiptPath,
        sha256: provenance.receiptSha256,
      },
      stageManifest: eligibility.stage.copyManifest,
      assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
      nativePassingCases: 4,
      publicPassingCases: 0,
      publicPromotionEligible: false,
    },
  };
}
