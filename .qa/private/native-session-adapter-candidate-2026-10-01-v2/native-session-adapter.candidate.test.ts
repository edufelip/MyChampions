import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  validateIosSessionAdapterCandidate,
  type IosSessionCaptureCandidate,
  type IosSessionAdapterCandidateInput,
} from './native-session-adapter.candidate';
import { requireNativePilotAssertions } from '../../../scripts/testing/native-pilot-contract';
import type { NativePilotSelection } from '../../../scripts/testing/native-pilot-contract';
import type { ProxyObservation } from '../../../scripts/testing/owned-api-proxy';
import type { OwnedDomainSnapshot } from '../../../scripts/testing/owned-session';

const root = path.resolve(__dirname, '../../..');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const apiOrigin = 'http://127.0.0.1:33123';
const requiredUiLabels = [
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
] as const;

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
    targetOrigin: apiOrigin,
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

function observations(): IosSessionCaptureCandidate['observations'] {
  return requiredUiLabels.map((label) => {
    const state = label === 'password-save-prompt' ? 'STATE-password-save' : undefined;
    const viewId = state
      ? state
      : label === 'signout-confirm' || label === 'signout-reopen'
        ? 'STATE-signout-confirm'
        : label === 'entry' || label === 'signout-confirmed' || label === 'signed-out-relaunch'
          ? 'SCR-sign-in'
          : label === 'coach-home' || label === 'restored-home'
            ? 'SCR-pro-home'
            : 'SCR-account';
    return {
      viewId,
      hierarchyPath: `${label}-hierarchy.json`,
      screenshotPath: `${label}.png`,
    };
  });
}

