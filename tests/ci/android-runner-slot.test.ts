import assert from 'node:assert/strict';
import test from 'node:test';
import {
  androidRunnerSlotEnvironment,
  parseAndroidRunnerSlot,
} from '../../scripts/ci/android-runner-slot';

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    MYCHAMPIONS_ANDROID_SLOT_ID: 'mychampions-android-a',
    MYCHAMPIONS_ANDROID_AVD: 'Pixel_10',
    MYCHAMPIONS_ANDROID_AVD_HOME: '/var/lib/mychampions/mychampions-android-a/avd',
    MYCHAMPIONS_ANDROID_USER_HOME: '/var/lib/mychampions/mychampions-android-a/user',
    MYCHAMPIONS_ANDROID_RECOVERY_ROOT: '/var/lib/mychampions/mychampions-android-a/recovery',
    MYCHAMPIONS_ANDROID_LOG_ROOT: '/var/lib/mychampions/mychampions-android-a/logs',
    MYCHAMPIONS_ANDROID_TEMP_ROOT: '/var/lib/mychampions/mychampions-android-a/temp',
    MYCHAMPIONS_ANDROID_LOCK_ROOT: '/var/lib/mychampions/mychampions-android-a/lock',
    MYCHAMPIONS_ANDROID_EMULATOR_PORT: '5556',
    MYCHAMPIONS_ANDROID_EMULATOR_SERIAL: 'emulator-5556',
    MYCHAMPIONS_ANDROID_ADB_SERVER_PORT: '5038',
    MYCHAMPIONS_ANDROID_METRO_PORT: '18082',
  };
}

test('Android runner slot parsing derives an isolated, exact port contract', () => {
  const slot = parseAndroidRunnerSlot(validEnvironment());

  assert.deepEqual(
    {
      slotId: slot.slotId,
      avd: slot.avd,
      emulatorPort: slot.emulatorPort,
      emulatorSerial: slot.emulatorSerial,
      adbServerPort: slot.adbServerPort,
      metroPort: slot.metroPort,
    },
    {
      slotId: 'mychampions-android-a',
      avd: 'Pixel_10',
      emulatorPort: 5556,
      emulatorSerial: 'emulator-5556',
      adbServerPort: 5038,
      metroPort: 18082,
    },
  );
});

test('Android runner slot environment exports Detox and exact cleanup namespaces', () => {
  const values = androidRunnerSlotEnvironment(parseAndroidRunnerSlot(validEnvironment()));

  assert.equal(values.ADB_SERVER_PORT, '5038');
  assert.equal(values.ANDROID_ADB_SERVER_PORT, '5038');
  assert.equal(values.MYCHAMPIONS_ANDROID_ADB_SERVER_PORT, '5038');
  assert.equal(values.ANDROID_SERIAL, 'emulator-5556');
  assert.equal(values.ANDROID_TMPDIR, '/var/lib/mychampions/mychampions-android-a/temp');
  assert.equal(values.DETOX_ANDROID_DEVICE, 'emulator-5556');
  assert.equal(values.DETOX_METRO_PORT, '18082');
  assert.equal(
    values.MYCHAMPIONS_NATIVE_STATE_ROOT,
    '/var/lib/mychampions/mychampions-android-a/recovery',
  );
  assert.equal(values.ANDROID_AVD_HOME, '/var/lib/mychampions/mychampions-android-a/avd');
});

test('Android runner slot rejects an unscoped slot, serial mismatch, and port collision', () => {
  const unscoped = validEnvironment();
  unscoped.MYCHAMPIONS_ANDROID_SLOT_ID = 'meer-android';
  assert.throws(() => parseAndroidRunnerSlot(unscoped), /mychampions-\*/);

  const serialMismatch = validEnvironment();
  serialMismatch.MYCHAMPIONS_ANDROID_EMULATOR_SERIAL = 'emulator-5554';
  assert.throws(() => parseAndroidRunnerSlot(serialMismatch), /must match/);

  const collision = validEnvironment();
  collision.MYCHAMPIONS_ANDROID_METRO_PORT = '5557';
  assert.throws(() => parseAndroidRunnerSlot(collision), /ports must be distinct/);

  const sharedPath = validEnvironment();
  sharedPath.MYCHAMPIONS_ANDROID_TEMP_ROOT = sharedPath.MYCHAMPIONS_ANDROID_LOG_ROOT;
  assert.throws(() => parseAndroidRunnerSlot(sharedPath), /must be separate slot directories/);
});

test('Android runner slot rejects unsafe paths, invalid ports, and missing values', () => {
  const unsafePath = validEnvironment();
  unsafePath.MYCHAMPIONS_ANDROID_LOG_ROOT = 'relative/logs';
  assert.throws(() => parseAndroidRunnerSlot(unsafePath), /absolute path/);

  const oddPort = validEnvironment();
  oddPort.MYCHAMPIONS_ANDROID_EMULATOR_PORT = '5555';
  oddPort.MYCHAMPIONS_ANDROID_EMULATOR_SERIAL = 'emulator-5555';
  assert.throws(() => parseAndroidRunnerSlot(oddPort), /even console port/);

  const missing = validEnvironment();
  delete missing.MYCHAMPIONS_ANDROID_RECOVERY_ROOT;
  assert.throws(() => parseAndroidRunnerSlot(missing), /RECOVERY_ROOT is required/);
});
