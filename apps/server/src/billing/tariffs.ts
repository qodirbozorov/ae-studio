/**
 * Tariflar (P9.03): to'lov paketlari. Foydalanuvchi `price` to'laydi (hozircha qo'lda, admin orqali), balansga
 * `credit` yoziladi (bonus = credit − price). PAYG — tarifsiz istalgan summa.
 */
import { microsToUsd, usdToMicros } from "@aes/shared";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { tariffs } from "../db/schema";

export type TariffRow = typeof tariffs.$inferSelect;

export const tariffInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  price_usd: z.number().finite().positive().max(100_000),
  credit_usd: z.number().finite().positive().max(100_000),
  active: z.boolean().default(true),
  sort: z.number().int().min(0).max(1000).default(0),
});

export const tariffPatchSchema = tariffInputSchema.partial();

export function presentTariff(row: TariffRow) {
  const price = microsToUsd(row.priceMicros);
  const credit = microsToUsd(row.creditMicros);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price_usd: price,
    credit_usd: credit,
    bonus_usd: Math.round((credit - price) * 100) / 100,
    active: row.active,
    sort: row.sort,
  };
}

export class TariffService {
  constructor(private readonly ctx: { db: Db; now: () => Date }) {}

  async list(activeOnly = false): Promise<TariffRow[]> {
    const rows = await this.ctx.db
      .select()
      .from(tariffs)
      .orderBy(asc(tariffs.sort), asc(tariffs.priceMicros));
    return activeOnly ? rows.filter((row) => row.active) : rows;
  }

  async get(id: string): Promise<TariffRow | null> {
    const [row] = await this.ctx.db.select().from(tariffs).where(eq(tariffs.id, id)).limit(1);
    return row ?? null;
  }

  async create(input: z.infer<typeof tariffInputSchema>): Promise<TariffRow> {
    const [row] = await this.ctx.db
      .insert(tariffs)
      .values({
        name: input.name,
        description: input.description,
        priceMicros: usdToMicros(input.price_usd),
        creditMicros: usdToMicros(input.credit_usd),
        active: input.active,
        sort: input.sort,
        createdAt: this.ctx.now(),
        updatedAt: this.ctx.now(),
      })
      .returning();
    return row!;
  }

  async update(id: string, patch: z.infer<typeof tariffPatchSchema>): Promise<TariffRow | null> {
    const [row] = await this.ctx.db
      .update(tariffs)
      .set({
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.price_usd === undefined ? {} : { priceMicros: usdToMicros(patch.price_usd) }),
        ...(patch.credit_usd === undefined ? {} : { creditMicros: usdToMicros(patch.credit_usd) }),
        ...(patch.active === undefined ? {} : { active: patch.active }),
        ...(patch.sort === undefined ? {} : { sort: patch.sort }),
        updatedAt: this.ctx.now(),
      })
      .where(eq(tariffs.id, id))
      .returning();
    return row ?? null;
  }

  /** O'chirish: ledger yozuvlarida tarif havolasi null bo'ladi (izohda nomi qoladi). */
  async remove(id: string): Promise<TariffRow | null> {
    const [row] = await this.ctx.db.delete(tariffs).where(eq(tariffs.id, id)).returning();
    return row ?? null;
  }
}
