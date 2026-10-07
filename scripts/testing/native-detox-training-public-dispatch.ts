import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  readOwnedDetoxConnectionFile,
  readOwnedDetoxConnectionEvidence,
  writeAtomicDetoxConnectionBytes,
  type DetoxConnectionEvidenceLifecycle,
} from './detox-connection-evidence';
import { runOwnedDetoxConnectionAttempt } from './detox-integrated-connection-driver';
import { requireDetoxRuntimeBuildMetadata } from './detox-runtime-build-metadata';
import {
  verifyDetoxTrainingStepReceipt,
  type VerifiedDetoxTrainingStepReceipt,
} from './detox-training-child-client';
import {
  buildDetoxTrainingStepPlan,
  requireDetoxTrainingSelection,
  type DetoxTrainingStep,
} from './detox-training-journey';
import {
  requireIosDetoxConnectionPublicSelection,
  runIosDetoxConnectionAttemptForNativePilot,
  runIosDetoxConnectionPublicAttempt,
  type DetoxConnectionPublicDispatchInput,
  type DetoxDispatchDependencies,
  type DetoxNativePilotAttemptResult,
} from './native-detox-connection-public-dispatch';
import {
  buildDetoxTrainingPublicFinalization,
  type DetoxTrainingPublicFinalizationCandidate,
} from './native-detox-training-public-finalization';
import { requireNativePilotAssertions, type NativePilotSelection } from './native-pilot-contract';
import { writeNativeTrainingAttemptBinding } from './native-training-attempt-binding';
import type { DetoxIosConnectionPublicBridgeResult } from './native-detox-connection-public-bridge';
import type {
  DetoxTrainingOriginalReceipt,
  DetoxTrainingProducerEvidence,
} from './native-detox-training-public-types';

/**
 * Private T14-B adapter candidate.  The connection owner remains the only
 * owner of the target, API session, proxy, Detox child and cleanup.  Training
 * is an additive selection passed to that owner; this module never creates a
 * second child or turns private Detox evidence into a public pass.
 */

export const IOS_DETOX_TRAINING_PUBLIC_DISPATCH = 'ios-detox-training' as const;
/**
 * Explicit non-import closure for the public training owner.  The generator
 * consumes this list because the runner is selected by the outer pilot and
 * the driver writes protected originals by path; a TypeScript import walk
 * alone would miss those runtime edges.
 */
export const detoxTrainingDispatchRuntimeClosure = [
  'docs/qa/native-pilot/inventory.json',
  'scripts/testing/native-detox-training-public-dispatch.ts',
  'scripts/testing/native-detox-training-public-finalization.ts',
  'scripts/testing/detox-training-owned-dispatch.ts',
  'scripts/testing/native-detox-training-public-finalization-contract.ts',
  'scripts/testing/native-detox-dispatch-lifecycle.ts',
  'scripts/testing/native-detox-training-public-types.ts',
  'scripts/testing/native-detox-connection-public-bridge.ts',
  'scripts/testing/native-detox-connection-public-dispatch.ts',
  'scripts/testing/detox-integrated-connection-driver.ts',
  'scripts/testing/detox-integrated-session-baseline.ts',
  'scripts/testing/detox-runtime-build-metadata.ts',
  'scripts/testing/native-training-public-evidence.ts',
  'scripts/testing/native-training-attempt-binding.ts',
  'scripts/testing/detox-training-child-client.ts',
  'scripts/testing/detox-training-child-protocol.mjs',
  'scripts/testing/detox-training-journey.ts',
  'scripts/testing/detox-connection-evidence.ts',
  'scripts/testing/native-pilot-contract.ts',
  'scripts/testing/native-build-identity.ts',
  'scripts/testing/native-build-reuse.ts',
  'scripts/testing/owned-native-command.ts',
  'scripts/testing/owned-process-group.ts',
  'scripts/testing/run-native-pilot.ts',
] as const;
export const DETOX_TRAINING_ASSERTION_IDS = Object.freeze([
  'NAT-training-normal-entry',
  'NAT-training-local-draft',
  'NAT-training-first-save',
  'NAT-training-edit-draft',
  'NAT-training-edited-save',
  'NAT-training-relaunch-read',
  'NAT-training-unrelated-state',
] as const);

const trainingStepAssertions: Readonly<
  Record<string, (typeof DETOX_TRAINING_ASSERTION_IDS)[number]>
> = Object.freeze({
  'training-normal-entry': 'NAT-training-normal-entry',
  'training-local-draft': 'NAT-training-local-draft',
  'training-first-save': 'NAT-training-first-save',
  'training-first-reopen': 'NAT-training-first-save',
  'training-edit-draft': 'NAT-training-edit-draft',
  'training-edited-save': 'NAT-training-edited-save',
  'training-edited-reopen': 'NAT-training-edited-save',
  'training-relaunch-read': 'NAT-training-relaunch-read',
});

const trainingStepIds = Object.freeze(Object.keys(trainingStepAssertions));
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

type RecordValue = Record<string, unknown>;

