import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { runDetoxSaveRetryChildCommand } from '../../scripts/testing/detox-save-retry-child-actions.js';
import {
  assertDetoxSaveRetryCommand,
  assertDetoxSaveRetryResponse,
  buildDetoxSaveRetryCommand,
  DETOX_SAVE_RETRY_DRAFT,
  selectorsForDetoxSaveRetryCommand,
  type DetoxSaveRetryCommand,
} from '../../scripts/testing/detox-save-retry-child-protocol.mjs';
import {
  runDetoxSaveRetryJourney,
  type DetoxSaveRetryChild,
  type DetoxSaveRetryDriverInput,
  type DetoxSaveRetryPlatform,
  type DetoxSaveRetryProxy,
  type DetoxSaveRetrySnapshot,
} from '../../scripts/testing/detox-save-retry-driver';

type CanonicalValidators = {
  requireNativeRetryDraft: (
    platform: DetoxSaveRetryPlatform,
    tree: unknown,
    enabled: boolean,
  ) => void;
  validateNativeRetrySnapshots: (
    before: DetoxSaveRetrySnapshot,
    failed: DetoxSaveRetrySnapshot,
    after: DetoxSaveRetrySnapshot,
    accountUid: string,
    platform: DetoxSaveRetryPlatform,
  ) => string;
};

type Tree = { attributes: Record<string, string>; children: Tree[] };

const identity = { pid: 32101, pgid: 32101, started: '2026-10-02T12:00:00.000Z' };
const runId = 'a'.repeat(24);
const attemptId = `${runId}:first`;
const planId = 'training_plan_11111111-1111-4111-8111-111111111111';
const errorText = 'Could not save plan. Try again.';
const targetOrigin = 'http://127.0.0.1:45000';

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  assert.equal(typeBytes.length, 4);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function validPngBytes(includeIdat = true): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunks = [pngChunk('IHDR', ihdr)];
  if (includeIdat) chunks.push(pngChunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))));
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

function id(platform: DetoxSaveRetryPlatform, value: string): string {
  return platform === 'android' ? `com.edufelip.mychampions.dev:id/${value}` : value;
}

function tree(platform: DetoxSaveRetryPlatform, saveEnabled: boolean): Tree {
  const fieldAttribute = platform === 'ios' ? 'value' : 'text';
  const quantityAttribute = platform === 'ios' ? 'accessibilityText' : 'text';
  return {
    attributes: {},
    children: [
      {
        attributes: {
          'resource-id': id(platform, 'pro.training_plan.name'),
          [fieldAttribute]: DETOX_SAVE_RETRY_DRAFT.title,
          enabled: 'true',
        },
        children: [],
      },
      {
        attributes: {
          'resource-id': id(platform, 'pro.training_plan.saveButton'),
          enabled: String(saveEnabled),
        },
        children: [],
      },
      {
        attributes: { 'resource-id': id(platform, 'pro.training_plan.sessionRow.Strength') },
        children: [
          {
            attributes: {
              'resource-id': id(platform, 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity'),
              [quantityAttribute]: DETOX_SAVE_RETRY_DRAFT.quantity,
            },
            children: [],
          },
        ],
      },
    ],
  };
}

function snapshot(platform: DetoxSaveRetryPlatform, plans: readonly Record<string, unknown>[]) {
  return {
    schemaVersion: 1,
    runId,
    scope: platform === 'ios' ? 'native-entry-ios' : 'native-entry-android',
    readOnly: true as const,
    trainingPlans: plans,
    connections: [],
  } satisfies DetoxSaveRetrySnapshot;
}

function savedPlan(): Record<string, unknown> {
  return {
    id: planId,
    studentAuthUid: 'coach',
    ownerProfessionalUid: 'coach',
    sourceKind: 'predefined',
    name: DETOX_SAVE_RETRY_DRAFT.title,
    isArchived: false,
    isDraft: false,
    lifecycleConnectionId: null,
    createdAt: '2026-10-02T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    sessions: [
      {
        name: DETOX_SAVE_RETRY_DRAFT.sessionName,
        items: [
          {
            name: DETOX_SAVE_RETRY_DRAFT.exerciseName,
            quantity: DETOX_SAVE_RETRY_DRAFT.quantity,
            exerciseId: DETOX_SAVE_RETRY_DRAFT.exerciseId,
          },
        ],
      },
    ],
  };
}

