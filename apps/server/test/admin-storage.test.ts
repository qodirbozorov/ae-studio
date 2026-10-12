/** Admin kirishi va Storage boshqaruvi (Railway volume ↔ R2, fayl explorer). */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStorage, SwitchStorage } from "../src/storage";
import type { S3Storage } from "../src/storage";
import { createTestApp } from "./helpers/app";
import type { TestApp } from "./helpers/app";

let t: TestApp;

let closed: TestApp | null = null;

afterEach(async () => {
  if (t !== undefined && t !== closed) {
    closed = t;
    await t.close();
  }
});

const ADMIN = { ADMIN_LOGIN: "boss", ADMIN_PASSWORD: "juda-uzun-parol-123" };

async function adminCookie(): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/api/admin/login",
    payload: { login: "boss", password: "juda-uzun-parol-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === "aes_admin")!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict" });
  return `aes_admin=${cookie.value}`;
}

describe("admin kirishi", () => {
  it("env berilmasa o'chiq", async () => {
    t = await createTestApp();
    const res = await t.app.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { login: "a", password: "b" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("noto'g'ri parol → 401; to'g'ri → cookie; cookie'siz → 401; boshqa Origin → 403", async () => {
    t = await createTestApp(ADMIN);
    const bad = await t.app.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { login: "boss", password: "xato" },
    });
    expect(bad.statusCode).toBe(401);
    expect((await t.app.inject({ url: "/api/admin/me" })).statusCode).toBe(401);
    const cookie = await adminCookie();
    const me = await t.app.inject({ url: "/api/admin/me", headers: { cookie } });
    expect(me.json()).toMatchObject({ ok: true, data: { login: "boss" } });
    const foreign = await t.app.inject({
      method: "PUT",
      url: "/api/admin/storage/active",
      headers: { cookie, origin: "https://evil.example" },
      payload: { driver: "local" },
    });
    expect(foreign.statusCode).toBe(403);
    // Muddati o'tgan sessiya.
    t.clock.advance(13 * 60 * 60 * 1000);
    expect((await t.app.inject({ url: "/api/admin/me", headers: { cookie } })).statusCode).toBe(
      401,
    );
  });

  it("urinishlar cheklangan", async () => {
    t = await createTestApp(ADMIN);
    let last = 0;
    for (let i = 0; i < 9; i++) {
      last = (
        await t.app.inject({
          method: "POST",
          url: "/api/admin/login",
          payload: { login: "boss", password: `x${i}` },
        })
      ).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe("storage boshqaruvi", () => {
  it("holat, explorer: papkalar → fayllar, yuklab olish, o'chirish", async () => {
    t = await createTestApp(ADMIN);
    const cookie = await adminCookie();
    await t.app.storage.putBytes("u/a/p/b/frames/x1.jpg", Buffer.from("jpeg"));
    await t.app.storage.putBytes("u/a/p/b/frames/x2.jpg", Buffer.from("jpeg2"));

    const view = await t.app.inject({ url: "/api/admin/storage", headers: { cookie } });
    expect(view.json().data).toMatchObject({
      active: "local",
      source: "none",
      r2: null,
      copy: null,
    });

    const root = await t.app.inject({
      url: "/api/admin/storage/browse?driver=local&prefix=",
      headers: { cookie },
    });
    expect(root.json().data).toMatchObject({ folders: ["u/"], files: [] });
    const frames = await t.app.inject({
      url: "/api/admin/storage/browse?driver=local&prefix=u/a/p/b/frames/",
      headers: { cookie },
    });
    expect(frames.json().data.files.map((f: { key: string }) => f.key)).toEqual([
      "u/a/p/b/frames/x1.jpg",
      "u/a/p/b/frames/x2.jpg",
    ]);
    const traversal = await t.app.inject({
      url: "/api/admin/storage/browse?driver=local&prefix=../",
      headers: { cookie },
    });
    expect(traversal.statusCode).toBe(400);

    const download = await t.app.inject({
      url: "/api/admin/storage/download?driver=local&key=u/a/p/b/frames/x1.jpg",
      headers: { cookie },
    });
    expect(download.statusCode).toBe(302);
    const file = await t.app.inject({
      url: download.headers.location!.replace("https://aes.test", ""),
    });
    expect(file.headers["content-type"]).toBe("image/jpeg");
    expect(file.body).toBe("jpeg");

    const del = await t.app.inject({
      method: "DELETE",
      url: "/api/admin/storage/object?driver=local&key=u/a/p/b/frames/x1.jpg",
      headers: { cookie },
    });
    expect(del.json()).toMatchObject({ ok: true, data: { deleted: 1 } });
    const folder = await t.app.inject({
      method: "DELETE",
      url: "/api/admin/storage/folder?driver=local&prefix=u/a/",
      headers: { cookie },
    });
    expect(folder.json()).toMatchObject({ ok: true, data: { deleted: 1 } });

    const noR2 = await t.app.inject({
      method: "PUT",
      url: "/api/admin/storage/active",
      headers: { cookie },
      payload: { driver: "s3" },
    });
    expect(noR2.statusCode).toBe(400);
    const s3Browse = await t.app.inject({
      url: "/api/admin/storage/browse?driver=s3&prefix=",
      headers: { cookie },
    });
    expect(s3Browse.statusCode).toBe(404);
  });

  it("R2 ga ulanib bo'lmasa saqlanmaydi", async () => {
    t = await createTestApp(ADMIN);
    const cookie = await adminCookie();
    const res = await t.app.inject({
      method: "PUT",
      url: "/api/admin/storage/r2",
      headers: { cookie },
      payload: {
        endpoint: "http://127.0.0.1:9",
        bucket: "aes-bucket",
        access_key_id: "AKIA12345678",
        secret_access_key: "sir-kalit",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("R2 ga ulanib bo'lmadi");
  });
});

describe("SwitchStorage", () => {
  it("yozish faolga, o'qish avval faoldan keyin ikkinchisidan, o'chirish ikkalasidan", async () => {
    const now = () => new Date();
    const local = new LocalStorage(mkdtempSync(join(tmpdir(), "aes-a-")), "https://x", now);
    const other = new LocalStorage(mkdtempSync(join(tmpdir(), "aes-b-")), "https://x", now);
    const sw = new SwitchStorage(local, other as unknown as S3Storage, "local");
    await sw.putBytes("k/old.txt", Buffer.from("eski"));
    sw.configure(other as unknown as S3Storage, "s3");
    expect(sw.driver).toBe("s3");
    expect((await sw.getBytes("k/old.txt"))?.toString()).toBe("eski");
    await sw.putBytes("k/new.txt", Buffer.from("yangi"));
    expect(await local.head("k/new.txt")).toBeNull();
    expect(await other.head("k/new.txt")).not.toBeNull();
    expect(await sw.list("k/")).toEqual(["k/new.txt", "k/old.txt"]);
    await sw.delete("k/old.txt");
    expect(await sw.head("k/old.txt")).toBeNull();
  });
});
