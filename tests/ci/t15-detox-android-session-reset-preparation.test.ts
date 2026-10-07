import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { androidMetroPreference } from '../../scripts/testing/android-build-identity';
import {
  buildDetoxAndroidStorageCommandHash,
  type DetoxAndroidOwnedCommandExecution,
  type DetoxAndroidSessionStorageBinding,
  type DetoxAndroidSessionStorageTarget,
} from '../../scripts/testing/detox-android-session-storage-producer';
import { prepareT15AndroidSessionColdReset } from '../../scripts/testing/t15-detox-android-session-reset-preparation';

const requestedRunId = 'a'.repeat(24);
const captureRunId = 'b'.repeat(24);
const ownerRunId = 'c'.repeat(24);
const targetRunId = 'd'.repeat(24);
const backendRunId = 'e'.repeat(24);
const hash = 'f'.repeat(64);
const appId = 'com.edufelip.mychampions.dev' as const;

function binding(): DetoxAndroidSessionStorageBinding {
  return {
    runId: backendRunId,
    scope: 'native-entry-android',
    apiOrigin: 'http://127.0.0.1:41001/',
    apiPid: 9100,
    backendAttemptId: `${backendRunId}:first`,
    manifestSha256: hash,
    fixtureAuthUidAllowlistHash: hash,
    waitForQuiescence: () => Promise.resolve(),
  };
}

