import { fail } from "@aes/shared";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { FastifyBaseLogger, FastifyError, FastifyInstance } from "fastify";
import { MemoryCluster } from "./cluster";
import type { Cluster } from "./cluster";
import { registerAssetRoutes } from "./assets/routes";
import { audit, registerAuditRoutes } from "./audit";
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
import type { ElevenOptions } from "./eleven/client";
import { registerElevenRoutes } from "./eleven/routes";
import { ElevenService } from "./eleven/service";
import { registerAudioRoutes } from "./audio/routes";
import { AudioService, presentTask } from "./audio/service";
import { registerBillingRoutes } from "./billing/routes";
import { BillingService } from "./billing/service";
import { TariffService } from "./billing/tariffs";
import { registerAdminUserRoutes } from "./admin/users-routes";
import { registerAdminBillingRoutes } from "./admin/billing-routes";
import { MusicLibrary } from "./music/library";
import { registerJobRoutes } from "./jobs/routes";
import type { RedisLike } from "./redis";
import { LocalStorage, SwitchStorage, createStorage } from "./storage";
import { StorageSettings } from "./storage/settings";
import { registerAdminAuth } from "./admin/auth";
import { registerAdminStorageRoutes } from "./admin/storage-routes";
import { registerAdminElevenRoutes } from "./admin/eleven-routes";
import { registerAdminIconRoutes } from "./admin/icons-routes";
import { registerAdminImageRoutes } from "./admin/images-routes";
import { IconLibrary } from "./icons/library";
import type { IconLibraryOptions } from "./icons/library";
import { UnsplashService } from "./stock/unsplash";
import type { UnsplashOptions } from "./stock/unsplash";
import { registerAdminMusicRoutes } from "./admin/music-routes";
import type { Storage } from "./storage";
import { createLimiter } from "./lib/rate-limit";
import { findWebDist, isSpaRequest, registerWeb } from "./web";
import { projects } from "./db/schema";
import { eq } from "drizzle-orm";
import { AgentHub } from "./ws/hub";
import { TemplateService } from "./templates/service";
import { registerTemplateRoutes } from "./templates/routes";
import { BrandService } from "./brands/service";
import { BatchService } from "./batch/service";
import { registerBatchRoutes } from "./batch/routes";
import { TelegramService } from "./telegram/service";
import type { TelegramOptions } from "./telegram/service";
import { registerTelegramRoutes } from "./telegram/routes";
import { registerCabinetRoutes } from "./cabinet/routes";
import { MaintenanceService } from "./ops/maintenance";
import { registerAgentSocket } from "./ws/routes";

declare module "fastify" {
  interface FastifyInstance {
    /** Ulangan panellar markazi (testlar va keyingi modullar uchun). */
    hub: AgentHub;
    cluster: Cluster;
    storage: Storage;
    jobs: JobEngine;
    audio: AudioService;
    billing: BillingService;
    tariffs: TariffService;
    eleven: ElevenService;
    music: MusicLibrary;
    templates: TemplateService;
    brands: BrandService;
    icons: IconLibrary;
    unsplash: UnsplashService;
    batches: BatchService;
    telegram: TelegramService;
    maintenance: MaintenanceService;
  }
}

/** Audio vazifasi "tirik" hisoblanadigan muddat (worker bilan bir xil, P8.03). */
const AUDIO_LEASE_MS = 40 * 60_000;

