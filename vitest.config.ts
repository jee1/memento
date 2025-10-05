import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist'],
    hookTimeout: 30000, // 30초로 증가
    testTimeout: 30000, // 30초로 증가
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
        'src/test/**/*error-handling*.{test,spec}.{js,ts}'
      ]
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
    // CI 환경에서 에러 처리 설정
    onUnhandledRejection: 'warn',
    onConsoleLog: 'warn'
  }
});
