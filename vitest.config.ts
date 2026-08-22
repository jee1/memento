import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import { baseTestConfig } from './vitest.base.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 2,
      },
    },
    include: [
      '{tests,scripts,apps}/**/*.{test,spec}.{js,ts}',
      'packages/{memento-core,memento-client,memento-server}/src/**/*.{test,spec}.{js,ts}',
    ],
    hookTimeout: 30000,
    testTimeout: 30000,
    setupFiles: ['./packages/memento-core/src/test/vitest.setup.ts'],
    ...(process.env.CI && {
      reporters: [
        'basic',
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
          /@xenova\/transformers/,
          /onnxruntime-node/,
        ]
      }
    }
  }
});