function actionReceipt(
  commandKind: string,
  platform: DetoxSaveRetryPlatform,
  commandPlanId = planId,
  commandErrorText = errorText,
) {
  const png = validPngBytes();
  const selectors = selectorsForDetoxSaveRetryCommand(
    commandKind as 'prepare-draft' | 'failed-save' | 'retry-save' | 'reopen',
    commandPlanId,
    commandErrorText,
  );
  const selectorObservations = selectors.map((selector) => ({
    selector,
    selectorKind: selector === 'OK' || selector === commandErrorText ? 'text' : 'id',
    attributes: { identifier: selector, visible: true, enabled: true },
    source: 'detox.element.getAttributes',
  }));
  const stat = {
    dev: 1,
    ino: 2,
    mode: 0o600,
    uid: 501,
    gid: 20,
    nlink: 1,
    size: png.length,
    mtimeMs: 1,
    ctimeMs: 1,
  };
  const hash = createHash('sha256').update(png).digest('hex');
  return {
    kind: 'private-detox-save-retry-action',
    phase: commandKind,
    state:
      commandKind === 'prepare-draft' || commandKind === 'failed-save'
        ? 'draft'
        : commandKind === 'reopen'
          ? 'reopened'
          : 'library',
    actionCount: 4,
    selectors,
    selectorObservations,
    hierarchyXml: '<hierarchy />',
    hierarchy: tree(platform, commandKind !== 'reopen'),
    hierarchySha256: createHash('sha256').update('<hierarchy />').digest('hex'),
    hierarchySource: 'detox.device.generateViewHierarchyXml',
    ...(commandKind === 'failed-save' ? { observedText: errorText } : {}),
    screenshot: {
      path: `/tmp/detox-save-retry-${commandKind}.png`,
      realpath: `/tmp/detox-save-retry-${commandKind}.png`,
      artifactRoot: '/tmp',
      bytes: png.length,
      sha256: hash,
      source: 'detox.device.takeScreenshot',
      producerPath: `/private/tmp/detox-save-retry-${commandKind}.png`,
      producerRealpath: `/private/tmp/detox-save-retry-${commandKind}.png`,
      producerStat: stat,
      producerSha256: hash,
      snapshotPath: `/tmp/detox-save-retry-${commandKind}.png`,
      snapshotStat: stat,
    },
    startedMonotonicMs: 1,
    finishedMonotonicMs: 2,
  };
}

function makeChild(platform: DetoxSaveRetryPlatform, calls: string[] = []): DetoxSaveRetryChild {
  const child = {
    identity,
    request(command: DetoxSaveRetryCommand) {
      calls.push(command.commandKind);
      return Promise.resolve({
        schemaVersion: 1,
        kind: 'private-detox-save-retry-response',
        commandId: command.commandId,
        commandHash: command.commandHash,
        commandKind: command.commandKind,
        runId,
        attemptId,
        platform,
        status: 'completed',
        childIdentity: identity,
        startedMonotonicMs: 1,
        finishedMonotonicMs: 2,
        ...(command.commandKind === 'shutdown'
          ? {}
          : {
              actionReceipt: actionReceipt(
                command.commandKind,
                platform,
                command.planId,
                command.errorText,
              ),
            }),
      });
    },
  } as unknown as DetoxSaveRetryChild;
  return child;
}

