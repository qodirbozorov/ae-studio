/**
 * WorldVectorLogo: SVG hujjati → IconData, admin kaliti (tekshirib, shifrlab), kredit tejash (logo storage'da
 * doimiy, qidiruv xotirada), xatolar va build (footage PDF + native shape).
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { devices, projects, systemSettings, users } from "../src/db/schema";
import { svgDocumentToIcon } from "../src/icons/svg";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import { mcpSession } from "./helpers/mcp";

const GOOD_KEY = "wvl_test_key_9876";
const BASE = "https://wvl.test/api/v1";
const SPOTIFY =
  '<svg id="Layer_1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2931 2931" width="2931" height="2931"><style>.st0{fill:#2ebd59}</style><path class="st0" d="M0 0h2931v2931H0z"/></svg>';

function fakeWvl() {
  const calls: { path: string; auth: string | null }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    const path = url.pathname.replace("/api/v1", "");
    calls.push({ path: path + url.search, auth });
    const json = (body: unknown, status = 200) => Response.json(body, { status });
    if (path === "/account/usage") {
      if (auth !== `Bearer ${GOOD_KEY}`) return json({ message: "Unauthenticated." }, 401);
      return json({
        data: {
          plan: "free",
          credits: {
            plan_remaining: 980,
            addon_remaining: 0,
            monthly_allowance: 1000,
            resets_at: "2026-11-21T00:00:00+00:00",
          },
          daily_breakdown: { "2026-10-24": { requests: 20, errors: 1 } },
        },
      });
    }
    if (path === "/logos/search") {
      return json({
        data: [
          { slug: "spotify-2", name: "Spotify", downloads: 900, tags: ["music"] },
          { slug: "spotify-1", name: "Spotify old", downloads: 100 },
        ],
      });
    }
    if (path === "/logos/spotify-2") {
      return json({ data: { slug: "spotify-2", name: "Spotify", svg_content: SPOTIFY } });
    }
    if (path === "/logos/limited") return json({ message: "Too many" }, 429);
    return json({ error: { code: "not_found", message: "Logo not found." } }, 404);
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

describe("svgDocumentToIcon", () => {
  it("viewBox, faqat width/height, ildiz bo'yog'i merosi; ildizsiz — null", () => {
    expect(svgDocumentToIcon(SPOTIFY)).toMatchObject({
      left: 0,
      top: 0,
      width: 2931,
      height: 2931,
      logo: true,
    });
    const sized = svgDocumentToIcon(
      '<?xml version="1.0"?><!-- x --><svg width="200px" height="100" fill="#f00"><path d="M0 0h1v1z"/></svg>',
    );
    expect(sized).toMatchObject({ width: 200, height: 100 });
    expect(sized!.body).toBe('<g fill="#f00"><path d="M0 0h1v1z"/></g>');
    expect(svgDocumentToIcon("<g/>")).toBeNull();
  });
});

describe("WorldVectorLogo", () => {
  let t: TestApp;
  let api: ReturnType<typeof fakeWvl>;
  afterEach(async () => {
    await t.close();
  });

  async function start(): Promise<string> {
    api = fakeWvl();
    t = await createTestApp(
      { ADMIN_LOGIN: "boss", ADMIN_PASSWORD: "juda-uzun-parol-123" },
      undefined,
      { iconOptions: { wvl: { fetch: api.fetch, baseUrl: BASE } } },
    );
    const res = await t.app.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { login: "boss", password: "juda-uzun-parol-123" },
    });
    return `aes_admin=${res.cookies.find((c) => c.name === "aes_admin")!.value}`;
  }

  const admin = (cookie: string, method: "GET" | "PUT" | "DELETE", payload?: object) =>
    t.app.inject({
      method,
      url: "/api/admin/worldvectorlogo",
      headers: { cookie },
      ...(payload === undefined ? {} : { payload }),
    });

  it("admin: noto'g'ri kalit saqlanmaydi; to'g'risi shifrlanadi, kreditlar ko'rinadi; o'chirish", async () => {
    const cookie = await start();
    expect((await admin(cookie, "GET")).json().data).toMatchObject({
      configured: false,
      usage: null,
    });
    const bad = await admin(cookie, "PUT", { api_key: "wrong_key_123" });
    expect(bad.statusCode).toBe(400);
    expect(await t.db.db.select().from(systemSettings)).toEqual([]);

    const good = await admin(cookie, "PUT", { api_key: GOOD_KEY });
    expect(good.json().data).toMatchObject({
      configured: true,
      masked: "…9876",
      usage: {
        plan: "free",
        plan_remaining: 980,
        monthly_allowance: 1000,
        daily: [{ date: "2026-10-24", requests: 20, errors: 1 }],
      },
    });
    expect(good.body).not.toContain(GOOD_KEY);
    const [row] = await t.db.db.select().from(systemSettings);
    expect(JSON.stringify(row)).not.toContain(GOOD_KEY);

    expect((await admin(cookie, "DELETE")).json().data).toMatchObject({ configured: false });
    const unauth = await t.app.inject({ url: "/api/admin/worldvectorlogo" });
    expect(unauth.statusCode).toBe(401);
  });

  it("logo bir marta olinadi (kalit bilan), keyin xotira/storage'dan; xatolar", async () => {
    const cookie = await start();
    await admin(cookie, "PUT", { api_key: GOOD_KEY });
    const first = await t.app.icons.resolve(["wvl:spotify-2"]);
    expect(first.ok && first.data["wvl:spotify-2"]).toMatchObject({ width: 2931, logo: true });
    const logoCalls = () => api.calls.filter((c) => c.path.startsWith("/logos/"));
    expect(logoCalls()).toEqual([{ path: "/logos/spotify-2", auth: `Bearer ${GOOD_KEY}` }]);
    await t.app.icons.resolve(["wvl:spotify-2"]);
    expect(logoCalls()).toHaveLength(1);
    expect(await t.app.storage.getBytes("cache/wvl/spotify-2.json")).not.toBeNull();

    expect(await t.app.icons.resolve(["wvl:nope"])).toMatchObject({
      ok: false,
      error: { code: "SPEC_INVALID" },
    });
    expect(await t.app.icons.resolve(["wvl:limited"])).toMatchObject({
      ok: false,
      error: { code: "SYS_RATE_LIMIT" },
    });
  });

  it("qidiruv faqat source=worldvectorlogo'da va keshlanadi; all — WorldVectorLogo'siz", async () => {
    await start();
    await login(t, "logo@x.uz");
    const s = await mcpSession(t, "logo@x.uz");
    const found = await s.call("icons_search", {
      query: "spotify",
      limit: 5,
      source: "worldvectorlogo",
    });
    expect(found.result.data).toMatchObject({
      icons: ["wvl:spotify-2", "wvl:spotify-1"],
      logos: [
        { name: "wvl:spotify-2", title: "Spotify", downloads: 900, tags: ["music"] },
        { name: "wvl:spotify-1", title: "Spotify old", downloads: 100, tags: [] },
      ],
      collections: { wvl: { name: "WorldVectorLogo" } },
    });
    await s.call("icons_search", { query: "spotify", limit: 2, source: "worldvectorlogo" });
    await s.call("icons_search", { query: "spotify", limit: 5, source: "lucide" });
    expect(api.calls.filter((c) => c.path.startsWith("/logos/search"))).toHaveLength(1);
  });

  it("build: wvl logo — footage PDF va as_shapes native shape (asl rang)", async () => {
    await start();
    await login(t, "wvl@x.uz");
    const [user] = await t.db.db.select().from(users).where(eq(users.email, "wvl@x.uz"));
    const [device] = await t.db.db
      .insert(devices)
      .values({ userId: user!.id, name: "PC", os: "win" })
      .returning();
    const [project] = await t.db.db
      .insert(projects)
      .values({ userId: user!.id, deviceId: device!.id, name: "logo", rootPath: "D:/l" })
      .returning();
    const agent = new FakeAgent(
      t.app.hub,
      { userId: user!.id, deviceId: device!.id },
      { root: "D:/l" },
    );
    agent.connect();
    const s = await mcpSession(t, "wvl@x.uz");
    const spec = {
      version: 1,
      format: { w: 1080, h: 1920, fps: 30 },
      output: { preset: "h264_social", name: "logo" },
      scenes: [
        {
          id: "s1",
          dur: 2,
          layers: [
            { type: "icon", name: "wvl:spotify-2", size: 300 },
            { type: "icon", name: "wvl:spotify-2", size: 300, as_shapes: true },
          ],
        },
      ],
    };
    expect((await s.call("plan_write", { project_id: project!.id, spec })).result.ok).toBe(true);
    const job = (await s.call("build_start", { project_id: project!.id })).result.data.id;
    await t.app.jobs.idle();
    expect((await s.call("job_status", { job_id: job })).result.data.state).toBe("VERIFY");
    expect([...agent.files.keys()].filter((f) => f.startsWith("icons/"))).toEqual([
      "icons/wvl-spotify-2_ffffff_200_v2.pdf",
    ]);
    const shape = agent.sentOps().find((op) => op.op === "layer.add_shape")!;
    expect(JSON.stringify(shape.params)).toContain('"color":"#2EBD59"');
  });
});
