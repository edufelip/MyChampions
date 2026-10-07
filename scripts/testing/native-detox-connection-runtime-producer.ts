import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  readOwnedDetoxConnectionEvidence,
  writeAtomicDetoxConnectionBytes,
  type DetoxConnectionEvidenceRead,
} from './detox-connection-evidence';
import {
  requireDetoxRuntimeBuildMetadata,
  type DetoxRuntimeBuildMetadata,
} from './detox-runtime-build-metadata';
import type { DetoxIosConnectionPublicBridgeResult } from './native-detox-connection-public-bridge';
import type {
  DetoxDispatchQualifiedBuild,
  DetoxNativePilotAttemptResult,
  DetoxRuntimeQualifiedBuild,
} from './native-detox-connection-public-dispatch';
import type {
  DetoxIosConnectionRuntimeFacts,
  DetoxRuntimeProtectedReceipt,
  DetoxRuntimeSqlSnapshot,
  DetoxRuntimeTransportWindow,
  DetoxRuntimeUiAssertion,
} from './native-detox-connection-runtime-verification';
import type { NativePilotSelection } from './native-pilot-contract';

const HASH = /^[a-f0-9]{64}$/;
const DIRECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:private\.)?(?:json|xml|png)$/;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_PNG_BYTES = 8 * 1024 * 1024;

/**
 * These are producer-owned references to files already written by the Detox
 * child/driver.  The runtime writer never accepts arbitrary runtime facts: it
 * re-reads every reference through the protected evidence reader and derives
 * the envelope hashes and metadata from those bytes.
 */
export type DetoxRuntimeOriginalReceiptSet = Readonly<{
  source: Readonly<{
    name: string;
    sourceTreeHash: string;
    helperInputsHash: string;
    detoxConfigHash: string;
    dispatchRuntimeInputsHash: string;
  }>;
  build: Readonly<
    {
      name: string;
      configuration: 'ios.sim.debug';
      sourceTreeHash: string;
      helperInputsHash: string;
      binaryHash: string;
      detoxConfigHash: string;
    } & DetoxRuntimeBuildMetadata
  >;
  target: Readonly<{
    name: string;
    platform: 'ios';
    deviceId: string;
    osVersion: string;
    appId: string;
    ownership: 'owned';
    apiOrigin: string;
  }>;
  reset: Readonly<{
    name: string;
    status: 'verified';
    targetDeviceId: string;
    permissionState: 'not-applicable';
    resetFingerprint: string;
  }>;
  transport: Readonly<{
    receiptName: string;
    sourceName: string;
    windows: readonly DetoxRuntimeTransportWindow[];
  }>;
  api: Readonly<{
    receiptName: string;
    apiPid: number;
    targetOrigin: string;
    requestIds: readonly number[];
  }>;
  sql: Readonly<{
    receiptName: string;
    snapshots: readonly Readonly<{ label: string; name: string }>[];
    isolationUnchanged: true;
    trainingPlansUnchanged: true;
  }>;
  ui: Readonly<{
    receiptName: string;
    assertions: readonly Readonly<{
      id: DetoxRuntimeUiAssertion['id'];
      actor: DetoxRuntimeUiAssertion['actor'];
      observationLabels: readonly string[];
      evidenceNames: readonly string[];
    }>[];
  }>;
  cleanup: Readonly<{
    name: string;
    status: 'cleaned';
    recoveryStatus: 'verified';
  }>;
}>;

type ProducerReport = Record<string, unknown>;

export type DetoxRuntimeProducerInput = Readonly<{
  repositoryRoot: string;
  captureRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  build: DetoxDispatchQualifiedBuild;
  bridgeResult: DetoxIosConnectionPublicBridgeResult;
  attempt: DetoxNativePilotAttemptResult;
  /** The owned dispatch lifecycle is propagated to every original read/write. */
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
}>;

function record(value: unknown, label: string): ProducerReport {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as ProducerReport;
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && HASH.test(value), `${label} must be a SHA-256 hash`);
}

function requireName(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' && DIRECT_NAME.test(value),
    `${label} is not a private receipt name`,
  );
}

