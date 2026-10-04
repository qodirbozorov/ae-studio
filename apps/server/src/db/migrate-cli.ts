// `pnpm db:migrate` va Railway preDeploy (`node apps/server/dist/migrate.js`).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { findMigrationsDir } from "./migrate";

const url = process.env.DATABASE_URL;
if (url === undefined || url === "") {
  console.error("DATABASE_URL berilmagan");
  process.exit(1);
}

const client = postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  const folder = findMigrationsDir();
  await migrate(drizzle(client), { migrationsFolder: folder });
  console.log("Migratsiyalar qo'llandi: " + folder);
} catch (error) {
  console.error("Migratsiya xatosi:", error);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
