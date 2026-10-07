import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  link,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { enUS } from '../../localization/en-US';
import {
  DetoxTrainingChildClient,
  verifyDetoxTrainingStepReceipt,
  type DetoxTrainingCancellationWriter,
  type DetoxTrainingEvidenceWriter,
  type VerifiedDetoxTrainingStepReceipt,
} from '../../scripts/testing/detox-training-child-client';
import {
  assertTrainingCommand,
  assertTrainingResponse,
  hashJson,
  publishTrainingCancellation,
  readOwnedTrainingFile,
  writeAtomicTrainingBytes,
  waitForTrainingCommand,
  writeAtomicTrainingJson,
} from '../../scripts/testing/detox-training-child-protocol.mjs';
import {
  buildDetoxTrainingStepPlan,
  DETOX_TRAINING_ASSERTION_IDS,
  requireDetoxTrainingStepReceipt,
  requireDetoxTrainingSelection,
  requireDetoxTrainingTransport,
  runDetoxTrainingJourney,
  type DetoxTrainingBoundEvidence,
  type DetoxTrainingSourceFileReceipt,
  type DetoxTrainingStep,
  type DetoxTrainingStepReceipt,
  type DetoxTrainingJourneyOptions,
  type DetoxTrainingUiBridge,
} from '../../scripts/testing/detox-training-journey';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';
import type { NativeTrainingJourneyInput } from '../../scripts/testing/native-training-journey';
import type { ProxyObservation } from '../../scripts/testing/owned-api-proxy';
import type { OwnedDomainSnapshot } from '../../scripts/testing/owned-session';

const repositoryRoot = path.resolve(__dirname, '../..');
const runId = 'a'.repeat(24);
const input: NativeTrainingJourneyInput = {
  runId,
  attemptId: `${runId}:first`,
  platform: 'ios',
  accountUid: 'coach',
  exerciseId: '00000000-0000-4000-8000-000000000001',
  exerciseName: 'en QA Exercise 1',
};
const child = {
  pid: 12_345,
  pgid: 12_345,
  started: '2026-10-02T00:00:00Z',
} as const;
const targetOrigin = 'http://127.0.0.1:9001';

async function selection(): Promise<NativePilotSelection> {
  const inventory = await readFile(
    path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'),
    'utf8',
  );
  const scenario = (
    JSON.parse(inventory) as { scenarios: Record<string, unknown>[] }
  ).scenarios.find((row) => row.id === 'SCN-training-ios');
  assert(scenario);
  return {
    arguments: {
      platform: 'ios',
      engine: 'detox',
      scenario: 'SCN-training-ios',
      mode: 'integration',
    },
    scenario: structuredClone(scenario) as NativePilotSelection['scenario'],
    scenarioHash: 'b'.repeat(64),
    requirementHash: 'c'.repeat(64),
  };
}

function baseSnapshot(): OwnedDomainSnapshot {
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

function savedSnapshot(name: string, quantity: string): OwnedDomainSnapshot {
  const value = baseSnapshot();
  value.trainingPlans.push({
    id: 'training_plan_11111111-1111-4111-8111-111111111111',
    studentAuthUid: input.accountUid,
    ownerProfessionalUid: input.accountUid,
    sourceKind: 'predefined',
    name,
    isArchived: false,
    isDraft: false,
    lifecycleConnectionId: null,
    sessions: [
      {
        id: 'session-1',
        name: 'Strength',
        notes: '',
        items: [
          {
            id: quantity === '3x8' ? 'item-1' : 'item-2',
            name: input.exerciseName,
            exerciseId: input.exerciseId,
            quantity,
            notes: '',
          },
        ],
      },
    ],
    createdAt: '2026-09-29T00:00:00Z',
    updatedAt: quantity === '3x8' ? '2026-09-29T00:00:00Z' : '2026-09-29T00:00:01Z',
  });
  return value;
}

function api(snapshot: OwnedDomainSnapshot) {
  return { status: 200, plan: structuredClone(snapshot.trainingPlans[1]) };
}

function proxyRow(
  requestId: number,
  method: string,
  route: string,
  status: number,
): ProxyObservation {
  return {
    requestId,
    method,
    pathHash: createHash('sha256').update(route).digest('hex'),
    requestOrigin: null,
    requestProfile: 'native',
    requestCredentialPresent: true,
    requestCredentialClassification: {
      authorization: 'bearer',
      cookie: 'absent',
      knownAccessCookie: 'absent',
      knownRefreshCookie: 'absent',
      otherCookiePresent: false,
      malformedCookiePresent: false,
    },
    targetOrigin,
    status,
    outcome: 'forwarded',
    faultAttemptId: null,
    elapsedMs: 1,
  };
}

function transport(
  planId = 'training_plan_11111111-1111-4111-8111-111111111111',
): readonly ProxyObservation[] {
  return [
    proxyRow(1, 'POST', '/plans/training', 201),
    proxyRow(2, 'GET', '/plans/predefined', 200),
    proxyRow(3, 'POST', '/integrations/exercise/search', 200),
    proxyRow(4, 'GET', `/integrations/exercise/exercises/${input.exerciseId}`, 200),
    proxyRow(5, 'GET', `/plans/training/${planId}`, 200),
    proxyRow(6, 'PATCH', `/plans/training/${planId}`, 200),
    proxyRow(7, 'GET', `/plans/training/${planId}`, 200),
    proxyRow(8, 'GET', `/plans/training/${planId}`, 200),
  ];
}

function sourceReceipt(
  root: string,
  fileName: string,
  bytes: Buffer,
): DetoxTrainingSourceFileReceipt {
  return {
    fileName,
    sourcePath: path.join(root, fileName),
    sourceRealpath: path.join(root, fileName),
    sourceBytes: bytes.byteLength,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    sourceMode: 0o600,
    sourceUid: process.getuid?.(),
  };
}

async function writeSource(
  root: string,
  fileName: string,
  value: unknown,
): Promise<DetoxTrainingSourceFileReceipt> {
  const bytes = Buffer.from(JSON.stringify(value));
  await writeFile(path.join(root, fileName), bytes, {
    flag: 'wx',
    mode: 0o600,
  });
  await chmod(path.join(root, fileName), 0o600);
  return sourceReceipt(root, fileName, bytes);
}

function xmlFor(step: DetoxTrainingStep): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const nodes = step.selectors
    .map(
      (selector) =>
        `<View class="UIView" width="100" height="50" visibility="visible" alpha="1" focused="false" x="0" y="0" id="${escape(selector)}"/>`,
    )
    .join('');
  return `<ViewHierarchy>${nodes}</ViewHierarchy>`;
}

