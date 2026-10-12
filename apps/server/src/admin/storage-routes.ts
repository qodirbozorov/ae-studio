/**
 * Admin → Storage: Railway volume va R2 sozlamasi, faol drayverni almashtirish va kichik fayl explorer
 * (papka bo'yicha ko'rish, yuklab olish, o'chirish, drayverlar orasida ko'chirish).
 */
import { fail, ok } from "@aes/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit";
import type { AppContext } from "../context";
import { isValidKey, isValidPrefix, mimeOf } from "../storage";
import type { StorageDriverName, SwitchStorage } from "../storage";
import type { StorageSettings } from "../storage/settings";
import { makeRequireAdmin } from "./auth";

/** Bitta papkani o'chirishda eng ko'p fayl (tasodifiy ommaviy o'chirishdan himoya). */
const FOLDER_DELETE_LIMIT = 5000;

export interface CopyStatus {
  running: boolean;
  from: StorageDriverName;
  to: StorageDriverName;
  prefix: string;
  total: number;
  copied: number;
  skipped: number;
  failed: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

const driverArg = z.enum(["local", "s3"]);

export function registerAdminStorageRoutes(
  app: FastifyInstance,
  ctx: Pick<AppContext, "env" | "db" | "now"> & Partial<Pick<AppContext, "cluster">>,
  storage: SwitchStorage,
  settings: StorageSettings,
): void {
  const requireAdmin = makeRequireAdmin(ctx);
  let copy: CopyStatus | null = null;

  const pick = (name: StorageDriverName) => storage.byName(name);
  const note = (action: string, data: unknown, ip: string) =>
    audit(ctx, app.log, { userId: null, actor: "admin", action, ip, data });
  /** Boshqa replikalar sozlamani darhol qayta o'qisin (P9.07; aks holda 30 s ichida). */
  const changed = () => ctx.cluster?.broadcast({ t: "settings", key: "storage" });

  app.get("/api/admin/storage", { preHandler: requireAdmin }, async () =>
    ok({ ...settings.view(), copy }),
  );

  app.put("/api/admin/storage/r2", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z
      .object({
        endpoint: z.url(),
        bucket: z.string().min(3).max(63),
        access_key_id: z.string().min(8).max(200),
        secret_access_key: z.string().max(500).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", parsed.error.message));
    const result = await settings.saveR2(parsed.data, "admin");
    if (!result.ok) return reply.code(400).send(result);
    changed();
    await note(
      "admin.storage.r2_saved",
      { endpoint: parsed.data.endpoint, bucket: parsed.data.bucket },
      request.ip,
    );
    return result;
  });

  app.delete("/api/admin/storage/r2", { preHandler: requireAdmin }, async (request) => {
    await note("admin.storage.r2_removed", null, request.ip);
    const removed = await settings.removeR2("admin");
    changed();
    return ok(removed);
  });

  app.put("/api/admin/storage/active", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({ driver: driverArg }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "driver: local | s3"));
    const result = await settings.setActive(parsed.data.driver, "admin");
    if (!result.ok) return reply.code(400).send(result);
    changed();
    await note("admin.storage.active", { driver: parsed.data.driver }, request.ip);
    return result;
  });

