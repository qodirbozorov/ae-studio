/**
 * Soxta panel (agent): AgentHub'ga to'g'ridan-to'g'ri ulanadi (WS'siz), oplarga javob beradi.
 * Xatti-harakat `onOp` bilan boshqariladi: javob, xato yoki javobsiz qoldirish (uzilish simulyatsiyasi).
 */
import { EventEmitter } from "node:events";
import { PROTOCOL_VERSION, makeError } from "@aes/shared";
import type { AesError, OpEnvelope, PanelMessage, ServerMessage } from "@aes/shared";
import type { WebSocket } from "ws";
import type { AgentHub } from "../../src/ws/hub";

class FakeSocket extends EventEmitter {
  closed = false;
  constructor(private readonly onSend: (message: ServerMessage) => void) {
    super();
  }
  send(data: string): void {
    if (this.closed) return;
    this.onSend(JSON.parse(data) as ServerMessage);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
  terminate(): void {
    this.close();
  }
}

/** "ok" — bo'sh info; `{ info }` — natija ma'lumoti bilan; "drop" — javobsiz; AesError — xato. */
export type OpReaction = "ok" | "drop" | AesError | { info: Record<string, unknown> };

export interface ScannedAsset {
  key: string;
  local_path: string;
  kind: "video" | "image" | "audio" | "other";
  meta: Record<string, unknown>;
  error?: AesError;
}

export class FakeAgent {
  /** Kelgan barcha server xabarlari. */
  readonly received: ServerMessage[] = [];
  /** `op.run` bilan kelgan op_id'lar (tartib bilan). */
  readonly ran: string[] = [];
  root: string;
  assets: ScannedAsset[];
  /** `file.download` bilan "saqlangan" fayllar: dest → sha256 (ustiga yozilmaydi, panel kabi). */
  readonly files = new Map<string, string>();
  /** `file.saved` dagi davomiylik (panel ffprobe o'rniga). */
  fileDuration: number | null = null;
  onOp: (op: OpEnvelope) => OpReaction | Promise<OpReaction> = () => "ok";
  /** `asset.preview.request`: JPEG'ni to'g'ridan-to'g'ri storage'ga yozadi (berilsa). */
  storage: { putBytes(key: string, data: Buffer, contentType?: string): Promise<void> } | null =
    null;
  /**
   * `render.request`: default — so'ralgan davomiylikdagi muvaffaqiyatli render.
   * `{ duration }` — boshqa davomiylik; AesError — xato; "drop" — javobsiz.
   */
  onRender: (
    message: Extract<ServerMessage, { type: "render.request" }>,
  ) => "ok" | "drop" | AesError | { duration: number } = () => "ok";
  /** Preview so'ralgan yo'llar. */
  readonly previews: string[] = [];
  /** `project.open` (MCP project_create): loyihani ro'yxatdan o'tkazadi. */
  onProjectOpen:
    ((root: string) => Promise<{ id: string; name: string; root_path: string }>) | null = null;
  private socket: FakeSocket | null = null;

  constructor(
    private readonly hub: AgentHub,
    private readonly identity: { userId: string; deviceId: string },
    options: { root: string; assets?: ScannedAsset[] },
  ) {
    this.root = options.root;
    this.assets = options.assets ?? [];
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.closed;
  }