async function writeStepEvidence(
  root: string,
  step: DetoxTrainingStep,
): Promise<VerifiedDetoxTrainingStepReceipt> {
  const attrs = step.selectors.map((selector) => {
    const value = step.expectedRendered[selector];
    return {
      identifier: selector,
      enabled: true,
      visible: true,
      hittable: true,
      frame: { x: 0, y: 0, width: 100, height: 50 },
      ...(value ? { label: value, value, text: value } : {}),
    };
  });
  const prefix = `detox-training-${step.id}`;
  const xml = Buffer.from(xmlFor(step));
  const screenshot = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const before = Buffer.from(JSON.stringify(attrs));
  const after = Buffer.from(JSON.stringify(attrs));
  const files = {
    xml: `${prefix}.xml`,
    screenshot: `${prefix}.png`,
    attributesBefore: `${prefix}-before.json`,
    attributesAfter: `${prefix}-after.json`,
  } as const;
  const canonicalRoot = await realpath(root);
  const producerPath = path.join(canonicalRoot, `${prefix}-producer.png`);
  const producerSnapshotPath = path.join(canonicalRoot, `${prefix}-producer-snapshot.png`);
  await writeFile(producerPath, screenshot, { flag: 'wx', mode: 0o600 });
  await writeFile(producerSnapshotPath, screenshot, {
    flag: 'wx',
    mode: 0o600,
  });
  const producerRealpath = await realpath(producerPath);
  const written = await Promise.all([
    writeFile(path.join(root, files.xml), xml, { flag: 'wx', mode: 0o600 }),
    writeFile(path.join(root, files.screenshot), screenshot, {
      flag: 'wx',
      mode: 0o600,
    }),
    writeFile(path.join(root, files.attributesBefore), before, {
      flag: 'wx',
      mode: 0o600,
    }),
    writeFile(path.join(root, files.attributesAfter), after, {
      flag: 'wx',
      mode: 0o600,
    }),
  ]);
  void written;
  const receipt = (
    producer: DetoxTrainingStepReceipt['sourceReceipts']['xml']['producer'],
    fileName: string,
    bytes: Buffer,
  ) => ({
    producer,
    sourceKind: 'file' as const,
    processPid: child.pid,
    processPgid: child.pgid,
    processStarted: child.started,
    sourceBytes: bytes.byteLength,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    sourcePath: path.join(root, fileName),
    sourceRealpath: path.join(root, fileName),
    sourceMode: 0o600,
    sourceUid: process.getuid?.(),
    fileName,
  });
  const producerStat = await lstat(producerPath);
  const producerSnapshotStat = await lstat(producerSnapshotPath);
  return {
    schemaVersion: 1,
    kind: 'private-detox-training-step-receipt',
    stepId: step.id,
    assertionId: step.assertionId,
    runId,
    attemptId: input.attemptId,
    commandId: 1,
    commandHash: 'e'.repeat(64),
    platform: step.platform,
    viewId: step.viewId,
    childIdentity: child,
    selectors: [...step.selectors],
    rendered: { ...step.expectedRendered },
    sourceFiles: files,
    sourceReceipts: {
      xml: receipt('detox.device.generateViewHierarchyXml', files.xml, xml),
      screenshot: {
        ...receipt('detox.device.takeScreenshot', files.screenshot, screenshot),
        producerPath: producerRealpath,
        producerRealpath,
        producerBytes: screenshot.byteLength,
        producerSha256: createHash('sha256').update(screenshot).digest('hex'),
        producerMode: producerStat.mode & 0o777,
        producerUid: producerStat.uid,
        producerNlink: producerStat.nlink,
        producerDev: producerStat.dev,
        producerIno: producerStat.ino,
        producerRetention: 'owned-snapshot',
        producerSnapshotPath,
        producerSnapshotRealpath: producerSnapshotPath,
        producerSnapshotBytes: screenshot.byteLength,
        producerSnapshotSha256: createHash('sha256').update(screenshot).digest('hex'),
        producerSnapshotMode: producerSnapshotStat.mode & 0o777,
        producerSnapshotUid: producerSnapshotStat.uid,
        producerSnapshotNlink: producerSnapshotStat.nlink,
        producerSnapshotDev: producerSnapshotStat.dev,
        producerSnapshotIno: producerSnapshotStat.ino,
      },
      attributesBefore: receipt('detox.element.getAttributes', files.attributesBefore, before),
      attributesAfter: receipt('detox.element.getAttributes', files.attributesAfter, after),
    },
    selectorEvidence: step.selectors.map((selector, index) => ({
      selector,
      before: attrs[index],
      after: attrs[index],
      frameStable: true as const,
    })),
    startedMonotonicMs: 1,
    finishedMonotonicMs: 2,
    status: 'completed',
    actionCompleted: true,
    hierarchyCaptured: true,
    screenshotCaptured: true,
  } as VerifiedDetoxTrainingStepReceipt;
}

