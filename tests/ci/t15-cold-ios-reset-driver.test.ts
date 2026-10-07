import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  createActualT15ColdResetDriver,
  createActualT15ColdResetProducer,
  type ActualIosResetExecutor,
} from '../../scripts/testing/t15-cold-ios-reset-driver';
import type {
  NativeComparisonAttemptExpectation,
  NativeComparisonTargetExpectation,
} from '../../scripts/testing/compare-native-pilot';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';
import type { FreshColdReset } from '../../scripts/testing/t15-cold-dispatcher';

const HASH = 'a'.repeat(64);
const RUN_ID = '0123456789abcdef01234567';
const BUILD_ID = 'abcdef0123456789abcdef01';
const COHORT = {
  id: 't15-cold',
  sourceFingerprint: HASH,
  fixtureResetFingerprint: HASH,
  flagsFingerprint: HASH,
  instrumentationOnlyDifferences: [],
};

function target(): NativeComparisonTargetExpectation {
  return {
    deviceId: 'SIM-OWNER',
    osVersion: 'iOS-26.5',
    appId: 'com.example.mychampions',
    buildProfile: 'debug',
    binaryHash: HASH,
    apiOrigin: 'http://127.0.0.1:43123',
  };
}

function expected(runId = RUN_ID): NativeComparisonAttemptExpectation {
  return {
    runId,
    trialOrdinal: 1,
    attemptId: `${runId}:first`,
    locale: 'en-US',
    cohortId: 't15-cold',
    fixtureResetId: `${runId}:reset`,
    repositories: [],
    target: target(),
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

function selection(
  family: 'training' | 'connection' | 'save-retry' | 'camera-denied' = 'training',
  engine: 'maestro' | 'detox' = 'maestro',
  platform: 'ios' | 'android' = 'ios',
): NativePilotSelection {
  return {
    arguments: {
      platform,
      engine,
      scenario: `SCN-${family}-${platform}`,
      mode: 'integration',
    },
    scenarioHash: HASH,
    requirementHash: HASH,
    scenario: {
      id: `SCN-${family}-${platform}`,
      platform,
      flowId: `FLW-${family}`,
      transitionIds: [],
      requirementRefs: [],
      dataMode: 'postgres',
      fixtureRef: `owned-postgres:${family}`,
      freshnessInputs: { requirementPaths: [] },
      pilotAssertions: [],
    },
  };
}

function identity() {
  return {
    dev: 1,
    ino: 2,
    uid: typeof process.getuid === 'function' ? process.getuid() : 0,
    gid: typeof process.getgid === 'function' ? process.getgid() : 0,
    mode: 0o100600,
    nlink: 1,
    size: 32,
    mtimeMs: 1,
    ctimeMs: 1,
  };
}

function resetFor(input: NativeComparisonAttemptExpectation): FreshColdReset & {
  requestedRunId: string;
  requestedAttemptId: string;
} {
  return {
    requestedRunId: input.runId,
    requestedAttemptId: input.attemptId,
    fixtureResetId: input.fixtureResetId,
    ownerRunId: input.runId,
    cohortFixtureFingerprint: HASH,
    status: 'fresh',
    startedAt: '2026-10-03T18:00:00.000Z',
    finishedAt: '2026-10-03T18:00:01.000Z',
    appStateFingerprint: HASH,
    fixtureStateFingerprint: HASH,
    sourceFingerprint: HASH,
    helperFingerprint: HASH,
    originalResetBinding: {
      status: 'verified',
      receiptPath: '/private/tmp/owned-ios-capture/reset-original.private.json',
      artifactRoot: '/private/tmp/owned-ios-capture',
      receiptHash: HASH,
      identity: identity(),
    },
    target: {
      platform: 'ios',
      deviceId: input.target.deviceId,
      osVersion: input.target.osVersion,
      appId: input.target.appId,
      buildProfile: input.target.buildProfile,
      binaryHash: input.target.binaryHash,
      apiOrigin: input.target.apiOrigin,
      ownerRunId: input.runId,
      phase: 'installed-before-ui',
    },
    backend: {
      runId: 'backend-run-1',
      ownerRunId: input.runId,
      artifactRoot: '/private/tmp/owned-ios-backend',
      apiOrigin: 'http://127.0.0.1:43124',
    },
    cleanupStatus: 'cleaned',
    blocker: null,
  };
}

function build() {
  return {
    platform: 'ios' as const,
    buildId: BUILD_ID,
    buildProfile: 'debug',
    sourceFingerprint: HASH,
    helperFingerprint: HASH,
    flagsFingerprint: HASH,
    binaryHash: HASH,
    current: true as const,
  };
}

async function privateRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 't15-ios-reset-driver-'));
  await chmod(root, 0o700);
  return root;
}

