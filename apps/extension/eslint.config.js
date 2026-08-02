import globals from 'globals';

import { reactConfig } from '@universal-cart/config/eslint/react';

export default [
  ...reactConfig,
  {
    // Node scripts that support the end-to-end suite, not extension code.
    files: ['tests/e2e/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    ignores: ['.wxt/**', '.output/**'],
  },
  {
    files: ['entrypoints/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        // WXT auto-imports these entrypoint helpers; `chrome` is provided by the browser.
        defineBackground: 'readonly',
        defineContentScript: 'readonly',
        defineUnlistedScript: 'readonly',
        chrome: 'readonly',
        browser: 'readonly',
      },
    },
  },
];
