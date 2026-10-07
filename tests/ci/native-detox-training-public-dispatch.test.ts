import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { readOwnedDetoxConnectionEvidence } from '../../scripts/testing/detox-connection-evidence';
import { DetoxConnectionIpcClient } from '../../scripts/testing/detox-connection-ipc';
import { readActualDetoxRuntimeMetadata } from '../../scripts/testing/detox-runtime-build-metadata';
import { runDetoxTrainingOnExistingOwner } from '../../scripts/testing/detox-training-owned-dispatch';
import {
  delegateIosDetoxConnectionAsSingleOwner,
  DETOX_IOS_CONNECTION_PUBLIC_OWNER,
  type DetoxIosConnectionPublicBridgeInput,
} from '../../scripts/testing/native-detox-connection-public-bridge';
import { runIosDetoxConnectionAttemptForNativePilot } from '../../scripts/testing/native-detox-connection-public-dispatch';
import {
  requireIosDetoxTrainingOwnerSelection,
  requireIosDetoxTrainingProducerEvidence,
  requireIosDetoxTrainingPublicSelection,
  runIosDetoxTrainingAttemptForPublicDispatch,
  selectVerifiedIosDetoxTrainingPublicFinalization,
  writeIosDetoxTrainingStageArtifacts,
  verifyIosDetoxTrainingTerminal,
  detoxTrainingDispatchRuntimeClosure,
} from '../../scripts/testing/native-detox-training-public-dispatch';
import {
  buildDetoxTrainingPublicFinalization,
  assertDetoxTrainingPublicFinalizationCandidate,
} from '../../scripts/testing/native-detox-training-public-finalization';
import {
  requireNativePilotAssertions,
  selectNativePilotScenario,
  type NativePilotSelection,
} from '../../scripts/testing/native-pilot-contract';
import {
  stageNativeTrainingPublicEvidence,
  verifyStagedNativeTrainingEvidence,
} from '../../scripts/testing/native-training-public-evidence';
import type { DetoxTrainingStep } from '../../scripts/testing/detox-training-journey';
import type { OwnedDomainSnapshot, OwnedFixtures } from '../../scripts/testing/owned-session';

const repositoryRoot = process.cwd();
const root = repositoryRoot;
const runId = 'a'.repeat(24);
const attemptId = `${runId}:first`;
const child = {
  pid: 12_345,
  pgid: 12_345,
  started: '2026-10-02T00:00:00Z',
} as const;
const apiOrigin = 'http://127.0.0.1:9001';
const exerciseId = '00000000-0000-4000-8000-000000000001';
const exerciseName = 'en QA Exercise 1';

void test('training owner rejects an elapsed IPC deadline without opening a command', () => {
  assert.throws(
    () =>
      new DetoxConnectionIpcClient({
        artifactRoot: path.join(os.tmpdir(), 'detox-training-expired-ipc'),
        platform: 'ios',
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: performance.now() - 1,
        expectedChild: child,
      }),
    /absolute deadline|elapsed/i,
  );
});

