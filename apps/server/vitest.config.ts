import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@aes/server",
    // PGlite (WASM Postgres) birinchi ishga tushishda bir necha soniya oladi.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
