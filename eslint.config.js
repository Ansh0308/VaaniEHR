// ESLint flat config (ESLint 9). Type-aware rules are intentionally not enabled yet (Phase 1.1).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.venv/**',
      '.agents/**',
      'security/semgrep/**',
      '.claude/**',
      'DOCUMENTS/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: [
      'scripts/**/*.mjs',
      '*.config.js',
      '*.config.ts',
      'apps/*/vite.config.ts',
      'apps/*/*.config.js',
    ],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  {
    // Command-line tools run by npm scripts: printing to the terminal is their job.
    files: [
      'apps/api-node/src/audit/verifyCli.ts',
      'apps/api-node/src/db/provision.ts',
      'apps/api-node/src/openapi/generate.ts',
      'apps/api-node/src/seed/seedDev.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/api-node/**/*.ts', 'apps/api-node/migrations/**/*.js', 'packages/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
);