function bridge(root: string, seen: string[], shutdowns: string[] = []): DetoxTrainingUiBridge {
  return {
    runTrainingStep: async (step) => {
      seen.push(step.id);
      const receipt = await writeStepEvidence(root, step);
      await verifyDetoxTrainingStepReceipt({
        artifactRoot: root,
        step,
        receipt: receipt as never,
      });
      return receipt;
    },
    restartApp: ({ appIdentifier, launchCount }) =>
      Promise.resolve({
        schemaVersion: 1,
        kind: 'private-detox-training-restart-receipt',
        commandId: 1,
        commandHash: 'e'.repeat(64),
        status: 'completed',
        runId,
        attemptId: input.attemptId,
        platform: 'ios',
        appIdentifier,
        launchCount,
        synchronizationDisabled: true,
        launchArgsHash: 'd'.repeat(64),
        childIdentity: child,
        cleanupFence: 'required-before-return',
        startedMonotonicMs: 1,
        finishedMonotonicMs: 2,
      }),
    shutdown: () => {
      shutdowns.push('shutdown');
      return Promise.resolve();
    },
  };
}

async function evidence(
  root: string,
  observations: readonly ProxyObservation[],
): Promise<DetoxTrainingBoundEvidence> {
  const apiSource = await writeSource(root, 'detox-training-api.json', {
    schemaVersion: 1,
    kind: 'private-detox-training-api-source',
    runId,
    attemptId: input.attemptId,
    targetOrigin,
    apiOrigin: targetOrigin,
    apiPid: child.pid,
    apiStarted: child.started,
    backendAttemptId: `${runId}:first`,
    manifestSha256: 'a'.repeat(64),
    apiLedgerSha256: 'b'.repeat(64),
    authUid: input.accountUid,
    reads: [],
  });
  const unrelated = [{ id: 'unrelated', quantity: '1x1' }];
  const sqlSource = await writeSource(root, 'detox-training-sql.json', {
    schemaVersion: 1,
    kind: 'private-detox-training-sql-source',
    runId,
    attemptId: input.attemptId,
    scope: 'native-entry-ios',
    apiOrigin: targetOrigin,
    apiPid: child.pid,
    apiStarted: child.started,
    backendAttemptId: `${runId}:first`,
    manifestSha256: 'a'.repeat(64),
    apiLedgerSha256: 'b'.repeat(64),
    authUid: input.accountUid,
    unrelatedBefore: unrelated,
    unrelatedAfter: unrelated,
    unrelatedStateUnchanged: true,
  });
  const transportSource = await writeSource(root, 'detox-training-transport.json', {
    schemaVersion: 1,
    kind: 'private-detox-training-proxy-source',
    runId,
    attemptId: input.attemptId,
    targetOrigin,
    apiOrigin: targetOrigin,
    apiPid: child.pid,
    apiStarted: child.started,
    authUid: input.accountUid,
    nativeAuthIdentities: [
      {
        apiPid: child.pid,
        authUid: input.accountUid,
        targetOrigin,
        verification: 'verified',
      },
    ],
    observations,
  });
  return {
    runId,
    attemptId: input.attemptId,
    targetOrigin,
    api: {
      apiOrigin: targetOrigin,
      apiPid: child.pid,
      apiStarted: child.started,
      backendAttemptId: `${runId}:first`,
      manifestSha256: 'a'.repeat(64),
      apiLedgerSha256: 'b'.repeat(64),
      authUid: input.accountUid,
      fixtureAuthUidAllowlistHash: 'f'.repeat(64),
      source: apiSource,
    },
    sql: {
      scope: 'native-entry-ios',
      apiOrigin: targetOrigin,
      apiPid: child.pid,
      apiStarted: child.started,
      backendAttemptId: `${runId}:first`,
      manifestSha256: 'a'.repeat(64),
      apiLedgerSha256: 'b'.repeat(64),
      authUid: input.accountUid,
      source: sqlSource,
      unrelatedBefore: unrelated,
      unrelatedAfter: unrelated,
    },
    transport: {
      apiOrigin: targetOrigin,
      apiPid: child.pid,
      apiStarted: child.started,
      authUid: input.accountUid,
      nativeAuthIdentities: [
        {
          apiPid: child.pid,
          authUid: input.accountUid,
          targetOrigin,
          verification: 'verified',
        },
      ],
      source: transportSource,
    },
  };
}

