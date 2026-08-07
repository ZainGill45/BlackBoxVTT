import { defineConfig } from 'vitest/config';

/**
 * Static architecture and deliberate design-policy rules.
 *
 * They run under `npm run lint` instead of the product-behavior test suite.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/design/**/*.test.ts'],
  },
});
