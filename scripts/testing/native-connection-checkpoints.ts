import { createHash } from 'node:crypto';
import {
  requireConnectionSnapshot,
  verifyConnectionSnapshotCheckpoint,
  verifyConnectionSnapshotPhaseTransition,
  type ConnectionSnapshotCheckpoint,
  type OwnedConnectionSnapshot,
} from './native-connection-snapshot';
import type { NativeAuthIdentityObservation } from './owned-api-proxy';
import type { OwnedFixtures } from './owned-session';

export type ConnectionAuthActor = 'coach' | 'student';

export type ConnectionAuthTransportObservation = {
  requestId: number;
  method: string;
  pathHash: string;
  requestOrigin: string | null;
  requestProfile: string;
  targetOrigin: string;
  status: number;
  outcome: string;
  faultAttemptId: string | null;
};

export type ConnectionAuthObservationWindow = {
  afterRequestId: number;
  throughRequestId: number;
};

/**
 * A redacted owned callback record proving which fixture response authenticated
 * for the matched request. The raw response body and credential never enter
 * this contract.
 */
export type ConnectionAuthIdentityObservation = NativeAuthIdentityObservation;

export type ConnectionAuthApiIdentity = {
  targetOrigin: string;
  apiPid: number;
};

export type ConnectionAuthCheckpointResult = {
  actor: ConnectionAuthActor;
  actorAuthUid: string;
  checkpoint: 'pending' | 'active';
  snapshotIdentity: {
    runId: string;
    scope: string;
    fixtureAuthUids: string[];
    target: OwnedConnectionSnapshot['target'];
  };
  matchedObservation: {
    requestId: number;
    method: string;
    pathHash: string;
    status: number;
    outcome: string;
    requestProfile: string;
    requestOrigin: string | null;
    targetOrigin: string;
  };
  matchedIdentity: ConnectionAuthIdentityObservation;
  actorIdentity: 'verified-from-owned-native-auth-identity';
  transportPrincipal: 'proxy-observation-has-no-principal-uid';
};

const authPathHash = createHash('sha256').update('/auth/email/sign-in').digest('hex');

function same(value: unknown, other: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(other);
}

function fixtureIds(fixtures: Pick<OwnedFixtures, 'accounts'>): string[] {
  return Object.values(fixtures.accounts)
    .map((account) => account.authUid)
    .sort();
}

function fixtureAuthUidAllowlistHash(fixtures: Pick<OwnedFixtures, 'accounts'>): string {
  return createHash('sha256')
    .update(JSON.stringify(fixtureIds(fixtures)))
    .digest('hex');
}

function expectedIdentity(
  snapshot: OwnedConnectionSnapshot,
  fixtures: Pick<OwnedFixtures, 'accounts'>,
) {
  return {
    runId: snapshot.runId,
    scope: snapshot.scope,
    fixtureAuthUids: fixtureIds(fixtures),
    target: {
      professionalAuthUid: fixtures.accounts.coach.authUid,
      studentAuthUid: fixtures.accounts.student.authUid,
      specialty: 'fitness_coach' as const,
    },
  };
}

function requireCausalSnapshotIdentity(
  before: OwnedConnectionSnapshot,
  after: OwnedConnectionSnapshot,
  fixtures: Pick<OwnedFixtures, 'accounts'>,
  checkpoint: ConnectionSnapshotCheckpoint,
) {
  const expected = expectedIdentity(before, fixtures);
  if (after.runId !== before.runId || after.scope !== before.scope)
    throw new Error('Connection auth checkpoint run or scope identity changed');
  requireConnectionSnapshot(before, expected);
  requireConnectionSnapshot(after, expected);
  verifyConnectionSnapshotCheckpoint({ snapshot: before, checkpoint, expected });
  verifyConnectionSnapshotCheckpoint({ snapshot: after, checkpoint, expected });
  return expected;
}

function requireTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed))
    throw new Error(`Connection auth checkpoint ${label} timestamp is invalid`);
  return parsed;
}

