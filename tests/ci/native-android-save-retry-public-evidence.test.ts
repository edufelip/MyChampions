import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enUS } from '../../localization/en-US';
import { androidSourceIdentity } from '../../scripts/testing/android-build-identity';
import { requireIntegratedLoopbackOrigin } from '../../scripts/testing/integration-preflight';
import {
  prepareAndroidSaveRetryPilotEvidence,
  stageNativeAndroidSaveRetryPublicEvidence,
  verifyStagedNativeAndroidSaveRetryEvidence,
  writeAndroidSaveRetryRuntimeFrames,
} from '../../scripts/testing/native-android-save-retry-public-evidence';
import {
  selectNativePilotScenario,
  type NativePilotSelection,
} from '../../scripts/testing/native-pilot-contract';
import { writeNativeSaveRetryAttemptBinding } from '../../scripts/testing/native-save-retry-attempt-binding';
import {
  nativeSaveRetryRuntimeFrames,
  nativeSaveRetrySnapshotPaths,
} from '../../scripts/testing/native-view-evidence';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3/8AAAAASUVORK5CYII=',
  'base64',
);

type Fixture = {
  repositoryRoot: string;
  selection: NativePilotSelection;
  requestedRunId: string;
  captureRunId: string;
  fixtureRunId: string;
  captureRoot: string;
  outputRoot: string;
  bindings: { id: string; requirementRefs: string[]; evidencePaths: string[] }[];
};

async function putJson(root: string, relative: string, value: unknown): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

async function putPng(root: string, relative: string): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, png, { mode: 0o644 });
}

const node = (attributes: Record<string, string>, children: unknown[] = []) => ({
  attributes,
  children,
});

