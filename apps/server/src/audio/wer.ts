/**
 * Word Error Rate (P4.14, o'zbek tili sifat testi): STT natijasi namuna matn bilan solishtiriladi.
 * O'zbek lotin yozuvi uchun normalizatsiya: kichik harf, tinish belgilarisiz, apostroflar (ʻ ʼ ' ` ‘ ’) bitta ko'rinishga.
 */

export function normalizeUz(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[ʻʼ`‘’´]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/(^|\s)'+|'+(\s|$)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Levenshtein so'zlar bo'yicha: (almashtirish + o'chirish + qo'shish) / namuna so'zlari soni. */
export function wordErrorRate(
  reference: string,
  hypothesis: string,
): {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  words: number;
} {
  const ref = normalizeUz(reference);
  const hyp = normalizeUz(hypothesis);
  const rows = ref.length + 1;
  const cols = hyp.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  }
  // Orqaga yurib turlarini sanaymiz.
  let i = ref.length;
  let j = hyp.length;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      if (ref[i - 1] !== hyp[j - 1]) substitutions++;
      i--;
      j--;
    } else if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) {
      deletions++;
      i--;
    } else {
      insertions++;
      j--;
    }
  }
  const words = ref.length;
  return {
    wer:
      words === 0
        ? 0
        : Math.round(((substitutions + deletions + insertions) / words) * 1000) / 1000,
    substitutions,
    deletions,
    insertions,
    words,
  };
}
