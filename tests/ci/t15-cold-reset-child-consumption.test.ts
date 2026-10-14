import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  consumeChildColdReset,
  readChildCaptureFromOwnedRoot,
  type ColdResetChildExpectation,
} from '../../scripts/testing/t15-cold-reset-child-consumption';

const runId = '0123456789abcdef01234567';
const captureRunId = 'fedcba9876543210fedcba98';
const captureRoot = `/private/tmp/${captureRunId}`;
const backendRoot = '/private/tmp/backend-owned-0001';
const hash = 'a'.repeat(64);
const sourceIdentity = {
  dev: 1,
  ino: 10,
  uid: 501,
  gid: 20,
  mode: 0o100600,
  nlink: 1,
  size: 123,
  mtimeMs: 1,
  ctimeMs: 1,
};
const expectedTarget = {
  platform: 'ios',
  deviceId: '01234567-89AB-CDEF-0123-456789ABCDEF',
  appId: 'com.edufelip.mychampions.dev',
  binaryHash: hash,
  apiOrigin: 'http://127.0.0.1:42002/',
  captureRunId,
  ownerRunId: runId,
  phase: 'installed-before-ui',
};
const expectedBackend = {
  runId: 'abcdef0123456789abcdef01',
  ownerRunId: runId,
  captureRunId,
  artifactRoot: backendRoot,
  apiOrigin: 'http://127.0.0.1:42001/',
  apiPid: 4002,
  apiStarted: 'api-start',
  apiScript: '/server/serve.ts',
  backendAttemptId: 'abcdef0123456789abcdef01:first',
  manifestSha256: hash,
};

const expectation: ColdResetChildExpectation = {
  requestedRunId: runId,
  requestedAttemptId: `${runId}:first`,
  fixtureResetId: 'reset-cell-0001',
  cohortFixtureFingerprint: 'b'.repeat(64),
  sourceFingerprint: 'c'.repeat(64),
  helperFingerprint: 'd'.repeat(64),
  target: expectedTarget,
  backend: expectedBackend,
  sourceIdentity,
};

function makeCapture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const target = { ...expectedTarget };
  const backend = {
    ...expectedBackend,
    processes: [
      {
        role: 'api',
        pid: 4002,
        started: 'api-start',
        script: '/server/serve.ts',
      },
    ],
  };
  const ownership = {
    listeners: [
      {
        resourceId: '42001',
        state: 'active',
        ownerRunId: runId,
        process: { pid: 4002, started: 'api-start' },
      },
      {
        resourceId: '42002',
        state: 'active',
        ownerRunId: runId,
        process: { pid: 4011, started: 'capture-start' },
      },
    ],
    namespaces: {
      capture: {
        path: captureRoot,
        realpath: captureRoot,
        dev: 1,
        ino: 2,
        uid: 501,
        gid: 20,
        mode: 448,
      },
      backend: {
        path: backendRoot,
        realpath: backendRoot,
        dev: 1,
        ino: 3,
        uid: 501,
        gid: 20,
        mode: 448,
      },
    },
  };
  const reset = {
    status: 'fresh',
    cleanupStatus: 'cleaned',
    blocker: null,
    ownerRunId: runId,
    requestedRunId: runId,
    requestedAttemptId: expectation.requestedAttemptId,
    fixtureResetId: expectation.fixtureResetId,
    cohortFixtureFingerprint: expectation.cohortFixtureFingerprint,
    sourceFingerprint: expectation.sourceFingerprint,
    helperFingerprint: expectation.helperFingerprint,
    startedAt: '2026-10-03T10:00:00.000Z',
    finishedAt: '2026-10-03T10:00:01.000Z',
    appStateFingerprint: 'e'.repeat(64),
    fixtureStateFingerprint: 'f'.repeat(64),
    fixture: {
      runId,
      scope: 'native-entry-ios',
      fixtureSha256: '1'.repeat(64),
      snapshotSha256: '2'.repeat(64),
      snapshotReceiptSha256: '3'.repeat(64),
    },
    receiptPath: `${captureRoot}/reset-original.private.json`,
    receiptHash: hash,
    originalResetBinding: {
      status: 'verified',
      artifactRoot: captureRoot,
      receiptPath: `${captureRoot}/reset-original.private.json`,
      receiptHash: hash,
      identity: sourceIdentity,
    },
    target,
    backend,
    ownership,
  };
  return {
    platform: 'ios',
    mode: 'integration',
    captureRoot,
    captureRunId,
    coldReset: { ...reset, ...overrides },
  };
}

void test('consumption derives the handoff binding from the returned child capture', () => {
  const binding = consumeChildColdReset({
    capture: makeCapture(),
    captureRoot,
    expectation,
  });
  assert.equal(binding.artifactRoot, captureRoot);
  assert.equal(binding.receiptPath, `${captureRoot}/reset-original.private.json`);
  assert.equal(binding.receiptHash, hash);
  assert.equal(binding.attemptId, expectation.requestedAttemptId);
  assert.equal(binding.cleanupStatus, 'cleaned');
  assert.equal(binding.target.captureRunId, captureRunId);
  assert.equal(binding.backend.ownerRunId, runId);
});

void test('consumption rejects a missing child reset instead of using pre-child paths', () => {
  assert.throws(
    () =>
      consumeChildColdReset({
        capture: {
          platform: 'ios',
          mode: 'integration',
          captureRoot,
          captureRunId,
        },
        captureRoot,
        expectation,
      }),
    /child cold reset must be an object/u,
  );
});

