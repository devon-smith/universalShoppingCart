import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared flat ESLint config for every package in the workspace.
 *
 * Intentionally type-unaware: type-level problems are the job of `pnpm typecheck`,
 * and keeping lint fast means it stays runnable on every save.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const baseConfig = [
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.es2022,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Remote executable code is banned project-wide (see BUILD_PLAN.md §17.4).
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts', '**/tests/**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];

export default baseConfig;
