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
7. VERIFY: contact_sheet (one grid image with times; frames_capture for single large frames), look at the frames critically against the brief. Then verify_approve, or verify_patch with a corrected spec (max 3 patches, then ask the user).
8. After approve the job renders (RENDER) and writes a report: report_get and show it to the user with the output path.

Professional layers (any visual layer: media, text, shape, solid, null, adjustment): keyframes {path: [{t, v, ease}]} with ease tokens enter|exit|move|soft|pop or cubic-bezier [x1,y1,x2,y2]; transform (AE units: px, %, degrees); effects[] by alias (gaussian_blur, drop_shadow, glow, gradient_ramp, four_color_gradient for mesh gradients, bezier_warp / wave_warp / turbulent_displace / bulge for deformation …) or any installed matchName — ae_effects lists them, fx_params shows exact param names/indices before you set unfamiliar ones; masks[] (rect, ellipse, path, svg_d); matte {source, type}; blend; parent; three_d. Shape layers: contents[] with rect/ellipse/star/polygon/path (svg_d + fit for icons)/group, fill/stroke (dashes, gradient), trim/round_corners/repeater/merge/offset_paths and contents.<id>.* keyframes. After build, ae_inspect reads back what AE actually created.

Audio (ElevenLabs, key set in the web cabinet — env_check.checks.elevenlabs): put voiceover/music/sfx/captions/source_audio into the spec's audio section; the job's AUDIO stage generates them (cached by params, files stored on the server and downloaded into the project's audio/ folder). Scenes can follow the voiceover sentences with dur "vo:a-b". Uzbek TTS: model eleven_v4, language "uz"; STT: el_stt (scribe_v2). Before spending credits run el_estimate; if ask_user is true, ask the user. Standalone tools: el_tts, el_sfx, el_music(_plan), el_dialogue, el_stt + transcript_get/transcript_edit, el_align, el_isolate, el_voice_change, el_dub, el_voice_design, el_voice_clone (only with the owner's consent), audio_tasks_status.

Errors are { ok:false, error:{ code, retryable, hint } }. BLOCKED: read error.hint; retryable → job_resume after the cause is fixed; SPEC_*/ASSET_* → verify_patch or plan_patch; otherwise ask the user. Nothing is ever overwritten: plans, .aep files and renders are versioned (v001, v002…). Reply to the user in their language (often Uzbek).`;

const PER_MINUTE = 120;

/** Handler natijasi → MCP CallToolResult (text JSON + rasmlar). */
export function toCallResult(output: ToolOutput): CallToolResult {
  const { images, ...result } = output;
  const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(result) }];
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
}

export function createMcpServer(options: McpServerOptions): Server {
  const server = new Server(
    { name: "ae-studio", title: "AE Studio", version: SERVER_VERSION },
    { capabilities: { tools: {}, prompts: {} }, instructions: MCP_INSTRUCTIONS },
  );
  const byName = new Map(options.tools.map((tool) => [tool.name, tool]));

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
    return toCallResult(output);
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