function assertAuthSnapshotDelta({
  before,
  after,
  actorAuthUid,
}: {
  before: OwnedConnectionSnapshot;
  after: OwnedConnectionSnapshot;
  actorAuthUid: string;
}) {
  if (before.rows.userProfiles.length !== after.rows.userProfiles.length)
    throw new Error('Connection auth checkpoint changed profile row cardinality');
  for (const [index, beforeProfile] of before.rows.userProfiles.entries()) {
    const afterProfile = after.rows.userProfiles[index];
    if (!afterProfile || beforeProfile.authUid !== afterProfile.authUid)
      throw new Error('Connection auth checkpoint changed profile identity or ordering');
    if (beforeProfile.authUid !== actorAuthUid) {
      if (!same(beforeProfile, afterProfile))
        throw new Error('Connection auth checkpoint changed a non-actor profile');
      continue;
    }
    const beforeComparable = { ...beforeProfile, updatedAt: undefined };
    const afterComparable = { ...afterProfile, updatedAt: undefined };
    if (!same(beforeComparable, afterComparable))
      throw new Error('Connection auth checkpoint changed actor profile fields beyond updatedAt');
    const beforeUpdatedAt = requireTimestamp(beforeProfile.updatedAt, 'before');
    const afterUpdatedAt = requireTimestamp(afterProfile.updatedAt, 'after');
    if (afterUpdatedAt < beforeUpdatedAt)
      throw new Error('Connection auth checkpoint actor updatedAt regressed');
    if (afterUpdatedAt === beforeUpdatedAt && afterProfile.updatedAt !== beforeProfile.updatedAt)
      throw new Error('Connection auth checkpoint changed timestamp encoding without advancing it');
  }

  for (const name of Object.keys(before.rows) as (keyof typeof before.rows)[]) {
    if (name !== 'userProfiles' && !same(before.rows[name], after.rows[name]))
      throw new Error(`Connection auth checkpoint changed non-profile ${name} state`);
  }
}

function requireObservationWindow(
  observations: readonly ConnectionAuthTransportObservation[],
  window: ConnectionAuthObservationWindow,
) {
  if (
    !Number.isSafeInteger(window.afterRequestId) ||
    window.afterRequestId < 0 ||
    !Number.isSafeInteger(window.throughRequestId) ||
    window.throughRequestId <= window.afterRequestId
  )
    throw new Error('Connection auth checkpoint requires a bounded request ordinal window');
  // The proxy exposes completion order, which may differ from request order.
  // Uniqueness and the explicit request-id window are authoritative; the raw
  // capture remains available to the caller for arrival-order evidence.
  if (observations.length === 0)
    throw new Error('Connection auth checkpoint transport observations are missing');
  const requestIds = new Set<number>();
  for (const observation of observations) {
    if (
      !observation ||
      !Number.isSafeInteger(observation.requestId) ||
      observation.requestId < 1 ||
      requestIds.has(observation.requestId) ||
      typeof observation.method !== 'string' ||
      typeof observation.pathHash !== 'string' ||
      !Number.isSafeInteger(observation.status) ||
      typeof observation.outcome !== 'string' ||
      typeof observation.requestProfile !== 'string' ||
      (observation.requestOrigin !== null && typeof observation.requestOrigin !== 'string') ||
      typeof observation.targetOrigin !== 'string' ||
      (observation.faultAttemptId !== null && typeof observation.faultAttemptId !== 'string')
    )
      throw new Error('Connection auth checkpoint transport observation identity is invalid');
    requestIds.add(observation.requestId);
  }
}

function findUniqueAuthObservation(
  observations: readonly ConnectionAuthTransportObservation[],
  window: ConnectionAuthObservationWindow,
) {
  requireObservationWindow(observations, window);
  const matches = observations.filter(
    (observation) =>
      observation.requestId > window.afterRequestId &&
      observation.requestId <= window.throughRequestId &&
      observation.method === 'POST' &&
      observation.pathHash === authPathHash &&
      observation.status === 201 &&
      observation.outcome === 'forwarded' &&
      observation.requestProfile === 'native' &&
      observation.requestOrigin === null &&
      observation.faultAttemptId === null &&
      observation.targetOrigin.length > 0,
  );
  if (matches.length !== 1)
    throw new Error('Connection auth checkpoint requires exactly one forwarded native sign-in');
  return matches[0];
}

