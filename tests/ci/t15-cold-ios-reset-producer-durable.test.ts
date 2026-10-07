import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  produceIosColdReset,
  type ColdResetPreparationExpectation,
  type OwnedIosColdResetContext,
} from '../../scripts/testing/t15-cold-ios-reset-producer';

// Durable source-level controls import the production module directly. Packet patch-inspection
// assertions remain private in the parent V7 packet.

const captureRunId = 'fedcba9876543210fedcba98';
const requestedRunId = '0123456789abcdef01234567';
const backendRunId = 'abcdef0123456789abcdef01';
const sha = 'a'.repeat(64);

const expectation: ColdResetPreparationExpectation = {
  requestedRunId,
  requestedAttemptId: `${requestedRunId}:first`,
  fixtureResetId: 'reset-cell-0001',
  cohortFixtureFingerprint: sha,
  sourceFingerprint: 'b'.repeat(64),
  helperFingerprint: 'c'.repeat(64),
};

async function makeContext(): Promise<{
  context: OwnedIosColdResetContext;
  cleanup: () => Promise<void>;
}> {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 't15-cold-durable-v7-')));
  const outputRoot = path.join(base, captureRunId);
  const backendRoot = path.join(base, 'backend-runtime');
  const installedContainerPath = path.join(base, 'installed-container');
  await Promise.all([
    mkdir(outputRoot, { mode: 0o700 }),
    mkdir(backendRoot, { mode: 0o700 }),
    mkdir(installedContainerPath, { mode: 0o700 }),
  ]);
  const device = {
    udid: '01234567-89AB-CDEF-0123-456789ABCDEF',
    name: 'MyChampions-Pilot-fedcba9876543210fedcba98',
    runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
    deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
    async verify() {},
    inspect() {
      return Promise.resolve({
        udid: device.udid,
        name: device.name,
        runtime: device.runtime,
        deviceTypeIdentifier: device.deviceTypeIdentifier,
        state: 'Booted',
        isAvailable: true,
      });
    },
  };
  const manifest = {
    runId: backendRunId,
    artifactRoot: backendRoot,
    composeProject: `mc_test_${backendRunId}`,
    processes: [
      {
        role: 'orchestrator',
        pid: 4001,
        started: 'orchestrator-start',
        script: '/server/scripts/testing/session.ts',
      },
      {
        role: 'api',
        pid: 4002,
        started: 'api-start',
        script: '/server/scripts/testing/serve.ts',
      },
    ],
  } as const;
  const fixtures = {
    runId: backendRunId,
    scope: 'native-entry-ios',
    accounts: { student: { authUid: 'student-owned', password: 'private' } },
    savedPlanId: 'plan-1',
  };
  const session = {
    manifest,
    apiOrigin: 'http://127.0.0.1:42001/',
    apiPid: 4002,
    async assertApiOwnership() {},
    probeApiLifetime() {
      return Promise.resolve({
        runId: backendRunId,
        apiOrigin: 'http://127.0.0.1:42001/',
        apiPid: 4002,
        apiStarted: 'api-start',
        apiScript: '/server/scripts/testing/serve.ts',
        backendAttemptId: `${backendRunId}:first`,
        manifestSha256: sha,
      });
    },
    snapshotWithEvidence(scope: string) {
      return Promise.resolve({
        value: { runId: backendRunId, scope, readOnly: true, rowCount: 1 },
        receipt: {
          kind: 'domain',
          snapshotId: 'snap-1',
          scope,
          runId: backendRunId,
        },
      });
    },
  };
  const context: OwnedIosColdResetContext = {
    outputRoot,
    captureRunId,
    ownerRunId: requestedRunId,
    resetStartedAt: '2026-10-03T11:59:59.000Z',
    device,
    session,
    proxy: {
      origin: 'http://127.0.0.1:42002/',
      runId: backendRunId,
      waitForQuiescence() {
        return Promise.resolve({ active: 0, outbound: 0 });
      },
    },
    fixtures,
    build: {
      appId: 'com.edufelip.mychampions.dev',
      binaryHash: sha,
      binaryPath: '/build/mychampions.app',
    },
    appState: {
      phase: 'installed-before-ui',
      appId: 'com.edufelip.mychampions.dev',
      installedContainerPath,
      installExecution: {
        execution: 'completed',
        cleanup: 'cleaned',
        pid: 4010,
      },
    },
    proxyProcess: {
      pid: 4011,
      started: 'capture-start',
      script: '/scripts/testing/capture-native-testability.ts',
    },
    now: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 9, 3, 12, 0, 0, tick++)).toISOString();
    })(),
  };
  return { context, cleanup: () => rm(base, { recursive: true, force: true }) };
}

