import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  validateIosSessionAdapterCandidate,
  type IosSessionCaptureCandidate,
  type IosSessionAdapterCandidateInput,
} from './native-session-adapter.candidate';
import { requireNativePilotAssertions } from '../../../scripts/testing/native-pilot-contract';
import type { NativePilotSelection } from '../../../scripts/testing/native-pilot-contract';
import {
  nativeObservedSelectors,
  type ViewEvidence,
} from '../../../scripts/testing/native-view-evidence';
import type {
  NativeAuthIdentityObservation,
  ProxyObservation,
} from '../../../scripts/testing/owned-api-proxy';
import type { OwnedDomainSnapshot } from '../../../scripts/testing/owned-session';

const root = path.resolve(__dirname, '../../..');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const apiOrigin = 'http://127.0.0.1:33123';
const apiPid = 43123;
const runId = 'a'.repeat(24);
const artifactRoot = path.join(os.tmpdir(), 'owned-mychampions-runtime', runId);
const fixtureAuthUids = ['coach-auth-uid', 'student-auth-uid', 'unrelated-student-auth-uid'];
const fixtureAuthUidAllowlistHash = hash(JSON.stringify([...fixtureAuthUids].sort()));
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
const requiredUiPaths = requiredUiLabels.map((label) => `${label}-hierarchy.json`);
const requiredUiViews = [
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
    runId,
    scope: 'native-entry-ios',
    readOnly: true,
    trainingPlans: [],
    connections: [],
    ...changes,
  } as OwnedDomainSnapshot;
}

function identityRows(): NativeAuthIdentityObservation[] {
  return [
    {
      requestId: 1,
      ordinal: 1,
      targetOrigin: apiOrigin,
      apiPid,
      status: 201,
      authUid: 'coach-auth-uid',
      verification: 'verified',
      verificationReason: 'verified',
      fixtureAuthUidAllowlistHash,
    },
  ];
}

function hierarchy(viewId: string) {
  const selector = nativeObservedSelectors[viewId];
  assert(selector, `test selector missing for ${viewId}`);
  return JSON.stringify({
    attributes: {},
    children: [{ attributes: { [selector.attribute]: selector.value }, children: [] }],
  });
}

async function writeFrame(rootPath: string, index: number): Promise<ViewEvidence> {
  const hierarchyPath = requiredUiPaths[index]!;
  const screenshotPath = hierarchyPath.replace('-hierarchy.json', '.png');
  const viewId = requiredUiViews[index]!;
  const screenshotBytes = Buffer.from('89504e470d0a1a0a0001020304050607', 'hex');
  const hierarchyBytes = Buffer.from(hierarchy(viewId));
  await writeFile(path.join(rootPath, screenshotPath), screenshotBytes, { mode: 0o600 });
  await writeFile(path.join(rootPath, hierarchyPath), hierarchyBytes, { mode: 0o600 });
  return {
    viewId,
    screenshotPath,
    screenshotHash: hash(screenshotBytes),
    hierarchyPath,
    hierarchyHash: hash(hierarchyBytes),
    reviewed: false,
  };
}

async function writeReceipt(rootPath: string, file: string, value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2));
  await writeFile(path.join(rootPath, file), bytes, { mode: 0o600 });
  return {
    path: file,
    sha256: hash(bytes),
    bytes: bytes.length,
    runId,
    scope: 'native-entry-ios',
    ownedRunId: runId,
    fixtureScope: 'native-entry-ios',
    artifactRoot,
    apiPid,
    targetOrigin: apiOrigin,
    fixtureAuthUidAllowlistHash,
  } as const;
}

