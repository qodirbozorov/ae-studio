import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LocalStorage} from "../src/storage";
import { S3Storage, isValidKey, storageKey } from "../src/storage";
import { createTestApp } from "./helpers/app";
import type { TestApp } from "./helpers/app";

const key = storageKey({
  userId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  kind: "thumbs",
  hash: "abc123",
  ext: ".JPG",
});

let t: TestApp;
let storage: LocalStorage;

beforeAll(async () => {
  t = await createTestApp();
  storage = t.app.storage as LocalStorage;
});

afterAll(async () => {
  await t.close();
});

/** Imzolangan URL → inject uchun yo'l. */
function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

describe("storage kalitlari (§5)", () => {
  it("u/<user>/p/<project>/<kind>/<hash>.<ext>", () => {
    expect(key).toBe(
      "u/11111111-1111-4111-8111-111111111111/p/22222222-2222-4222-8222-222222222222/thumbs/abc123.jpg",
    );
  });

  it("noto'g'ri qismlar rad etiladi", () => {
    expect(() =>
      storageKey({ userId: "../x", projectId: "p", kind: "frames", hash: "h", ext: "png" }),
    ).toThrow();
    expect(() =>
      storageKey({ userId: "u", projectId: "p", kind: "frames", hash: "a/b", ext: "png" }),
    ).toThrow();
    expect(isValidKey("u/a/../b")).toBe(false);
    expect(isValidKey("/u/a")).toBe(false);
    expect(isValidKey(key)).toBe(true);
  });
});

describe("lokal drayver (dev/test)", () => {
  it("test ilovasida S3 env yo'q → lokal drayver", () => {
    expect(storage.driver).toBe("local");
  });

  it("imzolangan PUT → GET bir xil baytlar; HEAD hajmni beradi", async () => {
    const putUrl = await storage.presignPut(key);
    expect(putUrl).toMatch(/^https:\/\/aes\.test\/storage\/u\/.+\?exp=\d+&sig=[0-9a-f]{64}$/);
    const put = await t.app.inject({
      method: "PUT",
      url: pathOf(putUrl),
      headers: { "content-type": "image/jpeg" },
      payload: Buffer.from("JPEG-DATA"),
    });
    expect(put.statusCode).toBe(200);
    expect(await storage.head(key)).toEqual({ size: 9 });

    const get = await t.app.inject({ method: "GET", url: pathOf(await storage.presignGet(key)) });
    expect(get.statusCode).toBe(200);
    expect(get.body).toBe("JPEG-DATA");
  });

  it("imzosiz, buzilgan, boshqa metod yoki muddati o'tgan imzo → 403", async () => {
    const putUrl = await storage.presignPut(key);
    const tampered = pathOf(putUrl).replace(
      /sig=(.)/,
      (_m, c: string) => `sig=${c === "0" ? "1" : "0"}`,
    );
    expect((await t.app.inject({ method: "PUT", url: tampered, payload: "x" })).statusCode).toBe(
      403,
    );
    expect((await t.app.inject({ method: "GET", url: `/storage/${key}` })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "GET", url: pathOf(putUrl) })).statusCode).toBe(403);

    t.clock.advance(15 * 60 * 1000 + 1_000);
    const expired = await t.app.inject({ method: "PUT", url: pathOf(putUrl), payload: "x" });
    expect(expired.statusCode).toBe(403);
    expect(expired.json().error.code).toBe("AUTH_INVALID");
  });

  it("JSON route'lar storage parseridan ta'sirlanmaydi", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "json@x.uz" },
    });
    expect(res.json()).toMatchObject({ ok: true });
  });
});

describe("S3 drayver (R2 / Railway bucket)", () => {
  it("presign URL: path-style, 15 daqiqa, SigV4 (tarmoqsiz)", async () => {
    const s3 = new S3Storage({
      endpoint: "https://acc.r2.cloudflarestorage.com",
      bucket: "aes-media",
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
    });
    const url = new URL(await s3.presignPut(key, { contentType: "image/jpeg" }));
    expect(url.host).toBe("acc.r2.cloudflarestorage.com");
    expect(url.pathname).toBe(`/aes-media/${key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    await expect(s3.presignGet("../etc/passwd")).rejects.toThrow();
  });
});
