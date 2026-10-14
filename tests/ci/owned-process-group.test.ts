import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  OwnedProcessCensusQueryError,
  inspectProcessIdentity,
  OwnedCommandCensusUnavailableError,
  groupProcesses,
  requireOwnedProcessIdentity,
  requireOwnedAdbConsumerBoundary,
  trackOwnedProcessGroup,
  type OwnedProcess,
  escapedOwnedProcesses,
  darwinPsCommandUnavailable,
  requireAvailableOwnedCommandCensus,
  observeOwnedCommandCensus,
  requireOwnedCensusUserBoundary,
  type CommandCensusRequery,
} from '../../scripts/testing/owned-process-group';

void test('background census retains unavailable observations while strict authority rejects them within one requery', async () => {
  const command = '/owned/adb';
  const row = {
    pid: 4321,
    pgid: 4000,
    started: 'Wed Sep 30 09:46:45 2026',
    commandHash: createHash('sha256').update(command).digest('hex'),
    uid: process.getuid!(),
    command,
  };
  const unavailable = {
    ...row,
    command: '(adb)',
    commandHash: createHash('sha256').update('(adb)').digest('hex'),
  };
  for (const strict of [false, true]) {
    let reads = 0;
    const events: CommandCensusRequery[] = [];
    const observation = observeOwnedCommandCensus({
      read: () => {
        reads++;
        return Promise.resolve([unavailable]);
      },
      relevant: (r) => r.pgid === row.pgid,
      onRequery: (event) => events.push(event),
      requireAvailable: strict,
      boundary: requireOwnedCensusUserBoundary,
      darwin: true,
    });
    if (strict) await assert.rejects(observation, /command census unavailable/);
    else assert.deepEqual(await observation, [unavailable]);
    assert.equal(reads, 2);
    assert.equal(events.length, 1);
    assert.equal(events[0].result, 'unavailable');
    assert.equal(events[0].unavailable[0].pid, row.pid);
    assert.equal(events[0].current[0].commandHash, unavailable.commandHash);
    assert.equal(events[0].unavailable[0].uid, process.getuid!());
  }
  let reads = 0;
  const events: CommandCensusRequery[] = [];
  assert.deepEqual(
    await observeOwnedCommandCensus({
      read: () => Promise.resolve(++reads === 1 ? [unavailable] : []),
      relevant: (r) => r.pgid === row.pgid,
      onRequery: (event) => events.push(event),
      boundary: requireOwnedCensusUserBoundary,
      darwin: true,
    }),
    [],
  );
  assert.equal(reads, 2);
  assert.equal(events[0].unavailable[0].pid, row.pid);
  assert.deepEqual(events[0].current, []);
  assert.equal(events[0].result, 'available');
});

void test('strict Darwin startup census settles short-lived child turnover without adopting placeholders', async () => {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const leader = {
    pid: 94127,
    pgid: 94127,
    started: 'Sun Oct  4 08:55:08 2026',
    commandHash: hash('/owned/emulator'),
    uid: process.getuid!(),
    command: '/owned/emulator',
  };
  const firstUnavailable = {
    pid: 94315,
    pgid: leader.pgid,
    started: 'Sun Oct  4 08:55:09 2026',
    commandHash: hash('(emulator)'),
    uid: leader.uid,
    command: '(emulator)',
  };
  const secondUnavailable = {
    pid: 94352,
    pgid: leader.pgid,
    started: 'Sun Oct  4 08:55:10 2026',
    commandHash: hash('(emulator)'),
    uid: leader.uid,
    command: '(emulator)',
  };
  const snapshots = [[leader, firstUnavailable], [leader, secondUnavailable], [leader]];
  let reads = 0;
  let now = 0;
  const sleeps: number[] = [];
  const events: CommandCensusRequery[] = [];
  const result = await observeOwnedCommandCensus({
    read: () => Promise.resolve(snapshots[Math.min(reads++, snapshots.length - 1)]),
    relevant: (row) => row.pgid === leader.pgid,
    onRequery: (event) => events.push(event),
    requireAvailable: true,
    boundary: requireOwnedCensusUserBoundary,
    darwin: true,
    settle: {
      untilMonotonicMs: 100,
      delayMs: 25,
      maxRequeries: 8,
      now: () => now,
      sleep: (delayMs) => {
        sleeps.push(delayMs);
        now += delayMs;
        return Promise.resolve();
      },
    },
  });
  assert.deepEqual(result, [leader]);
  assert.equal(reads, 3);
  assert.deepEqual(sleeps, [25]);
  assert.equal(events.length, 2);
  assert.deepEqual(
    events[0].unavailable.map((row) => row.pid),
    [firstUnavailable.pid],
  );
  assert.deepEqual(
    events[0].current.map((row) => row.pid),
    [leader.pid, secondUnavailable.pid],
  );
  assert.equal(events[0].result, 'unavailable');
  assert.deepEqual(
    events[1].unavailable.map((row) => row.pid),
    [secondUnavailable.pid],
  );
  assert.deepEqual(
    events[1].current.map((row) => row.pid),
    [leader.pid],
  );
  assert.equal(events[1].result, 'available');
  assert(
    !result.some((row) => row.pid === firstUnavailable.pid || row.pid === secondUnavailable.pid),
  );
});

