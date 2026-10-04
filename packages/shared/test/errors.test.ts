import { describe, expect, it } from "vitest";
import { ERROR_DEFS, errorPrefix, isErrorCode, makeError } from "../src/errors";
import type { ErrorCode } from "../src/errors";
import { fail, failWith, ok } from "../src/result";
import type { Result } from "../src/result";

const PREFIXES = ["ENV", "AUTH", "SPEC", "ASSET", "EL", "AE", "RENDER", "LOOP", "SYS"];
const codes = Object.keys(ERROR_DEFS) as ErrorCode[];

describe("ERROR_DEFS", () => {
  it("har kod: KATTA_HARF, ruxsat etilgan prefiks, mazmunli hint", () => {
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z]+_[A-Z0-9_]+$/);
      expect(PREFIXES).toContain(errorPrefix(code));
      expect(ERROR_DEFS[code].hint.length, code).toBeGreaterThan(15);
    }
  });

  it("§12 dagi barcha misol kodlar mavjud va retryable qiymatlari jadvalga mos", () => {
    // ASSET_ uchun §12 "qisman" deydi: faqat qayta yuklab olish yordam beradigan CORRUPT retryable.
    const plan: Record<string, boolean> = {
      ENV_AGENT_OFFLINE: true,
      ENV_AE_CLOSED: true,
      ENV_NO_FOLDER: true,
      ENV_FFMPEG_MISSING: true,
      AUTH_EXPIRED: false,
      AUTH_DEVICE_REVOKED: false,
      SPEC_INVALID: false,
      SPEC_UNKNOWN_ASSET: false,
      SPEC_UNKNOWN_TEMPLATE: false,
      ASSET_MISSING: false,
      ASSET_CORRUPT: true,
      ASSET_UNSUPPORTED: false,
      EL_AUTH: false,
      EL_QUOTA: false,
      EL_RATE_LIMIT: true,
      EL_TIMEOUT: true,
      EL_BAD_PARAMS: false,
      AE_SCRIPT_ERROR: false,
      AE_TIMEOUT: true,
      AE_FONT_MISSING: false,
      AE_VERSION: false,
      RENDER_FAILED: true,
      RENDER_DURATION_MISMATCH: true,
      LOOP_PATCH_LIMIT: false,
    };
    for (const [code, retryable] of Object.entries(plan)) {
      expect(isErrorCode(code), code).toBe(true);
      expect(ERROR_DEFS[code as ErrorCode].retryable, code).toBe(retryable);
    }
  });
});

describe("makeError", () => {
  it("kod bo'yicha retryable va hint qo'yiladi; ixtiyoriy maydonlar faqat berilganda", () => {
    expect(makeError("EL_QUOTA")).toEqual({
      code: "EL_QUOTA",
      retryable: false,
      hint: ERROR_DEFS.EL_QUOTA.hint,
    });
    const withExtra = makeError("SPEC_INVALID", "2 ta xato", [{ path: ["scenes", 0, "id"] }]);
    expect(withExtra.message).toBe("2 ta xato");
    expect(withExtra.details).toEqual([{ path: ["scenes", 0, "id"] }]);
    expect("message" in makeError("AE_TIMEOUT")).toBe(false);
  });

  it("noma'lum kod: tip darajasida xato, runtime'da SYS_INTERNAL", () => {
    // @ts-expect-error noma'lum kod tip darajasida rad etiladi
    const error = makeError("NOPE_CODE");
    expect(error.code).toBe("SYS_INTERNAL");
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("NOPE_CODE");
  });
});

describe("isErrorCode", () => {
  it("faqat ma'lum kodlar uchun true", () => {
    expect(isErrorCode("AE_TIMEOUT")).toBe(true);
    expect(isErrorCode("ae_timeout")).toBe(false);
    expect(isErrorCode("toString")).toBe(false);
    expect(isErrorCode(42)).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
  });
});

describe("Result", () => {
  it("ok / fail / failWith shakllari §8 formatiga mos", () => {
    expect(ok({ n: 1 })).toEqual({ ok: true, data: { n: 1 } });
    const failed = fail("ASSET_MISSING", "source/a.mp4");
    expect(failed.ok).toBe(false);
    expect(failed.error.code).toBe("ASSET_MISSING");
    expect(failed.error.message).toBe("source/a.mp4");
    expect(failWith(makeError("AE_VERSION"))).toEqual({
      ok: false,
      error: makeError("AE_VERSION"),
    });
  });

  it("Result tipi ok bo'yicha toraytiriladi", () => {
    const results: Result<number>[] = [ok(2), fail("SYS_NOT_FOUND")];
    const sum = results.reduce((acc, r) => (r.ok ? acc + r.data : acc), 0);
    expect(sum).toBe(2);
  });
});
