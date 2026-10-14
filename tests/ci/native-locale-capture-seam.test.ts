import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  sameNativeLocaleBinding,
  type NativeLocaleBinding,
} from '../../scripts/testing/locale-native-observation';
import {
  buildNativeLocaleBinding,
  hashNativeLocaleHelperInputs,
  normalizeNativeLocaleCommandOutput,
  readOwnedNativeLocaleStdout,
  readAndroidNativeLocaleProperties,
  safelyFinalizeNativeLocaleObservation,
  shouldPropagateAndroidLocaleCommandFailure,
  type AndroidLocalePropertyRead,
  type NativeLocaleCommandRead,
} from '../../scripts/testing/native-locale-capture-seam';
import { buildNativeLocaleContextCandidateFromFile } from '../../scripts/testing/native-locale-file-observation';

const hash = (character: string) => character.repeat(64);
const helperInputs = [
  { path: 'scripts/testing/capture-native-testability.ts', sha256: hash('a') },
  { path: 'scripts/testing/locale-native-observation.ts', sha256: hash('b') },
];
const target: NativeLocaleBinding['target'] = {
  platform: 'ios',
  deviceId: 'owned-ios-device',
  osVersion: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
  appId: 'com.edufelip.mychampions.dev',
  binaryHash: hash('c'),
  apiOrigin: 'http://127.0.0.1:61251',
};
const binding = buildNativeLocaleBinding({
  captureRunId: 'a'.repeat(24),
  sourceTreeHash: hash('d'),
  helperInputs,
  target,
});

function command(overrides: Partial<NativeLocaleCommandRead> = {}): NativeLocaleCommandRead {
  return {
    execution: 'completed',
    cleanup: 'cleaned',
    attempted: true,
    stdoutText: 'en_US\n',
    ...overrides,
  };
}

function androidProperty(
  value: string | null,
  overrides: Partial<AndroidLocalePropertyRead> = {},
): AndroidLocalePropertyRead {
  return {
    execution: 'completed',
    cleanup: 'cleaned',
    attempted: true,
    stdoutText: value,
    status: 'completed',
    value,
    ...overrides,
  };
}

async function privateRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locale-capture-seam-'));
  await chmod(root, 0o700);
  return realpath(root);
}

function contextTree(): unknown {
  return {
    attributes: { testID: 'testing.locale.diagnostic' },
    children: [
      { attributes: { testID: 'testing.locale.hydration.hydrated' } },
      { attributes: { testID: 'testing.locale.effective.en-US' } },
      { attributes: { testID: 'testing.locale.override.absent' } },
    ],
  };
}

void test('hashes the existing helper ledger and builds through canonical binding parsing', () => {
  assert.equal(
    hashNativeLocaleHelperInputs(helperInputs),
    hashNativeLocaleHelperInputs([...helperInputs].reverse()),
  );
  assert.equal(binding.captureRunId, 'a'.repeat(24));
  assert.equal(binding.helperInputsHash, hashNativeLocaleHelperInputs(helperInputs));
  assert.throws(() => hashNativeLocaleHelperInputs([...helperInputs, { ...helperInputs[0] }]));
  assert.throws(() =>
    buildNativeLocaleBinding({ ...binding, captureRunId: 'request-id', helperInputs }),
  );
});

void test('binding comparison rejects a tampered captured build identity', () => {
  const captured = structuredClone(binding);
  captured.target.binaryHash = hash('e');
  assert.equal(sameNativeLocaleBinding(captured, binding), false);
  assert.equal(sameNativeLocaleBinding(binding, structuredClone(binding)), true);
});

void test('normalizes recorded iOS output while preserving canonical status policy', () => {
  const observed = normalizeNativeLocaleCommandOutput({ binding, command: command() });
  assert.deepEqual(observed.observedOsLocale, {
    status: 'observed',
    source: 'ios-simctl-defaults',
    raw: 'en_US',
    resolved: 'en-US',
    normalization: 'platform-canonical',
  });
  assert.equal(observed.blocker, null);

  const languageOnly = normalizeNativeLocaleCommandOutput({
    binding,
    command: command({ stdoutText: 'en' }),
  });
  assert.equal(languageOnly.observedOsLocale?.normalization, 'language-only');
  assert.equal(languageOnly.observedOsLocale?.resolved, null);

  const failed = normalizeNativeLocaleCommandOutput({
    binding,
    command: command({ execution: 'child-failed', cleanup: 'cleaned', stdoutText: null }),
  });
  assert.equal(failed.observedOsLocale?.status, 'read-error');
  assert.equal(failed.blocker, 'locale-command-read-error');

  const unattempted = normalizeNativeLocaleCommandOutput({
    binding,
    command: command({ attempted: false, execution: 'harness-blocked', cleanup: 'not-acquired' }),
  });
  assert.equal(unattempted.observedOsLocale, null);
  assert.equal(unattempted.blocker, 'locale-command-not-attempted');
});