function makeProxy(
  options: {
    afterArm?: () => void;
    armError?: Error;
    onClear?: () => void;
  } = {},
) {
  let armed: { attemptId: string; injectedCount: number } | null = null;
  let injected = false;
  let requestId = 0;
  const observations: Record<string, unknown>[] = [];
  const credentialClassification = {
    authorization: 'bearer' as const,
    cookie: 'absent' as const,
    knownAccessCookie: 'absent' as const,
    knownRefreshCookie: 'absent' as const,
    otherCookiePresent: false,
    malformedCookiePresent: false,
  };
  const push = (row: Record<string, unknown>) =>
    observations.push({
      requestId: ++requestId,
      requestOrigin: null,
      requestProfile: 'native',
      targetOrigin,
      requestCredentialPresent: true,
      requestCredentialClassification: credentialClassification,
      ...row,
    });
  push({
    method: 'POST',
    pathHash: createHash('sha256').update('/auth/email/sign-in').digest('hex'),
    status: 201,
    outcome: 'forwarded',
    requestCredentialPresent: false,
    requestCredentialClassification: {
      authorization: 'absent',
      cookie: 'absent',
      knownAccessCookie: 'absent',
      knownRefreshCookie: 'absent',
      otherCookiePresent: false,
      malformedCookiePresent: false,
    },
    faultAttemptId: null,
  });
  push({
    method: 'GET',
    pathHash: createHash('sha256').update('/plans/predefined').digest('hex'),
    status: 200,
    outcome: 'forwarded',
    faultAttemptId: null,
  });
  push({
    method: 'POST',
    pathHash: createHash('sha256').update('/integrations/exercise/search').digest('hex'),
    status: 200,
    outcome: 'forwarded',
    faultAttemptId: null,
  });
  push({
    method: 'GET',
    pathHash: createHash('sha256')
      .update(`/integrations/exercise/exercises/${DETOX_SAVE_RETRY_DRAFT.exerciseId}`)
      .digest('hex'),
    status: 200,
    outcome: 'forwarded',
    faultAttemptId: null,
  });
  const proxy = {
    get requestIdFence() {
      return 0;
    },
    waitForQuiescence() {
      return Promise.resolve({ active: 0, outbound: 0 });
    },
    armObservedNativeSaveFault(input: { attemptId: string }) {
      assert.equal(armed, null);
      if (options.armError) throw options.armError;
      armed = { attemptId: input.attemptId, injectedCount: 0 };
      options.afterArm?.();
    },
    clearFault(attemptId: string) {
      options.onClear?.();
      assert.equal(armed?.attemptId, attemptId);
      const result = armed;
      armed = null;
      return result;
    },
    get faultState() {
      return armed && injected ? { ...armed, injectedCount: 1 } : armed;
    },
    get observations() {
      return observations;
    },
    markInjected(attemptId: string) {
      injected = true;
      if (armed) armed = { ...armed, injectedCount: 1 };
      push({
        method: 'POST',
        pathHash: '39fba87b65706bbbe102c30db7b5c352d03bc391ffa0d6c249525c48070b9da2',
        status: 503,
        outcome: 'injected',
        faultAttemptId: attemptId,
      });
    },
    markForwarded() {
      push({
        method: 'POST',
        pathHash: '39fba87b65706bbbe102c30db7b5c352d03bc391ffa0d6c249525c48070b9da2',
        status: 201,
        outcome: 'forwarded',
        faultAttemptId: null,
      });
    },
    markPatch(planPath = planId) {
      push({
        method: 'PATCH',
        pathHash: createHash('sha256').update(`/plans/training/${planPath}`).digest('hex'),
        status: 200,
        outcome: 'forwarded',
        faultAttemptId: null,
      });
    },
    markRead(readPlanId = planId) {
      push({
        method: 'GET',
        pathHash: createHash('sha256').update(`/plans/training/${readPlanId}`).digest('hex'),
        status: 200,
        outcome: 'forwarded',
        faultAttemptId: null,
      });
    },
    dropPatch() {
      const index = observations.findIndex(
        (row) =>
          row.method === 'PATCH' &&
          row.pathHash === createHash('sha256').update(`/plans/training/${planId}`).digest('hex'),
      );
      if (index >= 0) observations.splice(index, 1);
    },
    forgeOrigin() {
      const row = observations.find(
        (candidate) =>
          candidate.method === 'POST' &&
          candidate.pathHash ===
            '39fba87b65706bbbe102c30db7b5c352d03bc391ffa0d6c249525c48070b9da2' &&
          candidate.status === 201,
      );
      assert(row);
      row.requestOrigin = 'https://forged.invalid';
    },
  };
  return proxy as unknown as DetoxSaveRetryProxy & {
    markInjected: (attemptId: string) => void;
    markForwarded: () => void;
    markPatch: (planPath?: string) => void;
    markRead: (readPlanId?: string) => void;
    dropPatch: () => void;
    forgeOrigin: () => void;
  };
}

