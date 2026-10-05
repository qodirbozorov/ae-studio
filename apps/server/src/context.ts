import type { Mailer } from "./auth/mailer";
import type { Db } from "./db/client";
import type { Env } from "./env";
import type { RedisLike } from "./redis";
import type { Storage } from "./storage";
import type { AgentHub } from "./ws/hub";

/** Route modullari uchun umumiy bog'liqliklar. `now` — testlarda vaqtni boshqarish uchun. */
export interface AppContext {
  env: Env;
  db: Db;
  redis: RedisLike;
  mailer: Mailer;
  now: () => Date;
  storage: Storage;
  /** Ulangan panellar (WS). */
  hub: AgentHub;
}
