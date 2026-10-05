import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, openSync, closeSync, ftruncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { probe, resolveBinaries } from "../src/agent/ffmpeg";
import { fastHash, keyFromName, kindOf, scanSource } from "../src/agent/ingest";
import type { ScannedAsset } from "../src/agent/ingest";
import { FFMPEG_AVAILABLE, bins, makeSourceFolder } from "./media";

describe("kalit va tur", () => {
  it("fayl nomidan slug kalit", () => {
    expect(keyFromName("source/Clip 01 (final).MP4")).toBe("clip_01_final");
    expect(keyFromName("Ko'cha — ko'rinish.jpg")).toBe("ko_cha_ko_rinish");
    expect(keyFromName("___.png")).toBe("asset");
    expect(keyFromName("_intro.mov")).toBe("intro");
  });

  it("kengaytma bo'yicha tur", () => {
    expect(kindOf("a.MOV")).toBe("video");
    expect(kindOf("a.jpeg")).toBe("image");
    expect(kindOf("a.flac")).toBe("audio");
    expect(kindOf("a.txt")).toBe("other");
  });

  it("katta fayl uchun tez hash (hajm + boshi + oxiri)", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "aes-hash-")), "big.bin");
    const fd = openSync(file, "w");
    ftruncateSync(fd, 9 * 1024 * 1024);
    closeSync(fd);
    expect(await fastHash(file, 9 * 1024 * 1024)).toMatch(/^f:[0-9a-f]{64}$/);
  });
});

describe.skipIf(!FFMPEG_AVAILABLE)("INGEST (haqiqiy ffmpeg)", () => {
  let root: string;
  let assets: ScannedAsset[];
  const uploads: string[] = [];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "aes-ingest-"));
    makeSourceFolder(root);
    assets = await scanSource({
      root,
      bins,
      uploadThumb: async (file, hash) => {
        uploads.push(file);
        return `u/x/p/y/thumbs/${hash.replace(/[^a-z0-9]/gi, "")}.jpg`;
      },
    });
  }, 120_000);

  const byKey = (key: string) => {
    const found = assets.find((a) => a.key === key);
    if (found === undefined) throw new Error("asset yo'q: " + key);
    return found;
  };

  it("barcha fayllar (yashirinlardan tashqari), barqaror kalitlar", () => {
    expect(assets.map((a) => a.key).sort()).toEqual(
      ["broken", "clip_01", "clip_01_2", "notes", "photo", "vo"].sort(),
    );
    expect(byKey("clip_01_2").local_path).toBe("source/b-roll/clip_01.mov");
  });

  it("video metadata va thumbnail (≤1280px)", async () => {
    const clip = byKey("clip_01");
    expect(clip).toMatchObject({ kind: "video", local_path: "source/Clip 01.mp4" });
    expect(clip.meta).toMatchObject({ width: 1920, height: 1080, fps: 30, has_audio: true });
    expect(clip.meta.duration as number).toBeCloseTo(2, 0);
    expect(clip.thumb_key).toMatch(/^u\/x\/p\/y\/thumbs\/.+\.jpg$/);
    const thumb = uploads.find((f) => f.includes(clip.hash.replace(/[^a-z0-9]/gi, "")))!;
    expect(existsSync(thumb)).toBe(true);
    const meta = await probe(bins, thumb);
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(720);
  });

  it("rasm (thumbnail bilan), audio (thumbnail'siz)", () => {
    expect(byKey("photo")).toMatchObject({ kind: "image", meta: { width: 1000, height: 1500 } });
    expect(byKey("photo").thumb_key).toBeDefined();
    expect(byKey("vo")).toMatchObject({
      kind: "audio",
      meta: { has_video: false, has_audio: true },
    });
    expect(byKey("vo").thumb_key).toBeUndefined();
  });

  it("buzuq fayl ASSET_CORRUPT, qo'llanmaydigan ASSET_UNSUPPORTED — skanerlash to'xtamaydi", () => {
    expect(byKey("broken").error?.code).toBe("ASSET_CORRUPT");
    expect(byKey("notes").error?.code).toBe("ASSET_UNSUPPORTED");
  });

  it("ffmpeg topilmasa butun skanerlash ENV_FFMPEG_MISSING bilan to'xtaydi", async () => {
    await expect(
      scanSource({ root, bins: resolveBinaries(join(root, "yoq-papka")) }),
    ).rejects.toMatchObject({ error: { code: "ENV_FFMPEG_MISSING" } });
    expect(spawnSync(bins.ffprobe, ["-version"]).status).toBe(0);
  });
});
