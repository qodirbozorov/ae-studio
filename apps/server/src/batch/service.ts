/**
 * Batch (§11.4.3): shablon + CSV → N ta video. Har qator — alohida plan va job (`auto_approve`), ketma-ket
 * (qurilmada bitta aktiv job). Qatorlar oldindan tekshiriladi; job BLOCKED bo'lsa qator `failed` (job bekor
 * qilinadi) va keyingisiga o'tiladi. Holat `batches.items` da; server qayta ishga tushsa `recover()` davom ettiradi.
 */
import { fail, ok } from "@aes/shared";
import type { AesError, Aspect, Result } from "@aes/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../context";
import { batches, projects } from "../db/schema";
import type { JobEngine, JobRow } from "../jobs/engine";
import { applyTemplate } from "../templates/apply";
import { parseCsv } from "./csv";

export type BatchItemStatus = "pending" | "running" | "done" | "failed";

export interface BatchItem {
  row: number;
  name: string;
  slots: Record<string, string>;
  status: BatchItemStatus;
  job_id?: string;
  error?: { code: string; message?: string };
  outputs?: string[];
}

export interface BatchInput {
  projectId: string;
  template: string;
  csv: string;
  /** Ustun → slot (berilmasa ustun nomi = slot nomi). `name` ustuni — fayl nomi. */
  mapping?: Record<string, string> | undefined;
  format?: Aspect | undefined;
  variants?: Aspect[] | undefined;
  dur?: number | undefined;
  brand?: string | undefined;
}

export type BatchRow = typeof batches.$inferSelect;

export interface BatchListener {
  finished?(batch: BatchRow): void;
}

function fileName(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : fallback;
}

export class BatchService {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly listeners = new Set<BatchListener>();
  private stopped = false;

  constructor(
    private readonly ctx: Pick<AppContext, "db" | "now" | "templates">,
    private readonly engine: JobEngine,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Job yakunlansa tegishli batch'ni (va qurilma bo'shasa boshqalarini) davom ettiradi. */
  attach(): void {
    this.engine.listen({
      update: (job) => {
        if (job.state === "BLOCKED" && job.batchId !== null) {
          void this.onBlocked(job);
          return;
        }
        if (job.state !== "DONE") return;
        if (job.batchId !== null) this.kick(job.batchId);
        void this.kickRunning();
      },
    });
  }

