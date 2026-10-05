/**
 * Loyihalar (§5 `projects`): panel ish papkasini tanlaganda ro'yxatdan o'tkazadi (qurilma tokeni bilan).
 * Bir qurilmadagi bir papka = bitta loyiha. Kabinet o'z loyihalarini ko'radi.
 */
import { fail, ok, resolveInsideRoot } from "@aes/shared";
import type { Result } from "@aes/shared";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/session";
import type { AppContext } from "../context";
import { projects } from "../db/schema";
import { authenticateDevice } from "../devices/routes";

export type ProjectRow = typeof projects.$inferSelect;

/** Ish papkasi absolyut yo'l bo'lishi kerak (Windows `C:/...` yoki POSIX `/...`). */
export function normalizeRootPath(input: string): string | null {
  const slashed = input.trim().replace(/\\/g, "/");
  // Disk ildizi (`C:\`) o'z holicha qoladi; qolganlarida oxirgi `/` olib tashlanadi.
  if (/^[A-Za-z]:\/?$/.test(slashed)) return `${slashed.slice(0, 2)}/`;
  const value = slashed.replace(/\/+$/, "");
  if (!/^([A-Za-z]:\/|\/)/.test(value)) return null;
  if (value.split("/").some((part) => part === "..")) return null;
  return value;
}

/** Loyiha ichidagi nisbiy yo'l → absolyut (server tomoni himoyasi, §4.4). */
export function resolveProjectPath(
  project: Pick<ProjectRow, "rootPath">,
  rel: string,
): Result<string> {
  return resolveInsideRoot(project.rootPath, rel);
}

const registerSchema = z.strictObject({
  root_path: z.string().min(2).max(1024),
  name: z.string().trim().min(1).max(200).optional(),
});

function present(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    root_path: row.rootPath,
    device_id: row.deviceId,
    created_at: row.createdAt,
  };
}

export function registerProjectRoutes(app: FastifyInstance, ctx: AppContext): void {
  const deviceAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    request.device = await authenticateDevice(ctx, request.headers.authorization);
    if (request.device === null) {
      await reply.code(401).send(fail("AUTH_DEVICE_REVOKED", "Qurilma tokeni yaroqsiz"));
    }
  };

  app.post("/api/agent/projects", { preHandler: deviceAuth }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "root_path kerak"));
    const rootPath = normalizeRootPath(parsed.data.root_path);
    if (rootPath === null) {
      return reply
        .code(400)
        .send(fail("ENV_NO_FOLDER", "Ish papkasi absolyut yo'l bo'lishi kerak"));
    }
    const device = request.device!;
    const [existing] = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.deviceId, device.deviceId), eq(projects.rootPath, rootPath)))
      .limit(1);
    if (existing !== undefined) return ok(present(existing));
    const name = parsed.data.name ?? rootPath.split("/").filter(Boolean).pop() ?? "loyiha";
    const [created] = await ctx.db
      .insert(projects)
      .values({ userId: device.userId, deviceId: device.deviceId, name, rootPath })
      .returning();
    return ok(present(created!));
  });

  app.get("/api/agent/projects", { preHandler: deviceAuth }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(projects)
      .where(eq(projects.deviceId, request.device!.deviceId))
      .orderBy(desc(projects.createdAt))
      .limit(20);
    return ok(rows.map(present));
  });

  app.get("/api/projects", { preHandler: requireUser }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(projects)
      .where(eq(projects.userId, request.user!.id))
      .orderBy(desc(projects.createdAt));
    return ok(rows.map(present));
  });
}
