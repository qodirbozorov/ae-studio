/**
 * Soxta panel (agent): AgentHub'ga to'g'ridan-to'g'ri ulanadi (WS'siz), oplarga javob beradi.
 * Xatti-harakat `onOp` bilan boshqariladi: javob, xato yoki javobsiz qoldirish (uzilish simulyatsiyasi).
 */
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PROTOCOL_VERSION, makeError } from "@aes/shared";
import type { AesError, OpEnvelope, PanelMessage, ServerMessage } from "@aes/shared";
import type { WebSocket } from "ws";
import type { AgentHub } from "../../src/ws/hub";
import { wav } from "./fake-eleven";

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
  /** `audio.extract.request` so'ralgan yo'llar (javob: storage'ga WAV). */
  readonly extractions: string[] = [];
  /** Preview so'ralgan yo'llar. */
  readonly previews: string[] = [];
  /** `file.upload.request` so'ralgan yo'llar. */
  readonly uploads: string[] = [];
  /** Contact sheet so'rovlari. */
  readonly sheets: { files: string[]; labels: string[]; cols: number }[] = [];
  /** `project.open` (MCP project_create): loyihani ro'yxatdan o'tkazadi. */
  onProjectOpen:
    ((root: string) => Promise<{ id: string; name: string; root_path: string }>) | null = null;
  /** `hello` dagi protokol (1 — eski panel: `ops.batch` yo'q, oplar bittadan). */
  protocol = PROTOCOL_VERSION;
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
      protocol_version: this.protocol,
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

  /** Yuborilgan barcha oplar (`op.run` va `ops.batch`), tartib bilan. */
  sentOps(): OpEnvelope[] {
    const out: OpEnvelope[] = [];
    for (const m of this.received) {
      if (m.type === "op.run") out.push(m.op);
      else if (m.type === "ops.batch") out.push(...m.ops);
    }
    return out;
  }

  /** Bitta op natijasi (`onOp` bo'yicha); "drop" — javobsiz (uzilish). */
  private async react(
    op: OpEnvelope,
  ): Promise<
    "drop" | { ok: true; info: Record<string, unknown> } | { ok: false; error: AesError }
  > {
    this.ran.push(op.op_id);
    const reaction = await this.onOp(op);
    if (reaction === "drop") return "drop";
    if (reaction === "ok" || "info" in reaction) {
      const info =
        reaction !== "ok"
          ? reaction.info
          : op.op === "ping"
            ? { ae_version: "22.0", project_path: null }
            : {};
      return { ok: true, info };
    }
    return { ok: false, error: reaction as AesError };
  }

  ofType<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.received.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }

  private async handle(socket: FakeSocket, message: ServerMessage): Promise<void> {
    this.received.push(message);
    await new Promise((resolve) => setImmediate(resolve));
    if (socket.closed) return;
    if (message.type === "ops.batch") {
      // Panel kabi: oplar ketma-ket, birinchi xatoda to'xtaydi; "drop" — javobsiz (uzilish).
      const results: Extract<PanelMessage, { type: "ops.batch.result" }>["results"] = [];
      // jsx kabi: ketma-ket undo'ga kiradigan oplar bitta guruhda (nomi — birinchi op_id).
      let group: string | null = null;
      for (const op of message.ops) {
        const outcome = await this.react(op);
        if (outcome === "drop" || socket.closed) return;
        const undoable = !["project.open_or_create", "project.save", "undo"].includes(op.op);
        group = undoable ? (group ?? op.op_id) : null;
        if (outcome.ok) {
          results.push({
            op_id: op.op_id,
            ok: true,
            result: {
              op_id: op.op_id,
              reused: false,
              info: outcome.info,
              ...(group === null ? {} : { undo_group: group }),
            },
            duration_ms: 1,
          });
        } else {
          results.push({ op_id: op.op_id, ok: false, error: outcome.error, duration_ms: 1 });
          break;
        }
      }
      this.deliver(
        {
          type: "ops.batch.result",
          request_id: message.request_id,
          job_id: message.job_id,
          results,
          duration_ms: results.length,
        },
        socket,
      );
    } else if (message.type === "op.run") {
      const op = message.op;
      const outcome = await this.react(op);
      if (outcome === "drop" || socket.closed) return;
      if (outcome.ok) {
        const info = outcome.info;
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
            error: outcome.error,
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
    } else if (message.type === "audio.extract.request") {
      this.extractions.push(message.local_path);
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
      const audio = wav(2);
      await this.storage.putBytes(message.upload.storage_key, audio, "audio/wav");
      this.deliver(
        {
          type: "file.uploaded",
          request_id: message.request_id,
          storage_key: message.upload.storage_key,
          sha256: createHash("sha256").update(audio).digest("hex"),
          size: audio.length,
          duration_s: 2,
        },
        socket,
      );
    } else if (message.type === "frames.sheet.request") {
      this.sheets.push({ files: message.files, labels: message.labels, cols: message.cols });
      if (this.storage === null) return;
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
      await this.storage.putBytes(message.upload.storage_key, jpeg, "image/jpeg");
      this.deliver(
        {
          type: "file.uploaded",
          request_id: message.request_id,
          storage_key: message.upload.storage_key,
          sha256: createHash("sha256").update(jpeg).digest("hex"),
          size: jpeg.length,
        },
        socket,
      );
    } else if (message.type === "file.upload.request") {
      this.uploads.push(message.local_path);
      if (this.storage === null) {
        this.deliver(
          {
            type: "request.failed",
            request_id: message.request_id,
            error: makeError("SYS_INTERNAL", "soxta agentda storage yo'q"),
          },
          socket,
        );
        return;
      }
      const data = Buffer.from(`mock file: ${message.local_path}`);
      await this.storage.putBytes(message.upload.storage_key, data, message.content_type);
      this.deliver(
        {
          type: "file.uploaded",
          request_id: message.request_id,
          storage_key: message.upload.storage_key,
          sha256: createHash("sha256").update(data).digest("hex"),
          size: data.length,
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