async function actualRuntimeMetadataFixture() {
  const file = path.join(repositoryRoot, 'node_modules/detox/package.json');
  const stat = await lstat(file);
  const resolved = await realpath(file);
  const bytes = await readFile(file);
  const packageJson = JSON.parse(bytes.toString('utf8')) as {
    name?: unknown;
    version?: unknown;
  };
  assert.equal(packageJson.name, 'detox');
  assert(typeof packageJson.version === 'string');
  const identity = {
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
  return {
    environmentHash: 'e'.repeat(64),
    toolVersions: { node: process.version, detox: packageJson.version },
    toolVersionEvidence: {
      path: 'node_modules/detox/package.json' as const,
      realpath: resolved,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      packageName: 'detox' as const,
      packageVersion: packageJson.version,
      identity,
    },
  };
}

async function inventorySelections(): Promise<{
  training: NativePilotSelection;
  connection: NativePilotSelection;
}> {
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as { scenarios: NativePilotSelection['scenario'][] };
  const trainingScenario = inventory.scenarios.find((row) => row.id === 'SCN-training-ios');
  const connectionScenario = inventory.scenarios.find((row) => row.id === 'SCN-connection-ios');
  assert(trainingScenario);
  assert(connectionScenario);
  return {
    training: {
      arguments: {
        platform: 'ios',
        engine: 'detox',
        scenario: 'SCN-training-ios',
        mode: 'integration',
      },
      scenario: structuredClone(trainingScenario),
      scenarioHash: 'a'.repeat(64),
      requirementHash: 'b'.repeat(64),
    },
    connection: {
      arguments: {
        platform: 'ios',
        engine: 'detox',
        scenario: 'SCN-connection-ios',
        mode: 'integration',
      },
      scenario: structuredClone(connectionScenario),
      scenarioHash: 'c'.repeat(64),
      requirementHash: 'd'.repeat(64),
    },
  };
}

void test('iOS Detox training reaches the existing connection owner and keeps the seven-case ledger', async () => {
  const selected = await inventorySelections();
  const runtimeMetadata = await readActualDetoxRuntimeMetadata(repositoryRoot, 'e'.repeat(64));
  assert.equal(runtimeMetadata.toolVersionEvidence.packageName, 'detox');
  assert.equal(
    runtimeMetadata.toolVersionEvidence.packageVersion,
    runtimeMetadata.toolVersions.detox,
  );
  assert.equal(runtimeMetadata.toolVersionEvidence.path, 'node_modules/detox/package.json');
  assert.doesNotThrow(() => requireIosDetoxTrainingPublicSelection(selected.training));
  assert.doesNotThrow(() =>
    requireIosDetoxTrainingOwnerSelection(selected.training, selected.connection),
  );
  assert.throws(() =>
    requireIosDetoxTrainingPublicSelection({
      ...selected.training,
      arguments: { ...selected.training.arguments, engine: 'maestro' },
    } as NativePilotSelection),
  );
  assert.throws(() =>
    requireIosDetoxTrainingOwnerSelection(selected.training, {
      ...selected.connection,
      arguments: { ...selected.connection.arguments, platform: 'android' },
    } as NativePilotSelection),
  );

  const candidateRoot = path.resolve(__dirname, '../..');
  const adapter = await readFile(
    path.join(candidateRoot, 'scripts/testing/native-detox-training-public-dispatch.ts'),
    'utf8',
  );
  const runner = await readFile(
    path.join(candidateRoot, 'scripts/testing/run-native-pilot.ts'),
    'utf8',
  );
  const owner = await readFile(
    path.join(candidateRoot, 'scripts/testing/detox-integrated-connection-driver.ts'),
    'utf8',
  );
  const connection = await readFile(
    path.join(candidateRoot, 'scripts/testing/native-detox-connection-public-dispatch.ts'),
    'utf8',
  );
  const buildReuse = await readFile(
    path.join(candidateRoot, 'scripts/testing/native-build-reuse.ts'),
    'utf8',
  );
  const bridge = await readFile(
    path.join(candidateRoot, 'scripts/testing/native-detox-connection-public-bridge.ts'),
    'utf8',
  );
  assert.match(
    adapter,
    /runOwnedDetoxConnectionAttempt\([\s\S]*trainingSelection: input\.selection/,
  );
  // The current public runner owns the Maestro training lane.  The Detox
  // training adapter remains a separate source-only candidate until an
  // explicit runner-selection change is accepted; do not claim it is wired
  // merely because this module can be called directly.
  assert.match(runner, /isSupportedTrainingSelection/);
  assert.match(runner, /runIosTrainingAttempt/);
  assert.match(runner, /IOS_DETOX_TRAINING_PUBLIC_DISPATCH/);
  assert.match(runner, /runIosDetoxTrainingAttemptForPublicDispatch/);
  assert.match(owner, /runDetoxTrainingOnExistingOwner/);
  assert.match(bridge, /public runner attempt namespace/);
  assert.doesNotMatch(bridge, /artifactNamespace/);
  assert.match(owner, /trainingSelection/);
  assert.match(adapter, /writeAtomicDetoxConnectionBytes\(/);
  assert.match(adapter, /signal: attemptSignal/);
  assert.match(adapter, /deadlineAt: trainingDeadlineAt/);
  assert.match(adapter, /deadlineAtMonotonicMs: trainingDeadlineAt/);
  assert.match(adapter, /reuseBuildSourceRoot/);
  assert.match(connection, /reuseBuildSourceRoot/);
  assert.match(connection, /sourceRoot: reuseBuildSourceRoot/);
  assert.match(buildReuse, /sourceRoot\?: string/);
  assert.match(buildReuse, /Native build relocation source root/);
  assert.match(owner, /deadlineMs/);
  assert.doesNotMatch(owner, /deadlineAt: performance\.now\(\) \+ deadlineMs/);
  assert.match(adapter, /repositoryRoot: input\.repositoryRoot/);
  assert.match(adapter, /requireTrainingCommandHistory/);
  assert.match(adapter, /prepareTrainingCaptureRoot/);
  assert.match(adapter, /detox-training-captures/);
  assert.match(adapter, /artifactRoot: captureArtifactRoot/);
  assert.match(runner, /verifyStagedNativeTrainingEvidence/);
  assert.match(runner, /assertNativePilotCompletion/);
  assert.match(runner, /execution-deadlines\.private\.json/);
  assert.match(runner, /MYCHAMPIONS_NATIVE_BUILD_CACHE_ROOT/);
  assert.match(runner, /reuseBuildSourceRoot/);
  assert.match(runner, /iosDetoxTrainingSourceOnly/);
  assert.doesNotMatch(adapter, /writeFile\(/);
});

void test('generated training declaration binds every concrete dispatcher dependency', async () => {
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as {
    scenarios: {
      id: string;
      ownerPaths: string[];
      freshnessInputs?: { ownerPaths?: string[] };
    }[];
  };
  const training = inventory.scenarios.find((row) => row.id === 'SCN-training-ios');
  const android = inventory.scenarios.find((row) => row.id === 'SCN-training-android');
  assert(training);
  assert(android);
  const ownerPaths = new Set(training.ownerPaths);
  const freshnessPaths = new Set(training.freshnessInputs?.ownerPaths ?? []);
  for (const relativePath of detoxTrainingDispatchRuntimeClosure) {
    assert(ownerPaths.has(relativePath), `training owner closure omitted ${relativePath}`);
    assert(freshnessPaths.has(relativePath), `training freshness closure omitted ${relativePath}`);
  }
  assert.equal(ownerPaths.size, training.ownerPaths.length);
  assert.equal(freshnessPaths.size, (training.freshnessInputs?.ownerPaths ?? []).length);
  const iosOnlyTrainingPaths = detoxTrainingDispatchRuntimeClosure.slice(0, 4);
  for (const relativePath of iosOnlyTrainingPaths)
    assert(!android.ownerPaths.includes(relativePath), `Android training imported ${relativePath}`);
});

void test('runner composition delegates one bounded owner request and preserves failed owner result', async () => {
  const selected = await inventorySelections();
  const input = {
    repositoryRoot,
    serverRoot: repositoryRoot,
    artifactRoot: path.join(repositoryRoot, '.qa', 'private-training-composition-root'),
    requestedRunId: runId,
    requestedAttemptId: attemptId,
    selection: selected.training,
    connectionSelection: selected.connection,
    signal: new AbortController().signal,
    deadlineMs: 30_000,
    deadlineAtMonotonicMs: performance.now() + 30_000,
    buildRunId: 'b'.repeat(24),
  } as const;
  let calls = 0;
  const result = await runIosDetoxTrainingAttemptForPublicDispatch(input, {}, (received) => {
    calls += 1;
    assert.equal(received.selection, input.selection);
    assert.equal(received.connectionSelection, input.connectionSelection);
    assert.equal(received.deadlineAtMonotonicMs, input.deadlineAtMonotonicMs);
    return {
      verificationResult: 'failed',
      nativePassingCases: 0,
      publicPromotionEligible: false,
    } as never;
  });
  assert.equal(calls, 1);
  assert.equal(result.verificationResult, 'failed');
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.publicPromotionEligible, false);

  let expiredRunnerCalls = 0;
  await assert.rejects(
    runIosDetoxTrainingAttemptForPublicDispatch(
      { ...input, deadlineAtMonotonicMs: performance.now() - 1 },
      {},
      () => {
        expiredRunnerCalls += 1;
        throw new Error('expired deadline reached injected runner');
      },
    ),
    /deadline.*invalid|elapsed/i,
  );
  assert.equal(expiredRunnerCalls, 0);
});

void test('Detox artifact ownership is transferred only after the final bridge budget fence', async () => {
  const selected = await inventorySelections();
  const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-training-v8-lease-')));
  const artifactRoot = path.join(scratch, '.qa', 'artifacts', 'native-pilot', runId);
  await mkdir(path.dirname(artifactRoot), { recursive: true, mode: 0o700 });
  const controller = new AbortController();
  const start = performance.now();
  const deadlineAt = start + 30_000;
  let now = start;
  let bridgeCalls = 0;
  try {
    await assert.rejects(
      runIosDetoxConnectionAttemptForNativePilot(
        {
          repositoryRoot,
          serverRoot: scratch,
          artifactRoot,
          requestedRunId: runId,
          requestedAttemptId: attemptId,
          selection: selected.connection,
          signal: controller.signal,
          deadlineMs: 30_000,
          deadlineAtMonotonicMs: deadlineAt,
          buildRunId: 'b'.repeat(24),
        },
        {
          now: () => now,
          loadBuild: async () => {
            // The qualified build has loaded, but the remaining bridge budget
            // is now below the 30-second minimum. The bridge must not receive
            // ownership of the artifact root in this state.
            now = deadlineAt - 29_000;
            await Promise.resolve();
            return {} as never;
          },
          runBridge: async () => {
            bridgeCalls += 1;
            await Promise.resolve();
            throw new Error('bridge must not run after the budget fence');
          },
        },
      ),
      /cleanup|deadline elapsed/i,
    );
    assert.equal(bridgeCalls, 0);
    const rootEntries = await readdir(artifactRoot).catch(() => null);
    assert(
      rootEntries === null ||
        rootEntries.length === 0 ||
        rootEntries.includes('detox-connection-root-recovery.private.json'),
      'pre-driver cleanup left unclassified artifact files',
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

void test('training bridge uses the canonical attempt root and preserves blocked status', async () => {
  const selected = await inventorySelections();
  const canonicalCaptureRoot = path.join(
    repositoryRoot,
    '.qa/artifacts/native-pilot-attempts',
    runId,
  );
  const input = {
    owner: DETOX_IOS_CONNECTION_PUBLIC_OWNER,
    repositoryRoot,
    serverRoot: path.join(repositoryRoot, '..', 'mychampions-server'),
    artifactRoot: canonicalCaptureRoot,
    requestedRunId: runId,
    requestedAttemptId: attemptId,
    selection: selected.connection,
    build: {
      source: { sourceTreeHash: 'a'.repeat(64) },
      helperInputsHash: 'b'.repeat(64),
      binaryHash: 'c'.repeat(64),
      detoxConfigHash: 'd'.repeat(64),
    },
    runnerPaths: {
      jestConfigPath: path.join(
        repositoryRoot,
        'e2e/jest.detox-integrated-connection-baseline.config.js',
      ),
      testPath: path.join(repositoryRoot, 'e2e/detox-integrated-connection-baseline.e2e.test.js'),
    },
    signal: new AbortController().signal,
    deadlineMs: 30_000,
    validateBuild: () => undefined,
    delegate: () =>
      Promise.resolve({
        kind: 'private-detox-connection-attempt-not-public-receipt',
        status: 'blocked',
        selectionValid: true,
        acquired: false,
        cleanup: 'not-acquired',
        report: null,
        ledger: [],
        failures: [],
        recoveryStatus: 'verified',
        deadlineAccounting: null,
        nativePassingCases: 0,
        publicPromotionEligible: false,
      } as never),
  } as unknown as DetoxIosConnectionPublicBridgeInput;
  const result = await delegateIosDetoxConnectionAsSingleOwner(input);
  assert.equal(result.attempt.status, 'blocked');
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner({
      ...input,
      artifactRoot: path.join(
        repositoryRoot,
        '.qa/artifacts/native-pilot-attempts/detox-training-captures',
        runId,
      ),
    }),
    /public runner attempt namespace/i,
  );
});

void test('training producer verification rejects caller-shaped or failed evidence before any terminal', async () => {
  const runId = 'a'.repeat(24);
  const malformedBridge = {
    attempt: {
      status: 'source-only',
      cleanup: 'cleaned',
      recoveryStatus: 'verified',
      nativePassingCases: 0,
      publicPromotionEligible: false,
      report: {},
    },
  } as never;
  await assert.rejects(
    requireIosDetoxTrainingProducerEvidence({
      artifactRoot: path.join(repositoryRoot, '.qa', 'private-missing-training-artifact-root'),
      bridgeResult: malformedBridge,
    }),
  );

  const failedRuntime = {
    verificationResult: 'failed',
    publicPromotionEligible: false,
    nativePassingCases: 0,
    requestedRunId: runId,
  } as never;
  await assert.rejects(
    verifyIosDetoxTrainingTerminal({
      runtime: failedRuntime,
      signal: new AbortController().signal,
      deadlineAt: Number.POSITIVE_INFINITY,
    }),
  );
});
async function selection(): Promise<NativePilotSelection> {
  const inventory = JSON.parse(
    await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as { scenarios: NativePilotSelection['scenario'][] };
  const scenario = inventory.scenarios.find((row) => row.id === 'SCN-training-ios');
  assert(scenario);
  return {
    arguments: {
      platform: 'ios',
      engine: 'detox',
      scenario: 'SCN-training-ios',
      mode: 'integration',
    },
    scenario: structuredClone(scenario),
    scenarioHash: 'b'.repeat(64),
    requirementHash: 'c'.repeat(64),
  };
}

function baseline(): OwnedDomainSnapshot {
  return {
    schemaVersion: 1,
    runId,
    scope: 'native-entry-ios',
    readOnly: true,
    connections: [],
    trainingPlans: [
      {
        id: 'seeded-unrelated-plan',
        studentAuthUid: 'seeded-owner',
        ownerProfessionalUid: 'seeded-owner',
        sourceKind: 'predefined',
        name: 'Seeded',
        isArchived: false,
        isDraft: false,
        lifecycleConnectionId: null,
        sessions: [],
        createdAt: '2026-09-29T00:00:00Z',
        updatedAt: '2026-09-29T00:00:00Z',
      },
    ],
  };
}

function saved(name: string, quantity: string): OwnedDomainSnapshot {
  const value = baseline();
  value.trainingPlans.push({
    id: 'training_plan_11111111-1111-4111-8111-111111111111',
    studentAuthUid: 'coach',
    ownerProfessionalUid: 'coach',
    sourceKind: 'predefined',
    name,
    isArchived: false,
    isDraft: false,
    lifecycleConnectionId: null,
    createdAt: '2026-09-29T00:00:00Z',
    updatedAt: quantity === '3x8' ? '2026-09-29T00:00:00Z' : '2026-09-29T00:00:01Z',
    sessions: [
      {
        id: 'session-1',
        name: 'Strength',
        notes: '',
        items: [
          {
            id: quantity === '3x8' ? 'item-1' : 'item-2',
            name: exerciseName,
            exerciseId,
            quantity,
            notes: '',
          },
        ],
      },
    ],
  });
  return value;
}

type Producer =
  | 'detox.device.generateViewHierarchyXml'
  | 'detox.device.takeScreenshot'
  | 'detox.element.getAttributes';

function sourceReceipt(rootPath: string, fileName: string, bytes: Buffer, producer: Producer) {
  const file = path.join(rootPath, fileName);
  return {
    producer,
    sourceKind: 'file' as const,
    processPid: child.pid,
    processPgid: child.pgid,
    processStarted: child.started,
    sourceBytes: bytes.byteLength,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    sourcePath: file,
    sourceRealpath: file,
    sourceMode: 0o600,
    sourceUid: process.getuid?.(),
    fileName,
  };
}

async function stepReceipt(rootPath: string, step: DetoxTrainingStep) {
  const prefix = `detox-training-${step.id}`;
  const attrs = step.selectors.map((selector) => ({
    identifier: selector,
    enabled: true,
    visible: true,
    hittable: true,
    frame: { x: 0, y: 0, width: 100, height: 50 },
    ...(step.expectedRendered[selector]
      ? {
          text: step.expectedRendered[selector],
          value: step.expectedRendered[selector],
        }
      : {}),
  }));
  const files = {
    xml: `${prefix}.xml`,
    screenshot: `${prefix}.png`,
    attributesBefore: `${prefix}-before.json`,
    attributesAfter: `${prefix}-after.json`,
  };
  const values = {
    [files.xml]: Buffer.from(
      `<ViewHierarchy>${step.selectors
        .map(
          (id) =>
            `<View resource-id="${id}" class="UIView" width="100" height="50" visibility="visible" alpha="1" focused="false" x="0" y="0"/>`,
        )
        .join('')}</ViewHierarchy>`,
    ),
    [files.screenshot]: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
    [files.attributesBefore]: Buffer.from(JSON.stringify(attrs)),
    [files.attributesAfter]: Buffer.from(JSON.stringify(attrs)),
  };
  const canonicalRoot = await realpath(rootPath);
  const producerPath = path.join(canonicalRoot, `${prefix}-producer.png`);
  const producerSnapshotPath = path.join(canonicalRoot, `${prefix}-producer-snapshot.png`);
  await writeFile(producerPath, values[files.screenshot], {
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(producerSnapshotPath, values[files.screenshot], {
    flag: 'wx',
    mode: 0o600,
  });
  const producerRealpath = await realpath(producerPath);
  const producerSnapshotRealpath = await realpath(producerSnapshotPath);
  const producerStat = await lstat(producerPath);
  const producerSnapshotStat = await lstat(producerSnapshotPath);
  await Promise.all(
    Object.entries(values).map(async ([fileName, bytes]) => {
      await writeFile(path.join(rootPath, fileName), bytes, {
        flag: 'wx',
        mode: 0o600,
      });
      await chmod(path.join(rootPath, fileName), 0o600);
    }),
  );
  const receipt = (producer: string, fileName: string) => ({
    ...sourceReceipt(
      rootPath,
      fileName,
      values[fileName as keyof typeof values],
      producer as Producer,
    ),
  });
  return {
    schemaVersion: 1 as const,
    kind: 'private-detox-training-step-receipt' as const,
    stepId: step.id,
    assertionId: step.assertionId,
    runId,
    attemptId,
    commandId: 1,
    commandHash: 'e'.repeat(64),
    platform: 'ios' as const,
    viewId: step.viewId,
    childIdentity: child,
    selectors: [...step.selectors],
    rendered: { ...step.expectedRendered },
    sourceFiles: files,
    sourceReceipts: {
      xml: receipt('detox.device.generateViewHierarchyXml', files.xml),
      screenshot: {
        ...receipt('detox.device.takeScreenshot', files.screenshot),
        producerPath: producerRealpath,
        producerRealpath,
        producerBytes: values[files.screenshot].byteLength,
        producerSha256: createHash('sha256').update(values[files.screenshot]).digest('hex'),
        producerMode: producerStat.mode & 0o777,
        producerUid: producerStat.uid,
        producerNlink: producerStat.nlink,
        producerDev: producerStat.dev,
        producerIno: producerStat.ino,
        producerRetention: 'owned-snapshot' as const,
        producerSnapshotPath: producerSnapshotRealpath,
        producerSnapshotRealpath,
        producerSnapshotBytes: values[files.screenshot].byteLength,
        producerSnapshotSha256: createHash('sha256').update(values[files.screenshot]).digest('hex'),
        producerSnapshotMode: producerSnapshotStat.mode & 0o777,
        producerSnapshotUid: producerSnapshotStat.uid,
        producerSnapshotNlink: producerSnapshotStat.nlink,
        producerSnapshotDev: producerSnapshotStat.dev,
        producerSnapshotIno: producerSnapshotStat.ino,
      },
      attributesBefore: receipt('detox.element.getAttributes', files.attributesBefore),
      attributesAfter: receipt('detox.element.getAttributes', files.attributesAfter),
    },
    selectorEvidence: step.selectors.map((selector, index) => ({
      selector,
      before: attrs[index],
      after: attrs[index],
      frameStable: true as const,
    })),
    startedMonotonicMs: 1,
    finishedMonotonicMs: 2,
    status: 'completed' as const,
    actionCompleted: true,
    hierarchyCaptured: true,
    screenshotCaptured: true,
  };
}

void test('public training adapter consumes the existing owner producer files and retains private status', async () => {
  const output = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-training-owner-dispatch-')),
  );
  try {
    const selected = await selection();
    const runtimeMetadata = await actualRuntimeMetadataFixture();
    const states = [
      baseline(),
      baseline(),
      saved(`QA training ${attemptId}`, '3x8'),
      saved(`QA training ${attemptId}`, '3x8'),
      saved(`QA training ${attemptId}`, '3x8'),
      saved(`QA training ${attemptId} updated`, '4x10'),
      saved(`QA training ${attemptId} updated`, '4x10'),
      saved(`QA training ${attemptId} updated`, '4x10'),
    ];
    let snapshotIndex = 0;
    let apiReadIndex = 0;
    const observations = [
      {
        requestId: 1,
        method: 'POST',
        pathHash: createHash('sha256').update('/plans/training').digest('hex'),
        requestOrigin: null,
        requestProfile: 'native' as const,
        targetOrigin: apiOrigin,
        status: 201,
        outcome: 'forwarded' as const,
        faultAttemptId: null,
        elapsedMs: 1,
      },
      {
        requestId: 2,
        method: 'GET',
        pathHash: createHash('sha256').update('/plans/predefined').digest('hex'),
        requestOrigin: null,
        requestProfile: 'native' as const,
        targetOrigin: apiOrigin,
        status: 200,
        outcome: 'forwarded' as const,
        faultAttemptId: null,
        elapsedMs: 1,
      },
      {
        requestId: 3,
        method: 'POST',
        pathHash: createHash('sha256').update('/integrations/exercise/search').digest('hex'),
        requestOrigin: null,
        requestProfile: 'native' as const,
        targetOrigin: apiOrigin,
        status: 200,
        outcome: 'forwarded' as const,
        faultAttemptId: null,
        elapsedMs: 1,
      },
      {
        requestId: 4,
        method: 'GET',
        pathHash: createHash('sha256')
          .update(`/integrations/exercise/exercises/${exerciseId}`)
          .digest('hex'),
        requestOrigin: null,
        requestProfile: 'native' as const,
        targetOrigin: apiOrigin,
        status: 200,
        outcome: 'forwarded' as const,
        faultAttemptId: null,
        elapsedMs: 1,
      },
      {
        requestId: 5,
        method: 'GET',
        pathHash: createHash('sha256')
          .update('/plans/training/training_plan_11111111-1111-4111-8111-111111111111')
          .digest('hex'),
        requestOrigin: null,
        requestProfile: 'native' as const,
        targetOrigin: apiOrigin,
        status: 200,
        outcome: 'forwarded' as const,
        faultAttemptId: null,
        elapsedMs: 1,
      },
      {
        requestId: 6,
        method: 'PATCH',
        pathHash: createHash('sha256')
          .update('/plans/training/training_plan_11111111-1111-4111-8111-111111111111')
          .digest('hex'),
        requestOrigin: null,
        requestProfile: 'native' as const,
        targetOrigin: apiOrigin,
        status: 200,
        outcome: 'forwarded' as const,
        faultAttemptId: null,
        elapsedMs: 1,
      },
      {
        requestId: 7,
        method: 'GET',
        pathHash: createHash('sha256')
          .update('/plans/training/training_plan_11111111-1111-4111-8111-111111111111')
          .digest('hex'),
        requestOrigin: null,
        requestProfile: 'native' as const,
        targetOrigin: apiOrigin,
        status: 200,
        outcome: 'forwarded' as const,
        faultAttemptId: null,
        elapsedMs: 1,
      },
      {
        requestId: 8,
        method: 'GET',
        pathHash: createHash('sha256')
          .update('/plans/training/training_plan_11111111-1111-4111-8111-111111111111')
          .digest('hex'),
        requestOrigin: null,
        requestProfile: 'native' as const,
        targetOrigin: apiOrigin,
        status: 200,
        outcome: 'forwarded' as const,
        faultAttemptId: null,
        elapsedMs: 1,
      },
    ];
    for (const row of observations)
      Object.assign(row, {
        requestCredentialPresent: true,
        requestCredentialClassification: {
          authorization: 'bearer' as const,
          cookie: 'absent' as const,
          knownAccessCookie: 'absent' as const,
          knownRefreshCookie: 'absent' as const,
          otherCookiePresent: false,
          malformedCookiePresent: false,
        },
      });
    const bridge = {
      runTrainingStep: async (step: DetoxTrainingStep) => stepReceipt(output, step),
      restartApp: (options: { appIdentifier: string; launchCount: number }) =>
        Promise.resolve({
          schemaVersion: 1 as const,
          kind: 'private-detox-training-restart-receipt' as const,
          commandId: 1,
          commandHash: 'e'.repeat(64),
          status: 'completed' as const,
          runId,
          attemptId,
          platform: 'ios' as const,
          appIdentifier: options.appIdentifier,
          launchCount: options.launchCount,
          synchronizationDisabled: true as const,
          childIdentity: child,
          launchArgsHash: 'd'.repeat(64),
          startedMonotonicMs: 1,
          finishedMonotonicMs: 2,
          cleanupFence: 'required-before-return' as const,
        }),
      shutdown: () => Promise.resolve(),
    };
    const session = {
      manifest: { runId },
      apiOrigin,
      apiPid: 98_765,
      snapshot: () =>
        Promise.resolve(structuredClone(states[Math.min(snapshotIndex++, states.length - 1)])),
      snapshotWithEvidence: () => {
        const value = structuredClone(states[Math.min(snapshotIndex++, states.length - 1)]);
        return Promise.resolve({
          value,
          receipt: {
            apiOrigin,
            apiPid: 98_765,
            apiStarted: child.started,
            backendAttemptId: `${runId}:first`,
            manifestSha256: 'e'.repeat(64),
            apiLedgerSha256: 'f'.repeat(64),
            fixtureAuthUidAllowlistHash: 'g'.repeat(64),
          },
        });
      },
      probeCurrentApiLifetime: () =>
        Promise.resolve({
          runId,
          apiOrigin,
          apiPid: 98_765,
          apiStarted: child.started,
          apiScript: '/owned/scripts/testing/serve.ts',
          backendAttemptId: `${runId}:first`,
          manifestSha256: 'e'.repeat(64),
          apiAttempt: 'session-start',
          apiLedgerSha256: 'f'.repeat(64),
        }),
    };
    const proxy = {
      origin: 'http://127.0.0.1:9002',
      observations,
      nativeAuthIdentities: [
        {
          apiPid: 98_765,
          authUid: 'coach',
          targetOrigin: apiOrigin,
          verification: 'verified',
        },
      ],
      readObservedNativeTrainingPlan: () =>
        Promise.resolve({
          status: 200,
          plan: structuredClone(states[apiReadIndex++ < 1 ? 2 : 5].trainingPlans[1]),
        }),
    };
    const fixtures = {
      runId,
      scope: 'native-entry-ios',
      accounts: { coach: { authUid: 'coach' } },
      draft: { sessions: [{ items: [{ exerciseId, name: exerciseName }] }] },
    } as unknown as OwnedFixtures;
    const report: Record<string, unknown> = {
      detoxConnectionCommands: [
        {
          commandId: 7,
          commandHash: 'c'.repeat(64),
          commandKind: 'training-owner',
        },
      ],
    };
    const result = await runDetoxTrainingOnExistingOwner({
      repositoryRoot: root,
      output,
      selection: selected,
      fixtures,
      session: session as never,
      proxy: proxy as never,
      child: bridge,
      childIdentity: child,
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 30_000,
      report,
    });
    report.detoxTrainingChildShutdown = true;
    report.commandExecutions = [
      {
        label: 'detox-training-child',
        phase: 'step',
        deadlineMs: 30_000,
        execution: 'completed',
        command: 'detox-training-child',
        argv: [],
        cwd: root,
        pid: child.pid,
        pgid: child.pgid,
        cleanup: 'cleaned',
        childExitCode: 0,
        childSignal: null,
        censusFailure: null,
        outputFailure: null,
      },
    ];
    const originalHeader = {
      owner: 'detox-driver',
      requestedRunId: runId,
      requestedAttemptId: attemptId,
      captureRunId: runId,
      childIdentity: child,
      commandIds: [7],
      commandHashes: ['c'.repeat(64)],
    };
    const buildOriginal = {
      kind: 'private-detox-qualified-build-original',
      ...originalHeader,
      configuration: 'ios.sim.debug',
      sourceTreeHash: '3'.repeat(64),
      helperInputsHash: '1'.repeat(64),
      binaryHash: 'f'.repeat(64),
      detoxConfigHash: '2'.repeat(64),
      environmentHash: runtimeMetadata.environmentHash,
      toolVersions: runtimeMetadata.toolVersions,
      toolVersionEvidence: runtimeMetadata.toolVersionEvidence,
      dispatchRuntimeInputsHash: '4'.repeat(64),
    };
    await writeFile(
      path.join(output, 'detox-build-original.private.json'),
      `${JSON.stringify(buildOriginal)}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    await writeFile(
      path.join(output, 'detox-command-original.private.json'),
      `${JSON.stringify({
        kind: 'private-detox-command-original',
        ...originalHeader,
        commands: report.detoxConnectionCommands,
      })}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    await writeFile(
      path.join(output, 'detox-connection-cleanup.private.json'),
      `${JSON.stringify({
        kind: 'private-detox-connection-cleanup',
        captureRunId: runId,
        backendRunId: runId,
        status: 'cleaned',
        recoveryStatus: 'verified',
        failures: [],
        child: {
          pid: child.pid,
          outcome: { code: 0, signal: null },
          censusFailure: null,
          outputFailure: null,
        },
      })}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicPromotionEligible, false);
    assert.equal(
      report.detoxTraining && (report.detoxTraining as Record<string, unknown>).apiReadCount,
      3,
    );
    for (const name of [
      'detox-training-api.private.json',
      'detox-training-sql.private.json',
      'detox-training-transport.private.json',
    ]) {
      const bytes = await readFile(path.join(output, name));
      assert(bytes.byteLength > 0);
      assert.equal((await readdir(output)).includes(name), true);
      assert.equal((JSON.parse(bytes.toString('utf8')) as { runId?: string }).runId, runId);
    }
    const sourceReceipts = (report.detoxTraining as Record<string, unknown>)
      .sourceReceipts as Record<string, Record<string, unknown>>;
    for (const receipt of Object.values(sourceReceipts)) {
      assert.equal(receipt.sourceRealpath, receipt.sourcePath);
      assert.equal(receipt.sourceMode, 0o600);
      assert.equal(receipt.sourceNlink, 1);
      assert(Number.isSafeInteger(receipt.sourceDev));
      assert(Number.isSafeInteger(receipt.sourceIno));
    }
    const bridgeResult = {
      requestedRunId: runId,
      attempt: {
        status: 'source-only' as const,
        cleanup: 'cleaned' as const,
        recoveryStatus: 'verified' as const,
        nativePassingCases: 0,
        publicPromotionEligible: false,
        captureRunId: runId,
        report: {
          ...report,
          backend: { runId, apiOrigin, apiPid: 98_765 },
          target: {
            platform: 'ios',
            deviceId: 'owned-test-target',
            ownership: 'owned',
          },
          build: {
            platform: 'ios',
            configuration: 'ios.sim.debug',
            binaryPath: '/owned/build/MyChampions.app',
            binaryHash: 'f'.repeat(64),
            helperInputsHash: '1'.repeat(64),
            detoxConfigHash: '2'.repeat(64),
            source: { sourceTreeHash: '3'.repeat(64) },
            dispatchRuntimeInputsHash: '4'.repeat(64),
            ...runtimeMetadata,
          },
          detoxChildIdentity: child,
          detoxProducerReceipt: {
            captureRunId: runId,
            platform: 'ios',
            childIdentity: child,
          },
        },
      },
    };
    const evidence = await requireIosDetoxTrainingProducerEvidence({
      artifactRoot: output,
      bridgeResult,
    } as never);
    const originalBuildBytes = await readFile(
      path.join(output, 'detox-build-original.private.json'),
    );
    const forgedBuild = JSON.parse(originalBuildBytes.toString()) as Record<string, unknown>;
    forgedBuild.childIdentity = { ...child, pid: child.pid + 1 };
    await writeFile(
      path.join(output, 'detox-build-original.private.json'),
      `${JSON.stringify(forgedBuild)}\n`,
      { mode: 0o600 },
    );
    await assert.rejects(
      requireIosDetoxTrainingProducerEvidence({
        artifactRoot: output,
        bridgeResult,
      } as never),
      /child identity/i,
    );
    await writeFile(path.join(output, 'detox-build-original.private.json'), originalBuildBytes, {
      mode: 0o600,
    });
    assert.equal(evidence.assertionIds.length, 7);
    assert.equal(evidence.sourceReceipts.api.fileName, 'detox-training-api.private.json');
    assert.equal(evidence.publicPromotionEligible, false);

    const ledger = requireNativePilotAssertions(selected);
    const bindings = ledger.map((row) => ({
      id: row.id,
      requirementRefs: [...row.requirementRefs],
      evidencePaths: row.evidencePathTemplates!.map((template) =>
        template.replace('{attemptId}', evidence.attemptId),
      ),
    }));
    const runtime = {
      requestedRunId: runId,
      requestedAttemptId: attemptId,
      captureRunId: evidence.runId,
      fixtureRunId: evidence.runId,
      captureExitCode: 0,
      childExitCode: 0,
      childSignal: null,
      captureResult: 'observed',
      captureCleanup: 'cleaned',
      captureTimeout: null,
      cancellation: null,
      deadline: null,
      externalCleanupResult: 'passed',
      captureCompleted: true,
      callbackInvocations: 1,
      callbackCompleted: true,
      verificationResult: 'passed',
      postCaptureFailure: null,
      censusFailures: [],
      outputFailures: [],
      applicationFailure: null,
      applicationFailureCandidate: null,
    };
    const candidate = buildDetoxTrainingPublicFinalization({
      requestedRunId: runId,
      requestedAttemptId: attemptId,
      selection: selected,
      runtime,
      evidence,
      assertionBindings: bindings,
      runtimeEvidence: {
        metadata: evidence.runtimeMetadata,
        originalReceipts: evidence.originalReceipts,
      },
    });
    assertDetoxTrainingPublicFinalizationCandidate(candidate, {
      requestedRunId: runId,
      requestedAttemptId: attemptId,
      captureRunId: runId,
      fixtureRunId: runId,
    });
    assert.equal(candidate.nativePassingCases, 7);
    assert.equal(candidate.publicPassingCases, 7);
    assert.equal(candidate.publicPromotionEligible, true);
    const eligibleRuntime = {
      ...runtime,
      trainingEvidence: evidence,
      publicFinalization: candidate,
      publicFinalizationFailure: null,
    } as unknown as Parameters<typeof selectVerifiedIosDetoxTrainingPublicFinalization>[0];
    assert.strictEqual(
      selectVerifiedIosDetoxTrainingPublicFinalization(eligibleRuntime),
      candidate,
    );
    assert.equal(
      selectVerifiedIosDetoxTrainingPublicFinalization({
        ...eligibleRuntime,
        publicFinalizationFailure: { name: 'late', message: 'late terminal failure' },
      }),
      undefined,
    );

    // Exercise the actual capture -> private staging -> public terminal seam
    // with the inventory-selected Detox route and distinct requested, capture
    // and backend identities.  The source-only producer fixture above remains
    // deliberately non-promotable; this bounded route proves that promotion
    // can only be emitted after the real producer evidence is rebound to the
    // selected scenario and the existing protected stage verifier.
    const selectionRootOverride: unknown = process.env.MYCHAMPIONS_T14_SELECTION_ROOT;
    const selectionRepositoryRoot: string =
      typeof selectionRootOverride === 'string' && selectionRootOverride.length > 0
        ? selectionRootOverride
        : root;
    const inventory: unknown = JSON.parse(
      await readFile(
        path.join(selectionRepositoryRoot, 'docs/qa/native-pilot/inventory.json'),
        'utf8',
      ),
    );
    const canonicalSelected = await selectNativePilotScenario(
      selected.arguments,
      inventory,
      selectionRepositoryRoot,
    );
    const stageRequestedRunId = 'b'.repeat(24);
    const stageBackendRunId = 'c'.repeat(24);
    const stageEvidence = {
      ...evidence,
      runId: stageBackendRunId,
      attemptId: `${stageBackendRunId}:first`,
      input: {
        ...evidence.input,
        runId: stageBackendRunId,
        attemptId: `${stageBackendRunId}:first`,
      },
      stepReceipts: evidence.stepReceipts.map((receipt) => ({
        ...receipt,
        runId: stageBackendRunId,
        attemptId: `${stageBackendRunId}:first`,
      })),
    };
    const stageBuild = {
      platform: 'ios',
      configuration: 'ios.sim.debug',
      binaryPath: '/owned/build/MyChampions.app',
      binaryHash: 'f'.repeat(64),
      helperInputsHash: '1'.repeat(64),
      detoxConfigHash: '2'.repeat(64),
      source: { sourceTreeHash: '3'.repeat(64) },
      ...runtimeMetadata,
    };
    const captureParent = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'detox-training-public-capture-')),
    );
    const captureRoot = path.join(captureParent, runId);
    await mkdir(captureRoot, { mode: 0o700 });
    for (const name of await readdir(output)) {
      const sourcePath = path.join(output, name);
      const targetPath = path.join(captureRoot, name);
      const sourceStat = await lstat(sourcePath);
      assert(sourceStat.isFile(), `Training capture fixture entry is not a file: ${name}`);
      await copyFile(sourcePath, targetPath);
      await chmod(targetPath, sourceStat.mode & 0o777);
    }
    // The copied capture is a new owned evidence root. Rebind every original
    // receipt to the descriptor/path identity actually observed in that root;
    // retaining the producer-root realpath here would correctly fail the
    // finalizer's descriptor-bound reread and would make this fixture claim a
    // provenance relationship it does not have.
    const rebindOriginalReceipt = async (
      fileName: string,
      value: Readonly<Record<string, unknown>>,
    ) => {
      const observed = await readOwnedDetoxConnectionEvidence(
        captureRoot,
        fileName,
        16 * 1024 * 1024,
      );
      return {
        fileName,
        sha256: createHash('sha256').update(observed.bytes).digest('hex'),
        realpath: observed.realpath,
        metadata: observed.metadata,
        value,
      };
    };
    const stageOriginalReceipts = {
      build: await rebindOriginalReceipt(
        'detox-build-original.private.json',
        evidence.originalReceipts.build.value,
      ),
      command: await rebindOriginalReceipt(
        'detox-command-original.private.json',
        evidence.originalReceipts.command.value,
      ),
    };
    const stageEvidenceBound = {
      ...stageEvidence,
      originalReceipts: stageOriginalReceipts,
    };
    const stageArtifacts = await writeIosDetoxTrainingStageArtifacts({
      repositoryRoot: selectionRepositoryRoot,
      artifactRoot: captureRoot,
      requestedRunId: stageRequestedRunId,
      requestedAttemptId: `${stageRequestedRunId}:first`,
      selection: canonicalSelected,
      evidence: stageEvidenceBound,
      report,
      build: stageBuild,
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 30_000,
    });
    const stageRuntime = {
      ...runtime,
      requestedRunId: stageRequestedRunId,
      requestedAttemptId: `${stageRequestedRunId}:first`,
      captureRunId: runId,
      fixtureRunId: stageBackendRunId,
    };
    const stagedCandidate = buildDetoxTrainingPublicFinalization({
      requestedRunId: stageRequestedRunId,
      requestedAttemptId: `${stageRequestedRunId}:first`,
      selection: canonicalSelected,
      runtime: stageRuntime,
      evidence: stageEvidenceBound,
      assertionBindings: stageArtifacts.bindings,
      runtimeEvidence: {
        metadata: stageEvidence.runtimeMetadata,
        originalReceipts: stageEvidenceBound.originalReceipts,
      },
    });
    const stagingParent = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'detox-training-public-stage-')),
    );
    const stagedRoot = path.join(stagingParent, stageRequestedRunId);
    await mkdir(stagedRoot, { mode: 0o700 });
    try {
      const staged = await stageNativeTrainingPublicEvidence({
        repositoryRoot: selectionRepositoryRoot,
        captureRoot,
        outputRoot: stagedRoot,
        requestedRunId: stageRequestedRunId,
        fixtureRunId: stageBackendRunId,
        selection: canonicalSelected,
        bindings: stageArtifacts.bindings,
        publicFinalization: stagedCandidate,
        lifecycle: {
          signal: new AbortController().signal,
          deadlineAtMs: performance.now() + 30_000,
        },
      });
      assert.equal(staged.assertions.length, 7);
      const stagedManifest = JSON.parse(
        (await readFile(path.join(stagedRoot, staged.copyManifest.path))).toString('utf8'),
      ) as {
        nativePassingCases?: number;
        publicPassingCases?: number;
        publicPromotionEligible?: boolean;
      };
      assert.equal(stagedManifest.nativePassingCases, 7);
      assert.equal(stagedManifest.publicPassingCases, 7);
      assert.equal(stagedManifest.publicPromotionEligible, true);
      await verifyStagedNativeTrainingEvidence({
        outputRoot: stagedRoot,
        copyManifest: staged.copyManifest,
        requestedRunId: stageRequestedRunId,
        captureRunId: runId,
        fixtureRunId: stageBackendRunId,
        captureRoot,
        expectedPublicFinalization: stagedCandidate,
        lifecycle: {
          signal: new AbortController().signal,
          deadlineAtMs: performance.now() + 30_000,
        },
      });
      const originalBuildPath = path.join(captureRoot, 'detox-build-original.private.json');
      const originalBuildBytes = await readFile(originalBuildPath);
      const replacementBuildBytes = Buffer.from(
        originalBuildBytes
          .toString('utf8')
          .replace(/"sourceTreeHash":"3{64}"/, `"sourceTreeHash":"${'4'.repeat(64)}"`),
      );
      assert.equal(replacementBuildBytes.byteLength, originalBuildBytes.byteLength);
      // Reuse the same requested run identity after removing the successful
      // output; the stage contract intentionally rejects a fresh root whose
      // basename is unrelated to the bound requested run.
      await rm(stagedRoot, { recursive: true, force: true });
      await mkdir(stagedRoot, { mode: 0o700 });
      let replacedAfterInitialRecheck = false;
      await assert.rejects(
        stageNativeTrainingPublicEvidence({
          repositoryRoot: selectionRepositoryRoot,
          captureRoot,
          outputRoot: stagedRoot,
          requestedRunId: stageRequestedRunId,
          fixtureRunId: stageBackendRunId,
          selection: canonicalSelected,
          bindings: stageArtifacts.bindings,
          publicFinalization: stagedCandidate,
          lifecycle: {
            signal: new AbortController().signal,
            deadlineAtMs: performance.now() + 30_000,
            beforeMutationBoundary: async (label) => {
              if (label !== 'create directory evidence' || replacedAfterInitialRecheck) return;
              replacedAfterInitialRecheck = true;
              const replacement = `${originalBuildPath}.replacement`;
              await writeFile(replacement, replacementBuildBytes, {
                flag: 'wx',
                mode: 0o600,
              });
              await rename(replacement, originalBuildPath);
            },
          },
        }),
        /Detox original receipt (bytes|identity) changed/i,
      );
      assert.equal(replacedAfterInitialRecheck, true);
      await writeFile(originalBuildPath, originalBuildBytes, { mode: 0o600 });
      const invalidStagedRoot = path.join(stagingParent, 'd'.repeat(24));
      await mkdir(invalidStagedRoot, { mode: 0o700 });
      const malformedCandidate = {
        ...stagedCandidate,
        publicPromotionEligible: false,
      } as never;
      await assert.rejects(
        stageNativeTrainingPublicEvidence({
          repositoryRoot: selectionRepositoryRoot,
          captureRoot,
          outputRoot: invalidStagedRoot,
          requestedRunId: 'd'.repeat(24),
          fixtureRunId: stageBackendRunId,
          selection: canonicalSelected,
          bindings: stageArtifacts.bindings,
          publicFinalization: malformedCandidate,
          lifecycle: {
            signal: new AbortController().signal,
            deadlineAtMs: performance.now() + 30_000,
          },
        }),
        /identity differs|public promotion|eligible|true/i,
      );
    } finally {
      await rm(stagingParent, { recursive: true, force: true });
      await rm(captureParent, { recursive: true, force: true });
    }
    assert.throws(
      () =>
        buildDetoxTrainingPublicFinalization({
          requestedRunId: runId,
          requestedAttemptId: attemptId,
          selection: selected,
          runtime,
          evidence,
          assertionBindings: bindings,
          runtimeEvidence: {
            metadata: {
              ...evidence.runtimeMetadata,
              toolVersions: {
                ...evidence.runtimeMetadata.toolVersions,
                detox: 'owned-driver-contract',
              },
            },
            originalReceipts: evidence.originalReceipts,
          },
        }),
      /tool version is not observed|tool version is invalid|runtime metadata.*invalid/i,
    );
    assert.throws(
      () =>
        buildDetoxTrainingPublicFinalization({
          requestedRunId: runId,
          requestedAttemptId: attemptId,
          selection: selected,
          runtime: { ...runtime, childExitCode: 1 },
          evidence,
          assertionBindings: bindings,
          runtimeEvidence: {
            metadata: evidence.runtimeMetadata,
            originalReceipts: evidence.originalReceipts,
          },
        }),
      /1 !== 0/i,
    );
    assert.throws(
      () =>
        buildDetoxTrainingPublicFinalization({
          requestedRunId: runId,
          requestedAttemptId: attemptId,
          selection: selected,
          runtime,
          evidence,
          assertionBindings: bindings.slice(0, -1),
          runtimeEvidence: {
            metadata: evidence.runtimeMetadata,
            originalReceipts: evidence.originalReceipts,
          },
        }),
      /assertion count is incomplete/i,
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
