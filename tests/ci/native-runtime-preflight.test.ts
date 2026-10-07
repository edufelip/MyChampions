import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertIosNativeModuleRegistration,
  assertNativeBootstrapHealthy,
  inspectNativeMetroEntry,
  inspectNativeAndroidAutolinking,
  requireNativeMetroEntryPaths,
  nativeObservationBudget,
  nativeExecutionDeadlines,
  parseNativeExecutionDeadlines,
  nativeCommandDeadline,
} from '../../scripts/testing/native-runtime-preflight';

void test('native Android rejects cached foreign linking before build and permits a missing or contained generated cache', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'mc-native-linking-'));
  try {
    const repositoryRoot = path.join(temporary, 'client');
    const foreign = path.join(temporary, 'foreign');
    const generated = path.join(repositoryRoot, 'android/build/generated/autolinking');
    mkdirSync(generated, { recursive: true });
    mkdirSync(foreign);
    assert.equal(inspectNativeAndroidAutolinking(repositoryRoot, repositoryRoot).status, 'absent');
    const file = path.join(generated, 'autolinking.json');
    const input = { root: repositoryRoot, reactNativePath: repositoryRoot, dependencies: {} };
    writeFileSync(file, JSON.stringify(input));
    assert.equal(
      inspectNativeAndroidAutolinking(repositoryRoot, repositoryRoot).status,
      'contained',
    );
    for (const patch of [
      { root: foreign },
      { reactNativePath: foreign },
      { dependencies: { stale: { root: foreign } } },
      { dependencies: [] },
    ]) {
      writeFileSync(file, JSON.stringify({ ...input, ...patch }));
      assert.throws(() => inspectNativeAndroidAutolinking(repositoryRoot, repositoryRoot));
    }
    const linked = path.join(repositoryRoot, 'linked-native');
    symlinkSync(foreign, linked);
    writeFileSync(file, JSON.stringify({ ...input, reactNativePath: linked }));
    assert.throws(() => inspectNativeAndroidAutolinking(repositoryRoot, repositoryRoot), /escapes/);
    rmSync(file);
    symlinkSync(path.join(foreign, 'missing.json'), file);
    assert.throws(
      () => inspectNativeAndroidAutolinking(repositoryRoot, repositoryRoot),
      /dangling link/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

void test('native Metro preflight rejects external and symlinked entries but permits contained monorepo entries', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'mc-native-entry-'));
  try {
    const serverRoot = path.join(temporary, 'workspace');
    const repositoryRoot = path.join(serverRoot, 'client');
    const sibling = path.join(temporary, 'workspace-foreign');
    mkdirSync(repositoryRoot, { recursive: true });
    mkdirSync(sibling);
    const entry = path.join(serverRoot, 'entry.js');
    const foreign = path.join(sibling, 'entry.js');
    writeFileSync(entry, 'export default true;');
    writeFileSync(foreign, 'export default false;');
    const input = { repositoryRoot, serverRoot, entry };
    assert.match(requireNativeMetroEntryPaths(input).entryHash, /^[a-f0-9]{64}$/);
    assert.throws(() => requireNativeMetroEntryPaths({ ...input, entry: foreign }), /escapes/);
    const linked = path.join(repositoryRoot, 'linked-entry.js');
    symlinkSync(foreign, linked);
    assert.throws(() => requireNativeMetroEntryPaths({ ...input, entry: linked }), /escapes/);
    assert.throws(
      () => requireNativeMetroEntryPaths({ ...input, repositoryRoot: sibling }),
      /escapes/,
    );
    assert.throws(
      () => requireNativeMetroEntryPaths({ ...input, entry: repositoryRoot }),
      /regular file/,
    );
    assert.throws(() => requireNativeMetroEntryPaths({ ...input, entry: 'entry.js' }), /absolute/);
    assert.throws(() => requireNativeMetroEntryPaths({ ...input, entry: entry + '.missing' }));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

void test('native Metro preflight resolves actual installed Expo entries for both platforms without startup', () => {
  const root = process.cwd();
  for (const platform of ['ios', 'android'] as const) {
    const actual = inspectNativeMetroEntry(root, platform);
    assert.equal(actual.platform, platform);
    assert.match(actual.entry, /expo-router\/entry\.js$/);
    assert.match(actual.entryHash, /^[a-f0-9]{64}$/);
  }
  assert.throws(() => inspectNativeMetroEntry(root, 'web' as never), /platform/);
});

void test('public native execution bounds reject malformed/unsafe values and cannot widen declared command deadlines', () => {
  const defaults = { buildMs: 900000, stepMs: 600000, wholeRunMs: 2400000 };
  assert.deepEqual(nativeExecutionDeadlines(), defaults);
  assert.deepEqual(parseNativeExecutionDeadlines({}), defaults);
  for (const [field, envName] of [
    ['buildMs', 'MYCHAMPIONS_NATIVE_BUILD_DEADLINE_MS'],
    ['stepMs', 'MYCHAMPIONS_NATIVE_STEP_DEADLINE_MS'],
    ['wholeRunMs', 'MYCHAMPIONS_NATIVE_WHOLE_DEADLINE_MS'],
  ] as const) {
    assert.equal(parseNativeExecutionDeadlines({ [envName]: '1000' })[field], 1000);
    assert.equal(
      parseNativeExecutionDeadlines({ [envName]: String(defaults[field]) })[field],
      defaults[field],
    );
    for (const value of [
      '',
      ' 1000',
      '01000',
      '1e3',
      '1000.0',
      '+1000',
      '999',
      String(defaults[field] + 1),
    ])
      assert.throws(() => parseNativeExecutionDeadlines({ [envName]: value }), /Invalid/);
    for (const value of [null, undefined, '1000', NaN, Infinity, 1000.5])
      assert.throws(() => nativeExecutionDeadlines({ [field]: value } as never), /Invalid/);
  }
  for (const value of [null, [], { unknown: 1000 }])
    assert.throws(() => nativeExecutionDeadlines(value as never), /Invalid/);
  const short = nativeExecutionDeadlines({ buildMs: 1000, stepMs: 2000 });
  assert.equal(nativeCommandDeadline(900000, 'build', short), 1000);
  assert.equal(nativeCommandDeadline(600000, 'step', short), 2000);
  assert.equal(nativeCommandDeadline(500, 'step', short), 500);
  assert.equal(nativeCommandDeadline(20000, 'step', defaults), 20000);
  for (const value of [0, 99, 600001, Infinity])
    assert.throws(() => nativeCommandDeadline(value, 'step', defaults), /Invalid/);
});

void test('native build/UI lifecycle budget is explicit and rejects unsafe or protocol-overflow bounds', () => {
  const budget = nativeObservationBudget();
  assert.equal(budget.totalMs, 2_100_000);
  assert(budget.totalMs > 600_000, 'Backend default expires during a fresh build plus observation');
  for (const buildMs of [-1, 0, 999, 1.5, NaN, Infinity, 3_600_000])
    assert.throws(() =>
      nativeObservationBudget({ buildMs, observationMs: 900_000, cleanupMs: 300_000 }),
    );
  assert.throws(() =>
    nativeObservationBudget({ buildMs: 900_000, observationMs: 0, cleanupMs: 300_000 }),
  );
});

void test('native packaging rejects JS modules absent from installed Pods or the runtime provider', () => {
  const input = {
    resolved: {
      modules: [
        {
          packageName: 'expo-secure-store',
          pods: [{ podName: 'ExpoSecureStore' }],
          modules: ['SecureStoreModule'],
        },
      ],
    },
    lock: 'PODS:\n  - ExpoSecureStore (15.0.8)\n\nDEPENDENCIES:\n',
    installed: 'PODS:\n  - ExpoSecureStore (15.0.8)\n\nDEPENDENCIES:\n',
    provider: 'SecureStoreModule.self,',
  };
  assert.doesNotThrow(() => assertIosNativeModuleRegistration(input));
  assert.throws(
    () => assertIosNativeModuleRegistration({ ...input, provider: '' }),
    /not registered/,
  );
  const absent = 'PODS:\n  - ExpoCamera (17.0.8)\n\nDEPENDENCIES:\n';
  assert.throws(
    () => assertIosNativeModuleRegistration({ ...input, lock: absent, installed: absent }),
    /not installed/,
  );
  assert.throws(
    () => assertIosNativeModuleRegistration({ ...input, installed: absent }),
    /do not match/,
  );
});

void test('bootstrap native errors behind otherwise discoverable controls block qualification', () => {
  assert.throws(
    () =>
      assertNativeBootstrapHealthy(" ERROR  [Error: Cannot find native module 'ExpoSecureStore']"),
    /bootstrap/,
  );
  assert.throws(
    () => assertNativeBootstrapHealthy('Invariant Violation: native component unavailable'),
    /bootstrap/,
  );
  assert.doesNotThrow(() =>
    assertNativeBootstrapHealthy('Bundled app\n WARN Slow development transform'),
  );
});
