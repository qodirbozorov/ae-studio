/**
 * Kirish nuqtalari (§10.3): `runOp(json)` — bitta op; `runBatch(json)` — sahna oplari bitta evalScript'da (P6.04).
 * Har doim JSON satr qaytaradi: `{ ok: true, data }` yoki `{ ok: false, error }`.
 */
import type {
  AeBatchItem,
  AeBatchRequest,
  AeBatchResponse,
  AeContext,
  AeRequest,
  AeResponse,
  OpEnvelope,
  OpResultData,
} from "@aes/shared/ae";
import { makeError } from "@aes/shared/errors";
import type { AesError } from "@aes/shared/errors";
import { MIN_AE_VERSION } from "../shared/constants";
import { compCreate, compNest } from "./ops/comp";
import { fxAdd, fxApplyPreset, fxCatalog, fxParams } from "./ops/fx";
import { itemImport } from "./ops/item";
import { layerAddAudio, layerAddMedia, layerAddShape, layerAddText } from "./ops/layer";
import { audioDuck, captionsBuild } from "./ops/audio";
import { framesCapture } from "./ops/frames";
import { templateInstantiate } from "./ops/template";
import { layerInspect } from "./ops/inspect";
import { layerAddSolid, layerMask, layerSet } from "./ops/pro";
import { info } from "./ops/info";
import { ping } from "./ops/ping";
import { projectOpenOrCreate, projectSave } from "./ops/project";
import { propExpression, propKeyframes } from "./ops/prop";
import { renderQueue } from "./ops/render";
import { undo } from "./ops/undo";
import { beginTraceCache, endTraceCache, resetTraceCache } from "./lib/trace";
import { isAesThrown, isArray, raise } from "./lib/util";

/** Op handler: params tekshirilgan (agent zod bilan), op_id va kontekst bilan chaqiriladi. */
export type OpHandler = (params: never, opId: string, ctx: AeContext) => OpResultData;

const handlers: { [op: string]: OpHandler | undefined } = {};

export function registerOp(name: string, handler: OpHandler): void {
  handlers[name] = handler;
}

registerOp("ping", ping as OpHandler);
registerOp("info", info as OpHandler);
registerOp("frames.capture", framesCapture as OpHandler);
registerOp("render.queue", renderQueue as OpHandler);
registerOp("captions.build", captionsBuild as OpHandler);
registerOp("audio.duck", audioDuck as OpHandler);
registerOp("undo", undo as OpHandler);
registerOp("comp.create", compCreate as OpHandler);
registerOp("item.import", itemImport as OpHandler);
registerOp("layer.add_text", layerAddText as OpHandler);
registerOp("layer.add_media", layerAddMedia as OpHandler);
registerOp("project.open_or_create", projectOpenOrCreate as OpHandler);
registerOp("project.save", projectSave as OpHandler);
registerOp("comp.nest", compNest as OpHandler);
registerOp("layer.add_shape", layerAddShape as OpHandler);
registerOp("layer.add_audio", layerAddAudio as OpHandler);
registerOp("prop.keyframes", propKeyframes as OpHandler);
registerOp("prop.expression", propExpression as OpHandler);
registerOp("fx.apply_preset", fxApplyPreset as OpHandler);
registerOp("fx.add", fxAdd as OpHandler);
registerOp("template.instantiate", templateInstantiate as OpHandler);
registerOp("layer.add_solid", layerAddSolid as OpHandler);
registerOp("layer.set", layerSet as OpHandler);
registerOp("layer.mask", layerMask as OpHandler);
registerOp("fx.catalog", fxCatalog as OpHandler);
registerOp("fx.params", fxParams as OpHandler);
registerOp("layer.inspect", layerInspect as OpHandler);

/** O'zgartirmaydigan oplar: undo group ochilmaydi. */
const READ_ONLY: { [op: string]: boolean | undefined } = {
  ping: true,
  info: true,
  "fx.catalog": true,
  "layer.inspect": true,
};

/** Loyihani ochish/saqlash undo tarixiga kirmaydi (undo group ichida loyiha almashtirilmaydi). */
const NO_UNDO: { [op: string]: boolean | undefined } = {
  undo: true,
  "frames.capture": true,
  "render.queue": true,
  "project.open_or_create": true,
  "project.save": true,
};

function respond(response: AeResponse | AeBatchResponse): string {
  return JSON.stringify(response);
}

function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const e = error as { message?: unknown; line?: unknown };
    const message = typeof e.message === "string" ? e.message : String(error);
    return typeof e.line === "number" ? message + " (qator " + e.line + ")" : message;
  }
  return String(error);
}

function toError(error: unknown): AesError {
  if (isAesThrown(error)) return makeError(error.aesCode, error.message, error.details);
  return makeError("AE_SCRIPT_ERROR", describeError(error));
}

function parseRequest<T>(json: string): T | null {
  try {
    const value = JSON.parse(json) as T;
    return value === null || typeof value !== "object" ? null : value;
  } catch (_e) {
    return null;
  }
}

