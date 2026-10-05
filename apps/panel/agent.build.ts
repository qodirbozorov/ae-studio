/**
 * Agent bundle: CEP ichidagi Node (15+) uchun bitta CJS fayl (`dist/cep/agent/agent.cjs`).
 * Barcha bog'liqliklar (zod, @aes/shared, keyin `ws`) ichiga olinadi — extension'da node_modules shart emas.
 */
import { build, context } from "esbuild";
import type { BuildOptions } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const panelDir = path.dirname(fileURLToPath(import.meta.url));

export const AGENT_ENTRY = path.join(panelDir, "src", "agent", "index.ts");

function options(outFile: string, sourcemap: boolean): BuildOptions {
  return {
    entryPoints: [AGENT_ENTRY],
    outfile: outFile,
    bundle: true,
    platform: "node",
    // CEP 11 = Node 15.9 (eng eski qo'llanadigan).
    target: "node15",
    format: "cjs",
    minify: true,
    sourcemap,
    // `ws` ning ixtiyoriy native qo'shimchalari (D9: native modul yo'q).
    external: ["bufferutil", "utf-8-validate"],
    logLevel: "warning",
  };
}

export async function buildAgent(outFile: string, sourcemap: boolean): Promise<void> {
  await build(options(outFile, sourcemap));
}

export async function watchAgent(outFile: string): Promise<void> {
  const ctx = await context(options(outFile, true));
  await ctx.watch();
}