async function loadCanonicalValidators(): Promise<CanonicalValidators> {
  let repositoryRoot = process.env.MYCHAMPIONS_REPO_ROOT ?? process.cwd();
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(path.join(repositoryRoot, 'scripts/testing/native-save-retry-observation.ts')))
      break;
    repositoryRoot = path.dirname(repositoryRoot);
  }
  assert(existsSync(path.join(repositoryRoot, 'scripts/testing/native-save-retry-observation.ts')));
  const loaded: unknown = await import(
    pathToFileURL(path.join(repositoryRoot, 'scripts/testing/native-save-retry-observation.ts'))
      .href
  );
  const module = loaded as CanonicalValidators;
  return module;
}

function inputFor(
  platform: DetoxSaveRetryPlatform,
  validators: CanonicalValidators,
  child: DetoxSaveRetryChild,
  proxy: DetoxSaveRetryProxy,
  snapshotReader: () => Promise<DetoxSaveRetrySnapshot>,
): DetoxSaveRetryDriverInput {
  return {
    runId,
    attemptId,
    platform,
    accountUid: 'coach',
    targetOrigin,
    requestIdFence: 0,
    faultAttemptId: `native-save-${runId}`,
    child,
    proxy,
    snapshot: snapshotReader,
    readPlan: () => Promise.resolve({ status: 200, plan: savedPlan() }),
    validators: {
      requireDraft: validators.requireNativeRetryDraft,
      validateSnapshots: validators.validateNativeRetrySnapshots,
    },
    verifyScreenshot: (receipt: unknown) => {
      const row = receipt as { sha256?: string; bytes?: number };
      const bytes = validPngBytes();
      assert.equal(row.bytes, bytes.length);
      assert.equal(row.sha256, createHash('sha256').update(bytes).digest('hex'));
      return Promise.resolve(bytes);
    },
    errorText,
  };
}

for (const platform of ['ios', 'android'] as const) {
  void test(`Detox save/retry source orchestration binds canonical ${platform} draft and SQL validators`, async () => {
    const validators = await loadCanonicalValidators();
    const calls: string[] = [];
    const proxy = makeProxy();
    const child = makeChild(platform, calls) as unknown as {
      request: DetoxSaveRetryChild['request'];
      identity: typeof identity;
    };
    let snapshotCalls = 0;
    const before = snapshot(platform, []);
    const after = snapshot(platform, [savedPlan()]);
    const originalRequest = child.request;
    child.request = (command: DetoxSaveRetryCommand) => {
      if (command.commandKind === 'failed-save') proxy.markInjected(`native-save-${runId}`);
      if (command.commandKind === 'retry-save') {
        proxy.markForwarded();
        proxy.markPatch(planId);
      }
      return originalRequest(command);
    };
    const originalReadPlan = inputFor(platform, validators, child, proxy, () => {
      snapshotCalls += 1;
      return Promise.resolve(snapshotCalls < 4 ? before : after);
    });
    const driverInput = {
      ...originalReadPlan,
      readPlan: (id: string) => {
        assert.equal(id, planId);
        proxy.markRead(id);
        return Promise.resolve({ status: 200, plan: savedPlan() });
      },
    };
    const receipt = await runDetoxSaveRetryJourney(driverInput);
    assert.deepEqual(calls, ['prepare-draft', 'failed-save', 'retry-save', 'reopen']);
    assert.equal(receipt.platform, platform);
    assert.equal(receipt.planId, planId);
    assert.equal(receipt.nativePassingCases, 0);
    assert.equal(receipt.publicPromotionEligible, false);
  });
}

