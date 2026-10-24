/**
 * Ikonka kutubxonasi: Lucide (serverda, sukut) + Iconify (200 000+ ikonka, 150+ to'plam: mdi, tabler, ph,
 * simple-icons, logos, flag …) — `api.iconify.design` orqali — va WorldVectorLogo brend logolari (`wvl:<slug>`,
 * admin kaliti bilan). Topilgan ikonka xotirada va storage'da (`cache/iconify/…`, `cache/wvl/…`) saqlanadi:
 * qayta build tashqi API'ga bog'liq emas.
 */
import { fail, iconRef, ok } from "@aes/shared";
import type { IconData, Result } from "@aes/shared";
import { getIconData } from "@iconify/utils";
import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../context";
import { lucideIcon, searchLucide } from "./lucide";
import { normalizeIcon } from "./svg";
import { WVL_PREFIX, WorldVectorLogo } from "./wvl";
import type { WvlLogo, WvlOptions } from "./wvl";

export const ICONIFY_API = "https://api.iconify.design";

export interface IconLibraryOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  wvl?: WvlOptions;
}

/** `worldvectorlogo` — faqat aniq so'ralganda (har qidiruv kredit sarflaydi). */
export type IconSource = "all" | "lucide" | "iconify" | "worldvectorlogo";

/** To'plam haqida (litsenziya — foydalanuvchiga aytish uchun). */
export interface IconCollection {
  name: string;
  license: string | null;
  license_url: string | null;
  author: string | null;
  /** Ko'p rangli (logos, emoji): `color` ta'sir qilmaydi. */
  multicolor: boolean;
}

export interface IconSearchResult {
  icons: string[];
  collections: Record<string, IconCollection>;
  /** WorldVectorLogo: nom, sarlavha, yuklashlar (mashhurligi). */
  logos?: WvlLogo[];
  /** Iconify'ga ulanib bo'lmasa (faqat Lucide natijalari). */
  warning?: string;
}

const PART = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
/** SMIL animatsiyali to'plamlar: statik kadrda bo'sh/chala chiqadi — qidiruvda ko'rsatilmaydi. */
const ANIMATED_SETS = new Set(["line-md", "svg-spinners"]);
const ANIMATED = /<(animate|animateTransform|animateMotion|set)\b/;
const TIMEOUT_MS = 10_000;

type IconifyJson = Parameters<typeof getIconData>[0] & { not_found?: string[] };

interface SearchResponse {
  icons?: string[];
  collections?: Record<
    string,
    {
      name?: string;
      author?: { name?: string };
      license?: { title?: string; spdx?: string; url?: string };
      palette?: boolean;
    }
  >;
}

const WVL: IconCollection = {
  name: "WorldVectorLogo",
  license: "Brend logolari (tovar belgilari): faqat brendni ko'rsatish uchun",
  license_url: "https://worldvectorlogo.com",
  author: null,
  multicolor: true,
};

const LUCIDE: IconCollection = {
  name: "Lucide",
  license: "ISC",
  license_url: "https://github.com/lucide-icons/lucide/blob/main/LICENSE",
  author: "Lucide Contributors",
  multicolor: false,
};

export class IconLibrary {
  private readonly memory = new Map<string, IconData>();
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  readonly wvl: WorldVectorLogo;

