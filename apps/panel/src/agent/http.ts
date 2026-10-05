/** Minimal JSON HTTP klient: CEP Node 15 da `fetch` yo'q. */
import http from "node:http";
import https from "node:https";

export interface HttpResponse<T> {
  status: number;
  body: T;
}

export function postJson<T>(
  url: string,
  payload: unknown,
  timeoutMs = 15_000,
): Promise<HttpResponse<T>> {
  const target = new URL(url);
  const client = target.protocol === "https:" ? https : http;
  const data = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const request = client.request(
      target,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": data.length },
        timeout: timeoutMs,
      },
      (response) => {
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
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error(`${timeoutMs} ms ichida javob bo'lmadi`)),
    );
    request.on("error", reject);
    request.end(data);
  });
}
