import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { oauthTokens, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.close();
});

function linkFromLastMail(): string {
  const text = t.mailer.sent.at(-1)?.text ?? "";
  return /https:\/\/aes\.test(\/api\/auth\/verify\?token=[^\s"]+)/.exec(text)![1]!;
}

describe("magic link login (§4.3)", () => {
  it("to'liq oqim: xat → havola → cookie → /api/me → logout", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "  Ali@Example.COM ", next: "/device?code=ABC123" },
    });
    expect(res.json()).toEqual({ ok: true, data: { sent: true } });
    expect(t.mailer.sent.at(-1)?.to).toBe("ali@example.com");

    const verify = await t.app.inject({ method: "GET", url: linkFromLastMail() });
    expect(verify.statusCode).toBe(303);
    expect(verify.headers.location).toBe("/device?code=ABC123");
    const cookie = verify.cookies.find((c) => c.name === "aes_session")!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });

    const me = await t.app.inject({
      url: "/api/me",
      headers: { cookie: `aes_session=${cookie.value}` },
    });
    expect(me.json()).toMatchObject({ ok: true, data: { email: "ali@example.com" } });

    const logout = await t.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: `aes_session=${cookie.value}` },
    });
    expect(logout.json()).toMatchObject({ ok: true });
    const after = await t.app.inject({
      url: "/api/me",
      headers: { cookie: `aes_session=${cookie.value}` },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe("AUTH_EXPIRED");
  });

  it("havola bir martalik va 15 daqiqadan keyin eskiradi", async () => {
    t.clock.advance(60_000);
    await t.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "b@x.uz" },
    });
    const link = linkFromLastMail();
    expect((await t.app.inject(link)).statusCode).toBe(303);
    expect((await t.app.inject(link)).statusCode).toBe(401);

    t.clock.advance(60_000);
    await t.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "c@x.uz" },
    });
    const stale = linkFromLastMail();
    t.clock.advance(15 * 60 * 1000 + 1);
    expect((await t.app.inject(stale)).json().error.code).toBe("AUTH_EXPIRED");
  });

  it("DB'da token o'zi emas, faqat sha256 hash saqlanadi", async () => {
    t.clock.advance(60_000);
    await t.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "d@x.uz" },
    });
    const token = decodeURIComponent(linkFromLastMail().split("token=")[1]!);
    const rows = await t.db.db.select().from(oauthTokens).where(eq(oauthTokens.kind, "magic_link"));
    expect(rows.some((r) => r.hash === token)).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.hash))).toBe(true);
  });

  it("bir email'ga qayta havola 30 s kutadi; noto'g'ri email 400", async () => {
    t.clock.advance(60_000);
    const send = () =>
      t.app.inject({ method: "POST", url: "/api/auth/magic-link", payload: { email: "e@x.uz" } });
    expect((await send()).statusCode).toBe(200);
    expect((await send()).json().error.code).toBe("SYS_RATE_LIMIT");
    const bad = await t.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "nope" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("tashqi `next` yo'naltirish qabul qilinmaydi (open redirect yo'q)", async () => {
    t.clock.advance(60_000);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "f@x.uz", next: "//evil.com" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("bir email = bitta user; sessiyasiz /api/me 401", async () => {
    t.clock.advance(60_000);
    await login(t, "same@x.uz");
    await login(t, "SAME@x.uz");
    const rows = await t.db.db.select().from(users).where(eq(users.email, "same@x.uz"));
    expect(rows).toHaveLength(1);
    expect((await t.app.inject("/api/me")).statusCode).toBe(401);
  });
});
