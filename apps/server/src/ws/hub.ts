/**
 * Panel ulanishlari markazi (§10.2): har qurilma `device_token` bilan `/ws/agent` ga ulanadi (D8 outbound).
 * Heartbeat 10 s; 30 s javobsiz → offline (job'lar uchun WAITING_AGENT, P2.11). Oplar op_id bo'yicha kutiladi.
 *
 * Ko'p replika (P9.07): panel istalgan replikaga ulanadi. Replikalar presence'ni (`hub.up/down/state/alive`)
 * bir-biriga tarqatadi; boshqa replikadagi panelga `send` / `run` / `request` / `kick` cluster orqali uzatiladi
 * (RPC: `hub.rpc` → egasi bajaradi → `hub.res`). Yakka rejimda (`cluster.shared = false`) hammasi lokal.
 */
import { randomUUID } from "node:crypto";
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
import { MemoryCluster } from "../cluster";
import type { Cluster, ClusterMessage } from "../cluster";
import type { Db } from "../db/client";
import { devices } from "../db/schema";
import type { DeviceIdentity } from "../devices/routes";
import { SERVER_VERSION } from "../version";

/** Op timeout'iga qo'shiladigan tarmoq zaxirasi. */
const NETWORK_SLACK_MS = 5_000;
/** Replikalararo yetkazish uchun qo'shimcha zaxira. */
const CLUSTER_SLACK_MS = 5_000;
/** Boshqa replikadagi panel shu muddat "alive" yubormasa — offline hisoblanadi. */
const REMOTE_TTL_MS = HEARTBEAT_TIMEOUT_MS + 5_000;

interface Pending {
  resolve(result: Result<OpResultData>): void;
  timer: NodeJS.Timeout;
}

interface Connection {
  socket: WebSocket;
  identity: DeviceIdentity;
  lastSeen: number;
  pending: Map<string, Pending>;
  state: AgentState;
  /** Ulangan payt (devor soati): replikalar orasida qaysi ulanish yangiroq ekanini aniqlash uchun. */
  since: number;
}

/** Panel o'zi haqida xabar qilgan oxirgi holat (`hello`, `ae.state`). */
export interface AgentState {
  aeVersion: string | null;
  /** Panelda ochiq ish papkasi. */
  projectRoot: string | null;
  /** AE'da ochiq `.aep`. */
  projectPath: string | null;
  /** ffmpeg/ffprobe ishlaydimi (noma'lum bo'lsa null). */
  ffmpeg: boolean | null;
  /** Panel `hello` dagi protokol versiyasi (≥ 2 — `ops.batch`, P6.04). */
  protocol: number;
  /** Panel (ZXP) versiyasi. */
  panelVersion: string | null;
}

/** `request_id` li panel javoblari (`asset.scanned`, `file.*`, `request.failed`). */
type RequestReply = Extract<PanelMessage, { request_id?: string }>;

interface PendingRequest {
  deviceId: string;
  resolve(result: Result<RequestReply>): void;
  timer: NodeJS.Timeout;
}

/** Boshqa replikadagi panel. */
interface RemoteDevice {
  replica: string;
  userId: string;
  state: AgentState;
  since: number;
  seenAt: number;
}

/** Boshqa replikaga yuborilgan RPC (javob kutilmoqda). */
interface RemoteCall {
  deviceId: string;
  resolve(result: Result<unknown>): void;
  timer: NodeJS.Timeout;
}

export type PresenceListener = (deviceId: string, online: boolean) => void;
export type MessageListener = (identity: DeviceIdentity, message: PanelMessage) => void;

const EMPTY_STATE: AgentState = {
  aeVersion: null,
  projectRoot: null,
  projectPath: null,
  ffmpeg: null,
  protocol: 1,
  panelVersion: null,
};

