import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readNativeEvidenceObservation, type NativeEvidenceIdentity } from './native-view-evidence';
import { assertPublicReceipt } from './schema-validation';
import {
  normalizeT15AndroidDetoxSessionLifecycle,
  type T15AndroidSessionLifecycleExpectation,
  type T15AndroidSessionLifecycleNormalization,
} from './t15-detox-android-session-normalization';
import { t15DetoxSharedLifecycleContract } from './t15-detox-cold-lifecycle';
import type {
  NativeComparisonOwnershipWindow,
  NativeComparisonReceiptInput,
} from './compare-native-pilot';
import type { DetoxBaselineReport } from './detox-integrated-session-baseline';
import type { AndroidDetoxSessionNativePilotAttempt } from './native-detox-android-session-native-pilot-route';
import type { NativePilotSelection, NativePilotTarget } from './native-pilot-contract';

type Row = Record<string, unknown>;

const ZERO_HASH = '0'.repeat(64);

export type T15AndroidSessionSharedLifecycleReconciliation = Readonly<{
  status: 'blocked' | 'sealed-contract-compatible';
  identityMode: 'android-split' | 'sealed-shared';
  contract: Readonly<{
    sameOwnerRunId: boolean;
    bindsOriginalResetReceipt: boolean;
    bindsTargetBackendFixture: boolean;
    requiresClosedOwnershipWindows: boolean;
    requiresCleanupBeforeReceipt: boolean;
  }>;
  blockers: readonly string[];
}>;

export type AndroidDetoxSessionPublicReceiptBridgeResult = Readonly<{
  status: 'normalized' | 'blocked';
  receiptPath: string;
  receiptHash: string | null;
  publicReceipt: NativeComparisonReceiptInput | null;
  receiptIdentity: NativeEvidenceIdentity | null;
  normalization: T15AndroidSessionLifecycleNormalization;
  sharedLifecycle: T15AndroidSessionSharedLifecycleReconciliation;
  blockers: readonly string[];
}>;

export type AndroidDetoxSessionOuterReceiptMutable = {
  result: string;
  exitCode: number;
  assertions: unknown[];
  blocker?: unknown;
};

type BridgeInput = Readonly<{
  outputRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  runtimeTarget: NativePilotTarget;
  expectedFixtureHash: string | null;
  expectedFlagsHash: string | null;
  expectedToolVersions: Readonly<Record<string, string>>;
  runtime: AndroidDetoxSessionNativePilotAttempt;
  /** In-memory prepublication candidate used to gate a native outer pass. */
  candidateReceipt?: unknown;
}>;

function record(value: unknown, label: string): Row {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is malformed`);
  return value as Row;
}

function text(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is missing`);
  assert(!/[\0\r\n]/u.test(value), `${label} contains a control character`);
  return value;
}

function blocker(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 256);
}

