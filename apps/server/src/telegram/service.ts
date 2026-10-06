/**
 * Telegram xabarnoma (P5.08, §11.4.5): bot (BotFather tokeni, 👤 `TELEGRAM_BOT_TOKEN`) orqali
 * render tugaganda, job BLOCKED bo'lganda va batch yakunlanganda xabar.
 *
 * Bog'lash: kabinet bir martalik kod beradi (15 daqiqa) → foydalanuvchi botga `/start <kod>` yuboradi →
 * server long polling (`getUpdates`) bilan kodni topib `chat_id` ni saqlaydi. Webhook kerak emas.
 */
import { randomBytes } from "node:crypto";
import { fail, ok } from "@aes/shared";
import type { AesError, Result } from "@aes/shared";
import { and, eq, gt } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../context";
import { jobs, projects, telegramLinks } from "../db/schema";
import type { BatchRow, BatchService } from "../batch/service";
import { presentBatch } from "../batch/service";
import type { JobEngine, JobRow } from "../jobs/engine";
import { LOGIN_START_RE, confirmTelegramLogin } from "../auth/telegram-login";
import type { TelegramUser } from "../auth/telegram-login";

const CODE_TTL_MS = 15 * 60_000;
const POLL_TIMEOUT_S = 25;
const DEFAULT_API = "https://api.telegram.org";