void test('Detox save/retry child actions use real platform-independent IDs and capture APIs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'detox-save-retry-child-'));
  await chmod(directory, 0o700);
  const screenshotPath = path.join(await realpath(directory), 'real-detox-capture.png');
  await writeFile(screenshotPath, validPngBytes(), { mode: 0o600 });
  const calls: string[] = [];
  const runtime = {
    platform: 'ios' as const,
    artifactRoot: directory,
    childIdentity: identity,
    selectorObservations: [],
    deadlineAt: performance.now() + 30_000,
    by: {
      id: (value: string) => ({ kind: 'id', value }),
      text: (value: string) => ({ kind: 'text', value }),
    },
    element: (matcher: { kind: string; value: string }) => ({
      matcher,
      getAttributes() {
        return Promise.resolve({ identifier: matcher.value, visible: true, enabled: true });
      },
      tap() {
        calls.push(`tap:${matcher.kind}:${matcher.value}`);
        return Promise.resolve();
      },
      replaceText(value: string) {
        calls.push(`replace:${matcher.value}:${value}`);
        return Promise.resolve();
      },
    }),
    waitFor: (target: { matcher: { kind: string; value: string } }) => ({
      toBeVisible: () => ({
        withTimeout() {
          calls.push(`visible:${target.matcher.value}`);
          return Promise.resolve();
        },
        whileElement: () => ({
          scroll() {
            calls.push(`scroll:${target.matcher.value}`);
            return Promise.resolve();
          },
        }),
      }),
      not: {
        toBeVisible: () => ({
          withTimeout() {
            calls.push(`absent:${target.matcher.value}`);
            return Promise.resolve();
          },
        }),
      },
    }),
    device: {
      generateViewHierarchyXml() {
        return Promise.resolve('<hierarchy />');
      },
      takeScreenshot() {
        return Promise.resolve(screenshotPath);
      },
    },
    parseHierarchy: () => Promise.resolve({ attributes: {}, children: [] }),
  };
  try {
    const command = buildDetoxSaveRetryCommand({
      commandId: 1,
      runId,
      attemptId,
      platform: 'ios',
      commandKind: 'prepare-draft',
    });
    const response = await runDetoxSaveRetryChildCommand(command, runtime);
    assert.equal(response.status, 'completed', JSON.stringify(response));
    assert.equal((response.actionReceipt as { state: string }).state, 'draft');
    assert(calls.includes('tap:id:tabs.training'));
    assert(calls.includes('replace:pro.training_plan.name:Native QA Draft'));
    assert(calls.includes('tap:id:exerciseSearch.confirm'));
    const invalidPngs = [
      ['not-a-png', Buffer.from('not-a-png')],
      ['missing-idat', validPngBytes(false)],
      [
        'bad-crc',
        (() => {
          const bytes = validPngBytes();
          bytes[bytes.length - 1] ^= 0xff;
          return bytes;
        })(),
      ],
      ['truncated', validPngBytes().subarray(0, -1)],
    ] as const;
    for (const [label, invalidPng] of invalidPngs) {
      await writeFile(screenshotPath, invalidPng, { mode: 0o600 });
      const invalidResponse = await runDetoxSaveRetryChildCommand(
        buildDetoxSaveRetryCommand({
          commandId: 2,
          runId,
          attemptId,
          platform: 'ios',
          commandKind: 'prepare-draft',
        }),
        runtime,
      );
      assert.equal(invalidResponse.status, 'failed', label);
      assert.match(
        (invalidResponse.error as { message: string }).message,
        /outside the bounded PNG read|not a PNG|IDAT|CRC|truncated|incomplete/,
        label,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('Detox save/retry protocol rejects command and child identity tampering', () => {
  const command = buildDetoxSaveRetryCommand({
    commandId: 1,
    runId,
    attemptId,
    platform: 'ios',
    commandKind: 'prepare-draft',
  });
  assert.throws(
    () => assertDetoxSaveRetryCommand({ ...command, commandHash: '0'.repeat(64) }),
    /command hash is stale/,
  );
  const response = {
    schemaVersion: 1,
    kind: 'private-detox-save-retry-response',
    commandId: command.commandId,
    commandHash: command.commandHash,
    commandKind: command.commandKind,
    runId,
    attemptId,
    platform: 'ios' as const,
    status: 'completed' as const,
    childIdentity: identity,
    startedMonotonicMs: 1,
    finishedMonotonicMs: 2,
    actionReceipt: actionReceipt('prepare-draft', 'ios'),
  };
  assert.throws(
    () =>
      assertDetoxSaveRetryResponse(
        { ...response, childIdentity: { ...identity, pid: identity.pid + 1 } },
        command,
        identity,
      ),
    /child identity changed/,
  );
  assert.throws(
    () =>
      assertDetoxSaveRetryResponse(
        {
          ...response,
          actionReceipt: {
            ...(response.actionReceipt as Record<string, unknown>),
            selectors: ['forged.selector'],
          },
        },
        command,
        identity,
      ),
    /selectors do not match/,
  );
  assert.throws(
    () =>
      assertDetoxSaveRetryResponse(
        {
          ...response,
          actionReceipt: {
            ...(response.actionReceipt as Record<string, unknown>),
            screenshot: {
              ...((response.actionReceipt as Record<string, unknown>).screenshot as Record<
                string,
                unknown
              >),
              producerSha256: '0'.repeat(64),
            },
          },
        },
        command,
        identity,
      ),
    /producer hash differs/,
  );
});

void test('Detox save/retry child rejects a runtime/command platform mismatch', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'detox-save-retry-platform-'));
  const canonicalDirectory = await realpath(directory);
  const screenshotPath = path.join(canonicalDirectory, 'capture.png');
  await writeFile(screenshotPath, validPngBytes(), { mode: 0o600 });
  const runtime = {
    platform: 'ios' as const,
    artifactRoot: canonicalDirectory,
    childIdentity: identity,
    selectorObservations: [],
    by: { id: (value: string) => ({ value }), text: (value: string) => ({ value }) },
    element: () => ({
      getAttributes: () => Promise.resolve({ visible: true }),
      tap: () => Promise.resolve(),
      replaceText: () => Promise.resolve(),
    }),
    waitFor: () => ({
      toBeVisible: () => ({
        withTimeout: () => Promise.resolve(),
        whileElement: () => ({ scroll: () => Promise.resolve() }),
      }),
      not: { toBeVisible: () => ({ withTimeout: () => Promise.resolve() }) },
    }),
    device: {
      generateViewHierarchyXml: () => Promise.resolve('<hierarchy />'),
      takeScreenshot: () => Promise.resolve(screenshotPath),
    },
    parseHierarchy: () => Promise.resolve({ attributes: {}, children: [] }),
  };
  try {
    await assert.rejects(
      runDetoxSaveRetryChildCommand(
        buildDetoxSaveRetryCommand({
          commandId: 1,
          runId,
          attemptId,
          platform: 'android',
          commandKind: 'prepare-draft',
        }),
        runtime,
      ),
      /platform does not match/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('Detox save/retry driver aborts before snapshot, proxy fault, or child acquisition', async () => {
  const controller = new AbortController();
  controller.abort(new Error('pre-acquisition cancellation'));
  const validators = await loadCanonicalValidators();
  const proxy = makeProxy();
  const calls: string[] = [];
  let snapshots = 0;
  await assert.rejects(
    runDetoxSaveRetryJourney({
      ...inputFor('ios', validators, makeChild('ios', calls), proxy, () => {
        snapshots += 1;
        return Promise.resolve(snapshot('ios', []));
      }),
      signal: controller.signal,
    }),
    /pre-acquisition cancellation/,
  );
  assert.equal(snapshots, 0);
  assert.deepEqual(calls, []);
  assert.equal(proxy.faultState, null);
});

void test('Detox save/retry records fault ownership before an abort fence and clears an unconsumed fault', async () => {
  const validators = await loadCanonicalValidators();
  const controller = new AbortController();
  let clearCalls = 0;
  const proxy = makeProxy({
    afterArm: () => controller.abort(new Error('abort after fault arm')),
    onClear: () => {
      clearCalls += 1;
    },
  });
  await assert.rejects(
    runDetoxSaveRetryJourney({
      ...inputFor('ios', validators, makeChild('ios'), proxy, () =>
        Promise.resolve(snapshot('ios', [])),
      ),
      signal: controller.signal,
    }),
    /abort after fault arm/,
  );
  assert.equal(clearCalls, 1);
  assert.equal(proxy.faultState, null);
});

void test('Detox save/retry arm failure before ownership does not run fault cleanup', async () => {
  const validators = await loadCanonicalValidators();
  let clearCalls = 0;
  const proxy = makeProxy({
    armError: new Error('fault arm failed before ownership'),
    onClear: () => {
      clearCalls += 1;
    },
  });
  await assert.rejects(
    runDetoxSaveRetryJourney(
      inputFor('android', validators, makeChild('android'), proxy, () =>
        Promise.resolve(snapshot('android', [])),
      ),
    ),
    /fault arm failed before ownership/,
  );
  assert.equal(clearCalls, 0);
  assert.equal(proxy.faultState, null);
});

void test('Detox save/retry rejects a failure-time SQL mutation and still clears the one armed fault', async () => {
  const validators = await loadCanonicalValidators();
  const proxy = makeProxy();
  const child = makeChild('ios') as unknown as {
    request: DetoxSaveRetryChild['request'];
    identity: typeof identity;
  };
  const originalRequest = child.request;
  child.request = (command: DetoxSaveRetryCommand) => {
    if (command.commandKind === 'failed-save') proxy.markInjected(`native-save-${runId}`);
    return originalRequest(command);
  };
  let calls = 0;
  const before = snapshot('ios', []);
  const changed = snapshot('ios', [savedPlan()]);
  await assert.rejects(
    runDetoxSaveRetryJourney(
      inputFor('ios', validators, child, proxy, () => {
        calls += 1;
        return Promise.resolve(calls <= 2 ? before : changed);
      }),
    ),
    /changed owned SQL/,
  );
  assert.equal(calls, 3);
  assert.equal(proxy.faultState, null);
});

void test('Detox save/retry rejects duplicate pre-forward writes after otherwise valid state/API checks', async () => {
  const validators = await loadCanonicalValidators();
  const proxy = makeProxy();
  const child = makeChild('android') as unknown as {
    request: DetoxSaveRetryChild['request'];
    identity: typeof identity;
  };
  const originalRequest = child.request;
  child.request = (command: DetoxSaveRetryCommand) => {
    if (command.commandKind === 'failed-save') {
      proxy.markInjected(`native-save-${runId}`);
      proxy.markInjected(`native-save-${runId}`);
    }
    if (command.commandKind === 'retry-save') {
      proxy.markForwarded();
      proxy.markPatch(planId);
    }
    return originalRequest(command);
  };
  let calls = 0;
  const before = snapshot('android', []);
  const after = snapshot('android', [savedPlan()]);
  await assert.rejects(
    runDetoxSaveRetryJourney(
      inputFor('android', validators, child, proxy, () => {
        calls += 1;
        return Promise.resolve(calls < 4 ? before : after);
      }),
    ),
    /must issue one injected and one forwarded write/,
  );
  assert.equal(proxy.faultState, null);
});

void test('Detox save/retry rejects a durable PATCH receipt that disappears before finalization', async () => {
  const validators = await loadCanonicalValidators();
  const proxy = makeProxy();
  const child = makeChild('ios') as unknown as {
    request: DetoxSaveRetryChild['request'];
    identity: typeof identity;
  };
  const originalRequest = child.request;
  child.request = (command: DetoxSaveRetryCommand) => {
    if (command.commandKind === 'failed-save') proxy.markInjected(`native-save-${runId}`);
    if (command.commandKind === 'retry-save') {
      proxy.markForwarded();
      proxy.markPatch(planId);
    }
    return originalRequest(command);
  };
  let calls = 0;
  const before = snapshot('ios', []);
  const after = snapshot('ios', [savedPlan()]);
  await assert.rejects(
    runDetoxSaveRetryJourney({
      ...inputFor('ios', validators, child, proxy, () => {
        calls += 1;
        return Promise.resolve(calls < 4 ? before : after);
      }),
      readPlan: () => {
        proxy.dropPatch();
        proxy.markRead();
        return Promise.resolve({ status: 200, plan: savedPlan() });
      },
    }),
    /durable detail mutation/,
  );
  assert.equal(proxy.faultState, null);
});

void test('Detox save/retry rejects an origin-forged forwarded write', async () => {
  const validators = await loadCanonicalValidators();
  const proxy = makeProxy();
  const child = makeChild('android') as unknown as {
    request: DetoxSaveRetryChild['request'];
    identity: typeof identity;
  };
  const originalRequest = child.request;
  child.request = (command: DetoxSaveRetryCommand) => {
    if (command.commandKind === 'failed-save') proxy.markInjected(`native-save-${runId}`);
    if (command.commandKind === 'retry-save') {
      proxy.markForwarded();
      proxy.markPatch(planId);
      proxy.forgeOrigin();
    }
    return originalRequest(command);
  };
  let calls = 0;
  const before = snapshot('android', []);
  const after = snapshot('android', [savedPlan()]);
  await assert.rejects(
    runDetoxSaveRetryJourney(
      inputFor('android', validators, child, proxy, () => {
        calls += 1;
        return Promise.resolve(calls < 4 ? before : after);
      }),
    ),
    /origin was not native-bound|target origin changed/,
  );
  assert.equal(proxy.faultState, null);
});

void test('Detox save/retry rejects required transport rows excluded by the declared request fence', async () => {
  const validators = await loadCanonicalValidators();
  const proxy = makeProxy();
  const child = makeChild('ios') as unknown as {
    request: DetoxSaveRetryChild['request'];
    identity: typeof identity;
  };
  const originalRequest = child.request;
  child.request = (command: DetoxSaveRetryCommand) => {
    if (command.commandKind === 'failed-save') proxy.markInjected(`native-save-${runId}`);
    if (command.commandKind === 'retry-save') {
      proxy.markForwarded();
      proxy.markPatch(planId);
    }
    return originalRequest(command);
  };
  let calls = 0;
  const before = snapshot('ios', []);
  const after = snapshot('ios', [savedPlan()]);
  await assert.rejects(
    runDetoxSaveRetryJourney({
      ...inputFor('ios', validators, child, proxy, () => {
        calls += 1;
        return Promise.resolve(calls < 4 ? before : after);
      }),
      requestIdFence: 3,
    }),
    /must have one forwarded sign-in/,
  );
  assert.equal(proxy.faultState, null);
});

void test('Detox save/retry cancels an in-flight SQL snapshot read and clears no unarmed fault', async () => {
  const validators = await loadCanonicalValidators();
  const proxy = makeProxy();
  const controller = new AbortController();
  let calls = 0;
  const before = snapshot('ios', []);
  const child = makeChild('ios');
  const input = inputFor('ios', validators, child, proxy, () => {
    calls += 1;
    if (calls === 1) return Promise.resolve(before);
    return new Promise<DetoxSaveRetrySnapshot>(() => undefined);
  });
  const journey = runDetoxSaveRetryJourney({ ...input, signal: controller.signal });
  setTimeout(() => controller.abort(new Error('snapshot cancellation')), 10);
  await assert.rejects(journey, /snapshot cancellation/);
  assert.equal(calls, 2);
  assert.equal(proxy.faultState, null);
});

void test('Detox save/retry retains child failure and clears an already-consumed fault', async () => {
  const validators = await loadCanonicalValidators();
  const proxy = makeProxy();
  const child = makeChild('ios') as unknown as {
    request: DetoxSaveRetryChild['request'];
    identity: typeof identity;
  };
  const originalRequest = child.request;
  child.request = (command: DetoxSaveRetryCommand) => {
    if (command.commandKind === 'failed-save') {
      proxy.markInjected(`native-save-${runId}`);
      return originalRequest(command).then((value) => {
        const response = value as Record<string, unknown>;
        return {
          ...response,
          status: 'failed',
          error: { name: 'DetoxActionError', message: 'save button action failed' },
          actionReceipt: undefined,
        };
      });
    }
    return originalRequest(command);
  };
  const before = snapshot('ios', []);
  await assert.rejects(
    runDetoxSaveRetryJourney(
      inputFor('ios', validators, child, proxy, () => Promise.resolve(before)),
    ),
    /failed/,
  );
  assert.equal(proxy.faultState, null);
});
