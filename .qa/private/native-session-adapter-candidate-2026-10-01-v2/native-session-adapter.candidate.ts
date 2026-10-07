import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  nativeSessionAssertionIds,
  requireNativePilotAssertions,
} from '../../../scripts/testing/native-pilot-contract';
import type { NativePilotSelection } from '../../../scripts/testing/native-pilot-contract';
import type { ProxyObservation } from '../../../scripts/testing/owned-api-proxy';
import type { OwnedDomainSnapshot } from '../../../scripts/testing/owned-session';
import { assertTestingDocument } from '../../../scripts/testing/schema-validation';

/**
 * Candidate-only input for the explicit `session` capture charter. The legacy
 * `auth-account` diagnostic is intentionally outside this contract.
 */
export type IosAuthMetadataCandidate = {
  status: 'manifest-absent' | 'session-absent' | 'session-present';
  sessionPresent: boolean;
  profilePresent?: boolean;
  expiryPresent?: boolean;
  plaintextAccessTokenPresent?: boolean;
  plaintextRefreshTokenPresent?: boolean;
};

export type IosSessionObservationCandidate = {
  viewId: string;
  hierarchyPath: string;
  screenshotPath: string;
};

type SessionSqlReceiptCandidate = {
  path: string;
  runId: string;
  scope: string;
  sha256: string;
};

type SessionInitialAuthCandidate = {
  actor: 'coach';
  actorAuthUid: string;
  apiPid: number;
  targetOrigin: string;
  authRequestId: number;
  afterRequestId: number;
};

export type IosSessionCaptureCandidate = {
  kind: 'private-native-inventory-observation-not-behavior-attempt';
  mode: 'inventory';
  platform: 'ios';
  charter: 'session';
  result: 'observed';
  cleanup: 'cleaned';
  nativePassingCases: 0;
  observations: readonly IosSessionObservationCandidate[];
  sessionUiObservationOrder: readonly string[];
  sessionAssertionSequence: readonly string[];
  sessionInitialAuth: SessionInitialAuthCandidate;
  authMetadataBeforeRelaunch: IosAuthMetadataCandidate;
  authMetadataAfterRelaunch: IosAuthMetadataCandidate;
  authMetadataAfterSignout: IosAuthMetadataCandidate;
  authMetadataAfterSignedoutRelaunch: IosAuthMetadataCandidate;
  relaunchTransport: readonly ProxyObservation[];
  signedOutRelaunchTransport: readonly ProxyObservation[];
  signedOutRelaunchTransportRange: {
    startOrdinal: number;
    endOrdinalExclusive: number;
    firstRequestId: number | null;
    lastRequestId: number | null;
  };
  sessionSqlBefore: SessionSqlReceiptCandidate;
  sessionSqlAfterSignedoutRelaunch: SessionSqlReceiptCandidate;
  sessionSqlBeforeAfterUnchanged: true;
  nativeLogoutContract: {
    requirementRefs: readonly string[];
    scope: 'local-native-session-clear';
    serverRevocationQualified: false;
  };
};

export type IosSessionAdapterCandidateInput = {
  selection: NativePilotSelection;
  capture: IosSessionCaptureCandidate;
  transportObservations: readonly ProxyObservation[];
  sessionSqlBefore: OwnedDomainSnapshot;
  sessionSqlAfterSignedoutRelaunch: OwnedDomainSnapshot;
};

export type IosSessionAdapterCandidateResult = {
  kind: 'private-ios-session-adapter-candidate-not-public-receipt';
  charter: 'session';
  assertionIds: readonly string[];
  nativePassingCases: 0;
  serverRevocationQualified: false;
  evidence: {
    ui: {
      paths: readonly string[];
      requiredViews: readonly string[];
      orderedLabels: readonly string[];
    };
    api: {
      signInRequestIds: readonly number[];
      restorationHydrateRequestIds: readonly number[];
      signedOutRelaunchAuthRequestIds: readonly number[];
    };
    storage: {
      restoredSessionPresent: true;
      clearedAfterSignout: true;
      clearedAfterSignedOutRelaunch: true;
      plaintextTokensPresent: false;
    };
    sql: {
      unchangedTrainingPlans: true;
      unchangedConnections: true;
      authSessionRowsOutsideDeclaredDomainScope: true;
    };
  };
};

