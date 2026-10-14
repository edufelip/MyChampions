import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startOwnedNativeCommand } from '../../scripts/testing/owned-native-command';
import {
  inspectProcessIdentity,
  requireOwnedProcessIdentity,
} from '../../scripts/testing/owned-process-group';

const repositoryRoot = path.resolve(__dirname, '../..');
const entryPoint = path.join(repositoryRoot, 'scripts/testing/run-native-pilot.mjs');
const shellRunner = path.join(repositoryRoot, 'scripts/testing/run-native-pilot.sh');

async function privateArtifactRoot(prefix: string) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  await chmod(root, 0o700);
  return root;
}

const waitForFile = async (file: string, timeoutMs = 5_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await readFile(file);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out waiting for ${file}`);
};

const waitForClose = (child: ReturnType<typeof spawn>) =>
  new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

const bounded = async <T>(promise: Promise<T>, label: string, timeoutMs = 5_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const createFakeBash = async (root: string) => {
  const bin = path.join(root, 'bin');
  await mkdir(bin, { recursive: true, mode: 0o700 });
  const bash = path.join(bin, 'bash');
  await writeFile(
    bash,
    `#!${process.execPath}
import { writeFileSync } from 'node:fs';

writeFileSync(process.env.FAKE_BASH_ARGS, JSON.stringify(process.argv.slice(2)));
writeFileSync(process.env.FAKE_BASH_CWD, process.cwd());
writeFileSync(process.env.FAKE_BASH_READY, String(process.pid));
const configuredExit = process.env.FAKE_BASH_EXIT_CODE;
if (configuredExit !== undefined) {
  setTimeout(() => process.exit(Number(configuredExit)), 2_000).unref();
}
let finished = false;
const finish = (code) => {
  if (finished) return;
  finished = true;
  process.exitCode = code;
  setTimeout(() => process.exit(code), 10).unref();
};
process.once('SIGINT', () => finish(130));
process.once('SIGTERM', () => finish(143));
setInterval(() => {}, 1000);
`,
    { mode: 0o700 },
  );
  await chmod(bash, 0o700);
  return bin;
};

const captureOwnedLeader = async (command: Awaited<ReturnType<typeof startOwnedNativeCommand>>) => {
  const rows = await bounded(command.capture(true), 'strict owned wrapper census');
  const leader = rows.find((row) => row.pid === command.pid && row.pgid === command.pgid);
  assert.ok(leader, 'strict census must identify the directly spawned wrapper');
  const expected = {
    pid: leader.pid,
    pgid: leader.pgid,
    started: leader.started,
    commandHash: leader.commandHash,
  };
  requireOwnedProcessIdentity(expected, leader);
  return expected;
};

const assertExactIdentityAbsent = async (expected: { pid: number; started: string }) => {
  const current = await bounded(
    inspectProcessIdentity(expected.pid),
    'independent owned wrapper absence census',
  );
  assert.ok(!current || current.started !== expected.started, 'owned PID/start still exists');
};

const startFakeOwnedWrapper = async (options: {
  root: string;
  bin: string;
  args: string[];
  argsFile: string;
  cwdFile: string;
  readyFile: string;
  exitCode?: number;
}) => {
  const command = await startOwnedNativeCommand({
    command: process.execPath,
    argv: [entryPoint, ...options.args],
    artifactRoot: options.root,
    label: 'native-node-entry',
    cwd: options.root,
    env: {
      ...process.env,
      PATH: `${options.bin}${path.delimiter}${process.env.PATH ?? ''}`,
      FAKE_BASH_ARGS: options.argsFile,
      FAKE_BASH_CWD: options.cwdFile,
      FAKE_BASH_READY: options.readyFile,
      ...(options.exitCode === undefined ? {} : { FAKE_BASH_EXIT_CODE: String(options.exitCode) }),
    },
  });
  await waitForFile(options.readyFile);
  return command;
};

void test('Node entry delegates once to the shell runner with the repository cwd and exact argv', async () => {
  const root = await privateArtifactRoot('mc-native-node-entry-');
  const argsFile = path.join(root, 'args.json');
  const cwdFile = path.join(root, 'cwd');
  const readyFile = path.join(root, 'ready');
  const bin = await createFakeBash(root);
  const args = [
    '--platform=android',
    '--engine=maestro',
    '--scenario=SCN-training-android',
    '--mode=integration',
    '--extra=value with spaces',
  ];
  let command: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  let expected: Awaited<ReturnType<typeof captureOwnedLeader>> | undefined;
  try {
    command = await startFakeOwnedWrapper({
      root,
      bin,
      args,
      argsFile,
      cwdFile,
      readyFile,
    });
    expected = await captureOwnedLeader(command);
    const terminal = bounded(command.closed, 'SIGTERM wrapper terminal status');
    process.kill(expected.pid, 'SIGTERM');
    const result = await terminal;
    assert.equal(result.code, 143);
    assert.equal(result.signal, null);
    assert.deepEqual(JSON.parse(await readFile(argsFile, 'utf8')), [shellRunner, ...args]);
    assert.equal(await readFile(cwdFile, 'utf8'), repositoryRoot);
  } finally {
    if (command) await command.stop();
    if (expected) await assertExactIdentityAbsent(expected);
    await rm(root, { recursive: true, force: true });
  }
});

void test('Node entry forwards SIGINT and preserves the child cancellation status after close', async () => {
  const root = await privateArtifactRoot('mc-native-node-entry-signal-');
  const readyFile = path.join(root, 'ready');
  const bin = await createFakeBash(root);
  let command: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  let expected: Awaited<ReturnType<typeof captureOwnedLeader>> | undefined;
  try {
    command = await startFakeOwnedWrapper({
      root,
      bin,
      args: ['--signal-case'],
      argsFile: path.join(root, 'args.json'),
      cwdFile: path.join(root, 'cwd'),
      readyFile,
    });
    expected = await captureOwnedLeader(command);
    const terminal = bounded(command.closed, 'SIGINT wrapper terminal status');
    process.kill(expected.pid, 'SIGINT');
    const result = await terminal;
    assert.equal(result.code, 130);
    assert.equal(result.signal, null);
  } finally {
    if (command) await command.stop();
    if (expected) await assertExactIdentityAbsent(expected);
    await rm(root, { recursive: true, force: true });
  }
});

void test('Node entry preserves an arbitrary nonzero child exit status', async () => {
  const root = await privateArtifactRoot('mc-native-node-entry-status-');
  const argsFile = path.join(root, 'args.json');
  const cwdFile = path.join(root, 'cwd');
  const readyFile = path.join(root, 'ready');
  const bin = await createFakeBash(root);
  let command: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  let expected: Awaited<ReturnType<typeof captureOwnedLeader>> | undefined;
  try {
    command = await startFakeOwnedWrapper({
      root,
      bin,
      args: ['--child-exit-7'],
      argsFile,
      cwdFile,
      readyFile,
      exitCode: 7,
    });
    expected = await captureOwnedLeader(command);
    const result = await bounded(command.closed, 'arbitrary child terminal status');
    assert.equal(result.code, 7);
    assert.equal(result.signal, null);
  } finally {
    if (command) await command.stop();
    if (expected) await assertExactIdentityAbsent(expected);
    await rm(root, { recursive: true, force: true });
  }
});

void test('Node entry reports a blocked spawn and exits 2 when bash cannot be started', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mc-native-node-entry-spawn-'));
  const child = spawn(process.execPath, [entryPoint, '--spawn-failure'], {
    cwd: root,
    env: { ...process.env, PATH: root },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderr = [] as string[];
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
  try {
    const result = await bounded(waitForClose(child), 'shell spawn failure status');
    assert.equal(result.code, 2);
    assert.equal(result.signal, null);
    assert.match(stderr.join(''), /Native pilot entry blocked: could not start shell runner/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
