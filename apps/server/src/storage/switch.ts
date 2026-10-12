/**
 * Faol storage'ni ish vaqtida almashtirish: Railway volume (lokal disk) yoki Cloudflare R2 (S3).
 * - Yozish (put, presignPut) — faol drayverga.
 * - O'qish (head, get, presignGet) — avval faol, topilmasa ikkinchisi: almashtirgandan keyin eski fayllar
 *   ham ochiladi (admin xohlasa "ko'chirish" bilan birlashtiradi).
 * - O'chirish — ikkalasidan.
 */
import type { LocalStorage } from "./local";
import type { S3Storage } from "./s3";
import type { Storage, StoredObject } from "./storage";

export type StorageDriverName = "local" | "s3";

export class SwitchStorage implements Storage {
  constructor(
    readonly local: LocalStorage,
    private s3Driver: S3Storage | null,
    private activeName: StorageDriverName,
  ) {}

  get driver(): "s3" | "local" {
    return this.activeName === "s3" && this.s3Driver !== null ? "s3" : "local";
  }

  get s3(): S3Storage | null {
    return this.s3Driver;
  }

  /** Sozlama o'zgarganda (admin yoki boshqa replika). */
  configure(s3: S3Storage | null, active: StorageDriverName): void {
    this.s3Driver = s3;
    this.activeName = active;
  }

  drivers(): { name: StorageDriverName; storage: LocalStorage | S3Storage }[] {
    const list: { name: StorageDriverName; storage: LocalStorage | S3Storage }[] = [
      { name: "local", storage: this.local },
    ];
    if (this.s3Driver !== null) list.push({ name: "s3", storage: this.s3Driver });
    return list;
  }

  byName(name: StorageDriverName): LocalStorage | S3Storage | null {
    return name === "local" ? this.local : this.s3Driver;
  }

  private primary(): Storage {
    return this.driver === "s3" ? this.s3Driver! : this.local;
  }

  private secondary(): Storage | null {
    return this.driver === "s3" ? this.local : this.s3Driver;
  }

  /** Kalit qaysi drayverda bor (avval faol). */
  private async locate(key: string): Promise<Storage | null> {
    const primary = this.primary();
    if ((await primary.head(key)) !== null) return primary;
    const secondary = this.secondary();
    if (secondary !== null && (await secondary.head(key).catch(() => null)) !== null) {
      return secondary;
    }
    return null;
  }

  presignPut(key: string, options?: { contentType?: string; ttlS?: number }): Promise<string> {
    return this.primary().presignPut(key, options);
  }

  async presignGet(key: string, options?: { ttlS?: number }): Promise<string> {
    return ((await this.locate(key)) ?? this.primary()).presignGet(key, options);
  }

  async head(key: string): Promise<StoredObject | null> {
    const found = await this.locate(key);
    return found === null ? null : found.head(key);
  }

  async getBytes(key: string): Promise<Buffer | null> {
    const found = await this.locate(key);
    return found === null ? null : found.getBytes(key);
  }

  putBytes(key: string, data: Buffer, contentType?: string): Promise<void> {
    return this.primary().putBytes(key, data, contentType);
  }

  async delete(key: string): Promise<void> {
    await this.primary().delete(key);
    await this.secondary()
      ?.delete(key)
      .catch(() => undefined);
  }

  async list(prefix: string): Promise<string[]> {
    const keys = new Set(await this.primary().list(prefix));
    const secondary = this.secondary();
    if (secondary !== null) {
      for (const key of await secondary.list(prefix).catch(() => [])) keys.add(key);
    }
    return [...keys].sort();
  }
}
