import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Extractors read a Document. jsdom gives the tests a real DOM and a DOMParser to
    // build one from an HTML fixture.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
