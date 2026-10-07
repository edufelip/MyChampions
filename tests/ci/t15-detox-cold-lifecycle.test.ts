import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  createT15DetoxSharedLifecycleProducer,
  createT15DetoxSharedResetProducer,
  requireT15DetoxSharedRoute,
  T15_DETOX_SHARED_ROUTE_KEYS,
  type T15DetoxOwnedLifecycle,
} from '../../scripts/testing/t15-detox-cold-lifecycle';
import type {
  NativeComparisonAttemptExpectation,
  NativeComparisonColdAttemptIdentity,
  NativeComparisonOwnershipWindow,
} from '../../scripts/testing/compare-native-pilot';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';
import type { FreshColdReset } from '../../scripts/testing/t15-cold-dispatcher';

const HASH = 'a'.repeat(64);
const RUN_ID = 'b'.repeat(24);
const CAPTURE_ID = 'c'.repeat(24);
const ATTEMPT_ID = `${RUN_ID}:first`;
const RESET_ID = 'fixture-reset-session-ios-detox-01';
const receiptIdentity = {
  dev: 1,
  ino: 2,
  uid: 501,
  gid: 20,
  mode: 0o600,
  nlink: 1,
  size: 128,
  mtimeMs: 1,
  ctimeMs: 1,
};

function windows(): readonly NativeComparisonOwnershipWindow[] {
  return [
    {
      resourceType: 'process',
      resourceId: '1234',
      ownerRunId: RUN_ID,
      processStartIdentity: '2026-10-05T12:00:00.000Z:process',
      acquiredAt: '2026-10-05T12:00:00.000Z',
      releasedAt: '2026-10-05T12:00:10.000Z',
    },
    {
      resourceType: 'port',
      resourceId: '43111',
      ownerRunId: RUN_ID,
      processStartIdentity: null,
      acquiredAt: '2026-10-05T12:00:00.100Z',
      releasedAt: '2026-10-05T12:00:10.000Z',
    },
  ];
}

function target() {
  return {
    platform: 'ios',
    deviceId: 'simulator-01',
    osVersion: 'iOS 18.0',
    appId: 'com.example.app',
    buildProfile: 'ios.sim.debug',
    binaryHash: HASH,
    apiOrigin: 'http://127.0.0.1:43112',
    captureRunId: CAPTURE_ID,
    ownerRunId: RUN_ID,
    phase: 'installed-before-ui',
  };
}

function backend() {
  return {
    runId: RUN_ID,
    ownerRunId: RUN_ID,
    captureRunId: CAPTURE_ID,
    artifactRoot: '/private/t15/backend',
    apiOrigin: 'http://127.0.0.1:43113',
    apiPid: 1235,
    apiStarted: '2026-10-05T11:59:00.000Z',
    apiScript: 'server/dist/index.js',
    backendAttemptId: ATTEMPT_ID,
    manifestSha256: HASH,
  };
}

function binding(name: string, hashValue: string) {
  return {
    status: 'verified' as const,
    receiptPath: `/private/t15/capture/${name}`,
    artifactRoot: '/private/t15/capture',
    receiptHash: hashValue,
    identity: receiptIdentity,
  };
}

function expected(): NativeComparisonAttemptExpectation {
  return {
    runId: RUN_ID,
    trialOrdinal: 1,
    attemptId: ATTEMPT_ID,
    locale: 'en-US',
    cohortId: 't15',
    fixtureResetId: RESET_ID,
    repositories: [],
    target: {
      deviceId: 'simulator-01',
      osVersion: 'iOS 18.0',
      appId: 'com.example.app',
      buildProfile: 'ios.sim.debug',
      binaryHash: HASH,
      apiOrigin: 'http://127.0.0.1:43112',
    },
    inputs: {
      scenarioHash: HASH,
      requirementHash: HASH,
      fixtureHash: HASH,
      flagsHash: HASH,
      toolVersions: { node: '22' },
    },
    coldAttemptIdentity: {} as NativeComparisonColdAttemptIdentity,
  };
}

