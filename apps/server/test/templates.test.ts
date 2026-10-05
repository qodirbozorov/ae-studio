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

describe("shablon MCP toollari (P5.02)", () => {
  it("templates_list / template_get: slotlar, filtr, namuna sahna", async () => {
    const list = (await s.call("templates_list", { format: "16:9" })).result.data;
    const hook = list.find((e: { slug: string }) => e.slug === "hook_title");
    expect(hook).toMatchObject({
      source: "recipe",
      origin: "builtin",
      slots: {
        title: { type: "text", required: true, max_chars: 40 },
        kicker: { required: false },
      },
    });
    const got = (await s.call("template_get", { slug: "hook_title" })).result.data;
    expect(got.example_scene).toEqual({
      id: "s1",
      dur: 4,
      template: "hook_title",
      slots: { title: "<Sarlavha>", bg: "asset:<key>" },
    });
    expect((await s.call("template_get", { slug: "yoq" })).result.error.code).toBe(
      "SPEC_UNKNOWN_TEMPLATE",
    );
  });

  it("template_apply: new → append → slot xatosi", async () => {
    const created = await s.call("template_apply", {
      project_id: projectId,
      slug: "hook_title",
      mode: "new",
      format: "1:1",
      slots: { title: "Birinchi", bg: "asset:clip_01" },
      output_name: "kvadrat",
    });
    expect(created.result.data).toMatchObject({
      plan_version: 1,
      scene_id: "hook_title_1",
      format: { w: 1080, h: 1080, fps: 30 },
    });
    const appended = await s.call("template_apply", {
      project_id: projectId,
      slug: "hook_title",
      slots: { title: "Ikkinchi", bg: "asset:clip_01" },
      dur: 2,
    });
    expect(appended.result.data).toMatchObject({
      plan_version: 2,
      scene_id: "hook_title_2",
      scenes: ["hook_title_1", "hook_title_2"],
    });
    const bad = await s.call("template_apply", {
      project_id: projectId,
      slug: "hook_title",
      slots: { title: "x".repeat(41), bg: "asset:clip_01" },
    });
    expect(bad.result.error).toMatchObject({ code: "SPEC_INVALID" });
    const pre = await s.call("preflight", { project_id: projectId });
    expect(pre.result.data).toMatchObject({ ready: true, plan_version: 2 });
  });

  it("template_save recipe: sahnadan shablon → qayta ishlatish", async () => {
    await s.call("plan_write", {
      project_id: projectId,
      spec: {
        version: 1,
        format: { w: 1080, h: 1920, fps: 30 },
        scenes: [
          {
            id: "promo",
            dur: 3,
            bg: "#101820",
            layers: [
              { id: "photo", type: "media", src: "asset:clip_01", anim: "fade_in" },
              { id: "headline", type: "text", text: "Yangi mahsulot", anim: "pop" },
              { type: "shape", kind: "rect", color: "#FFCC00", size: { w: 0.5, h: 0.01 } },
            ],
          },
        ],
      },
    });
    const saved = await s.call("template_save", {
      project_id: projectId,
      scene_id: "promo",
      slug: "my_promo",
      title: "Mening promo",
    });
    expect(saved.result.data).toMatchObject({
      slug: "my_promo",
      origin: "user",
      version: 1,
      source: "recipe",
      formats: ["9:16"],
      duration: { min: 1.5, max: 6 },
      slots: {
        photo: { type: "media", required: false, default: "asset:clip_01" },
        headline: { type: "text", default: "Yangi mahsulot" },
      },
    });
    const applied = await s.call("template_apply", {
      project_id: projectId,
      slug: "my_promo",
      mode: "new",
      slots: { headline: "Chegirma" },
    });
    expect(applied.result.ok).toBe(true);
    const { id, status } = await runJob(
      (await t.app.jobs.plan(projectId, applied.result.data.plan_version))!.spec,
    );
    expect(status.state).toBe("VERIFY");
    const rows = await t.db.db.select().from(ops).where(eq(ops.jobId, id));
    expect(rows.find((r) => r.opId === "my_promo_1.tpl.headline")!.params).toMatchObject({
      text: "Chegirma",
      name: "headline",
    });
    expect(rows.find((r) => r.opId === "my_promo_1.comp")!.params).toMatchObject({
      bg: "#101820",
    });
  });

  it("template_save aep: qurilgan .aep panel orqali storage'ga → keyingi build'da yuklanadi", async () => {
    const spec = {
      version: 1,
      format: { w: 1080, h: 1920, fps: 30 },
      output: { name: "src" },
      scenes: [
        {
          id: "intro",
          dur: 3,
          layers: [{ id: "title", type: "text", text: "Salom" }],
        },
      ],
    };
    const early = await s.call("template_save", {
      project_id: projectId,
      scene_id: "intro",
      slug: "intro_aep",
      source: "aep",
    });
    expect(early.result.error.message).toMatch(/job_id/);
    const { id } = await runJob(spec);
    const saved = await s.call("template_save", {
      project_id: projectId,
      scene_id: "intro",
      slug: "intro_aep",
      source: "aep",
      job_id: id,
    });
    expect(saved.result.data).toMatchObject({ source: "aep", slots: { title: { type: "text" } } });
    expect(agent.uploads).toEqual(["reel_v001.aep"]);
    const entry = (await t.app.templates.get(userId, "intro_aep"))!;
    expect(entry.manifest).toMatchObject({
      comp: "01_intro",
      slots: { title: { layer: "title" } },
    });

    await s.call("job_cancel", { job_id: id });
    await t.app.jobs.idle();
    const next = await runJob({
      ...spec,
      scenes: [{ id: "s1", dur: 5, template: "intro_aep", slots: { title: "Yangi" } }],
    });
    expect(next.status.state).toBe("VERIFY");
    expect(agent.files.get("templates/intro_aep_v1.aep")).toBe(entry.manifest.files!.aep!.sha256);
  });

  it("/from-template prompt", async () => {
    const got = await s.rpc("prompts/get", {
      name: "from-template",
      arguments: { template: "hook_title", content: "Chegirma 30%" },
    });
    const text = got.messages[0].content.text as string;
    expect(text).toContain("hook_title");
    expect(text).toContain("template_apply");
    expect(text).toContain("Chegirma 30%");
  });
});
