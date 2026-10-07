import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path, { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { ownedDetoxBaselineFactories } from '../../scripts/testing/detox-integrated-session-baseline';
import {
  createCurrentDetoxIosCameraOwner,
  observeDetoxCameraChildOutcome,
  prepareDetoxCameraStageDirectory,
  resolveDetoxCameraNodeEnvironment,
  waitForOwnedDetoxChildStartup,
  type CurrentOwnerOptions,
} from '../../scripts/testing/native-detox-camera-ios-current-owner';
import {
  createDetoxCameraBootstrapGuard,
  requireDetoxCameraBootstrapReceipt,
} from '../../scripts/testing/native-detox-camera-ios-ipc';
import { DetoxCameraAcquisitionError } from '../../scripts/testing/native-detox-camera-ios-owner';
import {
  NativeHostContentionError,
  inspectNativeHostContention,
  requireNativeHostAvailability,
} from '../../scripts/testing/native-host-contention';
import { nativePilotDefaultOutputParent } from '../../scripts/testing/native-pilot-invocation';
import {
  OwnedNativeCommandAcquisitionError,
  startOwnedNativeCommand,
} from '../../scripts/testing/owned-native-command';
import { groupProcesses } from '../../scripts/testing/owned-process-group';
import {
  expectedIosDetoxCameraArtifactRoot,
  requireIosDetoxCameraArtifactRoot,
} from '../../scripts/testing/run-ios-detox-camera-attempt';
import {
  evaluatePartialDetoxCameraCleanup,
  inspectPartialDetoxCameraCleanup,
  requireOwnedIosCleanupNamespace,
} from '../../scripts/testing/verify-owned-ios-cleanup';

const ownerPath = path.join(
  __dirname,
  '../../scripts/testing/native-detox-camera-ios-current-owner.ts',
);
const attemptPath = path.join(__dirname, '../../scripts/testing/run-ios-detox-camera-attempt.ts');

void test('V15 normalizes NODE_ENV before resource acquisition and rejects arbitrary values', () => {
  assert.equal(resolveDetoxCameraNodeEnvironment(undefined), 'test');
  assert.equal(resolveDetoxCameraNodeEnvironment('development'), 'development');
  assert.equal(resolveDetoxCameraNodeEnvironment('production'), 'production');
  assert.equal(resolveDetoxCameraNodeEnvironment('test'), 'test');
  for (const value of ['', 'staging', 'TEST', ' development'])
    assert.throws(
      () => resolveDetoxCameraNodeEnvironment(value),
      /NODE_ENV to be development, production, or test/,
    );
});

void test('V16 binds the camera owner and inspector to the canonical cleanup namespace', () => {
  const repositoryRoot = '/private/worktrees/mychampions';
  const runId = '0123456789abcdef01234567';
  const cameraSelection = {
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-camera-denied-ios',
    mode: 'integration',
  } as const;
  const canonical = expectedIosDetoxCameraArtifactRoot(repositoryRoot, runId);
  assert.equal(canonical, join(repositoryRoot, '.qa/artifacts/native-pilot', runId));
  assert.equal(
    nativePilotDefaultOutputParent(repositoryRoot, cameraSelection),
    join(repositoryRoot, '.qa/artifacts/native-pilot'),
  );
  assert.doesNotThrow(() =>
    requireIosDetoxCameraArtifactRoot({
      repositoryRoot,
      artifactRoot: canonical,
      requestedRunId: runId,
    }),
  );
  assert.equal(requireOwnedIosCleanupNamespace(repositoryRoot, canonical), runId);
  const foreign = join(repositoryRoot, '.qa/artifacts/native-pilot-attempts', runId);
  assert.throws(
    () =>
      requireIosDetoxCameraArtifactRoot({
        repositoryRoot,
        artifactRoot: foreign,
        requestedRunId: runId,
      }),
    /canonical native-pilot cleanup namespace/,
  );
  assert.throws(
    () => requireOwnedIosCleanupNamespace(repositoryRoot, foreign),
    /Independent cleanup root differs from the captured run/,
  );
});

async function privateRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  await chmod(root, 0o700);
  return root;
}

async function prepareCameraRunnerInputs(root: string) {
  const paths = {
    detoxBaseConfigPath: join(root, '.detoxrc.js'),
    detoxConfigPath: join(root, 'detox.camera.private.config.js'),
    jestConfigPath: join(root, 'jest.detox-camera.private.config.js'),
    cameraTestPath: join(root, 'e2e/detox-ios-camera-route.e2e.test.js'),
    childSourcePath: join(root, 'e2e/detox-ios-camera-route.e2e.test.js'),
  } as const;
  await mkdir(join(root, 'e2e'), { mode: 0o700 });
  await writeFile(paths.detoxBaseConfigPath, 'module.exports = {}\n', { mode: 0o600 });
  await writeFile(paths.detoxConfigPath, 'module.exports = {}\n', { mode: 0o600 });
  await writeFile(paths.jestConfigPath, 'module.exports = {}\n', { mode: 0o600 });
  await writeFile(paths.cameraTestPath, "test('camera', () => {})\n", { mode: 0o600 });
  return {
    ...paths,
    childSourceSha256: createHash('sha256')
      .update(await readFile(paths.childSourcePath))
      .digest('hex'),
  };
}