void test('treats inherited object keys as unsupported locale strings without throwing', () => {
  for (const stdoutText of ['constructor', 'toString', '__proto__']) {
    const result = normalizeNativeLocaleCommandOutput({
      binding,
      command: command({ stdoutText }),
    });
    assert.equal(result.observedOsLocale?.status, 'invalid');
    assert.equal(result.observedOsLocale?.raw, stdoutText);
    assert.equal(result.blocker, null);
  }
});

void test('captures finalization errors as blocked evidence instead of throwing into cleanup', async () => {
  const result = await safelyFinalizeNativeLocaleObservation(() => {
    throw new Error('synthetic adapter failure');
  });
  assert.deepEqual(result, {
    status: 'blocked',
    error: { name: 'Error', message: 'synthetic adapter failure' },
  });
});

void test('rejects unbounded or control-bearing command output before locale evidence', () => {
  const oversized = normalizeNativeLocaleCommandOutput({
    binding,
    command: command({ stdoutText: 'x'.repeat(129) }),
  });
  assert.equal(oversized.observedOsLocale, null);
  assert.equal(oversized.blocker, 'locale-command-output-too-large');

  const control = normalizeNativeLocaleCommandOutput({
    binding,
    command: command({ stdoutText: 'en-US\u0000' }),
  });
  assert.equal(control.observedOsLocale, null);
  assert.equal(control.blocker, 'locale-command-output-control-character');
});

void test('Android preserves failed command metadata and never falls back after a failed persisted read', async () => {
  const calls: string[] = [];
  const result = await readAndroidNativeLocaleProperties((property) => {
    calls.push(property);
    return {
      execution: 'child-failed',
      cleanup: 'failed-recovery-ledger-retained',
      attempted: true,
      stdoutText: null,
      childExitCode: 1,
      childSignal: null,
      pid: 321,
      pgid: 321,
      logPath: '/private/persisted.private.log',
      stdoutPath: '/private/persisted.stdout',
      status: 'read-error',
      value: null,
    };
  });
  assert.deepEqual(calls, ['persist.sys.locale']);
  assert.equal(result.productDefault, null);
  assert.equal(result.selected.execution, 'child-failed');
  assert.equal(result.selected.cleanup, 'failed-recovery-ledger-retained');
  assert.equal(result.selected.attempted, true);
  assert.equal(result.selected.pid, 321);
});