void test('prepares Android session reset through the owned ADB ledger and binds preference input', async () => {
  const root = await mkdtemp('/private/tmp/t15-detox-session-prep-');
  await chmod(root, 0o700);
  try {
    const apk = Buffer.alloc(256, 0x61);
    const binaryPath = path.join(root, 'qualified.apk');
    await writeFile(binaryPath, apk, { mode: 0o600 });
    const binaryHash = createHash('sha256').update(apk).digest('hex');
    let preferenceXml = '';
    const labels: string[] = [];
    const storage = {
      appId,
      serial: 'emulator-5554',
      adbServerPort: 5037,
      verify: () => Promise.resolve(),
      runHostSqlite: () =>
        Promise.reject(new Error('Android reset preparation must not use host sqlite')),
      runAdb: async (
        input: Parameters<DetoxAndroidSessionStorageTarget['runAdb']>[0],
      ): Promise<DetoxAndroidOwnedCommandExecution> => {
        labels.push(input.label);
        const stdoutPath = input.stdoutPath!;
        const command = '/opt/android-sdk/platform-tools/adb';
        let output = '';
        if (input.label === 'android-install') output = 'Success\n';
        if (input.label === 'android-installed-path')
          output = 'package:/data/app/~~owner/com.edufelip.mychampions.dev/base.apk\n';
        if (input.label === 'android-installed-build') {
          await writeFile(path.join(input.artifactRoot, 'installed-base.apk'), apk, {
            flag: 'wx',
            mode: 0o600,
          });
          output = 'installed-base.apk: 1 file pulled. 1.0 MB/s (256 bytes in 0.001s)\n';
        }
        if (input.label === 'android-reverse-list')
          output = 'host-1 tcp:31333 tcp:31333\nhost-1 tcp:41002 tcp:41002\n';
        if (input.label === 'android-metro-prefs') {
          preferenceXml = input.input ?? '';
          output = preferenceXml;
        }
        if (input.label === 'android-metro-prefs-readback') output = preferenceXml;
        await writeFile(stdoutPath, output, { flag: 'wx', mode: 0o600 });
        const argv = [
          '-H',
          '127.0.0.1',
          '-P',
          String(input.target.adbServerPort),
          '-s',
          input.target.serial,
          ...input.argv,
        ];
        const execution: DetoxAndroidOwnedCommandExecution = {
          phase: 'step',
          execution: 'completed',
          cleanup: 'cleaned',
          childExitCode: 0,
          childSignal: null,
          pid: 9200 + labels.length,
          pgid: 9300 + labels.length,
          logPath: null,
          stdoutPath,
          ownershipPath: null,
          elapsedMs: 1,
          cleanupMs: 1,
          censusFailure: null,
          outputFailure: null,
          command,
          argv,
          cwd: '/private/tmp',
          deadlineMs: input.deadlineMs,
          ...(input.input !== undefined
            ? { inputSha256: createHash('sha256').update(input.input).digest('hex') }
            : {}),
          commandHash: buildDetoxAndroidStorageCommandHash({
            command,
            argv,
            cwd: '/private/tmp',
            deadlineMs: input.deadlineMs,
            ...(input.input !== undefined
              ? { inputSha256: createHash('sha256').update(input.input).digest('hex') }
              : {}),
            phase: 'step',
            target: input.target,
            binding: input.binding,
          }),
          target: input.target,
          binding: input.binding,
        };
        return execution;
      },
    };
    const preference = androidMetroPreference(appId, 31333);
    const result = await prepareT15AndroidSessionColdReset({
      artifactRoot: root,
      captureRunId,
      ownerRunId,
      target: {
        platform: 'android',
        deviceId: storage.serial,
        androidTargetRunId: targetRunId,
        androidOsVersion: 'Android 37',
        androidSessionStorage: storage,
        androidRuntimeParent: path.join(root, 'runtime'),
        androidSdkRoot: '/opt/android-sdk',
        ownership: { artifactRoot: root, hostLockRequired: true, cleanupAuthorized: true },
        verify: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      },
      appId,
      binaryPath,
      binaryHash,
      buildProfile: 'android.emu.debug',
      metroPort: 31333,
      apiOrigin: 'http://127.0.0.1:41002/',
      binding: { ...binding(), apiOrigin: 'http://127.0.0.1:41001/' },
      expectation: {
        requestedRunId,
        requestedAttemptId: `${requestedRunId}:first`,
        fixtureResetId: 'fixture-reset-a',
        cohortFixtureFingerprint: hash,
        sourceFingerprint: hash,
        helperFingerprint: hash,
      },
      deadlineMs: 60_000,
      signal: new AbortController().signal,
    });
    assert.equal(result.installedApk.sha256, binaryHash);
    assert.equal(result.preference.xml, preference.xml);
    assert.equal(preferenceXml, preference.xml);
    assert.deepEqual(labels.slice(0, 3), [
      'android-install',
      'android-installed-path',
      'android-installed-build',
    ]);
    for (const label of [
      'android-install',
      'android-installed-build',
      'android-reverse-metro',
      'android-reverse-api',
      'android-prefs-directory',
      'android-metro-prefs',
    ])
      assert.equal(labels.filter((candidate) => candidate === label).length, 1, label);
    const installed = await readFile(path.join(root, 'installed-base.apk'));
    assert.deepEqual(installed, apk);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('fails before ADB when the acquired target owner identity is missing', async () => {
  const root = await mkdtemp('/private/tmp/t15-detox-session-prep-missing-');
  await chmod(root, 0o700);
  try {
    await assert.rejects(
      () =>
        prepareT15AndroidSessionColdReset({
          artifactRoot: root,
          captureRunId,
          ownerRunId,
          target: {
            platform: 'android',
            deviceId: 'emulator-5554',
            androidSessionStorage: {
              appId,
              serial: 'emulator-5554',
              adbServerPort: 5037,
              verify: () => Promise.resolve(),
              runHostSqlite: () => Promise.reject(new Error('forbidden')),
              runAdb: () => Promise.reject(new Error('must not execute')),
            },
            ownership: { artifactRoot: root, hostLockRequired: true, cleanupAuthorized: true },
            verify: () => Promise.resolve(),
            stop: () => Promise.resolve(),
          },
          appId,
          binaryPath: path.join(root, 'qualified.apk'),
          binaryHash: hash,
          buildProfile: 'android.emu.debug',
          metroPort: 31333,
          apiOrigin: 'http://127.0.0.1:41002/',
          binding: binding(),
          expectation: {
            requestedRunId,
            requestedAttemptId: `${requestedRunId}:first`,
            fixtureResetId: 'fixture-reset-a',
            cohortFixtureFingerprint: hash,
            sourceFingerprint: hash,
            helperFingerprint: hash,
          },
          deadlineMs: 60_000,
          signal: new AbortController().signal,
        }),
      /target owner identity/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
