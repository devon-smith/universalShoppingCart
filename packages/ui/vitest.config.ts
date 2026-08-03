import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The primitives are DOM components: focus, accessible names and error fallbacks only
    // exist in a document, so these tests need one rather than a string of markup.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
