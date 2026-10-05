/**
 * Shablonlar registri (§11.2): tizim kutubxonasi (`library.ts`) + `templates` jadvali (umumiy `user_id = null`
 * va foydalanuvchi shablonlari, versiyalar bilan). Foydalanuvchi shablonining slug'i tizimnikini yopadi.
 *
 * `aep` shablon fayli server storage'ida (`u/<user>/templates/<sha256>.aep`); PREFLIGHT'da panelga
 * `templates/<slug>_v<n>.aep` ga yuklab qo'yiladi (sha256 bilan, versiyalar ustiga yozilmaydi).
 */
import { randomUUID } from "node:crypto";
import type { CompileTemplate } from "@aes/compiler";
import { fail, ok, parseTemplateManifest } from "@aes/shared";
import type { Result, TemplateManifest, TemplateManifestInput, VideoSpec } from "@aes/shared";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { AppContext } from "../context";
import { templates } from "../db/schema";
import { BUILTIN_TEMPLATES } from "./library";

export type TemplateOrigin = "builtin" | "system" | "user";

export interface TemplateEntry {
  id: string | null;
  slug: string;
  version: number;
  origin: TemplateOrigin;
  manifest: TemplateManifest;
  createdAt: string | null;
}

const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export function templateLocalPath(slug: string, version: number): string {
  return `templates/${slug}_v${version}.aep`;
}

export function templateStorageKey(userId: string, sha256: string, ext: string): string {
  return `u/${userId}/templates/${sha256}.${ext}`;
}

export class TemplateService {
  constructor(private readonly ctx: AppContext) {}

  private async rows(userId: string, slug?: string) {
    const owner = or(eq(templates.userId, userId), isNull(templates.userId));
    return this.ctx.db
      .select()
      .from(templates)
      .where(slug === undefined ? owner : and(owner, eq(templates.slug, slug)))
      .orderBy(desc(templates.version));
  }

  private entry(row: Awaited<ReturnType<TemplateService["rows"]>>[number]): TemplateEntry | null {
    const parsed = parseTemplateManifest(row.manifest);
    if (!parsed.ok) return null;
    return {
      id: row.id,
      slug: row.slug,
      version: row.version,
      origin: row.userId === null ? "system" : "user",
      manifest: parsed.data,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Har slug bo'yicha eng ustun yozuv: foydalanuvchi > umumiy (DB) > tizim kutubxonasi; oxirgi versiya. */
  async list(userId: string): Promise<TemplateEntry[]> {
    const best = new Map<string, TemplateEntry>();
    for (const manifest of BUILTIN_TEMPLATES) {
      best.set(manifest.slug, {
        id: null,
        slug: manifest.slug,
        version: 1,
        origin: "builtin",
        manifest,
        createdAt: null,
      });
    }
    const rank = { builtin: 0, system: 1, user: 2 } as const;
    for (const row of await this.rows(userId)) {
      const entry = this.entry(row);
      if (entry === null) continue;
      const current = best.get(entry.slug);
      if (
        current === undefined ||
        rank[entry.origin] > rank[current.origin] ||
        (rank[entry.origin] === rank[current.origin] && entry.version > current.version)
      ) {
        best.set(entry.slug, entry);
      }
    }
    return [...best.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async get(userId: string, slug: string, version?: number): Promise<TemplateEntry | null> {
    if (version !== undefined) {
      const row = (await this.rows(userId, slug)).find((r) => r.version === version);
      if (row !== undefined) return this.entry(row);
      const builtin = BUILTIN_TEMPLATES.find((m) => m.slug === slug);
      return builtin !== undefined && version === 1
        ? { id: null, slug, version: 1, origin: "builtin", manifest: builtin, createdAt: null }
        : null;
    }
    return (await this.list(userId)).find((entry) => entry.slug === slug) ?? null;
  }

  /** Foydalanuvchi shabloni: yangi versiya (avvalgilari o'zgarmaydi). */
  async save(userId: string, input: TemplateManifestInput): Promise<Result<TemplateEntry>> {
    const parsed = parseTemplateManifest(input);
    if (!parsed.ok) return parsed;
    const manifest = parsed.data;
    if (manifest.source === "aep" && manifest.files?.aep === undefined) {
      return fail("SYS_BAD_REQUEST", "aep shablonining fayli (files.aep) yo'q");
    }
    const [last] = await this.ctx.db
      .select({ version: templates.version })
      .from(templates)
      .where(and(eq(templates.userId, userId), eq(templates.slug, manifest.slug)))
      .orderBy(desc(templates.version))
      .limit(1);
    const [row] = await this.ctx.db
      .insert(templates)
      .values({
        userId,
        slug: manifest.slug,
        manifest,
        version: (last?.version ?? 0) + 1,
      })
      .returning();
    return ok(this.entry(row!)!);
  }

  /** Spec'dagi shablonlar compiler uchun (topilmagani — compiler SPEC_UNKNOWN_TEMPLATE beradi). */
  async forSpec(userId: string, spec: VideoSpec): Promise<Record<string, CompileTemplate>> {
    const slugs = new Set(spec.scenes.flatMap((scene) => scene.template ?? []));
    const out: Record<string, CompileTemplate> = {};
    if (slugs.size === 0) return out;
    const all = await this.list(userId);
    for (const entry of all) {
      if (!slugs.has(entry.slug)) continue;
      out[entry.slug] = {
        manifest: entry.manifest,
        version: entry.version,
        ...(entry.manifest.files?.aep === undefined
          ? {}
          : { file: templateLocalPath(entry.slug, entry.version) }),
      };
    }
    return out;
  }

  /** Aep shablon fayllarini panelga yuklab qo'yadi (bor bo'lsa sha256 bo'yicha "saqlangan"). */
  async deliver(
    deviceId: string,
    used: Record<string, CompileTemplate>,
  ): Promise<Result<{ files: string[] }>> {
    const files: string[] = [];
    for (const template of Object.values(used)) {
      const aep = template.manifest.files?.aep;
      if (template.file === undefined || aep === undefined) continue;
      const reply = await this.ctx.hub.request(
        deviceId,
        {
          type: "file.download",
          request_id: randomUUID(),
          url: await this.ctx.storage.presignGet(aep.storage_key),
          sha256: aep.sha256,
          dest: template.file,
          size: aep.size,
        },
        DOWNLOAD_TIMEOUT_MS,
      );
      if (!reply.ok) return reply;
      files.push(template.file);
    }
    return ok({ files });
  }

  /** Preview (gif/png) uchun vaqtinchalik havola. */
  async previewUrl(entry: TemplateEntry): Promise<string | null> {
    const preview = entry.manifest.files?.preview;
    return preview === undefined ? null : this.ctx.storage.presignGet(preview.storage_key);
  }
}
