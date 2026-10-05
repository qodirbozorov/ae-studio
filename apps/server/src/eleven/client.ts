/**
 * ElevenLabs HTTP klienti (§7). SDK o'rniga yupqa `fetch` qatlami: aniq nazorat, soxta server bilan test.
 * - Auth: `xi-api-key` sarlavhasi.
 * - Xatolar (§7.1): 401 → EL_AUTH, 402/kvota → EL_QUOTA, 429 → EL_RATE_LIMIT, timeout → EL_TIMEOUT, boshqa 4xx → EL_BAD_PARAMS.
 * - 429/5xx/tarmoq xatolarida 3 marta exponential backoff.
 */
import { makeError } from "@aes/shared";
import type { AesError } from "@aes/shared";

export const ELEVEN_BASE_URL = "https://api.elevenlabs.io";

export class ElevenError extends Error {
  constructor(
    readonly error: AesError,
    readonly status: number | null = null,
  ) {
    super(error.message ?? error.code);
    this.name = "ElevenError";
  }
}

export interface ElevenOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Bitta so'rov uchun timeout (ms). */
  timeoutMs?: number;
  retries?: number;
}

export type Body = { json: unknown } | { form: FormData } | undefined;

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: Body;
  timeoutMs?: number;
}

function detailText(payload: unknown): string {
  if (payload === null || typeof payload !== "object") return String(payload ?? "");
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (detail !== null && typeof detail === "object") {
    const d = detail as { message?: unknown; status?: unknown };
    if (typeof d.message === "string") return `${String(d.status ?? "")} ${d.message}`.trim();
    return JSON.stringify(detail).slice(0, 500);
  }
  return JSON.stringify(payload).slice(0, 500);
}

/** HTTP holati va javob matni → tasniflangan xato. */
export function mapElevenError(status: number, payload: unknown): AesError {
  const message = `ElevenLabs ${status}: ${detailText(payload)}`.slice(0, 600);
  const lower = message.toLowerCase();
  if (status === 401) return makeError("EL_AUTH", message);
  if (status === 402 || lower.includes("quota") || lower.includes("credits")) {
    return makeError("EL_QUOTA", message);
  }
  if (status === 429) return makeError("EL_RATE_LIMIT", message);
  if (status >= 500) return makeError("EL_TIMEOUT", message);
  return makeError("EL_BAD_PARAMS", message, payload);
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;

export class ElevenClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(
    private readonly apiKey: string,
    options: ElevenOptions = {},
  ) {
    this.baseUrl = (options.baseUrl ?? ELEVEN_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.retries = options.retries ?? 3;
  }

  private url(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  /** So'rov (retry bilan) → Response (2xx). */
  private async send(method: string, path: string, options: RequestOptions): Promise<Response> {
    let lastError: AesError = makeError("EL_TIMEOUT", "ElevenLabs javob bermadi");
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await this.sleep(500 * 2 ** (attempt - 1));
      const headers: Record<string, string> = { "xi-api-key": this.apiKey };
      let body: string | FormData | undefined;
      if (options.body !== undefined && "json" in options.body) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(options.body.json);
      } else if (options.body !== undefined) {
        body = options.body.form;
      }
      let response: Response;
      try {
        response = await this.fetchImpl(this.url(path, options.query), {
          method,
          headers,
          ...(body === undefined ? {} : { body }),
          signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
        });
      } catch (error) {
        lastError = makeError(
          "EL_TIMEOUT",
          `ElevenLabs: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (response.ok) return response;
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      lastError = mapElevenError(response.status, payload);
      if (!RETRYABLE(response.status)) throw new ElevenError(lastError, response.status);
    }
    throw new ElevenError(lastError);
  }

  async json<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(method, path, options);
    return (await response.json()) as T;
  }

  /** Binary javob (audio) va content-type. */
  async binary(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<{ data: Buffer; contentType: string; requestId: string | null }> {
    const response = await this.send(method, path, options);
    return {
      data: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      requestId: response.headers.get("request-id"),
    };
  }
}