function selection(): NativePilotSelection {
  return {
    arguments: {
      platform: 'ios',
      engine: 'detox',
      scenario: 'SCN-session-ios',
      mode: 'integration',
    },
    scenarioHash: HASH,
    requirementHash: HASH,
    scenario: {
      id: 'SCN-session-ios',
      platform: 'ios',
      flowId: 'FLW-session',
      transitionIds: [],
      requirementRefs: [],
      dataMode: 'postgres',
      fixtureRef: 'owned-postgres:SCN-session-ios:fresh-attempt',
      freshnessInputs: { requirementPaths: [] },
      pilotAssertions: [],
    },
  } as NativePilotSelection;
}

function reset(): FreshColdReset {
  return {
    fixtureResetId: RESET_ID,
    ownerRunId: RUN_ID,
    cohortFixtureFingerprint: HASH,
    status: 'fresh',
    startedAt: '2026-10-05T12:00:00.000Z',
    finishedAt: '2026-10-05T12:00:01.000Z',
    appStateFingerprint: HASH,
    fixtureStateFingerprint: HASH,
    sourceFingerprint: HASH,
    helperFingerprint: HASH,
    originalResetBinding: binding('reset-original.private.json', 'd'.repeat(64)),
    cleanupStatus: 'cleaned',
    blocker: null,
    target: target(),
    backend: backend(),
  };
}

function owner(): T15DetoxOwnedLifecycle {
  return {
    ownerRunId: RUN_ID,
    captureRunId: CAPTURE_ID,
    target: target(),
    backend: backend(),
    fixture: {
      runId: RUN_ID,
      ownerRunId: RUN_ID,
      captureRunId: CAPTURE_ID,
      scope: 'native-entry-ios',
      fixtureResetId: RESET_ID,
    },
    originalReceiptBinding: binding('original-attempt.private.json', 'e'.repeat(64)),
    process: { pid: 1234, processStartIdentity: '2026-10-05T12:00:00.000Z:process' },
    ownedPorts: [43111],
    ownershipWindows: windows(),
    cleanupStatus: 'cleaned',
    ownerState: { owner: 'existing-detox-route' },
  };
}

function input(signal: AbortSignal) {
  return {
    spec: { cohort: { fixtureResetFingerprint: HASH } } as never,
    expected: expected(),
    selection: selection(),
    signal,
    reusableBuild: {
      platform: 'ios',
      buildId: RUN_ID,
      buildProfile: 'ios.sim.debug',
      sourceFingerprint: HASH,
      helperFingerprint: HASH,
      flagsFingerprint: HASH,
      binaryHash: HASH,
      current: true,
    },
    outputRoot: '/private/t15/output',
    deadlineAtMonotonicMs: performance.now() + 10_000,
    terminalize: () => undefined,
  } as never;
}

function publicResult() {
  return {
    receipt: {
      path: '/private/t15/public/public-receipt.private.json',
      artifactRoot: '/private/t15/public',
      receiptHash: 'f'.repeat(64),
      receipt: {
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        captureRunId: CAPTURE_ID,
        ownerRunId: RUN_ID,
        backendRunId: RUN_ID,
        result: 'passed',
      },
    },
    receiptIdentity,
  };
}

function producer(options: {
  reset?: (input: unknown) => Promise<FreshColdReset>;
  owner?: (input: unknown) => Promise<T15DetoxOwnedLifecycle>;
  consumePublic?: (input: unknown) => Promise<ReturnType<typeof publicResult> | null>;
  cleanup?: (input: unknown) => Promise<{
    ownerRunId: string;
    status: 'cleaned';
    ownershipWindows: readonly NativeComparisonOwnershipWindow[];
    recoveryRecordPath: null;
  }>;
}) {
  return createT15DetoxSharedLifecycleProducer({
    route: 'session|ios',
    outputRoot: '/private/t15/output',
    reset: options.reset ?? (() => Promise.resolve(reset())),
    owner: options.owner ?? (() => Promise.resolve(owner())),
    consumePublic: options.consumePublic ?? (() => Promise.resolve(publicResult())),
    cleanup:
      options.cleanup ??
      (() =>
        Promise.resolve({
          ownerRunId: RUN_ID,
          status: 'cleaned' as const,
          ownershipWindows: windows(),
          recoveryRecordPath: null,
        })),
  });
}

