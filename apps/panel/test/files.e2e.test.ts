/** Fayl uzatish (§6): pre-signed URL → panel agent, sha256 tekshiruvi, WS `file.download` → `file.saved`. */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestApp } from "../../server/test/helpers/app";
import type { LocalStorage } from "../../server/src/storage";
import { downloadVerified, sha256File, uploadFile } from "../src/agent/files";
import type { Agent } from "../src/agent/index";
import { pairedAgent, start } from "./e2e-helpers";

let t: TestApp | undefined;
let agent: Agent | undefined;

afterEach(async () => {
  agent?.disconnect();
  await t?.close();
  t = agent = undefined;
});

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const KEY = "u/user1/p/proj1/audio-out/vo.mp3";

describe("upload / download (pre-signed)", () => {
  it("panel faylni yuklaydi; server bir xil baytlarni oladi", async () => {
    const s = await start();
    t = s.app;
    const dir = mkdtempSync(join(tmpdir(), "aes-up-"));
    const file = join(dir, "thumb.jpg");
    writeFileSync(file, Buffer.alloc(300_000, 7));

    const url = await s.app.app.storage.presignPut(KEY);
    const info = await uploadFile(url, file, "image/jpeg");
    expect(info).toEqual(await sha256File(file));
    expect((await s.app.app.storage.getBytes(KEY))?.equals(readFileSync(file))).toBe(true);
  });

  it("yuklab oladi va sha256 ni tekshiradi; mos kelmasa 3 urinishdan keyin ASSET_CORRUPT", async () => {
    const s = await start();
    t = s.app;
    await s.app.app.storage.putBytes(KEY, Buffer.from("VOICEOVER"));
    const dir = mkdtempSync(join(tmpdir(), "aes-down-"));
    const url = await s.app.app.storage.presignGet(KEY);

    const ok = await downloadVerified(url, join(dir, "audio", "vo.mp3"), sha("VOICEOVER"));
    expect(ok.size).toBe(9);
    expect(readFileSync(join(dir, "audio", "vo.mp3"), "utf8")).toBe("VOICEOVER");

    // Har GET so'rovida server imzoni tekshiradi — urinishlar sonini shu orqali sanaymiz.
    const verify = vi.spyOn(s.app.app.storage as LocalStorage, "verify");
    await expect(downloadVerified(url, join(dir, "bad.mp3"), sha("OTHER"))).rejects.toMatchObject({
      error: { code: "ASSET_CORRUPT", retryable: true },
    });
    expect(verify.mock.calls.filter(([method]) => method === "GET")).toHaveLength(3);
    // Buzilgan fayl (va vaqtinchalik .part) diskda qolmaydi.
    expect(readdirSync(dir).filter((f) => f.startsWith("bad"))).toEqual([]);
  });
});

describe("WS: file.download → file.saved", () => {
  it("server yuborgan faylni ish papkasiga saqlaydi; papkadan tashqari dest rad etiladi", async () => {
    const s = await start();
    t = s.app;
    const root = mkdtempSync(join(tmpdir(), "aes-root-"));
    const p = await pairedAgent(s.app, s.base, undefined, root);
    agent = p.agent;
    await s.app.app.storage.putBytes(KEY, Buffer.from("VOICEOVER"));
    const url = await s.app.app.storage.presignGet(KEY);

    const replies: Record<string, unknown> = {};
    s.app.app.hub.onMessage((_identity, message) => {
      if (message.type === "file.saved" || message.type === "request.failed") {
        replies[message.request_id] = message;
      }
    });
    const send = (request_id: string, dest: string, sha256: string) =>
      s.app.app.hub.send(p.credentials.device_id, {
        type: "file.download",
        request_id,
        url,
        sha256,
        dest,
      });

    send("r1", "audio/vo.mp3", sha("VOICEOVER"));
    send("r2", "../escape.mp3", sha("VOICEOVER"));
    send("r3", "audio/bad.mp3", sha("NOPE"));
    const deadline = Date.now() + 10_000;
    while (Object.keys(replies).length < 3 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(replies.r1).toMatchObject({ type: "file.saved", dest: "audio/vo.mp3", size: 9 });
    expect(readFileSync(join(root, "audio", "vo.mp3"), "utf8")).toBe("VOICEOVER");
    expect(replies.r2).toMatchObject({
      type: "request.failed",
      error: { code: "ASSET_OUTSIDE_ROOT" },
    });
    expect(replies.r3).toMatchObject({ type: "request.failed", error: { code: "ASSET_CORRUPT" } });
  });
});

describe("file.download: versiyalar ustiga yozilmaydi (P2.13)", () => {
  it("bir xil tarkib — saqlangan; boshqa tarkib — rad (overwrite: true bo'lmasa)", async () => {
    const s = await start();
    t = s.app;
    const root = mkdtempSync(join(tmpdir(), "aes-root-"));
    const p = await pairedAgent(s.app, s.base, undefined, root);
    agent = p.agent;
    const put = async (key: string, body: string) => {
      await s.app.app.storage.putBytes(key, Buffer.from(body));
      return s.app.app.storage.presignGet(key);
    };
    const v1 = await put(`${KEY}.v1`, "PLAN-1");
    const v2 = await put(`${KEY}.v2`, "PLAN-2");
    const device = p.credentials.device_id;
    const download = (request_id: string, url: string, body: string, overwrite?: boolean) =>
      s.app.app.hub.request(
        device,
        {
          type: "file.download",
          request_id,
          url,
          sha256: sha(body),
          dest: ".aestudio/plan.v001.json",
          ...(overwrite === undefined ? {} : { overwrite }),
        },
        10_000,
      );

    expect(await download("a", v1, "PLAN-1")).toMatchObject({
      ok: true,
      data: { type: "file.saved" },
    });
    expect(await download("b", v1, "PLAN-1")).toMatchObject({ ok: true, data: { size: 6 } });
    const refused = await download("c", v2, "PLAN-2");
    expect(refused).toMatchObject({ ok: false, error: { code: "SYS_BAD_REQUEST" } });
    expect(readFileSync(join(root, ".aestudio", "plan.v001.json"), "utf8")).toBe("PLAN-1");
    expect((await download("d", v2, "PLAN-2", true)).ok).toBe(true);
    expect(readFileSync(join(root, ".aestudio", "plan.v001.json"), "utf8")).toBe("PLAN-2");
  });
});
