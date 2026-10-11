import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

/** public/ dagi app shell fayllari (oflayn ochilish va o'rnatish uchun). */
const PUBLIC_SHELL = [
  "/manifest.webmanifest",
  "/ae-studio-full.svg",
  "/ae-studio-icon.svg",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

/**
 * PWA: `sw.template.js` dan `sw.js` chiqaradi (build fayllari ro'yxati + versiya xeshi) va
 * index.html dagi `__ORIGIN__` ni `PUBLIC_URL` bilan almashtiradi (og:image/og:url absolyut bo'lsin).
 */
function pwa(): Plugin {
  const origin = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
  return {
    name: "aes-pwa",
    transformIndexHtml: (html) => html.replaceAll("__ORIGIN__", origin),
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith(".map") && f !== "index.html")
        .sort();
      const version = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
      const source = readFileSync(new URL("./sw.template.js", import.meta.url), "utf8")
        .replace(/^\/\* global .*\*\/\r?\n/, "")
        .replace("const VERSION = __VERSION__;", `const VERSION = ${JSON.stringify(version)};`)
        .replace(
          "const PRECACHE = __PRECACHE__;",
          `const PRECACHE = ${JSON.stringify(["/", ...files.map((f) => `/${f}`), ...PUBLIC_SHELL])};`,
        );
      if (source.includes("= __")) this.error("sw.template.js: almashtirilmagan joy qoldi");
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
    apply: "build",
  };
}

// Dev: `pnpm --filter @aes/web dev` → API so'rovlari lokal serverga (3000) proksi qilinadi.
export default defineConfig({
  plugins: [react(), tailwindcss(), pwa()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000", "/oauth": "http://localhost:3000" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
