import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { enUS } from '../../localization/en-US';
import { androidSourceIdentity } from '../../scripts/testing/android-build-identity';
import { resolveAndroidProfessionalRosterTarget } from '../../scripts/testing/native-connection-hierarchy-android';
import {
  observeIosConnectionJourney,
  requireAndroidRosterFrameQualification,
} from '../../scripts/testing/native-connection-journey';
import {
  ANDROID_CONNECTION_PLATFORM,
  IOS_CONNECTION_PLATFORM,
  CONNECTION_PURPOSE_PLANS,
  CONNECTION_SNAPSHOT_KEYS,
  buildConnectionJourneyActionPlan,
  buildConnectionJourneyArtifactContract,
  requireConnectionPlatformProfile,
  requireConnectionPurposePlan,
} from '../../scripts/testing/native-connection-platform-contract';
import {
  assertNativeConnectionBackendProvenance,
  assertNativeConnectionObservationRoute,
  assertNativeConnectionProofExact,
  buildNativeConnectionAssertionBindings,
  nativeConnectionAssertionEvidenceKind,
  nativeConnectionEvidenceReferences,
  prepareAndroidConnectionPilotEvidence,
  stageAndroidConnectionPublicEvidence,
} from '../../scripts/testing/native-connection-public-evidence-android';
import { requireNativePilotAssertions } from '../../scripts/testing/native-pilot-contract';
import {
  ANDROID_CONNECTION_ADAPTER_STATUS,
  buildAndroidConnectionAttemptPlan,
  requireAndroidConnectionNavigation,
  requireAndroidConnectionProfile,
  requireAndroidConnectionRepositoryRoot,
  requireAndroidConnectionSelection,
  runAndroidConnectionAttempt,
  validateAndroidConnectionRuntimeContextShape,
} from '../../scripts/testing/run-android-connection-attempt';
import { assertTestingDocument } from '../../scripts/testing/schema-validation';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

type Selection = NativePilotSelection;
const runId = '0123456789abcdef01234567';
const apiOrigin = 'http://127.0.0.1:49123';

