import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
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
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildIosIncrementalBuildBinding,
  buildIosXcodebuildArguments,
  IOS_INCREMENTAL_BUILD_CACHE_RESULT_RECEIPT,
  loadIosIncrementalBuildCachePredecessor,
  prepareIosIncrementalBuildCache,
  resolveIosIncrementalBuildToolchain,
  writeIosIncrementalBuildCacheReceipt,
  writeIosIncrementalBuildCacheResultReceipt,
} from '../../scripts/testing/native-ios-incremental-build-cache';
import type { NativeCommandExecution } from '../../scripts/testing/owned-native-command';

const SOURCE = {
  sha: 'a'.repeat(40),
  dirty: true,
  sourceTreeHash: 'b'.repeat(64),
};
const RUN_ID = 'c'.repeat(24);
const DEVICE = '12345678-1234-1234-1234-123456789abc';
const TOOLCHAIN = {
  xcodebuildVersion: 'Xcode 26.1\nBuild version 17A999',
  developerDir: '/tmp/ios-cache-developer',
  developerDirCanonical: '/tmp/ios-cache-developer',
  sdkPath: '/tmp/ios-cache-sdk',
  sdkPathCanonical: '/tmp/ios-cache-sdk',
  sdkVersion: '26.1',
  architecture: 'arm64',
};

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function privateRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  await chmod(root, 0o700);
  return root;
}

async function writePrivate(file: string, value: string | Buffer): Promise<void> {
  await writeFile(file, value, { flag: 'wx', mode: 0o600 });
}

