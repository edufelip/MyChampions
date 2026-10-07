import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  prepareAndroidDetoxQualifiedBuild,
  requireAndroidDetoxBuildDescriptor,
} from '../../scripts/testing/detox-android-qualified-build';
import { buildDetoxVerifiedBinaryEnvironment } from '../../scripts/testing/detox-integrated-connection-driver';
import {
  detoxAndroidBuildInputClosure,
  type DetoxBaselineBuildInstrumentation,
} from '../../scripts/testing/detox-integrated-session-baseline';

const runId = 'a'.repeat(24);

void test('Android qualified build closure binds the camera owner runtime', () => {
  assert(
    detoxAndroidBuildInputClosure.includes(
      'scripts/testing/native-detox-camera-android-owned-session.ts',
    ),
  );
  for (const path of [
    'android/app/src/androidTest/java/com/eduardo880/mychampions/DetoxTest.java',
    'android/app/src/androidTest/java/com/edufelip/mychampions/DetoxCameraPermissionBridge.java',
    'e2e/detox-android-camera-denied.e2e.test.js',
    'e2e/jest.detox-integrated-connection-baseline.config.js',
  ])
    assert(detoxAndroidBuildInputClosure.includes(path as never), `missing build input: ${path}`);
});

void test('Android qualified build preparation is abort-fenced before toolchain acquisition', async () => {
  const controller = new AbortController();
  controller.abort(new Error('test cancellation'));
  let called = false;
  await assert.rejects(
    prepareAndroidDetoxQualifiedBuild({
      repositoryRoot: process.cwd(),
      artifactRoot: path.join(process.cwd(), '.qa/artifacts/native-pilot', runId),
      buildRunId: runId,
      apiOrigin: 'http://127.0.0.1:18080',
      metroPort: 18081,
      signal: controller.signal,
      deadlineMs: 30_000,
      resolveToolchain: () => {
        called = true;
        return Promise.reject(new Error('toolchain must not be acquired after cancellation'));
      },
    }),
    /test cancellation|aborted|AbortError/,
  );
  assert.equal(called, false);
});

void test('Android descriptor rejects a producer receipt outside its qualified run', () => {
  assert.throws(
    () =>
      requireAndroidDetoxBuildDescriptor(
        {
          kind: 'private-qualified-android-detox-build-not-public-receipt',
          buildRunId: runId,
          producerReceiptPath: '/tmp/foreign-receipt.json',
          producerReceiptHash: 'b'.repeat(64),
          build: {},
        },
        process.cwd(),
      ),
    /receipt path|receipt/i,
  );
});