void test('strict Darwin settling remains bounded by the original deadline and retries no other failure', async () => {
  const row = {
    pid: 94315,
    pgid: 94127,
    started: 'Sun Oct  4 08:55:09 2026',
    commandHash: createHash('sha256').update('(emulator)').digest('hex'),
    uid: process.getuid!(),
    command: '(emulator)',
  };
  let now = 0;
  let reads = 0;
  let sleeps = 0;
  await assert.rejects(
    observeOwnedCommandCensus({
      read: () => {
        reads++;
        return Promise.resolve([row]);
      },
      relevant: (candidate) => candidate.pgid === row.pgid,
      requireAvailable: true,
      boundary: requireOwnedCensusUserBoundary,
      darwin: true,
      settle: {
        untilMonotonicMs: 60,
        delayMs: 25,
        maxRequeries: 99,
        now: () => now,
        sleep: (delayMs) => {
          sleeps++;
          now += delayMs;
          return Promise.resolve();
        },
      },
    }),
    /census deadline/,
  );
  assert.equal(reads, 4);
  assert.equal(sleeps, 3);
  assert.equal(now, 60);

  reads = 0;
  await assert.rejects(
    observeOwnedCommandCensus({
      read: () => {
        reads++;
        return Promise.reject(new Error('foreign boundary'));
      },
      relevant: () => true,
      requireAvailable: true,
      darwin: true,
      settle: { untilMonotonicMs: 100, maxRequeries: 8, now: () => 0 },
    }),
    /foreign boundary/,
  );
  assert.equal(reads, 1);

  const controller = new AbortController();
  let abortedReads = 0;
  await assert.rejects(
    observeOwnedCommandCensus({
      read: () => {
        abortedReads++;
        controller.abort();
        return Promise.resolve([row]);
      },
      relevant: (candidate) => candidate.pgid === row.pgid,
      requireAvailable: true,
      darwin: true,
      settle: { untilMonotonicMs: 100, signal: controller.signal, now: () => 0 },
    }),
    /aborted/i,
  );
  assert.equal(abortedReads, 1);

  await assert.rejects(
    observeOwnedCommandCensus({
      read: () => Promise.reject(new OwnedCommandCensusUnavailableError()),
      relevant: () => true,
      requireAvailable: true,
      darwin: true,
      settle: { untilMonotonicMs: 100, maxRequeries: 8, now: () => 0 },
    }),
    /command census unavailable/,
  );
});

