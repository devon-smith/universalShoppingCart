import { baseConfig } from './eslint/base.js';

export default [
  ...baseConfig,
  {
    ignores: ['tsconfig/**'],
  },
];