  app.get("/api/admin/storage/browse", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z
      .object({ driver: driverArg, prefix: z.string().default(""), cursor: z.string().optional() })
      .safeParse(request.query);
    if (!parsed.success || !isValidPrefix(parsed.data.prefix)) {
      return reply.code(400).send(fail("SYS_BAD_REQUEST", "driver yoki prefix noto'g'ri"));
    }
    const driver = pick(parsed.data.driver);
    if (driver === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "R2 sozlanmagan"));
    try {
      return ok(
        await driver.browse(parsed.data.prefix, {
          ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
        }),
      );
    } catch (error) {
      return reply
        .code(502)
        .send(fail("SYS_INTERNAL", error instanceof Error ? error.message : String(error)));
    }
  });

  const objectArg = z.object({ driver: driverArg, key: z.string().refine(isValidKey) });

  app.get("/api/admin/storage/download", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = objectArg.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send(fail("SYS_BAD_REQUEST", "driver yoki key noto'g'ri"));
    const driver = pick(parsed.data.driver);
    if (driver === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "R2 sozlanmagan"));
    return reply.redirect(await driver.presignGet(parsed.data.key, { ttlS: 300 }));
  });

  app.delete("/api/admin/storage/object", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = objectArg.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send(fail("SYS_BAD_REQUEST", "driver yoki key noto'g'ri"));
    const driver = pick(parsed.data.driver);
    if (driver === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "R2 sozlanmagan"));
    await driver.delete(parsed.data.key);
    await note("admin.storage.delete", parsed.data, request.ip);
    return ok({ deleted: 1 });
  });

  app.delete("/api/admin/storage/folder", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z
      .object({ driver: driverArg, prefix: z.string().min(2) })
      .safeParse(request.query);
    if (!parsed.success || !isValidPrefix(parsed.data.prefix)) {
      return reply.code(400).send(fail("SYS_BAD_REQUEST", "Papka (prefix) noto'g'ri"));
    }
    const driver = pick(parsed.data.driver);
    if (driver === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "R2 sozlanmagan"));
    const keys = await driver.list(parsed.data.prefix);
    if (keys.length > FOLDER_DELETE_LIMIT) {
      return reply
        .code(400)
        .send(
          fail(
            "SYS_BAD_REQUEST",
            `Papkada ${keys.length} fayl: ${FOLDER_DELETE_LIMIT} tadan ko'p o'chirilmaydi`,
          ),
        );
    }
    for (const key of keys) await driver.delete(key);
    await note("admin.storage.delete_folder", { ...parsed.data, count: keys.length }, request.ip);
    return ok({ deleted: keys.length });
  });

  /** Manbadagi fayllarni maqsadga ko'chiradi (maqsadda borlari o'tkaziladi); fonda, bittadan. */
  app.post("/api/admin/storage/copy", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z
      .object({ from: driverArg, to: driverArg, prefix: z.string().default("") })
      .safeParse(request.body);
    if (
      !parsed.success ||
      parsed.data.from === parsed.data.to ||
      !isValidPrefix(parsed.data.prefix)
    ) {
      return reply.code(400).send(fail("SYS_BAD_REQUEST", "from/to/prefix noto'g'ri"));
    }
    if (copy?.running === true)
      return reply.code(409).send(fail("JOB_ACTIVE", "Ko'chirish davom etyapti"));
    const source = pick(parsed.data.from);
    const target = pick(parsed.data.to);
    if (source === null || target === null) {
      return reply.code(404).send(fail("SYS_NOT_FOUND", "R2 sozlanmagan"));
    }
    const status: CopyStatus = {
      running: true,
      ...parsed.data,
      total: 0,
      copied: 0,
      skipped: 0,
      failed: 0,
      error: null,
      started_at: ctx.now().toISOString(),
      finished_at: null,
    };
    copy = status;
    await note("admin.storage.copy", parsed.data, request.ip);
    void (async () => {
      try {
        const keys = await source.list(parsed.data.prefix);
        status.total = keys.length;
        for (const key of keys) {
          try {
            if ((await target.head(key)) !== null) {
              status.skipped += 1;
              continue;
            }
            const bytes = await source.getBytes(key);
            if (bytes === null) {
              status.failed += 1;
              continue;
            }
            await target.putBytes(key, bytes, mimeOf(key));
            status.copied += 1;
          } catch {
            status.failed += 1;
          }
        }
      } catch (error) {
        status.error = error instanceof Error ? error.message : String(error);
      } finally {
        status.running = false;
        status.finished_at = ctx.now().toISOString();
      }
    })();
    return ok(status);
  });
}
