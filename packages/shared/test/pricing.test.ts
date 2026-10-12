import { describe, expect, it } from "vitest";
import { DEFAULT_RATES, quoteAudio, quoteTimeline, usdToMicros } from "../src/pricing";

describe("narx siyosati (Faza 8)", () => {
  it("pro: tannarx × 1.2 × 2", () => {
    const music = quoteAudio("music", { music_length_ms: 60_000 }, null);
    expect(music).toMatchObject({ item: "music.pro", unit: "seconds", quantity: 60 });
    expect(music.costUsd).toBeCloseTo(0.15);
    expect(music.priceUsd).toBeCloseTo(0.36);
    const isolate = quoteAudio("isolate", {}, 120);
    expect(isolate.priceUsd).toBeCloseTo(0.12 * 2 * 2.4);
    const stt = quoteAudio("stt", {}, 3600);
    expect(stt.priceUsd).toBeCloseTo(0.22 * 2.4);
  });

  it("TTS va dialog — tannarxda; Flash arzonroq", () => {
    const text = "a".repeat(1000);
    expect(quoteAudio("tts", { text, model_id: "eleven_v3" }, null).priceUsd).toBeCloseTo(0.1);
    expect(quoteAudio("tts", { text, model_id: "eleven_flash_v2_5" }, null).priceUsd).toBeCloseTo(
      0.05,
    );
    const dialogue = quoteAudio("dialogue", { inputs: [{ text }, { text }] }, null);
    expect(dialogue).toMatchObject({ item: "dialogue", quantity: 2000 });
    expect(dialogue.priceUsd).toBeCloseTo(0.2);
  });

  it("oddiy variant — pro'dan 10× arzon, tannarx 0; faqat isolate/music da", () => {
    const basic = quoteAudio("isolate", {}, 60, { tier: "basic" });
    expect(basic).toMatchObject({ item: "isolate.basic", costUsd: 0 });
    expect(basic.priceUsd).toBeCloseTo(0.0288);
    expect(quoteAudio("tts", { text: "abc" }, null, { tier: "basic" }).item).toBe("tts");
  });

  it("kesh — yarim narx, tannarx 0", () => {
    const fresh = quoteAudio("music", {}, 30);
    const cached = quoteAudio("music", {}, 30, { cached: true });
    expect(cached.costUsd).toBe(0);
    expect(cached.priceUsd).toBeCloseTo(fresh.priceUsd / 2);
  });

  it("haqiqiy uzunlik so'ralganidan ustun", () => {
    expect(quoteAudio("sfx", { duration_seconds: 2 }, 3).quantity).toBe(3);
    expect(quoteAudio("sfx", { duration_seconds: 2 }, null).quantity).toBe(2);
  });

  it("timeline: daqiqasiga 0.01 $ × formatlar", () => {
    expect(quoteTimeline(90).priceUsd).toBeCloseTo(0.015);
    expect(quoteTimeline(90, 2)).toMatchObject({ item: "timeline", unit: "minutes", quantity: 3 });
    expect(DEFAULT_RATES.activationUsd).toBe(20);
    expect(usdToMicros(0.015)).toBe(15_000);
  });
});
