# Shablon kutubxonasi

Har shablon — `templates/<slug>/template.json` (manifest, sxema: `packages/shared/src/template.ts`).
Server ularni bundle'ga kiritadi (`apps/server/src/templates/library.ts`). Foydalanuvchi shablonlari
(`template_save`) `templates` jadvalida saqlanadi va bir xil slug'li tizim shablonining o'rnini bosadi.

| Slug | Nima uchun | Majburiy slotlar | Ixtiyoriy slotlar |
|---|---|---|---|
| `hook_title` | Birinchi soniyalar: fon ustida katta sarlavha | `title`, `bg` | `kicker`, `accent` |
| `lower_third` | Ism/lavozim plashkasi (intervyu) | `name` | `role`, `bg`, `accent` |
| `cta_outro` | Yakun: logo, chaqiriq, tugma | `headline` | `button`, `subline`, `logo`, `accent` |
| `product_showcase` | Mahsulot, nom, narx, belgi | `product`, `name`, `price` | `badge`, `accent` |
| `testimonial` | Mijoz fikri | `quote`, `author` | `role`, `photo`, `accent` |
| `top3_list` | Sarlavha + 3 band | `title`, `item1..3` | `bg`, `accent` |

Hammasi `recipe` turida va 9:16, 1:1, 16:9 formatlarida sinalgan
(`apps/panel/test/template-library.test.ts`: kompilyatsiya + ES3 bundle mock AE'da, brand bilan va brand'siz).

Subtitr stillari (`audio.captions.style`): `karaoke_bold`, `bold_pop`, `minimal` — `captions.build` opida.
O'tishlar (`scene.transition_out`): `fade`, `whip_*`, `zoom_*`, `slide_*` — compiler oplari.

## Recipe yozish

- `layers` — oddiy Spec layerlari. Pozitsiyalar kadrga nisbiy (`{x, y}` 0–1), o'lchamlar asosiy format
  pikselida.
- `"{{slot}}"` — slot qiymati. Butun qiymat bo'lsa, turi saqlanadi (`"src": "{{bg}}"`). Matn ichida bo'lsa,
  o'rniga qo'yiladi (`"Narx: {{price}}"`).
- `{{brand.primary|secondary|accent|text|background|heading_font|body_font|logo|name}}` — brand kit
  tokenlari:
  - brand bo'lmasa ranglar default qiymatda qoladi;
  - shrift va logo tokeni olib tashlanadi, layer o'z default'ida qoladi.
- `"if": "<slot>"` — slot bo'sh bo'lsa layer chiqmaydi (ixtiyoriy logo, belgi, fon).
- Slot `default` brand tokeni bo'lishi mumkin: `"default": "{{brand.accent}}"`.
- Media `scale` — `fit` o'lchamiga ko'paytiruvchi (logo uchun 0.25–0.3).
- Matn `max_width` dan oshsa, compiler paragraf qutisi yaratadi.

## Aep shablon

Dizayner After Effects'da comp yasaydi. Slot layerlari nomlanadi (`TITLE`, `BG_PLACEHOLDER`), ranglar
Essential Graphics'ga yoki "Color Control" effektiga beriladi. Keyin ikki yo'l bor:

- Claude: `template_save` (`source: "aep"`) — qurilgan job'ning `.aep` faylidan;
- qo'lda: manifest + `.aep` storage'ga yuklanadi.

Build'da fayl panelga `templates/<slug>_v<n>.aep` ga yuklanadi va `template.instantiate` bilan qo'yiladi.

## Preview (`preview.gif`) — 👤 AE kerak

1. `/from-template` bilan shablonni namuna slotlar bilan render qiling.
2. GIF yasang: `ffmpeg -i out/<nom>.mp4 -vf "fps=12,scale=360:-1:flags=lanczos" preview.gif`.
3. Faylni manifestning `files.preview` maydoniga storage orqali qo'shing.

Preview bo'lmasa, panel galereyasi manifestdan sxematik ko'rinish chizadi.
