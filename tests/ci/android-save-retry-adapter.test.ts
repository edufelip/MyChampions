import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runOwnedAndroidNativeSession } from '../../scripts/testing/capture-android-testability';
import { writeAndroidSaveRetryRuntimeFrames } from '../../scripts/testing/native-android-save-retry-public-evidence';
import {
  nativeSaveRetryRuntimeFrames,
  readNativeEvidenceObservation,
  readNativeEvidenceObservationForTest,
  validateNativeSaveRetryPreparation,
} from '../../scripts/testing/native-view-evidence';
import {
  persistAndroidSaveRetryAttemptOutcome,
  retireAndroidSaveRetryAssertionBindings,
  type AndroidSaveRetryAttemptResult,
} from '../../scripts/testing/run-android-save-retry-attempt';
import { nativePilotExecutionAdapter } from '../../scripts/testing/run-native-pilot';

const frameBytes = Buffer.from('89504e470d0a1a0a', 'hex');
const runId = '0123456789abcdef01234567';
const validatorRunId = 'fedcba9876543210fedcba98';
const accountUid = 'coach-uid';
const targetOrigin = 'http://127.0.0.1:1234';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function hierarchy(viewId: string): Record<string, unknown> {
  const selectors: Record<string, Record<string, string>> = {
    'STATE-training-save-error': { accessibilityText: 'Could not save plan. Try again.' },
    'SCR-training-builder': { 'resource-id': 'pro.training_plan.screen' },
    'SCR-training-library': { 'resource-id': 'pro.library.training.create' },
  };
  return { attributes: selectors[viewId] ?? {}, children: [] };
}

async function writeRuntimeFixture(root: string) {
  const frames = [
    ['save-error', 'STATE-training-save-error'],
    ['save-retained', 'SCR-training-builder'],
    ['save-retry-library', 'SCR-training-library'],
    ['save-retry-reopened', 'SCR-training-builder'],
  ] as const;
  const observations = [];
  for (const [label, viewId] of frames) {
    await writeFile(path.join(root, `${label}.png`), frameBytes, { mode: 0o600 });
    await writeFile(path.join(root, `${label}-hierarchy.json`), JSON.stringify(hierarchy(viewId)), {
      mode: 0o600,
    });
    observations.push({
      viewId,
      screenshotPath: `${label}.png`,
      hierarchyPath: `${label}-hierarchy.json`,
    });
  }
  await writeFile(
    path.join(root, 'capture.private.json'),
    JSON.stringify({
      kind: 'private-owned-native-save-retry-execution-not-public-receipt',
      mode: 'integration',
      platform: 'android',
      charter: 'save-retry',
      result: 'observed',
      cleanup: 'cleaned',
      nativePassingCases: 0,
      device: { serial: 'emulator-5554' },
      backend: { runId },
      observations,
    }),
    { mode: 0o600 },
  );
}

function snapshot(trainingPlans: Record<string, unknown>[]) {
  return {
    schemaVersion: 1,
    runId,
    scope: 'native-entry-android',
    readOnly: true,
    trainingPlans,
    connections: [],
  };
}

function plan(id: string, name: string, ownerProfessionalUid: string) {
  return {
    id,
    studentAuthUid: 'student-uid',
    ownerProfessionalUid,
    sourceKind: 'predefined',
    name,
    isArchived: false,
    isDraft: false,
    lifecycleConnectionId: null,
    createdAt: '2026-10-02 00:00:00+00',
    updatedAt: '2026-10-02 00:00:00+00',
    sessions:
      name === 'Native QA Draft'
        ? [
            {
              id: 'new-session',
              name: 'Strength',
              items: [
                {
                  id: 'new-item',
                  name: 'en QA Exercise 1',
                  exerciseId: '00000000-0000-4000-8000-000000000001',
                  quantity: '3x8',
                },
              ],
            },
          ]
        : [],
  };
}

