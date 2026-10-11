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
  telegram_id: string | null;
  email: string | null;
  created_at: string | null;
  devices: number;
  online: number;
}

export interface DeviceJob {
  id: string;
  state: string;
  outcome: string | null;
  paused: boolean;
  project: string;
  updated_at: string;
  progress: number | null;
}

export interface Device {
  id: string;
  name: string;
  os: string;
  ae_version: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
  online: boolean;
  panel_version: string | null;
  project_root: string | null;
  project_path: string | null;
  ffmpeg: boolean | null;
  job: DeviceJob | null;
}

export interface DeviceEvent {
  ts: string;
  level: string;
  type: string;
  message: string;
  op_id: string | null;
  job_id: string;
  project: string;
}

export interface DeviceActivity {
  device: Device;
  jobs: {
    id: string;
    state: string;
    outcome: string | null;
    project: string;
    created_at: string;
  }[];
  events: DeviceEvent[];
}

export interface AuditRow {
  ts: string;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
  data: unknown;
}
