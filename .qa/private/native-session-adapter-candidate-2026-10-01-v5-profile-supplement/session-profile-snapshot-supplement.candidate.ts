import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  verifyConnectionAuthCheckpoint,
  type ConnectionAuthApiIdentity,
  type ConnectionAuthTransportObservation,
} from '../../../scripts/testing/native-connection-checkpoints';
import {
  requireConnectionSnapshot,
  verifyConnectionSnapshotCheckpoint,
  type OwnedConnectionSnapshot,
} from '../../../scripts/testing/native-connection-snapshot';
import type { NativeAuthIdentityObservation } from '../../../scripts/testing/owned-api-proxy';
import type { OwnedFixtures } from '../../../scripts/testing/owned-session';

export const sessionProfileSnapshotLabels = Object.freeze([
  'before-login',
  'after-initial-login',
  'after-restore',
  'after-signed-out-relaunch',
] as const);
export type SessionProfileSnapshotLabel = (typeof sessionProfileSnapshotLabels)[number];

export type SessionProfileSnapshotReceipt = {
  path: string;
  sha256: string;
  bytes: number;
  runId: string;
  scope: string;
  ownedRunId: string;
  apiPid: number;
  targetOrigin: string;
  fixtureAuthUidAllowlistHash: string;
};

/** A private snapshot must retain the exact bytes read through readNativeEvidence. */
export type SessionProfileSnapshotEvidence = {
  label: SessionProfileSnapshotLabel;
  snapshot: OwnedConnectionSnapshot;
  bytes: Buffer;
  receipt: SessionProfileSnapshotReceipt;
};

export type SessionProfileRequestRange = {
  afterRequestId: number;
  throughRequestId: number;
};

export type SessionProfileSupplementInput = {
  fixtures: Pick<OwnedFixtures, 'accounts'>;
  expectedApiIdentity: ConnectionAuthApiIdentity;
  snapshots: Record<SessionProfileSnapshotLabel, SessionProfileSnapshotEvidence>;
  signIn: {
    observations: readonly ConnectionAuthTransportObservation[];
    authIdentities: readonly NativeAuthIdentityObservation[];
    range: SessionProfileRequestRange;
  };
  restore: {
    observations: readonly ConnectionProfileTransportObservation[];
    range: SessionProfileRequestRange;
  };
};

export type ConnectionProfileTransportObservation = ConnectionAuthTransportObservation;

export type SessionProfileSupplementResult = {
  kind: 'private-ios-session-profile-snapshot-supplement-not-public-receipt';
  nativePassingCases: 0;
  serverRevocationQualified: false;
  snapshotLabels: readonly SessionProfileSnapshotLabel[];
  signInRequestId: number;
  restoreHydrateRequestId: number;
  profileMutationPolicy: 'coach-updatedAt-only-in-bound-sign-in-and-hydrate-spans';
  postRestoreProjection: 'strictly-unchanged-through-local-signout-and-relaunch';
  noGetAssertion: true;
};

const sessionScope = 'native-entry-ios';
const hydratePathHash = hash('/me/hydrate');

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function fixtureAuthUidAllowlistHash(fixtures: Pick<OwnedFixtures, 'accounts'>): string {
  return hash(
    JSON.stringify(
      Object.values(fixtures.accounts)
        .map((account) => account.authUid)
        .sort(),
    ),
  );
}

function requireRequestRange(range: SessionProfileRequestRange, label: string): void {
  assert(
    Number.isSafeInteger(range.afterRequestId) && range.afterRequestId >= 0,
    `${label} lower bound`,
  );
  assert(
    Number.isSafeInteger(range.throughRequestId) && range.throughRequestId > range.afterRequestId,
    `${label} upper bound`,
  );
}

