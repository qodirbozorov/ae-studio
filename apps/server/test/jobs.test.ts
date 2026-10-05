/**
 * P2.11: job holat mashinasi soxta agent bilan — to'liq oqim va har bir xato yo'li.
 */
import { makeError } from "@aes/shared";
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { devices, jobEvents, jobs, ops, plans, projects, users } from "../src/db/schema";
import { aepPath, fileBase } from "../src/jobs/engine";
import { actionAllowed, nextState } from "../src/jobs/machine";
import { createTestApp, login } from "./helpers/app";
import { expectPgError } from "./helpers/db";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import type { OpReaction, ScannedAsset } from "./helpers/fake-agent";

const ROOT = "D:/Projects/reel";
const ASSETS: ScannedAsset[] = [
  {
    key: "clip_01",
    local_path: "source/clip_01.mp4",
    kind: "video",
    meta: { width: 1920, height: 1080, duration: 8 },
  },
  {
    key: "photo_02",
    local_path: "source/photo_02.jpg",
    kind: "image",
    meta: { width: 1000, height: 1500 },
  },
  { key: "ding", local_path: "audio/ding.wav", kind: "audio", meta: { duration: 1 } },
];

let t: TestApp;
let cookie: string;
let projectId: string;
let deviceId: string;
let agent: FakeAgent;

async function setup(root = ROOT): Promise<void> {
  t = await createTestApp();
  cookie = await login(t, "jobs@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "jobs@x.uz"));
  const [device] = await t.db.db
    .insert(devices)
    .values({ userId: user!.id, name: "PC", os: "win" })
    .returning();
  const [project] = await t.db.db
    .insert(projects)
    .values({ userId: user!.id, deviceId: device!.id, name: "reel", rootPath: root })
    .returning();
  deviceId = device!.id;
  projectId = project!.id;
  agent = new FakeAgent(t.app.hub, { userId: user!.id, deviceId }, { root, assets: ASSETS });
}

async function api(method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await t.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: response.statusCode, body: response.json() };
}

async function addPlan(spec: unknown = THREE_SCENES): Promise<number> {
  const res = await api("POST", `/api/projects/${projectId}/plans`, { spec });
  expect(res.body.ok).toBe(true);
  return res.body.data.version as number;
}

async function startJob(): Promise<string> {
  const res = await api("POST", `/api/projects/${projectId}/jobs`, {});
  expect(res.body).toMatchObject({ ok: true, data: { state: "CHECK" } });
  await t.app.jobs.idle();
  return res.body.data.id as string;
}

async function job(id: string) {
  await t.app.jobs.idle();
  return (await api("GET", `/api/jobs/${id}`)).body.data;
}

