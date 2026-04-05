import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Allow importing from the main doof src/ directory
      "@doof": path.resolve(__dirname, "../src"),
      // Polyfill node:path for browser (used by resolver.ts)
      "node:path": path.resolve(
        __dirname,
        "node_modules/path-browserify",
      ),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
