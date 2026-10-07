import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  ownershipProcesses,
  processSurvivors,
} from '../../scripts/testing/native-cleanup-evidence';
import {
  OwnedNativeCommandAcquisitionError,
  OwnedNativeCommandError,
  buildLeaderHandshakeScript,
  executeOwnedNativeCommand,
  ownedNativeCommandOutputMaxBytes,
  startOwnedNativeCommand,
} from '../../scripts/testing/owned-native-command';
import {
  groupProcesses,
  observeGroupProcesses,
  inspectProcessIdentity,
} from '../../scripts/testing/owned-process-group';
import type { NativeCommandExecution } from '../../scripts/testing/owned-native-command';

async function artifactRoot() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-command-')));
  await chmod(root, 0o700);
  return root;
}

void test(
  'Darwin background unavailable argv never becomes owned exec and permits a zero-exit child only after strict cleanup',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await artifactRoot(),
      originalPath = process.env.PATH;
    const bin = path.join(root, 'bin'),
      flag = path.join(root, 'unavailable-pid'),
      releasePath = path.join(root, 'release');
    let releasePromise: Promise<void> | undefined;
    const release = () =>
      (releasePromise ??= writeFile(releasePath, '', {
        flag: 'wx',
        mode: 0o600,
      }));
    let child: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
    try {
      await mkdir(bin, { mode: 0o700 });
      await writeFile(
        path.join(bin, 'ps'),
        `#!/usr/bin/env python3
import pathlib,re,subprocess,sys
r=subprocess.run(['/bin/ps',*sys.argv[1:]],capture_output=True,text=True)
flag=pathlib.Path(${JSON.stringify(flag)})
pid=int(flag.read_text()) if flag.exists() else -1
for line in r.stdout.splitlines():
 m=re.match(r'^(\\s*\\d+\\s+\\d+\\s+\\d+\\s+\\S+\\s+.{24}\\s+).+$',line)
 print(m.group(1)+'(node)' if m and int(line.split()[0])==pid else line)
sys.stderr.write(r.stderr)
sys.exit(r.returncode)
`,
        { mode: 0o700 },
      );
      process.env.PATH = `${bin}:${originalPath}`;
      child = await startOwnedNativeCommand({
        command: process.execPath,
        argv: [
          '-e',
          'const fs=require("node:fs");const end=Date.now()+15000;const t=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(t);process.exit(0)}else if(Date.now()>end)process.exit(3)},25)',
          releasePath,
        ],
        artifactRoot: root,
        label: 'unavailable-argv',
        env: process.env,
      });
      const ledgerPath = path.join(root, 'unavailable-argv.ownership.json');
      type Ledger = {
        processes: { pid: number; started: string; commandHash: string }[];
        leaderExecutions: unknown[];
        commandCensusRequeries: {
          unavailable: { pid: number; started: string }[];
          result: string;
        }[];
        cleanup: string;
      };
      const initial = JSON.parse(await readFile(ledgerPath, 'utf8')) as Ledger;
      assert.equal(initial.processes.length, 1);
      await writeFile(flag, String(child.pid), { flag: 'wx', mode: 0o600 });
      const deadline = Date.now() + 5000;
      let ledger: Ledger;
      do {
        assert(Date.now() < deadline, 'Expected actual unavailable argv census');
        await delay(25);
        ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as Ledger;
      } while (!ledger.commandCensusRequeries.length);
      assert.equal(child.censusFailure(), null);
      assert.deepEqual(ledger.processes, initial.processes);
      assert.deepEqual(ledger.leaderExecutions, []);
      assert.equal(ledger.commandCensusRequeries[0].result, 'unavailable');
      assert.equal(ledger.commandCensusRequeries[0].unavailable[0].pid, child.pid);
      assert.deepEqual(processSurvivors(ownershipProcesses(ledger), initial.processes).survivors, [
        child.pid,
      ]);
      await assert.rejects(child.capture(true), /command census unavailable/);
      const observations: unknown[] = [];
      assert.deepEqual(
        await observeGroupProcesses(child.pgid, (event) => observations.push(event)),
        initial.processes.map(({ pid, started }) => ({ pid, started })),
      );
      assert.equal(observations.length, 1);
      await assert.rejects(groupProcesses(child.pgid), /command census unavailable/);
      await release();
      assert.equal((await child.wait(5000)).code, 0);
      await child.stop();
      assert.equal(child.censusFailure(), null);
      ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as Ledger;
      assert.equal(ledger.cleanup, 'cleaned');
      assert.deepEqual(ledger.leaderExecutions, []);
      assert.deepEqual(ledger.processes, initial.processes);
      assert.deepEqual(await groupProcesses(child.pgid), []);
    } finally {
      process.env.PATH = originalPath;
      await rm(flag, { force: true });
      await release();
      await child?.closed;
      await child?.stop();
      await rm(root, { recursive: true });
    }
  },
);

void test('a periodic census failure retains its original private cause even when the child later exits zero and cleanup passes', async () => {
  const root = await artifactRoot(),
    originalPath = process.env.PATH;
  const bin = path.join(root, 'bin'),
    flag = path.join(root, 'fail-census');
  let child: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  try {
    await mkdir(bin, { mode: 0o700 });
    const quotedFlag = "'" + flag.replaceAll("'", "'\\''") + "'";
    await writeFile(
      path.join(bin, 'ps'),
      `#!/bin/sh\nif test -f ${quotedFlag}; then printf 'malformed census\\n'; exit 0; fi\nexec /bin/ps "$@"\n`,
      { mode: 0o700 },
    );
    process.env.PATH = `${bin}:${originalPath}`;
    child = await startOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', 'setTimeout(()=>process.exit(0),1500)'],
      artifactRoot: root,
      label: 'census-diagnostic',
      env: process.env,
    });
    await writeFile(flag, '', { flag: 'wx' });
    const deadline = Date.now() + 5000;
    while (!child.censusFailure()) {
      assert(Date.now() < deadline, 'Expected actual periodic census failure');
      await delay(25);
    }
    await rm(flag);
    process.env.PATH = originalPath;
    await assert.rejects(child.wait(5000), /census failed/);
    assert.equal((await child.closed).code, 0);
    await child.stop();
    const cause = JSON.parse(
      await readFile(path.join(root, 'census-diagnostic.census-failure.private.json'), 'utf8'),
    ) as { pid: number; pgid: number; message: string };
    assert.equal(cause.pid, child.pid);
    assert.equal(cause.pgid, child.pgid);
    assert.equal(cause.message, 'Owned worker census unavailable');
    assert.equal(child.censusFailure()?.publication, 'written');
    assert.equal(
      (
        JSON.parse(await readFile(path.join(root, 'census-diagnostic.ownership.json'), 'utf8')) as {
          cleanup: string;
        }
      ).cleanup,
      'cleaned',
    );
    assert.deepEqual(await groupProcesses(child.pgid), []);
  } finally {
    process.env.PATH = originalPath;
    await rm(flag, { force: true });
    await child?.stop();
    await rm(root, { recursive: true });
  }
});

