import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  buildDetoxAndroidStorageCommandHash,
  type DetoxAndroidOwnedCommandExecution,
  type DetoxAndroidSessionStorageTarget,
} from '../../scripts/testing/detox-android-session-storage-producer';
import { produceAndroidColdReset } from '../../scripts/testing/t15-cold-android-reset-producer';
import type { ColdResetPreparationExpectation } from '../../scripts/testing/t15-cold-ios-reset-producer';

const requestedRunId = 'a'.repeat(24);
const captureRunId = 'b'.repeat(24);
const backendRunId = 'c'.repeat(24);
const ownerRunId = 'd'.repeat(24);
const HASH = 'e'.repeat(64);
const startedAt = '2026-10-05T06:00:00.000Z';
const appId = 'com.edufelip.mychampions.dev';

function expectation(fixtureResetId = 'fixture-reset-a'): ColdResetPreparationExpectation {
  return {
    requestedRunId,
    requestedAttemptId: `${requestedRunId}:first`,
    fixtureResetId,
    cohortFixtureFingerprint: HASH,
    sourceFingerprint: HASH,
    helperFingerprint: HASH,
  };
}

function commandRows() {
  return [
    'android-install',
    'android-installed-build',
    'android-reverse-metro',
    'android-reverse-api',
    'android-prefs-directory',
    'android-metro-prefs',
  ].map((label, index) => ({
    label,
    execution: 'completed',
    cleanup: 'cleaned',
    pid: 7000 + index,
    pgid: 7000 + index,
    commandHash: HASH,
    ownerRunId,
  }));
}

async function makeContext(root: string) {
  const outputRoot = path.join(root, captureRunId);
  await mkdir(outputRoot, { mode: 0o700 });
  const backendRoot = path.join(root, 'backend');
  await mkdir(backendRoot, { mode: 0o700 });
  const installedBytes = Buffer.alloc(128, 0x61);
  const installedHash = createHash('sha256').update(installedBytes).digest('hex');
  const installedPath = path.join(outputRoot, 'installed-base.apk');
  await writeFile(installedPath, installedBytes, { flag: 'wx', mode: 0o600 });
  const storageCalls: {
    argv: readonly string[];
    binding: Record<string, unknown>;
  }[] = [];
  const storage: DetoxAndroidSessionStorageTarget = {
    appId,
    serial: 'emulator-5554',
    adbServerPort: 5037,
    verify: () => Promise.resolve(),
    runHostSqlite: () =>
      Promise.resolve().then(() => {
        throw new Error('host sqlite is forbidden for the Android reset action');
      }),
    runAdb: async (input) => {
      storageCalls.push({ argv: input.argv, binding: input.binding });
      const command = '/opt/android-sdk/platform-tools/adb';
      const argv = [
        '-H',
        '127.0.0.1',
        '-P',
        String(input.target.adbServerPort),
        '-s',
        input.target.serial,
        ...input.argv,
      ];
      const binding = {
        runId: input.binding.runId,
        scope: input.binding.scope,
        apiOrigin: input.binding.apiOrigin,
        apiPid: input.binding.apiPid,
        backendAttemptId: input.binding.backendAttemptId,
        manifestSha256: input.binding.manifestSha256,
        fixtureAuthUidAllowlistHash: input.binding.fixtureAuthUidAllowlistHash,
      };
      const execution: DetoxAndroidOwnedCommandExecution = {
        phase: 'step',
        execution: 'completed',
        cleanup: 'cleaned',
        childExitCode: 0,
        childSignal: null,
        pid: 8101,
        pgid: 8102,
        logPath: path.join(input.artifactRoot, 'android-reset-app-state.log'),
        stdoutPath:
          input.stdoutPath ?? path.join(input.artifactRoot, 'android-reset-app-state.stdout'),
        ownershipPath: path.join(input.artifactRoot, 'android-reset-app-state.ownership.json'),
        elapsedMs: 2,
        cleanupMs: 1,
        censusFailure: null,
        outputFailure: null,
        command,
        argv,
        cwd: '/private/tmp',
        deadlineMs: input.deadlineMs,
        commandHash: buildDetoxAndroidStorageCommandHash({
          command,
          argv,
          cwd: '/private/tmp',
          deadlineMs: input.deadlineMs,
          phase: 'step',
          target: input.target,
          binding,
        }),
        target: input.target,
        binding,
      };
      await writeFile(execution.stdoutPath!, 'Success\n', {
        flag: 'wx',
        mode: 0o600,
      });
      await writeFile(execution.logPath!, 'owned pm clear\n', {
        flag: 'wx',
        mode: 0o600,
      });
      await writeFile(
        execution.ownershipPath!,
        JSON.stringify({
          kind: 'private worker process ownership',
          cleanup: 'cleaned',
          pid: execution.pgid,
          pgid: execution.pgid,
          processes: [
            {
              pid: execution.pid,
              pgid: execution.pgid,
              started: startedAt,
              commandHash: execution.commandHash,
            },
          ],
        }),
        { flag: 'wx', mode: 0o600 },
      );
      return execution;
    },
  };
  const context = {
    expectation: expectation(),
    outputRoot,
    captureRunId,
    ownerRunId,
    resetStartedAt: startedAt,
    target: {
      identity: { serial: storage.serial },
      osVersion: 'Android 37',
      runId: 'e'.repeat(24),
      verify: () => Promise.resolve(),
      androidSessionStorage: storage,
    },
    session: {
      manifest: {
        runId: backendRunId,
        artifactRoot: backendRoot,
        composeProject: 'mychampions-test',
        processes: [
          {
            role: 'api',
            pid: 8200,
            startedAt,
            script: 'server/src/app.ts',
            ownerRunId: backendRunId,
          },
        ],
      },
      apiOrigin: 'http://127.0.0.1:41001/',
      apiPid: 8200,
      probeApiLifetime: () =>
        Promise.resolve({
          runId: backendRunId,
          apiOrigin: 'http://127.0.0.1:41001/',
          apiPid: 8200,
          apiStarted: startedAt,
          apiScript: 'server/src/app.ts',
          backendAttemptId: `${backendRunId}:first`,
          manifestSha256: HASH,
        }),
      snapshotWithEvidence: () =>
        Promise.resolve({
          value: {
            runId: backendRunId,
            scope: 'native-entry-android',
            state: 'unchanged',
          },
          receipt: {
            runId: backendRunId,
            scope: 'native-entry-android',
            apiPid: 8200,
          },
        }),
    },
    proxy: {
      runId: backendRunId,
      origin: 'http://127.0.0.1:41002/',
      waitForQuiescence: () => Promise.resolve({ active: 0, outbound: 0 }),
    },
    proxyProcess: {
      pid: process.pid,
      started: startedAt,
      script: process.argv[0],
    },
    fixtures: {
      runId: backendRunId,
      scope: 'native-entry-android',
      resetId: 'fixture-reset-a',
      accounts: {
        coach: { authUid: 'coach-auth-uid' },
        student: { authUid: 'student-auth-uid' },
      },
    },
    build: {
      appId,
      buildProfile: 'android.emu.debug',
      binaryHash: installedHash,
      apiOrigin: 'http://127.0.0.1:41002/',
    },
    installedApk: {
      path: installedPath,
      sha256: installedHash,
      sizeBytes: installedBytes.length,
    },
    commandExecutions: commandRows(),
    signal: new AbortController().signal,
    now: () => '2026-10-05T06:00:01.000Z',
  };
  return { context, storageCalls };
}