function readPrivateJson(root: string, relative: string, label: string): Row {
  const observation = readNativeEvidenceObservation(root, relative, true);
  try {
    return record(JSON.parse(observation.bytes.toString('utf8')), label);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${blocker(error)}`);
  }
}

function readPrivateAbsoluteJson(root: string, value: unknown, label: string): Row {
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(text(value, `${label} path`));
  assert.equal(path.dirname(candidate), absoluteRoot, `${label} escaped its capture root`);
  return readPrivateJson(absoluteRoot, path.basename(candidate), label);
}

function sameOptionalField(value: Row, field: string, expected: unknown, label: string): void {
  if (expected !== null && expected !== undefined) assert.equal(value[field], expected, label);
}

function requireOuterReceiptIdentity(input: {
  receipt: unknown;
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  runtimeTarget: NativePilotTarget;
  expectedFixtureHash: string | null;
  expectedFlagsHash: string | null;
  expectedToolVersions: Readonly<Record<string, string>>;
}): void {
  const value = record(input.receipt, 'outer Android Detox receipt');
  assert.equal(value.runId, input.requestedRunId);
  assert.equal(value.attemptId, input.requestedAttemptId);
  assert.equal(value.scenarioId, input.selection.scenario.id);
  assert.equal(value.phase, 'P4');
  assert.equal(value.layer, 'native');
  assert.equal(value.engine, 'detox');
  assert.equal(value.platform, 'android');
  assert.equal(value.dataMode, 'postgres');
  const target = record(value.target, 'outer Android Detox receipt target');
  for (const field of [
    'deviceId',
    'osVersion',
    'appId',
    'buildProfile',
    'binaryHash',
    'apiOrigin',
  ] as const)
    sameOptionalField(
      target,
      field,
      input.runtimeTarget[field],
      `outer receipt target.${field} differs from the owned route target`,
    );
  const inputs = record(value.inputs, 'outer Android Detox receipt inputs');
  assert.equal(inputs.scenarioHash, input.selection.scenarioHash);
  assert.equal(inputs.requirementHash, input.selection.requirementHash);
  sameOptionalField(
    inputs,
    'fixtureHash',
    input.expectedFixtureHash,
    'outer receipt fixture fingerprint differs from the owned session',
  );
  sameOptionalField(
    inputs,
    'flagsHash',
    input.expectedFlagsHash,
    'outer receipt flags fingerprint differs from the qualified build',
  );
  const toolVersions = record(inputs.toolVersions, 'outer Android Detox receipt tool versions');
  for (const [key, expected] of Object.entries(input.expectedToolVersions))
    assert.equal(toolVersions[key], expected, `outer receipt tool version differs for ${key}`);
}

/**
 * Read the terminal receipt that the outer native-pilot writer actually
 * published. The adapter receipt and private staging links are deliberately
 * rejected by the public schema and can never be returned from this bridge.
 */
export function readAndroidDetoxSessionOuterPublicReceipt(input: {
  outputRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  runtimeTarget: NativePilotTarget;
  expectedFixtureHash: string | null;
  expectedFlagsHash: string | null;
  expectedToolVersions: Readonly<Record<string, string>>;
}): {
  receipt: NativeComparisonReceiptInput;
  identity: NativeEvidenceIdentity;
} {
  const outputRoot = path.resolve(input.outputRoot);
  const observation = readNativeEvidenceObservation(outputRoot, 'receipt.json', true);
  let receipt: unknown;
  try {
    receipt = JSON.parse(observation.bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`outer receipt JSON is invalid: ${blocker(error)}`);
  }
  assertPublicReceipt(receipt, outputRoot);
  requireOuterReceiptIdentity({ ...input, receipt });
  const receiptPath = path.join(outputRoot, 'receipt.json');
  return {
    receipt: {
      path: receiptPath,
      artifactRoot: outputRoot,
      receipt,
      receiptHash: createHash('sha256').update(observation.bytes).digest('hex'),
      terminalPublicationBinding: null,
    },
    identity: observation.identity,
  };
}

function expectationFromReset(
  reset: Row | null,
  requestedRunId: string,
  requestedAttemptId: string,
): T15AndroidSessionLifecycleExpectation {
  return {
    requestedRunId,
    requestedAttemptId,
    fixtureResetId:
      typeof reset?.fixtureResetId === 'string' ? reset.fixtureResetId : 'reset-receipt-missing',
    cohortFixtureFingerprint:
      typeof reset?.cohortFixtureFingerprint === 'string'
        ? reset.cohortFixtureFingerprint
        : ZERO_HASH,
    sourceFingerprint:
      typeof reset?.sourceFingerprint === 'string' ? reset.sourceFingerprint : ZERO_HASH,
    helperFingerprint:
      typeof reset?.helperFingerprint === 'string' ? reset.helperFingerprint : ZERO_HASH,
  };
}

function sharedContractProjection(
  status: T15AndroidSessionLifecycleNormalization['status'],
  identity: T15AndroidSessionLifecycleNormalization['identity'],
): T15AndroidSessionSharedLifecycleReconciliation {
  if (
    status === 'private-candidate' &&
    identity &&
    identity.resourceOwnerRunId === identity.requestedRunId &&
    identity.backendRunId === identity.requestedRunId
  )
    return {
      status: 'sealed-contract-compatible',
      identityMode: 'sealed-shared',
      contract: {
        sameOwnerRunId: t15DetoxSharedLifecycleContract.sameOwnerRunId,
        bindsOriginalResetReceipt: t15DetoxSharedLifecycleContract.bindsOriginalResetReceipt,
        bindsTargetBackendFixture: t15DetoxSharedLifecycleContract.bindsTargetBackendFixture,
        requiresClosedOwnershipWindows:
          t15DetoxSharedLifecycleContract.requiresClosedOwnershipWindows,
        requiresCleanupBeforeReceipt: t15DetoxSharedLifecycleContract.requiresCleanupBeforeReceipt,
      },
      blockers: [],
    };
  return blockedSharedLifecycle([
    'sealed-shared-lifecycle-expects-backend-run-to-equal-resource-owner-run',
    'android-route-keeps-request-capture-resource-owner-target-and-backend-identities-distinct',
  ]);
}

function blockedSharedLifecycle(
  blockers: readonly string[],
): T15AndroidSessionSharedLifecycleReconciliation {
  return {
    status: 'blocked',
    identityMode: 'android-split',
    contract: {
      sameOwnerRunId: t15DetoxSharedLifecycleContract.sameOwnerRunId,
      bindsOriginalResetReceipt: t15DetoxSharedLifecycleContract.bindsOriginalResetReceipt,
      bindsTargetBackendFixture: t15DetoxSharedLifecycleContract.bindsTargetBackendFixture,
      requiresClosedOwnershipWindows:
        t15DetoxSharedLifecycleContract.requiresClosedOwnershipWindows,
      requiresCleanupBeforeReceipt: t15DetoxSharedLifecycleContract.requiresCleanupBeforeReceipt,
    },
    blockers,
  };
}

/**
 * Project one normalized route into the sealed contract without changing its
 * identity. The current Android route must remain blocked because its real
 * backend and resource-owner namespaces are intentionally distinct.
 */
export function reconcileT15AndroidSessionSharedLifecycle(
  input: Pick<T15AndroidSessionLifecycleNormalization, 'status' | 'identity'>,
): T15AndroidSessionSharedLifecycleReconciliation {
  return sharedContractProjection(input.status, input.identity);
}

/**
 * Reconcile the real Android route after outer publication. This function
 * consumes the route's reread private ledgers and the exact published receipt;
 * it never creates a receipt or maps one identity namespace onto another.
 */
export function reconcileT15AndroidDetoxSessionOuterReceipt(
  input: BridgeInput,
): AndroidDetoxSessionPublicReceiptBridgeResult {
  const outputRoot = path.resolve(input.outputRoot);
  const receiptPath = path.join(outputRoot, 'receipt.json');
  const blockers: string[] = [];
  let publicReceipt: NativeComparisonReceiptInput | null = null;
  let receiptIdentity: NativeEvidenceIdentity | null = null;
  let receiptHash: string | null = null;
  try {
    if (input.candidateReceipt !== undefined) {
      // A candidate is useful for checking the request shape before the first
      // publication, but it is never a public binding. In particular, do not
      // project its in-memory bytes into publicReceipt or receiptHash: the
      // outer contract is bound only by rereading receipt.json after the
      // protected terminal writer returns.
      assertPublicReceipt(input.candidateReceipt, outputRoot);
      requireOuterReceiptIdentity({
        receipt: input.candidateReceipt,
        requestedRunId: input.requestedRunId,
        requestedAttemptId: input.requestedAttemptId,
        selection: input.selection,
        runtimeTarget: input.runtimeTarget,
        expectedFixtureHash: input.expectedFixtureHash,
        expectedFlagsHash: input.expectedFlagsHash,
        expectedToolVersions: input.expectedToolVersions,
      });
      blockers.push('outer-public-receipt-not-published');
    } else {
      const published = readAndroidDetoxSessionOuterPublicReceipt({
        outputRoot,
        requestedRunId: input.requestedRunId,
        requestedAttemptId: input.requestedAttemptId,
        selection: input.selection,
        runtimeTarget: input.runtimeTarget,
        expectedFixtureHash: input.expectedFixtureHash,
        expectedFlagsHash: input.expectedFlagsHash,
        expectedToolVersions: input.expectedToolVersions,
      });
      publicReceipt = published.receipt;
      receiptIdentity = published.identity;
      receiptHash = published.receipt.receiptHash;
    }
  } catch (error) {
    blockers.push(`outer-public-receipt:${blocker(error)}`);
  }

  let report: DetoxBaselineReport;
  try {
    report = readPrivateJson(
      input.runtime.artifactRoot,
      'detox-integrated-session-baseline.private.json',
      'Detox baseline report',
    ) as unknown as DetoxBaselineReport;
  } catch (error) {
    blockers.push(`baseline-report:${blocker(error)}`);
    return {
      status: 'blocked',
      receiptPath,
      receiptHash,
      publicReceipt,
      receiptIdentity,
      normalization: input.runtime.lifecycleNormalization,
      sharedLifecycle: blockedSharedLifecycle([
        'android-session-baseline-report-unavailable',
        'sealed-shared-lifecycle-reconciliation-not-run',
      ]),
      blockers,
    };
  }

  let resetReceipt: Row | null = null;
  try {
    if (report.coldReset.receiptPath !== null)
      resetReceipt = readPrivateAbsoluteJson(
        input.runtime.artifactRoot,
        report.coldReset.receiptPath,
        'Android cold reset original receipt',
      );
  } catch (error) {
    blockers.push(`reset-receipt:${blocker(error)}`);
  }

  let captureLedger: Row | null = null;
  try {
    captureLedger = readPrivateJson(
      input.runtime.artifactRoot,
      'capture-final.private.json',
      'Detox capture-final ledger',
    );
  } catch (error) {
    blockers.push(`capture-ledger:${blocker(error)}`);
  }
  let cleanupLedger: Row | null = null;
  try {
    cleanupLedger = readPrivateJson(
      input.runtime.artifactRoot,
      'cleanup-final.private.json',
      'Detox cleanup-final ledger',
    );
  } catch (error) {
    blockers.push(`cleanup-ledger:${blocker(error)}`);
  }

  const normalization = normalizeT15AndroidDetoxSessionLifecycle({
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRunId: input.runtime.captureRunId,
    resourceOwnerRunId: input.runtime.resourceOwnerRunId,
    expectation: expectationFromReset(resetReceipt, input.requestedRunId, input.requestedAttemptId),
    report,
    resetReceipt,
    captureLedger,
    cleanupLedger,
    publicReceipt,
  });

  const sharedLifecycle = reconcileT15AndroidSessionSharedLifecycle(normalization);
  if (normalization.status !== 'private-candidate')
    blockers.push(`lifecycle-normalization:${normalization.status}`);
  if (normalization.publicConsumer.status !== 'normalized')
    blockers.push(...normalization.publicConsumer.blockers.map((value) => `public:${value}`));
  if (normalization.cleanup.status !== 'closed')
    blockers.push(...normalization.cleanup.blockers.map((value) => `cleanup:${value}`));
  blockers.push(...sharedLifecycle.blockers.map((value) => `shared:${value}`));
  return {
    status: blockers.length === 0 ? 'normalized' : 'blocked',
    receiptPath,
    receiptHash,
    publicReceipt,
    receiptIdentity,
    normalization,
    sharedLifecycle,
    blockers,
  };
}

/**
 * Apply the result of the protected, post-publication reread to the mutable
 * outer receipt. A private candidate can never grant terminal credit. Once a
 * real receipt has been published, any failed bridge invariant must be made
 * durable as a blocked terminal row with a nonzero exit code.
 */
export function blockAndroidDetoxSessionOuterReceiptForBridgeFailure(
  receipt: AndroidDetoxSessionOuterReceiptMutable,
  bridge: Pick<
    AndroidDetoxSessionPublicReceiptBridgeResult,
    'status' | 'publicReceipt' | 'normalization' | 'sharedLifecycle' | 'blockers'
  >,
): boolean {
  const qualified = isQualifiedAndroidDetoxSessionOuterReceiptBridge(bridge);
  if (qualified) return false;
  receipt.result = 'harness-blocked';
  receipt.exitCode = 2;
  receipt.assertions = [];
  receipt.blocker = {
    code: 'android-detox-session-outer-receipt-unverified',
    detail:
      (Array.isArray(bridge.blockers) ? bridge.blockers : []).length > 0
        ? `The protected Android Detox session receipt bridge remained blocked: ${(Array.isArray(bridge.blockers) ? bridge.blockers : []).join('; ')}`
        : 'The protected Android Detox session receipt bridge did not reach a sealed compatible lifecycle.',
    owner: 'client/server maintainer',
    nextAction:
      'Retain the published receipt and private reset, capture and cleanup ledgers; repair the binding before a fresh attempt.',
  };
  return true;
}

/** Promote only the explicit provisional row after the protected reread passes. */
export function promoteAndroidDetoxSessionOuterReceiptAfterBridge(
  receipt: AndroidDetoxSessionOuterReceiptMutable,
  bridge: Pick<
    AndroidDetoxSessionPublicReceiptBridgeResult,
    'status' | 'publicReceipt' | 'normalization' | 'sharedLifecycle' | 'blockers'
  >,
): boolean {
  if (!isQualifiedAndroidDetoxSessionOuterReceiptBridge(bridge)) return false;
  const blocker = receipt.blocker;
  if (
    !blocker ||
    typeof blocker !== 'object' ||
    (blocker as { code?: unknown }).code !== 'android-detox-session-outer-receipt-pending'
  )
    return false;
  receipt.result = 'passed';
  receipt.exitCode = 0;
  receipt.blocker = null;
  return true;
}

function isQualifiedAndroidDetoxSessionOuterReceiptBridge(
  bridge: Pick<
    AndroidDetoxSessionPublicReceiptBridgeResult,
    'status' | 'publicReceipt' | 'normalization' | 'sharedLifecycle' | 'blockers'
  >,
): boolean {
  return (
    bridge.status === 'normalized' &&
    bridge.publicReceipt != null &&
    bridge.normalization?.status === 'private-candidate' &&
    bridge.sharedLifecycle?.status === 'sealed-contract-compatible'
  );
}

export function requireT15AndroidSessionClosedOwnershipWindows(
  value: readonly NativeComparisonOwnershipWindow[],
): void {
  assert(value.some((row) => row.resourceType === 'process'));
  assert(value.some((row) => row.resourceType === 'port'));
}