const routeHash = (route: string) => createHash('sha256').update(route).digest('hex');
const signInPathHash = routeHash('/auth/email/sign-in');
const hydratePathHash = routeHash('/me/hydrate');

const requiredUiLabels = Object.freeze([
  'entry',
  'password-save-prompt',
  'coach-home',
  'restored-home',
  'account',
  'restored-identity',
  'signout-confirm',
  'cancel-signout',
  'signout-reopen',
  'signout-confirmed',
  'signed-out-relaunch',
] as const);

const requiredUiPaths = Object.freeze([
  'entry-hierarchy.json',
  'password-save-prompt-hierarchy.json',
  'coach-home-hierarchy.json',
  'restored-home-hierarchy.json',
  'account-hierarchy.json',
  'restored-identity-hierarchy.json',
  'signout-confirm-hierarchy.json',
  'cancel-signout-hierarchy.json',
  'signout-reopen-hierarchy.json',
  'signout-confirmed-hierarchy.json',
  'signed-out-relaunch-hierarchy.json',
] as const);

function requireMetadata(
  metadata: IosAuthMetadataCandidate,
  expectedPresent: boolean,
  label: string,
) {
  assert.equal(metadata.sessionPresent, expectedPresent, `${label} session presence changed`);
  if (!expectedPresent) {
    assert.equal(metadata.status, 'session-absent', `${label} metadata status changed`);
    return;
  }
  assert.equal(metadata.status, 'session-present', `${label} metadata status changed`);
  assert.equal(metadata.profilePresent, true, `${label} profile metadata is absent`);
  assert.equal(metadata.expiryPresent, true, `${label} expiry metadata is absent`);
  assert.equal(metadata.plaintextAccessTokenPresent, false, `${label} access token was exposed`);
  assert.equal(metadata.plaintextRefreshTokenPresent, false, `${label} refresh token was exposed`);
}

function requireNativeObservation(row: ProxyObservation, label: string) {
  assert.equal(row.requestProfile, 'native', `${label} request is not native`);
  assert.equal(row.outcome, 'forwarded', `${label} request was not forwarded`);
}

function requireDomainSnapshotIdentity(snapshot: OwnedDomainSnapshot, label: string) {
  assertTestingDocument('domain-snapshot-v1', snapshot);
  assert.equal(snapshot.schemaVersion, 1, `${label} SQL snapshot schema changed`);
  assert.equal(snapshot.readOnly, true, `${label} SQL snapshot is not read-only`);
  assert.match(snapshot.runId, /^[a-f0-9]{24}$/, `${label} SQL snapshot run identity is invalid`);
  assert.equal(snapshot.scope, 'native-entry-ios', `${label} SQL snapshot scope changed`);
}

function requireUnrelatedDomainStateUnchanged(
  before: OwnedDomainSnapshot,
  after: OwnedDomainSnapshot,
) {
  requireDomainSnapshotIdentity(before, 'before');
  requireDomainSnapshotIdentity(after, 'after');
  assert.equal(after.runId, before.runId, 'SQL snapshot run identity changed');
  assert.equal(after.scope, before.scope, 'SQL snapshot scope changed');
  assert.deepEqual(after.trainingPlans, before.trainingPlans, 'Unrelated training plans changed');
  assert.deepEqual(after.connections, before.connections, 'Unrelated connections changed');
}

function requireSessionSelection(selection: NativePilotSelection) {
  assert.deepEqual(selection.arguments, {
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-session-ios',
    mode: 'integration',
  });
  assert.equal(selection.scenario.flowId, 'FLW-session');
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    nativeSessionAssertionIds,
  );
}

