import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AndroidSessionStorageQueryError,
  buildDetoxAndroidStorageCommandHash,
  readDetoxAndroidSessionStorageCheckpoint,
  type DetoxAndroidSessionStorageTarget,
  type DetoxAndroidSessionStorageBinding,
  type DetoxAndroidOwnedCommandExecution,
  type DetoxAndroidSessionStoragePhase,
} from '../../scripts/testing/detox-android-session-storage-producer';
import { ownedDetoxBaselineFactories } from '../../scripts/testing/detox-integrated-session-baseline';
import type { NativeCommandExecution } from '../../scripts/testing/owned-native-command';

const presentQuery = JSON.stringify([
  {
    jsonValid: 1,
    profileType: 'object',
    profileAuthUid: 'coach-1',
    expiryType: 'text',
    accessTokenType: null,
    refreshTokenType: null,
    recordBytes: 192,
  },
]);
const presentXml =
  '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n' +
  '<map><string name="key_v1-secure.auth.server.session">encrypted-value</string></map>\n';

const binding: DetoxAndroidSessionStorageBinding = {
  runId: '0123456789abcdef01234567',
  scope: 'native-entry-android',
  apiOrigin: 'http://127.0.0.1:43123',
  apiPid: 9000,
  backendAttemptId: '0123456789abcdef01234567:first',
  manifestSha256: 'a'.repeat(64),
  fixtureAuthUidAllowlistHash: 'b'.repeat(64),
  waitForQuiescence: () => Promise.resolve(),
};

async function execution(
  input: {
    artifactRoot: string;
    label: string;
    kind: 'adb' | 'sqlite';
    argv: readonly string[];
    stdoutPath: string;
    target: { serial: string; adbServerPort: number };
    binding: Omit<DetoxAndroidSessionStorageBinding, 'waitForQuiescence'>;
  },
  cleanup: NativeCommandExecution['cleanup'] = 'cleaned',
): Promise<DetoxAndroidOwnedCommandExecution> {
  const command =
    input.kind === 'sqlite' ? '/usr/bin/sqlite3' : '/opt/android-sdk/platform-tools/adb';
  const argv =
    input.kind === 'sqlite'
      ? [...input.argv]
      : [
          '-H',
          '127.0.0.1',
          '-P',
          String(input.target.adbServerPort),
          '-s',
          input.target.serial,
          ...input.argv,
        ];
  const cwd = process.cwd();
  const ownershipPath = path.join(input.artifactRoot, input.label + '.ownership.json');
  const logPath = path.join(input.artifactRoot, input.label + '.log');
  const processCommandHash = 'c'.repeat(64);
  await writeFile(logPath, '', { flag: 'wx', mode: 0o600 });
  await writeFile(
    ownershipPath,
    JSON.stringify({
      kind: 'private worker process ownership',
      pid: 9001,
      pgid: 9001,
      processes: [
        { pid: 9001, pgid: 9001, started: 'started-9001', commandHash: processCommandHash },
      ],
      cleanup,
    }),
    { flag: 'wx', mode: 0o600 },
  );
  return {
    phase: 'step',
    execution: 'completed',
    cleanup,
    childExitCode: 0,
    childSignal: null,
    pid: 9001,
    pgid: 9001,
    logPath,
    stdoutPath: input.stdoutPath,
    ownershipPath,
    elapsedMs: 1,
    cleanupMs: 1,
    command,
    argv,
    cwd,
    deadlineMs: 60_000,
    commandHash: buildDetoxAndroidStorageCommandHash({
      command,
      argv,
      cwd,
      deadlineMs: 60_000,
      phase: 'step',
      target: input.target,
      binding: {
        runId: input.binding.runId,
        scope: input.binding.scope,
        apiOrigin: input.binding.apiOrigin,
        apiPid: input.binding.apiPid,
        backendAttemptId: input.binding.backendAttemptId,
        manifestSha256: input.binding.manifestSha256,
        fixtureAuthUidAllowlistHash: input.binding.fixtureAuthUidAllowlistHash,
      },
    }),
    target: input.target,
    binding: {
      runId: input.binding.runId,
      scope: input.binding.scope,
      apiOrigin: input.binding.apiOrigin,
      apiPid: input.binding.apiPid,
      backendAttemptId: input.binding.backendAttemptId,
      manifestSha256: input.binding.manifestSha256,
      fixtureAuthUidAllowlistHash: input.binding.fixtureAuthUidAllowlistHash,
    },
  };
}

