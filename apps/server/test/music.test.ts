/** P8.06: musiqa kutubxonasi — servis, admin API, kutubxona vazifasi va narx. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AudioService } from "../src/audio/service";
import type { AppContext } from "../src/context";
import { devices, musicTracks, projects, usageLedger, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";

let t: TestApp;
let userId: string;
let otherId: string;
let projectId: string;

/** Kichik WAV (davomiylik sarlavhadan o'qiladi). */
function wav(seconds: number, seed = 1): Buffer {
  const rate = 8000;
  const data = Buffer.alloc(Math.round(seconds * rate) * 2, seed);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

beforeEach(async () => {
  t = await createTestApp({ ADMIN_LOGIN: "boss", ADMIN_PASSWORD: "juda-uzun-parol-123" });
  await login(t, "music@x.uz");
  await login(t, "other@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "music@x.uz"));
  const [other] = await t.db.db.select().from(users).where(eq(users.email, "other@x.uz"));
  userId = user!.id;
  otherId = other!.id;
  const [device] = await t.db.db
    .insert(devices)
    .values({ userId, name: "PC", os: "win" })
    .returning();
  const [project] = await t.db.db
    .insert(projects)
    .values({ userId, deviceId: device!.id, name: "reel", rootPath: "D:/r" })
    .returning();
  projectId = project!.id;
});

afterEach(async () => {
  await t.close();
});

describe("MusicLibrary", () => {
  it("qo'shish takrorsiz; qidiruv ball bo'yicha; nomzod faqat egasiga ko'rinadi", async () => {
    const lib = t.app.music;
    const calm = await lib.add({
      bytes: wav(30, 1),
      ext: "wav",
      title: "Calm Piano",
      category: "corporate",
      description: "soft piano, calm, warm pads",
      tags: ["piano", "calm"],
      durationS: 30,
      source: "seed",
      loopable: true,
    });
    expect(calm.created).toBe(true);
    expect(calm.row.storageKey).toMatch(/^music\/[0-9a-f]{24}\.wav$/);
    expect(
      (await lib.add({ ...calm.row, bytes: wav(30, 1), ext: "wav", source: "seed" } as never))
        .created,
    ).toBe(false);
    await lib.add({
      bytes: wav(20, 2),
      ext: "wav",
      title: "Energetic Beat",
      category: "electronic",
      description: "fast drums, energetic",
      durationS: 20,
      source: "seed",
    });
    await lib.add({
      bytes: wav(10, 3),
      ext: "wav",
      title: "Mine",
      category: "generated",
      description: "calm guitar",
      durationS: 10,
      source: "generated",
      status: "candidate",
      ownerUserId: otherId,
    });

    const found = await lib.search(userId, { query: "calm piano" });
    expect(found.tracks.map((tr) => tr.title)).toEqual(["Calm Piano"]);
    expect(found.categories).toEqual(["corporate", "electronic"]);
    expect((await lib.search(otherId, { query: "calm" })).tracks.map((tr) => tr.title)).toEqual([
      "Calm Piano",
      "Mine",
    ]);
    expect((await lib.search(userId, { category: "electronic" })).tracks).toHaveLength(1);
  });
});

describe("admin → musiqa", () => {
  async function cookie(): Promise<string> {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { login: "boss", password: "juda-uzun-parol-123" },
    });
    return `aes_admin=${res.cookies.find((c) => c.name === "aes_admin")!.value}`;
  }

  it("yuklash (xom body), ro'yxat, nomzodni tasdiqlash, o'chirish", async () => {
    const c = await cookie();
    const meta = {
      filename: "lofi.wav",
      title: "Lo-fi",
      category: "chill",
      description: "lofi hip hop, relaxed",
      tags: ["lofi"],
      duration_s: 99,
      status: "candidate",
    };
    const up = await t.app.inject({
      method: "POST",
      url: `/api/admin/music?meta=${encodeURIComponent(JSON.stringify(meta))}`,
      headers: { cookie: c, "content-type": "audio/wav" },
      payload: wav(12, 7),
    });
    expect(up.json()).toMatchObject({
      ok: true,
      data: { created: true, track: { title: "Lo-fi" } },
    });
    const id = up.json().data.track.id;
    // WAV uzunligi sarlavhadan (mijoz bergan 99 emas).
    expect(up.json().data.track.duration_s).toBe(12);

    const list = await t.app.inject({
      url: "/api/admin/music?status=candidate",
      headers: { cookie: c },
    });
    expect(list.json().data).toMatchObject({ counts: { candidate: 1 }, tracks: [{ id }] });

    const patch = await t.app.inject({
      method: "PATCH",
      url: `/api/admin/music/${id}`,
      headers: { cookie: c },
      payload: { status: "public", title: "Lo-fi Chill" },
    });
    expect(patch.json().data).toMatchObject({ status: "public", title: "Lo-fi Chill" });

    const bad = await t.app.inject({
      method: "POST",
      url: `/api/admin/music?meta=${encodeURIComponent(JSON.stringify({ ...meta, filename: "x.exe" }))}`,
      headers: { cookie: c, "content-type": "application/octet-stream" },
      payload: Buffer.from("MZ"),
    });
    expect(bad.statusCode).toBe(400);
    expect((await t.app.inject({ url: "/api/admin/music" })).statusCode).toBe(401);

    const del = await t.app.inject({
      method: "DELETE",
      url: `/api/admin/music/${id}`,
      headers: { cookie: c },
    });
    expect(del.json()).toMatchObject({ ok: true });
    expect(await t.db.db.select().from(musicTracks)).toEqual([]);
  });
});

describe("kutubxona vazifasi", () => {
  it("trek storage'dan (tashqi xizmatsiz), natija uzunligi trekniki, narx videodagi uzunlik bo'yicha", async () => {
    const { row } = await t.app.music.add({
      bytes: wav(10, 4),
      ext: "wav",
      title: "Short loop",
      category: "ambient",
      durationS: 10,
      source: "seed",
      loopable: true,
    });
    t.app.audio.stop();
    const audio = new AudioService(
      {
        db: t.db.db,
        hub: t.app.hub,
        now: () => t.clock.now,
        storage: t.app.storage,
        eleven: t.app.eleven,
        billing: t.app.billing,
      } as unknown as AppContext,
      t.app.log,
    );
    const task = await audio.submit({
      userId,
      projectId,
      kind: "music",
      label: "Fon musiqa (kutubxona)",
      params: { tier: "basic", library_track: row.id, music_length_ms: 60_000 },
    });
    const done = await audio.wait(task.ok ? task.data.id : "", 5000);
    await audio.idle();
    audio.stop();
    expect(done).toMatchObject({ status: "done", durationMs: 10_000, ext: "wav" });
    const [charge] = await t.db.db
      .select()
      .from(usageLedger)
      .where(eq(usageLedger.audioTaskId, done!.id));
    // 60 s video × 0.15 $/daq × 2.4 × 0.1 = 0.036 $.
    expect(charge).toMatchObject({ item: "music.basic", quantity: 60, amountMicros: -36_000 });
    // Kutubxona treki qayta "nomzod" bo'lmaydi.
    expect(await t.app.music.collectGenerated(done!)).toBeNull();
  });
});
