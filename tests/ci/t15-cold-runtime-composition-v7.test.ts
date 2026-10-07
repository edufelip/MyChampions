import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createNativePilotOutputRoot,
  writeNativePilotPrivateFile,
  type NativePilotInvocation,
} from '../../scripts/testing/native-pilot-invocation';
import { readNativeEvidenceObservation } from '../../scripts/testing/native-view-evidence';
import {
  produceIosColdReset,
  type ColdResetPreparationExpectation,
  type OwnedIosColdResetContext,
} from '../../scripts/testing/t15-cold-ios-reset-producer';
import {
  consumeChildColdReset,
  readChildCaptureFromOwnedRoot,
  type ColdResetChildExpectation,
} from '../../scripts/testing/t15-cold-reset-child-consumption';
import {
  handoffColdResetReceiptFromProcessBinding,
  type ColdResetHandoff,
} from '../../scripts/testing/t15-cold-reset-handoff';
import { buildColdResetRuntimeLinkBinding } from '../../scripts/testing/t15-cold-runtime-link';

const captureRunId = 'fedcba9876543210fedcba98';
const requestedRunId = '0123456789abcdef01234567';
const backendRunId = 'abcdef0123456789abcdef01';
const sha = 'a'.repeat(64);

const expectation: ColdResetPreparationExpectation = {
  requestedRunId,
  requestedAttemptId: `${requestedRunId}:first`,
  fixtureResetId: 'reset-cell-v7-composition',
  cohortFixtureFingerprint: sha,
  sourceFingerprint: 'b'.repeat(64),
  helperFingerprint: 'c'.repeat(64),
};

