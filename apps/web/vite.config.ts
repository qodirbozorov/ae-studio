import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: `pnpm --filter @aes/web dev` → API so'rovlari lokal serverga (3000) proksi qilinadi.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000", "/oauth": "http://localhost:3000" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
