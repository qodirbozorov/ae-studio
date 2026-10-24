/**
 * WorldVectorLogo (https://worldvectorlogo.com/api/docs): brend logolari (SVG) — `wvl:<slug>`.
 * Kalit admin panelda (`system_settings.worldvectorlogo`, AES-256-GCM); kalitsiz — IP bo'yicha kuniga 10 so'rov.
 * Kredit tejash: logo (`GET /logos/{slug}` → `svg_content`) bir marta olinadi va storage'da doimiy
 * (`cache/wvl/<slug>.json`), qidiruv natijasi 1 soat xotirada; qidiruv faqat aniq so'ralganda.
 */
import { fail, ok } from "@aes/shared";
import type { IconData, Result } from "@aes/shared";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../context";
import { systemSettings } from "../db/schema";
import { maskSecret, openSecret, sealSecret } from "../secrets";
import { svgDocumentToIcon } from "./svg";

export const WVL_API = "https://worldvectorlogo.com/api/v1";
export const WVL_SETTINGS_KEY = "worldvectorlogo";
export const WVL_PREFIX = "wvl";

export interface WvlOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}

export interface WvlLogo {
  name: string;
  title: string;
  downloads: number;
  tags: string[];
}

export interface WvlAdminView {
  configured: boolean;
  masked: string | null;
  updated_at: string | null;
  usage: {
    plan: string;
    plan_remaining: number;
    addon_remaining: number;
    monthly_allowance: number;
    resets_at: string | null;
    daily: { date: string; requests: number; errors: number }[];
  } | null;
  error: { code: string; message: string | null } | null;
  /** Serverda saqlangan (qayta kredit sarflamaydigan) logolar soni — shu jarayon ko'rganlari. */
  cached_logos: number;
}

interface UsageResponse {
  data?: {
    plan?: string;
    credits?: {
      plan_remaining?: number;
      addon_remaining?: number;
      monthly_allowance?: number;
      resets_at?: string | null;
    };
    daily_breakdown?: Record<string, { requests?: number; errors?: number }>;
  };
}

interface LogoJson {
  slug: string;
  name: string;
  downloads?: number;
  tags?: string[];
  svg_content?: string;
}

const TIMEOUT_MS = 15_000;
const KEY_TTL_MS = 30_000;
const SEARCH_TTL_MS = 60 * 60 * 1000;
const USAGE_TTL_MS = 60_000;
const SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

type Ctx = Pick<AppContext, "db" | "env" | "now" | "storage">;

class WvlHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class WorldVectorLogo {
  private key: { at: number; value: string | null; updatedAt: Date | null } | null = null;
  private readonly searches = new Map<string, { at: number; logos: WvlLogo[] }>();
  private readonly logos = new Map<string, IconData>();
  private usageCache: { at: number; view: WvlAdminView["usage"] } | null = null;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(
    private readonly ctx: Ctx,
    private readonly log: FastifyBaseLogger,
    options: WvlOptions = {},
  ) {
    this.fetchFn = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? WVL_API).replace(/\/+$/, "");
  }

  /** Admin o'zgartirdi (shu yoki boshqa replikada). */
  invalidate(): void {
    this.key = null;
    this.usageCache = null;
  }

  private async apiKey(): Promise<{ value: string | null; updatedAt: Date | null }> {
    const nowMs = this.ctx.now().getTime();
    if (this.key !== null && nowMs - this.key.at < KEY_TTL_MS) return this.key;
    const [row] = await this.ctx.db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, WVL_SETTINGS_KEY));
    let value: string | null = null;
    if (row?.secret != null) {
      try {
        value = openSecret(this.ctx.env, row.secret);
      } catch (error) {
        this.log.error({ err: error }, "WorldVectorLogo kalitini ochib bo'lmadi (MASTER_KEY?)");
      }
    }
    this.key = { at: nowMs, value, updatedAt: row?.updatedAt ?? null };
    return this.key;
  }

  private async get<T>(path: string, key?: string | null): Promise<T> {
    const token = key === undefined ? (await this.apiKey()).value : key;
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        accept: "application/json",
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
    });
    if (!res.ok) {
      let message = `WorldVectorLogo ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string }; message?: string };
        message = body.error?.message ?? body.message ?? message;
      } catch {
        // JSON emas
      }
      throw new WvlHttpError(res.status, message);
    }
    return (await res.json()) as T;
  }

  private problem(error: unknown, what: string): Result<never> {
    if (error instanceof WvlHttpError) {
      if (error.status === 404) return fail("SPEC_INVALID", `${what}: topilmadi (icons_search)`);
      if (error.status === 401 || error.status === 403) {
        return fail(
          "SYS_BAD_REQUEST",
          `${what}: WorldVectorLogo kaliti noto'g'ri (admin → Ikonkalar)`,
        );
      }
      if (error.status === 402 || error.status === 429) {
        return fail(
          "SYS_RATE_LIMIT",
          `${what}: WorldVectorLogo krediti yoki kunlik chegara tugadi (admin → Ikonkalar)`,
        );
      }
      return fail("SYS_INTERNAL", `${what}: ${error.message}`);
    }
    this.log.warn({ err: error }, "WorldVectorLogo so'rovi ishlamadi");
    return fail("SYS_INTERNAL", `${what}: WorldVectorLogo'ga ulanib bo'lmadi`);
  }

  private cacheKey(slug: string): string {
    return `cache/wvl/${slug}.json`;
  }

  /** Logo geometriyasi: xotira → storage → API (1 kredit, keyin doimiy kesh). */
  async logo(slug: string): Promise<Result<IconData>> {
    if (!SLUG.test(slug)) return fail("SPEC_INVALID", `Logo nomi noto'g'ri: wvl:${slug}`);
    const memory = this.logos.get(slug);
    if (memory !== undefined) return ok(memory);
    try {
      const raw = await this.ctx.storage.getBytes(this.cacheKey(slug));
      if (raw !== null) {
        const icon = JSON.parse(raw.toString("utf8")) as IconData;
        if (typeof icon.body === "string" && icon.width > 0 && icon.height > 0) {
          this.logos.set(slug, icon);
          return ok(icon);
        }
      }
    } catch {
      // kesh buzilgan — qayta olinadi
    }
    let json: { data?: LogoJson };
    try {
      json = await this.get<{ data?: LogoJson }>(`/logos/${encodeURIComponent(slug)}`);
    } catch (error) {
      return this.problem(error, `wvl:${slug}`);
    }
    const svg = json.data?.svg_content;
    const icon = svg === undefined ? null : svgDocumentToIcon(svg);
    if (icon === null) return fail("SPEC_INVALID", `wvl:${slug}: logoda SVG yo'q`);
    this.logos.set(slug, icon);
    await this.ctx.storage
      .putBytes(this.cacheKey(slug), Buffer.from(JSON.stringify(icon)), "application/json")
      .catch((error: unknown) => this.log.warn({ err: error }, "logo keshini yozib bo'lmadi"));
    return ok(icon);
  }

  /** Qidiruv (eng ko'p yuklanganlar birinchi): 1 kredit, natija 1 soat xotirada. */
  async search(query: string, limit: number): Promise<Result<WvlLogo[]>> {
    const q = query.trim().toLowerCase();
    const cached = this.searches.get(q);
    const nowMs = this.ctx.now().getTime();
    if (cached !== undefined && nowMs - cached.at < SEARCH_TTL_MS && cached.logos.length >= limit) {
      return ok(cached.logos.slice(0, limit));
    }
    try {
      const params = new URLSearchParams({
        q,
        per_page: String(Math.min(50, Math.max(limit, 20))),
      });
      const json = await this.get<{ data?: LogoJson[] }>(`/logos/search?${params.toString()}`);
      const logos = (json.data ?? [])
        .filter((logo) => SLUG.test(logo.slug))
        .map((logo) => ({
          name: `${WVL_PREFIX}:${logo.slug}`,
          title: logo.name,
          downloads: logo.downloads ?? 0,
          tags: logo.tags ?? [],
        }));
      this.searches.set(q, { at: nowMs, logos });
      return ok(logos.slice(0, limit));
    } catch (error) {
      return this.problem(error, "WorldVectorLogo qidiruvi");
    }
  }

  private async usage(key: string, fresh: boolean): Promise<Result<WvlAdminView["usage"]>> {
    const nowMs = this.ctx.now().getTime();
    if (!fresh && this.usageCache !== null && nowMs - this.usageCache.at < USAGE_TTL_MS) {
      return ok(this.usageCache.view);
    }
    try {
      const json = await this.get<UsageResponse>("/account/usage", key);
      const credits = json.data?.credits ?? {};
      const view: WvlAdminView["usage"] = {
        plan: json.data?.plan ?? "free",
        plan_remaining: credits.plan_remaining ?? 0,
        addon_remaining: credits.addon_remaining ?? 0,
        monthly_allowance: credits.monthly_allowance ?? 0,
        resets_at: credits.resets_at ?? null,
        daily: Object.entries(json.data?.daily_breakdown ?? {})
          .map(([date, row]) => ({ date, requests: row.requests ?? 0, errors: row.errors ?? 0 }))
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 14),
      };
      this.usageCache = { at: nowMs, view };
      return ok(view);
    } catch (error) {
      return this.problem(error, "WorldVectorLogo hisobi");
    }
  }

  async adminView(fresh = false): Promise<WvlAdminView> {
    const key = await this.apiKey();
    const view: WvlAdminView = {
      configured: key.value !== null,
      masked: key.value === null ? null : maskSecret(key.value),
      updated_at: key.updatedAt?.toISOString() ?? null,
      usage: null,
      error: null,
      cached_logos: this.logos.size,
    };
    if (key.value === null) return view;
    const usage = await this.usage(key.value, fresh);
    if (usage.ok) view.usage = usage.data;
    else view.error = { code: usage.error.code, message: usage.error.message ?? null };
    return view;
  }

  /** Kalitni tekshirib (`/account/usage`) shifrlab saqlaydi; noto'g'ri kalit saqlanmaydi. */
  async setKey(apiKey: string, by: string): Promise<Result<WvlAdminView>> {
    if (this.ctx.env.MASTER_KEY === undefined) {
      return fail("SYS_BAD_REQUEST", "MASTER_KEY sozlanmagan: kalitni shifrlab saqlab bo'lmaydi");
    }
    const key = apiKey.trim();
    const checked = await this.usage(key, true);
    if (!checked.ok) return checked;
    await this.write(key, by);
    return ok(await this.adminView());
  }

  async removeKey(by: string): Promise<WvlAdminView> {
    await this.write(null, by);
    return this.adminView();
  }

  private async write(key: string | null, by: string): Promise<void> {
    const sealed = key === null ? null : sealSecret(this.ctx.env, key);
    const value = key === null ? { removed: true } : { masked: maskSecret(key) };
    await this.ctx.db
      .insert(systemSettings)
      .values({
        key: WVL_SETTINGS_KEY,
        value,
        secret: sealed,
        updatedBy: by,
        updatedAt: this.ctx.now(),
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, secret: sealed, updatedBy: by, updatedAt: this.ctx.now() },
      });
    this.invalidate();
  }
}