async function privateRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-android-storage-'));
  await chmod(root, 0o700);
  return realpath(root);
}

function targetFactory(options?: {
  absent?: boolean;
  noDatabases?: boolean;
  changedAfterListing?: boolean;
  failedCleanup?: boolean;
  missingOwnership?: boolean;
  forgedCommand?: boolean;
  queryCleanupFailure?: boolean;
  query?: string;
}) {
  const calls: { kind: 'adb' | 'sqlite'; label: string; argv: readonly string[] }[] = [];
  let verifyCalls = 0;
  let quiescenceCalls = 0;
  let databaseListingReads = 0;
  const targetBinding: DetoxAndroidSessionStorageBinding = {
    ...binding,
    waitForQuiescence: () => {
      quiescenceCalls += 1;
      return Promise.resolve();
    },
  };
  const target: DetoxAndroidSessionStorageTarget = {
    appId: 'com.edufelip.mychampions.dev',
    serial: 'emulator-5554',
    adbServerPort: 32123,
    verify: () => {
      verifyCalls += 1;
      return Promise.resolve();
    },
    runAdb: async (input) => {
      calls.push({ kind: 'adb', label: input.label, argv: input.argv });
      if (!input.stdoutPath) throw new Error('adb test command requires stdout');
      if (options?.failedCleanup)
        return execution(
          {
            artifactRoot: input.artifactRoot,
            label: input.label,
            kind: 'adb',
            argv: input.argv,
            stdoutPath: input.stdoutPath,
            target: input.target,
            binding: input.binding,
          },
          'failed-recovery-ledger-retained',
        );
      let bytes = Buffer.from('');
      if (input.label.endsWith('-quiesce')) {
        bytes = Buffer.from('');
      } else if (input.label.endsWith('-app-directory')) {
        bytes = Buffer.from(
          options?.noDatabases ? 'cache\nshared_prefs\n' : 'cache\ndatabases\nshared_prefs\n',
        );
      } else if (input.label.endsWith('-async-directory')) {
        databaseListingReads += 1;
        bytes = Buffer.from(
          options?.changedAfterListing && databaseListingReads === 2
            ? 'RKStorage\nRKStorage-wal\n'
            : 'RKStorage\n',
        );
      } else if (input.label.endsWith('-async-directory-after')) {
        databaseListingReads += 1;
        bytes = Buffer.from(
          options?.changedAfterListing ? 'RKStorage\nRKStorage-wal\n' : 'RKStorage\n',
        );
      } else if (input.label.endsWith('-rkstorage-capture')) {
        bytes = Buffer.from('sqlite database bytes');
      } else if (input.label.endsWith('-secure-presence')) {
        bytes = Buffer.from(options?.absent ? 'unrelated.xml\n' : 'SecureStore.xml\n');
      } else if (input.label.endsWith('-secure-capture')) {
        bytes = Buffer.from(presentXml);
      } else {
        throw new Error(`unexpected captured stdout label: ${input.label}`);
      }
      await writeFile(input.stdoutPath, bytes, { flag: 'wx', mode: 0o600 });
      const result = await execution({
        artifactRoot: input.artifactRoot,
        label: input.label,
        kind: 'adb',
        argv: input.argv,
        stdoutPath: input.stdoutPath,
        target: input.target,
        binding: input.binding,
      });
      if (options?.missingOwnership) return { ...result, ownershipPath: null };
      if (options?.forgedCommand) {
        const command = '/tmp/forged-adb';
        return {
          ...result,
          command,
          commandHash: buildDetoxAndroidStorageCommandHash({
            command,
            argv: result.argv,
            cwd: result.cwd,
            deadlineMs: result.deadlineMs,
            phase: result.phase,
            target: result.target,
            binding: result.binding,
          }),
        };
      }
      return result;
    },
    runHostSqlite: async (input) => {
      calls.push({ kind: 'sqlite', label: input.label, argv: input.argv });
      if (options?.failedCleanup)
        return execution(
          {
            artifactRoot: input.artifactRoot,
            label: input.label,
            kind: 'sqlite',
            argv: input.argv,
            stdoutPath: input.stdoutPath!,
            target: input.target,
            binding: input.binding,
          },
          'failed-recovery-ledger-retained',
        );
      if (!input.stdoutPath) throw new Error('sqlite test command requires stdout');
      await writeFile(
        input.stdoutPath,
        options?.query ?? (options?.absent ? '[]\n' : presentQuery),
        {
          flag: 'wx',
          mode: 0o600,
        },
      );
      const result = await execution({
        artifactRoot: input.artifactRoot,
        label: input.label,
        kind: 'sqlite',
        argv: input.argv,
        stdoutPath: input.stdoutPath,
        target: input.target,
        binding: input.binding,
      });
      if (options?.missingOwnership) return { ...result, ownershipPath: null };
      if (options?.forgedCommand) {
        const command = '/tmp/forged-sqlite';
        return {
          ...result,
          command,
          commandHash: buildDetoxAndroidStorageCommandHash({
            command,
            argv: result.argv,
            cwd: result.cwd,
            deadlineMs: result.deadlineMs,
            phase: result.phase,
            target: result.target,
            binding: result.binding,
          }),
        };
      }
      return result;
    },
  };
  return {
    target,
    calls,
    binding: targetBinding,
    get verifyCalls() {
      return verifyCalls;
    },
    get quiescenceCalls() {
      return quiescenceCalls;
    },
  };
}

