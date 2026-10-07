import assert from 'node:assert/strict';

export const androidSessionPublicSelection = Object.freeze({
  platform: 'android',
  engine: 'maestro',
  scenario: 'SCN-session-android',
  mode: 'integration',
} as const);

export const androidSessionPublicAssertionIds = Object.freeze([
  'NAT-session-login',
  'NAT-session-restore',
  'NAT-session-account',
  'NAT-session-signout',
  'NAT-session-signed-out-relaunch',
  'NAT-session-unrelated-state',
] as const);

export const androidSessionPublicUiObservationContract = Object.freeze([
  { label: 'entry', viewId: 'SCR-sign-in' },
  { label: 'coach-home', viewId: 'SCR-pro-home' },
  { label: 'auth-restored-home', viewId: 'SCR-pro-home' },
  { label: 'auth-account', viewId: 'SCR-account' },
  { label: 'auth-account-identity', viewId: 'SCR-account' },
  { label: 'auth-signout-open', viewId: 'STATE-signout-confirm' },
  { label: 'auth-signout-cancelled', viewId: 'SCR-account' },
  { label: 'auth-signout-reopen', viewId: 'STATE-signout-confirm' },
  { label: 'auth-signed-out', viewId: 'SCR-sign-in' },
  { label: 'auth-signed-out-relaunch', viewId: 'SCR-sign-in' },
] as const);

/**
 * Every producer command belongs to exactly one of the six ordered charter
 * assertions. The readiness and hierarchy commands are derived from each
 * observation label by the source consumer; this table only owns the phase
 * mapping so producer and consumer cannot silently bind different command
 * bytes to an assertion.
 */
export const androidSessionPublicCommandLabelsByAssertion = Object.freeze([
  ['entry'],
  ['coach-home'],
  ['auth-account', 'auth-account-identity'],
  ['auth-restored-home'],
  ['auth-signout-open', 'auth-signout-cancelled', 'auth-signout-reopen'],
  ['auth-signed-out', 'auth-signed-out-relaunch'],
] as const);

export type AndroidSessionPublicSelectionArguments = typeof androidSessionPublicSelection;

export type AndroidSessionPublicBlocked = {
  kind: 'private-android-session-public-dependency-loader';
  status: 'blocked' | 'incomplete' | 'selection-blocked';
  captureRoot: string;
  captureRunId: string | null;
  nativePassingCases: 0;
  publicPassingCases: 0;
  publicPromotionEligible: false;
  missing: readonly string[];
};

export type AndroidSessionPublicDependencyResult = {
  kind: 'private-android-session-public-dependency-not-public-receipt';
  status: 'validated-source-only';
  platform: 'android';
  engine: 'maestro';
  charter: 'session-account';
  assertionIds: readonly string[];
  captureRunId: string;
  nativePassingCases: 0;
  publicPassingCases: 0;
  publicPromotionEligible: false;
  serverRevocationQualified: false;
  cleanup: 'cleaned';
  files: {
    framePaths: readonly string[];
    profilePaths: readonly string[];
    domainPaths: readonly string[];
    transportPath: string;
    nativeAuthIdentitiesPath: string;
    sqlPaths: readonly string[];
  };
  verification: {
    profileCheckpointStatus: 'verified';
    signInRequestId: number;
    restorationHydrateRequestId: number;
    signedOutRequestCount: number;
    coachAuthUidHash: string;
    fixtureAuthUidAllowlistHash: string;
  };
};

export type AndroidSessionPublicLoad =
  | AndroidSessionPublicBlocked
  | (AndroidSessionPublicDependencyResult & {
      selection: AndroidSessionPublicSelectionArguments;
    });

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

/** Keep the Android source candidate pinned to the actual current Maestro producer. */
export function requireAndroidSessionSelectionArguments(
  value: unknown,
): AndroidSessionPublicSelectionArguments {
  const args = record(value, 'Android session selection');
  assert.deepEqual(
    args,
    androidSessionPublicSelection,
    'Android session selection is not Maestro integration',
  );
  return androidSessionPublicSelection;
}

/**
 * Validate the producer identity before any field projection. This accepts only
 * the actual private Android session report and retains the source-only boundary.
 */
export function requireAndroidSessionCaptureShape(value: unknown): Record<string, unknown> {
  const capture = record(value, 'Android session capture');
  for (const key of [
    'captureRunId',
    'source',
    'sourceAfter',
    'helperInputsBefore',
    'helperInputsAfter',
    'backend',
    'observations',
    'androidSessionCheckpointReceipts',
    'androidSessionCheckpointArtifacts',
    'androidSessionProfileCache',
    'androidSessionStorage',
    'androidSessionAuthIdentity',
    'androidSessionRestoreTransport',
    'androidSessionSignedOutTransport',
    'androidSessionCancelStorage',
    'androidSessionCancelIdentity',
    'androidSessionDomain',
    'androidSessionProfileCheckpoint',
    'androidSessionCharter',
    'androidSessionAuthEvidence',
    'androidSessionTerminalQualification',
    'nativeSessionContract',
  ])
    assert(Object.hasOwn(capture, key), `Android capture field is missing: ${key}`);
  assert.equal(
    capture.kind,
    'private-owned-native-session-execution-not-public-receipt',
    'Android capture kind is not the private session producer',
  );
  assert.equal(capture.mode, 'integration');
  assert.equal(capture.platform, 'android');
  assert.equal(capture.charter, 'session-account');
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  assert.equal(capture.nativePassingCases, 0);
  const terminal = record(
    capture.androidSessionTerminalQualification,
    'Android terminal qualification',
  );
  assert.equal(terminal.status, 'verified');
  assert.deepEqual(terminal.blockers, []);
  const authEvidence = record(capture.androidSessionAuthEvidence, 'Android auth evidence');
  assert.equal(authEvidence.status, 'available');
  assert(Object.hasOwn(authEvidence, 'transportReceipt'));
  assert(Object.hasOwn(authEvidence, 'nativeAuthIdentitiesReceipt'));
  assert.equal(
    record(capture.androidSessionProfileCheckpoint, 'Android profile checkpoint').status,
    'verified',
  );
  assert.equal(record(capture.androidSessionDomain, 'Android domain binding').status, 'verified');
  assert.equal(record(capture.androidSessionCharter, 'Android session charter').status, 'verified');
  assert.equal(
    record(capture.nativeSessionContract, 'Android local session contract').status,
    'verified',
  );
  assert.equal(
    record(capture.nativeSessionContract, 'Android local session contract')
      .serverRevocationQualified,
    false,
  );
  assert(Array.isArray(capture.observations), 'Android capture observations are missing');
  return capture;
}

export function blockedAndroidSessionDependency(
  status: AndroidSessionPublicBlocked['status'],
  captureRoot: string,
  captureRunId: string | null,
  missing: readonly string[],
): AndroidSessionPublicBlocked {
  return {
    kind: 'private-android-session-public-dependency-loader',
    status,
    captureRoot,
    captureRunId,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    missing: [...new Set(missing)],
  };
}
