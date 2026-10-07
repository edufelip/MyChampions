import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  nativeSessionAssertionIds,
  requireNativePilotAssertions,
} from '../../../scripts/testing/native-pilot-contract';
import type { NativePilotSelection } from '../../../scripts/testing/native-pilot-contract';
import {
  readNativeEvidence,
  validateNativeRuntimeFrameFiles,
  type ViewEvidence,
} from '../../../scripts/testing/native-view-evidence';
import type {
  NativeAuthIdentityObservation,
  ProxyObservation,
} from '../../../scripts/testing/owned-api-proxy';
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

export type IosSessionObservationCandidate = ViewEvidence & {
  /** Selector IDs Maestro asserted absent after a no-op action. */
  notVisibleSelectors?: readonly string[];
};

export type SessionCancelSignoutCheckpoint = {
  observationLabel: 'cancel-signout';
  hierarchyPath: 'cancel-signout-hierarchy.json';
  sessionPresent: true;
};

type SessionEvidenceReceiptCandidate = {
  path: string;
  sha256: string;
  bytes: number;
  runId: string;
  scope: string;
  ownedRunId: string;
  fixtureScope: string;
  artifactRoot: string;
  apiPid: number;
  targetOrigin: string;
  fixtureAuthUidAllowlistHash: string;
};

type SessionSqlReceiptCandidate = SessionEvidenceReceiptCandidate;

type SessionInitialAuthCandidate = {
  actor: 'coach';
  actorAuthUid: string;
  apiPid: number;
  targetOrigin: string;
  authRequestId: number;
  afterRequestId: number;
};

type SessionTransportRange = {
  startOrdinal: number;
  endOrdinalExclusive: number;
  firstRequestId: number | null;
  lastRequestId: number | null;
};