export class AgentHub {
  private readonly connections = new Map<string, Connection>();
  private readonly presence = new Set<PresenceListener>();
  private readonly messages = new Set<MessageListener>();
  private readonly requests = new Map<string, PendingRequest>();
  private readonly remote = new Map<string, RemoteDevice>();
  private readonly calls = new Map<string, RemoteCall>();
  private heartbeat: NodeJS.Timeout | null = null;
  private sweeper: NodeJS.Timeout | null = null;
  private readonly cluster: Cluster;

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
    cluster?: Cluster,
  ) {
    this.cluster = cluster ?? new MemoryCluster();
    if (this.cluster.shared) {
      this.cluster.onMessage((message) => this.onCluster(message));
      this.sweeper = setInterval(() => this.sweep(), HEARTBEAT_INTERVAL_MS);
      this.sweeper.unref();
    }
  }

  /** Replika ishga tushdi: boshqalardan ulangan panellar ro'yxatini so'raydi. */
  announce(): void {
    if (this.cluster.shared) this.cluster.broadcast({ t: "hub.sync" });
  }

  isOnline(deviceId: string): boolean {
    return this.connections.has(deviceId) || this.liveRemote(deviceId) !== null;
  }

  /** Ulangan panelning oxirgi holati (offline bo'lsa `null`). */
  state(deviceId: string): AgentState | null {
    return this.connections.get(deviceId)?.state ?? this.liveRemote(deviceId)?.state ?? null;
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
      state: { ...EMPTY_STATE },
      since: Date.now(),
    };
    this.connections.set(identity.deviceId, connection);
    this.remote.delete(identity.deviceId);
    socket.on("message", (data) => void this.onRaw(connection, data.toString()));
    socket.on("close", () => this.detach(connection));
    socket.on("error", (error) => this.log.warn({ err: error }, "agent WS xatosi"));
    this.emitPresence(identity.deviceId, true);
    this.ensureHeartbeat();
    this.publishUp(connection);
  }

  /** Qurilmani darhol uzadi (masalan kabinetda bekor qilinganda) — qaysi replikada bo'lsa ham. */
  kick(deviceId: string, reason = "Qurilma bekor qilindi"): void {
    this.kickLocal(deviceId, reason);
    if (this.cluster.shared) this.cluster.broadcast({ t: "hub.kick", d: deviceId, reason });
  }

  private kickLocal(deviceId: string, reason: string): void {
    const connection = this.connections.get(deviceId);
    if (connection === undefined) return;
    connection.socket.close(4001, reason);
    this.detach(connection);
  }

  send(deviceId: string, message: ServerMessage): boolean {
    const connection = this.connections.get(deviceId);
    if (connection !== undefined) {
      connection.socket.send(encodeMessage(message));
      return true;
    }
    const remote = this.liveRemote(deviceId);
    if (remote === null) return false;
    this.cluster.sendTo(remote.replica, { t: "hub.send", d: deviceId, m: message });
    return true;
  }

  /** Opni qurilmaga yuboradi va `op.done` / `op.failed` ni kutadi. */
  run(deviceId: string, op: OpEnvelope, jobId: string): Promise<Result<OpResultData>> {
    const connection = this.connections.get(deviceId);
    if (connection === undefined) {
      const remote = this.liveRemote(deviceId);
      if (remote === null) return Promise.resolve(fail("ENV_AGENT_OFFLINE", "Panel ulanmagan"));
      return this.call(
        remote.replica,
        deviceId,
        { kind: "run", op, jobId },
        op.timeout_ms + NETWORK_SLACK_MS + CLUSTER_SLACK_MS,
        `${op.op} javobi kelmadi`,
      ) as Promise<Result<OpResultData>>;
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

  /**
   * `request_id` li xabarni yuboradi va panelning shu `request_id` dagi javobini kutadi
   * (`request.failed` → xato). Kutilgan javob umumiy `onMessage` tinglovchilariga berilmaydi.
   */
  request(
    deviceId: string,
    message: Extract<ServerMessage, { request_id: string }>,
    timeoutMs: number,
  ): Promise<Result<RequestReply>> {
    if (!this.connections.has(deviceId)) {
      const remote = this.liveRemote(deviceId);
      if (remote === null) return Promise.resolve(fail("ENV_AGENT_OFFLINE", "Panel ulanmagan"));
      return this.call(
        remote.replica,
        deviceId,
        { kind: "request", m: message, timeoutMs },
        timeoutMs + CLUSTER_SLACK_MS,
        `${message.type} javobi kelmadi`,
      ) as Promise<Result<RequestReply>>;
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.requests.delete(message.request_id);
        resolve(fail("AE_TIMEOUT", `${message.type} javobi kelmadi`));
      }, timeoutMs);
      this.requests.set(message.request_id, { deviceId, resolve, timer });
      this.send(deviceId, message);
    });
  }

  close(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    if (this.sweeper !== null) clearInterval(this.sweeper);
    this.heartbeat = null;
    this.sweeper = null;
    for (const connection of [...this.connections.values()]) {
      connection.socket.close(1001, "Server to'xtatilmoqda");
      this.detach(connection);
    }
    for (const [id, call] of [...this.calls]) {
      clearTimeout(call.timer);
      this.calls.delete(id);
      call.resolve(fail("ENV_AGENT_OFFLINE", "Server to'xtatilmoqda"));
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

  private reply(requestId: string, result: Result<RequestReply>): boolean {
    const request = this.requests.get(requestId);
    if (request === undefined) return false;
    clearTimeout(request.timer);
    this.requests.delete(requestId);
    request.resolve(result);
    return true;
  }

  private detach(connection: Connection): void {
    if (this.connections.get(connection.identity.deviceId) !== connection) return;
    this.connections.delete(connection.identity.deviceId);
    for (const opId of [...connection.pending.keys()]) {
      this.settle(connection, opId, fail("ENV_AGENT_OFFLINE", "Panel uzildi"));
    }
    for (const [requestId, request] of [...this.requests]) {
      if (request.deviceId !== connection.identity.deviceId) continue;
      this.reply(requestId, fail("ENV_AGENT_OFFLINE", "Panel uzildi"));
    }
    void this.touch(connection.identity.deviceId, {});
    this.emitPresence(connection.identity.deviceId, false);
    if (this.cluster.shared) {
      this.cluster.broadcast({
        t: "hub.down",
        d: connection.identity.deviceId,
        since: connection.since,
      });
    }
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
        connection.state = {
          aeVersion: message.ae_version,
          projectRoot: message.project_root,
          projectPath: connection.state.projectPath,
          ffmpeg: connection.state.ffmpeg,
          protocol: message.protocol_version,
          panelVersion: message.panel_version,
        };
        this.publishState(connection);
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
        connection.state = {
          aeVersion: message.ae_version,
          projectRoot:
            message.project_root === undefined
              ? connection.state.projectRoot
              : message.project_root,
          projectPath: message.project_path,
          ffmpeg: message.ffmpeg === undefined ? connection.state.ffmpeg : message.ffmpeg,
          protocol: connection.state.protocol,
          panelVersion: connection.state.panelVersion,
        };
        this.publishState(connection);
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
    // Panel papkani ochdi (`project.open` javobi): holat darhol yangilanadi — keyingi bosqichlar
    // papkani qayta ochishni so'ramasin.
    if (message.type === "project.opened") {
      connection.state = { ...connection.state, projectRoot: message.project.root_path };
      this.publishState(connection);
    }
    if ("request_id" in message && message.request_id !== undefined) {
      const pending = this.requests.get(message.request_id);
      if (pending !== undefined && pending.deviceId === connection.identity.deviceId) {
        this.reply(
          message.request_id,
          message.type === "request.failed"
            ? failWith(message.error as AesError)
            : ok(message as RequestReply),
        );
        return;
      }
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
    this.publishAlive();
  }

  // ---------------------------------------------------------------- replikalar (P9.07)

  private liveRemote(deviceId: string): RemoteDevice | null {
    const entry = this.remote.get(deviceId);
    if (entry === undefined) return null;
    if (this.now().getTime() - entry.seenAt > REMOTE_TTL_MS) return null;
    return entry;
  }

  private snapshot(connection: Connection) {
    return {
      d: connection.identity.deviceId,
      u: connection.identity.userId,
      s: connection.state,
      since: connection.since,
    };
  }

  private publishUp(connection: Connection): void {
    if (this.cluster.shared) this.cluster.broadcast({ t: "hub.up", ...this.snapshot(connection) });
  }

  private publishState(connection: Connection): void {
    if (this.cluster.shared) {
      this.cluster.broadcast({
        t: "hub.state",
        d: connection.identity.deviceId,
        s: connection.state,
      });
    }
  }

  private publishAlive(): void {
    if (!this.cluster.shared || this.connections.size === 0) return;
    this.cluster.broadcast({
      t: "hub.alive",
      list: [...this.connections.values()].map((c) => this.snapshot(c)),
    });
  }

  /** Eskirgan remote yozuvlar va ularga yuborilgan RPC'lar. */
  private sweep(): void {
    const nowMs = this.now().getTime();
    for (const [deviceId, entry] of [...this.remote]) {
      if (nowMs - entry.seenAt > REMOTE_TTL_MS) this.dropRemote(deviceId, entry.replica);
    }
  }

  private dropRemote(deviceId: string, replica: string): void {
    const entry = this.remote.get(deviceId);
    if (entry === undefined || entry.replica !== replica) return;
    this.remote.delete(deviceId);
    for (const [id, call] of [...this.calls]) {
      if (call.deviceId !== deviceId) continue;
      clearTimeout(call.timer);
      this.calls.delete(id);
      call.resolve(fail("ENV_AGENT_OFFLINE", "Panel uzildi"));
    }
  }

  /** Boshqa replikadagi panel ulandi yoki tirikligini bildirdi. */
  private remoteUp(replica: string, item: { d: string; u: string; s: AgentState; since: number }) {
    const local = this.connections.get(item.d);
    if (local !== undefined) {
      const remoteNewer =
        item.since > local.since ||
        (item.since === local.since && replica > this.cluster.replicaId);
      if (!remoteNewer) {
        // Bizdagi ulanish yangiroq — eskisini yopishlari uchun qayta e'lon qilamiz.
        this.publishUp(local);
        return;
      }
      local.socket.close(4000, "Yangi ulanish bilan almashtirildi");
      this.detach(local);
    }
    this.remote.set(item.d, {
      replica,
      userId: item.u,
      state: item.s,
      since: item.since,
      seenAt: this.now().getTime(),
    });
  }

  private call(
    replica: string,
    deviceId: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    timeoutText: string,
  ): Promise<Result<unknown>> {
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        resolve(fail("AE_TIMEOUT", timeoutText));
      }, timeoutMs);
      this.calls.set(id, { deviceId, resolve, timer });
      this.cluster.sendTo(replica, { t: "hub.rpc", id, d: deviceId, ...body });
    });
  }

  private onCluster(message: ClusterMessage): void {
    const from = message.from;
    if (from === undefined || from === this.cluster.replicaId) return;
    switch (message.t) {
      case "hub.sync":
        this.publishAlive();
        return;
      case "hub.up":
        this.remoteUp(from, message as unknown as Parameters<AgentHub["remoteUp"]>[1]);
        return;
      case "hub.alive":
        for (const item of message.list as Parameters<AgentHub["remoteUp"]>[1][]) {
          const known = this.remote.get(item.d);
          if (known !== undefined && known.replica === from) {
            known.seenAt = this.now().getTime();
            known.state = item.s;
          } else {
            this.remoteUp(from, item);
          }
        }
        return;
      case "hub.state": {
        const known = this.remote.get(message.d as string);
        if (known !== undefined && known.replica === from) {
          known.state = message.s as AgentState;
          known.seenAt = this.now().getTime();
        }
        return;
      }
      case "hub.down": {
        const known = this.remote.get(message.d as string);
        if (known !== undefined && known.since === message.since) {
          this.dropRemote(message.d as string, from);
        }
        return;
      }
      case "hub.kick":
        this.kickLocal(message.d as string, String(message.reason ?? "Qurilma bekor qilindi"));
        return;
      case "hub.send":
        if (this.connections.has(message.d as string)) {
          this.send(message.d as string, message.m as ServerMessage);
        }
        return;
      case "hub.rpc":
        void this.serve(from, message);
        return;
      case "hub.res": {
        const call = this.calls.get(message.id as string);
        if (call === undefined) return;
        clearTimeout(call.timer);
        this.calls.delete(message.id as string);
        call.resolve(message.result as Result<unknown>);
        return;
      }
      default:
        return;
    }
  }

  /** Boshqa replika so'radi: bizdagi panelda bajarib javobini qaytaramiz. */
  private async serve(from: string, message: ClusterMessage): Promise<void> {
    const deviceId = message.d as string;
    let result: Result<unknown>;
    if (!this.connections.has(deviceId)) {
      result = fail("ENV_AGENT_OFFLINE", "Panel ulanmagan");
    } else if (message.kind === "run") {
      result = await this.run(deviceId, message.op as OpEnvelope, message.jobId as string);
    } else if (message.kind === "request") {
      result = await this.request(
        deviceId,
        message.m as Extract<ServerMessage, { request_id: string }>,
        Number(message.timeoutMs),
      );
    } else {
      result = fail("SYS_BAD_REQUEST", "Noma'lum RPC");
    }
    this.cluster.sendTo(from, { t: "hub.res", id: message.id, result });
  }
}
