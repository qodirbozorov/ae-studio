import type { BillingService } from "./billing/service";
import type { TariffService } from "./billing/tariffs";
import type { MusicLibrary } from "./music/library";
import type { Db } from "./db/client";
import type { AudioService } from "./audio/service";
import type { ElevenService } from "./eleven/service";
import type { Env } from "./env";
import type { RedisLike } from "./redis";
import type { TemplateService } from "./templates/service";
import type { BrandService } from "./brands/service";
import type { BatchService } from "./batch/service";
import type { TelegramService } from "./telegram/service";
import type { Storage } from "./storage";
import type { Cluster } from "./cluster";
import type { AgentHub } from "./ws/hub";

/** Route modullari uchun umumiy bog'liqliklar. `now` — testlarda vaqtni boshqarish uchun. */
export interface AppContext {
  env: Env;
  db: Db;
  redis: RedisLike;
  now: () => Date;
  storage: Storage;
  /** Ulangan panellar (WS). */
  hub: AgentHub;
  /** Replikalararo xabar, qulf va hisoblagich (P9.07); yakka rejimda lokal. */
  cluster: Cluster;
  /** ElevenLabs hisobi va klientlari (P4.01). */
  eleven: ElevenService;
  /** Audio vazifalari navbati (P4.03). */
  audio: AudioService;
  /** Balans va sarf jurnali (P8.01). */
  billing: BillingService;
  /** To'lov paketlari (P9.03). */
  tariffs: TariffService;
  /** Musiqa kutubxonasi (P8.06). */
  music: MusicLibrary;
  /** Shablonlar registri (P5.01). */
  templates: TemplateService;
  /** Brand kit'lar (P5.04). */
  brands: BrandService;
  /** Batch: shablon + CSV (P5.07). */
  batches: BatchService;
  /** Telegram xabarnoma (P5.08). */
  telegram: TelegramService;
}