async function writeValidatorFixture(root: string, backendRunId = runId) {
  const androidId = (value: string) => `com.edufelip.mychampions.dev:id/${value}`;
  const ownedSnapshot = (trainingPlans: Record<string, unknown>[]) => ({
    ...snapshot(trainingPlans),
    runId: backendRunId,
  });
  const baseline = ownedSnapshot([plan('seed-plan', 'Seed plan', accountUid)]);
  const failed = ownedSnapshot([plan('seed-plan', 'Seed plan', accountUid)]);
  const created = plan('created-plan', 'Native QA Draft', accountUid);
  const after = ownedSnapshot([...baseline.trainingPlans, created]);
  for (const [name, value] of [
    ['save-retry-before.private.json', baseline],
    ['save-retry-after-failure.private.json', failed],
    ['save-retry-after-success.private.json', after],
    ['save-retry-after-reopen.private.json', after],
  ] as const)
    await writeFile(path.join(root, name), JSON.stringify(value), { mode: 0o600 });
  const draft = {
    attributes: { 'resource-id': androidId('pro.training_plan.screen') },
    children: [
      {
        attributes: {
          'resource-id': androidId('pro.training_plan.name'),
          text: 'Native QA Draft',
          enabled: 'true',
        },
      },
      {
        attributes: {
          'resource-id': androidId('pro.training_plan.saveButton'),
          enabled: 'true',
        },
      },
      {
        attributes: { 'resource-id': androidId('pro.training_plan.sessionRow.Strength') },
        children: [
          {
            attributes: {
              'resource-id': androidId('pro.training_plan.itemRow.en_QA_Exercise_1.quantity'),
              text: '3x8',
            },
          },
        ],
      },
    ],
  };
  const reopened = {
    ...draft,
    children: draft.children.map((child) =>
      child.attributes?.['resource-id'] === androidId('pro.training_plan.saveButton')
        ? { ...child, attributes: { ...child.attributes, enabled: 'false' } }
        : child,
    ),
  };
  const library = {
    attributes: {},
    children: [
      { attributes: { 'resource-id': androidId('pro.library.training.create') } },
      { attributes: { 'resource-id': androidId('pro.library.training.row.created-plan') } },
    ],
  };
  const error = {
    attributes: {
      accessibilityText: 'Could not save plan. Try again.',
      text: 'Could not save plan. Try again.',
    },
    children: [{ attributes: { accessibilityText: 'OK', text: 'OK', enabled: 'true' } }],
  };
  for (const [name, value] of [
    ['save-error-hierarchy.json', error],
    ['save-retained-hierarchy.json', draft],
    ['save-retry-library-hierarchy.json', library],
    ['save-retry-reopened-hierarchy.json', reopened],
  ] as const) {
    await writeFile(path.join(root, name), JSON.stringify(value), { mode: 0o600 });
    await writeFile(path.join(root, name.replace('-hierarchy.json', '.png')), frameBytes, {
      mode: 0o600,
    });
  }
  await writeFile(
    path.join(root, 'capture.private.json'),
    JSON.stringify({
      kind: 'private-owned-native-save-retry-execution-not-public-receipt',
      mode: 'integration',
      platform: 'android',
      charter: 'save-retry',
      result: 'observed',
      cleanup: 'cleaned',
      nativePassingCases: 0,
      device: { serial: 'emulator-5554' },
      backend: { runId: backendRunId },
      observations: nativeSaveRetryRuntimeFrames.map(([label, viewId]) => ({
        viewId,
        screenshotPath: `${label}.png`,
        hierarchyPath: `${label}-hierarchy.json`,
      })),
    }),
    { mode: 0o600 },
  );
  const preparation = {
    requirementRefs: ['SC-208', 'TC-278', 'BR-293', 'BR-294', 'UC-002.7', 'BL-018/P4-save-retry'],
    createdId: 'created-plan',
    accountUid,
    attemptId: `native-save-${backendRunId}`,
    injectedCount: 1,
    snapshotPaths: [
      'save-retry-before.private.json',
      'save-retry-after-failure.private.json',
      'save-retry-after-success.private.json',
      'save-retry-after-reopen.private.json',
    ],
    scope: 'raw-native-save-error-retained-draft-and-retry-observation; no qualified behavior pass',
  };
  const record = (
    requestId: number,
    method: string,
    route: string,
    status: number,
    outcome = 'forwarded',
    faultAttemptId: string | null = null,
  ) => ({
    requestId,
    method,
    pathHash: hash(route),
    status,
    outcome,
    requestProfile: 'native',
    requestOrigin: null,
    faultAttemptId,
    targetOrigin,
  });
  const transport = [
    record(1, 'POST', '/auth/email/sign-in', 201),
    record(2, 'GET', '/plans/predefined', 200),
    record(3, 'POST', '/integrations/exercise/search', 200),
    record(4, 'GET', '/integrations/exercise/exercises/00000000-0000-4000-8000-000000000001', 200),
    record(5, 'POST', '/plans/training', 503, 'injected', `native-save-${backendRunId}`),
    record(6, 'POST', '/plans/training', 201),
    record(7, 'PATCH', '/plans/training/created-plan', 200),
    record(8, 'GET', '/plans/training/created-plan', 200),
  ];
  return { baseline, failed, after, preparation, transport };
}