void test('both census boundaries reject foreign users/caller and preserve first diagnostics when inspection fails', async () => {
  const row = {
    pid: 4321,
    pgid: 4000,
    started: 'Wed Sep 30 09:46:45 2026',
    commandHash: 'unavailable',
    uid: process.getuid!(),
    command: '(adb)',
  };
  for (const firstBad of [true, false])
    for (const change of [{ uid: row.uid + 1 }, { pid: process.pid }]) {
      let reads = 0;
      const events: CommandCensusRequery[] = [];
      await assert.rejects(
        observeOwnedCommandCensus({
          read: () =>
            Promise.resolve((++reads === 1) === firstBad ? [{ ...row, ...change }] : [row]),
          relevant: (r) => r.pgid === row.pgid,
          onRequery: (event) => events.push(event),
          requireAvailable: false,
          boundary: requireOwnedCensusUserBoundary,
          darwin: true,
        }),
        /foreign user or caller/,
      );
      assert.equal(reads, firstBad ? 1 : 2);
      assert.equal(events.length, 1);
      const recorded = firstBad ? events[0].unavailable : events[0].current;
      assert.equal(recorded[0].uid, change.uid ?? row.uid);
      assert.equal(recorded[0].pid, change.pid ?? row.pid);
    }
  let reads = 0;
  const events: CommandCensusRequery[] = [];
  await assert.rejects(
    observeOwnedCommandCensus({
      read: () => {
        if (++reads === 2) return Promise.reject(new Error('ps failed'));
        return Promise.resolve([row]);
      },
      relevant: () => true,
      onRequery: (event) => events.push(event),
      boundary: requireOwnedCensusUserBoundary,
      darwin: true,
    }),
    /ps failed/,
  );
  assert.equal(reads, 2);
  assert.equal(events[0].unavailable[0].pid, row.pid);
  assert.equal(events[0].result, 'unavailable');
});

void test('Darwin argv-unavailable placeholders require a fresh actual command and do not authorize exec drift, reused PIDs or unrelated ownership', () => {
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const command = '/owned/platform-tools/adb -s emulator-5554 shell logcat -G 2M';
  const acquired = {
    pid: 4321,
    pgid: 4000,
    started: 'Wed Sep 30 09:46:45 2026',
    commandHash: hash(command),
    uid: process.getuid!(),
    command,
  };
  const unavailable = {
    ...acquired,
    command: '(adb)',
    commandHash: hash('(adb)'),
  };
  const relevant = (row: typeof acquired) => row.pgid === acquired.pgid;
  assert(darwinPsCommandUnavailable('(adb)'));
  assert(darwinPsCommandUnavailable('(a process name)'));
  assert(!darwinPsCommandUnavailable(command));
  assert(!darwinPsCommandUnavailable('adb (extra)'));
  assert.throws(
    () => requireAvailableOwnedCommandCensus([unavailable], relevant),
    /command census unavailable/,
  );
  const restored = requireAvailableOwnedCommandCensus([acquired], relevant);
  assert.deepEqual(restored, [acquired]);
  requireOwnedProcessIdentity(acquired, restored[0]);
  for (const patch of [
    { started: 'Wed Sep 30 09:46:46 2026' },
    { command: '/foreign/worker', commandHash: hash('/foreign/worker') },
    { uid: process.getuid!() + 1 },
  ]) {
    const current = requireAvailableOwnedCommandCensus([{ ...acquired, ...patch }], relevant);
    assert.throws(() => requireOwnedProcessIdentity(acquired, current[0]), /identity changed/);
  }
  const foreign = { ...unavailable, pid: 9876, pgid: 9000 };
  assert.deepEqual(requireAvailableOwnedCommandCensus([acquired, foreign], relevant), [
    acquired,
    foreign,
  ]);
  assert.deepEqual(requireAvailableOwnedCommandCensus([], relevant), []);
  assert.equal(acquired.commandHash, hash(command));
});

type LiveLedger = {
  cleanup: string;
  processes: OwnedProcess[];
  leaderExecutions: unknown[];
  rejectedCensus?: {
    census: { strict: boolean; groupMembers: OwnedProcess[] };
    reason: string;
  };
};
type BuildCleanupLedger = LiveLedger & {
  cleanupMode: 'step' | 'build';
  naturalExitGraceMs: number;
  escapedSignals: unknown[];
};

void test('escaped ownership excludes reused PIDs while retaining exact-pair command drift for strict rejection', () => {
  const original: OwnedProcess = {
    pid: 4321,
    pgid: 4000,
    started: 'Tue Sep 29 22:00:00 2026',
    commandHash: 'original',
  };
  const acquired = new Map([[original.pid, original]]);
  const moved = { ...original, pgid: 5000 };
  const drift = { ...moved, commandHash: 'changed' };
  const reused = { ...moved, started: 'Tue Sep 29 22:01:00 2026' };
  const foreign = { ...moved, pid: 8765 };
  assert.deepEqual(
    escapedOwnedProcesses([original, moved, reused, foreign], original.pgid, acquired),
    [moved],
  );
  assert.deepEqual(escapedOwnedProcesses([drift], original.pgid, acquired), [drift]);
  assert.throws(() => requireOwnedProcessIdentity(original, { ...drift, uid: process.getuid!() }));
  assert.deepEqual(acquired.get(original.pid), original);
});

