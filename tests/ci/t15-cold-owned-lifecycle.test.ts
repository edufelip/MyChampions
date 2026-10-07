import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { stageIosCameraSubmissionEvidence } from '../../scripts/testing/native-camera-submission-evidence';
import { stageNativeConnectionPublicEvidence } from '../../scripts/testing/native-connection-public-evidence';
import { stageNativeSaveRetryPublicEvidence } from '../../scripts/testing/native-save-retry-public-evidence';
import {
  createT15OwnedPublicConsumer,
  stageCameraForColdConsumer,
  createT15OwnedLifecycleProducer,
  type T15OwnedLifecycleProducerOptions,
} from '../../scripts/testing/t15-cold-owned-lifecycle';
import type {
  OwnedIosNativeSessionOptions,
  OwnedIosNativeSessionResult,
} from '../../scripts/testing/capture-native-testability';
import type {
  NativeComparisonAttemptExpectation,
  NativeComparisonReceiptInput,
} from '../../scripts/testing/compare-native-pilot';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';
import type { ColdComparisonOwnedAttemptInvocation } from '../../scripts/testing/t15-cold-dispatcher';

const HASH = 'a'.repeat(64);
const RUN_ID = '0123456789abcdef01234567';

function sha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function identity(stat: Awaited<ReturnType<typeof lstat>>) {
  return {
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
}

function expected(runId = RUN_ID): NativeComparisonAttemptExpectation {
  return {
    runId,
    trialOrdinal: 1,
    attemptId: runId + ':first',
    locale: 'en-US',
    cohortId: 't15-source-cohort',
    fixtureResetId: runId + ':reset',
    repositories: [],
    target: {
      deviceId: 'SIM-OWNER',
      osVersion: 'iOS-26.5',
      appId: 'com.edufelip.mychampions.dev',
      buildProfile: 'debug',
      binaryHash: HASH,
      apiOrigin: 'http://127.0.0.1:43123',
    },
    inputs: {
      scenarioHash: HASH,
      requirementHash: HASH,
      fixtureHash: HASH,
      flagsHash: HASH,
      toolVersions: { maestro: '2.6.1' },
    },
    coldAttemptIdentity: {
      ownerRunId: runId,
      processPid: null,
      processStartIdentity: null,
      ownedPorts: [],
      ownershipWindows: [],
      originalReceiptBinding: {
        status: 'pending',
        receiptPath: null,
        artifactRoot: null,
        receiptHash: null,
      },
    },
  };
}

function selection(platform: 'ios' | 'android' = 'ios'): NativePilotSelection {
  return {
    arguments: {
      platform,
      engine: 'maestro',
      scenario: 'SCN-training-' + platform,
      mode: 'integration',
    },
    scenarioHash: HASH,
    requirementHash: HASH,
    scenario: {
      id: 'SCN-training-' + platform,
      platform,
      flowId: 'FLW-training',
      transitionIds: [],
      requirementRefs: [],
      dataMode: 'postgres',
      fixtureRef: 'owned-postgres:training',
      freshnessInputs: { requirementPaths: [] },
      pilotAssertions: [],
    },
  };
}

function cameraSelection(): NativePilotSelection {
  const base = selection();
  return {
    ...base,
    arguments: { ...base.arguments, scenario: 'SCN-camera-denied-ios' },
    scenario: { ...base.scenario, id: 'SCN-camera-denied-ios', flowId: 'FLW-camera-denied' },
  };
}

function invocation(item = expected()): ColdComparisonOwnedAttemptInvocation {
  return {
    spec: {
      schemaVersion: 1,
      scope: 'full',
      attemptsPerCell: 20,
      cohort: {
        id: 't15-source-cohort',
        sourceFingerprint: HASH,
        fixtureResetFingerprint: HASH,
        flagsFingerprint: HASH,
        instrumentationOnlyDifferences: [],
      },
      cells: [],
      executionOrder: [],
    },
    expected: item,
    selection: selection(),
    signal: new AbortController().signal,
    reusableBuild: {
      platform: 'ios',
      buildId: 'b'.repeat(24),
      buildProfile: 'debug',
      sourceFingerprint: HASH,
      helperFingerprint: HASH,
      flagsFingerprint: HASH,
      binaryHash: HASH,
      current: true,
    },
    deadlineAtMonotonicMs: performance.now() + 600_000,
    terminalize: () => {
      throw new Error('terminalize is not used by the owned lifecycle');
    },
  };
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 't15-owned-lifecycle-'));
  await chmod(root, 0o700);
  return root;
}

