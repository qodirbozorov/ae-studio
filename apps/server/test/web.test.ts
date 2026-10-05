import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findWebDist } from "../src/web";
import { createTestApp } from "./helpers/app";
import type { TestApp } from "./helpers/app";

const webDir = mkdtempSync(join(tmpdir(), "aes-web-"));
writeFileSync(join(webDir, "index.html"), "<!doctype html><title>AE Studio kabinet</title>");
writeFileSync(join(webDir, "app.js"), "console.log(1)");

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ WEB_DIST: webDir });
});

afterAll(async () => {
  await t.close();
});

describe("web kabinet static (§4.3)", () => {
  it("/ va SPA sahifalari index.html; fayllar o'zi", async () => {
    for (const url of ["/", "/device?code=ABC123", "/devices"]) {
      const res = await t.app.inject(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain("AE Studio kabinet");
    }
    expect((await t.app.inject("/app.js")).body).toBe("console.log(1)");
  });

  it("API yo'llari SPA'ga tushmaydi: 404 §8 formatida", async () => {
    for (const url of ["/api/nope", "/oauth/nope", "/health/x"]) {
      const res = await t.app.inject(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code, url).toBe("SYS_NOT_FOUND");
    }
  });

  it("findWebDist: noto'g'ri papka → null", () => {
    expect(findWebDist(join(webDir, "none"))).toBeNull();
    expect(findWebDist(webDir)).toBe(webDir);
  });
});
