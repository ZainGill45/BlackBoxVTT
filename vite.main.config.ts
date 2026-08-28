import { defineConfig } from "vite";

export default defineConfig({
    build: {
        ssr: "src/main/main.ts",
        outDir: "dist/main",
        emptyOutDir: true,
    },

    ssr: {
        target: "node",
        external: ["electron"],
    },
});