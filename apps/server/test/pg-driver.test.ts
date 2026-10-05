/** Asosiy oqimlar production drayveri (postgres.js) bilan: PGlite drayveri yashirgan xatolarni ushlash uchun. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVICE_GRANT } from "../src/devices/routes";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { createWireTestDb } from "./helpers/db";
import type { TestDb } from "./helpers/db";

let wire: TestDb;
let t: TestApp;

beforeAll(async () => {
  wire = await createWireTestDb();
  t = await createTestApp({}, wire);
});

afterAll(async () => {
  await t.close();
  await wire.close();
});

describe("postgres.js drayveri bilan", () => {
  it("login + device flow + qurilmalar ro'yxati", async () => {
    const cookie = await login(t, "wire@x.uz");
    const code = (
      await t.app.inject({
        method: "POST",
        url: "/oauth/device/code",
        payload: { device_name: "Wire-PC", os: "win" },
      })
    ).json() as { device_code: string; user_code: string };
    expect(code.user_code).toHaveLength(6);

    const pending = await t.app.inject({
      url: `/api/devices/pending?code=${code.user_code}`,
      headers: { cookie },
    });
    expect(pending.json()).toMatchObject({ ok: true });
    await t.app.inject({
      method: "POST",
      url: "/api/devices/confirm",
      headers: { cookie },
      payload: { user_code: code.user_code, approve: true },
    });
    const token = await t.app.inject({
      method: "POST",
      url: "/oauth/device/token",
      payload: { grant_type: DEVICE_GRANT, device_code: code.device_code },
    });
    expect(token.json()).toMatchObject({ token_type: "Bearer" });
    const list = await t.app.inject({ url: "/api/devices", headers: { cookie } });
    expect(list.json().data).toHaveLength(1);
  });
});
