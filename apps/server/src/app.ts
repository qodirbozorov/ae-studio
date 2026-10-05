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
import { registerDeviceRoutes } from "./devices/routes";
import type { Env } from "./env";
import { registerHealth } from "./health";
import type { RedisLike } from "./redis";
import { findWebDist, isSpaRequest, registerWeb } from "./web";
import { AgentHub } from "./ws/hub";
import { registerAgentSocket } from "./ws/routes";

declare module "fastify" {
  interface FastifyInstance {
    /** Ulangan panellar markazi (testlar va keyingi modullar uchun). */
    hub: AgentHub;
  }
}

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
  const webRoot = findWebDist(deps.env.WEB_DIST);
  app.setNotFoundHandler((request, reply) => {
    // SPA: kabinet sahifalari (`/device?code=…`) index.html ga; API yo'llari — 404 (§8 formatida).
    if (webRoot !== null && isSpaRequest(request)) return reply.sendFile("index.html");
    return reply.code(404).send(fail("SYS_NOT_FOUND", `${request.method} ${request.url}`));
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

  const now = deps.now ?? (() => new Date());
  const hub = new AgentHub(deps.db, app.log, now);
  app.decorate("hub", hub);
  const ctx: AppContext = {
    hub,
    env: deps.env,
    db: deps.db,
    redis: deps.redis,
    now,
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

  if (webRoot !== null) await registerWeb(app, webRoot);
  registerHealth(app, deps);
  registerAuthRoutes(app, ctx);
  registerDeviceRoutes(app, ctx);
  registerAgentSocket(app, ctx, hub);
  app.addHook("onClose", async () => hub.close());

  return app;
}
