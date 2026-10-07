import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enUS } from '../../localization/en-US';
import { requireIntegratedLoopbackOrigin } from '../../scripts/testing/integration-preflight';
import { sourceIdentity, treeHash } from '../../scripts/testing/native-build-identity';
import { selectNativePilotScenario } from '../../scripts/testing/native-pilot-contract';
import { writeNativeSaveRetryAttemptBinding } from '../../scripts/testing/native-save-retry-attempt-binding';
import {
  prepareIosSaveRetryPilotEvidence,
  stageNativeSaveRetryPublicEvidence,
  verifyStagedNativeSaveRetryEvidence,
  writeIosSaveRetryRuntimeFrames,
} from '../../scripts/testing/native-save-retry-public-evidence';
import {
  nativeSaveRetryRuntimeFrames,
  nativeSaveRetryRuntimeFramesPath,
  nativeSaveRetrySnapshotPaths,
  readNativeEvidence,
} from '../../scripts/testing/native-view-evidence';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3/8AAAAASUVORK5CYII=',
  'base64',
);
const oversizedCommandLog = Buffer.alloc(8 * 1024 * 1024 + 1, 0x6c);

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

const node = (attributes: Record<string, string>, children: unknown[] = []) => ({
  attributes,
  children,
});

async function putJson(root: string, relative: string, value: unknown): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

async function putBytes(root: string, relative: string, value: Buffer): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, value, { mode: 0o600 });
}

async function selectionFor(repositoryRoot: string): Promise<NativePilotSelection> {
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  return selectNativePilotScenario(
    { platform: 'ios', engine: 'maestro', scenario: 'SCN-save-retry-ios', mode: 'integration' },
    inventory,
    repositoryRoot,
  );
}

function ownedSnapshots(fixtureRunId: string, createdId: string) {
  const oldId = 'training_plan_22222222-2222-4222-8222-222222222222';
  const oldPlan = {
    id: oldId,
    studentAuthUid: 'coach',
    ownerProfessionalUid: 'coach',
    sourceKind: 'predefined',
    name: 'Seeded',
    isArchived: false,
    isDraft: false,
    lifecycleConnectionId: null,
    createdAt: '2026-09-29T00:00:00Z',
    updatedAt: '2026-09-29T00:00:00Z',
    sessions: [],
  };
  const baseline = {
    schemaVersion: 1,
    runId: fixtureRunId,
    scope: 'native-entry-ios',
    readOnly: true,
    connections: [],
    trainingPlans: [oldPlan],
  };
  const saved = {
    ...oldPlan,
    id: createdId,
    name: 'Native QA Draft',
    sessions: [
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
    ],
  };
  return [
    baseline,
    structuredClone(baseline),
    { ...baseline, trainingPlans: [oldPlan, saved] },
    { ...baseline, trainingPlans: [oldPlan, saved] },
  ];
}

function saveRetryTrees(createdId: string) {
  const name = {
    'resource-id': 'pro.training_plan.name',
    value: 'Native QA Draft',
    enabled: 'true',
  };
  const quantity = {
    'resource-id': 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity',
    accessibilityText: '3x8',
  };
  const draft = (saveEnabled: boolean) =>
    node({ 'resource-id': 'pro.training_plan.screen' }, [
      node(name),
      node({ 'resource-id': 'pro.training_plan.saveButton', enabled: String(saveEnabled) }),
      node({ 'resource-id': 'pro.training_plan.sessionRow.Strength' }, [node(quantity)]),
    ]);
  return {
    'save-error': node({ accessibilityText: enUS['pro.plan.error.save'] }, [
      node({ accessibilityText: 'OK', enabled: 'true' }),
    ]),
    'save-retained': draft(true),
    'save-retry-library': node({}, [
      node({ 'resource-id': 'pro.library.training.create' }),
      node({ 'resource-id': `pro.library.training.row.${createdId}` }),
    ]),
    'save-retry-reopened': draft(false),
  };
}

