import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVICE_GRANT } from "../src/devices/routes";
import { normalizeRootPath, resolveProjectPath } from "../src/projects/routes";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";

let t: TestApp;
let cookie: string;
let deviceToken: string;

beforeAll(async () => {
  t = await createTestApp();
  cookie = await login(t, "proj@x.uz");
  const code = (
    await t.app.inject({
      method: "POST",
      url: "/oauth/device/code",
      payload: { device_name: "PC", os: "win" },
    })
  ).json() as { device_code: string; user_code: string };
  await t.app.inject({
    method: "POST",
    url: "/api/devices/confirm",
    headers: { cookie },
    payload: { user_code: code.user_code, approve: true },
  });
  t.clock.advance(6_000);
  deviceToken = (
    await t.app.inject({
      method: "POST",
      url: "/oauth/device/token",
      payload: { grant_type: DEVICE_GRANT, device_code: code.device_code },
    })
  ).json().access_token;
});

afterAll(async () => {
  await t.close();
});

const register = (root_path: string, token = deviceToken) =>
  t.app.inject({
    method: "POST",
    url: "/api/agent/projects",
    headers: { authorization: `Bearer ${token}` },
    payload: { root_path },
  });

describe("loyihalar (§5 projects)", () => {
  it("panel papkani ro'yxatdan o'tkazadi; bir papka = bitta loyiha", async () => {
    const first = (await register("D:\\Projects\\Reel 01\\")).json();
    expect(first).toMatchObject({
      ok: true,
      data: { name: "Reel 01", root_path: "D:/Projects/Reel 01" },
    });
    const again = (await register("D:/Projects/Reel 01")).json();
    expect(again.data.id).toBe(first.data.id);

    const list = (
      await t.app.inject({
        url: "/api/agent/projects",
        headers: { authorization: `Bearer ${deviceToken}` },
      })
    ).json();
    expect(list.data).toHaveLength(1);
    const cabinet = (await t.app.inject({ url: "/api/projects", headers: { cookie } })).json();
    expect(cabinet.data[0]).toMatchObject({ id: first.data.id });
  });

  it("nisbiy yoki '..' li papka rad etiladi; tokensiz 401", async () => {
    expect((await register("Projects/reel")).json().error.code).toBe("ENV_NO_FOLDER");
    expect((await register("D:/a/../b")).json().error.code).toBe("ENV_NO_FOLDER");
    expect((await register("D:/x", "wrong")).statusCode).toBe(401);
  });

  it("normalizeRootPath va server tomonidagi path guard (§4.4)", () => {
    expect(normalizeRootPath("/Users/a/reel/")).toBe("/Users/a/reel");
    expect(normalizeRootPath("C:\\")).toBe("C:/");
    expect(normalizeRootPath("reel")).toBeNull();
    const project = { rootPath: "D:/Projects/Reel 01" };
    expect(resolveProjectPath(project, "source/a.mp4")).toEqual({
      ok: true,
      data: "D:/Projects/Reel 01/source/a.mp4",
    });
    expect(resolveProjectPath(project, "../secret.txt").ok).toBe(false);
    expect(resolveProjectPath(project, "C:/Windows/x").ok).toBe(false);
  });
});
