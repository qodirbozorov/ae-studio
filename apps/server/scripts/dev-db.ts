// Lokal dev Postgres: PGlite (WASM) Postgres wire-protocol orqali ochiladi — Docker shart emas.
// Ishlatish: pnpm --filter @aes/server dev:db  →  DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.env.DEV_DB_PORT ?? 55432);
/** `memory` — vaqtinchalik; aks holda papka (ma'lumotlar saqlanadi). */
const dataDir = process.env.DEV_DB_DIR ?? ".pglite";

const db = await PGlite.create(dataDir === "memory" ? undefined : dataDir);
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
await server.start();
console.log(`Dev Postgres tayyor: postgresql://postgres@127.0.0.1:${port}/postgres (${dataDir})`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
