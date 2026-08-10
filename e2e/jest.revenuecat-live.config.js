/** @type {import('@jest/types').Config.InitialOptions} */
const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: ['<rootDir>/e2e/revenuecat-test-store.e2e.test.js'],
  testTimeout: process.env.REVENUECAT_LIVE_MONITOR_EXPIRATION === 'true' ? 2_100_000 : 300_000,
};
