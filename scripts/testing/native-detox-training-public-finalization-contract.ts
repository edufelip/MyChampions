import assert from 'node:assert/strict';
import {
  requireDetoxRuntimeBuildMetadata,
  type DetoxRuntimeBuildMetadata,
} from './detox-runtime-build-metadata';
import { requireNativePilotAssertions, type NativePilotSelection } from './native-pilot-contract';
import type { DetoxConnectionEvidenceStat } from './detox-connection-evidence';
import type {
  DetoxTrainingOriginalReceipt,
  DetoxTrainingProducerEvidence,
} from './native-detox-training-public-types';

const digest = /^[a-f0-9]{64}$/;
const runId = /^[a-f0-9]{24}$/;
const placeholderVersion =
  /^(?:unknown|unavailable|owned-driver-contract|source-only|placeholder)$/i;
const DETOX_TRAINING_ASSERTION_IDS = Object.freeze([
  'NAT-training-normal-entry',
  'NAT-training-local-draft',
  'NAT-training-first-save',
  'NAT-training-edit-draft',
  'NAT-training-edited-save',
  'NAT-training-relaunch-read',
  'NAT-training-unrelated-state',
] as const);
const DETOX_TRAINING_STEP_ASSERTION_IDS = DETOX_TRAINING_ASSERTION_IDS.filter(
  (id) => id !== 'NAT-training-unrelated-state',
);

export type DetoxTrainingPublicAssertionBinding = Readonly<{
  id: string;
  requirementRefs: readonly string[];
  evidencePaths: readonly string[];
}>;

