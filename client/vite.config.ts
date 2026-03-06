import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  root: "client",
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("pdfjs-dist")) return "vendor-pdfjs";
          if (id.includes("pdf-lib")) return "vendor-pdf-lib";
          if (id.includes("lucide-svelte")) return "vendor-lucide";
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