void test('build cleanup observes natural shutdown even while the first census is verified', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'mc-build-natural-'));
  const child = spawn(
    process.execPath,
    [
      '-e',
      'process.stdin.once("data",()=>setTimeout(()=>{console.log("natural-shutdown");process.exit(0)},500));console.log("ready")',
    ],
    { detached: true, stdio: ['pipe', 'pipe', 'ignore'] },
  );
  child.stdin.on('error', () => undefined);
  const closed = once(child, 'close');
  let group: Awaited<ReturnType<typeof trackOwnedProcessGroup>> | undefined;
  let logs = '';
  child.stdout.on('data', (chunk: Buffer) => {
    logs += chunk.toString();
  });
  try {
    await once(child.stdout, 'data', { signal: AbortSignal.timeout(5000) });
    group = await trackOwnedProcessGroup(child, path.join(output, 'ownership.json'), 'build');
    assert.equal((await group.capture(true)).length, 1);
    child.stdin.end('finish');
    await group.stop();
    await closed;
    assert.equal(child.exitCode, 0);
    assert.equal(child.signalCode, null);
    assert.match(logs, /natural-shutdown/);
    const ledger = JSON.parse(
      await readFile(path.join(output, 'ownership.json'), 'utf8'),
    ) as BuildCleanupLedger;
    assert.equal(ledger.cleanup, 'cleaned');
    assert.deepEqual(ledger.escapedSignals, []);
  } finally {
    child.stdin.end('finish');
    await group?.stop().catch(() => undefined);
    await closed;
    await rm(output, { recursive: true });
  }
});

