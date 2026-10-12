# AE Studio — foydalanuvchi qo'llanmasi

AE Studio After Effects'da video yig'adi. Siz Claude'ga oddiy tilda yozasiz, Claude reja tuzadi va
panel uni AE'da quradi. Ovoz, musiqa va subtitrni server tayyorlaydi. Natija — AE loyihasi (`.aep`),
so'rasangiz `out/` papkasida MP4.

## 1. O'rnatish (bir marta, ~10 daqiqa)

1. **Panel:** [panel-install.md](panel-install.md) — o'rnatish skripti va birinchi ishga tushirish ustasi
   (ulanish → ish papkasi → muhit tekshiruvi).
2. **Claude:** [claude-connector.md](claude-connector.md) — Claude'da custom connector qo'shing (server
   manzili `/mcp`). Birinchi marta brauzerda kabinetga kirib ruxsat berasiz.
3. **Web kabinet** (server manzili): «Telegram orqali kirish» → botda **Start** → bot so'rov tafsilotini
   (brauzer, IP, vaqt) ko'rsatadi → **saytdagi raqamni** botda tanlang. Raqam mos kelmasa yoki kirishni siz
   boshlamagan bo'lsangiz («Bu men emas») — kirish bekor bo'ladi. Ro'yxatdan o'tish ham shu, email va parol
   kerak emas. Shu chat xabarnomalar uchun avtomatik ulanadi. Keyin Sozlamalar:
   - **Balans va Pro** — balans dollarda. Boshlash uchun bir martalik 20 $ to'lov, keyin ishlatilgan sari
     yechiladi. To'lov hozircha administrator orqali: tariflar va murojaat shu bo'limda; to'lov tushgach
     botga xabar keladi (balans 1 $ dan kamaysa ham). Bu yerda (yoki panel → Sozlama) **Pro musiqa** va
     **Pro ovoz tozalash** tugmalari: yoqilsa Claude har safar so'ramaydi, o'chiq bo'lsa narxni aytib
     ruxsat so'raydi.
   - **Kirishlar** — kabinet ochiq brauzerlar (brauzer, IP). Tanimaganini yoping yoki «Boshqa barchasidan
     chiqish».
   - **Telegram** — kirishda avtomatik ulanadi (boshqa chatga: «Ulash kodini olish» → botga `/start <kod>`). Video tayyor bo'lganda yoki
     to'xtaganda xabar keladi.
   - **Brand kit** (ixtiyoriy) — ranglar, shriftlar, logo, subtitr stili, default ovoz. `default` slug'li
     brand barcha videolarga qo'llanadi.

## 2. Birinchi video (Claude bilan)

1. Fayllaringizni (video, rasm, musiqa) ish papkasidagi `source/` ga qo'ying.
2. Claude'da `/new-reel` buyrug'ini tanlang yoki shunchaki yozing: *«source papkadagi videolardan 20
   soniyalik reel qil: mavzu — yangi menyu, ovoz o'zbekcha, subtitr bilan»*.
3. Claude:
   1. muhitni tekshiradi, fayllarni ko'radi (kadrlarni rasm sifatida), reja tuzadi va sizdan tasdiq so'raydi;
   2. audio narxini dollarda aytadi (Pro musiqa yoki Pro tozalash kerak bo'lsa, ruxsat so'raydi);
   3. qurishni boshlaydi — panelning **Live** bo'limida har qadam ko'rinadi;
   4. natijani AE timeline'da ko'rishingizni so'raydi, izohlaringiz bo'yicha tuzatadi (3 martagacha).
4. Yoqqan bo'lsa Claude'ga ayting yoki panel/kabinetda **Tasdiqlash** tugmasini bosing — Claude buni
   darhol ko'radi. Tasdiqlangandan keyin ham tuzatish so'rash mumkin. Render faqat siz so'rasangiz:
   `out/<nom>_v001.mp4`. Hisobot Claude'da, panel **Tarix** bo'limida va kabinetda bor.

Hech narsa o'chirilmaydi:

- har o'zgarish yangi versiya (`plan v2`, `<nom>_v002.aep`);
- audio fayllar serverda saqlanadi va keshdan qayta ishlatiladi — takroriy so'rov yarim narx.

## 3. Tayyor buyruqlar (Claude)

| Buyruq | Nima qiladi |
|---|---|
| `/new-reel` | Brief va fayllardan qisqa video (ovoz, musiqa, subtitr bilan) |
| `/from-template` | Tayyor shablon (hook, lower third, CTA, mahsulot, fikr, top-3) asosida |
| `/subtitle-video` | Mavjud videoga subtitr (ovoz tozalash + transkript) |
| `/dub-video` | Videoni boshqa tilga dublyaj |

Foydali so'rovlar:

- *«Shu videoni 16:9 va 1:1 da ham chiqar»* — format variantlari;
- *«Bu CSV'dagi 10 ta mahsulot uchun product_showcase'dan video qil»* — batch;
- *«3-sahnani shablon qilib saqla»* — `template_save`.

## 4. Claude'siz (panel → Shablonlar)

1. Galereyadan shablon tanlang.
2. Slotlarni to'ldiring: matn, `source/` dagi fayl, rang.
3. Formatni (va qo'shimcha formatlarni) belgilab, «Videoni yaratish» bosing.

Bir nechta video kerak bo'lsa, **CSV** maydoniga jadval qo'ying: ustunlar slot nomlari, `name` — fayl nomi.
Har qator alohida video bo'ladi. Holat Tarix bo'limida ko'rinadi, yakunda Telegram xabari keladi.

## 5. Formatlar va brend

- **Formatlar:** 9:16 (Reels/TikTok), 1:1, 16:9 (YouTube). Bitta rejadan bir nechta format chiqadi.
  Joylashuv nisbiy, matn chetga chiqmaydi (safe area).
- **Brand kit:** matn shrifti va rangi, fon, shablon ranglari, logo, subtitr stili, default ovoz va musiqa
  uslubi. Shrift AE'da bo'lmasa, fallback shriftlar sinaladi. Hech biri bo'lmasa, Claude
  `AE_FONT_MISSING` haqida aytadi.

## 6. Narxlar

| Nima | Narx |
|---|---|
| Montaj (timeline) | 0.01 $ / video daqiqasi, job uchun bir marta (tuzatish va qayta build bepul) |
| Ovoz (TTS) | tannarxda |
| Musiqa — kutubxonadan | 10× arzon (qisqa trek silliq loop qilinadi) |
| Ovoz tozalash — standart (serverda) | 10× arzon |
| Pro musiqa, Pro tozalash va boshqa audio | tannarx × 2.4 |
| Keshdan qayta ishlatish | yarim narx |

Aniq narxlar kabinet → Sozlamalar → Balans va Pro'da.

## 7. Muammo bo'lsa

- Panel **Live** bo'limida xato kodi va maslahat ko'rinadi. To'liq ro'yxat: [errors.md](errors.md).
- **AE yopilsa yoki panel uzilsa:** job kutadi va ulanish qaytgach saqlangan joydan davom etadi —
  dublikat yaratilmaydi.
- **Balans yetmasa:** Claude aytadi (`BILLING_BALANCE_LOW`). Balans va sarf tarixi — kabinet → Sozlamalar.
- **Undo:** panel → Live → «Undo last».
