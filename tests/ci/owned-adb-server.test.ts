import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireAdbServerReference,
  requireAdbServerPreserved,
} from '../../scripts/testing/owned-adb-server';
import type { AdbServerIdentity } from '../../scripts/testing/owned-adb-server';

void test('ADB service reference rejects replacement, user/command drift, and cancellation before acquisition', async () => {
  // Synthetic identity controls; the CI test does not start/stop global ADB.
  const server: AdbServerIdentity = {
    pid: 999999,
    pgid: 999999,
    uid: process.getuid!(),
    started: 'Tue Sep 29 13:20:47 2026',
    command: 'adb -L tcp:5037 fork-server server --reply-fd 4',
    commandHash: 'a'.repeat(64),
  };
  assert.doesNotThrow(() => requireAdbServerPreserved(server, structuredClone(server)));
  for (const changed of [
    null,
    { pid: 999998 },
    { started: 'Tue Sep 29 13:20:48 2026' },
    { uid: server.uid + 1 },
    { commandHash: 'b'.repeat(64) },
    { command: 'adb -L tcp:5037 nodaemon server' },
    { pgid: 999998 },
  ])
    assert.throws(() => requireAdbServerPreserved(server, changed && { ...server, ...changed }));
  const root = await mkdtemp(path.join(os.tmpdir(), 'mc-adb-cancel-'));
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      acquireAdbServerReference({
        artifactRoot: root,
        mode: 'borrow-if-present',
        signal: controller.signal,
      }),
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
