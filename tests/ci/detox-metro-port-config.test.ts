import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const candidateRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const configPath = path.join(candidateRoot, '.detoxrc.js');
const childScript = `
  const config = require(process.argv[1]);
  process.stdout.write(JSON.stringify({
    iosLaunch: config.apps['ios.debug'].launchArgs.RCT_jsLocation,
    iosBuild: config.apps['ios.debug'].build,
    androidReversePorts: config.apps['android.debug'].reversePorts,
    androidBuild: config.apps['android.debug'].build,
  }));
`;
const portKeys = [
  'DETOX_METRO_PORT',
  'DETOX_IOS_METRO_PORT',
  'DETOX_CONNECTION_PLATFORM',
  'DETOX_BASELINE_PLATFORM',
];

function loadConfig(overrides: Record<string, string | undefined>) {
  const env = { ...process.env };
  for (const key of portKeys) delete env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const child = spawnSync(process.execPath, ['-e', childScript, configPath], {
    cwd: candidateRoot,
    env,
    encoding: 'utf8',
  });
  return child;
}

function readConfig(overrides: Record<string, string | undefined>) {
  const child = loadConfig(overrides);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.error, undefined);
  return JSON.parse(child.stdout) as {
    iosLaunch: string;
    iosBuild: string;
    androidReversePorts: number[];
    androidBuild: string;
  };
}

void test('spawned Detox config keeps legacy shared ports and Android ceilings', () => {
  const legacy = readConfig({ DETOX_METRO_PORT: '18081' });
  assert.equal(legacy.iosLaunch, 'localhost:18081');
  assert.deepEqual(legacy.androidReversePorts, [18081]);
  assert.match(legacy.iosBuild, /RCT_METRO_PORT="18081"/);

  const androidMaximum = readConfig({
    DETOX_METRO_PORT: '49151',
    DETOX_CONNECTION_PLATFORM: 'android',
  });
  assert.deepEqual(androidMaximum.androidReversePorts, [49151]);
  assert.match(androidMaximum.androidBuild, /-PdetoxMetroPort=49151/);
});

void test('spawned iOS config accepts a qualified 51339 port without widening Android', () => {
  const markedShared = readConfig({
    DETOX_METRO_PORT: '51339',
    DETOX_CONNECTION_PLATFORM: 'ios',
  });
  assert.equal(markedShared.iosLaunch, 'localhost:51339');
  assert.match(markedShared.iosBuild, /RCT_METRO_PORT="51339"/);
  assert.deepEqual(markedShared.androidReversePorts, [8081]);
  assert.match(markedShared.androidBuild, /-PdetoxMetroPort=8081/);

  const baselineMarked = readConfig({
    DETOX_METRO_PORT: '51339',
    DETOX_BASELINE_PLATFORM: 'ios',
  });
  assert.equal(baselineMarked.iosLaunch, 'localhost:51339');
  assert.match(baselineMarked.iosBuild, /RCT_METRO_PORT="51339"/);
  assert.deepEqual(baselineMarked.androidReversePorts, [8081]);

  const explicitOverride = readConfig({
    DETOX_METRO_PORT: '18081',
    DETOX_IOS_METRO_PORT: '51339',
  });
  assert.equal(explicitOverride.iosLaunch, 'localhost:51339');
  assert.match(explicitOverride.iosBuild, /RCT_METRO_PORT="51339"/);
  assert.deepEqual(explicitOverride.androidReversePorts, [18081]);
});

void test('spawned config rejects an unmarked high shared port and invalid Android/iOS overrides', () => {
  const unmarkedHigh = loadConfig({ DETOX_METRO_PORT: '51339' });
  assert.notEqual(unmarkedHigh.status, 0);
  assert.match(unmarkedHigh.stderr, /DETOX_METRO_PORT.*49151/);

  const androidHigh = loadConfig({
    DETOX_METRO_PORT: '51339',
    DETOX_CONNECTION_PLATFORM: 'android',
  });
  assert.notEqual(androidHigh.status, 0);
  assert.match(androidHigh.stderr, /DETOX_METRO_PORT.*49151/);

  const invalidIos = loadConfig({ DETOX_IOS_METRO_PORT: '65536' });
  assert.notEqual(invalidIos.status, 0);
  assert.match(invalidIos.stderr, /DETOX_IOS_METRO_PORT.*65535/);
});
