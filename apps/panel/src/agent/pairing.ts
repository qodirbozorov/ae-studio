/**
 * Device flow panel tomoni (§4.2, RFC 8628): kod olish → foydalanuvchi web'da tasdiqlaydi → token poll.
 */
import { postJson } from "./http";

export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceGrant {
  access_token: string;
  device_id: string;
}

export class PairingError extends Error {
  constructor(
    readonly reason: "expired" | "denied" | "cancelled" | "server",
    message: string,
  ) {
    super(message);
    this.name = "PairingError";
  }
}

/** `https://app` yoki `https://app/` → `https://app`. */
export function normalizeServerUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Server manzili http(s):// bilan boshlanishi kerak");
  }
  return url.origin;
}

/** `https://app` → `wss://app/ws/agent`. */
export function agentSocketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/agent";
  return url.toString();
}

export async function requestDeviceCode(
  serverUrl: string,
  device: { name: string; os: string },
): Promise<DeviceCode> {
  const res = await postJson<DeviceCode & { error?: string }>(`${serverUrl}/oauth/device/code`, {
    device_name: device.name,
    os: device.os,
  });
  if (res.status !== 200 || typeof res.body.user_code !== "string") {
    throw new PairingError("server", `Kod olinmadi (HTTP ${res.status})`);
  }
  return res.body;
}

export interface PollOptions {
  signal?: { cancelled: boolean };
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Tasdiqlanguncha poll qiladi; `slow_down` da oraliq 5 s ga oshadi (RFC 8628 §3.5). */
export async function pollDeviceToken(
  serverUrl: string,
  code: DeviceCode,
  options: PollOptions = {},
): Promise<DeviceGrant> {
  const sleep = options.sleep ?? defaultSleep;
  let interval = code.interval * 1000;
  for (;;) {
    await sleep(interval);
    if (options.signal?.cancelled) throw new PairingError("cancelled", "Bekor qilindi");
    const res = await postJson<{ access_token?: string; device_id?: string; error?: string }>(
      `${serverUrl}/oauth/device/token`,
      { grant_type: DEVICE_GRANT, device_code: code.device_code },
    );
    if (
      res.status === 200 &&
      res.body.access_token !== undefined &&
      res.body.device_id !== undefined
    ) {
      return { access_token: res.body.access_token, device_id: res.body.device_id };
    }
    switch (res.body.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval += 5_000;
        continue;
      case "access_denied":
        throw new PairingError("denied", "Ulanish web kabinetda rad etildi");
      case "expired_token":
        throw new PairingError("expired", "Kod eskirdi — qaytadan boshlang");
      default:
        throw new PairingError("server", `Kutilmagan javob (HTTP ${res.status})`);
    }
  }
}