function requireSessionLedger(capture: IosSessionCaptureCandidate) {
  assert.deepEqual(
    capture.sessionAssertionSequence,
    nativeSessionAssertionIds,
    'Native session assertion sequence is not canonical',
  );
  assert.equal(capture.sessionSqlBeforeAfterUnchanged, true);
  assert.equal(capture.sessionInitialAuth.actor, 'coach');
  assert.match(capture.sessionInitialAuth.actorAuthUid, /^.+$/);
  assert.ok(Number.isSafeInteger(capture.sessionInitialAuth.apiPid));
  assert.ok(capture.sessionInitialAuth.apiPid > 1);
  assert.match(capture.sessionInitialAuth.targetOrigin, /^https?:\/\//);
  assert.ok(Number.isSafeInteger(capture.sessionInitialAuth.authRequestId));
  assert.ok(capture.sessionInitialAuth.authRequestId >= 1);
  assert.ok(capture.sessionInitialAuth.afterRequestId >= capture.sessionInitialAuth.authRequestId);
}

function requireUiEvidence(capture: IosSessionCaptureCandidate) {
  assert.deepEqual(
    capture.sessionUiObservationOrder,
    requiredUiLabels,
    'Session UI observation order is not canonical',
  );
  const paths = capture.observations.map((row) => row.hierarchyPath);
  for (const required of requiredUiPaths) {
    assert.equal(
      paths.filter((path) => path === required).length,
      1,
      `Missing UI evidence ${required}`,
    );
    const row = capture.observations.find((candidate) => candidate.hierarchyPath === required)!;
    assert.match(row.screenshotPath, /\.png$/);
    assert.match(row.viewId, /^SCR-|^STATE-/);
  }
  const expectedOrder = requiredUiPaths.map((path) => path);
  let previous = -1;
  for (const required of expectedOrder) {
    const index = paths.indexOf(required);
    assert.ok(index > previous, `Session observation order is not canonical at ${required}`);
    previous = index;
  }
  return paths;
}

function requireSessionSqlReceipt(
  receipt: SessionSqlReceiptCandidate,
  snapshot: OwnedDomainSnapshot,
  expectedPath: string,
  label: string,
) {
  assert.equal(receipt.path, expectedPath, `${label} SQL receipt path changed`);
  assert.equal(receipt.runId, snapshot.runId, `${label} SQL receipt run identity changed`);
  assert.equal(receipt.scope, snapshot.scope, `${label} SQL receipt scope changed`);
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/, `${label} SQL receipt hash is invalid`);
}

function requireApiEvidence(
  all: readonly ProxyObservation[],
  relaunch: readonly ProxyObservation[],
  signedOutRelaunch: readonly ProxyObservation[],
  sessionInitialAuth: SessionInitialAuthCandidate,
) {
  const signIns = all.filter((row) => row.pathHash === signInPathHash && row.status === 201);
  assert.equal(signIns.length, 1, 'Native sign-in must be observed exactly once');
  requireNativeObservation(signIns[0]!, 'native sign-in');
  assert.equal(signIns[0]!.requestId, sessionInitialAuth.authRequestId);

  const restorationHydrates = relaunch.filter(
    (row) => row.pathHash === hydratePathHash && row.status === 200,
  );
  assert.equal(restorationHydrates.length, 1, 'Restoration hydrate must be observed exactly once');
  requireNativeObservation(restorationHydrates[0]!, 'restoration hydrate');
  assert.ok(restorationHydrates[0]!.requestId > signIns[0]!.requestId);
  assert.equal(
    relaunch.some((row) => row.pathHash === signInPathHash),
    false,
    'Restoration must not sign in a second time',
  );

  assert.equal(
    signedOutRelaunch.some(
      (row) =>
        row.requestProfile !== 'native' ||
        row.outcome !== 'forwarded' ||
        row.targetOrigin !== sessionInitialAuth.targetOrigin,
    ),
    false,
    'Signed-out relaunch transport is not bound to the owned native API',
  );
  const signedOutAuthRequests = signedOutRelaunch.filter(
    (row) => row.pathHash === signInPathHash || row.pathHash === hydratePathHash,
  );
  assert.deepEqual(
    signedOutAuthRequests,
    [],
    'Signed-out relaunch must not issue an authenticated sign-in or hydrate',
  );
  return {
    signInRequestIds: signIns.map((row) => row.requestId),
    restorationHydrateRequestIds: restorationHydrates.map((row) => row.requestId),
    signedOutRelaunchAuthRequestIds: signedOutAuthRequests.map((row) => row.requestId),
  };
}

