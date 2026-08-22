import { defineConfig } from 'vitest/config';
import { baseTestConfig } from '../../vitest.base.js';

export default defineConfig({
  test: {
    ...baseTestConfig,
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
  },
});