async function fixtureRun(
  root: string,
  input: ColdComparisonOwnedAttemptInvocation,
  flags: { foreignTarget?: boolean; omitWindows?: boolean } = {},
  ownedOptions?: OwnedIosNativeSessionOptions,
): Promise<OwnedIosNativeSessionResult> {
  const attemptRoot = root;
  await mkdir(attemptRoot, { recursive: true, mode: 0o700 });
  const attemptStat = await lstat(attemptRoot);
  const now = Date.now();
  const startedAt = new Date(now - 5_000).toISOString();
  const resetFinishedAt = new Date(now - 4_000).toISOString();
  const commandStartedAt = new Date(now - 3_000).toISOString();
  const commandReleasedAt = new Date(now - 1_000).toISOString();
  const finishedAt = new Date(now + 5_000).toISOString();
  const resetBody = Buffer.from(
    JSON.stringify({ kind: 'reset-original', runId: input.expected.runId }),
  );
  await writeFile(path.join(attemptRoot, 'reset-original.private.json'), resetBody, {
    mode: 0o600,
    flag: 'wx',
  });
  const resetStat = await lstat(path.join(attemptRoot, 'reset-original.private.json'));
  const target = {
    platform: 'ios',
    deviceId: flags.foreignTarget ? 'FOREIGN' : 'SIM-OWNER',
    osVersion: 'iOS-26.5',
    appId: 'com.edufelip.mychampions.dev',
    binaryHash: HASH,
    apiOrigin: 'http://127.0.0.1:43123',
    ownerRunId: input.expected.runId,
    captureRunId: input.expected.runId,
  };
  const backend = {
    runId: input.expected.runId,
    ownerRunId: input.expected.runId,
    captureRunId: input.expected.runId,
    apiOrigin: 'http://127.0.0.1:43124',
  };
  const rawReset = {
    requestedRunId: input.expected.runId,
    requestedAttemptId: input.expected.attemptId,
    fixtureResetId: input.expected.fixtureResetId,
    ownerRunId: input.expected.runId,
    cohortFixtureFingerprint: HASH,
    status: 'fresh',
    startedAt,
    finishedAt: resetFinishedAt,
    appStateFingerprint: HASH,
    fixtureStateFingerprint: HASH,
    sourceFingerprint: HASH,
    helperFingerprint: HASH,
    blocker: null,
    target,
    backend,
    originalResetBinding: {
      status: 'verified',
      receiptPath: path.join(attemptRoot, 'reset-original.private.json'),
      artifactRoot: attemptRoot,
      receiptHash: sha(resetBody),
      identity: identity(resetStat),
    },
  };
  const report: Record<string, unknown> = {
    startedAt,
    finishedAt,
    captureRunId: input.expected.runId,
    cleanup: 'cleaned',
    result: 'passed',
    callerOutputRootBinding: {
      requestedRunId: input.expected.runId,
      captureRunId: input.expected.runId,
      binding: {
        path: attemptRoot,
        identity: {
          dev: attemptStat.dev,
          ino: attemptStat.ino,
          uid: attemptStat.uid,
          mode: attemptStat.mode & 0o777,
          nlink: attemptStat.nlink,
        },
      },
    },
    reservedPorts: [43123],
    backend,
    coldReset: rawReset,
  };
  if (ownedOptions?.executeTraining)
    await ownedOptions.executeTraining(
      {} as Parameters<NonNullable<typeof ownedOptions.executeTraining>>[0],
    );
  if (!flags.omitWindows) {
    report.ownershipWindows = [
      {
        resourceType: 'process',
        resourceId: '2345',
        ownerRunId: input.expected.runId,
        processStartIdentity: 'proc-start-1',
        acquiredAt: commandStartedAt,
        releasedAt: commandReleasedAt,
      },
      {
        resourceType: 'port',
        resourceId: '43123',
        ownerRunId: input.expected.runId,
        processStartIdentity: null,
        acquiredAt: commandStartedAt,
        releasedAt: commandReleasedAt,
      },
    ];
  }
  const ownershipPath = path.join(attemptRoot, 'training-scenario.ownership.json');
  await writeFile(
    ownershipPath,
    JSON.stringify({
      kind: 'private worker process ownership',
      pid: 2345,
      pgid: 2345,
      cleanup: 'cleaned',
      processes: [{ pid: 2345, pgid: 2345, started: commandStartedAt, commandHash: HASH }],
    }),
    { mode: 0o600, flag: 'wx' },
  );
  report.commandExecutions = flags.omitWindows
    ? []
    : [
        {
          label: 'training-scenario',
          execution: 'completed',
          cleanup: 'cleaned',
          pid: 2345,
          pgid: 2345,
          ownershipPath,
        },
      ];
  await writeFile(path.join(attemptRoot, 'capture.private.json'), JSON.stringify(report), {
    mode: 0o600,
    flag: 'wx',
  });
  return { artifactRoot: attemptRoot, exitCode: 0, report };
}

