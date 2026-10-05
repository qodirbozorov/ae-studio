import react from "@vitejs/plugin-react";
import { lstatSync, rmdirSync, rmSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { cep, runAction } from "vite-cep-plugin";
import type { CepOptions } from "vite-cep-plugin";
import { buildAgent, watchAgent } from "./agent.build";
import cepConfig from "./cep.config";
import { buildJsx, watchJsx } from "./vite.es.config";

const panelDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(panelDir, "src", "js");
const devDist = "dist";
const cepDist = "cep";
const outDir = path.join(panelDir, devDist, cepDist);
const jsxOut = path.join(outDir, "jsx", "index.js");
const agentOut = path.join(outDir, "agent", "agent.cjs");

const isProduction = process.env.NODE_ENV === "production";
const isMetaPackage = process.env.ZIP_PACKAGE === "true";
const isPackage = process.env.ZXP_PACKAGE === "true" || isMetaPackage;
const isServe = process.env.SERVE_PANEL === "true";
const action = process.env.BOLT_ACTION;
const sourcemap = (isPackage ? cepConfig.zxp.sourceMap : cepConfig.build?.sourceMap) ?? false;

const input = Object.fromEntries(
  cepConfig.panels.map((panel) => [panel.name, path.resolve(root, panel.mainPath)]),
);

const cepOptions: CepOptions = {
  cepConfig,
  isProduction,
  isPackage,
  isMetaPackage,
  isServe,
  debugReact: false,
  dir: path.join(panelDir, devDist),
  cepDist,
  zxpOutput: path.join(panelDir, devDist, "zxp", cepConfig.id),
  zipOutput: path.join(panelDir, devDist, "zip", `${cepConfig.displayName}_${cepConfig.version}`),
  packages: cepConfig.installModules ?? [],
};

if (action) runAction(cepOptions, action);

/**
 * ExtendScript (jsx) va Node agent bundle'lari Vite build'idan oldin (buildStart) tayyorlanadi:
 * ZXP imzolash (vite-cep-plugin writeBundle) paytida ular allaqachon `dist/cep` da bo'lishi shart.
 */
function nativeBundles(): Plugin {
  return {
    name: "aes-native-bundles",
    async buildStart() {
      if (this.meta.watchMode) {
        watchJsx(jsxOut, () => console.log("[jsx] qayta build qilindi"));
        await watchAgent(agentOut);
        return;
      }
      rmSync(outDir, { recursive: true, force: true });
      await Promise.all([buildJsx(jsxOut, sourcemap), buildAgent(agentOut, sourcemap)]);
    },
  };
}

/**
 * vite-cep-plugin har build'da CEP extensions papkasiga junction yaratadi (dev qulayligi).
 * Production build repo tashqarisida iz qoldirmasligi uchun u olib tashlanadi; kerak bo'lsa AES_SYMLINK=1.
 */
function removeBuildSymlink(): Plugin {
  return {
    name: "aes-remove-build-symlink",
    apply: "build",
    closeBundle() {
      if (!isProduction || process.env.AES_SYMLINK === "1") return;
      const extensions =
        process.platform === "win32"
          ? path.join(process.env.APPDATA ?? "", "Adobe", "CEP", "extensions")
          : path.join(os.homedir(), "Library", "Application Support", "Adobe", "CEP", "extensions");
      const link = path.join(extensions, cepConfig.id);
      try {
        if (!lstatSync(link).isSymbolicLink()) return;
      } catch {
        return;
      }
      try {
        unlinkSync(link);
      } catch {
        rmdirSync(link);
      }
    },
  };
}

export default defineConfig({
  plugins: [nativeBundles(), react(), cep(cepOptions), removeBuildSymlink()],
  root,
  clearScreen: false,
  server: { port: cepConfig.port },
  preview: { port: cepConfig.servePort },
  build: {
    sourcemap,
    outDir,
    emptyOutDir: false,
    // CEP 11 (AE 2022+) ichidagi Chromium 88.
    target: "chrome88",
    rollupOptions: {
      input,
      output: {
        manualChunks: {},
        preserveModules: false,
        format: "cjs",
        entryFileNames: "assets/[name]-[hash].cjs",
        chunkFileNames: "assets/[name]-[hash].cjs",
      },
    },
  },
});
