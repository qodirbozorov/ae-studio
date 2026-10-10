/**
 * Job holat mashinasi (§3): CHECK → PLAN → INGEST → AUDIO → PREFLIGHT → BUILD → VERIFY → RENDER → REPORT → DONE.
 *
 * - Yagona haqiqat manbai `jobs` + `job_events` + `ops` (§2.1). Server qayta ishga tushsa `recover()` davom ettiradi.
 * - Har o'tish compare-and-set (`WHERE state = <eski>`): amal (cancel, pause) ishlab turgan handler bilan to'qnashmaydi.
 * - Xato → `BLOCKED` (retry | patch | ask_user | cancel); panel yo'q → `WAITING_AGENT`, `hello` kelganda `prev_state` ga qaytadi.
 * - Vaqtincha: AUDIO → skipped (Faza 4), VERIFY → qo'lda approve (Faza 3), RENDER → skipped (Faza 3).
 */
import { createHash, randomUUID } from "node:crypto";
import { MAIN_COMP, compile, planTiming } from "@aes/compiler";
import type { CompileAsset, CompileAudio, CompiledVariant } from "@aes/compiler";
import {
  BATCH_PROTOCOL_VERSION,
  iconFile,
  MAX_PATCHES,
  audioUsesEleven,
  missingBrandAudio,
  durationMatches,
  fail,
  makeError,
  makeOp,
  ok,
  opTimeoutMs,
  parseSpec,
} from "@aes/shared";
import type {
  AeOpName,
  AesError,
  OpResultData,
  JobAction,
  JobOutcome,
  JobState,
  LogLevel,
  OpEnvelope,
  OutputPreset,
  Result,
  VideoSpec,
} from "@aes/shared";
import { and, asc, desc, eq, inArray, max, ne, notInArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { applyScan } from "../assets/routes";
import type { AppContext } from "../context";
import {
  assets,
  jobEvents,
  jobs,
  ops,
  plans,
  projects,
  pronunciationDicts,
  renders,
  reports,
} from "../db/schema";
import { cacheFlags } from "../audio/cache-status";
import { estimateCredits } from "../audio/estimate";
import { extractInput } from "../audio/inputs";
import { planAudioTasks } from "../audio/plan";
import type { AudioPlanItem, PronunciationLocator } from "../audio/plan";
import type { AudioTaskRow, InputRef } from "../audio/service";
import { wordsOfTask } from "../audio/words";
import { normalizeRootPath } from "../projects/routes";
import { storageKey } from "../storage";
import { buildReport, pad3 } from "./report";
import { lucidePdf, lucideSvg } from "../icons/lucide";
import { aeFonts, compileExtras, usesFonts } from "./compile-extras";
import { IDLE_STATES, actionAllowed, nextState } from "./machine";

export type JobRow = typeof jobs.$inferSelect;
type JobPatch = Partial<typeof jobs.$inferInsert>;
type ProjectRow = typeof projects.$inferSelect;
type OpRow = typeof ops.$inferSelect;

export interface JobEventOut {
  ts: string;
  level: LogLevel;
  type: string;
  op_id?: string;
  message: string;
  data?: unknown;
}

export interface JobProgress {
  done: number;
  total: number;
  scene_id?: string;
}

/** Live log va Live ekrani (P2.12) shu tinglovchilar orqali oladi. */
export interface JobListener {
  update?(job: JobRow, progress: JobProgress): void;
  event?(job: JobRow, event: JobEventOut): void;
}

type Step =
  | { kind: "next"; to?: JobState; set?: JobPatch }
  | { kind: "block"; error: AesError }
  | { kind: "wait_agent"; reason: string }
  /** Tashqi amal kutiladi (VERIFY, pause). */
  | { kind: "hold" }
  /** Handler ishlayotganda holat tashqaridan o'zgardi: qayta o'qib davom etiladi. */
  | { kind: "stale" };

const INGEST_TIMEOUT_MS = 10 * 60_000;
/** Panelda ish papkasini tiklash (`project.open`) uchun. */
const PROJECT_OPEN_TIMEOUT_MS = 60_000;
const CHECK_PING_TIMEOUT_MS = 15_000;
/** Bitta drive siklidagi holatlar soni chegarasi (cheksiz aylanishdan himoya). */
const MAX_STEPS = 64;
/** Bitta evalScript'dagi oplar chegarasi (katta sahna bo'laklarga bo'linadi, §3.2). */
const MAX_BATCH_OPS = 400;
/** Batch timeout: oplar timeout'lari yig'indisi, shu chegaragacha (+ tarmoq zaxirasi). */
const BATCH_TIMEOUT_CAP_MS = 30 * 60_000;
const BATCH_SLACK_MS = 15_000;

export type EngineContext = Pick<
  AppContext,
  "db" | "hub" | "now" | "storage" | "eleven" | "audio" | "templates" | "brands"
>;

/** Ish papkasidagi lokal nusxalar (§2.10): versiyali, hech biri ustiga yozilmaydi. */
export function planCopyPath(version: number): string {
  return `.aestudio/plan.v${pad3(version)}.json`;
}

export function reportCopyPath(job: Pick<JobRow, "id" | "aepVersion">): string {
  return job.aepVersion === null
    ? `.aestudio/report.job-${job.id.slice(0, 8)}.md`
    : `.aestudio/report.v${pad3(job.aepVersion)}.md`;
}

const COPY_TIMEOUT_MS = 60_000;

/** `.aep` fayl nomi uchun xavfsiz asos (loyiha nomidan). */
export function fileBase(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base === "" ? "project" : base.slice(0, 60);
}

export function aepPath(project: Pick<ProjectRow, "name">, version: number): string {
  return `${fileBase(project.name)}_v${pad3(version)}.aep`;
}

/** Loyiha assetlari compiler kontekstiga (PREFLIGHT va MCP `preflight`). */
export async function compileAssets(
  db: EngineContext["db"],
  projectId: string,
): Promise<Record<string, CompileAsset>> {
  const rows = await db.select().from(assets).where(eq(assets.projectId, projectId));
  const map: Record<string, CompileAsset> = {};
  for (const row of rows) {
    const meta = row.meta as Record<string, unknown>;
    const num = (key: string) => (typeof meta[key] === "number" ? (meta[key] as number) : null);
    map[row.key] = {
      key: row.key,
      local_path: row.localPath,
      kind: row.kind,
      status: row.status,
      meta: { width: num("width"), height: num("height"), duration: num("duration") },
    };
  }
  return map;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === "object"; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class JobEngine {
  private readonly driving = new Map<string, Promise<void>>();
  private readonly rerun = new Set<string>();
  private readonly listeners = new Set<JobListener>();
  /** Fondagi ishlar (qayta render): `idle()` ularni ham kutadi. */
  private readonly background = new Set<Promise<unknown>>();
  private stopped = false;

  constructor(
    private readonly ctx: EngineContext,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Hub'ga ulanadi: panel `hello` yuborganda shu qurilmadagi `WAITING_AGENT` joblar davom etadi. */
  attach(): void {
    this.ctx.hub.onMessage((identity, message) => {
      if (message.type === "hello") void this.agentReady(identity.deviceId);
    });
  }

  listen(listener: JobListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Server ishga tushganda: yakunlanmagan joblarni davom ettiradi (panel yo'q bo'lsa ular o'zi kutadi). */
  async recover(): Promise<number> {
    const rows = await this.ctx.db
      .select({ id: jobs.id, state: jobs.state, paused: jobs.paused })
      .from(jobs)
      .where(ne(jobs.state, "DONE"));
    const runnable = rows.filter((row) => !IDLE_STATES.includes(row.state) && !row.paused);
    for (const row of runnable) void this.drive(row.id);
    return runnable.length;
  }

  /** Testlar va to'xtatish: ishlab turgan driverlar tugashini kutadi. */
  async idle(): Promise<void> {
    while (this.driving.size > 0 || this.background.size > 0) {
      await Promise.all([...this.driving.values(), ...this.background]);
    }
  }

  stop(): void {
    this.stopped = true;
  }

  // ------------------------------------------------------------------ rejalar va joblar

  /** Yangi plan versiyasi (§2.10: hech biri ustiga yozilmaydi). */
  async addPlan(
    projectId: string,
    input: unknown,
    createdBy: "claude" | "user" | "system",
  ): Promise<Result<{ version: number; spec: VideoSpec }>> {
    const parsed = parseSpec(input);
    if (!parsed.ok) return parsed;
    for (let attempt = 0; attempt < 3; attempt++) {
      const [last] = await this.ctx.db
        .select({ version: max(plans.version) })
        .from(plans)
        .where(eq(plans.projectId, projectId));
      const version = (last?.version ?? 0) + 1;
      try {
        await this.ctx.db
          .insert(plans)
          .values({ projectId, version, spec: parsed.data, createdBy, createdAt: this.ctx.now() });
        return ok({ version, spec: parsed.data });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    return fail("SYS_INTERNAL", "Plan versiyasi ajratilmadi");
  }

  async create(input: {
    projectId: string;
    planVersion?: number;
    /** VERIFY avtomatik tasdiqlanadi (Claude'siz rejim). */
    autoApprove?: boolean;
    batchId?: string;
  }): Promise<Result<JobRow>> {
    const project = await this.project(input.projectId);
    if (project === null) return fail("SYS_NOT_FOUND", "Loyiha topilmadi");
    if (project.deviceId === null) {
      return fail("AUTH_DEVICE_REVOKED", "Loyiha qurilmasi bekor qilingan");
    }
    const plan = await this.plan(project.id, input.planVersion);
    if (plan === null) {
      return fail(
        "SPEC_INVALID",
        input.planVersion === undefined ? "Loyihada plan yo'q" : `Plan v${input.planVersion} yo'q`,
      );
    }
    const active = await this.activeJob(project.deviceId);
    if (active !== null) {
      return fail("JOB_ACTIVE", `Aktiv job: ${active.id} (${active.state})`, { job_id: active.id });
    }
    let job: JobRow;
    try {
      const [row] = await this.ctx.db
        .insert(jobs)
        .values({
          projectId: project.id,
          deviceId: project.deviceId,
          planVersion: plan.version,
          state: "CHECK",
          autoApprove: input.autoApprove === true,
          batchId: input.batchId ?? null,
          createdAt: this.ctx.now(),
          updatedAt: this.ctx.now(),
        })
        .returning();
      job = row!;
    } catch (error) {
      if (isUniqueViolation(error)) return fail("JOB_ACTIVE", "Bu qurilmada aktiv job bor");
      throw error;
    }
    await this.event(job, "info", "job.created", `Job yaratildi (plan v${plan.version})`);
    void this.drive(job.id);
    return ok(job);
  }

  async get(jobId: string): Promise<JobRow | null> {
    const [row] = await this.ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    return row ?? null;
  }

  async activeJob(deviceId: string): Promise<JobRow | null> {
    const [row] = await this.ctx.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.deviceId, deviceId), ne(jobs.state, "DONE")))
      .limit(1);
    return row ?? null;
  }

  async progress(jobId: string, sceneId?: string): Promise<JobProgress> {
    const rows = await this.ctx.db
      .select({ status: ops.status })
      .from(ops)
      .where(eq(ops.jobId, jobId));
    const progress: JobProgress = {
      done: rows.filter((row) => row.status === "done").length,
      total: rows.length,
    };
    if (sceneId !== undefined) progress.scene_id = sceneId;
    return progress;
  }

  // ------------------------------------------------------------------ amallar

  async act(
    jobId: string,
    action: JobAction,
    /** `render: false` — tasdiq render'siz (Claude: foydalanuvchi ruxsatisiz render yo'q). */
    input: { spec?: unknown; render?: boolean } = {},
  ): Promise<Result<JobRow>> {
    const job = await this.get(jobId);
    if (job === null) return fail("SYS_NOT_FOUND", "Job topilmadi");
    if (!actionAllowed(action, job.state, job.paused)) {
      return fail(
        "JOB_BAD_ACTION",
        `${action}: job ${job.state}${job.paused ? " (pauza)" : ""} holatida`,
        { state: job.state, paused: job.paused },
      );
    }
    let updated: JobRow | null = null;
    switch (action) {
      case "retry":
        updated = await this.transition(job, {
          state: job.prevState ?? "CHECK",
          prevState: "BLOCKED",
          error: null,
        });
        break;
      case "ask_user":
        await this.event(job, "info", "job.ask_user", "Foydalanuvchidan yo'l-yo'riq so'raldi");
        return ok(job);
      case "patch":
        return this.patch(job, input.spec);
      case "approve": {
        // Render og'ir (AE band, ping'lar kechikadi): faqat aniq so'ralganda. Aks holda natija
        // foydalanuvchining AE timeline'ida qoladi, job REPORT → DONE.
        const render = input.render !== false;
        updated = await this.transition(job, {
          state: render ? "RENDER" : "REPORT",
          prevState: null,
        });
        if (updated !== null) {
          await this.event(
            job,
            "info",
            "verify.approved",
            render
              ? "VERIFY tasdiqlandi"
              : "VERIFY tasdiqlandi (render'siz: natija AE timeline'ida; render faqat foydalanuvchi ruxsati bilan)",
          );
        }
        break;
      }
      case "cancel":
        updated = await this.transition(job, {
          state: "REPORT",
          prevState: job.state,
          outcome: "cancelled",
          paused: false,
        });
        if (updated !== null) {
          if (job.deviceId !== null) {
            this.ctx.hub.send(job.deviceId, { type: "job.cancel", job_id: job.id });
          }
          await this.event(job, "warn", "job.cancelled", "Job bekor qilindi");
        }
        break;
      case "pause":
        updated = await this.setPaused(job, true);
        if (updated !== null) {
          if (job.deviceId !== null) {
            this.ctx.hub.send(job.deviceId, { type: "job.pause", job_id: job.id });
          }
          await this.event(job, "info", "job.paused", "Pauza: joriy op tugagach to'xtaydi");
        }
        break;
      case "resume":
        updated = await this.setPaused(job, false);
        if (updated !== null) await this.event(job, "info", "job.resumed", "Davom ettirildi");
        break;
      case "undo":
        return this.undoLast(job);
    }
    if (updated === null) {
      return fail("JOB_BAD_ACTION", "Job holati shu payt o'zgardi; qayta urinib ko'ring");
    }
    void this.drive(job.id);
    return ok(updated);
  }

  private async patch(job: JobRow, spec: unknown): Promise<Result<JobRow>> {
    if (job.patchCount >= MAX_PATCHES) {
      return fail("LOOP_PATCH_LIMIT", `${MAX_PATCHES} ta patch ishlatildi`);
    }
    if (spec === undefined) return fail("SYS_BAD_REQUEST", "patch uchun spec kerak");
    const plan = await this.addPlan(job.projectId, spec, "claude");
    if (!plan.ok) return plan;
    // Allaqachon qurilgan versiya ustiga yozilmaydi: biror op bajarilgan bo'lsa yangi vNNN
    // (shu job'ning eski versiyasi ham hisobga olinishi uchun hozir ajratiladi).
    const [built] = await this.ctx.db
      .select({ id: ops.id })
      .from(ops)
      .where(and(eq(ops.jobId, job.id), eq(ops.status, "done")))
      .limit(1);
    const updated = await this.transition(job, {
      // Audio ham yangi plan bo'yicha (kesh: o'zgarmagan qismlar qayta generatsiya qilinmaydi).
      state: "AUDIO",
      prevState: null,
      planVersion: plan.data.version,
      patchCount: job.patchCount + 1,
      aepVersion: built === undefined ? job.aepVersion : await this.nextAepVersion(job.projectId),
      error: null,
    });
    if (updated === null) return fail("JOB_BAD_ACTION", "Job holati shu payt o'zgardi");
    await this.event(job, "info", "job.patched", `Patch: plan v${plan.data.version}`, {
      data: { plan_version: plan.data.version, patch_count: updated.patchCount },
    });
    void this.drive(job.id);
    return ok(updated);
  }

  /**
   * Undo last (Live ekrani, pauzada): AE'dagi oxirgi bajarilgan opni bekor qiladi va uni `pending` qiladi —
   * resume'da qayta bajariladi. Loyihani ochish/saqlash undo tarixiga kirmaydi, shuning uchun o'tkaziladi.
   */
  private async undoLast(job: JobRow): Promise<Result<JobRow>> {
    if (job.deviceId === null) return fail("AUTH_DEVICE_REVOKED", "Qurilma bekor qilingan");
    const [running] = await this.ctx.db
      .select({ id: ops.id })
      .from(ops)
      .where(and(eq(ops.jobId, job.id), eq(ops.status, "running")))
      .limit(1);
    if (running !== undefined || this.driving.has(job.id)) {
      return fail("JOB_BAD_ACTION", "Joriy op hali tugamadi; birozdan keyin qayta urining");
    }
    const [last] = await this.ctx.db
      .select()
      .from(ops)
      .where(
        and(
          eq(ops.jobId, job.id),
          eq(ops.status, "done"),
          notInArray(ops.op, ["project.open_or_create", "project.save"]),
        ),
      )
      .orderBy(desc(ops.seq))
      .limit(1);
    if (last === undefined) return fail("JOB_BAD_ACTION", "Bekor qilinadigan op yo'q");
    // Batch'da (P6.04) bir nechta op bitta AE undo group'ida: guruh butunligicha bekor qilinadi.
    const group = (last.result as OpResultData | null)?.undo_group ?? last.opId;
    const result = await this.ctx.hub.run(
      job.deviceId,
      makeOp("undo", `undo.${group}`.slice(0, 128), 0, { op_id: group }),
      job.id,
    );
    if (!result.ok) return result;
    const done = await this.ctx.db
      .select({ id: ops.id, result: ops.result })
      .from(ops)
      .where(and(eq(ops.jobId, job.id), eq(ops.status, "done")));
    const undone = done
      .filter(
        (row) => row.id === last.id || (row.result as OpResultData | null)?.undo_group === group,
      )
      .map((row) => row.id);
    await this.ctx.db
      .update(ops)
      .set({ status: "pending", result: null, finishedAt: null })
      .where(inArray(ops.id, undone));
    await this.event(job, "info", "op.undone", `↩ ${last.op} bekor qilindi (${undone.length} op)`, {
      opId: last.opId,
    });
    const updated = (await this.get(job.id)) ?? job;
    await this.notify(updated);
    return ok(updated);
  }

  private async setPaused(job: JobRow, paused: boolean): Promise<JobRow | null> {
    const [row] = await this.ctx.db
      .update(jobs)
      .set({ paused, updatedAt: this.ctx.now() })
      .where(and(eq(jobs.id, job.id), eq(jobs.paused, !paused)))
      .returning();
    if (row !== undefined) await this.notify(row);
    return row ?? null;
  }

  private async agentReady(deviceId: string): Promise<void> {
    const waiting = await this.ctx.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.deviceId, deviceId), eq(jobs.state, "WAITING_AGENT")));
    for (const job of waiting) {
      const updated = await this.transition(job, {
        state: job.prevState ?? "CHECK",
        prevState: "WAITING_AGENT",
      });
      if (updated === null) continue;
      await this.event(job, "info", "agent.back", "Panel qayta ulandi — davom etamiz");
      void this.drive(job.id);
    }
  }

  // ------------------------------------------------------------------ driver

  /** Job'ni idle holatgacha yuritadi. Bir job uchun bitta driver; ishlab tursa yana bir aylanish belgilanadi. */
  drive(jobId: string): Promise<void> {
    const running = this.driving.get(jobId);
    if (running !== undefined) {
      this.rerun.add(jobId);
      return running;
    }
    const run = (async () => {
      do {
        this.rerun.delete(jobId);
        await this.loop(jobId);
      } while (this.rerun.has(jobId) && !this.stopped);
    })()
      .catch((error: unknown) => this.log.error({ err: error, job: jobId }, "job driver xatosi"))
      .finally(() => this.driving.delete(jobId));
    this.driving.set(jobId, run);
    return run;
  }

  private async loop(jobId: string): Promise<void> {
    for (let steps = 0; steps < MAX_STEPS && !this.stopped; steps++) {
      const job = await this.get(jobId);
      if (job === null || IDLE_STATES.includes(job.state) || job.paused) return;
      const step = await this.handle(job);
      if (step.kind === "hold") return;
      if (step.kind === "stale") continue;
      await this.apply(job, step);
    }
  }

  private async handle(job: JobRow): Promise<Step> {
    try {
      switch (job.state) {
        case "CHECK":
          return await this.check(job);
        case "PLAN":
          return await this.planStep(job);
        case "INGEST":
          return await this.ingest(job);
        case "AUDIO":
          return await this.audioStep(job);
        case "PREFLIGHT":
          return await this.preflight(job);
        case "BUILD":
          return await this.build(job);
        case "VERIFY":
          if (job.autoApprove) {
            await this.event(
              job,
              "info",
              "verify.auto",
              "VERIFY: avtomatik tasdiq (Claude'siz rejim)",
            );
            return { kind: "next" };
          }
          await this.event(
            job,
            "info",
            "verify.waiting",
            "VERIFY: AE'da natijani ko'rib tasdiqlang (approve) yoki patch yuboring",
          );
          return { kind: "hold" };
        case "RENDER":
          return await this.renderStep(job);
        case "REPORT":
          return await this.report(job);
        default:
          return { kind: "hold" };
      }
    } catch (error) {
      this.log.error({ err: error, job: job.id, state: job.state }, "job handler xatosi");
      return {
        kind: "block",
        error: makeError("SYS_INTERNAL", error instanceof Error ? error.message : String(error)),
      };
    }
  }

  private async apply(job: JobRow, step: Exclude<Step, { kind: "hold" | "stale" }>): Promise<void> {
    switch (step.kind) {
      case "next": {
        const to = step.to ?? nextState(job.state);
        await this.transition(job, { prevState: null, ...step.set, state: to });
        return;
      }
      case "block": {
        const updated = await this.transition(job, {
          state: "BLOCKED",
          prevState: job.state,
          error: step.error,
        });
        if (updated !== null) {
          await this.event(job, "error", "job.blocked", `${step.error.code}: ${step.error.hint}`, {
            data: step.error,
          });
        }
        return;
      }
      case "wait_agent": {
        const updated = await this.transition(job, {
          state: "WAITING_AGENT",
          prevState: job.state,
        });
        if (updated !== null) await this.event(job, "warn", "agent.waiting", step.reason);
        return;
      }
    }
  }

  /** Compare-and-set o'tish. Holat boshqa joyda o'zgargan bo'lsa `null`. */
  private async transition(job: JobRow, set: JobPatch): Promise<JobRow | null> {
    const [row] = await this.ctx.db
      .update(jobs)
      .set({ ...set, updatedAt: this.ctx.now() })
      .where(and(eq(jobs.id, job.id), eq(jobs.state, job.state)))
      .returning();
    if (row === undefined) return null;
    if (row.state !== job.state) {
      await this.event(row, "info", "job.state", `${job.state} → ${row.state}`, {
        data: { from: job.state, to: row.state },
      });
    }
    await this.notify(row);
    return row;
  }

  private async notify(job: JobRow, sceneId?: string): Promise<void> {
    if (this.listeners.size === 0) return;
    const progress = await this.progress(job.id, sceneId);
    for (const listener of this.listeners) listener.update?.(job, progress);
  }

  /** Tashqi modullar (MCP VERIFY, render) uchun job log'iga yozuv. */
  async note(
    jobId: string,
    level: LogLevel,
    type: string,
    message: string,
    data?: unknown,
  ): Promise<void> {
    const job = await this.get(jobId);
    if (job !== null)
      await this.event(job, level, type, message, data === undefined ? {} : { data });
  }

  /** PREFLIGHT'da hisoblangan VERIFY kalit vaqtlari (oxirgi `preflight.ok` hodisasidan). */
  /** PREFLIGHT natijasidagi format variantlari (§11.4.1). */
  async variants(jobId: string): Promise<CompiledVariant[]> {
    const [row] = await this.ctx.db
      .select({ data: jobEvents.data })
      .from(jobEvents)
      .where(and(eq(jobEvents.jobId, jobId), eq(jobEvents.type, "preflight.ok")))
      .orderBy(desc(jobEvents.id))
      .limit(1);
    const variants = (row?.data as { variants?: unknown } | null)?.variants;
    return Array.isArray(variants) ? (variants as CompiledVariant[]) : [];
  }

  async keyTimes(jobId: string): Promise<number[]> {
    const [row] = await this.ctx.db
      .select({ data: jobEvents.data })
      .from(jobEvents)
      .where(and(eq(jobEvents.jobId, jobId), eq(jobEvents.type, "preflight.ok")))
      .orderBy(desc(jobEvents.id))
      .limit(1);
    const times = (row?.data as { key_times?: unknown } | null)?.key_times;
    return Array.isArray(times) ? times.filter((t): t is number => typeof t === "number") : [];
  }

  private async event(
    job: JobRow,
    level: LogLevel,
    type: string,
    message: string,
    extra: { opId?: string; data?: unknown } = {},
  ): Promise<void> {
    const ts = this.ctx.now();
    await this.ctx.db.insert(jobEvents).values({
      jobId: job.id,
      ts,
      level,
      type,
      opId: extra.opId ?? null,
      message,
      data: extra.data ?? null,
    });
    const event: JobEventOut = { ts: ts.toISOString(), level, type, message };
    if (extra.opId !== undefined) event.op_id = extra.opId;
    if (extra.data !== undefined) event.data = extra.data;
    for (const listener of this.listeners) listener.event?.(job, event);
  }

  // ------------------------------------------------------------------ handlerlar

  /**
   * #6: panelda job loyihasining papkasi ochiqmi; bo'lmasa (AE/panel qayta ochilgan, boshqa papka) uni
   * `project.open` bilan ochadi. CHECK, BUILD, RENDER va VERIFY kadrlaridan oldin — panel qayta ulanganda
   * papkani o'zi ham tiklaydi, server kutmasdan op yuborsa ENV_NO_FOLDER bo'lardi. null — tayyor.
   */
  private async ensureFolder(job: JobRow, stage: string): Promise<Step | null> {
    const project = await this.project(job.projectId);
    if (project === null) {
      return { kind: "block", error: makeError("SYS_NOT_FOUND", "Loyiha yo'q") };
    }
    if (job.deviceId === null) {
      return { kind: "block", error: makeError("AUTH_DEVICE_REVOKED", "Qurilma bekor qilingan") };
    }
    const agent = this.ctx.hub.state(job.deviceId);
    if (agent === null) return { kind: "wait_agent", reason: `${stage}: panel ulanmagan` };
    const root = agent.projectRoot === null ? null : normalizeRootPath(agent.projectRoot);
    if (root === project.rootPath) return null;
    const reopened = await this.ctx.hub.request(
      job.deviceId,
      { type: "project.open", request_id: randomUUID(), root_path: project.rootPath },
      PROJECT_OPEN_TIMEOUT_MS,
    );
    if (!reopened.ok && reopened.error.code === "ENV_AGENT_OFFLINE") {
      return { kind: "wait_agent", reason: `${stage}: panel uzildi (papka tiklash)` };
    }
    if (!reopened.ok || reopened.data.type !== "project.opened") {
      return {
        kind: "block",
        error: makeError(
          "ENV_NO_FOLDER",
          `Panelda ${root === null ? "papka ochilmagan" : `boshqa papka ochiq: ${root}`}; kerak: ${project.rootPath}` +
            (reopened.ok
              ? ""
              : ` (avtomatik ochilmadi: ${reopened.error.message ?? reopened.error.code})`),
        ),
      };
    }
    await this.event(
      job,
      "info",
      "check.folder_restored",
      `Ish papkasi avtomatik ochildi: ${project.rootPath}`,
      { data: { previous: root, root: project.rootPath, stage } },
    );
    return null;
  }

  /** VERIFY vositalari uchun: papka ochiq bo'lmasa ochadi (`ensureFolder`). */
  async prepareFolder(job: JobRow): Promise<Result<void>> {
    const step = await this.ensureFolder(job, "VERIFY");
    if (step === null) return ok(undefined);
    if (step.kind === "block") return { ok: false, error: step.error };
    return fail("ENV_AGENT_OFFLINE", "Panel ulanmagan");
  }

  private async check(job: JobRow): Promise<Step> {
    const project = await this.project(job.projectId);
    if (project === null)
      return { kind: "block", error: makeError("SYS_NOT_FOUND", "Loyiha yo'q") };
    if (job.deviceId === null) {
      return { kind: "block", error: makeError("AUTH_DEVICE_REVOKED", "Qurilma bekor qilingan") };
    }
    const agent = this.ctx.hub.state(job.deviceId);
    if (agent === null) return { kind: "wait_agent", reason: "CHECK: panel ulanmagan" };
    // ElevenLabs: spec audio talab qilsa — kalit va kvota (P4.01).
    const plan = await this.plan(job.projectId, job.planVersion);
    const planSpec = plan === null ? null : parseSpec(plan.spec);
    // Brand kit (§11.3): topilishi va undan to'ldiriladigan audio maydonlari.
    if (planSpec?.ok === true) {
      const brand = await this.ctx.brands.resolve(project.userId, planSpec.data.brand);
      if (!brand.ok) return { kind: "block", error: brand.error };
      const missing = missingBrandAudio(planSpec.data, brand.data);
      if (missing !== null) return { kind: "block", error: makeError("SPEC_INVALID", missing) };
    }
    if (planSpec?.ok === true && audioUsesEleven(planSpec.data)) {
      const account = await this.ctx.eleven.account(project.userId);
      if (!account.configured) {
        return {
          kind: "block",
          error: makeError(
            "EL_AUTH",
            "ElevenLabs kaliti kiritilmagan: kabinet → Sozlamalar → ElevenLabs",
          ),
        };
      }
      if (account.error !== null) {
        return {
          kind: "block",
          error: makeError(account.error as "EL_AUTH", "ElevenLabs hisobi tekshirilmadi"),
        };
      }
      if (account.remaining === 0) {
        return { kind: "block", error: makeError("EL_QUOTA", "ElevenLabs kvotasi tugagan") };
      }
    }
    const folder = await this.ensureFolder(job, "CHECK");
    if (folder !== null) return folder;
    const ping = await this.ctx.hub.run(
      job.deviceId,
      makeOp("ping", "check.ping", 0, {}, { timeout_ms: CHECK_PING_TIMEOUT_MS }),
      job.id,
    );
    if (!ping.ok) {
      if (ping.error.code === "ENV_AGENT_OFFLINE") {
        return { kind: "wait_agent", reason: "CHECK: panel uzildi" };
      }
      const error =
        ping.error.code === "AE_TIMEOUT"
          ? makeError("ENV_AE_CLOSED", "AE ping'ga javob bermadi")
          : ping.error;
      return { kind: "block", error };
    }
    const info = ping.data.info ?? {};
    const root = project.rootPath;
    await this.event(job, "info", "check.env", `AE ${String(info.ae_version ?? "?")} · ${root}`, {
      data: { ...info, project_root: root, server: "ok", panel: "online" },
    });
    return { kind: "next" };
  }

  private async planStep(job: JobRow): Promise<Step> {
    const plan = await this.plan(job.projectId, job.planVersion);
    if (plan === null) {
      return { kind: "block", error: makeError("SPEC_INVALID", `Plan v${job.planVersion} yo'q`) };
    }
    const spec = parseSpec(plan.spec);
    if (!spec.ok) return { kind: "block", error: spec.error };
    await this.event(
      job,
      "info",
      "plan.ok",
      `Plan v${job.planVersion}: ${spec.data.scenes.length} sahna`,
      { data: { plan_version: job.planVersion, scenes: spec.data.scenes.map((s) => s.id) } },
    );
    return { kind: "next" };
  }

  private async ingest(job: JobRow): Promise<Step> {
    const project = await this.project(job.projectId);
    if (project === null || job.deviceId === null) {
      return { kind: "block", error: makeError("SYS_NOT_FOUND", "Loyiha yoki qurilma yo'q") };
    }
    const reply = await this.ctx.hub.request(
      job.deviceId,
      { type: "assets.scan", request_id: randomUUID(), project_root: project.rootPath },
      INGEST_TIMEOUT_MS,
    );
    if (!reply.ok) {
      if (reply.error.code === "ENV_AGENT_OFFLINE") {
        return { kind: "wait_agent", reason: "INGEST: panel uzildi" };
      }
      return { kind: "block", error: reply.error };
    }
    if (reply.data.type !== "asset.scanned") {
      return {
        kind: "block",
        error: makeError("SYS_INTERNAL", `Kutilmagan javob: ${reply.data.type}`),
      };
    }
    const applied = await applyScan(
      this.ctx,
      { deviceId: job.deviceId, userId: project.userId },
      reply.data,
    );
    if (applied === null) {
      return {
        kind: "block",
        error: makeError("ENV_NO_FOLDER", "Skan natijasi loyihaga mos emas"),
      };
    }
    const broken = reply.data.assets.filter((asset) => asset.error !== undefined);
    await this.event(
      job,
      broken.length > 0 ? "warn" : "info",
      "ingest.done",
      `INGEST: ${applied.count} fayl${broken.length > 0 ? `, ${broken.length} tasi o'qilmadi` : ""}`,
      { data: { count: applied.count, broken: broken.map((a) => a.key) } },
    );
    return { kind: "next" };
  }

  private async preflight(job: JobRow): Promise<Step> {
    const project = await this.project(job.projectId);
    const plan = await this.plan(job.projectId, job.planVersion);
    if (project === null || plan === null) {
      return { kind: "block", error: makeError("SPEC_INVALID", "Loyiha yoki plan yo'q") };
    }
    const spec = parseSpec(plan.spec);
    if (!spec.ok) return { kind: "block", error: spec.error };

    const assetMap = await compileAssets(this.ctx.db, project.id);
    const audioReady = await this.audioReady(job);
    const version = job.aepVersion ?? (await this.nextAepVersion(project.id));
    const projectPath = aepPath(project, version);
    const resolved = await compileExtras(this.ctx, project.userId, spec.data);
    if (!resolved.ok) return { kind: "block", error: resolved.error };
    const extras = resolved.data;
    // Shriftlar: brand yoki Spec shrift ishlatsa AE'dan ro'yxat (AE_FONT_MISSING + fallback, §11.3).
    if (job.deviceId !== null && usesFonts(spec.data, extras)) {
      const fonts = await aeFonts(this.ctx, job.deviceId, job.id);
      if (!fonts.ok) {
        if (fonts.error.code === "ENV_AGENT_OFFLINE") {
          return { kind: "wait_agent", reason: "PREFLIGHT: panel uzildi (shriftlar)" };
        }
        return { kind: "block", error: fonts.error };
      }
      extras.fonts = fonts.data;
    }
    const compiled = compile(spec.data, {
      assets: assetMap,
      projectPath,
      version,
      ...(audioReady === null ? {} : { audio: audioReady }),
      ...extras,
    });
    if (!compiled.ok) return { kind: "block", error: compiled.error };
    // Aep shablon fayllari panelga (BUILD'dagi `template.instantiate` ularni import qiladi).
    if (extras.templates !== undefined && job.deviceId !== null) {
      const delivered = await this.ctx.templates.deliver(job.deviceId, extras.templates);
      if (!delivered.ok) {
        if (delivered.error.code === "ENV_AGENT_OFFLINE") {
          return { kind: "wait_agent", reason: "PREFLIGHT: panel uzildi (shablon fayli)" };
        }
        return { kind: "block", error: delivered.error };
      }
      if (delivered.data.files.length > 0) {
        await this.event(
          job,
          "info",
          "preflight.templates",
          `Shablon fayllari: ${delivered.data.files.join(", ")}`,
          { data: { files: delivered.data.files } },
        );
      }
    }

    // Lucide ikonkalari: SVG → PDF → panel `icons/` (kesh: bir xil fayl qayta yuborilmaydi).
    const icons = new Map<string, { name: string; color: string; stroke: number }>();
    for (const scene of spec.data.scenes) {
      for (const layer of scene.layers ?? []) {
        if (layer.type !== "icon") continue;
        icons.set(iconFile(layer.name, layer.color, layer.stroke_width), {
          name: layer.name,
          color: layer.color,
          stroke: layer.stroke_width,
        });
      }
    }
    for (const [dest, icon] of icons) {
      const svg = lucideSvg(icon.name, icon.color, icon.stroke);
      if (svg === null) {
        return {
          kind: "block",
          error: makeError("SPEC_INVALID", `Lucide ikonka topilmadi: ${icon.name} (icons_search)`),
        };
      }
      const sent = await this.publishBytes(
        job,
        dest,
        await lucidePdf(svg),
        "pdf",
        "application/pdf",
      );
      if (!sent.ok) {
        if (sent.error.code === "ENV_AGENT_OFFLINE") {
          return { kind: "wait_agent", reason: "PREFLIGHT: panel uzildi (ikonka)" };
        }
        return { kind: "block", error: sent.error };
      }
    }

    const hash = createHash("sha256").update(JSON.stringify(compiled.data.ops)).digest("hex");
    if (hash !== job.oplistHash) {
      await this.ctx.db.delete(ops).where(eq(ops.jobId, job.id));
      await this.ctx.db.insert(ops).values(
        compiled.data.ops.map((op, seq) => ({
          jobId: job.id,
          seq,
          opId: op.op_id,
          op: op.op,
          params: op.params,
        })),
      );
    }
    for (const warning of compiled.data.warnings) {
      await this.event(job, "warn", "preflight.warning", warning);
    }
    await this.event(
      job,
      "info",
      "preflight.ok",
      `PREFLIGHT: ${compiled.data.ops.length} op → ${projectPath}`,
      {
        data: {
          ops: compiled.data.ops.length,
          aep: projectPath,
          duration: compiled.data.duration,
          key_times: compiled.data.keyTimes,
          variants: compiled.data.variants,
          warnings: compiled.data.warnings,
        },
      },
    );
    return { kind: "next", set: { aepVersion: version, oplistHash: hash } };
  }

  /**
   * BUILD: oplar ketma-ket. Uzilish yoki retry'dan keyin oxirgi bajarilgan `project.save` dan keyingi
   * oplardan davom etadi (AE yopilgan bo'lsa saqlanmagan qism yo'qolgan; oplar idempotent, §2.5),
   * loyihani ochish opi esa avval qayta yuboriladi.
   */
  private async build(job: JobRow): Promise<Step> {
    if (job.deviceId === null) {
      return { kind: "block", error: makeError("AUTH_DEVICE_REVOKED", "Qurilma bekor qilingan") };
    }
    const folder = await this.ensureFolder(job, "BUILD");
    if (folder !== null) return folder;
    const rows = await this.ctx.db
      .select()
      .from(ops)
      .where(eq(ops.jobId, job.id))
      .orderBy(asc(ops.seq));
    if (rows.length === 0) return { kind: "next", to: "PREFLIGHT" };

    const firstOpen = rows.findIndex((row) => row.status !== "done");
    if (firstOpen === -1) return { kind: "next" };
    const interrupted = job.prevState === "WAITING_AGENT" || job.prevState === "BLOCKED";
    let start = firstOpen;
    if (interrupted) {
      let lastSave = -1;
      rows.forEach((row, index) => {
        if (index < firstOpen && row.op === "project.save" && row.status === "done")
          lastSave = index;
      });
      start = lastSave + 1;
    }
    const queue: OpRow[] = rows.slice(start);
    if (interrupted && start > 0 && rows[0]!.op === "project.open_or_create")
      queue.unshift(rows[0]!);
    if (interrupted) {
      await this.ctx.db
        .update(jobs)
        .set({ prevState: null })
        .where(and(eq(jobs.id, job.id), eq(jobs.state, "BUILD")));
      const from = rows[start] ?? queue[0]!;
      const reopen = queue[0] !== from ? "loyiha qayta ochiladi, " : "";
      await this.event(
        job,
        "info",
        "build.resume",
        `BUILD davom etadi: ${reopen}${from.opId} dan`,
        {
          opId: from.opId,
        },
      );
    }

    // Plan nusxasi ish papkasiga (har BUILD kirishida; bir xil tarkib — idempotent).
    const plan = await this.plan(job.projectId, job.planVersion);
    if (plan !== null) {
      const copied = await this.publish(
        job,
        planCopyPath(plan.version),
        `${JSON.stringify(plan.spec, null, 2)}\n`,
        "json",
      );
      if (!copied.ok && copied.error.code === "ENV_AGENT_OFFLINE") {
        return { kind: "wait_agent", reason: "BUILD: panel uzildi (plan nusxasi)" };
      }
    }

    const scenes = await this.sceneIds(job);
    const sceneOf = (row: OpRow): string | undefined => {
      const prefix = row.opId.split(".")[0]!;
      return scenes.has(prefix) ? prefix : undefined;
    };
    // P6.04: sahna oplari bitta evalScript'da (panel protokoli ≥ 2); eski panelga bittadan.
    const batched = (this.ctx.hub.state(job.deviceId)?.protocol ?? 1) >= BATCH_PROTOCOL_VERSION;
    const groups: OpRow[][] = [];
    for (const row of queue) {
      const last = groups.at(-1);
      if (
        batched &&
        last !== undefined &&
        last.length < MAX_BATCH_OPS &&
        sceneOf(last[0]!) === sceneOf(row)
      ) {
        last.push(row);
      } else {
        groups.push([row]);
      }
    }
    for (const group of groups) {
      const current = await this.get(job.id);
      if (current === null || current.state !== "BUILD") return { kind: "stale" };
      if (current.paused) return { kind: "hold" };
      const sceneId = sceneOf(group[0]!);
      const step = batched
        ? await this.buildBatch(current, job.deviceId, group, sceneId)
        : await this.buildOp(current, job.deviceId, group[0]!, sceneId);
      if (step !== null) return step;
    }
    const done = await this.get(job.id);
    if (done === null || done.state !== "BUILD") return { kind: "stale" };
    await this.event(job, "info", "build.done", `BUILD tugadi: ${rows.length} op`);
    return { kind: "next" };
  }

  private envelope(row: OpRow, sceneId: string | undefined): OpEnvelope {
    return makeOp(row.op as AeOpName, row.opId, row.seq, row.params as never, {
      ...(sceneId === undefined ? {} : { scene_id: sceneId }),
      timeout_ms: opTimeoutMs(row.op as AeOpName),
    }) as OpEnvelope;
  }

  private async opDone(row: OpRow, result: OpResultData, job?: JobRow): Promise<void> {
    await this.ctx.db
      .update(ops)
      .set({ status: "done", result, finishedAt: this.ctx.now() })
      .where(eq(ops.id, row.id));
    // Gibrid skript: natija (ok, result, error, line, ms) job log'iga; xato job'ni to'xtatmaydi.
    if (job !== undefined && row.op === "jsx.run") {
      const info = result.info ?? {};
      const good = info.ok !== false;
      const label = typeof info.label === "string" ? info.label : row.opId;
      const detail = good
        ? info.skipped === true
          ? "avval bajarilgan"
          : "ok"
        : `${String(info.error ?? "xato")}${typeof info.line === "number" ? ` (qator ${info.line})` : ""}`;
      await this.event(
        job,
        good ? "info" : "warn",
        "script.result",
        `${label}: ${detail}${typeof info.ms === "number" ? ` · ${info.ms} ms` : ""}`,
        { opId: row.opId, data: info },
      );
    }
  }

  /** Op xatosi: `failed`, hodisa va BLOCKED (sabab bilan). */
  private async opFailed(job: JobRow, row: OpRow, error: AesError): Promise<Step> {
    await this.ctx.db
      .update(ops)
      .set({ status: "failed", error, finishedAt: this.ctx.now() })
      .where(eq(ops.id, row.id));
    await this.event(job, "error", "op.failed", `${row.op}: ${error.code}`, {
      opId: row.opId,
      data: error,
    });
    return {
      kind: "block",
      error: { ...error, details: { op_id: row.opId, cause: error.details } },
    };
  }

  /** Eski panel (protokol 1): bitta op = bitta evalScript. null — davom etiladi. */
  private async buildOp(
    job: JobRow,
    deviceId: string,
    row: OpRow,
    sceneId: string | undefined,
  ): Promise<Step | null> {
    await this.ctx.db
      .update(ops)
      .set({ status: "running", startedAt: this.ctx.now(), error: null })
      .where(eq(ops.id, row.id));
    await this.notify(job, sceneId);
    const result = await this.ctx.hub.run(deviceId, this.envelope(row, sceneId), job.id);
    if (result.ok) {
      await this.opDone(row, result.data, job);
      await this.event(job, "debug", "op.done", `${row.op} ✓`, {
        opId: row.opId,
        data: { reused: result.data.reused },
      });
      return null;
    }
    if (result.error.code === "ENV_AGENT_OFFLINE") {
      await this.ctx.db.update(ops).set({ status: "pending" }).where(eq(ops.id, row.id));
      return { kind: "wait_agent", reason: `BUILD: panel uzildi (${row.opId})` };
    }
    return this.opFailed(job, row, result.error);
  }

  /**
   * Sahna batch'i (P6.04): oplar bitta `ops.batch` bilan, panel ularni bitta evalScript'da bajaradi.
   * Natija bo'yicha har op qatori yangilanadi; bajarilmaganlari `pending` qoladi (resume shu yerdan).
   */
  private async buildBatch(
    job: JobRow,
    deviceId: string,
    group: OpRow[],
    sceneId: string | undefined,
  ): Promise<Step | null> {
    await this.ctx.db
      .update(ops)
      .set({ status: "running", startedAt: this.ctx.now(), error: null })
      .where(
        inArray(
          ops.id,
          group.map((row) => row.id),
        ),
      );
    await this.notify(job, sceneId);
    const envelopes = group.map((row) => this.envelope(row, sceneId));
    const timeout = envelopes.reduce((sum, op) => sum + op.timeout_ms, 0);
    const reply = await this.ctx.hub.request(
      deviceId,
      {
        type: "ops.batch",
        request_id: randomUUID(),
        job_id: job.id,
        ...(sceneId === undefined ? {} : { scene_id: sceneId }),
        ops: envelopes,
      },
      Math.min(timeout, BATCH_TIMEOUT_CAP_MS) + BATCH_SLACK_MS,
    );
    const resetFrom = async (index: number) => {
      const rest = group.slice(index).map((row) => row.id);
      if (rest.length > 0) {
        await this.ctx.db.update(ops).set({ status: "pending" }).where(inArray(ops.id, rest));
      }
    };
    if (!reply.ok) {
      if (reply.error.code === "ENV_AGENT_OFFLINE") {
        await resetFrom(0);
        return { kind: "wait_agent", reason: `BUILD: panel uzildi (${sceneId ?? "asosiy"})` };
      }
      await resetFrom(1);
      return this.opFailed(job, group[0]!, reply.error);
    }
    if (reply.data.type !== "ops.batch.result") {
      await resetFrom(1);
      return this.opFailed(job, group[0]!, makeError("SYS_INTERNAL", "Kutilmagan batch javobi"));
    }
    const result = reply.data;
    let index = 0;
    for (const item of result.results) {
      const row = group[index];
      if (row === undefined || row.opId !== item.op_id) break;
      if (!item.ok) {
        await resetFrom(index + 1);
        return this.opFailed(job, row, item.error as AesError);
      }
      await this.opDone(row, item.result, job);
      index++;
    }
    if (index < group.length) {
      await resetFrom(index + 1);
      const error =
        (result.error as AesError | undefined) ??
        makeError("SYS_INTERNAL", `Batch to'liq bajarilmadi: ${index}/${group.length}`);
      return this.opFailed(job, group[index]!, error);
    }
    await this.event(
      job,
      "info",
      "scene.done",
      `${sceneId ?? "asosiy"}: ${group.length} op, ${result.duration_ms} ms`,
      { data: { scene_id: sceneId ?? null, ops: group.length, ms: result.duration_ms } },
    );
    return null;
  }

  private async report(job: JobRow): Promise<Step> {
    const project = await this.project(job.projectId);
    const plan = await this.plan(job.projectId, job.planVersion);
    const spec = plan === null ? null : parseSpec(plan.spec);
    const rows = await this.ctx.db
      .select({ status: ops.status })
      .from(ops)
      .where(eq(ops.jobId, job.id));
    const warnings = await this.ctx.db
      .select({ message: jobEvents.message })
      .from(jobEvents)
      .where(and(eq(jobEvents.jobId, job.id), inArray(jobEvents.type, ["preflight.warning"])));
    const outcome: JobOutcome = job.outcome ?? "success";
    const done = rows.filter((row) => row.status === "done").length;
    const markdown = buildReport({
      jobId: job.id,
      outcome,
      projectName: project?.name ?? "?",
      rootPath: project?.rootPath ?? "?",
      planVersion: job.planVersion,
      aepPath:
        project !== null && job.aepVersion !== null && done > 0
          ? aepPath(project, job.aepVersion)
          : null,
      mainComp: spec?.ok === true ? spec.data.output.name : null,
      spec: spec?.ok === true ? spec.data : null,
      ops: {
        total: rows.length,
        done,
        failed: rows.filter((row) => row.status === "failed").length,
      },
      renders: (await this.rendersOf(job.id))
        .filter((r) => r.status === "done")
        .reverse()
        .map((r) => ({
          path: r.localPath,
          duration_s: (r.durationMs ?? 0) / 1000,
          size_bytes: r.sizeBytes ?? 0,
          preset: r.preset,
        })),
      patchCount: job.patchCount,
      warnings: [...new Set(warnings.map((w) => w.message))],
      error: (job.error as AesError | null) ?? null,
      finishedAt: this.ctx.now().toISOString(),
    });
    await this.ctx.db
      .insert(reports)
      .values({ jobId: job.id, markdown, createdAt: this.ctx.now() });
    // Lokal nusxa — iloji bo'lsa (REPORT panelsiz ham tugaydi).
    const copy = reportCopyPath(job);
    const copied = await this.publish(job, copy, markdown, "md");
    await this.event(job, "info", "report.ready", "Hisobot tayyor", {
      data: { outcome, local_path: copied.ok ? copy : null },
    });
    return { kind: "next", set: { outcome, paused: false } };
  }

  // ------------------------------------------------------------------ AUDIO (P4.09)

  /** Oxirgi `audio.ready` natijasi (PREFLIGHT compile kontekstiga). */
  /** Loyihadagi shu plan versiyasi uchun oxirgi AUDIO natijasi (MCP preflight uchun). */
  async audioReadyFor(projectId: string, planVersion: number): Promise<CompileAudio | null> {
    const rows = await this.ctx.db
      .select({ data: jobEvents.data })
      .from(jobEvents)
      .innerJoin(jobs, eq(jobs.id, jobEvents.jobId))
      .where(and(eq(jobs.projectId, projectId), eq(jobEvents.type, "audio.ready")))
      .orderBy(desc(jobEvents.id))
      .limit(20);
    for (const row of rows) {
      const data = row.data as { compile?: CompileAudio; plan_version?: number } | null;
      if (data?.compile !== undefined && data.plan_version === planVersion) return data.compile;
    }
    return null;
  }

  private async audioReady(job: JobRow): Promise<CompileAudio | null> {
    const [row] = await this.ctx.db
      .select({ data: jobEvents.data })
      .from(jobEvents)
      .where(and(eq(jobEvents.jobId, job.id), eq(jobEvents.type, "audio.ready")))
      .orderBy(desc(jobEvents.id))
      .limit(1);
    const data = row?.data as { compile?: CompileAudio; plan_version?: number } | undefined;
    return data?.compile !== undefined && data.plan_version === job.planVersion
      ? data.compile
      : null;
  }

  /**
   * AUDIO (§3, §7.1): spec `audio` → vazifalar → kvota gate → bajarish (kesh) → panelga yetkazish.
   * Tartib: voiceover va boshqalar → TTS-first timing → musiqa (`match_video`). Har vazifa done yoki skipped(sabab).
   */
  private async audioStep(job: JobRow): Promise<Step> {
    const project = await this.project(job.projectId);
    const plan = await this.plan(job.projectId, job.planVersion);
    if (project === null || plan === null) {
      return { kind: "block", error: makeError("SPEC_INVALID", "Loyiha yoki plan yo'q") };
    }
    const spec = parseSpec(plan.spec);
    if (!spec.ok) return { kind: "block", error: spec.error };
    const dictionaries = await this.dictionaries(project.userId);
    const brandResult = await this.ctx.brands.resolve(project.userId, spec.data.brand);
    const brand = brandResult.ok ? brandResult.data : undefined;
    const items = planAudioTasks(spec.data, { videoDuration: null, dictionaries, brand });
    if (items.length === 0) {
      await this.event(job, "info", "audio.skipped", "AUDIO: spec'da ElevenLabs vazifasi yo'q");
      if (spec.data.audio !== undefined) {
        await this.event(job, "info", "audio.ready", "AUDIO: tayyor fayllar ishlatiladi", {
          data: { plan_version: job.planVersion, compile: {} },
        });
      }
      return { kind: "next" };
    }
    if (job.deviceId === null) {
      return { kind: "block", error: makeError("AUTH_DEVICE_REVOKED", "Qurilma bekor qilingan") };
    }
    if (!this.ctx.hub.isOnline(job.deviceId)) {
      return { kind: "wait_agent", reason: "AUDIO: panel ulanmagan" };
    }

    // Kvota gate (§7.1): taxminiy narx qolgan kvotadan oshsa — ask_user.
    const assetRows = await this.ctx.db
      .select()
      .from(assets)
      .where(eq(assets.projectId, project.id));
    const inputSeconds = (key?: string) => {
      const meta = assetRows.find((row) => row.key === key)?.meta as
        { duration?: number } | undefined;
      return typeof meta?.duration === "number" ? meta.duration : null;
    };
    // Keshdagi vazifalar kredit sarflamaydi (#8): gate faqat yangi generatsiyalarni hisoblaydi.
    const cachedFlags = await cacheFlags(
      this.ctx.db,
      items.map((item) => ({
        kind: item.kind,
        params: item.params,
        hasInput: item.inputAsset !== undefined,
      })),
    );
    const estimate = items.reduce(
      (sum, item, i) =>
        sum +
        (cachedFlags[i] === true
          ? 0
          : estimateCredits({
              kind: item.kind,
              params: item.params,
              inputSeconds: inputSeconds(item.inputAsset),
            })),
      0,
    );
    const account = await this.ctx.eleven.account(project.userId);
    if (account.remaining !== null && estimate > account.remaining) {
      return {
        kind: "block",
        error: makeError(
          "EL_QUOTA",
          `Taxminiy ${estimate} kredit, qolgan ${account.remaining}: foydalanuvchidan so'rang (ask_user)`,
          { estimate, remaining: account.remaining, ask_user: true },
        ),
      };
    }
    await this.event(
      job,
      "info",
      "audio.started",
      `AUDIO: ${items.length} vazifa (~${estimate} kredit)`,
      {
        data: { items: items.map((item) => ({ role: item.role, kind: item.kind })), estimate },
      },
    );

    const runItems = async (list: AudioPlanItem[]): Promise<Map<string, AudioTaskRow> | Step> => {
      const submitted: { item: AudioPlanItem; id: string }[] = [];
      for (const item of list) {
        let inputs: InputRef[] = [];
        if (item.inputAsset !== undefined) {
          const asset = assetRows.find((row) => row.key === item.inputAsset);
          if (asset === undefined || asset.status !== "ok") {
            return {
              kind: "block",
              error: makeError(
                "SPEC_UNKNOWN_ASSET",
                `/audio: asset:${item.inputAsset} yo'q yoki yaroqsiz`,
              ),
            };
          }
          const input = await extractInput(this.ctx, project, asset.localPath);
          if (!input.ok) {
            if (input.error.code === "ENV_AGENT_OFFLINE") {
              return { kind: "wait_agent", reason: "AUDIO: panel uzildi (ovoz ajratish)" };
            }
            return { kind: "block", error: input.error };
          }
          inputs = [input.data];
        }
        const task = await this.ctx.audio.submit({
          userId: project.userId,
          projectId: project.id,
          jobId: job.id,
          kind: item.kind,
          label: item.label,
          params: item.params,
          inputs,
        });
        if (!task.ok) return { kind: "block", error: task.error };
        submitted.push({ item, id: task.data.id });
      }
      const results = new Map<string, AudioTaskRow>();
      for (const { item, id } of submitted) {
        const task = await this.ctx.audio.wait(id, 30 * 60_000);
        if (task === null || task.status !== "done") {
          const error =
            (task?.error as AesError | null) ?? makeError("EL_TIMEOUT", `${item.label} tugamadi`);
          if (item.role.startsWith("sfx:")) {
            if (task !== null) await this.ctx.audio.skip(task.id, `${item.label}: ${error.code}`);
            await this.event(
              job,
              "warn",
              "audio.skipped_item",
              `${item.label} o'tkazib yuborildi: ${error.code}`,
              {
                data: error,
              },
            );
            continue;
          }
          return {
            kind: "block",
            error: { ...error, details: { task_id: id, role: item.role, cause: error.details } },
          };
        }
        results.set(item.role, task);
      }
      return results;
    };

    const first = await runItems(items.filter((item) => item.afterTiming !== true));
    if (!(first instanceof Map)) return first;

    // TTS-first timing: voiceover so'zlari → video uzunligi (musiqa uchun).
    const vo = first.get("voiceover") ?? first.get("vo_align");
    const voWords = vo === undefined ? null : wordsOfTask(vo);
    const timing = planTiming(
      spec.data,
      vo === undefined
        ? null
        : { words: voWords ?? [], duration: vo.durationMs === null ? null : vo.durationMs / 1000 },
    );
    if (!timing.ok) return { kind: "block", error: timing.error };
    const later = planAudioTasks(spec.data, {
      videoDuration: timing.data.total,
      dictionaries,
      brand,
    }).filter((item) => item.afterTiming === true);
    const second = await runItems(later);
    if (!(second instanceof Map)) return second;
    const all = new Map([...first, ...second]);

    // Panelga yetkazish (fayllar ish papkasida bo'lishi shart).
    for (const task of all.values()) {
      if (task.storageKey === null) continue;
      await this.ctx.audio.deliver(task);
      const fresh = await this.ctx.audio.get(task.id);
      if (fresh?.localPath == null) {
        if (!this.ctx.hub.isOnline(job.deviceId)) {
          return { kind: "wait_agent", reason: "AUDIO: panel uzildi (fayl yetkazish)" };
        }
        return {
          kind: "block",
          error: makeError("SYS_INTERNAL", `${task.label ?? task.kind}: panelga yetkazilmadi`),
        };
      }
      all.set([...all.entries()].find(([, t]) => t.id === task.id)![0], fresh);
    }

    const compileAudio: CompileAudio = {};
    if (vo !== undefined) {
      const voTask = all.get(vo.kind === "align" ? "vo_align" : "voiceover")!;
      if (voTask.kind === "align") {
        // Tayyor asset ovoz: so'zlar alignment'dan, fayl — asset'ning o'zi (compiler asset sifatida qo'yadi).
        compileAudio.voiceover = { file: "", words: voWords ?? [], duration: null };
      } else {
        compileAudio.voiceover = {
          file: voTask.localPath!,
          words: voWords ?? [],
          duration: voTask.durationMs === null ? null : voTask.durationMs / 1000,
        };
      }
    }
    const musicTask = all.get("music");
    if (musicTask?.localPath != null) compileAudio.music = { file: musicTask.localPath };
    const sfx: Record<string, { file: string }> = {};
    for (const [role, task] of all) {
      if (role.startsWith("sfx:") && task.localPath !== null)
        sfx[role.slice(4)] = { file: task.localPath };
    }
    if (Object.keys(sfx).length > 0) compileAudio.sfx = sfx;
    const isolated = all.get("source_isolate");
    const stt = all.get("source_stt");
    if (isolated !== undefined || stt !== undefined) {
      compileAudio.source = {
        ...(isolated?.localPath != null ? { isolatedFile: isolated.localPath } : {}),
        ...(stt !== undefined ? { words: wordsOfTask(stt) } : {}),
      };
    }
    const cached = [...all.values()].filter((task) => task.cached).length;
    await this.event(
      job,
      "info",
      "audio.ready",
      `AUDIO tayyor: ${all.size} fayl${cached > 0 ? ` (${cached} tasi keshdan)` : ""}, video ${timing.data.total} s`,
      {
        data: {
          plan_version: job.planVersion,
          compile: compileAudio,
          tasks: [...all.entries()].map(([role, task]) => ({
            role,
            id: task.id,
            cached: task.cached,
          })),
          duration: timing.data.total,
        },
      },
    );
    return { kind: "next" };
  }

  private async dictionaries(userId: string): Promise<Record<string, PronunciationLocator>> {
    const rows = await this.ctx.db
      .select()
      .from(pronunciationDicts)
      .where(eq(pronunciationDicts.userId, userId));
    return Object.fromEntries(
      rows.map((row) => [
        row.slug,
        { pronunciation_dictionary_id: row.elId, version_id: row.versionId },
      ]),
    );
  }

  // ------------------------------------------------------------------ RENDER (P3.07)

  private async renderStep(job: JobRow): Promise<Step> {
    if (job.deviceId === null) {
      return { kind: "block", error: makeError("AUTH_DEVICE_REVOKED", "Qurilma bekor qilingan") };
    }
    if (!this.ctx.hub.isOnline(job.deviceId)) {
      return { kind: "wait_agent", reason: "RENDER: panel ulanmagan" };
    }
    const folder = await this.ensureFolder(job, "RENDER");
    if (folder !== null) return folder;
    // Asosiy format va har variant alohida render qilinadi (§11.4.1); bajarilganlari qayta qilinmaydi.
    const done = new Set(
      (await this.rendersOf(job.id))
        .filter((r) => r.status === "done" && r.aepVersion === job.aepVersion)
        .map((r) => r.variant ?? ""),
    );
    for (const variant of [null, ...(await this.variants(job.id))]) {
      if (done.has(variant?.tag ?? "")) continue;
      const result = await this.render(job, undefined, variant ?? undefined);
      if (!result.ok) {
        if (result.error.code === "ENV_AGENT_OFFLINE") {
          return { kind: "wait_agent", reason: "RENDER: panel uzildi" };
        }
        return { kind: "block", error: result.error };
      }
    }
    const current = await this.get(job.id);
    if (current === null || current.state !== "RENDER") return { kind: "stale" };
    return { kind: "next" };
  }

  /** Kutilgan davomiylik: PREFLIGHT natijasidan (compile), bo'lmasa sahnalar yig'indisi. */
  private async expectedDuration(job: JobRow, spec: VideoSpec): Promise<number> {
    const [row] = await this.ctx.db
      .select({ data: jobEvents.data })
      .from(jobEvents)
      .where(and(eq(jobEvents.jobId, job.id), eq(jobEvents.type, "preflight.ok")))
      .orderBy(desc(jobEvents.id))
      .limit(1);
    const fromPreflight = (row?.data as { duration?: unknown } | null)?.duration;
    if (typeof fromPreflight === "number") return fromPreflight;
    return spec.scenes.reduce(
      (sum, scene) => sum + (typeof scene.dur === "number" ? scene.dur : 0),
      0,
    );
  }

  /**
   * Bitta render: `renders` qatori → panelga `render.request` → gate (fayl bor, davomiylik ±1 kadr).
   * Job holatini o'zgartirmaydi (RENDER handler ham, qayta render ham ishlatadi).
   */
  async render(
    job: JobRow,
    presetOverride?: OutputPreset,
    variant?: CompiledVariant,
  ): Promise<Result<typeof renders.$inferSelect>> {
    const project = await this.project(job.projectId);
    const plan = await this.plan(job.projectId, job.planVersion);
    if (project === null || plan === null || job.aepVersion === null || job.deviceId === null) {
      return fail("JOB_BAD_ACTION", "Job hali qurilmagan");
    }
    const spec = parseSpec(plan.spec);
    if (!spec.ok) return spec;
    const preset = presetOverride ?? spec.data.output.preset;
    const fps = spec.data.format.fps;
    const expected = await this.expectedDuration(job, spec.data);
    const name = variant?.name ?? spec.data.output.name;
    const outBase = `out/${fileBase(name)}_v${pad3(job.aepVersion)}`;
    const [row] = await this.ctx.db
      .insert(renders)
      .values({
        jobId: job.id,
        preset,
        variant: variant?.tag ?? null,
        aepVersion: job.aepVersion,
        localPath: `${outBase}.mp4`,
        status: "running",
        createdAt: this.ctx.now(),
        updatedAt: this.ctx.now(),
      })
      .returning();
    await this.event(job, "info", "render.started", `RENDER: ${preset} → ${outBase}.mp4`, {
      data: { render_id: row!.id, preset },
    });
    const finish = async (set: Partial<typeof renders.$inferInsert>) => {
      const [updated] = await this.ctx.db
        .update(renders)
        .set({ ...set, updatedAt: this.ctx.now() })
        .where(eq(renders.id, row!.id))
        .returning();
      return updated!;
    };
    const reply = await this.ctx.hub.request(
      job.deviceId,
      {
        type: "render.request",
        request_id: randomUUID(),
        job_id: job.id,
        project_path: aepPath(project, job.aepVersion),
        comp: { op_id: variant?.mainComp ?? MAIN_COMP, name },
        out_base: outBase,
        preset,
        fps,
        duration: expected,
      },
      Math.max(30 * 60_000, expected * 180_000 + 10 * 60_000),
    );
    if (!reply.ok || reply.data.type !== "render.done") {
      const error = reply.ok ? makeError("SYS_INTERNAL", "Kutilmagan javob") : reply.error;
      await finish({ status: "failed", error });
      await this.event(job, "error", "render.failed", `RENDER: ${error.code}`, { data: error });
      return { ok: false, error };
    }
    const done = reply.data;
    const base = {
      localPath: done.out,
      durationMs: Math.round(done.duration * 1000),
      sizeBytes: done.size,
      method: done.method,
      encoder: done.encoder,
    };
    if (!durationMatches(done.duration, expected, fps)) {
      const error = makeError(
        "RENDER_DURATION_MISMATCH",
        `Render ${done.duration.toFixed(3)} s, spec ${expected.toFixed(3)} s (±1 kadr)`,
        { actual: done.duration, expected, fps, out: done.out },
      );
      await finish({ ...base, status: "failed", error });
      await this.event(job, "error", "render.failed", `RENDER: ${error.message}`, { data: error });
      return { ok: false, error };
    }
    const saved = await finish({ ...base, status: "done", error: null });
    await this.event(job, "info", "render.done", `RENDER tayyor: ${done.out}`, {
      data: { render_id: saved.id, ...base },
    });
    return ok(saved);
  }

  /** Qayta render (DONE job, Tarix ekrani / MCP render_start): fonda ishlaydi. */
  async renderAgain(jobId: string, preset?: OutputPreset): Promise<Result<{ started: true }>> {
    const job = await this.get(jobId);
    if (job === null) return fail("SYS_NOT_FOUND", "Job topilmadi");
    if (job.state !== "DONE" || job.aepVersion === null) {
      return fail("JOB_BAD_ACTION", "Qayta render faqat qurilgan va yakunlangan job uchun");
    }
    if (job.deviceId === null || !this.ctx.hub.isOnline(job.deviceId)) {
      return fail("ENV_AGENT_OFFLINE", "Panel ulanmagan");
    }
    const [running] = await this.ctx.db
      .select({ id: renders.id })
      .from(renders)
      .where(and(eq(renders.jobId, job.id), eq(renders.status, "running")))
      .limit(1);
    if (running !== undefined) {
      return fail("JOB_BAD_ACTION", "Bu job uchun render allaqachon ketmoqda");
    }
    // Asosiy format va barcha variantlar ketma-ket (birinchi xatoda to'xtaydi).
    const variants = await this.variants(job.id);
    const task: Promise<unknown> = (async () => {
      for (const variant of [undefined, ...variants]) {
        const res = await this.render(job, preset, variant);
        if (!res.ok) return;
      }
    })().catch((error: unknown) =>
      this.log.error({ err: error, job: job.id }, "qayta render xatosi"),
    );
    this.background.add(task);
    void task.finally(() => this.background.delete(task));
    return ok({ started: true });
  }

  async rendersOf(jobId: string) {
    return this.ctx.db
      .select()
      .from(renders)
      .where(eq(renders.jobId, jobId))
      .orderBy(desc(renders.createdAt));
  }

  // ------------------------------------------------------------------ yordamchilar

  /**
   * Matn faylini ish papkasiga yozdiradi: storage (`docs/<sha256>`) → presigned GET → panel `file.download`.
   * Panel mavjud faylni boshqa tarkib bilan almashtirmaydi. Xato job'ni to'xtatmaydi (ogohlantirish).
   */
  private async publish(
    job: JobRow,
    dest: string,
    content: string,
    ext: "json" | "md",
  ): Promise<Result<{ dest: string }>> {
    return this.publishBytes(
      job,
      dest,
      Buffer.from(content, "utf8"),
      ext,
      ext === "json" ? "application/json" : "text/markdown; charset=utf-8",
    );
  }

  private async publishBytes(
    job: JobRow,
    dest: string,
    data: Buffer,
    ext: string,
    contentType: string,
  ): Promise<Result<{ dest: string }>> {
    const project = await this.project(job.projectId);
    if (project === null || job.deviceId === null) return fail("SYS_NOT_FOUND", "Loyiha yo'q");
    if (!this.ctx.hub.isOnline(job.deviceId)) return fail("ENV_AGENT_OFFLINE", "Panel ulanmagan");
    const sha256 = createHash("sha256").update(data).digest("hex");
    const key = storageKey({
      userId: project.userId,
      projectId: project.id,
      kind: "docs",
      hash: sha256,
      ext,
    });
    if ((await this.ctx.storage.head(key)) === null) {
      await this.ctx.storage.putBytes(key, data, contentType);
    }
    const reply = await this.ctx.hub.request(
      job.deviceId,
      {
        type: "file.download",
        request_id: randomUUID(),
        url: await this.ctx.storage.presignGet(key),
        sha256,
        dest,
        size: data.length,
      },
      COPY_TIMEOUT_MS,
    );
    if (!reply.ok) {
      await this.event(job, "warn", "file.copy_failed", `${dest}: ${reply.error.code}`, {
        data: reply.error,
      });
      return reply;
    }
    await this.event(job, "debug", "file.saved", `${dest} saqlandi`, { data: { dest, sha256 } });
    return ok({ dest });
  }

  private async project(projectId: string): Promise<ProjectRow | null> {
    const [row] = await this.ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return row ?? null;
  }

  async plan(projectId: string, version?: number) {
    const [row] = await this.ctx.db
      .select()
      .from(plans)
      .where(
        version === undefined
          ? eq(plans.projectId, projectId)
          : and(eq(plans.projectId, projectId), eq(plans.version, version)),
      )
      .orderBy(desc(plans.version))
      .limit(1);
    return row ?? null;
  }

  /** Loyihadagi keyingi `.aep` versiyasi: avvalgi joblar ajratganlaridan katta (hech biri ustiga yozilmaydi). */
  async nextAepVersion(projectId: string): Promise<number> {
    const [row] = await this.ctx.db
      .select({ version: max(jobs.aepVersion) })
      .from(jobs)
      .where(eq(jobs.projectId, projectId));
    return (row?.version ?? 0) + 1;
  }

  private async sceneIds(job: JobRow): Promise<Set<string>> {
    const plan = await this.plan(job.projectId, job.planVersion);
    const spec = plan === null ? null : parseSpec(plan.spec);
    return new Set(spec?.ok === true ? spec.data.scenes.map((scene) => scene.id) : []);
  }
}
