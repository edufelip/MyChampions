import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  validateIosSessionAdapterCandidate,
  type IosAuthAccountCaptureCandidate,
  type IosSessionAdapterCandidateInput,
} from './native-session-adapter.candidate';
import { requireNativePilotAssertions } from '../../../scripts/testing/native-pilot-contract';
import type { NativePilotSelection } from '../../../scripts/testing/native-pilot-contract';
import type { ProxyObservation } from '../../../scripts/testing/owned-api-proxy';
import type { OwnedDomainSnapshot } from '../../../scripts/testing/owned-session';

const root = path.resolve(__dirname, '../../..');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function observation(
  requestId: number,
  route: '/auth/email/sign-in' | '/me/hydrate',
  status: number,
): ProxyObservation {
  return {
    requestId,
    method: route === '/auth/email/sign-in' ? 'POST' : 'GET',
    pathHash: hash(route),
    requestOrigin: null,
    requestProfile: 'native',
    targetOrigin: 'http://127.0.0.1:33123',
    status,
    outcome: 'forwarded',
    faultAttemptId: null,
    elapsedMs: 1,
  };
}

function metadata(present: boolean) {
  return present
    ? {
        status: 'session-present' as const,
        sessionPresent: true,
        profilePresent: true,
        expiryPresent: true,
        plaintextAccessTokenPresent: false,
        plaintextRefreshTokenPresent: false,
      }
    : { status: 'session-absent' as const, sessionPresent: false };
}

function snapshot(changes: Record<string, unknown> = {}): OwnedDomainSnapshot {
  return {
    schemaVersion: 1,
    runId: 'a'.repeat(24),
    scope: 'native-entry-ios',
    readOnly: true,
    trainingPlans: [],
    connections: [],
    ...changes,
  } as OwnedDomainSnapshot;
}