void test('owned locale stdout accepts a zero-byte persisted value and enables the default fallback', async () => {
  const root = await privateRoot();
  try {
    await writeFile(path.join(root, 'persist.stdout'), Buffer.alloc(0), { mode: 0o600 });
    await writeFile(path.join(root, 'default.stdout'), 'es-ES\n', { mode: 0o600 });
    const calls: string[] = [];
    const result = await readAndroidNativeLocaleProperties((property) => {
      calls.push(property);
      const relative = property === 'persist.sys.locale' ? 'persist.stdout' : 'default.stdout';
      const value = readOwnedNativeLocaleStdout(root, relative);
      return androidProperty(value);
    });
    assert.deepEqual(calls, ['persist.sys.locale', 'ro.product.locale']);
    assert.equal(result.persisted.value, '');
    assert.equal(result.selectedProperty, 'ro.product.locale');
    assert.equal(result.selected.value, 'es-ES\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('owned locale stdout rejects oversize, non-private and symlinked files', async () => {
  const root = await privateRoot();
  try {
    const validPath = path.join(root, 'valid.stdout');
    await writeFile(validPath, 'en-US\n', { mode: 0o600 });
    const oversizePath = path.join(root, 'oversize.stdout');
    await writeFile(oversizePath, 'x'.repeat(129), { mode: 0o600 });
    assert.throws(() => readOwnedNativeLocaleStdout(root, 'oversize.stdout'));
    await chmod(validPath, 0o644);
    assert.throws(() => readOwnedNativeLocaleStdout(root, 'valid.stdout'));
    await chmod(validPath, 0o600);
    await symlink('valid.stdout', path.join(root, 'linked.stdout'));
    assert.throws(() => readOwnedNativeLocaleStdout(root, 'linked.stdout'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('a log path without a PID is not a spawn and harness or ownership blocks are propagated', async () => {
  const blocked = androidProperty(null, {
    execution: 'harness-blocked',
    cleanup: 'not-acquired',
    attempted: false,
    status: 'not-attempted',
    logPath: '/private/locale-os-read-persisted.private.log',
    stdoutPath: '/private/locale-os-read-persisted.stdout',
  });
  assert.equal(shouldPropagateAndroidLocaleCommandFailure(blocked), true);
  assert.equal(shouldPropagateAndroidLocaleCommandFailure(blocked, true), true);
  assert.equal(
    shouldPropagateAndroidLocaleCommandFailure(
      androidProperty(null, {
        execution: 'child-failed',
        cleanup: 'failed-recovery-ledger-retained',
        status: 'read-error',
      }),
    ),
    true,
  );
  const calls: string[] = [];
  const result = await readAndroidNativeLocaleProperties((property) => {
    calls.push(property);
    return blocked;
  });
  assert.deepEqual(calls, ['persist.sys.locale']);
  assert.equal(result.selectedProperty, 'persist.sys.locale');
  assert.equal(result.productDefault, null);
  assert.equal(result.selected.attempted, false);
  assert.equal(result.selected.logPath, blocked.logPath);
});

void test('Android does not treat missing persisted stdout as an empty value', async () => {
  const calls: string[] = [];
  const result = await readAndroidNativeLocaleProperties((property) => {
    calls.push(property);
    return {
      execution: 'completed',
      cleanup: 'cleaned',
      attempted: true,
      stdoutText: null,
      status: 'completed',
      value: null,
      pid: 444,
      pgid: 444,
    };
  });
  assert.deepEqual(calls, ['persist.sys.locale']);
  assert.equal(result.selectedProperty, 'persist.sys.locale');
  assert.equal(result.productDefault, null);
  assert.equal(result.selected.value, null);
});

void test('Android reads persisted locale first and falls back only after a successful empty read', async () => {
  const calls: string[] = [];
  const persisted = await readAndroidNativeLocaleProperties((property) => {
    calls.push(property);
    return androidProperty(property === 'persist.sys.locale' ? 'pt-BR\n' : 'en-US\n');
  });
  assert.deepEqual(calls, ['persist.sys.locale']);
  assert.equal(persisted.selectedProperty, 'persist.sys.locale');
  assert.equal(persisted.selected.value, 'pt-BR\n');

  calls.length = 0;
  const fallback = await readAndroidNativeLocaleProperties((property) => {
    calls.push(property);
    return androidProperty(property === 'persist.sys.locale' ? '\n' : 'es-ES\n');
  });
  assert.deepEqual(calls, ['persist.sys.locale', 'ro.product.locale']);
  assert.equal(fallback.selectedProperty, 'ro.product.locale');
  assert.equal(fallback.selected.value, 'es-ES\n');

  calls.length = 0;
  await assert.rejects(
    () =>
      readAndroidNativeLocaleProperties((property) => {
        calls.push(property);
        throw new Error(`blocked ${property}`);
      }),
    /blocked persist\.sys\.locale/,
  );
  assert.deepEqual(calls, ['persist.sys.locale']);
});

void test('passes the normalized OS result through the existing private hierarchy adapter', async () => {
  const root = await privateRoot();
  try {
    const hierarchyPath = 'entry-hierarchy.json';
    const bytes = Buffer.from(JSON.stringify(contextTree()));
    await writeFile(path.join(root, hierarchyPath), bytes, { mode: 0o600 });
    const observed = normalizeNativeLocaleCommandOutput({ binding, command: command() });
    const candidate = buildNativeLocaleContextCandidateFromFile({
      artifactRoot: root,
      hierarchyPath,
      binding,
      expectedBinding: binding,
      observedOsLocale: observed.observedOsLocale,
    });
    assert.equal(candidate.status, 'preparation-only');
    assert.equal(candidate.nativePassingCases, 0);
    assert.equal(candidate.publicLocale, null);
    assert.equal(candidate.treeHash, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(candidate.observedOsLocale, observed.observedOsLocale);
    assert.equal(candidate.binding?.captureRunId, binding.captureRunId);
    assert.ok(candidate.blockers.includes('runtime-proof-pending'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
