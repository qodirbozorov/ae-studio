import { describe, expect, it } from "vitest";
import { normalizeRelPath, resolveInsideRoot } from "../src/paths";

describe("resolveInsideRoot", () => {
  it("nisbiy yo'lni ish papkasiga qo'shadi (Windows va POSIX)", () => {
    expect(resolveInsideRoot("D:\\Projects\\reel\\", "source\\clip.mp4")).toEqual({
      ok: true,
      data: "D:/Projects/reel/source/clip.mp4",
    });
    expect(resolveInsideRoot("/Users/a/reel", "./audio//vo.mp3")).toEqual({
      ok: true,
      data: "/Users/a/reel/audio/vo.mp3",
    });
  });

  it.each([
    ["../secret.mp4"],
    ["source/../../x"],
    ["C:/Windows/system32"],
    ["c:relative"],
    ["/etc/passwd"],
    ["\\\\server\\share"],
    ["~/x"],
    [""],
    ["./"],
    ["a/\u0000b"],
  ])("rad etadi: %j", (rel) => {
    const result = resolveInsideRoot("D:/reel", rel);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ASSET_OUTSIDE_ROOT");
  });

  it("ish papkasi bo'sh bo'lsa ENV_NO_FOLDER", () => {
    const result = resolveInsideRoot("  ", "a.mp4");
    expect(result.ok ? null : result.error.code).toBe("ENV_NO_FOLDER");
  });

  it("'..' o'z ichida bo'lgan oddiy nomlar ruxsat etiladi", () => {
    expect(normalizeRelPath("clips/my..video.mp4")).toEqual({
      ok: true,
      data: "clips/my..video.mp4",
    });
  });
});
