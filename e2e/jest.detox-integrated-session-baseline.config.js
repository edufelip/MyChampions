const testPath =
  process.env.DETOX_BASELINE_TEST_PATH ||
  '<rootDir>/e2e/detox-integrated-session-baseline.e2e.test.js';

/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir: '..',
  testMatch: [testPath],
  testTimeout: 300000,
  maxWorkers: 1,
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  reporters: ['detox/runners/jest/reporter'],
  testEnvironment: 'detox/runners/jest/testEnvironment',
  verbose: true,
};
