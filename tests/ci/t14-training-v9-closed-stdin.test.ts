import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  __setDetoxConnectionEvidenceSpawnForTests,
  writeAtomicDetoxConnectionBytes,
} from '../../scripts/testing/detox-connection-evidence';

void test('closed sidecar stdin is bounded and does not surface an unhandled EPIPE', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'detox-training-closed-stdin-'));
  const root = await realpath(rootPath);
  await chmod(root, 0o700);
  const child = spawn(
    process.execPath,
    ['-e', 'process.stdin.destroy(); setTimeout(() => process.exit(0), 2000)'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let childClosed = false;
  const childDone = new Promise<void>((resolve) => {
    child.once('close', () => {
      childClosed = true;
      resolve();
    });
  });
  const restore = __setDetoxConnectionEvidenceSpawnForTests((() => child) as never);
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown) => uncaught.push(error);
  process.once('uncaughtException', onUncaught);
  try {
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(
        root,
        'detox-training-closed-stdin.private.json',
        Buffer.from('{"kind":"closed-stdin"}\n'),
        64 * 1024,
        { deadlineAt: performance.now() + 500 },
      ),
      /stdin|writer|protocol|recovery|deadline/i,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(uncaught, []);
  } finally {
    process.removeListener('uncaughtException', onUncaught);
    restore();
    if (!childClosed && child.exitCode === null) child.kill('SIGKILL');
    await childDone;
    await rm(root, { recursive: true, force: true });
  }
});
