import { defineConfig } from 'vitest/config';

/**
 * The visual-system invariants under src/test/design.
 *
 * These read the stylesheets as text and enforce deliberate design decisions —
 * one dark scheme, grayscale only, square corners, a fixed type scale. They are
 * lint rules rather than tests: a failure means someone drifted from the design
 * system, not that the application is broken, so they run under `npm run lint`
 * instead of `npm test` where a red result would read as a code defect.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/design/**/*.test.ts'],
  },
});
