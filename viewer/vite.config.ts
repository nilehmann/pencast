import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
    base: "/pencast-viewer/",
    plugins: [svelte()],
    build: {
        outDir: "../docs",
        emptyOutDir: true,
    },
    resolve: {
        // Allow viewer to import from the shared monorepo directory
        alias: {},
    },
});
