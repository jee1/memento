import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import { baseTestConfig } from './vitest.base.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CI 러너(4 vCPU)는 job 을 나눠 돌리므로 2개를 유지한다. 로컬은 코어의 1/4(2~6개)를 쓴다. VITEST_MAX_WORKERS 로 바꾼다.
const maxWorkers = Number(process.env.VITEST_MAX_WORKERS) || (process.env.CI ? 2 : Math.min(6, Math.max(2, Math.floor(os.cpus().length / 4))));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@memento\/core\/(.+)\.js$/,
        replacement: path.resolve(__dirname, 'packages/memento-core/src/$1.ts'),
      },
      {
        find: '@memento/core',
        replacement: path.resolve(__dirname, 'packages/memento-core/src/index.ts'),
      },
      {
        find: '@jee1/memento-client',
        replacement: path.resolve(__dirname, 'packages/memento-client/src/index.ts'),
      },
    ],
  },
  test: {
    ...baseTestConfig,
    globals: true,
    pool: 'forks',
    maxWorkers,
    include: [
      '{tests,scripts,apps}/**/*.{test,spec}.{js,ts}',
      'packages/{memento-core,memento-client,memento-server}/src/**/*.{test,spec}.{js,ts}',
    ],
    hookTimeout: 30000,
    testTimeout: 30000,
    setupFiles: ['./packages/memento-core/src/test/vitest.setup.ts'],
    ...(process.env.CI && {
      reporters: [
        ['default', { summary: false }],
        'junit',
        'json'
      ],
      outputFile: {
        junit: './test-results/junit.xml',
        json: './test-results/results.json'
      }
    }),
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/coverage/**'
      ]
    },
    server: {
      deps: {
        inline: [
          /@huggingface\/transformers/,
          /onnxruntime-node/,
        ]
      }
    }
  }
});
