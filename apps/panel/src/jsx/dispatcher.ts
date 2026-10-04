/**
 * `runOp(json)` — yagona kirish nuqtasi (§10.3). Bitta evalScript = bitta op.
 * Har doim JSON satr qaytaradi: `{ ok: true, data }` yoki `{ ok: false, error }`.
 */
import type { AeContext, AeRequest, AeResponse, OpEnvelope, OpResultData } from "@aes/shared/ae";
import { makeError } from "@aes/shared/errors";
import { MIN_AE_VERSION } from "../shared/constants";
import { ping } from "./ops/ping";
import { isAesThrown, raise } from "./lib/util";

/** Op handler: params tekshirilgan (agent zod bilan), op_id va kontekst bilan chaqiriladi. */
export type OpHandler = (params: never, opId: string, ctx: AeContext) => OpResultData;

const handlers: { [op: string]: OpHandler | undefined } = {};

export function registerOp(name: string, handler: OpHandler): void {
  handlers[name] = handler;
}

registerOp("ping", ping as OpHandler);

/** O'zgartirmaydigan oplar: undo group ochilmaydi. */
const READ_ONLY: { [op: string]: boolean | undefined } = { ping: true };

function respond(response: AeResponse): string {
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

export function runOp(json: string): string {
  let request: AeRequest;
  try {
    request = JSON.parse(json) as AeRequest;
  } catch (_e) {
    return respond({ ok: false, error: makeError("AE_BAD_PARAMS", "So'rov JSON emas") });
  }
  const op = request === null || typeof request !== "object" ? undefined : request.op;
  if (op === undefined || op === null || typeof op.op !== "string") {
    return respond({ ok: false, error: makeError("AE_BAD_PARAMS", "op yo'q") });
  }
  const readOnly = READ_ONLY[op.op] === true;
  if (!readOnly && parseFloat(app.version) < MIN_AE_VERSION) {
    return respond({
      ok: false,
      error: makeError("AE_VERSION", "After Effects " + app.version + " < " + MIN_AE_VERSION),
    });
  }
  const handler = handlers[op.op];
  if (handler === undefined) {
    return respond({ ok: false, error: makeError("AE_UNKNOWN_OP", "Noma'lum op: " + op.op) });
  }
  const ctx: AeContext =
    request.ctx === undefined || request.ctx === null ? { root: "" } : request.ctx;

  app.beginSuppressDialogs();
  if (!readOnly) app.beginUndoGroup("aes:" + op.op_id);
  try {
    const data = execute(handler, op);
    return respond({ ok: true, data: data });
  } catch (error) {
    if (isAesThrown(error)) {
      return respond({ ok: false, error: makeError(error.aesCode, error.message, error.details) });
    }
    return respond({ ok: false, error: makeError("AE_SCRIPT_ERROR", describeError(error)) });
  } finally {
    if (!readOnly) app.endUndoGroup();
    app.endSuppressDialogs(false);
  }

  function execute(fn: OpHandler, envelope: OpEnvelope): OpResultData {
    if (typeof envelope.op_id !== "string" || envelope.op_id === "") {
      raise("AE_BAD_PARAMS", "op_id yo'q");
    }
    const params = envelope.params === undefined || envelope.params === null ? {} : envelope.params;
    return fn(params as never, envelope.op_id, ctx);
  }
}