async function startUnverifiedBuildDescendant(mode: 'natural' | 'persistent') {
  const output = await mkdtemp(path.join(os.tmpdir(), 'mc-build-shutdown-'));
  const releasePath = path.join(output, 'release');
  let releasePromise: Promise<void> | undefined;
  const release = () =>
    (releasePromise ??= writeFile(releasePath, 'release', {
      flag: 'wx',
      mode: 0o600,
    }));
  const helper = `
import os, sys
r,w=os.pipe()
nested=os.fork()
if nested == 0:
    os.close(w)
    if os.read(r,1) != b'x': os._exit(0)
    script = 'import pathlib,sys,time; print("changed",flush=True); ' + ('time.sleep(2)' if sys.argv[1] == 'natural' else '\\nwhile not pathlib.Path(sys.argv[1]).exists(): time.sleep(0.05)')
    os.execv(sys.executable,[sys.executable,'-u','-c',script,sys.argv[2]])
else:
    os.close(r)
    print('ready',flush=True)
    if sys.stdin.buffer.read(1) != b'x': os._exit(0)
    os.write(w,b'x')
    os.close(w)
`;
  const child = spawn('python3', ['-u', '-c', helper, mode, releasePath], {
    detached: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  child.stdin.on('error', () => undefined);
  const closed = once(child, 'close');
  let group: Awaited<ReturnType<typeof trackOwnedProcessGroup>> | undefined;
  try {
    await once(child.stdout, 'data', { signal: AbortSignal.timeout(5000) });
    group = await trackOwnedProcessGroup(child, path.join(output, 'ownership.json'), 'build');
    const original = await group.capture(true);
    assert.equal(original.length, 2);
    const changed = once(child.stdout, 'data', {
      signal: AbortSignal.timeout(5000),
    });
    child.stdin.write('x');
    await changed;
    await assert.rejects(group.capture(true), /identity changed|Unverified worker group member/);
    return { output, child, closed, group, original, release };
  } catch (error) {
    await release();
    child.stdin.end('\n');
    await closed;
    await group?.stop().catch(() => undefined);
    await rm(output, { recursive: true });
    throw error;
  }
}

void test('build cleanup lets an unverified exec descendant exit naturally without adopting its new command', async () => {
  const { output, child, closed, group, original, release } =
    await startUnverifiedBuildDescendant('natural');
  try {
    await group.stop();
    await closed;
    assert.deepEqual(await groupProcesses(group.pgid), []);
    const ledger = JSON.parse(
      await readFile(path.join(output, 'ownership.json'), 'utf8'),
    ) as BuildCleanupLedger;
    assert.equal(ledger.cleanup, 'cleaned');
    assert.equal(ledger.cleanupMode, 'build');
    assert.equal(ledger.naturalExitGraceMs, 5000);
    assert.deepEqual(
      ledger.processes,
      original.map(({ pid, pgid, started, commandHash }) => ({
        pid,
        pgid,
        started,
        commandHash,
      })),
    );
    assert.deepEqual(ledger.escapedSignals, []);
    assert.equal(child.signalCode, null);
    assert.equal(ledger.rejectedCensus?.census.strict, true);
    assert.match(ledger.rejectedCensus.reason, /identity changed|Unverified worker group member/);
    assert(
      ledger.rejectedCensus.census.groupMembers.some((row) =>
        original.some(
          (previous) =>
            previous.pid === row.pid &&
            previous.started === row.started &&
            previous.commandHash !== row.commandHash,
        ),
      ),
    );
  } finally {
    await release();
    child.stdin.end('\n');
    await closed;
    await group.stop().catch(() => undefined);
    await rm(output, { recursive: true });
  }
});

void test('build cleanup still rejects persistent identity drift and leaves release to the controlled child', async () => {
  const { output, child, closed, group, original, release } =
    await startUnverifiedBuildDescendant('persistent');
  try {
    await assert.rejects(group.stop(), /identity changed|Unverified worker group member/);
    const ledger = JSON.parse(
      await readFile(path.join(output, 'ownership.json'), 'utf8'),
    ) as BuildCleanupLedger;
    assert.equal(ledger.cleanup, 'failed-recovery-ledger-retained');
    assert.equal(ledger.naturalExitGraceMs, 5000);
    assert.deepEqual(
      ledger.processes,
      original.map(({ pid, pgid, started, commandHash }) => ({
        pid,
        pgid,
        started,
        commandHash,
      })),
    );
    assert.deepEqual(ledger.escapedSignals, []);
    assert((await groupProcesses(group.pgid)).length > 0);
    assert.equal(child.signalCode, null);
    await release();
    child.stdin.end('\n');
    await closed;
    assert.deepEqual(await groupProcesses(group.pgid), []);
    assert.equal(
      (
        JSON.parse(
          await readFile(path.join(output, 'ownership.json'), 'utf8'),
        ) as BuildCleanupLedger
      ).cleanup,
      'failed-recovery-ledger-retained',
    );
  } finally {
    await release();
    child.stdin.end('\n');
    await closed;
    await group.stop().catch(() => undefined);
    await rm(output, { recursive: true });
  }
});

void test('owned launcher exec retains direct child identity and cleans the replacement process', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'mc-worker-exec-'));
  // Gate exec on stdin so tracking sees the shell before it becomes Node.
  const child = spawn(
    '/bin/sh',
    [
      '-c',
      'read gate; exec "$1" -e \'console.log("executed");setInterval(()=>{},1000)\'',
      'owned-launcher',
      process.execPath,
    ],
    { detached: true, stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const closed = once(child, 'close');
  let group: Awaited<ReturnType<typeof trackOwnedProcessGroup>> | undefined;
  try {
    group = await trackOwnedProcessGroup(child, path.join(output, 'ownership.json'));
    const before = await group.capture();
    assert.equal(before.length, 1);
    const ready = once(child.stdout, 'data', {
      signal: AbortSignal.timeout(5000),
    });
    child.stdin.end('continue\n');
    await ready;
    const after = await group.capture(true);
    assert.equal(after[0].pid, before[0].pid);
    assert.equal(after[0].started, before[0].started);
    assert.notEqual(after[0].commandHash, before[0].commandHash);
    const afterIdentities = after.map(({ pid, pgid, started, commandHash }) => ({
      pid,
      pgid,
      started,
      commandHash,
    }));
    // An external observer cannot use our in-memory child handle. It needs the
    // owner's current exact identity while the replacement process is live.
    const liveLedger = JSON.parse(
      await readFile(path.join(output, 'ownership.json'), 'utf8'),
    ) as LiveLedger;
    assert.equal(liveLedger.cleanup, 'running');
    assert.deepEqual(liveLedger.processes, afterIdentities);
    assert.equal(liveLedger.leaderExecutions.length, 1);
    assert.equal((await stat(path.join(output, 'ownership.json'))).mode & 0o777, 0o600);
    const observed = (await groupProcesses(group.pgid))[0];
    requireOwnedProcessIdentity(liveLedger.processes[0], {
      ...observed,
      uid: process.getuid!(),
    });
    const reads = Array.from({ length: 12 }, async () => {
      await group!.capture(true);
      const bytes = await readFile(path.join(output, 'ownership.json'), 'utf8');
      const snapshot = JSON.parse(bytes) as LiveLedger;
      assert.equal(snapshot.cleanup, 'running');
      assert.deepEqual(snapshot.processes, afterIdentities);
    });
    await Promise.all(reads);
    assert.deepEqual(await readdir(output), ['ownership.json']);
    await group.stop();
    await closed;
    assert.deepEqual(await groupProcesses(group.pgid), []);
    const ledger = JSON.parse(await readFile(path.join(output, 'ownership.json'), 'utf8')) as {
      cleanup: string;
      leaderExecutions: { previousCommandHash: string; commandHash: string }[];
    };
    assert.equal(ledger.cleanup, 'cleaned');
    assert.deepEqual(ledger.leaderExecutions, [
      {
        started: before[0].started,
        previousCommandHash: before[0].commandHash,
        commandHash: after[0].commandHash,
      },
    ]);
  } finally {
    await group?.stop();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
    await rm(output, { recursive: true });
  }
});

void test('failed live ledger publication rejects its census and leaves complete prior bytes', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'mc-worker-publication-'));
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  const closed = once(child, 'close');
  let group: Awaited<ReturnType<typeof trackOwnedProcessGroup>> | undefined;
  try {
    group = await trackOwnedProcessGroup(child, path.join(output, 'ownership.json'));
    const previous = await readFile(path.join(output, 'ownership.json'), 'utf8');
    await chmod(output, 0o500);
    await assert.rejects(group.capture(true), { code: 'EACCES' });
    assert.equal(await readFile(path.join(output, 'ownership.json'), 'utf8'), previous);
    assert.deepEqual(await readdir(output), ['ownership.json']);
    await chmod(output, 0o700);
    // A failed publication cannot poison later independent ownership queries.
    await group.capture(true);
    await group.stop();
    await closed;
    assert.deepEqual(await groupProcesses(group.pgid), []);
  } finally {
    await chmod(output, 0o700);
    await group?.stop();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
    await rm(output, { recursive: true });
  }
});