function requireSnapshotReceipt(
  evidence: SessionProfileSnapshotEvidence,
  expected: {
    runId: string;
    scope: string;
    apiIdentity: ConnectionAuthApiIdentity;
    fixtureAuthUidAllowlistHash: string;
  },
): void {
  const expectedPaths: Record<SessionProfileSnapshotLabel, string> = {
    'before-login': 'session-sql-before-login.private.json',
    'after-initial-login': 'session-sql-after-initial-login.private.json',
    'after-restore': 'session-sql-after-restore.private.json',
    'after-signed-out-relaunch': 'session-sql-after-signed-out-relaunch.private.json',
  };
  assert.equal(evidence.receipt.path, expectedPaths[evidence.label], `${evidence.label} path`);
  assert(
    evidence.receipt.path.length > 0 && !evidence.receipt.path.startsWith('/'),
    `${evidence.label} path`,
  );
  assert(/^[a-f0-9]{64}$/.test(evidence.receipt.sha256), `${evidence.label} hash shape`);
  assert(
    Number.isSafeInteger(evidence.receipt.bytes) && evidence.receipt.bytes > 0,
    `${evidence.label} byte count`,
  );
  assert.equal(
    evidence.receipt.sha256,
    hash(evidence.bytes),
    `${evidence.label} bytes were changed`,
  );
  assert.equal(
    evidence.receipt.bytes,
    evidence.bytes.length,
    `${evidence.label} byte count changed`,
  );
  assert.deepEqual(
    JSON.parse(evidence.bytes.toString('utf8')),
    evidence.snapshot,
    `${evidence.label} parsed bytes changed`,
  );
  assert.equal(evidence.receipt.runId, expected.runId, `${evidence.label} run identity`);
  assert.equal(evidence.receipt.ownedRunId, expected.runId, `${evidence.label} owned run identity`);
  assert.equal(evidence.receipt.scope, expected.scope, `${evidence.label} scope`);
  assert.equal(evidence.receipt.apiPid, expected.apiIdentity.apiPid, `${evidence.label} API pid`);
  assert.equal(
    evidence.receipt.targetOrigin,
    expected.apiIdentity.targetOrigin,
    `${evidence.label} API origin`,
  );
  assert.equal(
    evidence.receipt.fixtureAuthUidAllowlistHash,
    expected.fixtureAuthUidAllowlistHash,
    `${evidence.label} fixture identity hash`,
  );
}

function expectedSnapshotIdentity(
  snapshot: OwnedConnectionSnapshot,
  fixtures: Pick<OwnedFixtures, 'accounts'>,
) {
  return {
    runId: snapshot.runId,
    scope: snapshot.scope,
    fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
    target: {
      professionalAuthUid: fixtures.accounts.coach.authUid,
      studentAuthUid: fixtures.accounts.student.authUid,
      specialty: 'fitness_coach' as const,
    },
  };
}

function requireSessionSnapshotIdentity(
  snapshot: OwnedConnectionSnapshot,
  fixtures: Pick<OwnedFixtures, 'accounts'>,
  expected: ReturnType<typeof expectedSnapshotIdentity>,
): void {
  requireConnectionSnapshot(snapshot, expected);
  verifyConnectionSnapshotCheckpoint({ snapshot, checkpoint: 'pending', expected });
}

function requireTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), `${label} profile timestamp is invalid`);
  return parsed;
}

/** Mirrors the existing normal-auth exception: only the verified coach updatedAt may move. */
function assertCoachUpdatedAtOnly(
  before: OwnedConnectionSnapshot,
  after: OwnedConnectionSnapshot,
  coachAuthUid: string,
): void {
  assert.equal(
    before.rows.userProfiles.length,
    after.rows.userProfiles.length,
    'profile row cardinality changed',
  );
  for (const [index, beforeProfile] of before.rows.userProfiles.entries()) {
    const afterProfile = after.rows.userProfiles[index];
    assert(
      afterProfile && afterProfile.authUid === beforeProfile.authUid,
      'profile identity/order changed',
    );
    if (beforeProfile.authUid !== coachAuthUid) {
      assert.deepEqual(afterProfile, beforeProfile, 'non-coach profile changed');
      continue;
    }
    const beforeComparable = { ...beforeProfile, updatedAt: undefined };
    const afterComparable = { ...afterProfile, updatedAt: undefined };
    assert.deepEqual(afterComparable, beforeComparable, 'coach fields beyond updatedAt changed');
    const beforeUpdatedAt = requireTimestamp(beforeProfile.updatedAt, 'before');
    const afterUpdatedAt = requireTimestamp(afterProfile.updatedAt, 'after');
    assert(afterUpdatedAt >= beforeUpdatedAt, 'coach updatedAt regressed');
    if (afterUpdatedAt === beforeUpdatedAt)
      assert.equal(
        afterProfile.updatedAt,
        beforeProfile.updatedAt,
        'updatedAt encoding changed without advancing',
      );
  }
  for (const name of Object.keys(before.rows) as (keyof typeof before.rows)[])
    if (name !== 'userProfiles')
      assert.deepEqual(after.rows[name], before.rows[name], `${name} changed during auth span`);
}

