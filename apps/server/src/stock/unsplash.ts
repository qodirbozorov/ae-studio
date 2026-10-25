/**
 * Unsplash (https://unsplash.com/documentation): videolar uchun foto qidirish va loyihaga olish.
 * Qoidalar (API Guidelines): rasm fayli **Unsplash CDN havolasidan** olinadi (o'z storage'imizga qayta joylanmaydi —
 * panel `images.unsplash.com` dan to'g'ridan-to'g'ri yuklaydi, server baytlarni faqat sha256 uchun bir marta o'qiydi);
 * rasm ishlatilganda `links.download_location` chaqiriladi (loyiha × rasm uchun bir marta); muallif va Unsplash
 * UTM havolalari bilan ko'rsatiladi. Kalit — admin panelda (`system_settings.unsplash`, AES-256-GCM).
 * Demo rejimida soatiga 50 so'rov: qidiruv 1 soat, rasm ma'lumoti 24 soat xotirada.
 */
import { createHash } from "node:crypto";
import { fail, ok } from "@aes/shared";
import type { Result } from "@aes/shared";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../context";
import { systemSettings } from "../db/schema";
import { maskSecret, openSecret, sealSecret } from "../secrets";

export const UNSPLASH_API = "https://api.unsplash.com";
export const UNSPLASH_SETTINGS_KEY = "unsplash";
/** Atribusiya havolalaridagi UTM (`?utm_source=<ilova>&utm_medium=referral`). */
export const UTM_SOURCE = "ae_studio";
/** Panel faqat shu hostdan yuklaydi (hotlinking). */
export const UNSPLASH_CDN_HOST = "images.unsplash.com";

export type Orientation = "landscape" | "portrait" | "squarish";
export const COLORS = [
  "black_and_white",
  "black",
  "white",
  "yellow",
  "orange",
  "red",
  "purple",
  "magenta",
  "green",
  "teal",
  "blue",
] as const;
export type UnsplashColor = (typeof COLORS)[number];

export interface UnsplashOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** API'dan keladigan rasm (kerakli maydonlar). */
interface PhotoJson {
  id: string;
  width: number;
  height: number;
  color?: string | null;
  description?: string | null;
  alt_description?: string | null;
  premium?: boolean;
  plus?: boolean;
  urls: { raw: string; full: string; regular: string; small: string; thumb: string };
  links: { html: string; download_location: string };
  user: { name: string; username: string; links: { html: string } };
}

export interface PhotoView {
  id: string;
  description: string | null;
  width: number;
  height: number;
  color: string | null;
  author: string;
  author_url: string;
  photo_url: string;
  /** Kichik rasm (Unsplash CDN) — foydalanuvchiga ko'rsatish uchun. */
  thumb: string;
  attribution: string;
}

export interface UnsplashAdminView {
  configured: boolean;
  masked: string | null;
  updated_at: string | null;
  rate: { limit: number | null; remaining: number | null; at: string } | null;
  error: { code: string; message: string | null } | null;
}

const TIMEOUT_MS = 15_000;
const KEY_TTL_MS = 30_000;
const SEARCH_TTL_MS = 60 * 60 * 1000;
const PHOTO_TTL_MS = 24 * 60 * 60 * 1000;
/** Loyihaga olinadigan rasmning eng katta hajmi (sha256 uchun bir marta o'qiladi). */
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{4,64}$/;

type Ctx = Pick<AppContext, "db" | "env" | "now">;

class UnsplashHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const withUtm = (url: string) =>
  `${url}${url.includes("?") ? "&" : "?"}utm_source=${UTM_SOURCE}&utm_medium=referral`;

/** API javobi → foydalanuvchi va Claude uchun ko'rinish (atribusiya UTM bilan). */
export function photoView(p: PhotoJson): PhotoView {
  const author = p.user.name || p.user.username;
  return {
    id: p.id,
    description: p.alt_description ?? p.description ?? null,
    width: p.width,
    height: p.height,
    color: p.color ?? null,
    author,
    author_url: withUtm(p.user.links.html),
    photo_url: withUtm(p.links.html),
    thumb: p.urls.small,
    attribution: `Photo by ${author} on Unsplash`,
  };
}

/** Kerakli kenglikdagi JPEG (imgix parametrlari `urls.raw` ga), asl o'lchamdan katta emas. */
export function sizedUrl(
  p: { urls: { raw: string }; width: number },
  width: number,
): { url: string; width: number } {
  const w = Math.max(200, Math.min(Math.round(width), p.width, 6000));
  const url = new URL(p.urls.raw);
  url.searchParams.set("w", String(w));
  url.searchParams.set("fm", "jpg");
  url.searchParams.set("q", "85");
  url.searchParams.set("fit", "max");
  return { url: url.toString(), width: w };
}

