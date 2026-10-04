/**
 * ExtendScript (ES3) build: TS → Babel (preset-env, maqsadsiz = eng eski) → rollup →
 * Bolt CEP plaginlari (json2 `@include`, ponyfill, IIFE). Natija: `dist/cep/jsx/index.js`.
 * Testlar `generateJsx()` bilan xuddi shu konfiguratsiyani xotirada build qiladi.
 */
import babel from "@rollup/plugin-babel";
import json from "@rollup/plugin-json";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import presetEnv from "@babel/preset-env";
import presetTypescript from "@babel/preset-typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rollup, watch } from "rollup";
import type { OutputChunk, RollupOptions } from "rollup";
import { jsxInclude, jsxPonyfill } from "vite-cep-plugin";

const panelDir = path.dirname(fileURLToPath(import.meta.url));
const extensions = [".js", ".ts"];

export const JSX_ENTRY = path.join(panelDir, "src", "jsx", "index.ts");

export function createJsxRollupOptions(input: string = JSX_ENTRY): RollupOptions {
  return {
    input,
    treeshake: true,
    plugins: [
      json(),
      nodeResolve({ extensions }),
      babel({
        extensions,
        exclude: /node_modules/,
        babelrc: false,
        configFile: false,
        cwd: panelDir,
        babelHelpers: "inline",
        // targets berilmagan: preset-env eng eski muhitni nazarda tutadi (ES3 member/property literal'lari ham).
        presets: [presetEnv, presetTypescript],
      }),
      jsxPonyfill(),
      jsxInclude({ iife: true, globalThis: "thisObj" }),
    ],
    onwarn(warning, warn) {
      // Babel inline helper'lari `this` ni ishlatadi — ExtendScript uchun zararsiz.
      if (warning.code === "THIS_IS_UNDEFINED") return;
      warn(warning);
    },
  };
}

/** Xotirada build (testlar uchun): ExtendScript kodi satr sifatida. */
export async function generateJsx(input: string = JSX_ENTRY): Promise<string> {
  const bundle = await rollup(createJsxRollupOptions(input));
  try {
    const { output } = await bundle.generate({ file: "index.js", format: "es" });
    return (output[0] as OutputChunk).code;
  } finally {
    await bundle.close();
  }
}

export async function buildJsx(outFile: string, sourcemap: boolean): Promise<void> {
  const bundle = await rollup(createJsxRollupOptions());
  try {
    await bundle.write({ file: outFile, format: "es", sourcemap });
  } finally {
    await bundle.close();
  }
}

/** Dev: o'zgarishda qayta build. */
export function watchJsx(outFile: string, onRebuild: () => void): void {
  const options = createJsxRollupOptions();
  const watcher = watch({ ...options, output: { file: outFile, format: "es", sourcemap: true } });
  watcher.on("event", (event) => {
    if (event.code === "BUNDLE_END") {
      void event.result.close();
      onRebuild();
    } else if (event.code === "ERROR") {
      console.error("[jsx]", event.error.message);
    }
  });
}
