/**
 * Panel → server outbound WebSocket (D8). CEP Node'dagi sof-JS `ws` paketi ishlatiladi:
 * brauzer WebSocket `Authorization` header qo'ya olmaydi (Q1).
 * Uzilsa backoff + jitter bilan qayta ulanadi; server `ping` yuboradi, agent `pong` qaytaradi.
 */
import { PROTOCOL_VERSION, encodeMessage, parseServerMessage } from "@aes/shared";
import type { PanelMessage, ServerMessage } from "@aes/shared";
import WebSocket from "ws";
import type { LogStore } from "./log";
import type { OpRunner, RunnerEvent } from "./op-runner";

/** `unauthorized`: server tokenni rad etdi (qurilma bekor qilingan) — qayta ulanish to'xtaydi. */
export type ConnectionStatus =
  "idle" | "connecting" | "connected" | "disconnected" | "unauthorized";

export interface WsClientOptions {
  url: string;
  token: string;
  runner: OpRunner;
  log: LogStore;
  device: { name: string; os: string };
  panelVersion: string;
  getRoot: () => string;
  aeVersion?: () => string | null;
  /** Qayta ulanish kechikishi (ms): `min(max, base * 2^n)` + jitter. */
  backoff?: { baseMs: number; maxMs: number };
  random?: () => number;
}

export interface WsClient {
  start(): void;
  stop(): void;
  status(): ConnectionStatus;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
}

export function reconnectDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: number,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  // ±20% jitter: ko'p panel bir vaqtda qayta ulanmasligi uchun.
  return Math.round(exp * (0.8 + 0.4 * random));
}

export function createWsClient(options: WsClientOptions): WsClient {
  const { runner, log } = options;
  const backoff = options.backoff ?? { baseMs: 1_000, maxMs: 30_000 };
  const random = options.random ?? Math.random;
  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  let socket: WebSocket | null = null;
  let current: ConnectionStatus = "idle";
  let attempt = 0;
  let stopped = true;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (status: ConnectionStatus) => {
    if (status === current) return;
    current = status;
    for (const listener of statusListeners) listener(status);
  };

  const send = (message: PanelMessage) => {
    if (socket !== null && socket.readyState === WebSocket.OPEN)
      socket.send(encodeMessage(message));
  };

  // Runner eventlari serverga (faqat server yuborgan oplar uchun job_id bor).
  runner.onEvent((event: RunnerEvent) => {
    if (event.job_id === undefined || event.op === null) return;
    if (event.type === "op.started") {
      send({ type: "op.started", job_id: event.job_id, op_id: event.op.op_id, ts: event.ts });
    } else if (event.type === "op.done") {
      send({
        type: "op.done",
        job_id: event.job_id,
        op_id: event.op.op_id,
        result: event.result,
        duration_ms: event.duration_ms,
      });
    } else {
      send({
        type: "op.failed",
        job_id: event.job_id,
        op_id: event.op.op_id,
        error: event.error,
        duration_ms: event.duration_ms,
      });
    }
  });

  function handle(message: ServerMessage): void {
    switch (message.type) {
      case "hello_ack":
        attempt = 0;
        setStatus("connected");
        log.add({
          level: "info",
          message: `🟢 Serverga ulandi (server ${message.server_version})`,
        });
        return;
      case "ping":
        send({ type: "pong", ts: message.ts });
        return;
      case "op.run":
        void runner.submit(message.op, message.job_id);
        return;
      case "ops.batch":
        for (const op of message.ops) void runner.submit(op, message.job_id);
        return;
      default:
        return;
    }
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    const delay = reconnectDelay(attempt++, backoff.baseMs, backoff.maxMs, random());
    log.add({
      level: "warn",
      message: `🔴 Server bilan aloqa yo'q — ${Math.round(delay / 1000)} s dan keyin qayta ulanadi`,
    });
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect(): void {
    reconnectTimer = null;
    if (stopped) return;
    setStatus("connecting");
    const ws = new WebSocket(options.url, {
      headers: { Authorization: `Bearer ${options.token}` },
      handshakeTimeout: 10_000,
    });
    socket = ws;
    ws.on("open", () => {
      const running = runner.current();
      send({
        type: "hello",
        protocol_version: PROTOCOL_VERSION,
        panel_version: options.panelVersion,
        device: options.device,
        ae_version: options.aeVersion?.() ?? null,
        project_root: options.getRoot() || null,
        running:
          running !== null && running.job_id !== undefined
            ? { job_id: running.job_id, op_id: running.op.op_id }
            : null,
      });
    });
    ws.on("message", (data) => {
      const parsed = parseServerMessage(data.toString());
      if (parsed.ok) handle(parsed.data);
      else log.add({ level: "warn", message: "Server xabari noto'g'ri", data: parsed.error });
    });
    ws.on("unexpected-response", (_request, response) => {
      log.add({
        level: "error",
        message: `Server ulanishni rad etdi (HTTP ${response.statusCode})`,
      });
      if (response.statusCode === 401) {
        // Token yaroqsiz yoki qurilma bekor qilingan: qayta urinish ma'nosiz — yangi juftlash kerak.
        stopped = true;
        setStatus("unauthorized");
      }
      // Tinglovchi bo'lsa `ws` ulanishni o'zi yopmaydi: yopamiz → `close` → (kerak bo'lsa) qayta ulanish.
      ws.terminate();
    });
    ws.on("error", () => {
      // `close` hodisasi ham keladi — qayta ulanish o'sha yerda.
    });
    ws.on("close", () => {
      if (socket === ws) socket = null;
      if (current === "unauthorized") return;
      setStatus("disconnected");
      scheduleReconnect();
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      attempt = 0;
      connect();
    },
    stop() {
      stopped = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      socket?.close(1000, "Panel to'xtatdi");
      socket = null;
      setStatus("idle");
    },
    status: () => current,
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
  };
}