void test('consumption rejects target owner drift and capture-root drift', () => {
  const foreignTarget = makeCapture();
  (foreignTarget.coldReset as Record<string, unknown>).target = {
    ...((foreignTarget.coldReset as Record<string, unknown>).target as Record<string, unknown>),
    ownerRunId: 'fedcba9876543210fedcba98',
  };
  assert.throws(
    () =>
      consumeChildColdReset({
        capture: foreignTarget,
        captureRoot,
        expectation,
      }),
    /target ownerRunId/u,
  );
  assert.throws(
    () =>
      consumeChildColdReset({
        capture: makeCapture(),
        captureRoot: '/private/tmp/foreign',
        expectation,
      }),
    /child capture identity/u,
  );
});

void test('consumption rejects a blocked reset and an altered original receipt hash', () => {
  const blocked = makeCapture({ status: 'blocked' });
  assert.throws(
    () => consumeChildColdReset({ capture: blocked, captureRoot, expectation }),
    /clean fresh preparation/u,
  );
  const altered = makeCapture({ receiptHash: '9'.repeat(64) });
  assert.throws(
    () => consumeChildColdReset({ capture: altered, captureRoot, expectation }),
    /internally inconsistent/u,
  );
});

void test('consumption rejects missing listener/process ownership rows', () => {
  const missing = makeCapture();
  const reset = missing.coldReset as Record<string, unknown>;
  reset.ownership = {
    ...(reset.ownership ?? {}),
    listeners: [],
  };
  assert.throws(
    () => consumeChildColdReset({ capture: missing, captureRoot, expectation }),
    /listeners must contain owned rows/u,
  );
});

void test('consumption rejects collapsed listener origins and noncanonical namespaces', () => {
  const collapsed = makeCapture();
  const reset = collapsed.coldReset as Record<string, unknown>;
  const target = reset.target as Record<string, unknown>;
  const backend = reset.backend as Record<string, unknown>;
  backend.apiOrigin = target.apiOrigin;
  assert.throws(
    () => consumeChildColdReset({ capture: collapsed, captureRoot, expectation }),
    /listeners are not distinct/u,
  );
  const noncanonical = makeCapture();
  const noncanonicalReset = noncanonical.coldReset as Record<string, unknown>;
  const ownership = noncanonicalReset.ownership as Record<string, unknown>;
  const namespaces = ownership.namespaces as Record<string, unknown>;
  (namespaces.capture as Record<string, unknown>).realpath = '/private/tmp/foreign-capture';
  assert.throws(
    () =>
      consumeChildColdReset({
        capture: noncanonical,
        captureRoot,
        expectation,
      }),
    /canonical owned 0700/u,
  );
});

void test('consumption rejects a reset receipt published outside the child capture root', () => {
  const foreign = makeCapture();
  const reset = foreign.coldReset as Record<string, unknown>;
  reset.originalResetBinding = {
    status: 'verified',
    artifactRoot: '/private/tmp/foreign-root',
    receiptPath: '/private/tmp/foreign-root/reset-original.private.json',
    receiptHash: hash,
  };
  assert.throws(
    () => consumeChildColdReset({ capture: foreign, captureRoot, expectation }),
    /outside the returned capture root/u,
  );
});

void test('protected child capture reader binds bytes to the owned namespace and rejects a symlink', async () => {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 't15-cold-reader-')));
  const root = path.join(base, captureRunId);
  const capturePath = path.join(root, 'capture.private.json');
  try {
    await mkdir(root, { mode: 0o700 });
    const capture = {
      captureRoot: root,
      captureRunId,
      platform: 'ios',
      mode: 'integration',
    };
    await writeFile(capturePath, JSON.stringify(capture), { mode: 0o600 });
    await chmod(capturePath, 0o600);
    const observed = await readChildCaptureFromOwnedRoot({
      captureRoot: root,
      expectedCaptureRunId: captureRunId,
    });
    assert.deepEqual(observed.capture, capture);
    assert.equal(observed.rootIdentity.mode, 0o700);
    assert.equal(observed.fileIdentity.mode, 0o600);
    assert.equal(observed.fileIdentity.size, Buffer.byteLength(JSON.stringify(capture)));
    assert.equal(
      observed.captureHash,
      createHash('sha256').update(JSON.stringify(capture)).digest('hex'),
    );
    await rm(capturePath);
    await symlink(path.join(base, 'foreign-capture.json'), capturePath);
    await assert.rejects(
      readChildCaptureFromOwnedRoot({
        captureRoot: root,
        expectedCaptureRunId: captureRunId,
      }),
      /canonical owned 0600 file/u,
    );
    await assert.rejects(
      readChildCaptureFromOwnedRoot({
        captureRoot: `${root}/../${captureRunId}`,
        expectedCaptureRunId: captureRunId,
      }),
      /absolute normalized path/u,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

void test('protected reader retains the V34 missing-root failure and rejects crossed JSON namespaces', async () => {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 't15-cold-namespace-')));
  const root = path.join(base, captureRunId);
  const capturePath = path.join(root, 'capture.private.json');
  try {
    await mkdir(root, { mode: 0o700 });
    await writeFile(
      capturePath,
      JSON.stringify({ captureRunId, platform: 'android', mode: 'integration' }),
      { mode: 0o600 },
    );
    await assert.rejects(
      readChildCaptureFromOwnedRoot({
        captureRoot: root,
        expectedCaptureRunId: captureRunId,
      }),
      /child capture JSON identity differs from its protected namespace/u,
    );
    await rm(capturePath);
    await writeFile(
      capturePath,
      JSON.stringify({
        captureRunId,
        captureRoot: path.join(base, 'foreign-capture'),
        platform: 'android',
        mode: 'integration',
      }),
      { mode: 0o600 },
    );
    await assert.rejects(
      readChildCaptureFromOwnedRoot({
        captureRoot: root,
        expectedCaptureRunId: captureRunId,
      }),
      /child capture JSON identity differs from its protected namespace/u,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
