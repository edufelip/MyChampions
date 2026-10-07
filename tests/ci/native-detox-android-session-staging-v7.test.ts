import assert from 'node:assert/strict';
import { renameSync, symlinkSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  AndroidDetoxSessionStagingError,
  createAndroidDetoxSessionOwnedChildDirectory,
  prepareAndroidDetoxSessionPublicOutputRoot,
} from '../../scripts/testing/native-detox-android-session-public-staging';

const deadline = () => performance.now() + 10_000;

async function privateTree(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), prefix));
  await mkdir(path.join(root, 'capture'), { mode: 0o700 });
  await mkdir(path.join(root, 'owned'), { mode: 0o700 });
  return root;
}

void test('V7 actual ancestor race rejects before foreign mkdir and retains recovery evidence', async () => {
  const root = await privateTree('mcp-v7-android-session-race-');
  const captureRoot = path.join(root, 'capture');
  const parent = path.join(root, 'owned');
  const foreign = path.join(root, 'foreign');
  const moved = path.join(root, 'owned-original');
  await mkdir(foreign, { mode: 0o700 });
  let fences = 0;
  let swappedAtFence: number | null = null;
  const controller = new AbortController();
  const originalThrowIfAborted = controller.signal.throwIfAborted.bind(controller.signal);
  Object.defineProperty(controller.signal, 'throwIfAborted', {
    configurable: true,
    value: () => {
      originalThrowIfAborted();
      fences += 1;
      if (fences === 2) {
        swappedAtFence = fences;
        // This is the same lifecycle fence used by the old V5 probe: exchange
        // the checked ancestor immediately before the mutation operation.
        renameSync(parent, moved);
        symlinkSync(foreign, parent);
      }
    },
  });

  try {
    let failure: unknown;
    try {
      await prepareAndroidDetoxSessionPublicOutputRoot({
        captureRoot,
        outputRoot: path.join(parent, 'stage'),
        lifecycle: {
          signal: controller.signal,
          deadlineAtMonotonicMs: deadline(),
        },
      });
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof AndroidDetoxSessionStagingError);
    assert.equal(failure.recoveryStatus, 'failed-recovery-ledger-retained');
    assert(failure.recoveryRecordPath);
    assert.equal(swappedAtFence, 2, 'race was not injected at the pre-mutation lifecycle fence');
    assert(fences >= 3, 'anchored operation did not perform its abort fence');
    assert.deepEqual(await readdir(foreign), [], 'foreign directory received an unexpected child');
    assert.deepEqual(await readdir(moved), [], 'owned directory received an unexpected child');
    const ledgerBytes = await readFile(path.join(captureRoot, failure.recoveryRecordPath));
    const ledger = JSON.parse(ledgerBytes.toString('utf8')) as Record<string, unknown>;
    assert.equal(ledger.kind, 'private-android-detox-session-staging-recovery-not-public-receipt');
    assert.equal(ledger.foreignWriteObserved, false);
    assert.equal(ledger.nativePassingCases, 0);
    assert.equal(ledger.publicPassingCases, 0);
    console.log(
      JSON.stringify({
        actualRace: true,
        schedulerHook: 'AbortSignal throwIfAborted at second lifecycle fence',
        fences,
        rejection: failure.message,
        foreignDirectoryCreatedBeforeRejection: false,
        recoveryLedgerRetained: true,
        nativeExecution: false,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V7 clean positive creates an identity-bound empty root and child', async () => {
  const root = await privateTree('mcp-v7-android-session-positive-');
  const captureRoot = path.join(root, 'capture');
  const outputRoot = path.join(root, 'owned', 'stage');
  try {
    const prepared = await prepareAndroidDetoxSessionPublicOutputRoot({
      captureRoot,
      outputRoot,
      lifecycle: {
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: deadline(),
      },
    });
    assert.equal(prepared.outputRoot, outputRoot);
    assert.deepEqual(await readdir(outputRoot), []);
    const child = await createAndroidDetoxSessionOwnedChildDirectory({
      parent: outputRoot,
      name: 'evidence',
      expectedParentIdentity: prepared.identity,
      lifecycle: {
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: deadline(),
      },
    });
    const metadata = await lstat(child.path);
    assert(metadata.isDirectory() && !metadata.isSymbolicLink());
    assert.equal(metadata.mode & 0o777, 0o700);
    assert(metadata.nlink >= 2);
    assert.equal((await readdir(outputRoot)).join(','), 'evidence');
    console.log(
      JSON.stringify({
        cleanPositive: true,
        outputMode: (metadata.mode & 0o777).toString(8),
        childIdentityBound: true,
        recoveryLedger: false,
        nativeExecution: false,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V10 recovery-publication failure retains the created root and cannot report cleaned', async () => {
  const root = await privateTree('mcp-v10-android-session-ledger-failure-');
  const captureRoot = path.join(root, 'capture');
  const outputRoot = path.join(root, 'owned', 'stage');
  try {
    let failure: unknown;
    try {
      await prepareAndroidDetoxSessionPublicOutputRoot({
        captureRoot,
        outputRoot,
        lifecycle: {
          signal: new AbortController().signal,
          deadlineAtMonotonicMs: deadline(),
          onAfterAnchoredCreate: () => {
            throw new Error('forced post-acquisition staging failure');
          },
          onBeforeRecoveryLedgerWrite: () => {
            throw new Error('forced recovery publication failure');
          },
        },
      });
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof AndroidDetoxSessionStagingError);
    assert.equal(failure.recoveryStatus, 'failed-recovery-ledger-retained');
    assert.equal(failure.recoveryPublication, 'unknown');
    assert.equal(failure.recoveryRecordPath, null);
    assert.deepEqual(failure.retainedPaths, [outputRoot]);
    assert.deepEqual(await readdir(outputRoot), []);
    console.log(
      JSON.stringify({
        recoveryPublicationFailure: true,
        retainedRoot: outputRoot,
        recoveryStatus: failure.recoveryStatus,
        cleanedStatusRejected: true,
        nativeExecution: false,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V9 timeout reaps the anchored worker and records unverified recovery', async () => {
  const root = await privateTree('mcp-v9-android-session-reap-');
  const captureRoot = path.join(root, 'capture');
  const outputRoot = path.join(root, 'owned', 'stage');
  try {
    let failure: unknown;
    try {
      await prepareAndroidDetoxSessionPublicOutputRoot({
        captureRoot,
        outputRoot,
        lifecycle: {
          signal: new AbortController().signal,
          deadlineAtMonotonicMs: performance.now() + 600,
          testWorkerDelayMs: 2_000,
        },
      });
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof AndroidDetoxSessionStagingError);
    assert.equal(failure.recoveryPublication, 'unknown');
    assert(failure.childLifecycle);
    assert.equal(failure.childLifecycle.terminateRequested, true);
    assert.equal(failure.childLifecycle.reapStatus, 'reaped');
    assert.equal(failure.childLifecycle.closeObserved, true);
    assert.equal(failure.childLifecycle.pid !== null, true);
    console.log(
      JSON.stringify({
        timeoutChildReaped: true,
        pidBound: failure.childLifecycle.pid !== null,
        reapStatus: failure.childLifecycle.reapStatus,
        recoveryPublication: failure.recoveryPublication,
        nativeExecution: false,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
