import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const installer = 'scripts/testing/install-maestro.sh';
const installerSource = readFileSync(installer, 'utf8');
const pinnedSha256 = installerSource.match(/^zip_sha256=([0-9a-f]{64})$/m)?.[1];
const sandboxes: string[] = [];

after(() => {
  for (const sandbox of sandboxes) rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Runs the real installer offline: a curl shim "downloads" a file that is not
 * the Maestro release zip, and an optional fake cached binary logs each run.
 */
function runInstaller(cache: { binary: boolean; marker?: string } | null) {
  const sandbox = mkdtempSync(join(tmpdir(), 'install-maestro-'));
  sandboxes.push(sandbox);
  const shims = join(sandbox, 'shims');
  const versionRoot = join(sandbox, 'home', '2.10.0');
  const binary = join(versionRoot, 'maestro', 'bin', 'maestro');
  const downloads = join(sandbox, 'downloads.log');
  const binaryRuns = join(sandbox, 'binary-runs.log');
  mkdirSync(shims);
  writeFileSync(
    join(shims, 'curl'),
    `#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; *) shift;; esac; done\necho download >> '${downloads}'\necho 'not the Maestro release zip' > "$out"\n`,
  );
  chmodSync(join(shims, 'curl'), 0o755);
  mkdirSync(versionRoot, { recursive: true });
  writeFileSync(join(versionRoot, 'sentinel'), 'existing install\n');
  if (cache?.binary) {
    mkdirSync(join(versionRoot, 'maestro', 'bin'), { recursive: true });
    writeFileSync(binary, `#!/bin/sh\necho run >> '${binaryRuns}'\necho 2.10.0\n`);
    chmodSync(binary, 0o755);
  }
  if (cache?.marker) writeFileSync(join(versionRoot, 'maestro.zip.sha256'), `${cache.marker}\n`);

  const result = spawnSync('bash', [installer], {
    env: {
      ...process.env,
      PATH: `${shims}:${process.env.PATH}`,
      MAESTRO_SUITE_HOME: join(sandbox, 'home'),
    },
    encoding: 'utf8',
  });
  const lines = (path: string) =>
    existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).length : 0;
  return {
    ...result,
    binary,
    versionRoot,
    downloads: lines(downloads),
    binaryRuns: lines(binaryRuns),
  };
}

void test('install-maestro pins the cli-2.10.0 zip by SHA-256 and checks it before unpacking', () => {
  assert.match(installerSource, /^version=2\.10\.0$/m);
  assert.ok(pinnedSha256, 'install-maestro.sh must pin zip_sha256');
  const verify = installerSource.indexOf('shasum -a 256 "$tmp/maestro.zip"');
  const unpack = installerSource.indexOf('unzip -q "$tmp/maestro.zip"');
  const record = installerSource.indexOf('printf \'%s\\n\' "$zip_sha256" > "$marker"');
  assert.ok(verify !== -1 && verify < unpack, 'verify the zip before unzip');
  assert.ok(unpack !== -1 && unpack < record, 'record the hash only after unzip');
});

void test('install-maestro refuses a download that does not match the pinned hash', () => {
  const result = runInstaller(null);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA-256 mismatch/);
  assert.equal(result.stdout, '');
  assert.equal(result.downloads, 1);
  // Nothing was unpacked and the existing install folder was left alone.
  assert.ok(existsSync(join(result.versionRoot, 'sentinel')));
  assert.ok(!existsSync(join(result.versionRoot, 'maestro')));
});

void test('install-maestro never runs a cached install that did not record the pinned hash', () => {
  for (const marker of [undefined, '0'.repeat(64)]) {
    const result = runInstaller({ binary: true, marker });

    assert.equal(result.binaryRuns, 0, `marker=${marker}`);
    assert.equal(result.downloads, 1, `marker=${marker}`);
    assert.equal(result.status, 1, `marker=${marker}`);
  }
});

