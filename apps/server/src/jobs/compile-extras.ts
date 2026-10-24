/**
 * Compiler kontekstining server ma'lumotlariga bog'liq qismi (engine PREFLIGHT va MCP preflight/dry_run uchun
 * bir xil): Spec'dagi shablonlar (§11.2), brand kit (§11.3), ikonkalar geometriyasi va AE'dagi shriftlar.
 */
import type { CompileContext } from "@aes/compiler";
import { iconKey, makeOp, ok } from "@aes/shared";
import type { Result, VideoSpec } from "@aes/shared";
import type { AppContext } from "../context";

export type CompileExtras = Pick<CompileContext, "templates" | "brand" | "fonts" | "icons">;

/** Spec yoki brand shrift ishlatadimi (PREFLIGHT'da AE'dan shriftlar ro'yxati so'raladi). */
export function usesFonts(spec: VideoSpec, extras: CompileExtras): boolean {
  if (extras.brand !== undefined) return true;
  return spec.scenes.some((scene) =>
    (scene.layers ?? []).some((layer) => layer.type === "text" && layer.style.font !== undefined),
  );
}

/**
 * AE'dagi shriftlarning PostScript nomlari (`info` op). Panel offline yoki AE < 24 bo'lsa null
 * (shriftlar tekshirilmaydi). `ENV_AGENT_OFFLINE` alohida qaytariladi — engine panelni kutadi.
 */
export async function aeFonts(
  ctx: Pick<AppContext, "hub">,
  deviceId: string,
  jobId: string,
): Promise<Result<string[] | null>> {
  const res = await ctx.hub.run(
    deviceId,
    makeOp(
      "info",
      `${jobId === "mcp" ? "mcp" : "preflight"}.info.${Date.now()}`,
      0,
      {},
      {
        timeout_ms: 20_000,
      },
    ),
    jobId,
  );
  if (!res.ok) return res;
  const names = (res.data.info as { font_names?: unknown } | undefined)?.font_names;
  return ok(Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : null);
}

export async function compileExtras(
  ctx: Pick<AppContext, "templates" | "brands" | "icons">,
  userId: string,
  spec: VideoSpec,
): Promise<Result<CompileExtras>> {
  const brand = await ctx.brands.resolve(userId, spec.brand);
  if (!brand.ok) return brand;
  const templates = await ctx.templates.forSpec(userId, spec);
  const names = spec.scenes.flatMap((scene) =>
    (scene.layers ?? []).flatMap((layer) => (layer.type === "icon" ? [iconKey(layer.name)] : [])),
  );
  const icons = names.length === 0 ? null : await ctx.icons.resolve(names);
  if (icons !== null && !icons.ok) return icons;
  return ok({
    ...(Object.keys(templates).length === 0 ? {} : { templates }),
    ...(brand.data === undefined ? {} : { brand: brand.data }),
    ...(icons === null ? {} : { icons: icons.data }),
  });
}
