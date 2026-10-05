/**
 * P1.13 dev WebSocket: panel `DEV_AGENT_TOKEN` bilan `/ws/agent` ga ulanadi, `POST /dev/op` opni
 * ulangan panelga yuboradi va natijani kutadi. P2.05 da device token + job'lar bilan almashtiriladi.
 * Faqat `DEV_AGENT_TOKEN` berilganda yoqiladi.
 */
import { timingSafeEqual } from "node:crypto";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  PROTOCOL_VERSION,
  encodeMessage,
  fail,
  failWith,
  ok,
  parseOpEnvelope,
  parsePanelMessage,
} from "@aes/shared";
import type { AesError, OpEnvelope, OpResultData, Result, ServerMessage } from "@aes/shared";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { SERVER_VERSION } from "../version";

const DEV_DEVICE_ID = "dev-device";
const DEV_JOB_ID = "dev";
/** Op timeout'iga qo'shiladigan tarmoq zaxirasi. */
const NETWORK_SLACK_MS = 5_000;

interface Pending {
  resolve(result: Result<OpResultData>): void;
  timer: NodeJS.Timeout;
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Bitta dev panel ulanishini boshqaradi. */
export class DevAgentHub {
  private socket: WebSocket | null = null;
  private lastSeen = 0;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly log: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
  ) {}

  get connected(): boolean {
    return this.socket !== null;
  }

  attach(socket: WebSocket): void {
    if (this.socket !== null) this.socket.close(4000, "Yangi ulanish bilan almashtirildi");
    this.socket = socket;
    this.lastSeen = this.now();
    socket.on("message", (data) => this.onMessage(socket, data.toString()));
    socket.on("close", () => this.detach(socket));
    socket.on("error", (error) => this.log.warn({ err: error }, "agent WS xatosi"));
    this.startHeartbeat();
  }

  /** Opni panelga yuboradi va `op.done` / `op.failed` ni kutadi. */
  run(op: OpEnvelope): Promise<Result<OpResultData>> {
    const socket = this.socket;
    if (socket === null) return Promise.resolve(fail("ENV_AGENT_OFFLINE", "Panel ulanmagan"));
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(op.op_id);
        resolve(fail("AE_TIMEOUT", `${op.op} javobi kelmadi`));
      }, op.timeout_ms + NETWORK_SLACK_MS);
      this.pending.get(op.op_id)?.resolve(fail("SYS_BAD_REQUEST", "Bir xil op_id qayta yuborildi"));
      this.pending.set(op.op_id, { resolve, timer });
      this.send(socket, { type: "op.run", job_id: DEV_JOB_ID, op });
    });
  }

  close(): void {
    this.stopHeartbeat();
    this.socket?.close(1001, "Server to'xtatilmoqda");
    this.socket = null;
    this.failPending(fail("ENV_AGENT_OFFLINE", "Server to'xtatildi"));
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    socket.send(encodeMessage(message));
  }

  private settle(opId: string, result: Result<OpResultData>): void {
    const pending = this.pending.get(opId);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.pending.delete(opId);
    pending.resolve(result);
  }

  private failPending(result: Result<OpResultData>): void {
    for (const opId of [...this.pending.keys()]) this.settle(opId, result);
  }

  private onMessage(socket: WebSocket, raw: string): void {
    this.lastSeen = this.now();
    const parsed = parsePanelMessage(raw);
    if (!parsed.ok) {
      this.log.warn({ error: parsed.error }, "panel xabari noto'g'ri");
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "hello":
        this.log.info(
          { device: message.device, ae: message.ae_version, protocol: message.protocol_version },
          "panel ulandi",
        );
        this.send(socket, {
          type: "hello_ack",
          protocol_version: PROTOCOL_VERSION,
          server_version: SERVER_VERSION,
          device_id: DEV_DEVICE_ID,
          heartbeat_ms: HEARTBEAT_INTERVAL_MS,
        });
        return;
      case "op.done":
        this.settle(message.op_id, ok(message.result));
        return;
      case "op.failed":
        this.settle(message.op_id, failWith(message.error as AesError));
        return;
      case "log":
        this.log.info({ panel: message }, "panel log");
        return;
      default:
        return;
    }
  }

  private detach(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.stopHeartbeat();
    this.failPending(fail("ENV_AGENT_OFFLINE", "Panel uzildi"));
    this.log.info("panel uzildi");
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      const socket = this.socket;
      if (socket === null) return;
      if (this.now() - this.lastSeen > HEARTBEAT_TIMEOUT_MS) {
        this.log.warn("panel heartbeat'ga javob bermadi — uzildi");
        socket.terminate();
        this.detach(socket);
        return;
      }
      this.send(socket, { type: "ping", ts: this.now() });
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}

export async function registerDevAgent(app: FastifyInstance, token: string): Promise<DevAgentHub> {
  const hub = new DevAgentHub(app.log);
  const auth = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!tokenMatches(request.headers.authorization, token)) {
      await reply.code(401).send(fail("AUTH_INVALID", "Dev token noto'g'ri"));
    }
  };

  app.get("/ws/agent", { websocket: true, preValidation: auth }, (socket) => hub.attach(socket));

  app.post("/dev/op", { preValidation: auth }, async (request, reply) => {
    const parsed = parseOpEnvelope(request.body);
    if (!parsed.ok) return reply.code(400).send(parsed);
    const result = await hub.run(parsed.data);
    if (!result.ok && result.error.code === "ENV_AGENT_OFFLINE") reply.code(503);
    return result;
  });

  app.get("/dev/agent", { preValidation: auth }, async () => ok({ connected: hub.connected }));

  app.addHook("onClose", async () => hub.close());
  return hub;
}