  constructor(
    private readonly ctx: Pick<AppContext, "storage" | "db" | "env" | "now">,
    private readonly log: FastifyBaseLogger,
    options: IconLibraryOptions = {},
  ) {
    this.fetchFn = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? ICONIFY_API).replace(/\/+$/, "");
    this.wvl = new WorldVectorLogo(ctx, log, options.wvl ?? {});
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (res.status === 404) return { not_found: ["*"] } as T;
    if (!res.ok) throw new Error(`Iconify ${res.status}`);
    return (await res.json()) as T;
  }

  private cacheKey(prefix: string, name: string): string {
    return `cache/iconify/${prefix}/${name}.json`;
  }

  /**
   * Nomlar (`lucide:bell`, `mdi:bell`) → geometriya. Topilmagani — SPEC_INVALID (icons_search'ga ishora);
   * Iconify'ga ulanib bo'lmasa (va keshda yo'q) — SYS_INTERNAL (qayta urinsa bo'ladi).
   */
  async resolve(names: readonly string[]): Promise<Result<Record<string, IconData>>> {
    const out: Record<string, IconData> = {};
    const missing = new Map<string, string[]>();
    for (const full of new Set(names)) {
      const { prefix, name } = iconRef(full);
      const key = `${prefix}:${name}`;
      if (!PART.test(prefix) || !PART.test(name)) {
        return fail("SPEC_INVALID", `Ikonka nomi noto'g'ri: ${full} (icons_search)`);
      }
      if (prefix === "lucide") {
        const icon = lucideIcon(name);
        if (icon === null) {
          return fail("SPEC_INVALID", `Lucide ikonka topilmadi: ${full} (icons_search)`);
        }
        out[key] = icon;
        continue;
      }
      if (prefix === WVL_PREFIX) {
        const logo = await this.wvl.logo(name);
        if (!logo.ok) return logo;
        out[key] = logo.data;
        continue;
      }
      const cached = this.memory.get(key) ?? (await this.fromStorage(prefix, name));
      if (cached !== null) {
        out[key] = cached;
        continue;
      }
      missing.set(prefix, [...(missing.get(prefix) ?? []), name]);
    }
    for (const [prefix, list] of missing) {
      let json: IconifyJson;
      try {
        json = await this.getJson<IconifyJson>(
          `/${encodeURIComponent(prefix)}.json?icons=${list.map(encodeURIComponent).join(",")}`,
        );
      } catch (error) {
        this.log.warn({ err: error, prefix }, "Iconify'dan ikonka olib bo'lmadi");
        return fail(
          "SYS_INTERNAL",
          `Iconify'ga ulanib bo'lmadi (${prefix}:${list.join(", ")}): keyinroq urining yoki lucide ikonkasini tanlang`,
        );
      }
      for (const name of list) {
        const data = json.icons === undefined ? null : getIconData(json, name);
        if (data === null) {
          return fail("SPEC_INVALID", `Iconify ikonka topilmadi: ${prefix}:${name} (icons_search)`);
        }
        if (ANIMATED.test(data.body)) {
          return fail(
            "SPEC_INVALID",
            `${prefix}:${name} — animatsiyali SVG (AE'da statik, chala chiqadi): boshqa to'plamdan tanlang`,
          );
        }
        const icon = normalizeIcon(data);
        out[`${prefix}:${name}`] = icon;
        this.memory.set(`${prefix}:${name}`, icon);
        await this.ctx.storage
          .putBytes(
            this.cacheKey(prefix, name),
            Buffer.from(JSON.stringify(icon)),
            "application/json",
          )
          .catch((error: unknown) =>
            this.log.warn({ err: error }, "ikonka keshini yozib bo'lmadi"),
          );
      }
    }
    return ok(out);
  }

  private async fromStorage(prefix: string, name: string): Promise<IconData | null> {
    try {
      const raw = await this.ctx.storage.getBytes(this.cacheKey(prefix, name));
      if (raw === null) return null;
      const icon = JSON.parse(raw.toString("utf8")) as IconData;
      if (typeof icon.body !== "string" || !(icon.width > 0) || !(icon.height > 0)) return null;
      this.memory.set(`${prefix}:${name}`, icon);
      return icon;
    } catch {
      return null;
    }
  }

  /**
   * Qidiruv: Lucide (lokal, chiziqli UI ikonkalari) birinchi, keyin Iconify (`prefix` — bitta to'plam,
   * masalan `simple-icons` brend logolari). Iconify ishlamasa Lucide natijalari ogohlantirish bilan.
   */
  async search(
    query: string,
    limit: number,
    options: { source?: IconSource; prefix?: string } = {},
  ): Promise<IconSearchResult> {
    const source = options.source ?? "all";
    const prefix = options.prefix;
    const collections: Record<string, IconCollection> = {};
    if (source === "worldvectorlogo" || prefix === WVL_PREFIX) {
      const found = await this.wvl.search(query, limit);
      if (!found.ok) {
        return { icons: [], collections, warning: found.error.message ?? found.error.code };
      }
      if (found.data.length > 0) collections[WVL_PREFIX] = WVL;
      return { icons: found.data.map((logo) => logo.name), collections, logos: found.data };
    }
    const withLucide = (source !== "iconify" && prefix === undefined) || prefix === "lucide";
    const lucideHits = withLucide ? searchLucide(query, limit) : [];
    if (lucideHits.length > 0) collections.lucide = LUCIDE;
    if (source === "lucide" || prefix === "lucide" || query.trim() === "") {
      return { icons: lucideHits, collections };
    }
    // Lucide birinchi, lekin limitning yarmi Iconify'ga qoladi (bo'sh joy oxirida yana Lucide bilan to'ladi).
    const icons = lucideHits.slice(0, source === "all" ? Math.ceil(limit / 2) : 0);
    const finish = () => {
      for (const name of lucideHits) {
        if (icons.length >= limit) break;
        if (!icons.includes(name)) icons.push(name);
      }
      return icons;
    };
    try {
      const params = new URLSearchParams({
        query,
        // API: limit 32 … 999.
        limit: String(Math.max(32, Math.min(999, limit * 2))),
      });
      if (prefix !== undefined) params.set("prefix", prefix);
      const res = await this.getJson<SearchResponse>(`/search?${params.toString()}`);
      for (const name of res.icons ?? []) {
        if (icons.length >= limit) break;
        const set = iconRef(name).prefix;
        if (ANIMATED_SETS.has(set) || icons.includes(name) || lucideHits.includes(name)) continue;
        icons.push(name);
        const info = res.collections?.[set];
        if (collections[set] === undefined && info !== undefined) {
          collections[set] = {
            name: info.name ?? set,
            license: info.license?.spdx ?? info.license?.title ?? null,
            license_url: info.license?.url ?? null,
            author: info.author?.name ?? null,
            multicolor: info.palette === true,
          };
        }
      }
      return { icons: finish(), collections };
    } catch (error) {
      this.log.warn({ err: error }, "Iconify qidiruvi ishlamadi");
      return {
        icons: finish(),
        collections,
        warning: "Iconify'ga ulanib bo'lmadi: faqat Lucide natijalari",
      };
    }
  }
}
