/**
 * Balans va sarf jurnali (Faza 8, P8.01). Har pullik amal `usage_ledger` ga yoziladi va `users.balance_micros`
 * shu tranzaksiyada o'zgaradi. Audio vazifa va job timeline'i qayta hisoblanmaydi (unique indekslar).
 * Cheklov (`BILLING_ENFORCE`) yoqilmaguncha sarf faqat yoziladi.
 */
import { DEFAULT_RATES, fail, microsToUsd, ok, usdToMicros } from "@aes/shared";
import type { PriceQuote, PricingRates, Result } from "@aes/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { usageLedger, users } from "../db/schema";

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

type LedgerRow = typeof usageLedger.$inferSelect;

export class BillingService {
  constructor(
    private readonly ctx: Pick<AppContext, "db" | "now" | "env">,
    readonly rates: PricingRates = DEFAULT_RATES,
  ) {}

  get enforced(): boolean {
    return this.ctx.env.BILLING_ENFORCE === true;
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

  /** Taxminiy narxni to'lay oladimi. Cheklov o'chiq bo'lsa doim ok. */
  async check(userId: string, priceUsd: number): Promise<Result<void>> {
    if (!this.enforced) return ok(undefined);
    const account = await this.account(userId);
    if (!account.activated) {
      return fail(
        "BILLING_NOT_ACTIVATED",
        `Ishlatishni boshlash uchun ${account.activation_usd} $ boshlang'ich to'lov kerak`,
        { activation_usd: account.activation_usd },
      );
    }
    if (account.balance_usd < priceUsd || account.balance_usd <= 0) {
      return fail(
        "BILLING_BALANCE_LOW",
        `Balans ${account.balance_usd.toFixed(2)} $, kerak ≈ ${priceUsd.toFixed(2)} $`,
        { balance_usd: account.balance_usd, required_usd: priceUsd },
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
    return this.ctx.db.transaction(async (tx) => {
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
      if (inserted.length === 0) return false;
      if (amount !== 0) {
        await tx
          .update(users)
          .set({ balanceMicros: sql`${users.balanceMicros} - ${amount}` })
          .where(eq(users.id, input.userId));
      }
      return true;
    });
  }

  /**
   * Balansni to'ldirish (admin qo'lda; to'lov tizimi hozircha yo'q). Jami to'ldirish boshlang'ich to'lovga
   * yetganda hisob faollashadi.
   */
  async topup(userId: string, usd: number, by: string, note?: string): Promise<BillingAccount> {
    const amount = usdToMicros(usd);
    await this.ctx.db.transaction(async (tx) => {
      await tx.insert(usageLedger).values({
        userId,
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
    return this.account(userId);
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
