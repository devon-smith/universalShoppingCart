import { reactConfig } from '@universal-cart/config/eslint/react';

export default [
  ...reactConfig,
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