export type DetoxTrainingPublicFinalizationCandidate = Readonly<{
  kind: 'private-ios-detox-training-public-finalization-candidate';
  status: 'eligible';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  fixtureRunId: string;
  backendAttemptId: string;
  assertionBindings: readonly DetoxTrainingPublicAssertionBinding[];
  nativePassingCases: 7;
  publicPassingCases: 7;
  publicPromotionEligible: true;
  toolVersions: Readonly<Record<string, string>>;
  runtimeMetadata: DetoxRuntimeBuildMetadata;
  originalReceipts: Readonly<{
    build: DetoxTrainingOriginalReceipt;
    command: DetoxTrainingOriginalReceipt;
  }>;
  sourceIdentity: Readonly<{
    sourceTreeHash: string;
    helperInputsHash: string;
    binaryHash: string;
    detoxConfigHash: string;
  }>;
  targetIdentity: Record<string, unknown>;
  buildIdentity: Record<string, unknown>;
  childIdentity: Record<string, unknown>;
  cleanupSha256: string;
  stepReceipts: readonly {
    assertionId: string;
    fileName: string;
    sha256: string;
  }[];
  sourceReceipts: Readonly<
    Record<'api' | 'sql' | 'transport', { fileName: string; sha256: string }>
  >;
  unrelatedState: { fileName: string; sha256: string };
  scenarioHash: string;
  requirementHash: string;
}>;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is malformed`);
  return value as JsonRecord;
}

function stringValue(value: unknown, label: string): string {
  assert(
    typeof value === 'string' && value.length > 0 && value.trim() === value,
    `${label} is invalid`,
  );
  return value;
}

function hashValue(value: unknown, label: string): string {
  const candidate = stringValue(value, label);
  assert.match(candidate, digest, `${label} is not a SHA-256`);
  return candidate;
}

function runValue(value: unknown, label: string): string {
  const candidate = stringValue(value, label);
  assert.match(candidate, runId, `${label} is not a run ID`);
  return candidate;
}

function childIdentity(value: unknown, label: string): JsonRecord {
  const row = record(value, label);
  assert(Number.isSafeInteger(row.pid) && Number(row.pid) > 1, `${label}.pid is invalid`);
  assert(Number.isSafeInteger(row.pgid) && Number(row.pgid) > 1, `${label}.pgid is invalid`);
  stringValue(row.started, `${label}.started`);
  return row;
}

function actualRuntimeMetadata(value: unknown): DetoxRuntimeBuildMetadata {
  requireDetoxRuntimeBuildMetadata(value, 'Detox training runtime metadata');
  const metadata: DetoxRuntimeBuildMetadata = value;
  // The shared validator rejects placeholders and requires the descriptor
  // evidence. Keep this second check explicit at the public boundary so a
  // future broadening of that helper cannot turn fixture text into a pass.
  assert.match(metadata.toolVersions.node, /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  assert.match(metadata.toolVersions.detox, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  assert(!placeholderVersion.test(metadata.toolVersions.node));
  assert(!placeholderVersion.test(metadata.toolVersions.detox));
  return structuredClone(metadata);
}

function originalReceipt(value: unknown, label: string): DetoxTrainingOriginalReceipt {
  const row = record(value, label);
  const fileName = stringValue(row.fileName, `${label}.fileName`);
  assert.match(fileName, /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.private\.json$/);
  const realpath = stringValue(row.realpath, `${label}.realpath`);
  assert(realpath.startsWith('/'), `${label}.realpath must be absolute`);
  const metadata = record(row.metadata, `${label}.metadata`) as DetoxConnectionEvidenceStat;
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
    assert(
      typeof metadata[key] === 'number' && Number.isFinite(metadata[key]),
      `${label}.metadata.${key} is invalid`,
    );
  assert.equal(metadata.nlink, 1, `${label}.metadata.nlink is invalid`);
  assert.equal(metadata.mode & 0o777, 0o600, `${label}.metadata.mode is invalid`);
  const receiptValue = record(row.value, `${label}.value`);
  return {
    fileName,
    sha256: hashValue(row.sha256, `${label}.sha256`),
    realpath,
    metadata,
    value: structuredClone(receiptValue),
  };
}

function sourceIdentity(
  build: JsonRecord,
): DetoxTrainingPublicFinalizationCandidate['sourceIdentity'] {
  const source = record(build.source, 'Detox training build source');
  return {
    sourceTreeHash: hashValue(source.sourceTreeHash, 'Detox training source tree'),
    helperInputsHash: hashValue(build.helperInputsHash, 'Detox training helper inputs'),
    binaryHash: hashValue(build.binaryHash, 'Detox training binary'),
    detoxConfigHash: hashValue(build.detoxConfigHash, 'Detox training Detox config'),
  };
}

function exactBindings(
  selection: NativePilotSelection,
  bindings: readonly DetoxTrainingPublicAssertionBinding[],
  attemptId: string,
): readonly DetoxTrainingPublicAssertionBinding[] {
  const ledger = requireNativePilotAssertions(selection);
  assert.equal(bindings.length, ledger.length, 'Detox training assertion count is incomplete');
  assert.equal(
    new Set(bindings.map((row) => row.id)).size,
    ledger.length,
    'Detox training assertion IDs duplicate',
  );
  return ledger.map((required) => {
    const binding = bindings.find((row) => row.id === required.id);
    assert(binding, `Detox training assertion binding is missing: ${required.id}`);
    assert.deepEqual(binding.requirementRefs, required.requirementRefs);
    const expectedPaths = required.evidencePathTemplates!.map((template) =>
      template.replace('{attemptId}', attemptId),
    );
    assert(
      binding.evidencePaths.length === expectedPaths.length,
      `${required.id} evidence paths are incomplete`,
    );
    assert.deepEqual(
      binding.evidencePaths,
      expectedPaths,
      `${required.id} evidence paths do not match the declared attempt binding`,
    );
    for (const evidencePath of binding.evidencePaths) {
      assert(
        typeof evidencePath === 'string' && evidencePath.length > 0,
        `${required.id} evidence path is empty`,
      );
      assert(
        !evidencePath.startsWith('/') && !evidencePath.split('/').includes('..'),
        `${required.id} evidence path escapes root`,
      );
    }
    return {
      id: binding.id,
      requirementRefs: [...binding.requirementRefs],
      evidencePaths: [...expectedPaths],
    };
  });
}

function runtimeIsPubliclyComplete(
  runtime: JsonRecord,
  evidence: DetoxTrainingProducerEvidence,
): void {
  runValue(runtime.captureRunId, 'Detox training capture run');
  assert.equal(runtime.fixtureRunId, evidence.runId);
  assert.equal(runtime.captureExitCode, 0);
  assert.equal(runtime.childExitCode, 0);
  assert.equal(runtime.childSignal, null);
  assert.equal(runtime.captureResult, 'observed');
  assert.equal(runtime.captureCleanup, 'cleaned');
  assert.equal(runtime.captureTimeout, null);
  assert.equal(runtime.cancellation, null);
  assert.equal(runtime.deadline, null);
  assert.equal(runtime.externalCleanupResult, 'passed');
  assert.equal(runtime.captureCompleted, true);
  assert.equal(runtime.callbackInvocations, 1);
  assert.equal(runtime.callbackCompleted, true);
  assert.equal(runtime.verificationResult, 'passed');
  assert.equal(runtime.postCaptureFailure, null);
  assert.deepEqual(runtime.censusFailures, []);
  assert.deepEqual(runtime.outputFailures, []);
  assert.equal(runtime.applicationFailure, null);
  assert.equal(runtime.applicationFailureCandidate, null);
}

function exactEvidence(evidence: DetoxTrainingProducerEvidence): void {
  assert.deepEqual(evidence.assertionIds, DETOX_TRAINING_ASSERTION_IDS);
  assert(evidence.stepReceipts.length >= DETOX_TRAINING_STEP_ASSERTION_IDS.length);
  assert.deepEqual(
    [...new Set(evidence.stepReceipts.map((row) => row.assertionId))],
    DETOX_TRAINING_STEP_ASSERTION_IDS,
  );
  assert.equal(evidence.sixSqlCheckpoints, true);
  assert.equal(evidence.threeAuthenticatedApiReads, true);
  assert.equal(evidence.savedPlanDurableAfterRestart, true);
  assert.equal(evidence.cleanup.status, 'cleaned');
  assert.equal(evidence.cleanup.recoveryStatus, 'verified');
  assert.deepEqual(evidence.cleanup.failures, []);
  hashValue(evidence.cleanupSha256, 'Detox training cleanup');
  for (const row of evidence.stepReceipts) {
    stringValue(row.fileName, `${row.assertionId} receipt file`);
    hashValue(row.sha256, `${row.assertionId} receipt`);
  }
  for (const [name, row] of Object.entries(evidence.sourceReceipts)) {
    stringValue(row.fileName, `Detox training ${name} source file`);
    hashValue(row.sha256, `Detox training ${name} source`);
  }
  stringValue(evidence.unrelatedState.fileName, 'Detox training unrelated-state file');
  hashValue(evidence.unrelatedState.sha256, 'Detox training unrelated-state');
}

export type DetoxTrainingPublicFinalizationInput = Readonly<{
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  runtime: JsonRecord;
  evidence: DetoxTrainingProducerEvidence;
  assertionBindings: readonly DetoxTrainingPublicAssertionBinding[];
  runtimeEvidence: Readonly<{
    metadata: unknown;
    originalReceipts: Readonly<{
      build: DetoxTrainingOriginalReceipt;
      command: DetoxTrainingOriginalReceipt;
    }>;
  }>;
}>;

/**
 * Convert a fully reread private producer result into the only object that can
 * authorize public staging. The bridge's source-only zero/false fields are
 * intentionally never changed; this candidate is created only after the
 * outer runtime facts, seven original step receipts, API/SQL/transport source
 * receipts, cleanup and observed tool versions all bind to the same run.
 */
export function buildDetoxTrainingPublicFinalization(
  input: DetoxTrainingPublicFinalizationInput,
): DetoxTrainingPublicFinalizationCandidate {
  const requestedRunId = runValue(input.requestedRunId, 'Detox training requested run');
  const requestedAttemptId = stringValue(
    input.requestedAttemptId,
    'Detox training requested attempt',
  );
  assert.equal(requestedAttemptId, `${requestedRunId}:first`);
  const evidence = input.evidence;
  runtimeIsPubliclyComplete(record(input.runtime, 'Detox training runtime'), evidence);
  exactEvidence(evidence);
  const bindings = exactBindings(input.selection, input.assertionBindings, evidence.attemptId);
  const build = record(evidence.buildIdentity, 'Detox training build identity');
  const source = sourceIdentity(build);
  const runtimeMetadata = actualRuntimeMetadata(input.runtimeEvidence.metadata);
  assert.equal(runtimeMetadata.environmentHash, build.environmentHash);
  assert.deepEqual(runtimeMetadata.toolVersions, build.toolVersions);
  assert.deepEqual(runtimeMetadata.toolVersionEvidence, build.toolVersionEvidence);
  const originalBuildReceipt = originalReceipt(
    input.runtimeEvidence.originalReceipts.build,
    'Detox training original build receipt',
  );
  const originalCommandReceipt = originalReceipt(
    input.runtimeEvidence.originalReceipts.command,
    'Detox training original command receipt',
  );
  const child = childIdentity(evidence.childIdentity, 'Detox training child identity');
  const target = record(evidence.targetIdentity, 'Detox training target identity');
  assert.equal(target.platform, 'ios');
  assert.equal(target.ownership, 'owned');
  const scenarioHash = hashValue(input.selection.scenarioHash, 'Detox training scenario hash');
  const requirementHash = hashValue(
    input.selection.requirementHash,
    'Detox training requirement hash',
  );
  return {
    kind: 'private-ios-detox-training-public-finalization-candidate',
    status: 'eligible',
    requestedRunId,
    requestedAttemptId,
    captureRunId: runValue(input.runtime.captureRunId, 'Detox training capture run'),
    fixtureRunId: evidence.runId,
    backendAttemptId: evidence.attemptId,
    assertionBindings: bindings,
    nativePassingCases: 7,
    publicPassingCases: 7,
    publicPromotionEligible: true,
    toolVersions: { ...runtimeMetadata.toolVersions },
    runtimeMetadata,
    originalReceipts: {
      build: originalBuildReceipt,
      command: originalCommandReceipt,
    },
    sourceIdentity: source,
    targetIdentity: structuredClone(target),
    buildIdentity: structuredClone(build),
    childIdentity: structuredClone(child),
    cleanupSha256: evidence.cleanupSha256,
    stepReceipts: evidence.stepReceipts.map((row) => ({ ...row })),
    sourceReceipts: structuredClone(evidence.sourceReceipts),
    unrelatedState: { ...evidence.unrelatedState },
    scenarioHash,
    requirementHash,
  };
}

export function assertDetoxTrainingPublicFinalizationCandidate(
  candidate: DetoxTrainingPublicFinalizationCandidate,
  expected: Readonly<{
    requestedRunId: string;
    requestedAttemptId: string;
    captureRunId: string;
    fixtureRunId: string;
  }>,
): void {
  assert.equal(candidate.kind, 'private-ios-detox-training-public-finalization-candidate');
  assert.equal(candidate.status, 'eligible');
  assert.equal(candidate.requestedRunId, expected.requestedRunId);
  assert.equal(candidate.requestedAttemptId, expected.requestedAttemptId);
  assert.equal(candidate.captureRunId, expected.captureRunId);
  assert.equal(candidate.fixtureRunId, expected.fixtureRunId);
  assert.equal(candidate.backendAttemptId, `${candidate.fixtureRunId}:first`);
  assert.equal(candidate.nativePassingCases, 7);
  assert.equal(candidate.publicPassingCases, 7);
  assert.equal(candidate.publicPromotionEligible, true);
  const runtimeMetadata = actualRuntimeMetadata(candidate.runtimeMetadata);
  assert.deepEqual(candidate.toolVersions, runtimeMetadata.toolVersions);
  originalReceipt(candidate.originalReceipts.build, 'Detox training finalization build receipt');
  originalReceipt(
    candidate.originalReceipts.command,
    'Detox training finalization command receipt',
  );
  sourceIdentity(candidate.buildIdentity);
  childIdentity(candidate.childIdentity, 'Detox training finalization child');
  hashValue(candidate.cleanupSha256, 'Detox training finalization cleanup');
  assert.equal(candidate.assertionBindings.length, 7);
  assert(candidate.stepReceipts.length >= DETOX_TRAINING_STEP_ASSERTION_IDS.length);
  assert.deepEqual(
    [...new Set(candidate.stepReceipts.map((row) => row.assertionId))],
    DETOX_TRAINING_STEP_ASSERTION_IDS,
  );
}
