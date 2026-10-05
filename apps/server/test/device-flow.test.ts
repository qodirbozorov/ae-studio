import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticateDevice, DEVICE_GRANT, normalizeUserCode } from "../src/devices/routes";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";

let t: TestApp;
let cookie: string;

beforeAll(async () => {
  t = await createTestApp();
  cookie = await login(t, "owner@x.uz");
});

afterAll(async () => {
  await t.close();
});

async function startFlow() {
  const res = await t.app.inject({
    method: "POST",
    url: "/oauth/device/code",
    payload: { device_name: "Studio-PC", os: "Windows 10" },
  });
  return res.json() as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string;
    interval: number;
    expires_in: number;
  };
}

const poll = (deviceCode: string) =>
  t.app.inject({
    method: "POST",
    url: "/oauth/device/token",
    payload: { grant_type: DEVICE_GRANT, device_code: deviceCode },
  });

const confirm = (userCode: string, approve: boolean) =>
  t.app.inject({
    method: "POST",
    url: "/api/devices/confirm",
    headers: { cookie },
    payload: { user_code: userCode, approve },
  });

describe("device flow (§4.2, RFC 8628)", () => {
  it("to'liq oqim: kod → pending → tasdiq → device_token → qurilma ro'yxatda", async () => {
    const flow = await startFlow();
    expect(flow.user_code).toMatch(/^[BCDFGHJKMNPQRSTWXYZ2-9]{6}$/);
    expect(flow).toMatchObject({
      verification_uri: "https://aes.test/device",
      verification_uri_complete: `https://aes.test/device?code=${flow.user_code}`,
      interval: 5,
      expires_in: 600,
    });

    expect((await poll(flow.device_code)).json()).toMatchObject({ error: "authorization_pending" });
    expect((await poll(flow.device_code)).json()).toMatchObject({ error: "slow_down" });

    // kabinet: kodni ko'rish (kichik harf va tire bilan kiritilgan) va tasdiqlash
    const lower = `${flow.user_code.slice(0, 3).toLowerCase()}-${flow.user_code.slice(3)}`;
    const pending = await t.app.inject({
      url: `/api/devices/pending?code=${lower}`,
      headers: { cookie },
    });
    expect(pending.json()).toMatchObject({ ok: true, data: { device_name: "Studio-PC" } });
    expect((await confirm(lower, true)).json()).toMatchObject({
      ok: true,
      data: { status: "approved" },
    });

    t.clock.advance(6_000);
    const granted = await poll(flow.device_code);
    expect(granted.statusCode).toBe(200);
    const body = granted.json() as { access_token: string; token_type: string; device_id: string };
    expect(body.token_type).toBe("Bearer");

    // device_code bir martalik
    expect((await poll(flow.device_code)).json()).toMatchObject({ error: "expired_token" });

    const identity = await authenticateDevice(
      { db: t.db.db, now: () => t.clock.now },
      `Bearer ${body.access_token}`,
    );
    expect(identity).toEqual({ userId: expect.any(String), deviceId: body.device_id });

    const list = await t.app.inject({ url: "/api/devices", headers: { cookie } });
    expect(list.json().data).toEqual([
      expect.objectContaining({
        id: body.device_id,
        name: "Studio-PC",
        os: "Windows 10",
        revoked_at: null,
      }),
    ]);
  });

  it("rad etilsa access_denied; 10 daqiqadan keyin expired_token", async () => {
    const denied = await startFlow();
    await confirm(denied.user_code, false);
    expect((await poll(denied.device_code)).json()).toMatchObject({ error: "access_denied" });

    const stale = await startFlow();
    t.clock.advance(10 * 60 * 1000 + 1);
    expect((await poll(stale.device_code)).json()).toMatchObject({ error: "expired_token" });
    expect((await confirm(stale.user_code, true)).statusCode).toBe(404);
  });

  it("revoke: qurilma tokeni darhol yaroqsiz bo'ladi", async () => {
    const flow = await startFlow();
    await confirm(flow.user_code, true);
    t.clock.advance(6_000);
    const { access_token, device_id } = (await poll(flow.device_code)).json() as {
      access_token: string;
      device_id: string;
    };
    const ctx = {
      env: {} as never,
      db: t.db.db,
      redis: {} as never,
      mailer: {} as never,
      now: () => t.clock.now,
    };
    expect(await authenticateDevice(ctx, `Bearer ${access_token}`)).not.toBeNull();

    const revoke = await t.app.inject({
      method: "POST",
      url: `/api/devices/${device_id}/revoke`,
      headers: { cookie },
    });
    expect(revoke.json()).toMatchObject({ ok: true });
    expect(await authenticateDevice(ctx, `Bearer ${access_token}`)).toBeNull();
  });

  it("boshqa foydalanuvchi qurilmani bekor qila olmaydi; sessiyasiz tasdiq 401", async () => {
    const flow = await startFlow();
    await confirm(flow.user_code, true);
    t.clock.advance(6_000);
    const { device_id } = (await poll(flow.device_code)).json() as { device_id: string };
    const stranger = await login(t, "stranger@x.uz");
    const res = await t.app.inject({
      method: "POST",
      url: `/api/devices/${device_id}/revoke`,
      headers: { cookie: stranger },
    });
    expect(res.statusCode).toBe(404);
    const anon = await t.app.inject({
      method: "POST",
      url: "/api/devices/confirm",
      payload: { user_code: "BCDFGH", approve: true },
    });
    expect(anon.statusCode).toBe(401);
  });

  it("noto'g'ri so'rovlar: grant_type va device_name", async () => {
    const bad = await t.app.inject({
      method: "POST",
      url: "/oauth/device/token",
      payload: { grant_type: "password", device_code: "x".repeat(20) },
    });
    expect(bad.json()).toMatchObject({ error: "invalid_request" });
    const noName = await t.app.inject({ method: "POST", url: "/oauth/device/code", payload: {} });
    expect(noName.statusCode).toBe(400);
    expect(normalizeUserCode(" bcd-fgh ")).toBe("BCDFGH");
  });
});
