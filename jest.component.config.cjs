module.exports = {
  preset: 'jest-expo',
  modulePathIgnorePatterns: ['<rootDir>/.qa/'],
  testMatch: ['<rootDir>/tests/component/**/*.test.ts?(x)'],
  setupFilesAfterEnv: ['<rootDir>/tests/component/setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  clearMocks: true,
  restoreMocks: true,
  maxWorkers: 1,
  testTimeout: 10000,
};