void test('Android save/retry dispatch is limited to integrated Maestro', () => {
  const args = {
    platform: 'android',
    engine: 'maestro',
    scenario: 'SCN-save-retry-android',
    mode: 'integration',
  } as const;
  assert.equal(nativePilotExecutionAdapter(args), 'android-save-retry');
  assert.equal(nativePilotExecutionAdapter({ ...args, engine: 'detox' as never }), null);
  assert.equal(nativePilotExecutionAdapter({ ...args, mode: 'fixture' }), null);
  assert.equal(
    nativePilotExecutionAdapter({ ...args, platform: 'ios', scenario: 'SCN-save-retry-ios' }),
    'ios-save-retry',
  );
});

void test('Android owned lifecycle requires exactly the save/retry callback', async () => {
  await assert.rejects(
    runOwnedAndroidNativeSession({ charter: 'save-retry' }),
    /Invalid owned Android session options/,
  );
  await assert.rejects(
    runOwnedAndroidNativeSession({
      charter: 'save-retry',
      executeSaveRetry: () => Promise.resolve(),
      executeTraining: () => Promise.resolve(),
    }),
    /Invalid owned Android session options/,
  );
  const controller = new AbortController();
  controller.abort('SIGTERM');
  await assert.rejects(
    runOwnedAndroidNativeSession({
      charter: 'save-retry',
      signal: controller.signal,
      executeSaveRetry: () => Promise.resolve(),
    }),
    /SIGTERM|aborted|AbortError/i,
  );
});

