import type { Mailer } from "./auth/mailer";
import type { Db } from "./db/client";
import type { AudioService } from "./audio/service";
import type { ElevenService } from "./eleven/service";
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
  /** ElevenLabs hisobi va klientlari (P4.01). */
  eleven: ElevenService;
  /** Audio vazifalari navbati (P4.03). */
  audio: AudioService;
}