void test('invalid native command phase rejects before log or process acquisition', async () => {
  const root = await artifactRoot();
  try {
    await assert.rejects(
      startOwnedNativeCommand({
        command: process.execPath,
        argv: ['-e', 'process.exit(0)'],
        artifactRoot: root,
        label: 'invalid-phase',
        env: process.env,
        phase: 'unknown' as never,
      }),
      /Invalid native command phase/,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('native child failure retains exact exit and exclusive diagnostics', async () => {
  const root = await artifactRoot();
  let child: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  try {
    child = await startOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', 'console.log("first failure");process.exitCode=7'],
      artifactRoot: root,
      label: 'failed',
      env: process.env,
    });
    await assert.rejects(child.wait(5000), /failed: 7/);
    assert.equal((await child.closed).code, 7);
    await child.stop();
    const ownership = JSON.parse(
      await readFile(path.join(root, 'failed.ownership.json'), 'utf8'),
    ) as {
      cleanupMode: string;
      naturalExitGraceMs: number;
    };
    assert.equal(ownership.cleanupMode, 'step');
    assert.equal(ownership.naturalExitGraceMs, 1000);
    assert.deepEqual(await groupProcesses(child.pgid), []);
    assert.match(await readFile(child.logPath, 'utf8'), /first failure/);
    await assert.rejects(
      startOwnedNativeCommand({
        command: process.execPath,
        argv: ['-e', 'process.exit(0)'],
        artifactRoot: root,
        label: 'failed',
        env: process.env,
      }),
      /EEXIST/,
    );
    assert.match(await readFile(child.logPath, 'utf8'), /first failure/);
  } finally {
    await child?.stop();
    await rm(root, { recursive: true });
  }
});

void test('separate stdout capture preserves binary bytes while stderr stays in the diagnostic log', async () => {
  const root = await artifactRoot();
  const stdoutPath = path.join(root, 'screenshot.png');
  const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0a, 0x7f]);
  let child: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  try {
    child = await startOwnedNativeCommand({
      command: process.execPath,
      argv: [
        '-e',
        `process.stdout.write(Buffer.from(${JSON.stringify(payload.toString('base64'))},'base64'));process.stderr.write('adb warning\\n')`,
      ],
      artifactRoot: root,
      label: 'binary-capture',
      env: process.env,
      stdoutPath,
    });
    assert.deepEqual(await child.wait(5000), { code: 0, signal: null });
    await child.stop();
    assert.equal(child.stdoutPath, stdoutPath);
    assert.deepEqual(await readFile(stdoutPath), payload);
    assert.equal(await readFile(child.logPath, 'utf8'), 'adb warning\n');
    assert.equal((await lstat(stdoutPath)).mode & 0o777, 0o600);
    assert.deepEqual(await groupProcesses(child.pgid), []);
  } finally {
    await child?.stop();
    await rm(root, { recursive: true });
  }
});

