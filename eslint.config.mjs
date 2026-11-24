import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['node_modules/**', 'out/**', 'dist/**', 'test/shots/**', '*.log'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      '@typescript-eslint/no-explicit-any': 'error'
    }
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-empty': ['error', { allowEmptyCatch: true }] }
  }
)