void test('Android runtime frames are produced from actual observation paths and reject forged paths', async () => {
  const temporary = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-android-frame-control-')),
  );
  const root = path.join(temporary, runId);
  try {
    await mkdir(root, { mode: 0o700 });
    await writeRuntimeFixture(root);
    await writeAndroidSaveRetryRuntimeFrames(root);
    const frames = JSON.parse(
      await readFile(path.join(root, 'save-retry-runtime-frames.private.json'), 'utf8'),
    ) as { reviewed: boolean; viewId: string }[];
    assert.deepEqual(
      frames.map((row) => row.viewId),
      [
        'STATE-training-save-error',
        'SCR-training-builder',
        'SCR-training-library',
        'SCR-training-builder',
      ],
    );
    assert(frames.every((row) => row.reviewed === false));
    const capture = JSON.parse(await readFile(path.join(root, 'capture.private.json'), 'utf8')) as {
      observations: { screenshotPath: string }[];
    };
    capture.observations[0].screenshotPath = '../forged.png';
    await writeFile(path.join(root, 'capture.private.json'), JSON.stringify(capture), {
      mode: 0o600,
    });
    await assert.rejects(
      writeAndroidSaveRetryRuntimeFrames(root),
      /captured exactly once|within|escape|private|evidence/i,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('Android save/retry writer and validator preserve SQL and reject forged mutation', async () => {
  const temporary = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-android-validator-control-')),
  );
  const root = path.join(temporary, validatorRunId);
  try {
    await mkdir(root, { mode: 0o700 });
    const { after, preparation, transport } = await writeValidatorFixture(root, validatorRunId);
    await writeAndroidSaveRetryRuntimeFrames(root);
    assert.doesNotThrow(() =>
      validateNativeSaveRetryPreparation(
        root,
        'android',
        validatorRunId,
        preparation,
        transport,
        'runtime-captured',
      ),
    );
    const forged = {
      ...after,
      trainingPlans: after.trainingPlans.map((value, index) =>
        index === 0 ? { ...value, updatedAt: '2026-10-02 00:00:01+00' } : value,
      ),
    };
    await writeFile(
      path.join(root, 'save-retry-after-success.private.json'),
      JSON.stringify(forged),
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        validateNativeSaveRetryPreparation(
          root,
          'android',
          validatorRunId,
          preparation,
          transport,
          'runtime-captured',
        ),
      /Expected values|Native retry|created identity|SQL/i,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('Android evidence reader rejects same-size replacement after descriptor read', async () => {
  const root = path.join(process.cwd(), 'android-reader-replacement-control');
  try {
    await mkdir(root, { mode: 0o700 });
    const relative = 'capture.private.json';
    const original = Buffer.from('{"ok":true}');
    await writeFile(path.join(root, relative), original, { mode: 0o600 });
    const observed = readNativeEvidenceObservation(root, relative, true);
    assert.deepEqual(observed.bytes, original);
    assert.equal(observed.identity.mode & 0o777, 0o600);
    assert.equal(observed.identity.nlink, 1);
    assert.throws(
      () =>
        readNativeEvidenceObservationForTest(root, relative, true, {
          afterRead: () => {
            renameSync(path.join(root, relative), path.join(root, 'capture.private.old.json'));
            writeFileSync(path.join(root, relative), original, { mode: 0o600 });
          },
        }),
      /changed during read/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Android adapter publication failure retires reusable bindings but preserves diagnostic evidence', () => {
  const diagnostic = {
    path: 'capture.private.json',
    sha256: 'a'.repeat(64),
    reason: 'adapter-write',
  };
  const outcome = {
    assertionBindings: [
      { id: 'NAT-save-retry-error', requirementRefs: ['TC-303'], evidencePaths: ['error.json'] },
    ],
    assertionBindingsRetired: false,
    postCaptureFailure: diagnostic,
  };
  retireAndroidSaveRetryAssertionBindings(outcome);
  assert.deepEqual(outcome.assertionBindings, []);
  assert.equal(outcome.assertionBindingsRetired, true);
  assert.deepEqual(outcome.postCaptureFailure, diagnostic);
});

void test('Android adapter async publication failure retires the actual result bindings', async () => {
  const outcomeWithoutRoot: Omit<AndroidSaveRetryAttemptResult, 'artifactRoot'> = {
    kind: 'private-owned-android-save-retry-attempt-not-public-receipt',
    requestedRunId: runId,
    requestedAttemptId: `${runId}:first`,
    captureRunId: runId,
    backendRunId: runId,
    backendAttemptId: `${runId}:first`,
    faultAttemptId: `${runId}:first`,
    captureExitCode: 0,
    childExitCode: 0,
    childSignal: null,
    childClassification: 'completed',
    captureResult: 'observed',
    captureCleanup: 'cleaned',
    captureTimeout: null,
    cancellation: null,
    callbackInvocations: 1,
    callbackCompleted: true,
    externalCleanupResult: 'passed',
    verificationResult: 'passed',
    applicationFailure: null,
    applicationFailureCandidate: null,
    verificationFailure: null,
    postCaptureFailure: null,
    deadline: null,
    commandDiagnostics: [],
    censusFailures: [],
    outputFailures: [],
    assertionBindings: [
      { id: 'NAT-save-retry-error', requirementRefs: ['TC-303'], evidencePaths: ['error.json'] },
    ],
    assertionBindingsRetired: false,
    fixtureRunId: runId,
    fixtureHash: null,
    flagsHash: null,
    toolVersions: {},
    timingsMs: { build: 0, install: 0, reset: 0, scenario: 0, verify: 0, cleanup: 0 },
    nativePassingCases: 0,
  };
  let writes = 0;
  const outcome = await persistAndroidSaveRetryAttemptOutcome(
    '/private/android-save-retry-artifact',
    outcomeWithoutRoot,
    async (file, contents, options) => {
      writes++;
      assert.match(file, /runtime-adapter\.private\.json$/);
      assert.equal(typeof contents, 'string');
      assert.deepEqual(options, { flag: 'wx', mode: 0o600 });
      await Promise.resolve();
      throw new Error('synthetic private publication failure');
    },
  );
  assert.equal(writes, 1);
  assert.equal(outcome.artifactRoot, '/private/android-save-retry-artifact');
  assert.equal(outcome.postCaptureFailure?.phase, 'adapter-write');
  assert.equal(outcome.assertionBindingsRetired, true);
  assert.deepEqual(outcome.assertionBindings, []);
  assert.equal(outcome.nativePassingCases, 0);
});
