import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildDetoxAndroidStorageCommandHash,
  readDetoxAndroidSessionStorageCheckpoint,
  type DetoxAndroidOwnedCommandExecution,
  type DetoxAndroidSessionStorageBinding,
  type DetoxAndroidSessionStorageTarget,
} from '../../scripts/testing/detox-android-session-storage-producer';
import { projectAndroidSessionCacheCheckpoint } from '../../scripts/testing/detox-session-cache-observation';
import { requireAndroidStorageReceiptSet } from '../../scripts/testing/native-android-session-adapter';

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

async function privateRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dxr003-query-source-'));
  await chmod(root, 0o700);
  return realpath(root);
}

async function execution(input: {
  artifactRoot: string;
  kind: 'adb' | 'sqlite';
  label: string;
  argv: readonly string[];
  stdoutPath: string;
  target: { serial: string; adbServerPort: number };
  binding: Omit<DetoxAndroidSessionStorageBinding, 'waitForQuiescence'>;
}): Promise<DetoxAndroidOwnedCommandExecution> {
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
  const ownershipPath = path.join(input.artifactRoot, `${input.label}.ownership.json`);
  const logPath = path.join(input.artifactRoot, `${input.label}.log`);
  const commandHash = 'c'.repeat(64);
  await writeFile(logPath, '', { flag: 'wx', mode: 0o600 });
  await writeFile(
    ownershipPath,
    JSON.stringify({
      kind: 'private worker process ownership',
      pid: 9001,
      pgid: 9001,
      processes: [{ pid: 9001, pgid: 9001, started: 'started-9001', commandHash }],
      cleanup: 'cleaned',
    }),
    { flag: 'wx', mode: 0o600 },
  );
  return {
    phase: 'step',
    execution: 'completed',
    cleanup: 'cleaned',
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

function targetFactory(): DetoxAndroidSessionStorageTarget {
  const target = {
    serial: 'emulator-5554',
    adbServerPort: 32123,
  } as const;
  return {
    appId: 'com.edufelip.mychampions.dev',
    ...target,
    verify: () => Promise.resolve(),
    runAdb: async (input) => {
      if (!input.stdoutPath) throw new Error('DXR-003 adb output path is missing');
      const output = input.label.endsWith('-async-directory')
        ? 'RKStorage\n'
        : input.label.endsWith('-async-directory-after')
          ? 'RKStorage\n'
          : input.label.endsWith('-secure-presence')
            ? 'SecureStore.xml\n'
            : input.label.endsWith('-secure-capture')
              ? presentXml
              : input.label.includes('-RKStorage-capture')
                ? 'database-bytes'
                : '';
      await writeFile(input.stdoutPath, output, { flag: 'wx', mode: 0o600 });
      return execution({
        artifactRoot: input.artifactRoot,
        kind: 'adb',
        label: input.label,
        argv: input.argv,
        stdoutPath: input.stdoutPath,
        target,
        binding: input.binding,
      });
    },
    runHostSqlite: async (input) => {
      if (!input.stdoutPath) throw new Error('DXR-003 sqlite output path is missing');
      await writeFile(input.stdoutPath, presentQuery, { flag: 'wx', mode: 0o600 });
      return execution({
        artifactRoot: input.artifactRoot,
        kind: 'sqlite',
        label: input.label,
        argv: input.argv,
        stdoutPath: input.stdoutPath,
        target,
        binding: input.binding,
      });
    },
  };
}

async function produce() {
  const artifactRoot = await privateRoot();
  const target = targetFactory();
  const result = await readDetoxAndroidSessionStorageCheckpoint({
    checkpoint: 'afterLogin',
    artifactRoot,
    target,
    binding,
    actorAuthUid: 'coach-1',
    signal: new AbortController().signal,
  });
  return { artifactRoot, result };
}

void test('DXR-003 actual producer output satisfies cache and sibling storage consumers', async () => {
  const { artifactRoot, result } = await produce();
  try {
    assert.equal(result.privateArtifacts.querySource.kind, 'query');
    const projected = projectAndroidSessionCacheCheckpoint(result, 'afterLogin', 'coach-1');
    assert.equal(projected.status, 'session-present');
    const sibling = requireAndroidStorageReceiptSet(
      result.privateArtifacts,
      'DXR-003 actual producer receipt set',
    );
    assert.equal(sibling.querySource.kind, 'query');
    assert.equal(sibling.querySource.sha256, result.privateArtifacts.querySource.sha256);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('DXR-003 both consumers reject missing and wrong query-source roles', async () => {
  const { artifactRoot, result } = await produce();
  try {
    const missing = structuredClone(result);
    delete (missing.privateArtifacts.querySource as { kind?: unknown }).kind;
    assert.throws(
      () => projectAndroidSessionCacheCheckpoint(missing, 'afterLogin', 'coach-1'),
      /unexpected fields|malformed|unbound/i,
    );
    assert.throws(
      () => requireAndroidStorageReceiptSet(missing.privateArtifacts, 'DXR-003 missing kind'),
      /malformed|unbound/i,
    );

    const wrong = structuredClone(result);
    (wrong.privateArtifacts.querySource as { kind?: unknown }).kind = 'database';
    assert.throws(
      () => projectAndroidSessionCacheCheckpoint(wrong, 'afterLogin', 'coach-1'),
      /malformed|unbound/i,
    );
    assert.throws(
      () => requireAndroidStorageReceiptSet(wrong.privateArtifacts, 'DXR-003 wrong kind'),
      /malformed|unbound/i,
    );
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
