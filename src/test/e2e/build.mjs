/**
 * Builds the app the way Electron Forge builds it for packaging, but without
 * packaging it.
 *
 * `electron-forge start` only emits main and preload; the renderer stays behind
 * a Vite dev server and its URL is baked into main.js as
 * MAIN_WINDOW_VITE_DEV_SERVER_URL. An end-to-end run wants neither a dev server
 * nor a two-minute `forge package`, so this reproduces Forge's production
 * output — renderer on disk, no dev server URL — in a few seconds.
 *
 * The options below mirror @electron-forge/plugin-vite's own configs. If a
 * Forge upgrade changes those, the packaged app and this build will disagree,
 * and the E2E suite is what will notice.
 */

import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';

const root = fileURLToPath(new URL('../../..', import.meta.url));

// Electron and every Node builtin, in both bare and `node:` form.
const external = [
  'electron',
  'electron/common',
  ...builtinModules.flatMap((name) => [name, `node:${name}`]),
];

const RENDERER_NAME = 'main_window';

async function buildMain() {
  await build({
    configFile: false,
    root,
    mode: 'production',
    // Forge leaves this key undefined in a production build, which makes the
    // define plugin drop it and turns the identifier into a ReferenceError at
    // runtime. Replacing it with the literal `undefined` is what actually sends
    // main.ts down its loadFile branch.
    define: {
      MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
      MAIN_WINDOW_VITE_NAME: JSON.stringify(RENDERER_NAME),
    },
    resolve: {
      conditions: ['node'],
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
    build: {
      copyPublicDir: false,
      emptyOutDir: false,
      lib: {
        entry: path.join(root, 'src/main.ts'),
        fileName: () => '[name].js',
        formats: ['cjs'],
      },
      minify: false,
      outDir: path.join(root, '.vite/build'),
      rollupOptions: { external: [...external, 'electron/main'] },
      sourcemap: true,
    },
  });
}

async function buildDiceRollWorker() {
  await build({
    configFile: false,
    root,
    mode: 'production',
    resolve: {
      conditions: ['node'],
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
    build: {
      copyPublicDir: false,
      emptyOutDir: false,
      lib: {
        entry: path.join(root, 'src/main/diceRollWorker.ts'),
        fileName: () => '[name].js',
        formats: ['cjs'],
      },
      minify: false,
      outDir: path.join(root, '.vite/build'),
      rollupOptions: { external },
      sourcemap: true,
    },
  });
}

async function buildPreload(entryName = 'preload') {
  await build({
    configFile: false,
    root,
    mode: 'production',
    build: {
      copyPublicDir: false,
      emptyOutDir: false,
      minify: false,
      outDir: path.join(root, '.vite/build'),
      rollupOptions: {
        external: [...external, 'electron/renderer'],
        // Preload can pull in web assets, so Forge uses `input` rather than
        // `lib.entry` here.
        input: path.join(root, `src/${entryName}.ts`),
        output: {
          assetFileNames: '[name].[ext]',
          chunkFileNames: '[name].js',
          entryFileNames: '[name].js',
          format: 'cjs',
          inlineDynamicImports: true,
        },
      },
      sourcemap: true,
    },
  });
}

async function buildRenderer() {
  await build({
    configFile: false,
    root,
    mode: 'production',
    // main.ts resolves the renderer with a relative loadFile, so the bundle has
    // to reference its own assets relatively too.
    base: './',
    plugins: [react()],
    resolve: { preserveSymlinks: true },
    build: {
      copyPublicDir: true,
      emptyOutDir: true,
      outDir: path.join(root, `.vite/renderer/${RENDERER_NAME}`),
      rollupOptions: {
        input: {
          detachedCharacter: path.join(root, 'detached-character.html'),
          main: path.join(root, 'index.html'),
        },
      },
    },
  });
}

// Sequential rather than parallel: main and preload share an outDir with
// emptyOutDir disabled, and concurrent writes there have no ordering guarantee.
await buildMain();
await buildPreload();
await buildPreload('detachedCharacterPreload');
await buildDiceRollWorker();
await buildRenderer();

console.log('E2E build complete: .vite/build + .vite/renderer/' + RENDERER_NAME);