function contextOf(ctx: AeContext | undefined | null): AeContext {
  return ctx === undefined || ctx === null ? { root: "" } : ctx;
}

function versionError(): AesError | null {
  if (parseFloat(app.version) >= MIN_AE_VERSION) return null;
  return makeError("AE_VERSION", "After Effects " + app.version + " < " + MIN_AE_VERSION);
}

/** Bitta op (undo group va dialoglar chaqiruvchida). Xato bo'lsa tashlaydi. */
function execute(envelope: OpEnvelope, ctx: AeContext): OpResultData {
  if (envelope === null || typeof envelope !== "object" || typeof envelope.op !== "string") {
    return raise("AE_BAD_PARAMS", "op yo'q");
  }
  const handler = handlers[envelope.op];
  if (handler === undefined) return raise("AE_UNKNOWN_OP", "Noma'lum op: " + envelope.op);
  if (typeof envelope.op_id !== "string" || envelope.op_id === "") {
    return raise("AE_BAD_PARAMS", "op_id yo'q");
  }
  const params = envelope.params === undefined || envelope.params === null ? {} : envelope.params;
  return handler(params as never, envelope.op_id, ctx);
}

export function runOp(json: string): string {
  const request = parseRequest<AeRequest>(json);
  if (request === null) {
    return respond({ ok: false, error: makeError("AE_BAD_PARAMS", "So'rov JSON emas") });
  }
  const op = request.op;
  if (op === undefined || op === null || typeof op.op !== "string") {
    return respond({ ok: false, error: makeError("AE_BAD_PARAMS", "op yo'q") });
  }
  const readOnly = READ_ONLY[op.op] === true;
  if (!readOnly) {
    const tooOld = versionError();
    if (tooOld !== null) return respond({ ok: false, error: tooOld });
  }
  if (handlers[op.op] === undefined) {
    return respond({ ok: false, error: makeError("AE_UNKNOWN_OP", "Noma'lum op: " + op.op) });
  }
  const ctx = contextOf(request.ctx);

  app.beginSuppressDialogs();
  const undo = !readOnly && NO_UNDO[op.op] !== true;
  if (undo) app.beginUndoGroup("aes:" + op.op_id);
  try {
    return respond({ ok: true, data: execute(op, ctx) });
  } catch (error) {
    return respond({ ok: false, error: toError(error) });
  } finally {
    if (undo) app.endUndoGroup();
    app.endSuppressDialogs(false);
  }
}

/** Loyihani tashqaridan o'zgartiradigan oplar: keyin iz keshi qayta skanerlanadi. */
const RESCAN: { [op: string]: boolean | undefined } = {
  "template.instantiate": true,
  "render.queue": true,
  "project.open_or_create": true,
  undo: true,
};

function now(): number {
  return new Date().getTime();
}

/**
 * `runBatch(json)` — sahna oplari bitta evalScript'da (P6.04, update-technicalguidline §3.2, §3.4):
 * dialoglar bir marta o'chiriladi, undo group'ga kiradigan ketma-ket oplar bitta guruhda, iz keshi bilan.
 * Birinchi xatoda to'xtaydi; qolgan oplar natijada yo'q (chaqiruvchi ularni "bajarilmagan" deb biladi).
 */
export function runBatch(json: string): string {
  const request = parseRequest<AeBatchRequest>(json);
  if (request === null || !isArray(request.ops) || request.ops.length === 0) {
    return respond({ ok: false, error: makeError("AE_BAD_PARAMS", "Batch so'rovi noto'g'ri") });
  }
  const tooOld = versionError();
  if (tooOld !== null) return respond({ ok: false, error: tooOld });
  const ctx = contextOf(request.ctx);
  const started = now();
  const results: AeBatchItem[] = [];
  // Undo group nomi — guruhdagi birinchi op_id (`aes:<op_id>`, bittalik op bilan bir xil format).
  let undoGroup: string | null = null;

  app.beginSuppressDialogs();
  beginTraceCache();
  try {
    for (let i = 0; i < request.ops.length; i++) {
      const op = request.ops[i]!;
      const name = op !== null && typeof op === "object" ? op.op : "";
      const opStarted = now();
      const undoable = READ_ONLY[name] !== true && NO_UNDO[name] !== true;
      if (!undoable && undoGroup !== null) {
        app.endUndoGroup();
        undoGroup = null;
      }
      if (undoable && undoGroup === null) {
        undoGroup = String(op.op_id);
        app.beginUndoGroup("aes:" + undoGroup);
      }
      try {
        const data = execute(op, ctx);
        if (undoGroup !== null) data.undo_group = undoGroup;
        results.push({ op_id: op.op_id, ok: true, data: data, ms: now() - opStarted });
      } catch (error) {
        results.push({ op_id: op.op_id, ok: false, error: toError(error), ms: now() - opStarted });
        break;
      }
      if (RESCAN[name] === true) resetTraceCache();
    }
  } finally {
    if (undoGroup !== null) app.endUndoGroup();
    endTraceCache();
    app.endSuppressDialogs(false);
  }
  return respond({ ok: true, data: { results: results, ms: now() - started } });
}
