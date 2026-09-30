import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

export default defineConfig({
  // Next keeps JSX for its compiler; Vitest's Oxc transform must lower TSX first.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Disposable workerd/D1 fixtures bind localhost per test. Bound file-level
    // concurrency to avoid intermittent EADDRNOTAVAIL on local macOS runners;
    // tests still exercise their own real concurrent transaction races.
    maxWorkers: 2,
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    exclude: [...configDefaults.exclude, "docs/**/*.test.mjs", ".superpowers/**"],
    css: true,
  },
});
