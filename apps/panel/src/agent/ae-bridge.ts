/**
 * Agent ↔ ExtendScript ko'prigi: `evalScript` orqali `$[NS].runOp(json)` (§10.3).
 * Bitta chaqiruv = bitta op; timeout bo'lsa `AE_TIMEOUT` (AE o'zi opni oxirigacha bajaradi).
 */
import { fail } from "@aes/shared";
import type { AeContext, AeRequest, AeResponse, OpEnvelope } from "@aes/shared";
import { NS } from "../shared/constants";
import { TimeoutError, withTimeout } from "./timeout";

/** CEP `__adobe_cep__.evalScript` ning Promise ko'rinishi. */
export type EvalScript = (script: string) => Promise<string>;

/** ExtendScript ichida istisno bo'lsa CEP shu satrni qaytaradi. */
export const EVAL_SCRIPT_ERROR = "EvalScript error.";
const NOT_LOADED = "__AES_NOT_LOADED__";
const LOAD_TIMEOUT_MS = 15_000;

/**
 * JS satr literal'i (ExtendScript uchun xavfsiz): JSON escape + U+2028/2029,
 * chunki ES3'da ular satr ichida qator oxiri hisoblanadi.
 */
export function scriptLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function buildRunOpScript(request: AeRequest): string {
  const ns = scriptLiteral(NS);
  return (
    `(typeof $[${ns}] === "undefined" ? ${scriptLiteral(NOT_LOADED)} : ` +
    `$[${ns}].runOp(${scriptLiteral(JSON.stringify(request))}))`
  );
}

function isAeResponse(value: unknown): value is AeResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { ok?: unknown; data?: unknown; error?: unknown };
  return v.ok === true ? typeof v.data === "object" : v.ok === false && typeof v.error === "object";
}

export interface AeBridge {
  runOp(op: OpEnvelope, ctx: AeContext): Promise<AeResponse>;
  /** jsx bundle'ni (qayta) yuklaydi; muvaffaqiyatli bo'lsa true. */
  loadJsx(): Promise<boolean>;
}

export function createAeBridge(options: { evalScript: EvalScript; jsxPath?: string }): AeBridge {
  const { evalScript, jsxPath } = options;

  async function loadJsx(): Promise<boolean> {
    if (jsxPath === undefined) return false;
    const script = `$.evalFile(${scriptLiteral(jsxPath)}); typeof $[${scriptLiteral(NS)}]`;
    try {
      return (await withTimeout(evalScript(script), LOAD_TIMEOUT_MS)) === "object";
    } catch {
      return false;
    }
  }

  async function call(op: OpEnvelope, ctx: AeContext): Promise<string> {
    return withTimeout(evalScript(buildRunOpScript({ op, ctx })), op.timeout_ms);
  }

  async function runOp(op: OpEnvelope, ctx: AeContext): Promise<AeResponse> {
    let raw: string;
    try {
      raw = await call(op, ctx);
      if (raw === NOT_LOADED && (await loadJsx())) raw = await call(op, ctx);
    } catch (error) {
      if (error instanceof TimeoutError) {
        return fail("AE_TIMEOUT", `${op.op} ${op.timeout_ms} ms ichida tugamadi`);
      }
      return fail("ENV_AE_CLOSED", error instanceof Error ? error.message : String(error));
    }
    if (raw === NOT_LOADED) {
      return fail("AE_SCRIPT_ERROR", "ExtendScript (jsx) AE'ga yuklanmagan");
    }
    if (raw === EVAL_SCRIPT_ERROR || raw === "") {
      return fail("AE_SCRIPT_ERROR", "evalScript xatosi (ExtendScript istisnosi)");
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isAeResponse(parsed)) return parsed;
    } catch {
      // pastda umumiy xato
    }
    return fail("AE_SCRIPT_ERROR", "ExtendScript kutilmagan javob qaytardi: " + raw.slice(0, 200));
  }

  return { runOp, loadJsx };
}
