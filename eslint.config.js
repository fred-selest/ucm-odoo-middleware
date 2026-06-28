'use strict';

// ESLint v9 flat config — remplace .eslintrc.json
// https://eslint.org/docs/latest/use/configure/configuration-files

const js = require('@eslint/js');
const globals = require('globals');
const jestPlugin = require('eslint-plugin-jest');

module.exports = [
  // 1. Recommandations ESLint de base
  js.configs.recommended,

  // 2. Globals Node + ES2022 + Jest pour les fichiers du projet
  {
    files: ['src/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      jest: jestPlugin,
    },
    rules: {
      // ── Style ────────────────────────────────────────────────────────────
      'no-console': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-magic-numbers': 'off',
      'valid-jsdoc': 'off',
      'prefer-destructuring': 'off',
      'no-useless-escape': 'off',
      'max-len': 'off',

      // ── Conventions de l'équipe ─────────────────────────────────────────
      // ESLint 9 considère crypto/WebSocket/FormData comme globals natifs Node 20+ ;
      // les `const crypto = require('crypto')` sont des faux positifs.
      'no-redeclare': 'off',

      semi: ['error', 'always'],
      quotes: ['error', 'single'],
      indent: ['error', 2],
      'linebreak-style': ['error', 'unix'],
      'object-curly-spacing': ['error', 'always'],
      'space-infix-ops': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],

      // ── Jest (eslint-plugin-jest) ───────────────────────────────────────
      'jest/no-disabled-tests': 'warn',
      'jest/no-focused-tests': 'error',
      'jest/no-identical-title': 'error',
      'jest/valid-expect': 'error',
    },
  },

  // 3. Fichiers de tests Jest — recommandations supplémentaires
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      'no-unused-expressions': 'off', // courant en Jest (expect chains)
    },
  },

  // 4. Fichiers à ignorer
  {
    ignores: [
      'node_modules/',
      'data/',
      'logs/',
      'public/',
      'dist/',
      'coverage/',
      '*.bak',
      '*.bak-*',
      '.eslintrc.json',
    ],
  },
];