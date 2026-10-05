# O'zbek tili sifati (ElevenLabs) — P4.14

## Qaysi modellar o'zbekchani qo'llaydi (Q7)

Manba: ElevenLabs rasmiy hujjatlari (2026-10-05):
- [Models](https://elevenlabs.io/docs/overview/models)
- [Speech to Text](https://elevenlabs.io/docs/overview/capabilities/speech-to-text)
- [Text to Speech](https://elevenlabs.io/docs/overview/capabilities/text-to-speech)

| Imkoniyat | Model | O'zbekcha |
|---|---|---|
| TTS | `eleven_v4`, `eleven_v4_turbo` | ✅ (90+ til, `uzb`) |
| TTS | `eleven_v3`, `eleven_multilingual_v2`, `eleven_flash_v2_5` | ❌ ro'yxatda yo'q |
| STT (Scribe) | `scribe_v2` | ✅ "Good" daraja (WER 10–20%) |
| Dialogue | default `eleven_v3` | ❌ — o'zbekcha dialog uchun `model_id: eleven_v4` bering |
| Voice Design | `eleven_multilingual_ttv_v2` | tavsif ingliz tilida, ovoz har tilda gapira oladi |

**AE Studio'dagi default'lar:**
- TTS: `eleven_v4` (spec `voiceover.model_id` berilmasa) va `language: "uz"`;
- STT: `scribe_v2`.

## Sinov usuli

Haqiqiy kalit bilan quyidagi skript ishga tushiriladi. Kalit — kabinetdagi bilan bir xil; ovoz `el_voices` dan olinadi.

```sh
ELEVENLABS_API_KEY=sk_… VOICE_ID=… pnpm --filter @aes/server exec tsx scripts/uz-quality.mts
```

Skript quyidagilarni bajaradi:

1. **Namuna matnlar.** Ichida o'zbek apostrofli harflar (`oʻ`, `gʻ`), sonlar, brend nomlari va undov/so'roq gaplar bor. Ulardan TTS yaratiladi: `eleven_v4` va `eleven_v4_turbo`, `uz`, brend talaffuz lug'ati bilan.
2. **Qayta tanish.** Yaratilgan audio yana STT (`scribe_v2`, `uz`) bilan o'qiladi.
3. **WER.** O'zbek lotin uchun normalizatsiya qilinadi: kichik harf, tinish belgilarisiz, `ʻ ʼ ' ‘ ’ \`` bitta apostrofga. So'ng `apps/server/src/audio/wer.ts` bilan WER hisoblanadi.
4. **Alignment `loss`.** Forced alignment xatosi talaffuz va matn mosligini ko'rsatadi.

Natija jadvali konsolga chiqadi. Uni quyidagi bo'limga ko'chiring.

## Natijalar

> 👤 Bu kompyuterda ElevenLabs kaliti yo'q, shuning uchun jadval kalit kiritilgach to'ldiriladi.
> WER hisoblash va normalizatsiya avtomatik testlarda (`apps/server/test/uz-quality.test.ts`) sinalgan.

| # | Model | WER | Alignment loss | Izoh |
|---|---|---|---|---|
| — | — | — | — | kalit kiritilgach to'ldiriladi |

## Talaffuz lug'ati (brend so'zlar)

`el_pronunciation` tooli bilan yaratiladi. Spec'da `voiceover.pronunciation: ["brand-uz"]` deb ulanadi. Boshlang'ich qoidalar:

| So'z | Qoida |
|---|---|
| `AE Studio` | alias → `Ey-I Studio` |
| `After Effects` | alias → `After Effekts` |
| Inglizcha brendlar | alias: o'zbekcha o'qilishi (masalan `iPhone` → `Ayfon`) |

## Tavsiyalar

- **O'zbekcha voiceover:** `eleven_v4` + o'zbekcha ovoz (`el_voices`, `labels.language`) + `language: "uz"`.
- **Raqamlar va qisqartmalar:** so'z bilan yozing ("3 ta" → "uchta"). Shunda TTS va subtitr bir xil bo'ladi.
- **Transkript:** `transcript_edit` bilan imlo tuzatiladi; subtitr tahrirlangan matndan quriladi, vaqtlar saqlanadi.
- **Apostroflar:** spec matnida `ʻ` yoki `'` ishlatish mumkin. WER solishtirish ularni bir xil hisoblaydi.
