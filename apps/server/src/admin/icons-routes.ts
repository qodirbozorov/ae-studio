/**
 * Admin → Ikonkalar: WorldVectorLogo API kaliti (tekshirib, AES-256-GCM bilan `system_settings` ga), kredit
 * holati (`/account/usage`). Kalit hech qachon qaytarilmaydi — faqat `…abcd`.
 */
import { fail, ok } from "@aes/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit";
import type { AppContext } from "../context";
import { makeRequireAdmin } from "./auth";

export function registerAdminIconRoutes(
  app: FastifyInstance,
  ctx: Pick<AppContext, "env" | "db" | "now" | "icons"> & Partial<Pick<AppContext, "cluster">>,
): void {
  const requireAdmin = makeRequireAdmin(ctx);
  const changed = () => ctx.cluster?.broadcast({ t: "settings", key: "worldvectorlogo" });

  app.get("/api/admin/worldvectorlogo", { preHandler: requireAdmin }, async (request) => {
    const fresh = (request.query as { fresh?: string }).fresh === "1";
    return ok(await ctx.icons.wvl.adminView(fresh));
  });

  app.put("/api/admin/worldvectorlogo", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z
      .strictObject({ api_key: z.string().trim().min(8).max(300) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "api_key kerak"));
    const result = await ctx.icons.wvl.setKey(parsed.data.api_key, "admin");
    if (!result.ok) return reply.code(400).send(result);
    changed();
    await audit(ctx, request.log, {
      userId: null,
      actor: "admin",
      action: "admin.worldvectorlogo.key_set",
      target: result.data.masked,
      ip: request.ip,
    });
    return result;
  });

  app.delete("/api/admin/worldvectorlogo", { preHandler: requireAdmin }, async (request) => {
    const view = await ctx.icons.wvl.removeKey("admin");
    changed();
    await audit(ctx, request.log, {
      userId: null,
      actor: "admin",
      action: "admin.worldvectorlogo.key_removed",
      ip: request.ip,
    });
    return ok(view);
  });
}