async function journeyOptions(
  root: string,
  selected: NativePilotSelection,
  seen: string[],
  shutdowns: string[] = [],
): Promise<DetoxTrainingJourneyOptions> {
  const created = savedSnapshot(`QA training ${input.attemptId}`, '3x8');
  const edited = savedSnapshot(`QA training ${input.attemptId} updated`, '4x10');
  const states = [
    baseSnapshot(),
    baseSnapshot(),
    created,
    created,
    created,
    created,
    edited,
    edited,
    edited,
  ];
  let snapshots = 0;
  const rows = transport();
  return {
    repositoryRoot,
    output: root,
    selection: selected,
    input,
    bridge: bridge(root, seen, shutdowns),
    snapshot: () =>
      Promise.resolve(structuredClone(states[Math.min(snapshots++, states.length - 1)])),
    readPlan: (planId: string) => {
      assert.equal(planId, created.trainingPlans[1].id);
      return Promise.resolve(api(snapshots >= 7 ? edited : created));
    },
    transport: () => rows,
    targetOrigin,
    signal: new AbortController().signal,
    evidence: await evidence(root, rows),
    cleanup: () => Promise.resolve({ status: 'cleaned' as const, failures: [] as string[] }),
  };
}

void test('Detox training plan binds the seven T14-B assertions and exact quantities', () => {
  const selected = {
    platform: 'ios',
    title: `QA training ${input.attemptId}`,
    exerciseId: input.exerciseId,
    exerciseName: input.exerciseName,
    planId: 'training_plan_11111111-1111-4111-8111-111111111111',
  } as const;
  const steps = buildDetoxTrainingStepPlan(selected);
  assert.deepEqual(
    [...new Set(steps.map((row) => row.assertionId))],
    [...DETOX_TRAINING_ASSERTION_IDS].filter((id) => id !== 'NAT-training-unrelated-state'),
  );
  const draft = steps.find((row) => row.id === 'training-local-draft')!;
  assert.equal(
    draft.expectedRendered['pro.training_plan.itemRow.en_QA_Exercise_1.quantity'],
    '3x8',
  );
  assert(draft.actions.some((row) => row.kind === 'replace-text' && row.value === '3x8'));
  const edit = steps.find((row) => row.id === 'training-edit-draft')!;
  assert.equal(
    edit.expectedRendered['pro.training_plan.itemRow.en_QA_Exercise_1.quantity'],
    '4x10',
  );
  assert(edit.actions.some((row) => row.kind === 'replace-text' && row.value === '4x10'));
  assert.deepEqual(
    edit.actions.find((row) => row.kind === 'tap' && row.selectorKind === 'text'),
    { kind: 'tap', selector: enUS['common.cta.delete'], selectorKind: 'text' },
  );
});

