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
      // Added to eslint:recommended in ESLint 10; adoption tracked in #1360.
      'preserve-caught-error': 'off',
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
      'src/test/**/*.ts',
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
      'src/server/index.ts',
      'src/infrastructure/database/sqlite/init.ts',
      'src/infrastructure/database/sqlite/migrate.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    files: [
      'src/shared/config/**/*.ts',
      'src/shared/utils/write-coalescing.ts',
      'src/shared/utils/fts5-migration-status.ts',
      'src/shared/utils/reflection-notes-merge.ts',
      'src/shared/utils/type-param-validator.ts',
      'src/infrastructure/logging/**/*.ts',
      'src/infrastructure/scheduler/file-logger.ts',
      'src/domains/monitoring/services/performance-alert-service.ts',
      'packages/memento-core/src/shared/config/**/*.ts',
      'packages/memento-core/src/shared/utils/write-coalescing.ts',
      'packages/memento-core/src/shared/utils/fts5-migration-status.ts',
      'packages/memento-core/src/shared/utils/reflection-notes-merge.ts',
      'packages/memento-core/src/shared/utils/type-param-validator.ts',
      'packages/memento-core/src/infrastructure/logging/**/*.ts',
      'packages/memento-core/src/infrastructure/scheduler/file-logger.ts',
      'packages/memento-core/src/domains/monitoring/services/performance-alert-service.ts',
    ],
    rules: { 'no-console': 'off' },
  },
];