async function createFullFixture(repositoryRoot: string): Promise<Fixture> {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-save-retry-public-')));
  await chmod(temporary, 0o700);
  const requestedRunId = 'a'.repeat(24);
  const captureRunId = 'b'.repeat(24);
  const fixtureRunId = 'c'.repeat(24);
  const captureRoot = path.join(temporary, captureRunId);
  const outputRoot = path.join(temporary, requestedRunId);
  const binaryPath = path.join(temporary, 'mychampions.app');
  await mkdir(captureRoot, { mode: 0o700 });
  await mkdir(outputRoot, { mode: 0o700 });
  await mkdir(binaryPath, { mode: 0o700 });
  await writeFile(path.join(binaryPath, 'Info.plist'), 'synthetic binary identity', {
    mode: 0o600,
  });
  const selection = await selectionFor(repositoryRoot);
  const createdId = 'training_plan_11111111-1111-4111-8111-111111111111';
  const snapshots = ownedSnapshots(fixtureRunId, createdId);
  for (const [index, relative] of nativeSaveRetrySnapshotPaths.entries())
    await putJson(captureRoot, relative, snapshots[index]);
  const trees = saveRetryTrees(createdId);
  for (const [label, value] of Object.entries(trees)) {
    await putJson(captureRoot, `${label}-hierarchy.json`, value);
    await putBytes(captureRoot, `${label}.png`, png);
  }
  const routeHash = (route: string) => hash(route);
  const targetOrigin = 'http://127.0.0.1:45000';
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
      pathHash: routeHash(route),
      status,
      outcome,
      requestProfile: 'native',
      requestOrigin: null,
      faultAttemptId,
      targetOrigin,
    })),
  );
  const source = await sourceIdentity(repositoryRoot);
  const helperNames = [
    'capture-native-testability.ts',
    'native-training-observation.ts',
    'native-save-retry-observation.ts',
    'native-save-retry-attempt-binding.ts',
    'native-view-evidence.ts',
    'run-ios-save-retry-attempt.ts',
    'native-save-retry-public-evidence.ts',
  ];
  const helperInputsBefore = await Promise.all(
    helperNames.map(async (name) => {
      const bytes = await readFile(path.join(repositoryRoot, 'scripts/testing', name));
      return { path: `scripts/testing/${name}`, sha256: hash(bytes) };
    }),
  );
  const command = {
    label: 'ios-save-retry',
    phase: 'build',
    execution: 'completed',
    cleanup: 'cleaned',
    childExitCode: 0,
    childSignal: null,
    deadlineMs: 300_000,
    censusFailure: null,
    outputFailure: null,
    logPath: path.join(captureRoot, 'ios-save-retry.private.log'),
    ownershipPath: path.join(captureRoot, 'ios-save-retry.ownership.json'),
    stdoutPath: null,
  };
  await writeFile(command.logPath, oversizedCommandLog, { mode: 0o600 });
  await putJson(captureRoot, 'ios-save-retry.ownership.json', { pid: process.pid });
  const build = {
    bundleId: 'com.edufelip.mychampions.dev',
    binaryPath,
    binaryHash: await treeHash(binaryPath),
    profile: 'Metro-attached Debug; not bundled release qualification',
    apiOrigin: 'http://127.0.0.1:45001',
    metroOrigin: 'http://127.0.0.1:45002',
    node: process.version,
    environmentHash: 'd'.repeat(64),
  };
  requireIntegratedLoopbackOrigin(build.apiOrigin);
  const preparation = {
    platform: 'ios',
    snapshotScope: 'native-entry-ios',
    faultTarget: { method: 'POST', path: '/plans/training', status: 503 },
    requirementRefs: ['SC-208', 'TC-278', 'BR-293', 'BR-294', 'UC-002.7', 'BL-018/P4-save-retry'],
    createdId,
    accountUid: 'coach',
    faultAttemptId: attemptId,
    attemptId,
    injectedCount: 1,
    snapshotPaths: nativeSaveRetrySnapshotPaths,
    scope: 'raw-native-save-error-retained-draft-and-retry-observation; no qualified behavior pass',
  };
  const cleanup = {
    kind: 'independent ios native inventory cleanup proof',
    result: 'passed',
    runId: captureRunId,
    captureResult: 'observed',
    captureCleanupClean: true,
    pidStartPairs: 2,
    survivors: [],
    unknownProcessQueries: [],
    missingForeignDevices: [],
    ownedDeviceAbsent: true,
    cacheAbsent: true,
    docker: { container: [], network: [], volume: [] },
  };
  await putJson(captureRoot, 'external-cleanup.private.json', cleanup);
  await putJson(captureRoot, 'capture.private.json', {
    kind: 'private-owned-native-save-retry-execution-not-public-receipt',
    mode: 'integration',
    platform: 'ios',
    charter: 'save-retry',
    result: 'observed',
    cleanup: 'cleaned',
    nativePassingCases: 0,
    source,
    sourceAfter: source,
    helperInputsBefore,
    helperInputsAfter: helperInputsBefore,
    build,
    device: { udid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE' },
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
    kind: 'private-ios-save-retry-runtime-metadata-not-public-receipt',
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
  await writeIosSaveRetryRuntimeFrames(captureRoot);
  const prepared = await prepareIosSaveRetryPilotEvidence({
    repositoryRoot,
    artifactRoot: captureRoot,
    selection,
    requestedRunId,
  });
  await putJson(captureRoot, 'runtime-adapter.private.json', {
    kind: 'private-owned-ios-save-retry-attempt-not-public-receipt',
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

void test('iOS save/retry runtime frame writer records four unreviewed frames and refuses duplicate output', async () => {
  const repositoryRoot = await realpath(path.resolve(__dirname, '../..'));
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-save-retry-frames-')));
  await chmod(temporary, 0o700);
  try {
    const captureRoot = path.join(temporary, 'f'.repeat(24));
    await mkdir(captureRoot, { mode: 0o700 });
    const trees = saveRetryTrees('training_plan_11111111-1111-4111-8111-111111111111');
    for (const [label, value] of Object.entries(trees)) {
      await putJson(captureRoot, `${label}-hierarchy.json`, value);
      await putBytes(captureRoot, `${label}.png`, png);
    }
    await putJson(captureRoot, 'capture.private.json', {
      kind: 'private-owned-native-save-retry-execution-not-public-receipt',
      mode: 'integration',
      platform: 'ios',
      charter: 'save-retry',
      result: 'observed',
      cleanup: 'cleaned',
      nativePassingCases: 0,
      observations: nativeSaveRetryRuntimeFrames.map(([label, viewId]) => ({
        viewId,
        screenshotPath: `${label}.png`,
        hierarchyPath: `${label}-hierarchy.json`,
      })),
    });
    await writeIosSaveRetryRuntimeFrames(captureRoot);
    const frames = JSON.parse(
      await readFile(path.join(captureRoot, nativeSaveRetryRuntimeFramesPath), 'utf8'),
    ) as { reviewed: boolean }[];
    assert.equal(frames.length, 4);
    assert(frames.every((frame) => frame.reviewed === false));
    await assert.rejects(writeIosSaveRetryRuntimeFrames(captureRoot), /EEXIST/);
    assert.equal(repositoryRoot, path.resolve(repositoryRoot));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('iOS save/retry public evidence stages a synthetic private round trip and rejects binding/census boundaries', async () => {
  const repositoryRoot = await realpath(path.resolve(__dirname, '../..'));
  const fixture = await createFullFixture(repositoryRoot);
  const commandLogPath = path.join(fixture.captureRoot, 'ios-save-retry.private.log');
  const captureMetadataPath = path.join(fixture.captureRoot, 'capture.private.json');
  const runtimeAdapterMetadataPath = path.join(fixture.captureRoot, 'runtime-adapter.private.json');
  const originalCaptureMetadata = await readFile(captureMetadataPath);
  const originalRuntimeAdapterMetadata = await readFile(runtimeAdapterMetadataPath);
  try {
    await putBytes(fixture.captureRoot, 'oversized-generic.private.json', oversizedCommandLog);
    assert.throws(
      () => readNativeEvidence(fixture.captureRoot, 'oversized-generic.private.json', true),
      /bounded immutable input/i,
    );

    const forgedOversizedLog = JSON.parse(originalCaptureMetadata.toString()) as {
      commandExecutions: { logPath: string }[];
    };
    forgedOversizedLog.commandExecutions[0].logPath = path.join(
      fixture.captureRoot,
      'oversized-generic.private.json',
    );
    await writeFile(captureMetadataPath, JSON.stringify(forgedOversizedLog, null, 2), {
      mode: 0o600,
    });
    await assert.rejects(
      stageNativeSaveRetryPublicEvidence({
        repositoryRoot,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        requestedRunId: fixture.requestedRunId,
        fixtureRunId: fixture.fixtureRunId,
        selection: fixture.selection,
        bindings: fixture.bindings,
      }),
      /producer label|logPath/i,
    );
    await writeFile(captureMetadataPath, originalCaptureMetadata, { mode: 0o600 });
    await rm(path.join(fixture.captureRoot, 'oversized-generic.private.json'));

    await chmod(commandLogPath, 0o640);
    await assert.rejects(
      stageNativeSaveRetryPublicEvidence({
        repositoryRoot,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        requestedRunId: fixture.requestedRunId,
        fixtureRunId: fixture.fixtureRunId,
        selection: fixture.selection,
        bindings: fixture.bindings,
      }),
      /private|owned/i,
    );
    await chmod(commandLogPath, 0o600);

    const escapedCapture = JSON.parse(originalCaptureMetadata.toString()) as {
      commandExecutions: { logPath: string }[];
    };
    escapedCapture.commandExecutions[0].logPath = path.join(
      path.dirname(fixture.captureRoot),
      'outside-build.private.log',
    );
    await writeFile(captureMetadataPath, JSON.stringify(escapedCapture, null, 2), { mode: 0o600 });
    await assert.rejects(
      stageNativeSaveRetryPublicEvidence({
        repositoryRoot,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        requestedRunId: fixture.requestedRunId,
        fixtureRunId: fixture.fixtureRunId,
        selection: fixture.selection,
        bindings: fixture.bindings,
      }),
      /path|escape|command log/i,
    );
    await writeFile(captureMetadataPath, originalCaptureMetadata, { mode: 0o600 });

    const logOwnershipAlias = JSON.parse(originalCaptureMetadata.toString()) as {
      commandExecutions: {
        logPath: string;
        ownershipPath: string;
        outputFailure: unknown;
      }[];
    };
    logOwnershipAlias.commandExecutions[0].ownershipPath =
      logOwnershipAlias.commandExecutions[0].logPath;
    logOwnershipAlias.commandExecutions[0].outputFailure = null;
    await writeFile(captureMetadataPath, JSON.stringify(logOwnershipAlias, null, 2), {
      mode: 0o600,
    });
    await assert.rejects(
      stageNativeSaveRetryPublicEvidence({
        repositoryRoot,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        requestedRunId: fixture.requestedRunId,
        fixtureRunId: fixture.fixtureRunId,
        selection: fixture.selection,
        bindings: fixture.bindings,
      }),
      /artifact path .*aliases/i,
    );
    await writeFile(captureMetadataPath, originalCaptureMetadata, { mode: 0o600 });

    const logStdoutAlias = JSON.parse(originalCaptureMetadata.toString()) as {
      commandExecutions: {
        logPath: string;
        stdoutPath: string | null;
        outputFailure: unknown;
      }[];
    };
    logStdoutAlias.commandExecutions[0].stdoutPath = logStdoutAlias.commandExecutions[0].logPath;
    logStdoutAlias.commandExecutions[0].outputFailure = null;
    await writeFile(captureMetadataPath, JSON.stringify(logStdoutAlias, null, 2), {
      mode: 0o600,
    });
    await assert.rejects(
      stageNativeSaveRetryPublicEvidence({
        repositoryRoot,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        requestedRunId: fixture.requestedRunId,
        fixtureRunId: fixture.fixtureRunId,
        selection: fixture.selection,
        bindings: fixture.bindings,
      }),
      /artifact path .*aliases/i,
    );
    await writeFile(captureMetadataPath, originalCaptureMetadata, { mode: 0o600 });

    const duplicateCapture = JSON.parse(originalCaptureMetadata.toString()) as {
      commandExecutions: unknown[];
    };
    const duplicateAdapter = JSON.parse(originalRuntimeAdapterMetadata.toString()) as {
      commandDiagnostics: unknown[];
    };
    duplicateCapture.commandExecutions.push(structuredClone(duplicateCapture.commandExecutions[0]));
    duplicateAdapter.commandDiagnostics.push(
      structuredClone(duplicateAdapter.commandDiagnostics[0]),
    );
    await writeFile(captureMetadataPath, JSON.stringify(duplicateCapture, null, 2), {
      mode: 0o600,
    });
    await writeFile(runtimeAdapterMetadataPath, JSON.stringify(duplicateAdapter, null, 2), {
      mode: 0o600,
    });
    await assert.rejects(
      stageNativeSaveRetryPublicEvidence({
        repositoryRoot,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        requestedRunId: fixture.requestedRunId,
        fixtureRunId: fixture.fixtureRunId,
        selection: fixture.selection,
        bindings: fixture.bindings,
      }),
      /duplicated for log/i,
    );
    await writeFile(captureMetadataPath, originalCaptureMetadata, { mode: 0o600 });
    await writeFile(runtimeAdapterMetadataPath, originalRuntimeAdapterMetadata, { mode: 0o600 });

    const outsideLogPath = path.join(
      path.dirname(fixture.captureRoot),
      'outside-build.private.log',
    );
    await writeFile(outsideLogPath, 'outside', { mode: 0o600 });
    await rm(commandLogPath);
    await symlink(outsideLogPath, commandLogPath);
    await assert.rejects(
      stageNativeSaveRetryPublicEvidence({
        repositoryRoot,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        requestedRunId: fixture.requestedRunId,
        fixtureRunId: fixture.fixtureRunId,
        selection: fixture.selection,
        bindings: fixture.bindings,
      }),
      /symlink|escape|private/i,
    );
    await rm(commandLogPath);
    await writeFile(commandLogPath, oversizedCommandLog, { mode: 0o600 });
    await rm(outsideLogPath);

    const hardlinkPath = path.join(fixture.captureRoot, 'hardlink-alias.private.log');
    await link(commandLogPath, hardlinkPath);
    await assert.rejects(
      stageNativeSaveRetryPublicEvidence({
        repositoryRoot,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        requestedRunId: fixture.requestedRunId,
        fixtureRunId: fixture.fixtureRunId,
        selection: fixture.selection,
        bindings: fixture.bindings,
      }),
      /private|regular|link/i,
    );
    await rm(hardlinkPath);

    const failedCapture = JSON.parse(originalCaptureMetadata.toString()) as {
      commandExecutions: { outputFailure: unknown }[];
    };
    failedCapture.commandExecutions[0].outputFailure = {
      reason: 'io',
      stream: 'stderr',
      bytes: 1,
      message: 'synthetic output failure',
    };
    await writeFile(captureMetadataPath, JSON.stringify(failedCapture, null, 2), { mode: 0o600 });
    await assert.rejects(
      stageNativeSaveRetryPublicEvidence({
        repositoryRoot,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        requestedRunId: fixture.requestedRunId,
        fixtureRunId: fixture.fixtureRunId,
        selection: fixture.selection,
        bindings: fixture.bindings,
      }),
      /output|completed|diagnostic/i,
    );
    await writeFile(captureMetadataPath, originalCaptureMetadata, { mode: 0o600 });

    const reversed = [...fixture.bindings].reverse();
    await assert.rejects(
      stageNativeSaveRetryPublicEvidence({
        repositoryRoot,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        requestedRunId: fixture.requestedRunId,
        fixtureRunId: fixture.fixtureRunId,
        selection: fixture.selection,
        bindings: reversed,
      }),
      /assertion bindings|canonical|deep/i,
    );
    await writeFile(path.join(fixture.outputRoot, 'unattached.census-failure.private.json'), '{}', {
      mode: 0o600,
    });
    await assert.rejects(
      stageNativeSaveRetryPublicEvidence({
        repositoryRoot,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        requestedRunId: fixture.requestedRunId,
        fixtureRunId: fixture.fixtureRunId,
        selection: fixture.selection,
        bindings: fixture.bindings,
      }),
      /census failure/i,
    );
    await rm(path.join(fixture.outputRoot, 'unattached.census-failure.private.json'));
    const staged = await stageNativeSaveRetryPublicEvidence({
      repositoryRoot,
      captureRoot: fixture.captureRoot,
      outputRoot: fixture.outputRoot,
      requestedRunId: fixture.requestedRunId,
      fixtureRunId: fixture.fixtureRunId,
      selection: fixture.selection,
      bindings: fixture.bindings,
    });
    assert.equal(staged.nativePassingCases, 0);
    const manifestValue = JSON.parse(
      await readFile(path.join(fixture.outputRoot, staged.copyManifest.path), 'utf8'),
    ) as { files: { path: string; sizeBytes: number; sha256: string }[] };
    const commandManifest = manifestValue.files.find(
      (row) => row.path === 'ios-save-retry.private.log',
    );
    assert(commandManifest);
    assert.equal(commandManifest.sizeBytes, oversizedCommandLog.byteLength);
    assert.equal(commandManifest.sha256, hash(oversizedCommandLog));
    const stagedCommandLogPath = path.join(
      fixture.outputRoot,
      `evidence/${fixture.captureRunId}/ios-save-retry.private.log`,
    );
    const stagedCommandLogInfo = await lstat(stagedCommandLogPath);
    assert.equal(stagedCommandLogInfo.mode & 0o777, 0o600);
    await verifyStagedNativeSaveRetryEvidence({
      repositoryRoot,
      selection: fixture.selection,
      outputRoot: fixture.outputRoot,
      copyManifest: staged.copyManifest,
      requestedRunId: fixture.requestedRunId,
      captureRunId: fixture.captureRunId,
      fixtureRunId: fixture.fixtureRunId,
      captureRoot: fixture.captureRoot,
    });
    await writeFile(commandLogPath, 'truncated original log', { mode: 0o600 });
    await assert.rejects(
      verifyStagedNativeSaveRetryEvidence({
        repositoryRoot,
        selection: fixture.selection,
        outputRoot: fixture.outputRoot,
        copyManifest: staged.copyManifest,
        requestedRunId: fixture.requestedRunId,
        captureRunId: fixture.captureRunId,
        fixtureRunId: fixture.fixtureRunId,
        captureRoot: fixture.captureRoot,
      }),
      /immutable original|differs|size|changed/i,
    );
    await writeFile(commandLogPath, oversizedCommandLog, { mode: 0o600 });
    await writeFile(stagedCommandLogPath, 'truncated staged log', { mode: 0o600 });
    await assert.rejects(
      verifyStagedNativeSaveRetryEvidence({
        repositoryRoot,
        selection: fixture.selection,
        outputRoot: fixture.outputRoot,
        copyManifest: staged.copyManifest,
        requestedRunId: fixture.requestedRunId,
        captureRunId: fixture.captureRunId,
        fixtureRunId: fixture.fixtureRunId,
      }),
      /size|changed|Evidence/i,
    );
    await writeFile(stagedCommandLogPath, oversizedCommandLog, { mode: 0o600 });
    const manifest = path.join(fixture.outputRoot, staged.copyManifest.path);
    const stagedPrefix = `evidence/${fixture.captureRunId}`;
    const proofRelative = fixture.bindings[0].evidencePaths[0];
    const proofPath = path.join(fixture.outputRoot, stagedPrefix, proofRelative);
    const forgedProof = JSON.parse(await readFile(proofPath, 'utf8')) as {
      references: { path: string; sha256: string }[];
    };
    forgedProof.references[0].sha256 = 'f'.repeat(64);
    const forgedProofBytes = Buffer.from(JSON.stringify(forgedProof, null, 2));
    await writeFile(proofPath, forgedProofBytes, { mode: 0o600 });
    const forgedManifest = JSON.parse(await readFile(manifest, 'utf8')) as {
      files: { path: string; sha256: string }[];
    };
    forgedManifest.files.find((row) => row.path === proofRelative)!.sha256 = hash(forgedProofBytes);
    const forgedManifestBytes = Buffer.from(JSON.stringify(forgedManifest, null, 2));
    await writeFile(manifest, forgedManifestBytes, { mode: 0o600 });
    await assert.rejects(
      verifyStagedNativeSaveRetryEvidence({
        repositoryRoot,
        selection: fixture.selection,
        outputRoot: fixture.outputRoot,
        copyManifest: { path: staged.copyManifest.path, sha256: hash(forgedManifestBytes) },
        requestedRunId: fixture.requestedRunId,
        captureRunId: fixture.captureRunId,
        fixtureRunId: fixture.fixtureRunId,
      }),
      /Evidence changed/i,
    );
    const originalManifest = await readFile(manifest);
    await writeFile(manifest, Buffer.concat([originalManifest, Buffer.from('\nforged')]), {
      mode: 0o600,
    });
    await assert.rejects(
      verifyStagedNativeSaveRetryEvidence({
        repositoryRoot,
        selection: fixture.selection,
        outputRoot: fixture.outputRoot,
        copyManifest: staged.copyManifest,
        requestedRunId: fixture.requestedRunId,
        captureRunId: fixture.captureRunId,
        fixtureRunId: fixture.fixtureRunId,
      }),
      /copy manifest changed|hash/i,
    );
  } finally {
    await rm(path.dirname(fixture.captureRoot), { recursive: true, force: true });
  }
});

void test('iOS save/retry preparation rejects an Android selection before reading private artifacts', async () => {
  const repositoryRoot = await realpath(path.resolve(__dirname, '../..'));
  const selection = await selectionFor(repositoryRoot);
  const forged = {
    ...selection,
    arguments: {
      ...selection.arguments,
      platform: 'android' as const,
      scenario: 'SCN-save-retry-android' as const,
    },
  } as NativePilotSelection;
  await assert.rejects(
    prepareIosSaveRetryPilotEvidence({
      repositoryRoot,
      artifactRoot: path.join(os.tmpdir(), 'missing-save-retry-artifact'),
      selection: forged,
      requestedRunId: 'a'.repeat(24),
    }),
    /ios|scenario\/platform|selection/i,
  );
});
