import { fail } from "@aes/shared";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { FastifyError, FastifyInstance } from "fastify";
import { registerAssetRoutes } from "./assets/routes";
import { ConsoleMailer, ResendMailer } from "./auth/mailer";
import type { Mailer } from "./auth/mailer";
import { registerAuthRoutes } from "./auth/routes";
import { loadSession } from "./auth/session";
import type { AppContext } from "./context";
import type { Db } from "./db/client";
import { registerDeviceRoutes } from "./devices/routes";
import type { Env } from "./env";
import type { MetadataFetcher } from "./oauth/clients";
import { registerOAuthRoutes } from "./oauth/routes";
import { registerProjectRoutes } from "./projects/routes";
import { registerHealth } from "./health";
import { JobEngine } from "./jobs/engine";
import { registerLive } from "./jobs/live";
import { ClaudePresence } from "./mcp/presence";
import { registerMcpRoutes } from "./mcp/routes";
import { registerJobRoutes } from "./jobs/routes";
import type { RedisLike } from "./redis";
import { LocalStorage, createStorage } from "./storage";
import type { Storage } from "./storage";
import { findWebDist, isSpaRequest, registerWeb } from "./web";
import { AgentHub } from "./ws/hub";
import { registerAgentSocket } from "./ws/routes";

declare module "fastify" {
  interface FastifyInstance {
    /** Ulangan panellar markazi (testlar va keyingi modullar uchun). */
    hub: AgentHub;
    storage: Storage;
    jobs: JobEngine;
  }
}

export interface AppDeps {
  env: Env;
  db: Db;
  redis: RedisLike;
  /** Berilmasa: RESEND_API_KEY bo'lsa Resend, aks holda log (dev). */
  mailer?: Mailer;
  now?: () => Date;
  /** Berilmasa env bo'yicha (S3 yoki lokal). */
  storage?: Storage;
  /** OAuth CIMD hujjatlarini olish (testlar uchun). */
  oauthFetcher?: MetadataFetcher;
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
  const storage = deps.storage ?? createStorage(deps.env, app.log, now);
  app.decorate("storage", storage);
  const ctx: AppContext = {
    hub,
    storage,
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
  // OAuth token/revoke va ruxsat formasi (RFC 6749: application/x-www-form-urlencoded).
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 64 * 1024 },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    },
  );
  await app.register(websocket, { options: { maxPayload: 16 * 1024 * 1024 } });

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/api/")) await loadSession(ctx, request);
  });

  if (webRoot !== null) await registerWeb(app, webRoot);
  if (storage instanceof LocalStorage) await storage.register(app);
  registerHealth(app, deps);
  registerAuthRoutes(app, ctx);
  registerOAuthRoutes(
    app,
    ctx,
    deps.oauthFetcher === undefined ? {} : { fetcher: deps.oauthFetcher },
  );
  registerDeviceRoutes(app, ctx);
  registerAgentSocket(app, ctx, hub);
  registerProjectRoutes(app, ctx);
  registerAssetRoutes(app, ctx);

  const engine = new JobEngine(ctx, app.log);
  app.decorate("jobs", engine);
  engine.attach();
  registerLive(ctx, engine, app.log);
  registerJobRoutes(app, ctx, engine);
  const presence = new ClaudePresence(ctx, app.log);
  presence.attach();
  registerMcpRoutes(app, ctx, engine, { onRequest: (userId) => presence.touch(userId) });
  app.addHook("onReady", async () => {
    // DB hali tayyor bo'lmasa server baribir ko'tariladi (health 503 ko'rsatadi).
    try {
      const resumed = await engine.recover();
      if (resumed > 0) app.log.info({ resumed }, "yakunlanmagan joblar davom ettirildi");
    } catch (error) {
      app.log.warn({ err: error }, "joblarni tiklab bo'lmadi");
    }
  });
  app.addHook("onClose", async () => {
    engine.stop();
    hub.close();
    await engine.idle();
  });

  return app;
}
