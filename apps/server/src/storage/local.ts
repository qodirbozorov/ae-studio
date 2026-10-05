/**
 * Lokal storage drayveri (dev/test): fayllar server diskida, imzolangan URL'larni server o'zi beradi
 * (`/storage/<key>?exp=..&sig=..`, HMAC-SHA256). S3 bilan bir xil oqim — panel farqni bilmaydi.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fail } from "@aes/shared";
import type { FastifyInstance } from "fastify";
import { PRESIGN_TTL_S, isValidKey } from "./storage";
import type { Storage, StoredObject } from "./storage";

/** Bitta faylning eng katta hajmi (lokal drayver). */
export const LOCAL_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export class LocalStorage implements Storage {
  readonly driver = "local" as const;
  private readonly secret: Buffer;

  constructor(
    readonly root: string,
    private readonly publicUrl: string,
    private readonly now: () => Date,
    secret?: Buffer,
  ) {
    this.secret = secret ?? randomBytes(32);
  }

  private path(key: string): string {
    if (!isValidKey(key)) throw new Error(`Noto'g'ri storage kaliti: ${key}`);
    return join(this.root, ...key.split("/"));
  }

  sign(method: "GET" | "PUT", key: string, exp: number): string {
    return createHmac("sha256", this.secret).update(`${method}\n${key}\n${exp}`).digest("hex");
  }

  verify(method: "GET" | "PUT", key: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp * 1000 < this.now().getTime()) return false;
    const expected = Buffer.from(this.sign(method, key, exp));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private url(method: "GET" | "PUT", key: string, ttlS: number): string {
    this.path(key);
    const exp = Math.floor(this.now().getTime() / 1000) + ttlS;
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return `${this.publicUrl}/storage/${encoded}?exp=${exp}&sig=${this.sign(method, key, exp)}`;
  }

  async presignPut(key: string, options: { ttlS?: number } = {}) {
    return this.url("PUT", key, options.ttlS ?? PRESIGN_TTL_S);
  }

  async presignGet(key: string, options: { ttlS?: number } = {}) {
    return this.url("GET", key, options.ttlS ?? PRESIGN_TTL_S);
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      return { size: (await stat(this.path(key))).size };
    } catch {
      return null;
    }
  }

  async getBytes(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch {
      return null;
    }
  }

  async putBytes(key: string, data: Buffer): Promise<void> {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  /** `/storage/*` route'lari: imzo va muddat tekshiriladi. */
  async register(app: FastifyInstance): Promise<void> {
    // Xom oqim faqat shu scope ichida (boshqa route'larda JSON parser o'zgarmaydi).
    await app.register(async (scope) => this.routes(scope));
  }

  private routes(app: FastifyInstance): void {
    app.addContentTypeParser("*", (_request, payload, done) => done(null, payload));

    const parse = (request: { params: unknown; query: unknown }) => {
      const key = (request.params as { "*": string })["*"];
      const query = request.query as { exp?: string; sig?: string };
      return { key, exp: Number(query.exp), sig: query.sig ?? "" };
    };

    app.put("/storage/*", { bodyLimit: LOCAL_MAX_BYTES }, async (request, reply) => {
      const { key, exp, sig } = parse(request);
      if (!isValidKey(key) || !this.verify("PUT", key, exp, sig)) {
        return reply.code(403).send(fail("AUTH_INVALID", "Imzo yaroqsiz yoki muddati o'tgan"));
      }
      const file = this.path(key);
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.${randomBytes(4).toString("hex")}.part`;
      try {
        await pipeline(request.body as NodeJS.ReadableStream, createWriteStream(temp));
        await rename(temp, file);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
      return reply.code(200).send({ ok: true });
    });

    app.get("/storage/*", async (request, reply) => {
      const { key, exp, sig } = parse(request);
      if (!isValidKey(key) || !this.verify("GET", key, exp, sig)) {
        return reply.code(403).send(fail("AUTH_INVALID", "Imzo yaroqsiz yoki muddati o'tgan"));
      }
      const info = await this.head(key);
      if (info === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "Fayl yo'q"));
      reply.header("content-length", info.size).type("application/octet-stream");
      return reply.send(createReadStream(this.path(key)));
    });
  }
}
