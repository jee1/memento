import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default [
  { ignores: ['**/dist/'] },
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs', '**/*.cjs'],
    ...js.configs.recommended,
  },
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      security,
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': 'error',
      'no-redeclare': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'max-lines-per-function': 'off',
      complexity: ['error', 30],
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'error',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'off',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'warn',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-require': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs', '**/*.cjs'],
    ignores: ['static/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // #1835: TypeScript 파일은 500줄까지다(시험 제외).
    files: ['packages/**/*.ts', 'apps/**/*.ts', 'scripts/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**', '**/test/**'],
    rules: { 'max-lines': ['error', 500] },
  },
  {
    // 500줄을 넘는 기존 파일. 줄이면 목록에서 뺀다. 새 파일은 넣지 않는다.
    files: [
      'packages/memento-core/src/domains/consolidation/services/sleep-consolidation-service.ts',
      'packages/memento-core/src/domains/embedding/services/embedding-reindex-service.ts',
      'packages/memento-core/src/domains/embedding/services/memory-embedding-service.ts',
      'packages/memento-core/src/domains/memory/introspection/meta-memory-service.ts',
      'packages/memento-core/src/domains/memory/procedural/procedural-memory-change-detector.ts',
      'packages/memento-core/src/domains/memory/remember/remember-tool-memory-item.ts',
      'packages/memento-core/src/domains/memory/repositories/memory-item-repository.ts',
      'packages/memento-core/src/domains/monitoring/services/quality-assurance/search-metrics-collector.ts',
      'packages/memento-core/src/domains/monitoring/services/quality-assurance/vector-search-quality-metrics/report-quality-comparison.ts',
      'packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts',
      'packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts',
      'packages/memento-core/src/index.ts',
      'packages/memento-core/src/infrastructure/cache/cache-service.ts',
      'packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.ts',
      'packages/memento-core/src/infrastructure/database/sqlite/migration/migrations/006-fts5-reflection-notes.ts',
      'packages/memento-core/src/infrastructure/scheduler/batch-scheduler/batch-scheduler.ts',
      'packages/memento-server/src/server/handlers/anchor-map.handler.ts',
      'packages/memento-server/src/server/http-server.ts',
      'packages/memento-server/src/server/routes/admin/admin-batch.routes.ts',
      'packages/memento-server/src/server/routes/admin/admin-memory-review.routes.ts',
      'packages/memento-server/src/server/routes/admin/admin-ops-summary-zones.ts',
      'packages/memento-server/src/server/routes/quality.routes.ts',
      'scripts/agent-memory-benchmark-adapter.ts',
      'scripts/agent-memory-benchmark.ts',
      'scripts/agent-smoke-matrix.ts',
      'scripts/check-sql-injection.ts',
      'scripts/count-console-logs.ts',
      'scripts/generate-relation-ko-panel-v1.ts',
      'scripts/lib/quality-baseline.ts',
      'scripts/lib/relation-bfs-eval-runner.ts',
      'scripts/pr-merge-gate.ts',
      'scripts/quality-benchmark-maxsim.ts',
    ],
    rules: { 'max-lines': 'off' },
  },
  {
    files: ['apps/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/test-*.ts'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['packages/memento-client/src/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['packages/memento-server/src/cli.ts', 'packages/memento-server/src/cli/**/*.ts'],
    rules: { 'security/detect-non-literal-fs-filename': 'off' },
  },
  {
    files: [
      '**/*.spec.ts',
      '**/test-*.ts',
      'tests/**/*.ts',
      'packages/memento-core/src/test/**/*.ts',
      'scripts/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
    },
  },
  {
    files: ['static/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        d3: 'readonly',
        mementoAdminFetch: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      // ESLint 9 changed the caughtErrors default from "none" to "all".
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-console': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: [
      'packages/memento-core/src/shared/config/**/*.ts',
      'packages/memento-core/src/shared/utils/fts5-migration-status.ts',
      'packages/memento-core/src/shared/utils/reflection-notes-merge.ts',
      'packages/memento-core/src/shared/utils/type-param-validator.ts',
      'packages/memento-core/src/infrastructure/logging/**/*.ts',
      'packages/memento-core/src/infrastructure/scheduler/file-logger.ts',
    ],
    rules: { 'no-console': 'off' },
  },
];
