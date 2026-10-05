/**
 * Panel ↔ server WebSocket xabarlari (ae-studio-plan.md §10.2).
 * Har xabar `type` bo'yicha ajratiladi. §10.2 ga qo'shimchalar (sababi qarorlar jurnalida):
 * `job.update`, `job.event` (Live ekrani uchun) va `request.failed` (so'rov xatosi).
 */
import { z } from "zod";
import { ERROR_DEFS } from "./errors";
import type { ErrorCode } from "./errors";
import { parseWith, slugSchema } from "./common";
import { JOB_OUTCOMES, JOB_STATES, LOG_LEVELS } from "./jobs";
import { OUTPUT_PRESETS } from "./spec";
import { opEnvelopeSchema, opIdSchema, opResultDataSchema } from "./ops";
import { fail } from "./result";
import type { Result } from "./result";

export const HEARTBEAT_INTERVAL_MS = 10_000;
/** Shuncha vaqt javob bo'lmasa panel offline hisoblanadi → job `WAITING_AGENT` (§10.2). */
export const HEARTBEAT_TIMEOUT_MS = 30_000;

const ERROR_CODES = Object.keys(ERROR_DEFS) as [ErrorCode, ...ErrorCode[]];

export const aesErrorSchema = z.strictObject({
  code: z.enum(ERROR_CODES),
  retryable: z.boolean(),
  hint: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
});

const idSchema = z.string().min(1).max(128);
const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, { error: "sha256: 64 ta kichik hex belgi" });
const storageKeySchema = z.string().min(1).max(512);
const relPathSchema = z.string().min(1).max(1024);
const jobStateSchema = z.enum(JOB_STATES);
const logLevelSchema = z.enum(LOG_LEVELS);
const uploadTargetSchema = z.strictObject({
  url: z.url(),
  storage_key: storageKeySchema,
});

// ---------------------------------------------------------------- server → panel

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("hello_ack"),
    protocol_version: z.number().int(),
    server_version: z.string(),
    device_id: idSchema,
    heartbeat_ms: z.number().int().positive(),
  }),
  z.strictObject({ type: z.literal("op.run"), job_id: idSchema, op: opEnvelopeSchema }),
  z.strictObject({
    type: z.literal("ops.batch"),
    job_id: idSchema,
    ops: z.array(opEnvelopeSchema).min(1).max(500),
  }),
  z.strictObject({
    type: z.literal("asset.preview.request"),
    request_id: idSchema,
    local_path: relPathSchema,
    mode: z.enum(["image", "frames"]),
    /** `frames` rejimida soniyalar; berilmasa `count` ta teng oraliqda. */
    times: z.array(z.number().min(0)).max(50).optional(),
    count: z.number().int().min(1).max(50).optional(),
    max_px: z.number().int().min(64).max(4096),
    uploads: z.array(uploadTargetSchema).min(1).max(50),
  }),
  z.strictObject({
    type: z.literal("audio.extract.request"),
    request_id: idSchema,
    local_path: relPathSchema,
    format: z.enum(["opus", "wav", "mp3"]),
    mono: z.boolean(),
    sample_rate: z.number().int().min(8000).max(96_000).optional(),
    upload: uploadTargetSchema,
  }),
  z.strictObject({
    type: z.literal("file.download"),
    request_id: idSchema,
    url: z.url(),
    sha256: sha256Schema,
    dest: relPathSchema,
    size: z.number().int().min(0).optional(),
    /**
     * Mavjud faylni boshqa tarkib bilan almashtirishga ruxsat (default yo'q: versiyalar ustiga yozilmaydi, §2.10).
     * Bir xil sha256 li mavjud fayl har doim "saqlangan" hisoblanadi.
     */
    overwrite: z.boolean().optional(),
  }),
  z.strictObject({
    /** §10.2 ga qo'shimcha: INGEST — panel `source/` ni skanerlaydi va `asset.scanned` yuboradi. */
    type: z.literal("assets.scan"),
    request_id: idSchema,
    project_root: z.string().min(1).max(1024),
  }),
  z.strictObject({
    /** MCP `project_create`: panel papkani tayyorlaydi, loyihani ro'yxatdan o'tkazadi va ochadi. */
    type: z.literal("project.open"),
    request_id: idSchema,
    root_path: z.string().min(2).max(1024),
  }),
  z.strictObject({
    /**
     * RENDER (P3.07): panel `.aep` dan `comp_name` ni aerender (yoki Render Queue) bilan render qiladi,
     * ffmpeg bilan preset bo'yicha mp4 ga o'giradi. `out_base` + `.mp4`; mavjud bo'lsa `_2`, `_3` … (ustiga yozilmaydi).
     */
    type: z.literal("render.request"),
    request_id: idSchema,
    job_id: idSchema,
    project_path: relPathSchema,
    comp: z.strictObject({ op_id: opIdSchema, name: z.string().min(1).max(255) }),
    out_base: relPathSchema,
    preset: z.enum(OUTPUT_PRESETS),
    fps: z.number().positive().max(240),
    duration: z.number().positive().max(36_000),
  }),
  z.strictObject({ type: z.literal("job.pause"), job_id: idSchema }),
  z.strictObject({ type: z.literal("job.cancel"), job_id: idSchema }),
  z.strictObject({
    type: z.literal("job.update"),
    job_id: idSchema,
    state: jobStateSchema,
    prev_state: jobStateSchema.optional(),
    progress: z.strictObject({ done: z.number().int().min(0), total: z.number().int().min(0) }),
    scene_id: slugSchema.optional(),
    /** Live ekrani uchun qo'shimcha: pauza, yakun, BLOCKED xatosi. */
    paused: z.boolean().optional(),
    outcome: z.enum(JOB_OUTCOMES).optional(),
    error: aesErrorSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("job.event"),
    job_id: idSchema,
    event: z.strictObject({
      ts: z.iso.datetime(),
      level: logLevelSchema,
      type: z.string().min(1).max(64),
      op_id: opIdSchema.optional(),
      message: z.string().max(4000),
      data: z.unknown().optional(),
    }),
  }),
  z.strictObject({ type: z.literal("ping"), ts: z.number() }),
]);

