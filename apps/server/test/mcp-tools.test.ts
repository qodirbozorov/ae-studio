/**
 * P3.03: muhit va loyiha toollari (MCP orqali, soxta panel bilan) + JSON Patch.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { devices, projects, users } from "../src/db/schema";
import { applyJsonPatch } from "../src/lib/json-patch";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import { mcpSession } from "./helpers/mcp";
import type { McpSession } from "./helpers/mcp";

const ROOT = "D:/Projects/reel";
let t: TestApp;
let s: McpSession;
let userId: string;

async function addDevice(name = "PC") {
  const [device] = await t.db.db.insert(devices).values({ userId, name, os: "win" }).returning();
  return device!;
}

function agentFor(deviceId: string, root = ROOT) {
  return new FakeAgent(t.app.hub, { userId, deviceId }, { root });
}

async function addProject(deviceId: string, root = ROOT, owner = userId) {
  const [project] = await t.db.db
    .insert(projects)
    .values({ userId: owner, deviceId, name: root.split("/").pop()!, rootPath: root })
    .returning();
  return project!;
}

beforeEach(async () => {
  t = await createTestApp();
  await login(t, "tools@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "tools@x.uz"));
  userId = user!.id;
  s = await mcpSession(t, "tools@x.uz");
});

afterEach(async () => {
  await t.close();
});

describe("env_check / devices_list / ae_info", () => {
  it("qurilma yo'q → ready=false, ENV_AGENT_OFFLINE hint bilan", async () => {
    const { result } = await s.call("env_check");
    expect(result).toMatchObject({ ok: true, data: { ready: false, device: null } });
    expect(result.data.issues[0]).toMatchObject({
      code: "ENV_AGENT_OFFLINE",
      hint: expect.any(String),
    });
  });

  it("panel online, AE va papka bor → ready; ffmpeg yo'q → ENV_FFMPEG_MISSING", async () => {
    const device = await addDevice();
    const agent = agentFor(device.id);
    agent.connect();
    await new Promise((r) => setTimeout(r, 20));
    let { result } = await s.call("env_check");
    expect(result.data).toMatchObject({
      ready: true,
      device: { id: device.id, online: true, ae_version: "22.0", project_root: ROOT },
      checks: { panel: true, folder: ROOT },
    });
    agent.deliver({
      type: "ae.state",
      ae_version: "22.0",
      project_path: null,
      ffmpeg: false,
      busy: false,
    });
    await new Promise((r) => setTimeout(r, 20));
    ({ result } = await s.call("env_check"));
    expect(result.data.ready).toBe(false);
    expect(result.data.issues.map((i: { code: string }) => i.code)).toEqual(["ENV_FFMPEG_MISSING"]);

    const list = await s.call("devices_list");
    expect(list.result.data).toEqual([
      expect.objectContaining({ id: device.id, online: true, ffmpeg: false }),
    ]);
  });

  it("panel AE versiyasini hali yubormagan bo'lsa env_check AE'ni jonli ping qiladi", async () => {
    const device = await addDevice();
    const agent = agentFor(device.id);
    agent.connect();
    agent.deliver({ type: "ae.state", ae_version: null, project_path: null, busy: false });
    await new Promise((r) => setTimeout(r, 20));
    const { result } = await s.call("env_check");
    expect(result.data).toMatchObject({ ready: true, device: { ae_version: "22.0" } });
    expect(agent.ran.some((id) => id.startsWith("mcp.ping."))).toBe(true);
  });

  it("bir nechta qurilma (#7): loyiha qurilmasi avtomatik — project_id bilan yoki oxirgi loyiha bo'yicha", async () => {
    const a = await addDevice("A");
    const b = await addDevice("B");
    agentFor(a.id).connect();
    agentFor(b.id).connect();
    await new Promise((r) => setTimeout(r, 20));
    const project = await addProject(b.id);
    const byProject = await s.call("env_check", { project_id: project.id });
    expect(byProject.result.data.device.name).toBe("B");
    const byRecent = await s.call("env_check");
    expect(byRecent.result.data.device.name).toBe("B");
  });

  it("bir nechta online qurilma → device_id so'raladi", async () => {
    const a = await addDevice("A");
    const b = await addDevice("B");
    agentFor(a.id).connect();
    agentFor(b.id).connect();
    await new Promise((r) => setTimeout(r, 20));
    const { result } = await s.call("env_check");
    expect(result.error.code).toBe("SYS_BAD_REQUEST");
    expect(result.error.details.devices).toHaveLength(2);
    const picked = await s.call("env_check", { device_id: b.id });
    expect(picked.result.data.device.name).toBe("B");
  });

  it("ae_info: AE'dan comp'lar va shriftlar", async () => {
    const device = await addDevice();
    const agent = agentFor(device.id);
    agent.onOp = (op) =>
      op.op === "info"
        ? { info: { ae_version: "24.1", comps: [{ name: "Main" }], fonts: ["Arial"] } }
        : "ok";
    agent.connect();
    await new Promise((r) => setTimeout(r, 20));
    const { result } = await s.call("ae_info");
    expect(result).toMatchObject({ ok: true, data: { ae_version: "24.1", fonts: ["Arial"] } });
    agent.disconnect();
    const offline = await s.call("ae_info");
    expect(offline.result.error.code).toBe("ENV_AGENT_OFFLINE");
  });
});

describe("project_create / project_list / project_get", () => {
  it("panel papkani ochadi va loyiha qaytadi", async () => {
    const device = await addDevice();
    const agent = agentFor(device.id, "");
    agent.onProjectOpen = async (root) => {
      const project = await addProject(device.id, root);
      return { id: project.id, name: project.name, root_path: project.rootPath };
    };
    agent.connect();
    await new Promise((r) => setTimeout(r, 20));
    const created = await s.call("project_create", { root_path: "D:/Videos/promo" });
    expect(created.result).toMatchObject({
      ok: true,
      data: {
        name: "promo",
        root_path: "D:/Videos/promo",
        device: { online: true },
        latest_plan_version: null,
      },
    });
    const relative = await s.call("project_create", { root_path: "videos/promo" });
    expect(relative.result.error.code).toBe("ENV_NO_FOLDER");

    const list = await s.call("project_list");
    expect(list.result.data.map((p: { name: string }) => p.name)).toEqual(["promo"]);
    const got = await s.call("project_get", { project_id: created.result.data.id });
    expect(got.result.data).toMatchObject({ assets: { total: 0 }, plans: [], jobs: [] });
  });

  it("panel ulanmagan → ENV_AGENT_OFFLINE; begona loyiha → SYS_NOT_FOUND", async () => {
    const device = await addDevice();
    const offline = await s.call("project_create", { root_path: "D:/Videos/x" });
    expect(offline.result.error.code).toBe("ENV_AGENT_OFFLINE");

    await login(t, "other@x.uz");
    const [other] = await t.db.db.select().from(users).where(eq(users.email, "other@x.uz"));
    const foreign = await addProject(device.id, "D:/Other", other!.id);
    const res = await s.call("project_get", { project_id: foreign.id });
    expect(res.result.error.code).toBe("SYS_NOT_FOUND");
    const bad = await s.call("project_get", { project_id: "nope" });
    expect(bad.result.error.code).toBe("SYS_BAD_REQUEST");
  });
});

describe("plan_write / plan_patch / plan_get", () => {
  it("versiyalar, xulosa, aniq SPEC_INVALID path'lari", async () => {
    const device = await addDevice();
    const project = await addProject(device.id);
    const written = await s.call("plan_write", { project_id: project.id, spec: THREE_SCENES });
    expect(written.result).toMatchObject({
      ok: true,
      data: {
        version: 1,
        duration_s: 9.5,
        scenes: [{ id: "hook", dur: 3, layers: 2 }, { id: "point" }, { id: "cta" }],
        asset_refs: expect.arrayContaining(["clip_01", "photo_02", "ding"]),
      },
    });

    const broken = structuredClone(THREE_SCENES) as Record<string, unknown>;
    (broken.scenes as { dur: unknown }[])[1]!.dur = -1;
    const invalid = await s.call("plan_write", { project_id: project.id, spec: broken });
    expect(invalid.isError).toBe(true);
    expect(invalid.result.error.code).toBe("SPEC_INVALID");
    expect(JSON.stringify(invalid.result.error.details)).toContain("/scenes/1/dur");

    const patched = await s.call("plan_patch", {
      project_id: project.id,
      patch: [
        { op: "test", path: "/scenes/2/id", value: "cta" },
        { op: "replace", path: "/scenes/2/dur", value: 4 },
      ],
    });
    expect(patched.result.data).toMatchObject({ version: 2, base_version: 1, duration_s: 11 });

    const failedTest = await s.call("plan_patch", {
      project_id: project.id,
      patch: [{ op: "test", path: "/scenes/0/id", value: "boshqa" }],
    });
    expect(failedTest.result.error).toMatchObject({
      code: "SPEC_INVALID",
      details: { op_index: 0 },
    });
    const badPath = await s.call("plan_patch", {
      project_id: project.id,
      patch: [{ op: "remove", path: "/scenes/9" }],
    });
    expect(badPath.result.error.code).toBe("SPEC_INVALID");

    const latest = await s.call("plan_get", { project_id: project.id });
    expect(latest.result.data).toMatchObject({ version: 2, created_by: "claude" });
    expect(latest.result.data.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const first = await s.call("plan_get", { project_id: project.id, version: 1 });
    expect(first.result.data.spec.scenes[2].dur).toBe(2.5);
  });
});

describe("JSON Patch (RFC 6902)", () => {
  const doc = { a: [1, 2], "b/c": { "d~e": 1 } };
  it("add/remove/replace/move/copy/test, escape va massiv '-'", () => {
    const res = applyJsonPatch(doc, [
      { op: "add", path: "/a/-", value: 3 },
      { op: "add", path: "/a/0", value: 0 },
      { op: "replace", path: "/b~1c/d~0e", value: 2 },
      { op: "copy", from: "/a", path: "/copy" },
      { op: "move", from: "/copy", path: "/moved" },
      { op: "remove", path: "/a/1" },
      { op: "test", path: "/moved/3", value: 3 },
    ]);
    expect(res).toEqual({
      ok: true,
      data: { a: [0, 2, 3], "b/c": { "d~e": 2 }, moved: [0, 1, 2, 3] },
    });
    expect(doc.a).toEqual([1, 2]);
  });

  it("xatolar: yo'q yo'l, chegaradan tashqari indeks, o'z ichiga ko'chirish", () => {
    expect(applyJsonPatch(doc, [{ op: "replace", path: "/x", value: 1 }]).ok).toBe(false);
    expect(applyJsonPatch(doc, [{ op: "add", path: "/a/5", value: 1 }]).ok).toBe(false);
    expect(applyJsonPatch(doc, [{ op: "move", from: "/a", path: "/a/0" }]).ok).toBe(false);
    expect(applyJsonPatch(doc, [{ op: "remove", path: "" }]).ok).toBe(false);
  });
});
