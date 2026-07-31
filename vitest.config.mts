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
          new URL('./src/test/pixiGifStub.ts', import.meta.url),
        ),
      },
      // jsdom cannot provide a WebGL or WebGPU context for the real renderer.
      {
        find: /^pixi\.js$/,
        replacement: fileURLToPath(
          new URL('./src/test/pixiStub.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