async function makeCapture(rootPath: string): Promise<IosSessionCaptureCandidate> {
  const observations = await Promise.all(
    requiredUiPaths.map((_, index) => writeFrame(rootPath, index)),
  );
  const before = snapshot();
  const after = snapshot();
  const sqlBefore = await writeReceipt(rootPath, 'session-sql-before.private.json', before);
  const sqlAfter = await writeReceipt(
    rootPath,
    'session-sql-after-signed-out-relaunch.private.json',
    after,
  );
  const authIdentities = identityRows();
  const identityBytes = Buffer.from(JSON.stringify(authIdentities, null, 2));
  await writeFile(path.join(rootPath, 'native-auth-identities.private.json'), identityBytes, {
    mode: 0o600,
  });
  return {
    kind: 'private-native-inventory-observation-not-behavior-attempt',
    mode: 'inventory',
    platform: 'ios',
    charter: 'session',
    result: 'observed',
    cleanup: 'cleaned',
    nativePassingCases: 0,
    observations,
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
      apiPid,
      targetOrigin: apiOrigin,
      authRequestId: 1,
      afterRequestId: 2,
    },
    nativeAuthIdentityEvidence: {
      path: 'native-auth-identities.private.json',
      sha256: hash(identityBytes),
      bytes: identityBytes.length,
      runId,
      scope: 'native-entry-ios',
      ownedRunId: runId,
      fixtureScope: 'native-entry-ios',
      artifactRoot,
      apiPid,
      targetOrigin: apiOrigin,
      fixtureAuthUidAllowlistHash,
    },
    authMetadataBeforeRelaunch: metadata(true),
    authMetadataAfterRelaunch: metadata(true),
    authMetadataAfterSignout: metadata(false),
    authMetadataAfterSignedoutRelaunch: metadata(false),
    relaunchTransport: [observation(2, '/me/hydrate', 200)],
    relaunchTransportRange: {
      startOrdinal: 1,
      endOrdinalExclusive: 2,
      firstRequestId: 2,
      lastRequestId: 2,
    },
    signedOutRelaunchTransport: [],
    signedOutRelaunchTransportRange: {
      startOrdinal: 2,
      endOrdinalExclusive: 2,
      firstRequestId: null,
      lastRequestId: null,
    },
    sessionSqlBefore: sqlBefore,
    sessionSqlAfterSignedoutRelaunch: sqlAfter,
    sessionSqlBeforeAfterUnchanged: true,
    nativeLogoutContract: {
      requirementRefs: ['FR-270', 'BR-342'],
      scope: 'local-native-session-clear',
      serverRevocationQualified: false,
    },
  };
}

async function makeInput(): Promise<{ input: IosSessionAdapterCandidateInput; rootPath: string }> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'native-session-v3-evidence-'));
  const rootPath = await realpath(tempRoot);
  await chmod(rootPath, 0o700);
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
  const capture = await makeCapture(rootPath);
  const nativeAuthIdentities = identityRows();
  assert.equal(requireNativePilotAssertions(selection).length, 6);
  return {
    rootPath,
    input: {
      selection,
      capture,
      evidenceRoot: rootPath,
      fixtureAuthUids,
      ownedSessionManifest: {
        runId,
        artifactRoot,
        fixtureScopes: ['native-entry-ios'],
        coachAuthUid: 'coach-auth-uid',
        apiPid,
        apiOrigin,
      },
      transportObservations: [
        observation(1, '/auth/email/sign-in', 201),
        observation(2, '/me/hydrate', 200),
      ],
      nativeAuthIdentities,
      sessionSqlBefore: snapshot(),
      sessionSqlAfterSignedoutRelaunch: snapshot(),
    },
  };
}

void test('v3 validates owned ordered session evidence without acquisition', async () => {
  const scenario = await makeInput();
  try {
    const result = validateIosSessionAdapterCandidate(scenario.input);
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
  } finally {
    await rm(scenario.rootPath, { recursive: true, force: true });
  }
});

void test('v3 rejects legacy charter, reordered UI and incomplete assertion ledger', async () => {
  const scenario = await makeInput();
  try {
    const baseline = scenario.input;
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
  } finally {
    await rm(scenario.rootPath, { recursive: true, force: true });
  }
});

