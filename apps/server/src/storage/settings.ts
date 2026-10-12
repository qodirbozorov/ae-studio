/**
 * Storage sozlamalari (admin): faol drayver (Railway volume yoki R2) va R2 parametrlari `system_settings`
 * jadvalida, maxfiy kalit shifrlangan. DB'da yozuv bo'lmasa env (S3_*) ishlatiladi.
 * Boshqa replikalar o'zgarishni davriy tekshiruv bilan oladi.
 */
import { fail, ok } from "@aes/shared";
import type { Result } from "@aes/shared";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../context";
import { systemSettings } from "../db/schema";
import { maskSecret, openSecret, sealSecret } from "../secrets";
import { S3Storage } from "./s3";
import type { StorageDriverName, SwitchStorage } from "./switch";

const KEY = "storage";

export interface R2Input {
  endpoint: string;
  bucket: string;
  access_key_id: string;
  /** Bo'sh qoldirilsa avvalgi maxfiy kalit saqlanadi. */
  secret_access_key?: string;
}

interface StoredValue {
  active: StorageDriverName;
  r2: { endpoint: string; bucket: string; access_key_id: string } | null;
}

export interface StorageSettingsView {
  active: StorageDriverName;
  source: "db" | "env" | "none";
  local_dir: string;
  r2: {
    endpoint: string;
    bucket: string;
    access_key_id: string;
    secret_masked: string;
  } | null;
}

type Ctx = Pick<AppContext, "db" | "env" | "now">;

export class StorageSettings {
  private stamp: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private source: StorageSettingsView["source"] = "none";
  private r2: StorageSettingsView["r2"] = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly storage: SwitchStorage,
    private readonly log: FastifyBaseLogger,
  ) {
    const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = ctx.env;
    if (S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY) {
      this.source = "env";
      this.r2 = {
        endpoint: S3_ENDPOINT,
        bucket: S3_BUCKET,
        access_key_id: S3_ACCESS_KEY,
        secret_masked: maskSecret(S3_SECRET_KEY),
      };
    }
  }

  view(): StorageSettingsView {
    return {
      active: this.storage.driver,
      source: this.source,
      local_dir: this.storage.local.root,
      r2: this.r2,
    };
  }

  /** DB'dagi sozlamani qo'llaydi (yozuv bo'lmasa env holati qoladi). */
  async load(): Promise<void> {
    const [row] = await this.ctx.db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, KEY));
    if (row === undefined) return;
    this.stamp = row.updatedAt.getTime();
    const value = row.value as StoredValue;
    let s3: S3Storage | null = null;
    if (value.r2 !== null && row.secret != null) {
      const secret = openSecret(this.ctx.env, row.secret);
      s3 = new S3Storage({
        endpoint: value.r2.endpoint,
        bucket: value.r2.bucket,
        accessKeyId: value.r2.access_key_id,
        secretAccessKey: secret,
      });
      this.r2 = { ...value.r2, secret_masked: maskSecret(secret) };
    } else {
      this.r2 = null;
    }
    this.source = "db";
    this.storage.configure(s3, s3 === null ? "local" : value.active);
  }

  /** Boshqa replika o'zgartirgan bo'lsa qayta yuklaydi. */
  start(intervalMs = 30_000): void {
    this.timer = setInterval(() => {
      void this.refresh().catch((error: unknown) =>
        this.log.warn({ err: error }, "storage sozlamasini yangilab bo'lmadi"),
      );
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private async refresh(): Promise<void> {
    const [row] = await this.ctx.db
      .select({ updatedAt: systemSettings.updatedAt })
      .from(systemSettings)
      .where(eq(systemSettings.key, KEY));
    if (row !== undefined && row.updatedAt.getTime() !== this.stamp) await this.load();
  }

  private async stored(): Promise<{ value: StoredValue; secret: string | null }> {
    const [row] = await this.ctx.db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, KEY));
    if (row === undefined) {
      const { S3_SECRET_KEY } = this.ctx.env;
      return {
        value: {
          active: this.storage.driver,
          r2:
            this.r2 === null
              ? null
              : {
                  endpoint: this.r2.endpoint,
                  bucket: this.r2.bucket,
                  access_key_id: this.r2.access_key_id,
                },
        },
        secret: this.source === "env" ? (S3_SECRET_KEY ?? null) : null,
      };
    }
    return {
      value: row.value as StoredValue,
      secret: row.secret == null ? null : openSecret(this.ctx.env, row.secret),
    };
  }

  private async write(value: StoredValue, secret: string | null, by: string): Promise<void> {
    const sealed = secret === null ? null : sealSecret(this.ctx.env, secret);
    await this.ctx.db
      .insert(systemSettings)
      .values({ key: KEY, value, secret: sealed, updatedBy: by, updatedAt: this.ctx.now() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, secret: sealed, updatedBy: by, updatedAt: this.ctx.now() },
      });
    await this.load();
  }

  /** R2 parametrlarini tekshiradi (bucket'ga ulanish) va saqlaydi. Faol drayver o'zgarmaydi. */
  async saveR2(input: R2Input, by: string): Promise<Result<StorageSettingsView>> {
    if (this.ctx.env.MASTER_KEY === undefined) {
      return fail("SYS_BAD_REQUEST", "MASTER_KEY sozlanmagan: maxfiy kalitni saqlab bo'lmaydi");
    }
    const current = await this.stored();
    const secret = input.secret_access_key?.trim() || current.secret;
    if (secret === null || secret === "") {
      return fail("SYS_BAD_REQUEST", "Secret access key kerak");
    }
    const endpoint = input.endpoint.trim().replace(/\/+$/, "");
    const candidate = new S3Storage({
      endpoint,
      bucket: input.bucket.trim(),
      accessKeyId: input.access_key_id.trim(),
      secretAccessKey: secret,
    });
    try {
      await candidate.probe();
    } catch (error) {
      return fail(
        "SYS_BAD_REQUEST",
        `R2 ga ulanib bo'lmadi: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await this.write(
      {
        active: current.value.active,
        r2: { endpoint, bucket: input.bucket.trim(), access_key_id: input.access_key_id.trim() },
      },
      secret,
      by,
    );
    return ok(this.view());
  }

  async setActive(active: StorageDriverName, by: string): Promise<Result<StorageSettingsView>> {
    const current = await this.stored();
    if (active === "s3" && (current.value.r2 === null || current.secret === null)) {
      return fail("SYS_BAD_REQUEST", "Avval R2 sozlamalarini kiriting");
    }
    await this.write({ ...current.value, active }, current.secret, by);
    return ok(this.view());
  }

  /** R2 ni o'chiradi: faol drayver lokal diskka qaytadi (R2'dagi fayllar o'chirilmaydi). */
  async removeR2(by: string): Promise<StorageSettingsView> {
    await this.write({ active: "local", r2: null }, null, by);
    return this.view();
  }
}
