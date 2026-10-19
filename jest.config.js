module.exports = {
  testEnvironment: 'jsdom',
  testEnvironmentOptions: { url: 'http://localhost/' },
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  moduleFileExtensions: ['js', 'json', 'vue'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^dexie$': '<rootDir>/node_modules/dexie/dist/dexie.js',
  },
  transform: {
    '^.+\\.vue$': '@vue/vue2-jest',
    '^.+\\.js$': 'babel-jest',
  },
  modulePathIgnorePatterns: ['<rootDir>/dist', '<rootDir>/.direnv/'],
  clearMocks: true,
  restoreMocks: true,
};
