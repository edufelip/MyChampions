/**
 * Legacy combined config. Use `test:e2e:ios:debug:smoke` for the complete
 * suite so auth-entry and authenticated fixture states are isolated.
 * @type {import('@jest/types').Config.InitialOptions}
 */
const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/e2e/auth-sign-in.e2e.test.js',
    '<rootDir>/e2e/auth-role-selection.e2e.test.js',
    '<rootDir>/e2e/student-professionals.e2e.test.js',
  ],
};
