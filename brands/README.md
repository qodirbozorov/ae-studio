# Brand kit

Brand kit (sxema: `packages/shared/src/brand.ts`) foydalanuvchi bo'yicha `brands` jadvalida saqlanadi.
Uni saqlashning ikki yo'li bor: MCP `brand_save` yoki web kabinet. Shu papkadagi `example/brand.json` faqat
namuna.

Spec `brand` maydoni slug oladi, default qiymati `"default"`. Shu nomli brand saqlanmagan bo'lsa, video
brand'siz quriladi. Boshqa slug topilmasa, `SPEC_INVALID` qaytadi.

## Nima qo'llanadi

| Maydon | Qayerda |
|---|---|
| `colors.text` | Matnning default rangi (`style.color` berilmagan bo'lsa) |
| `colors.background` | Sahna foni (`scene.bg` va shablon `bg` berilmagan bo'lsa) |
| `colors.*`, `fonts.*`, `logo`, `name` | Shablon tokenlari: `{{brand.primary}}`, `{{brand.heading_font}}`, `{{brand.logo}}` … |
| `fonts.body` | Matnning default shrifti |
| `fonts.*.fallback` | AE'da shrift yo'q bo'lsa navbat bilan sinaladi; hech biri yo'q → `AE_FONT_MISSING` (PREFLIGHT) |
| `captions.style` | Subtitr stili (`audio.captions.style` berilmagan bo'lsa) |
| `voice` | Voiceover ovozi (`voiceover.voice_id` berilmagan bo'lsa) |
| `music_style` | Musiqa tavsifi (`music.prompt` berilmagan bo'lsa) |

Shriftlar PostScript nomi bilan beriladi (`Montserrat-Bold`). AE 24+ da PREFLIGHT ro'yxatni AE'dan oladi
(`info` op, `app.fonts`). Eski AE'da tekshiruv o'tkazib yuboriladi.

Logo asset loyihada bo'lmasa, video logo'siz quriladi va ogohlantirish beriladi.