void test('owned worker cleanup escalates for a TERM-ignoring descendant and preserves another group', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'mc-worker-group-'));
  const foreign = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const {spawn}=require('node:child_process');
    const nested=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)'],{stdio:['ignore','pipe','ignore']});
    nested.stdout.once('data',()=>{console.log('ready');setInterval(()=>{},1000)});
  `,
    ],
    { detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const closed = once(child, 'close');
  const foreignClosed = once(foreign, 'close');
  let group: Awaited<ReturnType<typeof trackOwnedProcessGroup>> | undefined;
  try {
    await once(child.stdout, 'data', { signal: AbortSignal.timeout(5000) });
    group = await trackOwnedProcessGroup(child, path.join(output, 'ownership.json'));
    assert.equal((await group.capture()).length, 2);
    const stopping = group.stop();
    assert.equal(group.stop(), stopping);
    await stopping;
    await closed;
    assert.deepEqual(await groupProcesses(group.pgid), []);
    assert.equal((await groupProcesses(foreign.pid!)).length, 1);
    const ledger = JSON.parse(await readFile(path.join(output, 'ownership.json'), 'utf8')) as {
      cleanup: string;
      processes: unknown[];
    };
    assert.equal(ledger.cleanup, 'cleaned');
    assert.equal(ledger.processes.length, 2);
  } finally {
    await group?.stop();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    foreign.kill('SIGTERM');
    await foreignClosed;
    await rm(output, { recursive: true });
  }
});

void test('process group inspection rejects caller and invalid group identities', async () => {
  await assert.rejects(groupProcesses(1));
  await assert.rejects(groupProcesses(Number.NaN));
});

void test('owned descendant leaving its group is released without signalling its new group members', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'mc-worker-escape-'));
  const helper = `
