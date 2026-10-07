import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { buildDetoxVerifiedBinaryEnvironment } from '../../scripts/testing/detox-integrated-connection-driver';
import {
  detoxSessionHelperClosure,
  requireDetoxBuildInstrumentation,
  type DetoxBaselineBuildInstrumentation,
} from '../../scripts/testing/detox-integrated-session-baseline';

const root = path.resolve(process.cwd());
const runId = '0123456789abcdef01234567';
const reusedBinary = path.join(
  root,
  '.qa/artifacts/native-pilot',
  runId,
  'ios-build/Build/Products/Debug-iphonesimulator/mychampions.app',
);
const checkedInBinary = path.join(
  root,
  'ios/build/Build/Products/Debug-iphonesimulator/mychampions.app',
);
const localRequire = createRequire(import.meta.url);

function build(): DetoxBaselineBuildInstrumentation {
  return {
    platform: 'ios',
    configuration: 'ios.sim.debug',
    binaryPath: reusedBinary,
    binaryHash: 'a'.repeat(64),
    testBinaryPath: null,
    testBinaryHash: null,
    source: { sha: 'b'.repeat(40), dirty: true, sourceTreeHash: 'c'.repeat(64) },
    helperInputPaths: [...detoxSessionHelperClosure],
    helperInputsHash: 'd'.repeat(64),
    detoxConfigPath: path.join(root, '.detoxrc.js'),
    detoxConfigHash: 'e'.repeat(64),
    metroPort: 41003,
    appIdentifier: 'com.edufelip.mychampions.dev',
    embeddedRuntime: {
      variant: 'dev',
      appIdentifier: 'com.edufelip.mychampions.dev',
      apiOrigin: 'http://127.0.0.1:41001',
      configSourcePath: path.join(root, 'app.config.ts'),
      configSourceHash: 'f'.repeat(64),
    },
    binaryReuse: {
      kind: 'qualified-ios-build-reuse',
      runId,
      binaryPath: reusedBinary,
      binaryHash: 'a'.repeat(64),
      binaryIdentity: {
        dev: 1,
        ino: 2,
        uid: typeof process.getuid === 'function' ? process.getuid() : 501,
        gid: 3,
        mode: 0o755,
        nlink: 2,
        size: 4,
        mtimeMs: 5,
        ctimeMs: 6,
      },
      checkedInBinaryPath: checkedInBinary,
    },
  };
}

void test('qualified reuse keeps the checked-in profile while accepting its exact artifact path', () => {
  const value = build();
  assert.equal(requireDetoxBuildInstrumentation(value, root), value);
  const environment = buildDetoxVerifiedBinaryEnvironment(value);
  assert.equal(environment.DETOX_IOS_VERIFIED_BINARY_PATH, reusedBinary);
  assert.equal(environment.DETOX_IOS_VERIFIED_BINARY_PROFILE_PATH, checkedInBinary);
  assert.equal(environment.DETOX_IOS_VERIFIED_BINARY_RUN_ID, runId);
  assert.equal(environment.DETOX_IOS_VERIFIED_BINARY_HASH, 'a'.repeat(64));
  assert.equal(typeof environment.DETOX_IOS_VERIFIED_BINARY_IDENTITY, 'string');
});

void test('iOS reuse accepts an owned OS-assigned Metro port through 65535', () => {
  const value = build();
  assert.equal(
    requireDetoxBuildInstrumentation({ ...value, metroPort: 51339 }, root).metroPort,
    51339,
  );
  assert.throws(
    () => requireDetoxBuildInstrumentation({ ...value, metroPort: 65536 }, root),
    /outside the owned range/,
  );
});

void test('Android reuse retains its 49151 Metro-port ceiling', () => {
  const value: DetoxBaselineBuildInstrumentation = {
    ...build(),
    platform: 'android',
    configuration: 'android.emu.debug',
    binaryPath: path.join(root, 'android/app/build/outputs/apk/dev/debug/app-dev-debug.apk'),
    testBinaryPath: path.join(
      root,
      'android/app/build/outputs/apk/androidTest/dev/debug/app-dev-debug-androidTest.apk',
    ),
    testBinaryHash: 'f'.repeat(64),
    binaryReuse: undefined,
  };
  assert.equal(
    requireDetoxBuildInstrumentation({ ...value, metroPort: 49151 }, root).metroPort,
    49151,
  );
  assert.throws(
    () => requireDetoxBuildInstrumentation({ ...value, metroPort: 51339 }, root),
    /outside the owned range/,
  );
});

