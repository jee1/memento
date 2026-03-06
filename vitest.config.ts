import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.{test,spec}.{js,ts}',
      'tests/**/*.{test,spec}.{js,ts}',
      'packages/memento-core/src/**/*.{test,spec}.{js,ts}',
      'packages/memento-client/src/**/*.{test,spec}.{js,ts}'
    ],
    exclude: ['node_modules', 'dist'],
    hookTimeout: 30000, // 30초로 증가
    testTimeout: 30000, // 30초로 증가
    setupFiles: ['./src/test/vitest.setup.ts'], // 전역 설정 파일
    // CI 환경에서 DB 관련 테스트 스킵
    ...(process.env.CI && {
      exclude: [
        'node_modules', 
        'dist', 
        'src/test/**/*db*.{test,spec}.{js,ts}', 
        'src/test/**/*database*.{test,spec}.{js,ts}',
        'src/test/**/*integration*.{test,spec}.{js,ts}',
        'src/test/**/*m1*.{test,spec}.{js,ts}',
        'src/test/**/*performance*.{test,spec}.{js,ts}',
        'src/test/**/*error-handling*.{test,spec}.{js,ts}',
        // CI 환경에서 네이티브 모듈을 사용하는 테스트 제외
        'src/services/**/*migration*.spec.ts'
      ]
    }),
    // CI 환경에서 JUnit 및 JSON 리포트 생성
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
