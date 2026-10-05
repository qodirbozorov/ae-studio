/** Minimal JSON HTTP klient: CEP Node 15 da `fetch` yo'q. */
import http from "node:http";
import https from "node:https";

export interface HttpResponse<T> {
  status: number;
  body: T;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function requestJson<T>(
  method: "GET" | "POST",
  url: string,
  payload: unknown,
  options: RequestOptions,
): Promise<HttpResponse<T>> {
  const target = new URL(url);
  const client = target.protocol === "https:" ? https : http;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const data = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
  const headers: Record<string, string | number> = { ...options.headers };
  if (data !== null) {
    headers["content-type"] = "application/json";
    headers["content-length"] = data.length;
  }
  return new Promise((resolve, reject) => {
    const request = client.request(target, { method, headers, timeout: timeoutMs }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try {
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) as T });
        } catch {
          reject(
            new Error(
              `Server JSON qaytarmadi (HTTP ${response.statusCode}): ${text.slice(0, 120)}`,
            ),
          );
        }
      });
    });
    request.on("timeout", () =>
      request.destroy(new Error(`${timeoutMs} ms ichida javob bo'lmadi`)),
    );
    request.on("error", reject);
    request.end(data ?? undefined);
  });
}

export function postJson<T>(
  url: string,
  payload: unknown,
  options: RequestOptions = {},
): Promise<HttpResponse<T>> {
  return requestJson<T>("POST", url, payload, options);
}

export function getJson<T>(url: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
  return requestJson<T>("GET", url, undefined, options);
}