function options(root: string, mutate: 'clean' | 'foreign' | 'missing-windows' = 'clean') {
  const input: ColdComparisonOwnedAttemptInvocation = invocation();
  const producerOptions: T15OwnedLifecycleProducerOptions = {
    repositoryRoot: '/private/tmp/current-q',
    outputRoot: root,
    scenario: () => ({
      charter: 'training-journey',
      executeTraining: () => Promise.resolve(),
    }),
    runOwned: async (ownedOptions) =>
      fixtureRun(
        String(ownedOptions.callerOutputRoot),
        input,
        mutate === 'foreign'
          ? { foreignTarget: true }
          : mutate === 'missing-windows'
            ? { omitWindows: true }
            : {},
        ownedOptions,
      ),
  };
  return { producerOptions, input };
}

async function publicConsumer(
  root: string,
  input: ColdComparisonOwnedAttemptInvocation,
  backendRunId = input.expected.runId,
): Promise<NativeComparisonReceiptInput> {
  const artifactRoot = root;
  const row = {
    result: 'passed',
    runId: input.expected.runId,
    attemptId: input.expected.attemptId,
    captureRunId: input.expected.runId,
    ownerRunId: input.expected.runId,
    backendRunId,
  };
  const bytes = Buffer.from(JSON.stringify(row) + '\n');
  const receiptPath = path.join(artifactRoot, 'receipt.json');
  await writeFile(receiptPath, bytes, { mode: 0o600, flag: 'wx' });
  return {
    path: receiptPath,
    artifactRoot,
    receipt: row,
    receiptHash: sha(bytes),
  };
}

