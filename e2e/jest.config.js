const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const requestedTestPath = process.env.DETOX_BASELINE_TEST_PATH;
let testMatch = ['<rootDir>/e2e/**/*.e2e.test.js'];
if (requestedTestPath) {
  const resolved = path.resolve(requestedTestPath);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.endsWith('.e2e.test.js'))
    throw new Error('DETOX_BASELINE_TEST_PATH must name one owned e2e test under the repository root');
  testMatch = [`<rootDir>/${relative.split(path.sep).join('/')}`];
}

/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir: '..',
  testMatch,
  testTimeout: 300000,
  maxWorkers: 1,
  globalSetup: '<rootDir>/e2e/detox-owned-global-setup.js',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  reporters: ['detox/runners/jest/reporter', '<rootDir>/e2e/ci-execution-reporter.js'],
  testEnvironment: 'detox/runners/jest/testEnvironment',
  verbose: true,
};
