/**
 * Panel ↔ server device flow (§4.2, RFC 8628).
 * 1) panel `POST /oauth/device/code` → `user_code` (6 belgi) + `device_code`;
 * 2) user kabinetda (`/device`) kodni tasdiqlaydi → `POST /api/devices/confirm`;
 * 3) panel `POST /oauth/device/token` ni poll qiladi → uzoq muddatli `device_token`.
 */
import { randomInt } from "node:crypto";
import { audit } from "../audit";
import { fail, ok } from "@aes/shared";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/session";
import { consumeToken, findActiveToken, issueToken } from "../auth/tokens";
import type { AppContext } from "../context";
import { devices, jobEvents, jobs, oauthTokens, ops, projects } from "../db/schema";

export const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
export const POLL_INTERVAL_S = 5;
export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** Adashtiradigan belgilarsiz (0/O, 1/I/L, U/V ...). */
const USER_CODE_ALPHABET = "BCDFGHJKMNPQRSTWXYZ23456789";

export function newUserCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  return code;
}

/** Foydalanuvchi kiritgan kodni normallashtiradi: `abc-123 ` → `ABC123`. */
export function normalizeUserCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

interface DeviceCodeData extends Record<string, unknown> {
  user_code: string;
  status: "pending" | "approved" | "denied";
  device_name: string;
  os: string;
  last_poll_at?: number;
}

const codeRequestSchema = z.strictObject({
  device_name: z.string().trim().min(1).max(100),
  os: z.string().trim().min(1).max(100),
});

const tokenRequestSchema = z.object({
  grant_type: z.literal(DEVICE_GRANT),
  device_code: z.string().min(16).max(200),
});

const confirmSchema = z.strictObject({
  user_code: z.string().min(4).max(20),
  approve: z.boolean(),
});

/** RFC 8628 xato javobi (`{ error }`). */
function oauthError(reply: FastifyReply, status: number, error: string, description?: string) {
  return reply.code(status).send({ error, error_description: description });
}

