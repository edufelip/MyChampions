import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runChild } from '../../scripts/ci/execute-selected-tests';

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Process ${pid} survived invocation timeout cleanup`);
}

test(
  'timed-out invocation reports its ID and terminates its exact owned process group',
  { skip: process.platform === 'win32' },
  async () => {
    const temp = mkdtempSync(join(tmpdir(), 'selective-invocation-timeout-'));
    const descendantPidPath = join(temp, 'descendant.pid');
    const descendantProgram =
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
    const leaderProgram = `
      const { spawn } = require('node:child_process');
      const { writeFileSync } = require('node:fs');
      process.on('SIGTERM', () => {});
      const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantProgram)}], {
        detached: false,
        stdio: 'ignore',
      });
      writeFileSync(${JSON.stringify(descendantPidPath)}, String(descendant.pid));
      setInterval(() => {}, 1000);
    `;

    try {
      await assert.rejects(
        runChild(
          'detox:timeout-fixture',
          process.execPath,
          ['-e', leaderProgram],
          process.cwd(),
          process.env,
          150
        ),
        /Invocation detox:timeout-fixture timed out after 150 ms/
      );
      const descendantPid = Number(readFileSync(descendantPidPath, 'utf8'));
      assert.ok(Number.isInteger(descendantPid) && descendantPid > 0);
      await waitForProcessExit(descendantPid);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
);

test('invocation remains unbounded when no timeout is configured', async () => {
  await runChild(
    'local:unbounded',
    process.execPath,
    ['-e', 'process.exit(0)'],
    process.cwd(),
    process.env,
    undefined
  );
});
