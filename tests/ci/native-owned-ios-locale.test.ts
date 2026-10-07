import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import {
  mkdtemp,
  mkdir,
  chmod,
  rm,
  writeFile,
  symlink,
  readFile,
  stat,
  rename,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  parseIosLocaleQuiescenceProcessCensus,
  readOwnedIosLocaleQuiescenceStdout,
} from '../../scripts/testing/ios-locale-quiescence';
import {
  IOS_LOCALE_RUNTIME_CONTRACT,
  auditIosLocaleSelectionControls,
  buildIosLocaleBindingGuard,
  buildIosLocaleCoachLoginFlow,
  buildIosLocaleHierarchyArgv,
  buildIosLocaleLaunchArgv,
  buildIosLocaleOsReadArgv,
  buildIosLocaleOsWriteArgv,
  buildIosLocaleSaveFlow,
  buildIosLocaleSelectionFlow,
  buildIosLocaleTerminateArgv,
  commandReceiptReferencesMatch,
  createIosLocaleOwnedTransport,
  evaluateIosLocaleContextCheckpoint,
  normalizeIosLocaleReadback,
  parseIosAppleLanguagesFirst,
  requireIosAppleLanguagesMatch,
  runIosLocaleScenario,
  validateIosLocaleCoachSignInReceipt,
  validateIosLocaleEffectiveDeadline,
  type IosLocaleHierarchyFrame,
} from '../../scripts/testing/ios-locale-runtime-adapter';
import {
  IOS_LANGUAGE_STORAGE_CONTRACT,
  readIosLanguageOverride,
  resetIosLanguageOverride,
} from '../../scripts/testing/ios-locale-storage';
import type {
  NativeLocaleBinding,
  NativeLocaleEvidence,
} from '../../scripts/testing/locale-native-observation';
import type { NativeLocaleCommandRead } from '../../scripts/testing/native-locale-capture-seam';

const UDID = '01234567-89AB-CDEF-0123-456789ABCDEF';
const CAPTURE = '0123456789abcdef01234567';
const HASH = 'a'.repeat(64);
const FIXTURE_DIRECTORY = path.join(realpathSync(tmpdir()), '.mychampions-ios-locale-v7-artifacts');

async function ensureFixtureDirectory(): Promise<void> {
  await mkdir(FIXTURE_DIRECTORY, { recursive: true, mode: 0o700 });
  await chmod(FIXTURE_DIRECTORY, 0o700);
}

