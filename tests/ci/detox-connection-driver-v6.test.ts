import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import {
  runDetoxConnectionDriverCleanup,
  type DetoxDriverCleanupInput,
  type DriverReport,
} from '../../scripts/testing/detox-integrated-connection-driver';

const report = (): DriverReport => ({
  kind: 'private-detox-connection-capture-not-public-receipt',
  nativePassingCases: 0,
  publicPromotionEligible: false,
  output: '',
});

function cleanupInput(root: string, calls: string[], deadlineAt: number): DetoxDriverCleanupInput {
  const child = {
    pid: process.pid,
    pgid: process.pid,
    wait: (remainingMs: number) => {
      calls.push(`child-wait:${remainingMs > 0}`);
      return Promise.resolve();
    },
    stop: () => {
      calls.push('child-stop');
      return Promise.resolve();
    },
    outcome: () => ({ code: 0, signal: null }),
    censusFailure: () => null,
    outputFailure: () => null,
  };
  const client = {
    request: () => {
      calls.push('child-shutdown');
      return Promise.resolve({ status: 'completed' } as never);
    },
    close: () => calls.push('client-close'),
  };
  return {
    artifactRoot: root,
    repositoryRoot: root,
    report: report(),
    reason: 'completed',
    signal: new AbortController().signal,
    deadlineAt,
    client,
    child,
    childCommand: { command: 'detox', argv: [] },
    proxy: {
      stop: () => {
        calls.push('proxy');
        return Promise.resolve();
      },
    },
    session: {
      stop: () => {
        calls.push('backend');
        return Promise.resolve();
      },
      manifest: { runId: 'backend-run' },
    },
    target: {
      stop: () => {
        calls.push('target');
        return Promise.resolve();
      },
    },
    reservation: {
      release: () => {
        calls.push('app-port');
        return Promise.resolve();
      },
    },
  };
}

void test('driver cleanup wires every owned resource through one shared deadline', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-driver-v6-success-'));
  await chmod(root, 0o700);
  const calls: string[] = [];
  try {
    const result = await runDetoxConnectionDriverCleanup(
      cleanupInput(root, calls, performance.now() + 500),
    );
    assert.equal(result.status, 'cleaned');
    assert.equal(result.recoveryStatus, 'verified');
    assert.deepEqual(calls, [
      'child-shutdown',
      'child-wait:true',
      'child-stop',
      'proxy',
      'backend',
      'target',
      'app-port',
      'client-close',
    ]);
    const receipt = JSON.parse(
      await readFile(path.join(root, 'detox-connection-cleanup.private.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(receipt.status, 'cleaned');
    assert.equal(receipt.recoveryStatus, 'verified');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('driver cleanup still stops an owned child after its wait reports a test failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-driver-v6-child-failure-'));
  await chmod(root, 0o700);
  const calls: string[] = [];
  try {
    const input = cleanupInput(root, calls, performance.now() + 500);
    const child = input.child!;
    const result = await runDetoxConnectionDriverCleanup({
      ...input,
      child: {
        ...child,
        wait: () => {
          calls.push('child-wait-failed');
          return Promise.reject(new Error('Detox child exited 1'));
        },
      },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.recoveryStatus, 'verified');
    assert(calls.includes('child-stop'));
    assert(calls.indexOf('child-wait-failed') < calls.indexOf('child-stop'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('driver cleanup stops publication as a passing result after a noncooperative owned resource', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-driver-v6-timeout-'));
  await chmod(root, 0o700);
  const calls: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const input: DetoxDriverCleanupInput = {
      ...cleanupInput(root, calls, performance.now() + 25),
      proxy: {
        stop: async () => {
          calls.push('proxy');
          await pending;
        },
      },
    };
    const result = await runDetoxConnectionDriverCleanup(input);
    assert.equal(result.status, 'failed');
    assert.equal(result.recoveryStatus, 'not-verified');
    assert.match(result.failures.join('\n'), /not-attempted-after-recovery-timeout/);
    assert(!calls.includes('backend'));
    const receipt = JSON.parse(
      await readFile(path.join(root, 'detox-connection-cleanup.private.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.recoveryStatus, 'not-verified');
  } finally {
    release();
    await pending;
    await rm(root, { recursive: true, force: true });
  }
});

void test('driver cleanup rejects an already-aborted cleanup as unverified', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-driver-v6-abort-'));
  await chmod(root, 0o700);
  const controller = new AbortController();
  controller.abort(new Error('caller cancelled'));
  try {
    const input: DetoxDriverCleanupInput = {
      ...cleanupInput(root, [], performance.now() + 500),
      signal: controller.signal,
    };
    const result = await runDetoxConnectionDriverCleanup(input);
    assert.equal(result.status, 'failed');
    assert.equal(result.recoveryStatus, 'not-verified');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('driver cleanup refuses recovery publication under a replaced artifact-root identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-driver-v6-root-identity-'));
  await chmod(root, 0o700);
  const metadata = await lstat(root);
  try {
    const result = await runDetoxConnectionDriverCleanup({
      ...cleanupInput(root, [], performance.now() + 500),
      artifactRootIdentity: {
        dev: metadata.dev,
        ino: metadata.ino + 1,
        uid: metadata.uid,
        gid: metadata.gid,
        mode: metadata.mode,
      },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.recoveryStatus, 'not-verified');
    assert.match(result.failures.join('\n'), /cleanup-receipt/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