function capture(): IosSessionCaptureCandidate {
  return {
    kind: 'private-native-inventory-observation-not-behavior-attempt',
    mode: 'inventory',
    platform: 'ios',
    charter: 'session',
    result: 'observed',
    cleanup: 'cleaned',
    nativePassingCases: 0,
    observations: observations(),
    sessionUiObservationOrder: [...requiredUiLabels],
    sessionAssertionSequence: [
      'NAT-session-login',
      'NAT-session-restore',
      'NAT-session-account',
      'NAT-session-signout',
      'NAT-session-signed-out-relaunch',
      'NAT-session-unrelated-state',
    ],
    sessionInitialAuth: {
      actor: 'coach',
      actorAuthUid: 'coach-auth-uid',
      apiPid: 43123,
      targetOrigin: apiOrigin,
      authRequestId: 1,
      afterRequestId: 2,
    },
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
    sessionSqlBefore: {
      path: 'session-sql-before.private.json',
      runId: 'a'.repeat(24),
      scope: 'native-entry-ios',
      sha256: 'b'.repeat(64),
    },
    sessionSqlAfterSignedoutRelaunch: {
      path: 'session-sql-after-signed-out-relaunch.private.json',
      runId: 'a'.repeat(24),
      scope: 'native-entry-ios',
      sha256: 'c'.repeat(64),
    },
    sessionSqlBeforeAfterUnchanged: true,
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

void test('candidate validates the explicit ordered session charter without acquisition', async () => {
  const result = validateIosSessionAdapterCandidate(await input());
  assert.equal(result.charter, 'session');
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
  assert.deepEqual(result.evidence.ui.orderedLabels, requiredUiLabels);
});

void test('candidate rejects legacy charter, reordered UI and incomplete assertion ledger', async () => {
  const baseline = await input();
  const legacy = structuredClone(baseline);
  legacy.capture.charter = 'auth-account' as never;
  assert.throws(() => validateIosSessionAdapterCandidate(legacy), /session/);

  const reorderedUi = structuredClone(baseline);
  reorderedUi.capture.sessionUiObservationOrder = [
    'entry',
    'password-save-prompt',
    'coach-home',
    'account',
    'restored-home',
    ...requiredUiLabels.slice(5),
  ];
  assert.throws(() => validateIosSessionAdapterCandidate(reorderedUi), /canonical/);

  const incompleteLedger = structuredClone(baseline);
  incompleteLedger.capture.sessionAssertionSequence =
    incompleteLedger.capture.sessionAssertionSequence.slice(0, -1);
  assert.throws(() => validateIosSessionAdapterCandidate(incompleteLedger), /canonical/);
});

void test('candidate rejects missing or tampered signed-out transport and SQL evidence', async () => {
  const baseline = await input();
  const missingTransport = structuredClone(baseline) as IosSessionAdapterCandidateInput & {
    capture: IosSessionCaptureCandidate & { signedOutRelaunchTransport?: unknown };
  };
  delete missingTransport.capture.signedOutRelaunchTransport;
  assert.throws(
    () => validateIosSessionAdapterCandidate(missingTransport),
    /signedOutRelaunchTransport/,
  );

  const authenticatedTransport = structuredClone(baseline);
  authenticatedTransport.capture.signedOutRelaunchTransport = [observation(3, '/me/hydrate', 200)];
  assert.throws(
    () => validateIosSessionAdapterCandidate(authenticatedTransport),
    /authenticated sign-in or hydrate|range|bound to the owned native API/,
  );

  const wrongApi = structuredClone(baseline);
  wrongApi.capture.signedOutRelaunchTransport = [
    { ...observation(3, '/auth/email/sign-in', 401), targetOrigin: 'http://foreign.test' },
  ];
  wrongApi.capture.signedOutRelaunchTransportRange = {
    startOrdinal: 2,
    endOrdinalExclusive: 3,
    firstRequestId: 3,
    lastRequestId: 3,
  };
  wrongApi.transportObservations = [
    ...wrongApi.transportObservations,
    ...wrongApi.capture.signedOutRelaunchTransport,
  ];
  assert.throws(
    () => validateIosSessionAdapterCandidate(wrongApi),
    /bound to the owned native API|not linked/,
  );

  const tamperedRange = structuredClone(baseline);
  tamperedRange.capture.signedOutRelaunchTransportRange.endOrdinalExclusive = 1;
  assert.throws(
    () => validateIosSessionAdapterCandidate(tamperedRange),
    /Signed-out transport range escapes stream|not linked/,
  );

  const sqlMutation = structuredClone(baseline);
  sqlMutation.sessionSqlAfterSignedoutRelaunch = snapshot({
    trainingPlans: [validUnexpectedTrainingPlan],
  });
  assert.throws(() => validateIosSessionAdapterCandidate(sqlMutation), /training plans changed/);

  const missingSnapshot = structuredClone(baseline) as IosSessionAdapterCandidateInput & {
    sessionSqlBefore?: OwnedDomainSnapshot;
  };
  delete missingSnapshot.sessionSqlBefore;
  assert.throws(
    () => validateIosSessionAdapterCandidate(missingSnapshot),
    /Missing session SQL snapshot before journey/,
  );
});

void test('candidate keeps local logout scope and source patch boundaries explicit', async () => {
  const baseline = await input();
  const forged = structuredClone(baseline);
  forged.capture.nativeLogoutContract.serverRevocationQualified = true as never;
  assert.throws(() => validateIosSessionAdapterCandidate(forged), /serverRevocationQualified/);

  const patch = await readFile(
    path.join(
      root,
      '.qa/private/native-session-adapter-candidate-2026-10-01-v2/capture-native-testability.session-charter.patch',
    ),
    'utf8',
  );
  assert.match(patch, /'session'/);
  assert.match(patch, /nativeSessionAssertionIds/);
  assert.match(patch, /sessionAssertionSequence/);
  assert.match(patch, /signout-reopen/);
  assert.match(patch, /session-sql-before\.private\.json/);
  assert.match(patch, /session-sql-after-signed-out-relaunch\.private\.json/);
  assert.match(patch, /signedOutRelaunchTransportRange/);
  assert.equal(patch.includes("charter === 'auth-account'"), false);
  assert.equal(/\bSELECT\b|startOwnedSession|startOwnedApiProxy/.test(patch), false);
});