void test('separate stdout capture is exclusive and leaves an existing artifact untouched', async () => {
  const root = await artifactRoot();
  const stdoutPath = path.join(root, 'occupied.png');
  try {
    await assert.rejects(
      startOwnedNativeCommand({
        command: process.execPath,
        argv: ['-e', 'process.exit(0)'],
        artifactRoot: root,
        label: 'empty-capture',
        env: process.env,
        stdoutPath: '',
      }),
      /non-empty string/,
    );
    assert.deepEqual(await readdir(root), []);
    await writeFile(stdoutPath, 'keep-me', { flag: 'wx', mode: 0o600 });
    await assert.rejects(
      startOwnedNativeCommand({
        command: process.execPath,
        argv: ['-e', 'process.exit(0)'],
        artifactRoot: root,
        label: 'exclusive-capture',
        env: process.env,
        stdoutPath,
      }),
      /EEXIST/,
    );
    assert.equal(await readFile(stdoutPath, 'utf8'), 'keep-me');
    assert.deepEqual(await readdir(root), ['occupied.png']);
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('default text capture keeps its historical unbounded streaming behavior', async () => {
  const root = await artifactRoot();
  try {
    const result = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: [
        '-e',
        `process.stdout.write(Buffer.alloc(${ownedNativeCommandOutputMaxBytes + 4096},7))`,
      ],
      artifactRoot: root,
      label: 'text-stream',
      env: process.env,
      deadlineMs: 5000,
    });
    assert.equal(result.execution, 'completed');
    assert.equal(result.cleanup, 'cleaned');
    assert(Object.hasOwn(result, 'censusFailure'));
    assert(Object.hasOwn(result, 'outputFailure'));
    assert.equal(result.censusFailure, null);
    assert.equal(result.outputFailure, null);
    assert.equal((await lstat(result.logPath!)).size, ownedNativeCommandOutputMaxBytes + 4096);
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('stdout output limit is a harness block with bounded bytes and strict cleanup', async () => {
  const root = await artifactRoot();
  const stdoutPath = path.join(root, 'oversized.png');
  try {
    const result = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: [
        '-e',
        `process.stdout.write(Buffer.alloc(${ownedNativeCommandOutputMaxBytes + 4096},7));setInterval(()=>{},1000)`,
      ],
      artifactRoot: root,
      label: 'output-limit',
      env: process.env,
      stdoutPath,
      deadlineMs: 5000,
    });
    assert.equal(result.execution, 'harness-blocked');
    assert.equal(result.cleanup, 'cleaned');
    assert.equal(result.outputFailure?.reason, 'limit');
    assert.equal(result.outputFailure?.stream, 'stdout');
    assert.equal(result.outputFailure?.bytes, ownedNativeCommandOutputMaxBytes + 4096);
    assert.equal((await lstat(stdoutPath)).size, ownedNativeCommandOutputMaxBytes);
    assert.deepEqual(await groupProcesses(result.pgid!), []);
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('late diagnostic flush I/O after child zero is a harness block with clean ownership release', async () => {
  const root = await artifactRoot();
  const wrapper = path.join(root, 'late-flush-wrapper.cjs');
  const modulePath = path.resolve('scripts/testing/owned-native-command.ts');
  await writeFile(
    wrapper,
    `
const fs = require('node:fs');
const path = require('node:path');
const {syncBuiltinESMExports} = require('node:module');
const root = process.argv[2];
const target = path.join(root, 'late-flush.private.log');
  const originalCreateWriteStream = fs.createWriteStream;
  fs.createWriteStream = (filePath, ...args) => {
    const stream = originalCreateWriteStream(filePath, ...args);
    if (filePath === target) {
      const originalDestroy = stream.destroy.bind(stream);
      let delayed = false;
      stream.destroy = (error) => {
        if (!delayed && error == null) {
          delayed = true;
          setTimeout(
            () => originalDestroy(Object.assign(new Error('synthetic late flush I/O'), {code: 'EIO'})),
            25,
          );
          return stream;
        }
        return originalDestroy(error);
      };
    }
  return stream;
};
syncBuiltinESMExports();
(async () => {
  const {executeOwnedNativeCommand} = await import(${JSON.stringify(modulePath)});
  const result = await executeOwnedNativeCommand({
    command: process.execPath,
    argv: ['-e', 'process.exit(0)'],
    artifactRoot: root,
    label: 'late-flush',
    env: process.env,
    deadlineMs: 5000,
  });
  process.stdout.write(JSON.stringify(result));
})().catch((error) => {
  process.stderr.write(String(error));
  process.exitCode = 1;
});
`,
    { flag: 'wx', mode: 0o600 },
  );
  try {
    const execution = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', wrapper, root],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      },
    );
    const result = JSON.parse(execution.stdout) as NativeCommandExecution;
    assert.equal(result.execution, 'harness-blocked');
    assert.equal(result.childExitCode, 0);
    assert.equal(result.childSignal, null);
    assert.equal(result.cleanup, 'cleaned');
    assert.equal(result.outputFailure?.reason, 'io');
    assert.ok(['stdout', 'stderr'].includes(result.outputFailure?.stream ?? ''));
    assert.match(result.outputFailure?.message ?? '', /synthetic late flush I\/O/);
    assert.deepEqual(await groupProcesses(result.pgid!), []);
    const ledger = JSON.parse(await readFile(result.ownershipPath!, 'utf8')) as {
      cleanup: string;
      processes: { pid: number; started: string; commandHash: string }[];
    };
    assert.equal(ledger.cleanup, 'cleaned');
    assert.deepEqual(processSurvivors(ownershipProcesses(ledger), []).survivors, []);
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('native deadline and cancellation stop only the owned group', async () => {
  const root = await artifactRoot();
  const foreign = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  const foreignClosed = new Promise<void>((resolve) => foreign.once('close', () => resolve()));
  const owned: Awaited<ReturnType<typeof startOwnedNativeCommand>>[] = [];
  try {
    for (const label of ['deadline', 'cancelled']) {
      const child = await startOwnedNativeCommand({
        command: process.execPath,
        argv: ['-e', 'setInterval(()=>{},1000)'],
        artifactRoot: root,
        label,
        env: process.env,
      });
      owned.push(child);
      const controller = new AbortController();
      const waiting = child.wait(200, controller.signal);
      if (label === 'cancelled') controller.abort();
      await assert.rejects(waiting, new RegExp(label));
      await child.stop();
      assert.deepEqual(await groupProcesses(child.pgid), []);
      assert.equal((await groupProcesses(foreign.pid!)).length, 1);
    }
  } finally {
    for (const child of owned) await child.stop();
    foreign.kill('SIGTERM');
    await foreignClosed;
    await rm(root, { recursive: true });
  }
});

void test('native census allows an exec descendant to finish naturally before strict cleanup', async () => {
  const root = await artifactRoot();
  let child: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  try {
    child = await startOwnedNativeCommand({
      command: process.execPath,
      argv: [
        '-e',
        `
        const {spawn}=require('node:child_process');
        const worker=spawn('/bin/sh',['-c','read gate; exec "$1" -e \\'setTimeout(()=>process.exit(0),1000)\\'','known-child',process.execPath],{stdio:['pipe','ignore','ignore']});
        setTimeout(()=>worker.stdin.end('go\\n'),1200);
        worker.on('exit',code=>{console.log('descendant completed',code);process.exitCode=code;});
      `,
      ],
      artifactRoot: root,
      label: 'descendant-exec',
      env: process.env,
    });
    await child.wait(8000);
    await child.stop();
    assert.deepEqual(await groupProcesses(child.pgid), []);
    assert.match(await readFile(child.logPath, 'utf8'), /descendant completed 0/);
  } finally {
    await child?.stop();
    await rm(root, { recursive: true });
  }
});

void test('explicit build phase accepts its declared cap without relaxing default steps or acquiring invalid requests', async () => {
  const { executeOwnedNativeCommand } = await import('../../scripts/testing/owned-native-command');
  const { readdir } = await import('node:fs/promises');
  const root = await artifactRoot();
  const options = {
    command: process.execPath,
    argv: ['-e', 'process.exitCode=0'],
    artifactRoot: root,
    label: 'build-phase',
    env: process.env,
    deadlineMs: 900_000,
  };
  try {
    await assert.rejects(executeOwnedNativeCommand(options), /deadline/);
    await assert.rejects(
      executeOwnedNativeCommand({
        ...options,
        phase: 'build',
        deadlineMs: 900_001,
      }),
      /deadline/,
    );
    await assert.rejects(
      executeOwnedNativeCommand({ ...options, phase: 'invalid' as 'build' }),
      /phase/,
    );
    assert.deepEqual(await readdir(root), []);
    const cancelled = new AbortController();
    cancelled.abort();
    const pre = await executeOwnedNativeCommand({
      ...options,
      phase: 'build',
      signal: cancelled.signal,
    });
    assert.equal(pre.phase, 'build');
    assert.equal(pre.cleanup, 'not-acquired');
    assert.equal(pre.pid, null);
    assert.deepEqual(await readdir(root), []);
    const result = await executeOwnedNativeCommand({
      ...options,
      phase: 'build',
    });
    assert.equal(result.phase, 'build');
    assert.equal(result.execution, 'completed');
    assert.equal(result.childExitCode, 0);
    assert.equal(result.cleanup, 'cleaned');
    assert.ok(result.pgid);
    assert.deepEqual(await groupProcesses(result.pgid), []);
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('terminal command records keep child result separate from cleanup and acquire nothing for invalid/cancelled requests', async () => {
  const { executeOwnedNativeCommand } = await import('../../scripts/testing/owned-native-command');
  const root = await artifactRoot();
  const foreign = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  const foreignClosed = new Promise<void>((resolve) => foreign.once('close', () => resolve()));
  const options = {
    command: process.execPath,
    argv: ['-e', 'setInterval(()=>{},1000)'],
    artifactRoot: root,
    label: 'terminal',
    env: process.env,
    deadlineMs: 5000,
  };
  try {
    for (const deadlineMs of [0, NaN, Infinity, 600_001])
      await assert.rejects(executeOwnedNativeCommand({ ...options, deadlineMs }), /deadline/);
    const aborted = new AbortController();
    aborted.abort();
    const pre = await executeOwnedNativeCommand({
      ...options,
      signal: aborted.signal,
    });
    assert.equal(pre.execution, 'cancelled');
    assert.equal(pre.cleanup, 'not-acquired');
    assert.equal(pre.pid, null);
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(root), []);
    const cells = [
      {
        label: 'terminal-success',
        argv: ['-e', 'console.log("engine finished");process.exitCode=0'],
        expected: 'completed',
        code: 0,
      },
      {
        label: 'terminal-failure',
        argv: ['-e', 'console.log("first failure");process.exitCode=7'],
        expected: 'child-failed',
        code: 7,
      },
      {
        label: 'terminal-deadline',
        argv: options.argv,
        expected: 'deadline',
        code: null,
      },
      {
        label: 'terminal-int',
        argv: options.argv,
        expected: 'cancelled',
        code: null,
      },
      {
        label: 'terminal-term',
        argv: options.argv,
        expected: 'cancelled',
        code: null,
      },
    ];
    for (const cell of cells) {
      const controller = new AbortController();
      const result = await executeOwnedNativeCommand({
        ...options,
        label: cell.label,
        argv: cell.argv,
        deadlineMs: cell.expected === 'deadline' ? 100 : 5000,
        signal: controller.signal,
        onStarted: () => {
          if (cell.expected === 'cancelled')
            controller.abort(cell.label.endsWith('int') ? 'SIGINT' : 'SIGTERM');
        },
      });
      assert.equal(result.execution, cell.expected);
      assert.equal(result.childExitCode, cell.code);
      assert.equal(result.cleanup, 'cleaned');
      assert.ok(result.pgid);
      assert.deepEqual(await groupProcesses(result.pgid), []);
      const ledger = JSON.parse(await readFile(result.ownershipPath!, 'utf8')) as {
        cleanup: string;
      };
      assert.equal(ledger.cleanup, 'cleaned');
      assert.ok(result.elapsedMs >= 0 && result.cleanupMs >= 0);
      assert.equal((await groupProcesses(foreign.pid!)).length, 1);
      if (cell.code === null) assert.equal(result.childSignal, 'SIGTERM');
    }
  } finally {
    foreign.kill('SIGTERM');
    await foreignClosed;
    await rm(root, { recursive: true });
  }
});

void test('real SIGINT and SIGTERM cancellation preserves signal exit while cleaning the separately owned engine group', async () => {
  const { writeFile } = await import('node:fs/promises');
  const root = await artifactRoot();
  const wrapper = path.join(root, 'signal-wrapper.cjs');
  await writeFile(
    wrapper,
    `
    const {writeFile} = require('node:fs/promises');
    const {executeOwnedNativeCommand} = require(${JSON.stringify(path.resolve(__dirname, '../../scripts/testing/owned-native-command.ts'))});
    void (async()=>{
    const controller=new AbortController();
    let exitCode=0;
    for (const [signal,code] of [['SIGINT',130],['SIGTERM',143]])
      process.once(signal,()=>{exitCode ||= code;controller.abort(signal)});
    const result=await executeOwnedNativeCommand({
      command:process.execPath,argv:['-e','setInterval(()=>{},1000)'],
      artifactRoot:process.argv[2],label:process.argv[3],env:process.env,
      deadlineMs:5000,signal:controller.signal,
      onStarted:()=>process.stdout.write('READY\\n'),
    });
    await writeFile(process.argv[4],JSON.stringify(result),{mode:0o600,flag:'wx'});
    process.exitCode=exitCode || 2;
    })().catch(error=>{process.stderr.write(String(error));process.exitCode=2});
  `,
    { mode: 0o600, flag: 'wx' },
  );
  let passed = false;
  try {
    for (const [signal, exitCode] of [
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ] as const) {
      const resultPath = path.join(root, `${signal}.json`);
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', wrapper, root, signal.toLowerCase(), resultPath],
        {
          cwd: path.resolve(__dirname, '../..'),
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '',
        errors = '',
        signalled = false,
        timedOut = false;
      const completion = new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      child.stdout.on('data', (bytes: Buffer) => {
        output += bytes.toString();
        if (!signalled && output.includes('READY\n')) {
          signalled = true;
          child.kill(signal);
        }
      });
      child.stderr.on('data', (bytes: Buffer) => {
        errors += bytes.toString();
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, 20_000);
      let code;
      try {
        code = await completion;
      } finally {
        clearTimeout(timer);
      }
      assert.equal(timedOut, false);
      assert.equal(signalled, true, errors);
      assert.equal(code, exitCode, errors);
      const result = JSON.parse(await readFile(resultPath, 'utf8')) as NativeCommandExecution;
      assert.equal(result.execution, 'cancelled');
      assert.equal(result.cleanup, 'cleaned');
      assert.equal(result.childExitCode, null);
      assert.equal(result.childSignal, 'SIGTERM');
      assert.ok(result.pgid);
      assert.deepEqual(await groupProcesses(result.pgid), []);
      assert.deepEqual(await groupProcesses(child.pid!), []);
    }
    passed = true;
  } finally {
    // Preserve recovery identities/diagnostics when the externally checked test fails.
    if (passed) await rm(root, { recursive: true });
  }
});

void test('controlled cleanup rejection cannot erase the original child failure or claim a clean engine attempt', async () => {
  const { executeOwnedNativeCommand } = await import('../../scripts/testing/owned-native-command');
  const root = await artifactRoot();
  let recover: (() => Promise<void>) | undefined;
  let pgid: number | undefined;
  try {
    const result = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', 'process.exitCode=7'],
      artifactRoot: root,
      label: 'cleanup-control',
      env: process.env,
      deadlineMs: 5000,
      onStarted: (child) => {
        recover = child.stop;
        pgid = child.pgid;
        // Synthetic stop rejection tests composition only, not an actual ownership mismatch.
        child.stop = () => Promise.reject(new Error('controlled cleanup rejection'));
      },
    });
    assert.equal(result.execution, 'child-failed');
    assert.equal(result.childExitCode, 7);
    assert.equal(result.cleanup, 'failed-recovery-ledger-retained');
    assert.ok(result.ownershipPath);
    await readFile(result.ownershipPath, 'utf8');
  } finally {
    await recover?.();
    if (pgid) assert.deepEqual(await groupProcesses(pgid), []);
    await rm(root, { recursive: true });
  }
});

void test('unsafe escaped-descendant exec mismatch retains live identities and the original failed ledger', async () => {
  const root = await artifactRoot();
  const release = path.join(root, 'release');
  const wrapper = path.join(root, 'retained-wrapper.cjs');
  const engine = `import os,pathlib,sys,time
child=os.fork()
if child==0:
    while not pathlib.Path(sys.argv[1]).exists(): time.sleep(0.01)
    os.setpgid(0,0)
    pathlib.Path(sys.argv[2]).write_text('escaped')
    while not pathlib.Path(sys.argv[3]).exists(): time.sleep(0.01)
    code='import pathlib,sys,time\\nwhile not pathlib.Path(sys.argv[1]).exists(): time.sleep(0.01)'
    os.execv(sys.executable,[sys.executable,'-u','-c',code,sys.argv[4]])
print('READY',flush=True)
while not pathlib.Path(sys.argv[4]).exists(): time.sleep(0.01)
os.waitpid(child,0)
`;
  await writeFile(
    wrapper,
    `
    const fs=require('node:fs/promises'),path=require('node:path');
    const {setTimeout:delay}=require('node:timers/promises');
    const {startOwnedNativeCommand}=require(${JSON.stringify(path.resolve(__dirname, '../../scripts/testing/owned-native-command.ts'))});
    (async()=>{
      const root=process.argv[2];
      const child=await startOwnedNativeCommand({command:'python3',argv:['-u','-c',${JSON.stringify(engine)},path.join(root,'exec-trigger'),path.join(root,'escape-ready'),path.join(root,'exec-now'),path.join(root,'release')],artifactRoot:root,label:'retained-engine',env:process.env});
      const deadline=Date.now()+5000;
      while(!(await fs.readFile(child.logPath,'utf8')).includes('READY')){if(Date.now()>deadline)throw Error('Fixture not ready');await delay(10)}
      await child.capture(true);
      await fs.writeFile(path.join(root,'exec-trigger'),'x',{flag:'wx'});
      while(true){try{await fs.readFile(path.join(root,'escape-ready'),'utf8');break}catch{if(Date.now()>deadline)throw Error('Escape fixture not ready');await delay(10)}}
      await child.capture(true);
      await fs.writeFile(path.join(root,'exec-now'),'x',{flag:'wx'});
      let rejected=false;
      while(Date.now()<deadline){try{await child.capture(true)}catch{rejected=true;break}await delay(10)}
      if(!rejected)throw Error('Expected real descendant exec mismatch');
      let failure;
      try{await child.stop()}catch(error){failure=error.message}
      if(!failure)throw Error('Expected retained cleanup failure');
      await fs.writeFile(path.join(root,'retained-result.json'),JSON.stringify({pid:child.pid,pgid:child.pgid,failure,outcome:child.outcome()}),{flag:'wx',mode:0o600});
      process.exitCode=2;
    })().catch(error=>{console.error(error.message);process.exitCode=3});
  `,
    { flag: 'wx', mode: 0o600 },
  );
  const child = spawn(process.execPath, ['--import', 'tsx', wrapper, root], {
    cwd: path.resolve(__dirname, '../..'),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const completion = new Promise<number | null>((resolve) => child.once('close', resolve));
  let timedOut = false,
    errors = '';
  child.stderr.on('data', (bytes: Buffer) => {
    errors += bytes.toString();
  });
  const timer = setTimeout(() => {
    timedOut = true;
    void writeFile(release, 'x').catch(() => undefined);
  }, 10000);
  let pgid: number | undefined;
  try {
    const code = await completion;
    assert.equal(timedOut, false, errors);
    assert.equal(code, 2, errors);
    const result = JSON.parse(await readFile(path.join(root, 'retained-result.json'), 'utf8')) as {
      pid: number;
      pgid: number;
      failure: string;
      outcome: { code: number | null; signal: string | null };
    };
    pgid = result.pgid;
    assert.equal(result.outcome.code, null);
    assert.equal(result.outcome.signal, null);
    assert.match(result.failure, /identity changed|Unverified worker group member/);
    const ledger = JSON.parse(
      await readFile(path.join(root, 'retained-engine.ownership.json'), 'utf8'),
    ) as {
      cleanup: string;
      processes: { pid: number; started: string; commandHash: string }[];
      escapedProcesses: {
        pid: number;
        pgid: number;
        started: string;
        commandHash: string;
      }[];
    };
    const live = await groupProcesses(pgid);
    assert(
      live.some((row) => row.pid === result.pid),
      'Controlled engine must still be alive',
    );
    assert.equal(ledger.cleanup, 'failed-recovery-ledger-retained');
    assert(ledger.processes.some((row) => row.pid === result.pid));
    const escaped = ledger.escapedProcesses.find((row) => row.pid !== result.pid);
    assert(escaped, 'Escaped descendant identity must remain in the failed ledger');
    assert.notEqual(escaped.pgid, result.pgid, 'Unsafe fixture must leave the owned group');
    const descendant = (await groupProcesses(escaped.pgid)).find((row) => row.pid === escaped.pid);
    assert(descendant, 'Unverified escaped exec descendant must still be alive');
    const original = ledger.processes.find(
      (row) => row.pid === descendant.pid && row.started === descendant.started,
    );
    assert(original, 'Original descendant identity must remain in the failed ledger');
    assert.notEqual(original.commandHash, descendant.commandHash);
    assert(
      !/SyntaxError|Traceback/.test(
        await readFile(path.join(root, 'retained-engine.private.log'), 'utf8'),
      ),
    );
  } finally {
    clearTimeout(timer);
    await writeFile(release, 'x');
    await completion;
    if (pgid) {
      const end = Date.now() + 5000;
      while ((await groupProcesses(pgid)).length) {
        assert(Date.now() < end, 'Controlled retained fixture did not release');
        await delay(25);
      }
    }
    await rm(root, { recursive: true });
  }
});

void test('a real failed process query remains harness-blocked after child zero and clean release, with only redacted status persisted', async () => {
  const root = await artifactRoot();
  const bin = path.join(root, 'bin'),
    marker = path.join(root, 'fail-once');
  const stdout = 'controlled foreign argv stdout',
    stderr = 'controlled private query stderr';
  const stdoutBytes = Buffer.concat([Buffer.from(stdout), Buffer.from([0xff])]);
  let audited = false;
  try {
    await mkdir(bin, { mode: 0o700 });
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    await writeFile(
      path.join(bin, 'ps'),
      `#!/bin/sh\nif test -f ${quote(marker)}; then rm ${quote(marker)}; printf '%s' ${quote(stdout)}; printf '\\377'; printf '%s' ${quote(stderr)} >&2; exit 1; fi\nexec /bin/ps "$@"\n`,
      { mode: 0o700 },
    );
    const modulePath = path.resolve('scripts/testing/owned-native-command.ts');
    const program = `const fs=require('node:fs');const {executeOwnedNativeCommand}=require(${JSON.stringify(modulePath)});(async()=>{const result=await executeOwnedNativeCommand({command:process.execPath,argv:['-e','setTimeout(()=>process.exit(0),3000)'],artifactRoot:${JSON.stringify(root)},label:'query-failure',env:process.env,deadlineMs:10000,onStarted:()=>fs.writeFileSync(${JSON.stringify(marker)},'',{flag:'wx',mode:0o600})});console.log(JSON.stringify(result));})().catch(e=>{console.error(e);process.exitCode=1;});`;
    // PATH belongs only to this disposable controller, never to concurrent tests or the host.
    const execution = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', '--eval', program],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    );
    const result = JSON.parse(execution.stdout.trim()) as NativeCommandExecution;
    assert.equal(result.execution, 'harness-blocked');
    assert.equal(result.childExitCode, 0);
    assert.equal(result.childSignal, null);
    assert.equal(result.cleanup, 'cleaned');
    assert.equal(result.censusFailure?.publication, 'written');
    assert.equal(result.censusFailure?.errorClass, 'OwnedProcessCensusQueryError');
    assert.deepEqual(result.censusFailure?.queryFailure, {
      exitCode: 1,
      errorCode: null,
      killed: false,
      signal: null,
      timeoutMs: 5000,
      maxBufferBytes: 8 * 1024 * 1024,
      stdout: {
        bytes: stdoutBytes.length,
        sha256: createHash('sha256').update(stdoutBytes).digest('hex'),
      },
      stderr: {
        bytes: Buffer.byteLength(stderr),
        sha256: createHash('sha256').update(stderr).digest('hex'),
      },
    });
    const diagnosticPath = path.join(root, 'query-failure.census-failure.private.json');
    const bytes = await readFile(diagnosticPath, 'utf8');
    assert(!bytes.includes(stdout));
    assert(!bytes.includes(stderr));
    const original = JSON.parse(bytes) as {
      publication: string;
      queryFailure: unknown;
    };
    assert.equal(original.publication, 'pending');
    assert.deepEqual(original.queryFailure, result.censusFailure?.queryFailure);
    assert.equal((await lstat(diagnosticPath)).mode & 0o777, 0o600);
    const ledger = JSON.parse(await readFile(result.ownershipPath!, 'utf8')) as { cleanup: string };
    assert.equal(ledger.cleanup, 'cleaned');
    const recorded = ownershipProcesses(ledger);
    const observed = await groupProcesses(result.pgid!);
    assert.deepEqual(observed, []);
    // Inspect every recorded PID separately as well; a different PGID cannot hide a survivor.
    for (const row of recorded) {
      const current = await inspectProcessIdentity(row.pid);
      assert(current === undefined || current.started !== row.started);
    }
    await assert.rejects(writeFile(diagnosticPath, 'replacement', { flag: 'wx' }), /EEXIST/);
    assert.equal(await readFile(diagnosticPath, 'utf8'), bytes);
    audited = true;
  } finally {
    if (audited) await rm(root, { recursive: true });
    else console.error(`Retained failed query-control artifacts: ${root}`);
  }
});

void test('the producer handshake preserves exact stdin and retains an observed launcher leader for a fast command', async () => {
  const root = await artifactRoot();
  try {
    const result = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: [
        '-e',
        "process.stdin.pipe(process.stdout); process.stdin.on('end', () => setTimeout(() => process.exit(0), 500))",
      ],
      artifactRoot: root,
      label: 'leader-handshake-fast',
      env: process.env,
      input: 'authenticated-input',
      deadlineMs: 5000,
      leaderHandshake: true,
    });
    assert.equal(result.execution, 'completed');
    assert.equal(result.childExitCode, 0);
    assert.equal(result.childSignal, null);
    assert.equal(result.cleanup, 'cleaned');
    assert.equal(await readFile(result.logPath!, 'utf8'), 'authenticated-input');
    const ledger = JSON.parse(await readFile(result.ownershipPath!, 'utf8')) as {
      pid: number;
      pgid: number;
      processes: {
        pid: number;
        pgid: number;
        started: string;
        commandHash: string;
      }[];
    };
    const launcher = ledger.processes.find(
      (row) => row.pid === result.pid && row.pgid === result.pgid,
    );
    assert(launcher, 'handshake must retain the observed launcher identity');
    assert(Number.isSafeInteger(launcher.pid) && launcher.pid > 1);
    assert(Number.isSafeInteger(launcher.pgid) && launcher.pgid > 1);
    assert(typeof launcher.started === 'string' && launcher.started.length > 0);
    assert.match(launcher.commandHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(await groupProcesses(result.pgid!), []);
    assert(!(await readdir(root)).some((name) => name.endsWith('.launcher.private.sh')));
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('the producer handshake records a released target as a same-PID exec', async () => {
  const root = await artifactRoot();
  try {
    const result = await executeOwnedNativeCommand({
      command: '/bin/sleep',
      argv: ['2'],
      artifactRoot: root,
      label: 'leader-handshake-exec',
      env: process.env,
      deadlineMs: 5000,
      leaderHandshake: true,
    });
    assert.equal(result.execution, 'completed');
    assert.equal(result.cleanup, 'cleaned');
    const ledger = JSON.parse(await readFile(result.ownershipPath!, 'utf8')) as {
      processes: {
        pid: number;
        pgid: number;
        started: string;
        commandHash: string;
      }[];
      leaderExecutions: {
        started: string;
        previousCommandHash: string;
        commandHash: string;
      }[];
    };
    const transition = ledger.leaderExecutions.find(
      (entry) => entry.previousCommandHash !== entry.commandHash,
    );
    assert(transition, 'post-release target must be recorded as a same-PID leader exec');
    assert.equal(result.pid, result.pgid);
    assert(ledger.processes.some((row) => row.pid === result.pid && row.pgid === result.pgid));
    assert.equal(
      transition.started,
      ledger.processes.find((row) => row.pid === result.pid)?.started,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('leader acquisition cancellation after ownership proof performs strict cleanup', async () => {
  const root = await artifactRoot();
  const marker = path.join(root, 'cancelled-target-ran');
  const controller = new AbortController();
  let checks = 0;
  const originalThrowIfAborted = controller.signal.throwIfAborted.bind(controller.signal);
  Object.defineProperty(controller.signal, 'throwIfAborted', {
    configurable: true,
    value() {
      checks += 1;
      if (checks === 8) controller.abort();
      originalThrowIfAborted();
    },
  });
  let failure: OwnedNativeCommandAcquisitionError | undefined;
  try {
    await startOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
      artifactRoot: root,
      label: 'leader-handshake-cancelled',
      env: process.env,
      deadlineMs: 5000,
      leaderHandshake: true,
      signal: controller.signal,
    });
  } catch (error) {
    assert(error instanceof OwnedNativeCommandAcquisitionError);
    failure = error;
  }
  try {
    assert(failure, 'cancellation must reject acquisition');
    assert(failure.cause instanceof OwnedNativeCommandError);
    assert.equal(failure.cause.reason, 'cancelled');
    assert.equal(failure.cleanup, 'cleaned');
    assert(failure.cleanupMs > 0);
    const ledger = JSON.parse(await readFile(failure.ownershipPath!, 'utf8')) as {
      processes: unknown[];
      cleanup: string;
    };
    assert(ledger.processes.length > 0, 'cancellation must retain the ownership proof');
    assert.equal(ledger.cleanup, 'cleaned');
    await assert.rejects(lstat(marker), /ENOENT/);
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('the release gate rejects EOF and wrong bytes without executing the target', async () => {
  const root = await artifactRoot();
  const marker = path.join(root, 'target-ran');
  const scriptPath = path.join(root, 'release-gate.private.sh');
  const script = buildLeaderHandshakeScript(process.execPath, [
    '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
  ]);
  await writeFile(scriptPath, script, { flag: 'wx', mode: 0o600 });
  try {
    for (const input of [Buffer.alloc(0), Buffer.from([0x00])]) {
      const child = spawn('/bin/sh', [scriptPath], {
        cwd: root,
        env: process.env,
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      child.stdin.end(input);
      const [code, signal] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null];
      assert.equal(code, 125);
      assert.equal(signal, null);
    }
    await assert.rejects(lstat(marker), /ENOENT/);
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('a pre-existing launcher artifact is retained when exclusive creation fails', async () => {
  const root = await artifactRoot();
  const launcherPath = path.join(root, 'preexisting-launcher.launcher.private.sh');
  const sentinel = '# retained pre-existing launcher\n';
  await writeFile(launcherPath, sentinel, { flag: 'wx', mode: 0o600 });
  try {
    await assert.rejects(
      startOwnedNativeCommand({
        command: process.execPath,
        argv: ['-e', 'process.exit(0)'],
        artifactRoot: root,
        label: 'preexisting-launcher',
        env: process.env,
        leaderHandshake: true,
        deadlineMs: 500,
      }),
      /EEXIST/,
    );
    assert.equal(await readFile(launcherPath, 'utf8'), sentinel);
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('one absolute deadline covers delayed ownership acquisition and execution wait', async () => {
  const root = await artifactRoot();
  const bin = path.join(root, 'bin');
  const delayMarker = path.join(root, 'ps-delay-used');
  const releasedMarker = path.join(root, 'target-released');
  const originalPath = process.env.PATH;
  await mkdir(bin, { mode: 0o700 });
  await writeFile(
    path.join(bin, 'ps'),
    `#!/usr/bin/env python3
import json
import os
import pathlib
import sys
import time
ledger_path = pathlib.Path(${JSON.stringify(path.join(root, 'single-budget-delay.ownership.json'))})
delay_marker = pathlib.Path(${JSON.stringify(delayMarker)})
if ledger_path.exists() and not delay_marker.exists():
    ledger = json.loads(ledger_path.read_text())
    if any(row.get('pid') == ledger.get('pid') and row.get('pgid') == ledger.get('pgid') for row in ledger.get('processes', [])):
        delay_marker.write_text('real initial ownership observed')
        time.sleep(5)
os.execv('/bin/ps', ['/bin/ps', *sys.argv[1:]])
`,
    { mode: 0o700, flag: 'wx' },
  );
  process.env.PATH = `${bin}:${originalPath ?? ''}`;
  let absenceVerified = false;
  const deadlineMs = 2000;
  try {
    const result = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(releasedMarker)}, 'released'); setTimeout(() => process.exit(0), 2000)`,
      ],
      artifactRoot: root,
      label: 'single-budget-delay',
      env: process.env,
      deadlineMs,
      leaderHandshake: true,
    });
    assert.equal(result.execution, 'deadline');
    assert.equal(result.cleanup, 'cleaned');
    assert(result.cleanupMs > 0, 'recovery cleanup must have a separate duration');
    assert(
      result.elapsedMs - result.cleanupMs < deadlineMs + 300,
      `execution/acquisition received a fresh budget: ${result.elapsedMs - result.cleanupMs}`,
    );
    assert.equal(await readFile(delayMarker, 'utf8'), 'real initial ownership observed');
    await assert.rejects(lstat(releasedMarker), /ENOENT/);
    const ledger = JSON.parse(await readFile(result.ownershipPath!, 'utf8')) as {
      processes: unknown[];
      cleanup: string;
    };
    assert(ledger.processes.length > 0, 'deadline cleanup needs a real initial ownership ledger');
    assert.equal(ledger.cleanup, 'cleaned');
    assert(result.pgid !== null);
    assert.deepEqual(await groupProcesses(result.pgid), []);
    absenceVerified = true;
  } finally {
    process.env.PATH = originalPath;
    if (absenceVerified) await rm(root, { recursive: true });
    else console.error('Retained failed deadline control artifacts:', root);
  }
});

void test('the producer handshake rejects a missing leader census without fabricating ownership', async () => {
  const root = await artifactRoot();
  const bin = path.join(root, 'bin');
  const originalPath = process.env.PATH;
  await mkdir(bin, { mode: 0o700 });
  await writeFile(
    path.join(bin, 'ps'),
    `#!/bin/sh
set -eu
umask 077
printf '%s\\n' empty-census >> ${JSON.stringify(path.join(root, 'leader-census-events'))}
# Return a valid empty census for every bounded leader requery. The production
# deadline, rather than malformed output or a wall-clock test timer, decides.
exit 0
`,
    { mode: 0o700, flag: 'wx' },
  );
  process.env.PATH = `${bin}:${originalPath ?? ''}`;
  let failure: OwnedNativeCommandAcquisitionError | undefined;
  try {
    await startOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', 'process.exit(0)'],
      artifactRoot: root,
      label: 'leader-handshake-missing',
      env: process.env,
      leaderHandshake: true,
      deadlineMs: 500,
    });
  } catch (error) {
    assert(error instanceof OwnedNativeCommandAcquisitionError);
    failure = error;
  } finally {
    process.env.PATH = originalPath;
  }
  let absenceVerified = false;
  try {
    assert(failure, 'missing leader census must reject acquisition');
    const censusEvents = (await readFile(path.join(root, 'leader-census-events'), 'utf8'))
      .trim()
      .split('\n');
    assert(censusEvents.length >= 2, 'strict leader requery must observe the empty census');
    assert(censusEvents.every((event) => event === 'empty-census'));
    const failureCause = failure.cause;
    const failureCauseMessage =
      failureCause instanceof Error ? failureCause.message : String(failureCause);
    assert(
      (failureCause instanceof OwnedNativeCommandError && failureCause.reason === 'deadline') ||
        failureCauseMessage === 'Owned worker census deadline' ||
        failureCauseMessage === 'Owned worker leader handshake was not observed',
      `missing leader census must terminate at the absolute deadline: ${failureCauseMessage}`,
    );
    assert(failure.pid !== null);
    assert(Number.isSafeInteger(failure.pid) && failure.pid > 1);
    assert(failure.pgid !== null);
    assert.equal(failure.pgid, failure.pid);
    assert.equal(failure.cleanup, 'failed-recovery-ledger-retained');
    assert(failure.ownershipPath);
    const ledger = JSON.parse(await readFile(failure.ownershipPath, 'utf8')) as {
      pid: number;
      pgid: number;
      processes: unknown[];
      cleanup: string;
      latestCensus?: {
        strict: boolean;
        groupMembers: unknown[];
        escapedCandidates: unknown[];
      };
    };
    assert.equal(ledger.pid, failure.pid);
    assert.equal(ledger.pgid, failure.pgid);
    assert.deepEqual(ledger.processes, []);
    assert.equal(ledger.cleanup, 'running');
    assert.equal(ledger.latestCensus?.strict, true);
    assert.deepEqual(ledger.latestCensus?.groupMembers, []);
    assert.deepEqual(ledger.latestCensus?.escapedCandidates, []);
    const failedPgid = failure.pgid;
    const deadline = Date.now() + 5000;
    while ((await groupProcesses(failedPgid)).length > 0) {
      assert(Date.now() < deadline, 'failed handshake launcher survived cleanup boundary');
      await delay(25);
    }
    absenceVerified = true;
  } finally {
    if (absenceVerified) await rm(root, { recursive: true });
    else console.error('Retained failed missing-leader control artifacts:', root);
  }
});

void test('effective command deadline keeps a long whole-run budget within the step budget', async () => {
  const root = await artifactRoot();
  try {
    const wholeDeadline = performance.now() + 1_800_000;
    const result = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', 'setTimeout(()=>console.log("owned-step-completed"),500)'],
      artifactRoot: root,
      label: 'effective-deadline-success',
      env: process.env,
      deadlineMs: 2000,
      deadlineAtMonotonicMs: wholeDeadline,
      initialOwnershipDeadlineAtMonotonicMs: wholeDeadline,
    });
    assert.equal(result.execution, 'completed');
    assert.equal(result.childExitCode, 0);
    assert.equal(result.cleanup, 'cleaned');
    assert.ok(result.pgid);
    assert.deepEqual(await groupProcesses(result.pgid), []);
    assert.match(await readFile(result.logPath!, 'utf8'), /owned-step-completed/);
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('effective command deadline preserves the earlier absolute or relative limit', async () => {
  const root = await artifactRoot();
  try {
    for (const earlier of ['absolute', 'relative']) {
      const result = await executeOwnedNativeCommand({
        command: process.execPath,
        argv: ['-e', 'setTimeout(()=>console.log("must-not-complete"),3000)'],
        artifactRoot: root,
        label: `effective-deadline-${earlier}`,
        env: process.env,
        deadlineMs: earlier === 'absolute' ? 2000 : 500,
        deadlineAtMonotonicMs: performance.now() + (earlier === 'absolute' ? 500 : 1_800_000),
      });
      assert.equal(result.execution, 'deadline');
      assert.equal(result.childExitCode, null);
      assert.equal(result.cleanup, 'cleaned');
      assert.ok(result.pgid);
      assert.deepEqual(await groupProcesses(result.pgid), []);
      assert.doesNotMatch(await readFile(result.logPath!, 'utf8'), /must-not-complete/);
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('effective command deadline rejects malformed ownership budgets before acquiring artifacts', async () => {
  const root = await artifactRoot();
  try {
    const options = {
      command: process.execPath,
      argv: ['-e', 'setInterval(()=>{},1000)'],
      artifactRoot: root,
      label: 'effective-deadline-invalid-ownership',
      env: process.env,
      deadlineMs: 2000,
      deadlineAtMonotonicMs: performance.now() + 1_800_000,
    };
    for (const initialOwnershipDeadlineAtMonotonicMs of [Infinity, -Infinity, NaN]) {
      const invalid = await executeOwnedNativeCommand({
        ...options,
        initialOwnershipDeadlineAtMonotonicMs,
      });
      assert.equal(invalid.execution, 'harness-blocked');
      assert.equal(invalid.cleanup, 'unknown');
      assert.equal(invalid.pid, null);
      assert.equal(invalid.pgid, null);
      assert.equal(invalid.logPath, null);
      assert.equal(invalid.ownershipPath, null);
      assert.deepEqual(await readdir(root), []);
    }
    const controller = new AbortController();
    controller.abort('already-cancelled');
    const cancelled = await executeOwnedNativeCommand({
      ...options,
      initialOwnershipDeadlineAtMonotonicMs: Infinity,
      signal: controller.signal,
    });
    assert.equal(cancelled.execution, 'cancelled');
    assert.equal(cancelled.cleanup, 'not-acquired');
    assert.equal(cancelled.pid, null);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true });
  }
});
