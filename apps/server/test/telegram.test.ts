/**
 * P5.08: Telegram — kabinetdan kod → botga /start <kod> → bog'lanadi; render tugaganda, BLOCKED bo'lganda
 * va batch yakunida (bitta umumiy) xabar; token yo'q bo'lsa o'chiq.
 */
import { makeError } from "@aes/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { devices, projects, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import type { ScannedAsset } from "./helpers/fake-agent";
import { FakeTelegram } from "./helpers/fake-telegram";
import { mcpSession } from "./helpers/mcp";
import type { McpSession } from "./helpers/mcp";

const ROOT = "D:/Projects/tg";
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
let tg: FakeTelegram;
let cookie: string;
let s: McpSession;
let agent: FakeAgent;
let projectId: string;

beforeEach(async () => {
  tg = new FakeTelegram();
  t = await createTestApp(
    {
      TELEGRAM_BOT_TOKEN: "TEST:TOKEN",
      TELEGRAM_BOT_USERNAME: "aestudio_bot",
      TELEGRAM_API_URL: "https://tg.test",
    },
    undefined,
    { telegramOptions: { fetch: tg.fetch, poll: false } },
  );
  cookie = await login(t, "tg@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "tg@x.uz"));
  const [device] = await t.db.db
    .insert(devices)
    .values({ userId: user!.id, name: "PC", os: "win" })
    .returning();
  const [project] = await t.db.db
    .insert(projects)
    .values({ userId: user!.id, deviceId: device!.id, name: "reel", rootPath: ROOT })
    .returning();
  projectId = project!.id;
  agent = new FakeAgent(
    t.app.hub,
    { userId: user!.id, deviceId: device!.id },
    { root: ROOT, assets: ASSETS },
  );
  agent.connect();
  s = await mcpSession(t, "tg@x.uz");
});

afterEach(async () => {
  await t.close();
});

async function link(): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/api/settings/telegram/code",
    headers: { cookie },
  });
  const code = res.json().data.code as string;
  tg.userWrites(777, `/start ${code}`);
  await t.app.telegram.pollOnce(0);
  return code;
}

async function runJob() {
  await s.call("plan_write", { project_id: projectId, spec: THREE_SCENES });
  const id = (await s.call("build_start", { project_id: projectId })).result.data.id as string;
  await t.app.jobs.idle();
  await t.app.telegram.idle();
  return id;
}

describe("Telegram", () => {
  it("bog'lash: kod (deep link) → /start → ulandi; noto'g'ri va eskirgan kod; uzish", async () => {
    const before = await t.app.inject({
      method: "GET",
      url: "/api/settings/telegram",
      headers: { cookie },
    });
    expect(before.json().data).toEqual({
      enabled: true,
      linked: false,
      bot_username: "aestudio_bot",
      chat: null,
    });

    const res = await t.app.inject({
      method: "POST",
      url: "/api/settings/telegram/code",
      headers: { cookie },
    });
    const { code, link: url } = res.json().data;
    expect(url).toBe(`https://t.me/aestudio_bot?start=${code}`);

    tg.userWrites(555, "/start ABCDEF0123");
    await t.app.telegram.pollOnce(0);
    expect(tg.sent.at(-1)!.text).toMatch(/noto'g'ri/);

    tg.userWrites(777, `/start ${code}`);
    await t.app.telegram.pollOnce(0);
    expect(tg.sent.at(-1)).toMatchObject({
      chat_id: "777",
      text: expect.stringContaining("ulandi"),
    });
    const after = await t.app.inject({
      method: "GET",
      url: "/api/settings/telegram",
      headers: { cookie },
    });
    expect(after.json().data).toMatchObject({ linked: true, chat: "Ali" });
    // Kod bir martalik.
    tg.userWrites(888, code);
    await t.app.telegram.pollOnce(0);
    expect(tg.sent.at(-1)!.text).toMatch(/noto'g'ri/);

    // Eskirgan kod.
    const fresh = (
      await t.app.inject({
        method: "POST",
        url: "/api/settings/telegram/code",
        headers: { cookie },
      })
    ).json().data.code;
    t.clock.advance(16 * 60_000);
    tg.userWrites(999, fresh);
    await t.app.telegram.pollOnce(0);
    expect(tg.sent.at(-1)!.text).toMatch(/eskirgan/);

    await t.app.inject({ method: "DELETE", url: "/api/settings/telegram", headers: { cookie } });
    expect((await t.app.telegram.status((await t.db.db.select().from(users))[0]!.id)).linked).toBe(
      false,
    );
  });

  it("render tugadi → xabar (fayl yo'li); BLOCKED → xabar", async () => {
    await link();
    const id = await runJob();
    await s.call("verify_approve", { job_id: id });
    await t.app.jobs.idle();
    await t.app.telegram.idle();
    await t.app.jobs.idle();
    await t.app.telegram.idle();
    const done = tg.sent.filter((m) => m.text.startsWith("🎬"));
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      chat_id: "777",
      text: expect.stringContaining("out/reel_v1_v001.mp4"),
    });

    agent.onRender = () => makeError("RENDER_FAILED", "disk to'la");
    const second = await runJob();
    await s.call("verify_approve", { job_id: second });
    await t.app.jobs.idle();
    await t.app.telegram.idle();
    const blocked = tg.sent.filter((m) => m.text.startsWith("⚠️"));
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.text).toContain("RENDER_FAILED");
  });

  it("batch: qatorlar alohida emas, yakunda bitta umumiy xabar", async () => {
    await link();
    const started = await s.call("batch_start", {
      project_id: projectId,
      template: "top3_list",
      csv: "name,title,item1,item2,item3\nA,Sarlavha,a,b,c\nB,Sarlavha,d,e,f",
    });
    for (let i = 0; i < 20; i++) {
      await t.app.jobs.idle();
      await t.app.telegram.idle();
      await t.app.batches.idle();
    }
    const status = (await s.call("batch_status", { batch_id: started.result.data.id })).result.data;
    expect(status.status).toBe("done");
    const texts = tg.sent.map((m) => m.text).filter((x) => !x.includes("ulandi"));
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(/Batch tugadi — top3_list: 2\/2/);
    expect(texts[0]).toContain("out/A_v001.mp4");
  });

  it("token yo'q: o'chiq, kod berilmaydi", async () => {
    const plain = await createTestApp();
    const c = await login(plain, "x@x.uz");
    const st = await plain.app.inject({
      method: "GET",
      url: "/api/settings/telegram",
      headers: { cookie: c },
    });
    expect(st.json().data.enabled).toBe(false);
    const code = await plain.app.inject({
      method: "POST",
      url: "/api/settings/telegram/code",
      headers: { cookie: c },
    });
    expect(code.statusCode).toBe(400);
    await plain.close();
  });
});
