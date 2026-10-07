import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { treeHash } from '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/scripts/testing/native-build-identity';
import {
  waitForOwnedDetoxCameraJestSelection,
  waitForOwnedDetoxChildStartup,
} from '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/scripts/testing/native-detox-camera-ios-current-owner';
import {
  readOwnedIosDetoxCameraRunnerInputs,
  rereadOwnedIosDetoxCameraRunnerInputs,
  stageOwnedIosDetoxCameraRunnerInputs,
} from '/Users/eduwaldo/.codex/private-overlays/ios-detox-camera-save-password-remote-helper-contract-v21-20261006/candidate/scripts/testing/native-detox-camera-ios-inputs';
import { startOwnedNativeCommand } from '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/scripts/testing/owned-native-command';
import { groupProcesses } from '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/scripts/testing/owned-process-group';

async function runnerRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  await chmod(root, 0o700);
  await mkdir(path.join(root, 'e2e'), { mode: 0o700 });
  await writeFile(path.join(root, '.detoxrc.js'), 'module.exports = { testRunner: {} };\n', {
    mode: 0o600,
  });
  await writeFile(
    path.join(root, 'detox.camera.private.config.js'),
    [
      "const path = require('node:path');",
      'const currentRoot = process.env.DETOX_CAMERA_CURRENT_ROOT;',
      "const base = require(path.join(currentRoot, '.detoxrc.js'));",
      'module.exports = { ...base, testRunner: { ...base.testRunner, args: { ...base.testRunner.args, config: process.env.DETOX_CAMERA_JEST_CONFIG_PATH } } };',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(root, 'jest.detox-camera.private.config.js'),
    [
      'module.exports = {',
      '  rootDir: process.env.DETOX_CAMERA_CURRENT_ROOT,',
      '  testMatch: [process.env.DETOX_CAMERA_TEST_PATH],',
      '};',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(root, 'e2e/detox-ios-camera-route.e2e.test.js'),
    "test('camera', () => {});\n",
    { mode: 0o600 },
  );
  await mkdir(path.join(root, 'scripts/testing'), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    path.join(root, 'scripts/testing/native-detox-camera-ios-ipc.ts'),
    "export const fixtureIpcContract = 'owned-password-stage';\n",
    { mode: 0o600 },
  );
  return root;
}

function paths(root: string) {
  return {
    detoxBaseConfigPath: path.join(root, '.detoxrc.js'),
    detoxConfigPath: path.join(root, 'detox.camera.private.config.js'),
    jestConfigPath: path.join(root, 'jest.detox-camera.private.config.js'),
    cameraTestPath: path.join(root, 'e2e/detox-ios-camera-route.e2e.test.js'),
    childSourcePath: path.join(root, 'e2e/detox-ios-camera-route.e2e.test.js'),
    ipcSourcePath: path.join(root, 'scripts/testing/native-detox-camera-ios-ipc.ts'),
  } as const;
}

void test('V26 binds the imported Detox base config and rechecks it before launch', async () => {
  const root = await runnerRoot('mc-ios-camera-v26-launch-');
  try {
    const identity = await readOwnedIosDetoxCameraRunnerInputs({
      repositoryRoot: root,
      paths: paths(root),
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: performance.now() + 10_000,
    });
    assert.equal(identity.files.detoxBaseConfigPath.relativePath, '.detoxrc.js');
    assert.equal(identity.files.detoxBaseConfigPath.sha256.length, 64);
    await writeFile(path.join(root, '.detoxrc.js'), 'module.exports = { changed: true };\n', {
      mode: 0o600,
    });
    await assert.rejects(
      rereadOwnedIosDetoxCameraRunnerInputs({
        repositoryRoot: root,
        paths: paths(root),
        expected: identity,
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: performance.now() + 10_000,
      }),
      /changed after ownership qualification/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V27 rejects a directory-to-symlink substitution after readdir', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v27-dir-')));
  const root = path.join(parent, 'root');
  const outside = path.join(parent, 'outside');
  const directory = path.join(root, 'nested');
  try {
    await mkdir(directory, { mode: 0o700, recursive: true });
    await mkdir(outside, { mode: 0o700 });
    await writeFile(path.join(directory, 'owned.txt'), 'owned\n', {
      mode: 0o600,
    });
    await writeFile(path.join(outside, 'foreign.txt'), 'foreign\n', {
      mode: 0o600,
    });
    let swapped = false;
    await assert.rejects(
      treeHash(root, {
        verifyStableIdentity: true,
        testHooks: {
          beforeEntryIdentityCheck: async (entry) => {
            if (!swapped && entry.expected === 'directory' && entry.path === directory) {
              swapped = true;
              await rename(directory, `${directory}.owned`);
              await symlink(outside, directory);
            }
          },
        },
      }),
      /directory changed type before traversal/i,
    );
    assert.equal(swapped, true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('V27 rejects a file-to-symlink substitution before reading bytes', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v27-file-')));
  const root = path.join(parent, 'root');
  const outside = path.join(parent, 'foreign.txt');
  const file = path.join(root, 'owned.txt');
  try {
    await mkdir(root, { mode: 0o700 });
    await writeFile(file, 'owned\n', { mode: 0o600 });
    await writeFile(outside, 'foreign\n', { mode: 0o600 });
    let swapped = false;
    await assert.rejects(
      treeHash(root, {
        verifyStableIdentity: true,
        testHooks: {
          beforeEntryIdentityCheck: async (entry) => {
            if (!swapped && entry.expected === 'file' && entry.path === file) {
              swapped = true;
              await rename(file, `${file}.owned`);
              await symlink(outside, file);
            }
          },
        },
      }),
      /file changed type before reading/i,
    );
    assert.equal(swapped, true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('V27 rejects descendant and symlink mutations at their post-read fences', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v27-post-')));
  const root = path.join(parent, 'root');
  const targetA = path.join(parent, 'target-a');
  const targetB = path.join(parent, 'target-b');
  const link = path.join(root, 'link');
  try {
    await mkdir(root, { mode: 0o700 });
    await writeFile(path.join(root, 'owned.txt'), 'owned\n', { mode: 0o600 });
    await writeFile(targetA, 'a\n', { mode: 0o600 });
    await writeFile(targetB, 'b\n', { mode: 0o600 });
    await symlink(targetA, link);
    let linkSwapped = false;
    await assert.rejects(
      treeHash(root, {
        verifyStableIdentity: true,
        testHooks: {
          beforeSymlinkPostCheck: async (file) => {
            if (!linkSwapped && file === link) {
              linkSwapped = true;
              await unlink(file);
              await symlink(targetB, file);
            }
          },
        },
      }),
      /symlink changed while it was being hashed/i,
    );
    assert.equal(linkSwapped, true);

    let directoryMutated = false;
    await assert.rejects(
      treeHash(root, {
        verifyStableIdentity: true,
        testHooks: {
          beforeDirectoryPostCheck: async (directory) => {
            if (!directoryMutated && directory === root) {
              directoryMutated = true;
              await writeFile(path.join(root, 'late.txt'), 'late\n', {
                mode: 0o600,
              });
            }
          },
        },
      }),
      /directory changed while its descendants were being hashed/i,
    );
    assert.equal(directoryMutated, true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('V27 stages immutable launch inputs before Detox/Jest module loading', async () => {
  const root = await runnerRoot('mc-ios-camera-v27-stage-root-');
  const stageParent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v27-stage-')),
  );
  const stageRoot = path.join(stageParent, 'owner-stage');
  let stagedRootForCleanup: string | undefined;
  const originalEnv = new Map<string, string | undefined>();
  const envKeys = [
    'DETOX_CAMERA_CURRENT_ROOT',
    'DETOX_CAMERA_DETOX_CONFIG_PATH',
    'DETOX_CAMERA_JEST_CONFIG_PATH',
    'DETOX_CAMERA_TEST_PATH',
    'DETOX_CAMERA_CHILD_SOURCE_PATH',
  ];
  const requireConfig = createRequire(import.meta.url);
  try {
    await mkdir(stageRoot, { mode: 0o700 });
    const inputPaths = paths(root);
    const original = await readOwnedIosDetoxCameraRunnerInputs({
      repositoryRoot: root,
      paths: inputPaths,
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: performance.now() + 10_000,
    });
    const staged = await stageOwnedIosDetoxCameraRunnerInputs({
      repositoryRoot: root,
      stageRoot,
      paths: inputPaths,
      expected: original,
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: performance.now() + 10_000,
    });
    stagedRootForCleanup = staged.staged.root;
    const originalBase = await readFile(inputPaths.detoxBaseConfigPath, 'utf8');
    await writeFile(inputPaths.detoxBaseConfigPath, 'module.exports = { changed: true };\n', {
      mode: 0o600,
    });
    assert.equal(await readFile(staged.paths.detoxBaseConfigPath, 'utf8'), originalBase);
    assert.deepEqual(
      await readFile(staged.paths.ipcSourcePath),
      await readFile(inputPaths.ipcSourcePath),
    );
    assert.equal((await lstat(staged.paths.ipcSourcePath)).mode & 0o777, 0o400);
    assert.equal((await lstat(staged.staged.root)).mode & 0o777, 0o500);
    assert.equal((await lstat(staged.paths.detoxBaseConfigPath)).mode & 0o777, 0o400);
    for (const key of envKeys) originalEnv.set(key, process.env[key]);
    process.env.DETOX_CAMERA_CURRENT_ROOT = staged.staged.root;
    process.env.DETOX_CAMERA_DETOX_CONFIG_PATH = staged.paths.detoxConfigPath;
    process.env.DETOX_CAMERA_JEST_CONFIG_PATH = staged.paths.jestConfigPath;
    process.env.DETOX_CAMERA_TEST_PATH = staged.paths.cameraTestPath;
    process.env.DETOX_CAMERA_CHILD_SOURCE_PATH = staged.paths.childSourcePath;
    const detoxConfig = requireConfig(staged.paths.detoxConfigPath) as {
      testRunner: { args: { config: string } };
    };
    const jestConfig = requireConfig(staged.paths.jestConfigPath) as {
      rootDir: string;
      testMatch: string[];
    };
    assert.equal(detoxConfig.testRunner.args.config, staged.paths.jestConfigPath);
    assert.equal(jestConfig.rootDir, staged.staged.root);
    assert.deepEqual(jestConfig.testMatch, [staged.paths.cameraTestPath]);
  } finally {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (stagedRootForCleanup) {
      await chmod(stagedRootForCleanup, 0o700).catch(() => undefined);
      await chmod(path.join(stagedRootForCleanup, 'e2e'), 0o700).catch(() => undefined);
      await chmod(path.join(stagedRootForCleanup, 'scripts'), 0o700).catch(() => undefined);
      await chmod(path.join(stagedRootForCleanup, 'scripts/testing'), 0o700).catch(() => undefined);
    }
    await rm(root, { recursive: true, force: true });
    await rm(stageParent, { recursive: true, force: true });
  }
});

void test('V28 rejects zero-test and terminal-child bootstrap before IPC', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v28-empty-')));
  await chmod(root, 0o700);
  const terminalChild = {
    pgid: 49201,
    outcome: () => ({ code: 1, signal: null }),
    capture: () => Promise.reject(new Error('terminal children must not be recensed')),
  } as unknown as Parameters<typeof waitForOwnedDetoxChildStartup>[0];
  const liveChild = {
    pgid: 49202,
    outcome: () => ({ code: null, signal: null }),
  } as unknown as Parameters<typeof waitForOwnedDetoxCameraJestSelection>[0]['child'];
  try {
    await assert.rejects(
      waitForOwnedDetoxChildStartup(
        terminalChild,
        performance.now() + 10_000,
        new AbortController().signal,
      ),
      /terminated before startup: code=1, signal=null/i,
    );
    await assert.rejects(
      waitForOwnedDetoxCameraJestSelection({
        child: terminalChild,
        artifactRoot: root,
        runnerInputsSha256: 'a'.repeat(64),
        cameraTestPath: path.join(root, 'e2e/detox-ios-camera-route.e2e.test.js'),
        cameraTestSha256: 'b'.repeat(64),
        deadlineAtMonotonicMs: performance.now() + 10_000,
        signal: new AbortController().signal,
      }),
      /terminated before Jest test selection: code=1, signal=null/i,
    );
    await assert.rejects(
      waitForOwnedDetoxCameraJestSelection({
        child: liveChild,
        artifactRoot: root,
        runnerInputsSha256: 'a'.repeat(64),
        cameraTestPath: path.join(root, 'e2e/detox-ios-camera-route.e2e.test.js'),
        cameraTestSha256: 'b'.repeat(64),
        deadlineAtMonotonicMs: performance.now() + 250,
        signal: new AbortController().signal,
      }),
      /did not publish exactly one selected test before bootstrap/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V27 adopts a real descendant exec and cleans the owned group', async () => {
  if (process.platform === 'win32') return;
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v27-exec-')));
  await chmod(root, 0o700);
  const marker = path.join(root, 'descendant-started');
  const release = path.join(root, 'descendant-release');
  const script = path.join(root, 'descendant-parent.cjs');
  await writeFile(
    script,
    [
      "const fs = require('node:fs');",
      "const { spawn } = require('node:child_process');",
      'const marker = process.argv[2];',
      'const release = process.argv[3];',
      "const shell = spawn('/bin/sh', ['-c', 'printf started > \"$1\"; read gate; exec \"$2\" -e \"setInterval(()=>{},1000)\"', 'owned-descendant', marker, process.execPath], { stdio: ['pipe', 'ignore', 'ignore'] });",
      "const timer = setInterval(() => { if (fs.existsSync(release)) { clearInterval(timer); shell.stdin.end('go\\n'); } }, 10);",
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'),
    { mode: 0o700 },
  );
  let child: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  try {
    child = await startOwnedNativeCommand({
      command: process.execPath,
      argv: [script, marker, release],
      artifactRoot: root,
      label: 'descendant-exec',
      env: { ...process.env },
    });
    const markerDeadline = Date.now() + 5_000;
    while (true) {
      try {
        await lstat(marker);
        break;
      } catch {
        assert(Date.now() < markerDeadline, 'owned descendant did not reach the exec gate');
        await delay(20);
      }
    }
    const before = await child.capture(true);
    const descendant = before.find((row) => row.pid !== child!.pid);
    assert(descendant, 'expected an owned non-leader descendant before exec');
    await writeFile(release, 'release\n', { flag: 'wx', mode: 0o600 });

    const transitionDeadline = Date.now() + 5_000;
    let after = before;
    let ledger: {
      processExecutions: {
        pid: number;
        pgid: number;
        started: string;
        previousCommandHash: string;
        commandHash: string;
      }[];
    };
    do {
      await delay(25);
      after = await child.capture(true);
      ledger = JSON.parse(
        await readFile(path.join(root, 'descendant-exec.ownership.json'), 'utf8'),
      ) as typeof ledger;
    } while (ledger.processExecutions.length === 0 && Date.now() < transitionDeadline);
    assert.equal(ledger.processExecutions.length, 1);
    assert.deepEqual(ledger.processExecutions[0], {
      pid: descendant.pid,
      pgid: descendant.pgid,
      started: descendant.started,
      previousCommandHash: descendant.commandHash,
      commandHash: after.find((row) => row.pid === descendant.pid)!.commandHash,
    });
    assert.notEqual(
      ledger.processExecutions[0].previousCommandHash,
      ledger.processExecutions[0].commandHash,
    );

    await child.stop();
    await child.closed;
    assert.deepEqual(await groupProcesses(child.pgid), []);
  } finally {
    await child?.stop().catch(() => undefined);
    await child?.closed.catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

void test('V27 refuses to stage after a reviewed input mutates', async () => {
  const root = await runnerRoot('mc-ios-camera-v27-stage-race-');
  const stageParent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v27-race-')),
  );
  const stageRoot = path.join(stageParent, 'owner-stage');
  try {
    await mkdir(stageRoot, { mode: 0o700 });
    const inputPaths = paths(root);
    const original = await readOwnedIosDetoxCameraRunnerInputs({
      repositoryRoot: root,
      paths: inputPaths,
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: performance.now() + 10_000,
    });
    await writeFile(inputPaths.cameraTestPath, "test('changed', () => {});\n", {
      mode: 0o600,
    });
    await assert.rejects(
      stageOwnedIosDetoxCameraRunnerInputs({
        repositoryRoot: root,
        stageRoot,
        paths: inputPaths,
        expected: original,
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: performance.now() + 10_000,
      }),
      /changed before immutable staging/i,
    );
    assert.deepEqual(await (await import('node:fs/promises')).readdir(stageRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(stageParent, { recursive: true, force: true });
  }
});

void test('V27 preserves runner provenance and immutable fences in source and child launch paths', async () => {
  const owner = await readFile(
    path.join(
      '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/tests/ci',
      '../../scripts/testing/native-detox-camera-ios-current-owner.ts',
    ),
    'utf8',
  );
  const child = await readFile(
    path.join(
      '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/tests/ci',
      '../../e2e/detox-ios-camera-route.e2e.test.js',
    ),
    'utf8',
  );
  const detoxConfig = await readFile(
    path.join(
      '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/tests/ci',
      '../../detox.camera.private.config.js',
    ),
    'utf8',
  );
  const jestConfig = await readFile(
    path.join(
      '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/tests/ci',
      '../../jest.detox-camera.private.config.js',
    ),
    'utf8',
  );
  const tree = await readFile(
    path.join(
      '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/tests/ci',
      '../../scripts/testing/native-build-identity.ts',
    ),
    'utf8',
  );
  assert.match(
    owner,
    /record\.identity = \{ \.\.\.\(record\.identity \?\? \{\}\), \.\.\.identity \}/,
  );
  assert.match(owner, /DETOX_CAMERA_DETOX_BASE_CONFIG_PATH/);
  assert.match(owner, /DETOX_CAMERA_DETOX_BASE_CONFIG_SHA256/);
  assert.match(owner, /NODE_PATH: nodeModulesRoot/);
  assert.match(owner, /DETOX_CAMERA_NODE_MODULES_ROOT/);
  assert.match(owner, /DETOX_CAMERA_WORKING_ROOT/);
  assert.match(owner, /Object\.assign\(childEnv/);
  assert.match(child, /async function verifyRunnerInputs\(\)/);
  assert.match(child, /await verifyRunnerInputs\(\);/);
  assert.match(child, /runnerInputsExpectedSha256/);
  assert.match(tree, /requireDirectoryIdentity\(await lstat\(file\), file\)/);
  assert.match(tree, /requireFileIdentity\(await lstat\(file\), file\)/);
  assert.match(tree, /beforeEntryIdentityCheck/);
  assert.match(tree, /const targetAfter = liveOptions\?\.verifyStableIdentity/);
  assert.match(tree, /Native symlink changed while it was being hashed/);
  assert.match(tree, /Native directory changed while its descendants were being hashed/);
  assert.match(tree, /beforeDirectoryPostCheck/);
  assert.match(owner, /stageOwnedIosDetoxCameraRunnerInputs/);
  assert.match(owner, /async function resolveOwnedYarnCli/);
  assert.match(owner, /command: process\.execPath/);
  assert.match(owner, /argv: \[\s*yarnCliPath/);
  assert.match(
    owner,
    /childCommand\.argv\[4\] = stagedRunnerInputsBeforeChild\.paths\.detoxConfigPath/,
  );
  assert.match(owner, /waitForOwnedDetoxCameraJestSelection/);
  assert.match(owner, /DETOX_CAMERA_JEST_SELECTION_RECEIPT/);
  assert.match(child, /detox-ios-camera-jest-selection-v1/);
  assert.match(child, /selectedTestCount: 1/);
  assert.match(owner, /DETOX_CAMERA_REVIEWED_RUNNER_INPUTS_SHA256/);
  assert.match(owner, /stagedRunnerInputsBeforeChild\.paths\.detoxConfigPath/);
  assert.match(child, /reviewedRunnerRoot/);
  assert.match(child, /process\.env\.NODE_PATH !== nodeModulesRoot/);
  assert.match(child, /require\.resolve\('detox'\)/);
  assert.match(child, /verifyDetoxIosProfileBinding\(\)/);
  assert.match(child, /Q checked-in profile/);
  assert.match(detoxConfig, /expectedCameraTestPath/);
  assert.match(detoxConfig, /_: \[cameraTestPath\]/);
  assert.match(jestConfig, /cameraTestPath !== path\.join\(currentRoot/);
});
