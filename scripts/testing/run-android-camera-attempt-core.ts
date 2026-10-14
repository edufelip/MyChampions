import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  ANDROID_CAMERA_ASSERTION_IDS,
  ANDROID_CAMERA_SCENARIO,
  androidCameraSelectionHash,
  requireAndroidCameraIdentityBoundary,
  type AndroidCameraRuntimeIdentity,
} from './native-camera-android-contract';
import {
  androidCameraBlockedGates,
  requireAndroidCameraRuntimeIdentity,
} from './native-camera-android-observation';
import { requireNativePilotAssertions, type NativePilotSelection } from './native-pilot-contract';

const RUN_ID = /^[a-f0-9]{24}$/u;

export type AndroidCameraCleanupEvidence = {
  status: 'cleaned';
  verified: true;
  runId: string;
  ownerRunId: string;
  resources: readonly string[];
  independentCensus: {
    status: 'complete';
    foreignResources: readonly string[];
  };
};

export type AndroidCameraExecutionResult = {
  /** The actual public caller boundary, retained separately from every owned resource. */
  requestedRunId: string;
  captureRunId: string;
  identity: AndroidCameraRuntimeIdentity;
  producerStatus: 'receipts-bound';
  sourceSelectionHash: string;
  localeStatus: 'qualified';
  cleanup: AndroidCameraCleanupEvidence;
};

export type AndroidCameraAttemptResultV4Core = {
  kind: 'private-owned-android-camera-v4-attempt';
  status: 'source-only' | 'harness-blocked' | 'cancelled';
  requestedRunId: string;
  captureRunId: string | null;
  callbackInvocations: number;
  runtimeQualification: 'Pending';
  publicPromotionEligible: false;
  nativePassingCases: 0;
  cleanup: 'not-acquired' | 'cleaned' | 'failed-recovery-retained';
  blockedGates: readonly { gate: string; status: 'blocked'; reason: string }[];
  errorName: string | null;
};

export type AndroidCameraAttemptOptionsV4Core = {
  repositoryRoot: string;
  requestedRunId: string;
  selection: NativePilotSelection;
  signal: AbortSignal;
  execute?: (input: {
    requestedRunId: string;
    selection: NativePilotSelection;
    signal: AbortSignal;
  }) => Promise<AndroidCameraExecutionResult>;
};

function requireRunId(value: unknown, label: string): string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
  return value;
}

function requireSelection(selection: NativePilotSelection): void {
  assert.deepEqual(selection.arguments, {
    platform: 'android',
    engine: 'maestro',
    scenario: ANDROID_CAMERA_SCENARIO,
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, ANDROID_CAMERA_SCENARIO);
  assert.equal(selection.scenario.platform, 'android');
  assert.equal(selection.scenario.flowId, 'FLW-camera-denied');
  const ledger = requireNativePilotAssertions(selection);
  assert.deepEqual(
    ledger.map((row) => row.id),
    ANDROID_CAMERA_ASSERTION_IDS,
  );
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 128) : 'UnknownError';
}

function requireCleanup(
  value: AndroidCameraCleanupEvidence,
  expected: { runId: string; ownerRunId: string },
): void {
  assert.equal(value.status, 'cleaned');
  assert.equal(value.verified, true);
  assert.equal(value.runId, expected.runId);
  assert.equal(value.ownerRunId, expected.ownerRunId);
  assert.deepEqual(value.independentCensus, {
    status: 'complete',
    foreignResources: [],
  });
}

/**
 * A future source adapter may call this seam after it has acquired the owned
 * target.  The seam is deliberately non-qualifying: missing producer,
 * locale, source closure, API, SQL or cleanup receipts always remain blocked.
 */
export async function runAndroidCameraAttemptV4Core(
  options: AndroidCameraAttemptOptionsV4Core,
): Promise<AndroidCameraAttemptResultV4Core> {
  requireRunId(options.requestedRunId, 'Android camera requested run ID');
  assert(
    path.isAbsolute(options.repositoryRoot),
    'Android camera repository root must be absolute',
  );
  assert.equal(
    await realpath(options.repositoryRoot),
    options.repositoryRoot,
    'Android camera repository root is not canonical',
  );
  requireSelection(options.selection);
  options.signal.throwIfAborted();
  if (!options.execute)
    return {
      kind: 'private-owned-android-camera-v4-attempt',
      status: 'harness-blocked',
      requestedRunId: options.requestedRunId,
      captureRunId: null,
      callbackInvocations: 0,
      runtimeQualification: 'Pending',
      publicPromotionEligible: false,
      nativePassingCases: 0,
      cleanup: 'not-acquired',
      blockedGates: androidCameraBlockedGates(),
      errorName: 'AndroidCameraProducerUnavailable',
    };
  let callbackInvocations = 0;
  let execution: AndroidCameraExecutionResult | null = null;
  let cleanup: AndroidCameraAttemptResultV4Core['cleanup'] = 'not-acquired';
  let failure: string | null = null;
  let status: AndroidCameraAttemptResultV4Core['status'] = 'source-only';
  try {
    callbackInvocations++;
    assert.equal(callbackInvocations, 1);
    execution = await options.execute({
      requestedRunId: options.requestedRunId,
      selection: options.selection,
      signal: options.signal,
    });
    options.signal.throwIfAborted();
    assert.equal(execution.producerStatus, 'receipts-bound');
    assert.equal(
      requireRunId(execution.requestedRunId, 'Android execution requested run ID'),
      options.requestedRunId,
      'Android execution requested run is not bound to the public caller',
    );
    requireRunId(execution.captureRunId, 'Android capture run ID');
    assert.equal(execution.sourceSelectionHash, androidCameraSelectionHash(options.selection));
    assert.equal(execution.localeStatus, 'qualified');
    const identity = requireAndroidCameraRuntimeIdentity(execution.identity);
    assert.equal(
      identity.captureRunId,
      execution.captureRunId,
      'Android producer capture run is not bound to the execution capture root',
    );
    requireAndroidCameraIdentityBoundary({
      requestedRunId: options.requestedRunId,
      captureRunId: identity.captureRunId,
      ownerRunId: identity.ownerRunId,
      backendRunId: identity.backendRunId,
    });
    requireCleanup(execution.cleanup, {
      runId: identity.backendRunId,
      ownerRunId: identity.ownerRunId,
    });
    cleanup = 'cleaned';
  } catch (error) {
    failure = errorName(error);
    status = options.signal.aborted ? 'cancelled' : 'harness-blocked';
  }
  if (options.signal.aborted) status = 'cancelled';
  return {
    kind: 'private-owned-android-camera-v4-attempt',
    status,
    requestedRunId: options.requestedRunId,
    captureRunId: execution?.captureRunId ?? null,
    callbackInvocations,
    runtimeQualification: 'Pending',
    publicPromotionEligible: false,
    nativePassingCases: 0,
    cleanup,
    blockedGates: androidCameraBlockedGates(),
    errorName: failure,
  };
}
