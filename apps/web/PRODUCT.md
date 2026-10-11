# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Administrator va jamoa a'zolari: After Effects'da AE Studio panelidan foydalanadigan motion dizaynerlar va
ularning qurilmalarini, ulanishlarini va kalitlarini boshqaradigan administrator. Kabinetga qisqa tashriflar
bilan kiriladi: yangi qurilmani kod bilan ulash, panel onlayn ekanini va joriy job holatini ko'rish, xato
bo'lganda faollik lentasidan sababni topish, ElevenLabs/Telegram/Brand sozlamalarini kiritish.

Hozirgi kodda rollar va jamoa (bir nechta foydalanuvchini bitta joyda boshqarish) yo'q: har akkaunt o'z
qurilmalari va job'larini ko'radi. Jamoa/rol funksiyalari — ochiq qaror.

## Product Purpose

AE Studio: foydalanuvchi Claude'ga oddiy tilda yozadi, server (Railway) reja (Video Spec) asosida oplarni
kompilyatsiya qiladi, After Effects ichidagi CEP panel ularni bajaradi; ElevenLabs ovoz, musiqa, subtitr
beradi. Web kabinet — shu tizimning boshqaruv paneli: kirish, qurilmalarni ulash va kuzatish, job tarixi va
hisobotlar, audit, ulangan ilovalar (Claude connector), sozlamalar.

Muvaffaqiyat: foydalanuvchi bir qarashda qaysi qurilma onlayn, nima qurilayotgani va nima to'xtaganini biladi;
ulash va sozlash bir necha soniyada bajariladi.

## Positioning

Claude, panel va ElevenLabs bir-biri bilan to'g'ridan-to'g'ri gaplashmaydi — hammasi server orqali. Kabinet bu
zanjirning yagona kuzatuv nuqtasi: qurilma holati, job holat mashinasi (CHECK → … → DONE), audit izi.

## Operating Context

- Kirish: Telegram bot deep link (parol/email yo'q). Shu chat xabarnomalar uchun ham ulanadi.
- Qurilma ulash: panel 6 belgili kod ko'rsatadi → kabinetda tasdiqlanadi (device flow).
- Job holatlari: CHECK, PLAN, INGEST, AUDIO, PREFLIGHT, BUILD, VERIFY, RENDER, REPORT, DONE, BLOCKED,
  WAITING_AGENT.
- Asl media foydalanuvchi kompyuterida qoladi; kabinet faqat metadata, holat va hisobotlarni ko'rsatadi.

## Capabilities and Constraints

- Sahifalar: Qurilmalar, Qurilma faolligi, Qurilma ulash, Tarix (job'lar, batch'lar, hisobot), Audit,
  Ulangan ilovalar, Profil, Sozlamalar (ElevenLabs kaliti, Telegram, Brand kit JSON).
- Stack: React 19 + Vite + Tailwind v4, lucide ikonlari. Server API `{ ok, data } | { ok: false, error }`.
- Interfeys tili — o'zbekcha.
- ElevenLabs kaliti serverda shifrlangan, qaytarib ko'rsatilmaydi.

## Brand Commitments

- Nomi: AE Studio.
- Kabinet vizual yo'nalishi foydalanuvchi bergan reference'ga bog'langan (2026-10-12): yumshoq kulrang
  maydon, oq kartalar, katta radiuslar, Inter (Google Fonts) yengil og'irliklarda. Faqat light rejim.

## Evidence on Hand

Haqiqiy ma'lumot faqat API'dan keladi. Mijozlar, raqamlar yoki natijalar haqida da'volar yo'q va
to'qilmasligi kerak.

## Product Principles

1. Holat birinchi: onlayn/oflayn, joriy job va xato bir qarashda ko'rinadi.
2. Hech narsa yashirin emas: har harakat audit va faollik lentasida iz qoldiradi.
3. Xavfli amallar (qurilma/ilovani bekor qilish, kalitni o'chirish) aniq tasdiq bilan.
4. Xato doim sabab va keyingi qadam bilan ko'rsatiladi.
