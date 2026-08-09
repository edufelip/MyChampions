// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const expoConfig = require('eslint-config-expo/flat');

const typedTypeScriptConfig = tsPlugin.configs['flat/recommended-type-checked'].map(
  (config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
    ...(config.rules
      ? {
          rules: Object.fromEntries(
            Object.entries(config.rules).map(([rule, setting]) => [
              rule,
              Array.isArray(setting)
                ? ['warn', ...setting.slice(1)]
                : setting === 'error'
                  ? 'warn'
                  : setting,
            ])
          ),
        }
      : {}),
  })
);

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/*',
      '.expo/*',
      '.artifacts/*',
      'artifacts/*',
      'coverage/*',
      'playwright-report/*',
      'test-results/*',
    ],
  },
  // Expo already registers the parser/plugin for TypeScript. Reuse only the
  // type-aware rule layers to avoid registering the plugin twice in flat config.
  ...typedTypeScriptConfig.slice(1),
  {
    files: ['e2e/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: {
        afterAll: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        by: 'readonly',
        describe: 'readonly',
        device: 'readonly',
        element: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        waitFor: 'readonly',
      },
    },
  },
  {
    files: ['features/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'expo/no-dynamic-env-var': 'warn',
      'react/display-name': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'import/order': [
        'warn',
        {
          alphabetize: { caseInsensitive: true, order: 'asc' },
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
            'object',
            'type',
          ],
          'newlines-between': 'never',
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/unbound-method': 'warn',
    },
  },
]);