async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function makeContext(base: string): Promise<OwnedIosColdResetContext> {
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
  return {
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
}

void test('cold producer composes through protected child read, handoff and runtime link', async () => {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 't15-cold-v7-compose-')));
  const outputParent = path.join(base, 'runner-parent');
  await mkdir(outputParent, { mode: 0o700 });
  try {
    const context = await makeContext(base);
    const produced = await produceIosColdReset({ expectation, context });
    const childExpectation: ColdResetChildExpectation = {
      ...expectation,
      target: {
        platform: 'ios',
        deviceId: context.device.udid,
        appId: context.build.appId,
        binaryHash: context.build.binaryHash,
        apiOrigin: context.proxy.origin,
        captureRunId,
        ownerRunId: requestedRunId,
        phase: context.appState.phase,
      },
      backend: {
        runId: backendRunId,
        ownerRunId: requestedRunId,
        captureRunId,
        artifactRoot: context.session.manifest.artifactRoot,
        apiOrigin: context.session.apiOrigin,
        apiPid: context.session.apiPid,
        apiStarted: 'api-start',
        apiScript: '/server/scripts/testing/serve.ts',
        backendAttemptId: `${backendRunId}:first`,
        manifestSha256: sha,
      },
      sourceIdentity: produced.originalResetBinding.identity,
    };
    await writePrivateJson(path.join(context.outputRoot, 'capture.private.json'), {
      platform: 'ios',
      mode: 'integration',
      captureRoot: context.outputRoot,
      captureRunId,
      coldReset: produced,
    });

    const protectedCapture = await readChildCaptureFromOwnedRoot({
      captureRoot: context.outputRoot,
      expectedCaptureRunId: captureRunId,
    });
    const child = consumeChildColdReset({
      capture: protectedCapture.capture,
      captureRoot: context.outputRoot,
      expectation: childExpectation,
    });
    const invocation: NativePilotInvocation = {
      selection: {
        platform: 'ios',
        engine: 'detox',
        scenario: 'SCN-connection-ios',
        mode: 'integration',
      },
      requestedRunId,
      requestedAttemptId: `${requestedRunId}:first`,
      outputParent,
      coldResetBinding: null,
    };
    const prepared = await createNativePilotOutputRoot({
      invocation,
      defaultOutputParent: outputParent,
      signal: new AbortController().signal,
    });
    const handoff = await handoffColdResetReceiptFromProcessBinding({
      signal: new AbortController().signal,
      binding: child,
      prepared,
    });
    const runtimeLink = buildColdResetRuntimeLinkBinding({
      requestedRunId,
      requestedAttemptId: `${requestedRunId}:first`,
      captureRoot: context.outputRoot,
      captureRunId,
      outputRoot: prepared.outputRoot,
      child,
      handoff,
    });
    await writeNativePilotPrivateFile({
      root: prepared.outputRoot,
      relative: 'runtime-link.private.json',
      contents: JSON.stringify({
        kind: 'private cold producer-to-runtime link composition; not native qualification',
        requestedRunId,
        requestedAttemptId: `${requestedRunId}:first`,
        coldResetHandoff: runtimeLink,
      }),
      namespaceIdentity: prepared.namespaceIdentity,
      signal: new AbortController().signal,
    });
    const observation = readNativeEvidenceObservation(
      prepared.outputRoot,
      'runtime-link.private.json',
      true,
    );
    const document = JSON.parse(observation.bytes.toString('utf8')) as {
      coldResetHandoff: typeof runtimeLink;
    };
    assert.equal(observation.identity.nlink, 1);
    assert.equal(observation.identity.mode & 0o777, 0o600);
    assert.equal(document.coldResetHandoff.source.status, 'verified');
    assert.equal(document.coldResetHandoff.final.status, 'verified');
    assert.equal(document.coldResetHandoff.source.receiptHash, produced.receiptHash);
    assert.equal(document.coldResetHandoff.final.receiptHash, produced.receiptHash);
    assert.equal(document.coldResetHandoff.captureRoot, context.outputRoot);
    assert.equal(document.coldResetHandoff.captureRunId, captureRunId);
    assert.equal(document.coldResetHandoff.requestedRunId, requestedRunId);
    assert.equal(document.coldResetHandoff.final.identity.nlink, 1);
    assert.equal(document.coldResetHandoff.final.identity.mode & 0o777, 0o600);
    assert.equal(
      document.coldResetHandoff.final.receiptPath,
      path.join(prepared.outputRoot, 'reset-original.private.json'),
    );
    assert.match(document.coldResetHandoff.target.deviceId as string, /01234567-89AB-CDEF/u);
    assert.equal(document.coldResetHandoff.backend.runId, backendRunId);

    await assert.rejects(
      () =>
        Promise.resolve().then(() =>
          buildColdResetRuntimeLinkBinding({
            requestedRunId,
            requestedAttemptId: `${requestedRunId}:first`,
            captureRoot: context.outputRoot,
            captureRunId,
            outputRoot: prepared.outputRoot,
            child: {
              ...child,
              target: { ...child.target, ownerRunId: 'foreign-owner' },
            },
            handoff,
          }),
        ),
      /target ownerRunId is not bound/u,
    );
    const badHandoff = {
      ...handoff,
      finalIdentity: { ...handoff.finalIdentity, nlink: 2 },
    } as ColdResetHandoff;
    await assert.rejects(
      () =>
        Promise.resolve().then(() =>
          buildColdResetRuntimeLinkBinding({
            requestedRunId,
            requestedAttemptId: `${requestedRunId}:first`,
            captureRoot: context.outputRoot,
            captureRunId,
            outputRoot: prepared.outputRoot,
            child,
            handoff: badHandoff,
          }),
        ),
      /final identity is not one owned immutable/u,
    );
    const renamedHandoff = {
      ...handoff,
      finalRelativePath: 'renamed-reset.json',
    } as unknown as ColdResetHandoff;
    await assert.rejects(
      () =>
        Promise.resolve().then(() =>
          buildColdResetRuntimeLinkBinding({
            requestedRunId,
            requestedAttemptId: `${requestedRunId}:first`,
            captureRoot: context.outputRoot,
            captureRunId,
            outputRoot: prepared.outputRoot,
            child,
            handoff: renamedHandoff,
          }),
        ),
      /immutable receipt name/u,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