  connect(): void {
    const socket = new FakeSocket((message) => void this.handle(socket, message));
    this.socket = socket;
    this.hub.attach(socket as unknown as WebSocket, this.identity);
    this.deliver({
      type: "hello",
      protocol_version: PROTOCOL_VERSION,
      panel_version: "test",
      device: { name: "PC", os: "test" },
      ae_version: "22.0",
      project_root: this.root,
      running: null,
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  deliver(message: PanelMessage, socket = this.socket): void {
    socket?.emit("message", Buffer.from(JSON.stringify(message)));
  }

  ofType<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.received.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }

  private async handle(socket: FakeSocket, message: ServerMessage): Promise<void> {
    this.received.push(message);
    await new Promise((resolve) => setImmediate(resolve));
    if (socket.closed) return;
    if (message.type === "op.run") {
      const op = message.op;
      this.ran.push(op.op_id);
      const reaction = await this.onOp(op);
      if (reaction === "drop" || socket.closed) return;
      if (reaction === "ok" || "info" in reaction) {
        const info =
          reaction !== "ok"
            ? reaction.info
            : op.op === "ping"
              ? { ae_version: "22.0", project_path: null }
              : {};
        this.deliver(
          {
            type: "op.done",
            job_id: message.job_id,
            op_id: op.op_id,
            result: {
              op_id: op.op_id,
              reused: false,
              info,
            },
            duration_ms: 1,
          },
          socket,
        );
      } else {
        this.deliver(
          {
            type: "op.failed",
            job_id: message.job_id,
            op_id: op.op_id,
            error: reaction as AesError,
            duration_ms: 1,
          },
          socket,
        );
      }
    } else if (message.type === "render.request") {
      const reaction = this.onRender(message);
      if (reaction === "drop") return;
      if (reaction !== "ok" && "code" in reaction) {
        this.deliver(
          { type: "request.failed", request_id: message.request_id, error: reaction },
          socket,
        );
        return;
      }
      this.deliver(
        {
          type: "render.done",
          request_id: message.request_id,
          out: `${message.out_base}.mp4`,
          duration: reaction === "ok" ? message.duration : reaction.duration,
          size: 2_000_000,
          method: "aerender",
          encoder: "libx264",
        },
        socket,
      );
    } else if (message.type === "asset.preview.request") {
      this.previews.push(message.local_path);
      if (this.storage === null) {
        this.deliver(
          {
            type: "request.failed",
            request_id: message.request_id,
            error: makeError("ENV_FFMPEG_MISSING", "soxta agentda storage yo'q"),
          },
          socket,
        );
        return;
      }
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
      const files = [];
      for (const upload of message.uploads.slice(
        0,
        message.mode === "image" ? 1 : message.uploads.length,
      )) {
        await this.storage.putBytes(upload.storage_key, jpeg, "image/jpeg");
        files.push({ storage_key: upload.storage_key, time: null, size: jpeg.length });
      }
      this.deliver({ type: "asset.preview.ready", request_id: message.request_id, files }, socket);
    } else if (message.type === "project.open") {
      if (this.onProjectOpen === null) {
        this.deliver(
          {
            type: "request.failed",
            request_id: message.request_id,
            error: makeError("ENV_NO_FOLDER", "papka ochilmadi"),
          },
          socket,
        );
        return;
      }
      const project = await this.onProjectOpen(message.root_path);
      this.root = project.root_path;
      this.deliver({ type: "project.opened", request_id: message.request_id, project }, socket);
    } else if (message.type === "file.download") {
      const existing = this.files.get(message.dest);
      if (existing !== undefined && existing !== message.sha256 && message.overwrite !== true) {
        this.deliver(
          {
            type: "request.failed",
            request_id: message.request_id,
            error: makeError("SYS_BAD_REQUEST", `${message.dest} mavjud`),
          },
          socket,
        );
        return;
      }
      this.files.set(message.dest, message.sha256);
      this.deliver(
        {
          type: "file.saved",
          request_id: message.request_id,
          dest: message.dest,
          sha256: message.sha256,
          size: message.size ?? 0,
          ...(this.fileDuration === null ? {} : { duration_s: this.fileDuration }),
        },
        socket,
      );
    } else if (message.type === "assets.scan") {
      if (message.project_root !== this.root) {
        this.deliver(
          {
            type: "request.failed",
            request_id: message.request_id,
            error: makeError("ENV_NO_FOLDER", "boshqa papka"),
          },
          socket,
        );
        return;
      }
      this.deliver(
        {
          type: "asset.scanned",
          request_id: message.request_id,
          project_root: this.root,
          assets: this.assets.map((asset) => ({
            ...asset,
            size: 1000,
            mtime_ms: 1,
            hash: `h_${asset.key}`,
          })),
        },
        socket,
      );
    }
  }
}
