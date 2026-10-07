import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  readOwnedDetoxConnectionEvidence,
  type DetoxConnectionEvidenceStat,
} from './detox-connection-evidence';
import {
  requireDetoxRuntimeBuildMetadata,
  type DetoxRuntimeBuildMetadata,
} from './detox-runtime-build-metadata';
import { requireNativeConnectionTransport } from './native-connection-journey-core';
import { CONNECTION_PURPOSE_PLANS } from './native-connection-platform-contract';
import { requireConnectionSnapshot } from './native-connection-snapshot';
import {
  stageIosDetoxConnectionPublicEvidence,
  verifyStagedIosDetoxConnectionPublicEvidence,
  type DetoxIosConnectionEvidenceCopyManifest,
  type DetoxIosConnectionOriginalFileBinding,
  type DetoxIosConnectionPublicStagingLifecycle,
} from './native-detox-connection-public-staging';
import {
  nativeConnectionAssertionIds,
  requireNativePilotAssertions,
  type NativePilotSelection,
} from './native-pilot-contract';
import type { DetoxBaselineBuildInstrumentation } from './detox-integrated-session-baseline';
import type { NativeConnectionAssertionBinding } from './native-connection-public-evidence';
import type { DetoxIosConnectionPublicBridgeResult } from './native-detox-connection-public-bridge';
import type { DetoxDispatchQualifiedBuild } from './native-detox-connection-public-dispatch';

const HASH = /^[a-f0-9]{64}$/;
const DIRECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:private\.)?(?:json|xml|png)$/;
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d+$/;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_PNG_BYTES = 8 * 1024 * 1024;

/**
 * A protected original file identity.  The runtime verifier reads the file
 * through the existing descriptor/no-follow reader and compares every field;
 * a path or hash supplied without the original bytes is not sufficient.
 */
export type DetoxRuntimeProtectedReceipt = Readonly<{
  name: string;
  bytes: number;
  sha256: string;
  metadata: DetoxConnectionEvidenceStat;
}>;

type ReceiptIdentity = Readonly<{
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
}>;

export type DetoxIosConnectionRuntimeFacts = Readonly<{
  kind: 'private-detox-ios-connection-runtime-facts';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  captureResult: 'observed';
  captureExitCode: 0;
  childExitCode: 0;
  childSignal: null;
  childClassification: 'completed';
  captureCleanup: 'cleaned' | 'failed';
  externalCleanupResult: 'passed' | 'failed';
  verificationResult: 'passed' | 'failed';
  callbackInvocations: 1;
  callbackCompleted: true;
  captureTimeout: null;
  cancellation: null;
  postCaptureFailure: null;
  censusFailures: readonly [];
  outputFailures: readonly [];
  timingsMs: Readonly<{
    build: number;
    install: number;
    reset: number;
    scenario: number;
    verify: number;
    cleanup: number;
  }>;
  source: Readonly<{
    receipt: DetoxRuntimeProtectedReceipt;
    sourceTreeHash: string;
    helperInputsHash: string;
    detoxConfigHash: string;
    dispatchRuntimeInputsHash: string;
  }>;
  build: Readonly<
    {
      receipt: DetoxRuntimeProtectedReceipt;
      configuration: 'ios.sim.debug';
      sourceTreeHash: string;
      helperInputsHash: string;
      binaryHash: string;
      detoxConfigHash: string;
    } & DetoxRuntimeBuildMetadata
  >;
  target: Readonly<{
    receipt: DetoxRuntimeProtectedReceipt;
    platform: 'ios';
    deviceId: string;
    osVersion: string;
    appId: string;
    ownership: 'owned';
    apiOrigin: string;
  }>;
  reset: Readonly<{
    receipt: DetoxRuntimeProtectedReceipt;
    status: 'verified';
    targetDeviceId: string;
    permissionState: 'not-applicable';
    resetFingerprint: string;
  }>;
  transport: Readonly<{
    receipt: DetoxRuntimeProtectedReceipt;
    source: DetoxRuntimeProtectedReceipt;
    windows: readonly DetoxRuntimeTransportWindow[];
  }>;
  api: Readonly<{
    receipt: DetoxRuntimeProtectedReceipt;
    apiPid: number;
    targetOrigin: string;
    requestIds: readonly number[];
  }>;
  sql: Readonly<{
    receipt: DetoxRuntimeProtectedReceipt;
    snapshots: readonly DetoxRuntimeSqlSnapshot[];
    isolationUnchanged: true;
    trainingPlansUnchanged: true;
  }>;
  ui: Readonly<{
    receipt: DetoxRuntimeProtectedReceipt;
    assertions: readonly DetoxRuntimeUiAssertion[];
  }>;
  cleanup: Readonly<{
    receipt: DetoxRuntimeProtectedReceipt;
    status: 'cleaned' | 'failed';
    recoveryStatus: 'verified' | 'blocked';
    failures: readonly [];
    survivors: readonly [];
    unknownProcesses: readonly [];
  }>;
}>;

