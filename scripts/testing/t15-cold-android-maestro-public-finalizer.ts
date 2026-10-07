import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  finalizeAndroidCameraNativeRuntime,
  type AndroidCameraNativeRuntimePublicFinalizationResult,
} from './native-android-camera-runtime-finalizer';
import {
  stageNativeAndroidSaveRetryPublicEvidence,
  verifyStagedNativeAndroidSaveRetryEvidence,
  type AndroidSaveRetryAssertionBinding,
} from './native-android-save-retry-public-evidence';
import { loadAndroidSessionPublicDependency } from './native-android-session-public-dependency';
import {
  collectAndroidSessionProducerReceipts,
  requiredAndroidSessionBundlePaths,
  verifyStagedAndroidSessionDependency,
} from './native-android-session-public-staging';
import {
  stageNativeConnectionPublicEvidence,
  verifyStagedAndroidConnectionEvidence,
  type NativeConnectionAssertionBinding,
} from './native-connection-public-evidence-core';
import { requireNativePilotAssertions, type NativePilotSelection } from './native-pilot-contract';
import {
  stageNativeTrainingPublicEvidence,
  verifyStagedNativeTrainingEvidence,
} from './native-training-public-evidence';
import { readNativeEvidenceObservation, type NativeEvidenceIdentity } from './native-view-evidence';
import { readCaptureProducerReceipt } from './run-android-session-attempt';
import { assertPublicReceipt } from './schema-validation';
import type {
  NativeComparisonAttemptExpectation,
  NativeComparisonReceiptInput,
} from './compare-native-pilot';
import type { FreshColdReset } from './t15-cold-dispatcher';
import type { T15OwnedLifecycleSessionResult } from './t15-cold-owned-lifecycle';

type Row = Record<string, unknown>;

type Stage = {
  copyManifest?: { path: string; sha256: string };
  assertions: readonly {
    id: string;
    requirementRefs: string[];
    outcome: 'passed';
    evidencePaths: string[];
  }[];
  artifacts: readonly string[];
};

type ProtectedFinalizerReceiptBinding = {
  root: 'capture' | 'output';
  path: string;
  sha256: string;
  identity: NativeEvidenceIdentity;
};

type Finalization = {
  family: string;
  nativePassingCases: number;
  publicPassingCases: number;
  publicPromotionEligible: true;
  stage: Stage | null;
  finalizerKind: string;
  finalizerReceipt: unknown;
  finalizerReceiptBinding: ProtectedFinalizerReceiptBinding;
};

