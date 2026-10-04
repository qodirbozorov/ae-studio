import { defineConfig } from "vitest/config";

// Panel testlari Node muhitida (jsx bundle mock-AE'da, agent soxta evalScript bilan).
// vite.config.ts (CEP plaginlari) bu yerda yuklanmaydi.
export default defineConfig({
  test: {
    name: "@aes/panel",
    environment: "node",
    testTimeout: 30_000,
  },
});
