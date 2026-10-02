import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'playwright-report/**', 'test-results/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    // The engine is pure: no clocks, no ambient randomness, no host APIs.
    files: ['packages/engine/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'performance', 'crypto', 'setTimeout', 'setInterval', 'process', 'structuredClone'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded engine RNG.' },
        { object: 'Date', property: 'now', message: 'Time is passed in on actions (at).' },
      ],
    },
  },
);
