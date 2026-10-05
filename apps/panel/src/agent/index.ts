/**
 * Panel agenti (CEP ichidagi Node, mixed context). UI uni `agent/agent.cjs` dan `require` qiladi
 * va CEP `evalScript` ni beradi. Agent brauzer API'siga bog'liq emas — Node'da test qilinadi.
 */
import os from "node:os";
import { makeOp } from "@aes/shared";
import { createAeBridge } from "./ae-bridge";
import type { AeBridge, EvalScript } from "./ae-bridge";
import { clearCredentials, loadCredentials, saveCredentials } from "./credentials";
import type { Credentials } from "./credentials";
import { LogStore } from "./log";
import { createOpRunner } from "./op-runner";
import type { OpRunner } from "./op-runner";
import {
  PairingError,
  agentSocketUrl,
  normalizeServerUrl,
  pollDeviceToken,
  requestDeviceCode,
} from "./pairing";
import type { DeviceCode, PollOptions } from "./pairing";
import { createWsClient } from "./ws-client";
import type { WsClient } from "./ws-client";

export interface AgentOptions {
  evalScript: EvalScript;
  /** jsx bundle yo'li (`<extension>/jsx/index.js`): yuklanmagan bo'lsa avtomatik `$.evalFile`. */
  jsxPath?: string;
  root?: string;
  /** Credentials papkasi (CEP userData); berilmasa home. */
  dataDir?: string;
  panelVersion?: string;
  /** Testlar uchun: poll kutishini boshqarish. */
  pollOptions?: PollOptions;
}

export interface ServerConnection {
  url: string;
  token: string;
  device: { name: string; os: string };
  panelVersion: string;
}

export interface Pairing {
  /** Panelda ko'rsatiladigan kod. */
  code: Promise<DeviceCode>;
  /** Tasdiqlanib ulanganda tugaydi; rad etilsa/eskirsa `PairingError`. */
  done: Promise<Credentials>;
  cancel(): void;
}

export interface Agent {
  log: LogStore;
  bridge: AeBridge;
  runner: OpRunner;
  getRoot(): string;
  setRoot(root: string): void;
  /** Saqlangan qurilma hisobi (yo'q bo'lsa null). */
  account(): Credentials | null;
  /** Device flow: kod → web'da tasdiq → token saqlanadi → ulanadi. */
  pair(serverUrl: string): Pairing;
  /** Saqlangan token bilan ulanish; hisob yo'q bo'lsa null. */
  connectSaved(): WsClient | null;
  /** Ulanishni uzadi va tokenni o'chiradi. */
  logout(): void;
  /** Past darajali ulanish (dev token, testlar). */
  connect(server: ServerConnection): WsClient;
  disconnect(): void;
  connection(): WsClient | null;
}

export function deviceInfo(): { name: string; os: string } {
  return { name: os.hostname(), os: `${os.type()} ${os.release()}` };
}

export function createAgent(options: AgentOptions): Agent {
  let root = options.root ?? "";
  const dataDir = options.dataDir ?? os.homedir();
  const panelVersion = options.panelVersion ?? "0.0.0";
  const log = new LogStore();
  const bridge = createAeBridge({ evalScript: options.evalScript, jsxPath: options.jsxPath });
  const runner = createOpRunner({ bridge, log, getRoot: () => root });
  let client: WsClient | null = null;
  let account = loadCredentials(dataDir);

  let aeVersion: string | null = null;

  /** Ulangach AE versiyasi va loyiha yo'lini `ping` bilan aniqlab serverga yuboradi. */
  async function reportAeState(target: WsClient): Promise<void> {
    const res = await bridge.runOp(makeOp("ping", "sys.ping", 0, {}, { timeout_ms: 10_000 }), {
      root,
    });
    const info = res.ok ? (res.data.info ?? {}) : {};
    aeVersion = typeof info.ae_version === "string" ? info.ae_version : null;
    const projectPath = typeof info.project_path === "string" ? info.project_path : null;
    target.reportAeState({ ae_version: aeVersion, project_path: projectPath, busy: false });
  }

  function connect(server: ServerConnection): WsClient {
    client?.stop();
    const next = createWsClient({
      ...server,
      runner,
      log,
      getRoot: () => root,
      aeVersion: () => aeVersion,
    });
    client = next;
    next.onStatus((status) => {
      if (status === "connected") void reportAeState(next);
      if (status === "unauthorized" && account !== null && server.token === account.token) {
        log.add({ level: "warn", message: "Qurilma bekor qilingan — panelni qayta ulang" });
        clearCredentials(dataDir);
        account = null;
      }
    });
    next.start();
    return next;
  }

  function connectWith(credentials: Credentials): WsClient {
    return connect({
      url: agentSocketUrl(credentials.server_url),
      token: credentials.token,
      device: deviceInfo(),
      panelVersion,
    });
  }

  return {
    log,
    bridge,
    runner,
    getRoot: () => root,
    setRoot(next) {
      root = next;
    },
    account: () => account,
    pair(serverUrl) {
      const signal = { cancelled: false };
      const base = normalizeServerUrl(serverUrl);
      const code = requestDeviceCode(base, deviceInfo());
      const done = code.then(async (deviceCode) => {
        log.add({
          level: "info",
          message: `🔑 Kod: ${deviceCode.user_code} — web kabinetda tasdiqlang`,
        });
        const grant = await pollDeviceToken(base, deviceCode, { ...options.pollOptions, signal });
        const credentials: Credentials = {
          server_url: base,
          device_id: grant.device_id,
          token: grant.access_token,
        };
        saveCredentials(dataDir, credentials);
        account = credentials;
        log.add({ level: "info", message: "✅ Qurilma ulandi" });
        connectWith(credentials);
        return credentials;
      });
      done.catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log.add({ level: "error", message: `❌ Ulanish: ${message}` });
      });
      return {
        code,
        done,
        cancel() {
          signal.cancelled = true;
        },
      };
    },
    connectSaved() {
      return account === null ? null : connectWith(account);
    },
    logout() {
      client?.stop();
      client = null;
      clearCredentials(dataDir);
      account = null;
    },
    connect,
    disconnect() {
      client?.stop();
      client = null;
    },
    connection: () => client,
  };
}

export { PairingError };
export type { Credentials } from "./credentials";
export type { EvalScript } from "./ae-bridge";
export type { LogEntry } from "./log";
export type { OpOutcome, RunnerEvent } from "./op-runner";
export type { DeviceCode } from "./pairing";
export type { ConnectionStatus, WsClient } from "./ws-client";