void test('reuse rejects arbitrary paths, stale run binding and unqualified external paths', () => {
  const value = build();
  assert.throws(
    () => requireDetoxBuildInstrumentation({ ...value, binaryReuse: undefined }, root),
    /checked-in debug profile/,
  );
  assert.throws(
    () =>
      requireDetoxBuildInstrumentation(
        {
          ...value,
          binaryPath: path.join(root, '.qa/artifacts/native-pilot', 'f'.repeat(24), 'app.app'),
          binaryReuse: {
            ...value.binaryReuse!,
            binaryPath: path.join(root, '.qa/artifacts/native-pilot', 'f'.repeat(24), 'app.app'),
          },
        },
        root,
      ),
    /outside the qualified artifact run/,
  );
  assert.throws(
    () =>
      requireDetoxBuildInstrumentation(
        {
          ...value,
          binaryReuse: { ...value.binaryReuse!, checkedInBinaryPath: path.join(root, 'other.app') },
        },
        root,
      ),
    /checked-in debug profile/,
  );
});

void test('driver clears inherited reuse overrides for an ordinary checked-in build', () => {
  const value = build();
  const ordinary: DetoxBaselineBuildInstrumentation = {
    ...value,
    binaryPath: checkedInBinary,
    binaryReuse: undefined,
  };
  const environment = buildDetoxVerifiedBinaryEnvironment(ordinary);
  assert.equal(environment.DETOX_IOS_VERIFIED_BINARY_PATH, undefined);
  assert.equal(environment.DETOX_IOS_VERIFIED_BINARY_IDENTITY, undefined);
});

void test('Detox config consumes only the complete verified reuse environment', () => {
  const configPath = path.join(root, '.detoxrc.js');
  const previous = {
    path: process.env.DETOX_IOS_VERIFIED_BINARY_PATH,
    hash: process.env.DETOX_IOS_VERIFIED_BINARY_HASH,
    runId: process.env.DETOX_IOS_VERIFIED_BINARY_RUN_ID,
    profile: process.env.DETOX_IOS_VERIFIED_BINARY_PROFILE_PATH,
    identity: process.env.DETOX_IOS_VERIFIED_BINARY_IDENTITY,
  };
  const restore = () => {
    const values = {
      DETOX_IOS_VERIFIED_BINARY_PATH: previous.path,
      DETOX_IOS_VERIFIED_BINARY_HASH: previous.hash,
      DETOX_IOS_VERIFIED_BINARY_RUN_ID: previous.runId,
      DETOX_IOS_VERIFIED_BINARY_PROFILE_PATH: previous.profile,
      DETOX_IOS_VERIFIED_BINARY_IDENTITY: previous.identity,
    };
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete localRequire.cache[localRequire.resolve(configPath)];
  };
  try {
    const value = build();
    const environment = buildDetoxVerifiedBinaryEnvironment(value);
    for (const [key, envValue] of Object.entries(environment)) {
      if (envValue === undefined) delete process.env[key];
      else process.env[key] = envValue;
    }
    delete localRequire.cache[localRequire.resolve(configPath)];
    const config = localRequire(configPath) as {
      apps: { 'ios.debug': { binaryPath: string } };
    };
    assert.equal(config.apps['ios.debug'].binaryPath, reusedBinary);
    process.env.DETOX_IOS_VERIFIED_BINARY_PATH = path.join(root, 'other.app');
    delete localRequire.cache[localRequire.resolve(configPath)];
    assert.throws(() => localRequire(configPath), /qualified artifact path/);
    process.env.DETOX_IOS_VERIFIED_BINARY_PATH = reusedBinary;
    process.env.DETOX_IOS_VERIFIED_BINARY_IDENTITY = '{}';
    delete localRequire.cache[localRequire.resolve(configPath)];
    assert.throws(() => localRequire(configPath), /IDENTITY is incomplete/);
  } finally {
    restore();
  }
});
