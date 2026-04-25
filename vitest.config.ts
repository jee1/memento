import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

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
        find: '@memento/client',
        replacement: path.resolve(__dirname, 'packages/memento-client/src/index.ts'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 2,
      },
    },
    include: [
      'tests/**/*.{test,spec}.{js,ts}',
      'scripts/**/*.{test,spec}.{js,ts}',
      'apps/**/*.{test,spec}.{js,ts}',
      'packages/memento-core/src/**/*.{test,spec}.{js,ts}',
      'packages/memento-client/src/**/*.{test,spec}.{js,ts}',
      'packages/memento-server/src/**/*.{test,spec}.{js,ts}',
      'packages/memento-agent/src/**/*.{test,spec}.{js,ts}',
    ],
    exclude: [
      'node_modules',
      'dist',
    ],
    hookTimeout: 30000,
    testTimeout: 30000,
    setupFiles: ['./packages/memento-core/src/test/vitest.setup.ts'],
    // CI 환경에서 DB 관련 및 무거운 테스트 스킵
    ...(process.env.CI && {
      exclude: [
        'node_modules', 
        'dist', 
        '**/test/**/*db*.{test,spec}.{js,ts}', 
        '**/test/**/*database*.{test,spec}.{js,ts}',
        '**/test/**/*integration*.{test,spec}.{js,ts}',
        '**/test/**/*m1*.{test,spec}.{js,ts}',
        '**/test/**/*performance*.{test,spec}.{js,ts}',
        '**/test/**/*error-handling*.{test,spec}.{js,ts}',
        'packages/memento-core/src/domains/monitoring/services/quality-assurance/*.spec.ts',
        '**/migration-runner.integration.spec.ts'
      ]
    }),
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
