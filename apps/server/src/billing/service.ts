/**
 * Balans va sarf jurnali (Faza 8, P8.01). Har pullik amal `usage_ledger` ga yoziladi va `users.balance_micros`
 * shu tranzaksiyada o'zgaradi. Audio vazifa va job timeline'i qayta hisoblanmaydi (unique indekslar).
 * Cheklov (`BILLING_ENFORCE`) yoqilmaguncha sarf faqat yoziladi.
 * Stavkalar (P9.04) — kod + admin o'zgartirgan farqlar (`system_settings.billing`), replikalar 30 s da yangilaydi.
 */
import { DEFAULT_RATES, fail, microsToUsd, ok, usdToMicros } from "@aes/shared";
import type { PriceQuote, PricingRates, Result } from "@aes/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../context";
import { systemSettings, usageLedger, users } from "../db/schema";
import { BILLING_SETTINGS_KEY, mergeRates, parseStored } from "./settings";
import type { BillingSettingsValue } from "./settings";

/** Shu chegaradan pastga tushganda foydalanuvchiga bir marta eslatma (bot). */
export const LOW_BALANCE_USD = 1;

export interface ChargeInput {
  userId: string;
  quote: PriceQuote;
  jobId?: string | null;
  audioTaskId?: string | null;
  cached?: boolean;
  note?: string;
}

export interface BillingAccount {
  enforced: boolean;
  activated: boolean;
  balance_usd: number;
  activation_usd: number;
}

export interface BillingListener {
  /** Sarfdan keyin balans `LOW_BALANCE_USD` dan pastga tushdi (faqat faollashtirilgan hisob). */
  low?(userId: string, balanceUsd: number): void;
  /** Admin (yoki skript) balansni o'zgartirdi. */
  topup?(userId: string, usd: number, account: BillingAccount): void;
}

type LedgerRow = typeof usageLedger.$inferSelect;

export class BillingService {
  private current: PricingRates;
  private settings: BillingSettingsValue = {};
  private timer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<BillingListener>();

  constructor(
    private readonly ctx: Pick<AppContext, "db" | "now" | "env">,
    rates: PricingRates = DEFAULT_RATES,
    private readonly log?: FastifyBaseLogger,
  ) {
    this.current = rates;
  }

  get enforced(): boolean {
    return this.ctx.env.BILLING_ENFORCE === true;
  }

  /** Amaldagi stavkalar (kod + admin farqlari). */
  get rates(): PricingRates {
    return this.current;
  }

  /** To'lov uchun murojaat (admin kiritgan), bo'lmasa null. */
  get contact(): string | null {
    const value = this.settings.contact?.trim();
    return value === undefined || value === "" ? null : value;
  }

  get stored(): BillingSettingsValue {
    return this.settings;
  }

