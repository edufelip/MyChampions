import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
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
import { deflateSync } from 'node:zlib';
import {
  readOwnedDetoxConnectionFile,
  writeAtomicDetoxConnectionBytes,
} from '../../scripts/testing/detox-connection-evidence';
import {
  runDetoxConnectionDriverCleanup,
  runDetoxSaveRetryOnExistingConnectionOwner,
} from '../../scripts/testing/detox-integrated-connection-driver';
import { readActualDetoxRuntimeMetadata } from '../../scripts/testing/detox-runtime-build-metadata';
import { runDetoxSaveRetryChildCommand } from '../../scripts/testing/detox-save-retry-child-actions.js';
import { DetoxSaveRetryChildClient } from '../../scripts/testing/detox-save-retry-child-client';
import {
  buildDetoxSaveRetryCommand,
  type DetoxSaveRetryCommand,
} from '../../scripts/testing/detox-save-retry-child-protocol.mjs';
import {
  createDetoxSaveRetryTerminalFailure,
  createDetoxSaveRetryOuterFailureTerminal,
  requireCoachAuthTransition,
  requireFaultIdentity,
  requireMatchingDetoxSaveRetrySelection,
  runDetoxSaveRetryOnExistingOwner,
} from '../../scripts/testing/detox-save-retry-owned-dispatch';
import {
  selectNativePilotScenario,
  type NativePilotSelection,
} from '../../scripts/testing/native-pilot-contract';

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

const child = { pid: 32101, pgid: 32101, started: '2026-10-02T12:00:00.000Z' };
const runId = 'a'.repeat(24);
const attemptId = `${runId}:first`;

async function fixtureRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-save-retry-owner-')));
  await chmod(root, 0o700);
  return root;
}