function record(value: unknown, label: string): RecordValue {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is malformed`);
  return value as RecordValue;
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), `${label} hash is invalid`);
}

function requireRunId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && /^[a-f0-9]{24}$/.test(value), `${label} is invalid`);
}

function requireChildIdentity(value: unknown, label: string): RecordValue {
  const row = record(value, label);
  assert(Number.isSafeInteger(row.pid) && Number(row.pid) > 1, `${label} pid is invalid`);
  assert(Number.isSafeInteger(row.pgid) && Number(row.pgid) > 1, `${label} pgid is invalid`);
  assert(typeof row.started === 'string' && row.started.length > 0, `${label} start is invalid`);
  return row;
}

function lifecycle(input: {
  signal?: AbortSignal;
  deadlineAt?: number;
}): DetoxConnectionEvidenceLifecycle {
  return {
    signal: input.signal,
    deadlineAt: input.deadlineAt,
  };
}

function requireArtifactLocalPath(value: unknown, artifactRoot: string, label: string): string {
  assert(typeof value === 'string' && path.isAbsolute(value), `${label} path is invalid`);
  const resolved = path.resolve(value);
  assert.equal(
    path.dirname(resolved),
    path.resolve(artifactRoot),
    `${label} escaped artifact root`,
  );
  return resolved;
}

async function readArtifactJson(
  artifactRoot: string,
  name: string,
  signal?: AbortSignal,
  deadlineAt?: number,
): Promise<{ value: RecordValue; bytes: Buffer; sha256: string }> {
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.private\.json$/.test(name));
  const bytes = await readOwnedDetoxConnectionFile(
    artifactRoot,
    name,
    16 * 1024 * 1024,
    lifecycle({ signal, deadlineAt }),
  );
  const value = record(JSON.parse(bytes.toString('utf8')), name);
  return { value, bytes, sha256: hash(bytes) };
}

async function readArtifactReceipt(
  artifactRoot: string,
  name: string,
  signal?: AbortSignal,
  deadlineAt?: number,
): Promise<DetoxTrainingOriginalReceipt> {
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.private\.json$/.test(name));
  const observed = await readOwnedDetoxConnectionEvidence(
    artifactRoot,
    name,
    16 * 1024 * 1024,
    lifecycle({ signal, deadlineAt }),
  );
  const value = record(JSON.parse(observed.bytes.toString('utf8')), name);
  return {
    fileName: name,
    sha256: hash(observed.bytes),
    realpath: observed.realpath,
    metadata: observed.metadata,
    value,
  };
}

async function requireBoundSource(
  artifactRoot: string,
  value: unknown,
  label: string,
  expectedProcess: RecordValue,
  signal?: AbortSignal,
  deadlineAt?: number,
): Promise<{ fileName: string; bytes: number; sha256: string }> {
  const receipt = record(value, `${label} source receipt`);
  assert(
    receipt.sourceKind === undefined || receipt.sourceKind === 'file',
    `${label} source kind changed`,
  );
  assert(typeof receipt.fileName === 'string', `${label} file name is missing`);
  const sourcePath = requireArtifactLocalPath(receipt.sourcePath, artifactRoot, `${label} source`);
  assert.equal(path.basename(sourcePath), receipt.fileName, `${label} source name changed`);
  assert.equal(
    typeof receipt.sourceRealpath === 'string' &&
      path.resolve(receipt.sourceRealpath) === sourcePath,
    true,
    `${label} source realpath changed`,
  );
  assert(Number.isSafeInteger(receipt.sourceBytes) && Number(receipt.sourceBytes) > 0);
  requireHash(receipt.sourceSha256, `${label} source`);
  const processFieldsPresent =
    receipt.processPid !== undefined &&
    receipt.processPgid !== undefined &&
    receipt.processStarted !== undefined;
  assert.equal(processFieldsPresent, true, `${label} producer identity is missing`);
  assert.equal(receipt.processPid, expectedProcess.pid, `${label} process changed`);
  assert.equal(receipt.processPgid, expectedProcess.pgid, `${label} process group changed`);
  assert.equal(receipt.processStarted, expectedProcess.started, `${label} process start changed`);
  const observed = await readOwnedDetoxConnectionEvidence(
    artifactRoot,
    receipt.fileName,
    16 * 1024 * 1024,
    lifecycle({ signal, deadlineAt }),
  );
  const source = observed.bytes;
  assert.equal(observed.metadata.nlink, 1, `${label} source hardlink changed`);
  assert.equal(observed.metadata.mode & 0o777, 0o600, `${label} source mode changed`);
  assert(
    typeof process.getuid !== 'function' || observed.metadata.uid === process.getuid(),
    `${label} source owner changed`,
  );
  assert.equal(source.byteLength, receipt.sourceBytes, `${label} source size changed`);
  assert.equal(hash(source), receipt.sourceSha256, `${label} source bytes changed`);
  assert.equal(receipt.sourceMode, 0o600, `${label} source mode changed`);
  if (receipt.producerPath !== undefined) {
    const producerPath = requireArtifactLocalPath(
      receipt.producerPath,
      artifactRoot,
      `${label} producer`,
    );
    assert(typeof receipt.producerRealpath === 'string');
    assert.equal(path.resolve(receipt.producerRealpath), producerPath);
    assert(Number.isSafeInteger(receipt.producerBytes));
    requireHash(receipt.producerSha256, `${label} producer`);
    const producer = await readOwnedDetoxConnectionFile(
      artifactRoot,
      path.basename(producerPath),
      16 * 1024 * 1024,
      lifecycle({ signal, deadlineAt }),
    );
    assert.equal(producer.byteLength, receipt.producerBytes);
    assert.equal(hash(producer), receipt.producerSha256);
    if (receipt.producerSnapshotPath !== undefined) {
      const snapshotPath = requireArtifactLocalPath(
        receipt.producerSnapshotPath,
        artifactRoot,
        `${label} producer snapshot`,
      );
      assert(typeof receipt.producerSnapshotRealpath === 'string');
      assert.equal(path.resolve(receipt.producerSnapshotRealpath), snapshotPath);
      assert(Number.isSafeInteger(receipt.producerSnapshotBytes));
      requireHash(receipt.producerSnapshotSha256, `${label} producer snapshot`);
      const snapshot = await readOwnedDetoxConnectionFile(
        artifactRoot,
        path.basename(snapshotPath),
        16 * 1024 * 1024,
        lifecycle({ signal, deadlineAt }),
      );
      assert.equal(snapshot.byteLength, receipt.producerSnapshotBytes);
      assert.equal(hash(snapshot), receipt.producerSnapshotSha256);
    }
  }
  return {
    fileName: String(receipt.fileName),
    bytes: source.byteLength,
    sha256: hash(source),
  };
}

function trainingDefinitions(input: {
  attemptId: string;
  exerciseId: string;
  exerciseName: string;
  planId: string;
}): readonly DetoxTrainingStep[] {
  return buildDetoxTrainingStepPlan({
    platform: 'ios',
    title: `QA training ${input.attemptId}`,
    exerciseId: input.exerciseId,
    exerciseName: input.exerciseName,
    planId: input.planId,
  });
}

async function requireTrainingStepReceipt(
  artifactRoot: string,
  name: string,
  platform: 'ios' | 'android',
  child: RecordValue,
  runId: string,
  attemptId: string,
  exerciseId: string,
  exerciseName: string,
  planId: string,
  signal?: AbortSignal,
  deadlineAt?: number,
): Promise<{ assertionId: string; fileName: string; sha256: string }> {
  const parsed = await readArtifactJson(artifactRoot, name, signal, deadlineAt);
  const receipt = parsed.value;
  const stepId = String(receipt.stepId);
  assert(Object.hasOwn(trainingStepAssertions, stepId), `Unexpected training step: ${stepId}`);
  const definition = trainingDefinitions({
    attemptId,
    exerciseId,
    exerciseName,
    planId,
  }).find((candidate) => candidate.id === stepId);
  assert(definition, `Training step definition is missing: ${stepId}`);
  assert.equal(receipt.kind, 'private-detox-training-step-receipt');
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.actionCompleted, true);
  assert.equal(receipt.hierarchyCaptured, true);
  assert.equal(receipt.screenshotCaptured, true);
  assert.equal(receipt.platform, platform);
  assert.equal(receipt.runId, runId);
  assert.equal(receipt.attemptId, attemptId);
  assert.deepEqual(requireChildIdentity(receipt.childIdentity, `${name} child`), child);
  assert.equal(receipt.assertionId, trainingStepAssertions[stepId]);
  assert.deepEqual(receipt.rendered, definition.expectedRendered);
  await verifyDetoxTrainingStepReceipt({
    artifactRoot,
    step: definition,
    receipt: receipt as unknown as VerifiedDetoxTrainingStepReceipt,
    expectedRunId: runId,
    expectedAttemptId: attemptId,
    expectedChild: child as unknown as {
      pid: number;
      pgid: number;
      started: string;
    },
    signal,
    deadlineAt,
  });
  return {
    assertionId: trainingStepAssertions[stepId],
    fileName: name,
    sha256: parsed.sha256,
  };
}

/**
 * Re-read the existing driver producer output.  No caller-provided summary is
 * accepted as evidence: the child receipts and API/SQL/transport source files
 * are opened from the owned artifact root and rebound to the producer child.
 */
export async function requireIosDetoxTrainingProducerEvidence(input: {
  artifactRoot: string;
  bridgeResult: DetoxIosConnectionPublicBridgeResult;
  signal?: AbortSignal;
  deadlineAt?: number;
}): Promise<DetoxTrainingProducerEvidence> {
  const artifactRoot = await realpath(input.artifactRoot);
  const attempt = input.bridgeResult.attempt;
  assert.equal(attempt.status, 'source-only');
  assert.equal(attempt.cleanup, 'cleaned');
  assert.equal(attempt.recoveryStatus, 'verified');
  assert.equal(attempt.nativePassingCases, 0);
  assert.equal(attempt.publicPromotionEligible, false);
  const report = record(attempt.report, 'Detox training producer report');
  const backend = record(report.backend, 'Detox training backend');
  const target = record(report.target, 'Detox training target');
  const build = record(report.build, 'Detox training build');
  const producer = record(report.detoxProducerReceipt, 'Detox training producer receipt');
  const child = requireChildIdentity(report.detoxChildIdentity, 'Detox training producer child');
  requireRunId(producer.captureRunId, 'Detox training capture run');
  assert.equal(producer.captureRunId, input.bridgeResult.requestedRunId);
  requireRunId(backend.runId, 'Detox training backend run');
  assert.equal(backend.apiOrigin && typeof backend.apiOrigin === 'string', true);
  assert(Number.isSafeInteger(backend.apiPid) && Number(backend.apiPid) > 1);
  const training = record(report.detoxTraining, 'Detox training dispatch report');
  assert.equal(training.kind, 'private-detox-training-owned-dispatch');
  assert.equal(training.runId, backend.runId);
  assert.equal(training.attemptId, `${backend.runId}:first`);
  assert.equal(training.platform, 'ios');
  assert.equal(report.detoxTrainingChildShutdown, true, 'Detox training child was not shut down');
  requireTrainingCommandHistory(report, child);
  assert.equal(target.platform, 'ios');
  assert(typeof target.deviceId === 'string' && target.deviceId.length > 0);
  assert.equal(target.ownership, 'owned');
  assert.equal(build.platform, 'ios');
  assert(typeof build.configuration === 'string' && build.configuration.length > 0);
  assert(typeof build.binaryPath === 'string' && build.binaryPath.length > 0);
  requireHash(build.binaryHash, 'Detox training binary');
  requireHash(build.helperInputsHash, 'Detox training helpers');
  requireHash(build.detoxConfigHash, 'Detox training Detox config');
  const runtimeMetadata = {
    environmentHash: build.environmentHash,
    toolVersions: build.toolVersions,
    toolVersionEvidence: build.toolVersionEvidence,
  };
  requireDetoxRuntimeBuildMetadata(runtimeMetadata, 'Detox training runtime metadata');
  const buildSource = record(build.source, 'Detox training build source');
  requireHash(buildSource.sourceTreeHash, 'Detox training source tree');
  assert.deepEqual(requireChildIdentity(training.childIdentity, 'Detox training child'), child);
  assert.equal(training.nativePassingCases, 0);
  assert.equal(training.publicPromotionEligible, false);
  const trainingInput = record(training.input, 'Detox training input');
  assert.equal(trainingInput.runId, backend.runId);
  assert.equal(trainingInput.attemptId, `${backend.runId}:first`);
  assert.equal(trainingInput.platform, 'ios');
  assert(typeof trainingInput.accountUid === 'string' && trainingInput.accountUid.length > 0);
  assert.match(String(trainingInput.exerciseId), /^[0-9a-f-]{36}$/);
  assert(typeof trainingInput.exerciseName === 'string' && trainingInput.exerciseName.length > 0);
  assert(typeof training.planId === 'string' && training.planId.length > 0);
  assert.equal(training.sixSqlCheckpoints, true);
  assert.equal(training.threeAuthenticatedApiReads, true);
  assert.equal(training.savedPlanDurableAfterRestart, true);
  const cleanupDocument = await readArtifactJson(
    artifactRoot,
    'detox-connection-cleanup.private.json',
    input.signal,
    input.deadlineAt,
  );
  const cleanup = cleanupDocument.value;
  assert.equal(cleanup.kind, 'private-detox-connection-cleanup');
  assert.equal(cleanup.captureRunId, input.bridgeResult.requestedRunId);
  assert.equal(cleanup.backendRunId, backend.runId);
  assert.equal(cleanup.status, 'cleaned');
  assert.equal(cleanup.recoveryStatus, 'verified');
  assert.deepEqual(cleanup.failures, []);
  const cleanupChild = record(cleanup.child, 'Detox cleanup child');
  assert.equal(cleanupChild.pid, child.pid);
  assert.deepEqual(cleanupChild.outcome, { code: 0, signal: null });
  assert.equal(cleanupChild.censusFailure, null);
  assert.equal(cleanupChild.outputFailure, null);
  const buildOriginal = await readArtifactReceipt(
    artifactRoot,
    'detox-build-original.private.json',
    input.signal,
    input.deadlineAt,
  );
  const commandOriginal = await readArtifactReceipt(
    artifactRoot,
    'detox-command-original.private.json',
    input.signal,
    input.deadlineAt,
  );
  const expectedAttemptId = `${input.bridgeResult.requestedRunId}:first`;
  const rawConnectionCommands = report.detoxConnectionCommands;
  assert(
    Array.isArray(rawConnectionCommands) && rawConnectionCommands.length > 0,
    'Detox connection command ledger is missing',
  );
  const connectionCommands = rawConnectionCommands.map((value, index) => {
    const row = record(value, `Detox connection command ${index}`);
    assert(Number.isSafeInteger(row.commandId), 'Detox connection command ID is invalid');
    requireHash(row.commandHash, 'Detox connection command hash');
    return row;
  });
  const commandIds = connectionCommands.map((row) => {
    assert(Number.isSafeInteger(row.commandId), 'Detox connection command ID is invalid');
    return Number(row.commandId);
  });
  const commandHashes = connectionCommands.map((row) => {
    requireHash(row.commandHash, 'Detox connection command hash');
    return row.commandHash;
  });
  const requireOriginalHeader = (value: RecordValue, label: string) => {
    assert.equal(value.owner, 'detox-driver', `${label} owner is not bound`);
    assert.equal(value.requestedRunId, input.bridgeResult.requestedRunId);
    assert.equal(value.requestedAttemptId, expectedAttemptId);
    assert.equal(value.captureRunId, producer.captureRunId);
    assert.deepEqual(value.childIdentity, child, `${label} child identity changed`);
    assert.deepEqual(value.commandIds, commandIds, `${label} command IDs changed`);
    assert.deepEqual(value.commandHashes, commandHashes, `${label} command hashes changed`);
  };
  requireOriginalHeader(buildOriginal.value, 'Detox original build');
  assert.equal(buildOriginal.value.kind, 'private-detox-qualified-build-original');
  assert.equal(buildOriginal.value.configuration, build.configuration);
  assert.equal(buildOriginal.value.sourceTreeHash, buildSource.sourceTreeHash);
  assert.equal(buildOriginal.value.helperInputsHash, build.helperInputsHash);
  assert.equal(buildOriginal.value.binaryHash, build.binaryHash);
  assert.equal(buildOriginal.value.detoxConfigHash, build.detoxConfigHash);
  assert.equal(buildOriginal.value.environmentHash, runtimeMetadata.environmentHash);
  assert.deepEqual(buildOriginal.value.toolVersions, runtimeMetadata.toolVersions);
  assert.deepEqual(buildOriginal.value.toolVersionEvidence, runtimeMetadata.toolVersionEvidence);
  requireHash(build.dispatchRuntimeInputsHash, 'Detox dispatch runtime inputs');
  assert.equal(buildOriginal.value.dispatchRuntimeInputsHash, build.dispatchRuntimeInputsHash);
  requireOriginalHeader(commandOriginal.value, 'Detox original command');
  assert.equal(commandOriginal.value.kind, 'private-detox-command-original');
  assert.deepEqual(commandOriginal.value.commands, connectionCommands);
  assert(Number.isSafeInteger(training.snapshotCount) && Number(training.snapshotCount) >= 6);
  assert.equal(training.apiReadCount, 3);
  assert(Number.isSafeInteger(training.proxyObservationCount));
  assert(Number(training.proxyObservationCount) > 0);

  const rawSources = record(training.sourceReceipts, 'Detox training source receipts');
  assert.deepEqual(Object.keys(rawSources).sort(), ['api', 'sql', 'transport']);
  const sourceReceipts = {} as Record<
    'api' | 'sql' | 'transport',
    { fileName: string; sha256: string }
  >;
  const sourceKinds = {
    api: 'private-detox-training-api-source',
    sql: 'private-detox-training-sql-source',
    transport: 'private-detox-training-proxy-source',
  } as const;
  for (const key of ['api', 'sql', 'transport'] as const) {
    const value = await requireBoundSource(
      artifactRoot,
      rawSources[key],
      `Detox training ${key}`,
      child,
      input.signal,
      input.deadlineAt,
    );
    const sourceDocument = await readArtifactJson(
      artifactRoot,
      value.fileName,
      input.signal,
      input.deadlineAt,
    );
    assert.equal(sourceDocument.value.kind, sourceKinds[key]);
    assert.equal(sourceDocument.value.runId, backend.runId);
    assert.equal(sourceDocument.value.attemptId, `${backend.runId}:first`);
    sourceReceipts[key] = value;
  }

  const stepReceipts = [] as {
    assertionId: string;
    fileName: string;
    sha256: string;
  }[];
  for (const stepId of trainingStepIds) {
    stepReceipts.push(
      await requireTrainingStepReceipt(
        artifactRoot,
        `detox-training-${stepId}.private.json`,
        'ios',
        child,
        String(backend.runId),
        `${backend.runId}:first`,
        String(trainingInput.exerciseId),
        String(trainingInput.exerciseName),
        String(training.planId),
        input.signal,
        input.deadlineAt,
      ),
    );
  }
  const unrelated = await readArtifactJson(
    artifactRoot,
    'detox-training-unrelated-state.private.json',
    input.signal,
    input.deadlineAt,
  );
  assert.equal(unrelated.value.kind, 'private-detox-training-unrelated-state-proof');
  assert.equal(unrelated.value.assertionId, 'NAT-training-unrelated-state');
  assert.equal(unrelated.value.runId, backend.runId);
  assert.equal(unrelated.value.attemptId, `${backend.runId}:first`);
  assert.equal(unrelated.value.unchanged, true);
  assert.equal(unrelated.value.sqlSourceFile, sourceReceipts.sql.fileName);

  return {
    kind: 'private-detox-training-producer-evidence-not-public-receipt',
    runId: String(backend.runId),
    attemptId: `${backend.runId}:first`,
    platform: 'ios',
    childIdentity: child,
    backendIdentity: backend,
    targetIdentity: target,
    buildIdentity: build,
    runtimeMetadata,
    originalReceipts: {
      build: buildOriginal,
      command: commandOriginal,
    },
    input: {
      runId: String(trainingInput.runId),
      attemptId: String(trainingInput.attemptId),
      platform: 'ios',
      accountUid: String(trainingInput.accountUid),
      exerciseId: String(trainingInput.exerciseId),
      exerciseName: String(trainingInput.exerciseName),
    },
    planId: String(training.planId),
    sixSqlCheckpoints: true,
    threeAuthenticatedApiReads: true,
    savedPlanDurableAfterRestart: true,
    cleanup,
    cleanupSha256: cleanupDocument.sha256,
    assertionIds: [...DETOX_TRAINING_ASSERTION_IDS],
    stepReceipts,
    unrelatedState: {
      fileName: 'detox-training-unrelated-state.private.json',
      sha256: unrelated.sha256,
    },
    sourceReceipts,
    snapshotCount: Number(training.snapshotCount),
    apiReadCount: Number(training.apiReadCount),
    proxyObservationCount: Number(training.proxyObservationCount),
    publicPromotionEligible: false,
  };
}

type TrainingStageArtifact = Readonly<{ path: string; sha256: string }>;

async function requirePrivateDirectory(root: string, relative: string): Promise<string> {
  assert(relative && !path.isAbsolute(relative) && !relative.includes('..'));
  let current = await realpath(root);
  for (const segment of relative.split('/').filter(Boolean)) {
    const next = path.join(current, segment);
    await mkdir(next, { recursive: true, mode: 0o700 });
    const stat = await lstat(next);
    assert(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(stat.uid, process.getuid?.());
    assert.equal(stat.mode & 0o777, 0o700);
    assert.equal(await realpath(next), next);
    current = next;
  }
  return current;
}

async function prepareTrainingCaptureRoot(input: {
  outputRoot: string;
  requestedRunId: string;
  signal: AbortSignal;
  deadlineAt: number;
}): Promise<string> {
  input.signal.throwIfAborted();
  assert(
    performance.now() < input.deadlineAt,
    'Detox training deadline elapsed before capture root',
  );
  requireRunId(input.requestedRunId, 'Detox training requested run');
  const outputRoot = await realpath(input.outputRoot);
  const captureParent = await requirePrivateDirectory(
    path.dirname(outputRoot),
    'detox-training-captures',
  );
  const captureRoot = path.join(captureParent, input.requestedRunId);
  try {
    const existing = await lstat(captureRoot);
    throw new Error(
      `Detox training capture root already exists (${existing.isDirectory() ? 'directory' : 'entry'})`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  input.signal.throwIfAborted();
  assert(
    performance.now() < input.deadlineAt,
    'Detox training deadline elapsed before capture root',
  );
  return captureRoot;
}

async function writePrivateJson(
  root: string,
  name: string,
  value: unknown,
  input: { signal: AbortSignal; deadlineAt: number },
): Promise<TrainingStageArtifact> {
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.private\.json$/.test(name));
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const result = await writeAtomicDetoxConnectionBytes(
    root,
    name,
    bytes,
    16 * 1024 * 1024,
    lifecycle(input),
  );
  assert.equal(result.bytes.byteLength, bytes.byteLength);
  assert.equal(hash(result.bytes), hash(bytes));
  const readback = await readOwnedDetoxConnectionEvidence(
    root,
    name,
    16 * 1024 * 1024,
    lifecycle(input),
  );
  assert.deepEqual(readback.bytes, bytes, `${name} changed after publication`);
  assert.equal(readback.metadata.nlink, 1);
  assert.equal(readback.metadata.mode & 0o777, 0o600);
  return { path: name, sha256: hash(bytes) };
}

async function writeNestedPrivateJson(
  root: string,
  relative: string,
  value: unknown,
  input: { signal: AbortSignal; deadlineAt: number },
): Promise<TrainingStageArtifact> {
  const parentRelative = path.posix.dirname(relative);
  const name = path.posix.basename(relative);
  const parent = await requirePrivateDirectory(root, parentRelative);
  return writePrivateJson(parent, name, value, input).then((artifact) => ({
    path: relative,
    sha256: artifact.sha256,
  }));
}

function sourceReference(fileName: string, sha256: string): { path: string; sha256: string } {
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.private\.json$/.test(fileName));
  requireHash(sha256, `${fileName} reference`);
  return { path: fileName, sha256 };
}

function commandDiagnostics(
  report: RecordValue,
  expectedChild?: RecordValue,
): readonly RecordValue[] {
  const commands = report.commandExecutions;
  assert(
    Array.isArray(commands) && commands.length > 0,
    'Detox training command diagnostics are missing',
  );
  return (commands as unknown[]).map((value, index) => {
    const row = record(value, `Detox training command ${index}`);
    assert.equal(row.execution, 'completed');
    if (row.cleanup !== undefined) assert.equal(row.cleanup, 'cleaned');
    assert.equal(row.childExitCode, 0);
    assert.equal(row.childSignal, null);
    assert.equal(row.censusFailure, null);
    assert.equal(row.outputFailure, null);
    if (row.label !== undefined) assert(typeof row.label === 'string' && row.label.length > 0);
    else assert(typeof row.command === 'string' && row.command.length > 0);
    assert(row.phase === 'step' || row.phase === 'build');
    if (row.deadlineMs !== undefined)
      assert(
        typeof row.deadlineMs === 'number' && Number.isFinite(row.deadlineMs) && row.deadlineMs > 0,
      );
    if (row.phase === 'step' && expectedChild) {
      assert.equal(row.pid, expectedChild.pid);
      assert.equal(row.pgid, expectedChild.pgid);
    }
    return row;
  });
}

function requireTrainingCommandHistory(
  report: RecordValue,
  expectedChild: RecordValue,
): readonly RecordValue[] {
  const commands = commandDiagnostics(report, expectedChild);
  assert(
    commands.some((row) => row.phase === 'step'),
    'Detox training command history has no owned step command',
  );
  assert(
    commands.every(
      (row) =>
        row.childExitCode === 0 &&
        row.childSignal === null &&
        row.execution === 'completed' &&
        (row.cleanup === undefined || row.cleanup === 'cleaned'),
    ),
    'Detox training command history is not a completed owned producer history',
  );
  return commands;
}

export async function writeIosDetoxTrainingStageArtifacts(input: {
  repositoryRoot: string;
  artifactRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  evidence: DetoxTrainingProducerEvidence;
  report: RecordValue;
  build: RecordValue;
  signal: AbortSignal;
  deadlineAt: number;
}): Promise<{
  artifacts: readonly TrainingStageArtifact[];
  bindings: {
    id: string;
    requirementRefs: string[];
    evidencePaths: string[];
  }[];
}> {
  const lifecycleInput = { signal: input.signal, deadlineAt: input.deadlineAt };
  const binding = await writeNativeTrainingAttemptBinding({
    repositoryRoot: input.repositoryRoot,
    artifactRoot: input.artifactRoot,
    requestedRunId: input.requestedRunId,
    backendRunId: input.evidence.runId,
    selection: input.selection,
  });
  const ledger = requireNativePilotAssertions(input.selection);
  const stepByAssertion = new Map(input.evidence.stepReceipts.map((row) => [row.assertionId, row]));
  const sourceFiles = {
    api: input.evidence.sourceReceipts.api,
    sql: input.evidence.sourceReceipts.sql,
    transport: input.evidence.sourceReceipts.transport,
  };
  const bindings = [] as {
    id: string;
    requirementRefs: string[];
    evidencePaths: string[];
  }[];
  const artifacts: TrainingStageArtifact[] = [
    {
      path: 'training-attempt-binding.private.json',
      sha256: hash(Buffer.from(JSON.stringify(binding))),
    },
  ];
  for (const row of ledger) {
    const evidencePaths = row.evidencePathTemplates!.map((template) =>
      template.replace('{attemptId}', input.evidence.attemptId),
    );
    bindings.push({
      id: row.id,
      requirementRefs: [...row.requirementRefs],
      evidencePaths,
    });
    for (const [index, evidenceKind] of row.evidenceKinds.entries()) {
      const source =
        evidenceKind === 'api'
          ? sourceFiles.api
          : evidenceKind === 'sql'
            ? sourceFiles.sql
            : (stepByAssertion.get(row.id) ?? input.evidence.stepReceipts[0]);
      assert(source, `Detox training source is missing for ${row.id}`);
      const proof = {
        schemaVersion: 1,
        kind: 'native-training-assertion-evidence-preparation',
        purpose: 'runtime',
        assertionId: row.id,
        evidenceKind,
        requirementRefs: [...row.requirementRefs],
        fixtureRunId: input.evidence.runId,
        attemptId: input.evidence.attemptId,
        scenarioHash: input.selection.scenarioHash,
        requirementHash: input.selection.requirementHash,
        nativePassingCases: 0,
        references: [sourceReference(source.fileName, source.sha256)],
      };
      artifacts.push(
        await writeNestedPrivateJson(
          input.artifactRoot,
          evidencePaths[index],
          proof,
          lifecycleInput,
        ),
      );
    }
  }
  const commands = commandDiagnostics(input.report, input.evidence.childIdentity);
  const cleanup = input.evidence.cleanup;
  const capture = {
    kind: 'private-owned-native-training-execution-not-public-receipt',
    mode: 'integration',
    platform: 'ios',
    charter: 'SCN-training-ios',
    result: 'observed',
    cleanup: 'cleaned',
    nativePassingCases: 0,
    backend: { runId: input.evidence.runId },
    source: input.evidence.buildIdentity.source ?? null,
    sourceAfter: input.evidence.buildIdentity.source ?? null,
    build: {
      binaryPath: input.build.binaryPath,
      binaryHash: input.build.binaryHash,
    },
    commandExecutions: commands,
    observations: input.evidence.stepReceipts.map((row) => ({
      viewId: row.assertionId,
      screenshotPath: row.fileName,
      hierarchyPath: row.fileName,
    })),
    trainingJourney: {
      input: input.evidence.input,
      requestedAttemptId: input.requestedAttemptId,
      selection: binding.selection,
    },
  };
  const runtimeMetadata = {
    input: input.evidence.input,
    planId: input.evidence.planId,
    scope: 'native-entry-ios',
    sixSqlCheckpoints: true,
    threeAuthenticatedApiReads: true,
    savedPlanDurableAfterRestart: true,
    publicNativePassingCases: 0,
    requestedAttemptId: input.requestedAttemptId,
    selection: binding.selection,
  };
  const adapter = {
    kind: 'private-owned-ios-training-attempt-not-public-receipt',
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRunId: path.basename(input.artifactRoot),
    captureExitCode: 0,
    captureCleanup: 'cleaned',
    childExitCode: 0,
    callbackInvocations: 1,
    callbackCompleted: true,
    externalCleanupResult: 'passed',
    verificationResult: 'passed',
    assertionBindings: bindings,
    commandDiagnostics: commands,
    censusFailures: [],
    outputFailures: [],
    nativePassingCases: 0,
    publicPromotionEligible: false,
    sourceProducer: {
      kind: input.evidence.kind,
      sourceReceipts: input.evidence.sourceReceipts,
      cleanupPath: 'detox-connection-cleanup.private.json',
    },
  };
  const cleanupProjection = {
    kind: 'private-owned-ios-training-cleanup-projection-not-public-receipt',
    runId: path.basename(input.artifactRoot),
    result: 'passed',
    sourcePath: 'detox-connection-cleanup.private.json',
    sourceSha256: input.evidence.cleanupSha256,
    producerCleanup: cleanup,
    nativePassingCases: 0,
  };
  const frames = {
    kind: 'private-owned-ios-detox-training-runtime-frames-not-public-receipt',
    runId: input.evidence.runId,
    attemptId: input.evidence.attemptId,
    steps: input.evidence.stepReceipts,
    sourceReceipts: input.evidence.sourceReceipts,
    nativePassingCases: 0,
  };
  artifacts.push(
    await writePrivateJson(
      input.artifactRoot,
      'runtime-adapter.private.json',
      adapter,
      lifecycleInput,
    ),
  );
  artifacts.push(
    await writePrivateJson(input.artifactRoot, 'capture.private.json', capture, lifecycleInput),
  );
  artifacts.push(
    await writePrivateJson(
      input.artifactRoot,
      'external-cleanup.private.json',
      cleanupProjection,
      lifecycleInput,
    ),
  );
  artifacts.push(
    await writePrivateJson(
      input.artifactRoot,
      'training-runtime-metadata.private.json',
      runtimeMetadata,
      lifecycleInput,
    ),
  );
  artifacts.push(
    await writePrivateJson(
      input.artifactRoot,
      'training-journey-runtime-frames.private.json',
      frames,
      lifecycleInput,
    ),
  );
  return { artifacts, bindings };
}

export function requireIosDetoxTrainingPublicSelection(
  selection: NativePilotSelection,
): NativePilotSelection {
  requireDetoxTrainingSelection(selection);
  assert.deepEqual(selection.arguments, {
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-training-ios',
    mode: 'integration',
  });
  return selection;
}

export function requireIosDetoxTrainingOwnerSelection(
  training: NativePilotSelection,
  owner: NativePilotSelection,
): NativePilotSelection {
  requireIosDetoxTrainingPublicSelection(training);
  requireIosDetoxConnectionPublicSelection(owner);
  assert.equal(owner.arguments.platform, training.arguments.platform);
  return owner;
}

export type DetoxTrainingDispatchDependencies = Readonly<{
  now?: DetoxDispatchDependencies['now'];
  loadBuild?: DetoxDispatchDependencies['loadBuild'];
  runBridge?: (
    input: DetoxConnectionPublicDispatchInput,
  ) => Promise<DetoxIosConnectionPublicBridgeResult>;
}>;

export type DetoxIosTrainingNativePilotAttemptResult = Omit<
  DetoxNativePilotAttemptResult,
  | 'kind'
  | 'verificationResult'
  | 'assertionBindings'
  | 'publicFinalization'
  | 'publicFinalizationInput'
> &
  Readonly<{
    kind: 'private-owned-ios-detox-training-attempt-not-public-receipt';
    trainingSelection: NativePilotSelection;
    connectionSelection: NativePilotSelection;
    trainingEvidence: DetoxTrainingProducerEvidence | null;
    assertionBindings: readonly {
      id: string;
      requirementRefs: string[];
      evidencePaths: string[];
    }[];
    deadlineAtMonotonicMs: number;
    verificationResult: 'passed' | 'failed' | 'not-executed';
    publicPromotionEligible: false;
    /** Null means the private producer was valid but public finalization lacked a required fact. */
    publicFinalization: DetoxTrainingPublicFinalizationCandidate | null;
    publicFinalizationFailure: { name: string; message: string } | null;
  }>;

/**
 * Select only a producer candidate that still satisfies the complete runtime
 * terminal envelope. A private candidate is never enough by itself: any late
 * failure, cleanup uncertainty, cancellation, deadline, or count mismatch
 * keeps the outer runner on the source-only path.
 */
export function selectVerifiedIosDetoxTrainingPublicFinalization(
  runtime: DetoxIosTrainingNativePilotAttemptResult,
): DetoxTrainingPublicFinalizationCandidate | undefined {
  if (
    runtime.verificationResult !== 'passed' ||
    runtime.publicFinalizationFailure !== null ||
    runtime.trainingEvidence === null ||
    runtime.captureExitCode !== 0 ||
    runtime.childExitCode !== 0 ||
    runtime.childSignal !== null ||
    runtime.captureResult !== 'observed' ||
    runtime.captureCleanup !== 'cleaned' ||
    runtime.captureTimeout !== null ||
    runtime.cancellation !== null ||
    runtime.deadline !== null ||
    runtime.externalCleanupResult !== 'passed' ||
    runtime.captureCompleted !== true ||
    runtime.postCaptureFailure !== null ||
    runtime.applicationFailure !== null ||
    runtime.applicationFailureCandidate !== null
  )
    return undefined;
  const candidate = runtime.publicFinalization;
  if (
    candidate === null ||
    candidate.status !== 'eligible' ||
    candidate.nativePassingCases !== 7 ||
    candidate.publicPassingCases !== 7 ||
    candidate.publicPromotionEligible !== true ||
    candidate.assertionBindings.length !== DETOX_TRAINING_ASSERTION_IDS.length
  )
    return undefined;
  return candidate;
}

function verificationFailure(error: unknown) {
  return {
    phase: 'verification' as const,
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Actual public-callable entry candidate. The default bridge delegates to
 * runOwnedDetoxConnectionAttempt and passes trainingSelection into the already
 * acquired owner. The attempt remains private until the outer terminal; a
 * fully validated candidate is carried forward, but this function never
 * publishes a public receipt by itself.
 */
export async function runIosDetoxTrainingAttemptForNativePilot(
  input: {
    repositoryRoot: string;
    serverRoot: string;
    artifactRoot: string;
    requestedRunId: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    connectionSelection: NativePilotSelection;
    signal: AbortSignal;
    /** The outer native pilot owns this absolute deadline. */
    deadlineAtMonotonicMs: number;
    buildRunId: string;
    reuseBuildSourceRoot?: string;
    parentEnv?: Readonly<Record<string, string | undefined>>;
  },
  dependencies: DetoxTrainingDispatchDependencies = {},
): Promise<DetoxIosTrainingNativePilotAttemptResult> {
  requireIosDetoxTrainingOwnerSelection(input.selection, input.connectionSelection);
  assert(
    Number.isFinite(input.deadlineAtMonotonicMs) && input.deadlineAtMonotonicMs > performance.now(),
    'Detox training caller-owned deadline is invalid or elapsed',
  );
  input.signal.throwIfAborted();
  const trainingDeadlineAt = input.deadlineAtMonotonicMs;
  const attemptSignal = input.signal;
  const bridge = dependencies.runBridge;
  const captureArtifactRoot = await prepareTrainingCaptureRoot({
    outputRoot: input.artifactRoot,
    requestedRunId: input.requestedRunId,
    signal: attemptSignal,
    deadlineAt: trainingDeadlineAt,
  });
  const base = await runIosDetoxConnectionAttemptForNativePilot(
    {
      ...input,
      artifactRoot: captureArtifactRoot,
      signal: attemptSignal,
      // The bridge keeps its existing 30s–600s validation range, while the
      // absolute deadline is carried into baseline and owns every downstream budget.
      deadlineMs: Math.max(30_000, Math.ceil(trainingDeadlineAt - performance.now())),
      deadlineAtMonotonicMs: trainingDeadlineAt,
      selection: input.connectionSelection,
    },
    {
      now: dependencies.now,
      loadBuild: dependencies.loadBuild,
      runBridge: async (bridgeInput) => {
        if (bridge)
          return bridge({
            ...bridgeInput,
            signal: attemptSignal,
            deadlineAtMonotonicMs: trainingDeadlineAt,
          });
        return runIosDetoxConnectionPublicAttempt({
          ...bridgeInput,
          signal: attemptSignal,
          delegate: (options) =>
            runOwnedDetoxConnectionAttempt({
              ...options,
              signal: attemptSignal,
              deadlineAtMonotonicMs: trainingDeadlineAt,
              trainingSelection: input.selection,
            }),
        });
      },
    },
  );
  let trainingEvidence: DetoxTrainingProducerEvidence | null = null;
  let assertionBindings: readonly {
    id: string;
    requirementRefs: string[];
    evidencePaths: string[];
  }[] = [];
  let verificationResult: DetoxIosTrainingNativePilotAttemptResult['verificationResult'] =
    'not-executed';
  let publicFinalization: DetoxTrainingPublicFinalizationCandidate | null = null;
  let publicFinalizationFailure: { name: string; message: string } | null = null;
  let postCaptureFailure = base.postCaptureFailure;
  if (
    base.detoxBridgeResult.attempt.status === 'source-only' &&
    base.captureCompleted &&
    base.captureExitCode === 0 &&
    base.childExitCode === 0 &&
    base.externalCleanupResult === 'passed'
  ) {
    try {
      trainingEvidence = await requireIosDetoxTrainingProducerEvidence({
        artifactRoot: base.artifactRoot,
        bridgeResult: base.detoxBridgeResult,
        signal: attemptSignal,
        deadlineAt: trainingDeadlineAt,
      });
      const stageArtifacts = await writeIosDetoxTrainingStageArtifacts({
        repositoryRoot: input.repositoryRoot,
        artifactRoot: base.artifactRoot,
        requestedRunId: input.requestedRunId,
        requestedAttemptId: input.requestedAttemptId,
        selection: input.selection,
        evidence: trainingEvidence,
        report: record(base.detoxBridgeResult.attempt.report, 'Detox training report'),
        build: record(base.detoxBuild, 'Detox training qualified build'),
        signal: attemptSignal,
        deadlineAt: trainingDeadlineAt,
      });
      assertionBindings = stageArtifacts.bindings;
      verificationResult = 'passed';
      try {
        publicFinalization = buildDetoxTrainingPublicFinalization({
          requestedRunId: input.requestedRunId,
          requestedAttemptId: input.requestedAttemptId,
          selection: input.selection,
          runtime: base as unknown as Record<string, unknown>,
          evidence: trainingEvidence,
          assertionBindings: stageArtifacts.bindings,
          runtimeEvidence: {
            metadata: trainingEvidence.runtimeMetadata,
            originalReceipts: trainingEvidence.originalReceipts,
          },
        });
      } catch (error) {
        // Private producer verification may pass while public promotion is
        // still unavailable. Preserve the original evidence and expose a
        // bounded reason; never turn an absent observed tool version into a
        // fabricated public pass.
        publicFinalizationFailure = {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    } catch (error) {
      verificationResult = 'failed';
      postCaptureFailure ??= verificationFailure(error);
    }
  }
  return {
    ...base,
    kind: 'private-owned-ios-detox-training-attempt-not-public-receipt',
    trainingSelection: input.selection,
    connectionSelection: input.connectionSelection,
    trainingEvidence,
    assertionBindings,
    deadlineAtMonotonicMs: trainingDeadlineAt,
    verificationResult,
    postCaptureFailure,
    captureCompleted: base.captureCompleted && postCaptureFailure === null,
    nativePassingCases: 0,
    publicPromotionEligible: false,
    publicFinalization,
    publicFinalizationFailure,
  };
}

export type DetoxIosTrainingAttemptInput = Parameters<
  typeof runIosDetoxTrainingAttemptForNativePilot
>[0];

export type DetoxIosTrainingAttemptRunner = (
  input: DetoxIosTrainingAttemptInput,
  dependencies?: DetoxTrainingDispatchDependencies,
) => Promise<DetoxIosTrainingNativePilotAttemptResult>;

/**
 * The runner uses this explicit public-dispatch seam so the composition can be
 * tested without inventing a native receipt.  The default is the real owner
 * implementation above; injected runners are test-only and still return the
 * source-only/private result type.
 */
export async function runIosDetoxTrainingAttemptForPublicDispatch(
  input: DetoxIosTrainingAttemptInput,
  dependencies: DetoxTrainingDispatchDependencies = {},
  runner: DetoxIosTrainingAttemptRunner = runIosDetoxTrainingAttemptForNativePilot,
): Promise<DetoxIosTrainingNativePilotAttemptResult> {
  requireIosDetoxTrainingOwnerSelection(input.selection, input.connectionSelection);
  assert(
    Number.isFinite(input.deadlineAtMonotonicMs) && input.deadlineAtMonotonicMs > performance.now(),
    'Detox training caller-owned deadline is invalid or elapsed',
  );
  return runner(input, dependencies);
}

/**
 * Terminal boundary used by the runner candidate. It rereads the producer
 * files after the bridge has settled. The outer native pilot is the only
 * terminal publisher; this helper never writes a receipt or promotes a run.
 */
export async function verifyIosDetoxTrainingTerminal(input: {
  runtime: DetoxIosTrainingNativePilotAttemptResult;
  signal: AbortSignal;
  deadlineAt: number;
}) {
  assert.equal(input.runtime.verificationResult, 'passed');
  assert.equal(input.runtime.publicPromotionEligible, false);
  assert.equal(input.runtime.nativePassingCases, 0);
  const evidence = await requireIosDetoxTrainingProducerEvidence({
    artifactRoot: input.runtime.artifactRoot,
    bridgeResult: input.runtime.detoxBridgeResult,
    signal: input.signal,
    deadlineAt: input.deadlineAt,
  });
  return {
    kind: 'private-detox-training-source-only-terminal-link' as const,
    requestedRunId: input.runtime.requestedRunId,
    requestedAttemptId: input.runtime.requestedAttemptId,
    captureRunId: input.runtime.captureRunId,
    backendRunId: input.runtime.backendRunId,
    assertionIds: [...evidence.assertionIds],
    stepReceipts: evidence.stepReceipts,
    unrelatedState: evidence.unrelatedState,
    sourceReceipts: evidence.sourceReceipts,
    childIdentity: evidence.childIdentity,
    targetIdentity: evidence.targetIdentity,
    buildIdentity: evidence.buildIdentity,
    nativePassingCases: 0 as const,
    publicPromotionEligible: false as const,
  };
}
