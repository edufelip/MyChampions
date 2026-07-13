/** @type {import('@jest/types').Config.InitialOptions} */
const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/e2e/auth-role-selection.e2e.test.js',
    '<rootDir>/e2e/student-professionals.e2e.test.js',
  ],
};