void test('install-maestro reuses a cached install that recorded the pinned hash', () => {
  const result = runInstaller({ binary: true, marker: pinnedSha256 });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${result.binary}\n`);
  assert.equal(result.downloads, 0);
});

void test('Maestro device prep opts out of analytics like the flow runner', () => {
  const devicePrep = readFileSync('scripts/testing/maestro-device.sh', 'utf8');
  const firstMaestroRun = devicePrep.indexOf('"$maestro_bin"');

  for (const optOut of [
    'export MAESTRO_CLI_NO_ANALYTICS=1',
    'export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true',
  ]) {
    const index = devicePrep.indexOf(optOut);
    assert.ok(index !== -1 && index < firstMaestroRun, optOut);
  }
});

// The app every suite flow launches with clearState; device prep must pin this same id.
const suiteAppId = readFileSync('.maestro/suite/common/launch-fresh.yaml', 'utf8').match(
  /^appId: (\S+)$/m,
)?.[1];

type FakeAndroidDevice = {
  api?: string;
  persistLocale?: string;
  productLocale?: string;
  appLocales?: string;
};

/**
 * Runs the real Android device prep against a fake adb that logs every call and
 * answers getprop / get-app-locales from the given device state.
 */
function runAndroidDevicePrep(device: FakeAndroidDevice = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), 'maestro-device-'));
  sandboxes.push(sandbox);
  const shims = join(sandbox, 'shims');
  const adbLog = join(sandbox, 'adb.log');
  const apk = join(sandbox, 'app-dev-debug.apk');
  mkdirSync(shims);
  writeFileSync(apk, 'not a real apk\n');
  writeFileSync(
    join(shims, 'adb'),
    [
      '#!/bin/sh',
      `echo "$*" >> '${adbLog}'`,
      'case "$*" in',
      '  *"getprop ro.build.version.sdk") echo "$FAKE_API" ;;',
      '  *"getprop persist.sys.locale") echo "$FAKE_PERSIST_LOCALE" ;;',
      '  *"getprop ro.product.locale") echo "$FAKE_PRODUCT_LOCALE" ;;',
      '  *"cmd locale get-app-locales "*) echo "Locales for $7 for user -2 are [$FAKE_APP_LOCALES]" ;;',
      'esac',
      '',
    ].join('\n'),
  );
  chmodSync(join(shims, 'adb'), 0o755);

  const result = spawnSync(
    'bash',
    ['scripts/testing/maestro-device.sh', '--platform', 'android', '--app', apk],
    {
      env: {
        ...process.env,
        PATH: `${shims}:${process.env.PATH}`,
        ANDROID_SERIAL: 'emulator-5554',
        FAKE_API: device.api ?? '36',
        FAKE_PERSIST_LOCALE: device.persistLocale ?? '',
        FAKE_PRODUCT_LOCALE: device.productLocale ?? 'en-US',
        FAKE_APP_LOCALES: device.appLocales ?? 'en-US',
      },
      encoding: 'utf8',
    },
  );
  const calls = existsSync(adbLog) ? readFileSync(adbLog, 'utf8').split('\n').filter(Boolean) : [];
  const callIndex = (fragment: string) => calls.findIndex((call) => call.includes(fragment));
  return { ...result, calls, callIndex };
}

void test('Android device prep pins the suite app to en-US after install and checks it', () => {
  assert.ok(suiteAppId, 'launch-fresh.yaml must declare the suite appId');
  const result = runAndroidDevicePrep();

  assert.equal(result.status, 0, result.stderr);
  const install = result.callIndex(' install -r -t ');
  const pin = result.callIndex(' cmd locale set-app-locales ');
  const check = result.callIndex(' cmd locale get-app-locales ');
  assert.ok(install !== -1 && install < pin && pin < check, result.calls.join('\n'));
  assert.equal(
    result.calls[pin],
    `-s emulator-5554 shell cmd locale set-app-locales ${suiteAppId} --user current --locales en-US`,
  );
  assert.equal(
    result.calls[check],
    `-s emulator-5554 shell cmd locale get-app-locales ${suiteAppId} --user current`,
  );
  assert.ok(
    result.stdout.includes(`Pinned ${suiteAppId} to en-US on emulator-5554.`),
    result.stdout,
  );
});

void test('Android device prep fails when get-app-locales does not report en-US', () => {
  for (const appLocales of ['', 'pt-BR', 'en-US,pt-BR']) {
    const result = runAndroidDevicePrep({ appLocales });

    assert.equal(result.status, 1, `appLocales=${appLocales}`);
    assert.match(result.stderr, /Could not pin \S+ to en-US on emulator-5554/);
    assert.ok(result.stderr.includes(`are [${appLocales}]`), result.stderr);
  }
});

void test('Android device prep requires API 33+ before installing', () => {
  for (const api of ['32', '']) {
    const result = runAndroidDevicePrep({ api });

    assert.equal(result.status, 1, `api=${api}`);
    assert.match(result.stderr, /needs API 33\+ \(Android 13\)/);
    assert.equal(result.callIndex(' install '), -1, `api=${api}`);
    assert.equal(result.callIndex(' cmd locale '), -1, `api=${api}`);
  }
  assert.equal(runAndroidDevicePrep({ api: '33' }).status, 0);
});

void test('Android device prep requires an en-US system language before installing', () => {
  // clearState runs `pm clear`, which drops the per-app language, so each flow
  // renders in the system language: persist.sys.locale, else ro.product.locale.
  const cases: [FakeAndroidDevice, boolean][] = [
    [{ persistLocale: '', productLocale: 'en-US' }, true],
    [{ persistLocale: 'en-US-u-mu-celsius', productLocale: 'pt-BR' }, true],
    [{ persistLocale: 'pt-BR', productLocale: 'en-US' }, false],
    [{ persistLocale: '', productLocale: 'es-ES' }, false],
    [{ persistLocale: 'en-GB', productLocale: 'en-US' }, false],
    [{ persistLocale: '', productLocale: '' }, false],
  ];
  for (const [device, ok] of cases) {
    const result = runAndroidDevicePrep(device);
    const label = JSON.stringify(device);

    assert.equal(result.status, ok ? 0 : 1, `${label}\n${result.stderr}`);
    if (!ok) {
      assert.match(result.stderr, /the suite needs en-US because each flow's clearState/, label);
      assert.equal(result.callIndex(' install '), -1, label);
    }
  }
});