async function run(
  options: Parameters<typeof targetFactory>[0] | undefined,
  checkpoint: 'afterLogin' | 'afterSignout',
  actorAuthUid: string | undefined,
  phase?: DetoxAndroidSessionStoragePhase,
) {
  const artifactRoot = await privateRoot();
  const target = targetFactory(options);
  try {
    const result = await readDetoxAndroidSessionStorageCheckpoint({
      checkpoint,
      artifactRoot,
      target: target.target,
      binding: target.binding,
      actorAuthUid,
      phase,
      signal: new AbortController().signal,
      removeRawQuery: options?.queryCleanupFailure
        ? () => Promise.reject(new Error('injected query cleanup failure'))
        : undefined,
    });
    return {
      result,
      calls: target.calls,
      verifyCalls: target.verifyCalls,
      quiescenceCalls: target.quiescenceCalls,
      artifactRoot,
    };
  } catch (error) {
    await rm(artifactRoot, { recursive: true, force: true });
    throw error;
  }
}

void test('reads a present checkpoint through fixed adb/sqlite commands and binds coach identity', async () => {
  const { result, calls, artifactRoot, verifyCalls, quiescenceCalls } = await run(
    undefined,
    'afterLogin',
    'coach-1',
  );
  try {
    assert.equal(result.status, 'session-present');
    assert.equal(result.asyncStorage.profileAuthUidHash?.length, 64);
    assert.equal(calls[0]?.label, 'auth-before-relaunch-quiesce');
    assert.equal(calls.at(-1)?.label, 'auth-before-relaunch-secure-capture');
    assert.equal(calls.filter((call) => call.kind === 'sqlite').length, 1);
    assert(verifyCalls >= calls.filter((call) => call.kind === 'adb').length);
    assert(quiescenceCalls >= calls.length);
    assert(calls.every((call) => !call.argv.includes('sh') && !call.argv.includes('-c')));
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('reads a signed-out checkpoint without retaining a profile identity', async () => {
  const { result, artifactRoot } = await run({ absent: true }, 'afterSignout', undefined);
  try {
    assert.equal(result.status, 'session-absent');
    assert.equal(result.asyncStorage.profileAuthUidHash, null);
    assert.equal(result.secureStore.sessionEntryPresent, false);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('records the explicit before-login adapter phase separately from the cache label', async () => {
  const { calls, artifactRoot } = await run(
    { absent: true },
    'afterSignout',
    undefined,
    'before-login',
  );
  try {
    assert.equal(calls[0]?.label, 'auth-before-login-quiesce');
    assert(calls.some((call) => call.label === 'auth-before-login-async-query'));
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('records a fresh-install before-login checkpoint as an absent database', async () => {
  const { calls, artifactRoot, result } = await run(
    { absent: true, noDatabases: true },
    'afterSignout',
    undefined,
    'before-login',
  );
  try {
    assert(calls.some((call) => call.label === 'auth-before-login-app-directory'));
    assert(!calls.some((call) => call.label === 'auth-before-login-async-directory'));
    assert(!calls.some((call) => call.label === 'auth-before-login-async-query'));
    assert.equal(result.status, 'session-absent');
    assert.equal(result.asyncStorage.database, 'absent');
    assert.equal(result.privateArtifacts.database, null);
    assert.equal(result.privateArtifacts.query, null);
    assert.match(result.privateArtifacts.databaseListing.path, /app-directory\.stdout$/);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('rejects a changed database listing before publishing a checkpoint', async () => {
  await assert.rejects(
    run({ changedAfterListing: true }, 'afterLogin', 'coach-1'),
    /database changed during capture/,
  );
});

void test('rejects a command with failed cleanup even when its child exit is zero', async () => {
  await assert.rejects(
    run({ failedCleanup: true }, 'afterLogin', 'coach-1'),
    /did not complete cleanly/,
  );
});

void test('rejects a clean callback without an ownership ledger', async () => {
  await assert.rejects(
    run({ missingOwnership: true }, 'afterLogin', 'coach-1'),
    /private receipts are incomplete/,
  );
});

void test('rejects a forged tool path even when the command callback is otherwise clean', async () => {
  await assert.rejects(
    run({ forgedCommand: true }, 'afterLogin', 'coach-1'),
    /tool path is not pinned/,
  );
});

void test('retains an injected sqlite cleanup failure separately from query evidence', async () => {
  await assert.rejects(
    run({ queryCleanupFailure: true }, 'afterLogin', 'coach-1'),
    (error: unknown) => {
      assert(error instanceof AndroidSessionStorageQueryError);
      assert.equal(error.queryFailure, null);
      assert(error.queryCleanupFailure instanceof Error);
      return true;
    },
  );
});

void test('rejects a persisted profile bound to another actor', async () => {
  await assert.rejects(
    run(undefined, 'afterLogin', 'student-1'),
    /does not match the authenticated actor/,
  );
});

void test('does not dispatch any adb command after cancellation', async () => {
  const artifactRoot = await privateRoot();
  const target = targetFactory();
  const controller = new AbortController();
  controller.abort('test');
  try {
    await assert.rejects(
      readDetoxAndroidSessionStorageCheckpoint({
        checkpoint: 'afterLogin',
        artifactRoot,
        target: target.target,
        binding: target.binding,
        actorAuthUid: 'coach-1',
        signal: controller.signal,
      }),
    );
    assert.deepEqual(target.calls, []);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('baseline factory delegates to the owned Android producer and rejects a target without it', async () => {
  const artifactRoot = await privateRoot();
  const runtime = targetFactory();
  const target = {
    platform: 'android' as const,
    deviceId: runtime.target.serial,
    ownership: {
      artifactRoot,
      hostLockRequired: true as const,
      cleanupAuthorized: true as const,
    },
    verify: runtime.target.verify,
    stop: () => Promise.resolve(),
    androidSessionStorage: runtime.target,
  };
  try {
    const reader = ownedDetoxBaselineFactories.readAndroidSessionStorageCheckpoint;
    assert(reader);
    const checkpoint = await reader({
      checkpoint: 'afterLogin',
      artifactRoot,
      target,
      binding: runtime.binding,
      actorAuthUid: 'coach-1',
      signal: new AbortController().signal,
    });
    assert.equal(checkpoint.status, 'session-present');
    await assert.rejects(
      reader({
        checkpoint: 'afterLogin',
        artifactRoot,
        target: { ...target, androidSessionStorage: undefined },
        binding: runtime.binding,
        actorAuthUid: 'coach-1',
        signal: new AbortController().signal,
      }),
      /owned Android target runtime/,
    );
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
