/**
 * Brand kit'lar (§11.3): foydalanuvchi bo'yicha `brands` jadvali (slug yagona, saqlash — upsert).
 * Spec `brand` (default "default"): "default" saqlanmagan bo'lsa brand'siz quriladi; boshqa slug topilmasa xato.
 */
import { fail, ok, parseBrand } from "@aes/shared";
import type { Brand, Result } from "@aes/shared";
import { and, asc, eq } from "drizzle-orm";
import type { AppContext } from "../context";
import { brands } from "../db/schema";

export class BrandService {
  constructor(private readonly ctx: Pick<AppContext, "db" | "now">) {}

  async list(userId: string): Promise<(Brand & { updated_at: string })[]> {
    const rows = await this.ctx.db
      .select()
      .from(brands)
      .where(eq(brands.userId, userId))
      .orderBy(asc(brands.slug));
    const out: (Brand & { updated_at: string })[] = [];
    for (const row of rows) {
      const parsed = parseBrand(row.data);
      if (parsed.ok) out.push({ ...parsed.data, updated_at: row.updatedAt.toISOString() });
    }
    return out;
  }

  async get(userId: string, slug: string): Promise<Brand | null> {
    const [row] = await this.ctx.db
      .select()
      .from(brands)
      .where(and(eq(brands.userId, userId), eq(brands.slug, slug)))
      .limit(1);
    if (row === undefined) return null;
    const parsed = parseBrand(row.data);
    return parsed.ok ? parsed.data : null;
  }

  async save(userId: string, input: unknown): Promise<Result<Brand>> {
    const parsed = parseBrand(input);
    if (!parsed.ok) return parsed;
    const brand = parsed.data;
    await this.ctx.db
      .insert(brands)
      .values({ userId, slug: brand.slug, data: brand })
      .onConflictDoUpdate({
        target: [brands.userId, brands.slug],
        set: { data: brand, updatedAt: this.ctx.now() },
      });
    return ok(brand);
  }

  async remove(userId: string, slug: string): Promise<boolean> {
    const deleted = await this.ctx.db
      .delete(brands)
      .where(and(eq(brands.userId, userId), eq(brands.slug, slug)))
      .returning({ id: brands.id });
    return deleted.length > 0;
  }

  /** Spec'dagi brand: "default" yo'q bo'lsa — brand'siz (undefined); boshqasi yo'q bo'lsa — SPEC_INVALID. */
  async resolve(userId: string, slug: string): Promise<Result<Brand | undefined>> {
    const brand = await this.get(userId, slug);
    if (brand !== null) return ok(brand);
    if (slug === "default") return ok(undefined);
    return fail("SPEC_INVALID", `/brand: '${slug}' brand kit topilmadi (brands_list / brand_save)`);
  }
}
