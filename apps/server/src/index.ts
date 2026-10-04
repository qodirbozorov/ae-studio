import { buildApp } from "./app";
import { createDb } from "./db/client";
import { loadEnv } from "./env";
import { createRedis } from "./redis";

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const env = loadEnv();
  const database = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const app = await buildApp({ env, db: database.db, redis });

  app.addHook("onClose", async () => {
    await Promise.allSettled([database.close(), redis.quit()]);
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, "server to'xtatilmoqda");
    const force = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
    force.unref();
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "to'xtatishda xato");
      process.exit(1);
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
