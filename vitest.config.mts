import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^pixi\.js\/gif$/,
        replacement: fileURLToPath(
          new URL('./src/test/support/pixiGifStub.ts', import.meta.url),
        ),
      },
      // jsdom cannot provide a WebGL or WebGPU context for the real renderer.
      {
        find: /^pixi\.js$/,
        replacement: fileURLToPath(
          new URL('./src/test/support/pixiStub.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    // The Playwright suite under src/test/e2e drives real Electron processes
    // and is run by `npm run test:e2e`; it uses .spec.ts so this never collects
    // it.
    include: ['src/test/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/support/setup.ts'],
    css: true,
  },
});
