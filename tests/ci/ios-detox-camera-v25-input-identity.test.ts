import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { treeHash } from '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/scripts/testing/native-build-identity';
import {
  readOwnedIosDetoxCameraRunnerInputs,
  rereadOwnedIosDetoxCameraRunnerInputs,
} from '/Users/eduwaldo/.codex/private-overlays/ios-detox-camera-save-password-remote-helper-contract-v21-20261006/candidate/scripts/testing/native-detox-camera-ios-inputs';

async function runnerRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  await chmod(root, 0o700);
  await writeFile(path.join(root, '.detoxrc.js'), 'module.exports = {}\n', {
    mode: 0o600,
  });
  await writeFile(path.join(root, 'detox.camera.private.config.js'), 'module.exports = {}\n', {
    mode: 0o600,
  });
  await writeFile(path.join(root, 'jest.detox-camera.private.config.js'), 'module.exports = {}\n', {
    mode: 0o600,
  });
  await mkdir(path.join(root, 'e2e'), { mode: 0o700 });
  await writeFile(
    path.join(root, 'e2e/detox-ios-camera-route.e2e.test.js'),
    "test('camera', () => {})\n",
    {
      mode: 0o600,
    },
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

async function read(root: string) {
  return readOwnedIosDetoxCameraRunnerInputs({
    repositoryRoot: root,
    paths: paths(root),
    signal: new AbortController().signal,
    deadlineAtMonotonicMs: performance.now() + 10_000,
  });
}

void test('V25 binds the exact owned camera runner closure and rejects foreign or symlinked inputs', async () => {
  const root = await runnerRoot('mc-ios-camera-v25-inputs-');
  const foreignRoot = await runnerRoot('mc-ios-camera-v25-foreign-');
  try {
    const identity = await read(root);
    assert.equal(identity.files.detoxBaseConfigPath.relativePath, '.detoxrc.js');
    assert.equal(identity.files.detoxConfigPath.relativePath, 'detox.camera.private.config.js');
    assert.equal(identity.files.jestConfigPath.relativePath, 'jest.detox-camera.private.config.js');
    assert.equal(
      identity.files.cameraTestPath.relativePath,
      'e2e/detox-ios-camera-route.e2e.test.js',
    );
    assert.equal(
      identity.files.ipcSourcePath.relativePath,
      'scripts/testing/native-detox-camera-ios-ipc.ts',
    );
    assert.equal(identity.files.ipcSourcePath.sha256.length, 64);
    await assert.rejects(
      readOwnedIosDetoxCameraRunnerInputs({
        repositoryRoot: root,
        paths: {
          ...paths(root),
          jestConfigPath: path.join(foreignRoot, 'jest.detox-camera.private.config.js'),
        },
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: performance.now() + 10_000,
      }),
      /outside.*canonical.*root/i,
    );
    const symlinkPath = path.join(root, 'jest.detox-camera.private.config.js');
    await rm(symlinkPath);
    await symlink(path.join(foreignRoot, 'jest.detox-camera.private.config.js'), symlinkPath);
    await assert.rejects(read(root), /canonical regular file/i);
    assert.equal(identity.files.childSourcePath.sha256, identity.files.cameraTestPath.sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(foreignRoot, { recursive: true, force: true });
  }
});

void test('V25 re-reads runner content and metadata before child action', async () => {
  const root = await runnerRoot('mc-ios-camera-v25-reread-');
  try {
    const identity = await read(root);
    await writeFile(
      path.join(root, 'detox.camera.private.config.js'),
      'module.exports = { changed: true }\n',
      {
        mode: 0o600,
      },
    );
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

void test('V25 tree hashing fails closed on cancellation and expired original deadline', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v25-tree-')));
  try {
    await writeFile(path.join(root, 'payload'), 'payload');
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      treeHash(root, { signal: cancelled.signal, verifyStableIdentity: true }),
      /aborted/i,
    );
    await assert.rejects(
      treeHash(root, {
        deadlineAtMonotonicMs: performance.now() - 1,
        verifyStableIdentity: true,
      }),
      /deadline exceeded/i,
    );
    assert.match(
      await treeHash(root, {
        deadlineAtMonotonicMs: performance.now() + 10_000,
        verifyStableIdentity: true,
      }),
      /^[a-f0-9]{64}$/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V25 retains signal forwarding through the shared target and permission/app observers', async () => {
  const baseline = await readFile(
    path.join(
      '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/tests/ci',
      '../../scripts/testing/detox-integrated-session-baseline.ts',
    ),
    'utf8',
  );
  const observation = await readFile(
    path.join(
      '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/tests/ci',
      '../../scripts/testing/native-camera-observation.ts',
    ),
    'utf8',
  );
  const buildIdentity = await readFile(
    path.join(
      '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions/tests/ci',
      '../../scripts/testing/native-build-identity.ts',
    ),
    'utf8',
  );
  assert.match(baseline, /verify: async \(signal\?: AbortSignal\)/);
  assert.match(baseline, /device\.inspect\(signal\)/);
  assert.match(observation, /await device\.verify\(signal\)/);
  assert.match(buildIdentity, /new AbortController\(\)/);
  assert.match(buildIdentity, /setTimeout\(scheduleDeadlineAbort/);
});