const validUnexpectedTrainingPlan = {
  id: 'unexpected-plan',
  studentAuthUid: 'student-auth-uid',
  ownerProfessionalUid: null,
  sourceKind: 'self_managed' as const,
  name: null,
  isArchived: false,
  isDraft: false,
  lifecycleConnectionId: null,
  sessions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function observations(): IosAuthAccountCaptureCandidate['observations'] {
  return [
    'entry-hierarchy.json',
    'coach-home-hierarchy.json',
    'restored-home-hierarchy.json',
    'restored-account-hierarchy.json',
    'restored-identity-hierarchy.json',
    'account-hierarchy.json',
    'signout-confirm-hierarchy.json',
    'cancel-signout-hierarchy.json',
    'signed-out-hierarchy.json',
    'signed-out-relaunch-hierarchy.json',
  ].map((hierarchyPath) => ({
    viewId: hierarchyPath.includes('home') ? 'SCR-pro-home' : 'SCR-account',
    hierarchyPath,
    screenshotPath: hierarchyPath.replace('.json', '.png'),
  }));
}

function capture(): IosAuthAccountCaptureCandidate {
  return {
    kind: 'private-native-inventory-observation-not-behavior-attempt',
    mode: 'inventory',
    platform: 'ios',
    charter: 'auth-account',
    result: 'observed',
    cleanup: 'cleaned',
    nativePassingCases: 0,
    observations: observations(),
    authMetadataBeforeRelaunch: metadata(true),
    authMetadataAfterRelaunch: metadata(true),
    authMetadataAfterSignout: metadata(false),
    authMetadataAfterSignedoutRelaunch: metadata(false),
    relaunchTransport: [observation(2, '/me/hydrate', 200)],
    signedOutRelaunchTransport: [],
    signedOutRelaunchTransportRange: {
      startOrdinal: 2,
      endOrdinalExclusive: 2,
      firstRequestId: null,
      lastRequestId: null,
    },
    nativeLogoutContract: {
      requirementRefs: ['FR-270', 'BR-342'],
      scope: 'local-native-session-clear',
      serverRevocationQualified: false,
    },
  };
}

async function input(): Promise<IosSessionAdapterCandidateInput> {
  const inventory = JSON.parse(
    await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as { scenarios: NativePilotSelection['scenario'][] };
  const scenario = inventory.scenarios.find((row) => row.id === 'SCN-session-ios');
  assert(scenario, 'session scenario fixture is missing');
  const selection: NativePilotSelection = {
    arguments: {
      platform: 'ios',
      engine: 'maestro',
      scenario: 'SCN-session-ios',
      mode: 'integration',
    },
    scenarioHash: '0'.repeat(64),
    requirementHash: '0'.repeat(64),
    scenario: structuredClone(scenario),
  };
  assert.equal(requireNativePilotAssertions(selection).length, 6);
  return {
    selection,
    capture: capture(),
    transportObservations: [
      observation(1, '/auth/email/sign-in', 201),
      observation(2, '/me/hydrate', 200),
    ],
    sessionSqlBefore: snapshot(),
    sessionSqlAfterSignedoutRelaunch: snapshot(),
  };
}

void test('candidate iOS session adapter validates auth-account UI/API/storage/SQL evidence without acquisition', async () => {
  const result = validateIosSessionAdapterCandidate(await input());
  assert.deepEqual(result.assertionIds, [
    'NAT-session-login',
    'NAT-session-restore',
    'NAT-session-account',
    'NAT-session-signout',
    'NAT-session-signed-out-relaunch',
    'NAT-session-unrelated-state',
  ]);
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.serverRevocationQualified, false);
  assert.deepEqual(result.evidence.api.signInRequestIds, [1]);
  assert.deepEqual(result.evidence.api.restorationHydrateRequestIds, [2]);
  assert.equal(result.evidence.sql.unchangedConnections, true);
});

void test('candidate rejects missing signed-out transport, storage clearing or unrelated SQL proof', async () => {
  const baseline = await input();
  const missingTransportField = structuredClone(baseline);
  delete (missingTransportField.capture as { signedOutRelaunchTransport?: unknown })
    .signedOutRelaunchTransport;
  assert.throws(
    () => validateIosSessionAdapterCandidate(missingTransportField),
    /Missing signedOutRelaunchTransport evidence/,
  );

  const missingTransport = structuredClone(baseline);
  missingTransport.capture.signedOutRelaunchTransport = [observation(3, '/me/hydrate', 200)];
  assert.throws(
    () => validateIosSessionAdapterCandidate(missingTransport),
    /Signed-out relaunch must not issue/,
  );

  const tamperedTransportRange = structuredClone(baseline);
  tamperedTransportRange.capture.signedOutRelaunchTransportRange.endOrdinalExclusive = 1;
  assert.throws(
    () => validateIosSessionAdapterCandidate(tamperedTransportRange),
    /Signed-out transport range escapes stream|not linked to the all-observation range/,
  );

  const storageLeak = structuredClone(baseline);
  storageLeak.capture.authMetadataAfterSignout = metadata(true);
  assert.throws(
    () => validateIosSessionAdapterCandidate(storageLeak),
    /after sign-out session presence/,
  );

  const sqlMutation = structuredClone(baseline);
  sqlMutation.sessionSqlAfterSignedoutRelaunch = snapshot({
    trainingPlans: [validUnexpectedTrainingPlan],
  });
  assert.throws(() => validateIosSessionAdapterCandidate(sqlMutation), /training plans changed/);

  const missingBefore = structuredClone(baseline) as IosSessionAdapterCandidateInput & {
    sessionSqlBefore?: OwnedDomainSnapshot;
  };
  delete missingBefore.sessionSqlBefore;
  assert.throws(
    () => validateIosSessionAdapterCandidate(missingBefore),
    /Missing session SQL snapshot before journey/,
  );

  const missingAfter = structuredClone(baseline) as IosSessionAdapterCandidateInput & {
    sessionSqlAfterSignedoutRelaunch?: OwnedDomainSnapshot;
  };
  delete missingAfter.sessionSqlAfterSignedoutRelaunch;
  assert.throws(
    () => validateIosSessionAdapterCandidate(missingAfter),
    /Missing session SQL snapshot after signed-out relaunch/,
  );
});

void test('candidate rejects a server-revocation claim and missing ordered session contract', async () => {
  const baseline = await input();
  const forged = structuredClone(baseline) as NativePilotSelection &
    IosSessionAdapterCandidateInput;
  forged.capture.nativeLogoutContract.serverRevocationQualified = true as never;
  assert.throws(() => validateIosSessionAdapterCandidate(forged), /serverRevocationQualified/);

  const altered = await input();
  altered.selection.scenario.pilotAssertions!.reverse();
  assert.throws(
    () => validateIosSessionAdapterCandidate(altered),
    /complete declared contract|ordered canonical assertions/,
  );
});

void test('candidate seam reuses owned snapshot and transport contracts without ad hoc runtime wiring', async () => {
  const patch = await readFile(
    path.join(
      root,
      '.qa/private/native-session-adapter-candidate-2026-10-01-v1/capture-native-testability.seam.patch',
    ),
    'utf8',
  );
  assert.equal((patch.match(/session\.snapshot\('native-entry-ios'\)/g) ?? []).length, 2);
  assert.match(patch, /session-sql-before\.private\.json/);
  assert.match(patch, /session-sql-after-signed-out-relaunch\.private\.json/);
  assert.match(patch, /signedOutRelaunchTransportRange/);
  assert.match(patch, /sessionSqlBeforeAfterUnchanged/);
  assert.equal(/\bSELECT\b|startOwnedSession|startOwnedApiProxy/.test(patch), false);
});
