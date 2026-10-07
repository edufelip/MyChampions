import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { runDetoxConnectionDriverCleanup } from '../../scripts/testing/detox-integrated-connection-driver';
import { runDetoxTrainingOnExistingOwner } from '../../scripts/testing/detox-training-owned-dispatch';
import type { DetoxTrainingStep } from '../../scripts/testing/detox-training-journey';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';
import type { OwnedDomainSnapshot, OwnedFixtures } from '../../scripts/testing/owned-session';

const root = path.resolve(__dirname, '../..');
const runId = 'a'.repeat(24);
const attemptId = `${runId}:first`;
const child = { pid: 12_345, pgid: 12_345, started: '2026-10-02T00:00:00Z' } as const;
const apiOrigin = 'http://127.0.0.1:9001';
const exerciseId = '00000000-0000-4000-8000-000000000001';
const exerciseName = 'en QA Exercise 1';

void test('Integrated training leaves aggregate cleanup to the outer baseline owner', async () => {
  const driver = await readFile(
    path.join(root, 'scripts/testing/detox-integrated-connection-driver.ts'),
    'utf8',
  );
  const baseline = await readFile(
    path.join(root, 'scripts/testing/detox-integrated-connection-baseline.ts'),
    'utf8',
  );
  const dispatchStart = driver.indexOf('await runDetoxTrainingOnExistingOwner({');
  assert.notEqual(dispatchStart, -1);
  const dispatchEnd = driver.indexOf('\n        });', dispatchStart);
  assert.notEqual(dispatchEnd, -1);
  const dispatch = driver.slice(dispatchStart, dispatchEnd);
  assert.doesNotMatch(dispatch, /\bcleanup\s*:/);
  assert.match(baseline, /acquired\?\.cleanup\(/);
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
      ? { text: step.expectedRendered[selector], value: step.expectedRendered[selector] }
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
      `<ViewHierarchy>${step.selectors.map((id) => `<View id="${id}"/>`).join('')}</ViewHierarchy>`,
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
  await writeFile(producerPath, values[files.screenshot], { flag: 'wx', mode: 0o600 });
  await writeFile(producerSnapshotPath, values[files.screenshot], { flag: 'wx', mode: 0o600 });
  const producerRealpath = await realpath(producerPath);
  const producerSnapshotRealpath = await realpath(producerSnapshotPath);
  const producerStat = await lstat(producerPath);
  const producerSnapshotStat = await lstat(producerSnapshotPath);
  await Promise.all(
    Object.entries(values).map(async ([fileName, bytes]) => {
      await writeFile(path.join(rootPath, fileName), bytes, { flag: 'wx', mode: 0o600 });
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

void test('existing owner dispatch stages raw API, SQL and proxy evidence and shares one child', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'detox-training-owner-dispatch-'));
  try {
    const selected = await selection();
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
    const report: Record<string, unknown> = {};
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
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

void test('training shutdown leaves kill, wait and reap to the existing aggregate owner', async () => {
  const artifact = await mkdtemp(path.join(os.tmpdir(), 'detox-training-owner-cleanup-'));
  try {
    let waits = 0;
    let stops = 0;
    let closeCalls = 0;
    const result = await runDetoxConnectionDriverCleanup({
      artifactRoot: await realpath(artifact),
      repositoryRoot: root,
      report: { detoxTrainingChildShutdown: true },
      reason: 'completed',
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 5_000,
      client: {
        request: () =>
          Promise.reject(new Error('connection shutdown must not be sent after training shutdown')),
        close: () => {
          closeCalls += 1;
        },
      },
      child: {
        pid: child.pid,
        pgid: child.pgid,
        wait: () => {
          waits += 1;
          return Promise.resolve();
        },
        stop: () => {
          stops += 1;
          return Promise.resolve();
        },
        outcome: () => ({ code: 0, signal: null }),
        censusFailure: () => null,
        outputFailure: () => null,
      },
      childCommand: { command: 'node', argv: [] } as never,
    });
    assert.equal(result.status, 'cleaned');
    assert.equal(waits, 1);
    assert.equal(stops, 1);
    assert.equal(closeCalls, 1);
    const receipt = JSON.parse(
      await readFile(path.join(artifact, 'detox-connection-cleanup.private.json'), 'utf8'),
    ) as { child?: { pid?: number; outcome?: { code?: number; signal?: string | null } } };
    assert.equal(receipt.child?.pid, child.pid);
    assert.equal(receipt.child?.outcome?.code, 0);
    assert.equal(receipt.child?.outcome?.signal, null);
  } finally {
    await rm(artifact, { recursive: true, force: true });
  }
});
