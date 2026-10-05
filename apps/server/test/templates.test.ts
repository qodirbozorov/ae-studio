/**
 * P5.01: shablon registri (tizim kutubxonasi + DB versiyalar), recipe shablon bilan preflight va job,
 * aep shablon: PREFLIGHT'da fayl panelga yuklanadi, BUILD'da `template.instantiate`.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { devices, ops, projects, users } from "../src/db/schema";
import { templateStorageKey } from "../src/templates/service";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import type { ScannedAsset } from "./helpers/fake-agent";
import { mcpSession } from "./helpers/mcp";
import type { McpSession } from "./helpers/mcp";

const ROOT = "D:/Projects/reel";
const ASSETS: ScannedAsset[] = [
  {
    key: "clip_01",
    local_path: "source/clip_01.mp4",
    kind: "video",
    meta: { width: 1920, height: 1080, duration: 8 },
  },
];

let t: TestApp;
let s: McpSession;
let userId: string;
let projectId: string;
let agent: FakeAgent;

beforeEach(async () => {
  t = await createTestApp();
  await login(t, "tp@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "tp@x.uz"));
  userId = user!.id;
  const [device] = await t.db.db
    .insert(devices)
    .values({ userId, name: "PC", os: "win" })
    .returning();
  const [project] = await t.db.db
    .insert(projects)
    .values({ userId, deviceId: device!.id, name: "reel", rootPath: ROOT })
    .returning();
  projectId = project!.id;
  agent = new FakeAgent(
    t.app.hub,
    { userId, deviceId: device!.id },
    { root: ROOT, assets: ASSETS },
  );
  agent.storage = t.app.storage;
  agent.connect();
  s = await mcpSession(t, "tp@x.uz");
  await s.call("assets_scan", { project_id: projectId });
});

afterEach(async () => {
  await t.close();
});

const HOOK_SPEC = {
  version: 1,
  format: { w: 1080, h: 1920, fps: 30 },
  output: { name: "hook" },
  scenes: [
    {
      id: "s1",
      dur: 3,
      template: "hook_title",
      slots: { title: "3 ta xato", bg: "asset:clip_01" },
    },
  ],
};

async function runJob(spec: unknown) {
  await s.call("plan_write", { project_id: projectId, spec });
  const id = (await s.call("build_start", { project_id: projectId })).result.data.id as string;
  await t.app.jobs.idle();
  return { id, status: (await s.call("job_status", { job_id: id, log_limit: 50 })).result.data };
}

describe("shablon registri", () => {
  it("tizim kutubxonasi; foydalanuvchi shabloni versiyalanadi va tizimnikini yopadi", async () => {
    const list = await t.app.templates.list(userId);
    expect(list.find((e) => e.slug === "hook_title")).toMatchObject({
      origin: "builtin",
      version: 1,
    });
    const own = { ...(await t.app.templates.get(userId, "hook_title"))!.manifest, title: "Mening" };
    const v1 = await t.app.templates.save(userId, own);
    const v2 = await t.app.templates.save(userId, { ...own, title: "Mening 2" });
    expect(v1.ok && v2.ok && [v1.data.version, v2.data.version]).toEqual([1, 2]);
    expect(await t.app.templates.get(userId, "hook_title")).toMatchObject({
      origin: "user",
      version: 2,
      manifest: { title: "Mening 2" },
    });
    expect((await t.app.templates.get(userId, "hook_title", 1))?.manifest.title).toBe("Mening");
    // Boshqa foydalanuvchiga ko'rinmaydi.
    expect(
      (await t.app.templates.get("00000000-0000-4000-8000-000000000000", "hook_title"))!.origin,
    ).toBe("builtin");
  });

  it("aep shablon fayl'siz saqlanmaydi", async () => {
    const res = await t.app.templates.save(userId, {
      slug: "promo",
      comp: "PROMO",
      duration: { min: 2, max: 8 },
      formats: ["9:16"],
      slots: {},
    });
    expect(res.ok ? null : res.error.code).toBe("SYS_BAD_REQUEST");
  });
});

describe("shablonli build", () => {
  it("recipe: preflight va job — shablon layerlari oplarda", async () => {
    await s.call("plan_write", { project_id: projectId, spec: HOOK_SPEC });
    const pre = await s.call("preflight", { project_id: projectId });
    expect(pre.result, JSON.stringify(pre.result)).toMatchObject({
      ok: true,
      data: { ready: true },
    });

    const { id, status } = await runJob(HOOK_SPEC);
    expect(status.state).toBe("VERIFY");
    const rows = await t.db.db.select().from(ops).where(eq(ops.jobId, id));
    const opIds = rows.map((r) => r.opId);
    expect(opIds).toEqual(
      expect.arrayContaining(["s1.tpl.bg", "s1.tpl.shade", "s1.tpl.title", "s1.tpl.underline"]),
    );
    expect(opIds).not.toContain("s1.tpl.kicker");
    expect(rows.find((r) => r.opId === "s1.tpl.title")!.params).toMatchObject({
      text: "3 ta xato",
    });
  });

  it("noma'lum shablon va noto'g'ri slot — tushunarli xato", async () => {
    await s.call("plan_write", {
      project_id: projectId,
      spec: { ...HOOK_SPEC, scenes: [{ ...HOOK_SPEC.scenes[0], template: "yoq" }] },
    });
    expect((await s.call("preflight", { project_id: projectId })).result).toMatchObject({
      ok: false,
      error: { code: "SPEC_UNKNOWN_TEMPLATE" },
    });
    await s.call("plan_write", {
      project_id: projectId,
      spec: { ...HOOK_SPEC, scenes: [{ ...HOOK_SPEC.scenes[0], slots: { bg: "asset:clip_01" } }] },
    });
    expect((await s.call("preflight", { project_id: projectId })).result).toMatchObject({
      ok: false,
      error: { code: "SPEC_INVALID", message: expect.stringContaining("slots/title") },
    });
  });

  it("aep: fayl storage'dan panelga yuklanadi, BUILD'da template.instantiate", async () => {
    const data = Buffer.from("aep bytes");
    const sha256 = createHash("sha256").update(data).digest("hex");
    const key = templateStorageKey(userId, sha256, "aep");
    await t.app.storage.putBytes(key, data, "application/octet-stream");
    const saved = await t.app.templates.save(userId, {
      slug: "promo",
      comp: "PROMO",
      duration: { min: 2, max: 8 },
      formats: ["9:16"],
      slots: {
        title: { type: "text", layer: "TITLE" },
        bg: { type: "media", layer: "BG", fit: "cover" },
      },
      files: { aep: { storage_key: key, sha256, size: data.length } },
    });
    expect(saved.ok).toBe(true);

    const { id, status } = await runJob({
      ...HOOK_SPEC,
      scenes: [
        { id: "s1", dur: 4, template: "promo", slots: { title: "Chegirma", bg: "asset:clip_01" } },
      ],
    });
    expect(status.state).toBe("VERIFY");
    expect(agent.files.get("templates/promo_v1.aep")).toBe(sha256);
    const row = (await t.db.db.select().from(ops).where(eq(ops.jobId, id))).find(
      (r) => r.opId === "s1.tpl",
    )!;
    expect(row).toMatchObject({
      op: "template.instantiate",
      status: "done",
      params: {
        file: "templates/promo_v1.aep",
        template_comp: "PROMO",
        dur: 4,
        // jsonb kalitlar tartibini o'zgartiradi — tartibga bog'liq emas.
        slots: expect.arrayContaining([
          { type: "text", layer: "TITLE", text: "Chegirma" },
          { type: "media", layer: "BG", item: "asset.clip_01", fit: "cover" },
        ]),
      },
    });
    expect(status.logs.map((l: { type: string }) => l.type)).toContain("preflight.templates");
  });
});