void test('T15 shared Detox lifecycle closes reset, owner, public and cleanup under one owner run', async () => {
  const events: string[] = [];
  const deadline: number[] = [];
  const run = createT15DetoxSharedLifecycleProducer({
    route: 'session|ios',
    outputRoot: '/private/t15/output',
    reset: (value) => {
      events.push('reset');
      deadline.push(value.deadlineAtMonotonicMs);
      assert.equal(value.expected.runId, RUN_ID);
      return Promise.resolve(reset());
    },
    owner: (value) => {
      events.push('owner');
      deadline.push(value.deadlineAtMonotonicMs);
      assert.equal(value.reset.ownerRunId, RUN_ID);
      assert.deepEqual(value.reset.target, target());
      assert.deepEqual(value.reset.backend, backend());
      return Promise.resolve(owner());
    },
    consumePublic: (value) => {
      events.push('public');
      deadline.push(value.deadlineAtMonotonicMs);
      assert.equal(value.owner.ownerRunId, RUN_ID);
      assert.equal(value.owner.captureRunId, CAPTURE_ID);
      assert.equal(value.owner.fixture.fixtureResetId, RESET_ID);
      assert.equal(value.owner.backend.backendAttemptId, ATTEMPT_ID);
      return Promise.resolve(publicResult());
    },
    cleanup: (value) => {
      events.push('cleanup');
      deadline.push(value.deadlineAtMonotonicMs);
      assert.equal(value.owner.ownerRunId, RUN_ID);
      assert(value.publicResult);
      return Promise.resolve({
        ownerRunId: RUN_ID,
        status: 'cleaned',
        ownershipWindows: windows(),
        recoveryRecordPath: null,
      });
    },
  });
  const result = await run(input(new AbortController().signal));
  assert.deepEqual(events, ['reset', 'owner', 'public', 'cleanup']);
  assert.equal(new Set(deadline).size, 1);
  assert.equal(result.status, 'received');
  assert.equal(result.ownerRunId, RUN_ID);
  assert.equal(result.reset.originalResetBinding.status, 'verified');
  assert.equal(result.coldAttemptIdentity.ownershipWindows.length, 2);
  assert.equal(
    result.receipt?.receipt && (result.receipt.receipt as { result: string }).result,
    'passed',
  );
});

void test('T15 split shared reset producer forwards one bounded deadline and rejects cancellation', async () => {
  const controller = new AbortController();
  let observedDeadline = 0;
  const producer = createT15DetoxSharedResetProducer({
    route: 'session|ios',
    attemptDeadlineMs: 5_000,
    prepare: (value) => {
      observedDeadline = value.deadlineAtMonotonicMs;
      return Promise.resolve(reset());
    },
  });
  const prepared = await producer(input(controller.signal));
  assert.equal(prepared.status, 'fresh');
  assert(observedDeadline > performance.now());
  controller.abort();
  const cancelled = await producer(input(controller.signal));
  assert.equal(cancelled.status, 'blocked');
  assert.equal(cancelled.cleanupStatus, 'not-acquired');
  assert.match(cancelled.blocker ?? '', /aborted/);
});

void test('T15 rejects a foreign reset before invoking the existing Detox owner', async () => {
  let ownerCalls = 0;
  const foreign = { ...reset(), ownerRunId: '1'.repeat(24) };
  const run = producer({
    reset: () => Promise.resolve(foreign),
    owner: () => {
      ownerCalls += 1;
      return Promise.resolve(owner());
    },
  });
  const result = await run(input(new AbortController().signal));
  assert.equal(ownerCalls, 0);
  assert.equal(result.status, 'harness-blocked');
  assert.match(result.issue ?? '', /reset-identity-mismatch/);
  assert.equal(result.receipt, null);
});

void test('T15 rejects a reset backend that is not bound to the owner run', async () => {
  let ownerCalls = 0;
  const foreign = {
    ...reset(),
    backend: { ...backend(), runId: '1'.repeat(24) },
  };
  const run = producer({
    reset: () => Promise.resolve(foreign),
    owner: () => {
      ownerCalls += 1;
      return Promise.resolve(owner());
    },
  });
  const result = await run(input(new AbortController().signal));
  assert.equal(ownerCalls, 0);
  assert.equal(result.status, 'harness-blocked');
  assert.match(result.issue ?? '', /reset\.backend\.runId/);
  assert.equal(result.receipt, null);
});

