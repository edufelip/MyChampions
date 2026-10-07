import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  OWNED_INITIAL_API_ATTEMPT,
  OWNED_INITIAL_API_LEDGER_BASENAME,
  assertOwnedApiAttemptStateStable,
  readOwnedApiAttemptWithStability,
  readOwnedApiProcessAttempt,
  readOwnedInitialApiProcess,
  readOwnedRuntimeDocumentWithReceipt,
  type OwnedApiAttemptState,
  type OwnedApiProcessIdentity,
  type OwnedApiProcessRecord,
  type OwnedManifest,
} from '../../scripts/testing/owned-session';

const serverRoot = '/owned/server';
const apiPid = 4321;
const apiStarted = 'Mon Sep 29 12:00:00 2026';
const apiScript = `${serverRoot}/scripts/testing/serve.ts`;
const apiOrigin = 'http://127.0.0.1:42001';
const runId = 'a'.repeat(24);
const ownerTokenHash = 'b'.repeat(64);

function identity(overrides: Partial<OwnedApiProcessIdentity> = {}): OwnedApiProcessIdentity {
  return {
    apiPid,
    apiOrigin,
    apiStarted,
    apiScript,
    ...overrides,
  };
}

function record(overrides: Partial<OwnedApiProcessRecord> = {}): OwnedApiProcessRecord {
  return {
    schemaVersion: 1,
    runId,
    ownerTokenHash,
    pid: apiPid,
    started: apiStarted,
    script: apiScript,
    attempt: OWNED_INITIAL_API_ATTEMPT,
    origin: apiOrigin,
    ...overrides,
  };
}

function manifest(artifactRoot: string, overrides: Partial<OwnedManifest> = {}): OwnedManifest {
  return {
    phase: 'tests',
    runId,
    repoRoot: serverRoot,
    runtimeRoot: path.dirname(artifactRoot),
    artifactRoot,
    ownerTokenHash,
    orchestratorPid: 9876,
    composeProject: `mc_test_${runId}`,
    port: 42001,
    targets: {
      DATABASE_URL: `mc_test_${runId}`,
      FOOD_CATALOG_DATABASE_URL: `mc_test_${runId}_food`,
      EXERCISE_CATALOG_DATABASE_URL: `mc_test_${runId}_exercise`,
    },
    fixtureScopes: [],
    processes: [
      {
        role: 'orchestrator',
        pid: 9876,
        started: 'orchestrator-start',
        script: `${serverRoot}/scripts/testing/session.ts`,
      },
      { role: 'api', pid: apiPid, started: apiStarted, script: apiScript },
    ],
    repositories: {},
    ...overrides,
  };
}

async function writeLedger(root: string, value: OwnedApiProcessRecord): Promise<string> {
  const file = path.join(root, OWNED_INITIAL_API_LEDGER_BASENAME);
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  return file;
}

