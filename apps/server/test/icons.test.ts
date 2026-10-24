/**
 * Ikonkalar: Lucide (lokal) + Iconify (soxta API, kesh), PDF geometriyasi (ikonka sahifani to'liq va
 * markazda egallaydi) va build: footage ikonkalari PDF bo'lib panelga, as_shapes — native shape qatlam.
 */
import { inflateSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { devices, projects, users } from "../src/db/schema";
import { IconLibrary } from "../src/icons/library";
import { iconPdf, iconSvg } from "../src/icons/svg";
import { lucideIcon } from "../src/icons/lucide";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import { mcpSession } from "./helpers/mcp";

const MDI_BELL = {
  body: '<path fill="currentColor" d="M21 19v1H3v-1l2-2v-6c0-3.1 2-5.8 5-6.7V4a2 2 0 0 1 4 0v.3c3 .9 5 3.6 5 6.7v6zm-7 2a2 2 0 0 1-4 0" />',
};

/** Soxta `api.iconify.design`: `/<prefix>.json?icons=` va `/search`. */
function fakeIconify() {
  const calls: string[] = [];
  let down = false;
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (down) throw new Error("ECONNREFUSED");
    if (url.pathname === "/search") {
      return Response.json({
        icons: ["mdi:bell", "line-md:bell-loop", "simple-icons:youtube"],
        collections: {
          mdi: { name: "Material Design Icons", license: { spdx: "Apache-2.0" } },
          "line-md": { name: "Material Line Icons", license: { spdx: "MIT" } },
          "simple-icons": { name: "Simple Icons", license: { spdx: "CC0-1.0" } },
        },
      });
    }
    if (url.pathname === "/mdi.json") {
      const wanted = url.searchParams.get("icons")!.split(",");
      return Response.json({
        prefix: "mdi",
        width: 24,
        height: 24,
        icons: Object.fromEntries(wanted.filter((n) => n === "bell").map((n) => [n, MDI_BELL])),
        ...(wanted.includes("bell") ? {} : { not_found: wanted }),
      });
    }
    if (url.pathname === "/line-md.json") {
      return Response.json({
        prefix: "line-md",
        icons: { "bell-loop": { body: '<path d="M0 0h1"><animate attributeName="d"/></path>' } },
      });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;
  return {
    fetch: fetchFn,
    calls,
    setDown(value: boolean) {
      down = value;
    },
  };
}

function memoryStorage() {
  const store = new Map<string, Buffer>();
  return {
    store,
    storage: {
      getBytes: async (key: string) => store.get(key) ?? null,
      putBytes: async (key: string, data: Buffer) => {
        store.set(key, data);
      },
    },
  };
}

const log = { warn: () => {} } as never;

describe("IconLibrary", () => {
  it("Lucide lokal; Iconify API'dan, keyin xotira/storage keshidan", async () => {
    const api = fakeIconify();
    const mem = memoryStorage();
    const lib = new IconLibrary(mem as never, log, { fetch: api.fetch });
    const res = await lib.resolve(["bell", "lucide:bell", "mdi:bell"]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.data).sort()).toEqual(["lucide:bell", "mdi:bell"]);
    expect(res.data["mdi:bell"]).toMatchObject({ left: 0, top: 0, width: 24, height: 24 });
    expect(api.calls).toEqual(["/mdi.json?icons=bell"]);
    expect(mem.store.has("cache/iconify/mdi/bell.json")).toBe(true);

    // Yangi jarayon (xotira bo'sh), Iconify ishlamaydi — storage keshidan.
    api.setDown(true);
    const again = await new IconLibrary(mem as never, log, { fetch: api.fetch }).resolve([
      "mdi:bell",
    ]);
    expect(again.ok).toBe(true);
    expect(api.calls).toHaveLength(1);
  });

  it("topilmadi → SPEC_INVALID; Iconify ishlamasa → SYS_INTERNAL; animatsiyali → SPEC_INVALID", async () => {
    const api = fakeIconify();
    const lib = new IconLibrary(memoryStorage() as never, log, { fetch: api.fetch });
    expect(await lib.resolve(["lucide:no-such-icon-x"])).toMatchObject({
      ok: false,
      error: { code: "SPEC_INVALID" },
    });
    expect(await lib.resolve(["mdi:nope"])).toMatchObject({
      ok: false,
      error: { code: "SPEC_INVALID" },
    });
    expect(await lib.resolve(["nosuchset:bell"])).toMatchObject({
      ok: false,
      error: { code: "SPEC_INVALID" },
    });
    const animated = await lib.resolve(["line-md:bell-loop"]);
    expect(animated).toMatchObject({ ok: false, error: { code: "SPEC_INVALID" } });
    api.setDown(true);
    expect(await lib.resolve(["mdi:bell"])).toMatchObject({
      ok: false,
      error: { code: "SYS_INTERNAL" },
    });
  });

  it("qidiruv: Lucide birinchi, keyin Iconify (animatsiyali to'plamsiz), litsenziyalar; API yo'q — ogohlantirish", async () => {
    const api = fakeIconify();
    const lib = new IconLibrary(memoryStorage() as never, log, { fetch: api.fetch });
    const found = await lib.search("bell", 5);
    expect(found.icons[0]).toBe("lucide:bell");
    expect(found.icons).toContain("mdi:bell");
    expect(found.icons).not.toContain("line-md:bell-loop");
    expect(found.collections).toMatchObject({
      lucide: { license: "ISC" },
      mdi: { name: "Material Design Icons", license: "Apache-2.0" },
    });
    expect(
      (await lib.search("bell", 5, { source: "lucide" })).icons.every((n) =>
        n.startsWith("lucide:"),
      ),
    ).toBe(true);
    expect((await lib.search("youtube", 5, { prefix: "simple-icons" })).icons).not.toContain(
      "lucide:bell",
    );
    api.setDown(true);
    const offline = await lib.search("bell", 50);
    expect(offline.warning).toContain("Iconify");
    expect(offline.icons[0]).toBe("lucide:bell");
  });
});

describe("PDF geometriyasi", () => {
  it("ikonka 256 pt sahifani to'liq egallaydi: viewBox masshtabi 256/24, px → pt (×0.75) yo'q", async () => {
    const pdf = await iconPdf(iconSvg(lucideIcon("square")!, "#FF3B30", 2));
    const raw = pdf.toString("latin1");
    const stream = /stream\r?\n([\s\S]*?)endstream/.exec(raw)![1]!;
    let content = stream;
    try {
      content = inflateSync(Buffer.from(stream, "latin1")).toString("latin1");
    } catch {
      // siqilmagan oqim
    }
    expect(raw).not.toContain("/Subtype /Image");
    expect(content).not.toMatch(/\b0\.75 0 0 0\.75 0 0 cm/);
    expect(content).toMatch(/\b10\.666667 0 0 10\.666667 0 0 cm/);
    expect(content).toContain("1 J"); // yumaloq uch
  });
});

describe("build: ikonkalar", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.close();
  });

  it("footage ikonkasi — v2 PDF panelga; as_shapes — shape qatlam, PDF'siz; icons_search MCP orqali", async () => {
    const api = fakeIconify();
    t = await createTestApp({}, undefined, { iconOptions: { fetch: api.fetch } });
    await login(t, "icon@x.uz");
    const [user] = await t.db.db.select().from(users).where(eq(users.email, "icon@x.uz"));
    const [device] = await t.db.db
      .insert(devices)
      .values({ userId: user!.id, name: "PC", os: "win" })
      .returning();
    const [project] = await t.db.db
      .insert(projects)
      .values({ userId: user!.id, deviceId: device!.id, name: "icons", rootPath: "D:/i" })
      .returning();
    const agent = new FakeAgent(
      t.app.hub,
      { userId: user!.id, deviceId: device!.id },
      { root: "D:/i" },
    );
    agent.connect();
    const s = await mcpSession(t, "icon@x.uz");

    const search = await s.call("icons_search", { query: "bell", limit: 4 });
    expect(search.result.data.icons[0]).toBe("lucide:bell");

    const spec = {
      version: 1,
      format: { w: 1080, h: 1920, fps: 30 },
      output: { preset: "h264_social", name: "icons" },
      scenes: [
        {
          id: "s1",
          dur: 2,
          layers: [
            { type: "icon", name: "mdi:bell", size: 128, color: "#FFCC00" },
            { id: "draw", type: "icon", name: "lucide:bell", size: 200, as_shapes: true },
          ],
        },
      ],
    };
    expect((await s.call("plan_write", { project_id: project!.id, spec })).result.ok).toBe(true);
    const job = (await s.call("build_start", { project_id: project!.id })).result.data.id;
    await t.app.jobs.idle();
    expect((await s.call("job_status", { job_id: job })).result.data.state).toBe("VERIFY");

    expect([...agent.files.keys()].filter((f) => f.startsWith("icons/"))).toEqual([
      "icons/mdi-bell_ffcc00_200_v2.pdf",
    ]);
    const ops = agent.sentOps();
    expect(ops.find((op) => op.op === "layer.add_media")!.params).toMatchObject({ scale: 0.5 });
    const shape = ops.find((op) => op.op === "layer.add_shape")!;
    expect(shape.params).toMatchObject({ pos: [540, 960] });
    expect(JSON.stringify(shape.params)).toContain('"id":"icon"');
  });
});