void test('T15 cancellation after ownership still requires cleanup and cannot publish', async () => {
  const controller = new AbortController();
  let cleanupCalls = 0;
  const run = producer({
    consumePublic: () => {
      controller.abort();
      return Promise.reject(new Error('cancelled-by-caller'));
    },
    cleanup: (value) => {
      cleanupCalls += 1;
      const signal = (value as { signal: AbortSignal }).signal;
      assert.equal(signal.aborted, true);
      return Promise.resolve({
        ownerRunId: RUN_ID,
        status: 'cleaned' as const,
        ownershipWindows: windows(),
        recoveryRecordPath: null,
      });
    },
  });
  const result = await run(input(controller.signal));
  assert.equal(cleanupCalls, 1);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.receipt, null);
  assert.equal(result.coldAttemptIdentity.processPid, 1234);
});

void test('T15 cancellation immediately after owner acquisition still requires cleanup', async () => {
  const controller = new AbortController();
  let cleanupCalls = 0;
  const run = createT15DetoxSharedLifecycleProducer({
    route: 'session|ios',
    outputRoot: '/private/t15/output',
    reset: () => Promise.resolve(reset()),
    owner: () => {
      controller.abort();
      return Promise.resolve(owner());
    },
    consumePublic: () => {
      throw new Error('public must not run after owner cancellation');
    },
    cleanup: (value) => {
      cleanupCalls += 1;
      assert.equal((value as { signal: AbortSignal }).signal.aborted, true);
      assert.equal((value as { publicResult: unknown }).publicResult, null);
      return Promise.resolve({
        ownerRunId: RUN_ID,
        status: 'cleaned' as const,
        ownershipWindows: windows(),
        recoveryRecordPath: null,
      });
    },
  });
  const result = await run(input(controller.signal));
  assert.equal(cleanupCalls, 1);
  assert.equal(result.status, 'cancelled');
  assert.match(result.issue ?? '', /aborted|deadline-after-cleanup/);
  assert.equal(result.receipt, null);
  assert.equal(result.coldAttemptIdentity.processPid, 1234);
});

void test('T15 deadline crossing during cleanup blocks promotion while retaining ownership', async () => {
  const controller = new AbortController();
  const lifecycleInput = input(controller.signal) as {
    deadlineAtMonotonicMs: number;
  };
  let cleanupCalls = 0;
  const run = producer({
    cleanup: () => {
      cleanupCalls += 1;
      lifecycleInput.deadlineAtMonotonicMs = performance.now() - 1;
      return Promise.resolve({
        ownerRunId: RUN_ID,
        status: 'cleaned' as const,
        ownershipWindows: windows(),
        recoveryRecordPath: null,
      });
    },
  });
  const result = await run(lifecycleInput as never);
  assert.equal(cleanupCalls, 1);
  assert.equal(result.status, 'harness-blocked');
  assert.match(result.issue ?? '', /deadline-after-cleanup/);
  assert.equal(result.receipt, null);
  assert.equal(result.coldAttemptIdentity.processPid, 1234);
});

void test('T15 foreign cleanup closes no route and retains the owned terminal identity', async () => {
  const run = producer({
    cleanup: () =>
      Promise.resolve({
        ownerRunId: '1'.repeat(24),
        status: 'cleaned' as const,
        ownershipWindows: windows(),
        recoveryRecordPath: null,
      }),
  });
  const result = await run(input(new AbortController().signal));
  assert.equal(result.status, 'harness-blocked');
  assert.match(result.issue ?? '', /cleanup-owner-or-status-mismatch/);
  assert.equal(result.coldAttemptIdentity.processPid, 1234);
  assert.equal(result.receipt, null);
});

void test('T15 exposes exactly nine shared Detox routes and leaves Android camera outside the adapter', () => {
  assert.equal(T15_DETOX_SHARED_ROUTE_KEYS.length, 9);
  assert.equal(new Set(T15_DETOX_SHARED_ROUTE_KEYS).size, 9);
  assert.throws(() => requireT15DetoxSharedRoute('camera-denied|android'), /not eligible/);
  for (const key of T15_DETOX_SHARED_ROUTE_KEYS) {
    const route = requireT15DetoxSharedRoute(key);
    assert.equal(route.runtimeBinding, 'caller-supplied');
    assert.ok(route.ownerModule.length > 0);
    assert.ok(route.publicModule.length > 0);
  }
});