export class UnsplashService {
  private key: { at: number; value: string | null; updatedAt: Date | null } | null = null;
  private readonly searches = new Map<
    string,
    { at: number; value: { total: number; photos: PhotoJson[] } }
  >();
  private readonly photos = new Map<string, { at: number; value: PhotoJson }>();
  private rate: UnsplashAdminView["rate"] = null;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(
    private readonly ctx: Ctx,
    private readonly log: FastifyBaseLogger,
    options: UnsplashOptions = {},
  ) {
    this.fetchFn = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? UNSPLASH_API).replace(/\/+$/, "");
  }

  /** Admin o'zgartirdi (shu yoki boshqa replikada). */
  invalidate(): void {
    this.key = null;
  }

  private async apiKey(): Promise<{ value: string | null; updatedAt: Date | null }> {
    const nowMs = this.ctx.now().getTime();
    if (this.key !== null && nowMs - this.key.at < KEY_TTL_MS) return this.key;
    const [row] = await this.ctx.db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, UNSPLASH_SETTINGS_KEY));
    let value: string | null = null;
    if (row?.secret != null) {
      try {
        value = openSecret(this.ctx.env, row.secret);
      } catch (error) {
        this.log.error({ err: error }, "Unsplash kalitini ochib bo'lmadi (MASTER_KEY?)");
      }
    }
    this.key = { at: nowMs, value, updatedAt: row?.updatedAt ?? null };
    return this.key;
  }

  private async get<T>(path: string, key?: string): Promise<T> {
    const token = key ?? (await this.apiKey()).value;
    if (token === null)
      throw new UnsplashHttpError(401, "Unsplash kaliti kiritilmagan (admin → Rasmlar)");
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: `Client-ID ${token}`,
        "accept-version": "v1",
        accept: "application/json",
      },
    });
    const limit = Number(res.headers.get("x-ratelimit-limit"));
    const remaining = Number(res.headers.get("x-ratelimit-remaining"));
    if (Number.isFinite(limit) && res.headers.has("x-ratelimit-limit")) {
      this.rate = {
        limit,
        remaining: Number.isFinite(remaining) ? remaining : null,
        at: this.ctx.now().toISOString(),
      };
    }
    if (!res.ok) {
      let message = `Unsplash ${res.status}`;
      try {
        const body = (await res.json()) as { errors?: string[] };
        message = body.errors?.join("; ") || message;
      } catch {
        // JSON emas (masalan "Rate Limit Exceeded" matni)
      }
      throw new UnsplashHttpError(res.status, message);
    }
    return (await res.json()) as T;
  }

  private problem(error: unknown, what: string): Result<never> {
    if (error instanceof UnsplashHttpError) {
      if (error.status === 404)
        return fail("SYS_NOT_FOUND", `${what}: rasm topilmadi (images_search)`);
      if (error.status === 401) return fail("SYS_BAD_REQUEST", `${what}: ${error.message}`);
      if (error.status === 403 || error.status === 429) {
        return fail("SYS_RATE_LIMIT", `${what}: Unsplash soatlik limiti tugadi — keyinroq urining`);
      }
      return fail("SYS_INTERNAL", `${what}: ${error.message}`);
    }
    this.log.warn({ err: error }, "Unsplash so'rovi ishlamadi");
    return fail("SYS_INTERNAL", `${what}: Unsplash'ga ulanib bo'lmadi`);
  }

  async configured(): Promise<boolean> {
    return (await this.apiKey()).value !== null;
  }

  /** Qidiruv (`/search/photos`): Unsplash+ (premium) natijalar chiqarib tashlanadi; 1 soat kesh. */
  async search(input: {
    query: string;
    orientation?: Orientation;
    color?: UnsplashColor;
    count: number;
    page?: number;
  }): Promise<Result<{ total: number; photos: PhotoView[] }>> {
    const params = new URLSearchParams({
      query: input.query.trim(),
      per_page: String(Math.min(30, Math.max(1, input.count))),
      page: String(input.page ?? 1),
      content_filter: "high",
    });
    if (input.orientation !== undefined) params.set("orientation", input.orientation);
    if (input.color !== undefined) params.set("color", input.color);
    const cacheKey = params.toString().toLowerCase();
    const nowMs = this.ctx.now().getTime();
    const cached = this.searches.get(cacheKey);
    let value = cached !== undefined && nowMs - cached.at < SEARCH_TTL_MS ? cached.value : null;
    if (value === null) {
      try {
        const json = await this.get<{ total?: number; results?: PhotoJson[] }>(
          `/search/photos?${params.toString()}`,
        );
        value = { total: json.total ?? 0, photos: json.results ?? [] };
        this.searches.set(cacheKey, { at: nowMs, value });
        for (const p of value.photos) this.photos.set(p.id, { at: nowMs, value: p });
      } catch (error) {
        return this.problem(error, "Unsplash qidiruvi");
      }
    }
    const photos = value.photos.filter((p) => p.premium !== true && p.plus !== true).map(photoView);
    return ok({ total: value.total, photos });
  }

  /** Bitta rasm (`/photos/:id`), 24 soat kesh. */
  async photo(id: string): Promise<Result<PhotoJson>> {
    if (!ID.test(id)) return fail("SYS_BAD_REQUEST", `Unsplash rasm id noto'g'ri: ${id}`);
    const nowMs = this.ctx.now().getTime();
    const cached = this.photos.get(id);
    if (
      cached !== undefined &&
      nowMs - cached.at < PHOTO_TTL_MS &&
      cached.value.links?.download_location
    ) {
      return ok(cached.value);
    }
    try {
      const value = await this.get<PhotoJson>(`/photos/${encodeURIComponent(id)}`);
      this.photos.set(id, { at: nowMs, value });
      if (value.premium === true || value.plus === true) {
        return fail(
          "SYS_BAD_REQUEST",
          `${id}: Unsplash+ (premium) rasm — API orqali ishlatib bo'lmaydi`,
        );
      }
      return ok(value);
    } catch (error) {
      return this.problem(error, `Unsplash ${id}`);
    }
  }

  /** Rasm ishlatildi — Unsplash talabi (download tracking). */
  async trackDownload(photo: PhotoJson): Promise<boolean> {
    try {
      const url = new URL(photo.links.download_location);
      await this.get(`${url.pathname}${url.search}`);
      return true;
    } catch (error) {
      this.log.warn({ err: error, photo: photo.id }, "Unsplash download tracking yuborilmadi");
      return false;
    }
  }

  /**
   * CDN faylining sha256 va hajmi — panel aynan shu havoladan yuklaydi va tekshiradi. Baytlar saqlanmaydi.
   */
  async fingerprint(url: string): Promise<Result<{ sha256: string; size: number }>> {
    if (new URL(url).host !== UNSPLASH_CDN_HOST)
      return fail("SYS_BAD_REQUEST", "Faqat Unsplash CDN havolasi");
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) return fail("SYS_INTERNAL", `Unsplash CDN ${res.status}`);
      if (!(res.headers.get("content-type") ?? "").startsWith("image/")) {
        return fail("SYS_INTERNAL", "Unsplash CDN rasm qaytarmadi");
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
        return fail(
          "SYS_BAD_REQUEST",
          `Rasm hajmi ${Math.round(bytes.length / 1e6)} MB — kichikroq kenglik tanlang`,
        );
      }
      return ok({ sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length });
    } catch (error) {
      this.log.warn({ err: error }, "Unsplash CDN'dan o'qib bo'lmadi");
      return fail("SYS_INTERNAL", "Unsplash CDN'ga ulanib bo'lmadi");
    }
  }

  async adminView(fresh = false): Promise<UnsplashAdminView> {
    const key = await this.apiKey();
    const view: UnsplashAdminView = {
      configured: key.value !== null,
      masked: key.value === null ? null : maskSecret(key.value),
      updated_at: key.updatedAt?.toISOString() ?? null,
      rate: this.rate,
      error: null,
    };
    if (key.value !== null && (fresh || this.rate === null)) {
      try {
        await this.get("/photos?per_page=1", key.value);
        view.rate = this.rate;
      } catch (error) {
        const p = this.problem(error, "Unsplash");
        if (!p.ok) view.error = { code: p.error.code, message: p.error.message ?? null };
      }
    }
    return view;
  }

  /** Kalitni tekshirib (bitta so'rov) shifrlab saqlaydi; noto'g'ri kalit saqlanmaydi. */
  async setKey(apiKey: string, by: string): Promise<Result<UnsplashAdminView>> {
    if (this.ctx.env.MASTER_KEY === undefined) {
      return fail("SYS_BAD_REQUEST", "MASTER_KEY sozlanmagan: kalitni shifrlab saqlab bo'lmaydi");
    }
    const key = apiKey.trim();
    try {
      await this.get("/photos?per_page=1", key);
    } catch (error) {
      if (error instanceof UnsplashHttpError && error.status === 401) {
        return fail("SYS_BAD_REQUEST", "Unsplash kaliti noto'g'ri (Access Key kerak)");
      }
      return this.problem(error, "Unsplash");
    }
    await this.write(key, by);
    return ok(await this.adminView());
  }

  async removeKey(by: string): Promise<UnsplashAdminView> {
    await this.write(null, by);
    this.rate = null;
    return this.adminView();
  }

  private async write(key: string | null, by: string): Promise<void> {
    const sealed = key === null ? null : sealSecret(this.ctx.env, key);
    const value = key === null ? { removed: true } : { masked: maskSecret(key) };
    await this.ctx.db
      .insert(systemSettings)
      .values({
        key: UNSPLASH_SETTINGS_KEY,
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
