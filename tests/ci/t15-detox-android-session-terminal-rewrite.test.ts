import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  createNativePilotOutputRoot,
  writeNativePilotTerminalReceipt,
} from '../../scripts/testing/native-pilot-invocation';

void test('protected Android Detox terminal replacement persists the blocked reread outcome', async () => {
  const parent = await mkdtemp('/Users/eduwaldo/.codex/t15-android-terminal-rewrite-');
  await chmod(parent, 0o700);
  const runId = 'a'.repeat(24);
  const attemptId = `${runId}:first`;
  const prepared = await createNativePilotOutputRoot({
    invocation: {
      selection: {
        platform: 'android',
        engine: 'detox',
        scenario: 'SCN-session-android',
        mode: 'integration',
      } as never,
      requestedRunId: runId,
      requestedAttemptId: attemptId,
      outputParent: parent,
    },
    defaultOutputParent: parent,
    deadlineAt: performance.now() + 30_000,
  });
  const initial = {
    schemaVersion: 1,
    runId,
    attemptId,
    result: 'passed',
    exitCode: 0,
    assertions: [{ id: 'NAT-session-login' }],
  };
  const blocked = {
    ...initial,
    result: 'harness-blocked',
    exitCode: 2,
    assertions: [],
    blocker: {
      code: 'android-detox-session-outer-receipt-unverified',
      detail: 'protected bridge failed',
    },
  };
  try {
    const first = await writeNativePilotTerminalReceipt({
      root: prepared.outputRoot,
      receipt: initial,
      namespaceIdentity: prepared.namespaceIdentity,
      recoveryDeadlineMs: 30_000,
    });
    assert.equal(first.status, 'published');
    const replacement = await writeNativePilotTerminalReceipt({
      root: prepared.outputRoot,
      receipt: blocked,
      namespaceIdentity: prepared.namespaceIdentity,
      recoveryDeadlineMs: 30_000,
      replaceExisting: true,
    });
    assert.equal(replacement.status, 'published');
    const persisted = JSON.parse(
      await readFile(`${prepared.outputRoot}/receipt.json`, 'utf8'),
    ) as typeof blocked;
    assert.equal(persisted.result, 'harness-blocked');
    assert.equal(persisted.exitCode, 2);
    assert.deepEqual(persisted.assertions, []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
