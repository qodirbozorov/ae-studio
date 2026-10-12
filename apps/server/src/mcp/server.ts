/**
 * MCP server (Streamable HTTP, stateless): har so'rovga yangi `Server` + transport, foydalanuvchi tokendan.
 * Low-level `Server` ishlatiladi: inputSchema zod v4 `z.toJSONSchema` dan, javoblar yagona formatda.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fail, makeError, parseWith } from "@aes/shared";
import type { AesError } from "@aes/shared";
import { z } from "zod";
import { RateLimiter } from "../lib/rate-limit";
import { SERVER_VERSION } from "../version";
import type { PromptDef } from "./prompts";
import type { ToolContext, ToolDef, ToolOutput } from "./registry";

export const MCP_INSTRUCTIONS = `AE Studio builds After Effects videos on the user's own computer from a declarative Video Spec (plan.json). The AE panel (agent) must be online; all media stays local, you see it through previews.

Loop (follow in order, every stage has a gate):
1. env_check → is the panel online, AE open, a project folder selected? If not, tell the user exactly what to do (hint field).
2. project_list / project_get, or project_create (absolute folder path on the user's machine).
3. assets_scan, then assets_list. Use asset_preview to actually look at images/videos before planning. Reference media only as "asset:<key>" from assets_list — never invent keys.
4. spec_schema (once) → plan_write. On SPEC_INVALID fix exactly the reported JSON Pointer paths; use plan_patch for small edits.
5. preflight → fix missing[] → build_start (dry_run first for long videos).
6. Poll job_status every 5-10 s until state is VERIFY, BLOCKED or DONE. Do not start a second job: one active job per device.
7. VERIFY: the user reviews the result in the After Effects timeline first — tell them which .aep and composition to open (aep_path from job_status) and ask for feedback. Use contact_sheet only when the user asks you to look or for one quick sanity check (a single call, small max_px); frames_capture only for one specific frame. Then verify_patch with the user's corrections (max 3 patches, then ask), or verify_approve when the user is satisfied. The user can also approve with the «Tasdiqlash» button in the AE panel or web cabinet: when the user comes back, call job_status first. Any tool result may carry a "notices" array (e.g. the user approved in the panel) — tell the user about it in the chat. An approved job (DONE, outcome success) can still be fixed: verify_patch on that same job reopens it.
8. verify_approve does NOT render: the job finishes (DONE) and the .aep stays in the user's AE. Rendering is heavy for the user's computer: never render on your own — only when the user explicitly asks (verify_approve with render: true + user_confirmed: true, or render_start with user_confirmed: true for a finished job). report_get summarizes the job.

Professional layers (any visual layer: media, text, shape, solid, null, adjustment): keyframes {path: [{t, v, ease}]} with ease tokens enter|exit|move|soft|pop or cubic-bezier [x1,y1,x2,y2]; transform (AE units: px, %, degrees); effects[] by alias (gaussian_blur, drop_shadow, glow, gradient_ramp, four_color_gradient for mesh gradients, bezier_warp / wave_warp / turbulent_displace / bulge for deformation …) or any installed matchName — ae_effects lists them, fx_params shows exact param names/indices before you set unfamiliar ones; masks[] (rect, ellipse, path, svg_d); matte {source, type}; blend; parent; three_d. Shape layers: contents[] with rect/ellipse/star/polygon/path (svg_d + fit for icons)/group, fill/stroke (dashes, gradient), trim/round_corners/repeater/merge/offset_paths and contents.<id>.* keyframes. Hybrid scripts (only what the spec cannot do): per layer presets [{name, at}] (presets_list, preset_inspect), expressions {path: "lib:inertial_bounce(0.05,4,8)" or raw}, text_anim {by, preset, stagger}; spec scripts[] {id, lib | code, hook, args} with snippets from scripts_lib_list (counter, text_words, apply_preset …). Scripts work on layers the spec created, are short, and their results go to the job log (a failing script does not stop the job). ae_run_jsx runs raw ExtendScript immediately (no approval), e.g. a whole scene from the ae-extendscript helpers.

Icons: never draw icon paths yourself — icons_search (Lucide) → layer {type: "icon", name, size, color}; it comes in as vector footage (as_shapes: true only to animate its paths). After build, ae_inspect reads back what AE actually created.

Audio: put voiceover/music/sfx/captions/source_audio into the spec's audio section; the job's AUDIO stage produces them (cached by params, files stored on the server and downloaded into the project's audio/ folder). Scenes can follow the voiceover sentences with dur "vo:a-b". Uzbek TTS: model eleven_v4, language "uz"; STT: audio_transcribe (scribe_v2). Never name the underlying audio provider to the user — say "audio service". Everything is paid from the user's prepaid balance (balance_get): run audio_estimate first (USD; cached items cost half) and if ask_user is true tell the user the price and ask. Music: search the library first (music_search, cheap) and use audio.music {kind: "library", track} — short tracks are looped with a crossfade; generate new music (spec music.kind "music" or music_generate) only if nothing fits AND the user accepted the price. Clean speech: source_audio.isolate true/"standard" runs on our server (cheap); "pro" is premium. Pro music/isolation need the user's consent unless they turned Pro on in the panel: on BILLING_CONFIRM_REQUIRED tell the price and, after a yes, build_start/job_resume with pro_confirmed: true. Standalone tools: voice_tts, sfx_generate, music_generate, music_plan, voice_dialogue, audio_transcribe + transcript_get/transcript_edit, audio_align, audio_isolate, voice_change, audio_dub, voice_design, voice_clone (only with the owner's consent), audio_tasks_status.

Errors are { ok:false, error:{ code, retryable, hint } }. BLOCKED: read error.hint; retryable → job_resume after the cause is fixed; SPEC_*/ASSET_* → verify_patch or plan_patch; otherwise ask the user. Nothing is ever overwritten: plans, .aep files and renders are versioned (v001, v002…). Reply to the user in their language (often Uzbek).`;

const PER_MINUTE = 120;

/** Handler natijasi → MCP CallToolResult (text JSON + rasmlar). */
export function toCallResult(output: ToolOutput, notices: readonly string[] = []): CallToolResult {
  const { images, ...result } = output;
  const body = notices.length > 0 ? { ...result, notices } : result;
  const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(body) }];
  for (const image of images ?? []) content.push(image);
  return result.ok ? { content } : { content, isError: true };
}

export interface McpServerOptions {
  tools: readonly ToolDef[];
  prompts: readonly PromptDef[];
  limiter: RateLimiter;
  context: ToolContext;
  /** Har tool chaqiruvi (audit, Claude indikatori). */
  onCall?: (name: string, ok: boolean) => void;
  /** Claude hali ko'rmagan voqealar (masalan foydalanuvchi panelda tasdiqladi) — javobga qo'shiladi. */
  notices?: () => Promise<string[]>;
}

export function createMcpServer(options: McpServerOptions): Server {
  const server = new Server(
    { name: "ae-studio", title: "AE Studio", version: SERVER_VERSION },
    { capabilities: { tools: {}, prompts: {} }, instructions: MCP_INSTRUCTIONS },
  );
  const byName = new Map(
    options.tools.flatMap((tool) =>
      [tool.name, ...(tool.aliases ?? [])].map((name) => [name, tool]),
    ),
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: options.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.input, { io: "input" }) as {
        type: "object";
        [key: string]: unknown;
      },
      ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (tool === undefined) {
      return toCallResult(fail("SYS_NOT_FOUND", `Noma'lum tool: ${request.params.name}`));
    }
    if (!options.limiter.take(options.context.userId)) {
      return toCallResult(
        fail("SYS_RATE_LIMIT", `Daqiqasiga ${PER_MINUTE} ta chaqiruv chegarasi`, {
          retry_after_s: options.limiter.retryAfterS(options.context.userId),
        }),
      );
    }
    const input = parseWith(tool.input, request.params.arguments ?? {}, "SYS_BAD_REQUEST");
    if (!input.ok) {
      options.onCall?.(tool.name, false);
      return toCallResult(input);
    }
    let output: ToolOutput;
    try {
      output = await tool.handler(options.context, input.data);
    } catch (error) {
      options.context.log.error({ err: error, tool: tool.name }, "mcp tool xatosi");
      output = {
        ok: false,
        error: makeError("SYS_INTERNAL", error instanceof Error ? error.message : String(error)),
      } as { ok: false; error: AesError };
    }
    options.onCall?.(tool.name, output.ok);
    const notices = (await options.notices?.().catch(() => [])) ?? [];
    return toCallResult(output, notices);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: options.prompts.map((prompt) => ({
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = options.prompts.find((p) => p.name === request.params.name);
    if (prompt === undefined) throw new Error(`Noma'lum prompt: ${request.params.name}`);
    return prompt.render(request.params.arguments ?? {});
  });

  return server;
}

export function mcpRateLimiter(now: () => Date): RateLimiter {
  return new RateLimiter(PER_MINUTE, 60_000, () => now().getTime());
}