export function registerDeviceRoutes(app: FastifyInstance, ctx: AppContext): void {
  async function findPendingByUserCode(userCode: string) {
    const [row] = await ctx.db
      .select()
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.kind, "device_code"),
          isNull(oauthTokens.revokedAt),
          sql`${oauthTokens.data}->>'user_code' = ${userCode}`,
          // Date parametri ustun tipi orqali (raw sql ichida postgres.js uni serializatsiya qilmaydi).
          gt(oauthTokens.expiresAt, ctx.now()),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  // ---------------------------------------------------------------- panel tomoni (autentifikatsiyasiz)

  app.post("/oauth/device/code", async (request, reply) => {
    const parsed = codeRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return oauthError(reply, 400, "invalid_request", "device_name va os kerak");
    // user_code takrorlanmasligi (faol kodlar orasida) uchun bir necha urinish.
    let userCode = newUserCode();
    for (
      let attempt = 0;
      attempt < 5 && (await findPendingByUserCode(userCode)) !== null;
      attempt++
    ) {
      userCode = newUserCode();
    }
    const data: DeviceCodeData = {
      user_code: userCode,
      status: "pending",
      device_name: parsed.data.device_name,
      os: parsed.data.os,
    };
    const { token } = await issueToken(ctx.db, {
      kind: "device_code",
      ttlMs: DEVICE_CODE_TTL_MS,
      now: ctx.now(),
      data,
    });
    const verificationUri = `${ctx.env.PUBLIC_URL}/device`;
    return {
      device_code: token,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}?code=${userCode}`,
      expires_in: DEVICE_CODE_TTL_MS / 1000,
      interval: POLL_INTERVAL_S,
    };
  });

  app.post("/oauth/device/token", async (request, reply) => {
    const parsed = tokenRequestSchema.safeParse(request.body);
    if (!parsed.success) return oauthError(reply, 400, "invalid_request");
    const now = ctx.now();
    const row = await findActiveToken(ctx.db, "device_code", parsed.data.device_code, now);
    if (row === null)
      return oauthError(reply, 400, "expired_token", "Kod eskirgan, qaytadan boshlang");
    const data = row.data as DeviceCodeData;

    if (data.status === "denied") {
      await consumeToken(ctx.db, "device_code", parsed.data.device_code, now);
      return oauthError(reply, 400, "access_denied", "Foydalanuvchi rad etdi");
    }
    if (data.status === "pending") {
      const tooFast =
        data.last_poll_at !== undefined &&
        now.getTime() - data.last_poll_at < POLL_INTERVAL_S * 1000;
      await ctx.db
        .update(oauthTokens)
        .set({ data: { ...data, last_poll_at: now.getTime() } })
        .where(eq(oauthTokens.id, row.id));
      return oauthError(reply, 400, tooFast ? "slow_down" : "authorization_pending");
    }

    // approved: kod bir martalik — atomar iste'mol qilinadi.
    const consumed = await consumeToken(ctx.db, "device_code", parsed.data.device_code, now);
    if (consumed === null || consumed.userId === null)
      return oauthError(reply, 400, "expired_token");
    const [device] = await ctx.db
      .insert(devices)
      .values({ userId: consumed.userId, name: data.device_name, os: data.os, lastSeenAt: now })
      .returning();
    const { token } = await issueToken(ctx.db, {
      kind: "device",
      ttlMs: null,
      now,
      userId: consumed.userId,
      deviceId: device!.id,
    });
    return { access_token: token, token_type: "Bearer", device_id: device!.id };
  });

  // ---------------------------------------------------------------- kabinet tomoni (sessiya)

  app.get("/api/devices/pending", { preHandler: requireUser }, async (request, reply) => {
    const code = normalizeUserCode(String((request.query as { code?: unknown }).code ?? ""));
    const row = await findPendingByUserCode(code);
    const data = row?.data as DeviceCodeData | undefined;
    if (data === undefined || data.status !== "pending") {
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Kod topilmadi yoki eskirgan"));
    }
    return ok({ user_code: code, device_name: data.device_name, os: data.os });
  });

  app.post("/api/devices/confirm", { preHandler: requireUser }, async (request, reply) => {
    const parsed = confirmSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send(fail("SYS_BAD_REQUEST", "user_code va approve kerak"));
    const code = normalizeUserCode(parsed.data.user_code);
    const row = await findPendingByUserCode(code);
    const data = row?.data as DeviceCodeData | undefined;
    if (row === null || data === undefined || data.status !== "pending") {
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Kod topilmadi yoki eskirgan"));
    }
    await ctx.db
      .update(oauthTokens)
      .set({
        userId: request.user!.id,
        data: { ...data, status: parsed.data.approve ? "approved" : "denied" },
      })
      .where(eq(oauthTokens.id, row.id));
    await audit(ctx, request.log, {
      userId: request.user!.id,
      actor: "user",
      action: parsed.data.approve ? "device.approved" : "device.denied",
      target: data.device_name,
      ip: request.ip,
    });
    return ok({
      status: parsed.data.approve ? "approved" : "denied",
      device_name: data.device_name,
    });
  });

  /** Qurilmadagi oxirgi job: holat, loyiha va op'lar bo'yicha progress. */
  const latestJob = async (deviceId: string) => {
    const [job] = await ctx.db
      .select({
        id: jobs.id,
        state: jobs.state,
        outcome: jobs.outcome,
        paused: jobs.paused,
        project: projects.name,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .innerJoin(projects, eq(projects.id, jobs.projectId))
      .where(eq(jobs.deviceId, deviceId))
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    if (job === undefined) return null;
    const counts = await ctx.db
      .select({ status: ops.status, n: sql<number>`count(*)::int` })
      .from(ops)
      .where(eq(ops.jobId, job.id))
      .groupBy(ops.status);
    const total = counts.reduce((sum, c) => sum + Number(c.n), 0);
    const done = counts.filter((c) => c.status === "done").reduce((s, c) => s + Number(c.n), 0);
    return {
      id: job.id,
      state: job.state,
      outcome: job.outcome,
      paused: job.paused,
      project: job.project,
      updated_at: job.updatedAt,
      progress: total === 0 ? null : Math.round((done / total) * 100),
    };
  };

  const present = async (d: typeof devices.$inferSelect) => {
    const live = ctx.hub.state(d.id);
    return {
      id: d.id,
      name: d.name,
      os: d.os,
      ae_version: live?.aeVersion ?? d.aeVersion,
      last_seen_at: d.lastSeenAt,
      revoked_at: d.revokedAt,
      created_at: d.createdAt,
      online: live !== null,
      panel_version: live?.panelVersion ?? null,
      project_root: live?.projectRoot ?? null,
      project_path: live?.projectPath ?? null,
      ffmpeg: live?.ffmpeg ?? null,
      job: d.revokedAt === null ? await latestJob(d.id) : null,
    };
  };

  app.get("/api/devices", { preHandler: requireUser }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(devices)
      .where(eq(devices.userId, request.user!.id))
      .orderBy(desc(devices.createdAt));
    return ok(await Promise.all(rows.map(present)));
  });

  /** Qurilma faolligi: jonli holat, oxirgi job'lar va hodisalar lentasi. */
  app.get("/api/devices/:id/activity", { preHandler: requireUser }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!z.uuid().safeParse(id).success) return reply.code(404).send(fail("SYS_NOT_FOUND"));
    const [device] = await ctx.db
      .select()
      .from(devices)
      .where(and(eq(devices.id, id), eq(devices.userId, request.user!.id)));
    if (device === undefined)
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Qurilma topilmadi"));
    const recent = await ctx.db
      .select({
        id: jobs.id,
        state: jobs.state,
        outcome: jobs.outcome,
        project: projects.name,
        created_at: jobs.createdAt,
      })
      .from(jobs)
      .innerJoin(projects, eq(projects.id, jobs.projectId))
      .where(eq(jobs.deviceId, id))
      .orderBy(desc(jobs.createdAt))
      .limit(10);
    const events = await ctx.db
      .select({
        ts: jobEvents.ts,
        level: jobEvents.level,
        type: jobEvents.type,
        message: jobEvents.message,
        op_id: jobEvents.opId,
        job_id: jobEvents.jobId,
        project: projects.name,
      })
      .from(jobEvents)
      .innerJoin(jobs, eq(jobs.id, jobEvents.jobId))
      .innerJoin(projects, eq(projects.id, jobs.projectId))
      .where(and(eq(jobs.deviceId, id), sql`${jobEvents.level} <> 'debug'`))
      .orderBy(desc(jobEvents.id))
      .limit(120);
    return ok({ device: await present(device), jobs: recent, events });
  });

  app.post("/api/devices/:id/revoke", { preHandler: requireUser }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!z.uuid().safeParse(id).success) return reply.code(404).send(fail("SYS_NOT_FOUND"));
    const now = ctx.now();
    const [device] = await ctx.db
      .update(devices)
      .set({ revokedAt: now })
      .where(and(eq(devices.id, id), eq(devices.userId, request.user!.id)))
      .returning();
    if (device === undefined)
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Qurilma topilmadi"));
    await ctx.db
      .update(oauthTokens)
      .set({ revokedAt: now })
      .where(and(eq(oauthTokens.deviceId, id), isNull(oauthTokens.revokedAt)));
    ctx.hub.kick(id);
    await audit(ctx, request.log, {
      userId: request.user!.id,
      actor: "user",
      action: "device.revoked",
      target: device.name,
      ip: request.ip,
      data: { device_id: id },
    });
    return ok({ revoked: true });
  });
}

export interface DeviceIdentity {
  userId: string;
  deviceId: string;
}

/** WS ulanishida `Authorization: Bearer <device_token>` ni tekshiradi (P2.05). */
export async function authenticateDevice(
  ctx: Pick<AppContext, "db" | "now">,
  header: string | undefined,
): Promise<DeviceIdentity | null> {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (token === "") return null;
  const row = await findActiveToken(ctx.db, "device", token, ctx.now());
  if (row === null || row.userId === null || row.deviceId === null) return null;
  const [device] = await ctx.db.select().from(devices).where(eq(devices.id, row.deviceId)).limit(1);
  if (device === undefined || device.revokedAt !== null) return null;
  return { userId: row.userId, deviceId: row.deviceId };
}
