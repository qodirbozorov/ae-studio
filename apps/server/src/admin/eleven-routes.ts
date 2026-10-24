/**
 * Admin → Audio: markaziy ElevenLabs kaliti (tekshirib, AES-256-GCM bilan `system_settings` ga), obuna
 * kvotasi, qolgan kredit va joriy davr sarfi. Kalit hech qachon qaytarilmaydi — faqat `…abcd`.
 */
import { fail, ok } from "@aes/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit";
import type { AppContext } from "../context";
import { makeRequireAdmin } from "./auth";

export function registerAdminElevenRoutes(
  app: FastifyInstance,
  ctx: Pick<AppContext, "env" | "db" | "now" | "eleven"> & Partial<Pick<AppContext, "cluster">>,
): void {
  const requireAdmin = makeRequireAdmin(ctx);
  /** Boshqa replikalar keshni darhol tozalasin (aks holda 30 s ichida). */
  const changed = () => ctx.cluster?.broadcast({ t: "settings", key: "elevenlabs" });

  app.get("/api/admin/elevenlabs", { preHandler: requireAdmin }, async (request) => {
    const fresh = (request.query as { fresh?: string }).fresh === "1";
    return ok(await ctx.eleven.adminView(fresh));
  });

  app.put("/api/admin/elevenlabs", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z
      .strictObject({ api_key: z.string().trim().min(10).max(200) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "api_key kerak"));
    const result = await ctx.eleven.setSystemKey(parsed.data.api_key, "admin");
    if (!result.ok) return reply.code(400).send(result);
    changed();
    await audit(ctx, request.log, {
      userId: null,
      actor: "admin",
      action: "admin.elevenlabs.key_set",
      target: result.data.masked,
      ip: request.ip,
    });
    return result;
  });

  app.delete("/api/admin/elevenlabs", { preHandler: requireAdmin }, async (request) => {
    const view = await ctx.eleven.removeSystemKey("admin");
    changed();
    await audit(ctx, request.log, {
      userId: null,
      actor: "admin",
      action: "admin.elevenlabs.key_removed",
      ip: request.ip,
    });
    return ok(view);
  });
}
