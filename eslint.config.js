// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { flatConfigs as importXConfigs } from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/.vite/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  // NOTE: import-x's TypeScript resolver config is intentionally omitted until a real
  // package with its own tsconfig lands (e.g. apps/web). Add `importXConfigs.typescript`
  // — with `eslint-import-resolver-typescript` — at that point.
  importXConfigs.recommended,
  jsxA11y.flatConfigs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'error',
      'import-x/order': [
        'error',
        {
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        },
      ],
    },
  },

  // TypeScript-specific rules
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
    },
  },

  // React Hooks rules — scoped to the web app only; backend packages don't need them.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Tooling, scripts and tests may use console.
  {
    files: [
      '**/scripts/**',
      '**/__tests__/**',
      '**/*.test.{ts,tsx,js,jsx}',
      '**/*.config.{js,ts,mjs,cjs}',
    ],
    rules: {
      'no-console': 'off',
    },
  },

  prettier,
);