async function prepare(root: string): Promise<string> {
  const stageRoot = path.join(root, 'detox-camera-stage');
  await prepareDetoxCameraStageDirectory({
    artifactRoot: root,
    stageRoot,
    signal: new AbortController().signal,
    deadlineAtMonotonicMs: performance.now() + 30_000,
  });
  return stageRoot;
}

void test('V14 binds host census to the prepared stage and wires real default acquisition', async () => {
  const owner = await readFile(ownerPath, 'utf8');
  const stage = owner.indexOf('await prepareDetoxCameraStageDirectory({');
  const census = owner.indexOf('await factories.requireNativeHostAvailability(options.stageRoot);');
  const previous = owner.indexOf(
    'await factories.capturePreviousIosDevices(options.artifactRoot, options.signal);',
  );
  const reservation = owner.indexOf("acquireResource('app-port'");
  const proxy = owner.indexOf("acquireResource('proxy'");
  const expo = owner.indexOf("acquireResource('expo'");
  const afterDevices = owner.indexOf("label: 'after-ios-devices'", expo);
  const capture = owner.indexOf("'capture.private.json'", afterDevices);
  const verify = owner.indexOf('factories.verifyOwnedIosCleanup({', capture);
  assert(stage >= 0 && census > stage, 'stage binding must precede the owner host census');
  assert(
    previous > census && reservation > previous,
    'device baseline must precede app acquisition',
  );
  assert(proxy > reservation && expo > proxy, 'proxy and Expo must be acquired in the owner');
  assert(
    afterDevices > expo && capture > afterDevices,
    'cleanup must publish device and capture ledgers',
  );
  assert(verify > capture, 'independent cleanup must consume the published capture ledger');
  assert(
    !owner.includes('requireNativeHostAvailability(options.artifactRoot)'),
    'owner must not reuse the outer census path',
  );
  assert.match(owner, /requestedPort:\s*qualifiedApiPort/);
  assert.match(owner, /surface:\s*'native'/);
  assert.match(owner, /apiOrigin:\s*proxy!?\.origin/);
  assert.match(owner, /parentEnv,\s*signal:\s*options\.signal/);
  assert.match(owner, /resolveDetoxCameraNodeEnvironment\(parentEnv\.NODE_ENV\)/);
  assert.match(owner, /cleanupPartiallyAcquired/);
  assert.match(owner, /new DetoxCameraAcquisitionError\(/);
  assert.match(owner, /runDetoxCleanupAggregate\(\{/);
  assert.match(owner, /deadlineAt:\s*options\.deadlineAtMonotonicMs/);
  assert.match(owner, /new AbortController\(\)\.signal/);
  assert.match(owner, /reason === 'aborted'[\s\S]{0,120}\? 'cancelled'/);
  assert.match(owner, /'partial-capture-ledger'/);
  assert.match(owner, /buildDetoxVerifiedBinaryEnvironment\(options\.build\)/);
  assert.match(owner, /DETOX_IOS_SIMULATOR_UDID:\s*target\.deviceId/);
  assert.match(owner, /DETOX_CONNECTION_PLATFORM:\s*'ios'/);
  assert.match(owner, /factories\.reserveOwnedAppPort\(options\.build\.metroPort\)/);
  assert.match(owner, /reservation:\s*reservation!/);
  assert.match(owner, /DETOX_METRO_PORT:\s*String\(reservation\.port\)/);
  assert.match(owner, /DETOX_IOS_METRO_PORT:\s*undefined/);
  assert.doesNotMatch(owner, /DETOX_IOS_METRO_PORT:\s*String\(reservation\.port\)/);
  assert.match(owner, /deadlineMs:\s*remainingDeadlineMs\(options\.deadlineAt\)/);
  assert.match(owner, /commandExecutions:\s*\[/);
  const captureBlock = owner.slice(capture);
  assert.match(captureBlock, /scope:\s*'cleanup-only'/);
  assert.match(captureBlock, /assertionsVerified:\s*false/);
  assert.match(captureBlock, /'owner-completed-unverified'/);
  assert.doesNotMatch(captureBlock, /\?\s*'passed'/);
  const attempt = await readFile(attemptPath, 'utf8');
  assert.match(attempt, /parentEnv:\s*input\.parentEnv/);
  assert.match(attempt, /requireIosDetoxCameraArtifactRoot\(input\)/);
  const runner = await readFile(
    join(__dirname, '../../scripts/testing/run-native-pilot.ts'),
    'utf8',
  );
  assert.match(runner, /nativePilotDefaultOutputParent\(root, invocation\.selection\)/);
  const publications = [...owner.matchAll(/kind: 'private-owned-ios-detox-camera-capture'/gu)];
  assert.equal(
    publications.length,
    2,
    'Detox owner must publish both partial and final capture ledgers',
  );
  for (const publication of publications) {
    const block = owner.slice(Math.max(0, publication.index - 300), publication.index + 700);
    assert.match(block, /platform:\s*captureNamespace\.platform/);
    assert.match(block, /mode:\s*captureNamespace\.mode/);
    assert.match(block, /captureRunId:\s*captureNamespace\.captureRunId/);
    assert.match(block, /captureRoot:\s*captureNamespace\.captureRoot/);
  }
});

void test('V20 accepts a qualified iOS TCP port through the marked shared Detox variable', () => {
  const configPath = path.join(__dirname, '../../.detoxrc.js');
  const probe = 'require(process.argv[1]); process.stdout.write("loaded");';
  const environment = { ...process.env };
  for (const key of ['DETOX_METRO_PORT', 'DETOX_IOS_METRO_PORT', 'DETOX_CONNECTION_PLATFORM'])
    delete environment[key];
  environment.DETOX_METRO_PORT = '63032';
  environment.DETOX_CONNECTION_PLATFORM = 'ios';
  const marked = spawnSync(process.execPath, ['-e', probe, configPath], {
    cwd: path.resolve(__dirname, '../..'),
    env: environment,
    encoding: 'utf8',
  });
  assert.equal(marked.status, 0, marked.stderr);
  assert.equal(marked.stdout, 'loaded');

  const cleared = spawnSync(process.execPath, ['-e', probe, configPath], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...environment, DETOX_IOS_METRO_PORT: undefined },
    encoding: 'utf8',
  });
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.equal(cleared.stdout, 'loaded');

  const inheritedOverride = { ...environment, DETOX_IOS_METRO_PORT: '63032' };
  const rejected = spawnSync(process.execPath, ['-e', probe, configPath], {
    cwd: path.resolve(__dirname, '../..'),
    env: inheritedOverride,
    encoding: 'utf8',
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /DETOX_METRO_PORT.*49151/);
});

void test('V14 preserves the outer census and creates a distinct clean stage census', async () => {
  const root = await privateRoot('mc-ios-detox-v14-stage-');
  try {
    const stageRoot = await prepare(root);
    await requireNativeHostAvailability(root);
    const outerPath = path.join(root, 'native-host-census.private.json');
    const outerBytes = await readFile(outerPath);
    const clean = await requireNativeHostAvailability(stageRoot);
    assert.equal(clean.status, 'no-known-job');
    const stagePath = path.join(stageRoot, 'native-host-census.private.json');
    const stageBytes = await readFile(stagePath);
    assert.notDeepEqual(stageBytes, Buffer.alloc(0));
    assert.deepEqual(await readFile(outerPath), outerBytes);
    assert.equal((await stat(stagePath)).mode & 0o777, 0o600);
    await assert.rejects(requireNativeHostAvailability(stageRoot), /EEXIST/);
    assert.deepEqual(await readFile(stagePath), stageBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V14 blocks a competing Detox child at the stage boundary without signalling it', async () => {
  const root = await privateRoot('mc-ios-detox-v14-contention-');
  let child: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  try {
    const stageRoot = await prepare(root);
    const script = path.join(root, 'node_modules/.bin/detox');
    await mkdir(path.dirname(script), { recursive: true, mode: 0o700 });
    await writeFile(script, 'setInterval(()=>{},1000);', { mode: 0o600 });
    child = await startOwnedNativeCommand({
      command: process.execPath,
      argv: [script, 'test', 'V14-PRIVATE-CONTROL'],
      artifactRoot: root,
      label: 'v14-synthetic-detox',
      env: process.env,
      phase: 'step',
    });
    const before = await inspectNativeHostContention();
    assert(before.knownJobs.some((row) => row.pid === child!.pid && row.kind === 'detox'));
    await assert.rejects(
      requireNativeHostAvailability(stageRoot),
      (error: unknown) => error instanceof NativeHostContentionError,
    );
    assert.equal(child.outcome().code, null);
    assert.doesNotThrow(() => process.kill(child!.pid, 0));
    const receipt = await readFile(path.join(stageRoot, 'native-host-census.private.json'), 'utf8');
    assert(!receipt.includes('V14-PRIVATE-CONTROL'));
    assert(!receipt.includes(script));
    await assert.rejects(requireNativeHostAvailability(stageRoot), /EEXIST/);
    assert.equal(child.outcome().code, null);
  } finally {
    await child?.stop();
    await rm(root, { recursive: true, force: true });
  }
});

void test('V19 retains native command evidence paths and stop failures in the partial camera ledger', async () => {
  const root = await privateRoot('mc-ios-detox-v19-partial-');
  const runId = '0123456789abcdef01234567';
  const releaseCalls = { value: 0 };
  const targetStops: string[] = [];
  const reservation = {
    port: 19001,
    origin: 'http://127.0.0.1:19001',
    release: () => {
      releaseCalls.value += 1;
      return Promise.resolve();
    },
  };
  const target = {
    platform: 'ios' as const,
    deviceId: 'owned-simulator-1',
    ownership: {
      artifactRoot: root,
      hostLockRequired: true as const,
      cleanupAuthorized: true as const,
    },
    verify: () => Promise.resolve(),
    stop: () => {
      targetStops.push('owned-simulator-1');
      return Promise.reject(new Error('injected target stop failure'));
    },
  };
  const backendFailure = new OwnedNativeCommandAcquisitionError({
    message: 'injected unknown native command handle',
    pid: 4242,
    pgid: 4242,
    logPath: join(root, 'detox-camera-child.private.log'),
    stdoutPath: join(root, 'detox-camera-child.stdout.private'),
    ownershipPath: join(root, 'detox-camera-child.ownership.json'),
  });
  const factories = {
    ...ownedDetoxBaselineFactories,
    requireNativeHostAvailability: () => Promise.resolve({ status: 'no-known-job' as const }),
    capturePreviousIosDevices: () => Promise.resolve(),
    reserveOwnedAppPort: () => Promise.resolve(reservation),
    acquireOwnedTarget: () => Promise.resolve(target),
    verifyIosSimulatorApp: () => Promise.resolve(),
    startOwnedSession: () => Promise.reject(backendFailure),
    verifyOwnedIosCleanup: () => Promise.resolve({ result: 'failed' as const }),
  } as unknown as typeof ownedDetoxBaselineFactories;
  const controller = new AbortController();
  const build = {
    platform: 'ios',
    configuration: 'ios.sim.debug',
    binaryPath: join(root, 'MyChampions.app'),
    binaryHash: 'b'.repeat(64),
    testBinaryPath: null,
    testBinaryHash: null,
    source: { sha: 'c'.repeat(40), dirty: false, sourceTreeHash: 'd'.repeat(64) },
    helperInputPaths: [],
    helperInputsHash: 'e'.repeat(64),
    detoxConfigPath: join(root, 'detox.js'),
    detoxConfigHash: 'f'.repeat(64),
    metroPort: 19001,
    appIdentifier: 'com.edufelip.mychampions.dev',
    embeddedRuntime: {
      variant: 'dev',
      appIdentifier: 'com.edufelip.mychampions.dev',
      apiOrigin: 'http://127.0.0.1:19003',
      configSourcePath: join(root, 'app.config.ts'),
      configSourceHash: '1'.repeat(64),
    },
    dispatchRuntimeInputPaths: [],
    dispatchRuntimeInputIdentities: [],
    dispatchRuntimeInputsHash: '2'.repeat(64),
    environmentHash: '3'.repeat(64),
    toolVersions: { node: process.version },
    toolVersionEvidence: {},
  } as never;
  try {
    const runnerInputs = await prepareCameraRunnerInputs(root);
    const owner = createCurrentDetoxIosCameraOwner({
      currentRoot: root,
      repositoryRoot: root,
      serverRoot: root,
      artifactRoot: root,
      stageRoot: join(root, 'detox-camera-stage'),
      deadlineAtMonotonicMs: performance.now() + 30_000,
      deadlineAt: Date.now() + 30_000,
      buildElapsedMs: 10,
      signal: controller.signal,
      build,
      configuration: 'ios.sim.debug',
      detoxBaseConfigPath: runnerInputs.detoxBaseConfigPath,
      detoxConfigPath: runnerInputs.detoxConfigPath,
      jestConfigPath: runnerInputs.jestConfigPath,
      cameraTestPath: runnerInputs.cameraTestPath,
      childSourcePath: runnerInputs.childSourcePath,
      childSourceSha256: runnerInputs.childSourceSha256,
      helperInputsHash: '5'.repeat(64),
      declarationHash: '6'.repeat(64),
      parentEnv: {
        ...process.env,
        NODE_ENV: 'test',
        MYCHAMPIONS_NATIVE_HOST_LOCK_HELD: '1',
      },
      factories,
      readSimulatorRuntime: () => Promise.resolve('iOS 18.0'),
    } satisfies CurrentOwnerOptions);

    await assert.rejects(owner.acquire(), (error: unknown) => {
      assert(error instanceof DetoxCameraAcquisitionError);
      assert.equal(error.acquisitionFailure.resource, 'backend');
      assert.equal(error.acquisitionFailure.pid, 4242);
      assert.equal(error.acquisitionFailure.pgid, 4242);
      assert.equal(error.acquisitionFailure.unknownHandle, true);
      assert.equal(error.acquisitionFailure.artifactPathsLexicallyValidated, true);
      assert.equal(error.acquisitionFailure.logPath, 'detox-camera-child.private.log');
      assert.equal(error.acquisitionFailure.stdoutPath, 'detox-camera-child.stdout.private');
      assert.equal(error.acquisitionFailure.ownershipPath, 'detox-camera-child.ownership.json');
      assert.equal(error.cleanup.captureCleanup, 'failed');
      return true;
    });

    const capture = JSON.parse(await readFile(join(root, 'capture.private.json'), 'utf8')) as {
      platform?: string;
      mode?: string;
      captureRunId?: string;
      captureRoot?: string;
      result?: string;
      acquisitionIntents?: string[];
      acquisitionSequence?: string[];
      acquisitionFailure?: {
        resource?: string;
        pid?: number;
        pgid?: number;
        unknownHandle?: boolean;
        artifactPathsLexicallyValidated?: boolean;
        logPath?: string | null;
        stdoutPath?: string | null;
        ownershipPath?: string | null;
      };
      backendAcquisitionFailure?: {
        resource?: string;
        pid?: number;
        pgid?: number;
        artifactPathsLexicallyValidated?: boolean;
        logPath?: string | null;
        stdoutPath?: string | null;
        ownershipPath?: string | null;
      };
      cleanup?: {
        status?: string;
        resources?: { resource?: string; cleanup?: string }[];
      };
      resourceStates?: { resource?: string; status?: string; failure?: unknown }[];
      cleanupAggregate?: { stepResults?: { label?: string; status?: string }[] };
      postChild?: { status?: string };
    };
    assert.equal(capture.platform, 'ios');
    assert.equal(capture.mode, 'integration');
    assert.equal(capture.captureRunId, path.basename(root));
    assert.equal(capture.captureRoot, root);
    assert.equal(capture.result, 'harness-blocked');
    assert.deepEqual(capture.acquisitionIntents, ['app-port', 'target', 'backend']);
    assert.deepEqual(capture.acquisitionSequence, ['app-port', 'target']);
    assert.equal(capture.acquisitionFailure?.resource, 'backend');
    assert.equal(capture.acquisitionFailure?.pid, 4242);
    assert.equal(capture.acquisitionFailure?.pgid, 4242);
    assert.equal(capture.acquisitionFailure?.unknownHandle, true);
    assert.equal(capture.acquisitionFailure?.artifactPathsLexicallyValidated, true);
    assert.equal(capture.acquisitionFailure?.logPath, 'detox-camera-child.private.log');
    assert.equal(capture.acquisitionFailure?.stdoutPath, 'detox-camera-child.stdout.private');
    assert.equal(capture.acquisitionFailure?.ownershipPath, 'detox-camera-child.ownership.json');
    assert.equal(capture.backendAcquisitionFailure?.resource, 'backend');
    assert.equal(capture.backendAcquisitionFailure?.pid, 4242);
    assert.equal(capture.backendAcquisitionFailure?.pgid, 4242);
    assert.equal(capture.backendAcquisitionFailure?.artifactPathsLexicallyValidated, true);
    assert.equal(capture.backendAcquisitionFailure?.logPath, 'detox-camera-child.private.log');
    assert.equal(capture.cleanup?.status, 'failed-recovery-retained');
    assert.equal(
      capture.cleanup?.resources?.find((row) => row.resource === 'target')?.cleanup,
      'failed',
    );
    assert.equal(
      capture.resourceStates?.find((row) => row.resource === 'backend')?.status,
      'unknown',
    );
    assert.equal(
      capture.cleanupAggregate?.stepResults?.find((row) => row.label === 'target-stop')?.status,
      'failed',
    );
    assert.equal(capture.postChild?.status, 'unknown');
    const proof = evaluatePartialDetoxCameraCleanup({
      runId,
      capture,
      files: ['capture.private.json'],
    });
    assert.equal(proof.result, 'failed');
    assert.equal(proof.recoveryVerified, false);
    assert.equal(releaseCalls.value, 1);
    assert.deepEqual(targetStops, ['owned-simulator-1']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V19 attaches validation failures to the acquired resource record', async () => {
  const root = await privateRoot('mc-ios-detox-v19-validation-');
  const targetStops: string[] = [];
  try {
    const reservation = {
      port: 19002,
      origin: 'http://127.0.0.1:19002',
      release: () => Promise.resolve(),
    };
    const target = {
      platform: 'ios' as const,
      deviceId: 'owned-simulator-validation',
      ownership: {
        artifactRoot: root,
        hostLockRequired: true as const,
        cleanupAuthorized: true as const,
      },
      verify: () => Promise.reject(new Error('injected target validation failure')),
      stop: () => {
        targetStops.push('owned-simulator-validation');
        return Promise.resolve();
      },
    };
    const factories = {
      ...ownedDetoxBaselineFactories,
      requireNativeHostAvailability: () => Promise.resolve({ status: 'no-known-job' as const }),
      capturePreviousIosDevices: () => Promise.resolve(),
      reserveOwnedAppPort: () => Promise.resolve(reservation),
      acquireOwnedTarget: () => Promise.resolve(target),
      startOwnedSession: () => Promise.reject(new Error('backend must not be acquired')),
      verifyOwnedIosCleanup: () => Promise.resolve({ result: 'failed' as const }),
    } as unknown as typeof ownedDetoxBaselineFactories;
    const build = {
      platform: 'ios',
      configuration: 'ios.sim.debug',
      binaryPath: join(root, 'MyChampions.app'),
      binaryHash: 'b'.repeat(64),
      metroPort: 19002,
      environmentHash: '3'.repeat(64),
      embeddedRuntime: {
        variant: 'dev',
        appIdentifier: 'com.edufelip.mychampions.dev',
        apiOrigin: 'http://127.0.0.1:19003',
        configSourcePath: join(root, 'app.config.ts'),
        configSourceHash: '1'.repeat(64),
      },
    } as never;
    const runnerInputs = await prepareCameraRunnerInputs(root);
    const owner = createCurrentDetoxIosCameraOwner({
      currentRoot: root,
      repositoryRoot: root,
      serverRoot: root,
      artifactRoot: root,
      stageRoot: join(root, 'detox-camera-stage'),
      deadlineAtMonotonicMs: performance.now() + 30_000,
      deadlineAt: Date.now() + 30_000,
      buildElapsedMs: 10,
      signal: new AbortController().signal,
      build,
      configuration: 'ios.sim.debug',
      detoxBaseConfigPath: runnerInputs.detoxBaseConfigPath,
      detoxConfigPath: runnerInputs.detoxConfigPath,
      jestConfigPath: runnerInputs.jestConfigPath,
      cameraTestPath: runnerInputs.cameraTestPath,
      childSourcePath: runnerInputs.childSourcePath,
      childSourceSha256: runnerInputs.childSourceSha256,
      helperInputsHash: '5'.repeat(64),
      declarationHash: '6'.repeat(64),
      parentEnv: {
        ...process.env,
        NODE_ENV: 'test',
        MYCHAMPIONS_NATIVE_HOST_LOCK_HELD: '1',
      },
      factories,
      readSimulatorRuntime: () => Promise.resolve('iOS 18.0'),
    } satisfies CurrentOwnerOptions);

    await assert.rejects(owner.acquire(), /injected target validation failure/);
    const capture = JSON.parse(await readFile(join(root, 'capture.private.json'), 'utf8')) as {
      acquisitionFailure?: { resource?: string; acquisitionPhase?: string };
      resourceStates?: {
        resource?: string;
        status?: string;
        failure?: { resource?: string; acquisitionPhase?: string } | null;
      }[];
    };
    const targetRecord = capture.resourceStates?.find((row) => row.resource === 'target');
    assert.equal(capture.acquisitionFailure?.resource, 'target');
    assert.equal(capture.acquisitionFailure?.acquisitionPhase, 'validation');
    assert.equal(targetRecord?.status, 'acquired');
    assert.equal(targetRecord?.failure?.resource, 'target');
    assert.equal(targetRecord?.failure?.acquisitionPhase, 'validation');
    assert.deepEqual(targetStops, ['owned-simulator-validation']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V19 treats a live Detox child with null exit outcome as unknown until close is observed', async () => {
  const root = await privateRoot('mc-ios-detox-v19-live-child-');
  let child: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  try {
    child = await startOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', 'setInterval(() => {}, 1000);'],
      artifactRoot: root,
      label: 'v19-live-child',
      env: process.env,
    });
    const live = observeDetoxCameraChildOutcome(child);
    assert.equal(live.status, 'unknown');
    assert.equal(live.reason, 'child-exit-not-observed');
    await child.stop();
    await child.closed;
    const stopped = observeDetoxCameraChildOutcome(child);
    assert.equal(stopped.status, 'observed');
    assert(stopped.code !== null || stopped.signal !== null);
  } finally {
    await child?.stop();
    await rm(root, { recursive: true, force: true });
  }
});

void test('V19 rejects non-prefix and duplicate partial acquisition sequences', () => {
  const base = {
    result: 'harness-blocked',
    acquisitionIntents: ['app-port', 'target', 'backend'],
    acquisitionSequence: ['app-port', 'backend'],
    acquisitionFailure: {
      artifactPathsLexicallyValidated: true,
      logPath: null,
      stdoutPath: null,
      ownershipPath: null,
    },
    cleanup: {
      status: 'failed-recovery-retained',
      resources: [],
      aggregate: {},
      unknownResources: [],
    },
    resourceStates: [],
    cleanupAggregate: {},
    postChild: { status: 'unknown' },
  };
  const outOfOrder = evaluatePartialDetoxCameraCleanup({
    runId: '0123456789abcdef01234567',
    capture: base,
    files: ['capture.private.json'],
  });
  assert(outOfOrder.failureReasons.includes('acquisition-sequence-invalid'));
  const duplicate = evaluatePartialDetoxCameraCleanup({
    runId: '0123456789abcdef01234567',
    capture: { ...base, acquisitionSequence: ['app-port', 'app-port'] },
    files: ['capture.private.json'],
  });
  assert(duplicate.failureReasons.includes('acquisition-sequence-invalid'));
});

void test('V19 names native artifact evidence as lexical and rejects an unproven projection', () => {
  const capture = {
    result: 'harness-blocked',
    acquisitionIntents: ['backend'],
    acquisitionSequence: [],
    acquisitionFailure: {
      artifactPathsLexicallyValidated: false,
      logPath: '../foreign.log',
      stdoutPath: null,
      ownershipPath: null,
    },
    cleanup: {
      status: 'failed-recovery-retained',
      resources: [],
      aggregate: {},
      unknownResources: [],
    },
    resourceStates: [],
    cleanupAggregate: {},
    postChild: { status: 'unknown' },
  };
  const proof = evaluatePartialDetoxCameraCleanup({
    runId: '0123456789abcdef01234567',
    capture,
    files: ['capture.private.json'],
  });
  assert(proof.failureReasons.includes('native-artifact-path-lexical-validation-missing'));
  assert(proof.failureReasons.includes('native-artifact-logPath-invalid'));
});

void test('V19 fences partial cleanup inspection with the caller signal and original deadline', async () => {
  const root = await privateRoot('mc-ios-detox-v19-verifier-fence-');
  try {
    const aborted = new AbortController();
    aborted.abort(new Error('injected partial verifier abort'));
    await assert.rejects(
      inspectPartialDetoxCameraCleanup(
        root,
        '0123456789abcdef01234567',
        {},
        {
          signal: aborted.signal,
          deadlineAtMonotonicMs: performance.now() + 5_000,
        },
      ),
      /abort/i,
    );
    await assert.rejects(
      inspectPartialDetoxCameraCleanup(
        root,
        '0123456789abcdef01234567',
        {},
        {
          signal: new AbortController().signal,
          deadlineAtMonotonicMs: performance.now() - 1,
        },
      ),
      /deadline/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V21 bootstraps the owned app before permission-container observation and fences child cleanup', async () => {
  const owner = await readFile(ownerPath, 'utf8');
  const child = owner.indexOf("child = await acquireResource('detox'");
  const identity = owner.indexOf('waitForOwnedDetoxChildStartup', child);
  const ipc = owner.indexOf("ipc.request({ kind: 'bootstrap', actor: 'student' })", identity);
  const permission = owner.indexOf('const permissionBefore', ipc);
  const cameraRead = owner.indexOf('readOwnedIosCameraPermission(', ipc);
  assert(child >= 0);
  assert(identity > child, 'the child process must be established before startup settling');
  assert(ipc > identity, 'the bootstrap command must follow owned child identity');
  assert(permission > ipc, 'permission-container observation must follow app bootstrap');
  assert(cameraRead > ipc, 'permission-container observation must follow app bootstrap');
  assert.match(owner, /Math\.min\(deadlineAtMonotonicMs, performance\.now\(\) \+ 5_000\)/);
  assert.match(owner, /await child!\.capture\(false, settle\);\s*await child!\.stop\(settle\);/);
});

void test('V21 startup settling adopts delayed owned descendants before strict cleanup', async () => {
  const root = await privateRoot('mc-ios-detox-v21-child-settle-');
  let child: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  try {
    child = await startOwnedNativeCommand({
      command: process.execPath,
      argv: [
        '-e',
        `
          const { spawn } = require('node:child_process');
          setTimeout(() => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }), 200);
          setInterval(() => {}, 1000);
        `,
      ],
      artifactRoot: root,
      label: 'v21-delayed-child',
      env: process.env,
      phase: 'step',
    });
    await waitForOwnedDetoxChildStartup(
      child,
      performance.now() + 5_000,
      new AbortController().signal,
    );
    const ownership = JSON.parse(
      await readFile(path.join(root, 'v21-delayed-child.ownership.json'), 'utf8'),
    ) as { processes?: { pid: number }[] };
    assert((ownership.processes?.length ?? 0) >= 2, 'delayed descendant was not retained');
    await child.stop();
    assert.deepEqual(await groupProcesses(child.pgid), []);
  } finally {
    await child?.stop().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

void test('V22 binds one real bootstrap readiness receipt across owner, producer and child', async () => {
  const owner = await readFile(ownerPath, 'utf8');
  const producer = await readFile(
    path.join(__dirname, '../../scripts/testing/native-detox-camera-ios-producer.ts'),
    'utf8',
  );
  const child = await readFile(
    path.join(__dirname, '../../e2e/detox-ios-camera-route.e2e.test.js'),
    'utf8',
  );
  const ipc = await readFile(
    path.join(__dirname, '../../scripts/testing/native-detox-camera-ios-ipc.ts'),
    'utf8',
  );
  assert.equal((owner.match(/kind: 'bootstrap'/g) ?? []).length, 1);
  assert.equal((producer.match(/kind: 'bootstrap'/g) ?? []).length, 0);
  assert.match(owner, /requireDetoxCameraBootstrapResponse/);
  assert.match(owner, /bootstrapReceipt/);
  assert.match(producer, /requireDetoxCameraBootstrapReceipt\(context\.bootstrapReceipt\)/);
  assert.match(child, /await launchFresh\(\);\s*await signIn\(studentEmail/);
  assert.match(child, /schema: 'detox-ios-camera-bootstrap-ready-v1'/);
  assert.match(ipc, /requireDetoxCameraBootstrapReceipt/);
  assert.match(ipc, /readiness\.authenticated !== true/);
});

void test('V22 rejects fabricated or wrong-actor bootstrap readiness', () => {
  const child = { pid: 4242, pgid: 4242, startedAt: 'Sun Oct  4 20:47:10 2026' };
  const valid = {
    commandId: '0000-bootstrap',
    commandHash: 'a'.repeat(64),
    child,
    readiness: {
      schema: 'detox-ios-camera-bootstrap-ready-v1',
      actor: 'student',
      landingId: 'student.home.screen',
      launch: 'fresh',
      authenticated: true,
    },
  } as const;
  assert.deepEqual(requireDetoxCameraBootstrapReceipt(valid), valid);
  assert.throws(
    () => requireDetoxCameraBootstrapReceipt({ ...valid, readiness: undefined }),
    /readiness is missing|readiness is invalid/,
  );
  assert.throws(
    () =>
      requireDetoxCameraBootstrapReceipt({
        ...valid,
        readiness: { ...valid.readiness, actor: 'coach' },
      }),
    /readiness is invalid/,
  );
});

void test('V22 startup census is bounded by the original deadline and cancellation', async () => {
  let observedSettle:
    { untilMonotonicMs?: number; signal?: AbortSignal; maxRequeries?: number } | undefined;
  const delayedChild = {
    pid: 4242,
    pgid: 4242,
    outcome: () => ({ code: null, signal: null }),
    capture: async (
      _requireVerified: boolean,
      settle?: { untilMonotonicMs?: number; signal?: AbortSignal; maxRequeries?: number },
    ) => {
      observedSettle = settle;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return [{ pid: 4242, pgid: 4242, started: 'started', commandHash: 'a'.repeat(64) }];
    },
  } as never;
  const deadline = performance.now() + 50;
  const deadlineSignal = new AbortController().signal;
  await assert.rejects(
    waitForOwnedDetoxChildStartup(delayedChild, deadline, deadlineSignal),
    /deadline|monotonic/,
  );
  assert.equal(observedSettle?.signal, deadlineSignal);
  assert.equal(observedSettle?.maxRequeries, 1);
  assert((observedSettle?.untilMonotonicMs ?? Infinity) <= deadline);
  const abort = new AbortController();
  const pending = waitForOwnedDetoxChildStartup(
    delayedChild,
    performance.now() + 5_000,
    abort.signal,
  );
  setTimeout(() => abort.abort(new Error('injected startup abort')), 10);
  await assert.rejects(pending, /abort|startup abort/i);
});

void test('V22 rejects a startup census that contains no member of the owned process group', async () => {
  const foreignChild = {
    pid: 4242,
    pgid: 4242,
    outcome: () => ({ code: null, signal: null }),
    capture: () =>
      Promise.resolve([{ pid: 4343, pgid: 4343, started: 'started', commandHash: 'b'.repeat(64) }]),
  } as never;
  await assert.rejects(
    waitForOwnedDetoxChildStartup(
      foreignChild,
      performance.now() + 5_000,
      new AbortController().signal,
    ),
    /process group disappeared/,
  );
});

void test('V23 rejects duplicate bootstrap attempts at both IPC and child boundaries', async () => {
  const guard = createDetoxCameraBootstrapGuard();
  assert.doesNotThrow(() => guard.claim());
  assert.throws(() => guard.claim(), /bootstrap was already requested/);
  const ipc = await readFile(
    path.join(__dirname, '../../scripts/testing/native-detox-camera-ios-ipc.ts'),
    'utf8',
  );
  const child = await readFile(
    path.join(__dirname, '../../e2e/detox-ios-camera-route.e2e.test.js'),
    'utf8',
  );
  assert.match(ipc, /command\.kind === 'bootstrap'\) this\.#bootstrapGuard\.claim\(\)/);
  assert.match(ipc, /createDetoxCameraBootstrapGuard/);
  assert.match(
    child,
    /if \(bootstrapSeen\) throw new Error\('Detox camera bootstrap was already handled'\)/,
  );
  assert.match(child, /bootstrapSeen = true;\s*await launchFresh\(\)/);
});

void test('V22 strict child stop refuses to signal after its original census deadline', async () => {
  const root = await privateRoot('mc-ios-detox-v22-stop-deadline-');
  let child: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  try {
    child = await startOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', 'setTimeout(() => {}, 200);'],
      artifactRoot: root,
      label: 'v22-stop-deadline',
      env: process.env,
      phase: 'step',
    });
    const signal = new AbortController().signal;
    await assert.rejects(
      child.stop({
        untilMonotonicMs: performance.now() + 1,
        signal,
        maxRequeries: 1,
        delayMs: 1,
      }),
      /deadline/,
    );
    assert.equal(child.outcome().code, null);
    await child.closed;
  } finally {
    await child?.closed.catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