async function waitForFile(root: string, name: string): Promise<void> {
  const deadline = performance.now() + 2_000;
  for (;;) {
    try {
      await readOwnedDetoxConnectionFile(root, name, 128 * 1024);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && !/owned bounded immutable file/i.test(String(error))) throw error;
    }
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${name}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function cancelledResponse(command: DetoxSaveRetryCommand, identity = child) {
  return {
    schemaVersion: 1,
    kind: 'private-detox-save-retry-response',
    commandId: command.commandId,
    commandHash: command.commandHash,
    commandKind: command.commandKind,
    runId: command.runId,
    attemptId: command.attemptId,
    platform: command.platform,
    status: 'cancelled',
    childIdentity: identity,
    startedMonotonicMs: 1,
    finishedMonotonicMs: 2,
    error: { name: 'AbortError', message: 'fixture cancelled' },
  };
}

async function publishResponse(root: string, command: DetoxSaveRetryCommand, response: unknown) {
  await writeAtomicDetoxConnectionBytes(
    root,
    `detox-save-retry-response-${command.commandId}.private.json`,
    Buffer.from(JSON.stringify(response) + '\n'),
    2 * 1024 * 1024,
  );
}

void test('owned Save/retry client rejects malformed or elapsed aggregate deadlines at construction', async () => {
  const root = await fixtureRoot();
  try {
    for (const deadlineAt of [Number.NaN, Number.POSITIVE_INFINITY, performance.now() - 1])
      assert.throws(
        () =>
          new DetoxSaveRetryChildClient({
            artifactRoot: root,
            platform: 'ios',
            signal: new AbortController().signal,
            deadlineAt,
            deadlineMs: 2_000,
            expectedChild: child,
          }),
        /deadline is invalid or elapsed/i,
      );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('owned Save/retry client publishes a namespaced cancellation and accepts only cancelled response', async () => {
  const root = await fixtureRoot();
  const controller = new AbortController();
  const client = new DetoxSaveRetryChildClient({
    artifactRoot: root,
    platform: 'ios',
    signal: controller.signal,
    deadlineMs: 2_000,
    expectedChild: child,
  });
  const command = buildDetoxSaveRetryCommand({
    commandId: 1,
    runId,
    attemptId: `${runId}:first`,
    platform: 'ios',
    commandKind: 'prepare-draft',
  });
  const pending = client.request(command);
  try {
    await waitForFile(root, 'detox-save-retry-command-1.private.json');
    controller.abort(new Error('fixture cancellation'));
    await waitForFile(root, 'detox-save-retry-cancel-1.private.json');
    const cancellation = JSON.parse(
      await readOwnedDetoxConnectionFile(
        root,
        'detox-save-retry-cancel-1.private.json',
        16 * 1024,
      ).then((bytes) => bytes.toString('utf8')),
    ) as Record<string, unknown>;
    assert.equal(cancellation.commandId, command.commandId);
    assert.equal(cancellation.commandHash, command.commandHash);
    await publishResponse(root, command, cancelledResponse(command));
    const response = (await pending) as { status: string };
    assert.equal(response.status, 'cancelled');
  } finally {
    client.close();
    await Promise.allSettled([pending]);
    await rm(root, { recursive: true, force: true });
  }
});

void test('owned Save/retry client rejects elapsed requests before writing a command', async () => {
  const root = await fixtureRoot();
  const client = new DetoxSaveRetryChildClient({
    artifactRoot: root,
    platform: 'ios',
    signal: new AbortController().signal,
    deadlineMs: 2_000,
    expectedChild: child,
  });
  const command = buildDetoxSaveRetryCommand({
    commandId: 1,
    runId,
    attemptId: `${runId}:first`,
    platform: 'ios',
    commandKind: 'prepare-draft',
  });
  try {
    await assert.rejects(
      () => client.request(command, { deadlineAt: performance.now() - 1 }),
      /deadline elapsed before request/i,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    client.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test('owned Save/retry client rejects a pre-aborted request without publishing command or cancel files', async () => {
  const root = await fixtureRoot();
  const controller = new AbortController();
  controller.abort(new Error('pre-aborted fixture'));
  const client = new DetoxSaveRetryChildClient({
    artifactRoot: root,
    platform: 'ios',
    signal: controller.signal,
    deadlineMs: 2_000,
    expectedChild: child,
  });
  const command = buildDetoxSaveRetryCommand({
    commandId: 1,
    runId,
    attemptId: `${runId}:first`,
    platform: 'ios',
    commandKind: 'prepare-draft',
  });
  try {
    await assert.rejects(() => client.request(command), /pre-aborted fixture/i);
    assert.deepEqual(await readdir(root), []);
  } finally {
    client.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test('owned Save/retry client rejects a response from a foreign child identity', async () => {
  const root = await fixtureRoot();
  const client = new DetoxSaveRetryChildClient({
    artifactRoot: root,
    platform: 'ios',
    signal: new AbortController().signal,
    deadlineMs: 2_000,
    expectedChild: child,
  });
  const command = buildDetoxSaveRetryCommand({
    commandId: 1,
    runId,
    attemptId: `${runId}:first`,
    platform: 'ios',
    commandKind: 'prepare-draft',
  });
  const pending = client.request(command);
  try {
    await waitForFile(root, 'detox-save-retry-command-1.private.json');
    await publishResponse(
      root,
      command,
      cancelledResponse(command, { ...child, pid: child.pid + 1 }),
    );
    await assert.rejects(pending, /child identity changed/i);
  } finally {
    client.close();
    await Promise.allSettled([pending]);
    await rm(root, { recursive: true, force: true });
  }
});

void test('Save/retry drain waits for the existing child and returns truthful ownership state', async () => {
  const root = await fixtureRoot();
  const controller = new AbortController();
  const client = new DetoxSaveRetryChildClient({
    artifactRoot: root,
    platform: 'ios',
    signal: controller.signal,
    deadlineMs: 2_000,
    expectedChild: child,
  });
  const command = buildDetoxSaveRetryCommand({
    commandId: 1,
    runId,
    attemptId: `${runId}:first`,
    platform: 'ios',
    commandKind: 'prepare-draft',
  });
  const pending = client.request(command);
  try {
    await waitForFile(root, 'detox-save-retry-command-1.private.json');
    const drainPromise = client.drain({ deadlineAt: performance.now() + 1_000 });
    await waitForFile(root, 'detox-save-retry-cancel-1.private.json');
    await publishResponse(root, command, cancelledResponse(command));
    const drain = await drainPromise;
    assert.equal(drain.status, 'verified');
    assert.deepEqual(drain.pendingCommandIds, []);
    assert.equal(((await pending) as { status: string }).status, 'cancelled');
    client.close();
  } finally {
    await Promise.allSettled([pending]);
    if (!client.terminalState().some((row) => row.status === 'pending')) client.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test('Save/retry drain records not-verified when a noncooperative child survives the cleanup deadline', async () => {
  const root = await fixtureRoot();
  const controller = new AbortController();
  const client = new DetoxSaveRetryChildClient({
    artifactRoot: root,
    platform: 'ios',
    signal: controller.signal,
    deadlineMs: 2_000,
    expectedChild: child,
  });
  const command = buildDetoxSaveRetryCommand({
    commandId: 1,
    runId,
    attemptId: `${runId}:first`,
    platform: 'ios',
    commandKind: 'prepare-draft',
  });
  const pending = client.request(command);
  try {
    await waitForFile(root, 'detox-save-retry-command-1.private.json');
    const drain = await client.drain({ deadlineAt: performance.now() + 20 });
    assert.equal(drain.status, 'not-verified');
    assert.deepEqual(drain.pendingCommandIds, [1]);
    controller.abort(new Error('cleanup control abort'));
    await assert.rejects(pending);
  } finally {
    await Promise.allSettled([pending]);
    if (!client.terminalState().some((row) => row.status === 'pending')) client.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test('Save/retry composed boundary binds coach identity and canonical shared fault identity', () => {
  const fixtures = {
    runId: 'b'.repeat(24),
    accounts: { coach: { authUid: 'coach-fixture' } },
  } as unknown as Parameters<typeof requireFaultIdentity>[0];
  assert.doesNotThrow(() =>
    requireCoachAuthTransition(
      {
        actor: 'coach',
        beforeRequestId: 10,
        authRequestId: 11,
        afterRequestId: 12,
        actorAuthUid: 'coach-fixture',
      },
      fixtures,
      'http://127.0.0.1:3000',
    ),
  );
  assert.throws(
    () =>
      requireCoachAuthTransition(
        {
          actor: 'student',
          beforeRequestId: 10,
          authRequestId: 11,
          afterRequestId: 12,
          actorAuthUid: 'coach-fixture',
        } as unknown as Parameters<typeof requireCoachAuthTransition>[0],
        fixtures,
        'http://127.0.0.1:3000',
      ),
    /coach/i,
  );
  const identity = requireFaultIdentity(fixtures, 'c'.repeat(24), 'c'.repeat(24));
  assert.equal(identity.faultAttemptId, `native-save-${fixtures.runId}`);
  assert.throws(() => requireFaultIdentity(fixtures, 'bad', 'bad'), /match/i);
});

void test('Save/retry terminal failure retains abort, child, proxy and evidence facts without a passing claim', () => {
  const controller = new AbortController();
  controller.abort(new Error('controlled abort'));
  const faultIdentity = {
    requestedRunId: runId,
    captureRunId: runId,
    backendRunId: 'b'.repeat(24),
    requestedAttemptId: `${runId}:first`,
    backendAttemptId: `${'b'.repeat(24)}:first`,
    faultAttemptId: `native-save-${'b'.repeat(24)}` as const,
  };
  const terminal = createDetoxSaveRetryTerminalFailure({
    error: new Error('save failed before retry'),
    signal: controller.signal,
    deadlineAt: performance.now() + 2_000,
    faultIdentity,
    coachAuthTransition: {
      actor: 'coach',
      beforeRequestId: 10,
      authRequestId: 11,
      afterRequestId: 12,
      actorAuthUid: 'coach-fixture',
    },
    childIdentity: child,
    childTerminalState: [],
    faultState: { attemptId: faultIdentity.faultAttemptId, injectedCount: 1 },
    proxyObservations: [{ requestId: 13 }],
    evidenceRefs: ['detox-save-retry-response-2.private.json'],
  });
  assert.equal(terminal.status, 'cancelled');
  assert.equal(terminal.nativePassingCases, 0);
  assert.equal(terminal.publicPromotionEligible, false);
  assert.deepEqual(terminal.proxyObservationRefs, [13]);
  assert.equal(terminal.cleanup.status, 'pending');
});

void test('Save/retry owner deep-compares the reselected canonical selection before acquisition', async () => {
  const args = {
    platform: 'ios' as const,
    engine: 'detox' as const,
    scenario: 'SCN-save-retry-ios',
    mode: 'integration' as const,
  };
  const inventory = JSON.parse(
    await (
      await import('node:fs/promises')
    ).readFile(
      path.join(
        process.env.MYCHAMPIONS_REPO_ROOT ?? process.cwd(),
        'docs/qa/native-pilot/inventory.json',
      ),
      'utf8',
    ),
  ) as { scenarios: unknown[] };
  const scenario = inventory.scenarios.find((row) => (row as { id?: string }).id === args.scenario);
  assert(scenario, 'Save/retry source control fixture is absent');
  const selection = {
    arguments: args,
    scenario,
    scenarioHash: 'a'.repeat(64),
    requirementHash: 'b'.repeat(64),
  } as unknown as NativePilotSelection;
  const current = structuredClone(selection);
  assert.deepEqual(requireMatchingDetoxSaveRetrySelection(current, selection), selection);
  current.requirementHash = 'c'.repeat(64);
  assert.throws(
    () => requireMatchingDetoxSaveRetrySelection(current, selection),
    /stale|different source root|deep/i,
  );
});

void test('Detox save/retry child actions use real platform-independent IDs and capture APIs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'detox-save-retry-child-'));
  await chmod(directory, 0o700);
  const screenshotPath = path.join(await realpath(directory), 'real-detox-capture.png');
  await writeFile(screenshotPath, validPngBytes(), { mode: 0o600 });
  const calls: string[] = [];
  const runtime = {
    platform: 'ios' as const,
    artifactRoot: directory,
    childIdentity: child,
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

void test('Save/retry composed cleanup waits on a verified drain before aggregate cleanup', async () => {
  const root = await fixtureRoot();
  const report: Record<string, unknown> = {};
  let closed = false;
  try {
    const result = await runDetoxConnectionDriverCleanup({
      artifactRoot: root,
      repositoryRoot: process.cwd(),
      report,
      reason: 'cancelled',
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 1_000,
      saveRetryClient: {
        drain: async () => {
          await Promise.resolve();
          return {
            status: 'verified' as const,
            pendingCommandIds: [],
            terminalCommandIds: [1],
            failures: [],
          };
        },
        close: () => {
          closed = true;
        },
      },
    });
    assert.equal(result.status, 'cleaned');
    assert.equal(result.recoveryStatus, 'verified');
    assert.equal(closed, true);
    assert.deepEqual(report.detoxSaveRetryTerminal, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Save/retry composed cleanup retains not-verified drain facts and fails closed', async () => {
  const root = await fixtureRoot();
  const report: Record<string, unknown> = {};
  try {
    const result = await runDetoxConnectionDriverCleanup({
      artifactRoot: root,
      repositoryRoot: process.cwd(),
      report,
      reason: 'cancelled',
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 1_000,
      saveRetryClient: {
        drain: async () => {
          await Promise.resolve();
          return {
            status: 'not-verified' as const,
            pendingCommandIds: [2],
            terminalCommandIds: [1],
            failures: ['controlled child remained pending'],
          };
        },
        close: () => undefined,
      },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.recoveryStatus, 'not-verified');
    assert.deepEqual(
      (report.detoxSaveRetryTerminal as { cleanup: { status: string } }).cleanup.status,
      'not-verified',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Save/retry not-verified drain lowers aggregate recovery and gates later owner cleanup', async () => {
  const root = await fixtureRoot();
  const destructive: string[] = [];
  const report: Record<string, unknown> = {};
  try {
    const result = await runDetoxConnectionDriverCleanup({
      artifactRoot: root,
      repositoryRoot: process.cwd(),
      report,
      reason: 'cancelled',
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 1_000,
      saveRetryClient: {
        drain: () =>
          Promise.resolve({
            status: 'not-verified' as const,
            pendingCommandIds: [7],
            terminalCommandIds: [1],
            failures: ['controlled pending child'],
          }),
        close: () => undefined,
      },
      client: {
        request: () => {
          destructive.push('child-shutdown');
          return Promise.resolve({ status: 'completed' } as never);
        },
        close: () => undefined,
      },
      child: {
        pid: child.pid,
        pgid: child.pgid,
        wait: () => {
          destructive.push('child-wait');
          return Promise.resolve();
        },
        stop: () => {
          destructive.push('child-stop');
          return Promise.resolve();
        },
        outcome: () => ({ code: null, signal: null }),
        censusFailure: () => undefined,
        outputFailure: () => undefined,
      },
      proxy: {
        stop: () => {
          destructive.push('proxy');
          return Promise.resolve();
        },
      },
      session: {
        manifest: { runId },
        stop: () => {
          destructive.push('backend');
          return Promise.resolve();
        },
      },
      target: {
        stop: () => {
          destructive.push('target');
          return Promise.resolve();
        },
      },
      reservation: {
        release: () => {
          destructive.push('app-port');
          return Promise.resolve();
        },
      },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.recoveryStatus, 'not-verified');
    assert.deepEqual(destructive, []);
    const terminal = report.detoxSaveRetryTerminal as Record<string, unknown>;
    assert.deepEqual((terminal.drain as Record<string, unknown>).pendingCommandIds, [7]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Save/retry thrown drain records uncertain state and gates later owner cleanup', async () => {
  const root = await fixtureRoot();
  const destructive: string[] = [];
  const report: Record<string, unknown> = {};
  const pendingTerminal = {
    commandId: 8,
    commandKind: 'prepare-draft' as const,
    status: 'pending' as const,
    commandHash: 'c'.repeat(64),
    responsePath: 'detox-save-retry-response-8.private.json',
    cancelPath: 'detox-save-retry-cancel-8.private.json',
    evidenceRefs: [],
  };
  try {
    const result = await runDetoxConnectionDriverCleanup({
      artifactRoot: root,
      repositoryRoot: process.cwd(),
      report,
      reason: 'cancelled',
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 1_000,
      saveRetryClient: {
        identity: child,
        terminalState: () => [pendingTerminal],
        drain: () => {
          throw new Error('Detox save/retry child drain deadline elapsed before result');
        },
        close: () => undefined,
      },
      client: {
        request: () => {
          destructive.push('child-shutdown');
          return Promise.resolve({ status: 'completed' } as never);
        },
        close: () => undefined,
      },
      child: {
        pid: child.pid,
        pgid: child.pgid,
        wait: () => {
          destructive.push('child-wait');
          return Promise.resolve();
        },
        stop: () => {
          destructive.push('child-stop');
          return Promise.resolve();
        },
        outcome: () => ({ code: null, signal: null }),
        censusFailure: () => undefined,
        outputFailure: () => undefined,
      },
      proxy: {
        stop: () => {
          destructive.push('proxy');
          return Promise.resolve();
        },
      },
      session: {
        manifest: { runId },
        stop: () => {
          destructive.push('backend');
          return Promise.resolve();
        },
      },
      target: {
        stop: () => {
          destructive.push('target');
          return Promise.resolve();
        },
      },
      reservation: {
        release: () => {
          destructive.push('app-port');
          return Promise.resolve();
        },
      },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.recoveryStatus, 'not-verified');
    assert.deepEqual(destructive, []);
    const terminal = report.detoxSaveRetryTerminal as Record<string, unknown>;
    const drain = terminal.drain as Record<string, unknown>;
    assert.equal(drain.status, 'not-verified');
    assert.deepEqual(drain.pendingCommandIds, [8]);
    assert.deepEqual(terminal.childTerminalState, [pendingTerminal]);
    assert.deepEqual(terminal.childIdentity, child);
    assert.deepEqual(drain.uncertainty, {
      kind: 'drain-throw-before-result',
      pendingCommandIdsKnown: false,
      terminalStateObserved: true,
      error: {
        name: 'Error',
        message: 'Detox save/retry child drain deadline elapsed before result',
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Save/retry delayed drain fulfillment cannot mutate the published timeout report', async () => {
  const root = await fixtureRoot();
  const report: Record<string, unknown> = {};
  let settled = false;
  const pendingTerminal = {
    commandId: 9,
    commandKind: 'prepare-draft' as const,
    status: 'pending' as const,
    commandHash: 'd'.repeat(64),
    responsePath: 'detox-save-retry-response-9.private.json',
    cancelPath: 'detox-save-retry-cancel-9.private.json',
    evidenceRefs: [],
  };
  try {
    const result = await runDetoxConnectionDriverCleanup({
      artifactRoot: root,
      repositoryRoot: process.cwd(),
      report,
      reason: 'cancelled',
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 40,
      saveRetryClient: {
        identity: child,
        terminalState: () => [pendingTerminal],
        drain: async () => {
          await new Promise((resolve) => setTimeout(resolve, 120));
          settled = true;
          return {
            status: 'not-verified' as const,
            pendingCommandIds: [9],
            terminalCommandIds: [],
            failures: ['late-not-verified'],
          };
        },
        close: () => undefined,
      },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.recoveryStatus, 'not-verified');
    const reportAtReturn = JSON.stringify(report);
    const receiptPath = path.join(root, 'detox-connection-cleanup.private.json');
    const receiptAtReturn = await readFile(receiptPath, 'utf8');
    const terminal = report.detoxSaveRetryTerminal as Record<string, unknown>;
    assert.equal(
      ((terminal.drain as Record<string, unknown>).uncertainty as Record<string, unknown>).kind,
      'drain-timeout-before-result',
    );
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.equal(settled, true);
    assert.equal(JSON.stringify(report), reportAtReturn);
    assert.equal(await readFile(receiptPath, 'utf8'), receiptAtReturn);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Save/retry delayed drain rejection cannot replace the published timeout uncertainty', async () => {
  const root = await fixtureRoot();
  const report: Record<string, unknown> = {};
  let settled = false;
  const pendingTerminal = {
    commandId: 10,
    commandKind: 'prepare-draft' as const,
    status: 'pending' as const,
    commandHash: 'e'.repeat(64),
    responsePath: 'detox-save-retry-response-10.private.json',
    cancelPath: 'detox-save-retry-cancel-10.private.json',
    evidenceRefs: [],
  };
  try {
    const result = await runDetoxConnectionDriverCleanup({
      artifactRoot: root,
      repositoryRoot: process.cwd(),
      report,
      reason: 'cancelled',
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 40,
      saveRetryClient: {
        identity: child,
        terminalState: () => [pendingTerminal],
        drain: async () => {
          await new Promise((resolve) => setTimeout(resolve, 120));
          settled = true;
          throw new Error('late-drain-rejection');
        },
        close: () => undefined,
      },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.recoveryStatus, 'not-verified');
    const reportAtReturn = JSON.stringify(report);
    const receiptPath = path.join(root, 'detox-connection-cleanup.private.json');
    const receiptAtReturn = await readFile(receiptPath, 'utf8');
    const terminal = report.detoxSaveRetryTerminal as Record<string, unknown>;
    assert.equal(
      ((terminal.drain as Record<string, unknown>).uncertainty as Record<string, unknown>).kind,
      'drain-timeout-before-result',
    );
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.equal(settled, true);
    assert.equal(JSON.stringify(report), reportAtReturn);
    assert.equal(await readFile(receiptPath, 'utf8'), receiptAtReturn);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

type CompositionHarness = {
  parent: string;
  output: string;
  fixtures: unknown;
  session: unknown;
  proxy: unknown;
  child: unknown;
  childIdentity: typeof child;
  screenshotCalls: string[];
  producerContext: {
    build: typeof compositionBuild;
    runtimeMetadata: Awaited<ReturnType<typeof readActualDetoxRuntimeMetadata>>;
  };
};

const composedRunId = 'd'.repeat(24);
const composedPlanId = 'training_plan_00000000-0000-4000-8000-000000000001';
const composedCoachUid = 'coach-composition-fixture';
const composedOrigin = 'http://127.0.0.1:3010';
const compositionBuild = {
  source: { sourceTreeHash: 'a'.repeat(64) },
  helperInputsHash: 'b'.repeat(64),
  binaryHash: 'c'.repeat(64),
  detoxConfigHash: 'd'.repeat(64),
};

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function composedPlan() {
  return {
    id: composedPlanId,
    studentAuthUid: 'student-composition-fixture',
    ownerProfessionalUid: composedCoachUid,
    sourceKind: 'predefined',
    name: 'Native QA Draft',
    isArchived: false,
    isDraft: false,
    lifecycleConnectionId: null,
    sessions: [
      {
        id: 'composition-session',
        name: 'Strength',
        notes: '',
        items: [
          {
            id: 'composition-item',
            name: 'en QA Exercise 1',
            notes: '',
            quantity: '3x8',
            exerciseId: '00000000-0000-4000-8000-000000000001',
          },
        ],
      },
    ],
    createdAt: '2026-10-02T12:00:00.000Z',
    updatedAt: '2026-10-02T12:00:01.000Z',
  };
}

function composedDomainSnapshot(withPlan: boolean) {
  return {
    schemaVersion: 1,
    runId: composedRunId,
    scope: 'native-entry-ios',
    readOnly: true,
    trainingPlans: withPlan ? [composedPlan()] : [],
    connections: [],
  };
}

function composedHierarchy(commandKind: string): unknown {
  const saveEnabled = commandKind === 'reopen' ? 'false' : 'true';
  return {
    attributes: {},
    children: [
      {
        attributes: {
          'resource-id': 'pro.training_plan.name',
          value: 'Native QA Draft',
          enabled: 'true',
        },
        children: [],
      },
      {
        attributes: { 'resource-id': 'pro.training_plan.saveButton', enabled: saveEnabled },
        children: [],
      },
      {
        attributes: { 'resource-id': 'pro.training_plan.sessionRow.Strength' },
        children: [
          {
            attributes: {
              'resource-id': 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity',
              accessibilityText: '3x8',
            },
            children: [],
          },
        ],
      },
    ],
  };
}

function composedObservation(
  requestId: number,
  method: string,
  route: string,
  status: number,
  outcome: 'forwarded' | 'injected',
  faultAttemptId: string | null = null,
  credentials = true,
) {
  return {
    requestId,
    method,
    pathHash: hashText(route),
    requestOrigin: null,
    requestProfile: 'native' as const,
    requestCredentialPresent: credentials,
    ...(credentials
      ? {
          requestCredentialClassification: {
            authorization: 'bearer' as const,
            cookie: 'absent' as const,
            knownAccessCookie: 'absent' as const,
            knownRefreshCookie: 'absent' as const,
            otherCookiePresent: false,
            malformedCookiePresent: false,
          },
        }
      : {}),
    targetOrigin: composedOrigin,
    status,
    outcome,
    faultAttemptId,
  };
}

function composedObservations() {
  const planPath = `/plans/training/${composedPlanId}`;
  const faultAttemptId = `native-save-${composedRunId}`;
  return [
    composedObservation(11, 'POST', '/auth/email/sign-in', 201, 'forwarded', null, false),
    composedObservation(12, 'GET', '/plans/predefined', 200, 'forwarded'),
    composedObservation(13, 'POST', '/integrations/exercise/search', 200, 'forwarded'),
    composedObservation(
      14,
      'GET',
      '/integrations/exercise/exercises/00000000-0000-4000-8000-000000000001',
      200,
      'forwarded',
    ),
    composedObservation(15, 'POST', '/plans/training', 503, 'injected', faultAttemptId),
    composedObservation(16, 'POST', '/plans/training', 201, 'forwarded', null),
    composedObservation(17, 'PATCH', planPath, 200, 'forwarded', null),
    composedObservation(18, 'GET', planPath, 200, 'forwarded', null),
    composedObservation(19, 'GET', planPath, 200, 'forwarded', null),
  ];
}

async function makeCompositionHarness(
  failCommand?: string,
  repositoryRoot = process.cwd(),
): Promise<CompositionHarness & { report: Record<string, unknown> }> {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-save-retry-compose-')));
  await chmod(parent, 0o700);
  const output = path.join(parent, composedRunId);
  await mkdir(output, { mode: 0o700 });
  const runtimeMetadata = await readActualDetoxRuntimeMetadata(repositoryRoot, 'e'.repeat(64));
  const screenshotPath = path.join(output, 'detox-composition-producer.png');
  await writeFile(screenshotPath, validPngBytes(), { mode: 0o600 });
  const screenshotCalls: string[] = [];
  let activeCommand = '';
  let snapshotAfterRetry = false;
  let faultState: { attemptId: string; injectedCount: number } | null = null;
  const controller = new AbortController();
  const runtime = {
    platform: 'ios' as const,
    artifactRoot: output,
    childIdentity: child,
    selectorObservations: [] as {
      selector: string;
      selectorKind: 'id' | 'text';
      attributes: Record<string, unknown>;
      source: 'detox.element.getAttributes';
    }[],
    signal: controller.signal,
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
        screenshotCalls.push(`tap:${matcher.kind}:${matcher.value}`);
        return Promise.resolve();
      },
      replaceText(value: string) {
        screenshotCalls.push(`replace:${matcher.value}:${value}`);
        return Promise.resolve();
      },
    }),
    waitFor: (target: { matcher: { kind: string; value: string } }) => ({
      toBeVisible: () => ({
        withTimeout() {
          screenshotCalls.push(`visible:${target.matcher.value}`);
          return Promise.resolve();
        },
        whileElement: () => ({
          scroll() {
            screenshotCalls.push(`scroll:${target.matcher.value}`);
            return Promise.resolve();
          },
        }),
      }),
      not: {
        toBeVisible: () => ({
          withTimeout() {
            screenshotCalls.push(`absent:${target.matcher.value}`);
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
    parseHierarchy: () => Promise.resolve(composedHierarchy(activeCommand)),
  };
  const { runDetoxSaveRetryChildCommand } =
    await import('../../scripts/testing/detox-save-retry-child-actions.js');
  const childClient = {
    identity: child,
    async request(
      command: Parameters<typeof runDetoxSaveRetryChildCommand>[0],
      options?: { signal?: AbortSignal },
    ) {
      options?.signal?.throwIfAborted();
      activeCommand = command.commandKind;
      if (failCommand === command.commandKind)
        throw new Error(`controlled ${command.commandKind} failure`);
      const response = await runDetoxSaveRetryChildCommand(command, runtime);
      if (response.status !== 'completed') {
        const error = response.error;
        const message =
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message?: unknown }).message)
            : response.status;
        throw new Error(String(message));
      }
      await publishResponse(output, command, response);
      if (command.commandKind === 'retry-save') snapshotAfterRetry = true;
      return response;
    },
    terminalState: () => [],
  };
  const observations = composedObservations();
  const proxy = {
    requestIdFence: 0,
    get faultState() {
      return faultState;
    },
    observations,
    armObservedNativeSaveFault(input: { attemptId: string }) {
      faultState = { attemptId: input.attemptId, injectedCount: 1 };
    },
    clearFault(attemptId: string) {
      assert.deepEqual(faultState, { attemptId, injectedCount: 1 });
      faultState = null;
      return { attemptId, injectedCount: 1 };
    },
    waitForQuiescence: () => Promise.resolve({ active: 0, outbound: 0 }),
    readObservedNativeTrainingPlan: () =>
      Promise.resolve({
        status: 200,
        plan: composedPlan(),
        verification: 'synthetic-source-control',
      }),
  };
  const baseline = composedDomainSnapshot(false);
  const after = composedDomainSnapshot(true);
  const session = {
    apiOrigin: composedOrigin,
    apiPid: 30100,
    snapshot(_scope: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      return Promise.resolve(structuredClone(snapshotAfterRetry ? after : baseline));
    },
  };
  const fixtures = {
    runId: composedRunId,
    scope: 'native-entry-ios',
    accounts: {
      coach: {
        email: 'coach@example.invalid',
        password: 'synthetic-source-control-only',
        authUid: composedCoachUid,
        role: 'professional',
      },
      student: {
        email: 'student@example.invalid',
        password: 'synthetic-source-control-only',
        authUid: 'student-composition-fixture',
        role: 'student',
      },
    },
  };
  return {
    parent,
    output,
    fixtures,
    session,
    proxy,
    child: childClient,
    childIdentity: child,
    screenshotCalls,
    report: {
      build: compositionBuild,
      detoxChild: {
        pid: child.pid,
        pgid: child.pgid,
        cwd: repositoryRoot,
        ownership: 'owned-process-group',
      },
      detoxChildIdentity: child,
      detoxTransportSource: [{ requestId: 11 }],
    },
    producerContext: { build: compositionBuild, runtimeMetadata },
  };
}

type ProjectionInventory = {
  sources: { paths: string[]; revision: string }[];
  scenarios: {
    ownerPaths?: string[];
    freshnessInputs?: { requirementPaths?: string[] };
    maestroFlow?: string;
  }[];
  views: { ownerPaths?: string[] }[];
  transitions: { ownerPaths?: string[] }[];
  [key: string]: unknown;
};

async function makeCurrentInventoryProjection(baseRoot: string) {
  const projection = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-save-retry-selection-')),
  );
  await chmod(projection, 0o700);
  const inventoryPath = path.join(baseRoot, 'docs/qa/native-pilot/inventory.json');
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as ProjectionInventory;
  const paths = new Set<string>();
  for (const source of inventory.sources)
    for (const relative of source.paths ?? []) paths.add(relative);
  for (const scenario of inventory.scenarios) {
    for (const relative of [
      ...(scenario.ownerPaths ?? []),
      ...(scenario.freshnessInputs?.requirementPaths ?? []),
    ])
      paths.add(relative);
    if (scenario.maestroFlow) paths.add(scenario.maestroFlow);
  }
  for (const view of inventory.views)
    for (const relative of view.ownerPaths ?? []) paths.add(relative);
  for (const transition of inventory.transitions)
    for (const relative of transition.ownerPaths ?? []) paths.add(relative);
  const hashes = new Map<string, string>();
  for (const relative of paths) {
    const source = await realpath(path.join(baseRoot, relative));
    const bytes = await readFile(source);
    const destination = path.join(projection, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { mode: 0o600 });
    hashes.set(relative, createHash('sha256').update(bytes).digest('hex'));
  }
  for (const source of inventory.sources) {
    assert.equal(source.paths.length, 1);
    const revision = hashes.get(source.paths[0]);
    assert(revision, `Projection source was not copied: ${source.paths[0]}`);
    source.revision = revision;
  }
  const destinationInventory = path.join(projection, 'docs/qa/native-pilot/inventory.json');
  await mkdir(path.dirname(destinationInventory), { recursive: true, mode: 0o700 });
  await writeFile(destinationInventory, JSON.stringify(inventory, null, 2) + '\n', { mode: 0o600 });
  const detoxPackage = await readFile(path.join(baseRoot, 'node_modules/detox/package.json'));
  const projectedDetoxPackage = path.join(projection, 'node_modules/detox/package.json');
  await mkdir(path.dirname(projectedDetoxPackage), { recursive: true, mode: 0o700 });
  await writeFile(projectedDetoxPackage, detoxPackage, { mode: 0o600 });
  const selection = await selectNativePilotScenario(
    { platform: 'ios', engine: 'detox', scenario: 'SCN-save-retry-ios', mode: 'integration' },
    inventory,
    projection,
  );
  return { projection, selection };
}

async function makeCompositionSelection() {
  const baseRoot =
    process.env.MYCHAMPIONS_QUALIFIED_ROOT ?? process.env.MYCHAMPIONS_REPO_ROOT ?? process.cwd();
  return makeCurrentInventoryProjection(baseRoot);
}

void test('Save/retry dispatcher composes fresh selection, coach boundary, journey and terminal report', async () => {
  const selectionFixture = await makeCompositionSelection();
  const harness = await makeCompositionHarness(undefined, selectionFixture.projection);
  try {
    const result = await runDetoxSaveRetryOnExistingOwner({
      repositoryRoot: selectionFixture.projection,
      output: harness.output,
      selection: selectionFixture.selection,
      fixtures: harness.fixtures as never,
      session: harness.session as never,
      proxy: harness.proxy as never,
      child: harness.child as never,
      childIdentity: harness.childIdentity,
      coachAuthTransition: {
        actor: 'coach',
        beforeRequestId: 10,
        authRequestId: 11,
        afterRequestId: 12,
        actorAuthUid: composedCoachUid,
      },
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 30_000,
      report: harness.report,
      producerContext: harness.producerContext,
    });
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicPromotionEligible, false);
    assert.equal((harness.report.detoxSaveRetry as Record<string, unknown>).platform, 'ios');
    assert.equal(
      (harness.report.detoxSaveRetry as Record<string, unknown>).faultIdentity
        ? (
            (harness.report.detoxSaveRetry as Record<string, unknown>).faultIdentity as Record<
              string,
              unknown
            >
          ).faultAttemptId
        : undefined,
      `native-save-${composedRunId}`,
    );
    assert(harness.screenshotCalls.some((call) => call.startsWith('tap:id:tabs.training')));
  } finally {
    await rm(harness.parent, { recursive: true, force: true });
    await rm(selectionFixture.projection, { recursive: true, force: true });
  }
});

void test('Save/retry dispatcher publishes cancellation facts without a passing report', async () => {
  const selectionFixture = await makeCompositionSelection();
  const harness = await makeCompositionHarness(undefined, selectionFixture.projection);
  const controller = new AbortController();
  controller.abort(new Error('controlled composed cancellation'));
  try {
    await assert.rejects(
      runDetoxSaveRetryOnExistingOwner({
        repositoryRoot: selectionFixture.projection,
        output: harness.output,
        selection: selectionFixture.selection,
        fixtures: harness.fixtures as never,
        session: harness.session as never,
        proxy: harness.proxy as never,
        child: harness.child as never,
        childIdentity: harness.childIdentity,
        coachAuthTransition: {
          actor: 'coach',
          beforeRequestId: 10,
          authRequestId: 11,
          afterRequestId: 12,
          actorAuthUid: composedCoachUid,
        },
        signal: controller.signal,
        deadlineAt: performance.now() + 30_000,
        report: harness.report,
        producerContext: harness.producerContext,
      }),
      /controlled composed cancellation/,
    );
    const terminal = harness.report.detoxSaveRetryTerminal as Record<string, unknown>;
    assert.equal(terminal.status, 'cancelled');
    assert.equal(terminal.nativePassingCases, 0);
    assert.equal(terminal.publicPromotionEligible, false);
  } finally {
    await rm(harness.parent, { recursive: true, force: true });
    await rm(selectionFixture.projection, { recursive: true, force: true });
  }
});

void test('Save/retry dispatcher rejects foreign coach transitions before owned reads', async () => {
  const selectionFixture = await makeCompositionSelection();
  const harness = await makeCompositionHarness(undefined, selectionFixture.projection);
  try {
    await assert.rejects(
      runDetoxSaveRetryOnExistingOwner({
        repositoryRoot: selectionFixture.projection,
        output: harness.output,
        selection: selectionFixture.selection,
        fixtures: harness.fixtures as never,
        session: harness.session as never,
        proxy: harness.proxy as never,
        child: harness.child as never,
        childIdentity: harness.childIdentity,
        coachAuthTransition: {
          actor: 'student',
          beforeRequestId: 10,
          authRequestId: 11,
          afterRequestId: 12,
          actorAuthUid: composedCoachUid,
        } as never,
        signal: new AbortController().signal,
        deadlineAt: performance.now() + 30_000,
        report: harness.report,
        producerContext: harness.producerContext,
      }),
      /coach/,
    );
    assert.equal(harness.report.detoxSaveRetry, undefined);
  } finally {
    await rm(harness.parent, { recursive: true, force: true });
    await rm(selectionFixture.projection, { recursive: true, force: true });
  }
});

void test('Save/retry dispatcher rejects a stale reselected inventory binding', async () => {
  const selectionFixture = await makeCompositionSelection();
  const harness = await makeCompositionHarness(undefined, selectionFixture.projection);
  try {
    const staleSelection = {
      ...selectionFixture.selection,
      requirementHash: '0'.repeat(64),
    };
    await assert.rejects(
      runDetoxSaveRetryOnExistingOwner({
        repositoryRoot: selectionFixture.projection,
        output: harness.output,
        selection: staleSelection,
        fixtures: harness.fixtures as never,
        session: harness.session as never,
        proxy: harness.proxy as never,
        child: harness.child as never,
        childIdentity: harness.childIdentity,
        coachAuthTransition: {
          actor: 'coach',
          beforeRequestId: 10,
          authRequestId: 11,
          afterRequestId: 12,
          actorAuthUid: composedCoachUid,
        },
        signal: new AbortController().signal,
        deadlineAt: performance.now() + 30_000,
        report: harness.report,
        producerContext: harness.producerContext,
      }),
      /stale|different source root|deep/i,
    );
    assert.equal(harness.report.detoxSaveRetry, undefined);
  } finally {
    await rm(harness.parent, { recursive: true, force: true });
    await rm(selectionFixture.projection, { recursive: true, force: true });
  }
});

void test('Save/retry dispatcher retains terminal facts when aggregate cleanup is not verified', async () => {
  const selectionFixture = await makeCompositionSelection();
  const harness = await makeCompositionHarness('failed-save', selectionFixture.projection);
  try {
    await assert.rejects(
      runDetoxSaveRetryOnExistingOwner({
        repositoryRoot: selectionFixture.projection,
        output: harness.output,
        selection: selectionFixture.selection,
        fixtures: harness.fixtures as never,
        session: harness.session as never,
        proxy: harness.proxy as never,
        child: harness.child as never,
        childIdentity: harness.childIdentity,
        coachAuthTransition: {
          actor: 'coach',
          beforeRequestId: 10,
          authRequestId: 11,
          afterRequestId: 12,
          actorAuthUid: composedCoachUid,
        },
        signal: new AbortController().signal,
        deadlineAt: performance.now() + 30_000,
        report: harness.report,
        producerContext: harness.producerContext,
      }),
      /controlled failed-save failure/,
    );
    const cleanup = await runDetoxConnectionDriverCleanup({
      artifactRoot: harness.output,
      repositoryRoot: selectionFixture.projection,
      report: harness.report,
      reason: 'journey-failed',
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 1_000,
      saveRetryClient: {
        drain: () =>
          Promise.resolve({
            status: 'not-verified' as const,
            pendingCommandIds: [2],
            terminalCommandIds: [1],
            failures: ['controlled composed drain failure'],
          }),
        close: () => undefined,
      },
    });
    assert.equal(cleanup.status, 'failed');
    assert.equal(
      (harness.report.detoxSaveRetryTerminal as Record<string, unknown>).nativePassingCases,
      0,
    );
    assert.equal(
      (
        (harness.report.detoxSaveRetryTerminal as Record<string, unknown>).cleanup as Record<
          string,
          unknown
        >
      ).status,
      'not-verified',
    );
  } finally {
    await rm(harness.parent, { recursive: true, force: true });
    await rm(selectionFixture.projection, { recursive: true, force: true });
  }
});

void test('post-success Save cleanup publishes complete terminal facts from the saved report', async () => {
  const selectionFixture = await makeCompositionSelection();
  const harness = await makeCompositionHarness(undefined, selectionFixture.projection);
  try {
    await runDetoxSaveRetryOnExistingOwner({
      repositoryRoot: selectionFixture.projection,
      output: harness.output,
      selection: selectionFixture.selection,
      fixtures: harness.fixtures as never,
      session: harness.session as never,
      proxy: harness.proxy as never,
      child: harness.child as never,
      childIdentity: harness.childIdentity,
      coachAuthTransition: {
        actor: 'coach',
        beforeRequestId: 10,
        authRequestId: 11,
        afterRequestId: 12,
        actorAuthUid: composedCoachUid,
      },
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 30_000,
      report: harness.report,
      producerContext: harness.producerContext,
    });
    const proxy = harness.proxy as {
      observations: readonly { requestId: number }[];
      faultState: unknown;
    };
    const cleanup = await runDetoxConnectionDriverCleanup({
      artifactRoot: harness.output,
      repositoryRoot: selectionFixture.projection,
      report: harness.report,
      reason: 'journey-failed',
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 1_000,
      proxy: {
        stop: () => Promise.resolve(),
        observations: proxy.observations,
        faultState: proxy.faultState,
      },
      saveRetryClient: {
        terminalState: () => [],
        drain: () =>
          Promise.resolve({
            status: 'not-verified' as const,
            pendingCommandIds: [9],
            terminalCommandIds: [1, 2, 3, 4],
            failures: ['controlled post-success drain failure'],
          }),
        close: () => undefined,
      },
    });
    assert.equal(cleanup.status, 'failed');
    const terminal = harness.report.detoxSaveRetryTerminal as Record<string, unknown>;
    assert.equal(terminal.kind, 'private-detox-save-retry-terminal-failure');
    assert.equal(terminal.status, 'failed');
    assert.equal(
      (terminal.faultIdentity as Record<string, unknown>).faultAttemptId,
      `native-save-${composedRunId}`,
    );
    assert.deepEqual(terminal.coachAuthTransition, {
      actor: 'coach',
      beforeRequestId: 10,
      authRequestId: 11,
      afterRequestId: 12,
      actorAuthUid: composedCoachUid,
    });
    assert.deepEqual(terminal.childIdentity, harness.childIdentity);
    assert.equal((terminal.cleanup as Record<string, unknown>).status, 'not-verified');
    assert.deepEqual((terminal.drain as { pendingCommandIds: number[] }).pendingCommandIds, [9]);
    assert.equal(terminal.nativePassingCases, 0);
    assert.equal(terminal.publicPromotionEligible, false);
  } finally {
    await rm(harness.parent, { recursive: true, force: true });
    await rm(selectionFixture.projection, { recursive: true, force: true });
  }
});

void test('outer Save fallback retains the already-verified coach transition', () => {
  const transition = {
    actor: 'coach' as const,
    beforeRequestId: 10,
    authRequestId: 11,
    afterRequestId: 12,
    actorAuthUid: composedCoachUid,
  };
  const terminal = createDetoxSaveRetryOuterFailureTerminal({
    error: new Error('controlled failure after coach switch'),
    signal: new AbortController().signal,
    deadlineAt: performance.now() + 1_000,
    report: { detoxSaveRetryCoachAuth: transition },
    faultIdentity: {
      requestedRunId: composedRunId,
      captureRunId: composedRunId,
      backendRunId: composedRunId,
      requestedAttemptId: `${composedRunId}:first`,
      backendAttemptId: `${composedRunId}:first`,
      faultAttemptId: `native-save-${composedRunId}`,
    },
    childIdentity: child,
    childTerminalState: [],
    faultState: null,
    proxyObservations: [{ requestId: 13 }],
  });
  assert.deepEqual(terminal.coachAuthTransition, transition);
  assert.equal(terminal.nativePassingCases, 0);
  assert.equal(terminal.publicPromotionEligible, false);
});

void test('owner-switch driver seam retains the transition in its real outer catch', async () => {
  const selectionFixture = await makeCompositionSelection();
  const harness = await makeCompositionHarness(undefined, selectionFixture.projection);
  const ownerSwitches: string[] = [];
  const ownerSession = {
    ...(harness.session as Record<string, unknown>),
    fixtures: () => Promise.resolve(harness.fixtures),
  };
  const ownerContext = {
    output: harness.output,
    fixtures: harness.fixtures,
    proxy: {
      observations: (harness.proxy as { observations: unknown[] }).observations,
      nativeAuthIdentities: [],
    },
    apiIdentity: { apiPid: 30100, targetOrigin: composedOrigin },
    observe: () => Promise.resolve(),
    snapshot: () => Promise.resolve(composedDomainSnapshot(false)),
    connectionSnapshot: () => Promise.resolve({}) as never,
    isolationSnapshot: () => Promise.resolve({}) as never,
    report: harness.report,
    switchAccount: (actor: 'coach', navigation: 'student-professionals-back') => {
      ownerSwitches.push(`${actor}:${navigation}`);
      return Promise.resolve({
        actor,
        beforeRequestId: 10,
        authRequestId: 11,
        afterRequestId: 12,
        actorAuthUid: composedCoachUid,
      });
    },
  };
  try {
    const staleSelection = {
      ...selectionFixture.selection,
      requirementHash: '0'.repeat(64),
    };
    await assert.rejects(
      runDetoxSaveRetryOnExistingConnectionOwner({
        context: ownerContext as never,
        repositoryRoot: selectionFixture.projection,
        output: harness.output,
        selection: staleSelection,
        session: ownerSession as never,
        proxy: harness.proxy as never,
        saveRetryClient: harness.child as never,
        ownerChild: harness.child as never,
        childIdentity: harness.childIdentity,
        signal: new AbortController().signal,
        deadlineAt: performance.now() + 30_000,
        producerContext: harness.producerContext,
      }),
      /stale|different source root|deep/i,
    );
    assert.deepEqual(ownerSwitches, ['coach:student-professionals-back']);
    assert.deepEqual(harness.report.detoxSaveRetryCoachAuth, {
      actor: 'coach',
      beforeRequestId: 10,
      authRequestId: 11,
      afterRequestId: 12,
      actorAuthUid: composedCoachUid,
    });
    const terminal = harness.report.detoxSaveRetryTerminal as Record<string, unknown>;
    assert.deepEqual(terminal.coachAuthTransition, harness.report.detoxSaveRetryCoachAuth);
    assert.equal(terminal.nativePassingCases, 0);
    assert.equal(terminal.publicPromotionEligible, false);
  } finally {
    await rm(harness.parent, { recursive: true, force: true });
    await rm(selectionFixture.projection, { recursive: true, force: true });
  }
});
