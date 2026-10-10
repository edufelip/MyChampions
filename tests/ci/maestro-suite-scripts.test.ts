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
