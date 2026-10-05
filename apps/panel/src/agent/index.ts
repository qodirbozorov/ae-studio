/**
 * Panel agenti (CEP ichidagi Node, mixed context). UI uni `agent/agent.cjs` dan `require` qiladi
 * va CEP `evalScript` ni beradi. Agent brauzer API'siga bog'liq emas — Node'da test qilinadi.
 */
import { createAeBridge } from "./ae-bridge";
import type { AeBridge, EvalScript } from "./ae-bridge";
import { LogStore } from "./log";
import { createOpRunner } from "./op-runner";
import type { OpRunner } from "./op-runner";
import { createWsClient } from "./ws-client";
import type { WsClient } from "./ws-client";

export interface AgentOptions {
  evalScript: EvalScript;
  /** jsx bundle yo'li (`<extension>/jsx/index.js`): yuklanmagan bo'lsa avtomatik `$.evalFile`. */
  jsxPath?: string;
  root?: string;
}

export interface ServerConnection {
  url: string;
  token: string;
  device: { name: string; os: string };
  panelVersion: string;
}

export interface Agent {
  log: LogStore;
  bridge: AeBridge;
  runner: OpRunner;
  getRoot(): string;
  setRoot(root: string): void;
  /** Serverga ulanadi (oldingi ulanish bo'lsa to'xtatiladi). */
  connect(server: ServerConnection): WsClient;
  disconnect(): void;
  connection(): WsClient | null;
}

export function createAgent(options: AgentOptions): Agent {
  let root = options.root ?? "";
  const log = new LogStore();
  const bridge = createAeBridge({ evalScript: options.evalScript, jsxPath: options.jsxPath });
  const runner = createOpRunner({ bridge, log, getRoot: () => root });
  let client: WsClient | null = null;
  return {
    log,
    bridge,
    runner,
    getRoot: () => root,
    setRoot(next) {
      root = next;
    },
    connect(server) {
      client?.stop();
      client = createWsClient({ ...server, runner, log, getRoot: () => root });
      client.start();
      return client;
    },
    disconnect() {
      client?.stop();
      client = null;
    },
    connection: () => client,
  };
}

export type { EvalScript } from "./ae-bridge";
export type { LogEntry } from "./log";
export type { OpOutcome, RunnerEvent } from "./op-runner";
export type { ConnectionStatus, WsClient } from "./ws-client";