async function fixture(
  manifest: unknown,
  files: Record<string, string> = {},
  rawManifest?: string,
) {
  await ensureFixtureDirectory();
  const root = await mkdtemp(path.join(FIXTURE_DIRECTORY, '.fixture-'));
  const storage = path.join(
    root,
    'Library',
    'Application Support',
    IOS_LANGUAGE_STORAGE_CONTRACT.bundleId,
    IOS_LANGUAGE_STORAGE_CONTRACT.directory,
  );
  await mkdir(storage, { recursive: true, mode: 0o700 });
  for (const parent of [
    root,
    path.join(root, 'Library'),
    path.join(root, 'Library', 'Application Support'),
    path.join(root, 'Library', 'Application Support', IOS_LANGUAGE_STORAGE_CONTRACT.bundleId),
    storage,
  ])
    await chmod(parent, 0o700);
  if (rawManifest !== undefined)
    await writeFile(path.join(storage, 'manifest.json'), rawManifest, { mode: 0o600 });
  else if (manifest !== null)
    await writeFile(path.join(storage, 'manifest.json'), `${JSON.stringify(manifest)}\n`, {
      mode: 0o600,
    });
  for (const [name, value] of Object.entries(files))
    await writeFile(path.join(storage, name), value, { mode: 0o600 });
  return { root, storage, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function quiescence(): {
  status: 'terminated';
  captureRunId: string;
  deviceId: string;
  bundleId: typeof IOS_LANGUAGE_STORAGE_CONTRACT.bundleId;
  appRunning: false;
  observedAt: string;
  probe: {
    status: 'observed';
    captureRunId: string;
    deviceId: string;
    bundleId: typeof IOS_LANGUAGE_STORAGE_CONTRACT.bundleId;
    command: {
      label: string;
      execution: 'completed';
      cleanup: 'cleaned';
      pid: number;
      pgid: number;
      logPath: string;
      stdoutPath: string;
      stdoutBytes: number;
      stdoutSha256: string;
      bindingCaptureRunId: string;
    };
    processes: readonly { pid: number; command: string }[];
    observedAt: string;
  };
} {
  return {
    status: 'terminated',
    captureRunId: CAPTURE,
    deviceId: UDID,
    bundleId: IOS_LANGUAGE_STORAGE_CONTRACT.bundleId,
    appRunning: false,
    observedAt: '2026-10-01T12:00:00.000Z',
    probe: {
      status: 'observed',
      captureRunId: CAPTURE,
      deviceId: UDID,
      bundleId: IOS_LANGUAGE_STORAGE_CONTRACT.bundleId,
      command: {
        label: 'locale-reset-quiescence-1',
        execution: 'completed',
        cleanup: 'cleaned',
        pid: 101,
        pgid: 101,
        logPath: 'quiescence.log',
        stdoutPath: 'quiescence.stdout',
        stdoutBytes: 0,
        stdoutSha256: '0'.repeat(64),
        bindingCaptureRunId: CAPTURE,
      },
      processes: [],
      observedAt: '2026-10-01T12:00:00.000Z',
    },
  };
}

void test('iOS locale command builders use bounded owned argv and no broad reset', () => {
  assert.deepEqual(buildIosLocaleOsWriteArgv({ udid: UDID, locale: 'pt-BR' }), [
    [
      'simctl',
      'spawn',
      UDID,
      'defaults',
      'write',
      'NSGlobalDomain',
      'AppleLanguages',
      '-array',
      'pt',
    ],
    ['simctl', 'spawn', UDID, 'defaults', 'write', 'NSGlobalDomain', 'AppleLocale', 'pt_BR'],
  ]);
  assert.deepEqual(buildIosLocaleOsReadArgv(UDID), [
    ['simctl', 'spawn', UDID, 'defaults', 'read', 'NSGlobalDomain', 'AppleLanguages'],
    ['simctl', 'spawn', UDID, 'defaults', 'read', 'NSGlobalDomain', 'AppleLocale'],
  ]);
  assert.deepEqual(buildIosLocaleTerminateArgv(UDID), [
    'simctl',
    'terminate',
    UDID,
    IOS_LANGUAGE_STORAGE_CONTRACT.bundleId,
  ]);
  assert.deepEqual(buildIosLocaleLaunchArgv(UDID, IOS_LANGUAGE_STORAGE_CONTRACT.bundleId, 8081), [
    'simctl',
    'launch',
    '--terminate-running-process',
    UDID,
    IOS_LANGUAGE_STORAGE_CONTRACT.bundleId,
    '-RCT_jsLocation',
    'localhost:8081',
  ]);
  assert.deepEqual(buildIosLocaleHierarchyArgv(UDID), ['--no-ansi', '--udid', UDID, 'hierarchy']);
  assert.throws(() => buildIosLocaleLaunchArgv(UDID, IOS_LANGUAGE_STORAGE_CONTRACT.bundleId, 80));
  assert.deepEqual(IOS_LOCALE_RUNTIME_CONTRACT.forbiddenResetTokens, [
    'pm clear',
    'simctl erase',
    'clearState',
    'rm -rf',
  ]);
  assert.equal(parseIosAppleLanguagesFirst('(\n    pt\n)'), 'pt');
  assert.equal(parseIosAppleLanguagesFirst('(\n    en\n)'), 'en');
  assert.equal(parseIosAppleLanguagesFirst(''), null);
  assert.equal(parseIosAppleLanguagesFirst('garbage pt garbage'), null);
  assert.equal(parseIosAppleLanguagesFirst('(\n    pt\n)\uFFFD'), null);
  assert.equal(parseIosAppleLanguagesFirst('(\n    pt, es\n)'), 'pt');
  assert.equal(parseIosAppleLanguagesFirst('(pt,)'), null);
  assert.equal(parseIosAppleLanguagesFirst('(pt,,es)'), null);
  assert.equal(parseIosAppleLanguagesFirst('(pt-foo)'), null);
  assert.equal(parseIosAppleLanguagesFirst('(pt_BR)'), null);
  assert.equal(parseIosAppleLanguagesFirst('(\n    pt; es\n)'), null);
  assert.doesNotThrow(() => requireIosAppleLanguagesMatch('pt-BR', '(\n    pt\n)'));
  assert.throws(
    () => requireIosAppleLanguagesMatch('pt-BR', '(\n    en\n)'),
    /AppleLanguages first entry is stale/,
  );
});

void test('normal iOS locale flow binds coach sign-in before Account and uses every documented selector', () => {
  const login = buildIosLocaleCoachLoginFlow(
    IOS_LANGUAGE_STORAGE_CONTRACT.bundleId,
    'coach@example.invalid',
    'fixture-password-placeholder',
  );
  assert.match(login, /auth\.signIn\.emailInput/);
  assert.match(login, /auth\.signIn\.passwordInput/);
  assert.match(login, /Save Password/);
  assert.match(login, /Not Now/);
  assert.match(login, /pro\.home\.screen/);
  const selection = buildIosLocaleSelectionFlow(IOS_LANGUAGE_STORAGE_CONTRACT.bundleId, 'es-ES');
  const accountIndex = selection.indexOf('id: tabs.account');
  const languageIndex = selection.indexOf('id: settings.account.languageRow');
  const requestedIndex = selection.indexOf('id: settings.languageSelect.option.es-ES');
  assert.ok(accountIndex >= 0 && languageIndex > accountIndex && requestedIndex > languageIndex);
  for (const selector of [
    'settings.account.screen',
    'settings.languageSelect.screen',
    'settings.languageSelect.option.en-US',
    'settings.languageSelect.option.pt-BR',
    'settings.languageSelect.option.es-ES',
    'settings.languageSelect.option.es-ES.checkmark',
  ])
    assert.match(selection, new RegExp(selector.replaceAll('.', '\\.')));
  assert.match(
    buildIosLocaleSaveFlow(IOS_LANGUAGE_STORAGE_CONTRACT.bundleId),
    /settings\.languageSelect\.saveButton/,
  );
});

void test('language storage reader distinguishes absent, present, invalid and malformed states', async (t) => {
  const present = await fixture(
    { [IOS_LANGUAGE_STORAGE_CONTRACT.key]: 'pt-BR', unrelated: 'keep' },
    { auth: 'session-shape' },
  );
  t.after(present.cleanup);
  const presentObservation = await readIosLanguageOverride(present.root);
  assert.equal(presentObservation.status, 'present');
  assert.equal(presentObservation.value, 'pt-BR');
  assert.equal(presentObservation.keyFile, null);
  assert.equal(
    presentObservation.inventory.some((file) => file.name === 'auth'),
    true,
  );
  assert.equal(presentObservation.layout.status, 'complete');
  assert.equal(presentObservation.layout.directories.length, 5);
  assert.equal(
    presentObservation.layout.directories.every((directory) => directory.uid > 0),
    true,
  );
  assert.equal(presentObservation.manifestFile?.mode, 0o600);
  assert.equal(
    presentObservation.manifestFile?.bytes,
    Buffer.byteLength(
      JSON.stringify({
        [IOS_LANGUAGE_STORAGE_CONTRACT.key]: 'pt-BR',
        unrelated: 'keep',
      }) + '\n',
    ),
  );

  const absent = await fixture({ unrelated: 'keep' });
  t.after(absent.cleanup);
  assert.equal((await readIosLanguageOverride(absent.root)).status, 'absent');

  const invalid = await fixture({ [IOS_LANGUAGE_STORAGE_CONTRACT.key]: 'fr-FR' });
  t.after(invalid.cleanup);
  const invalidObservation = await readIosLanguageOverride(invalid.root);
  assert.equal(invalidObservation.status, 'invalid');
  assert.equal(invalidObservation.value, null);

  const malformed = await fixture(null);
  t.after(malformed.cleanup);
  await writeFile(path.join(malformed.storage, 'manifest.json'), '{not-json', { mode: 0o600 });
  const malformedObservation = await readIosLanguageOverride(malformed.root);
  assert.equal(malformedObservation.status, 'read-error');
  assert.equal(malformedObservation.errorCode, 'manifest-malformed');

  const invalidUtf8 = await fixture(null);
  t.after(invalidUtf8.cleanup);
  await writeFile(path.join(invalidUtf8.storage, 'manifest.json'), Buffer.from([0xc3, 0x28]), {
    mode: 0o600,
  });
  await assert.rejects(readIosLanguageOverride(invalidUtf8.root), /valid UTF-8/);
});

void test('storage inventory enforces an aggregate byte cap instead of only per-file limits', async (t) => {
  const files = Object.fromEntries(
    Array.from({ length: 130 }, (_, index) => [`owned-${index}`, 'x'.repeat(64 * 1024 - 1)]),
  );
  const state = await fixture({ [IOS_LANGUAGE_STORAGE_CONTRACT.key]: 'pt-BR' }, files);
  t.after(state.cleanup);
  await assert.rejects(readIosLanguageOverride(state.root), /aggregate bounded read size/);
});

void test('real simulator container modes allow normal 0755/0644 but reject writable group/other state', async (t) => {
  const normal = await fixture(
    { [IOS_LANGUAGE_STORAGE_CONTRACT.key]: 'en-US' },
    { auth: 'session-shape' },
  );
  t.after(normal.cleanup);
  for (const parent of [
    normal.root,
    path.join(normal.root, 'Library'),
    path.join(normal.root, 'Library', 'Application Support'),
    path.join(
      normal.root,
      'Library',
      'Application Support',
      IOS_LANGUAGE_STORAGE_CONTRACT.bundleId,
    ),
    normal.storage,
  ])
    await chmod(parent, 0o755);
  await chmod(path.join(normal.storage, 'manifest.json'), 0o644);
  await chmod(path.join(normal.storage, 'auth'), 0o644);
  assert.equal((await readIosLanguageOverride(normal.root)).status, 'present');

  await chmod(normal.storage, 0o775);
  await assert.rejects(
    readIosLanguageOverride(normal.root),
    /unsafe app-container mode|owned directory/,
  );
  await chmod(normal.storage, 0o755);
  await chmod(path.join(normal.storage, 'manifest.json'), 0o664);
  await assert.rejects(
    readIosLanguageOverride(normal.root),
    /unsafe app-container mode|storage file/,
  );
});

void test('every app-container layout segment is owner-bound and rejects an intermediate symlink', async (t) => {
  const state = await fixture({ [IOS_LANGUAGE_STORAGE_CONTRACT.key]: 'en-US' });
  t.after(state.cleanup);
  const realLibrary = path.join(state.root, 'Library-real');
  await rename(path.join(state.root, 'Library'), realLibrary);
  await symlink(realLibrary, path.join(state.root, 'Library'));
  await assert.rejects(
    readIosLanguageOverride(state.root),
    /canonical owned directory|language storage/,
  );
});

void test('key-only reset preserves normal simulator manifest mode instead of applying QA artifact chmod', async (t) => {
  const state = await fixture({ [IOS_LANGUAGE_STORAGE_CONTRACT.key]: 'en-US', unrelated: 'keep' });
  t.after(state.cleanup);
  for (const parent of [
    state.root,
    path.join(state.root, 'Library'),
    path.join(state.root, 'Library', 'Application Support'),
    path.join(state.root, 'Library', 'Application Support', IOS_LANGUAGE_STORAGE_CONTRACT.bundleId),
    state.storage,
  ])
    await chmod(parent, 0o755);
  const manifest = path.join(state.storage, IOS_LANGUAGE_STORAGE_CONTRACT.manifest);
  await chmod(manifest, 0o644);
  const reset = await resetIosLanguageOverride({
    dataRoot: state.root,
    quiescence: quiescence(),
    captureRunId: CAPTURE,
    deviceId: UDID,
    authBefore: { sessionPresent: true },
    authAfter: { sessionPresent: true },
    domainBefore: { stable: true },
    domainAfter: { stable: true },
  });
  assert.equal(reset.status, 'observed');
  assert.equal((await stat(manifest)).mode & 0o777, 0o644);
});

void test('hashed AsyncStorage value and exact key-only reset preserve unrelated app state and snapshots', async (t) => {
  const keyFile = createHash('md5').update(IOS_LANGUAGE_STORAGE_CONTRACT.key).digest('hex');
  const state = await fixture(
    { [IOS_LANGUAGE_STORAGE_CONTRACT.key]: null, unrelated: 'keep' },
    { [keyFile]: 'es-ES', auth: 'auth-session', domain: 'domain-state' },
  );
  t.after(state.cleanup);
  const before = await readIosLanguageOverride(state.root);
  assert.equal(before.status, 'present');
  assert.equal(before.value, 'es-ES');
  assert.equal(before.keyFile?.bytes, Buffer.byteLength('es-ES'));
  assert.match(before.keyFile?.sha256 ?? '', /^[a-f0-9]{64}$/);
  const auth = { status: 'session-present', sessionPresent: true, profilePresent: true };
  const domain = { runId: 'owned-run', rows: [{ id: 'domain-1' }] };
  const reset = await resetIosLanguageOverride({
    dataRoot: state.root,
    quiescence: quiescence(),
    captureRunId: CAPTURE,
    deviceId: UDID,
    authBefore: auth,
    authAfter: auth,
    domainBefore: domain,
    domainAfter: domain,
  });
  assert.equal(reset.status, 'observed');
  assert.deepEqual([...reset.changedFiles].sort(), ['manifest.json', keyFile].sort());
  assert.equal(reset.after.status, 'absent');
  assert.equal(reset.unrelatedStoragePreserved, true);
  assert.equal(reset.authBefore.sha256, reset.authAfter.sha256);
  assert.equal(reset.domainBefore.sha256, reset.domainAfter.sha256);
  assert.equal(await readFile(path.join(state.storage, 'auth'), 'utf8'), 'auth-session');
  assert.equal(await readFile(path.join(state.storage, 'domain'), 'utf8'), 'domain-state');
});

void test('interrupted key-file mutation returns recovery-required receipt after atomic manifest publish', async (t) => {
  const keyFile = createHash('md5').update(IOS_LANGUAGE_STORAGE_CONTRACT.key).digest('hex');
  const state = await fixture(
    { [IOS_LANGUAGE_STORAGE_CONTRACT.key]: null, unrelated: 'keep' },
    { [keyFile]: 'pt-BR', unrelated: 'foreign-bytes' },
  );
  t.after(state.cleanup);
  const controller = new AbortController();
  const reset = await resetIosLanguageOverride({
    dataRoot: state.root,
    quiescence: quiescence(),
    captureRunId: CAPTURE,
    deviceId: UDID,
    authBefore: { sessionPresent: true },
    domainBefore: { stable: true },
    authAfter: { sessionPresent: true },
    domainAfter: { stable: true },
    beforeKeyFileUnlink: () => controller.abort(new Error('controlled interruption')),
    signal: controller.signal,
  });
  assert.equal(reset.status, 'failed-recovery-required');
  if (reset.status !== 'failed-recovery-required') throw new Error('missing recovery receipt');
  assert.equal(reset.failure.phase, 'key-file-unlink');
  assert.deepEqual(reset.changedFiles, ['manifest.json']);
  assert.equal(reset.unrelatedStoragePreserved, false);
  assert.equal(await readFile(path.join(state.storage, keyFile), 'utf8'), 'pt-BR');
  assert.deepEqual(JSON.parse(await readFile(path.join(state.storage, 'manifest.json'), 'utf8')), {
    unrelated: 'keep',
  });
  assert.equal(await readFile(path.join(state.storage, 'unrelated'), 'utf8'), 'foreign-bytes');
});

void test('an existing recovery temp file blocks a second reset without deleting the first attempt', async (t) => {
  const state = await fixture({ [IOS_LANGUAGE_STORAGE_CONTRACT.key]: 'pt-BR', unrelated: 'keep' });
  t.after(state.cleanup);
  const temporaryPath = path.join(
    state.storage,
    `${IOS_LANGUAGE_STORAGE_CONTRACT.manifest}.locale-reset-${CAPTURE}.tmp`,
  );
  await writeFile(temporaryPath, 'first-attempt-recovery', { mode: 0o600 });
  await assert.rejects(
    resetIosLanguageOverride({
      dataRoot: state.root,
      quiescence: quiescence(),
      captureRunId: CAPTURE,
      deviceId: UDID,
      authBefore: { sessionPresent: true },
      domainBefore: { stable: true },
      authAfter: { sessionPresent: true },
      domainAfter: { stable: true },
    }),
    /EEXIST|already exists|file exists/,
  );
  assert.equal(await readFile(temporaryPath, 'utf8'), 'first-attempt-recovery');
  assert.equal((await readIosLanguageOverride(state.root)).status, 'present');
});

void test('manifest reset compares target bytes while preserving unrelated logical entries and file bytes', async (t) => {
  const rawManifest = [
    '{',
    '  "tail": {"b": 2, "a": "escaped \\u00e9\\nvalue"},',
    `  "${IOS_LANGUAGE_STORAGE_CONTRACT.key}": "pt-BR",`,
    '  "head": "keep"',
    '}',
    '',
  ].join('\n');
  const state = await fixture(null, { unrelated: 'foreign-bytes' }, rawManifest);
  t.after(state.cleanup);
  const manifestPath = path.join(state.storage, IOS_LANGUAGE_STORAGE_CONTRACT.manifest);
  const unrelatedPath = path.join(state.storage, 'unrelated');
  const beforeBytes = await readFile(manifestPath);
  const unrelatedBefore = await readFile(unrelatedPath);
  const before = await readIosLanguageOverride(state.root);
  assert.equal(before.status, 'present');
  assert.equal(before.manifestFile?.bytes, beforeBytes.byteLength);
  assert.equal(before.manifestFile?.sha256, createHash('sha256').update(beforeBytes).digest('hex'));
  const reset = await resetIosLanguageOverride({
    dataRoot: state.root,
    quiescence: quiescence(),
    captureRunId: CAPTURE,
    deviceId: UDID,
    authBefore: { sessionPresent: true },
    authAfter: { sessionPresent: true },
    domainBefore: { stable: true },
    domainAfter: { stable: true },
  });
  assert.equal(reset.status, 'observed');
  const afterBytes = await readFile(manifestPath);
  assert.notDeepEqual(afterBytes, beforeBytes);
  assert.deepEqual(JSON.parse(afterBytes.toString('utf8')), {
    tail: { b: 2, a: 'escaped é\nvalue' },
    head: 'keep',
  });
  assert.deepEqual(await readFile(unrelatedPath), unrelatedBefore);
  assert.equal(reset.after.status, 'absent');
});

void test('direct manifest reset changes only manifest and rejects non-quiescent reset', async (t) => {
  const state = await fixture(
    { [IOS_LANGUAGE_STORAGE_CONTRACT.key]: 'en-US', unrelated: 'keep' },
    { auth: 'auth' },
  );
  t.after(state.cleanup);
  await assert.rejects(
    resetIosLanguageOverride({
      dataRoot: state.root,
      quiescence: { ...quiescence(), appRunning: true } as never,
      captureRunId: CAPTURE,
      deviceId: UDID,
      authBefore: {},
      authAfter: {},
      domainBefore: {},
      domainAfter: {},
    }),
    /terminated-app receipt/,
  );
  await assert.rejects(
    resetIosLanguageOverride({
      dataRoot: state.root,
      quiescence: {
        ...quiescence(),
        probe: {
          ...quiescence().probe,
          processes: [{ pid: 777, command: IOS_LANGUAGE_STORAGE_CONTRACT.bundleId }],
        },
      } as never,
      captureRunId: CAPTURE,
      deviceId: UDID,
      authBefore: {},
      authAfter: {},
      domainBefore: {},
      domainAfter: {},
    }),
    /terminated-app receipt/,
  );
  const emptyBefore = await readIosLanguageOverride(state.root);
  const reset = await resetIosLanguageOverride({
    dataRoot: state.root,
    quiescence: quiescence(),
    captureRunId: CAPTURE,
    deviceId: UDID,
    authBefore: { sessionPresent: true },
    authAfter: { sessionPresent: true },
    domainBefore: { rows: ['same'] },
    domainAfter: { rows: ['same'] },
  });
  assert.equal(reset.changedFiles.length, 1);
  assert.deepEqual(reset.changedFiles, ['manifest.json']);
  assert.equal(emptyBefore.status, 'present');
  if (reset.status !== 'observed') throw new Error('reset unexpectedly requires recovery');
  assert.equal(reset.after.status, 'absent');
  assert.equal(await readFile(path.join(state.storage, 'auth'), 'utf8'), 'auth');
  assert.deepEqual(JSON.parse(await readFile(path.join(state.storage, 'manifest.json'), 'utf8')), {
    unrelated: 'keep',
  });
});

void test('key-only reset invokes auth and domain readers after mutation', async (t) => {
  const state = await fixture({ [IOS_LANGUAGE_STORAGE_CONTRACT.key]: 'pt-BR' });
  t.after(state.cleanup);
  let authAfterCalled = false;
  let domainAfterCalled = false;
  let authAfterSignal: AbortSignal | undefined;
  let domainAfterSignal: AbortSignal | undefined;
  const controller = new AbortController();
  const reset = await resetIosLanguageOverride({
    dataRoot: state.root,
    quiescence: quiescence(),
    captureRunId: CAPTURE,
    deviceId: UDID,
    authBefore: { sessionPresent: true },
    domainBefore: { stable: true },
    readAuthAfter: async (signal) => {
      authAfterSignal = signal;
      assert.equal(
        (await readIosLanguageOverride(state.root, IOS_LANGUAGE_STORAGE_CONTRACT.bundleId, signal))
          .status,
        'absent',
      );
      authAfterCalled = true;
      return { sessionPresent: true };
    },
    readDomainAfter: (signal) => {
      domainAfterSignal = signal;
      assert.equal(authAfterCalled, true);
      domainAfterCalled = true;
      return Promise.resolve({ stable: true });
    },
    signal: controller.signal,
  });
  assert.equal(reset.status, 'observed');
  assert.equal(authAfterCalled, true);
  assert.equal(domainAfterCalled, true);
  assert.equal(authAfterSignal, controller.signal);
  assert.equal(domainAfterSignal, controller.signal);
});

void test('aborted key-only reset stops before direct storage mutation and never returns a receipt', async (t) => {
  const state = await fixture({ [IOS_LANGUAGE_STORAGE_CONTRACT.key]: 'pt-BR', unrelated: 'keep' });
  t.after(state.cleanup);
  const controller = new AbortController();
  controller.abort(new Error('cancelled before reset'));
  await assert.rejects(
    resetIosLanguageOverride({
      dataRoot: state.root,
      quiescence: quiescence(),
      captureRunId: CAPTURE,
      deviceId: UDID,
      authBefore: { sessionPresent: true },
      domainBefore: { stable: true },
      authAfter: { sessionPresent: true },
      domainAfter: { stable: true },
      signal: controller.signal,
    }),
    /cancelled before reset/,
  );
  assert.equal((await readIosLanguageOverride(state.root)).status, 'present');
});

void test('aborted bounded storage reads stop before any direct file read', async (t) => {
  const state = await fixture({ [IOS_LANGUAGE_STORAGE_CONTRACT.key]: 'pt-BR' });
  t.after(state.cleanup);
  const controller = new AbortController();
  controller.abort(new Error('cancelled during bounded read'));
  await assert.rejects(
    readIosLanguageOverride(state.root, IOS_LANGUAGE_STORAGE_CONTRACT.bundleId, controller.signal),
    /cancelled during bounded read/,
  );
});

void test('abort after key mutation returns a recovery receipt while retaining actual storage outcome', async (t) => {
  const state = await fixture({ [IOS_LANGUAGE_STORAGE_CONTRACT.key]: 'pt-BR', unrelated: 'keep' });
  t.after(state.cleanup);
  const controller = new AbortController();
  const auth = { sessionPresent: true };
  const domain = { stable: true };
  const reset = await resetIosLanguageOverride({
    dataRoot: state.root,
    quiescence: quiescence(),
    captureRunId: CAPTURE,
    deviceId: UDID,
    authBefore: auth,
    domainBefore: domain,
    readAuthAfter: () => {
      controller.abort(new Error('cancelled after reset mutation'));
      return Promise.resolve(auth);
    },
    readDomainAfter: () => Promise.resolve(domain),
    signal: controller.signal,
  });
  assert.equal(reset.status, 'failed-recovery-required');
  if (reset.status !== 'failed-recovery-required') throw new Error('missing recovery receipt');
  assert.equal(reset.failure.phase, 'post-mutation-preservation');
  assert.equal(reset.after?.status, 'absent');
  assert.equal((await readIosLanguageOverride(state.root)).status, 'absent');
});

void test('storage reader rejects symlinked key files instead of reading foreign bytes', async (t) => {
  const state = await fixture({ [IOS_LANGUAGE_STORAGE_CONTRACT.key]: null });
  t.after(state.cleanup);
  const keyFile = createHash('md5').update(IOS_LANGUAGE_STORAGE_CONTRACT.key).digest('hex');
  const foreign = path.join(state.root, 'foreign-value');
  await writeFile(foreign, 'pt-BR', { mode: 0o600 });
  await symlink(foreign, path.join(state.storage, keyFile));
  await assert.rejects(readIosLanguageOverride(state.root), /storage file|language storage/);
});

void test('storage reader rejects dangling intermediate layout symlinks instead of treating them as absent', async (t) => {
  const state = await fixture(null);
  t.after(state.cleanup);
  await rm(path.join(state.root, 'Library'), { recursive: true, force: true });
  await symlink(path.join(state.root, 'missing-library-target'), path.join(state.root, 'Library'));
  await assert.rejects(readIosLanguageOverride(state.root), /dangling symlink|language storage/);
});

void test('quiescence census rejects malformed rows instead of dropping them', () => {
  assert.deepEqual(
    parseIosLocaleQuiescenceProcessCensus(
      Buffer.from('101 /usr/bin/other\n202 /Applications/com.edufelip.mychampions.dev\n'),
      IOS_LANGUAGE_STORAGE_CONTRACT.bundleId,
    ),
    [{ pid: 202, command: '/Applications/com.edufelip.mychampions.dev' }],
  );
  assert.throws(
    () =>
      parseIosLocaleQuiescenceProcessCensus(
        Buffer.from('malformed-row\n'),
        IOS_LANGUAGE_STORAGE_CONTRACT.bundleId,
      ),
    /malformed/,
  );
  assert.throws(
    () =>
      parseIosLocaleQuiescenceProcessCensus(
        Buffer.from('101 /usr/bin/other\nmalformed-row\n'),
        IOS_LANGUAGE_STORAGE_CONTRACT.bundleId,
      ),
    /malformed/,
  );
});

void test('quiescence stdout is owned, private, bounded and abort-aware before parsing', async (t) => {
  await ensureFixtureDirectory();
  const root = await mkdtemp(path.join(FIXTURE_DIRECTORY, '.quiescence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const file = path.join(root, 'quiescence.stdout');
  await writeFile(file, '101 /usr/bin/other\n', { mode: 0o600 });
  const observed = await readOwnedIosLocaleQuiescenceStdout(root, file);
  assert.equal(observed.size, Buffer.byteLength('101 /usr/bin/other\n'));
  await chmod(file, 0o644);
  await assert.rejects(readOwnedIosLocaleQuiescenceStdout(root, file), /bounded owned/);
  await chmod(file, 0o600);
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(
    readOwnedIosLocaleQuiescenceStdout(root, file, controller.signal),
    /cancelled/,
  );
  await writeFile(file, 'x'.repeat(64 * 1024 + 1), { mode: 0o600 });
  await assert.rejects(readOwnedIosLocaleQuiescenceStdout(root, file), /bounded owned/);
});

function binding(): NativeLocaleBinding {
  return {
    captureRunId: CAPTURE,
    sourceTreeHash: HASH,
    helperInputsHash: 'b'.repeat(64),
    target: {
      platform: 'ios',
      deviceId: UDID,
      osVersion: 'iOS 26.5',
      appId: IOS_LANGUAGE_STORAGE_CONTRACT.bundleId,
      binaryHash: 'c'.repeat(64),
      apiOrigin: 'http://127.0.0.1:18081/',
    },
  };
}

function successfulLocaleRead(
  stdoutText: string | null,
  attempted = true,
): NativeLocaleCommandRead {
  return {
    execution: 'completed',
    cleanup: 'cleaned',
    attempted,
    stdoutText,
    childExitCode: 0,
    childSignal: null,
    pid: 100,
    pgid: 100,
    logPath: 'owned.log',
    stdoutPath: 'owned.stdout',
  };
}

void test('iOS OS qualification requires the current AppleLanguages and AppleLocale reads together', () => {
  const valid = normalizeIosLocaleReadback({
    binding: binding(),
    appleLanguages: successfulLocaleRead('(\n    pt\n)'),
    appleLocale: successfulLocaleRead('pt_BR'),
  });
  assert.deepEqual(valid, {
    status: 'observed',
    source: 'ios-simctl-defaults',
    raw: 'pt_BR',
    resolved: 'pt-BR',
    normalization: 'platform-canonical',
  });
  assert.equal(
    normalizeIosLocaleReadback({
      binding: binding(),
      appleLanguages: successfulLocaleRead('(\n    en\n)'),
      appleLocale: successfulLocaleRead('pt_BR'),
    }).status,
    'invalid',
  );
  assert.equal(
    normalizeIosLocaleReadback({
      binding: binding(),
      appleLanguages: successfulLocaleRead(null, false),
      appleLocale: successfulLocaleRead('pt_BR'),
    }).status,
    'read-error',
  );
});

function diagnosticTree(input: {
  hydration: string;
  effective?: string;
  override: string;
  overrideValue?: string;
}): unknown {
  const ids = [
    `testing.locale.hydration.${input.hydration}`,
    ...(input.effective ? [`testing.locale.effective.${input.effective}`] : []),
    `testing.locale.override.${input.override}`,
    ...(input.overrideValue ? [`testing.locale.overrideValue.${input.overrideValue}`] : []),
  ];
  return {
    attributes: { testID: 'testing.locale.diagnostic' },
    children: ids.map((id) => ({ attributes: { testID: id } })),
  };
}

function frame(tree: unknown): IosLocaleHierarchyFrame {
  return {
    label: 'context',
    hierarchyPath: 'context-hierarchy.json',
    hierarchyHash: HASH,
    tree,
    captureRunId: CAPTURE,
    binding: binding(),
    observedAt: '2026-10-01T12:00:00.000Z',
  };
}

function override(
  status: NativeLocaleEvidence['override']['status'],
  value: NativeLocaleEvidence['override']['value'] = null,
): NativeLocaleEvidence['override'] {
  return { status, source: 'language-storage', value };
}

void test('context checkpoint binds diagnostic override to independently read storage', () => {
  const mismatch = evaluateIosLocaleContextCheckpoint({
    id: 'selected',
    frame: frame(
      diagnosticTree({
        hydration: 'hydrated',
        effective: 'pt-BR',
        override: 'present',
        overrideValue: 'pt-BR',
      }),
    ),
    storageOverride: override('absent'),
    expectedOsLocale: 'en-US',
    expectedLocale: 'pt-BR',
  });
  assert.equal(mismatch.qualification, 'blocked');
  assert.equal(mismatch.reason, 'storage-context-override-mismatch');

  const valid = evaluateIosLocaleContextCheckpoint({
    id: 'selected',
    frame: frame(
      diagnosticTree({
        hydration: 'hydrated',
        effective: 'pt-BR',
        override: 'present',
        overrideValue: 'pt-BR',
      }),
    ),
    storageOverride: override('present', 'pt-BR'),
    expectedOsLocale: 'en-US',
    expectedLocale: 'pt-BR',
  });
  assert.equal(valid.qualification, 'eligible');

  const pending = evaluateIosLocaleContextCheckpoint({
    id: 'initial-fallback',
    frame: frame(diagnosticTree({ hydration: 'pending', override: 'unobserved' })),
    storageOverride: override('absent'),
    expectedOsLocale: 'en-US',
    expectedLocale: 'en-US',
  });
  assert.equal(pending.qualification, 'blocked');
});

void test('language screen audit is separate and requires all options plus requested checkmark', () => {
  const tree = {
    attributes: { testID: 'settings.languageSelect.screen' },
    children: [
      ...['en-US', 'pt-BR', 'es-ES'].map((locale) => ({
        attributes: { testID: `settings.languageSelect.option.${locale}` },
      })),
      { attributes: { testID: 'settings.languageSelect.option.es-ES.checkmark' } },
    ],
  };
  assert.deepEqual(auditIosLocaleSelectionControls(tree, 'es-ES'), {
    status: 'observed',
    selectedLocale: 'es-ES',
  });
  assert.equal(auditIosLocaleSelectionControls(tree, 'pt-BR').status, 'blocked');
});

void test('coach receipt requires the fixture UID, role, session, terms, request and API identity', () => {
  const fixtureAuthUidHash = createHash('sha256').update('coach-auth-uid').digest('hex');
  const valid = {
    status: 'observed',
    role: 'coach',
    fixtureRole: 'professional',
    fixtureAuthUid: 'coach-auth-uid',
    sessionRunId: CAPTURE,
    signInRequestId: 12,
    signInStatus: 201,
    signInPathHash: createHash('sha256').update('/auth/email/sign-in').digest('hex'),
    apiPid: 9876,
    apiOrigin: 'http://127.0.0.1:18081/',
    sessionPresent: true,
    termsAccepted: true,
    acceptedTermsVersion: 'v1',
    sessionEvidence: {
      source: 'ios-auth-storage',
      status: 'session-present',
      profilePresent: true,
      profileAuthUidHash: fixtureAuthUidHash,
      observationHash: 'd'.repeat(64),
    },
    termsEvidence: {
      source: 'owned-sql-profile-snapshot',
      acceptedTermsVersion: 'v1',
      lockedRole: 'professional',
      authUidHash: fixtureAuthUidHash,
      snapshotHash: 'f'.repeat(64),
      runId: CAPTURE,
      scope: 'native-entry-ios',
    },
    homeSelector: 'pro.home.screen',
    homeHierarchy: {
      label: 'locale-coach-home',
      hierarchyPath: 'locale-coach-home-hierarchy.json',
      hierarchyHash: HASH,
      captureRunId: CAPTURE,
      binding: binding(),
      observedAt: '2026-10-01T12:00:00.000Z',
      selector: 'pro.home.screen',
    },
    observedAt: '2026-10-01T12:00:00.000Z',
  } as const;
  assert.deepEqual(
    validateIosLocaleCoachSignInReceipt(valid, {
      sessionRunId: CAPTURE,
      captureRunId: CAPTURE,
      fixtureAuthUid: 'coach-auth-uid',
      apiPid: 9876,
      apiOrigin: 'http://127.0.0.1:18081/',
      binding: binding(),
    }).fixtureAuthUid,
    'coach-auth-uid',
  );
  assert.throws(
    () =>
      validateIosLocaleCoachSignInReceipt(
        { ...valid, termsAccepted: false },
        {
          sessionRunId: CAPTURE,
          captureRunId: CAPTURE,
          fixtureAuthUid: 'coach-auth-uid',
          apiPid: 9876,
          apiOrigin: 'http://127.0.0.1:18081/',
          binding: binding(),
        },
      ),
    /unbound|incomplete|mismatched/,
  );
  const forgedHash = { toString: () => HASH };
  for (const forged of [
    { ...valid, sessionEvidence: { ...valid.sessionEvidence, observationHash: forgedHash } },
    { ...valid, termsEvidence: { ...valid.termsEvidence, snapshotHash: forgedHash } },
    { ...valid, homeHierarchy: { ...valid.homeHierarchy, hierarchyHash: forgedHash } },
  ]) {
    assert.throws(
      () =>
        validateIosLocaleCoachSignInReceipt(forged, {
          sessionRunId: CAPTURE,
          captureRunId: CAPTURE,
          fixtureAuthUid: 'coach-auth-uid',
          apiPid: 9876,
          apiOrigin: 'http://127.0.0.1:18081/',
          binding: binding(),
        }),
      /unbound|incomplete|mismatched/,
    );
  }
});

void test('effective locale deadlines cannot extend the caller cap', () => {
  assert.equal(validateIosLocaleEffectiveDeadline(15_000, 1_000), 1_000);
  assert.throws(() => validateIosLocaleEffectiveDeadline(15_000, 15_001), /extends/);
  assert.throws(() => validateIosLocaleEffectiveDeadline(15_000, 0), /invalid/);
});

void test('final receipt references require the exact command deadline and output hashes', () => {
  const receipt = {
    label: 'locale-os-read-languages-1',
    command: 'xcrun',
    argv: [],
    execution: 'completed' as const,
    cleanup: 'cleaned' as const,
    childExitCode: 0,
    childSignal: null,
    pid: 101,
    pgid: 101,
    startedAt: '2026-10-01T12:00:00.000Z',
    finishedAt: '2026-10-01T12:00:01.000Z',
    deadlineMs: 1000,
    captureRunId: CAPTURE,
    binding: binding(),
    log: {
      path: 'locale.log',
      uid: process.getuid?.() ?? 0,
      mode: 0o600,
      bytes: 1,
      sha256: HASH,
      canonical: true as const,
      symlink: false as const,
    },
    stdout: null,
  };
  const reference = {
    label: receipt.label,
    command: receipt.command,
    argv: receipt.argv,
    captureRunId: receipt.captureRunId,
    binding: receipt.binding,
    pid: receipt.pid,
    pgid: receipt.pgid,
    deadlineMs: 1000,
    logSha256: HASH,
    stdoutSha256: null,
  };
  assert.equal(commandReceiptReferencesMatch([reference], [receipt]), true);
  assert.equal(
    commandReceiptReferencesMatch([{ ...reference, logSha256: 'f'.repeat(64) }], [receipt]),
    false,
  );
  assert.equal(
    commandReceiptReferencesMatch([{ ...reference, deadlineMs: 1001 }], [receipt]),
    false,
  );
  assert.equal(
    commandReceiptReferencesMatch([{ ...reference, argv: ['wrong'] }], [receipt]),
    false,
  );
  assert.equal(
    commandReceiptReferencesMatch(
      [{ ...reference, captureRunId: 'fedcba9876543210fedcba98' }],
      [receipt],
    ),
    false,
  );
  assert.equal(commandReceiptReferencesMatch([{ ...reference, pid: 202 }], [receipt]), false);
  assert.equal(commandReceiptReferencesMatch([reference], [{ ...receipt, pgid: 0 }]), false);
});

void test('owned cleanup has an independent hard bound and retains the first recovery receipt', async () => {
  await ensureFixtureDirectory();
  const controller = new AbortController();
  let cleanupCalls = 0;
  const transport = createIosLocaleOwnedTransport({
    artifactRoot: FIXTURE_DIRECTORY,
    sourceRoot: process.cwd(),
    cwd: process.cwd(),
    output: FIXTURE_DIRECTORY,
    captureRunId: CAPTURE,
    binding: binding(),
    device: { udid: UDID, runtime: 'iOS 26.5' },
    bundleId: IOS_LANGUAGE_STORAGE_CONTRACT.bundleId,
    metroPort: 8081,
    apiPid: 101,
    effectiveCommandDeadline: (requestedMs: number) => requestedMs,
    signal: controller.signal,
    verifyTarget: () => Promise.resolve(undefined),
    build: {
      qualification: 'qualified',
      sourceTreeHash: HASH,
      helperInputsHash: 'b'.repeat(64),
      binaryHash: 'c'.repeat(64),
      bundleId: IOS_LANGUAGE_STORAGE_CONTRACT.bundleId,
      apiOrigin: binding().target.apiOrigin,
      backendApiOrigin: 'http://127.0.0.1:19001',
      reusedFrom: null,
    },
    fixtures: {
      accounts: {
        coach: {
          email: 'coach@example.invalid',
          password: 'x',
          authUid: 'fixture',
          role: 'professional',
        },
      },
    },
    sessionRunId: CAPTURE,
    readAppAuthMetadata: () => Promise.resolve({}),
    readAuthProfileSnapshot: () => Promise.resolve({}),
    readCoachSignInReceipt: () => {
      return Promise.reject(new Error('not reached'));
    },
    probeQuiescence: () => {
      return Promise.reject(new Error('not reached'));
    },
    readDomainSnapshot: () => Promise.resolve({}),
    cleanupOwned: async () => {
      cleanupCalls += 1;
      return new Promise<never>(() => undefined);
    },
    cleanupDeadlineMs: 10,
  });
  const startedAt = Date.now();
  await assert.rejects(transport.cleanup(), /requires recovery/);
  assert.ok(Date.now() - startedAt < 1_000);
  const receipt = transport.cleanupReceipt();
  assert.equal(receipt?.status, 'failed-recovery-required');
  assert.equal(receipt?.failure?.code, 'cleanup-timeout');
  assert.equal(receipt?.failure?.pendingOperation, true);
  await assert.rejects(transport.cleanup(), /requires recovery/);
  assert.equal(cleanupCalls, 1);
});

void test('scenario stops after the first failed prerequisite and retains cleanup outcome', async () => {
  const phaseReceipt = (operationId: string) => ({
    status: 'observed' as const,
    captureRunId: CAPTURE,
    operationId,
    startedAt: '2026-10-01T12:00:00.000Z',
    finishedAt: '2026-10-01T12:00:01.000Z',
    reason: null,
    commandReceiptRefs: [],
  });
  let laterMutations = 0;
  let cleanupCalls = 0;
  const result = await runIosLocaleScenario(
    {
      scenarioId: 'locale-selection-persistence',
      requestedLocale: 'pt-BR',
      expectedBinding: binding(),
      baselineOsLocale: 'en-US',
    },
    {
      platform: 'ios',
      contextCleanupOwner: 'scenario',
      prepareFreshTarget: () => {
        return Promise.reject(new Error('fresh-target-failed'));
      },
      setOsLocale: () => {
        laterMutations += 1;
        return Promise.resolve(phaseReceipt('set-os'));
      },
      readOsLocale: () => {
        laterMutations += 1;
        return Promise.reject(new Error('read-os-should-not-run'));
      },
      readOverride: () => {
        laterMutations += 1;
        return Promise.reject(new Error('override-should-not-run'));
      },
      launch: () => {
        laterMutations += 1;
        return Promise.resolve(phaseReceipt('launch'));
      },
      runNormalFlow: () => {
        laterMutations += 1;
        return Promise.resolve(phaseReceipt('flow'));
      },
      captureHierarchy: () => {
        laterMutations += 1;
        return Promise.reject(new Error('hierarchy-should-not-run'));
      },
      auditSelection: () => ({
        status: 'blocked' as const,
        reason: 'language-screen-missing' as const,
      }),
      saveSelection: () => {
        laterMutations += 1;
        return Promise.resolve(phaseReceipt('save'));
      },
      clearOverride: () => {
        laterMutations += 1;
        return Promise.reject(new Error('clear-should-not-run'));
      },
      cleanup: () => {
        cleanupCalls += 1;
        return Promise.resolve(phaseReceipt('cleanup'));
      },
      commandReceipts: () => [],
      appContainerReceipt: () => null,
      coachSignInReceipt: () => null,
      cleanupReceipt: () => null,
    },
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.cleanupAttempted, true);
  assert.equal(result.cleanupObserved, true);
  assert.equal(result.cleanupError, null);
  assert.equal(cleanupCalls, 1);
  assert.equal(laterMutations, 0);
  assert.deepEqual(
    result.steps.map((step) => step.id),
    ['fresh-target', 'cleanup'],
  );
  assert.equal(result.blockers.includes('stopped-after-step-failure'), true);
});

void test('outer-owned scenario never invokes transport cleanup', async () => {
  const phaseReceipt = (operationId: string) => ({
    status: 'observed' as const,
    captureRunId: CAPTURE,
    operationId,
    startedAt: '2026-10-01T12:00:00.000Z',
    finishedAt: '2026-10-01T12:00:01.000Z',
    reason: null,
    commandReceiptRefs: [],
  });
  let cleanupCalls = 0;
  const result = await runIosLocaleScenario(
    {
      scenarioId: 'locale-selection-persistence',
      requestedLocale: 'pt-BR',
      expectedBinding: binding(),
      baselineOsLocale: 'en-US',
    },
    {
      platform: 'ios',
      contextCleanupOwner: 'outer-capture',
      prepareFreshTarget: () => Promise.reject(new Error('fresh-target-failed')),
      setOsLocale: () => Promise.resolve(phaseReceipt('set-os')),
      readOsLocale: () => Promise.reject(new Error('read-os-should-not-run')),
      readOverride: () => Promise.reject(new Error('override-should-not-run')),
      launch: () => Promise.resolve(phaseReceipt('launch')),
      runNormalFlow: () => Promise.resolve(phaseReceipt('flow')),
      captureHierarchy: () => Promise.reject(new Error('hierarchy-should-not-run')),
      auditSelection: () => ({
        status: 'blocked' as const,
        reason: 'language-screen-missing' as const,
      }),
      saveSelection: () => Promise.resolve(phaseReceipt('save')),
      clearOverride: () => Promise.reject(new Error('clear-should-not-run')),
      cleanup: () => {
        cleanupCalls += 1;
        return Promise.reject(new Error('outer capture owns cleanup'));
      },
      commandReceipts: () => [],
      appContainerReceipt: () => null,
      coachSignInReceipt: () => null,
      cleanupReceipt: () => null,
    },
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.cleanupOwner, 'outer-capture');
  assert.equal(result.cleanupAttempted, false);
  assert.equal(result.cleanupObserved, false);
  assert.equal(result.cleanupError, null);
  assert.equal(cleanupCalls, 0);
  assert.deepEqual(
    result.steps.map((step) => step.id),
    ['fresh-target'],
  );
});

void test('binding guard rejects stale or non-owned identity before transport setup', () => {
  assert.equal(buildIosLocaleBindingGuard(binding()).captureRunId, CAPTURE);
  assert.throws(() => buildIosLocaleBindingGuard({ ...binding(), captureRunId: 'not-a-run' }));
  assert.equal(IOS_LOCALE_RUNTIME_CONTRACT.publicLocale, null);
  assert.equal(IOS_LOCALE_RUNTIME_CONTRACT.runtimeQualification, 'pending');
});
