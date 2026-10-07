const path = require('node:path');

const currentRoot = process.env.DETOX_CAMERA_CURRENT_ROOT;
const cameraTestPath = process.env.DETOX_CAMERA_TEST_PATH;
if (
  !currentRoot ||
  !cameraTestPath ||
  !path.isAbsolute(currentRoot) ||
  !path.isAbsolute(cameraTestPath) ||
  path.normalize(currentRoot) !== currentRoot ||
  path.normalize(cameraTestPath) !== cameraTestPath ||
  cameraTestPath !== path.join(currentRoot, 'e2e/detox-ios-camera-route.e2e.test.js')
) {
  throw new Error('Detox camera Jest paths are incomplete');
}

module.exports = {
  rootDir: currentRoot,
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  reporters: ['detox/runners/jest/reporter'],
  testEnvironment: 'detox/runners/jest/testEnvironment',
  testMatch: [cameraTestPath],
  testTimeout: 300000,
  maxWorkers: 1,
};
