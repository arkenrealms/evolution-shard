module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.unit.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/build/'],
};