// ---------------------------------------------------------------- panel → server

export const panelMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("hello"),
    protocol_version: z.number().int(),
    panel_version: z.string(),
    device: z.strictObject({
      name: z.string().min(1).max(100),
      os: z.string().min(1).max(100),
    }),
    ae_version: z.string().nullable(),
    project_root: z.string().max(1024).nullable(),
    /** Uzilish paytida bajarilayotgan op (resume uchun). */
    running: z.strictObject({ job_id: idSchema, op_id: opIdSchema }).nullable(),
  }),
  z.strictObject({
    type: z.literal("op.started"),
    job_id: idSchema,
    op_id: opIdSchema,
    ts: z.number(),
  }),
  z.strictObject({
    type: z.literal("op.done"),
    job_id: idSchema,
    op_id: opIdSchema,
    result: opResultDataSchema,
    duration_ms: z.number().min(0),
  }),
  z.strictObject({
    type: z.literal("op.failed"),
    job_id: idSchema,
    op_id: opIdSchema,
    error: aesErrorSchema,
    duration_ms: z.number().min(0),
  }),
  z.strictObject({
    type: z.literal("log"),
    level: logLevelSchema,
    message: z.string().max(4000),
    job_id: idSchema.optional(),
    op_id: opIdSchema.optional(),
    data: z.unknown().optional(),
  }),
  z.strictObject({
    type: z.literal("asset.scanned"),
    request_id: idSchema.optional(),
    project_root: z.string().max(1024),
    assets: z
      .array(
        z.strictObject({
          key: slugSchema,
          local_path: relPathSchema,
          kind: z.enum(["video", "image", "audio", "other"]),
          size: z.number().int().min(0),
          mtime_ms: z.number().min(0),
          hash: z.string().min(1).max(128),
          meta: z.record(z.string(), z.unknown()),
          thumb_key: storageKeySchema.optional(),
          error: aesErrorSchema.optional(),
        }),
      )
      .max(10_000),
  }),
  z.strictObject({
    type: z.literal("file.uploaded"),
    request_id: idSchema,
    storage_key: storageKeySchema,
    sha256: sha256Schema,
    size: z.number().int().min(0),
  }),
  z.strictObject({
    type: z.literal("file.saved"),
    request_id: idSchema,
    dest: relPathSchema,
    sha256: sha256Schema,
    size: z.number().int().min(0),
  }),
  z.strictObject({
    type: z.literal("ae.state"),
    ae_version: z.string().nullable(),
    project_path: z.string().max(1024).nullable(),
    /** Panelda ochiq ish papkasi (job CHECK uni loyiha papkasi bilan solishtiradi). */
    project_root: z.string().max(1024).nullable().optional(),
    /** ffmpeg/ffprobe ishlaydimi (env_check). */
    ffmpeg: z.boolean().nullable().optional(),
    busy: z.boolean(),
  }),
  z.strictObject({
    /** `asset.preview.request` javobi: yuklangan JPG'lar (tartib bilan). */
    type: z.literal("asset.preview.ready"),
    request_id: idSchema,
    files: z
      .array(
        z.strictObject({
          storage_key: storageKeySchema,
          time: z.number().min(0).nullable(),
          size: z.number().int().min(0),
        }),
      )
      .min(1)
      .max(50),
  }),
  z.strictObject({
    type: z.literal("render.done"),
    request_id: idSchema,
    out: relPathSchema,
    duration: z.number().min(0),
    size: z.number().int().min(0),
    method: z.enum(["aerender", "render_queue"]),
    encoder: z.string().max(64),
  }),
  z.strictObject({
    type: z.literal("project.opened"),
    request_id: idSchema,
    project: z.strictObject({
      id: idSchema,
      name: z.string().min(1).max(200),
      root_path: z.string().min(1).max(1024),
    }),
  }),
  z.strictObject({ type: z.literal("pong"), ts: z.number() }),
  z.strictObject({
    type: z.literal("request.failed"),
    request_id: idSchema,
    error: aesErrorSchema,
  }),
]);

export type ServerMessage = z.output<typeof serverMessageSchema>;
export type PanelMessage = z.output<typeof panelMessageSchema>;
export type ServerMessageType = ServerMessage["type"];
export type PanelMessageType = PanelMessage["type"];
export type ServerMessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;
export type PanelMessageOf<T extends PanelMessageType> = Extract<PanelMessage, { type: T }>;

/** Xom xabarni (string yoki obyekt) parse va validatsiya qiladi. */
function parseMessage<T>(schema: z.ZodType<T>, raw: unknown, code: ErrorCode): Result<T> {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return fail(code, "Xabar JSON emas");
    }
  }
  return parseWith(schema, value, code);
}

export function parseServerMessage(raw: unknown): Result<ServerMessage> {
  return parseMessage(serverMessageSchema, raw, "SYS_BAD_REQUEST");
}

export function parsePanelMessage(raw: unknown): Result<PanelMessage> {
  return parseMessage(panelMessageSchema, raw, "SYS_BAD_REQUEST");
}

export function encodeMessage(message: ServerMessage | PanelMessage): string {
  return JSON.stringify(message);
}
