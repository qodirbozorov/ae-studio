/**
 * Agent ↔ ExtendScript ko'prigi: `evalScript` orqali `$[NS].runOp(json)` (§10.3).
 * Bitta chaqiruv = bitta op; timeout bo'lsa `AE_TIMEOUT` (AE o'zi opni oxirigacha bajaradi).
 */
import { fail } from "@aes/shared";
import type { AeContext, AeRequest, AeResponse, OpEnvelope } from "@aes/shared";
import { JSX_VERSION, NS } from "../shared/constants";
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

/**
 * jsx yuklanmagan yoki AE sessiyasida boshqa versiya (panel yangilangan) bo'lsa — NOT_LOADED:
 * agent bundle'ni qayta yuklaydi (P6.03, `AES.version`).
 */
export function buildRunOpScript(request: AeRequest, version: string = JSX_VERSION): string {
  const ns = scriptLiteral(NS);
  return (
    `(typeof $[${ns}] === "undefined" || $[${ns}].version !== ${scriptLiteral(version)} ? ` +
    `${scriptLiteral(NOT_LOADED)} : ` +
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
  /** Oxirgi yuklash xatosi (AE'dagi haqiqiy sabab: fayl, istisno matni, qator). */
  let loadError: string | null = null;

  async function loadJsx(): Promise<boolean> {
    if (jsxPath === undefined) {
      loadError = "jsx yo'li berilmagan";
      return false;
    }
    // Xato bo'lsa CEP faqat "EvalScript error." qaytaradi — sababni ExtendScript ichida ushlaymiz.
    const script =
      `(function () { try { var f = new File(${scriptLiteral(jsxPath)});` +
      ` if (!f.exists) return "ERR:fayl topilmadi: " + f.fsName;` +
      ` $.evalFile(f); var api = $[${scriptLiteral(NS)}];` +
      ` return typeof api === "object" ? "v:" + api.version : typeof api;` +
      ` } catch (e) { return "ERR:" + e.toString() + (e.line ? " (qator " + e.line + ")" : ""); } })()`;
    try {
      const result = await withTimeout(evalScript(script), LOAD_TIMEOUT_MS);
      if (result === `v:${JSX_VERSION}`) {
        loadError = null;
        return true;
      }
      if (result.startsWith("v:")) {
        loadError = `jsx versiyasi ${result.slice(2)}, panel ${JSX_VERSION} kutadi (panelni qayta o'rnating)`;
        return false;
      }
      loadError = result.startsWith("ERR:")
        ? result.slice(4)
        : result === EVAL_SCRIPT_ERROR
          ? "evalScript xatosi"
          : `kutilmagan javob: ${result.slice(0, 120)}`;
      return false;
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
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
      return fail(
        "AE_SCRIPT_ERROR",
        `ExtendScript (jsx) AE'ga yuklanmagan${loadError === null ? "" : `: ${loadError}`}`,
      );
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