void test('Android build producer retains a failed owned command and refuses publication', async () => {
  const failedRunId = 'b'.repeat(24);
  const artifactRoot = path.join(process.cwd(), '.qa/artifacts/native-pilot', failedRunId);
  let commandCalls = 0;
  try {
    await assert.rejects(
      prepareAndroidDetoxQualifiedBuild({
        repositoryRoot: process.cwd(),
        artifactRoot,
        buildRunId: failedRunId,
        apiOrigin: 'http://127.0.0.1:18080',
        metroPort: 18081,
        signal: new AbortController().signal,
        deadlineMs: 30_000,
        resolveToolchain: () => Promise.resolve({ sdkRoot: '/sdk', javaHome: '/java' }),
        runCommand: () => {
          commandCalls++;
          return Promise.resolve({
            phase: 'build' as const,
            execution: 'child-failed' as const,
            cleanup: 'cleaned' as const,
            childExitCode: 1,
            childSignal: null,
            pid: 12,
            pgid: 12,
            logPath: null,
            stdoutPath: null,
            ownershipPath: null,
            elapsedMs: 1,
            cleanupMs: 1,
            censusFailure: null,
            outputFailure: null,
          });
        },
      }),
      /did not complete|exited unsuccessfully/,
    );
    assert.equal(commandCalls, 1);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('Android qualified build sets the app isolated output before app project evaluation', async () => {
  const isolatedRunId = 'c'.repeat(24);
  const artifactRoot = path.join(process.cwd(), '.qa/artifacts/native-pilot', isolatedRunId);
  let initScript = '';
  let commandEnvironment: NodeJS.ProcessEnv | undefined;
  try {
    await assert.rejects(
      prepareAndroidDetoxQualifiedBuild({
        repositoryRoot: process.cwd(),
        artifactRoot,
        buildRunId: isolatedRunId,
        apiOrigin: 'http://127.0.0.1:18080',
        metroPort: 18081,
        signal: new AbortController().signal,
        deadlineMs: 30_000,
        resolveToolchain: () => Promise.resolve({ sdkRoot: '/sdk', javaHome: '/java' }),
        runCommand: async (options) => {
          commandEnvironment = options.env;
          const initIndex = options.argv.indexOf('-I');
          initScript = await readFile(options.argv[initIndex + 1], 'utf8');
          return {
            phase: 'build',
            execution: 'child-failed',
            cleanup: 'cleaned',
            childExitCode: 1,
            childSignal: null,
            pid: 12,
            pgid: 12,
            logPath: null,
            stdoutPath: null,
            ownershipPath: null,
            elapsedMs: 1,
            cleanupMs: 1,
            censusFailure: null,
            outputFailure: null,
          };
        },
      }),
      /did not complete|exited unsuccessfully/,
    );
    assert.match(initScript, /gradle\.beforeProject/u);
    assert.match(initScript, /p\.path == ':app'/u);
    assert.match(initScript, /p\.layout\.buildDirectory\.set/u);
    assert.equal(commandEnvironment?.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL, 'http://127.0.0.1:18080');
    assert.equal(commandEnvironment?.EXPO_NO_DOTENV, '1');
    assert.equal(
      commandEnvironment?.GRADLE_USER_HOME,
      path.join(process.cwd(), '.qa/artifacts/native-pilot/android-detox-gradle-user-home'),
    );
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('Android verified environment binds both APKs and clears inherited iOS overrides', () => {
  const build = {
    platform: 'android',
    binaryPath: `/repo/.qa/artifacts/native-pilot/${runId}/android-build/outputs/apk/dev/debug/app-dev-debug.apk`,
    binaryHash: 'c'.repeat(64),
    testBinaryPath: `/repo/.qa/artifacts/native-pilot/${runId}/android-build/outputs/apk/androidTest/dev/debug/app-dev-debug-androidTest.apk`,
    testBinaryHash: 'd'.repeat(64),
    binaryReuse: {
      kind: 'qualified-android-build-reuse',
      runId,
      binaryPath: `/repo/.qa/artifacts/native-pilot/${runId}/android-build/outputs/apk/dev/debug/app-dev-debug.apk`,
      binaryHash: 'c'.repeat(64),
      binaryIdentity: {},
      testBinaryPath: `/repo/.qa/artifacts/native-pilot/${runId}/android-build/outputs/apk/androidTest/dev/debug/app-dev-debug-androidTest.apk`,
      testBinaryHash: 'd'.repeat(64),
      testBinaryIdentity: {},
      checkedInBinaryPath: '/repo/android/app/build/outputs/apk/dev/debug/app-dev-debug.apk',
      checkedInTestBinaryPath:
        '/repo/android/app/build/outputs/apk/androidTest/dev/debug/app-dev-debug-androidTest.apk',
      androidBuildInputPaths: [],
      androidBuildInputsHash: 'e'.repeat(64),
      commandReceiptPath: `/repo/.qa/artifacts/native-pilot/${runId}/android-detox-build.execution.private.json`,
      commandReceiptHash: 'f'.repeat(64),
    },
  } as unknown as DetoxBaselineBuildInstrumentation;
  const env = buildDetoxVerifiedBinaryEnvironment(build);
  assert.equal(env.DETOX_IOS_VERIFIED_BINARY_PATH, undefined);
  assert.equal(env.DETOX_ANDROID_VERIFIED_BINARY_RUN_ID, runId);
  assert.equal(env.DETOX_ANDROID_VERIFIED_TEST_BINARY_HASH, 'd'.repeat(64));
});
