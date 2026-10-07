import assert from 'node:assert/strict';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  verifyAndroidCameraRuntimeEligibility,
  type AndroidCameraNativeRuntimeProvenance,
  type AndroidCameraRuntimeEligibilityInput,
  type AndroidCameraRuntimeEligibilityResult,
} from './native-android-camera-runtime-eligibility';
import { readOwnedAndroidBoundedFile } from './native-android-session-adapter';
import {
  ANDROID_CAMERA_ASSERTION_IDS,
  ANDROID_CAMERA_SCENARIO,
  androidCameraSelectionHash,
  requireAndroidCameraIdentityBoundary,
} from './native-camera-android-contract';
import {
  requireAndroidCameraProducerOutput,
  requireAndroidCameraSelectionShape,
  type AndroidCameraProducerReceipts,
} from './native-camera-android-producer';

const RUN_ID = /^[a-f0-9]{24}$/u;
const SEALED_LABEL = /^sealed-source-control:[a-z0-9-]+$/u;

/**
 * The private dispatch boundary delegates evidence work to the sealed
 * eligibility verifier.  It owns only pre-delegation identity and terminal
 * checks, plus result projection; it never creates producer, UI, API, SQL,
 * locale, build, or cleanup facts.
 */
export type AndroidCameraRuntimeDispatchInput = Omit<
  AndroidCameraRuntimeEligibilityInput,
  'producer' | 'signal' | 'deadlineAt' | 'sourceOnlyTestLabel'
> & {
  producer: AndroidCameraProducerReceipts;
  signal: AbortSignal;
  deadlineAt: number;
  sourceOnlyTestLabel?: `sealed-source-control:${string}`;
  runtimeProvenance?: AndroidCameraNativeRuntimeProvenance;
  /** Resource-free seam used only by private controls; production defaults to the sealed verifier. */
  verifier?: AndroidCameraRuntimeEligibilityVerifier;
};

export type AndroidCameraRuntimeEligibilityVerifier = (
  input: AndroidCameraRuntimeEligibilityInput,
) => Promise<AndroidCameraRuntimeEligibilityResult>;

export type AndroidCameraRuntimeDispatchResult = {
  kind: 'private-owned-android-camera-runtime-dispatch-not-public-receipt';
  status: AndroidCameraRuntimeEligibilityResult['status'];
  verificationMode: AndroidCameraRuntimeEligibilityResult['verificationMode'];
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  fixtureRunId: string;
  producerCaptureRunId: string;
  stageManifestPath: string;
  assertionBindings: AndroidCameraRuntimeEligibilityResult['assertionBindings'];
  eligibility: AndroidCameraRuntimeEligibilityResult;
  runtimeProvenance: AndroidCameraRuntimeEligibilityResult['runtimeProvenance'];
  nativePassingCases: AndroidCameraRuntimeEligibilityResult['nativePassingCases'];
  publicPassingCases: AndroidCameraRuntimeEligibilityResult['publicPassingCases'];
  publicPromotionEligible: boolean;
};

function privateLabel(value: string): asserts value is `sealed-source-control:${string}` {
  assert.match(value, SEALED_LABEL, 'Android camera dispatch source-only label is invalid');
}

function requireRunId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
}

