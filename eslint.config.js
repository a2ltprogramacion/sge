import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astroPlugin from 'eslint-plugin-astro';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.astro/**', '**/.wrangler/**', '**/.turbo/**', '**/coverage/**', '**/*.config.*', '**/*.d.ts'] },

  // Base JS/TS config
  ...tseslint.configs.recommended,
  js.configs.recommended,

  // Astro config
  {
    files: ['**/*.astro'],
    plugins: { astro: astroPlugin },
    languageOptions: {
      parser: astroPlugin.parser,
      parserOptions: {
        extraFileExtensions: ['.astro'],
      },
    },
    rules: {
      ...astroPlugin.configs.recommended.rules,
      'astro/no-set-html-directive': 'warn',
      'astro/no-unused-define-vars-in-style': 'warn',
    },
  },

  // TypeScript specific rules
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'warn',
    },
  },

  // JSX A11y for .astro and .tsx
  {
    files: ['**/*.astro', '**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      ...jsxA11y.configs.recommended.rules,
      'jsx-a11y/anchor-is-valid': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
    },
  },

  // Test files
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Config files - more lenient
  {
    files: ['**/*.config.*', '**/*.config.*'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);