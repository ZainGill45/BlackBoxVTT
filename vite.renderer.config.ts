import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        detachedCharacter: fileURLToPath(
          new URL('./detached-character.html', import.meta.url),
        ),
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
  plugins: [react()],
});
