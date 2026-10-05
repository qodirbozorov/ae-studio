/**
 * O'zbek tili sifat testi (P4.14, §7.1) — haqiqiy ElevenLabs kaliti bilan qo'lda ishga tushiriladi:
 *   ELEVENLABS_API_KEY=sk_… VOICE_ID=… pnpm --filter @aes/server exec tsx scripts/uz-quality.mts
 * 1) TTS (eleven_v4, uz) namuna matnlardan audio yaratadi → 2) STT (scribe_v2, uz) shu audioni o'qiydi →
 * 3) WER (normalizatsiyalangan) → 4) pronunciation dictionary (brend so'zlar) bilan qayta TTS.
 * Natija jadvali konsolga chiqadi; uni docs/uz-quality.md ga ko'chiring.
 */
import { forcedAlignment, speechToText } from "../src/eleven/analyze";
import { ElevenClient } from "../src/eleven/client";
import { tts } from "../src/eleven/tts";
import { createDictionary, listModels } from "../src/eleven/voice";
import { wordErrorRate } from "../src/audio/wer";

const key = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.VOICE_ID;
if (!key || !voiceId) {
  console.error("ELEVENLABS_API_KEY va VOICE_ID kerak (el_voices dan o'zbekcha ovoz)");
  process.exit(2);
}

export const SAMPLES = [
  "Assalomu alaykum! Bugun sizga uchta muhim maslahat beraman.",
  "Oʻzbekiston poytaxti Toshkent shahri boʻlib, u Markaziy Osiyodagi eng katta shaharlardan biri.",
  "Gʻalaba qozonish uchun har kuni oz-ozdan, lekin toʻxtovsiz harakat qilish kerak.",
  "Mahsulotimizni sinab koʻring: birinchi oy mutlaqo bepul, obuna boʻling va doʻstlaringizga ulashing.",
  "AE Studio yordamida videolar After Effects dasturida avtomatik yigʻiladi.",
];

const client = new ElevenClient(key, { timeoutMs: 180_000 });

const models = await listModels(client);
const uzModels = models.filter((m) =>
  (m.languages ?? []).some((l) => l.language_id === "uz" || l.language_id === "uzb"),
);
console.log(
  "Oʻzbekchani qoʻllovchi modellar:",
  uzModels.map((m) => m.model_id).join(", ") || "(roʻyxatda yoʻq)",
);

const dict = await createDictionary(client, {
  name: "aes-uz-brand",
  rules: [
    { type: "alias", string_to_replace: "AE Studio", alias: "Ey-I Studio" },
    { type: "alias", string_to_replace: "After Effects", alias: "After Effekts" },
  ],
});

console.log("\n| # | Model | WER | Alignment loss | Matn (STT) |");
console.log("|---|---|---|---|---|");
for (const [index, text] of SAMPLES.entries()) {
  for (const model of ["eleven_v4", "eleven_v4_turbo"]) {
    const audio = await tts(client, {
      voice_id: voiceId,
      text,
      model_id: model,
      language_code: "uz",
      pronunciation_dictionary_locators: [
        { pronunciation_dictionary_id: dict.id, version_id: dict.version_id },
      ],
    });
    const file = {
      data: audio.audio,
      filename: `s${index}.${audio.ext}`,
      contentType: audio.contentType,
    };
    const transcript = await speechToText(client, {
      file,
      language_code: "uz",
      model_id: "scribe_v2",
    });
    const aligned = await forcedAlignment(client, { file, text });
    const score = wordErrorRate(text, transcript.text);
    console.log(
      `| ${index + 1} | ${model} | ${(score.wer * 100).toFixed(1)}% | ${aligned.loss.toFixed(3)} | ${transcript.text} |`,
    );
  }
}
