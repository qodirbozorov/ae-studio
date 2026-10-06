/** Server REST API (§8 formati: `{ ok, data } | { ok: false, error }`). */
export interface ApiError {
  code: string;
  hint: string;
  message?: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function api<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
    });
    return (await response.json()) as ApiResult<T>;
  } catch {
    return { ok: false, error: { code: "SYS_INTERNAL", hint: "Server bilan aloqa yo'q" } };
  }
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export interface Me {
  id: string;
  name: string;
}

export interface Device {
  id: string;
  name: string;
  os: string;
  ae_version: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
