const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const detoxGlobalSetup = require('detox/runners/jest/globalSetup');

module.exports = async (...args) => {
  const artifactRoot = process.env.DETOX_ANDROID_CAMERA_ARTIFACT_ROOT;
  if (artifactRoot) {
    await writeFile(
      path.join(artifactRoot, 'detox-jest-global-setup.private.json'),
      `${JSON.stringify({ kind: 'private-owned-android-detox-jest-global-setup', entered: true })}\n`,
      { flag: 'wx', mode: 0o600 },
    );
  }
  return detoxGlobalSetup(...args);
};