function snapshot(runId: string, trainingPlans: Record<string, unknown>[]) {
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
    createdAt: '2026-09-29T00:00:00Z',
    updatedAt: '2026-09-29T00:00:00Z',
    sessions:
      name === 'Native QA Draft'
        ? [
            {
              name: 'Strength',
              items: [
                {
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

function trees(createdId: string) {
  const androidId = (value: string) => `com.edufelip.mychampions.dev:id/${value}`;
  const draft = (saveEnabled: boolean) =>
    node({ 'resource-id': androidId('pro.training_plan.screen') }, [
      node({
        'resource-id': androidId('pro.training_plan.name'),
        text: 'Native QA Draft',
        enabled: 'true',
      }),
      node({
        'resource-id': androidId('pro.training_plan.saveButton'),
        enabled: String(saveEnabled),
      }),
      node({ 'resource-id': androidId('pro.training_plan.sessionRow.Strength') }, [
        node({
          'resource-id': androidId('pro.training_plan.itemRow.en_QA_Exercise_1.quantity'),
          text: '3x8',
        }),
      ]),
    ]);
  return {
    'save-error': node(
      {
        text: enUS['pro.plan.error.save'],
        accessibilityText: enUS['pro.plan.error.save'],
      },
      [node({ text: 'OK', enabled: 'true' })],
    ),
    'save-retained': draft(true),
    'save-retry-library': node({}, [
      node({ 'resource-id': androidId('pro.library.training.create') }),
      node({ 'resource-id': androidId(`pro.library.training.row.${createdId}`) }),
    ]),
    'save-retry-reopened': draft(false),
  };
}

function snapshots(runId: string, createdId: string) {
  const oldPlan = plan('training_plan_22222222-2222-4222-8222-222222222222', 'Seeded', 'coach');
  const baseline = snapshot(runId, [oldPlan]);
  const created = plan(createdId, 'Native QA Draft', 'coach');
  const saved = snapshot(runId, [oldPlan, created]);
  return [baseline, structuredClone(baseline), saved, structuredClone(saved)];
}

async function selectionFor(repositoryRoot: string): Promise<NativePilotSelection> {
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  return selectNativePilotScenario(
    {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-save-retry-android',
      mode: 'integration',
    },
    inventory,
    repositoryRoot,
  );
}

async function createFixture(repositoryRoot: string): Promise<Fixture> {
  const temporary = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-android-save-retry-public-')),
  );
  await chmod(temporary, 0o700);
  const requestedRunId = 'a'.repeat(24);
  const captureRunId = 'b'.repeat(24);
  const fixtureRunId = 'c'.repeat(24);
  const captureRoot = path.join(temporary, captureRunId);
  const outputRoot = path.join(temporary, requestedRunId);
  await mkdir(captureRoot, { mode: 0o700 });
  await mkdir(outputRoot, { mode: 0o700 });
  const binaryPath = path.join(captureRoot, 'mychampions.apk');
  await writeFile(binaryPath, Buffer.from('private synthetic APK identity'), { mode: 0o600 });
  const selection = await selectionFor(repositoryRoot);
  const createdId = 'training_plan_11111111-1111-4111-8111-111111111111';
  const owned = snapshots(fixtureRunId, createdId);
  for (const [index, relative] of nativeSaveRetrySnapshotPaths.entries())
    await putJson(captureRoot, relative, owned[index]);
  for (const [label, value] of Object.entries(trees(createdId))) {
    await putJson(captureRoot, `${label}-hierarchy.json`, value);
    await putPng(captureRoot, `${label}.png`);
  }
  const targetOrigin = 'http://127.0.0.1:45001';
  const attemptId = `native-save-${fixtureRunId}`;
  const routes = [
    ['POST', '/auth/email/sign-in', 201, 'forwarded', null],
    ['GET', '/plans/predefined', 200, 'forwarded', null],
    ['POST', '/integrations/exercise/search', 200, 'forwarded', null],
    [
      'GET',
      '/integrations/exercise/exercises/00000000-0000-4000-8000-000000000001',
      200,
      'forwarded',
      null,
    ],
    ['POST', '/plans/training', 503, 'injected', attemptId],
    ['POST', '/plans/training', 201, 'forwarded', null],
    ['PATCH', `/plans/training/${createdId}`, 200, 'forwarded', null],
    ['GET', `/plans/training/${createdId}`, 200, 'forwarded', null],
  ] as const;
  await putJson(
    captureRoot,
    'transport-observations.private.json',
    routes.map(([method, route, status, outcome, faultAttemptId], index) => ({
      requestId: index + 1,
      method,
      pathHash: hash(route),
      status,
      outcome,
      requestProfile: 'native',
      requestOrigin: null,
      faultAttemptId,
      targetOrigin,
    })),
  );
  const source = await androidSourceIdentity(repositoryRoot);
  const helperNames = [
    'capture-android-testability.ts',
    'native-save-retry-observation.ts',
    'native-save-retry-attempt-binding.ts',
    'native-view-evidence.ts',
    'run-android-save-retry-attempt.ts',
    'native-android-save-retry-public-evidence.ts',
  ];
  const helperInputsBefore = await Promise.all(
    helperNames.map(async (name) => ({
      path: `scripts/testing/${name}`,
      sha256: hash(await readFile(path.join(repositoryRoot, 'scripts/testing', name))),
    })),
  );
  const command = {
    label: 'android-save-retry',
    phase: 'build',
    execution: 'completed',
    cleanup: 'cleaned',
    childExitCode: 0,
    childSignal: null,
    deadlineMs: 300_000,
    censusFailure: null,
    outputFailure: null,
    logPath: path.join(captureRoot, 'android-save-retry.private.log'),
    ownershipPath: path.join(captureRoot, 'android-save-retry.ownership.json'),
    stdoutPath: null,
  };
  await writeFile(command.logPath, 'bounded Android private command log', { mode: 0o600 });
  await putJson(captureRoot, 'android-save-retry.ownership.json', { pid: process.pid });
  const binaryBytes = await readFile(binaryPath);
  const build = {
    appId: 'com.edufelip.mychampions.dev',
    binaryPath,
    binaryHash: hash(binaryBytes),
    profile:
      'Metro-attached devDebug arm64; no app-domain instrumentation; optional separately bound read-only input reader; not bundled release qualification',
    apiOrigin: 'http://127.0.0.1:45002',
    metroOrigin: 'http://127.0.0.1:45003',
    node: process.version,
    environmentHash: 'd'.repeat(64),
  };
  requireIntegratedLoopbackOrigin(build.apiOrigin);
  const preparation = {
    requirementRefs: ['SC-208', 'TC-278', 'BR-293', 'BR-294', 'UC-002.7', 'BL-018/P4-save-retry'],
    createdId,
    accountUid: 'coach',
    faultAttemptId: attemptId,
    attemptId,
    injectedCount: 1,
    snapshotPaths: nativeSaveRetrySnapshotPaths,
    scope: 'raw-native-save-error-retained-draft-and-retry-observation; no qualified behavior pass',
  };
  await putJson(captureRoot, 'external-cleanup.private.json', {
    kind: 'independent android native cleanup proof',
    runId: captureRunId,
    result: 'passed',
    captureResult: 'observed',
    captureCleanupClean: true,
    nativePassingCases: 0,
    acquisitions: ['adb', 'emulator', 'backend', 'proxy', 'expo'],
    pidStartPairs: 2,
    survivors: [],
    unknownProcessQueries: [],
    missingForeignDevices: [],
    unavailablePorts: [],
    ownedDeviceAbsent: true,
    cacheAbsent: true,
    defaultAdbPreserved: true,
    foreignAvdsPreserved: true,
    deletedOwnedDirectories: 6,
    docker: { container: [], network: [], volume: [] },
  });
  await putJson(captureRoot, 'capture.private.json', {
    kind: 'private-owned-native-save-retry-execution-not-public-receipt',
    mode: 'integration',
    platform: 'android',
    charter: 'save-retry',
    result: 'observed',
    cleanup: 'cleaned',
    nativePassingCases: 0,
    source,
    sourceAfter: source,
    helperInputsBefore,
    helperInputsAfter: helperInputsBefore,
    build,
    device: { serial: 'emulator-5554' },
    backend: { runId: fixtureRunId },
    commandExecutions: [command],
    observations: nativeSaveRetryRuntimeFrames.map(([label, viewId]) => ({
      viewId,
      screenshotPath: `${label}.png`,
      hierarchyPath: `${label}-hierarchy.json`,
    })),
    saveRetryPreparation: preparation,
  });
  const binding = await writeNativeSaveRetryAttemptBinding({
    repositoryRoot,
    artifactRoot: captureRoot,
    requestedRunId,
    backendRunId: fixtureRunId,
    selection,
  });
  await putJson(captureRoot, 'save-retry-runtime-metadata.private.json', {
    schemaVersion: 1,
    kind: 'private-android-save-retry-runtime-metadata-not-public-receipt',
    requestedRunId: binding.requestedRunId,
    requestedAttemptId: binding.requestedAttemptId,
    captureRunId: binding.captureRunId,
    backendRunId: binding.backendRunId,
    backendAttemptId: binding.backendAttemptId,
    faultAttemptId: binding.faultAttemptId,
    selection: binding.selection,
    assertionContract: binding.assertionContract,
    preparation,
    publicNativePassingCases: 0,
  });
  await writeAndroidSaveRetryRuntimeFrames(captureRoot);
  const prepared = await prepareAndroidSaveRetryPilotEvidence({
    repositoryRoot,
    artifactRoot: captureRoot,
    selection,
    requestedRunId,
  });
  await putJson(captureRoot, 'runtime-adapter.private.json', {
    kind: 'private-owned-android-save-retry-attempt-not-public-receipt',
    requestedRunId,
    requestedAttemptId: binding.requestedAttemptId,
    captureRunId,
    backendRunId: fixtureRunId,
    backendAttemptId: binding.backendAttemptId,
    faultAttemptId: binding.faultAttemptId,
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
    assertionBindingsRetired: false,
    externalCleanupResult: 'passed',
    verificationResult: 'passed',
    applicationFailure: null,
    applicationFailureCandidate: null,
    verificationFailure: null,
    postCaptureFailure: null,
    deadline: null,
    assertionBindings: prepared.bindings,
    fixtureRunId,
    fixtureHash: 'e'.repeat(64),
    flagsHash: build.environmentHash,
    toolVersions: { node: process.version, maestro: '2.6.1' },
    timingsMs: { build: 1, install: 1, reset: 1, scenario: 1, verify: 1, cleanup: 1 },
    commandDiagnostics: [command],
    censusFailures: [],
    outputFailures: [],
    nativePassingCases: 0,
    artifactRoot: captureRoot,
  });
  return {
    repositoryRoot,
    selection,
    requestedRunId,
    captureRunId,
    fixtureRunId,
    captureRoot,
    outputRoot,
    bindings: prepared.bindings,
  };
}

void test('Android save/retry publication retains PNG/JSON modes and rejects same-byte original replacement', async () => {
  const repositoryRoot = await realpath(path.resolve(__dirname, '../..'));
  const fixture = await createFixture(repositoryRoot);
  try {
    const staged = await stageNativeAndroidSaveRetryPublicEvidence({
      repositoryRoot,
      captureRoot: fixture.captureRoot,
      outputRoot: fixture.outputRoot,
      requestedRunId: fixture.requestedRunId,
      fixtureRunId: fixture.fixtureRunId,
      selection: fixture.selection,
      bindings: fixture.bindings,
    });
    const manifest = JSON.parse(
      await readFile(path.join(fixture.outputRoot, staged.copyManifest.path), 'utf8'),
    ) as {
      schemaVersion: number;
      files: { path: string; mode: number; originalIdentity: unknown }[];
    };
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.files.find((row) => row.path === 'save-error.png')?.mode, 0o644);
    assert.equal(
      manifest.files.find((row) => row.path === 'save-error-hierarchy.json')?.mode,
      0o600,
    );
    assert(
      manifest.files.every(
        (row) => row.path.startsWith('source/') || row.originalIdentity !== null,
      ),
    );
    await verifyStagedNativeAndroidSaveRetryEvidence({
      repositoryRoot,
      selection: fixture.selection,
      outputRoot: fixture.outputRoot,
      copyManifest: staged.copyManifest,
      requestedRunId: fixture.requestedRunId,
      captureRunId: fixture.captureRunId,
      fixtureRunId: fixture.fixtureRunId,
      captureRoot: fixture.captureRoot,
    });
    const originalHierarchy = await readFile(
      path.join(fixture.captureRoot, 'save-error-hierarchy.json'),
    );
    const replacementPath = path.join(fixture.captureRoot, 'save-error-hierarchy.replaced.json');
    await writeFile(replacementPath, originalHierarchy, { mode: 0o600 });
    await rm(path.join(fixture.captureRoot, 'save-error-hierarchy.json'));
    await writeFile(
      path.join(fixture.captureRoot, 'save-error-hierarchy.json'),
      originalHierarchy,
      {
        mode: 0o600,
      },
    );
    await assert.rejects(
      verifyStagedNativeAndroidSaveRetryEvidence({
        repositoryRoot,
        selection: fixture.selection,
        outputRoot: fixture.outputRoot,
        copyManifest: staged.copyManifest,
        requestedRunId: fixture.requestedRunId,
        captureRunId: fixture.captureRunId,
        fixtureRunId: fixture.fixtureRunId,
        captureRoot: fixture.captureRoot,
      }),
      /identity changed|stale|changed/i,
    );
    await rm(replacementPath, { force: true });
  } finally {
    await rm(path.dirname(fixture.captureRoot), { recursive: true, force: true });
  }
});

void test('Android save/retry publication restores public PNG mode under umask 077', async () => {
  const repositoryRoot = await realpath(path.resolve(__dirname, '../..'));
  const fixture = await createFixture(repositoryRoot);
  const previousUmask = process.umask(0o077);
  try {
    const staged = await stageNativeAndroidSaveRetryPublicEvidence({
      repositoryRoot,
      captureRoot: fixture.captureRoot,
      outputRoot: fixture.outputRoot,
      requestedRunId: fixture.requestedRunId,
      fixtureRunId: fixture.fixtureRunId,
      selection: fixture.selection,
      bindings: fixture.bindings,
    });
    const stagedRoot = path.join(fixture.outputRoot, `evidence/${fixture.captureRunId}`);
    const pngInfo = await lstat(path.join(stagedRoot, 'save-error.png'));
    const jsonInfo = await lstat(path.join(stagedRoot, 'save-error-hierarchy.json'));
    assert.equal(pngInfo.mode & 0o777, 0o644);
    assert.equal(jsonInfo.mode & 0o777, 0o600);
    assert.equal(
      staged.copyManifest.path,
      `evidence/${fixture.captureRunId}/copy-manifest.private.json`,
    );
  } finally {
    process.umask(previousUmask);
    await rm(path.dirname(fixture.captureRoot), { recursive: true, force: true });
  }
});