export type DetoxRuntimeTransportWindow = Readonly<{
  method: 'POST' | 'GET';
  route: string;
  status: number;
  afterRequestId: number;
  throughRequestId: number;
  unique: boolean;
}>;

export type DetoxRuntimeSqlSnapshot = Readonly<{
  label: string;
  receipt: DetoxRuntimeProtectedReceipt;
}>;

export type DetoxRuntimeUiAssertion = Readonly<{
  id: (typeof nativeConnectionAssertionIds)[number];
  actor: 'coach' | 'student';
  observationLabels: readonly string[];
  evidence: readonly DetoxRuntimeProtectedReceipt[];
}>;

export type DetoxIosConnectionRuntimeVerificationInput = Readonly<{
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  build: DetoxDispatchQualifiedBuild;
  bridgeResult: DetoxIosConnectionPublicBridgeResult;
  runtime: DetoxIosConnectionRuntimeFacts;
  lifecycle: DetoxIosConnectionPublicStagingLifecycle;
  validateBuild?: (
    build: DetoxDispatchQualifiedBuild,
    repositoryRoot: string,
  ) => void | Promise<void>;
}>;

export type DetoxIosConnectionRuntimeVerificationResult = Readonly<{
  kind: 'private-detox-ios-connection-runtime-verification-not-public-receipt';
  status: 'verified-runtime';
  verificationResult: 'passed';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  assertionBindings: readonly NativeConnectionAssertionBinding[];
  staged: Readonly<{
    outputRoot: string;
    manifest: DetoxIosConnectionEvidenceCopyManifest;
  }>;
  nativePassingCases: 0;
  publicPassingCases: 0;
  publicPromotionEligible: false;
}>;

type RecordValue = Record<string, unknown>;

function record(value: unknown, label: string): RecordValue {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as RecordValue;
}

function hashBytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && HASH.test(value), `${label} must be a SHA-256 hash`);
}

function requireReceiptHeader(
  value: unknown,
  kind: string,
  identity: ReceiptIdentity,
): RecordValue {
  const row = record(value, `${kind} receipt`);
  assert.equal(row.kind, kind);
  assert.equal(row.requestedRunId, identity.requestedRunId);
  assert.equal(row.requestedAttemptId, identity.requestedAttemptId);
  assert.equal(row.captureRunId, identity.captureRunId);
  return row;
}

