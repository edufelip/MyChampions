/* global __filename */

const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');

const expectedConfigHash = process.env.DETOX_CONNECTION_JEST_CONFIG_SHA256;
if (expectedConfigHash) {
  const actualConfigHash = createHash('sha256').update(readFileSync(__filename)).digest('hex');
  if (actualConfigHash !== expectedConfigHash)
    throw new Error('Detox Jest config changed after parent validation');
}

const testPath =
  process.env.DETOX_CONNECTION_TEST_PATH ||
  '<rootDir>/e2e/detox-integrated-connection-baseline.e2e.test.js';

module.exports = {
  rootDir: '..',
  testMatch: [testPath],
  testTimeout: 600000,
  maxWorkers: 1,
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  reporters: ['detox/runners/jest/reporter'],
  testEnvironment: 'detox/runners/jest/testEnvironment',
  verbose: true,
};
