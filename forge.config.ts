import { VitePlugin } from "@electron-forge/plugin-vite";

export default {
    plugins: [
        new VitePlugin({
            build: [
                {
                    entry: "src/main/main.ts",
                    config: "vite.main.config.ts",
                    target: "main",
                },
            ],
            renderer: [
                {
                    name: "main_window",
                    config: "vite.renderer.config.ts",
                },
            ],
        }),
    ],
};