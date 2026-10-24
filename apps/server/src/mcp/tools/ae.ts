/**
 * AE vositalari (Faza 7, update-technicalguidline §5.2): o'rnatilgan effektlar, effekt parametrlari
 * va qurilgan comp/qatlam tuzilmasi — Claude spec'ni aniq yozishi va natijani tekshirishi uchun.
 */
import { EXPRESSION_LIB, FX_ALIASES, SCRIPT_LIB, fxMatchName, scriptParams } from "@aes/compiler";
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
    name: "ae_run_jsx",
    title: "Run script in AE",
    description:
      "Runs a short script in After Effects right now (outside a build) — for fixes and checks. Prefer lib (tested snippets, scripts_lib_list); raw code is ES3 ExtendScript with AES helpers (AES.target(args), AES.layer(comp, id), AES.preset(layer, name, sec), AES.prop(layer, path), AES.anim, AES.dump) runs without approval. A whole-scene build in one script is fine (up to 120 s); the result is the script's return value or its last expression (e.g. an IIFE returning a log string). Returns {ok, result | error, line, ms}.",
    input: z.object({
      lib: z
        .string()
        .regex(/^[a-z0-9_]+$/)
        .optional(),
      code: z.string().min(1).max(50_000).optional(),
      args: z.record(z.string(), z.unknown()).optional(),
      ...deviceFields,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async handler(ctx, input) {
      if ((input.lib === undefined) === (input.code === undefined)) {
        return fail("SYS_BAD_REQUEST", "lib yoki code (bittasi) kerak");
      }
      const params = scriptParams(input, {}, false);
      if (!params.ok) return params;
      return runInfo(ctx, input, "jsx.run", params.data, 120_000);
    },
  }),

  defineTool({
    name: "scripts_lib_list",
    title: "Script snippets",
    description:
      'Tested script snippets for spec scripts[] (hook after_layer:<id> | after_scene:<id> | after_build) and ae_run_jsx, with their args; plus expression templates for layer expressions ("lib:name(args)").',
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler() {
      return ok({
        snippets: Object.entries(SCRIPT_LIB).map(([name, entry]) => ({
          name,
          description: entry.description,
          args: entry.args,
        })),
        expressions: EXPRESSION_LIB,
      });
    },
  }),

  defineTool({
    name: "presets_list",
    title: "Animation presets",
    description:
      "Lists .ffx animation presets available to AE: the project's presets/ folder, User Presets and AE's built-in Presets. Use the name in a layer's presets [{name, at}] or the apply_preset snippet.",
    input: z.object({
      query: z.string().max(128).optional(),
      limit: z.number().int().min(1).max(500).default(100),
      ...deviceFields,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const params: OpParamsMap["presets.list"] = { limit: input.limit };
      if (input.query !== undefined) params.query = input.query;
      return runInfo(ctx, input, "presets.list", params, 60_000);
    },
  }),

  defineTool({
    name: "preset_inspect",
    title: "Inspect preset",
    description:
      "Applies a preset to a temporary layer in AE and reports what it adds: effects, keyframed properties (with key counts) and expressions. Use it to learn a preset before using it.",
    input: z.object({
      name: z.string().min(1).max(256),
      layer_type: z.enum(["text", "solid", "shape"]).default("text"),
      ...deviceFields,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      return runInfo(
        ctx,
        input,
        "preset.inspect",
        { name: input.name, layer_type: input.layer_type },
        60_000,
      );
    },
  }),

  defineTool({
    name: "icons_search",
    title: "Search icons",
    description:
      'Searches icons by name words, e.g. "bell", "arrow right", "youtube". Lucide (ISC, ~1,600 consistent outline UI icons, offline) comes first, then Iconify (200,000+ icons in 150+ sets): brand logos (prefix simple-icons — mono, logos — multicolor), filled/other styles (mdi, ph, tabler, solar, material-symbols), flags (flag), emoji (fluent-emoji-flat), weather etc. Prefer one set per video for a consistent look; use prefix to search one set. Brand logo missing there, or the official full-color/wordmark logo needed: source "worldvectorlogo" (WorldVectorLogo, 60,000+ brand logos as wvl:<slug>; each search spends limited monthly admin credits — search once, precise brand name). Results: icons[] (prefix:name), collections{prefix: {name, license, multicolor}} (mention non-permissive licenses, e.g. CC BY, and that brand logos are trademarks), logos[] (WorldVectorLogo: title, downloads — prefer the most downloaded/current version). Use the name in a spec layer {type: "icon", name, size, color, stroke_width}: crisp vector footage in AE; as_shapes: true builds a native shape layer (exact size, centered) for path animation. color has no effect on multicolor icons.',
    input: z.object({
      query: z.string().min(1).max(64),
      limit: z.number().int().min(1).max(50).default(20),
      source: z
        .enum(["all", "lucide", "iconify", "worldvectorlogo"])
        .default("all")
        .describe(
          "all: Lucide first, then Iconify; lucide: offline only; iconify: Iconify only; worldvectorlogo: brand logos (uses credits, never included in all)",
        ),
      prefix: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(40)
        .optional()
        .describe("One Iconify set, e.g. simple-icons, logos, mdi, ph, tabler, flag"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(ctx, input) {
      return ok(
        await ctx.app.icons.search(input.query, input.limit, {
          source: input.source,
          ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
        }),
      );
    },
  }),

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
