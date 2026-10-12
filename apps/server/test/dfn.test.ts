/** P8.05: server isolation (DeepFilterNet3). */
import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { findDeepFilter, runDeepFilter, wavDuration } from "../src/audio/dfn";
import { AudioService } from "../src/audio/service";
import type { AppContext } from "../src/context";
import { devices, projects, usageLedger, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";

/** 48 kHz mono 16-bit WAV: sinus + shovqin. */
function noisyWav(seconds: number): Buffer {
  const rate = 48_000;
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const value = 0.3 * Math.sin((2 * Math.PI * 220 * i) / rate) + 0.2 * (Math.random() * 2 - 1);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32_000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
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

/** Soxta deep-filter: kirishni `-o` papkasiga nusxalaydi (CI'da binar shart emas). */
function fakeCommand(): string[] {
  const dir = mkdtempSync(join(tmpdir(), "aes-fake-dfn-"));
  const script = join(dir, "fake.cjs");
  writeFileSync(
    script,
    `const fs=require("fs"),p=require("path");const a=process.argv.slice(2);const o=a[a.indexOf("-o")+1];const src=a[a.length-1];fs.mkdirSync(o,{recursive:true});fs.copyFileSync(src,p.join(o,p.basename(src)));`,
  );
  return [process.execPath, script];
}

describe("deep-filter", () => {
  it("WAV davomiyligi sarlavhadan", () => {
    expect(wavDuration(noisyWav(1.5))).toBeCloseTo(1.5, 3);
    expect(wavDuration(Buffer.from("not a wav"))).toBeNull();
  });

  const bin = findDeepFilter();
  it.skipIf(bin === null)(
    "haqiqiy binar: shovqinli WAV → toza WAV (uzunligi saqlanadi)",
    async () => {
      const input = noisyWav(2);
      const out = await runDeepFilter(input, { command: [bin!] });
      expect(out.toString("ascii", 0, 4)).toBe("RIFF");
      expect(wavDuration(out)).toBeCloseTo(2, 1);
    },
  );
});

describe("AudioService: oddiy isolation", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.close();
  });

  it("tier basic → deep-filter (tashqi xizmat kalitisiz), WAV natija, sarf isolate.basic", async () => {
    t = await createTestApp();
    await login(t, "dfn@x.uz");
    const [user] = await t.db.db.select().from(users).where(eq(users.email, "dfn@x.uz"));
    const [device] = await t.db.db
      .insert(devices)
      .values({ userId: user!.id, name: "PC", os: "win" })
      .returning();
    const [project] = await t.db.db
      .insert(projects)
      .values({ userId: user!.id, deviceId: device!.id, name: "reel", rootPath: "D:/r" })
      .returning();
    const input = noisyWav(3);
    const key = `u/${user!.id}/p/${project!.id}/audio-in/in1.wav`;
    await t.app.storage.putBytes(key, input);
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
      { deepFilter: { command: fakeCommand() } },
    );
    const task = await audio.submit({
      userId: user!.id,
      projectId: project!.id,
      kind: "isolate",
      label: "Toza ovoz",
      params: { tier: "basic" },
      inputs: [{ name: "audio", storage_key: key, sha256: "x", duration_s: 3 }],
    });
    expect(task.ok).toBe(true);
    const done = await audio.wait(task.ok ? task.data.id : "", 10_000);
    await audio.idle();
    audio.stop();
    expect(done).toMatchObject({ status: "done", ext: "wav", durationMs: 3000 });
    expect(done!.result).toMatchObject({ engine: "dfn3" });
    const [charge] = await t.db.db
      .select()
      .from(usageLedger)
      .where(eq(usageLedger.audioTaskId, done!.id));
    // 3 s × 0.12 $/daq × 2.4 × 0.1 = 0.00144 $; tannarx 0.
    expect(charge).toMatchObject({ item: "isolate.basic", costMicros: 0, amountMicros: -1440 });
  });
});
