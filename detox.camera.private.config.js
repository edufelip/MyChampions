const path = require('node:path');

const currentRoot = process.env.DETOX_CAMERA_CURRENT_ROOT;
if (!currentRoot || !path.isAbsolute(currentRoot))
  throw new Error('DETOX_CAMERA_CURRENT_ROOT is required');
const base = require(path.join(currentRoot, '.detoxrc.js'));
const jestConfigPath = process.env.DETOX_CAMERA_JEST_CONFIG_PATH;
const cameraTestPath = process.env.DETOX_CAMERA_TEST_PATH;
const expectedCameraTestPath = path.join(currentRoot, 'e2e/detox-ios-camera-route.e2e.test.js');
if (
  !jestConfigPath ||
  !cameraTestPath ||
  !path.isAbsolute(jestConfigPath) ||
  !path.isAbsolute(cameraTestPath) ||
  path.normalize(jestConfigPath) !== jestConfigPath ||
  path.normalize(cameraTestPath) !== cameraTestPath ||
  cameraTestPath !== expectedCameraTestPath
)
  throw new Error('Detox camera staged Jest selection paths are incomplete or foreign');

module.exports = {
  ...base,
  testRunner: {
    ...base.testRunner,
    args: {
      ...base.testRunner.args,
      config: jestConfigPath,
      _: [cameraTestPath],
    },
  },
};
