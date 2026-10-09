/**
 * Agent ↔ ExtendScript ko'prigi: `evalScript` orqali `$[NS].runOp(json)` (§10.3).
 * Bitta chaqiruv = bitta op; timeout bo'lsa `AE_TIMEOUT` (AE o'zi opni oxirigacha bajaradi).
 */
import { fail } from "@aes/shared";
import type {
  AeBatchRequest,
  AeBatchResponse,
  AeContext,
  AeRequest,
  AeResponse,
  OpEnvelope,
} from "@aes/shared";
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
function buildScript(
  method: "runOp" | "runBatch",
  request: AeRequest | AeBatchRequest,
  version: string,
): string {
  const ns = scriptLiteral(NS);
  return (
    `(typeof $[${ns}] === "undefined" || $[${ns}].version !== ${scriptLiteral(version)} ? ` +
    `${scriptLiteral(NOT_LOADED)} : ` +
    `$[${ns}].${method}(${scriptLiteral(JSON.stringify(request))}))`
  );
}

export function buildRunOpScript(request: AeRequest, version: string = JSX_VERSION): string {
  return buildScript("runOp", request, version);
}

/** Sahna batch'i bitta evalScript'da (P6.04). */
export function buildRunBatchScript(
  request: AeBatchRequest,
  version: string = JSX_VERSION,
): string {
  return buildScript("runBatch", request, version);
}

function isAeResponse(value: unknown): value is AeResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { ok?: unknown; data?: unknown; error?: unknown };
  return v.ok === true ? typeof v.data === "object" : v.ok === false && typeof v.error === "object";
}

function isBatchResponse(value: unknown): value is AeBatchResponse {
  if (!isAeResponse(value)) return false;
  return !value.ok || Array.isArray((value.data as { results?: unknown }).results);
}

export interface AeBridge {
  runOp(op: OpEnvelope, ctx: AeContext): Promise<AeResponse>;
  /** Oplar bitta evalScript'da (P6.04); `timeoutMs` — butun batch uchun. */
  runBatch(
    ops: OpEnvelope[],
    ctx: AeContext,
    options: { label?: string; timeoutMs: number },
  ): Promise<AeBatchResponse>;
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

  /** Skriptni yuboradi; jsx yuklanmagan/eski bo'lsa bir marta qayta yuklab takrorlaydi. */
  async function invoke(
    script: string,
    timeoutMs: number,
    what: string,
  ): Promise<{ ok: true; parsed: unknown } | { ok: false; response: ReturnType<typeof fail> }> {
    let raw: string;
    try {
      raw = await withTimeout(evalScript(script), timeoutMs);
      if (raw === NOT_LOADED && (await loadJsx())) {
        raw = await withTimeout(evalScript(script), timeoutMs);
      }
    } catch (error) {
      if (error instanceof TimeoutError) {
        return {
          ok: false,
          response: fail("AE_TIMEOUT", `${what} ${timeoutMs} ms ichida tugamadi`),
        };
      }
      return {
        ok: false,
        response: fail("ENV_AE_CLOSED", error instanceof Error ? error.message : String(error)),
      };
    }
    if (raw === NOT_LOADED) {
      return {
        ok: false,
        response: fail(
          "AE_SCRIPT_ERROR",
          `ExtendScript (jsx) AE'ga yuklanmagan${loadError === null ? "" : `: ${loadError}`}`,
        ),
      };
    }
    if (raw === EVAL_SCRIPT_ERROR || raw === "") {
      return {
        ok: false,
        response: fail("AE_SCRIPT_ERROR", "evalScript xatosi (ExtendScript istisnosi)"),
      };
    }
    try {
      return { ok: true, parsed: JSON.parse(raw) as unknown };
    } catch {
      return {
        ok: false,
        response: fail(
          "AE_SCRIPT_ERROR",
          "ExtendScript kutilmagan javob qaytardi: " + raw.slice(0, 200),
        ),
      };
    }
  }

  async function runOp(op: OpEnvelope, ctx: AeContext): Promise<AeResponse> {
    const res = await invoke(buildRunOpScript({ op, ctx }), op.timeout_ms, op.op);
    if (!res.ok) return res.response;
    if (isAeResponse(res.parsed)) return res.parsed;
    return fail("AE_SCRIPT_ERROR", "ExtendScript kutilmagan javob qaytardi");
  }

  async function runBatch(
    ops: OpEnvelope[],
    ctx: AeContext,
    options: { label?: string; timeoutMs: number },
  ): Promise<AeBatchResponse> {
    const request: AeBatchRequest = { ops, ctx };
    if (options.label !== undefined) request.label = options.label;
    const res = await invoke(
      buildRunBatchScript(request),
      options.timeoutMs,
      `batch (${ops.length} op)`,
    );
    if (!res.ok) return res.response;
    if (isBatchResponse(res.parsed)) return res.parsed;
    return fail("AE_SCRIPT_ERROR", "ExtendScript kutilmagan batch javobi qaytardi");
  }

  return { runOp, runBatch, loadJsx };
}