void test('Training protocol hashes commands and rejects expired writes before touching the artifact root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-protocol-'));
  try {
    const command = {
      schemaVersion: 1,
      kind: 'private-detox-training-command',
      commandId: 1,
      runId,
      attemptId: input.attemptId,
      platform: 'ios',
      timeoutMs: 1_000,
      commandKind: 'shutdown',
      commandHash: '',
    };
    command.commandHash = hashJson({ ...command, commandHash: undefined });
    assert.deepEqual(assertTrainingCommand(command), command);
    const restart = {
      ...command,
      commandId: 2,
      commandKind: 'restart-app' as const,
      appIdentifier: 'com.edufelip.mychampions.dev',
      launchCount: 2,
      commandHash: '',
    };
    restart.commandHash = hashJson({ ...restart, commandHash: undefined });
    assert.deepEqual(assertTrainingCommand(restart), restart);
    assert.throws(
      () => assertTrainingCommand({ ...command, commandHash: '0'.repeat(64) }),
      /hash/i,
    );
    const client = new DetoxTrainingChildClient({
      artifactRoot: root,
      platform: 'ios',
      runId,
      attemptId: input.attemptId,
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 1_000,
      expectedChild: child,
    });
    await assert.rejects(client.shutdown({ deadlineAt: 0 }), /deadline/i);
    const expiredAtConstruction = new DetoxTrainingChildClient({
      artifactRoot: root,
      platform: 'ios',
      runId,
      attemptId: input.attemptId,
      signal: new AbortController().signal,
      deadlineAt: performance.now() - 1,
      expectedChild: child,
    });
    await assert.rejects(expiredAtConstruction.shutdown(), /deadline/i);
    await assert.rejects(
      writeAtomicTrainingJson(
        root,
        'detox-training-api.private.json',
        { kind: 'private-detox-training-api-source' },
        { deadlineAt: performance.now() - 1 },
      ),
      /deadline/i,
    );
    const cancelled = new AbortController();
    cancelled.abort(new Error('sidecar cancelled'));
    await assert.rejects(
      writeAtomicTrainingJson(
        root,
        'detox-training-sql.private.json',
        { kind: 'private-detox-training-sql-source' },
        { signal: cancelled.signal, deadlineAt: performance.now() + 10_000 },
      ),
      /sidecar cancelled|cancel/i,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Training evidence reader rejects hardlinks and aborted reads before publication', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-reader-'));
  try {
    const original = path.join(root, 'detox-training-reader.json');
    const alias = path.join(root, 'detox-training-reader-alias.json');
    await writeFile(original, '{}\n', { mode: 0o600 });
    await link(original, alias);
    await assert.rejects(
      readOwnedTrainingFile(root, 'detox-training-reader-alias.json', 1024),
      /owned|immutable|bounded/i,
    );
    const controller = new AbortController();
    controller.abort(new Error('reader cancelled'));
    await assert.rejects(
      readOwnedTrainingFile(root, 'detox-training-reader.json', 1024, {
        signal: controller.signal,
        deadlineAt: performance.now() + 10_000,
      }),
      /reader cancelled|cancel/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Atomic writer rejects a supplied leaf symlink before target mutation', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'detox-training-root-alias-parent-'));
  const target = await mkdtemp(path.join(os.tmpdir(), 'detox-training-root-alias-target-'));
  const alias = path.join(parent, 'artifact-root');
  try {
    await symlink(target, alias, 'dir');
    await assert.rejects(
      writeAtomicTrainingBytes(
        alias,
        'detox-training-root-alias.json',
        Buffer.from('must-not-write-through-alias'),
        1024,
      ),
      /private directory|symbolic|symlink/i,
    );
    assert.deepEqual(await readdir(target), []);
    assert.equal((await lstat(alias)).isSymbolicLink(), true);
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

void test('Atomic child evidence publication removes an interrupted temporary write', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-atomic-write-'));
  try {
    let signalReads = 0;
    const signal = {
      get aborted() {
        signalReads += 1;
        return signalReads >= 4;
      },
      reason: new Error('injected partial-write cancellation'),
    } as unknown as AbortSignal;
    await assert.rejects(
      writeAtomicTrainingBytes(
        root,
        'detox-training-partial.png',
        Buffer.alloc(128 * 1024, 7),
        16 * 1024 * 1024,
        { signal, deadlineAt: performance.now() + 10_000 },
      ),
      /partial-write cancellation|cancel/i,
    );
    const names = await readdir(root);
    assert.equal(names.includes('detox-training-partial.png'), false);
    assert.equal(
      names.some((name) => name.includes('detox-training-partial.png.tmp-')),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Atomic publication never replaces a final created after the initial absence check', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-atomic-no-replace-'));
  const name = 'detox-training-no-replace.json';
  const foreign = Buffer.from('foreign-evidence');
  try {
    await assert.rejects(
      writeAtomicTrainingBytes(root, name, Buffer.from('owned-evidence'), 1024, {
        beforePublish: async ({ final }) => {
          await writeFile(final, foreign, { flag: 'wx', mode: 0o600 });
        },
      }),
      /already exists|EEXIST|publication/i,
    );
    assert.deepEqual(await readFile(path.join(root, name)), foreign);
    assert.equal(
      (await readdir(root)).some((entry) => entry.includes(`${name}.tmp-`)),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Atomic publication preserves a same-size replacement after abort and reports recovery failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-atomic-owner-fence-'));
  const name = 'detox-training-owner-fence.json';
  const foreign = Buffer.from('owned-evidence');
  const controller = new AbortController();
  try {
    await assert.rejects(
      writeAtomicTrainingBytes(root, name, Buffer.from('owned-evidence'), 1024, {
        signal: controller.signal,
        afterPublish: async ({ final }) => {
          await rm(final);
          await writeFile(final, foreign, { flag: 'wx', mode: 0o600 });
          controller.abort(new Error('post-publish cancellation'));
        },
      }),
      /recovery|post-publish cancellation|cancel/i,
    );
    assert.deepEqual(await readFile(path.join(root, name)), foreign);
    assert.equal(
      (await readdir(root)).some((entry) => entry.includes(`${name}.tmp-`)),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Atomic publication rejects an abort after temporary unlink and cleans the owned final', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-atomic-late-abort-'));
  const controller = new AbortController();
  const name = 'detox-training-late-abort.json';
  try {
    await assert.rejects(
      writeAtomicTrainingBytes(root, name, Buffer.from('late-abort-evidence'), 1024, {
        signal: controller.signal,
        afterTemporaryUnlink: () => {
          controller.abort(new Error('temporary-unlink cancellation'));
        },
      }),
      /temporary-unlink cancellation|cancel|recovery/i,
    );
    assert.equal((await readdir(root)).includes(name), false);
    assert.equal(
      (await readdir(root)).some((entry) => entry.includes(`${name}.tmp-`)),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Atomic publication rejects a deadline after temporary unlink and cleans the owned final', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-atomic-late-deadline-'));
  let afterTemporaryUnlink = false;
  const name = 'detox-training-late-deadline.json';
  try {
    await assert.rejects(
      writeAtomicTrainingBytes(root, name, Buffer.from('late-deadline-evidence'), 1024, {
        get deadlineAt() {
          return afterTemporaryUnlink ? performance.now() - 1 : performance.now() + 10_000;
        },
        afterTemporaryUnlink: () => {
          afterTemporaryUnlink = true;
        },
      }),
      /deadline/i,
    );
    assert.equal((await readdir(root)).includes(name), false);
    assert.equal(
      (await readdir(root)).some((entry) => entry.includes(`${name}.tmp-`)),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Training receipt reads back original hierarchy, screenshot and getAttributes bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-receipt-'));
  try {
    const step = buildDetoxTrainingStepPlan({
      platform: 'ios',
      title: `QA training ${input.attemptId}`,
      exerciseId: input.exerciseId,
      exerciseName: input.exerciseName,
    }).find((row) => row.id === 'training-local-draft')!;
    const receipt = await writeStepEvidence(root, step);
    await rm(path.join(root, `detox-training-${step.id}-producer.png`));
    assert.doesNotThrow(() => requireDetoxTrainingStepReceipt(receipt, step));
    const verified = await verifyDetoxTrainingStepReceipt({
      artifactRoot: root,
      step,
      receipt: receipt as never,
      expectedRunId: runId,
      expectedAttemptId: input.attemptId,
    });
    assert.equal(verified.selectorEvidence?.length, step.selectors.length);
    const wrongBinding = { ...receipt, attemptId: `${'b'.repeat(24)}:first` };
    await assert.rejects(
      verifyDetoxTrainingStepReceipt({
        artifactRoot: root,
        step,
        receipt: wrongBinding as never,
        expectedRunId: runId,
        expectedAttemptId: input.attemptId,
      }),
      /Expected values|bbbb/i,
    );
    const bad = {
      ...receipt,
      sourceReceipts: {
        ...receipt.sourceReceipts,
        screenshot: {
          ...receipt.sourceReceipts.screenshot,
          sourceSha256: '0'.repeat(64),
        },
      },
    };
    await assert.rejects(
      verifyDetoxTrainingStepReceipt({
        artifactRoot: root,
        step,
        receipt: bad as never,
      }),
      /hash|changed|expected/i,
    );
    await writeFile(path.join(root, receipt.sourceFiles.screenshot), Buffer.from('not-a-png'));
    await assert.rejects(
      verifyDetoxTrainingStepReceipt({ artifactRoot: root, step, receipt }),
      /hash|changed|PNG|producer|expected|byte/i,
    );
    await writeFile(
      path.join(root, receipt.sourceFiles.screenshot),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
      { mode: 0o600 },
    );
    const unsafe = {
      ...receipt,
      sourceReceipts: {
        ...receipt.sourceReceipts,
        screenshot: { ...receipt.sourceReceipts.screenshot, sourceMode: 0o644 },
      },
    };
    assert.throws(() => requireDetoxTrainingStepReceipt(unsafe, step));
    const escapedSnapshot = {
      ...receipt,
      sourceReceipts: {
        ...receipt.sourceReceipts,
        screenshot: {
          ...receipt.sourceReceipts.screenshot,
          producerSnapshotPath: path.join(os.tmpdir(), 'foreign-detox-training-snapshot.png'),
          producerSnapshotRealpath: path.join(os.tmpdir(), 'foreign-detox-training-snapshot.png'),
        },
      },
    };
    await assert.rejects(
      verifyDetoxTrainingStepReceipt({
        artifactRoot: root,
        step,
        receipt: escapedSnapshot as never,
      }),
      /escaped artifact root/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Training response identity cannot be replayed for another command', () => {
  const command = {
    schemaVersion: 1 as const,
    kind: 'private-detox-training-command' as const,
    commandId: 7,
    runId,
    attemptId: input.attemptId,
    platform: 'ios' as const,
    timeoutMs: 1_000,
    commandKind: 'shutdown' as const,
    commandHash: '',
  };
  command.commandHash = hashJson({ ...command, commandHash: undefined });
  const response = {
    schemaVersion: 1 as const,
    kind: 'private-detox-training-response' as const,
    commandId: command.commandId,
    commandHash: command.commandHash,
    commandKind: command.commandKind,
    runId,
    attemptId: input.attemptId,
    platform: 'ios' as const,
    status: 'completed' as const,
    childIdentity: child,
    startedMonotonicMs: 1,
    finishedMonotonicMs: 2,
  };
  assert.doesNotThrow(() => assertTrainingResponse(response, command, child));
  assert.throws(
    () => assertTrainingResponse({ ...response, commandId: 8 }, command, child),
    /command identity/i,
  );
  assert.throws(
    () => assertTrainingResponse({ ...response, commandHash: 'f'.repeat(64) }, command, child),
    /command identity/i,
  );
});

void test('The child client drains initial-write cancellation evidence after the writer rejects', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-initial-write-cancel-'));
  const controller = new AbortController();
  let command: ReturnType<typeof assertTrainingCommand> | undefined;
  let commandWritten: (() => void) | undefined;
  let cancellationOptions: { signal?: AbortSignal; deadlineAt?: number } | undefined;
  const writeEvidence: DetoxTrainingEvidenceWriter = async (writeRoot, name, value, options) => {
    if (name.includes('cancel-')) cancellationOptions = options;
    await writeAtomicTrainingJson(writeRoot, name, value, options);
    if (name.includes('command-')) {
      command = assertTrainingCommand(value);
      controller.abort(new Error('initial training command cancellation'));
      commandWritten?.();
      throw controller.signal.reason;
    }
  };
  const publishCancellation: DetoxTrainingCancellationWriter = async (
    writeRoot,
    cancellationCommand,
    options,
  ) => {
    cancellationOptions = options;
    await publishTrainingCancellation(writeRoot, cancellationCommand, options);
  };
  const step = buildDetoxTrainingStepPlan({
    platform: 'ios',
    title: `QA training ${input.attemptId}`,
    exerciseId: input.exerciseId,
    exerciseName: input.exerciseName,
  }).find((row) => row.id === 'training-normal-entry')!;
  const client = new DetoxTrainingChildClient({
    artifactRoot: root,
    platform: 'ios',
    runId,
    attemptId: input.attemptId,
    signal: controller.signal,
    deadlineAt: performance.now() + 5_000,
    expectedChild: child,
    writeEvidence,
    publishCancellation,
  });
  const ready = new Promise<void>((resolve) => {
    commandWritten = resolve;
  });
  try {
    const pending = client.runTrainingStep(step);
    await ready;
    await assert.rejects(pending, /initial training command cancellation|cancellation evidence/i);
    assert(command);
    const cancellation = JSON.parse(
      await readFile(
        path.join(root, `detox-training-cancel-${command.commandId}.private.json`),
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.equal(cancellation.commandId, command.commandId);
    assert.equal(cancellation.commandHash, command.commandHash);
    assert(cancellationOptions);
    assert(cancellationOptions.signal);
    assert.equal(cancellationOptions.signal.aborted, false);
    assert(typeof cancellationOptions.deadlineAt === 'number');
  } finally {
    client.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test('The child client publishes cancellation and rejects a late completed response', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-late-response-'));
  const controller = new AbortController();
  try {
    const step = buildDetoxTrainingStepPlan({
      platform: 'ios',
      title: `QA training ${input.attemptId}`,
      exerciseId: input.exerciseId,
      exerciseName: input.exerciseName,
    }).find((row) => row.id === 'training-normal-entry')!;
    const client = new DetoxTrainingChildClient({
      artifactRoot: root,
      platform: 'ios',
      runId,
      attemptId: input.attemptId,
      signal: controller.signal,
      deadlineAt: performance.now() + 5_000,
      expectedChild: child,
    });
    const pending = client.runTrainingStep(step);
    const rejection = assert.rejects(pending, /late successful|cancellation/i);
    const command = await waitForTrainingCommand({
      root,
      afterCommandId: 0,
      deadlineAt: performance.now() + 2_000,
    });
    const receipt = await writeStepEvidence(root, step);
    controller.abort(new Error('late-response cancellation'));
    await writeAtomicTrainingJson(
      root,
      `detox-training-response-${command.commandId}.private.json`,
      {
        schemaVersion: 1,
        kind: 'private-detox-training-response',
        commandId: command.commandId,
        commandHash: command.commandHash,
        commandKind: command.commandKind,
        runId,
        attemptId: input.attemptId,
        platform: 'ios',
        status: 'completed',
        childIdentity: child,
        startedMonotonicMs: 1,
        finishedMonotonicMs: 2,
        stepReceipt: receipt,
      },
    );
    await rejection;
    assert.equal(
      (await readdir(root)).includes(`detox-training-cancel-${command.commandId}.private.json`),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('The actual child action module contains only owned Detox operations and restart fences', async () => {
  const source = await readFile(
    path.join(repositoryRoot, 'scripts/testing/detox-training-child-actions.js'),
    'utf8',
  );
  for (const token of [
    'generateViewHierarchyXml',
    'takeScreenshot',
    'getAttributes',
    'launchApp',
    'disableSynchronization',
    'detox-training-child-protocol.mjs',
    'writeAtomicTrainingBytes',
    'readOwnedTrainingPath',
    'signal',
    'deadlineAt',
  ])
    assert(source.includes(token), token);
  const child = await readFile(
    path.join(repositoryRoot, 'e2e/detox-integrated-connection-baseline.e2e.test.js'),
    'utf8',
  );
  for (const token of [
    'monitorTrainingCancellation',
    'AbortController',
    'publishTrainingResult',
    'publishTrainingResponse',
    'command.appIdentifier',
    'command.launchCount',
  ])
    assert(child.includes(token), token);
});

void test('The actual child capture path preserves foreign publication races through the shared writer', async () => {
  const { executeTrainingStep } =
    (await import('../../scripts/testing/detox-training-child-actions.js')) as unknown as {
      executeTrainingStep: (runtime: unknown, step: DetoxTrainingStep) => Promise<unknown>;
    };
  const step = buildDetoxTrainingStepPlan({
    platform: 'ios',
    title: `QA training ${input.attemptId}`,
    exerciseId: input.exerciseId,
    exerciseName: input.exerciseName,
  }).find((row) => row.id === 'training-normal-entry')!;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const makeRuntime = (root: string, signal: AbortSignal, hooks: Record<string, unknown>) => ({
    artifactRoot: root,
    signal,
    deadlineAt: performance.now() + 10_000,
    childIdentity: child,
    runId,
    attemptId: input.attemptId,
    commandId: 9,
    commandHash: 'e'.repeat(64),
    platform: 'ios',
    __testPublicationHooks: hooks,
    by: {
      id: (selector: string) => selector,
      text: (selector: string) => selector,
    },
    element: (selector: string) => ({
      getAttributes: () =>
        Promise.resolve({
          identifier: selector,
          enabled: true,
          visible: true,
          hittable: true,
          frame: { x: 0, y: 0, width: 100, height: 50 },
        }),
      scroll: () => Promise.resolve(),
      tap: () => Promise.resolve(),
      replaceText: () => Promise.resolve(),
    }),
    expect: () => ({
      toBeVisible: () => Promise.resolve(),
      not: { toBeVisible: () => Promise.resolve() },
    }),
    device: {
      generateViewHierarchyXml: () => Promise.resolve('<ViewHierarchy />'),
      takeScreenshot: () => Promise.resolve(path.join(root, 'detox-producer.png')),
      dismissKeyboard: () => Promise.resolve(),
    },
  });
  const run = async (hooks: Record<string, unknown>, foreign: Buffer) => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'detox-training-child-writer-')),
    );
    await writeFile(path.join(root, 'detox-producer.png'), png, {
      mode: 0o600,
    });
    return {
      root,
      runtime: makeRuntime(root, new AbortController().signal, hooks),
      foreign,
    };
  };
  const first = await run(
    {
      beforePublish: async ({ fileName, final }: { fileName: string; final: string }) => {
        if (fileName === `detox-training-${step.id}.xml`)
          await writeFile(final, Buffer.from('foreign-child-evidence'), {
            flag: 'wx',
            mode: 0o600,
          });
      },
    },
    Buffer.from('foreign-child-evidence'),
  );
  try {
    await assert.rejects(executeTrainingStep(first.runtime, step), /exists|EEXIST|publication/i);
    assert.deepEqual(
      await readFile(path.join(first.root, `detox-training-${step.id}.xml`)),
      first.foreign,
    );
    assert.equal(
      (await readdir(first.root)).some((entry) => entry.includes('.tmp-')),
      false,
    );
  } finally {
    await rm(first.root, { recursive: true, force: true });
  }
  const controller = new AbortController();
  const replacement = Buffer.alloc(Buffer.byteLength('<ViewHierarchy />'), 102);
  const second = await run(
    {
      afterPublish: async ({ fileName, final }: { fileName: string; final: string }) => {
        if (fileName === `detox-training-${step.id}.xml`) {
          await rm(final);
          await writeFile(final, replacement, { flag: 'wx', mode: 0o600 });
          controller.abort(new Error('child post-publish cancellation'));
        }
      },
    },
    replacement,
  );
  second.runtime = { ...second.runtime, signal: controller.signal };
  try {
    await assert.rejects(
      executeTrainingStep(second.runtime, step),
      /recovery|cancellation|cancel/i,
    );
    assert.deepEqual(
      await readFile(path.join(second.root, `detox-training-${step.id}.xml`)),
      replacement,
    );
    assert.equal(
      (await readdir(second.root)).some((entry) => entry.includes('.tmp-')),
      false,
    );
  } finally {
    await rm(second.root, { recursive: true, force: true });
  }
});

void test('Detox training journey binds UI, API, SQL and cleanup through one owner', async () => {
  const selected = await selection();
  requireDetoxTrainingSelection(selected);
  const seen: string[] = [];
  const shutdowns: string[] = [];
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-source-'));
  try {
    const result = await runDetoxTrainingJourney(
      await journeyOptions(root, selected, seen, shutdowns),
    );
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicPromotionEligible, false);
    assert.equal(result.planId, 'training_plan_11111111-1111-4111-8111-111111111111');
    assert.equal(
      (result.unrelatedState as { assertionId: string }).assertionId,
      'NAT-training-unrelated-state',
    );
    assert.deepEqual(seen, [
      'training-normal-entry',
      'training-local-draft',
      'training-first-save',
      'training-first-reopen',
      'training-edit-draft',
      'training-edited-save',
      'training-edited-reopen',
      'training-relaunch-read',
    ]);
    assert.deepEqual(shutdowns, ['shutdown']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('A cleanup failure suppresses the private journey result', async () => {
  const selected = await selection();
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-cleanup-failure-'));
  try {
    const options: DetoxTrainingJourneyOptions = {
      ...(await journeyOptions(root, selected, [])),
      cleanup: () =>
        Promise.resolve({
          status: 'failed' as const,
          failures: ['owned child did not reach its reap fence'],
        }),
    };
    await assert.rejects(runDetoxTrainingJourney(options), /cleanup/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('An aborted journey does not start a child action and still invokes cancelled cleanup', async () => {
  const selected = await selection();
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-abort-'));
  const controller = new AbortController();
  controller.abort(new Error('test cancellation'));
  const calls: string[] = [];
  try {
    const options: DetoxTrainingJourneyOptions = {
      ...(await journeyOptions(root, selected, calls)),
      signal: controller.signal,
      cleanup: ({ reason }) => {
        calls.push(`cleanup:${reason}`);
        return Promise.resolve({
          status: 'cleaned' as const,
          failures: [] as string[],
        });
      },
    };
    await assert.rejects(runDetoxTrainingJourney(options), /test cancellation|cancelled/i);
    assert.deepEqual(calls, ['cleanup:cancelled']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Transport rejects duplicate, injected, wrong-origin and missing detail observations', () => {
  const planId = 'training_plan_11111111-1111-4111-8111-111111111111';
  const good = [...transport(planId)];
  assert.deepEqual(
    requireDetoxTrainingTransport({
      observations: good,
      planId,
      exerciseId: input.exerciseId,
      targetOrigin,
    }),
    { createdRequests: 1, editedRequests: 1, durableReads: 3, catalogReads: 1 },
  );
  for (const mutate of [
    (rows: ProxyObservation[]) => rows.push(rows[0]),
    (rows: ProxyObservation[]) => {
      rows[0] = { ...rows[0], outcome: 'injected' };
    },
    (rows: ProxyObservation[]) => {
      rows[5] = { ...rows[5], targetOrigin: 'http://127.0.0.1:9002' };
    },
    (rows: ProxyObservation[]) => {
      rows.splice(3, 1);
    },
  ]) {
    const bad = structuredClone(good);
    mutate(bad);
    assert.throws(() =>
      requireDetoxTrainingTransport({
        observations: bad,
        planId,
        exerciseId: input.exerciseId,
        targetOrigin,
      }),
    );
  }
});

void test('Connection-only bridge fails closed before snapshot, API, SQL or cleanup acquisition', async () => {
  const selected = await selection();
  const calls: string[] = [];
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-training-blocked-'));
  try {
    await assert.rejects(
      runDetoxTrainingJourney({
        repositoryRoot,
        output: root,
        selection: selected,
        input,
        bridge: {} as DetoxTrainingUiBridge,
        snapshot: () => {
          calls.push('snapshot');
          return Promise.resolve(baseSnapshot());
        },
        readPlan: () => {
          calls.push('readPlan');
          return Promise.resolve({ status: 200, plan: null });
        },
        transport: () => [],
        targetOrigin,
        signal: new AbortController().signal,
        evidence: {} as DetoxTrainingBoundEvidence,
        cleanup: () => {
          calls.push('cleanup');
          return Promise.resolve({ status: 'cleaned', failures: [] });
        },
      }),
      /training step runner/i,
    );
    assert.deepEqual(calls, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
