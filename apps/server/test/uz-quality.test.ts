/** P4.14: WER va o'zbek lotin normalizatsiyasi. */
import { describe, expect, it } from "vitest";
import { normalizeUz, wordErrorRate } from "../src/audio/wer";

describe("o'zbek WER", () => {
  it("apostroflar, katta-kichik harf va tinish belgilari farq qilmaydi", () => {
    expect(normalizeUz("Oʻzbekiston, Gʼalaba! O‘quvchi’ “sinov”")).toEqual([
      "o'zbekiston",
      "g'alaba",
      "o'quvchi",
      "sinov",
    ]);
    expect(
      wordErrorRate("Oʻzbekiston poytaxti — Toshkent.", "o'zbekiston poytaxti toshkent").wer,
    ).toBe(0);
  });

  it("almashtirish, o'chirish va qo'shish sanaladi", () => {
    const score = wordErrorRate("bir ikki uch to'rt besh", "bir ikkki uch besh olti");
    expect(score.substitutions + score.deletions + score.insertions).toBe(3);
    expect(score).toMatchObject({ words: 5, wer: 0.6 });
    expect(wordErrorRate("bir ikki uch", "bir uch")).toMatchObject({
      deletions: 1,
      substitutions: 0,
      insertions: 0,
    });
    expect(wordErrorRate("bir uch", "bir ikki uch")).toMatchObject({ insertions: 1, wer: 0.5 });
    expect(wordErrorRate("bir ikki", "bir uch")).toMatchObject({ substitutions: 1, wer: 0.5 });
    expect(wordErrorRate("", "").wer).toBe(0);
  });
});