function assertStatEqual(
  actual: DetoxConnectionEvidenceStat,
  expected: DetoxConnectionEvidenceStat,
  label: string,
): void {
  for (const key of [
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
    assert.equal(actual[key], expected[key], `${label}.${key} changed`);
}

async function readProtected(
  root: string,
  receipt: DetoxRuntimeProtectedReceipt,
  identity: ReceiptIdentity,
  lifecycle: DetoxIosConnectionPublicStagingLifecycle,
  label: string,
): Promise<{ bytes: Buffer; json: RecordValue | null; parsed: unknown }> {
  assert(
    typeof receipt.name === 'string' && DIRECT_NAME.test(receipt.name),
    `${label} name is unsafe`,
  );
  assert(
    Number.isSafeInteger(receipt.bytes) && receipt.bytes > 0,
    `${label} byte count is invalid`,
  );
  requireHash(receipt.sha256, `${label} hash`);
  assert.equal(receipt.metadata.size, receipt.bytes, `${label} metadata size differs`);
  assert.equal(receipt.metadata.nlink, 1, `${label} must be single-link`);
  assert.equal(receipt.metadata.mode & 0o777, 0o600, `${label} must be private`);
  const observed = await readOwnedDetoxConnectionEvidence(
    root,
    receipt.name,
    receipt.name.endsWith('.png') ? MAX_PNG_BYTES : MAX_JSON_BYTES,
    { signal: lifecycle.signal, deadlineAt: lifecycle.deadlineAtMonotonicMs },
  );
  assert.equal(observed.bytes.byteLength, receipt.bytes, `${label} byte count changed`);
  assert.equal(hashBytes(observed.bytes), receipt.sha256, `${label} bytes changed`);
  assertStatEqual(observed.metadata, receipt.metadata, label);
  let json: RecordValue | null = null;
  let parsed: unknown;
  if (receipt.name.endsWith('.json')) {
    try {
      parsed = JSON.parse(observed.bytes.toString('utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        json = parsed as RecordValue;
    } catch (error) {
      throw new Error(`${label} is not valid JSON`, { cause: error });
    }
  }
  return { bytes: observed.bytes, json, parsed };
}

function assertTerminalFacts(input: DetoxIosConnectionRuntimeVerificationInput): void {
  const runtime = input.runtime;
  assert.equal(runtime.kind, 'private-detox-ios-connection-runtime-facts');
  assert.equal(runtime.requestedRunId, input.requestedRunId);
  assert.equal(runtime.requestedAttemptId, input.requestedAttemptId);
  assert.equal(runtime.captureRunId, input.requestedRunId);
  assert.equal(runtime.captureResult, 'observed');
  assert.equal(runtime.captureExitCode, 0);
  assert.equal(runtime.childExitCode, 0);
  assert.equal(runtime.childSignal, null);
  assert.equal(runtime.childClassification, 'completed');
  assert.equal(runtime.captureCleanup, 'cleaned');
  assert.equal(runtime.externalCleanupResult, 'passed');
  assert.equal(runtime.verificationResult, 'passed');
  assert.equal(runtime.callbackInvocations, 1);
  assert.equal(runtime.callbackCompleted, true);
  assert.equal(runtime.captureTimeout, null);
  assert.equal(runtime.cancellation, null);
  assert.equal(runtime.postCaptureFailure, null);
  assert.deepEqual(runtime.censusFailures, []);
  assert.deepEqual(runtime.outputFailures, []);
  for (const [name, value] of Object.entries(runtime.timingsMs))
    assert(
      typeof value === 'number' && Number.isFinite(value) && value > 0,
      `${name} timing is invalid`,
    );
}

function assertSelectionAndBridge(input: DetoxIosConnectionRuntimeVerificationInput): RecordValue {
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.deepEqual(input.selection.arguments, {
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-connection-ios',
    mode: 'integration',
  });
  const rows = requireNativePilotAssertions(input.selection);
  assert.deepEqual(
    rows.map((row) => row.id),
    [...nativeConnectionAssertionIds],
  );
  const bridge = input.bridgeResult;
  assert.equal(bridge.owner, 'detox-driver');
  assert.equal(bridge.engine, 'detox');
  assert.equal(bridge.platform, 'ios');
  assert.equal(bridge.requestedRunId, input.requestedRunId);
  assert.equal(bridge.requestedAttemptId, input.requestedAttemptId);
  assert.equal(bridge.nativePassingCases, 0);
  assert.equal(bridge.publicPromotionEligible, false);
  assert.equal(bridge.attempt.acquired, true);
  assert.equal(bridge.attempt.cleanup, 'cleaned');
  assert.equal(bridge.attempt.recoveryStatus, 'verified');
  assert(bridge.attempt.report !== null, 'Detox producer report is missing');
  const report = record(bridge.attempt.report, 'Detox producer report');
  assert.equal(report.kind, 'private-detox-connection-capture-not-public-receipt');
  assert.equal(report.nativePassingCases, 0);
  assert.equal(report.publicPromotionEligible, false);
  assert.deepEqual(bridge.selection.assertionIds, [...nativeConnectionAssertionIds]);
  return report;
}

async function verifyRuntimeReceiptSet(
  input: DetoxIosConnectionRuntimeVerificationInput,
  report: RecordValue,
): Promise<DetoxIosConnectionOriginalFileBinding> {
  const identity: ReceiptIdentity = {
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRunId: input.runtime.captureRunId,
  };
  const runtime = input.runtime;
  requireDetoxRuntimeBuildMetadata(input.build, 'Qualified Detox runtime metadata');
  requireDetoxRuntimeBuildMetadata(runtime.build, 'Runtime receipt build metadata');
  assert.equal(runtime.build.environmentHash, input.build.environmentHash);
  assert.deepEqual(runtime.build.toolVersions, input.build.toolVersions);
  assert.deepEqual(runtime.build.toolVersionEvidence, input.build.toolVersionEvidence);
  requireHash(runtime.source.sourceTreeHash, 'Runtime source tree hash');
  requireHash(runtime.source.helperInputsHash, 'Runtime helper hash');
  requireHash(runtime.source.detoxConfigHash, 'Runtime Detox config hash');
  requireHash(runtime.source.dispatchRuntimeInputsHash, 'Runtime dispatch closure hash');
  assert(
    input.build.dispatchRuntimeInputPaths.length > 0,
    'Qualified Detox build is missing its dispatch runtime closure',
  );
  requireHash(input.build.dispatchRuntimeInputsHash, 'Qualified Detox dispatch closure hash');
  assert.equal(
    runtime.source.dispatchRuntimeInputsHash,
    input.build.dispatchRuntimeInputsHash,
    'Runtime envelope is bound to a different Detox dispatch closure',
  );
  requireHash(runtime.build.binaryHash, 'Runtime binary hash');
  assert.equal(runtime.source.sourceTreeHash, input.build.source.sourceTreeHash);
  assert.equal(runtime.source.helperInputsHash, input.build.helperInputsHash);
  assert.equal(runtime.source.detoxConfigHash, input.build.detoxConfigHash);
  assert.equal(runtime.build.configuration, input.build.configuration);
  assert.equal(runtime.build.sourceTreeHash, input.build.source.sourceTreeHash);
  assert.equal(runtime.build.helperInputsHash, input.build.helperInputsHash);
  assert.equal(runtime.build.binaryHash, input.build.binaryHash);
  assert.equal(runtime.build.detoxConfigHash, input.build.detoxConfigHash);
  assert.deepEqual(input.bridgeResult.declaredBuildIdentity, {
    sourceTreeHash: runtime.source.sourceTreeHash,
    helperInputsHash: runtime.source.helperInputsHash,
    binaryHash: runtime.build.binaryHash,
    detoxConfigHash: runtime.build.detoxConfigHash,
  });

  const source = await readProtected(
    input.captureRoot,
    runtime.source.receipt,
    identity,
    input.lifecycle,
    'Source receipt',
  );
  const sourceJson = requireReceiptHeader(
    source.json,
    'private-detox-connection-source-runtime-receipt',
    identity,
  );
  assert.equal(sourceJson.sourceTreeHash, runtime.source.sourceTreeHash);
  assert.equal(sourceJson.helperInputsHash, runtime.source.helperInputsHash);
  assert.equal(sourceJson.detoxConfigHash, runtime.source.detoxConfigHash);
  assert.equal(sourceJson.dispatchRuntimeInputsHash, runtime.source.dispatchRuntimeInputsHash);
  const build = await readProtected(
    input.captureRoot,
    runtime.build.receipt,
    identity,
    input.lifecycle,
    'Build receipt',
  );
  const buildJson = requireReceiptHeader(
    build.json,
    'private-detox-connection-build-runtime-receipt',
    identity,
  );
  assert.equal(buildJson.configuration, runtime.build.configuration);
  assert.equal(buildJson.binaryHash, runtime.build.binaryHash);
  assert.equal(buildJson.sourceTreeHash, runtime.build.sourceTreeHash);
  assert.equal(buildJson.helperInputsHash, runtime.build.helperInputsHash);
  assert.equal(buildJson.detoxConfigHash, runtime.build.detoxConfigHash);
  assert.equal(buildJson.environmentHash, runtime.build.environmentHash);
  assert.deepEqual(buildJson.toolVersions, runtime.build.toolVersions);
  assert.deepEqual(buildJson.toolVersionEvidence, runtime.build.toolVersionEvidence);
  const producerReceipt = record(report.detoxProducerReceipt, 'Detox producer receipt');
  assert.equal(producerReceipt.kind, 'private-detox-connection-producer-receipt');
  assert.equal(producerReceipt.captureRunId, identity.captureRunId);
  assert.equal(producerReceipt.platform, 'ios');
  assert.equal(producerReceipt.sourceTreeHash, runtime.source.sourceTreeHash);
  assert.equal(producerReceipt.helperInputsHash, runtime.source.helperInputsHash);

  assert(typeof runtime.target.deviceId === 'string' && runtime.target.deviceId.length > 0);
  assert(typeof runtime.target.osVersion === 'string' && runtime.target.osVersion.length > 0);
  assert.equal(runtime.target.appId, input.build.appIdentifier);
  assert.match(runtime.target.apiOrigin, LOOPBACK);
  const target = await readProtected(
    input.captureRoot,
    runtime.target.receipt,
    identity,
    input.lifecycle,
    'Target receipt',
  );
  const targetJson = requireReceiptHeader(
    target.json,
    'private-detox-connection-target-runtime-receipt',
    identity,
  );
  assert.equal(targetJson.deviceId, runtime.target.deviceId);
  assert.equal(targetJson.osVersion, runtime.target.osVersion);
  assert.equal(targetJson.appId, runtime.target.appId);
  assert.equal(targetJson.ownership, 'owned');
  assert.equal(targetJson.apiOrigin, runtime.target.apiOrigin);
  const reportTarget = record(report.target, 'Detox target receipt');
  assert.equal(reportTarget.platform, 'ios');
  assert.equal(reportTarget.deviceId, runtime.target.deviceId);
  assert.equal(reportTarget.ownership, 'owned');

  const reset = await readProtected(
    input.captureRoot,
    runtime.reset.receipt,
    identity,
    input.lifecycle,
    'Reset receipt',
  );
  const resetJson = requireReceiptHeader(
    reset.json,
    'private-detox-connection-reset-runtime-receipt',
    identity,
  );
  assert.equal(resetJson.status, 'verified');
  assert.equal(resetJson.targetDeviceId, runtime.reset.targetDeviceId);
  assert.equal(resetJson.permissionState, runtime.reset.permissionState);
  assert.equal(resetJson.resetFingerprint, runtime.reset.resetFingerprint);
  requireHash(runtime.reset.resetFingerprint, 'Reset fingerprint');
  assert.equal(runtime.reset.targetDeviceId, runtime.target.deviceId);

  const backend = record(report.backend, 'Detox backend identity');
  const apiIdentity = record(report.connectionApiIdentity, 'Detox API identity');
  assert.equal(backend.apiOrigin, runtime.target.apiOrigin);
  assert.equal(apiIdentity.targetOrigin, runtime.target.apiOrigin);
  assert.equal(backend.apiPid, apiIdentity.apiPid);
  assert.equal(backend.apiPid, runtime.api.apiPid);
  assert(Number.isSafeInteger(runtime.api.apiPid) && runtime.api.apiPid > 1);
  const api = await readProtected(
    input.captureRoot,
    runtime.api.receipt,
    identity,
    input.lifecycle,
    'API receipt',
  );
  const apiJson = requireReceiptHeader(
    api.json,
    'private-detox-connection-api-runtime-receipt',
    identity,
  );
  assert.equal(apiJson.apiPid, runtime.api.apiPid);
  assert.equal(apiJson.targetOrigin, runtime.api.targetOrigin);
  assert.deepEqual(apiJson.requestIds, [...runtime.api.requestIds]);

  assert(Array.isArray(report.detoxTransportSource));
  const transport = report.detoxTransportSource as RecordValue[];
  requireHash(report.detoxTransportSourceHash, 'Detox transport source hash');
  assert.equal(report.detoxTransportSourceHash, hashJson(report.detoxTransportSource));
  const reportTransportReceipt = record(
    report.detoxTransportSourceReceipt,
    'Detox transport source receipt',
  );
  assert.equal(reportTransportReceipt.path, runtime.transport.source.name);
  assert.equal(reportTransportReceipt.sourceBytes, runtime.transport.source.bytes);
  assert.equal(reportTransportReceipt.sourceSha256, runtime.transport.source.sha256);
  const transportSource = await readProtected(
    input.captureRoot,
    runtime.transport.source,
    identity,
    input.lifecycle,
    'Transport source',
  );
  assert(Array.isArray(transportSource.parsed), 'Transport source must be an array');
  assert.deepEqual(transportSource.parsed, transport);
  const transportReceipt = await readProtected(
    input.captureRoot,
    runtime.transport.receipt,
    identity,
    input.lifecycle,
    'Transport receipt',
  );
  const transportReceiptJson = requireReceiptHeader(
    transportReceipt.json,
    'private-detox-connection-transport-runtime-receipt',
    identity,
  );
  assert.equal(transportReceiptJson.sourceName, runtime.transport.source.name);
  assert.deepEqual(transportReceiptJson.windows, runtime.transport.windows);
  const transportRows = transport as never;
  const windowRequestIds = new Set<number>();
  for (const window of runtime.transport.windows) {
    const matching = requireNativeConnectionTransport({
      observations: transportRows,
      method: window.method,
      route: window.route,
      status: window.status,
      targetOrigin: runtime.target.apiOrigin,
      afterRequestId: window.afterRequestId,
      throughRequestId: window.throughRequestId,
      unique: window.unique,
    });
    assert(matching.length > 0, `Transport window is not bound: ${window.method} ${window.route}`);
    for (const row of matching) windowRequestIds.add(row.requestId);
  }
  const requestIds = new Set(runtime.api.requestIds);
  assert(requestIds.size === runtime.api.requestIds.length && runtime.api.requestIds.length > 0);
  for (const requestId of requestIds) {
    const row = transport.find((candidate) => candidate.requestId === requestId);
    assert(row, `API request ${requestId} is absent from transport`);
    assert.equal(row.targetOrigin, runtime.target.apiOrigin);
    assert.equal(row.outcome, 'forwarded');
    assert.equal(row.requestProfile, 'native');
    assert.equal(row.requestOrigin, null);
  }
  for (const requestId of windowRequestIds)
    assert(requestIds.has(requestId), `API receipt omits transport request ${requestId}`);

  const prep = record(report.connectionJourneyPreparation, 'Detox connection preparation');
  assert.equal(prep.isolationUnchanged, true);
  assert.equal(prep.trainingPlansUnchanged, true);
  assert.equal(runtime.sql.isolationUnchanged, true);
  assert.equal(runtime.sql.trainingPlansUnchanged, true);
  const snapshots = record(prep.snapshots, 'Detox SQL snapshot map');
  assert.equal(runtime.sql.snapshots.length, 12);
  const snapshotNames = new Set(runtime.sql.snapshots.map((row) => row.receipt.name));
  assert.equal(
    snapshotNames.size,
    runtime.sql.snapshots.length,
    'SQL snapshot receipt is duplicated',
  );
  assert.deepEqual(
    runtime.sql.snapshots.map((row) => row.label).sort(),
    Object.keys(snapshots).sort(),
  );
  const sql = await readProtected(
    input.captureRoot,
    runtime.sql.receipt,
    identity,
    input.lifecycle,
    'SQL receipt',
  );
  const sqlJson = requireReceiptHeader(
    sql.json,
    'private-detox-connection-sql-runtime-receipt',
    identity,
  );
  assert.deepEqual(
    sqlJson.snapshotNames,
    runtime.sql.snapshots.map((row) => row.receipt.name),
  );
  assert.equal(sqlJson.isolationUnchanged, true);
  assert.equal(sqlJson.trainingPlansUnchanged, true);
  for (const row of runtime.sql.snapshots) {
    const expected = record(snapshots[row.label], `SQL snapshot ${row.label}`);
    assert.equal(expected.path, row.receipt.name);
    const snapshot = await readProtected(
      input.captureRoot,
      row.receipt,
      identity,
      input.lifecycle,
      `SQL snapshot ${row.label}`,
    );
    requireConnectionSnapshot(JSON.parse(snapshot.bytes.toString('utf8')), {
      runId: String(backend.runId),
    });
    assert.equal(hashBytes(snapshot.bytes), expected.sha256);
  }

  const observationNames = new Set<string>();
  const commands = Array.isArray(report.detoxConnectionCommands)
    ? (report.detoxConnectionCommands as RecordValue[])
    : [];
  const observations = Array.isArray(report.detoxConnectionObservations)
    ? (report.detoxConnectionObservations as RecordValue[])
    : [];
  for (const observation of observations) {
    assert(typeof observation.label === 'string');
    observationNames.add(String(observation.label));
  }
  assert(commands.length === observations.length && observationNames.size === observations.length);
  const ui = await readProtected(
    input.captureRoot,
    runtime.ui.receipt,
    identity,
    input.lifecycle,
    'UI receipt',
  );
  const uiJson = requireReceiptHeader(
    ui.json,
    'private-detox-connection-ui-runtime-receipt',
    identity,
  );
  assert.deepEqual(uiJson.assertionIds, [...nativeConnectionAssertionIds]);
  assert.deepEqual(
    uiJson.observationLabels,
    runtime.ui.assertions.flatMap((row) => row.observationLabels),
  );
  assert.equal(runtime.ui.assertions.length, nativeConnectionAssertionIds.length);
  const declaredIds = runtime.ui.assertions.map((row) => row.id);
  assert.deepEqual(declaredIds, [...nativeConnectionAssertionIds]);
  const ledger = Array.isArray(report.detoxConnectionLedger)
    ? (report.detoxConnectionLedger as RecordValue[])
    : [];
  assert.equal(ledger.length, nativeConnectionAssertionIds.length);
  for (const [index, assertion] of runtime.ui.assertions.entries()) {
    const purpose = CONNECTION_PURPOSE_PLANS[index];
    assert.equal(assertion.actor, purpose.actor);
    const requiresUi = purpose.requiredEvidence.includes('ui');
    if (requiresUi) assert(assertion.observationLabels.length > 0);
    else assert.equal(assertion.observationLabels.length, 0);
    const ledgerRow = ledger[index];
    assert.equal(ledgerRow.id, assertion.id);
    assert.equal(ledgerRow.status, 'passed');
    assert.equal(ledgerRow.bound, true);
    assert.deepEqual(ledgerRow.observationLabels, assertion.observationLabels);
    for (const label of assertion.observationLabels) assert(observationNames.has(label));
    const evidenceNames = new Set<string>();
    for (const evidence of assertion.evidence) {
      assert(!evidenceNames.has(evidence.name), `UI evidence is duplicated: ${evidence.name}`);
      evidenceNames.add(evidence.name);
      await readProtected(
        input.captureRoot,
        evidence,
        identity,
        input.lifecycle,
        `UI evidence ${assertion.id}`,
      );
    }
    if (requiresUi) {
      for (const label of assertion.observationLabels) {
        assert(evidenceNames.has(`${label}.png`), `UI screenshot is not bound: ${label}`);
        assert(evidenceNames.has(`${label}-hierarchy.json`), `UI hierarchy is not bound: ${label}`);
      }
      assert(evidenceNames.size >= 2, `UI assertion lacks original evidence: ${assertion.id}`);
    } else
      assert.equal(evidenceNames.size, 0, `SQL-only assertion has UI evidence: ${assertion.id}`);
  }

  const cleanup = await readProtected(
    input.captureRoot,
    runtime.cleanup.receipt,
    identity,
    input.lifecycle,
    'Cleanup receipt',
  );
  const cleanupJson = requireReceiptHeader(
    cleanup.json,
    'private-detox-connection-cleanup',
    identity,
  );
  assert.equal(cleanupJson.status, 'cleaned');
  assert.equal(cleanupJson.recoveryStatus, 'verified');
  assert.deepEqual(cleanupJson.failures, []);
  assert.equal(runtime.cleanup.status, 'cleaned');
  assert.equal(runtime.cleanup.recoveryStatus, 'verified');
  assert.deepEqual(runtime.cleanup.failures, []);
  assert.deepEqual(runtime.cleanup.survivors, []);
  assert.deepEqual(runtime.cleanup.unknownProcesses, []);

  const originalName = cleanupJson.originalName;
  assert.equal(
    originalName,
    'detox-connection-cleanup.private.json',
    'Runtime cleanup receipt is bound to an unexpected original file',
  );
  const originalBytes = cleanupJson.originalBytes;
  assert(
    Number.isSafeInteger(originalBytes) && Number(originalBytes) > 0,
    'Runtime cleanup receipt is missing the original byte count',
  );
  const originalSha256 = cleanupJson.originalSha256;
  requireHash(originalSha256, 'Runtime cleanup original hash');
  const originalMetadata = record(
    cleanupJson.originalMetadata,
    'Runtime cleanup original metadata',
  ) as DetoxConnectionEvidenceStat;
  const observedOriginal = await readOwnedDetoxConnectionEvidence(
    input.captureRoot,
    originalName,
    MAX_JSON_BYTES,
    { signal: input.lifecycle.signal, deadlineAt: input.lifecycle.deadlineAtMonotonicMs },
  );
  assert.equal(
    observedOriginal.bytes.byteLength,
    originalBytes,
    'Cleanup original byte count changed after runtime receipt publication',
  );
  assert.equal(
    hashBytes(observedOriginal.bytes),
    originalSha256,
    'Cleanup original bytes changed after runtime receipt publication',
  );
  assertStatEqual(
    observedOriginal.metadata,
    originalMetadata,
    'Cleanup original descriptor identity',
  );
  return {
    name: originalName,
    bytes: observedOriginal.bytes.byteLength,
    sha256: hashBytes(observedOriginal.bytes),
    metadata: observedOriginal.metadata,
  };
}

function canonicalBindings(
  input: DetoxIosConnectionRuntimeVerificationInput,
  manifest: DetoxIosConnectionEvidenceCopyManifest,
): NativeConnectionAssertionBinding[] {
  const names = new Set(manifest.files.map((file) => file.name));
  const rows = requireNativePilotAssertions(input.selection);
  return input.runtime.ui.assertions.map((assertion, index) => {
    const contract = rows[index];
    const evidence = new Set<string>(assertion.evidence.map((file) => file.name));
    const sql = input.runtime.sql.snapshots
      .filter((snapshot) =>
        String(CONNECTION_PURPOSE_PLANS[index].requiredSnapshot)
          .split('/')
          .includes(snapshot.label),
      )
      .map((snapshot) => snapshot.receipt.name);
    for (const name of sql) evidence.add(name);
    if (contract.evidenceKinds.includes('api')) evidence.add(input.runtime.transport.source.name);
    for (const name of evidence)
      assert(names.has(name), `Staged runtime evidence is missing: ${name}`);
    return {
      id: assertion.id,
      requirementRefs: [...contract.requirementRefs],
      evidencePaths: [...evidence],
    };
  });
}

/**
 * Verify one real Detox runtime envelope and stage its original evidence for
 * the canonical runner.  The return value is deliberately a private
 * verification result with zero public/native counts; only the existing
 * run-native-pilot terminal writer may publish a P4 receipt.
 */
export async function verifyIosDetoxConnectionRuntimeForCanonicalFinalization(
  input: DetoxIosConnectionRuntimeVerificationInput,
): Promise<DetoxIosConnectionRuntimeVerificationResult> {
  assertTerminalFacts(input);
  const report = assertSelectionAndBridge(input);
  const expectedCleanupOriginal = await verifyRuntimeReceiptSet(input, report);
  const validateBuild = input.validateBuild
    ? (stagingBuild: DetoxBaselineBuildInstrumentation, repositoryRoot: string) => {
        assert.equal(stagingBuild.platform, input.build.platform);
        return input.validateBuild!(input.build, repositoryRoot);
      }
    : undefined;
  const staged = await stageIosDetoxConnectionPublicEvidence({
    repositoryRoot: input.repositoryRoot,
    captureRoot: input.captureRoot,
    outputRoot: input.outputRoot,
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    selection: input.selection,
    bridgeResult: input.bridgeResult,
    build: input.build,
    lifecycle: input.lifecycle,
    expectedCleanupOriginal,
    validateBuild,
  });
  await verifyStagedIosDetoxConnectionPublicEvidence({
    repositoryRoot: input.repositoryRoot,
    captureRoot: input.captureRoot,
    outputRoot: staged.outputRoot,
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    selection: input.selection,
    bridgeResult: input.bridgeResult,
    build: input.build,
    lifecycle: input.lifecycle,
    expectedCleanupOriginal,
    validateBuild,
    copyManifest: staged.manifest,
  });
  const assertionBindings = canonicalBindings(input, staged.manifest);
  assert.equal(assertionBindings.length, nativeConnectionAssertionIds.length);
  assert.deepEqual(
    assertionBindings.map((row) => row.id),
    [...nativeConnectionAssertionIds],
  );
  return {
    kind: 'private-detox-ios-connection-runtime-verification-not-public-receipt',
    status: 'verified-runtime',
    verificationResult: 'passed',
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRunId: input.runtime.captureRunId,
    assertionBindings,
    staged: { outputRoot: staged.outputRoot, manifest: staged.manifest },
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
  };
}