void test('executes and receipts the same owned Android pm clear action with build identity', async () => {
  const root = await mkdtemp('/private/tmp/t15-android-reset-producer-');
  await chmod(root, 0o700);
  try {
    const { context, storageCalls } = await makeContext(root);
    const result = await produceAndroidColdReset(context);
    assert.equal(storageCalls.length, 1);
    assert.deepEqual(storageCalls[0].argv, ['shell', 'pm', 'clear', appId]);
    const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8')) as {
      target: { buildProfile: string };
      appState: {
        resetOutcome: string;
        resetAction: {
          label: string;
          argv: string[];
          binding: { runId: string };
          target: { serial: string };
        };
      };
      buildProfile?: unknown;
    };
    assert.equal(receipt.target.buildProfile, 'android.emu.debug');
    assert.equal(receipt.appState.resetOutcome, 'Success');
    assert.equal(receipt.appState.resetAction.label, 'android-reset-app-state');
    assert.deepEqual(receipt.appState.resetAction.argv.slice(-4), ['shell', 'pm', 'clear', appId]);
    assert.equal(receipt.appState.resetAction.binding.runId, backendRunId);
    assert.equal(receipt.appState.resetAction.target.serial, 'emulator-5554');
    assert.equal(receipt.buildProfile, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('fails closed when the owned pm clear action does not report Success', async () => {
  const root = await mkdtemp('/private/tmp/t15-android-reset-producer-fail-');
  await chmod(root, 0o700);
  try {
    const { context } = await makeContext(root);
    const storage = context.target.androidSessionStorage;
    context.target.androidSessionStorage = {
      ...storage,
      runAdb: async (input) => {
        const execution = await storage.runAdb(input);
        await writeFile(execution.stdoutPath!, 'Failure [not cleared]\n', {
          flag: 'w',
          mode: 0o600,
        });
        return execution;
      },
    };
    await assert.rejects(() => produceAndroidColdReset(context), /pm clear Success/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