function requireAuthIdentity(
  identities: readonly ConnectionAuthIdentityObservation[],
  requestId: number,
  actorAuthUid: string,
  targetOrigin: string,
  expectedApiIdentity: ConnectionAuthApiIdentity,
  expectedFixtureAuthUidAllowlistHash: string,
): ConnectionAuthIdentityObservation {
  if (identities.length === 0)
    throw new Error('Connection auth checkpoint native identity evidence is missing');
  const requestIds = new Set<number>();
  const ordinals = new Set<number>();
  for (const identity of identities) {
    if (
      !identity ||
      !Number.isSafeInteger(identity.requestId) ||
      identity.requestId < 1 ||
      requestIds.has(identity.requestId) ||
      !Number.isSafeInteger(identity.ordinal) ||
      identity.ordinal < 1 ||
      ordinals.has(identity.ordinal) ||
      typeof identity.targetOrigin !== 'string' ||
      identity.targetOrigin.length === 0 ||
      !Number.isSafeInteger(identity.apiPid) ||
      identity.apiPid < 1 ||
      !Number.isSafeInteger(identity.status) ||
      (identity.authUid !== null && typeof identity.authUid !== 'string') ||
      (identity.authUid !== null && identity.authUid.length === 0) ||
      !['verified', 'unverified'].includes(identity.verification) ||
      typeof identity.verificationReason !== 'string' ||
      identity.fixtureAuthUidAllowlistHash !== expectedFixtureAuthUidAllowlistHash
    )
      throw new Error('Connection auth checkpoint native identity evidence is invalid');
    requestIds.add(identity.requestId);
    ordinals.add(identity.ordinal);
  }
  const matches = identities.filter((identity) => identity.requestId === requestId);
  if (matches.length !== 1)
    throw new Error('Connection auth checkpoint native identity request binding is not unique');
  const identity = matches[0];
  if (
    identity.status !== 201 ||
    identity.verification !== 'verified' ||
    identity.verificationReason !== 'verified' ||
    identity.authUid !== actorAuthUid
  )
    throw new Error('Connection auth checkpoint authenticated fixture identity mismatch');
  if (identity.targetOrigin !== targetOrigin)
    throw new Error('Connection auth checkpoint native identity target mismatch');
  if (
    identity.targetOrigin !== expectedApiIdentity.targetOrigin ||
    identity.apiPid !== expectedApiIdentity.apiPid
  )
    throw new Error('Connection auth checkpoint native identity does not match the owned API');
  return { ...identity };
}

/** Validate the unlinked-to-pending submission span only. */
export function verifyConnectionSubmissionSnapshotTransition({
  before,
  pending,
  fixtures,
}: {
  before: OwnedConnectionSnapshot;
  pending: OwnedConnectionSnapshot;
  fixtures: Pick<OwnedFixtures, 'accounts'>;
}): void {
  verifyConnectionSnapshotPhaseTransition({
    before,
    after: pending,
    beforeCheckpoint: 'unlinked',
    afterCheckpoint: 'pending',
    fixtures,
  });
}

/** Validate the pending-after-coach-auth-to-active confirmation span only. */
export function verifyConnectionConfirmationSnapshotTransition({
  pending,
  active,
  fixtures,
}: {
  pending: OwnedConnectionSnapshot;
  active: OwnedConnectionSnapshot;
  fixtures: Pick<OwnedFixtures, 'accounts'>;
}): void {
  verifyConnectionSnapshotPhaseTransition({
    before: pending,
    after: active,
    beforeCheckpoint: 'pending',
    afterCheckpoint: 'active',
    fixtures,
  });
}

/**
 * Validate one normal native account switch between two contiguous state
 * checkpoints. The actor is fixture-derived and must also match a redacted
 * owned auth-response identity record; ProxyObservation itself carries no
 * principal UID, so those two evidence intents remain separate.
 */