void test('v3 rejects range, owned transport, absent metadata, and SQL receipt tampering', async () => {
  const scenario = await makeInput();
  try {
    const baseline = scenario.input;
    const foreignTransport = structuredClone(baseline);
    foreignTransport.capture.relaunchTransport = [
      { ...observation(2, '/me/hydrate', 200), targetOrigin: 'http://foreign.test:33123' },
    ];
    assert.throws(
      () => validateIosSessionAdapterCandidate(foreignTransport),
      /another API|non-owned|range|linked/,
    );

    const tamperedRange = structuredClone(baseline);
    tamperedRange.capture.relaunchTransportRange.endOrdinalExclusive = 1;
    assert.throws(() => validateIosSessionAdapterCandidate(tamperedRange), /range|linked/);

    const authenticatedTransport = structuredClone(baseline);
    authenticatedTransport.capture.signedOutRelaunchTransport = [
      observation(3, '/me/hydrate', 200),
    ];
    authenticatedTransport.capture.signedOutRelaunchTransportRange = {
      startOrdinal: 2,
      endOrdinalExclusive: 3,
      firstRequestId: 3,
      lastRequestId: 3,
    };
    authenticatedTransport.transportObservations = [
      ...authenticatedTransport.transportObservations,
      ...authenticatedTransport.capture.signedOutRelaunchTransport,
    ];
    assert.throws(
      () => validateIosSessionAdapterCandidate(authenticatedTransport),
      /authenticated routes|range|linked/,
    );

    const positiveAbsentMetadata = structuredClone(baseline);
    positiveAbsentMetadata.capture.authMetadataAfterSignout = {
      status: 'session-absent',
      sessionPresent: false,
      profilePresent: true,
    };
    assert.throws(() => validateIosSessionAdapterCandidate(positiveAbsentMetadata), /exposed/);

    const tamperedSqlReceipt = structuredClone(baseline);
    tamperedSqlReceipt.capture.sessionSqlBefore.sha256 = '0'.repeat(64);
    assert.throws(() => validateIosSessionAdapterCandidate(tamperedSqlReceipt), /does not match/);
  } finally {
    await rm(scenario.rootPath, { recursive: true, force: true });
  }
});

void test('v3 rejects forged identity provenance and actual evidence bytes/selectors', async () => {
  const scenario = await makeInput();
  try {
    const forgedIdentity = structuredClone(scenario.input);
    forgedIdentity.nativeAuthIdentities[0]!.authUid = 'foreign-auth-uid';
    assert.throws(
      () => validateIosSessionAdapterCandidate(forgedIdentity),
      /differ from the owned identity input|outside the fixture allowlist/,
    );

    const forgedActor = structuredClone(scenario.input);
    forgedActor.capture.sessionInitialAuth.actorAuthUid = 'student-auth-uid';
    assert.throws(
      () => validateIosSessionAdapterCandidate(forgedActor),
      /coach-auth-uid|does not match|actor is outside|Initial auth identity/,
    );

    const hierarchyPath = path.join(scenario.rootPath, 'coach-home-hierarchy.json');
    await writeFile(
      hierarchyPath,
      JSON.stringify({ attributes: {}, children: [{ attributes: { 'resource-id': 'wrong' } }] }),
      { mode: 0o600 },
    );
    assert.throws(
      () => validateIosSessionAdapterCandidate(scenario.input),
      /evidence bytes changed|exact actual-tree selector|Native observation lacks PNG/,
    );
  } finally {
    await rm(scenario.rootPath, { recursive: true, force: true });
  }
});

void test('v3 source patch persists ownership and uses existing bounded evidence readers', async () => {
  const patch = await readFile(
    path.join(
      root,
      '.qa/private/native-session-adapter-candidate-2026-10-01-v3/capture-native-testability.session-charter.v3.patch',
    ),
    'utf8',
  );
  assert.match(patch, /native-auth-identities\.private\.json/);
  assert.match(patch, /fixtureAuthUidAllowlistHash/);
  assert.match(patch, /relaunchTransportRange/);
  assert.match(patch, /readNativeEvidence/);
  assert.match(patch, /validateNativeRuntimeFrameFiles/);
  assert.match(patch, /ownedSessionSqlBeforeBytes/);
  assert.match(patch, /requireSignedOutMetadata/);
  assert.equal(patch.includes("charter === 'auth-account'"), false);
  assert.equal(/\bSELECT\b|startOwnedSession|startOwnedApiProxy/.test(patch), false);
});