export interface AppDeps {
  env: Env;
  db: Db;
  redis: RedisLike;
  now?: () => Date;
  /** Berilmasa env bo'yicha (S3 yoki lokal). */
  storage?: Storage;
  /** OAuth CIMD hujjatlarini olish (testlar uchun). */
  oauthFetcher?: MetadataFetcher;
  /** ElevenLabs klient sozlamalari (testlar: soxta fetch, tez retry). */
  elevenOptions?: ElevenOptions;
  /** Audio navbati sozlamalari (testlar: dubbing poll). */
  audioOptions?: ConstructorParameters<typeof AudioService>[2];
  /** Telegram (testlar: soxta fetch, polling'siz). */
  telegramOptions?: TelegramOptions;
  /** Iconify API (testlar: soxta fetch). */
  iconOptions?: IconLibraryOptions;
  /** Unsplash API (testlar: soxta fetch). */
  unsplashOptions?: UnsplashOptions;
  /**
   * Replikalararo aloqa (P9.07). Berilmasa — yakka (`MemoryCluster`, taqsimlangan yo'llar o'chiq).
   * Production: `RedisCluster` (`index.ts`).
   */
  cluster?: (log: FastifyBaseLogger) => Cluster;
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
  const cluster = deps.cluster?.(app.log) ?? new MemoryCluster();
  try {
    await cluster.start();
  } catch (error) {
    app.log.error({ err: error }, "cluster (Redis) ulanmadi: replikalararo aloqa ishlamaydi");
  }
  app.decorate("cluster", cluster);
  const hub = new AgentHub(deps.db, app.log, now, cluster);
  app.decorate("hub", hub);
  const storage = deps.storage ?? createStorage(deps.env, app.log, now);
  app.decorate("storage", storage);
  const ctx = {
    hub,
    cluster,
    storage,
    env: deps.env,
    db: deps.db,
    redis: deps.redis,
    now,
  } as AppContext;
  ctx.billing = new BillingService(ctx, undefined, app.log);
  app.decorate("billing", ctx.billing);
  // Admin narxni boshqa replikada o'zgartirdi (P9.07).
  cluster.onMessage((message) => {
    if (message.t === "settings" && message.key === "billing") {
      ctx.billing
        .loadSettings()
        .catch((error: unknown) => app.log.warn({ err: error }, "narx sozlamasi yangilanmadi"));
    }
  });

  const tariffs = new TariffService(ctx);
  ctx.tariffs = tariffs;
  app.decorate("tariffs", tariffs);
  ctx.music = new MusicLibrary(ctx);
  app.decorate("music", ctx.music);
  ctx.eleven = new ElevenService(ctx, app.log, deps.elevenOptions ?? {});
  ctx.eleven.attach();
  app.decorate("eleven", ctx.eleven);
  // Env'dagi kalit admin panelga (DB, shifrlangan) bir marta ko'chiriladi.
  try {
    if (await ctx.eleven.seedFromEnv()) app.log.info("ElevenLabs kaliti env'dan DB'ga ko'chirildi");
  } catch (error) {
    app.log.error({ err: error }, "ElevenLabs kalitini DB'ga ko'chirib bo'lmadi: env ishlatiladi");
  }
  cluster.onMessage((message) => {
    if (message.t === "settings" && message.key === "elevenlabs") ctx.eleven.invalidate();
  });
  // `api` roli faqat umumiy storage (R2) bilan: lokal diskni worker ko'rmaydi — unda server o'zi bajaradi.
  const audioRole = () =>
    deps.env.AES_ROLE === "api" && ctx.storage.driver === "s3"
      ? ("api" as const)
      : ("all" as const);
  ctx.audio = new AudioService(ctx, app.log, {
    role: audioRole,
    concurrency: deps.env.AUDIO_CONCURRENCY,
    ...(deps.env.DEEP_FILTER_BIN === undefined
      ? {}
      : { deepFilter: { bin: deps.env.DEEP_FILTER_BIN } }),
    cluster,
    ...deps.audioOptions,
  });
  ctx.audio.attach();
  app.decorate("audio", ctx.audio);
  ctx.templates = new TemplateService(ctx);
  app.decorate("templates", ctx.templates);
  ctx.brands = new BrandService(ctx);
  app.decorate("brands", ctx.brands);
  ctx.icons = new IconLibrary(ctx, app.log, deps.iconOptions ?? {});
  app.decorate("icons", ctx.icons);
  ctx.unsplash = new UnsplashService(ctx, app.log, deps.unsplashOptions ?? {});
  app.decorate("unsplash", ctx.unsplash);
  cluster.onMessage((message) => {
    if (message.t === "settings" && message.key === "unsplash") ctx.unsplash.invalidate();
  });
  cluster.onMessage((message) => {
    if (message.t === "settings" && message.key === "worldvectorlogo") ctx.icons.wvl.invalidate();
  });

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