async function writeAttemptLedger(
  root: string,
  attempt: string,
  value: OwnedApiProcessRecord,
): Promise<string> {
  const file = path.join(root, `api-${attempt}.json`);
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  return file;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

void test('initial API lifetime reads the physical session-start ledger and returns the logical first ID', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-api-lifetime-')));
  const root = path.join(parent, 'run');
  await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o700);
  const ownedManifest = manifest(root);
  const input = {
    manifest: ownedManifest,
    serverRoot,
    current: identity(),
    initial: identity(),
  };
  try {
    await assert.rejects(
      readOwnedInitialApiProcess(input),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT',
    );
    const ledger = await writeLedger(root, record());
    const result = await readOwnedInitialApiProcess(input);
    assert.equal(result.backendAttemptId, `${runId}:first`);
    assert.equal(result.record.attempt, 'session-start');
    assert.equal(result.receipt.path, OWNED_INITIAL_API_LEDGER_BASENAME);
    assert.match(result.receipt.sha256, /^[a-f0-9]{64}$/);
    assert.equal(ledger, path.join(root, 'api-session-start.json'));
    await assert.rejects(
      readOwnedInitialApiProcess({
        ...input,
        manifest: { ...ownedManifest, artifactRoot: path.join(root, 'missing') },
      }),
      /ENOENT|private|path/i,
    );
    await writeLedger(root, record());
    await assert.rejects(
      readOwnedInitialApiProcess({
        ...input,
        manifest: {
          ...ownedManifest,
          processes: ownedManifest.processes.map((row) =>
            row.role === 'api' ? { ...row, started: 'reused-pid-start' } : row,
          ),
        },
      }),
      /absent from the current manifest/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('initial API lifetime rejects identity drift, restart relabeling, cancellation and symlinks', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-api-lifetime-negative-')));
  const root = path.join(parent, 'run');
  const outside = path.join(parent, 'outside.json');
  await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o700);
  const ownedManifest = manifest(root);
  const input = {
    manifest: ownedManifest,
    serverRoot,
    current: identity(),
    initial: identity(),
  };
  try {
    for (const invalid of [
      { runId: 'c'.repeat(24) },
      { ownerTokenHash: 'd'.repeat(64) },
      { pid: 4322 },
      { started: 'reused-pid-start' },
      { script: '/foreign/server/scripts/testing/serve.ts' },
      { attempt: 'restart-1' },
      { origin: 'http://127.0.0.1:42002' },
    ]) {
      await writeLedger(root, record(invalid));
      await assert.rejects(readOwnedInitialApiProcess(input), /identity mismatch/);
    }
    await writeLedger(root, record());
    await assert.rejects(
      readOwnedInitialApiProcess({
        ...input,
        current: identity({
          apiPid: 4322,
          apiOrigin: 'http://127.0.0.1:42002',
          apiStarted: 'new-start',
        }),
        initial: identity(),
        manifest: {
          ...ownedManifest,
          processes: [
            ...ownedManifest.processes,
            { role: 'api', pid: 4322, started: 'new-start', script: apiScript },
          ],
        },
      }),
      /provenance changed|restarted/,
    );
    await writeLedger(root, record());
    await assert.rejects(
      readOwnedInitialApiProcess({
        ...input,
        current: identity({ apiOrigin: 'https://127.0.0.1:42001' }),
      }),
      /loopback HTTP origin/,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      readOwnedInitialApiProcess({ ...input, signal: controller.signal }),
      /aborted/i,
    );
    await writeFile(outside, JSON.stringify(record()), { mode: 0o600 });
    await rm(path.join(root, OWNED_INITIAL_API_LEDGER_BASENAME), { force: true });
    await symlink(outside, path.join(root, OWNED_INITIAL_API_LEDGER_BASENAME));
    await assert.rejects(readOwnedInitialApiProcess(input), /path mismatch/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('current API lifetime binds a real restart ledger without relabeling it as first', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-api-attempt-')));
  const root = path.join(parent, 'run');
  const outside = path.join(parent, 'outside-restart.json');
  await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o700);
  const restartedPid = 5678;
  const restartedStarted = 'Tue Sep 30 12:00:00 2026';
  const restartedOrigin = 'http://127.0.0.1:42002';
  const restartedAttempt = 'restart-1';
  const restartedManifest = manifest(root, {
    processes: [
      {
        role: 'orchestrator',
        pid: 9876,
        started: 'orchestrator-start',
        script: `${serverRoot}/scripts/testing/session.ts`,
      },
      { role: 'api', pid: apiPid, started: apiStarted, script: apiScript },
      { role: 'api', pid: restartedPid, started: restartedStarted, script: apiScript },
    ],
  });
  const current = identity({
    apiPid: restartedPid,
    apiStarted: restartedStarted,
    apiOrigin: restartedOrigin,
  });
  try {
    const ledger = await writeAttemptLedger(
      root,
      restartedAttempt,
      record({
        pid: restartedPid,
        started: restartedStarted,
        attempt: restartedAttempt,
        origin: restartedOrigin,
      }),
    );
    const result = await readOwnedApiProcessAttempt({
      manifest: restartedManifest,
      serverRoot,
      current,
      attempt: restartedAttempt,
    });
    assert.equal(result.apiAttempt, restartedAttempt);
    assert.equal(result.backendAttemptId, `${runId}:${restartedAttempt}`);
    assert.equal(result.record.attempt, restartedAttempt);
    assert.equal(result.receipt.path, path.basename(ledger));
    assert.match(result.receipt.sha256, /^[a-f0-9]{64}$/);
    assert.notEqual(result.backendAttemptId, `${runId}:first`);

    for (const invalid of [
      { attempt: OWNED_INITIAL_API_ATTEMPT },
      { ownerTokenHash: 'c'.repeat(64) },
      { pid: apiPid },
      { started: apiStarted },
      { script: '/foreign/server/scripts/testing/serve.ts' },
      { origin: apiOrigin },
      { runId: 'd'.repeat(24) },
    ]) {
      await writeAttemptLedger(
        root,
        restartedAttempt,
        record({
          pid: restartedPid,
          started: restartedStarted,
          attempt: restartedAttempt,
          origin: restartedOrigin,
          ...invalid,
        }),
      );
      await assert.rejects(
        readOwnedApiProcessAttempt({
          manifest: restartedManifest,
          serverRoot,
          current,
          attempt: restartedAttempt,
        }),
        /identity mismatch/,
      );
    }

    await writeAttemptLedger(
      root,
      restartedAttempt,
      record({
        pid: restartedPid,
        started: restartedStarted,
        attempt: restartedAttempt,
        origin: restartedOrigin,
      }),
    );
    await assert.rejects(
      readOwnedApiProcessAttempt({
        manifest: {
          ...restartedManifest,
          processes: restartedManifest.processes.map((row) =>
            row.pid === restartedPid ? { ...row, started: 'manifest-drift' } : row,
          ),
        },
        serverRoot,
        current,
        attempt: restartedAttempt,
      }),
      /absent from the current manifest/,
    );
    await writeFile(
      outside,
      JSON.stringify(
        record({
          pid: restartedPid,
          started: restartedStarted,
          attempt: restartedAttempt,
          origin: restartedOrigin,
        }),
      ),
      { mode: 0o600 },
    );
    await writeAttemptLedger(
      root,
      restartedAttempt,
      record({
        pid: restartedPid,
        started: restartedStarted,
        attempt: restartedAttempt,
        origin: restartedOrigin,
      }),
    );
    await rm(path.join(root, `api-${restartedAttempt}.json`));
    await symlink(outside, path.join(root, `api-${restartedAttempt}.json`));
    await assert.rejects(
      readOwnedApiProcessAttempt({
        manifest: restartedManifest,
        serverRoot,
        current,
        attempt: restartedAttempt,
      }),
      /path mismatch/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('receipt acquisition rejects deterministic restart and teardown windows and accepts a stable read', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-api-stability-')));
  const root = path.join(parent, 'run');
  await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o700);
  const attempt = 'restart-1';
  const ledger = await writeAttemptLedger(
    root,
    attempt,
    record({
      pid: apiPid,
      started: apiStarted,
      attempt,
      origin: apiOrigin,
    }),
  );
  const stableState: OwnedApiAttemptState = {
    apiPid,
    apiOrigin,
    apiStarted,
    apiScript,
    apiAttempt: attempt,
  };
  const readReceipt = (signal?: AbortSignal) =>
    readOwnedRuntimeDocumentWithReceipt(
      ledger,
      root,
      path.basename(ledger),
      'api-process-v1',
      signal,
    );
  let mode: 'stable' | 'restart' | 'teardown' = 'stable';
  const restartedState: OwnedApiAttemptState = {
    apiPid: apiPid + 1,
    apiOrigin: 'http://127.0.0.1:42002',
    apiStarted: 'Tue Sep 30 12:00:00 2026',
    apiScript,
    apiAttempt: 'restart-2',
  };
  const assertLive = (expected: OwnedApiAttemptState) => {
    if (mode === 'teardown') throw new Error('Owned API session is closed, closing, or failed');
    const actual = mode === 'restart' ? restartedState : stableState;
    assertOwnedApiAttemptStateStable(expected, actual);
    return Promise.resolve(actual);
  };
  try {
    const stable = await readOwnedApiAttemptWithStability({
      captureState: () => stableState,
      assertLive,
      read: (_expected, signal) => readReceipt(signal),
    });
    assert.equal(stable.value.receipt.path, path.basename(ledger));
    assert.equal(stable.state.apiAttempt, attempt);

    const restartEntered = deferred<void>();
    const releaseRestart = deferred<void>();
    const restartRead = readOwnedApiAttemptWithStability({
      captureState: () => stableState,
      assertLive,
      read: async (_expected, signal) => {
        restartEntered.resolve();
        await releaseRestart.promise;
        return readReceipt(signal);
      },
    });
    await restartEntered.promise;
    mode = 'restart';
    releaseRestart.resolve();
    await assert.rejects(restartRead, /changed during receipt acquisition|identity mismatch/);

    mode = 'stable';
    const teardownEntered = deferred<void>();
    const releaseTeardown = deferred<void>();
    const teardownRead = readOwnedApiAttemptWithStability({
      captureState: () => stableState,
      assertLive,
      read: async (_expected, signal) => {
        teardownEntered.resolve();
        await releaseTeardown.promise;
        return readReceipt(signal);
      },
    });
    await teardownEntered.promise;
    mode = 'teardown';
    releaseTeardown.resolve();
    await assert.rejects(teardownRead, /closed, closing, or failed/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