  listen(listener: BillingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** DB'dagi sozlamani o'qiydi (yozuv yo'q yoki buzilgan bo'lsa — kod stavkalari). */
  async loadSettings(): Promise<void> {
    const [row] = await this.ctx.db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, BILLING_SETTINGS_KEY))
      .limit(1);
    const parsed = row === undefined ? {} : parseStored(row.value);
    if (parsed === null) {
      this.log?.error("billing sozlamasi buzilgan: kod stavkalari ishlatiladi");
      return;
    }
    this.apply(parsed);
  }

  /** Admin saqladi: DB'ga yozadi va darhol qo'llaydi (boshqa replikalar keyingi yangilashda). */
  async saveSettings(value: BillingSettingsValue, by: string): Promise<void> {
    await this.ctx.db
      .insert(systemSettings)
      .values({ key: BILLING_SETTINGS_KEY, value, updatedBy: by, updatedAt: this.ctx.now() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedBy: by, updatedAt: this.ctx.now() },
      });
    this.apply(value);
  }

  private apply(value: BillingSettingsValue): void {
    this.settings = value;
    this.current = mergeRates(value.rates);
  }

  startRefresh(intervalMs = 30_000): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.loadSettings().catch((error: unknown) =>
        this.log?.warn({ err: error }, "billing sozlamasi yangilanmadi"),
      );
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async account(userId: string): Promise<BillingAccount> {
    const [user] = await this.ctx.db
      .select({ balance: users.balanceMicros, activatedAt: users.activatedAt })
      .from(users)
      .where(eq(users.id, userId));
    return {
      enforced: this.enforced,
      activated: user?.activatedAt != null,
      balance_usd: microsToUsd(user?.balance ?? 0),
      activation_usd: this.rates.activationUsd,
    };
  }

  /** To'ldirish yo'li (xato hint'lari uchun): kabinet va admin kontakti. */
  private payHint(): string {
    const contact = this.contact;
    return `Balansni to'ldirish: kabinet → Sozlamalar → Balans va Pro${contact === null ? "" : ` (to'lov: ${contact})`}`;
  }

  /** Taxminiy narxni to'lay oladimi. Cheklov o'chiq bo'lsa doim ok. */
  async check(userId: string, priceUsd: number): Promise<Result<void>> {
    if (!this.enforced) return ok(undefined);
    const account = await this.account(userId);
    if (!account.activated) {
      return fail(
        "BILLING_NOT_ACTIVATED",
        `Ishlatishni boshlash uchun ${account.activation_usd} $ boshlang'ich to'lov kerak`,
        { activation_usd: account.activation_usd, pay: this.payHint() },
      );
    }
    if (account.balance_usd < priceUsd || account.balance_usd <= 0) {
      return fail(
        "BILLING_BALANCE_LOW",
        `Balans ${account.balance_usd.toFixed(2)} $, kerak ≈ ${priceUsd.toFixed(2)} $`,
        { balance_usd: account.balance_usd, required_usd: priceUsd, pay: this.payHint() },
      );
    }
    return ok(undefined);
  }

  /**
   * Sarfni yozadi va balansdan yechadi. Shu vazifa yoki job timeline'i allaqachon yozilgan bo'lsa — hech narsa
   * qilmaydi (idempotent) va `false` qaytaradi.
   */
  async charge(input: ChargeInput): Promise<boolean> {
    const amount = usdToMicros(input.quote.priceUsd);
    const result = await this.ctx.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(usageLedger)
        .values({
          userId: input.userId,
          jobId: input.jobId ?? null,
          audioTaskId: input.audioTaskId ?? null,
          kind: "charge",
          item: input.quote.item,
          quantity: input.quote.quantity,
          unit: input.quote.unit,
          costMicros: usdToMicros(input.quote.costUsd),
          amountMicros: -amount,
          cached: input.cached === true,
          note: input.note ?? null,
          createdAt: this.ctx.now(),
        })
        .onConflictDoNothing()
        .returning({ id: usageLedger.id });
      if (inserted.length === 0) return null;
      if (amount === 0) return { after: null, activated: false };
      const [user] = await tx
        .update(users)
        .set({ balanceMicros: sql`${users.balanceMicros} - ${amount}` })
        .where(eq(users.id, input.userId))
        .returning({ balance: users.balanceMicros, activatedAt: users.activatedAt });
      return { after: user?.balance ?? null, activated: user?.activatedAt != null };
    });
    if (result === null) return false;
    // Chegarani shu sarf kesib o'tgan bo'lsa — bir marta eslatma.
    if (result.after !== null && result.activated) {
      const limit = usdToMicros(LOW_BALANCE_USD);
      if (result.after < limit && result.after + amount >= limit) {
        this.emit((listener) => listener.low?.(input.userId, microsToUsd(result.after!)));
      }
    }
    return true;
  }

  /**
   * Balansni to'ldirish (admin qo'lda; to'lov tizimi hozircha yo'q). Jami to'ldirish boshlang'ich to'lovga
   * yetganda hisob faollashadi. Manfiy summa — tuzatish (`adjust`), faollashtirishni bekor qilmaydi.
   */
  async topup(
    userId: string,
    usd: number,
    by: string,
    note?: string,
    options: { tariffId?: string | null } = {},
  ): Promise<BillingAccount> {
    const amount = usdToMicros(usd);
    await this.ctx.db.transaction(async (tx) => {
      await tx.insert(usageLedger).values({
        userId,
        tariffId: options.tariffId ?? null,
        kind: usd >= 0 ? "topup" : "adjust",
        item: usd >= 0 ? "topup" : "adjust",
        quantity: usd,
        unit: "usd",
        amountMicros: amount,
        note: note ?? null,
        createdBy: by,
        createdAt: this.ctx.now(),
      });
      await tx
        .update(users)
        .set({ balanceMicros: sql`${users.balanceMicros} + ${amount}` })
        .where(eq(users.id, userId));
      const [total] = await tx
        .select({ sum: sql<string>`coalesce(sum(${usageLedger.amountMicros}), 0)` })
        .from(usageLedger)
        .where(sql`${usageLedger.userId} = ${userId} and ${usageLedger.kind} = 'topup'`);
      if (Number(total?.sum ?? 0) >= usdToMicros(this.rates.activationUsd)) {
        await tx
          .update(users)
          .set({ activatedAt: this.ctx.now() })
          .where(and(eq(users.id, userId), isNull(users.activatedAt)));
      }
    });
    const account = await this.account(userId);
    this.emit((listener) => listener.topup?.(userId, usd, account));
    return account;
  }

  /** Tinglovchi xatosi sarf/to'ldirishni buzmaydi. */
  private emit(call: (listener: BillingListener) => void): void {
    for (const listener of this.listeners) {
      try {
        call(listener);
      } catch (error) {
        this.log?.warn({ err: error }, "billing tinglovchisi xatosi");
      }
    }
  }

  async history(userId: string, limit = 50): Promise<LedgerRow[]> {
    return this.ctx.db
      .select()
      .from(usageLedger)
      .where(eq(usageLedger.userId, userId))
      .orderBy(desc(usageLedger.id))
      .limit(limit);
  }
}
