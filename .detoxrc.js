const iosMetroPort = process.env.DETOX_METRO_PORT || '8081';
const androidMetroPort = Number(process.env.DETOX_METRO_PORT || '8081');
const iosSimulatorDevice = process.env.DETOX_IOS_SIMULATOR_UDID
  ? { id: process.env.DETOX_IOS_SIMULATOR_UDID }
  : { type: process.env.DETOX_IOS_SIMULATOR || 'iPhone 17' };

/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      '$0': 'jest',
      config: process.env.DETOX_JEST_CONFIG || 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 300000,
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/mychampions.app',
      launchArgs: {
        RCT_jsLocation: `localhost:${iosMetroPort}`,
      },
      build:
        'xcodebuild -workspace ios/mychampions.xcworkspace -scheme mychampions -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build RCT_METRO_PORT="${DETOX_METRO_PORT:-8081}"',
    },
    'ios.release': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Release-iphonesimulator/mychampions.app',
      build:
        'xcodebuild -workspace ios/mychampions.xcworkspace -scheme mychampions -configuration Release -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/dev/debug/app-dev-debug.apk',
      testBinaryPath:
        'android/app/build/outputs/apk/androidTest/dev/debug/app-dev-debug-androidTest.apk',
      build:
        'cd android && APP_VARIANT=dev EXPO_PUBLIC_ENV=dev ./gradlew -DtestBuildType=debug -PdetoxMetroPort="${DETOX_METRO_PORT:-8081}" app:assembleDevDebug app:assembleDevDebugAndroidTest',
      reversePorts: [androidMetroPort],
    },
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/production/release/app-production-release.apk',
      testBinaryPath:
        'android/app/build/outputs/apk/androidTest/production/release/app-production-release-androidTest.apk',
      build:
        'cd android && APP_VARIANT=prod EXPO_PUBLIC_ENV=prod EXPO_NO_DEV_CLIENT=1 ./gradlew -DtestBuildType=release -PdetoxMetroPort="${DETOX_METRO_PORT:-8081}" -PCI_VERSION_CODE="${CI_VERSION_CODE:?CI_VERSION_CODE_required}" app:assembleProductionRelease app:assembleProductionReleaseAndroidTest',
    },
    'android.prodDebug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/production/debug/app-production-debug.apk',
      testBinaryPath:
        'android/app/build/outputs/apk/androidTest/production/debug/app-production-debug-androidTest.apk',
      build:
        'cd android && APP_VARIANT=prod EXPO_PUBLIC_ENV=prod ./gradlew -DtestBuildType=debug -PdetoxMetroPort="${DETOX_METRO_PORT:-8081}" app:assembleProductionDebug app:assembleProductionDebugAndroidTest',
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