import os, sys, time, subprocess
r,w=os.pipe()
nested=os.fork()
if nested == 0:
    os.close(w)
    if os.read(r,1) != b'x': os._exit(0)
    os.setpgid(0,0)
    foreign=subprocess.Popen([sys.executable,'-c','import time; time.sleep(120)'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    print(str(os.getpid())+' '+str(foreign.pid),flush=True)
    time.sleep(120)
else:
    os.close(r)
    print('ready',flush=True)
    sys.stdin.readline()
    os.write(w,b'x')
    time.sleep(120)
`;
  const child = spawn('python3', ['-u', '-c', helper], {
    detached: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const closed = once(child, 'close');
  let group: Awaited<ReturnType<typeof trackOwnedProcessGroup>> | undefined;
  let escapedPid: number | undefined;
  let protectedMember: Awaited<ReturnType<typeof groupProcesses>>[number] | undefined;
  try {
    await once(child.stdout, 'data', { signal: AbortSignal.timeout(5000) });
    group = await trackOwnedProcessGroup(child, path.join(output, 'ownership.json'));
    assert.equal((await group.capture(true)).length, 2);
    const moved = once(child.stdout, 'data', {
      signal: AbortSignal.timeout(5000),
    });
    child.stdin.end('move\n');
    const [chunk] = (await moved) as [Buffer];
    const [escaped, foreign] = chunk.toString().trim().split(/\s+/).map(Number);
    escapedPid = escaped;
    const newGroup = await groupProcesses(escaped);
    protectedMember = newGroup.find((row) => row.pid === foreign);
    assert(protectedMember);
    const observed = await group.capture(true);
    assert(observed.some((row) => row.pid === escaped && row.pgid === escaped));
    assert(!observed.some((row) => row.pid === foreign));
    await group.stop();
    await closed;
    const surviving = await groupProcesses(escaped);
    assert(!surviving.some((row) => row.pid === escaped));
    assert.deepEqual(
      surviving.find((row) => row.pid === foreign),
      protectedMember,
    );
    const ledger = JSON.parse(await readFile(path.join(output, 'ownership.json'), 'utf8')) as {
      cleanup: string;
      escapedProcesses: { pid: number }[];
      processes: { pid: number }[];
    };
    assert.equal(ledger.cleanup, 'cleaned');
    assert.equal(ledger.escapedProcesses.length, 1);
    assert.equal(ledger.escapedProcesses[0].pid, escaped);
    assert(!ledger.processes.some((row: { pid: number }) => row.pid === foreign));
  } finally {
    await group?.stop().catch(() => undefined);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (escapedPid && protectedMember) {
      const current = (await groupProcesses(escapedPid)).find(
        (row) => row.pid === protectedMember!.pid,
      );
      if (
        current &&
        current.started === protectedMember.started &&
        current.commandHash === protectedMember.commandHash
      )
        process.kill(current.pid, 'SIGTERM');
    }
    await closed;
    await rm(output, { recursive: true });
  }
});

void test('escaped process identity permits only group change; PID/start/user/command mismatches reject', () => {
  const expected = {
    pid: 999999,
    pgid: 999998,
    started: 'Tue Sep 29 12:58:16 2026',
    commandHash: 'a'.repeat(64),
  };
  const current = { ...expected, pgid: 999997, uid: process.getuid!() };
  assert.doesNotThrow(() => requireOwnedProcessIdentity(expected, current));
  for (const changed of [
    { pid: expected.pid + 1 },
    { pid: process.pid },
    { started: 'Tue Sep 29 12:58:17 2026' },
    { uid: current.uid + 1 },
    { commandHash: 'b'.repeat(64) },
  ])
    assert.throws(
      () => requireOwnedProcessIdentity(expected, { ...current, ...changed }),
      /identity changed/,
    );
});

void test('ADB release rejects ambiguous listener, attached device and foreign native consumers', () => {
  const boundary = {
    pid: 999999,
    listenerPids: [999999],
    devicePayload: '',
    foreignJobCount: 0,
  };
  assert.doesNotThrow(() => requireOwnedAdbConsumerBoundary(boundary));
  assert.doesNotThrow(() =>
    requireOwnedAdbConsumerBoundary({
      ...boundary,
      listenerPids: [999999, 999999],
    }),
  );
  for (const changed of [
    { listenerPids: [] },
    { listenerPids: [999998] },
    { listenerPids: [999999, 999998] },
    { listenerPids: [Number.NaN] },
    { devicePayload: 'emulator-5554 device\n' },
    { foreignJobCount: 1 },
    { foreignJobCount: Number.NaN },
    { pid: 1 },
  ])
    assert.throws(
      () => requireOwnedAdbConsumerBoundary({ ...boundary, ...changed }),
      /ambiguous listener or foreign consumer/,
    );
});

void test('process-query diagnostics preserve known status and hash output without exposing foreign argv or guessing missing fields', () => {
  const secret = 'foreign argv secret';
  const diagnostic = new OwnedProcessCensusQueryError({
    message: secret,
    cmd: secret,
    code: 1,
    killed: false,
    signal: 'SIGTERM',
    stdout: 'é' + secret,
    stderr: Buffer.from(secret),
  });
  assert.deepEqual(diagnostic.queryFailure, {
    exitCode: 1,
    errorCode: null,
    killed: false,
    signal: 'SIGTERM',
    timeoutMs: 5000,
    maxBufferBytes: 8 * 1024 * 1024,
    stdout: {
      bytes: Buffer.byteLength('é' + secret),
      sha256: createHash('sha256')
        .update('é' + secret)
        .digest('hex'),
    },
    stderr: {
      bytes: Buffer.byteLength(secret),
      sha256: createHash('sha256').update(secret).digest('hex'),
    },
  });
  assert(!JSON.stringify(diagnostic).includes(secret));
  assert(!diagnostic.message.includes(secret));
  for (const error of [
    null,
    new Error(secret),
    { code: secret, signal: secret, killed: 1, stdout: 42, stderr: {} },
    { code: -2 },
  ]) {
    const result = new OwnedProcessCensusQueryError(error).queryFailure;
    assert.equal(result.exitCode, null);
    assert.equal(result.errorCode, null);
    assert.equal(result.signal, null);
    assert.equal(result.killed, null);
    assert.equal(result.stdout, null);
    assert.equal(result.stderr, null);
  }
  const binary = Buffer.from([0xff, 0x00, 0x80]);
  assert.deepEqual(new OwnedProcessCensusQueryError({ stdout: binary }).queryFailure.stdout, {
    bytes: 3,
    sha256: createHash('sha256').update(binary).digest('hex'),
  });
  const timeout = new OwnedProcessCensusQueryError({
    code: 'ETIMEDOUT',
    killed: true,
    signal: 'SIGTERM',
    stdout: '',
    stderr: '',
  }).queryFailure;
  assert.equal(timeout.errorCode, 'ETIMEDOUT');
  assert.equal(timeout.killed, true);
  assert.deepEqual(timeout.stdout, {
    bytes: 0,
    sha256: createHash('sha256').update('').digest('hex'),
  });
});

void test('a ps census that times out under load is retried with a fresh query', async () => {
  const shimRoot = await mkdtemp(path.join(os.tmpdir(), 'ps-shim-'));
  const counter = path.join(shimRoot, 'calls');
  // First call stalls past the 5 s census timeout; later calls use the real ps.
  await writeFile(
    path.join(shimRoot, 'ps'),
    `#!/bin/sh\nif [ ! -f "${counter}" ]; then : > "${counter}"; exec sleep 7; fi\nexec /bin/ps "$@"\n`,
    { mode: 0o755 },
  );
  const originalPath = process.env.PATH;
  process.env.PATH = `${shimRoot}:${originalPath ?? ''}`;
  try {
    const row = await inspectProcessIdentity(process.pid);
    assert.equal(row?.pid, process.pid);
  } finally {
    process.env.PATH = originalPath;
    await rm(shimRoot, { recursive: true, force: true });
  }
});