export type OwnedSessionManifestCandidate = {
  runId: string;
  artifactRoot: string;
  fixtureScopes: readonly string[];
  coachAuthUid: string;
  apiPid: number;
  apiOrigin: string;
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
  nativeAuthIdentityEvidence: SessionEvidenceReceiptCandidate;
  authMetadataBeforeRelaunch: IosAuthMetadataCandidate;
  authMetadataAfterRelaunch: IosAuthMetadataCandidate;
  authMetadataAfterCancel: IosAuthMetadataCandidate;
  cancelSignoutCheckpoint: SessionCancelSignoutCheckpoint;
  authMetadataAfterSignout: IosAuthMetadataCandidate;
  authMetadataAfterSignedoutRelaunch: IosAuthMetadataCandidate;
  relaunchTransport: readonly ProxyObservation[];
  relaunchTransportRange: SessionTransportRange;
  signedOutRelaunchTransport: readonly ProxyObservation[];
  signedOutRelaunchTransportRange: SessionTransportRange;
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
  evidenceRoot: string;
  fixtureAuthUids: readonly string[];
  ownedSessionManifest: OwnedSessionManifestCandidate;
  transportObservations: readonly ProxyObservation[];
  nativeAuthIdentities: readonly NativeAuthIdentityObservation[];
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
      retainedAfterCancel: true;
      cancelConfirmationAbsent: true;
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

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const routeHash = (route: string) => hash(route);
const signInPathHash = routeHash('/auth/email/sign-in');
const hydratePathHash = routeHash('/me/hydrate');
const sessionScope = 'native-entry-ios';

/** Candidate mirror of the v4 source boundary around direct session I/O. */
export async function runSessionDirectIoWithAbort<T>(
  signal: AbortSignal,
  operation: () => T | PromiseLike<T>,
): Promise<T> {
  signal.throwIfAborted();
  const value = await operation();
  signal.throwIfAborted();
  return value;
}

/** Complete ledgers are published only when the signal remains live after assignment. */
export function publishSessionLedgerWithAbortGuard(
  signal: AbortSignal,
  report: Record<string, unknown>,
  ledger: Record<string, unknown>,
) {
  signal.throwIfAborted();
  try {
    Object.assign(report, ledger);
    signal.throwIfAborted();
    report.sessionEvidencePublication = 'complete';
  } catch (error) {
    for (const key of Object.keys(ledger)) delete report[key];
    report.sessionEvidencePublication = 'aborted-before-complete';
    throw error;
  }
}

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

const requiredUiViews = Object.freeze([
  'SCR-sign-in',
  'STATE-password-save',
  'SCR-pro-home',
  'SCR-pro-home',
  'SCR-account',
  'SCR-account',
  'STATE-signout-confirm',
  'SCR-account',
  'STATE-signout-confirm',
  'SCR-sign-in',
  'SCR-sign-in',
] as const);

function requireMetadata(
  metadata: IosAuthMetadataCandidate,
  expectedPresent: boolean,
  label: string,
) {
  assert.equal(metadata.sessionPresent, expectedPresent, `${label} session presence changed`);
  if (!expectedPresent) {
    assert.equal(metadata.status, 'session-absent', `${label} metadata status changed`);
    assert.notEqual(metadata.profilePresent, true, `${label} profile metadata was exposed`);
    assert.notEqual(metadata.expiryPresent, true, `${label} expiry metadata was exposed`);
    assert.notEqual(
      metadata.plaintextAccessTokenPresent,
      true,
      `${label} access token metadata was exposed`,
    );
    assert.notEqual(
      metadata.plaintextRefreshTokenPresent,
      true,
      `${label} refresh token metadata was exposed`,
    );
    return;
  }
  assert.equal(metadata.status, 'session-present', `${label} metadata status changed`);
  assert.equal(metadata.profilePresent, true, `${label} profile metadata is absent`);
  assert.equal(metadata.expiryPresent, true, `${label} expiry metadata is absent`);
  assert.equal(metadata.plaintextAccessTokenPresent, false, `${label} access token was exposed`);
  assert.equal(metadata.plaintextRefreshTokenPresent, false, `${label} refresh token was exposed`);
}

function requireOwnedManifest(manifest: OwnedSessionManifestCandidate) {
  assert.match(manifest.runId, /^[a-f0-9]{24}$/, 'Owned session run identity is invalid');
  assert.equal(
    path.isAbsolute(manifest.artifactRoot),
    true,
    'Owned session artifact root must be absolute',
  );
  assert.equal(
    manifest.fixtureScopes.includes(sessionScope),
    true,
    'Owned session fixture scope is absent from manifest',
  );
  assert.match(manifest.coachAuthUid, /^.+$/, 'Owned coach fixture identity is absent');
  assert.ok(Number.isSafeInteger(manifest.apiPid) && manifest.apiPid > 1);
  assert.match(manifest.apiOrigin, /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
}

function fixtureAllowlistHash(fixtureAuthUids: readonly string[]) {
  const sorted = [...fixtureAuthUids].sort();
  assert.ok(sorted.length > 0, 'Fixture actor allowlist is empty');
  assert.equal(new Set(sorted).size, sorted.length, 'Fixture actor allowlist is duplicated');
  assert.equal(
    sorted.every((value) => typeof value === 'string' && value.length > 0),
    true,
    'Fixture actor allowlist contains an invalid UID',
  );
  return hash(JSON.stringify(sorted));
}

function requireNativeObservation(
  row: ProxyObservation,
  label: string,
  manifest: OwnedSessionManifestCandidate,
) {
  assert.equal(row.requestProfile, 'native', `${label} request is not native`);
  assert.equal(row.requestOrigin, null, `${label} request has an app origin`);
  assert.equal(row.outcome, 'forwarded', `${label} request was not forwarded`);
  assert.equal(row.faultAttemptId, null, `${label} request has a fault attempt`);
  assert.equal(row.targetOrigin, manifest.apiOrigin, `${label} request targets another API`);
}

function requireOwnedTransportRows(
  rows: readonly ProxyObservation[],
  label: string,
  manifest: OwnedSessionManifestCandidate,
  allowEmpty = false,
) {
  if (!allowEmpty) assert.ok(rows.length > 0, `${label} transport slice is empty`);
  const requestIds = new Set<number>();
  for (const [index, row] of rows.entries()) {
    requireNativeObservation(row, `${label}[${index}]`, manifest);
    assert.ok(Number.isSafeInteger(row.requestId) && row.requestId > 0);
    assert.equal(requestIds.has(row.requestId), false, `${label} request IDs are duplicated`);
    requestIds.add(row.requestId);
  }
}

function requireDomainSnapshotIdentity(
  snapshot: OwnedDomainSnapshot,
  manifest: OwnedSessionManifestCandidate,
  label: string,
) {
  assertTestingDocument('domain-snapshot-v1', snapshot);
  assert.equal(snapshot.schemaVersion, 1, `${label} SQL snapshot schema changed`);
  assert.equal(snapshot.readOnly, true, `${label} SQL snapshot is not read-only`);
  assert.equal(snapshot.runId, manifest.runId, `${label} SQL snapshot run identity is unbound`);
  assert.equal(snapshot.scope, sessionScope, `${label} SQL snapshot scope changed`);
}

function requireUnrelatedDomainStateUnchanged(
  before: OwnedDomainSnapshot,
  after: OwnedDomainSnapshot,
  manifest: OwnedSessionManifestCandidate,
) {
  requireDomainSnapshotIdentity(before, manifest, 'before');
  requireDomainSnapshotIdentity(after, manifest, 'after');
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
  assert.deepEqual(capture.cancelSignoutCheckpoint, {
    observationLabel: 'cancel-signout',
    hierarchyPath: 'cancel-signout-hierarchy.json',
    sessionPresent: true,
  });
}

function hierarchyHasResourceId(value: unknown, resourceId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const node = value as { attributes?: Record<string, unknown>; children?: unknown[] };
  return (
    node.attributes?.['resource-id'] === resourceId ||
    (Array.isArray(node.children) &&
      node.children.some((child) => hierarchyHasResourceId(child, resourceId)))
  );
}

function requireUiEvidence(root: string, capture: IosSessionCaptureCandidate) {
  assert.deepEqual(
    capture.sessionUiObservationOrder,
    requiredUiLabels,
    'Session UI observation order is not canonical',
  );
  assert.equal(capture.observations.length, requiredUiPaths.length);
  for (const [index, requiredPath] of requiredUiPaths.entries()) {
    const row = capture.observations[index];
    assert.equal(
      row?.hierarchyPath,
      requiredPath,
      `UI evidence ordinal changed at ${requiredPath}`,
    );
    assert.equal(
      row?.viewId,
      requiredUiViews[index],
      `UI selector view changed at ${requiredPath}`,
    );
    assert.equal(row?.screenshotPath, requiredPath.replace('-hierarchy.json', '.png'));
    assert.equal(row?.reviewed, false, `UI evidence ${requiredPath} claimed visual review`);
    validateNativeRuntimeFrameFiles(root, [row], [row.viewId]);
    if (requiredPath === 'cancel-signout-hierarchy.json') {
      assert.deepEqual(
        row?.notVisibleSelectors,
        ['settings.account.signOutConfirm'],
        'Cancel frame lacks the Maestro confirmation absence contract',
      );
      const hierarchy = JSON.parse(
        readNativeEvidence(root, row.hierarchyPath, true).toString('utf8'),
      );
      assert.equal(
        hierarchyHasResourceId(hierarchy, 'settings.account.signOutConfirm'),
        false,
        'Cancel frame retained the sign-out confirmation subtree',
      );
    } else {
      assert.deepEqual(row?.notVisibleSelectors ?? [], []);
    }
  }
  return capture.observations.map((row) => row.hierarchyPath);
}

function requireSessionEvidenceReceipt(
  root: string,
  receipt: SessionEvidenceReceiptCandidate,
  expected: {
    path: string;
    manifest: OwnedSessionManifestCandidate;
    fixtureAuthUidAllowlistHash: string;
    label: string;
  },
) {
  assert.equal(receipt.path, expected.path, `${expected.label} evidence path changed`);
  assert.equal(receipt.runId, expected.manifest.runId, `${expected.label} run identity changed`);
  assert.equal(receipt.scope, sessionScope, `${expected.label} scope changed`);
  assert.equal(receipt.ownedRunId, expected.manifest.runId, `${expected.label} owned run changed`);
  assert.equal(receipt.fixtureScope, sessionScope, `${expected.label} fixture scope changed`);
  assert.equal(
    receipt.artifactRoot,
    expected.manifest.artifactRoot,
    `${expected.label} artifact root is unbound`,
  );
  assert.equal(receipt.apiPid, expected.manifest.apiPid, `${expected.label} API PID is unbound`);
  assert.equal(
    receipt.targetOrigin,
    expected.manifest.apiOrigin,
    `${expected.label} API origin is unbound`,
  );
  assert.equal(
    receipt.fixtureAuthUidAllowlistHash,
    expected.fixtureAuthUidAllowlistHash,
    `${expected.label} fixture actor allowlist changed`,
  );
  const bytes = readNativeEvidence(root, receipt.path, true);
  assert.equal(receipt.bytes, bytes.length, `${expected.label} byte count changed`);
  assert.equal(receipt.sha256, hash(bytes), `${expected.label} receipt hash does not match bytes`);
  return bytes;
}

function requireSessionSqlReceipt(
  root: string,
  receipt: SessionSqlReceiptCandidate,
  snapshot: OwnedDomainSnapshot,
  manifest: OwnedSessionManifestCandidate,
  expectedPath: string,
  fixtureAuthUidAllowlistHash: string,
  label: string,
) {
  const bytes = requireSessionEvidenceReceipt(root, receipt, {
    path: expectedPath,
    manifest,
    fixtureAuthUidAllowlistHash,
    label,
  });
  const diskSnapshot = JSON.parse(bytes.toString('utf8')) as OwnedDomainSnapshot;
  requireDomainSnapshotIdentity(diskSnapshot, manifest, `${label} disk`);
  assert.deepEqual(diskSnapshot, snapshot, `${label} SQL snapshot differs from owned input`);
  return diskSnapshot;
}

function requireNativeAuthIdentityEvidence(
  input: IosSessionAdapterCandidateInput,
  allowlistHash: string,
) {
  const receipt = input.capture.nativeAuthIdentityEvidence;
  const bytes = requireSessionEvidenceReceipt(input.evidenceRoot, receipt, {
    path: 'native-auth-identities.private.json',
    manifest: input.ownedSessionManifest,
    fixtureAuthUidAllowlistHash: allowlistHash,
    label: 'native auth identity',
  });
  const diskIdentities = JSON.parse(bytes.toString('utf8')) as NativeAuthIdentityObservation[];
  assert.deepEqual(
    diskIdentities,
    input.nativeAuthIdentities,
    'Persisted native auth identities differ from the owned identity input',
  );
  assert.ok(diskIdentities.length > 0, 'Persisted native auth identities are empty');
  const requestIds = new Set<number>();
  const ordinals = new Set<number>();
  for (const [index, identity] of diskIdentities.entries()) {
    assert.ok(Number.isSafeInteger(identity.requestId) && identity.requestId > 0);
    assert.ok(Number.isSafeInteger(identity.ordinal) && identity.ordinal > 0);
    assert.equal(
      requestIds.has(identity.requestId),
      false,
      `Auth identity request ${index} duplicated`,
    );
    assert.equal(
      ordinals.has(identity.ordinal),
      false,
      `Auth identity ordinal ${index} duplicated`,
    );
    assert.equal(identity.targetOrigin, input.ownedSessionManifest.apiOrigin);
    assert.equal(identity.apiPid, input.ownedSessionManifest.apiPid);
    assert.equal(
      identity.fixtureAuthUidAllowlistHash,
      allowlistHash,
      `Auth identity ${index} fixture binding changed`,
    );
    assert.equal(
      identity.authUid === null || input.fixtureAuthUids.includes(identity.authUid),
      true,
      `Auth identity ${index} is outside the fixture allowlist`,
    );
    assert.equal(
      identity.verification === 'verified' || identity.verification === 'unverified',
      true,
    );
    assert.equal(typeof identity.verificationReason, 'string');
    requestIds.add(identity.requestId);
    ordinals.add(identity.ordinal);
  }
  return diskIdentities;
}

function requireApiEvidence(
  all: readonly ProxyObservation[],
  relaunch: readonly ProxyObservation[],
  relaunchRange: SessionTransportRange,
  signedOutRelaunch: readonly ProxyObservation[],
  signedOutRange: SessionTransportRange,
  sessionInitialAuth: SessionInitialAuthCandidate,
  manifest: OwnedSessionManifestCandidate,
) {
  const signIns = all.filter((row) => row.pathHash === signInPathHash);
  assert.equal(signIns.length, 1, 'Native sign-in route must be observed exactly once');
  requireNativeObservation(signIns[0]!, 'native sign-in', manifest);
  assert.equal(signIns[0]!.status, 201, 'Native sign-in status changed');
  assert.equal(signIns[0]!.requestId, sessionInitialAuth.authRequestId);

  requireOwnedTransportRows(relaunch, 'restore', manifest);
  const restorationHydrates = relaunch.filter(
    (row) => row.pathHash === hydratePathHash && row.status === 200,
  );
  assert.equal(restorationHydrates.length, 1, 'Restoration hydrate must be observed exactly once');
  assert.ok(restorationHydrates[0]!.requestId > signIns[0]!.requestId);
  assert.equal(
    relaunch.filter((row) => row.pathHash === signInPathHash).length,
    0,
    'Restoration must not sign in a second time',
  );

  requireOwnedTransportRows(signedOutRelaunch, 'signed-out relaunch', manifest, true);
  assert.equal(
    signedOutRelaunch.some(
      (row) => row.pathHash === signInPathHash || row.pathHash === hydratePathHash,
    ),
    false,
    'Signed-out relaunch must not issue authenticated routes',
  );
  requireTransportRange(all, relaunch, relaunchRange, 'restore');
  requireTransportRange(all, signedOutRelaunch, signedOutRange, 'signed-out relaunch');
  return {
    signInRequestIds: signIns.map((row) => row.requestId),
    restorationHydrateRequestIds: restorationHydrates.map((row) => row.requestId),
    signedOutRelaunchAuthRequestIds: [],
  };
}

function requireTransportRange(
  all: readonly ProxyObservation[],
  slice: readonly ProxyObservation[],
  range: SessionTransportRange,
  label: string,
) {
  assert.ok(Number.isSafeInteger(range.startOrdinal) && range.startOrdinal >= 0);
  assert.ok(
    Number.isSafeInteger(range.endOrdinalExclusive) &&
      range.endOrdinalExclusive >= range.startOrdinal,
    `${label} transport range is inverted`,
  );
  assert.ok(range.endOrdinalExclusive <= all.length, `${label} transport range escapes stream`);
  assert.deepEqual(
    all.slice(range.startOrdinal, range.endOrdinalExclusive),
    slice,
    `${label} transport slice is not linked to the all-observation range`,
  );
  assert.equal(
    range.endOrdinalExclusive - range.startOrdinal,
    slice.length,
    `${label} transport range length changed`,
  );
  assert.equal(range.firstRequestId, slice[0]?.requestId ?? null);
  assert.equal(range.lastRequestId, slice[slice.length - 1]?.requestId ?? null);
}

/** Validate the private explicit session contract without acquiring resources. */
export function validateIosSessionAdapterCandidate(
  input: IosSessionAdapterCandidateInput,
): IosSessionAdapterCandidateResult {
  requireSessionSelection(input.selection);
  requireOwnedManifest(input.ownedSessionManifest);
  const allowlistHash = fixtureAllowlistHash(input.fixtureAuthUids);
  const capture = input.capture;
  assert.equal(capture.kind, 'private-native-inventory-observation-not-behavior-attempt');
  assert.equal(capture.mode, 'inventory');
  assert.equal(capture.platform, 'ios');
  assert.equal(capture.charter, 'session');
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  assert.equal(capture.nativePassingCases, 0);
  requireSessionLedger(capture);
  const paths = requireUiEvidence(input.evidenceRoot, capture);
  const identities = requireNativeAuthIdentityEvidence(input, allowlistHash);
  const matchedIdentity = identities.filter(
    (identity) => identity.requestId === capture.sessionInitialAuth.authRequestId,
  );
  assert.equal(matchedIdentity.length, 1, 'Initial native auth identity is not unique');
  assert.equal(matchedIdentity[0]!.status, 201);
  assert.equal(matchedIdentity[0]!.verification, 'verified');
  assert.equal(matchedIdentity[0]!.verificationReason, 'verified');
  assert.equal(matchedIdentity[0]!.authUid, capture.sessionInitialAuth.actorAuthUid);
  assert.equal(matchedIdentity[0]!.apiPid, input.ownedSessionManifest.apiPid);
  assert.equal(matchedIdentity[0]!.targetOrigin, input.ownedSessionManifest.apiOrigin);
  assert.ok(
    input.transportObservations.some(
      (row) =>
        row.requestId === capture.sessionInitialAuth.authRequestId &&
        row.pathHash === signInPathHash,
    ),
    'Initial auth identity is not linked to transport',
  );
  assert.equal(capture.sessionInitialAuth.apiPid, input.ownedSessionManifest.apiPid);
  assert.equal(capture.sessionInitialAuth.targetOrigin, input.ownedSessionManifest.apiOrigin);
  assert.equal(
    capture.sessionInitialAuth.actorAuthUid,
    input.ownedSessionManifest.coachAuthUid,
    'Initial auth actor is not the owned coach fixture',
  );
  assert.equal(
    input.fixtureAuthUids.includes(capture.sessionInitialAuth.actorAuthUid),
    true,
    'Initial auth actor is outside fixture allowlist',
  );
  const api = requireApiEvidence(
    input.transportObservations,
    capture.relaunchTransport,
    capture.relaunchTransportRange,
    capture.signedOutRelaunchTransport,
    capture.signedOutRelaunchTransportRange,
    capture.sessionInitialAuth,
    input.ownedSessionManifest,
  );
  requireMetadata(capture.authMetadataBeforeRelaunch, true, 'before relaunch');
  requireMetadata(capture.authMetadataAfterRelaunch, true, 'after restoration');
  requireMetadata(capture.authMetadataAfterCancel, true, 'after sign-out cancel');
  assert.equal(
    capture.cancelSignoutCheckpoint.sessionPresent,
    capture.authMetadataAfterCancel.sessionPresent,
    'Cancel checkpoint is not bound to retained session metadata',
  );
  requireMetadata(capture.authMetadataAfterSignout, false, 'after sign-out');
  requireMetadata(capture.authMetadataAfterSignedoutRelaunch, false, 'after signed-out relaunch');
  assert.deepEqual(capture.nativeLogoutContract.requirementRefs, ['FR-270', 'BR-342']);
  assert.equal(capture.nativeLogoutContract.scope, 'local-native-session-clear');
  if (capture.nativeLogoutContract.serverRevocationQualified !== false)
    throw new Error('serverRevocationQualified must remain false');
  const before = requireSessionSqlReceipt(
    input.evidenceRoot,
    capture.sessionSqlBefore,
    input.sessionSqlBefore,
    input.ownedSessionManifest,
    'session-sql-before.private.json',
    allowlistHash,
    'before',
  );
  const after = requireSessionSqlReceipt(
    input.evidenceRoot,
    capture.sessionSqlAfterSignedoutRelaunch,
    input.sessionSqlAfterSignedoutRelaunch,
    input.ownedSessionManifest,
    'session-sql-after-signed-out-relaunch.private.json',
    allowlistHash,
    'after',
  );
  requireUnrelatedDomainStateUnchanged(before, after, input.ownedSessionManifest);
  return {
    kind: 'private-ios-session-adapter-candidate-not-public-receipt',
    charter: 'session',
    assertionIds: [...nativeSessionAssertionIds],
    nativePassingCases: 0,
    serverRevocationQualified: false,
    evidence: {
      ui: {
        paths,
        requiredViews: [...requiredUiViews],
        orderedLabels: [...requiredUiLabels],
      },
      api,
      storage: {
        restoredSessionPresent: true,
        retainedAfterCancel: true,
        cancelConfirmationAbsent: true,
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
