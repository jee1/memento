import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // 품질 스크립트 등 @memento/core 서브패스(…/*.js) → 소스 .ts (exports와 동일 경로)
      {
        find: /^@memento\/core\/(.+)\.js$/,
        replacement: path.resolve(__dirname, 'packages/memento-core/src/$1.ts'),
      },
      {
        // 서버 테스트에서 @memento/core를 dist 없이 소스로 resolve (CI/로컬 npm test 시 진입점 오류 방지)
        find: '@memento/core',
        replacement: path.resolve(__dirname, 'packages/memento-core/src/index.ts'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    // 기본 `threads` 풀은 워커 스레드가 동일 프로세스를 공유해 BatchScheduler 싱글톤이 파일 간에 충돌한다.
    // `forks`는 파일마다 자식 프로세스로 격리한다.
    pool: 'forks',
    include: [
      // 루트 src에는 packages/*/src와 중복된 레거시 스펙이 많다.
      // 전체 src를 포함하면 동일 테스트가 두 번 실행되어 전체 시간이 급격히 늘어난다.
      'src/npm-client/**/*.{test,spec}.{js,ts}',
      'src/services/**/*.{test,spec}.{js,ts}',
      'src/test/**/*.{test,spec}.{js,ts}',
      'src/tools/**/*.{test,spec}.{js,ts}',
      'src/workers/**/*.{test,spec}.{js,ts}',
      'tests/**/*.{test,spec}.{js,ts}',
      'scripts/**/*.{test,spec}.{js,ts}',
      'packages/memento-core/src/**/*.{test,spec}.{js,ts}',
      'packages/memento-client/src/**/*.{test,spec}.{js,ts}',
      'packages/memento-server/src/**/*.{test,spec}.{js,ts}'
    ],
    exclude: [
      'node_modules',
      'dist',
    ],
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
        'src/services/**/*migration*.spec.ts',
        // CI에서 DB 파일 이동/롤백 시 SQLITE_READONLY_DBMOVED 플레이크 방지
        '**/migration-runner.integration.spec.ts'
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