void test('one owned lifecycle consumes public receipt only after clean original evidence', async () => {
  const root = await makeRoot();
  try {
    const pair = options(root);
    pair.producerOptions.consumePublic = ({ lifecycle }) =>
      publicConsumer(lifecycle.artifactRoot, pair.input).then((receipt) => {
        assert.equal(lifecycle.report.cleanup, 'cleaned');
        return receipt;
      });
    const result = await createT15OwnedLifecycleProducer(pair.producerOptions)(pair.input);
    assert.equal(result.status, 'received');
    assert.equal(result.lifecycleStage, 'public-consumption');
    assert.equal(result.failure, null);
    assert.equal(result.coldAttemptIdentity.processPid, 2345);
    assert.equal(result.coldAttemptIdentity.ownerRunId, RUN_ID);
    assert.equal(
      result.coldAttemptIdentity.originalReceiptBinding.receiptPath,
      path.join(await realpath(root), RUN_ID, 'receipt.json'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('clean reset with a foreign target is blocked before public consumption', async () => {
  const root = await makeRoot();
  try {
    const pair = options(root, 'foreign');
    let consumed = false;
    pair.producerOptions.consumePublic = () => {
      consumed = true;
      return Promise.resolve(null);
    };
    const result = await createT15OwnedLifecycleProducer(pair.producerOptions)(pair.input);
    assert.equal(result.status, 'harness-blocked');
    assert.match(result.issue ?? '', /reset-not-bound/);
    assert.equal(consumed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('clean reset without closed ownership windows remains blocked', async () => {
  const root = await makeRoot();
  try {
    const pair = options(root, 'missing-windows');
    pair.producerOptions.consumePublic = () => Promise.reject(new Error('must not consume'));
    const result = await createT15OwnedLifecycleProducer(pair.producerOptions)(pair.input);
    assert.equal(result.status, 'harness-blocked');
    assert.match(result.issue ?? '', /ownership-windows/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('public consumption rejects a receipt rebound to a new backend after cleanup', async () => {
  const root = await makeRoot();
  try {
    const pair = options(root);
    pair.producerOptions.consumePublic = ({ lifecycle }) =>
      publicConsumer(lifecycle.artifactRoot, pair.input, 'foreign-backend');
    const result = await createT15OwnedLifecycleProducer(pair.producerOptions)(pair.input);
    assert.equal(result.status, 'harness-blocked');
    assert.match(result.issue ?? '', /public-consumer-mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('clean owned lifecycle without a public consumer stays blocked after cleanup', async () => {
  const root = await makeRoot();
  try {
    const pair = options(root);
    const result = await createT15OwnedLifecycleProducer(pair.producerOptions)(pair.input);
    assert.equal(result.status, 'harness-blocked');
    assert.equal(result.failure, 'public-consumer-unwired');
    assert.equal(result.lifecycleStage, 'cleanup');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('the default public consumer refuses a lifecycle without an actual runtime adapter', async () => {
  const root = await makeRoot();
  try {
    const pair = options(root);
    pair.producerOptions.consumePublic = createT15OwnedPublicConsumer({
      repositoryRoot: '/private/tmp/current-q',
    });
    const result = await createT15OwnedLifecycleProducer(pair.producerOptions)(pair.input);
    assert.equal(result.status, 'harness-blocked');
    assert.equal(result.failure, 'public-consumer-unwired');
    assert.match(result.issue ?? '', /public-consumer-returned-no-receipt/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('post-acquisition cancellation retains the owned reset and ownership row', async () => {
  const root = await makeRoot();
  const controller = new AbortController();
  try {
    const pair = options(root);
    pair.input = { ...pair.input, signal: controller.signal };
    pair.producerOptions.runOwned = async (ownedOptions) => {
      const result = await fixtureRun(
        String(ownedOptions.callerOutputRoot),
        pair.input,
        {},
        ownedOptions,
      );
      controller.abort();
      return result;
    };
    const result = await createT15OwnedLifecycleProducer(pair.producerOptions)(pair.input);
    assert.equal(result.status, 'cancelled');
    assert.equal(result.failure, 'cancelled-after-lifecycle');
    assert.equal(result.lifecycleStage, 'cleanup');
    assert.equal(result.coldAttemptIdentity.processPid, 2345);
    assert.equal(result.reset.status, 'fresh');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('caller absolute deadline is forwarded without renewal', async () => {
  const root = await makeRoot();
  try {
    const pair = options(root);
    const absoluteDeadline = performance.now() + 5_000;
    pair.input = { ...pair.input, deadlineAtMonotonicMs: absoluteDeadline };
    let observedDeadline: number | undefined;
    pair.producerOptions.runOwned = async (ownedOptions) => {
      observedDeadline = ownedOptions.deadlineAtMonotonicMs;
      return fixtureRun(String(ownedOptions.callerOutputRoot), pair.input, {}, ownedOptions);
    };
    pair.producerOptions.consumePublic = ({ lifecycle }) =>
      publicConsumer(lifecycle.artifactRoot, pair.input);
    const result = await createT15OwnedLifecycleProducer(pair.producerOptions)(pair.input);
    assert.equal(result.status, 'received');
    assert.equal(observedDeadline, absoluteDeadline);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('unqualified build keeps the cohort reset binding distinct from attempt fixture inputs', async () => {
  const root = await makeRoot();
  try {
    const pair = options(root);
    const cohortFingerprint = 'b'.repeat(64);
    pair.input = {
      ...pair.input,
      reusableBuild: null,
      spec: {
        ...pair.input.spec,
        cohort: {
          ...pair.input.spec.cohort,
          fixtureResetFingerprint: cohortFingerprint,
        },
      },
    };
    let ownedCalls = 0;
    pair.producerOptions.runOwned = () => {
      ownedCalls += 1;
      return Promise.reject(new Error('unqualified build must not acquire'));
    };
    const result = await createT15OwnedLifecycleProducer(pair.producerOptions)(pair.input);
    assert.notEqual(pair.input.expected.inputs.fixtureHash, cohortFingerprint);
    assert.equal(result.status, 'harness-blocked');
    assert.equal(result.issue, 'build-reuse-unqualified');
    assert.equal(result.reset.cohortFixtureFingerprint, cohortFingerprint);
    assert.equal(result.reset.ownerRunId, pair.input.expected.runId);
    assert.equal(result.reset.fixtureResetId, pair.input.expected.fixtureResetId);
    assert.equal(result.reset.cleanupStatus, 'not-acquired');
    assert.equal(result.reset.originalResetBinding.status, 'pending');
    assert.equal(result.receipt, null);
    assert.equal(ownedCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('unsupported Android cells remain explicit blocked rows without an owned lifecycle', async () => {
  const root = await makeRoot();
  try {
    const pair = options(root);
    pair.input = { ...pair.input, selection: selection('android') };
    let owned = false;
    pair.producerOptions.runOwned = () => {
      owned = true;
      return Promise.reject(new Error('unsupported Android must not acquire'));
    };
    const result = await createT15OwnedLifecycleProducer(pair.producerOptions)(pair.input);
    assert.equal(result.status, 'harness-blocked');
    assert.match(result.issue ?? '', /unsupported-platform/);
    assert.equal(owned, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('connection/save/camera staging observes the caller lifecycle before filesystem access', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    stageNativeConnectionPublicEvidence({
      repositoryRoot: '/private/tmp/absent',
      captureRoot: '/private/tmp/absent-capture',
      outputRoot: '/private/tmp/absent-output',
      requestedRunId: RUN_ID,
      fixtureRunId: RUN_ID,
      selection: selection(),
      bindings: [],
      lifecycle: { signal: controller.signal, deadlineAtMs: performance.now() + 5_000 },
    }),
    /aborted/i,
  );
  await assert.rejects(
    stageNativeSaveRetryPublicEvidence({
      repositoryRoot: '/private/tmp/absent',
      captureRoot: '/private/tmp/absent-capture',
      outputRoot: '/private/tmp/absent-output',
      requestedRunId: RUN_ID,
      fixtureRunId: RUN_ID,
      selection: selection(),
      bindings: [],
      lifecycle: { signal: new AbortController().signal, deadlineAtMs: performance.now() - 1 },
    }),
    /deadline expired/i,
  );
  await assert.rejects(
    stageIosCameraSubmissionEvidence({
      captureRoot: '/private/tmp/absent-capture',
      outputRoot: '/private/tmp/absent-output',
      captureRunId: RUN_ID,
      requestedRunId: RUN_ID,
      fixtureRunId: RUN_ID,
      targetOrigin: 'http://127.0.0.1:43123',
      preparation: {},
      transport: [],
      lifecycle: { signal: new AbortController().signal, deadlineAtMs: performance.now() - 1 },
    }),
    /deadline expired/i,
  );
});

void test('camera outer consumer fences before protected pre-read', async () => {
  await assert.rejects(
    stageCameraForColdConsumer({
      captureRoot: '/private/tmp/absent-camera-capture',
      outputRoot: '/private/tmp/absent-camera-output',
      expected: expected(),
      selection: cameraSelection(),
      fixtureRunId: RUN_ID,
      captureRunId: RUN_ID,
      lifecycle: { signal: new AbortController().signal, deadlineAtMs: performance.now() - 1 },
    }),
    /public-consumer-deadline/i,
  );
});

void test('actual camera stage mismatch publishes a blocked receipt after lifecycle binding', async () => {
  const root = await makeRoot();
  try {
    const pair = options(root);
    pair.input = { ...pair.input, selection: cameraSelection() };
    pair.producerOptions.consumePublic = createT15OwnedPublicConsumer({
      repositoryRoot: '/private/tmp/current-q',
    });
    pair.producerOptions.runOwned = async (ownedOptions) => {
      const lifecycle = await fixtureRun(
        String(ownedOptions.callerOutputRoot),
        pair.input,
        {},
        ownedOptions,
      );
      const adapter = {
        requestedRunId: pair.input.expected.runId,
        requestedAttemptId: pair.input.expected.attemptId,
        captureRunId: pair.input.expected.runId,
        fixtureRunId: pair.input.expected.runId,
        callbackInvocations: 1,
        callbackCompleted: true,
        externalCleanupResult: 'passed',
        verificationResult: 'passed',
        captureResult: 'observed',
        captureCleanup: 'cleaned',
        nativePassingCases: 0,
        postCaptureFailure: null,
        censusFailures: [],
        outputFailures: [],
        assertionIds: ['SC-222'],
      };
      await writeFile(
        path.join(lifecycle.artifactRoot, 'camera-runtime-adapter.private.json'),
        JSON.stringify(adapter),
        { mode: 0o600, flag: 'wx' },
      );
      await writeFile(
        path.join(lifecycle.artifactRoot, 'camera-runtime-metadata.private.json'),
        JSON.stringify({
          requestedRunId: 'foreign-run',
          captureRunId: pair.input.expected.runId,
          backendRunId: pair.input.expected.runId,
        }),
        { mode: 0o600, flag: 'wx' },
      );
      return lifecycle;
    };
    const result = await createT15OwnedLifecycleProducer(pair.producerOptions)(pair.input);
    assert.equal(result.status, 'harness-blocked');
    assert.ok(result.receipt);
    const blockedReceipt = result.receipt.receipt as Record<string, unknown>;
    assert.equal(blockedReceipt.result, 'harness-blocked');
    assert.match(String(blockedReceipt.blocker), /camera-metadata/);
    assert.equal(result.failure, 'public-consumer-mismatch');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
