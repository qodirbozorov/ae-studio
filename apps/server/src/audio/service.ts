/**
 * Audio vazifalari (§7.1, P4.03): `kind + params (+ kirish fayllari)` → `params_hash` → `eleven_cache` →
 * navbat → ElevenLabs → storage (`audio-out`) → panelga `file.download` (`audio/`, sha256) → `file.saved`.
 *
 * Navbat server ichida (Postgres — yagona haqiqat manbai): server qayta ishga tushsa `recover()` davom ettiradi.
 * Hamma ElevenLabs fayllari serverda (storage) saqlanadi; panel ularni yuklab oladi (kirishlar esa panel →
 * storage `audio-in` → ElevenLabs).
 */
import { createHash, randomUUID } from "node:crypto";
import { fail, makeError, ok } from "@aes/shared";
import type { AesError, AudioKind, Result } from "@aes/shared";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../context";
import { audioTasks, elevenCache, projects } from "../db/schema";
import { forcedAlignment, isolate, speechToText } from "../eleven/analyze";
import { audioResult } from "../eleven/audio";
import type { AudioResult, InputFile } from "../eleven/audio";
import { ElevenError } from "../eleven/client";
import type { ElevenClient } from "../eleven/client";
import { dialogue, music, soundEffect } from "../eleven/generate";
import type { DialogueParams, MusicParams, SfxParams } from "../eleven/generate";
import { tts } from "../eleven/tts";
import type { Alignment, TtsParams } from "../eleven/tts";
import { designVoice, dub, voiceChange } from "../eleven/voice";
import type { PollOptions } from "../eleven/voice";
import { storageKey } from "../storage";
import { estimateCredits } from "./estimate";

export type AudioTaskRow = typeof audioTasks.$inferSelect;

export interface InputRef {
  name: string;
  storage_key: string;
  sha256: string;
  duration_s?: number | null;
}

export interface SubmitInput {
  userId: string;
  projectId?: string | null;
  jobId?: string | null;
  kind: AudioKind;
  params: Record<string, unknown>;
  inputs?: InputRef[];
  label?: string | null;
  /** Keshni chetlab o'tish (qayta generatsiya). */
  fresh?: boolean;
}

export type AudioListener = (task: AudioTaskRow) => void;

/** Kalitlari tartiblangan JSON (hash barqaror bo'lishi uchun). */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function paramsHash(
  kind: AudioKind,
  params: Record<string, unknown>,
  inputs: InputRef[] = [],
): string {
  return createHash("sha256")
    .update(
      canonical({ kind, params, inputs: inputs.map((i) => ({ name: i.name, sha256: i.sha256 })) }),
    )
    .digest("hex");
}

/** TTS alignment'idan audio uzunligi (oxirgi belgi tugashi). */
export function alignmentEnd(alignment: Alignment | null | undefined): number | null {
  const ends = alignment?.character_end_times_seconds ?? [];
  return ends.length === 0 ? null : (ends[ends.length - 1] ?? null);
}

export function presentTask(task: AudioTaskRow) {
  return {
    id: task.id,
    kind: task.kind as AudioKind,
    label: task.label,
    status: task.status,
    project_id: task.projectId,
    job_id: task.jobId,
    local_path: task.localPath,
    duration_s: task.durationMs === null ? null : task.durationMs / 1000,
    cached: task.cached,
    error: (task.error as AesError | null) ?? null,
    created_at: task.createdAt.toISOString(),
  };
}

const DELIVERY_TIMEOUT_MS = 120_000;

export class AudioService {
  private readonly pending: string[] = [];
  private readonly running = new Set<string>();
  private readonly listeners = new Set<AudioListener>();
  private readonly waiters = new Map<string, Set<(task: AudioTaskRow) => void>>();
  private readonly delivering = new Map<string, Promise<void>>();
  private stopped = false;
  private readonly concurrency: number;

  constructor(
    private readonly ctx: Pick<AppContext, "db" | "hub" | "now" | "storage" | "eleven">,
    private readonly log: FastifyBaseLogger,
    private readonly options: { concurrency?: number; dubPoll?: PollOptions } = {},
  ) {
    this.concurrency = options.concurrency ?? 2;
  }