async function requireOwnedPrivateDirectory(value: string, label: string): Promise<string> {
  const resolved = await realpath(value);
  assert.equal(resolved, path.resolve(value), `${label} is not canonical`);
  const info = await lstat(resolved);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a regular directory`);
  assert.equal(info.uid, process.getuid?.(), `${label} is not owned`);
  assert.equal(info.mode & 0o777, 0o700, `${label} is not private`);
  return resolved;
}

function requireDeadline(signal: AbortSignal, deadlineAt: number, label: string): void {
  signal.throwIfAborted();
  assert(Number.isFinite(deadlineAt), `${label} deadline is not finite`);
  assert(deadlineAt > performance.now(), `${label} deadline has expired`);
}

function requireTerminalAttempt(
  input: AndroidCameraRuntimeDispatchInput,
): AndroidCameraProducerReceipts {
  const runtime = input.runtime;
  assert(runtime, 'Android camera source-only dispatch requires a terminal attempt');
  assert.equal(runtime.kind, 'private-owned-android-camera-public-attempt-not-public-receipt');
  assert.equal(runtime.requestedRunId, input.requestedRunId);
  assert.equal(runtime.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.equal(runtime.captureRunId, input.captureRunId);
  assert.equal(runtime.fixtureRunId, input.fixtureRunId);
  assert.equal(runtime.captureExitCode, 0);
  assert.equal(runtime.childExitCode, 0);
  assert.equal(runtime.childSignal, null);
  assert.equal(runtime.childClassification, 'completed');
  assert.equal(runtime.captureResult, 'observed');
  assert.equal(runtime.captureCleanup, 'cleaned');
  assert.equal(runtime.captureTimeout, null);
  assert.equal(runtime.cancellation, null);
  assert.equal(runtime.deadline, null);
  assert.equal(runtime.callbackInvocations, 1);
  assert.equal(runtime.callbackCompleted, true);
  assert.deepEqual(runtime.captureInvocation, {
    count: 1,
    returned: true,
    exitCode: 0,
    result: 'observed',
  });
  assert.equal(runtime.captureCompleted, true);
  assert.equal(runtime.externalCleanupResult, 'passed');
  assert.equal(runtime.verificationResult, 'source-only');
  assert.equal(runtime.verificationFailure, null);
  assert.equal(runtime.postCaptureFailure, null);
  assert.deepEqual(runtime.censusFailures, []);
  assert.deepEqual(runtime.outputFailures, []);
  assert.deepEqual(runtime.assertionIds, [...ANDROID_CAMERA_ASSERTION_IDS]);
  assert.equal(runtime.nativePassingCases, 0);
  assert.equal(runtime.publicPassingCases, 0);
  assert.equal(runtime.publicPromotionEligible, false);
  assert.equal(runtime.stagedManifestPath, null);
  assert.equal(path.resolve(runtime.artifactRoot), path.resolve(input.captureRoot));
  assert(runtime.commandDiagnostics.length > 0, 'Android camera command history is missing');
  assert(
    runtime.commandDiagnostics.every(
      (row) => row.execution === 'completed' && row.cleanup === 'cleaned',
    ),
    'Android camera command history is not a clean terminal history',
  );
  const producer = runtime.cameraProducer;
  assert(producer, 'Android camera producer receipt is missing from the public attempt');
  assert.deepEqual(
    producer,
    input.producer,
    'Android camera producer is not the dispatch-bound producer',
  );
  assert.equal(producer.captureRunId, input.captureRunId);
  assert.equal(producer.identity.captureRunId, input.captureRunId);
  assert.equal(producer.identity.backendRunId, input.fixtureRunId);
  assert.equal(producer.identity.backendAttemptId, `${input.fixtureRunId}:first`);
  assert.equal(runtime.backendRunId, producer.identity.backendRunId);
  assert.equal(runtime.backendAttemptId, producer.identity.backendAttemptId);
  requireAndroidCameraIdentityBoundary({
    requestedRunId: input.requestedRunId,
    captureRunId: input.captureRunId,
    ownerRunId: producer.identity.ownerRunId,
    backendRunId: input.fixtureRunId,
  });
  return producer;
}

function requireNativeDriverIdentity(input: AndroidCameraRuntimeDispatchInput): void {
  const driver = input.nativeDriver;
  assert(driver, 'Android native dispatch requires an acquired native driver result');
  assert.equal(
    driver.kind,
    'private-owned-android-camera-native-runtime-driver-result-not-public-receipt',
  );
  assert.equal(driver.status, 'native-observed');
  assert.equal(driver.platform, 'android');
  assert.equal(driver.engine, 'maestro');
  assert.equal(driver.requestedRunId, input.requestedRunId);
  assert.equal(driver.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.equal(driver.captureRunId, input.captureRunId);
  assert.equal(driver.fixtureRunId, input.fixtureRunId);
  assert.equal(driver.ownerRunId, input.producer.identity.ownerRunId);
  assert.deepEqual(driver.target, input.target);
  assert.equal(driver.process.apiPid, input.producer.identity.apiPid);
  assert.equal(driver.process.apiStarted, input.producer.identity.apiStarted);
  assert.equal(driver.process.apiOrigin, input.producer.identity.apiOrigin);
  assert.equal(driver.process.ownerRunId, input.producer.identity.ownerRunId);
  assert.equal(driver.process.targetDeviceId, input.target.deviceId);
  assert.equal(driver.acquisition.status, 'acquired');
  assert.equal(driver.acquisition.result, 'observed');
  assert.equal(driver.acquisition.cleanup, 'cleaned');
  assert.equal(driver.acquisition.externalCleanup, 'passed');
  assert(
    driver.acquisition.commandDiagnostics.length > 0,
    'Android native driver command history is missing',
  );
}

function relativeChild(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is missing`);
  assert(!path.isAbsolute(value), `${label} is absolute`);
  assert(!value.split(/[\\/]/u).includes('..'), `${label} escapes its root`);
  assert(path.posix.normalize(value) === value, `${label} is not normalized`);
  return value;
}

