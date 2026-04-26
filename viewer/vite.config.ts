import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { typiaGeneratorPlugin } from "../vite-plugin-typia";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: __dirname,
    base: process.env.BASE_PATH ?? "/",
    plugins: [typiaGeneratorPlugin(), svelte()],
    build: {
        outDir: path.resolve(__dirname, "../docs"),
        emptyOutDir: true,
    },
});
