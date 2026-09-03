import { VitePlugin } from "@electron-forge/plugin-vite";

export default {
  plugins: [
    new VitePlugin({
      build: [{
        entry: "src/main/main.ts",
        config: "vite.main.config.ts",
        target: "main",
      }, {
        entry: "src/renderer/preload.ts",
        config: "vite.preload.config.ts",
        target: "preload",
      }],
      renderer: [{
        name: "main_window",
        config: "vite.renderer.config.ts",
      }],
    }),
  ],
};