function isRecord(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function requireIdentity(value: unknown, label: string): NativeEvidenceIdentity {
  assert(isRecord(value), `${label} identity is missing`);
  for (const field of ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'])
    assert(
      typeof value[field] === 'number' && Number.isFinite(value[field]),
      `${label}.${field} identity is invalid`,
    );
  return value as NativeEvidenceIdentity;
}

function privateRelative(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is missing`);
  assert(!path.isAbsolute(value), `${label} must be relative`);
  assert(!value.includes('\\') && !value.split('/').includes('..'), `${label} escaped its root`);
  assert(
    value.split('/').every((part) => part.length > 0 && part !== '.'),
    `${label} is not normalized`,
  );
  return value;
}

function protectedFinalizerBinding(input: {
  root: string;
  rootKind: 'capture' | 'output';
  relativePath: unknown;
  expectedHash?: unknown;
  expectedIdentity?: unknown;
  label: string;
}): { binding: ProtectedFinalizerReceiptBinding; receipt: Row } {
  const relativePath = privateRelative(input.relativePath, `${input.label}.path`);
  const observed = readNativeEvidenceObservation(input.root, relativePath, true);
  const observedHash = sha(observed.bytes);
  if (input.expectedHash !== undefined) assert.equal(observedHash, input.expectedHash);
  if (input.expectedIdentity !== undefined)
    assert.deepEqual(
      observed.identity,
      requireIdentity(input.expectedIdentity, `${input.label}.identity`),
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(observed.bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error(`${input.label} is not valid JSON`);
  }
  assert(isRecord(parsed), `${input.label} is not an object`);
  return {
    binding: {
      root: input.rootKind,
      path: relativePath,
      sha256: observedHash,
      identity: observed.identity,
    },
    receipt: parsed,
  };
}

function requirePublishedNativeFinalizerReceipt(input: {
  receipt: Row;
  expected: NativeComparisonAttemptExpectation;
  captureRunId: string;
  selection: NativePilotSelection;
  label: string;
  requiredNativePassingCases?: number;
}): void {
  assert.equal(input.receipt.status, 'published-native', `${input.label} status is not terminal`);
  assert.equal(input.receipt.requestedRunId, input.expected.runId);
  assert.equal(input.receipt.requestedAttemptId, input.expected.attemptId);
  assert.equal(input.receipt.captureRunId, input.captureRunId);
  assert.equal(input.receipt.publicPromotionEligible, true);
  const nativePassingCases = input.receipt.nativePassingCases;
  assert(
    Number.isSafeInteger(nativePassingCases) && Number(nativePassingCases) > 0,
    `${input.label} native count is not positive`,
  );
  assert.equal(input.receipt.publicPassingCases, nativePassingCases);
  if (input.requiredNativePassingCases !== undefined)
    assert.equal(nativePassingCases, input.requiredNativePassingCases);
  const requiredIds = requireNativePilotAssertions(input.selection).map((row) => row.id);
  assert.deepEqual(input.receipt.assertionIds, requiredIds, `${input.label} assertions changed`);
}

function requireGenericAndroidMaestroNativeProof(input: {
  adapter: Row;
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  captureRoot: string;
  captureRunId: string;
  flowId: string;
}): ProtectedFinalizerReceiptBinding {
  if (input.adapter.verificationResult === 'source-only')
    throw new Error('android-maestro-source-only-native-proof-unavailable');
  if (input.adapter.dependencyStatus === 'validated-source-only')
    throw new Error('android-maestro-validated-source-only-native-proof-unavailable');
  const proof = input.adapter.nativeEngineProof;
  if (!isRecord(proof)) throw new Error('android-maestro-native-proof-missing');
  assert.equal(proof.kind, 'private-android-maestro-native-proof-v1');
  assert.equal(proof.status, 'passed');
  assert.equal(proof.engine, 'maestro');
  assert.equal(proof.platform, 'android');
  assert.equal(proof.requestedRunId, input.expected.runId);
  assert.equal(proof.requestedAttemptId, input.expected.attemptId);
  assert.equal(proof.captureRunId, input.captureRunId);
  assert.equal(proof.flowId, input.flowId);
  assert.equal(proof.nativeActionsCompleted, true);
  const nativePassingCases = proof.nativePassingCases;
  if (
    typeof nativePassingCases !== 'number' ||
    !Number.isSafeInteger(nativePassingCases) ||
    nativePassingCases <= 0
  )
    throw new Error('Android Maestro native proof count is not positive');
  assert.equal(input.adapter.nativePassingCases, nativePassingCases);
  assert.equal(input.adapter.publicPassingCases, 0);
  assert.equal(input.adapter.publicPromotionEligible, false);
  const requiredIds = requireNativePilotAssertions(input.selection).map((row) => row.id);
  assert.deepEqual(
    proof.assertionIds,
    requiredIds,
    'Android Maestro native proof assertions changed',
  );
  const finalizer = isRecord(proof.finalizerReceipt)
    ? proof.finalizerReceipt
    : (() => {
        throw new Error('Android Maestro native proof finalizer binding is missing');
      })();
  const loaded = protectedFinalizerBinding({
    root: input.captureRoot,
    rootKind: 'capture',
    relativePath: finalizer.path,
    expectedHash: finalizer.sha256,
    expectedIdentity: finalizer.identity,
    label: 'Android Maestro native proof finalizer',
  });
  requirePublishedNativeFinalizerReceipt({
    receipt: loaded.receipt,
    expected: input.expected,
    captureRunId: input.captureRunId,
    selection: input.selection,
    label: 'Android Maestro native proof finalizer',
    requiredNativePassingCases: nativePassingCases,
  });
  return loaded.binding;
}

function requireCameraAndroidMaestroNativeProof(input: {
  adapter: Row;
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  captureRunId: string;
  outputRoot: string;
}): ProtectedFinalizerReceiptBinding {
  const eligibility = input.adapter.nativeRuntimeEligibility;
  assert(isRecord(eligibility), 'Android camera native eligibility is missing');
  assert.equal(eligibility.status, 'verified-native-private');
  assert.equal(eligibility.verificationMode, 'native-runtime');
  assert.equal(eligibility.nativePassingCases, 4);
  assert.equal(eligibility.publicPassingCases, 0);
  assert.equal(eligibility.publicPromotionEligible, false);
  const provenance = eligibility.runtimeProvenance;
  assert(isRecord(provenance) && provenance.mode === 'native-runtime');
  const proof = eligibility.evidenceProof;
  assert(isRecord(proof) && isRecord(proof.nativeDriver));
  const finalizer = input.adapter.nativeRuntimeFinalizerReceipt;
  assert(isRecord(finalizer), 'Android camera native finalizer binding is missing');
  const loaded = protectedFinalizerBinding({
    root: input.outputRoot,
    rootKind: 'output',
    relativePath: finalizer.path,
    expectedHash: finalizer.sha256,
    label: 'Android camera native finalizer',
  });
  requirePublishedNativeFinalizerReceipt({
    receipt: loaded.receipt,
    expected: input.expected,
    captureRunId: input.captureRunId,
    selection: input.selection,
    label: 'Android camera native finalizer',
    requiredNativePassingCases: 4,
  });
  return loaded.binding;
}

function deadline(signal: AbortSignal, deadlineAt: number): void {
  signal.throwIfAborted();
  if (!Number.isFinite(deadlineAt) || performance.now() >= deadlineAt)
    throw new Error('android-maestro-finalizer-deadline');
}

function readJson(root: string, relative: string): { row: Row; hash: string } {
  const observation = readNativeEvidenceObservation(root, relative, !relative.endsWith('.png'));
  let parsed: unknown;
  try {
    parsed = JSON.parse(observation.bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `Android Maestro finalizer invalid ${relative}: ${error instanceof Error ? error.message : 'json'}`,
    );
  }
  if (!isRecord(parsed)) throw new Error(`Android Maestro finalizer ${relative} is not an object`);
  return { row: parsed, hash: sha(observation.bytes) };
}

function adapterPath(flowId: string): string {
  return flowId === 'FLW-session'
    ? 'android-session-runtime-adapter.private.json'
    : flowId === 'FLW-camera-denied'
      ? 'android-camera-runtime-adapter.private.json'
      : 'runtime-adapter.private.json';
}

function requireAdapterTerminal(
  adapter: Row,
  expected: NativeComparisonAttemptExpectation,
  captureRunId: string,
  backendRunId: string,
  flowId: string,
): void {
  assert.equal(adapter.requestedRunId, expected.runId);
  assert.equal(adapter.requestedAttemptId, expected.attemptId);
  assert.equal(adapter.captureRunId, captureRunId);
  assert.equal(adapter.fixtureRunId ?? adapter.backendRunId, backendRunId);
  assert.equal(adapter.captureExitCode, 0);
  assert.equal(adapter.callbackInvocations, 1);
  assert.equal(adapter.callbackCompleted, true);
  assert.equal(adapter.externalCleanupResult, 'passed');
  assert.equal(adapter.captureResult, 'observed');
  assert.equal(adapter.captureCleanup, 'cleaned');
  assert.equal(adapter.postCaptureFailure, null);
  assert.deepEqual(adapter.censusFailures, []);
  assert.deepEqual(adapter.outputFailures, []);
  assert(
    Number.isSafeInteger(adapter.nativePassingCases) && Number(adapter.nativePassingCases) >= 0,
    'Android Maestro adapter native count is invalid',
  );
  assert.equal(adapter.publicPassingCases, 0);
  assert.equal(adapter.publicPromotionEligible, false);
  if (flowId === 'FLW-camera-denied' || flowId === 'FLW-session')
    assert.equal(adapter.verificationResult, 'source-only');
  else assert.equal(adapter.verificationResult, 'passed');
  const diagnostics = adapter.commandDiagnostics;
  assert(Array.isArray(diagnostics) && diagnostics.length > 0);
  assert(
    diagnostics.every(
      (row) => isRecord(row) && row.execution === 'completed' && row.cleanup === 'cleaned',
    ),
    'Android Maestro adapter command history is not a clean terminal',
  );
}

function requireCaptureTerminal(
  lifecycle: T15OwnedLifecycleSessionResult,
  reset: FreshColdReset,
  expected: NativeComparisonAttemptExpectation,
): { report: Row; build: Row; target: Row; backend: Row; captureRunId: string } {
  assert.equal(lifecycle.exitCode, 0);
  assert(isRecord(lifecycle.report), 'Android Maestro capture report is missing');
  const report = lifecycle.report;
  assert.equal(report.result, 'observed');
  assert.equal(report.cleanup, 'cleaned');
  const captureRunId =
    typeof report.captureRunId === 'string' && report.captureRunId.length > 0
      ? report.captureRunId
      : path.basename(lifecycle.artifactRoot);
  assert.equal(captureRunId, path.basename(lifecycle.artifactRoot));
  assert.equal(reset.status, 'fresh');
  assert.equal(reset.cleanupStatus, 'cleaned');
  assert(isRecord(reset.target), 'Android cold reset target is missing');
  assert(isRecord(reset.backend), 'Android cold reset backend is missing');
  const target = reset.target;
  const backend = reset.backend;
  assert(isRecord(report.build), 'Android capture build identity is missing');
  const build = report.build;
  for (const key of ['appId', 'profile', 'binaryHash', 'apiOrigin'])
    assert(
      typeof build[key] === 'string' && String(build[key]).length > 0,
      `Android build ${key} missing`,
    );
  assert.equal(build.binaryHash, target.binaryHash);
  assert.equal(build.appId, target.appId);
  assert.equal(build.apiOrigin, target.apiOrigin);
  if (expected.target.binaryHash !== null)
    assert.equal(build.binaryHash, expected.target.binaryHash);
  if (expected.target.buildProfile !== null)
    assert.equal(build.profile, expected.target.buildProfile);
  if (expected.target.appId !== null) assert.equal(build.appId, expected.target.appId);
  if (expected.target.apiOrigin !== null) assert.equal(build.apiOrigin, expected.target.apiOrigin);
  assert.equal(build.sourceTreeHash, reset.sourceFingerprint);
  assert.equal(build.helperInputsHash, reset.helperFingerprint);
  assert(isRecord(report.source) && isRecord(report.sourceAfter));
  assert.deepEqual(report.source, report.sourceAfter);
  assert(Array.isArray(report.helperInputsBefore) && Array.isArray(report.helperInputsAfter));
  assert.deepEqual(report.helperInputsBefore, report.helperInputsAfter);
  assert(isRecord(report.originalAttemptReceipt));
  assert.equal(report.originalAttemptReceipt.status, 'verified');
  assert.equal(report.originalAttemptReceipt.runId, expected.runId);
  assert.equal(report.originalAttemptReceipt.attemptId, expected.attemptId);
  assert.equal(report.originalAttemptReceipt.captureRunId, captureRunId);
  assert(Array.isArray(report.ownershipWindows) && report.ownershipWindows.length >= 2);
  for (const raw of report.ownershipWindows) {
    assert(isRecord(raw));
    assert.equal(raw.ownerRunId, expected.runId);
    assert(typeof raw.acquiredAt === 'string' && typeof raw.releasedAt === 'string');
    assert(Date.parse(raw.releasedAt) > Date.parse(raw.acquiredAt));
  }
  if (typeof backend.runId !== 'string' || backend.runId.length === 0)
    throw new Error('Android Maestro backend identity is missing');
  return { report, build, target, backend, captureRunId };
}

function bindingRows(
  adapter: Row,
): { id: string; requirementRefs: string[]; evidencePaths: string[] }[] {
  assert(
    Array.isArray(adapter.assertionBindings),
    'Android Maestro assertion bindings are missing',
  );
  return adapter.assertionBindings.map((value, index) => {
    if (!isRecord(value)) throw new Error(`Android Maestro assertion binding ${index} is invalid`);
    assert(typeof value.id === 'string');
    assert(
      Array.isArray(value.requirementRefs) &&
        value.requirementRefs.every((row) => typeof row === 'string'),
    );
    assert(
      Array.isArray(value.evidencePaths) &&
        value.evidencePaths.every((row) => typeof row === 'string'),
    );
    return {
      id: value.id,
      requirementRefs: value.requirementRefs,
      evidencePaths: value.evidencePaths,
    };
  });
}

function requireBindingCount(
  selection: NativePilotSelection,
  bindings: readonly { id: string }[],
): void {
  const required = requireNativePilotAssertions(selection);
  assert.equal(bindings.length, required.length);
  assert.deepEqual(
    bindings.map((row) => row.id),
    required.map((row) => row.id),
  );
}

function rereadStageAndOriginal(
  captureRoot: string,
  outputRoot: string,
  captureRunId: string,
  bindings: readonly { evidencePaths: readonly string[] }[],
  artifacts: readonly string[],
): void {
  for (const binding of bindings) {
    for (const relative of binding.evidencePaths) {
      const original = readNativeEvidenceObservation(
        captureRoot,
        relative,
        !relative.endsWith('.png'),
      );
      const staged = readNativeEvidenceObservation(
        outputRoot,
        `evidence/${captureRunId}/${relative}`,
        !relative.endsWith('.png'),
      );
      assert.equal(
        sha(original.bytes),
        sha(staged.bytes),
        `Android staged evidence changed: ${relative}`,
      );
      if (!relative.endsWith('.png')) {
        let proof: unknown;
        try {
          proof = JSON.parse(original.bytes.toString('utf8')) as unknown;
        } catch {
          proof = null;
        }
        if (isRecord(proof) && Array.isArray(proof.references)) {
          for (const rawReference of proof.references) {
            assert(isRecord(rawReference), `Android evidence reference is malformed: ${relative}`);
            if (rawReference.redacted === true) continue;
            assert(
              typeof rawReference.path === 'string' && rawReference.path.length > 0,
              `Android evidence reference path is missing: ${relative}`,
            );
            assert(
              typeof rawReference.sha256 === 'string' &&
                /^[a-f0-9]{64}$/u.test(rawReference.sha256),
              `Android evidence reference hash is missing: ${relative}`,
            );
            const referencePath = rawReference.path;
            const originalReference = readNativeEvidenceObservation(
              captureRoot,
              referencePath,
              !referencePath.endsWith('.png'),
            );
            const stagedReference = readNativeEvidenceObservation(
              outputRoot,
              `evidence/${captureRunId}/${referencePath}`,
              !referencePath.endsWith('.png'),
            );
            assert.equal(
              sha(originalReference.bytes),
              rawReference.sha256,
              `Android original evidence reference changed: ${referencePath}`,
            );
            assert.equal(
              sha(stagedReference.bytes),
              rawReference.sha256,
              `Android staged evidence reference changed: ${referencePath}`,
            );
          }
        }
      }
    }
  }
  for (const artifact of artifacts) {
    const observed = readNativeEvidenceObservation(
      outputRoot,
      artifact,
      !artifact.endsWith('.png'),
    );
    assert(observed.bytes.length > 0, `Android finalizer artifact is empty: ${artifact}`);
  }
}

async function stageSession(input: {
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  captureRunId: string;
  backendRunId: string;
  report: Row;
  adapter: Row;
  signal: AbortSignal;
  deadlineAt: number;
}): Promise<Stage> {
  const dependency = await loadAndroidSessionPublicDependency({
    repositoryRoot: input.repositoryRoot,
    captureRoot: input.captureRoot,
    cleanupRoot: input.captureRoot,
    signal: input.signal,
    deadlineMs: Math.max(1, Math.floor(input.deadlineAt - performance.now())),
  });
  assert.equal(dependency.status, 'validated-source-only');
  const staged = input.adapter.staged;
  assert(isRecord(staged), 'Android session staged dependency is missing');
  assert(isRecord(staged.copyManifest));
  const cleanup = readJson(input.captureRoot, 'external-cleanup.private.json').row;
  const captureReceipt = await readCaptureProducerReceipt(input.captureRoot, input.captureRunId);
  const producerReceipts = collectAndroidSessionProducerReceipts(input.report, [
    cleanup,
    captureReceipt,
  ]);
  await verifyStagedAndroidSessionDependency({
    outputRoot: input.outputRoot,
    copyManifest: staged.copyManifest as { path: string; sha256: string },
    requestedRunId: input.expected.runId,
    captureRunId: input.captureRunId,
    captureRoot: input.captureRoot,
    dependency,
    selection: input.selection,
    producerReceipts: producerReceipts,
  });
  assert(Array.isArray(staged.assertionIds));
  const required = requireNativePilotAssertions(input.selection);
  assert.deepEqual(
    staged.assertionIds,
    required.map((row) => row.id),
    'Android session staged assertion order changed',
  );
  assert(Array.isArray(staged.artifacts));
  assert(typeof staged.copyManifest.path === 'string');
  const copyManifestPath = staged.copyManifest.path;
  const expectedArtifacts = [
    copyManifestPath,
    ...requiredAndroidSessionBundlePaths(dependency).map(
      (relative) => `evidence/${input.captureRunId}/${relative}`,
    ),
  ];
  assert.deepEqual(
    staged.artifacts,
    expectedArtifacts,
    'Android session staged artifact set changed',
  );
  const evidenceByKind = {
    ui: [...dependency.files.framePaths],
    api: [
      ...dependency.files.profilePaths,
      ...dependency.files.domainPaths,
      dependency.files.transportPath,
      dependency.files.nativeAuthIdentitiesPath,
    ],
    sql: [...dependency.files.sqlPaths],
  } as const;
  const sourceAssertions = required.map((row) => ({
    id: row.id,
    requirementRefs: [...row.requirementRefs],
    outcome: 'passed' as const,
    evidencePaths: [...new Set(row.evidenceKinds.flatMap((kind) => evidenceByKind[kind]))].sort(),
  }));
  const assertions = sourceAssertions.map((row) => ({
    ...row,
    evidencePaths: row.evidencePaths.map(
      (relative) => `evidence/${input.captureRunId}/${relative}`,
    ),
  }));
  requireBindingCount(input.selection, sourceAssertions);
  rereadStageAndOriginal(
    input.captureRoot,
    input.outputRoot,
    input.captureRunId,
    sourceAssertions,
    expectedArtifacts,
  );
  return {
    copyManifest: staged.copyManifest as { path: string; sha256: string },
    assertions,
    artifacts: expectedArtifacts,
  };
}

async function stageTraining(input: {
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  captureRunId: string;
  backendRunId: string;
  adapter: Row;
  signal: AbortSignal;
  deadlineAt: number;
}): Promise<Stage> {
  const bindings = bindingRows(input.adapter);
  requireBindingCount(input.selection, bindings);
  const stage = await stageNativeTrainingPublicEvidence({
    repositoryRoot: input.repositoryRoot,
    captureRoot: input.captureRoot,
    outputRoot: input.outputRoot,
    requestedRunId: input.expected.runId,
    fixtureRunId: input.backendRunId,
    selection: input.selection,
    bindings,
    lifecycle: { signal: input.signal, deadlineAtMs: input.deadlineAt },
  });
  await verifyStagedNativeTrainingEvidence({
    outputRoot: input.outputRoot,
    copyManifest: stage.copyManifest,
    requestedRunId: input.expected.runId,
    captureRunId: input.captureRunId,
    fixtureRunId: input.backendRunId,
    captureRoot: input.captureRoot,
    lifecycle: { signal: input.signal, deadlineAtMs: input.deadlineAt },
  });
  rereadStageAndOriginal(
    input.captureRoot,
    input.outputRoot,
    input.captureRunId,
    bindings,
    stage.artifacts,
  );
  return stage as Stage;
}

async function stageConnection(input: {
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  captureRunId: string;
  backendRunId: string;
  adapter: Row;
  signal: AbortSignal;
  deadlineAt: number;
}): Promise<Stage> {
  const bindings = bindingRows(input.adapter) as NativeConnectionAssertionBinding[];
  requireBindingCount(input.selection, bindings);
  const stage = await stageNativeConnectionPublicEvidence({
    repositoryRoot: input.repositoryRoot,
    captureRoot: input.captureRoot,
    outputRoot: input.outputRoot,
    requestedRunId: input.expected.runId,
    fixtureRunId: input.backendRunId,
    selection: input.selection,
    bindings,
    platform: 'android',
    lifecycle: { signal: input.signal, deadlineAtMs: input.deadlineAt },
  });
  await verifyStagedAndroidConnectionPublicEvidence({
    repositoryRoot: input.repositoryRoot,
    selection: input.selection,
    outputRoot: input.outputRoot,
    copyManifest: stage.copyManifest,
    requestedRunId: input.expected.runId,
    captureRunId: input.captureRunId,
    fixtureRunId: input.backendRunId,
    bindings,
    captureRoot: input.captureRoot,
  });
  rereadStageAndOriginal(
    input.captureRoot,
    input.outputRoot,
    input.captureRunId,
    bindings,
    stage.artifacts,
  );
  return stage as Stage;
}

async function verifyStagedAndroidConnectionPublicEvidence(
  options: Parameters<typeof verifyStagedAndroidConnectionEvidence>[0],
) {
  return verifyStagedAndroidConnectionEvidence(options);
}

async function stageSaveRetry(input: {
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  captureRunId: string;
  backendRunId: string;
  adapter: Row;
}): Promise<Stage> {
  const bindings = bindingRows(input.adapter) as AndroidSaveRetryAssertionBinding[];
  requireBindingCount(input.selection, bindings);
  const stage = await stageNativeAndroidSaveRetryPublicEvidence({
    repositoryRoot: input.repositoryRoot,
    captureRoot: input.captureRoot,
    outputRoot: input.outputRoot,
    requestedRunId: input.expected.runId,
    fixtureRunId: input.backendRunId,
    selection: input.selection,
    bindings,
  });
  await verifyStagedNativeAndroidSaveRetryEvidence({
    repositoryRoot: input.repositoryRoot,
    selection: input.selection,
    outputRoot: input.outputRoot,
    copyManifest: stage.copyManifest,
    requestedRunId: input.expected.runId,
    captureRunId: input.captureRunId,
    fixtureRunId: input.backendRunId,
    captureRoot: input.captureRoot,
  });
  rereadStageAndOriginal(
    input.captureRoot,
    input.outputRoot,
    input.captureRunId,
    bindings,
    stage.artifacts,
  );
  return stage as Stage;
}

function cameraStage(finalizer: AndroidCameraNativeRuntimePublicFinalizationResult): Stage {
  const bindings = finalizer.assertionBindings.map((binding) => ({
    id: binding.id,
    requirementRefs: [...binding.requirementRefs],
    outcome: 'passed' as const,
    evidencePaths: binding.evidencePaths.map((path) => path),
  }));
  const receipt = finalizer.finalizerReceipt;
  return {
    assertions: bindings,
    artifacts: [
      receipt.stageManifest.path,
      'android-camera-native-runtime-finalization.private.json',
    ],
  };
}

function finalizationDocument(input: {
  expected: NativeComparisonAttemptExpectation;
  reset: FreshColdReset;
  build: Row;
  backend: Row;
  captureRunId: string;
  stage: Stage;
  finalization: Finalization;
}): Row {
  return {
    kind: 'private-t15-android-maestro-native-finalization',
    status: 'published-native',
    runId: input.expected.runId,
    attemptId: input.expected.attemptId,
    captureRunId: input.captureRunId,
    backendRunId: input.backend.runId,
    family: input.finalization.family,
    assertionIds: input.stage.assertions.map((row) => row.id),
    nativePassingCases: input.finalization.nativePassingCases,
    publicPassingCases: input.finalization.publicPassingCases,
    publicPromotionEligible: input.finalization.publicPromotionEligible,
    sourceTreeHash: input.build.sourceTreeHash,
    helperInputsHash: input.build.helperInputsHash,
    binaryHash: input.build.binaryHash,
    resetReceiptHash: input.reset.originalResetBinding.receiptHash,
    finalizerKind: input.finalization.finalizerKind,
    finalizerReceipt: input.finalization.finalizerReceipt,
    finalizerReceiptBinding: input.finalization.finalizerReceiptBinding,
  };
}

function publicReceipt(input: {
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  report: Row;
  build: Row;
  target: Row;
  backend: Row;
  captureRunId: string;
  stage: Stage;
  outputRoot: string;
}): NativeComparisonReceiptInput {
  const target = {
    deviceId: String(input.target.deviceId),
    osVersion: String(input.target.osVersion),
    appId: String(input.target.appId),
    buildProfile: String(input.build.profile),
    binaryHash: String(input.build.binaryHash),
    apiOrigin: String(input.target.apiOrigin),
  };
  const expectedTarget = input.expected.target;
  for (const [key, value] of Object.entries(expectedTarget))
    if (value !== null) assert.equal(target[key as keyof typeof target], value);
  const inputValues = input.expected.inputs;
  if (inputValues.fixtureHash !== null)
    assert.equal(input.report.fixtureHash, inputValues.fixtureHash);
  const buildFlags = input.build.flagsFingerprint ?? input.build.environmentHash;
  if (inputValues.flagsHash !== null) assert.equal(buildFlags, inputValues.flagsHash);
  const toolVersions = isRecord(input.report.toolVersions) ? input.report.toolVersions : {};
  for (const [key, value] of Object.entries(inputValues.toolVersions))
    assert.equal(toolVersions[key], value);
  const commandRows: readonly unknown[] = Array.isArray(input.report.commandExecutions)
    ? (input.report.commandExecutions as readonly unknown[])
    : [];
  const terminal = [...commandRows]
    .reverse()
    .find(
      (row): row is Row =>
        isRecord(row) &&
        row.execution === 'completed' &&
        row.cleanup === 'cleaned' &&
        row.childExitCode === 0 &&
        typeof row.command === 'string' &&
        Array.isArray(row.argv),
    );
  assert(terminal, 'Android Maestro terminal command is missing');
  assert(isRecord(input.report.timingsMs), 'Android Maestro timings are missing');
  const timingsMs: Record<string, number> = {};
  for (const phase of ['build', 'install', 'reset', 'scenario', 'verify', 'cleanup']) {
    assert(
      typeof input.report.timingsMs[phase] === 'number' &&
        Number.isFinite(input.report.timingsMs[phase]),
    );
    timingsMs[phase] = input.report.timingsMs[phase];
  }
  const assertions = input.stage.assertions.map((assertion) => ({
    id: assertion.id,
    requirementRefs: [...assertion.requirementRefs],
    outcome: assertion.outcome,
    evidencePaths: [...assertion.evidencePaths],
  }));
  assert(Array.isArray(input.report.ownershipWindows));
  const ownedResourceIds = (input.report.ownershipWindows as unknown[]).map((row) => {
    assert(isRecord(row));
    return String(row.resourceId);
  });
  const startedAt = String(input.report.startedAt);
  const finishedAt = String(input.report.finishedAt);
  assert(Date.parse(finishedAt) > Date.parse(startedAt));
  const finalizationPath = 'android-maestro-native-finalization.private.json';
  return {
    path: path.join(input.outputRoot, 'cold-public-receipt.private.json'),
    artifactRoot: input.outputRoot,
    receipt: {
      schemaVersion: 1,
      runId: input.expected.runId,
      attemptId: input.expected.attemptId,
      scenarioId: input.selection.scenario.id,
      phase: 'P4',
      layer: 'native',
      engine: 'maestro',
      dataMode: input.selection.scenario.dataMode,
      platform: 'android',
      locale: input.expected.locale,
      repositories: input.expected.repositories,
      target,
      inputs: inputValues,
      command: {
        executable: terminal.command,
        argv: terminal.argv,
      },
      startedAt,
      finishedAt,
      result: 'passed',
      exitCode: 0,
      childExitCode: 0,
      assertions,
      timingsMs,
      cleanup: { status: 'cleaned', ownedResourceIds, recoveryRecordPath: null },
      artifacts: [...input.stage.artifacts, finalizationPath],
      blocker: null,
    },
    receiptHash: '',
  };
}

export async function finalizeT15AndroidMaestroPublicEvidence(input: {
  repositoryRoot: string;
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  lifecycle: T15OwnedLifecycleSessionResult;
  reset: FreshColdReset;
  outputRoot: string;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
}): Promise<NativeComparisonReceiptInput> {
  deadline(input.signal, input.deadlineAtMonotonicMs);
  const common = requireCaptureTerminal(input.lifecycle, input.reset, input.expected);
  const adapterFile = readJson(
    input.lifecycle.artifactRoot,
    adapterPath(input.selection.scenario.flowId),
  );
  const adapter = adapterFile.row;
  requireAdapterTerminal(
    adapter,
    input.expected,
    common.captureRunId,
    String(common.backend.runId),
    input.selection.scenario.flowId,
  );
  const flow = input.selection.scenario.flowId;
  let stage: Stage;
  let finalizer: Finalization;
  let finalizerBinding: ProtectedFinalizerReceiptBinding;
  if (flow === 'FLW-camera-denied') {
    finalizerBinding = requireCameraAndroidMaestroNativeProof({
      adapter,
      expected: input.expected,
      selection: input.selection,
      captureRunId: common.captureRunId,
      outputRoot: input.outputRoot,
    });
    assert(isRecord(adapter.nativeRuntimeEligibility));
    const runtime = await finalizeAndroidCameraNativeRuntime({
      eligibility: adapter.nativeRuntimeEligibility as never,
      repositoryRoot: input.repositoryRoot,
      captureRoot: input.lifecycle.artifactRoot,
      outputRoot: input.outputRoot,
      signal: input.signal,
      deadlineAt: input.deadlineAtMonotonicMs,
    });
    stage = cameraStage(runtime);
    requireBindingCount(input.selection, stage.assertions);
    finalizer = {
      family: 'camera-denied',
      nativePassingCases: runtime.nativePassingCases,
      publicPassingCases: runtime.publicPassingCases,
      publicPromotionEligible: true,
      stage,
      finalizerKind: runtime.kind,
      finalizerReceipt: runtime.finalizerReceipt,
      finalizerReceiptBinding: finalizerBinding,
    };
  } else if (flow === 'FLW-session') {
    finalizerBinding = requireGenericAndroidMaestroNativeProof({
      adapter,
      expected: input.expected,
      selection: input.selection,
      captureRoot: input.lifecycle.artifactRoot,
      captureRunId: common.captureRunId,
      flowId: flow,
    });
    stage = await stageSession({
      repositoryRoot: input.repositoryRoot,
      captureRoot: input.lifecycle.artifactRoot,
      outputRoot: input.outputRoot,
      expected: input.expected,
      selection: input.selection,
      captureRunId: common.captureRunId,
      backendRunId: String(common.backend.runId),
      report: common.report,
      adapter,
      signal: input.signal,
      deadlineAt: input.deadlineAtMonotonicMs,
    });
    finalizer = {
      family: 'session',
      nativePassingCases: stage.assertions.length,
      publicPassingCases: stage.assertions.length,
      publicPromotionEligible: true,
      stage,
      finalizerKind: 'private-t15-android-maestro-session-runtime-finalizer',
      finalizerReceipt: { stage: stage.copyManifest },
      finalizerReceiptBinding: finalizerBinding,
    };
  } else if (flow === 'FLW-training') {
    finalizerBinding = requireGenericAndroidMaestroNativeProof({
      adapter,
      expected: input.expected,
      selection: input.selection,
      captureRoot: input.lifecycle.artifactRoot,
      captureRunId: common.captureRunId,
      flowId: flow,
    });
    stage = await stageTraining({
      repositoryRoot: input.repositoryRoot,
      captureRoot: input.lifecycle.artifactRoot,
      outputRoot: input.outputRoot,
      expected: input.expected,
      selection: input.selection,
      captureRunId: common.captureRunId,
      backendRunId: String(common.backend.runId),
      adapter,
      signal: input.signal,
      deadlineAt: input.deadlineAtMonotonicMs,
    });
    finalizer = {
      family: 'training',
      nativePassingCases: stage.assertions.length,
      publicPassingCases: stage.assertions.length,
      publicPromotionEligible: true,
      stage,
      finalizerKind: 'private-t15-android-maestro-training-runtime-finalizer',
      finalizerReceipt: { stage: stage.copyManifest },
      finalizerReceiptBinding: finalizerBinding,
    };
  } else if (flow === 'FLW-connection') {
    finalizerBinding = requireGenericAndroidMaestroNativeProof({
      adapter,
      expected: input.expected,
      selection: input.selection,
      captureRoot: input.lifecycle.artifactRoot,
      captureRunId: common.captureRunId,
      flowId: flow,
    });
    stage = await stageConnection({
      repositoryRoot: input.repositoryRoot,
      captureRoot: input.lifecycle.artifactRoot,
      outputRoot: input.outputRoot,
      expected: input.expected,
      selection: input.selection,
      captureRunId: common.captureRunId,
      backendRunId: String(common.backend.runId),
      adapter,
      signal: input.signal,
      deadlineAt: input.deadlineAtMonotonicMs,
    });
    finalizer = {
      family: 'connection',
      nativePassingCases: stage.assertions.length,
      publicPassingCases: stage.assertions.length,
      publicPromotionEligible: true,
      stage,
      finalizerKind: 'private-t15-android-maestro-connection-runtime-finalizer',
      finalizerReceipt: { stage: stage.copyManifest },
      finalizerReceiptBinding: finalizerBinding,
    };
  } else if (flow === 'FLW-save-retry') {
    finalizerBinding = requireGenericAndroidMaestroNativeProof({
      adapter,
      expected: input.expected,
      selection: input.selection,
      captureRoot: input.lifecycle.artifactRoot,
      captureRunId: common.captureRunId,
      flowId: flow,
    });
    stage = await stageSaveRetry({
      repositoryRoot: input.repositoryRoot,
      captureRoot: input.lifecycle.artifactRoot,
      outputRoot: input.outputRoot,
      expected: input.expected,
      selection: input.selection,
      captureRunId: common.captureRunId,
      backendRunId: String(common.backend.runId),
      adapter,
    });
    finalizer = {
      family: 'save-retry',
      nativePassingCases: stage.assertions.length,
      publicPassingCases: stage.assertions.length,
      publicPromotionEligible: true,
      stage,
      finalizerKind: 'private-t15-android-maestro-save-retry-runtime-finalizer',
      finalizerReceipt: { stage: stage.copyManifest },
      finalizerReceiptBinding: finalizerBinding,
    };
  } else {
    throw new Error('android-maestro-finalizer-family-unavailable');
  }
  const terminalFinalizer = protectedFinalizerBinding({
    root: finalizerBinding.root === 'capture' ? input.lifecycle.artifactRoot : input.outputRoot,
    rootKind: finalizerBinding.root,
    relativePath: finalizerBinding.path,
    expectedHash: finalizerBinding.sha256,
    expectedIdentity: finalizerBinding.identity,
    label: 'Android Maestro terminal finalizer',
  });
  requirePublishedNativeFinalizerReceipt({
    receipt: terminalFinalizer.receipt,
    expected: input.expected,
    captureRunId: common.captureRunId,
    selection: input.selection,
    label: 'Android Maestro terminal finalizer',
    requiredNativePassingCases: finalizer.nativePassingCases,
  });
  finalizerBinding = terminalFinalizer.binding;
  finalizer = { ...finalizer, finalizerReceiptBinding: finalizerBinding };
  requireBindingCount(input.selection, finalizer.stage?.assertions ?? []);
  deadline(input.signal, input.deadlineAtMonotonicMs);
  const receipt = publicReceipt({
    expected: input.expected,
    selection: input.selection,
    report: common.report,
    build: common.build,
    target: common.target,
    backend: common.backend,
    captureRunId: common.captureRunId,
    stage: finalizer.stage!,
    outputRoot: input.outputRoot,
  });
  const finalizationPath = path.join(
    input.outputRoot,
    'android-maestro-native-finalization.private.json',
  );
  const finalizationBytes = Buffer.from(
    JSON.stringify(
      finalizationDocument({
        expected: input.expected,
        reset: input.reset,
        build: common.build,
        backend: common.backend,
        captureRunId: common.captureRunId,
        stage: finalizer.stage!,
        finalization: finalizer,
      }),
      null,
      2,
    ) + '\n',
  );
  await writeFile(finalizationPath, finalizationBytes, { flag: 'wx', mode: 0o600 });
  const finalizationObserved = readNativeEvidenceObservation(
    input.outputRoot,
    'android-maestro-native-finalization.private.json',
    true,
  );
  assert.equal(sha(finalizationObserved.bytes), sha(finalizationBytes));
  assertPublicReceipt(receipt.receipt, input.outputRoot);
  const receiptBytes = Buffer.from(JSON.stringify(receipt.receipt, null, 2) + '\n');
  await writeFile(receipt.path, receiptBytes, { flag: 'wx', mode: 0o600 });
  const observed = readNativeEvidenceObservation(
    input.outputRoot,
    'cold-public-receipt.private.json',
    true,
  );
  assert.equal(sha(observed.bytes), sha(receiptBytes));
  const parsed = JSON.parse(observed.bytes.toString('utf8')) as unknown;
  assert.deepEqual(parsed, receipt.receipt);
  return {
    path: receipt.path,
    artifactRoot: receipt.artifactRoot,
    receipt: parsed,
    receiptHash: sha(observed.bytes),
  };
}

export const t15AndroidMaestroPublicFinalizerContract = {
  families: ['session', 'training', 'connection', 'camera-denied', 'save-retry'] as const,
  terminal: 'protected-finalizer-reread' as const,
  sourceOnlyAdaptersRemainZero: true,
  runtimePromotionRequiresCaptureAndCleanup: true,
  receiptJsonForbidden: true,
};
