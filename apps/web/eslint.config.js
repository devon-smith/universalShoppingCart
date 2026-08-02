import { reactConfig } from '@universal-cart/config/eslint/react';

export default [
  ...reactConfig,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
];
