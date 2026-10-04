import { fail } from "@aes/shared";
import Fastify from "fastify";
import type { FastifyError, FastifyInstance } from "fastify";
import type { Db } from "./db/client";
import type { Env } from "./env";
import { registerHealth } from "./health";
import type { RedisLike } from "./redis";

export interface AppDeps {
  env: Env;
  db: Db;
  redis: RedisLike;
}

/** Fastify ilovasini yig'adi (tinglamaydi): testlar `app.inject()` bilan chaqiradi. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.env.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    // Railway proxy ortida: haqiqiy IP va protokol X-Forwarded-* dan.
    trustProxy: true,
    requestTimeout: 30_000,
  });

  // Barcha javoblar §8 formatida: { ok: false, error: { code, retryable, hint } }.
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send(fail("SYS_NOT_FOUND", `${request.method} ${request.url}`));
  });
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (error.validation !== undefined || (status >= 400 && status < 500)) {
      reply.code(status).send(fail("SYS_BAD_REQUEST", error.message));
      return;
    }
    request.log.error({ err: error }, "kutilmagan xato");
    reply.code(500).send(fail("SYS_INTERNAL"));
  });

  registerHealth(app, deps);

  return app;
}