export interface TelegramOptions {
  fetch?: typeof fetch;
  /** false — polling ishga tushmaydi (testlar `pollOnce` ni o'zi chaqiradi). */
  poll?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

interface Update {
  update_id: number;
  message?: {
    chat: { id: number; title?: string; username?: string; first_name?: string };
    from?: TelegramUser;
    text?: string;
  };
}

export interface TelegramStatus {
  enabled: boolean;
  linked: boolean;
  bot_username: string | null;
  chat: string | null;
}

export class TelegramService {
  private offset = 0;
  private running = false;
  private stopped = false;
  private readonly sent = new Set<string>();
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private loop: Promise<void> | null = null;
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly ctx: Pick<AppContext, "db" | "env" | "now">,
    private readonly log: FastifyBaseLogger,
    private readonly options: TelegramOptions = {},
  ) {
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get enabled(): boolean {
    return this.ctx.env.TELEGRAM_BOT_TOKEN !== undefined;
  }

  private get botUsername(): string | null {
    return this.ctx.env.TELEGRAM_BOT_USERNAME ?? null;
  }

  private async api<T>(method: string, body: Record<string, unknown>): Promise<Result<T>> {
    const base = this.ctx.env.TELEGRAM_API_URL ?? DEFAULT_API;
    try {
      const res = await this.fetchFn(`${base}/bot${this.ctx.env.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
      if (!json.ok)
        return fail("SYS_INTERNAL", `Telegram ${method}: ${json.description ?? res.status}`);
      return ok(json.result as T);
    } catch (error) {
      return fail(
        "SYS_INTERNAL",
        `Telegram ${method}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Engine va batch hodisalariga ulanadi; token bo'lsa polling'ni boshlaydi. */
  attach(engine: JobEngine, batches: BatchService): void {
    engine.listen({
      update: (job) => {
        if (job.state === "DONE" || job.state === "BLOCKED") this.track(this.onJob(engine, job));
      },
    });
    batches.listen({ finished: (batch) => this.track(this.onBatch(batch)) });
    if (this.enabled && this.options.poll !== false) this.loop = this.pollLoop();
  }

  private track(task: Promise<unknown>): void {
    const safe = task.catch((error: unknown) => this.log.warn({ err: error }, "telegram xatosi"));
    this.pending.add(safe);
    void safe.finally(() => this.pending.delete(safe));
  }

  /** Yuborilayotgan xabarlar tugaguncha (testlar). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.loop?.catch(() => undefined);
  }

  // ------------------------------------------------------------------ bog'lash

  async status(userId: string): Promise<TelegramStatus> {
    const [row] = await this.ctx.db
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.userId, userId))
      .limit(1);
    return {
      enabled: this.enabled,
      linked: row?.chatId != null,
      bot_username: this.botUsername,
      chat: row?.chatTitle ?? null,
    };
  }

  async createCode(
    userId: string,
  ): Promise<Result<{ code: string; expires_at: string; link: string | null }>> {
    if (!this.enabled) {
      return fail("SYS_BAD_REQUEST", "Telegram bot sozlanmagan (TELEGRAM_BOT_TOKEN)");
    }
    const code = randomBytes(5).toString("hex").toUpperCase();
    const expires = new Date(this.ctx.now().getTime() + CODE_TTL_MS);
    await this.ctx.db
      .insert(telegramLinks)
      .values({ userId, code, codeExpiresAt: expires })
      .onConflictDoUpdate({
        target: telegramLinks.userId,
        set: { code, codeExpiresAt: expires },
      });
    const bot = this.botUsername;
    return ok({
      code,
      expires_at: expires.toISOString(),
      link: bot === null ? null : `https://t.me/${bot}?start=${code}`,
    });
  }

  async unlink(userId: string): Promise<void> {
    await this.ctx.db.delete(telegramLinks).where(eq(telegramLinks.userId, userId));
  }

  /** Bitta `getUpdates` (long polling); bog'lash kodlarini qayta ishlaydi. */
  async pollOnce(timeoutS = POLL_TIMEOUT_S): Promise<number> {
    const updates = await this.api<Update[]>("getUpdates", {
      offset: this.offset,
      timeout: timeoutS,
      allowed_updates: ["message"],
    });
    if (!updates.ok) return 0;
    for (const update of updates.data) {
      this.offset = Math.max(this.offset, update.update_id + 1);
      await this.handle(update);
    }
    return updates.data.length;
  }

  private async pollLoop(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (!this.stopped) {
      try {
        await this.pollOnce();
      } catch (error) {
        this.log.warn({ err: error }, "telegram polling xatosi");
        await this.sleep(5_000);
      }
    }
    this.running = false;
  }

  private async handle(update: Update): Promise<void> {
    const message = update.message;
    if (message?.text === undefined) return;
    const chatId = String(message.chat.id);
    // Kabinetga kirish: `/start login_<kod>` (deep link).
    const login = LOGIN_START_RE.exec(message.text.trim());
    if (login !== null) {
      const from = message.from ?? { id: message.chat.id, first_name: message.chat.first_name };
      const result = await confirmTelegramLogin(this.ctx, login[1]!, from, chatId);
      await this.send(
        chatId,
        result === "ok"
          ? "✅ Kirish tasdiqlandi — brauzerga qayting. Xabarnomalar ham shu chatga keladi."
          : "❌ Kirish havolasi eskirgan yoki ishlatilgan. Kabinetda «Telegram orqali kirish»ni qayta bosing.",
      );
      return;
    }
    const match = /^(?:\/start\s+)?([0-9A-Fa-f]{10})\s*$/.exec(message.text.trim());
    if (match === null) {
      if (message.text.startsWith("/start")) {
        await this.send(
          chatId,
          "AE Studio: kabinetga kirish uchun saytdagi «Telegram orqali kirish» tugmasini bosing.",
        );
      }
      return;
    }
    const code = match[1]!.toUpperCase();
    const [link] = await this.ctx.db
      .select()
      .from(telegramLinks)
      .where(and(eq(telegramLinks.code, code), gt(telegramLinks.codeExpiresAt, this.ctx.now())))
      .limit(1);
    if (link === undefined) {
      await this.send(chatId, "❌ Kod noto'g'ri yoki eskirgan. Kabinetdan yangi kod oling.");
      return;
    }
    const title = message.chat.title ?? message.chat.username ?? message.chat.first_name ?? chatId;
    await this.ctx.db
      .update(telegramLinks)
      .set({ chatId, chatTitle: title, code: null, codeExpiresAt: null, linkedAt: this.ctx.now() })
      .where(eq(telegramLinks.userId, link.userId));
    await this.send(
      chatId,
      "✅ AE Studio ulandi: render tugaganda va job to'xtaganda xabar keladi.",
    );
  }

  // ------------------------------------------------------------------ xabarlar

  private async send(chatId: string, text: string): Promise<boolean> {
    const res = await this.api("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });
    if (!res.ok) this.log.warn({ err: res.error }, "telegram xabar yuborilmadi");
    return res.ok;
  }

  /** Foydalanuvchiga (bog'langan bo'lsa) xabar. */
  async notify(userId: string, text: string): Promise<boolean> {
    if (!this.enabled) return false;
    const [row] = await this.ctx.db
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.userId, userId))
      .limit(1);
    if (row?.chatId == null) return false;
    return this.send(row.chatId, text);
  }

  private once(key: string): boolean {
    if (this.sent.has(key)) return false;
    this.sent.add(key);
    if (this.sent.size > 5000) this.sent.clear();
    return true;
  }

  private async onJob(engine: JobEngine, job: JobRow): Promise<void> {
    // Batch qatorlari alohida xabar bermaydi — batch yakunida bitta umumiy xabar.
    if (!this.enabled || job.batchId !== null) return;
    if (!this.once(`${job.id}:${job.state}:${job.updatedAt.getTime()}`)) return;
    const [row] = await this.ctx.db
      .select({ userId: projects.userId, name: projects.name })
      .from(jobs)
      .innerJoin(projects, eq(projects.id, jobs.projectId))
      .where(eq(jobs.id, job.id))
      .limit(1);
    if (row === undefined) return;
    if (job.state === "DONE") {
      if (job.outcome !== "success") return;
      const files = (await engine.rendersOf(job.id))
        .filter((r) => r.status === "done" && r.aepVersion === job.aepVersion)
        .map((r) => r.localPath)
        .reverse();
      await this.notify(
        row.userId,
        [`🎬 Video tayyor — ${row.name}`, ...files.map((f) => `• ${f}`)].join("\n"),
      );
      return;
    }
    const error = job.error as AesError | null;
    await this.notify(
      row.userId,
      `⚠️ Job to'xtadi — ${row.name}\n${error?.code ?? "?"}: ${error?.message ?? error?.hint ?? ""}`.trim(),
    );
  }

  private async onBatch(batch: BatchRow): Promise<void> {
    if (!this.enabled || !this.once(`batch:${batch.id}:${batch.status}`)) return;
    const view = presentBatch(batch);
    const lines = [
      `📦 Batch tugadi — ${view.template}: ${view.done}/${view.total} tayyor${view.failed > 0 ? `, ${view.failed} xato` : ""}`,
      ...view.items.map((item) =>
        item.status === "done"
          ? `✅ ${item.name}: ${(item.outputs ?? []).join(", ")}`
          : `❌ ${item.name}: ${item.error?.code ?? item.status}`,
      ),
    ];
    await this.notify(batch.userId, lines.join("\n"));
  }
}