function requiredDigest(value: unknown, label: string): string {
  assert(typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value), `${label} is invalid`);
  return value;
}

async function requireCaptureOwnerBinding(
  captureRoot: string,
  captureRunId: string,
  producer: AndroidCameraProducerReceipts,
  signal: AbortSignal,
): Promise<void> {
  const loaded = await readOwnedAndroidBoundedFile({
    artifactRoot: captureRoot,
    filePath: path.join(captureRoot, 'capture.private.json'),
    label: 'Android camera capture owner report',
    maxBytes: 32 * 1024 * 1024,
    signal,
  });
  let report: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(loaded.bytes.toString('utf8'));
    assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
    report = parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error('Android camera capture owner report is malformed', {
      cause: error,
    });
  }
  assert.equal(report.captureRunId, captureRunId);
  assert.equal(report.kind, 'private-owned-native-camera-denied-execution-not-public-receipt');
  const device = report.device;
  assert(device && typeof device === 'object' && !Array.isArray(device));
  const ownerRunId = (device as Record<string, unknown>).runId;
  requireRunId(ownerRunId, 'Android camera capture owner run ID');
  assert.equal(ownerRunId, producer.identity.ownerRunId);
}

function requireProducerProvenance(
  producer: AndroidCameraProducerReceipts,
  input: AndroidCameraRuntimeDispatchInput,
): void {
  requireAndroidCameraIdentityBoundary({
    requestedRunId: input.requestedRunId,
    captureRunId: input.captureRunId,
    ownerRunId: producer.identity.ownerRunId,
    backendRunId: input.fixtureRunId,
  });
  assert.equal(producer.sourceSelectionHash, androidCameraSelectionHash(input.selection));
  assert.equal(producer.identity.captureRunId, input.captureRunId);
  requireRunId(producer.identity.ownerRunId, 'Android camera producer owner run ID');
  assert.equal(producer.identity.backendRunId, input.fixtureRunId);
  assert.equal(producer.identity.backendAttemptId, `${input.fixtureRunId}:first`);
  assert.deepEqual(producer.identity.target, input.target);
  assert.equal(producer.identity.serial, input.target.deviceId);
  assert.equal(producer.identity.apiOrigin, input.target.apiOrigin);
  assert.equal(producer.identity.target.apiOrigin, input.target.apiOrigin);

  const invocations = new Set<string>();
  const commandOrdinals = new Set<number>();
  for (const frame of producer.frames) {
    relativeChild(frame.path, `Android camera ${frame.label} frame path`);
    requiredDigest(frame.sha256, `Android camera ${frame.label} frame hash`);
    assert(Number.isSafeInteger(frame.sizeBytes) && frame.sizeBytes > 0);
    const action = frame.action;
    assert.equal(action.label, frame.label);
    assert(typeof action.invocationId === 'string' && action.invocationId.length > 0);
    assert(!invocations.has(action.invocationId), 'Android camera frame invocation is duplicated');
    invocations.add(action.invocationId);
    assert(Number.isSafeInteger(action.ordinal) && action.ordinal >= 0);
    assert(Number.isSafeInteger(action.commandOrdinal) && action.commandOrdinal >= 0);
    assert(
      !commandOrdinals.has(action.commandOrdinal),
      'Android camera command ordinal is duplicated',
    );
    commandOrdinals.add(action.commandOrdinal);
    assert(typeof action.commandLabel === 'string' && action.commandLabel.length > 0);
  }

  const locale = producer.identity.locale as unknown as Record<string, unknown>;
  assert(locale && typeof locale === 'object' && !Array.isArray(locale));
  assert.equal(locale.requestedLocale, input.expectedLocale);
  const observed = locale.observedOsLocale;
  assert(observed && typeof observed === 'object' && !Array.isArray(observed));
  assert.equal((observed as Record<string, unknown>).resolved, input.expectedLocale);
  const app = locale.effectiveAppLocale;
  assert(app && typeof app === 'object' && !Array.isArray(app));
  assert.equal((app as Record<string, unknown>).value, input.expectedLocale);
  const binding = locale.binding;
  assert(binding && typeof binding === 'object' && !Array.isArray(binding));
  assert.equal((binding as Record<string, unknown>).captureRunId, input.captureRunId);

  const phases = new Set<string>();
  const canonicalSql = input.producer.sqlReceipts[0];
  assert(canonicalSql, 'Android camera SQL producer has no canonical receipt');
  for (const receipt of producer.sqlReceipts) {
    relativeChild(receipt.path, 'Android camera SQL path');
    assert(
      path.isAbsolute(receipt.parentSnapshotRoot) &&
        path.resolve(receipt.parentSnapshotRoot) === receipt.parentSnapshotRoot,
      'Android camera SQL parent root is not canonical',
    );
    assert.equal(receipt.parentManifestPath, 'manifest.json');
    relativeChild(receipt.parentManifestRetainedPath, 'Android retained parent manifest path');
    assert.notEqual(receipt.parentManifestRetainedPath, receipt.parentManifestPath);
    assert.equal(receipt.parentManifestRetainedKind, 'sidecar');
    requiredDigest(receipt.parentManifestRetainedSha256, 'Android retained parent manifest hash');
    assert.equal(receipt.parentManifestRetainedSizeBytes, receipt.parentManifestSizeBytes);
    assert.equal(receipt.parentManifestRetainedOwnerUid, process.getuid?.());
    assert.equal(receipt.parentManifestRetainedMode, 0o600);
    assert.equal(receipt.parentManifestRetainedVerification, 'owned-stable-reader-v6');
    relativeChild(receipt.parentSnapshotRetainedPath, 'Android camera retained parent path');
    assert.equal(receipt.parentSnapshotRetainedKind, 'sidecar');
    requiredDigest(receipt.parentSnapshotRetainedSha256, 'Android retained parent hash');
    assert.equal(receipt.parentSnapshotRetainedSizeBytes, receipt.parentSnapshotSizeBytes);
    assert.equal(receipt.parentSnapshotRetainedOwnerUid, process.getuid?.());
    assert.equal(receipt.parentSnapshotRetainedMode, 0o600);
    assert.equal(receipt.parentSnapshotRetainedVerification, 'owned-stable-reader-v6');
    assert(/^[a-z0-9-]{1,48}$/u.test(receipt.parentApiAttempt));
    relativeChild(receipt.parentApiLedgerPath, 'Android API ledger path');
    assert.equal(
      receipt.parentApiLedgerPath,
      receipt.parentApiAttempt === 'session-start'
        ? 'api-session-start.json'
        : `api-${receipt.parentApiAttempt}.json`,
    );
    relativeChild(receipt.parentApiLedgerRetainedPath, 'Android retained API ledger path');
    assert.notEqual(receipt.parentApiLedgerRetainedPath, receipt.parentApiLedgerPath);
    assert.equal(receipt.parentApiLedgerRetainedKind, 'sidecar');
    requiredDigest(receipt.parentApiLedgerRetainedSha256, 'Android retained API ledger hash');
    assert.equal(receipt.parentApiLedgerRetainedSizeBytes, receipt.parentApiLedgerSizeBytes);
    assert.equal(receipt.parentApiLedgerRetainedOwnerUid, process.getuid?.());
    assert.equal(receipt.parentApiLedgerRetainedMode, 0o600);
    assert.equal(receipt.parentApiLedgerRetainedVerification, 'owned-stable-reader-v6');
    relativeChild(receipt.parentSnapshotPath, 'Android camera SQL parent path');
    requiredDigest(receipt.sha256, 'Android camera SQL hash');
    requiredDigest(receipt.parentSnapshotSha256, 'Android camera SQL parent hash');
    assert.equal(receipt.kind, 'query');
    assert.equal(receipt.verification, 'owned-stable-reader-v6');
    assert.equal(receipt.mode, 0o600);
    assert.equal(receipt.parentRunId, input.fixtureRunId);
    assert.equal(receipt.parentBackendAttemptId, `${input.fixtureRunId}:first`);
    assert.equal(receipt.parentApiOrigin, input.target.apiOrigin);
    assert(Number.isSafeInteger(receipt.parentApiPid) && receipt.parentApiPid > 1);
    assert.equal(receipt.parentApiStarted, input.producer.identity.apiStarted);
    assert.equal(receipt.parentApiScript, input.producer.identity.apiScript);
    assert.equal(receipt.parentManifestSha256, canonicalSql.parentManifestSha256);
    assert.equal(receipt.parentApiAttempt, canonicalSql.parentApiAttempt);
    assert.equal(receipt.parentApiLedgerSha256, canonicalSql.parentApiLedgerSha256);
    assert(Number.isSafeInteger(receipt.parentSnapshotSizeBytes));
    phases.add(receipt.phase);
  }
  assert.deepEqual([...phases].sort(), [
    'before',
    'isolation-after',
    'isolation-before',
    'pending',
    'training-after',
    'training-before',
  ]);
}

