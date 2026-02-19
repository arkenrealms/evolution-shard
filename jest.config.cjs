module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.unit.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/build'],
};
