import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { requireOwnedIosInstalledAppBinding } from '../../scripts/testing/native-camera-observation';

const ownerPath = path.join(
  __dirname,
  '../../scripts/testing/native-detox-camera-ios-current-owner.ts',
);
const producerPath = path.join(
  __dirname,
  '../../scripts/testing/native-detox-camera-ios-producer.ts',
);

void test('V23 binds the launched app container to the owned simulator and qualified build', async () => {
  const expected = {
    deviceUdid: 'owned-sim-1',
    bundleId: 'com.edufelip.mychampions.dev',
    binaryHash: 'a'.repeat(64),
  } as const;
  const valid = {
    source: 'owned-simulator-installed-app',
    ...expected,
    appContainerPath:
      '/Users/owned/Library/Developer/CoreSimulator/Devices/owned-sim-1/Containers/Bundle/Application/mychampions.app',
  } as const;
  assert.deepEqual(requireOwnedIosInstalledAppBinding(valid, expected), valid);
  for (const invalid of [
    { ...valid, deviceUdid: 'foreign-sim' },
    { ...valid, bundleId: 'com.foreign.app' },
    { ...valid, binaryHash: 'b'.repeat(64) },
    { ...valid, appContainerPath: '/tmp/foreign.app' },
    { ...valid, appContainerPath: `${valid.appContainerPath}\nforeign` },
  ])
    assert.throws(() => requireOwnedIosInstalledAppBinding(invalid, expected));

  const owner = await readFile(ownerPath, 'utf8');
  const producer = await readFile(producerPath, 'utf8');
  const bootstrap = owner.indexOf("ipc.request({ kind: 'bootstrap', actor: 'student' })");
  const installed = owner.indexOf('verifyOwnedIosInstalledApp', bootstrap);
  const permission = owner.indexOf('readOwnedIosCameraPermission(', installed);
  assert(bootstrap >= 0 && installed > bootstrap && permission > installed);
  assert.match(owner, /options\.build\.binaryHash/);
  assert.match(owner, /installedApp/);
  assert.doesNotMatch(owner, /simctl',\s*\['install'/);
  assert.match(producer, /requireOwnedIosInstalledAppBinding\(context\.installedApp/);
});