function androidSelection(): Selection {
  const inventory = JSON.parse(
    readFileSync(path.resolve(process.cwd(), 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as {
    scenarios: Selection['scenario'][];
  };
  const scenario = inventory.scenarios.find((row) => row.id === 'SCN-connection-android');
  assert(scenario, 'Android connection inventory scenario is unavailable');
  return {
    arguments: {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-connection-android',
      mode: 'integration',
    },
    scenario,
    scenarioHash: 'a'.repeat(64),
    requirementHash: 'b'.repeat(64),
  };
}

function contextShape() {
  return {
    output: '/private/candidate/output',
    fixtures: {},
    proxy: {},
    apiIdentity: { apiPid: 4123, targetOrigin: apiOrigin },
    observe: () => Promise.resolve(),
    snapshot: () => Promise.resolve({}),
    connectionSnapshot: () => Promise.resolve({}),
    isolationSnapshot: () => Promise.resolve({}),
    report: { nativePassingCases: 0 },
    switchAccount: () =>
      Promise.resolve({
        actor: 'coach' as const,
        beforeRequestId: 0,
        authRequestId: 1,
        afterRequestId: 1,
        actorAuthUid: 'fixture-coach',
      }),
  };
}

function rosterTree(state: 'pending' | 'active', conflictingText = false) {
  const suffix =
    state === 'pending'
      ? `${enUS['pro.student_profile.specialty.fitness_coach']}, ${enUS['pro.student_profile.assignment.pending']}`
      : `${enUS['pro.student_profile.specialty.fitness_coach']}, ${enUS['pro.student_profile.assignment.active']}`;
  const attributes = {
    'resource-id': 'pro.students.row.fixture-student',
    text: conflictingText ? `Wrong, ${suffix}` : '',
    accessibilityText: `Alex, ${suffix}`,
  };
  return {
    attributes: { 'resource-id': 'root' },
    children: [
      {
        attributes: { 'resource-id': 'pro.students.screen' },
        children: [{ attributes }],
      },
    ],
  };
}

void test('Android producer source identity has the current bounded digest shape', async () => {
  const identity = await androidSourceIdentity(process.cwd());
  assert.match(identity.sha, /^[a-f0-9]{40}$/);
  assert.match(identity.sourceTreeHash, /^[a-f0-9]{64}$/);
});

void test('Android candidate preserves the shared seven-purpose contract and iOS export surface', () => {
  const profile = requireConnectionPlatformProfile(ANDROID_CONNECTION_PLATFORM);
  assert.equal(profile.platform, 'android');
  assert.equal(profile.expectedLocale, 'en-US');
  assert.equal(profile.frameTextAttribute, 'accessibilityText');
  assert.equal(profile.credentialPrompt, 'none');
  assert.equal(profile.keyboardDismissal, 'hideKeyboard');
  assert.throws(() => requireConnectionPlatformProfile({ ...profile, expectedLocale: 'pt-BR' }));
  assert.deepEqual(profile.actors, ['coach', 'student']);
  assert.deepEqual(profile.navigation, ['none', 'student-professionals-back']);
  assert.deepEqual(
    buildConnectionJourneyActionPlan(profile).map((row) => [row.id, row.actor, row.navigation]),
    CONNECTION_PURPOSE_PLANS.map((row) => [row.id, row.actor, row.navigation]),
  );
  assert.deepEqual(CONNECTION_PURPOSE_PLANS.at(-1)?.requiredEvidence, ['sql']);
  assert.equal(buildConnectionJourneyArtifactContract(profile).nativePassingCases, 0);
  assert.equal(buildConnectionJourneyArtifactContract(profile).runtimeExecution, 'pending');
  assert.deepEqual(CONNECTION_SNAPSHOT_KEYS, [
    'normalCoachBefore',
    'normalCoachAfter',
    'before',
    'pending',
    'pendingAfterCoachAuth',
    'active',
    'activeAfterStudentAuth',
    'final',
    'isolationBefore',
    'isolationAfter',
    'trainingBefore',
    'trainingAfter',
  ]);
  assert.equal(typeof observeIosConnectionJourney, 'function');
});

void test('Android adapter gates selection, actor/navigation vocabulary, context, and plan before acquisition', () => {
  const selection = androidSelection();
  const contract = requireAndroidConnectionSelection(selection);
  assert.deepEqual(
    contract.assertionIds,
    requireNativePilotAssertions(selection).map((row) => row.id),
  );
  const plan = buildAndroidConnectionAttemptPlan({ selection, contextShape: contextShape() });
  assert.equal(plan.status, ANDROID_CONNECTION_ADAPTER_STATUS);
  assert.equal(plan.nativePassingCases, 0);
  assert.equal(plan.runtime, 'pending');
  assert.equal(plan.artifactContract.fixtureScope, 'native-entry-android');
  requireAndroidConnectionProfile(ANDROID_CONNECTION_PLATFORM);
  assert.equal(requireAndroidConnectionNavigation('none'), 'none');
  assert.equal(
    requireAndroidConnectionNavigation('student-professionals-back'),
    'student-professionals-back',
  );
  assert.throws(() => requireAndroidConnectionNavigation('runFlow'));
  assert.throws(() =>
    requireConnectionPurposePlan([{ ...CONNECTION_PURPOSE_PLANS[0], actor: 'admin' }]),
  );
  const alteredEvidence = CONNECTION_PURPOSE_PLANS.map((row) =>
    row.id === 'NAT-connection-unrelated-state'
      ? { ...row, requiredEvidence: ['ui', 'sql'] as const }
      : row,
  );
  assert.throws(() => requireConnectionPurposePlan(alteredEvidence));
  assert.throws(() =>
    validateAndroidConnectionRuntimeContextShape({
      ...contextShape(),
      report: { nativePassingCases: 1 },
    }),
  );
  assert.throws(() =>
    validateAndroidConnectionRuntimeContextShape({
      ...contextShape(),
      apiIdentity: { apiPid: 1, targetOrigin: apiOrigin },
    }),
  );
});

void test('Android adapter rejects stale platform/fixture/purpose selections', () => {
  const selection = androidSelection();
  assert.throws(
    () =>
      requireAndroidConnectionSelection({
        ...selection,
        arguments: { ...selection.arguments, platform: 'ios' },
      }),
    /platform|selection|scenario/i,
  );
  const altered = structuredClone(selection);
  altered.scenario.fixtureRef = 'owned-postgres:SCN-connection-android:seeded';
  assert.throws(() => requireAndroidConnectionSelection(altered), /fixture|fresh/i);
  const reordered = structuredClone(selection);
  reordered.scenario.pilotAssertions = [...(reordered.scenario.pilotAssertions ?? [])].reverse();
  assert.throws(
    () => requireAndroidConnectionSelection(reordered),
    /assertion|contract|connection/i,
  );
});

void test('Android roster resolver binds accessibilityText and rejects disagreement or absence', () => {
  const pending = resolveAndroidProfessionalRosterTarget({
    tree: rosterTree('pending'),
    targetStudentAuthUid: 'fixture-student',
    assignmentState: 'pending',
  });
  assert.equal(pending.assignmentStateEvidence.attribute, 'accessibilityText');
  assert.equal(pending.assignmentState, 'pending');
  const active = resolveAndroidProfessionalRosterTarget({
    tree: rosterTree('active'),
    targetStudentAuthUid: 'fixture-student',
    assignmentState: 'active',
  });
  assert.equal(active.assignmentStateEvidence.attribute, 'accessibilityText');
  assert.throws(() =>
    resolveAndroidProfessionalRosterTarget({
      tree: rosterTree('pending', true),
      targetStudentAuthUid: 'fixture-student',
      assignmentState: 'pending',
    }),
  );
  assert.throws(() =>
    resolveAndroidProfessionalRosterTarget({
      tree: {
        attributes: { 'resource-id': 'root' },
        children: [
          {
            attributes: { 'resource-id': 'pro.students.screen' },
            children: [
              {
                attributes: {
                  'resource-id': 'pro.students.row.fixture-student',
                  text: `Alex, ${enUS['pro.student_profile.specialty.fitness_coach']}, ${enUS['pro.student_profile.assignment.pending']}`,
                },
              },
            ],
          },
        ],
      },
      targetStudentAuthUid: 'fixture-student',
      assignmentState: 'pending',
    }),
  );
  assert.throws(() =>
    requireAndroidRosterFrameQualification({
      platform: 'ios',
      frameTextAttribute: 'accessibilityText',
      status: 'qualified',
      pendingAssignmentState: 'pending',
      activeAssignmentState: 'active',
    }),
  );
});

void test('Android mapper exposes seven bindings, redaction recipes, backend identity, and strict route/proof guards', () => {
  const selection = androidSelection();
  const bindings = buildNativeConnectionAssertionBindings(selection, `${runId}:first`);
  assert.equal(bindings.length, 7);
  assert.deepEqual(
    bindings.map((row) => row.id),
    requireNativePilotAssertions(selection).map((row) => row.id),
  );
  const uiRefs = nativeConnectionEvidenceReferences(bindings[0].id, 'ui');
  assert(uiRefs.some((row) => row.redacted));
  assert(
    nativeConnectionEvidenceReferences(bindings[0].id, 'ui', 'android').every(
      (row) =>
        row.path !== 'password-save-prompt.png' &&
        row.path !== 'password-save-prompt-hierarchy.json',
    ),
  );
  const apiProcess = {
    pid: 4123,
    started: '2026-10-01T10:00:00.000Z',
    script: 'server/src/index.ts',
  };
  const backend = {
    runId,
    apiOrigin,
    backendAttemptId: `${runId}:first`,
    apiProcess,
    processes: [{ role: 'api', ...apiProcess }],
  };
  const identity = assertNativeConnectionBackendProvenance(
    backend,
    { apiPid: apiProcess.pid, targetOrigin: apiOrigin },
    runId,
    `${runId}:first`,
  );
  assert.deepEqual(identity, apiProcess);
  assert.throws(() =>
    assertNativeConnectionBackendProvenance(
      { ...backend, apiOrigin: 'http://127.0.0.1:49124' },
      { apiPid: apiProcess.pid, targetOrigin: apiOrigin },
      runId,
      `${runId}:first`,
    ),
  );

  const observation = {
    requestId: 2,
    method: 'GET',
    pathHash: createHash('sha256').update('/connections').digest('hex'),
    targetOrigin: apiOrigin,
    requestOrigin: null,
    requestProfile: 'native',
    outcome: 'forwarded',
    status: 200,
    faultAttemptId: null,
  };
  assertNativeConnectionObservationRoute(
    [observation],
    [observation] as never,
    '/connections',
    'GET',
    200,
    true,
  );
  assert.throws(() =>
    assertNativeConnectionObservationRoute(
      [observation],
      [observation] as never,
      '/professional/students',
      'GET',
      200,
      true,
    ),
  );

  const row = requireNativePilotAssertions(selection)[0];
  const references = nativeConnectionEvidenceReferences(row.id, 'api').map((reference) => ({
    ...reference,
    sha256: 'a'.repeat(64),
  }));
  const proof: Parameters<typeof assertNativeConnectionProofExact>[1] = {
    schemaVersion: 1,
    kind: nativeConnectionAssertionEvidenceKind,
    purpose: 'runtime' as const,
    assertionId: row.id,
    evidenceKind: 'api' as const,
    requirementRefs: row.requirementRefs,
    fixtureRunId: runId,
    attemptId: `${runId}:first`,
    scenarioHash: selection.scenarioHash,
    requirementHash: selection.requirementHash,
    references,
    nativePassingCases: 0 as const,
    scope:
      'prepared runtime connection proof; public receipt/finalization and engine qualification are separate',
  };
  assertNativeConnectionProofExact(proof, proof);
  assert.throws(() =>
    assertNativeConnectionProofExact({ ...proof, references: references.slice(1) }, proof),
  );
});

void test('Android adapter and mapper perform real source-level cleanup/verification wiring without acquisition on invalid input', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) =>
    readFile(
      fileURLToPath(
        new URL('../../scripts/testing/run-android-connection-attempt.ts', import.meta.url),
      ),
      'utf8',
    ),
  );
  assert.match(source, /verifyOwnedAndroidCleanup/);
  assert.match(source, /prepareAndroidConnectionPilotEvidence/);
  assert.match(source, /projectAndroidConnectionAttemptTerminalFacts/);
  assert.doesNotMatch(source, /startOwnedAndroidSession|reserveOwnedAppPort|spawn\(/);
  const mapperSource = await import('node:fs/promises').then(({ readFile }) =>
    readFile(
      fileURLToPath(
        new URL('../../scripts/testing/native-connection-public-evidence-core.ts', import.meta.url),
      ),
      'utf8',
    ),
  );
  for (const helper of [
    'native-connection-platform-contract.ts',
    'native-connection-journey.ts',
    'native-connection-journey-core.ts',
    'native-connection-public-evidence.ts',
    'native-connection-public-evidence-core.ts',
    'native-connection-hierarchy-android.ts',
    'run-android-connection-attempt.ts',
  ])
    assert.match(mapperSource, new RegExp(helper.replaceAll('.', '\\.')));

  const temporary = await mkdtemp(path.join(os.tmpdir(), 'android-connection-candidate-'));
  try {
    const output = await readdir(temporary);
    assert.deepEqual(output, []);
    await assert.rejects(
      requireAndroidConnectionRepositoryRoot(temporary),
      /repositoryRoot|source checkout/,
    );
    const controller = new AbortController();
    controller.abort('resource-free control');
    await assert.rejects(
      runAndroidConnectionAttempt({
        repositoryRoot: process.cwd(),
        requestedRunId: runId,
        selection: androidSelection(),
        signal: controller.signal,
      }),
    );
    await assert.rejects(
      prepareAndroidConnectionPilotEvidence({
        repositoryRoot: process.cwd(),
        artifactRoot: temporary,
        selection: androidSelection(),
        requestedRunId: runId,
      }),
    );
    await assert.rejects(
      stageAndroidConnectionPublicEvidence({
        repositoryRoot: process.cwd(),
        captureRoot: temporary,
        outputRoot: temporary,
        requestedRunId: runId,
        fixtureRunId: runId,
        selection: androidSelection(),
        bindings: [],
      }),
    );
    assert.deepEqual(await readdir(temporary), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('both native isolation profiles produce schema-valid owned fixture and snapshot requests', () => {
  for (const profile of [ANDROID_CONNECTION_PLATFORM, IOS_CONNECTION_PLATFORM]) {
    const checked = requireConnectionPlatformProfile(profile);
    assert.notEqual(checked.isolationScope, checked.fixtureScope);
    for (const op of ['seed', 'snapshot', 'connection-snapshot']) {
      assertTestingDocument('session-request-v1', {
        id: `scope-regression-${op}`,
        op,
        scope: checked.isolationScope,
      });
    }
  }
});

void test('the historical oversized Android isolation scope remains rejected before owned I/O', () => {
  const oversized = 'native-connection-isolation-android';
  assert.throws(
    () =>
      assertTestingDocument('session-request-v1', {
        id: 'scope-regression',
        op: 'seed',
        scope: oversized,
      }),
    /Invalid session-request-v1 document/,
  );
  assert.throws(
    () =>
      requireConnectionPlatformProfile({
        ...ANDROID_CONNECTION_PLATFORM,
        isolationScope: oversized,
      }),
    /Connection isolation scope is invalid/,
  );
});