  listen(listener: BatchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stop(): void {
    this.stopped = true;
  }

  async idle(): Promise<void> {
    while (this.chains.size > 0) await Promise.all([...this.chains.values()]);
  }

  async recover(): Promise<number> {
    const running = await this.ctx.db.select().from(batches).where(eq(batches.status, "running"));
    for (const batch of running) this.kick(batch.id);
    return running.length;
  }

  async get(userId: string, batchId: string): Promise<BatchRow | null> {
    const [row] = await this.ctx.db
      .select()
      .from(batches)
      .where(and(eq(batches.id, batchId), eq(batches.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async listForProject(userId: string, projectId: string): Promise<BatchRow[]> {
    return this.ctx.db
      .select()
      .from(batches)
      .where(and(eq(batches.userId, userId), eq(batches.projectId, projectId)));
  }

  /** CSV'ni tekshiradi, batch yaratadi va ishga tushiradi. Xato qatorlar bo'lsa hech narsa boshlanmaydi. */
  async start(userId: string, input: BatchInput): Promise<Result<BatchRow>> {
    const [project] = await this.ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.userId, userId)))
      .limit(1);
    if (project === undefined) return fail("SYS_NOT_FOUND", "Loyiha topilmadi");
    const entry = await this.ctx.templates.get(userId, input.template);
    if (entry === null) {
      return fail("SPEC_UNKNOWN_TEMPLATE", `'${input.template}' shabloni topilmadi`);
    }
    const table = parseCsv(input.csv);
    if (!table.ok) return table;
    const mapping =
      input.mapping ??
      Object.fromEntries(
        table.data.header.filter((h) => entry.manifest.slots[h] !== undefined).map((h) => [h, h]),
      );
    for (const [column, slot] of Object.entries(mapping)) {
      if (!table.data.header.includes(column)) {
        return fail("SYS_BAD_REQUEST", `CSV'da '${column}' ustuni yo'q`, {
          columns: table.data.header,
        });
      }
      if (entry.manifest.slots[slot] === undefined) {
        return fail("SYS_BAD_REQUEST", `'${input.template}' shablonida '${slot}' sloti yo'q`, {
          slots: Object.keys(entry.manifest.slots),
        });
      }
    }
    const items: BatchItem[] = [];
    const problems: { row: number; message: string }[] = [];
    const names = new Set<string>();
    for (const [index, record] of table.data.rows.entries()) {
      const row = index + 1;
      const slots: Record<string, string> = {};
      for (const [column, slot] of Object.entries(mapping)) {
        const value = record[column] ?? "";
        if (value !== "") slots[slot] = value;
      }
      let name = fileName(record.name ?? "", `${input.template}_${String(row).padStart(3, "0")}`);
      while (names.has(name)) name = `${name}_${row}`;
      names.add(name);
      const check = applyTemplate(entry, null, {
        slots,
        dur: input.dur,
        mode: "new",
        aspect: input.format,
        outputName: name,
      });
      if (!check.ok) problems.push({ row, message: check.error.message ?? check.error.code });
      items.push({ row, name, slots, status: "pending" });
    }
    if (problems.length > 0) {
      return fail(
        "SPEC_INVALID",
        `CSV: ${problems.length} qatorda xato (${problems
          .slice(0, 3)
          .map((p) => `${p.row}: ${p.message}`)
          .join("; ")})`,
        { rows: problems },
      );
    }
    const [batch] = await this.ctx.db
      .insert(batches)
      .values({
        userId,
        projectId: project.id,
        template: input.template,
        options: {
          ...(input.format === undefined ? {} : { format: input.format }),
          ...(input.variants === undefined ? {} : { variants: input.variants }),
          ...(input.dur === undefined ? {} : { dur: input.dur }),
          ...(input.brand === undefined ? {} : { brand: input.brand }),
        },
        items,
        status: "running",
      })
      .returning();
    this.kick(batch!.id);
    return ok(batch!);
  }

  async cancel(userId: string, batchId: string): Promise<Result<BatchRow>> {
    const batch = await this.get(userId, batchId);
    if (batch === null) return fail("SYS_NOT_FOUND", "Batch topilmadi");
    if (batch.status !== "running") return ok(batch);
    const items = (batch.items as BatchItem[]).map((item) =>
      item.status === "pending"
        ? {
            ...item,
            status: "failed" as const,
            error: { code: "JOB_CANCELLED", message: "Batch bekor qilindi" },
          }
        : item,
    );
    const updated = await this.save(batch.id, items, "cancelled");
    const running = items.find((item) => item.status === "running");
    if (running?.job_id !== undefined) await this.engine.act(running.job_id, "cancel");
    return ok(updated);
  }

  private kick(batchId: string): void {
    if (this.stopped) return;
    const previous = this.chains.get(batchId) ?? Promise.resolve();
    const next = previous
      .then(() => this.advance(batchId))
      .catch((error: unknown) => this.log.error({ err: error, batch: batchId }, "batch xatosi"));
    this.chains.set(batchId, next);
    void next.finally(() => {
      if (this.chains.get(batchId) === next) this.chains.delete(batchId);
    });
  }

  private async kickRunning(): Promise<void> {
    const running = await this.ctx.db
      .select({ id: batches.id })
      .from(batches)
      .where(eq(batches.status, "running"));
    for (const batch of running) this.kick(batch.id);
  }

  private async save(batchId: string, items: BatchItem[], status?: string): Promise<BatchRow> {
    const [row] = await this.ctx.db
      .update(batches)
      .set({ items, ...(status === undefined ? {} : { status }), updatedAt: this.ctx.now() })
      .where(eq(batches.id, batchId))
      .returning();
    return row!;
  }

  /** BLOCKED qator: xato saqlanadi, job bekor qilinadi (keyingi qatorga yo'l ochiladi). */
  private async onBlocked(job: JobRow): Promise<void> {
    const [batch] = await this.ctx.db
      .select()
      .from(batches)
      .where(eq(batches.id, job.batchId!))
      .limit(1);
    if (batch === undefined) return;
    const error = job.error as AesError | null;
    const items = (batch.items as BatchItem[]).map((item) =>
      item.job_id === job.id && error !== null
        ? {
            ...item,
            error: {
              code: error.code,
              ...(error.message === undefined ? {} : { message: error.message }),
            },
          }
        : item,
    );
    await this.save(batch.id, items);
    await this.engine.act(job.id, "cancel");
  }

  private async advance(batchId: string): Promise<void> {
    const [batch] = await this.ctx.db
      .select()
      .from(batches)
      .where(eq(batches.id, batchId))
      .limit(1);
    if (batch === undefined || batch.status !== "running") return;
    const items = [...(batch.items as BatchItem[])];

    // Yugurayotgan qator yakunlanganmi?
    const runningIndex = items.findIndex((item) => item.status === "running");
    if (runningIndex >= 0) {
      const item = items[runningIndex]!;
      const job = item.job_id === undefined ? null : await this.engine.get(item.job_id);
      if (job !== null && job.state !== "DONE") return; // hali ishlayapti
      if (job === null || job.outcome !== "success") {
        items[runningIndex] = {
          ...item,
          status: "failed",
          error: item.error ?? {
            code: "JOB_CANCELLED",
            message: `Job ${job?.outcome ?? "topilmadi"}`,
          },
        };
      } else {
        const renders = await this.engine.rendersOf(job.id);
        items[runningIndex] = {
          ...item,
          status: "done",
          outputs: renders
            .filter((r) => r.status === "done")
            .map((r) => r.localPath)
            .reverse(),
        };
      }
      await this.save(batchId, items);
    }

    const nextIndex = items.findIndex((item) => item.status === "pending");
    if (nextIndex < 0) {
      const failed = items.filter((item) => item.status === "failed").length;
      const finished = await this.save(batchId, items, failed === items.length ? "failed" : "done");
      for (const listener of this.listeners) listener.finished?.(finished);
      return;
    }
    const item = items[nextIndex]!;
    const entry = await this.ctx.templates.get(batch.userId, batch.template);
    const options = batch.options as {
      format?: Aspect;
      variants?: Aspect[];
      dur?: number;
      brand?: string;
    };
    if (entry === null) {
      items[nextIndex] = { ...item, status: "failed", error: { code: "SPEC_UNKNOWN_TEMPLATE" } };
      await this.save(batchId, items);
      this.kick(batchId);
      return;
    }
    const applied = applyTemplate(entry, null, {
      slots: item.slots,
      dur: options.dur,
      mode: "new",
      aspect: options.format,
      outputName: item.name,
    });
    const spec = applied.ok
      ? {
          ...(applied.data.spec as Record<string, unknown>),
          ...(options.brand === undefined ? {} : { brand: options.brand }),
          ...(options.variants === undefined ? {} : { variants: options.variants }),
        }
      : null;
    const plan = spec === null ? null : await this.engine.addPlan(batch.projectId, spec, "user");
    if (plan === null || !plan.ok) {
      const error = plan === null ? (applied.ok ? null : applied.error) : plan.error;
      items[nextIndex] = {
        ...item,
        status: "failed",
        error: {
          code: error?.code ?? "SPEC_INVALID",
          ...(error?.message === undefined ? {} : { message: error.message }),
        },
      };
      await this.save(batchId, items);
      this.kick(batchId);
      return;
    }
    const job = await this.engine.create({
      projectId: batch.projectId,
      planVersion: plan.data.version,
      autoApprove: true,
      batchId,
    });
    if (!job.ok) {
      // Qurilmada boshqa job ishlayapti: u tugaganda (listener) qayta urinamiz.
      if (job.error.code === "JOB_ACTIVE") return;
      items[nextIndex] = {
        ...item,
        status: "failed",
        error: {
          code: job.error.code,
          ...(job.error.message === undefined ? {} : { message: job.error.message }),
        },
      };
      await this.save(batchId, items);
      this.kick(batchId);
      return;
    }
    items[nextIndex] = { ...item, status: "running", job_id: job.data.id };
    await this.save(batchId, items);
  }
}

/** Batch holati (MCP / panel / kabinet uchun). */
export function presentBatch(batch: BatchRow) {
  const items = batch.items as BatchItem[];
  const count = (status: BatchItemStatus) => items.filter((item) => item.status === status).length;
  return {
    id: batch.id,
    project_id: batch.projectId,
    template: batch.template,
    status: batch.status,
    total: items.length,
    done: count("done"),
    failed: count("failed"),
    running: count("running"),
    pending: count("pending"),
    items,
    created_at: batch.createdAt.toISOString(),
    updated_at: batch.updatedAt.toISOString(),
  };
}

/** Yakuniy hisobot (markdown jadval). */
export function batchReport(batch: BatchRow): string {
  const view = presentBatch(batch);
  const lines = [
    `# Batch: ${view.template}`,
    ``,
    `Holat: **${view.status}** · ${view.done}/${view.total} tayyor${view.failed > 0 ? ` · ${view.failed} xato` : ""}`,
    ``,
    `| # | Nom | Holat | Natija |`,
    `|---|---|---|---|`,
    ...view.items.map(
      (item) =>
        `| ${item.row} | ${item.name} | ${item.status} | ${
          item.status === "done"
            ? (item.outputs ?? []).map((o) => `\`${o}\``).join("<br>")
            : (item.error?.message ?? item.error?.code ?? "")
        } |`,
    ),
  ];
  return lines.join("\n");
}