  // Login va qurilma ulash: IP bo'yicha chegaralar (brute force / spam'ga qarshi, P3.10).
  const authLimiter = createLimiter(ctx.cluster, "auth", 30, 10 * 60_000, () => now().getTime());
  const limited = new Set(["/api/auth/telegram", "/oauth/device/code", "/api/devices/confirm"]);
  // Xavfsizlik sarlavhalari (P5.13): MIME sniffing, clickjacking, referer sizishi, HTTPS (production).
  app.addHook("onSend", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    if (!reply.hasHeader("x-frame-options")) reply.header("x-frame-options", "DENY");
    if (deps.env.NODE_ENV === "production") {
      reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
  });
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "POST" || !limited.has(request.url.split("?")[0]!)) return;
    const limit = await authLimiter.check(`${request.ip}:${request.url}`);
    if (!limit.allowed) {
      return reply
        .code(429)
        .header("retry-after", String(limit.retryAfterS))
        .send(fail("SYS_RATE_LIMIT", "Juda ko'p urinish, birozdan keyin qayta urining"));
    }
  });

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/api/")) await loadSession(ctx, request);
  });

  if (webRoot !== null) await registerWeb(app, webRoot);
  if (storage instanceof LocalStorage) await storage.register(app);
  registerAdminAuth(app, ctx);
  registerAdminMusicRoutes(app, ctx);
  registerAdminUserRoutes(app, ctx, tariffs);
  registerAdminBillingRoutes(app, ctx, tariffs);
  registerAdminElevenRoutes(app, ctx);
  registerAdminIconRoutes(app, ctx);
  registerAdminImageRoutes(app, ctx);
  if (storage instanceof SwitchStorage) {
    await storage.local.register(app);
    const storageSettings = new StorageSettings(ctx, storage, app.log);
    try {
      await storageSettings.load();
    } catch (error) {
      app.log.error(
        { err: error },
        "storage sozlamasini o'qib bo'lmadi: env/lokal disk ishlatiladi",
      );
    }
    storageSettings.start();
    app.addHook("onClose", async () => storageSettings.stop());
    cluster.onMessage((message) => {
      if (message.t === "settings" && message.key === "storage") {
        storageSettings
          .load()
          .catch((error: unknown) =>
            app.log.warn({ err: error }, "storage sozlamasi yangilanmadi"),
          );
      }
    });
    registerAdminStorageRoutes(app, ctx, storage, storageSettings);
  }
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
  ctx.batches = new BatchService(ctx, engine, app.log);
  ctx.batches.attach();
  app.decorate("batches", ctx.batches);
  ctx.telegram = new TelegramService(ctx, app.log, deps.telegramOptions ?? {});
  ctx.telegram.attach(engine, ctx.batches);
  ctx.telegram.attachBilling(ctx.billing);
  app.decorate("telegram", ctx.telegram);
  const maintenance = new MaintenanceService(ctx, app.log);
  app.decorate("maintenance", maintenance);
  // Backup va tozalash rejalashtiruvchisi faqat production'da (testlar va dev'da qo'lda chaqiriladi).
  if (deps.env.NODE_ENV === "production") app.addHook("onReady", async () => maintenance.start());
  // Telegram webhook (P9.06): production'da ishga tushganda ro'yxatdan o'tkaziladi (idempotent).
  if (deps.env.NODE_ENV === "production" && ctx.telegram.webhookSecret !== null) {
    app.addHook("onReady", async () => {
      const registered = await ctx.telegram.registerWebhook(deps.env.PUBLIC_URL);
      if (registered.ok) app.log.info("telegram webhook o'rnatildi");
      else app.log.error({ err: registered.error }, "telegram webhook o'rnatilmadi");
    });
  }
  registerLive(ctx, engine, app.log);
  registerJobRoutes(app, ctx, engine);
  registerTemplateRoutes(app, ctx, engine);
  registerBatchRoutes(app, ctx);
  registerTelegramRoutes(app, ctx);
  registerCabinetRoutes(app, ctx, engine);
  registerBillingRoutes(app, ctx, tariffs);
  const presence = new ClaudePresence(ctx, app.log);
  presence.attach();
  registerMcpRoutes(app, ctx, engine, {
    onRequest: (userId) => presence.touch(userId),
    onCall: (userId, clientId, tool, ok, mutating) => {
      // O'qish toollari audit'ni to'ldirib yubormasligi uchun faqat o'zgartiruvchilar yoziladi.
      if (!mutating) return;
      void audit(ctx, app.log, {
        userId,
        actor: "claude",
        action: `mcp.${tool}`,
        target: clientId,
        data: { ok },
      });
    },
  });
  registerAuditRoutes(app, ctx);
  registerElevenRoutes(app, ctx);
  registerAudioRoutes(app, ctx);
  // Audio ekrani: vazifa holati loyiha qurilmasiga (P4.12).
  ctx.audio.listen((task) => {
    if (task.projectId === null) return;
    void ctx.db
      .select({ deviceId: projects.deviceId })
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1)
      .then(([row]) => {
        if (row?.deviceId)
          ctx.hub.send(row.deviceId, { type: "audio.update", task: presentTask(task) });
      })
      .catch((error: unknown) => app.log.warn({ err: error }, "audio.update yuborilmadi"));
  });
  // Tashqi xizmatda generatsiya qilingan musiqa → kutubxona nomzodi (P8.06).
  ctx.audio.listen((task) => {
    if (task.kind !== "music" || task.status !== "done" || task.cached) return;
    void ctx.music
      .collectGenerated(task)
      .catch((error: unknown) => app.log.warn({ err: error }, "musiqa kutubxonaga qo'shilmadi"));
  });
  app.addHook("onReady", async () => {
    try {
      if (deps.env.AES_ROLE === "api") {
        // Worker bajaradi; server natijani kuzatadi. R2 o'chirilsa server navbatni o'zi oladi.
        ctx.audio.startWatching();
        ctx.audio.startPolling();
        return;
      }
      // Ko'p replika (P9.07): boshqa tirik replika bajarayotgan vazifaga tegilmaydi (lease), o'lganlarning
      // navbatdagi vazifalarini DB navbatidan olamiz (egallash atomar).
      const requeued = cluster.shared
        ? await ctx.audio.recover({ leaseMs: AUDIO_LEASE_MS })
        : await ctx.audio.recover();
      if (cluster.shared) ctx.audio.startPolling(5000);
      if (requeued > 0) app.log.info({ requeued }, "audio vazifalari davom ettirildi");
    } catch (error) {
      app.log.warn({ err: error }, "audio vazifalari tiklanmadi");
    }
  });
  app.addHook("onReady", async () => {
    // Narx stavkalari (P9.04): DB'dagi admin farqlari; o'qilmasa kod stavkalari.
    try {
      await ctx.billing.loadSettings();
    } catch (error) {
      app.log.error({ err: error }, "narx sozlamasi o'qilmadi: kod stavkalari ishlatiladi");
    }
    ctx.billing.startRefresh();
    // Boshqa replikalardagi panellar ro'yxati (P9.07).
    hub.announce();
  });
  app.addHook("onReady", async () => {
    // DB hali tayyor bo'lmasa server baribir ko'tariladi (health 503 ko'rsatadi).
    try {
      const resumed = await engine.recover();
      if (resumed > 0) app.log.info({ resumed }, "yakunlanmagan joblar davom ettirildi");
      const batchesResumed = await ctx.batches.recover();
      if (batchesResumed > 0) app.log.info({ batchesResumed }, "batch'lar davom ettirildi");
    } catch (error) {
      app.log.warn({ err: error }, "joblarni tiklab bo'lmadi");
    }
  });
  app.addHook("onClose", async () => {
    ctx.billing.stop();
    ctx.audio.stop();
    ctx.batches.stop();
    await ctx.telegram.stop();
    await maintenance.stop();
    engine.stop();
    hub.close();
    await engine.idle();
    await ctx.batches.idle();
    await cluster.close();
  });

  return app;
}