  attach(): void {
    this.ctx.hub.onMessage((identity, message) => {
      if (message.type === "hello") void this.deliverPending(identity.deviceId);
    });
  }

  listen(listener: AudioListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stop(): void {
    this.stopped = true;
  }

  /** Testlar: navbat va yetkazishlar tugashini kutadi. */
  async idle(): Promise<void> {
    for (let i = 0; i < 1000; i++) {
      if (this.pending.length === 0 && this.running.size === 0 && this.delivering.size === 0)
        return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async get(id: string): Promise<AudioTaskRow | null> {
    const [row] = await this.ctx.db.select().from(audioTasks).where(eq(audioTasks.id, id)).limit(1);
    return row ?? null;
  }

  async list(filter: {
    userId: string;
    projectId?: string;
    jobId?: string;
    ids?: string[];
    limit?: number;
  }) {
    const where = [eq(audioTasks.userId, filter.userId)];
    if (filter.projectId !== undefined) where.push(eq(audioTasks.projectId, filter.projectId));
    if (filter.jobId !== undefined) where.push(eq(audioTasks.jobId, filter.jobId));
    if (filter.ids !== undefined && filter.ids.length > 0)
      where.push(inArray(audioTasks.id, filter.ids));
    return this.ctx.db
      .select()
      .from(audioTasks)
      .where(and(...where))
      .orderBy(desc(audioTasks.createdAt))
      .limit(filter.limit ?? 100);
  }

  // ---------------------------------------------------------------- yuborish va kesh

  async submit(input: SubmitInput): Promise<Result<AudioTaskRow>> {
    const inputs = input.inputs ?? [];
    const hash = paramsHash(input.kind, input.params, inputs);
    const base = {
      userId: input.userId,
      projectId: input.projectId ?? null,
      jobId: input.jobId ?? null,
      kind: input.kind,
      label: input.label ?? null,
      params: input.params,
      inputs,
      paramsHash: hash,
      createdAt: this.ctx.now(),
      updatedAt: this.ctx.now(),
    };
    if (input.fresh !== true) {
      const [hit] = await this.ctx.db
        .select()
        .from(elevenCache)
        .where(eq(elevenCache.paramsHash, hash))
        .limit(1);
      if (hit !== undefined) {
        const [task] = await this.ctx.db
          .insert(audioTasks)
          .values({
            ...base,
            status: "done",
            cached: true,
            credits: 0,
            storageKey: hit.storageKey,
            contentType: hit.contentType,
            ext: hit.ext,
            sha256: hit.sha256,
            durationMs: hit.durationMs,
            result: hit.result,
          })
          .returning();
        this.finished(task!);
        void this.deliver(task!);
        return ok(task!);
      }
    }
    const [task] = await this.ctx.db
      .insert(audioTasks)
      .values({
        ...base,
        status: "queued",
        credits: estimateCredits({
          kind: input.kind,
          params: input.params,
          inputSeconds: inputs.reduce((sum, i) => sum + (i.duration_s ?? 0), 0),
        }),
      })
      .returning();
    this.notify(task!);
    this.enqueue(task!.id);
    return ok(task!);
  }

  /** Vazifa tugashini kutadi (yoki timeout'da joriy holat). */
  async wait(id: string, timeoutMs: number): Promise<AudioTaskRow | null> {
    const current = await this.get(id);
    if (current === null || ["done", "failed", "skipped"].includes(current.status)) return current;
    return new Promise((resolve) => {
      const set = this.waiters.get(id) ?? new Set();
      const timer = setTimeout(() => {
        set.delete(done);
        void this.get(id).then(resolve);
      }, timeoutMs);
      const done = (task: AudioTaskRow) => {
        clearTimeout(timer);
        resolve(task);
      };
      set.add(done);
      this.waiters.set(id, set);
    });
  }

  /** Muvaffaqiyatsiz vazifani qayta navbatga qo'yadi. */
  async retry(id: string): Promise<Result<AudioTaskRow>> {
    const [task] = await this.ctx.db
      .update(audioTasks)
      .set({ status: "queued", error: null, updatedAt: this.ctx.now() })
      .where(and(eq(audioTasks.id, id), eq(audioTasks.status, "failed")))
      .returning();
    if (task === undefined)
      return fail("JOB_BAD_ACTION", "Faqat muvaffaqiyatsiz vazifa qayta yuboriladi");
    this.notify(task);
    this.enqueue(task.id);
    return ok(task);
  }

  async skip(id: string, reason: string): Promise<void> {
    const [task] = await this.ctx.db
      .update(audioTasks)
      .set({
        status: "skipped",
        error: makeError("SYS_BAD_REQUEST", reason),
        updatedAt: this.ctx.now(),
      })
      .where(eq(audioTasks.id, id))
      .returning();
    if (task !== undefined) this.finished(task);
  }

  /** Server ishga tushganda: tugallanmagan vazifalarni qayta navbatga qo'yadi, yetkazilmaganlarni yetkazadi. */
  async recover(): Promise<number> {
    const rows = await this.ctx.db
      .update(audioTasks)
      .set({ status: "queued", updatedAt: this.ctx.now() })
      .where(inArray(audioTasks.status, ["queued", "running"]))
      .returning({ id: audioTasks.id });
    for (const row of rows) this.enqueue(row.id);
    return rows.length;
  }

  // ---------------------------------------------------------------- navbat

  private enqueue(id: string): void {
    if (!this.pending.includes(id)) this.pending.push(id);
    this.pump();
  }

  private pump(): void {
    while (!this.stopped && this.running.size < this.concurrency && this.pending.length > 0) {
      const id = this.pending.shift()!;
      this.running.add(id);
      void this.process(id).finally(() => {
        this.running.delete(id);
        this.pump();
      });
    }
  }

  private async process(id: string): Promise<void> {
    const [task] = await this.ctx.db
      .update(audioTasks)
      .set({ status: "running", updatedAt: this.ctx.now() })
      .where(and(eq(audioTasks.id, id), eq(audioTasks.status, "queued")))
      .returning();
    if (task === undefined) return;
    this.notify(task);
    try {
      const client = await this.ctx.eleven.client(task.userId);
      if (!client.ok) throw new ElevenError(client.error);
      const inputs = await this.loadInputs(task);
      const out = await this.execute(task, client.data, inputs);
      await this.complete(task, out);
    } catch (error) {
      const aes =
        error instanceof ElevenError
          ? error.error
          : makeError("SYS_INTERNAL", error instanceof Error ? error.message : String(error));
      this.log.warn({ task: task.id, kind: task.kind, code: aes.code }, "audio vazifa xatosi");
      const [failed] = await this.ctx.db
        .update(audioTasks)
        .set({ status: "failed", error: aes, updatedAt: this.ctx.now() })
        .where(eq(audioTasks.id, task.id))
        .returning();
      if (failed !== undefined) this.finished(failed);
    }
  }

  private async loadInputs(task: AudioTaskRow): Promise<InputFile[]> {
    const files: InputFile[] = [];
    for (const input of task.inputs ?? []) {
      const data = await this.ctx.storage.getBytes(input.storage_key);
      if (data === null) {
        throw new ElevenError(
          makeError("ASSET_MISSING", `Kirish fayli storage'da yo'q: ${input.name}`),
        );
      }
      const ext = input.storage_key.split(".").pop() ?? "bin";
      files.push({
        data,
        filename: `${input.name}.${ext}`,
        contentType: "application/octet-stream",
      });
    }
    return files;
  }

  private async execute(
    task: AudioTaskRow,
    client: ElevenClient,
    inputs: InputFile[],
  ): Promise<{
    audio: AudioResult | null;
    result: Record<string, unknown> | null;
    durationS: number | null;
  }> {
    const params = task.params as Record<string, unknown>;
    const file = () => {
      const first = inputs[0];
      if (first === undefined)
        throw new ElevenError(makeError("SYS_BAD_REQUEST", "Kirish audiosi kerak"));
      return first;
    };
    switch (task.kind as AudioKind) {
      case "tts": {
        const audio = await tts(client, params as unknown as TtsParams);
        const alignment = audio.data?.alignment as Alignment | null;
        return { audio, result: audio.data ?? null, durationS: alignmentEnd(alignment) };
      }
      case "dialogue":
        return {
          audio: await dialogue(client, params as unknown as DialogueParams),
          result: null,
          durationS: null,
        };
      case "sfx":
        return {
          audio: await soundEffect(client, params as unknown as SfxParams),
          result: null,
          durationS: typeof params.duration_seconds === "number" ? params.duration_seconds : null,
        };
      case "music": {
        const plan = params.composition_plan as
          { sections?: { duration_ms: number }[] } | undefined;
        const ms =
          plan?.sections?.reduce((a, s) => a + s.duration_ms, 0) ??
          (params.music_length_ms as number | undefined);
        return {
          audio: await music(client, params as unknown as MusicParams),
          result: null,
          durationS: typeof ms === "number" ? ms / 1000 : null,
        };
      }
      case "stt": {
        const transcript = await speechToText(client, { ...(params as object), file: file() });
        return { audio: null, result: { transcript }, durationS: null };
      }
      case "align": {
        const alignment = await forcedAlignment(client, {
          text: String(params.text ?? ""),
          file: file(),
        });
        return { audio: null, result: { alignment }, durationS: null };
      }
      case "isolate":
        return { audio: await isolate(client, { file: file() }), result: null, durationS: null };
      case "voice_change":
        return {
          audio: await voiceChange(client, { ...(params as { voice_id: string }), file: file() }),
          result: null,
          durationS: null,
        };
      case "dub": {
        const audio = await dub(
          client,
          { ...(params as { target_lang: string }), file: file() },
          this.options.dubPoll ?? {},
        );
        return { audio, result: audio.data ?? null, durationS: null };
      }
      case "voice_design": {
        const design = await designVoice(client, params as { voice_description: string });
        const first = design.previews[0];
        return {
          audio:
            first === undefined ? null : audioResult(Buffer.from(first.audio_base_64, "base64")),
          result: {
            text: design.text,
            previews: design.previews.map((p) => ({
              generated_voice_id: p.generated_voice_id,
              duration_secs: p.duration_secs,
              language: p.language ?? null,
            })),
          },
          durationS: first?.duration_secs ?? null,
        };
      }
    }
    throw new ElevenError(makeError("SYS_BAD_REQUEST", `Noma'lum audio turi: ${task.kind}`));
  }

  private async complete(
    task: AudioTaskRow,
    out: {
      audio: AudioResult | null;
      result: Record<string, unknown> | null;
      durationS: number | null;
    },
  ): Promise<void> {
    let key: string | null = null;
    let sha: string | null = null;
    if (out.audio !== null) {
      sha = createHash("sha256").update(out.audio.audio).digest("hex");
      key = storageKey({
        userId: task.userId,
        projectId: task.projectId ?? "shared",
        kind: "audio-out",
        hash: sha,
        ext: out.audio.ext,
      });
      if ((await this.ctx.storage.head(key)) === null) {
        await this.ctx.storage.putBytes(key, out.audio.audio, out.audio.contentType);
      }
    }
    const durationMs = out.durationS === null ? null : Math.round(out.durationS * 1000);
    const values = {
      storageKey: key,
      contentType: out.audio?.contentType ?? null,
      ext: out.audio?.ext ?? null,
      sha256: sha,
      durationMs,
      result: out.result,
    };
    await this.ctx.db
      .insert(elevenCache)
      .values({
        paramsHash: task.paramsHash,
        kind: task.kind,
        credits: task.credits,
        createdAt: this.ctx.now(),
        ...values,
      })
      .onConflictDoUpdate({ target: elevenCache.paramsHash, set: values });
    const [done] = await this.ctx.db
      .update(audioTasks)
      .set({ ...values, status: "done", error: null, updatedAt: this.ctx.now() })
      .where(eq(audioTasks.id, task.id))
      .returning();
    if (done === undefined) return;
    this.finished(done);
    void this.deliver(done);
  }

  // ---------------------------------------------------------------- panelga yetkazish

  /** `audio/<kind>_<sha12>.<ext>` — tarkibga bog'liq nom: bir xil fayl qayta yozilmaydi, yangisi yangi nom oladi. */
  static localPath(task: Pick<AudioTaskRow, "kind" | "sha256" | "ext">): string | null {
    if (task.sha256 === null || task.ext === null) return null;
    return `audio/${task.kind}_${task.sha256.slice(0, 12)}.${task.ext}`;
  }

  /** Natijani loyiha papkasiga yuklab beradi (panel online bo'lsa). Takroriy chaqiruv bir marta bajariladi. */
  deliver(task: AudioTaskRow): Promise<void> {
    const running = this.delivering.get(task.id);
    if (running !== undefined) return running;
    const run = this.deliverOnce(task).finally(() => this.delivering.delete(task.id));
    this.delivering.set(task.id, run);
    return run;
  }

  private async deliverOnce(task: AudioTaskRow): Promise<void> {
    if (task.storageKey === null || task.projectId === null || task.deliveredAt !== null) return;
    const dest = AudioService.localPath(task);
    if (dest === null || task.sha256 === null) return;
    const [project] = await this.ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1);
    if (project?.deviceId == null || !this.ctx.hub.isOnline(project.deviceId)) return;
    const size = (await this.ctx.storage.head(task.storageKey))?.size;
    const reply = await this.ctx.hub.request(
      project.deviceId,
      {
        type: "file.download",
        request_id: randomUUID(),
        url: await this.ctx.storage.presignGet(task.storageKey),
        sha256: task.sha256,
        dest,
        ...(size === undefined ? {} : { size }),
      },
      DELIVERY_TIMEOUT_MS,
    );
    if (!reply.ok || reply.data.type !== "file.saved") {
      this.log.warn(
        { task: task.id, error: reply.ok ? reply.data.type : reply.error.code },
        "audio yetkazilmadi",
      );
      return;
    }
    const probed = reply.data.duration_s;
    const [updated] = await this.ctx.db
      .update(audioTasks)
      .set({
        localPath: dest,
        deliveredAt: this.ctx.now(),
        ...(task.durationMs === null && typeof probed === "number"
          ? { durationMs: Math.round(probed * 1000) }
          : {}),
        updatedAt: this.ctx.now(),
      })
      .where(eq(audioTasks.id, task.id))
      .returning();
    if (updated !== undefined) {
      if (task.durationMs === null && typeof probed === "number") {
        await this.ctx.db
          .update(elevenCache)
          .set({ durationMs: updated.durationMs })
          .where(and(eq(elevenCache.paramsHash, task.paramsHash), isNull(elevenCache.durationMs)));
      }
      this.notify(updated);
    }
  }

  /** Panel ulanganda: shu qurilma loyihalaridagi yetkazilmagan natijalar. */
  async deliverPending(deviceId: string): Promise<void> {
    const rows = await this.ctx.db
      .select({ task: audioTasks })
      .from(audioTasks)
      .innerJoin(projects, eq(projects.id, audioTasks.projectId))
      .where(
        and(
          eq(projects.deviceId, deviceId),
          eq(audioTasks.status, "done"),
          isNotNull(audioTasks.storageKey),
          isNull(audioTasks.deliveredAt),
        ),
      );
    for (const { task } of rows) await this.deliver(task);
  }

  // ---------------------------------------------------------------- hodisalar

  private notify(task: AudioTaskRow): void {
    for (const listener of this.listeners) listener(task);
  }

  private finished(task: AudioTaskRow): void {
    this.notify(task);
    const set = this.waiters.get(task.id);
    if (set === undefined) return;
    this.waiters.delete(task.id);
    for (const resolve of set) resolve(task);
  }
}
