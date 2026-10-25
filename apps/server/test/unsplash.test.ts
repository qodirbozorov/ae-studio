/**
 * Unsplash: admin kaliti (tekshirib, shifrlab), qidiruv (atribusiya + UTM, premium filtri, orientatsiya plandan,
 * kesh), loyihaga olish (panel CDN'dan to'g'ridan-to'g'ri, sha256 bilan; asset + stock_photos; download tracking
 * bir marta), credits.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { assets, devices, projects, stockPhotos, systemSettings, users } from "../src/db/schema";
import { stockKey } from "../src/stock/import";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import { mcpSession } from "./helpers/mcp";

const GOOD_KEY = "unsplash_access_key_0123456789";
const BYTES = Buffer.from("jpeg-bytes-of-cotton-field");

const photo = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  width: 6000,
  height: 4000,
  color: "#d9c8a0",
  alt_description: "cotton field at sunrise",
  urls: {
    raw: `https://images.unsplash.com/photo-${id}?ixid=abc`,
    full: `https://images.unsplash.com/photo-${id}?full`,
    regular: `https://images.unsplash.com/photo-${id}?w=1080`,
    small: `https://images.unsplash.com/photo-${id}?w=400`,
    thumb: `https://images.unsplash.com/photo-${id}?w=200`,
  },
  links: {
    html: `https://unsplash.com/photos/${id}`,
    download_location: `https://api.unsplash.com/photos/${id}/download?ixid=abc`,
  },
  user: { name: "Aziz Karimov", username: "aziz", links: { html: "https://unsplash.com/@aziz" } },
  ...extra,
});

function fakeUnsplash() {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    if (url.host === "images.unsplash.com") {
      calls.push(`cdn ${url.pathname}?w=${url.searchParams.get("w")}`);
      return new Response(BYTES, { headers: { "content-type": "image/jpeg" } });
    }
    calls.push(`${url.pathname}${url.search}`);
    const headers = {
      "content-type": "application/json",
      "x-ratelimit-limit": "50",
      "x-ratelimit-remaining": "41",
    };
    if (auth !== `Client-ID ${GOOD_KEY}`)
      return new Response(
        JSON.stringify({ errors: ["OAuth error: The access token is invalid"] }),
        { status: 401, headers },
      );
    if (url.pathname === "/photos")
      return new Response(JSON.stringify([photo("Ab1-cd")]), { headers });
    if (url.pathname === "/search/photos") {
      return new Response(
        JSON.stringify({
          total: 2,
          total_pages: 1,
          results: [photo("Ab1-cd"), photo("PLUS99", { premium: true })],
        }),
        { headers },
      );
    }
    if (url.pathname === "/photos/Ab1-cd")
      return new Response(JSON.stringify(photo("Ab1-cd")), { headers });
    if (url.pathname === "/photos/Ab1-cd/download")
      return new Response(JSON.stringify({ url: "x" }), { headers });
    return new Response(JSON.stringify({ errors: ["Couldn't find Photo"] }), {
      status: 404,
      headers,
    });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

let t: TestApp;
afterEach(async () => {
  await t.close();
});

async function start() {
  const api = fakeUnsplash();
  t = await createTestApp(
    { ADMIN_LOGIN: "boss", ADMIN_PASSWORD: "juda-uzun-parol-123" },
    undefined,
    {
      unsplashOptions: { fetch: api.fetch, baseUrl: "https://api.unsplash.com" },
    },
  );
  const res = await t.app.inject({
    method: "POST",
    url: "/api/admin/login",
    payload: { login: "boss", password: "juda-uzun-parol-123" },
  });
  const admin = `aes_admin=${res.cookies.find((c) => c.name === "aes_admin")!.value}`;
  return { api, admin };
}

const adminCall = (cookie: string, method: "GET" | "PUT" | "DELETE", payload?: object) =>
  t.app.inject({
    method,
    url: "/api/admin/unsplash",
    headers: { cookie },
    ...(payload === undefined ? {} : { payload }),
  });

async function project(email: string) {
  await login(t, email);
  const [user] = await t.db.db.select().from(users).where(eq(users.email, email));
  const [device] = await t.db.db
    .insert(devices)
    .values({ userId: user!.id, name: "PC", os: "win" })
    .returning();
  const [row] = await t.db.db
    .insert(projects)
    .values({ userId: user!.id, deviceId: device!.id, name: "reel", rootPath: "D:/r" })
    .returning();
  const agent = new FakeAgent(
    t.app.hub,
    { userId: user!.id, deviceId: device!.id },
    { root: "D:/r" },
  );
  return { project: row!, agent, s: await mcpSession(t, email) };
}

describe("Unsplash", () => {
  it("admin: noto'g'ri kalit saqlanmaydi; to'g'risi shifrlanadi, limit ko'rinadi", async () => {
    const { admin } = await start();
    expect((await adminCall(admin, "GET")).json().data).toMatchObject({
      configured: false,
      stats: { total: 0 },
    });
    const bad = await adminCall(admin, "PUT", { api_key: "wrong_key_wrong_key_000" });
    expect(bad.statusCode).toBe(400);
    expect(await t.db.db.select().from(systemSettings)).toEqual([]);
    const good = await adminCall(admin, "PUT", { api_key: GOOD_KEY });
    expect(good.json().data).toMatchObject({
      configured: true,
      masked: "…6789",
      rate: { limit: 50, remaining: 41 },
    });
    expect(good.body).not.toContain(GOOD_KEY);
    expect(JSON.stringify(await t.db.db.select().from(systemSettings))).not.toContain(GOOD_KEY);
    expect((await t.app.inject({ url: "/api/admin/unsplash" })).statusCode).toBe(401);
  });

  it("qidiruv: sozlanmagan → xato; atribusiya + UTM, premium chiqariladi, orientatsiya plandan, kesh", async () => {
    const { api, admin } = await start();
    const { project: p, s } = await project("img@x.uz");
    expect((await s.call("images_search", { query: "cotton field" })).result.error.code).toBe(
      "SYS_BAD_REQUEST",
    );
    await adminCall(admin, "PUT", { api_key: GOOD_KEY });
    await s.call("plan_write", { project_id: p.id, spec: THREE_SCENES });
    const found = (await s.call("images_search", { query: "cotton field", project_id: p.id }))
      .result.data;
    expect(found.orientation).toBe("portrait");
    expect(found.photos).toHaveLength(1);
    expect(found.photos[0]).toMatchObject({
      id: "Ab1-cd",
      description: "cotton field at sunrise",
      author: "Aziz Karimov",
      author_url: "https://unsplash.com/@aziz?utm_source=ae_studio&utm_medium=referral",
      photo_url: "https://unsplash.com/photos/Ab1-cd?utm_source=ae_studio&utm_medium=referral",
      attribution: "Photo by Aziz Karimov on Unsplash",
    });
    const searches = () => api.calls.filter((c) => c.startsWith("/search/photos"));
    expect(searches()[0]).toContain("orientation=portrait");
    expect(searches()[0]).toContain("content_filter=high");
    await s.call("images_search", { query: "cotton field", project_id: p.id });
    expect(searches()).toHaveLength(1);
  });

  it("import: CDN havolasi sha256 bilan panelga, asset + muallif, tracking bir marta; takror — mavjud; credits", async () => {
    const { api, admin } = await start();
    await adminCall(admin, "PUT", { api_key: GOOD_KEY });
    const { project: p, agent, s } = await project("imp@x.uz");
    expect(
      (await s.call("images_import", { project_id: p.id, photo_id: "Ab1-cd" })).result.error.code,
    ).toBe("ENV_AGENT_OFFLINE");
    agent.connect();
    await s.call("plan_write", { project_id: p.id, spec: THREE_SCENES });

    const first = (await s.call("images_import", { project_id: p.id, photo_id: "Ab1-cd" })).result
      .data;
    const key = stockKey("Ab1-cd");
    expect(key).toBe("unsplash_ab1_cd");
    expect(first).toMatchObject({
      key,
      ref: `asset:${key}`,
      local_path: `source/unsplash/${key}.jpg`,
      file_width: 2400,
      file_height: 1600,
      already: false,
    });

    const download = agent.ofType("file.download").at(-1)!;
    expect(new URL(download.url).host).toBe("images.unsplash.com");
    expect(new URL(download.url).searchParams.get("w")).toBe("2400");
    expect(download.sha256).toBe(createHash("sha256").update(BYTES).digest("hex"));
    expect(download.dest).toBe(`source/unsplash/${key}.jpg`);

    const [asset] = await t.db.db.select().from(assets).where(eq(assets.key, key));
    expect(asset).toMatchObject({
      kind: "image",
      status: "ok",
      meta: { width: 2400, height: 1600, provider: "unsplash" },
    });
    const [stock] = await t.db.db.select().from(stockPhotos);
    expect(stock).toMatchObject({ photoId: "Ab1-cd", author: "Aziz Karimov", assetKey: key });
    expect(stock!.downloadTrackedAt).not.toBeNull();
    const tracking = () => api.calls.filter((c) => c.startsWith("/photos/Ab1-cd/download"));
    expect(tracking()).toHaveLength(1);

    const again = (await s.call("images_import", { project_id: p.id, photo_id: "Ab1-cd" })).result
      .data;
    expect(again).toMatchObject({ key, already: true });
    expect(agent.ofType("file.download")).toHaveLength(1);
    expect(tracking()).toHaveLength(1);

    const credits = (await s.call("images_credits", { project_id: p.id })).result.data;
    expect(credits.text).toBe(
      "Photo by Aziz Karimov on Unsplash — https://unsplash.com/photos/Ab1-cd?utm_source=ae_studio&utm_medium=referral",
    );
    expect(
      (await s.call("images_import", { project_id: p.id, photo_id: "Nope99" })).result.error.code,
    ).toBe("SYS_NOT_FOUND");
  });
});