function requireHydrateObservation(
  observations: readonly ConnectionProfileTransportObservation[],
  range: SessionProfileRequestRange,
  expectedApiIdentity: ConnectionAuthApiIdentity,
): ConnectionProfileTransportObservation {
  requireRequestRange(range, 'restore hydrate request range');
  const matches = observations.filter(
    (observation) =>
      observation.requestId > range.afterRequestId &&
      observation.requestId <= range.throughRequestId &&
      observation.method === 'POST' &&
      observation.pathHash === hydratePathHash &&
      observation.requestProfile === 'native' &&
      observation.requestOrigin === null &&
      observation.status === 200 &&
      observation.outcome === 'forwarded' &&
      observation.faultAttemptId === null &&
      observation.targetOrigin === expectedApiIdentity.targetOrigin,
  );
  assert.equal(matches.length, 1, 'restore span requires exactly one native POST /me/hydrate 200');
  return matches[0];
}

/**
 * Validate the profile-complete session SQL supplement after the main v4
 * contract. This function consumes already-read owned bytes and never claims
 * runtime/public qualification.
 */
export function validateSessionProfileSnapshotSupplement(
  input: SessionProfileSupplementInput,
): SessionProfileSupplementResult {
  const before = input.snapshots['before-login'];
  const afterLogin = input.snapshots['after-initial-login'];
  const afterRestore = input.snapshots['after-restore'];
  const afterSignedOutRelaunch = input.snapshots['after-signed-out-relaunch'];
  assert.deepEqual(
    Object.keys(input.snapshots).sort(),
    [...sessionProfileSnapshotLabels].sort(),
    'all four profile snapshot labels are required',
  );
  assert.equal(before.snapshot.scope, sessionScope, 'session profile scope changed');
  const expected = expectedSnapshotIdentity(before.snapshot, input.fixtures);
  const fixtureAuthUidHash = fixtureAuthUidAllowlistHash(input.fixtures);
  const seenPaths = new Set<string>();
  for (const evidence of [before, afterLogin, afterRestore, afterSignedOutRelaunch]) {
    assert(!seenPaths.has(evidence.receipt.path), `${evidence.label} reuses a snapshot path`);
    seenPaths.add(evidence.receipt.path);
    requireSnapshotReceipt(evidence, {
      runId: expected.runId,
      scope: expected.scope,
      apiIdentity: input.expectedApiIdentity,
      fixtureAuthUidAllowlistHash: fixtureAuthUidHash,
    });
    requireSessionSnapshotIdentity(evidence.snapshot, input.fixtures, expected);
  }
  assert.equal(afterLogin.snapshot.runId, expected.runId, 'initial login snapshot run changed');
  assert.equal(afterRestore.snapshot.runId, expected.runId, 'restore snapshot run changed');
  assert.equal(afterSignedOutRelaunch.snapshot.runId, expected.runId, 'final snapshot run changed');

  requireRequestRange(input.signIn.range, 'initial sign-in request range');
  requireRequestRange(input.restore.range, 'restore hydrate request range');
  assert(
    input.restore.range.afterRequestId >= input.signIn.range.throughRequestId,
    'restore hydrate span overlaps initial sign-in span',
  );
  const signIn = verifyConnectionAuthCheckpoint({
    before: before.snapshot,
    after: afterLogin.snapshot,
    fixtures: input.fixtures,
    actor: 'coach',
    checkpoint: 'pending',
    observations: input.signIn.observations,
    authIdentities: input.signIn.authIdentities,
    expectedApiIdentity: input.expectedApiIdentity,
    afterRequestId: input.signIn.range.afterRequestId,
    throughRequestId: input.signIn.range.throughRequestId,
  });
  assert.equal(
    signIn.actorAuthUid,
    input.fixtures.accounts.coach.authUid,
    'sign-in coach identity changed',
  );
  const hydrate = requireHydrateObservation(
    input.restore.observations,
    input.restore.range,
    input.expectedApiIdentity,
  );
  assertCoachUpdatedAtOnly(afterLogin.snapshot, afterRestore.snapshot, signIn.actorAuthUid);

  // Once restoration has completed, local cancellation, confirmed sign-out,
  // and signed-out relaunch must leave every declared projection row exact.
  assert.deepEqual(
    afterSignedOutRelaunch.snapshot,
    afterRestore.snapshot,
    'post-restore projection changed through logout or signed-out relaunch',
  );
  return {
    kind: 'private-ios-session-profile-snapshot-supplement-not-public-receipt',
    nativePassingCases: 0,
    serverRevocationQualified: false,
    snapshotLabels: [...sessionProfileSnapshotLabels],
    signInRequestId: signIn.matchedObservation.requestId,
    restoreHydrateRequestId: hydrate.requestId,
    profileMutationPolicy: 'coach-updatedAt-only-in-bound-sign-in-and-hydrate-spans',
    postRestoreProjection: 'strictly-unchanged-through-local-signout-and-relaunch',
    noGetAssertion: true,
  };
}
