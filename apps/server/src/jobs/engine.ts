/**
 * Job holat mashinasi (§3): CHECK → PLAN → INGEST → AUDIO → PREFLIGHT → BUILD → VERIFY → RENDER → REPORT → DONE.
 *
 * - Yagona haqiqat manbai `jobs` + `job_events` + `ops` (§2.1). Server qayta ishga tushsa `recover()` davom ettiradi.
 * - Har o'tish compare-and-set (`WHERE state = <eski>`): amal (cancel, pause) ishlab turgan handler bilan to'qnashmaydi.
 * - Xato → `BLOCKED` (retry | patch | ask_user | cancel); panel yo'q → `WAITING_AGENT`, `hello` kelganda `prev_state` ga qaytadi.
 * - Vaqtincha: AUDIO → skipped (Faza 4), VERIFY → qo'lda approve (Faza 3), RENDER → skipped (Faza 3).
 */
import { createHash, randomUUID } from "node:crypto";
import { compile } from "@aes/compiler";
import type { CompileAsset } from "@aes/compiler";
import { MAX_PATCHES, fail, makeError, makeOp, ok, opTimeoutMs, parseSpec } from "@aes/shared";
import type {
  AeOpName,
  AesError,
  JobAction,
  JobOutcome,
  JobState,
  LogLevel,
  OpEnvelope,
  Result,
  VideoSpec,
} from "@aes/shared";
import { and, asc, desc, eq, inArray, max, ne, notInArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { applyScan } from "../assets/routes";
import type { AppContext } from "../context";
import { assets, jobEvents, jobs, ops, plans, projects, reports } from "../db/schema";
import { normalizeRootPath } from "../projects/routes";
import { storageKey } from "../storage";
import { buildReport, pad3 } from "./report";
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
const CHECK_PING_TIMEOUT_MS = 15_000;
/** Bitta drive siklidagi holatlar soni chegarasi (cheksiz aylanishdan himoya). */
const MAX_STEPS = 64;

export type EngineContext = Pick<AppContext, "db" | "hub" | "now" | "storage">;

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
    while (this.driving.size > 0) await Promise.all([...this.driving.values()]);
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

  async create(input: { projectId: string; planVersion?: number }): Promise<Result<JobRow>> {
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
    input: { spec?: unknown } = {},
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
      case "approve":
        updated = await this.transition(job, { state: "RENDER", prevState: null });
        if (updated !== null)
          await this.event(job, "info", "verify.approved", "VERIFY tasdiqlandi");
        break;
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
      state: "PREFLIGHT",
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
    const result = await this.ctx.hub.run(
      job.deviceId,
      makeOp("undo", `undo.${last.opId}`.slice(0, 128), 0, { op_id: last.opId }),
      job.id,
    );
    if (!result.ok) return result;
    await this.ctx.db
      .update(ops)
      .set({ status: "pending", result: null, finishedAt: null })
      .where(eq(ops.id, last.id));
    await this.event(job, "info", "op.undone", `↩ ${last.op} bekor qilindi`, { opId: last.opId });
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
          await this.event(job, "info", "audio.skipped", "AUDIO: Faza 4 gacha o'tkazib yuboriladi");
          return { kind: "next" };
        case "PREFLIGHT":
          return await this.preflight(job);
        case "BUILD":
          return await this.build(job);
        case "VERIFY":
          await this.event(
            job,
            "info",
            "verify.waiting",
            "VERIFY: AE'da natijani ko'rib tasdiqlang (approve) yoki patch yuboring",
          );
          return { kind: "hold" };
        case "RENDER":
          await this.event(job, "info", "render.skipped", "RENDER: Faza 3 da qo'shiladi");
          return { kind: "next" };
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

  private async check(job: JobRow): Promise<Step> {
    const project = await this.project(job.projectId);
    if (project === null)
      return { kind: "block", error: makeError("SYS_NOT_FOUND", "Loyiha yo'q") };
    if (job.deviceId === null) {
      return { kind: "block", error: makeError("AUTH_DEVICE_REVOKED", "Qurilma bekor qilingan") };
    }
    const agent = this.ctx.hub.state(job.deviceId);
    if (agent === null) return { kind: "wait_agent", reason: "CHECK: panel ulanmagan" };
    const root = agent.projectRoot === null ? null : normalizeRootPath(agent.projectRoot);
    if (root !== project.rootPath) {
      return {
        kind: "block",
        error: makeError(
          "ENV_NO_FOLDER",
          `Panelda ${root === null ? "papka ochilmagan" : `boshqa papka ochiq: ${root}`}; kerak: ${project.rootPath}`,
        ),
      };
    }
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
    const version = job.aepVersion ?? (await this.nextAepVersion(project.id));
    const projectPath = aepPath(project, version);
    const compiled = compile(spec.data, { assets: assetMap, projectPath, version });
    if (!compiled.ok) return { kind: "block", error: compiled.error };

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
    for (const row of queue) {
      const current = await this.get(job.id);
      if (current === null || current.state !== "BUILD") return { kind: "stale" };
      if (current.paused) return { kind: "hold" };

      const sceneId = scenes.has(row.opId.split(".")[0]!) ? row.opId.split(".")[0] : undefined;
      await this.ctx.db
        .update(ops)
        .set({ status: "running", startedAt: this.ctx.now(), error: null })
        .where(eq(ops.id, row.id));
      await this.notify(current, sceneId);

      const envelope = makeOp(row.op as AeOpName, row.opId, row.seq, row.params as never, {
        ...(sceneId === undefined ? {} : { scene_id: sceneId }),
        timeout_ms: opTimeoutMs(row.op as AeOpName),
      }) as OpEnvelope;
      const result = await this.ctx.hub.run(job.deviceId, envelope, job.id);
      if (result.ok) {
        await this.ctx.db
          .update(ops)
          .set({ status: "done", result: result.data, finishedAt: this.ctx.now() })
          .where(eq(ops.id, row.id));
        await this.event(job, "debug", "op.done", `${row.op} ✓`, {
          opId: row.opId,
          data: { reused: result.data.reused },
        });
        continue;
      }
      if (result.error.code === "ENV_AGENT_OFFLINE") {
        await this.ctx.db.update(ops).set({ status: "pending" }).where(eq(ops.id, row.id));
        return { kind: "wait_agent", reason: `BUILD: panel uzildi (${row.opId})` };
      }
      await this.ctx.db
        .update(ops)
        .set({ status: "failed", error: result.error, finishedAt: this.ctx.now() })
        .where(eq(ops.id, row.id));
      await this.event(job, "error", "op.failed", `${row.op}: ${result.error.code}`, {
        opId: row.opId,
        data: result.error,
      });
      return {
        kind: "block",
        error: { ...result.error, details: { op_id: row.opId, cause: result.error.details } },
      };
    }
    const done = await this.get(job.id);
    if (done === null || done.state !== "BUILD") return { kind: "stale" };
    await this.event(job, "info", "build.done", `BUILD tugadi: ${rows.length} op`);
    return { kind: "next" };
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
    const project = await this.project(job.projectId);
    if (project === null || job.deviceId === null) return fail("SYS_NOT_FOUND", "Loyiha yo'q");
    if (!this.ctx.hub.isOnline(job.deviceId)) return fail("ENV_AGENT_OFFLINE", "Panel ulanmagan");
    const data = Buffer.from(content, "utf8");
    const sha256 = createHash("sha256").update(data).digest("hex");
    const key = storageKey({
      userId: project.userId,
      projectId: project.id,
      kind: "docs",
      hash: sha256,
      ext,
    });
    if ((await this.ctx.storage.head(key)) === null) {
      await this.ctx.storage.putBytes(
        key,
        data,
        ext === "json" ? "application/json" : "text/markdown; charset=utf-8",
      );
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
