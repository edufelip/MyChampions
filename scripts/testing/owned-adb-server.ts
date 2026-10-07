import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { startOwnedNativeCommand } from './owned-native-command';
import {
  inspectProcessIdentity,
  readOnlyAdbDevicePayload,
  requireOwnedAdbConsumerBoundary,
  requireOwnedProcessIdentity,
} from './owned-process-group';

const execute = promisify(execFile);
export type AdbServerIdentity = NonNullable<Awaited<ReturnType<typeof inspectProcessIdentity>>>;

/** One default-port service. Unknown/ambiguous listeners never become owned. */
export async function inspectAdbServer(): Promise<AdbServerIdentity | null> {
  let stdout: string;
  try {
    ({ stdout } = await execute('lsof', ['-nP', '-tiTCP:5037', '-sTCP:LISTEN'], { timeout: 2000 }));
  } catch (error) {
    if (
      (error as { code?: unknown; stdout?: unknown; stderr?: unknown }).code === 1 &&
      !(error as { stdout?: string }).stdout?.trim() &&
      !(error as { stderr?: string }).stderr?.trim()
    )
      return null;
    throw error;
  }
  const ids = [...new Set(stdout.trim().split(/\s+/).map(Number))];
  assert(ids.length === 1 && Number.isSafeInteger(ids[0]) && ids[0] > 1, 'Ambiguous ADB listener');
  const row = await inspectProcessIdentity(ids[0]);
  assert(row, 'ADB listener process disappeared');
  requireOwnedProcessIdentity(row, row); // Same user/caller policy, no ownership claim.
  assert.match(
    row.command,
    /^(?:\S*\/)?adb -L tcp:5037 (?:fork-server server --reply-fd \d+|nodaemon server)$/,
  );
  return row;
}

export function requireAdbServerPreserved(
  before: AdbServerIdentity,
  after: AdbServerIdentity | null,
) {
  assert(after, 'ADB service disappeared or was replaced');
  requireOwnedProcessIdentity(before, after);
  assert.equal(after.pgid, before.pgid, 'ADB service group changed');
  assert.equal(after.command, before.command, 'ADB service command changed');
}

/** Held across commands; an existing server is borrowed and must survive untouched. */
export async function acquireAdbServerReference(options: {
  artifactRoot: string;
  mode: 'borrow-if-present' | 'own-or-borrow';
  signal?: AbortSignal;
}) {
  assert(options.mode === 'borrow-if-present' || options.mode === 'own-or-borrow');
  options.signal?.throwIfAborted();
  const root = await realpath(options.artifactRoot);
  const meta = await lstat(root);
  assert(
    root === path.resolve(options.artifactRoot) &&
      meta.isDirectory() &&
      meta.uid === process.getuid?.() &&
      (meta.mode & 0o777) === 0o700,
    'ADB evidence root must be private/canonical/owned',
  );
  const before = await inspectAdbServer();
  await writeFile(
    path.join(root, 'adb-server-before.private.json'),
    JSON.stringify(
      {
        kind: 'session ADB baseline; inspection is not ownership',
        identity: before,
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  let worker: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  let identity: AdbServerIdentity;
  const mode = before ? 'borrowed' : 'owned';
  try {
    options.signal?.throwIfAborted();
    if (before) identity = before;
    else {
      assert.equal(
        options.mode,
        'own-or-borrow',
        'Borrowed ADB service is absent; no startup authorized',
      );
      worker = await startOwnedNativeCommand({
        command: 'adb',
        argv: ['-L', 'tcp:5037', 'nodaemon', 'server'],
        artifactRoot: root,
        label: 'adb-server',
        env: {
          ...process.env,
          ADB_SERVER_SOCKET: 'tcp:127.0.0.1:5037',
          ANDROID_ADB_SERVER_PORT: '5037',
        },
      });
      const deadline = performance.now() + 5000;
      let current: AdbServerIdentity | null = null;
      while (performance.now() < deadline) {
        options.signal?.throwIfAborted();
        current = await inspectAdbServer();
        if (current) break;
        if (worker.outcome().code !== null || worker.outcome().signal !== null)
          throw new Error('Owned foreground ADB failed before readiness');
        await delay(50);
      }
      assert(
        current && current.pid === worker.pid,
        'ADB startup race or readiness failure; foreign service preserved',
      );
      identity = current;
      await worker.capture(true);
    }
    requireAdbServerPreserved(identity, await inspectAdbServer());
    requireOwnedAdbConsumerBoundary({
      pid: identity.pid,
      listenerPids: [identity.pid],
      devicePayload: await readOnlyAdbDevicePayload(),
      foreignJobCount: 0,
    });
  } catch (error) {
    await worker?.stop();
    throw error;
  }
  const report = {
    kind: 'session-wide default-port ADB reference',
    mode,
    identity,
    cleanup: 'running',
    observations: [] as { phase: string; identity: AdbServerIdentity }[],
  };
  const assertAlive = async (phase: string) => {
    const current = await inspectAdbServer();
    requireAdbServerPreserved(identity, current);
    report.observations.push({ phase, identity: current! });
  };
  await writeFile(
    path.join(root, 'adb-server-reference.private.json'),
    JSON.stringify(report, null, 2),
    { flag: 'wx', mode: 0o600 },
  );
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      try {
        await assertAlive('before-session-release');
        if (worker) {
          await worker.stop();
          assert.equal(
            await inspectAdbServer(),
            null,
            'Unknown ADB replacement after owned release',
          );
          report.cleanup = 'owned-released';
        } else {
          await assertAlive('borrowed-preserved');
          report.cleanup = 'borrowed-preserved';
        }
      } catch (error) {
        report.cleanup = 'failed-recovery-retained';
        throw error;
      } finally {
        await writeFile(
          path.join(root, 'adb-server-cleanup.private.json'),
          JSON.stringify(report, null, 2),
          { flag: 'wx', mode: 0o600 },
        );
      }
    })();
    return stopping;
  };
  return { report, assertAlive, stop };
}