function requiredString(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is missing`);
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  assert(typeof value === 'number' && Number.isSafeInteger(value), `${label} is missing`);
  return value;
}

type ProtectedOriginalBinding = Readonly<{
  name: string;
  bytes: number;
  sha256: string;
  metadata: DetoxConnectionEvidenceRead['metadata'];
}>;

function protectedOriginalBinding(value: unknown, label: string): ProtectedOriginalBinding {
  const row = record(value, label);
  const metadata = record(row.metadata, `${label} metadata`);
  for (const key of ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size'])
    requiredNumber(metadata[key], `${label} metadata ${key}`);
  for (const key of ['mtimeMs', 'ctimeMs'])
    assert(
      typeof metadata[key] === 'number' && Number.isFinite(metadata[key]),
      `${label} metadata ${key} is missing`,
    );
  return {
    name: requiredString(row.name, `${label} name`),
    bytes: requiredNumber(row.bytes, `${label} byte count`),
    sha256: (() => {
      const hash = row.sha256;
      requireHash(hash, `${label} hash`);
      return hash;
    })(),
    metadata: metadata as DetoxConnectionEvidenceRead['metadata'],
  };
}

function assertProtectedOriginalBinding(
  value: unknown,
  observed: DetoxConnectionEvidenceRead,
  label: string,
  expectedName: string,
): void {
  const expected = protectedOriginalBinding(value, label);
  assert.equal(expected.name, expectedName, `${label} name changed`);
  assert.equal(expected.bytes, observed.bytes.byteLength, `${label} byte count changed`);
  assert.equal(expected.sha256, hashBytes(observed.bytes), `${label} bytes changed`);
  assert.deepEqual(expected.metadata, observed.metadata, `${label} descriptor identity changed`);
}

function identity(input: DetoxRuntimeProducerInput) {
  return {
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRunId: input.requestedRunId,
  } as const;
}

async function readOriginal(
  input: DetoxRuntimeProducerInput,
  root: string,
  name: string,
  label: string,
  maxBytes = MAX_JSON_BYTES,
): Promise<DetoxConnectionEvidenceRead> {
  requireName(name, `${label} original`);
  return readOwnedDetoxConnectionEvidence(root, name, maxBytes, {
    signal: input.signal,
    deadlineAt: input.deadlineAtMonotonicMs,
  });
}

function protectedReceipt(
  name: string,
  observed: DetoxConnectionEvidenceRead,
): DetoxRuntimeProtectedReceipt {
  return {
    name,
    bytes: observed.bytes.byteLength,
    sha256: hashBytes(observed.bytes),
    metadata: observed.metadata,
  };
}

async function writeEnvelope(
  root: string,
  name: string,
  input: DetoxRuntimeProducerInput,
  kind: string,
  fields: Record<string, unknown>,
): Promise<DetoxRuntimeProtectedReceipt> {
  const bytes = Buffer.from(
    `${JSON.stringify({
      kind,
      requestedRunId: input.requestedRunId,
      requestedAttemptId: input.requestedAttemptId,
      captureRunId: input.requestedRunId,
      ...fields,
    })}\n`,
  );
  const written = await writeAtomicDetoxConnectionBytes(root, name, bytes, MAX_JSON_BYTES, {
    signal: input.signal,
    deadlineAt: input.deadlineAtMonotonicMs,
  });
  return protectedReceipt(name, written);
}

function requireCompletedAttempt(input: DetoxRuntimeProducerInput): void {
  const { attempt, bridgeResult } = input;
  assert.equal(attempt.requestedAttemptId, `${attempt.requestedRunId}:first`);
  assert.equal(attempt.requestedRunId, input.requestedRunId);
  assert.equal(attempt.captureResult, 'observed');
  assert.equal(attempt.captureExitCode, 0);
  assert.equal(attempt.childExitCode, 0);
  assert.equal(attempt.childSignal, null);
  assert.equal(attempt.childClassification, 'completed');
  assert.equal(attempt.captureCleanup, 'cleaned');
  assert.equal(attempt.externalCleanupResult, 'passed');
  assert.equal(attempt.verificationResult, 'passed');
  assert.equal(attempt.callbackInvocations, 1);
  assert.equal(attempt.callbackCompleted, true);
  assert.equal(attempt.captureTimeout, null);
  assert.equal(attempt.cancellation, null);
  assert.equal(attempt.deadline, null);
  assert.equal(attempt.postCaptureFailure, null);
  assert.equal(attempt.captureCompleted, true);
  assert.equal(attempt.captureInvocation.count, 1);
  assert.equal(attempt.captureInvocation.returned, true);
  assert.equal(attempt.nativePassingCases, 0);
  assert.equal(attempt.publicFinalization, null);
  assert.equal(attempt.publicFinalizationInput, null);
  assert.equal(attempt.staged, null);
  assert.equal(bridgeResult.nativePassingCases, 0);
  assert.equal(bridgeResult.publicPromotionEligible, false);
  assert.equal(bridgeResult.attempt.status, 'source-only');
  assert.equal(bridgeResult.attempt.acquired, true);
  assert.equal(bridgeResult.attempt.cleanup, 'cleaned');
  assert.equal(bridgeResult.attempt.recoveryStatus, 'verified');
  for (const [name, value] of Object.entries(attempt.timingsMs))
    assert(
      Number.isFinite(value) && value > 0,
      `Detox runtime timing ${name} is not producer-observed`,
    );
}

function requireReport(input: DetoxRuntimeProducerInput): ProducerReport {
  const report = record(input.bridgeResult.attempt.report, 'Detox producer report');
  assert.equal(report.kind, 'private-detox-connection-capture-not-public-receipt');
  assert.equal(report.output, input.captureRoot);
  assert.equal(report.nativePassingCases, 0);
  assert.equal(report.publicPromotionEligible, false);
  assert.deepEqual(report.selection, input.selection);
  const producer = record(report.detoxProducerReceipt, 'Detox producer receipt');
  assert.equal(producer.captureRunId, input.requestedRunId);
  assert.equal(producer.platform, 'ios');
  assert.equal(producer.sourceTreeHash, input.build.source.sourceTreeHash);
  assert.equal(producer.helperInputsHash, input.build.helperInputsHash);
  return report;
}

function reportObject(value: unknown, label: string): ProducerReport {
  return record(value, label);
}

function missingOwnedFile(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT',
  );
}

/**
 * Bind the runtime envelope to the real Detox report after the journey has
 * completed.  The driver owns the target, simulator-owner marker, transport,
 * snapshots, UI observations and cleanup receipt; this adapter only writes
 * small producer receipt indexes after rereading those originals.  A driver
 * without a fresh simulator-owner marker remains source-only.
 */
async function deriveOriginalReceiptSetFromDriver(
  input: DetoxRuntimeProducerInput,
  report: ProducerReport,
): Promise<DetoxRuntimeOriginalReceiptSet | null> {
  try {
    const target = reportObject(report.target, 'Detox target report');
    const backend = reportObject(report.backend, 'Detox backend report');
    const api = reportObject(report.connectionApiIdentity, 'Detox API report');
    const preparation = reportObject(report.connectionJourneyPreparation, 'Detox journey report');
    const snapshots = reportObject(preparation.snapshots, 'Detox snapshot report');
    const reportBuild = reportObject(report.build, 'Detox build report');
    const runtimeMetadata = {
      environmentHash: reportBuild.environmentHash,
      toolVersions: reportBuild.toolVersions,
      toolVersionEvidence: reportBuild.toolVersionEvidence,
    };
    requireDetoxRuntimeBuildMetadata(runtimeMetadata, 'Detox producer runtime metadata');
    requireDetoxRuntimeBuildMetadata(input.build, 'Detox qualified runtime metadata');
    const qualifiedBuild = input.build as DetoxRuntimeQualifiedBuild;
    assert.equal(runtimeMetadata.environmentHash, qualifiedBuild.environmentHash);
    assert.deepEqual(runtimeMetadata.toolVersions, qualifiedBuild.toolVersions);
    assert.deepEqual(runtimeMetadata.toolVersionEvidence, qualifiedBuild.toolVersionEvidence);
    const sourceReceipt = reportObject(
      report.detoxTransportSourceReceipt,
      'Detox transport source receipt',
    );
    const sourceRows = report.detoxTransportSource;
    const ledger = report.detoxConnectionLedger;
    const observations = report.detoxConnectionObservations;
    assert(Array.isArray(sourceRows) && sourceRows.length > 0);
    assert(Array.isArray(ledger) && ledger.length === 7);
    assert(Array.isArray(observations) && observations.length > 0);
    assert(sourceReceipt.path === 'detox-connection-transport-source.private.json');
    assert(typeof target.deviceId === 'string' && target.deviceId.length > 0);
    assert(typeof target.osVersion === 'string' && target.osVersion.length > 0);
    assert(typeof target.apiOrigin === 'string' && target.apiOrigin.length > 0);
    const targetReset = reportObject(target.reset, 'Detox target reset report');
    const resetName = requiredString(targetReset.name, 'Detox target reset path');
    assert.equal(resetName, 'detox-reset-original.private.json');
    assert.equal(targetReset.status, 'verified');
    assert.equal(targetReset.targetDeviceId, target.deviceId);
    assert(typeof input.build.appIdentifier === 'string' && input.build.appIdentifier.length > 0);
    assert(typeof backend.apiPid === 'number' && Number.isSafeInteger(backend.apiPid));
    assert(typeof api.apiPid === 'number' && Number.isSafeInteger(api.apiPid));
    assert.equal(backend.apiPid, api.apiPid);
    assert.equal(api.targetOrigin, target.apiOrigin);
    assert(preparation.isolationUnchanged === true && preparation.trainingPlansUnchanged === true);

    const owner = await readOriginal(
      input,
      input.captureRoot,
      'simulator-owner.private.json',
      'Simulator owner',
    );
    const ownerJson = JSON.parse(owner.bytes.toString('utf8')) as ProducerReport;
    const ownerIdentity = reportObject(ownerJson.identity, 'Simulator owner identity');
    assert(ownerJson.state === 'owned');
    assert.equal(ownerIdentity.udid, target.deviceId);
    assert(typeof ownerIdentity.runtime === 'string' && ownerIdentity.runtime.length > 0);
    assert.equal(ownerIdentity.runtime, target.osVersion);
    const reset = await readOriginal(input, input.captureRoot, resetName, 'Detox reset');
    const resetJson = JSON.parse(reset.bytes.toString('utf8')) as ProducerReport;
    assert.equal(resetJson.kind, 'private-detox-fresh-owned-target-reset-original');
    assert.equal(resetJson.platform, 'ios');
    assert.equal(resetJson.status, 'verified');
    assert.equal(resetJson.freshOwnedTarget, true);
    assert.equal(resetJson.resetMethod, 'new-owned-simulator');
    assert.equal(resetJson.ownerPath, 'simulator-owner.private.json');
    assert.equal(resetJson.ownerSha256, hashBytes(owner.bytes));
    assert.equal(resetJson.ownerBytes, owner.bytes.byteLength);
    assert.equal(resetJson.targetDeviceId, target.deviceId);
    assert.equal(resetJson.osVersion, ownerIdentity.runtime);
    const resetFingerprint = hashBytes(reset.bytes);
    assert.equal(targetReset.resetFingerprint, resetFingerprint);

    const sourceName = 'detox-source-original.private.json';
    const buildName = 'detox-build-original.private.json';
    const targetName = 'detox-target-original.private.json';
    const transportName = 'detox-transport-original.private.json';
    const apiName = 'detox-api-original.private.json';
    const sqlName = 'detox-sql-original.private.json';
    const uiName = 'detox-ui-original.private.json';
    const snapshotRows = Object.entries(snapshots).map(([label, value]) => {
      const row = reportObject(value, `Detox snapshot ${label}`);
      assert(typeof row.path === 'string');
      return {
        label,
        name: requiredString(row.path, `Detox snapshot ${label} path`),
      };
    });
    assert.equal(snapshotRows.length, 12);
    const transportWindows = preparation.transportWindows;
    assert(Array.isArray(transportWindows) && transportWindows.length >= 9);
    const requestIds = sourceRows
      .map((row) => reportObject(row, 'Detox transport row').requestId)
      .filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value));
    assert.equal(new Set(requestIds).size, requestIds.length);
    assert(requestIds.length > 0);

    const uiAssertions = ledger.map((value) => {
      const row = reportObject(value, 'Detox UI ledger row');
      const labels = row.observationLabels;
      assert(Array.isArray(labels));
      const evidenceNames = labels.flatMap((label) => [
        `${String(label)}.png`,
        `${String(label)}-hierarchy.json`,
      ]);
      return {
        id: row.id as DetoxRuntimeUiAssertion['id'],
        actor: row.actor as DetoxRuntimeUiAssertion['actor'],
        observationLabels: labels.map(String),
        evidenceNames,
      };
    });
    const configuration = input.build.configuration;
    assert.equal(configuration, 'ios.sim.debug');
    const set: DetoxRuntimeOriginalReceiptSet = {
      source: {
        name: sourceName,
        sourceTreeHash: input.build.source.sourceTreeHash,
        helperInputsHash: input.build.helperInputsHash,
        detoxConfigHash: input.build.detoxConfigHash,
        dispatchRuntimeInputsHash: input.build.dispatchRuntimeInputsHash,
      },
      build: {
        name: buildName,
        configuration,
        sourceTreeHash: input.build.source.sourceTreeHash,
        helperInputsHash: input.build.helperInputsHash,
        binaryHash: input.build.binaryHash,
        detoxConfigHash: input.build.detoxConfigHash,
        environmentHash: qualifiedBuild.environmentHash,
        toolVersions: qualifiedBuild.toolVersions,
        toolVersionEvidence: qualifiedBuild.toolVersionEvidence,
      },
      target: {
        name: targetName,
        platform: 'ios',
        deviceId: requiredString(target.deviceId, 'Detox target device ID'),
        osVersion: requiredString(target.osVersion, 'Detox target OS version'),
        appId: input.build.appIdentifier,
        ownership: 'owned',
        apiOrigin: requiredString(target.apiOrigin, 'Detox target API origin'),
      },
      reset: {
        name: resetName,
        status: 'verified',
        targetDeviceId: requiredString(target.deviceId, 'Detox reset target device ID'),
        permissionState: 'not-applicable',
        resetFingerprint,
      },
      transport: {
        receiptName: transportName,
        sourceName: requiredString(sourceReceipt.path, 'Detox transport source path'),
        windows: transportWindows as DetoxRuntimeTransportWindow[],
      },
      api: {
        receiptName: apiName,
        apiPid: requiredNumber(api.apiPid, 'Detox API PID'),
        targetOrigin: requiredString(api.targetOrigin, 'Detox API target origin'),
        requestIds,
      },
      sql: {
        receiptName: sqlName,
        snapshots: snapshotRows,
        isolationUnchanged: true,
        trainingPlansUnchanged: true,
      },
      ui: { receiptName: uiName, assertions: uiAssertions },
      cleanup: {
        name: 'detox-connection-cleanup.private.json',
        status: 'cleaned',
        recoveryStatus: 'verified',
      },
    };

    const originals = await Promise.all([
      readOriginal(input, input.captureRoot, sourceName, 'Source'),
      readOriginal(input, input.captureRoot, buildName, 'Build'),
      readOriginal(input, input.captureRoot, targetName, 'Target'),
      readOriginal(input, input.captureRoot, transportName, 'Transport'),
      readOriginal(input, input.captureRoot, apiName, 'API'),
      readOriginal(input, input.captureRoot, sqlName, 'SQL'),
      readOriginal(input, input.captureRoot, uiName, 'UI'),
    ]);
    const expectedOwner = 'detox-driver';
    const expectedRunId = input.requestedRunId;
    const expectedAttemptId = input.requestedAttemptId;
    const expectedCommands = (
      Array.isArray(report.detoxConnectionCommands) ? report.detoxConnectionCommands : []
    ) as readonly Record<string, unknown>[];
    assert(expectedCommands.length > 0, 'Detox originals lack actual command provenance');
    const expectedCommandIds = expectedCommands.map((command) => command.commandId);
    const expectedCommandHashes = expectedCommands.map((command) => command.commandHash);
    for (const [index, original] of originals.entries()) {
      const json = JSON.parse(original.bytes.toString('utf8')) as ProducerReport;
      assert.equal(json.owner, expectedOwner, `Detox original ${index} is not driver-owned`);
      assert.equal(json.requestedRunId, expectedRunId);
      assert.equal(json.requestedAttemptId, expectedAttemptId);
      assert.equal(json.captureRunId, expectedRunId);
      assert.deepEqual(json.childIdentity, report.detoxChildIdentity);
      assert.deepEqual(json.commandIds, expectedCommandIds);
      assert.deepEqual(json.commandHashes, expectedCommandHashes);
    }
    const sourceJson = JSON.parse(originals[0].bytes.toString('utf8')) as ProducerReport;
    const buildJson = JSON.parse(originals[1].bytes.toString('utf8')) as ProducerReport;
    const targetJson = JSON.parse(originals[2].bytes.toString('utf8')) as ProducerReport;
    const transportJson = JSON.parse(originals[3].bytes.toString('utf8')) as ProducerReport;
    const apiJson = JSON.parse(originals[4].bytes.toString('utf8')) as ProducerReport;
    const sqlJson = JSON.parse(originals[5].bytes.toString('utf8')) as ProducerReport;
    const uiJson = JSON.parse(originals[6].bytes.toString('utf8')) as ProducerReport;
    assertProtectedOriginalBinding(
      record(record(targetJson.evidence, 'Detox target evidence').owner, 'Detox owner evidence'),
      owner,
      'Detox owner evidence',
      'simulator-owner.private.json',
    );
    assertProtectedOriginalBinding(
      record(record(targetJson.evidence, 'Detox target evidence').reset, 'Detox reset evidence'),
      reset,
      'Detox reset evidence',
      set.reset.name,
    );
    const transportSource = await readOriginal(
      input,
      input.captureRoot,
      set.transport.sourceName,
      'Transport source',
    );
    assertProtectedOriginalBinding(
      transportJson.sourceEvidence,
      transportSource,
      'Detox transport source evidence',
      set.transport.sourceName,
    );
    assertProtectedOriginalBinding(
      apiJson.transportSourceEvidence,
      transportSource,
      'Detox API transport source evidence',
      set.transport.sourceName,
    );
    const snapshotOriginals = await Promise.all(
      set.sql.snapshots.map((row) =>
        readOriginal(input, input.captureRoot, row.name, `SQL snapshot ${row.label}`),
      ),
    );
    const snapshotBindings = sqlJson.snapshotEvidence;
    assert(Array.isArray(snapshotBindings));
    assert.equal(snapshotBindings.length, snapshotOriginals.length);
    snapshotBindings.forEach((binding, index) => {
      assertProtectedOriginalBinding(
        binding,
        snapshotOriginals[index],
        `Detox SQL snapshot ${set.sql.snapshots[index].label} evidence`,
        set.sql.snapshots[index].name,
      );
    });
    const uiEvidenceNames = set.ui.assertions.flatMap((row) => row.evidenceNames);
    const uiOriginals = await Promise.all(
      uiEvidenceNames.map((name) =>
        readOriginal(input, input.captureRoot, name, `UI evidence ${name}`),
      ),
    );
    const uiBindings = uiJson.evidence;
    assert(Array.isArray(uiBindings));
    assert.equal(uiBindings.length, uiOriginals.length);
    uiBindings.forEach((binding, index) => {
      assertProtectedOriginalBinding(
        binding,
        uiOriginals[index],
        `Detox UI evidence ${uiEvidenceNames[index]}`,
        uiEvidenceNames[index],
      );
    });
    assert.equal(sourceJson.sourceTreeHash, set.source.sourceTreeHash);
    assert.equal(sourceJson.helperInputsHash, set.source.helperInputsHash);
    assert.equal(sourceJson.detoxConfigHash, set.source.detoxConfigHash);
    assert.equal(sourceJson.dispatchRuntimeInputsHash, set.source.dispatchRuntimeInputsHash);
    assert.equal(buildJson.configuration, set.build.configuration);
    assert.equal(buildJson.binaryHash, set.build.binaryHash);
    assert.equal(targetJson.deviceId, set.target.deviceId);
    assert.equal(targetJson.apiOrigin, set.target.apiOrigin);
    assert.equal(transportJson.sourceName, set.transport.sourceName);
    assert.deepEqual(transportJson.windows, set.transport.windows);
    assert.equal(apiJson.apiPid, set.api.apiPid);
    assert.equal(apiJson.targetOrigin, set.api.targetOrigin);
    assert.deepEqual(apiJson.requestIds, set.api.requestIds);
    assert.deepEqual(
      sqlJson.snapshotNames,
      set.sql.snapshots.map((row) => row.name),
    );
    assert.equal(sqlJson.isolationUnchanged, true);
    assert.equal(sqlJson.trainingPlansUnchanged, true);
    assert.deepEqual(
      uiJson.assertionIds,
      set.ui.assertions.map((row) => row.id),
    );
    report.target = { ...target, reset: set.reset };
    return set;
  } catch (error) {
    if (missingOwnedFile(error)) return null;
    throw error;
  }
}

function requireReceiptSetShape(set: DetoxRuntimeOriginalReceiptSet): void {
  for (const [group, value] of Object.entries(set)) {
    assert(value && typeof value === 'object', `Detox runtime ${group} receipt set is missing`);
  }
  requireName(set.source.name, 'Source');
  requireName(set.build.name, 'Build');
  requireName(set.target.name, 'Target');
  requireName(set.reset.name, 'Reset');
  requireName(set.transport.receiptName, 'Transport');
  requireName(set.transport.sourceName, 'Transport source');
  requireName(set.api.receiptName, 'API');
  requireName(set.sql.receiptName, 'SQL');
  requireName(set.ui.receiptName, 'UI');
  requireName(set.cleanup.name, 'Cleanup');
  for (const row of set.sql.snapshots) requireName(row.name, `SQL snapshot ${row.label}`);
  for (const row of set.ui.assertions) {
    assert(Array.isArray(row.observationLabels));
    for (const name of row.evidenceNames) requireName(name, `UI evidence ${row.id}`);
  }
  requireHash(set.source.sourceTreeHash, 'Runtime source tree hash');
  requireHash(set.source.helperInputsHash, 'Runtime helper hash');
  requireHash(set.source.detoxConfigHash, 'Runtime Detox config hash');
  requireHash(set.source.dispatchRuntimeInputsHash, 'Runtime dispatch closure hash');
  requireHash(set.build.sourceTreeHash, 'Runtime build source hash');
  requireHash(set.build.helperInputsHash, 'Runtime build helper hash');
  requireHash(set.build.binaryHash, 'Runtime build binary hash');
  requireHash(set.build.detoxConfigHash, 'Runtime build Detox config hash');
  requireDetoxRuntimeBuildMetadata(set.build, 'Runtime build metadata');
  requireHash(set.reset.resetFingerprint, 'Runtime reset fingerprint');
  assert.match(set.target.apiOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(set.target.platform, 'ios');
  assert.equal(set.target.ownership, 'owned');
  assert.equal(set.reset.status, 'verified');
  assert.equal(set.reset.permissionState, 'not-applicable');
  assert.equal(set.sql.isolationUnchanged, true);
  assert.equal(set.sql.trainingPlansUnchanged, true);
  assert.equal(set.cleanup.status, 'cleaned');
  assert.equal(set.cleanup.recoveryStatus, 'verified');
}

function requireSetMatchesReport(
  set: DetoxRuntimeOriginalReceiptSet,
  report: ProducerReport,
  input: DetoxRuntimeProducerInput,
): void {
  const target = reportObject(report.target, 'Detox target report');
  assert.equal(target.platform, 'ios');
  assert.equal(target.deviceId, set.target.deviceId);
  assert.equal(target.ownership, 'owned');
  assert.equal(target.osVersion, set.target.osVersion);
  assert.equal(target.appId, set.target.appId);
  assert.equal(target.apiOrigin, set.target.apiOrigin);
  const reset = reportObject(target.reset, 'Detox target reset proof');
  assert.equal(reset.name, set.reset.name);
  assert.equal(reset.targetDeviceId, set.reset.targetDeviceId);
  assert.equal(reset.resetFingerprint, set.reset.resetFingerprint);
  const backend = reportObject(report.backend, 'Detox backend report');
  const api = reportObject(report.connectionApiIdentity, 'Detox API report');
  assert.equal(backend.apiOrigin, set.target.apiOrigin);
  assert.equal(api.targetOrigin, set.api.targetOrigin);
  assert.equal(backend.apiPid, set.api.apiPid);
  assert.equal(api.apiPid, set.api.apiPid);
  const transportReceipt = reportObject(
    report.detoxTransportSourceReceipt,
    'Detox transport report',
  );
  assert.equal(transportReceipt.path, set.transport.sourceName);
  const prep = reportObject(report.connectionJourneyPreparation, 'Detox journey report');
  const snapshots = reportObject(prep.snapshots, 'Detox snapshot report');
  assert.deepEqual(Object.keys(snapshots).sort(), set.sql.snapshots.map((row) => row.label).sort());
  const ledger = report.detoxConnectionLedger;
  assert(Array.isArray(ledger));
  assert.deepEqual(
    ledger.map((row) => reportObject(row, 'Detox ledger row').id),
    set.ui.assertions.map((row) => row.id),
  );
  assert.equal(input.build.dispatchRuntimeInputsHash, set.source.dispatchRuntimeInputsHash);
  const reportBuild = reportObject(report.build, 'Detox build report');
  const reportMetadata = {
    environmentHash: reportBuild.environmentHash,
    toolVersions: reportBuild.toolVersions,
    toolVersionEvidence: reportBuild.toolVersionEvidence,
  };
  requireDetoxRuntimeBuildMetadata(reportMetadata, 'Detox producer build metadata');
  assert.equal(reportMetadata.environmentHash, set.build.environmentHash);
  assert.deepEqual(reportMetadata.toolVersions, set.build.toolVersions);
  assert.deepEqual(reportMetadata.toolVersionEvidence, set.build.toolVersionEvidence);
}

async function requireOriginalFiles(
  input: DetoxRuntimeProducerInput,
  set: DetoxRuntimeOriginalReceiptSet,
): Promise<
  Readonly<{
    source: DetoxConnectionEvidenceRead;
    build: DetoxConnectionEvidenceRead;
    target: DetoxConnectionEvidenceRead;
    reset: DetoxConnectionEvidenceRead;
    transportReceipt: DetoxConnectionEvidenceRead;
    transportSource: DetoxConnectionEvidenceRead;
    api: DetoxConnectionEvidenceRead;
    sql: DetoxConnectionEvidenceRead;
    snapshots: readonly Readonly<{
      label: string;
      read: DetoxConnectionEvidenceRead;
    }>[];
    ui: DetoxConnectionEvidenceRead;
    uiEvidence: readonly DetoxConnectionEvidenceRead[];
    cleanup: DetoxConnectionEvidenceRead;
  }>
> {
  const root = input.attempt.artifactRoot;
  const source = await readOriginal(input, root, set.source.name, 'Source');
  const build = await readOriginal(input, root, set.build.name, 'Build');
  const target = await readOriginal(input, root, set.target.name, 'Target');
  const reset = await readOriginal(input, root, set.reset.name, 'Reset');
  const transportReceipt = await readOriginal(input, root, set.transport.receiptName, 'Transport');
  const transportSource = await readOriginal(
    input,
    root,
    set.transport.sourceName,
    'Transport source',
  );
  const api = await readOriginal(input, root, set.api.receiptName, 'API');
  const sql = await readOriginal(input, root, set.sql.receiptName, 'SQL');
  const snapshots = await Promise.all(
    set.sql.snapshots.map(async (row) => ({
      label: row.label,
      read: await readOriginal(input, root, row.name, `SQL snapshot ${row.label}`),
    })),
  );
  const ui = await readOriginal(input, root, set.ui.receiptName, 'UI');
  const uiEvidence = await Promise.all(
    set.ui.assertions.flatMap((row) =>
      row.evidenceNames.map((name) =>
        readOriginal(
          input,
          root,
          name,
          `UI evidence ${row.id}`,
          name.endsWith('.png') ? MAX_PNG_BYTES : MAX_JSON_BYTES,
        ),
      ),
    ),
  );
  const cleanup = await readOriginal(input, root, set.cleanup.name, 'Cleanup');
  return {
    source,
    build,
    target,
    reset,
    transportReceipt,
    transportSource,
    api,
    sql,
    snapshots,
    ui,
    uiEvidence,
    cleanup,
  };
}

function requireTiming(
  input: DetoxRuntimeProducerInput,
): DetoxIosConnectionRuntimeFacts['timingsMs'] {
  const timing = input.attempt.timingsMs;
  for (const [name, value] of Object.entries(timing))
    assert(
      Number.isFinite(value) && value > 0,
      `Detox ${name} timing was not emitted by the producer`,
    );
  return { ...timing };
}

/**
 * Turn a complete producer-owned receipt set into the verifier input. The
 * driver must have written the originals before this function runs. A report
 * field is never an authority for the original set, because a caller could
 * manufacture it from the same in-memory values that the verifier is meant
 * to independently observe.
 */
export async function produceDetoxRuntimeFactsFromActualProducer(
  input: DetoxRuntimeProducerInput,
): Promise<DetoxIosConnectionRuntimeFacts | null> {
  requireCompletedAttempt(input);
  const report = requireReport(input);
  const set = await deriveOriginalReceiptSetFromDriver(input, report);
  if (!set) return null;
  requireReceiptSetShape(set);
  requireSetMatchesReport(set, report, input);
  const originals = await requireOriginalFiles(input, set);
  const root = input.attempt.artifactRoot;
  const id = identity(input);
  const producerReport = await writeEnvelope(
    root,
    'detox-connection-runtime-producer-report.private.json',
    input,
    'private-detox-connection-runtime-producer-report',
    {
      source: set.source,
      build: set.build,
      target: set.target,
      reset: set.reset,
      transport: set.transport,
      api: set.api,
      sql: set.sql,
      ui: set.ui,
      cleanup: set.cleanup,
    },
  );
  const sourceReceipt = await writeEnvelope(
    root,
    'detox-connection-runtime-source.private.json',
    input,
    'private-detox-connection-source-runtime-receipt',
    {
      ...set.source,
      producerReportName: producerReport.name,
      producerReportSha256: producerReport.sha256,
    },
  );
  const buildReceipt = await writeEnvelope(
    root,
    'detox-connection-runtime-build.private.json',
    input,
    'private-detox-connection-build-runtime-receipt',
    {
      ...set.build,
      producerReportName: producerReport.name,
      producerReportSha256: producerReport.sha256,
    },
  );
  const targetReceipt = await writeEnvelope(
    root,
    'detox-connection-runtime-target.private.json',
    input,
    'private-detox-connection-target-runtime-receipt',
    {
      ...set.target,
      producerReportName: producerReport.name,
      producerReportSha256: producerReport.sha256,
    },
  );
  const resetReceipt = await writeEnvelope(
    root,
    'detox-connection-runtime-reset.private.json',
    input,
    'private-detox-connection-reset-runtime-receipt',
    {
      ...set.reset,
      producerReportName: producerReport.name,
      producerReportSha256: producerReport.sha256,
    },
  );
  const transportReceipt = await writeEnvelope(
    root,
    'detox-connection-runtime-transport.private.json',
    input,
    'private-detox-connection-transport-runtime-receipt',
    {
      sourceName: set.transport.sourceName,
      windows: set.transport.windows,
      producerReportName: producerReport.name,
      producerReportSha256: producerReport.sha256,
    },
  );
  const apiReceipt = await writeEnvelope(
    root,
    'detox-connection-runtime-api.private.json',
    input,
    'private-detox-connection-api-runtime-receipt',
    {
      ...set.api,
      producerReportName: producerReport.name,
      producerReportSha256: producerReport.sha256,
    },
  );
  const sqlReceipt = await writeEnvelope(
    root,
    'detox-connection-runtime-sql.private.json',
    input,
    'private-detox-connection-sql-runtime-receipt',
    {
      snapshotNames: set.sql.snapshots.map((row) => row.name),
      isolationUnchanged: true,
      trainingPlansUnchanged: true,
      producerReportName: producerReport.name,
      producerReportSha256: producerReport.sha256,
    },
  );
  const uiReceipt = await writeEnvelope(
    root,
    'detox-connection-runtime-ui.private.json',
    input,
    'private-detox-connection-ui-runtime-receipt',
    {
      assertionIds: set.ui.assertions.map((row) => row.id),
      observationLabels: set.ui.assertions.flatMap((row) => row.observationLabels),
      producerReportName: producerReport.name,
      producerReportSha256: producerReport.sha256,
    },
  );
  const cleanupReceipt = await writeEnvelope(
    root,
    'detox-connection-runtime-cleanup.private.json',
    input,
    'private-detox-connection-cleanup',
    {
      status: set.cleanup.status,
      recoveryStatus: set.cleanup.recoveryStatus,
      failures: [],
      survivors: [],
      unknownProcesses: [],
      originalName: set.cleanup.name,
      originalBytes: originals.cleanup.bytes.byteLength,
      originalSha256: hashBytes(originals.cleanup.bytes),
      originalMetadata: originals.cleanup.metadata,
    },
  );
  // The reads above are intentionally retained in this function. Their
  // identities are the producer proof; the verifier will reread them again.
  const transportSourceRows = JSON.parse(
    originals.transportSource.bytes.toString('utf8'),
  ) as unknown;
  assert(Array.isArray(transportSourceRows));
  const requestIds = set.api.requestIds;
  assert.equal(new Set(requestIds).size, requestIds.length);
  const snapshots: DetoxRuntimeSqlSnapshot[] = set.sql.snapshots.map((row, index) => ({
    label: row.label,
    receipt: protectedReceipt(row.name, originals.snapshots[index].read),
  }));
  const assertions: DetoxRuntimeUiAssertion[] = set.ui.assertions.map((row) => ({
    id: row.id,
    actor: row.actor,
    observationLabels: [...row.observationLabels],
    evidence: row.evidenceNames.map((name) => {
      const found = originals.uiEvidence.find((candidate) =>
        candidate.realpath.endsWith(`/${name}`),
      );
      assert(found, `UI evidence was not reread: ${name}`);
      return protectedReceipt(name, found);
    }),
  }));
  return {
    kind: 'private-detox-ios-connection-runtime-facts',
    requestedRunId: id.requestedRunId,
    requestedAttemptId: id.requestedAttemptId,
    captureRunId: id.captureRunId,
    captureResult: 'observed',
    captureExitCode: 0,
    childExitCode: 0,
    childSignal: null,
    childClassification: 'completed',
    captureCleanup: 'cleaned',
    externalCleanupResult: 'passed',
    verificationResult: 'passed',
    callbackInvocations: 1,
    callbackCompleted: true,
    captureTimeout: null,
    cancellation: null,
    postCaptureFailure: null,
    censusFailures: [],
    outputFailures: [],
    timingsMs: requireTiming(input),
    source: {
      receipt: sourceReceipt,
      sourceTreeHash: set.source.sourceTreeHash,
      helperInputsHash: set.source.helperInputsHash,
      detoxConfigHash: set.source.detoxConfigHash,
      dispatchRuntimeInputsHash: set.source.dispatchRuntimeInputsHash,
    },
    build: {
      receipt: buildReceipt,
      configuration: set.build.configuration,
      sourceTreeHash: set.build.sourceTreeHash,
      helperInputsHash: set.build.helperInputsHash,
      binaryHash: set.build.binaryHash,
      detoxConfigHash: set.build.detoxConfigHash,
      environmentHash: set.build.environmentHash,
      toolVersions: set.build.toolVersions,
      toolVersionEvidence: set.build.toolVersionEvidence,
    },
    target: {
      receipt: targetReceipt,
      platform: 'ios',
      deviceId: set.target.deviceId,
      osVersion: set.target.osVersion,
      appId: set.target.appId,
      ownership: 'owned',
      apiOrigin: set.target.apiOrigin,
    },
    reset: {
      receipt: resetReceipt,
      status: 'verified',
      targetDeviceId: set.reset.targetDeviceId,
      permissionState: 'not-applicable',
      resetFingerprint: set.reset.resetFingerprint,
    },
    transport: {
      receipt: transportReceipt,
      source: protectedReceipt(set.transport.sourceName, originals.transportSource),
      windows: [...set.transport.windows],
    },
    api: {
      receipt: apiReceipt,
      apiPid: set.api.apiPid,
      targetOrigin: set.api.targetOrigin,
      requestIds: [...requestIds],
    },
    sql: {
      receipt: sqlReceipt,
      snapshots,
      isolationUnchanged: true,
      trainingPlansUnchanged: true,
    },
    ui: { receipt: uiReceipt, assertions },
    cleanup: {
      receipt: cleanupReceipt,
      status: 'cleaned',
      recoveryStatus: 'verified',
      failures: [],
      survivors: [],
      unknownProcesses: [],
    },
  };
}
