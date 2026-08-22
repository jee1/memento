import { defineConfig } from 'vitest/config';
import { baseTestConfig } from '../../vitest.base.js';

export default defineConfig({
  test: {
    ...baseTestConfig,
    include: ['src/**/*.spec.ts'],
    testTimeout: 5_000,
  },
});
