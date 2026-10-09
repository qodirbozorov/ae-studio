/**
 * AE vositalari (Faza 7, update-technicalguidline §5.2): o'rnatilgan effektlar, effekt parametrlari
 * va qurilgan comp/qatlam tuzilmasi — Claude spec'ni aniq yozishi va natijani tekshirishi uchun.
 */
import { FX_ALIASES, fxMatchName } from "@aes/compiler";
import { fail, makeOp, ok } from "@aes/shared";
import type { AeOpName, OpEnvelope, OpParamsMap, Result } from "@aes/shared";
import { z } from "zod";
import { defineTool } from "../registry";
import type { ToolContext } from "../registry";
import { pickDevice, uuidArg } from "./common";

const deviceFields = {
  device_id: uuidArg("device_id").optional().describe("Usually not needed"),
  project_id: uuidArg("project_id").optional().describe("Resolve the device of this project"),
};

async function runInfo<N extends AeOpName>(
  ctx: ToolContext,
  input: { device_id?: string | undefined; project_id?: string | undefined },
  op: N,
  params: OpParamsMap[N],
  timeoutMs = 30_000,
): Promise<Result<Record<string, unknown>>> {
  const picked = await pickDevice(ctx, input.device_id, input.project_id);
  if (!picked.ok) return picked;
  if (!ctx.app.hub.isOnline(picked.data.id)) return fail("ENV_AGENT_OFFLINE", "Panel ulanmagan");
  const res = await ctx.app.hub.run(
    picked.data.id,
    makeOp(op, `mcp.${op}.${Date.now()}`, 0, params, { timeout_ms: timeoutMs }) as OpEnvelope,
    "mcp",
  );
  if (!res.ok) return res;
  return ok(res.data.info ?? {});
}

export const aeTools = [
  defineTool({
    name: "ae_effects",
    title: "Installed effects",
    description:
      'Lists effects installed in After Effects (built-in and third-party plugins) with matchName and category. Use a matchName in spec effects[].fx when AE Studio has no alias for it. query filters by name, matchName or category (e.g. "blur", "glow", "Sapphire", "Distort").',
    input: z.object({
      query: z.string().max(128).optional(),
      limit: z.number().int().min(1).max(500).default(100),
      ...deviceFields,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const params: OpParamsMap["fx.catalog"] = { limit: input.limit };
      if (input.query !== undefined) params.query = input.query;
      return runInfo(ctx, input, "fx.catalog", params);
    },
  }),

  defineTool({
    name: "fx_params",
    title: "Effect parameters",
    description:
      'Shows the exact parameters of an effect: 1-based index, display name, matchName, type (number, point2d, color, group …), default value, min/max — by adding it to a temporary layer in AE. Use it before setting params of unfamiliar or third-party effects. In spec effects[].params the key can be the index ("3"), the name or the matchName; values: numbers, [x, y] points in layer px, "#RRGGBB" colors. Also lists the param aliases AE Studio maps for that effect.',
    input: z.object({
      fx: z.string().min(1).max(128).describe("Alias (gaussian_blur, glow …) or effect matchName"),
      ...deviceFields,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const res = await runInfo(
        ctx,
        input,
        "fx.params",
        { match_name: fxMatchName(input.fx) },
        60_000,
      );
      if (!res.ok) return res;
      const alias = FX_ALIASES[input.fx];
      if (alias === undefined) return res;
      const aliases: Record<string, string> = {};
      for (const [name, param] of Object.entries(alias.params)) aliases[name] = param.key;
      return ok({ ...res.data, aliases });
    },
  }),

  defineTool({
    name: "ae_inspect",
    title: "Inspect composition",
    description:
      "Reads back what is actually built in After Effects. Without layer: the composition's layers (type, timing, parent, effects, masks). With layer: that layer's property tree (values, keyframe counts, expressions) to depth. comp = composition name (scene comps are named like 01_<scene_id>, the main comp has the output name; default: the active comp); layer = layer name (the layer id from the spec).",
    input: z.object({
      comp: z.string().min(1).max(255).optional(),
      layer: z.string().min(1).max(255).optional(),
      depth: z.number().int().min(0).max(6).default(3),
      ...deviceFields,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const params: OpParamsMap["layer.inspect"] = { depth: input.depth };
      if (input.comp !== undefined) params.comp = input.comp;
      if (input.layer !== undefined) params.layer = input.layer;
      return runInfo(ctx, input, "layer.inspect", params);
    },
  }),
];