async function createPredecessor(parent: string) {
  const sourceRoot = path.join(parent, '.qa/artifacts/native-pilot', RUN_ID);
  await mkdir(sourceRoot, { recursive: true, mode: 0o700 });
  const cacheRoot = path.join(sourceRoot, 'ios-build');
  await mkdir(path.join(cacheRoot, 'Build/Intermediates.noindex/Objects-normal/arm64'), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(path.join(cacheRoot, 'CompilationCache.noindex/generic/v1.1'), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(path.join(cacheRoot, 'ModuleCache.noindex/modules'), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(path.join(cacheRoot, 'SDKStatCaches.noindex'), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(path.join(cacheRoot, 'Build/Products/Debug-iphonesimulator'), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    path.join(cacheRoot, 'Build/Intermediates.noindex/Objects-normal/arm64/App.o'),
    'partial compiler object',
    { mode: 0o600 },
  );
  await writeFile(path.join(cacheRoot, 'CompilationCache.noindex/generic/v1.1/cache'), 'cache', {
    mode: 0o600,
  });
  await writeFile(path.join(cacheRoot, 'ModuleCache.noindex/modules/module.pcm'), 'module', {
    mode: 0o600,
  });
  await writeFile(path.join(cacheRoot, 'SDKStatCaches.noindex/sdk.cache'), 'sdk', { mode: 0o600 });
  await writeFile(
    path.join(cacheRoot, 'Build/Products/Debug-iphonesimulator/stale.app'),
    'must never be copied',
    { mode: 0o600 },
  );
  const logPath = path.join(sourceRoot, 'build.private.log');
  const ownershipPath = path.join(sourceRoot, 'build.ownership.json');
  await writePrivate(logPath, 'xcodebuild terminal log');
  await writePrivate(
    ownershipPath,
    JSON.stringify({
      processes: [
        {
          pid: 123,
          pgid: 123,
          started: '2026-10-06T00:00:00.000Z',
          commandHash: sha('xcodebuild'),
        },
      ],
    }),
  );
  const entitlementsPath = path.join(sourceRoot, 'entitlements.private.plist');
  await writePrivate(entitlementsPath, '<plist/>');
  const binding = buildIosIncrementalBuildBinding({
    source: SOURCE,
    toolchain: TOOLCHAIN,
    metroPort: 50000,
    entitlementsSha256: sha('<plist/>'),
  });
  const argv = buildIosXcodebuildArguments({
    derivedDataPath: cacheRoot,
    deviceUdid: DEVICE,
    entitlementsPath,
    metroPort: 50000,
  });
  const command: NativeCommandExecution & {
    label: string;
    command: string;
    argv: string[];
    deadlineMs: number;
  } = {
    label: 'build',
    command: 'xcodebuild',
    argv,
    phase: 'build',
    execution: 'deadline',
    cleanup: 'cleaned',
    childExitCode: null,
    childSignal: 'SIGTERM',
    pid: 123,
    pgid: 123,
    logPath,
    stdoutPath: null,
    ownershipPath,
    elapsedMs: 900000,
    cleanupMs: 100,
    deadlineMs: 900000,
  };
  const receipt = await writeIosIncrementalBuildCacheReceipt({
    artifactRoot: sourceRoot,
    captureRunId: RUN_ID,
    source: SOURCE,
    sourceAfter: SOURCE,
    binding,
    command,
    captureCleanup: 'cleaned',
  });
  await writePrivate(
    path.join(sourceRoot, 'capture.private.json'),
    JSON.stringify({
      captureRunId: RUN_ID,
      captureRoot: sourceRoot,
      platform: 'ios',
      cleanup: 'cleaned',
      source: SOURCE,
      sourceAfter: SOURCE,
      reservedPorts: [50000],
      commandExecutions: [command],
      incrementalBuildCacheReceipt: {
        path: receipt.path,
        sha256: receipt.sha256,
        bytes: receipt.bytes,
      },
    }),
  );
  return { sourceRoot, cacheRoot, binding, command };
}

void test('accepts only a cleaned failed producer and copies compiler state into a fresh cache root', async () => {
  const parent = await privateRoot('mc-ios-incremental-positive-');
  const destination = await privateRoot('mc-ios-incremental-destination-');
  try {
    const predecessor = await createPredecessor(parent);
    const loaded = await loadIosIncrementalBuildCachePredecessor(predecessor.sourceRoot, SOURCE);
    assert.equal(loaded.captureRunId, RUN_ID);
    assert.equal(loaded.metroPort, 50000);
    const prepared = await prepareIosIncrementalBuildCache({
      predecessor: loaded,
      destinationRoot: destination,
      currentBinding: predecessor.binding,
      deadlineMs: 900000,
      artifactRoot: destination,
    });
    assert.equal(prepared.appProductsCopied, false);
    assert.equal(prepared.terminalReceiptCopied, false);
    assert.equal(prepared.freshXcodebuildRequired, true);
    assert.equal(prepared.originalBuildDeadlineMs, 900000);
    assert.equal(
      await readFile(
        path.join(destination, 'ios-build/Build/Intermediates.noindex/Objects-normal/arm64/App.o'),
        'utf8',
      ),
      'partial compiler object',
    );
    await assert.rejects(
      lstat(path.join(destination, 'ios-build/Build/Products/Debug-iphonesimulator/stale.app')),
      { code: 'ENOENT' },
    );
    const resultReceipt = await writeIosIncrementalBuildCacheResultReceipt({
      artifactRoot: destination,
      preparation: prepared,
      command: predecessor.command,
      captureCleanup: 'cleaned',
    });
    assert.equal(resultReceipt.path, IOS_INCREMENTAL_BUILD_CACHE_RESULT_RECEIPT);
    assert.equal(resultReceipt.bytes > 0, true);
    assert.match(resultReceipt.sha256, /^[a-f0-9]{64}$/);
    const result = JSON.parse(
      await readFile(path.join(destination, IOS_INCREMENTAL_BUILD_CACHE_RESULT_RECEIPT), 'utf8'),
    ) as {
      freshBuild: {
        appProductsReused: boolean;
        terminalReceiptReused: boolean;
      };
    };
    assert.deepEqual(result.freshBuild, {
      appProductsReused: false,
      terminalReceiptReused: false,
      promotion: 'never-from-cache',
      command: predecessor.command,
      captureCleanup: 'cleaned',
    });
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
  }
});

void test('rejects stale source, symlink aliases, foreign cache roots, wrong bindings and shortened deadlines', async () => {
  const parent = await privateRoot('mc-ios-incremental-negative-');
  const destination = await privateRoot('mc-ios-incremental-negative-destination-');
  try {
    const predecessor = await createPredecessor(parent);
    await assert.rejects(
      loadIosIncrementalBuildCachePredecessor(predecessor.sourceRoot, {
        ...SOURCE,
        sourceTreeHash: 'd'.repeat(64),
      }),
      /source identity is stale/,
    );
    const alias = path.join(parent, 'alias');
    await symlink(predecessor.sourceRoot, alias);
    await assert.rejects(
      loadIosIncrementalBuildCachePredecessor(alias, SOURCE),
      /must be canonical/,
    );
    await assert.rejects(
      loadIosIncrementalBuildCachePredecessor(predecessor.cacheRoot, SOURCE),
      /owned native pilot or native recovery root/,
    );
    const foreign = path.join(parent, 'foreign-cache', RUN_ID);
    await mkdir(foreign, { recursive: true, mode: 0o700 });
    await assert.rejects(
      loadIosIncrementalBuildCachePredecessor(foreign, SOURCE),
      /owned native pilot or native recovery root/,
    );
    await writeFile(
      path.join(predecessor.cacheRoot, 'ModuleCache.noindex/modules/module.pcm'),
      'changed after producer receipt',
      { mode: 0o600 },
    );
    await assert.rejects(
      loadIosIncrementalBuildCachePredecessor(predecessor.sourceRoot, SOURCE),
      /compiler cache bytes changed/,
    );
    const fresh = await createPredecessor(path.join(parent, 'second'));
    const loaded = await loadIosIncrementalBuildCachePredecessor(fresh.sourceRoot, SOURCE);
    await assert.rejects(
      prepareIosIncrementalBuildCache({
        predecessor: loaded,
        destinationRoot: destination,
        currentBinding: {
          ...fresh.binding,
          build: { ...fresh.binding.build, metroPort: 50001 },
          bindingSha256: 'e'.repeat(64),
        },
        deadlineMs: 900000,
        artifactRoot: destination,
      }),
      /toolchain, SDK, architecture or configuration differs/,
    );
    await assert.rejects(
      prepareIosIncrementalBuildCache({
        predecessor: loaded,
        destinationRoot: destination,
        currentBinding: fresh.binding,
        deadlineMs: 899999,
        artifactRoot: destination,
      }),
      /original 900000ms build deadline/,
    );
    await mkdir(path.join(destination, 'ios-build'), { mode: 0o700 });
    await assert.rejects(
      prepareIosIncrementalBuildCache({
        predecessor: loaded,
        destinationRoot: destination,
        currentBinding: fresh.binding,
        deadlineMs: 900000,
        artifactRoot: destination,
      }),
      /destination DerivedData already exists/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
  }
});

void test('resolves toolchain identity through real command outputs and keeps build argv bounded', async () => {
  const root = await privateRoot('mc-ios-incremental-toolchain-');
  const developer = path.join(root, 'Developer');
  const sdk = path.join(root, 'SDK');
  await mkdir(developer, { mode: 0o700 });
  await mkdir(sdk, { mode: 0o700 });
  const output: Record<string, string> = {
    'xcodebuild -version': 'Xcode 26.1\nBuild version 17A999\n',
    'xcode-select -p': `${developer}\n`,
    'xcrun --sdk iphonesimulator --show-sdk-path': `${sdk}\n`,
    'xcrun --sdk iphonesimulator --show-sdk-version': '26.1\n',
    'uname -m': 'arm64\n',
  };
  try {
    const toolchain = await resolveIosIncrementalBuildToolchain((command, argv) =>
      Promise.resolve({ stdout: output[[command, ...argv].join(' ')] ?? '' }),
    );
    assert.equal(toolchain.sdkPathCanonical, sdk);
    assert.equal(toolchain.architecture, 'arm64');
    const argv = buildIosXcodebuildArguments({
      derivedDataPath: path.join(root, 'ios-build'),
      deviceUdid: DEVICE,
      entitlementsPath: path.join(root, 'entitlements.plist'),
      metroPort: 50000,
    });
    assert.deepEqual(argv.slice(0, 12), [
      '-workspace',
      'ios/mychampions.xcworkspace',
      '-scheme',
      'mychampions',
      '-configuration',
      'Debug',
      '-sdk',
      'iphonesimulator',
      '-destination',
      `id=${DEVICE}`,
      '-derivedDataPath',
      path.join(root, 'ios-build'),
    ]);
    assert.equal(argv.includes('-disableAutomaticPackageResolution'), true);
    assert.equal(argv.includes('CODE_SIGNING_ALLOWED=YES'), true);
    assert.equal(argv.includes('CODE_SIGNING_REQUIRED=NO'), true);
    assert.equal(argv.includes('CODE_SIGN_IDENTITY=-'), true);
    assert.equal(argv.includes('RCT_METRO_PORT=50000'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('production camera wiring keeps the source option optional and runs a fresh bounded build', async () => {
  const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const [capture, camera, pilot] = await Promise.all([
    readFile(path.join(candidateRoot, 'scripts/testing/capture-native-testability.ts'), 'utf8'),
    readFile(path.join(candidateRoot, 'scripts/testing/run-ios-camera-attempt.ts'), 'utf8'),
    readFile(path.join(candidateRoot, 'scripts/testing/run-native-pilot.ts'), 'utf8'),
  ]);
  assert.match(capture, /incrementalBuildCacheSourceRoot/);
  assert.match(capture, /prepareIosIncrementalBuildCache/);
  assert.match(capture, /buildIosXcodebuildArguments/);
  assert.match(capture, /nativeEnv,\s*budget\.buildMs/);
  assert.match(capture, /writeIosIncrementalBuildCacheResultReceipt/);
  assert.match(camera, /incrementalBuildCacheSourceRoot: options\.incrementalBuildCacheSourceRoot/);
  assert.match(pilot, /MYCHAMPIONS_NATIVE_INCREMENTAL_BUILD_CACHE_ROOT/);
});
