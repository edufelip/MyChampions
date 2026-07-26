/** @type {import('@jest/types').Config.InitialOptions} */
const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/e2e/professional-subscription-actions.e2e.test.js',
    '<rootDir>/e2e/professional-subscription-cap.e2e.test.js',
  ],
};
