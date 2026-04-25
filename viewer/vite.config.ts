import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: __dirname,
    base: "/pencast-viewer/",
    plugins: [svelte()],
    build: {
        outDir: path.resolve(__dirname, "../docs"),
        emptyOutDir: true,
    },
});
