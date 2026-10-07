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
import type { Plugin } from "rollup";

/**
 * ExtendScript faylni BOM'siz bo'lsa tizim kodirovkasida o'qishi mumkin (Windows: cp1251/1252) - UTF-8
 * belgilar (o'zbekcha apostrof, tire, strelka) buziladi. Bundle to'liq ASCII qilinadi (\uXXXX) va qator
 * oxirlari LF (Bolt include'i yakka CR qoldiradi).
 */
export function extendScriptSafe(): Plugin {
  const safe = (code: string) =>
    code
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0080-￿]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
  return {
    name: "aes-extendscript-safe",
    renderChunk(code) {
      return { code: safe(code), map: null };
    },
    // Bolt jsxInclude json2'ni keyinroq qo'shadi (yakka CR bilan) — oxirida yana tozalanadi.
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "chunk") chunk.code = safe(chunk.code);
      }
    },
  };
}

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
        // Symbol ExtendScript'da yo'q: har `typeof` uchun _typeof helper qo'shilmasin.
        presets: [[presetEnv, { exclude: ["transform-typeof-symbol"] }], presetTypescript],
      }),
      jsxPonyfill(),
      jsxInclude({ iife: true, globalThis: "thisObj" }),
      extendScriptSafe(),
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
