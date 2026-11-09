import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import a11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import noLiteralColors from './no-literal-colors.mjs';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-coverage/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/.tanstack/**',
      'packages/ui/story-build/**',
      'apps/web/src/routeTree.gen.ts',
      'audit/**',
      // Intentionally unsafe examples are validated by the Semgrep rule test runner.
      '.semgrep/security.tsx',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx,mts,cts}'],
  })),
  {
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: { globals: { ...globals.node } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{js,jsx,ts,tsx}', 'packages/ui/**/*.{js,jsx,ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: [
      'apps/*/src/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}',
      'packages/*/src/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}',
      'apps/web/server.js',
    ],
    ignores: ['**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}', '**/src/test/**'],
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression:matches([object.name="document"], [object.property.name="document"], [object.property.value="document"])' +
            ':matches([property.name=/^write(ln)?$/], [property.value=/^write(ln)?$/])',
          message: 'Use safe DOM APIs instead of document.write or document.writeln.',
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{jsx,tsx}', 'packages/ui/src/**/*.{jsx,tsx}'],
    ...react.configs.flat.recommended,
    settings: { react: { version: '19' } },
    plugins: {
      react,
      'react-hooks': hooks,
      'jsx-a11y': a11y,
      barghsa: { rules: { 'no-literal-colors': noLiteralColors } },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...a11y.flatConfigs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'barghsa/no-literal-colors': 'error',
      'jsx-a11y/label-has-associated-control': ['error', { depth: 5 }],
      'jsx-a11y/no-autofocus': ['error', { ignoreNonDOM: true }],
    },
  },
  {
    files: ['**/*.{test,spec}.{js,jsx,ts,tsx}', '**/test/**', '**/e2e/**'],
    // Strict production typing is separate from intentionally malformed test inputs.
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'barghsa/no-literal-colors': 'off' },
  },
  {
    files: ['**/e2e/**'],
    // Playwright requires object destructuring even when only testInfo is used.
    rules: { 'no-empty-pattern': 'off' },
  }
);
