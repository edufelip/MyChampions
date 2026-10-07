const path = require('node:path');

const rawMetroPort = process.env.DETOX_METRO_PORT || '8081';
if (!/^[0-9]+$/.test(rawMetroPort)) {
  throw new Error('DETOX_METRO_PORT must contain only decimal digits');
}
const rawIosMetroPort = process.env.DETOX_IOS_METRO_PORT ?? rawMetroPort;
const executionPlatform =
  process.env.DETOX_CONNECTION_PLATFORM ?? process.env.DETOX_BASELINE_PLATFORM;
const iosPlatformExecution = executionPlatform === 'ios';
const iosMetroPortOverride = process.env.DETOX_IOS_METRO_PORT !== undefined;

function parseMetroPort(name, raw, maximum) {
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${name} must contain only decimal digits`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1024 || parsed > maximum) {
    throw new Error(`${name} must be an unprivileged port from 1024 to ${maximum}`);
  }
  return parsed;
}

const sharedMetroPortMaximum = iosPlatformExecution && !iosMetroPortOverride ? 65535 : 49151;
const parsedMetroPort = parseMetroPort('DETOX_METRO_PORT', rawMetroPort, sharedMetroPortMaximum);
const iosMetroPort = parseMetroPort(
  iosMetroPortOverride ? 'DETOX_IOS_METRO_PORT' : 'DETOX_METRO_PORT',
  rawIosMetroPort,
  65535,
);
// A high iOS-only shared value is accepted only for an explicitly iOS-marked
// process. The config still defines Android apps, so keep their reverse/build
// port inside Android's 49151 ceiling rather than leaking the iOS value.
const androidMetroPort = parsedMetroPort <= 49151 ? parsedMetroPort : 8081;
const iosSimulatorDevice = process.env.DETOX_IOS_SIMULATOR_UDID
  ? { id: process.env.DETOX_IOS_SIMULATOR_UDID }
  : { type: process.env.DETOX_IOS_SIMULATOR || 'iPhone 17' };

function iosDebugBinaryPath(defaultPath) {
  const override = process.env.DETOX_IOS_VERIFIED_BINARY_PATH;
  if (override === undefined) return defaultPath;
  const runId = process.env.DETOX_IOS_VERIFIED_BINARY_RUN_ID;
  const hash = process.env.DETOX_IOS_VERIFIED_BINARY_HASH;
  const profilePath = process.env.DETOX_IOS_VERIFIED_BINARY_PROFILE_PATH;
  const identity = process.env.DETOX_IOS_VERIFIED_BINARY_IDENTITY;
  if (
    !path.isAbsolute(override) ||
    path.normalize(override) !== override ||
    !/^[a-f0-9]{24}$/.test(runId || '') ||
    !/^[a-f0-9]{64}$/.test(hash || '') ||
    profilePath !== path.resolve(defaultPath) ||
    !identity
  )
    throw new Error('DETOX_IOS_VERIFIED_BINARY_PATH requires a complete qualified reuse receipt');
  const expectedReusePath = path.resolve(
    '.qa/artifacts/native-pilot',
    runId,
    'ios-build/Build/Products/Debug-iphonesimulator/mychampions.app',
  );
  if (override !== expectedReusePath)
    throw new Error('DETOX_IOS_VERIFIED_BINARY_PATH is outside the qualified artifact path');
  let parsedIdentity;
  try {
    parsedIdentity = JSON.parse(identity);
  } catch {
    throw new Error('DETOX_IOS_VERIFIED_BINARY_IDENTITY is invalid');
  }
  for (const key of ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs']) {
    if (!Number.isFinite(parsedIdentity?.[key]) || parsedIdentity[key] < 0)
      throw new Error('DETOX_IOS_VERIFIED_BINARY_IDENTITY is incomplete');
  }
  return override;
}

function androidDebugBinaryPaths(defaultBinaryPath, defaultTestBinaryPath) {
  const binaryPath = process.env.DETOX_ANDROID_VERIFIED_BINARY_PATH;
  const testBinaryPath = process.env.DETOX_ANDROID_VERIFIED_TEST_BINARY_PATH;
  if (binaryPath === undefined && testBinaryPath === undefined)
    return { binaryPath: defaultBinaryPath, testBinaryPath: defaultTestBinaryPath };
  const runId = process.env.DETOX_ANDROID_VERIFIED_BINARY_RUN_ID;
  const binaryHash = process.env.DETOX_ANDROID_VERIFIED_BINARY_HASH;
  const testHash = process.env.DETOX_ANDROID_VERIFIED_TEST_BINARY_HASH;
  const profilePath = process.env.DETOX_ANDROID_VERIFIED_BINARY_PROFILE_PATH;
  const testProfilePath = process.env.DETOX_ANDROID_VERIFIED_TEST_BINARY_PROFILE_PATH;
  if (
    !path.isAbsolute(binaryPath || '') ||
    !path.isAbsolute(testBinaryPath || '') ||
    !/^[a-f0-9]{24}$/.test(runId || '') ||
    !/^[a-f0-9]{64}$/.test(binaryHash || '') ||
    !/^[a-f0-9]{64}$/.test(testHash || '') ||
    profilePath !== path.resolve(defaultBinaryPath) ||
    testProfilePath !== path.resolve(defaultTestBinaryPath)
  )
    throw new Error('Android verified APK paths require a complete qualified reuse receipt');
  const root = path.resolve('.qa/artifacts/native-pilot', runId, 'android-build/outputs/apk');
  if (
    binaryPath !== path.join(root, 'dev/debug/app-dev-debug.apk') ||
    testBinaryPath !== path.join(root, 'androidTest/dev/debug/app-dev-debug-androidTest.apk')
  )
    throw new Error('Android verified APK paths are outside the qualified artifact path');
  return { binaryPath, testBinaryPath };
}

const androidDebugBinaries = androidDebugBinaryPaths(
  'android/app/build/outputs/apk/dev/debug/app-dev-debug.apk',
  'android/app/build/outputs/apk/androidTest/dev/debug/app-dev-debug-androidTest.apk',
);

function requireAndroidCameraLaunchValue(name, pattern) {
  const value = process.env[name];
  if (typeof value !== 'string' || !pattern.test(value))
    throw new Error(`${name} is invalid for the owned Android camera launch`);
  return value;
}

function ownedAndroidCameraLaunchArgs() {
  if (process.env.DETOX_ANDROID_CAMERA_SCENARIO !== 'denied') return {};
  const ownerRunId = requireAndroidCameraLaunchValue(
    'DETOX_ANDROID_CAMERA_OWNER_RUN_ID',
    /^[a-f0-9]{24}$/,
  );
  return {
    detoxEnableSynchronization: 0,
    detoxCameraBridge: 'enabled',
    detoxCameraCaptureRunId: requireAndroidCameraLaunchValue(
      'DETOX_ANDROID_CAMERA_CAPTURE_RUN_ID',
      /^[a-f0-9]{24}$/,
    ),
    detoxCameraOwnerRunId: ownerRunId,
    detoxCameraAttemptId: requireAndroidCameraLaunchValue(
      'DETOX_ANDROID_CAMERA_ATTEMPT_ID',
      new RegExp(`^${ownerRunId}:first$`),
    ),
    detoxCameraSerial: requireAndroidCameraLaunchValue(
      'DETOX_ANDROID_CAMERA_SERIAL',
      /^(?:emulator-[0-9]+|[A-Za-z0-9._:-]{1,127})$/,
    ),
    detoxCameraAppId: requireAndroidCameraLaunchValue(
      'DETOX_ANDROID_CAMERA_APP_ID',
      /^com\.edufelip\.mychampions\.dev$/,
    ),
    detoxCameraLocale: requireAndroidCameraLaunchValue(
      'DETOX_ANDROID_CAMERA_LOCALE',
      /^(?:en-US|pt-BR|es-ES)$/,
    ),
    detoxCameraDeadlineAtEpochMs: requireAndroidCameraLaunchValue(
      'DETOX_ANDROID_CAMERA_DEADLINE_AT',
      /^[0-9]{13,}$/,
    ),
    detoxCameraCancelRelativePath: 'cancel.signal',
  };
}

const androidDebugLaunchArgs = ownedAndroidCameraLaunchArgs();

/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: process.env.DETOX_JEST_CONFIG || 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 300000,
    },
  },
  behavior: {
    init: {
      // The native-pilot owner installs the qualified APK pair, resets the
      // permission, and persists its run-bound bridge configuration before
      // starting Detox. A second Detox reinstall would erase that private
      // configuration before instrumentation can read it.
      reinstallApp: false,
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: iosDebugBinaryPath(
        'ios/build/Build/Products/Debug-iphonesimulator/mychampions.app',
      ),
      launchArgs: {
        RCT_jsLocation: `localhost:${iosMetroPort}`,
      },
      build: `xcodebuild -workspace ios/mychampions.xcworkspace -scheme mychampions -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build RCT_METRO_PORT="${iosMetroPort}"`,
    },
    'ios.release': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Release-iphonesimulator/mychampions.app',
      build:
        'xcodebuild -workspace ios/mychampions.xcworkspace -scheme mychampions -configuration Release -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: androidDebugBinaries.binaryPath,
      testBinaryPath: androidDebugBinaries.testBinaryPath,
      launchArgs: androidDebugLaunchArgs,
      build: `cd android && APP_VARIANT=dev EXPO_PUBLIC_ENV=dev ./gradlew -DtestBuildType=debug -PdetoxMetroPort=${androidMetroPort} app:assembleDevDebug app:assembleDevDebugAndroidTest`,
      reversePorts: [androidMetroPort],
    },
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/production/release/app-production-release.apk',
      testBinaryPath:
        'android/app/build/outputs/apk/androidTest/production/release/app-production-release-androidTest.apk',
      build: `cd android && APP_VARIANT=prod EXPO_PUBLIC_ENV=prod EXPO_NO_DEV_CLIENT=1 ./gradlew -DtestBuildType=release -PdetoxMetroPort=${androidMetroPort} -PCI_VERSION_CODE="\${CI_VERSION_CODE:?CI_VERSION_CODE_required}" app:assembleProductionRelease app:assembleProductionReleaseAndroidTest`,
    },
    'android.prodDebug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/production/debug/app-production-debug.apk',
      testBinaryPath:
        'android/app/build/outputs/apk/androidTest/production/debug/app-production-debug-androidTest.apk',
      build: `cd android && APP_VARIANT=prod EXPO_PUBLIC_ENV=prod ./gradlew -DtestBuildType=debug -PdetoxMetroPort=${androidMetroPort} app:assembleProductionDebug app:assembleProductionDebugAndroidTest`,
      reversePorts: [androidMetroPort],
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: iosSimulatorDevice,
    },
    attached: {
      type: 'android.attached',
      device: {
        adbName: process.env.DETOX_ANDROID_DEVICE || '.*',
      },
    },
    emulator: {
      type: 'android.emulator',
      device: {
        avdName: process.env.DETOX_ANDROID_AVD || 'Pixel_10',
      },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
    'ios.sim.release': {
      device: 'simulator',
      app: 'ios.release',
    },
    'android.att.debug': {
      device: 'attached',
      app: 'android.debug',
    },
    'android.att.release': {
      device: 'attached',
      app: 'android.release',
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
    'android.emu.release': {
      device: 'emulator',
      app: 'android.release',
    },
    'android.att.prodDebug': {
      device: 'attached',
      app: 'android.prodDebug',
    },
    'android.emu.prodDebug': {
      device: 'emulator',
      app: 'android.prodDebug',
    },
  },
};