void test('producer derives target/backend/listeners from the same acquired lifecycle', async () => {
  const { context, cleanup } = await makeContext();
  try {
    const result = await produceIosColdReset({ expectation, context });
    assert.equal(result.status, 'fresh');
    assert.equal(result.target.deviceId, context.device.udid);
    assert.equal(result.target.apiOrigin, context.device ? context.proxy.origin : null);
    assert.equal(result.backend.runId, backendRunId);
    assert.equal(result.backend.apiPid, context.session.apiPid);
    assert.equal(result.backend.ownerRunId, requestedRunId);
    assert.equal(result.cleanupStatus, 'cleaned');
    assert.equal(result.startedAt, context.resetStartedAt);
    assert.equal(result.ownership.listeners.length, 2);
    assert.equal(result.originalResetBinding.identity.nlink, 1);
    assert.equal(result.originalResetBinding.identity.mode & 0o777, 0o600);
    assert.equal(result.ownership.namespaces.capture.path, context.outputRoot);
    assert.notEqual(
      result.ownership.namespaces.capture.path,
      result.ownership.namespaces.backend.path,
    );
    const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8')) as Record<
      string,
      unknown
    >;
    assert.deepEqual(receipt.target, result.target);
    assert.deepEqual(receipt.backend, result.backend);
    assert.equal(receipt.resourceCleanupStatus, 'deferred-to-capture-finalizer');
  } finally {
    await cleanup();
  }
});

void test('producer rejects an unbound reset start timestamp before publication', async () => {
  const { context, cleanup } = await makeContext();
  try {
    await assert.rejects(
      produceIosColdReset({
        expectation,
        context: { ...context, resetStartedAt: 'not-a-timestamp' },
      }),
      /resetStartedAt is invalid/u,
    );
    await assert.rejects(readFile(path.join(context.outputRoot, 'reset-original.private.json')));
  } finally {
    await cleanup();
  }
});

void test('producer rejects a backend/API identity that changes before reset publication', async () => {
  const { context, cleanup } = await makeContext();
  try {
    const badContext = {
      ...context,
      session: {
        ...context.session,
        async probeApiLifetime() {
          return {
            ...(await context.session.probeApiLifetime()),
            apiPid: 4999,
          };
        },
      },
    } as OwnedIosColdResetContext;
    await assert.rejects(
      produceIosColdReset({ expectation, context: badContext }),
      /same-session bound|backend API process row does not match/u,
    );
  } finally {
    await cleanup();
  }
});

void test('producer rejects a launched app phase, same listener, and non-quiescent proxy', async () => {
  const { context, cleanup } = await makeContext();
  try {
    const launchedContext = {
      ...context,
      appState: { ...context.appState, phase: 'launched' },
    } as unknown as OwnedIosColdResetContext;
    await assert.rejects(
      produceIosColdReset({ expectation, context: launchedContext }),
      /before UI launch/u,
    );
    const second = await makeContext();
    try {
      const sameListenerContext = {
        ...second.context,
        proxy: {
          ...second.context.proxy,
          origin: second.context.session.apiOrigin,
        },
      };
      await assert.rejects(
        produceIosColdReset({ expectation, context: sameListenerContext }),
        /not distinct/u,
      );
    } finally {
      await second.cleanup();
    }
  } finally {
    await cleanup();
  }
});

void test('producer passes the live abort signal into quiescence and blocks late publication', async () => {
  const { context, cleanup } = await makeContext();
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  let receivedDeadlineMs: number | undefined;
  try {
    const pendingProxyContext = {
      ...context,
      signal: controller.signal,
      proxy: {
        ...context.proxy,
        waitForQuiescence(deadlineMs: number, signal?: AbortSignal) {
          receivedSignal = signal;
          receivedDeadlineMs = deadlineMs;
          return new Promise<{ active: number; outbound: number }>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () =>
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error(String(signal.reason ?? 'quiescence aborted')),
                ),
              { once: true },
            );
            // Synchronize cancellation with actual quiescence entry. A wall-clock
            // timer can fire while the full unit run is still in earlier owned
            // lifecycle checks, which would test cancellation before signal
            // delivery instead of the live quiescence contract.
            controller.abort(new Error('deadline while waiting for proxy quiescence'));
          });
        },
      },
    };
    const pending = produceIosColdReset({
      expectation,
      context: pendingProxyContext,
    });
    await assert.rejects(pending, /deadline while waiting for proxy quiescence/u);
    assert.equal(receivedSignal, controller.signal);
    assert.equal(receivedDeadlineMs, 5000);
    await assert.rejects(readFile(path.join(context.outputRoot, 'reset-original.private.json')));
  } finally {
    await cleanup();
  }
});

void test('producer never writes a receipt when owned proxy quiescence fails', async () => {
  const { context, cleanup } = await makeContext();
  try {
    const failedProxyContext = {
      ...context,
      proxy: {
        ...context.proxy,
        waitForQuiescence() {
          return Promise.reject(new Error('proxy still has an in-flight request'));
        },
      },
    };
    await assert.rejects(
      produceIosColdReset({ expectation, context: failedProxyContext }),
      /in-flight request/u,
    );
    await assert.rejects(readFile(path.join(context.outputRoot, 'reset-original.private.json')));
  } finally {
    await cleanup();
  }
});

void test('producer rejects a symlinked output namespace before touching it', async () => {
  const { context, cleanup } = await makeContext();
  const realOutput = context.outputRoot;
  const link = `${realOutput}-link`;
  try {
    await symlink(realOutput, link);
    const linkedContext = {
      ...context,
      outputRoot: link,
      captureRunId,
    };
    await assert.rejects(
      produceIosColdReset({ expectation, context: linkedContext }),
      /canonical directory/u,
    );
  } finally {
    await rm(link, { recursive: true, force: true });
    await cleanup();
  }
});
