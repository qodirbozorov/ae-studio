import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    passWithNoTests: true,
    // Dev kompyuterda xotira kam (7.9 GB RAM, commit deyarli to'la): parallel worker'lar
    // (Babel/rollup, PGlite WASM) native crash beradi. Bitta worker — sekinroq, lekin barqaror.
    maxWorkers: 1,
  },
});
