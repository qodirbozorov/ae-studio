import { fail } from "@aes/shared";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { FastifyError, FastifyInstance } from "fastify";
import { ConsoleMailer, ResendMailer } from "./auth/mailer";
import type { Mailer } from "./auth/mailer";
import { registerAuthRoutes } from "./auth/routes";
import { loadSession } from "./auth/session";
import type { AppContext } from "./context";
import type { Db } from "./db/client";
import type { Env } from "./env";
import { registerHealth } from "./health";
import type { RedisLike } from "./redis";
import { registerDevAgent } from "./ws/dev-agent";

export interface AppDeps {
  env: Env;
  db: Db;
  redis: RedisLike;
  /** Berilmasa: RESEND_API_KEY bo'lsa Resend, aks holda log (dev). */
  mailer?: Mailer;
  now?: () => Date;
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

  const ctx: AppContext = {
    env: deps.env,
    db: deps.db,
    redis: deps.redis,
    now: deps.now ?? (() => new Date()),
    mailer:
      deps.mailer ??
      (deps.env.RESEND_API_KEY !== undefined
        ? new ResendMailer(deps.env.RESEND_API_KEY, deps.env.MAIL_FROM)
        : new ConsoleMailer(app.log)),
  };

  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 16 * 1024 * 1024 } });

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/api/")) await loadSession(ctx, request);
  });

  registerHealth(app, deps);
  registerAuthRoutes(app, ctx);

  // P1.13: faqat DEV_AGENT_TOKEN berilganda (P2.05 da device flow bilan almashtiriladi).
  if (deps.env.DEV_AGENT_TOKEN !== undefined) {
    await registerDevAgent(app, deps.env.DEV_AGENT_TOKEN);
  }

  return app;
}
