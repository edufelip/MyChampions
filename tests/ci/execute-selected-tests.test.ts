import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInvocations } from '../../scripts/ci/execute-selected-tests';
import type { CommandInvocation } from '../../scripts/ci/selective-execution';

// Each invocation is a real, trivial child process (no detox/emulator/Metro
// involved -- omitting `metro` on the CommandInvocation makes runInvocation
// take the plain runChild path). It writes a marker file before exiting, so
// we can prove -- from outside the child process -- whether it actually ran,
// which is the only way to detect the regression this guards against: a
// crashing invocation silently skipping every invocation scheduled after it.
function makeInvocation(id: string, markerDir: string, exitCode: number): CommandInvocation {
  const markerPath = join(markerDir, `${id}.marker`);
  const program = `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran'); process.exit(${exitCode});`;
  return {
    id,
    command: process.execPath,
    args: ['-e', program],
    env: {},
  };
}

function ran(markerDir: string, id: string): boolean {
  return existsSync(join(markerDir, `${id}.marker`));
}

test('runInvocations: all invocations succeed', async () => {
  const markerDir = mkdtempSync(join(tmpdir(), 'execute-selected-tests-'));
  try {
    const invocations = [
      makeInvocation('suite-a', markerDir, 0),
      makeInvocation('suite-b', markerDir, 0),
      makeInvocation('suite-c', markerDir, 0),
    ];

    await runInvocations(invocations, process.cwd(), undefined);

    for (const invocation of invocations) {
      assert.ok(ran(markerDir, invocation.id), `${invocation.id} should have run`);
    }
  } finally {
    rmSync(markerDir, { recursive: true, force: true });
  }
});

test('runInvocations: a failure in the middle does not skip later invocations', async () => {
  const markerDir = mkdtempSync(join(tmpdir(), 'execute-selected-tests-'));
  try {
    const invocations = [
      makeInvocation('suite-a', markerDir, 0),
      makeInvocation('suite-b-crash', markerDir, 1),
      makeInvocation('suite-c', markerDir, 0),
      makeInvocation('suite-d', markerDir, 0),
    ];

    await assert.rejects(
      runInvocations(invocations, process.cwd(), undefined),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /1 of 4 invocation\(s\) failed/);
        assert.match(error.message, /suite-b-crash/);
        return true;
      },
    );

    // The regression: before the fix, suite-c and suite-d never ran because
    // the bare loop threw and aborted the batch at suite-b-crash.
    for (const invocation of invocations) {
      assert.ok(ran(markerDir, invocation.id), `${invocation.id} should have run`);
    }
  } finally {
    rmSync(markerDir, { recursive: true, force: true });
  }
});

test('runInvocations: two non-adjacent failures both run and are both reported', async () => {
  const markerDir = mkdtempSync(join(tmpdir(), 'execute-selected-tests-'));
  try {
    const invocations = [
      makeInvocation('suite-a', markerDir, 0),
      makeInvocation('suite-b-crash', markerDir, 1),
      makeInvocation('suite-c', markerDir, 0),
      makeInvocation('suite-d-crash', markerDir, 1),
      makeInvocation('suite-e', markerDir, 0),
    ];

    await assert.rejects(
      runInvocations(invocations, process.cwd(), undefined),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /2 of 5 invocation\(s\) failed/);
        assert.match(error.message, /suite-b-crash/);
        assert.match(error.message, /suite-d-crash/);
        return true;
      },
    );

    for (const invocation of invocations) {
      assert.ok(ran(markerDir, invocation.id), `${invocation.id} should have run`);
    }
  } finally {
    rmSync(markerDir, { recursive: true, force: true });
  }
});
