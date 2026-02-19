module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['<rootDir>/shard.service.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/build/'],
};