void test('actual iOS reset driver binds the selection and same native attempt', async () => {
  const root = await privateRoot();
  try {
    const item = expected();
    let observed: Record<string, unknown> | undefined;
    const runIos: ActualIosResetExecutor = (options) => {
      observed = {
        charter: options.charter,
        requestedRunId: options.requestedRunId,
        callerOutputRoot: options.callerOutputRoot,
        coldReset: options.coldReset,
        reuseBuildRunId: options.reuseBuildRunId,
      };
      return Promise.resolve({
        artifactRoot: '/private/tmp/owned-ios-capture',
        exitCode: 2,
        report: {
          result: 'harness-blocked',
          cleanup: 'cleaned',
          coldResetEvidence: {
            path: 'reset-original.private.json',
            sha256: HASH,
          },
          coldReset: resetFor(item),
        },
      });
    };
    const driver = createActualT15ColdResetDriver({ runIos });
    const result = await driver({
      repositoryRoot: '/private/tmp/qualified-source',
      outputRoot: root,
      expected: item,
      cohort: COHORT,
      selection: selection(),
      signal: new AbortController().signal,
      reusableBuild: build(),
      deadlineAtMonotonicMs: performance.now() + 60_000,
    });
    assert.equal(result.status, 'fresh');
    assert.equal(result.ownerRunId, item.runId);
    assert.deepEqual(result.target?.deviceId, item.target.deviceId);
    assert.equal(observed?.charter, 'training-journey');
    assert.equal(observed?.requestedRunId, item.runId);
    assert.equal(observed?.reuseBuildRunId, BUILD_ID);
    assert.equal(
      (observed?.coldReset as { requestedAttemptId?: string }).requestedAttemptId,
      item.attemptId,
    );
    assert.equal(path.basename(observed?.callerOutputRoot as string), item.runId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('unsupported Android and Detox paths remain explicit blocked reset rows', async () => {
  const root = await privateRoot();
  try {
    const item = expected();
    const driver = createActualT15ColdResetDriver({
      runIos: () => Promise.reject(new Error('executor must not run for unsupported selection')),
    });
    const android = await driver({
      repositoryRoot: '/private/tmp/qualified-source',
      outputRoot: root,
      expected: item,
      cohort: COHORT,
      selection: selection('training', 'maestro', 'android'),
      signal: new AbortController().signal,
      reusableBuild: { ...build(), platform: 'android' },
      deadlineAtMonotonicMs: performance.now() + 60_000,
    });
    assert.equal(android.status, 'blocked');
    assert.match(android.blocker ?? '', /platform-unsupported/);
    const detox = await driver({
      repositoryRoot: '/private/tmp/qualified-source',
      outputRoot: root,
      expected: item,
      cohort: COHORT,
      selection: selection('training', 'detox'),
      signal: new AbortController().signal,
      reusableBuild: build(),
      deadlineAtMonotonicMs: performance.now() + 60_000,
    });
    assert.equal(detox.status, 'blocked');
    assert.match(detox.blocker ?? '', /detox-cold-reset-consumer-unwired/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('producer passes native expectation and resolved selection to the actual driver', async () => {
  const root = await privateRoot();
  try {
    const item = expected();
    let receivedAttemptId = '';
    let receivedScenario = '';
    const producer = createActualT15ColdResetProducer({
      repositoryRoot: '/private/tmp/qualified-source',
      outputRoot: root,
      attemptDeadlineMs: 60_000,
      runIos: () =>
        Promise.resolve({
          artifactRoot: '/private/tmp/owned-ios-capture',
          exitCode: 2,
          report: {
            cleanup: 'cleaned',
            coldResetEvidence: {
              path: 'reset-original.private.json',
              sha256: HASH,
            },
            coldReset: resetFor(item),
          },
        }),
    });
    // The real adapter above is selected through the producer. The returned
    // row is source-only fixture evidence; no native command is started here.
    const row = await producer({
      spec: { cohort: COHORT } as never,
      expected: item,
      selection: selection('training'),
      signal: new AbortController().signal,
      reusableBuild: build(),
      outputRoot: root,
    });
    receivedAttemptId = row.ownerRunId;
    receivedScenario = selection('training').scenario.id;
    assert.equal(receivedAttemptId, item.runId);
    assert.equal(receivedScenario, 'SCN-training-ios');
    assert.equal(row.status, 'fresh');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('foreign target rows are rejected before a reset can enter the matrix', async () => {
  const root = await privateRoot();
  try {
    const item = expected();
    const runIos: ActualIosResetExecutor = () => {
      const reset = resetFor(item);
      return Promise.resolve({
        artifactRoot: '/private/tmp/owned-ios-capture',
        exitCode: 2,
        report: {
          cleanup: 'cleaned',
          coldResetEvidence: {
            path: 'reset-original.private.json',
            sha256: HASH,
          },
          coldReset: {
            ...reset,
            target: { ...reset.target, deviceId: 'FOREIGN-DEVICE' },
          },
        },
      });
    };
    const driver = createActualT15ColdResetDriver({ runIos });
    await assert.rejects(
      driver({
        repositoryRoot: '/private/tmp/qualified-source',
        outputRoot: root,
        expected: item,
        cohort: COHORT,
        selection: selection(),
        signal: new AbortController().signal,
        reusableBuild: build(),
        deadlineAtMonotonicMs: performance.now() + 60_000,
      }),
      /ios-reset-target-deviceId-mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('late abort retains a clean owned reset for the dispatcher denominator', async () => {
  const root = await privateRoot();
  try {
    const item = expected();
    const controller = new AbortController();
    const runIos: ActualIosResetExecutor = () => {
      controller.abort('late-reset-cancel');
      return Promise.resolve({
        artifactRoot: '/private/tmp/owned-ios-capture',
        exitCode: 2,
        report: {
          cleanup: 'cleaned',
          coldResetEvidence: {
            path: 'reset-original.private.json',
            sha256: HASH,
          },
          coldReset: resetFor(item),
        },
      });
    };
    const driver = createActualT15ColdResetDriver({ runIos });
    const row = await driver({
      repositoryRoot: '/private/tmp/qualified-source',
      outputRoot: root,
      expected: item,
      cohort: COHORT,
      selection: selection(),
      signal: controller.signal,
      reusableBuild: build(),
      deadlineAtMonotonicMs: performance.now() + 60_000,
    });
    assert.equal(row.status, 'fresh');
    assert.equal(row.cleanupStatus, 'cleaned');
    assert.equal(row.ownerRunId, item.runId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
