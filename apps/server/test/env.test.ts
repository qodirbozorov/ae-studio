import { describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "../src/env";

const base = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/aes",
  REDIS_URL: "redis://localhost:6379",
};

function problems(source: Record<string, string>): string[] {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  throw new Error("EnvError kutilgan edi");
}

describe("loadEnv", () => {
  it("minimal env + default qiymatlar", () => {
    const env = loadEnv(base);
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.PUBLIC_URL).toBe("http://localhost:3000");
  });

  it("PORT satrdan songa aylantiriladi (Railway PORT beradi)", () => {
    expect(loadEnv({ ...base, PORT: "8080" }).PORT).toBe(8080);
  });

  it("production'da PUBLIC_URL majburiy", () => {
    expect(problems({ ...base, NODE_ENV: "production" })).toEqual([
      expect.stringContaining("PUBLIC_URL"),
    ]);
    const env = loadEnv({
      ...base,
      NODE_ENV: "production",
      PUBLIC_URL: "https://aes.up.railway.app",
    });
    expect(env.PUBLIC_URL).toBe("https://aes.up.railway.app");
  });

  it("xato xabarida o'zgaruvchi nomi bor, qiymati (maxfiy) yo'q", () => {
    const found = problems({
      DATABASE_URL: "mysql://root:SUPER_SECRET@db/aes",
      REDIS_URL: "http://token-XYZ@cache",
    });
    expect(found.join("\n")).toContain("DATABASE_URL");
    expect(found.join("\n")).toContain("REDIS_URL");
    expect(found.join("\n")).not.toContain("SUPER_SECRET");
    expect(found.join("\n")).not.toContain("token-XYZ");
  });

  it("MASTER_KEY aynan 32 bayt base64 bo'lishi kerak", () => {
    expect(problems({ ...base, MASTER_KEY: Buffer.alloc(16).toString("base64") })).toEqual([
      expect.stringContaining("MASTER_KEY"),
    ]);
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(loadEnv({ ...base, MASTER_KEY: key }).MASTER_KEY).toBe(key);
  });

  it("DEV_AGENT_TOKEN qisqa bo'lsa rad etiladi", () => {
    expect(problems({ ...base, DEV_AGENT_TOKEN: "short" })).toEqual([
      expect.stringContaining("DEV_AGENT_TOKEN"),
    ]);
  });
});
