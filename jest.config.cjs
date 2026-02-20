module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: {
    '^@arken/node/db$': '<rootDir>/../../node/db.ts',
    '^@arken/node/util$': '<rootDir>/../../node/util.ts',
    '^@arken/node/(.+)$': '<rootDir>/../../node/$1',
    '^@arken/evolution-protocol$': '<rootDir>/../protocol/index.ts',
    '^@arken/evolution-protocol/(.+)$': '<rootDir>/../protocol/$1',
    '^@arken/seer-protocol$': '<rootDir>/../../seer/protocol/index.ts',
    '^@arken/seer-protocol/(.+)$': '<rootDir>/../../seer/protocol/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  testMatch: ['**/*.test.ts'],
};
