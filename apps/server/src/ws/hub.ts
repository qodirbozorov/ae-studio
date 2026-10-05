/**
 * Panel ulanishlari markazi (§10.2): har qurilma `device_token` bilan `/ws/agent` ga ulanadi (D8 outbound).
 * Heartbeat 10 s; 30 s javobsiz → offline (job'lar uchun WAITING_AGENT, P2.11). Oplar op_id bo'yicha kutiladi.
 */
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  PROTOCOL_VERSION,
  encodeMessage,
  fail,
  failWith,
  ok,
  parsePanelMessage,
} from "@aes/shared";
import type {
  AesError,
  OpEnvelope,
  OpResultData,
  PanelMessage,
  Result,
  ServerMessage,
} from "@aes/shared";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { WebSocket } from "ws";
import type { Db } from "../db/client";
import { devices } from "../db/schema";
import type { DeviceIdentity } from "../devices/routes";
import { SERVER_VERSION } from "../version";

/** Op timeout'iga qo'shiladigan tarmoq zaxirasi. */
const NETWORK_SLACK_MS = 5_000;

interface Pending {
  resolve(result: Result<OpResultData>): void;
  timer: NodeJS.Timeout;
}

interface Connection {
  socket: WebSocket;
  identity: DeviceIdentity;
  lastSeen: number;
  pending: Map<string, Pending>;
}

export type PresenceListener = (deviceId: string, online: boolean) => void;
export type MessageListener = (identity: DeviceIdentity, message: PanelMessage) => void;

export class AgentHub {
  private readonly connections = new Map<string, Connection>();
  private readonly presence = new Set<PresenceListener>();
  private readonly messages = new Set<MessageListener>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  isOnline(deviceId: string): boolean {
    return this.connections.has(deviceId);
  }

  onPresence(listener: PresenceListener): () => void {
    this.presence.add(listener);
    return () => this.presence.delete(listener);
  }

  onMessage(listener: MessageListener): () => void {
    this.messages.add(listener);
    return () => this.messages.delete(listener);
  }

  attach(socket: WebSocket, identity: DeviceIdentity): void {
    const previous = this.connections.get(identity.deviceId);
    if (previous !== undefined) {
      previous.socket.close(4000, "Yangi ulanish bilan almashtirildi");
      this.detach(previous);
    }
    const connection: Connection = {
      socket,
      identity,
      lastSeen: this.now().getTime(),
      pending: new Map(),
    };
    this.connections.set(identity.deviceId, connection);
    socket.on("message", (data) => void this.onRaw(connection, data.toString()));
    socket.on("close", () => this.detach(connection));
    socket.on("error", (error) => this.log.warn({ err: error }, "agent WS xatosi"));
    this.emitPresence(identity.deviceId, true);
    this.ensureHeartbeat();
  }

  /** Qurilmani darhol uzadi (masalan kabinetda bekor qilinganda). */
  kick(deviceId: string, reason = "Qurilma bekor qilindi"): void {
    const connection = this.connections.get(deviceId);
    if (connection === undefined) return;
    connection.socket.close(4001, reason);
    this.detach(connection);
  }

  send(deviceId: string, message: ServerMessage): boolean {
    const connection = this.connections.get(deviceId);
    if (connection === undefined) return false;
    connection.socket.send(encodeMessage(message));
    return true;
  }

  /** Opni qurilmaga yuboradi va `op.done` / `op.failed` ni kutadi. */
  run(deviceId: string, op: OpEnvelope, jobId: string): Promise<Result<OpResultData>> {
    const connection = this.connections.get(deviceId);
    if (connection === undefined) {
      return Promise.resolve(fail("ENV_AGENT_OFFLINE", "Panel ulanmagan"));
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        connection.pending.delete(op.op_id);
        resolve(fail("AE_TIMEOUT", `${op.op} javobi kelmadi`));
      }, op.timeout_ms + NETWORK_SLACK_MS);
      connection.pending
        .get(op.op_id)
        ?.resolve(fail("SYS_BAD_REQUEST", "Bir xil op_id qayta yuborildi"));
      connection.pending.set(op.op_id, { resolve, timer });
      connection.socket.send(encodeMessage({ type: "op.run", job_id: jobId, op }));
    });
  }

  close(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const connection of [...this.connections.values()]) {
      connection.socket.close(1001, "Server to'xtatilmoqda");
      this.detach(connection);
    }
  }

  private emitPresence(deviceId: string, online: boolean): void {
    for (const listener of this.presence) listener(deviceId, online);
  }

  private settle(connection: Connection, opId: string, result: Result<OpResultData>): void {
    const pending = connection.pending.get(opId);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    connection.pending.delete(opId);
    pending.resolve(result);
  }

  private detach(connection: Connection): void {
    if (this.connections.get(connection.identity.deviceId) !== connection) return;
    this.connections.delete(connection.identity.deviceId);
    for (const opId of [...connection.pending.keys()]) {
      this.settle(connection, opId, fail("ENV_AGENT_OFFLINE", "Panel uzildi"));
    }
    void this.touch(connection.identity.deviceId, {});
    this.emitPresence(connection.identity.deviceId, false);
    this.log.info({ device: connection.identity.deviceId }, "panel uzildi");
  }

  private async touch(deviceId: string, extra: { aeVersion?: string | null }): Promise<void> {
    try {
      await this.db
        .update(devices)
        .set({ lastSeenAt: this.now(), ...extra })
        .where(eq(devices.id, deviceId));
    } catch (error) {
      this.log.warn({ err: error }, "devices.last_seen yangilanmadi");
    }
  }

  private async onRaw(connection: Connection, raw: string): Promise<void> {
    connection.lastSeen = this.now().getTime();
    const parsed = parsePanelMessage(raw);
    if (!parsed.ok) {
      this.log.warn({ error: parsed.error }, "panel xabari noto'g'ri");
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "hello":
        await this.touch(connection.identity.deviceId, { aeVersion: message.ae_version });
        connection.socket.send(
          encodeMessage({
            type: "hello_ack",
            protocol_version: PROTOCOL_VERSION,
            server_version: SERVER_VERSION,
            device_id: connection.identity.deviceId,
            heartbeat_ms: HEARTBEAT_INTERVAL_MS,
          }),
        );
        break;
      case "ae.state":
        await this.touch(connection.identity.deviceId, { aeVersion: message.ae_version });
        break;
      case "op.done":
        this.settle(connection, message.op_id, ok(message.result));
        break;
      case "op.failed":
        this.settle(connection, message.op_id, failWith(message.error as AesError));
        break;
      default:
        break;
    }
    for (const listener of this.messages) listener(connection.identity, message);
  }

  private ensureHeartbeat(): void {
    if (this.heartbeat !== null) return;
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  /** Heartbeat qadami (testlarda to'g'ridan-to'g'ri chaqiriladi). */
  beat(): void {
    const nowMs = this.now().getTime();
    for (const connection of [...this.connections.values()]) {
      if (nowMs - connection.lastSeen > HEARTBEAT_TIMEOUT_MS) {
        this.log.warn({ device: connection.identity.deviceId }, "heartbeat javobsiz — uzildi");
        connection.socket.terminate();
        this.detach(connection);
        continue;
      }
      connection.socket.send(encodeMessage({ type: "ping", ts: nowMs }));
    }
  }
}