function requireEligibilityResult(
  result: AndroidCameraRuntimeEligibilityResult,
  input: AndroidCameraRuntimeDispatchInput,
): void {
  assert.equal(result.kind, 'private-android-camera-runtime-eligibility-not-public-receipt');
  const sourceOnly = input.sourceOnlyTestLabel !== undefined;
  assert.equal(result.status, sourceOnly ? 'validated-source-only' : 'verified-native-private');
  assert.equal(result.verificationMode, sourceOnly ? 'source-only-control' : 'native-runtime');
  assert.equal(result.captureRunId, input.captureRunId);
  assert.equal(result.requestedRunId, input.requestedRunId);
  assert.equal(result.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.equal(result.fixtureRunId, input.fixtureRunId);
  assert.equal(result.sourceOnlyTestLabel, input.sourceOnlyTestLabel ?? null);
  assert.equal(result.nativePassingCases, sourceOnly ? 0 : 4);
  assert.equal(result.publicPassingCases, 0);
  assert.equal(result.publicPromotionEligible, false);
  assert.equal(result.stage.status, 'validated-source-only');
  assert.equal(result.stage.publicPromotionEligible, false);
  assert.equal(result.stage.nativePassingCases, 0);
  assert.equal(result.stage.publicPassingCases, 0);
  assert.deepEqual(result.stage.assertionIds, [...ANDROID_CAMERA_ASSERTION_IDS]);
  assert.deepEqual(result.assertionBindings, result.evidenceProof.assertionBindings);
  assert.deepEqual(result.stage, result.evidenceProof.stage);
  assert.deepEqual(
    result.assertionBindings.map((row) => row.id),
    [...ANDROID_CAMERA_ASSERTION_IDS],
  );
  assert.equal(result.evidenceProof.captureRunId, input.captureRunId);
  assert.equal(result.evidenceProof.fixtureRunId, input.fixtureRunId);
  assert.deepEqual(result.evidenceProof.target, input.target);
  if (sourceOnly) {
    assert.deepEqual(result.runtimeProvenance, {
      mode: 'source-only-control',
      label: input.sourceOnlyTestLabel,
    });
  } else {
    assert.deepEqual(result.runtimeProvenance, input.runtimeProvenance);
    assert(
      result.evidenceProof.nativeDriver,
      'native eligibility proof is missing the acquired driver',
    );
  }
}

/**
 * Dispatches one already-completed Android camera attempt through the sealed
 * original-receipt verifier and its canonical stager. Source fixtures require
 * a sealed source-only label; an actual runtime caller must instead provide the
 * producer-written native provenance receipt.
 */
export async function dispatchAndroidCameraRuntime(
  input: AndroidCameraRuntimeDispatchInput,
): Promise<AndroidCameraRuntimeDispatchResult> {
  if (input.sourceOnlyTestLabel !== undefined) {
    privateLabel(input.sourceOnlyTestLabel);
    assert.equal(
      input.runtimeProvenance,
      undefined,
      'source-only dispatch cannot carry native provenance',
    );
  } else {
    assert(input.runtimeProvenance, 'Android camera runtime dispatch requires native provenance');
    assert.equal(
      input.runtime,
      null,
      'native dispatch cannot relabel a source-only runtime attempt',
    );
    requireNativeDriverIdentity(input);
  }
  requireRunId(input.requestedRunId, 'Android camera requested run ID');
  requireRunId(input.captureRunId, 'Android camera capture run ID');
  requireRunId(input.fixtureRunId, 'Android camera fixture run ID');
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  if (input.sourceOnlyTestLabel !== undefined) {
    assert(input.runtime);
    assert.equal(input.captureRunId, input.runtime.captureRunId);
    assert.equal(input.fixtureRunId, input.runtime.fixtureRunId);
  } else {
    assert(input.nativeDriver);
    assert.equal(input.captureRunId, input.nativeDriver.captureRunId);
    assert.equal(input.fixtureRunId, input.nativeDriver.fixtureRunId);
  }
  assert.equal(input.selection.arguments.platform, 'android');
  assert.equal(input.selection.arguments.engine, 'maestro');
  assert.equal(input.selection.arguments.scenario, ANDROID_CAMERA_SCENARIO);
  assert.equal(input.selection.arguments.mode, 'integration');
  requireAndroidCameraSelectionShape(input.selection);
  requireDeadline(input.signal, input.deadlineAt, 'Android camera dispatch');

  const captureRoot = await requireOwnedPrivateDirectory(
    input.captureRoot,
    'Android camera capture root',
  );
  const outputRoot = await requireOwnedPrivateDirectory(
    input.outputRoot,
    'Android camera output root',
  );
  assert.notEqual(captureRoot, outputRoot, 'Android camera capture/output roots must be distinct');
  if (input.sourceOnlyTestLabel !== undefined) {
    assert(input.runtime);
    assert.equal(path.resolve(input.runtime.artifactRoot), captureRoot);
  }

  const producer =
    input.sourceOnlyTestLabel !== undefined ? requireTerminalAttempt(input) : input.producer;
  if (input.sourceOnlyTestLabel === undefined) requireNativeDriverIdentity(input);
  // This is the current producer envelope guard used by the real emitter.  It
  // intentionally runs before the verifier and rejects caller-made summaries.
  requireAndroidCameraProducerOutput(producer, {
    selectionHash: androidCameraSelectionHash(input.selection),
    runId: input.captureRunId,
  });
  requireProducerProvenance(producer, input);
  await requireCaptureOwnerBinding(captureRoot, input.captureRunId, producer, input.signal);
  requireDeadline(input.signal, input.deadlineAt, 'Android camera dispatch before verification');

  const verifier = input.verifier ?? verifyAndroidCameraRuntimeEligibility;
  const eligibility = await verifier({
    ...input,
    producer,
    signal: input.signal,
    deadlineAt: input.deadlineAt,
    sourceOnlyTestLabel: input.sourceOnlyTestLabel,
    runtimeProvenance: input.runtimeProvenance,
  });
  requireDeadline(input.signal, input.deadlineAt, 'Android camera dispatch after verification');
  requireEligibilityResult(eligibility, input);

  return {
    kind: 'private-owned-android-camera-runtime-dispatch-not-public-receipt',
    status: eligibility.status,
    verificationMode: eligibility.verificationMode,
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRunId: input.captureRunId,
    fixtureRunId: input.fixtureRunId,
    producerCaptureRunId: producer.captureRunId,
    stageManifestPath: eligibility.stage.copyManifest.path,
    assertionBindings: eligibility.assertionBindings,
    eligibility,
    runtimeProvenance: eligibility.runtimeProvenance,
    nativePassingCases: eligibility.nativePassingCases,
    publicPassingCases: eligibility.publicPassingCases,
    publicPromotionEligible: eligibility.publicPromotionEligible,
  };
}
