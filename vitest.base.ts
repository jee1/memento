export const baseTestConfig = {
  environment: 'node' as const,
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    ...(process.env.CI && process.env.VITEST_INCLUDE_NIGHTLY !== '1'
      ? ['**/*.nightly.spec.ts']
      : []),
  ],
};