/** Panel ulanishi kabi asinxron hodisalardan keyin: holat o'zgarguncha kutadi. */
async function waitState(id: string, state: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = await job(id);
    if (current.state === state || Date.now() > deadline) return current;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function act(id: string, action: string, extra: object = {}) {
  const res = await api("POST", `/api/jobs/${id}/actions`, { action, ...extra });
  await t.app.jobs.idle();
  return res;
}

async function states(id: string): Promise<string[]> {
  const rows = await t.db.db
    .select()
    .from(jobEvents)
    .where(and(eq(jobEvents.jobId, id), eq(jobEvents.type, "job.state")))
    .orderBy(asc(jobEvents.id));
  return rows.map((row) => (row.data as { to: string }).to);
}

async function opStatuses(id: string) {
  return t.db.db
    .select({ opId: ops.opId, status: ops.status })
    .from(ops)
    .where(eq(ops.jobId, id))
    .orderBy(asc(ops.seq));
}

beforeEach(async () => {
  await setup();
});

afterEach(async () => {
  await t.close();
});

describe("holat mashinasi (sof)", () => {
  it("zanjir va amal ruxsatlari", () => {
    expect(nextState("CHECK")).toBe("PLAN");
    expect(nextState("REPORT")).toBe("DONE");
    expect(() => nextState("DONE")).toThrow();
    expect(actionAllowed("retry", "BLOCKED", false)).toBe(true);
    expect(actionAllowed("retry", "BUILD", false)).toBe(false);
    expect(actionAllowed("approve", "VERIFY", false)).toBe(true);
    expect(actionAllowed("patch", "VERIFY", false)).toBe(true);
    expect(actionAllowed("cancel", "DONE", false)).toBe(false);
    expect(actionAllowed("resume", "BUILD", false)).toBe(false);
    expect(fileBase("Mening reel'im 2")).toBe("Mening_reel_im_2");
    expect(aepPath({ name: "reel" }, 7)).toBe("reel_v007.aep");
  });
});

describe("to'liq oqim", () => {
  it("CHECK → … → VERIFY (qo'lda) → REPORT → DONE, hisobot va versiyalar", async () => {
    agent.connect();
    await addPlan();
    const id = await startJob();

    let current = await job(id);
    expect(current).toMatchObject({ state: "VERIFY", aep_version: 1, patch_count: 0 });
    expect(current.progress.done).toBe(current.progress.total);
    expect(await states(id)).toEqual(["PLAN", "INGEST", "AUDIO", "PREFLIGHT", "BUILD", "VERIFY"]);
    expect(agent.ran[0]).toBe("check.ping");
    expect(agent.ran[1]).toBe("aes.project");
    expect(agent.ofType("assets.scan")).toHaveLength(1);

    // Assetlar INGEST'da yozilgan.
    const assetList = await api("GET", `/api/projects/${projectId}/assets`);
    expect(assetList.body.data.map((a: { key: string }) => a.key).sort()).toEqual([
      "clip_01",
      "ding",
      "photo_02",
    ]);

    const approved = await act(id, "approve");
    expect(approved.body.ok).toBe(true);
    current = await job(id);
    expect(current).toMatchObject({ state: "DONE", outcome: "success" });
    expect((await states(id)).slice(-3)).toEqual(["RENDER", "REPORT", "DONE"]);

    const report = await api("GET", `/api/jobs/${id}/report`);
    expect(report.body.data.markdown).toContain("reel_v001.aep");
    expect(report.body.data.markdown).toContain("| 2 | point | `02_point` | 3 | fade |");

    const events = await api("GET", `/api/jobs/${id}/events`);
    const types = events.body.data.map((e: { type: string }) => e.type);
    expect(types).toContain("check.env");
    expect(types).toContain("audio.skipped");
    expect(types).toContain("render.skipped");

    // Ikkinchi job yangi vNNN oladi: oldingi versiya ustiga yozilmaydi.
    const second = await startJob();
    expect(await job(second)).toMatchObject({ state: "VERIFY", aep_version: 2 });
    const saves = agent.ofType("op.run").filter((m) => m.op.op === "project.open_or_create");
    expect(saves.map((m) => (m.op.params as { path: string }).path)).toEqual([
      "reel_v001.aep",
      "reel_v002.aep",
    ]);
  });

  it("bitta qurilmada bitta aktiv job", async () => {
    agent.connect();
    await addPlan();
    await startJob();
    const again = await api("POST", `/api/projects/${projectId}/jobs`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("JOB_ACTIVE");
  });

  it("plan yo'q → xato; noto'g'ri plan qabul qilinmaydi", async () => {
    const none = await api("POST", `/api/projects/${projectId}/jobs`, {});
    expect(none.body.error.code).toBe("SPEC_INVALID");
    const bad = await api("POST", `/api/projects/${projectId}/plans`, { spec: { version: 1 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("SPEC_INVALID");
  });
});

describe("panel yo'q / uzilish", () => {
  it("panel ulanmagan → WAITING_AGENT; ulanishi bilan davom etadi", async () => {
    await addPlan();
    const id = await startJob();
    expect(await job(id)).toMatchObject({ state: "WAITING_AGENT", prev_state: "CHECK" });

    agent.connect();
    expect(await waitState(id, "VERIFY")).toMatchObject({ state: "VERIFY" });
  });

  it("BUILD o'rtasida uzilish → WAITING_AGENT → oxirgi saqlashdan davom, dublikatsiz", async () => {
    agent.connect();
    await addPlan();
    agent.onOp = (op) => {
      if (op.op_id === "point.caption") {
        agent.disconnect();
        return "drop";
      }
      return "ok";
    };
    const id = await startJob();
    expect(await job(id)).toMatchObject({ state: "WAITING_AGENT", prev_state: "BUILD" });
    const before = await opStatuses(id);
    expect(before.find((o) => o.opId === "point.caption")?.status).toBe("pending");

    agent.onOp = () => "ok";
    const ranBefore = agent.ran.length;
    agent.connect();
    expect(await waitState(id, "VERIFY")).toMatchObject({ state: "VERIFY" });

    const resent = agent.ran.slice(ranBefore);
    // Loyiha qayta ochiladi, keyin oxirgi saqlangan sahnadan (hook.save) keyingi oplar.
    expect(resent[0]).toBe("aes.project");
    expect(resent[1]).toBe("point.comp");
    expect(resent).not.toContain("hook.comp");
    expect(resent).not.toContain("asset.clip_01");
    const after = await opStatuses(id);
    expect(after.every((o) => o.status === "done")).toBe(true);
  });

  it("server qayta ishga tushsa yakunlanmagan job davom etadi", async () => {
    await addPlan();
    const [row] = await t.db.db
      .insert(jobs)
      .values({ projectId, deviceId, planVersion: 1, state: "PLAN" })
      .returning();
    await t.app.jobs.recover();
    // PLAN serverda bajariladi, INGEST panel kutadi.
    expect(await job(row!.id)).toMatchObject({ state: "WAITING_AGENT", prev_state: "INGEST" });
  });
});

describe("BLOCKED yo'llari", () => {
  it("panelda boshqa papka ochiq → BLOCKED ENV_NO_FOLDER → retry", async () => {
    agent.root = "D:/Projects/other";
    agent.connect();
    await addPlan();
    const id = await startJob();
    const blocked = await job(id);
    expect(blocked).toMatchObject({ state: "BLOCKED", prev_state: "CHECK" });
    expect(blocked.error.code).toBe("ENV_NO_FOLDER");

    agent.disconnect();
    agent.root = ROOT;
    agent.connect();
    expect((await act(id, "retry")).body.ok).toBe(true);
    expect(await job(id)).toMatchObject({ state: "VERIFY" });
  });

  it("AE javob bermasa → BLOCKED ENV_AE_CLOSED", async () => {
    agent.connect();
    agent.onOp = (op) => (op.op === "ping" ? makeError("AE_TIMEOUT", "jim") : "ok");
    await addPlan();
    const id = await startJob();
    expect((await job(id)).error.code).toBe("ENV_AE_CLOSED");
  });

  it("INGEST xatosi (panel boshqa papka bilan javob beradi) → BLOCKED", async () => {
    agent.connect();
    await addPlan();
    agent.onOp = (op) => {
      if (op.op === "ping") agent.root = "D:/x";
      return "ok";
    };
    const id = await startJob();
    expect(await job(id)).toMatchObject({ state: "BLOCKED", prev_state: "INGEST" });
  });

  it("PREFLIGHT: noma'lum asset → BLOCKED → patch → davom (patch_count)", async () => {
    agent.connect();
    const broken = structuredClone(THREE_SCENES);
    broken.scenes[0]!.layers[0] = { type: "media", src: "asset:nope", anim: "none" } as never;
    await addPlan(broken);
    const id = await startJob();
    const blocked = await job(id);
    expect(blocked).toMatchObject({ state: "BLOCKED", prev_state: "PREFLIGHT" });
    expect(blocked.error.code).toBe("SPEC_UNKNOWN_ASSET");

    const patched = await act(id, "patch", { spec: THREE_SCENES });
    expect(patched.body.data).toMatchObject({ plan_version: 2, patch_count: 1 });
    // Hech narsa qurilmagan edi: versiya raqami saqlanadi.
    expect(await job(id)).toMatchObject({ state: "VERIFY", aep_version: 1 });
  });

  it("BUILD'da op xatosi → BLOCKED (op_id bilan) → retry oxirgi saqlashdan", async () => {
    agent.connect();
    await addPlan();
    let fails = 1;
    agent.onOp = (op) =>
      op.op_id === "cta.comp" && fails-- > 0 ? makeError("AE_SCRIPT_ERROR", "boom") : "ok";
    const id = await startJob();
    const blocked = await job(id);
    expect(blocked).toMatchObject({ state: "BLOCKED", prev_state: "BUILD" });
    expect(blocked.error).toMatchObject({
      code: "AE_SCRIPT_ERROR",
      details: { op_id: "cta.comp" },
    });
    expect((await opStatuses(id)).find((o) => o.opId === "cta.comp")?.status).toBe("failed");

    const ranBefore = agent.ran.length;
    await act(id, "retry");
    expect(await job(id)).toMatchObject({ state: "VERIFY" });
    const resent = agent.ran.slice(ranBefore);
    expect(resent.slice(0, 2)).toEqual(["aes.project", "cta.comp"]);
  });

  it("VERIFY'dan patch → yangi .aep versiyasi (qurilgan fayl ustiga yozilmaydi)", async () => {
    agent.connect();
    await addPlan();
    const id = await startJob();
    const changed = structuredClone(THREE_SCENES);
    changed.scenes[2]!.dur = 3;
    await act(id, "patch", { spec: changed });
    expect(await job(id)).toMatchObject({ state: "VERIFY", aep_version: 2, plan_version: 2 });
  });

  it("patch chegarasi (3) → LOOP_PATCH_LIMIT", async () => {
    agent.connect();
    await addPlan();
    const id = await startJob();
    for (let i = 0; i < 3; i++) {
      const changed = structuredClone(THREE_SCENES);
      changed.scenes[2]!.dur = 3 + i;
      expect((await act(id, "patch", { spec: changed })).body.ok).toBe(true);
    }
    const limit = await act(id, "patch", { spec: THREE_SCENES });
    expect(limit.status).toBe(409);
    expect(limit.body.error.code).toBe("LOOP_PATCH_LIMIT");
  });

  it("noto'g'ri amal → JOB_BAD_ACTION; ask_user BLOCKED'da qoladi", async () => {
    agent.connect();
    agent.onOp = (op) => (op.op === "ping" ? makeError("AE_SCRIPT_ERROR") : "ok");
    await addPlan();
    const id = await startJob();
    const bad = await act(id, "approve");
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe("JOB_BAD_ACTION");
    expect((await act(id, "ask_user")).body.data.state).toBe("BLOCKED");
  });
});

describe("cancel va pause", () => {
  it("cancel → REPORT → DONE (cancelled), panelga job.cancel", async () => {
    agent.connect();
    await addPlan();
    agent.onOp = async (op): Promise<OpReaction> => {
      if (op.op_id === "point.comp")
        await api("POST", `/api/jobs/${jobId}/actions`, { action: "cancel" });
      return "ok";
    };
    let jobId = "";
    const created = await api("POST", `/api/projects/${projectId}/jobs`, {});
    jobId = created.body.data.id;
    const done = await job(jobId);
    expect(done).toMatchObject({ state: "DONE", outcome: "cancelled" });
    expect(agent.ofType("job.cancel")).toHaveLength(1);
    // Bekor qilingandan keyin boshqa op yuborilmaydi.
    expect(agent.ran.at(-1)).toBe("point.comp");
    const report = await api("GET", `/api/jobs/${jobId}/report`);
    expect(report.body.data.markdown).toContain("Bekor qilindi");
    // Endi yangi job boshlash mumkin.
    expect((await api("POST", `/api/projects/${projectId}/jobs`, {})).body.ok).toBe(true);
  });

  it("pause BUILD'ni oplar orasida to'xtatadi, resume davom ettiradi", async () => {
    agent.connect();
    await addPlan();
    let jobId = "";
    agent.onOp = async (op): Promise<OpReaction> => {
      if (op.op_id === "hook.save")
        await api("POST", `/api/jobs/${jobId}/actions`, { action: "pause" });
      return "ok";
    };
    const created = await api("POST", `/api/projects/${projectId}/jobs`, {});
    jobId = created.body.data.id;
    const paused = await job(jobId);
    expect(paused).toMatchObject({ state: "BUILD", paused: true });
    expect(agent.ran.at(-1)).toBe("hook.save");
    expect(agent.ofType("job.pause")).toHaveLength(1);

    agent.onOp = () => "ok";
    await act(jobId, "resume");
    expect(await job(jobId)).toMatchObject({ state: "VERIFY", paused: false });
  });
});

describe("Live (P2.12): job_events → WS → panel", () => {
  it("panelga job.update (holat, progress, sahna) va job.event keladi", async () => {
    agent.connect();
    await addPlan();
    const id = await startJob();
    await job(id);
    const updates = agent.ofType("job.update").filter((m) => m.job_id === id);
    const seen = [...new Set(updates.map((m) => m.state))];
    expect(seen).toEqual(["PLAN", "INGEST", "AUDIO", "PREFLIGHT", "BUILD", "VERIFY"]);
    const build = updates.filter((m) => m.state === "BUILD");
    expect(build.some((m) => m.scene_id === "point")).toBe(true);
    expect(build.at(-1)!.progress.total).toBeGreaterThan(20);
    expect(updates.at(-1)!.progress.done).toBe(updates.at(-1)!.progress.total);

    const events = agent.ofType("job.event").map((m) => m.event.type);
    expect(events).toContain("check.env");
    expect(events).toContain("build.done");
    expect(events).toContain("verify.waiting");
  });

  it("BLOCKED xatosi job.update ichida; qayta ulanganda aktiv job darhol yuboriladi", async () => {
    agent.connect();
    agent.onOp = (op) => (op.op === "ping" ? makeError("AE_SCRIPT_ERROR", "x") : "ok");
    await addPlan();
    const id = await startJob();
    await job(id);
    const blocked = agent.ofType("job.update").at(-1)!;
    expect(blocked).toMatchObject({ state: "BLOCKED", error: { code: "AE_SCRIPT_ERROR" } });

    agent.disconnect();
    const before = agent.received.length;
    agent.connect();
    const again = await eventuallyMessage(() =>
      agent.received.slice(before).find((m) => m.type === "job.update"),
    );
    expect(again).toMatchObject({ job_id: id, state: "BLOCKED" });
  });

  it("panel tarixi va amallari qurilma tokeni bilan", async () => {
    agent.connect();
    await addPlan();
    const id = await startJob();
    await job(id);
    const token = await deviceToken();
    const auth = { authorization: `Bearer ${token}` };
    const active = await t.app.inject({ url: "/api/agent/jobs/active", headers: auth });
    expect(active.json().data).toMatchObject({ id, state: "VERIFY" });
    const history = await t.app.inject({ url: `/api/agent/jobs/${id}/events`, headers: auth });
    expect(history.json().data.length).toBeGreaterThan(10);
    const approve = await t.app.inject({
      method: "POST",
      url: `/api/agent/jobs/${id}/actions`,
      headers: auth,
      payload: { action: "approve" },
    });
    expect(approve.statusCode).toBe(400);
    const cancel = await t.app.inject({
      method: "POST",
      url: `/api/agent/jobs/${id}/actions`,
      headers: auth,
      payload: { action: "cancel" },
    });
    expect(cancel.json()).toMatchObject({ ok: true });
    expect(await job(id)).toMatchObject({ state: "DONE", outcome: "cancelled" });
  });

  it("Undo last: pauzada oxirgi opni AE'da bekor qiladi, resume uni qayta bajaradi", async () => {
    agent.connect();
    await addPlan();
    let jobId = "";
    agent.onOp = async (op): Promise<OpReaction> => {
      if (op.op_id === "hook.title")
        await api("POST", `/api/jobs/${jobId}/actions`, { action: "pause" });
      return "ok";
    };
    jobId = (await api("POST", `/api/projects/${projectId}/jobs`, {})).body.data.id;
    expect(await job(jobId)).toMatchObject({ state: "BUILD", paused: true });

    agent.onOp = () => "ok";
    const undo = await act(jobId, "undo");
    expect(undo.body.ok).toBe(true);
    const undoOp = agent.ofType("op.run").at(-1)!.op;
    expect(undoOp).toMatchObject({ op: "undo", params: { op_id: "hook.title" } });
    expect((await opStatuses(jobId)).find((o) => o.opId === "hook.title")?.status).toBe("pending");
    // Ikkinchi undo: oldingi op (hook.l0.anim).
    await act(jobId, "undo");
    expect(agent.ofType("op.run").at(-1)!.op.params).toEqual({ op_id: "hook.l0.anim" });

    const ranBefore = agent.ran.length;
    await act(jobId, "resume");
    expect(await job(jobId)).toMatchObject({ state: "VERIFY" });
    expect(agent.ran.slice(ranBefore, ranBefore + 2)).toEqual(["hook.l0.anim", "hook.title"]);
  });

  it("Undo pauzasiz mumkin emas", async () => {
    agent.connect();
    await addPlan();
    const id = await startJob();
    const res = await act(id, "undo");
    expect(res.body.error.code).toBe("JOB_BAD_ACTION");
  });
});

async function eventuallyMessage<T>(read: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("xabar kelmadi");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Shu test qurilmasi uchun device token (oauth_tokens ga to'g'ridan-to'g'ri). */
async function deviceToken(): Promise<string> {
  const { issueToken } = await import("../src/auth/tokens");
  const [device] = await t.db.db.select().from(devices).where(eq(devices.id, deviceId));
  const issued = await issueToken(t.db.db, {
    kind: "device",
    userId: device!.userId,
    deviceId,
    ttlMs: 3_600_000,
    now: t.clock.now,
  });
  return issued.token;
}

describe("versiyalash (P2.13): hech qaysi versiya ustiga yozilmaydi", () => {
  it("plan va hisobot nusxalari .aestudio/ da, har versiya alohida fayl", async () => {
    agent.connect();
    await addPlan();
    const first = await startJob();
    await act(first, "approve");
    expect(await job(first)).toMatchObject({ state: "DONE" });
    expect([...agent.files.keys()].sort()).toEqual([
      ".aestudio/plan.v001.json",
      ".aestudio/report.v001.md",
    ]);

    // Ikkinchi job: shu plan, yangi .aep — plan nusxasi o'sha (bir xil tarkib), hisobot yangi fayl.
    const second = await startJob();
    const changed = structuredClone(THREE_SCENES);
    changed.scenes[0]!.dur = 4;
    await act(second, "patch", { spec: changed });
    expect(await job(second)).toMatchObject({ state: "VERIFY", aep_version: 3, plan_version: 2 });
    await act(second, "approve");
    expect([...agent.files.keys()].sort()).toEqual([
      ".aestudio/plan.v001.json",
      ".aestudio/plan.v002.json",
      ".aestudio/report.v001.md",
      ".aestudio/report.v003.md",
    ]);
    const opens = agent
      .ofType("op.run")
      .filter((m) => m.op.op === "project.open_or_create")
      .map((m) => (m.op.params as { path: string }).path);
    expect(opens).toEqual(["reel_v001.aep", "reel_v002.aep", "reel_v003.aep"]);
    const saves = agent
      .ofType("op.run")
      .filter((m) => m.op.op === "project.save")
      .map((m) => (m.op.params as { version: number }).version);
    expect(new Set(saves)).toEqual(new Set([1, 2, 3]));

    // Hech bir nusxa rad etilmagan (ya'ni hech narsa ustiga yozishga urinilmagan).
    const failed = await t.db.db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.type, "file.copy_failed"));
    expect(failed).toEqual([]);
    const report = await api("GET", `/api/jobs/${second}/report`);
    expect(report.body.data.markdown).toContain("reel_v003.aep");
    expect(report.body.data.markdown).toContain("Patch'lar: 1");
  });

  it("plan versiyasi DB'da o'zgarmas: takroriy versiya rad etiladi", async () => {
    expect(await addPlan()).toBe(1);
    expect(await addPlan()).toBe(2);
    const code = await expectPgError(
      t.db.db.insert(plans).values({ projectId, version: 1, spec: {}, createdBy: "user" }),
    );
    expect(code).toBe("23505");
    const list = await api("GET", `/api/projects/${projectId}/plans`);
    expect(list.body.data.map((p: { version: number }) => p.version)).toEqual([2, 1]);
  });

  it("aep versiyasi loyiha ichida takrorlanmaydi (DB)", async () => {
    await addPlan();
    await t.db.db
      .insert(jobs)
      .values({ projectId, deviceId: null, planVersion: 1, state: "DONE", aepVersion: 1 });
    const code = await expectPgError(
      t.db.db
        .insert(jobs)
        .values({ projectId, deviceId: null, planVersion: 1, state: "DONE", aepVersion: 1 }),
    );
    expect(code).toBe("23505");
  });

  it("panel uzilgan bo'lsa REPORT baribir tugaydi (nusxasiz)", async () => {
    agent.connect();
    await addPlan();
    const id = await startJob();
    agent.disconnect();
    await act(id, "cancel");
    const done = await job(id);
    expect(done).toMatchObject({ state: "DONE", outcome: "cancelled" });
    expect(agent.files.has(".aestudio/report.v001.md")).toBe(false);
  });
});
