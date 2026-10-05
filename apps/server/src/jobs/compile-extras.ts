/**
 * Compiler kontekstining server ma'lumotlariga bog'liq qismi (engine PREFLIGHT va MCP preflight/dry_run uchun
 * bir xil): Spec'dagi shablonlar (§11.2).
 */
import type { CompileContext } from "@aes/compiler";
import type { VideoSpec } from "@aes/shared";
import type { AppContext } from "../context";

export type CompileExtras = Pick<CompileContext, "templates" | "tokens">;

export async function compileExtras(
  ctx: Pick<AppContext, "templates">,
  userId: string,
  spec: VideoSpec,
): Promise<CompileExtras> {
  const templates = await ctx.templates.forSpec(userId, spec);
  return Object.keys(templates).length === 0 ? {} : { templates };
}
