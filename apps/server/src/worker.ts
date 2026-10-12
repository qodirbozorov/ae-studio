/**
 * Audio worker (P8.03, `AES_ROLE=worker`): faqat audio vazifalarini bajaradi — tashqi audio xizmati, server
 * isolation (DeepFilterNet3), sarf yozuvi. Navbat Postgres'da: bir nechta worker replikasi xavfsiz ishlaydi.
 * Natijani panelga `api` serveri yetkazadi (panel unga ulangan). Umumiy storage (R2) talab qilinadi.
 */
import Fastify from "fastify";
import { AudioService } from "./audio/service";
import { BillingService } from "./billing/service";
import type { AppContext } from "./context";
import type { DbHandle } from "./db/client";
import { ElevenService } from "./eleven/service";
import type { Env } from "./env";
import { createStorage } from "./storage";
import { StorageSettings } from "./storage/settings";
import { AgentHub } from "./ws/hub";

/** O'lgan worker'ning "running" vazifasi shu muddatdan keyin qayta navbatga qaytadi (dublyaj ≤ 30 daq). */
const LEASE_MS = 40 * 60_000;

export async function runWorker(env: Env, database: DbHandle): Promise<void> {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });
  const now = () => new Date();
  const storage = createStorage(env, app.log, now);
  const ctx = {
    env,
    db: database.db,
    now,
    storage,
    hub: new AgentHub(database.db, app.log, now),
  } as unknown as AppContext;
  ctx.billing = new BillingService(ctx);
  ctx.eleven = new ElevenService(ctx, app.log);
  const settings = new StorageSettings(ctx, storage, app.log);
  await settings.load();
  settings.start();

  // Lokal disk faol bo'lsa worker fayllarni ko'rmaydi: kutadi, server o'zi bajaradi.
  const audio = new AudioService(ctx, app.log, {
    concurrency: env.AUDIO_CONCURRENCY,
    role: () => (storage.driver === "s3" ? "worker" : "api"),
    ...(env.DEEP_FILTER_BIN === undefined ? {} : { deepFilter: { bin: env.DEEP_FILTER_BIN } }),
  });
  ctx.audio = audio;

  app.get("/health", async (_request, reply) => {
    const shared = storage.driver === "s3";
    return reply.code(shared ? 200 : 503).send({
      ok: shared,
      role: "worker",
      storage: storage.driver,
      ...(shared ? {} : { hint: "Worker umumiy storage (R2) bilan ishlaydi: admin → Storage" }),
    });
  });

  const requeued = await audio.recover({ leaseMs: LEASE_MS });
  if (requeued > 0) app.log.info({ requeued }, "o'lgan worker vazifalari qaytarildi");
  audio.startPolling();
  if (storage.driver !== "s3") {
    app.log.warn("R2 faol emas: worker kutmoqda (vazifalarni server bajaradi)");
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "worker to'xtatilmoqda");
    audio.stop();
    settings.stop();
    await audio.idle();
    await app.close();
    await database.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.PORT, host: env.HOST });
}
