import { defineConfig } from 'vitest/config';
import { baseTestConfig } from '../../vitest.base.js';

export default defineConfig({
  test: {
    ...baseTestConfig,
    globals: true,
    include: ['src/**/*.spec.ts'],
    // #927 CI 실패 시 workflow 가 업로드하는 구조화 결과. outputFile 경로는 이 패키지 루트 기준이다.
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
  },
});