export function verifyConnectionAuthCheckpoint({
  before,
  after,
  fixtures,
  actor,
  checkpoint,
  observations,
  authIdentities,
  expectedApiIdentity,
  afterRequestId,
  throughRequestId,
}: {
  before: OwnedConnectionSnapshot;
  after: OwnedConnectionSnapshot;
  fixtures: Pick<OwnedFixtures, 'accounts'>;
  actor: ConnectionAuthActor;
  checkpoint: 'pending' | 'active';
  observations: readonly ConnectionAuthTransportObservation[];
  authIdentities: readonly ConnectionAuthIdentityObservation[];
  expectedApiIdentity: ConnectionAuthApiIdentity;
  afterRequestId: number;
  throughRequestId: number;
}): ConnectionAuthCheckpointResult {
  if (
    (checkpoint === 'pending' && actor !== 'coach') ||
    (checkpoint === 'active' && actor !== 'student')
  )
    throw new Error('Connection auth checkpoint actor does not match its causal state');
  const expected = requireCausalSnapshotIdentity(before, after, fixtures, checkpoint);
  const actorAuthUid = fixtures.accounts[actor].authUid;
  assertAuthSnapshotDelta({ before, after, actorAuthUid });
  const matched = findUniqueAuthObservation(observations, { afterRequestId, throughRequestId });
  const matchedIdentity = requireAuthIdentity(
    authIdentities,
    matched.requestId,
    actorAuthUid,
    matched.targetOrigin,
    expectedApiIdentity,
    fixtureAuthUidAllowlistHash(fixtures),
  );
  return {
    actor,
    actorAuthUid,
    checkpoint,
    snapshotIdentity: {
      runId: expected.runId,
      scope: expected.scope,
      fixtureAuthUids: [...expected.fixtureAuthUids],
      target: structuredClone(after.target),
    },
    matchedObservation: {
      requestId: matched.requestId,
      method: matched.method,
      pathHash: matched.pathHash,
      status: matched.status,
      outcome: matched.outcome,
      requestProfile: matched.requestProfile,
      requestOrigin: matched.requestOrigin,
      targetOrigin: matched.targetOrigin,
    },
    matchedIdentity,
    actorIdentity: 'verified-from-owned-native-auth-identity',
    transportPrincipal: 'proxy-observation-has-no-principal-uid',
  };
}

/** Compose only contiguous phase/auth spans; no non-contiguous triad is passed through. */
export function verifyNativeConnectionJourney({
  before,
  pending,
  pendingAfterCoachAuth,
  active,
  activeAfterStudentAuth,
  fixtures,
  observations,
  authIdentities,
  expectedApiIdentity,
  coachAuth,
  studentAuth,
}: {
  before: OwnedConnectionSnapshot;
  pending: OwnedConnectionSnapshot;
  pendingAfterCoachAuth: OwnedConnectionSnapshot;
  active: OwnedConnectionSnapshot;
  activeAfterStudentAuth: OwnedConnectionSnapshot;
  fixtures: Pick<OwnedFixtures, 'accounts'>;
  observations: readonly ConnectionAuthTransportObservation[];
  authIdentities: readonly ConnectionAuthIdentityObservation[];
  expectedApiIdentity: ConnectionAuthApiIdentity;
  coachAuth: ConnectionAuthObservationWindow;
  studentAuth: ConnectionAuthObservationWindow;
}): {
  coachAuth: ConnectionAuthCheckpointResult;
  studentAuth: ConnectionAuthCheckpointResult;
} {
  verifyConnectionSubmissionSnapshotTransition({ before, pending, fixtures });
  const coachResult = verifyConnectionAuthCheckpoint({
    before: pending,
    after: pendingAfterCoachAuth,
    fixtures,
    actor: 'coach',
    checkpoint: 'pending',
    observations,
    authIdentities,
    expectedApiIdentity,
    ...coachAuth,
  });
  verifyConnectionConfirmationSnapshotTransition({
    pending: pendingAfterCoachAuth,
    active,
    fixtures,
  });
  const studentResult = verifyConnectionAuthCheckpoint({
    before: active,
    after: activeAfterStudentAuth,
    fixtures,
    actor: 'student',
    checkpoint: 'active',
    observations,
    authIdentities,
    expectedApiIdentity,
    ...studentAuth,
  });
  return { coachAuth: coachResult, studentAuth: studentResult };
}
