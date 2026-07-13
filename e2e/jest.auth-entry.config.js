/** @type {import('@jest/types').Config.InitialOptions} */
const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: ['<rootDir>/e2e/auth-sign-in.e2e.test.js'],
};