function requireSignedOutTransportRange(
  all: readonly ProxyObservation[],
  slice: readonly ProxyObservation[],
  range: IosSessionCaptureCandidate['signedOutRelaunchTransportRange'],
) {
  assert.ok(Number.isSafeInteger(range.startOrdinal) && range.startOrdinal >= 0);
  assert.ok(
    Number.isSafeInteger(range.endOrdinalExclusive) &&
      range.endOrdinalExclusive >= range.startOrdinal,
    'Signed-out transport range escapes stream',
  );
  assert.ok(range.endOrdinalExclusive <= all.length, 'Signed-out transport range escapes stream');
  assert.deepEqual(
    all.slice(range.startOrdinal, range.endOrdinalExclusive),
    slice,
    'Signed-out transport slice is not linked to the all-observation range',
  );
  assert.equal(
    range.endOrdinalExclusive - range.startOrdinal,
    slice.length,
    'Signed-out transport range length changed',
  );
  assert.equal(range.firstRequestId, slice[0]?.requestId ?? null);
  assert.equal(range.lastRequestId, slice[slice.length - 1]?.requestId ?? null);
}

/** Validate the private explicit session contract without acquiring resources. */
export function validateIosSessionAdapterCandidate(
  input: IosSessionAdapterCandidateInput,
): IosSessionAdapterCandidateResult {
  requireSessionSelection(input.selection);
  const capture = input.capture;
  assert.equal(capture.kind, 'private-native-inventory-observation-not-behavior-attempt');
  assert.equal(capture.mode, 'inventory');
  assert.equal(capture.platform, 'ios');
  assert.equal(capture.charter, 'session');
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  assert.equal(capture.nativePassingCases, 0);
  if (!Object.hasOwn(capture, 'signedOutRelaunchTransport'))
    throw new Error('Missing signedOutRelaunchTransport evidence');
  if (!Object.hasOwn(capture, 'signedOutRelaunchTransportRange'))
    throw new Error('Missing signedOutRelaunchTransportRange evidence');
  requireSessionLedger(capture);
  const paths = requireUiEvidence(capture);
  const api = requireApiEvidence(
    input.transportObservations,
    capture.relaunchTransport,
    capture.signedOutRelaunchTransport,
    capture.sessionInitialAuth,
  );
  requireSignedOutTransportRange(
    input.transportObservations,
    capture.signedOutRelaunchTransport,
    capture.signedOutRelaunchTransportRange,
  );
  requireMetadata(capture.authMetadataBeforeRelaunch, true, 'before relaunch');
  requireMetadata(capture.authMetadataAfterRelaunch, true, 'after restoration');
  requireMetadata(capture.authMetadataAfterSignout, false, 'after sign-out');
  requireMetadata(capture.authMetadataAfterSignedoutRelaunch, false, 'after signed-out relaunch');
  assert.deepEqual(capture.nativeLogoutContract.requirementRefs, ['FR-270', 'BR-342']);
  assert.equal(capture.nativeLogoutContract.scope, 'local-native-session-clear');
  if (capture.nativeLogoutContract.serverRevocationQualified !== false)
    throw new Error('serverRevocationQualified must remain false');
  if (!input.sessionSqlBefore) throw new Error('Missing session SQL snapshot before journey');
  if (!input.sessionSqlAfterSignedoutRelaunch)
    throw new Error('Missing session SQL snapshot after signed-out relaunch');
  requireSessionSqlReceipt(
    capture.sessionSqlBefore,
    input.sessionSqlBefore,
    'session-sql-before.private.json',
    'before',
  );
  requireSessionSqlReceipt(
    capture.sessionSqlAfterSignedoutRelaunch,
    input.sessionSqlAfterSignedoutRelaunch,
    'session-sql-after-signed-out-relaunch.private.json',
    'after',
  );
  requireUnrelatedDomainStateUnchanged(
    input.sessionSqlBefore,
    input.sessionSqlAfterSignedoutRelaunch,
  );
  return {
    kind: 'private-ios-session-adapter-candidate-not-public-receipt',
    charter: 'session',
    assertionIds: [...nativeSessionAssertionIds],
    nativePassingCases: 0,
    serverRevocationQualified: false,
    evidence: {
      ui: {
        paths,
        requiredViews: [...requiredUiPaths],
        orderedLabels: [...requiredUiLabels],
      },
      api,
      storage: {
        restoredSessionPresent: true,
        clearedAfterSignout: true,
        clearedAfterSignedOutRelaunch: true,
        plaintextTokensPresent: false,
      },
      sql: {
        unchangedTrainingPlans: true,
        unchangedConnections: true,
        authSessionRowsOutsideDeclaredDomainScope: true,
      },
    },
  };
}
