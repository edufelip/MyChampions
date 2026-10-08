import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { requireIntegratedLoopbackOrigin } from './integration-preflight';
import { requireConnectionSnapshot } from './native-connection-snapshot';
import { assertTestingDocument } from './schema-validation';
import type { OwnedConnectionSnapshot } from './native-connection-snapshot';
import type { NativeAuthIdentityObservation, ProxyObservation } from './owned-api-proxy';
import type { OwnedDomainSnapshot } from './owned-session';

export const nativeSessionProfileCheckpointIds = [
  'beforeLogin',
  'afterLogin',
  'afterRestoration',
  'afterSignedOutRelaunch',
] as const;
type Checkpoint = (typeof nativeSessionProfileCheckpointIds)[number];
type Window = { afterRequestId: number; throughRequestId: number };

export type NativeSessionProfileCheckpointInput = {
  platform: 'ios' | 'android';
  backendRunId: string;
  fixtureAuthUids: readonly string[];
  coachAuthUid: string;
  studentAuthUid: string;
  expectedApiIdentity: { apiPid: number; targetOrigin: string };
  profiles: Record<Checkpoint, OwnedConnectionSnapshot>;
  domain: Record<Checkpoint, OwnedDomainSnapshot>;
  observations: readonly ProxyObservation[];
  authIdentities: readonly NativeAuthIdentityObservation[];
  loginWindow: Window;
  restorationWindow: Window;
  /**
   * Signed-in relaunches after restoration (Android storage snapshots
   * force-stop the app). Each must hydrate exactly once.
   */
  relaunchWindows?: readonly Window[];
  /** Hashes read from the actual persisted native session profile, never SQL-derived. */
  persistedCoachIdentity: { afterLoginAuthUidHash: string; afterRestorationAuthUidHash: string };
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const loginPath = hash('/auth/email/sign-in');
const hydratePath = hash('/me/hydrate');

function windowRows(observations: readonly ProxyObservation[], window: Window) {
  assert.ok(Number.isSafeInteger(window.afterRequestId) && window.afterRequestId >= 0);
  assert.ok(
    Number.isSafeInteger(window.throughRequestId) &&
      window.throughRequestId > window.afterRequestId,
    'Session profile checkpoint requires a bounded request window',
  );
  const rows = observations.filter(
    (row) => row.requestId > window.afterRequestId && row.requestId <= window.throughRequestId,
  );
  assert.ok(rows.length > 0, 'Session profile checkpoint transport is missing');
  return rows;
}

function requireNativeRequest(row: ProxyObservation, input: NativeSessionProfileCheckpointInput) {
  assert.equal(row.requestProfile, 'native');
  assert.equal(row.requestOrigin, null);
  assert.equal(row.outcome, 'forwarded');
  assert.equal(row.faultAttemptId, null);
  assert.equal(row.targetOrigin, input.expectedApiIdentity.targetOrigin);
}

function profileDelta(
  before: OwnedConnectionSnapshot,
  after: OwnedConnectionSnapshot,
  coachAuthUid: string,
) {
  assert.deepEqual(after.rowCounts, before.rowCounts, 'Session changed projected row counts');
  for (const name of Object.keys(before.rows) as (keyof OwnedConnectionSnapshot['rows'])[]) {
    if (name !== 'userProfiles') {
      assert.deepEqual(after.rows[name], before.rows[name], `Session changed ${name}`);
      continue;
    }
    for (const [index, row] of before.rows.userProfiles.entries()) {
      const next = after.rows.userProfiles[index];
      assert.ok(next, 'Session profile row disappeared');
      assert.equal(next.authUid, row.authUid, 'Session profile identity/order changed');
      if (row.authUid !== coachAuthUid) {
        assert.deepEqual(next, row, 'Session changed another actor profile');
        continue;
      }
      const { updatedAt: beforeTime, ...beforeFields } = row;
      const { updatedAt: afterTime, ...afterFields } = next;
      assert.deepEqual(afterFields, beforeFields, 'Session changed coach fields beyond updatedAt');
      const previous = Date.parse(beforeTime);
      const current = Date.parse(afterTime);
      assert.ok(Number.isFinite(previous) && Number.isFinite(current), 'Invalid profile timestamp');
      assert.ok(current >= previous, 'Session coach updatedAt regressed');
      if (current === previous)
        assert.equal(afterTime, beforeTime, 'Session changed timestamp encoding without advancing');
    }
  }
}

/**
 * Verifies parsed owned evidence only. Callers must read/hash actual private SQL,
 * proxy, identity and native-storage files before calling; this is not a public
 * receipt, process owner, native action, or substitute for those file checks.
 */
export function verifyNativeSessionProfileCheckpoints(input: NativeSessionProfileCheckpointInput) {
  assert.ok(input.platform === 'ios' || input.platform === 'android');
  assert.match(input.backendRunId, /^[a-f0-9]{24}$/);
  requireIntegratedLoopbackOrigin(input.expectedApiIdentity.targetOrigin);
  assert.ok(
    Number.isSafeInteger(input.expectedApiIdentity.apiPid) && input.expectedApiIdentity.apiPid > 1,
  );
  const fixtureAuthUids = [...input.fixtureAuthUids].sort();
  assert.ok(fixtureAuthUids.length >= 2);
  assert.equal(new Set(fixtureAuthUids).size, fixtureAuthUids.length);
  assert.ok(fixtureAuthUids.every((uid) => typeof uid === 'string' && uid.length > 0));
  assert.ok(fixtureAuthUids.includes(input.coachAuthUid));
  assert.ok(fixtureAuthUids.includes(input.studentAuthUid));
  assert.notEqual(input.coachAuthUid, input.studentAuthUid);
  const scope = `native-entry-${input.platform}`;
  const expected = {
    runId: input.backendRunId,
    scope,
    fixtureAuthUids,
    target: {
      professionalAuthUid: input.coachAuthUid,
      studentAuthUid: input.studentAuthUid,
      specialty: 'fitness_coach' as const,
    },
  };
  for (const checkpoint of nativeSessionProfileCheckpointIds) {
    const profile = requireConnectionSnapshot(input.profiles[checkpoint], expected);
    assert.deepEqual(
      profile.rows.userProfiles.map((row) => row.authUid),
      fixtureAuthUids,
      'Session SQL must observe every fixture profile',
    );
    const coach = profile.rows.userProfiles.find((row) => row.authUid === input.coachAuthUid)!;
    assert.equal(coach.lockedRole, 'professional');
    assert.equal(coach.acceptedTermsVersion, 'v1');
    const domain = input.domain[checkpoint];
    assertTestingDocument('domain-snapshot-v1', domain);
    assert.equal(domain.runId, input.backendRunId);
    assert.equal(domain.scope, scope);
    assert.equal(domain.readOnly, true);
    assert.deepEqual(domain, input.domain.beforeLogin, `Session changed domain at ${checkpoint}`);
  }

  const requestIds = new Set<number>();
  for (const row of input.observations) {
    assert.ok(Number.isSafeInteger(row.requestId) && row.requestId > 0);
    assert.equal(requestIds.has(row.requestId), false, 'Duplicate session transport request');
    requestIds.add(row.requestId);
    requireNativeRequest(row, input);
  }
  assert.ok(
    input.loginWindow.throughRequestId <= input.restorationWindow.afterRequestId,
    'Session profile request windows overlap or are reversed',
  );
  const loginRows = windowRows(input.observations, input.loginWindow);
  const restoreRows = windowRows(input.observations, input.restorationWindow);
  const logins = input.observations.filter((row) => row.pathHash === loginPath);
  assert.equal(logins.length, 1, 'Session profile proof requires exactly one sign-in');
  const login = logins[0];
  assert.equal(login.method, 'POST');
  assert.equal(login.status, 201);
  assert.ok(loginRows.includes(login), 'Session sign-in is outside the login checkpoint');
  assert.equal(
    restoreRows.some((row) => row.pathHash === loginPath),
    false,
  );
  const hydrates = restoreRows.filter((row) => row.pathHash === hydratePath);
  assert.equal(hydrates.length, 1, 'Session restoration requires exactly one hydrate');
  assert.equal(hydrates[0].method, 'POST');
  assert.equal(hydrates[0].status, 200);
  let previousThrough = input.restorationWindow.throughRequestId;
  const relaunchRows = (input.relaunchWindows ?? []).map((window) => {
    assert.ok(
      window.afterRequestId >= previousThrough,
      'Session relaunch windows overlap or are reversed',
    );
    previousThrough = window.throughRequestId;
    const rows = windowRows(input.observations, window);
    assert.equal(
      rows.filter((row) => row.pathHash === hydratePath).length,
      1,
      'Session relaunch requires exactly one hydrate',
    );
    return rows;
  });
  for (const row of input.observations.filter((row) => row.pathHash === hydratePath)) {
    assert.ok(
      loginRows.includes(row) ||
        restoreRows.includes(row) ||
        relaunchRows.some((rows) => rows.includes(row)),
      'Hydrate is outside declared auth spans',
    );
    assert.equal(row.method, 'POST');
    assert.equal(row.status, 200);
  }

  assert.equal(input.authIdentities.length, 1, 'Session sign-in identity is not unique');
  const identity = input.authIdentities[0];
  assert.equal(identity.requestId, login.requestId);
  assert.ok(Number.isSafeInteger(identity.ordinal) && identity.ordinal > 0);
  assert.equal(identity.status, 201);
  assert.equal(identity.verification, 'verified');
  assert.equal(identity.verificationReason, 'verified');
  assert.equal(identity.authUid, input.coachAuthUid);
  assert.equal(identity.apiPid, input.expectedApiIdentity.apiPid);
  assert.equal(identity.targetOrigin, input.expectedApiIdentity.targetOrigin);
  assert.equal(identity.fixtureAuthUidAllowlistHash, hash(JSON.stringify(fixtureAuthUids)));
  const coachHash = hash(input.coachAuthUid);
  assert.equal(input.persistedCoachIdentity.afterLoginAuthUidHash, coachHash);
  assert.equal(input.persistedCoachIdentity.afterRestorationAuthUidHash, coachHash);

  profileDelta(input.profiles.beforeLogin, input.profiles.afterLogin, input.coachAuthUid);
  profileDelta(input.profiles.afterLogin, input.profiles.afterRestoration, input.coachAuthUid);
  // Each declared signed-in relaunch hydrates, which may advance only the
  // coach's updatedAt; without relaunches the rows must be identical.
  if ((input.relaunchWindows ?? []).length > 0)
    profileDelta(
      input.profiles.afterRestoration,
      input.profiles.afterSignedOutRelaunch,
      input.coachAuthUid,
    );
  else
    assert.deepEqual(
      input.profiles.afterSignedOutRelaunch,
      input.profiles.afterRestoration,
      'Session changed profile/domain rows after restoration',
    );
  return {
    kind: 'native-session-profile-checkpoint-verification' as const,
    status: 'verified' as const,
    checkpointIds: [...nativeSessionProfileCheckpointIds],
    signInRequestId: login.requestId,
    restorationHydrateRequestId: hydrates[0].requestId,
    coachAuthUidHash: coachHash,
    timestampException: 'bound-coach-updatedAt-in-login-and-restoration-spans-only' as const,
    nativePassingCases: 0 as const,
  };
}

/** Checks the complete, stopped proxy stream and a fence taken before termination. */
export function requireSignedOutSessionTransport(input: {
  observations: readonly ProxyObservation[];
  window: Window;
  expectedTargetOrigin: string;
}) {
  requireIntegratedLoopbackOrigin(input.expectedTargetOrigin);
  const { afterRequestId, throughRequestId } = input.window;
  assert.ok(Number.isSafeInteger(afterRequestId) && afterRequestId >= 0);
  assert.ok(Number.isSafeInteger(throughRequestId) && throughRequestId >= afterRequestId);
  const ids = new Set(input.observations.map((row) => row.requestId));
  assert.equal(ids.size, input.observations.length, 'Closed session stream repeats request IDs');
  assert.equal(ids.size, throughRequestId, 'Closed session stream is incomplete');
  for (let requestId = 1; requestId <= throughRequestId; requestId++)
    assert.ok(ids.has(requestId), 'Closed session stream lacks a started request');
  const rows = input.observations.filter((row) => row.requestId > afterRequestId);
  for (const row of rows) {
    assert.ok(row.requestId <= throughRequestId, 'Session request escaped the closed window');
    assert.equal(row.requestProfile, 'native');
    assert.equal(row.requestOrigin, null);
    assert.equal(row.outcome, 'forwarded');
    assert.equal(row.faultAttemptId, null);
    assert.equal(row.targetOrigin, input.expectedTargetOrigin);
    assert.equal(row.requestCredentialPresent, false, 'Signed-out request carried credentials');
    assert.notEqual(row.pathHash, loginPath, 'Signed-out relaunch submitted credentials');
    assert.notEqual(row.pathHash, hydratePath, 'Signed-out relaunch hydrated a session');
  }
  return rows;
}

/** A saved receipt must still describe the exact final stream, never a rewritten snapshot. */
export function requireFinalSessionTransport(
  bytes: Buffer,
  receipt: { bytes: number; sha256: string },
  finalObservations: readonly unknown[],
) {
  assert.equal(bytes.length, receipt.bytes, 'Session transport byte length changed');
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    receipt.sha256,
    'Session transport hash changed',
  );
  assert.deepEqual(
    JSON.parse(bytes.toString()),
    finalObservations,
    'Session transport changed after publication',
  );
}

/** Publish the private ledger only while the owned observation is still active. */
export function publishNativeSessionLedger(
  report: Record<string, unknown>,
  ledger: Record<string, unknown>,
  signal: AbortSignal,
) {
  const previous = new Map(
    Object.keys(ledger).map(
      (key) => [key, { present: Object.hasOwn(report, key), value: report[key] }] as const,
    ),
  );
  try {
    signal.throwIfAborted();
    Object.assign(report, ledger);
    signal.throwIfAborted();
    report.sessionEvidencePublication = 'complete';
  } catch (error) {
    for (const [key, entry] of previous) {
      if (entry.present) report[key] = entry.value;
      else delete report[key];
    }
    report.sessionEvidencePublication = 'aborted-before-complete';
    throw error;
  }
}
