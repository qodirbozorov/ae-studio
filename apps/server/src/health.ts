import { fail, ok } from "@aes/shared";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "./app";
import { withTimeout } from "./lib/timeout";
import { SERVER_VERSION } from "./version";

const CHECK_TIMEOUT_MS = 2_000;

type CheckStatus = "ok" | "error";

/** `/health`: DB va Redis'ni timeout bilan tekshiradi. Hammasi ok → 200, aks holda 503. */
export function registerHealth(app: FastifyInstance, deps: AppDeps): void {
  async function check(label: string, run: () => Promise<unknown>): Promise<CheckStatus> {
    try {
      await withTimeout(run(), CHECK_TIMEOUT_MS, label);
      return "ok";
    } catch (error) {
      app.log.warn({ err: error, check: label }, "health tekshiruvi muvaffaqiyatsiz");
      return "error";
    }
  }

  app.get("/health", async (_request, reply) => {
    const [db, redis] = await Promise.all([
      check("db", () => deps.db.execute(sql`select 1`)),
      check("redis", () => deps.redis.ping()),
    ]);
    const data = {
      status: db === "ok" && redis === "ok" ? "ok" : "degraded",
      db,
      redis,
      version: SERVER_VERSION,
      uptime_s: Math.round(process.uptime()),
    };
    if (data.status === "ok") return ok(data);
    reply.code(503);
    return fail("SYS_INTERNAL", `health: db=${db}, redis=${redis}`, data);
  });
}
