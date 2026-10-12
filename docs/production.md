# Production tayyorgarligi

## Railway

- **Healthcheck:** `/health` (120 s). Javobda DB va Redis holati bo'ladi. Biror qism ishlamasa 503 qaytadi,
  Railway servisni sog'lom deb hisoblamaydi.
- **Qayta ishga tushirish:** `ON_FAILURE`, ko'pi bilan 5 marta (`railway.json`).
- **To'xtash:** SIGTERM kelganda server yangi so'rov qabul qilmaydi va joriy ishlarni 10 s ichida
  yakunlaydi (`index.ts`).
- **Ishga tushganda tiklanadi:**
  - yakunlanmagan joblar — saqlangan joydan, dublikatsiz;
  - audio vazifalari;
  - batch'lar.
- **Migratsiyalar** pre-deploy bosqichida (`node apps/server/dist/migrate.js`). Ular idempotent:
  0000–0017.
- **Build** `deep-filter` 0.5.6 binarini yuklaydi (`apps/server/scripts/fetch-deep-filter.mjs`, sha256
  tekshiriladi) — standart ovoz tozalash serverda bajariladi.

### Env (Faza 8–9)

| O'zgaruvchi | Ma'nosi |
|---|---|
| `ADMIN_LOGIN`, `ADMIN_PASSWORD` | `/admin` kirish (parol ≥ 12 belgi). Bo'sh bo'lsa admin o'chiq |
| `ELEVENLABS_API_KEY` | Markaziy audio kaliti (foydalanuvchilar kalit kiritmaydi) |
| `BILLING_ENFORCE` | `1` — balans/faollashtirish tekshiriladi; bo'sh — faqat sarf yoziladi |
| `AES_ROLE` | `all` (default) · `api` · `worker` |
| `AUDIO_CONCURRENCY` | Worker'da parallel audio vazifalar (default 2) |
| `DEEP_FILTER_BIN` | `deep-filter` yo'li (bo'sh — `apps/server/bin/` dan topiladi) |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook (24–256 belgi `A-Za-z0-9_-`). Berilsa — webhook, aks holda long polling. Bir nechta replikada tavsiya etiladi |
| `AES_CLUSTER` | `redis` · `off`. Berilmasa: production'da `redis` (presence, RPC, qulflar Redis orqali), boshqa muhitda `off` |

### Storage

Admin → **Storage**: Railway volume yoki R2 (S3) tanlanadi, R2 kalitlari shu yerda kiritiladi (`MASTER_KEY`
bilan shifrlanadi). Yozish faol storage'ga; o'qish avval faoldan, so'ng ikkinchisidan. Fayl ko'ruvchi
ikkalasini ko'rsatadi: yuklab olish, o'chirish, bir storage'dan boshqasiga nusxalash.

### Masshtab

- Bitta instans (`AES_ROLE=all`) — default. Audio navbati, job engine va Telegram polling jarayon ichida.
- **Bir nechta replika** (P9.07; Railway → server → Replicas). Talablar: R2 faol (volume bitta replikaga
  ulanadi), Redis (`REDIS_URL`, ichki tarmoq), `AES_CLUSTER` `off` emas, Telegram uchun webhook
  (`TELEGRAM_WEBHOOK_SECRET`). Nima qanday ishlaydi:
  - panel istalgan replikaga ulanadi; replikalar presence'ni Redis pub/sub orqali tarqatadi, boshqa
    replikadagi panelga op/so'rov RPC bilan yetkaziladi (`apps/server/src/ws/hub.ts`);
  - job driver `job:<id>` qulfi ostida (60 s, uzaytiriladi): bitta job ikki replikada yurmaydi; qulf band
    bo'lsa egasiga "yana yurit" yuboriladi; replika o'lsa qulf bo'shaydi va qayta ishga tushganda tiklanadi;
  - batch `advance` — `batch:<id>` qulfi; backup/tozalash va Telegram polling — lider qulfi;
  - audio: navbat Postgres'da (atomar egallash, 40 daqiqalik lease), kutuvchilar DB orqali xabar oladi;
  - rate limit (login, admin, OAuth, MCP, audio) — Redis hisoblagichi (barcha replikalar uchun umumiy);
  - narx va storage sozlamasi o'zgarsa boshqa replikalar darhol qayta o'qiydi;
  - sessiya, OAuth, admin cookie — DB yoki imzo (holatsiz).
  Cheklov: admin → Storage'dagi "nusxalash" holati faqat shu so'rov tushgan replikada ko'rinadi.
  Redis ishlamasa qulf va limit "ochiq" ishlaydi (xizmat to'xtamaydi, xato logda).
- Og'ir audio uchun alohida worker servisi: serverda `AES_ROLE=api`, worker'da `AES_ROLE=worker` (xuddi shu
  image, `DATABASE_URL` va `MASTER_KEY` bir xil). **Faqat R2 faol bo'lganda** — volume bitta servisga
  ulanadi. Worker navbatdan vazifani atomar oladi, 40 daqiqalik lease bilan; o'lgan worker'ning vazifasi
  qaytadi. R2 faol bo'lmasa worker kutadi va `/health` 503 qaytaradi.

### Admin (`/admin`)

- **Foydalanuvchilar:** qidiruv (ism, @username, Telegram ID, email, ID), holat filtri, umumiy ko'rsatkichlar
  (tushum, sarf, tannarx, marja). Profil: balans va sarf tarixi, panellar, Claude ulanishlari, joblar,
  sessiyalar. Amallar: balansni to'ldirish (tarif yoki erkin summa; manfiy — tuzatish), sessiyalarni bekor
  qilish (ixtiyoriy Claude ulanishlari bilan), bloklash (barcha sessiya, panel va Claude tokenlari bekor,
  panel uziladi; har autentifikatsiyada ham tekshiriladi) va blokdan chiqarish.
- **Narxlar:** tariflar (to'lov → balansga summa, bonus; faollari kabinetda ko'rinadi), stavkalar (ustama,
  oddiy/pro nisbati, kesh, montaj, boshlang'ich to'lov, tannarxlar — bo'sh maydon koddagi qiymat), to'lov
  kontakti (kabinet, panel, bot va Claude ko'rsatadi). Har o'zgarish audit'da.

### Balans va musiqa

- To'ldirish: admin → Foydalanuvchilar → profil (tarif yoki summa) yoki
  `pnpm --filter @aes/server topup <telegram_id|email|user_id> <usd> [izoh]`
  (`DATABASE_PUBLIC_URL` bilan). Jami 20 $ ga yetganda hisob faollashadi. Foydalanuvchiga botda xabar boradi;
  balans 1 $ dan pastga tushganda ham.
- Musiqa kutubxonasi: admin → **Musiqa** (yuklash, nom/kategoriya/tavsif, nomzodlarni tasdiqlash) yoki
  `pnpm --filter @aes/server seed:music <papka> [meta.json|csv]`. Pro generatsiya natijalari nomzod
  sifatida avtomatik yig'iladi.

## DB backup

- **Avtomatik:** production'da har `BACKUP_INTERVAL_H` (default 24) soatda butun baza storage'ga yoziladi:
  `system/backups/<vaqt>.ndjson.gz`. Oxirgi `BACKUP_KEEP` (default 14) tasi saqlanadi.
- **Format:** Postgres'ning o'z JSON serializatsiyasi (`json_agg`), har jadval bir qator, gzip. Tiklash
  `json_populate_recordset` bilan bajariladi — turlar aniq qaytadi. Jadvallar FK tartibida, bitta
  tranzaksiyada tiklanadi. Bo'sh bo'lmagan bazaga tiklanmaydi.
- **Qo'lda:**
  ```bash
  DATABASE_URL=… pnpm --filter @aes/server exec tsx scripts/backup.mts dump backup.ndjson.gz
  DATABASE_URL=<yangi bo'sh baza> pnpm --filter @aes/server exec tsx scripts/backup.mts restore backup.ndjson.gz
  ```
- **Diqqat:** `secrets` (ElevenLabs kalitlari) shifrlangan holda saqlanadi. Tiklangan bazada ular faqat o'sha
  `MASTER_KEY` bilan ochiladi — `MASTER_KEY` ni alohida, xavfsiz joyda saqlang.
- Railway Postgres'ning o'z volume snapshot'lari ham yoqiq tursin. Bu qo'shimcha himoya.

## Loglarni saqlash muddati

Har kuni avtomatik tozalanadi:

| Ma'lumot | Muddat |
|---|---|
| `job_events` (live log) | `LOG_RETENTION_DAYS` (default 90 kun). Faqat yakunlangan va shundan eski joblar; job, plan, hisobot va renderlar qoladi |
| `audit_log` | 365 kun |
| Eskirgan OAuth tokenlari | muddatidan 7 kun keyin |
| Telegram bog'lash kodlari | muddati o'tishi bilan |

Server loglari (pino, stdout) Railway'da saqlanadi. `authorization` va `cookie` sarlavhalari yashiriladi.

## Xavfsizlik ko'rigi (2026-10-12, Faza 9)

| Soha | Holat |
|---|---|
| Kirish (Telegram) | Bot so'rov tafsilotini (brauzer, IP, Toshkent vaqti) ko'rsatadi; saytdagi 2 xonali raqam botdagi 3 tugmadan tanlanadi; noto'g'ri raqam yoki «Bu men emas» so'rovni yopadi; havolani boshqa Telegram hisobi ocholmaydi. Fishing havolasi bilan begona kira olmaydi |
| Webhook | `X-Telegram-Bot-Api-Secret-Token` konstant vaqtda solishtiriladi, takroriy update e'tiborsiz |
| Sessiyalar | IP va brauzer saqlanadi; kabinetda ro'yxat, bittasini yoki boshqa barchasini yopish; 24 soatda rotatsiya (eski token 60 s ishlaydi). Token `created_at` ilova soatidan |
| Bloklash | Barcha kirish tokenlari bekor + sessiya, panel (HTTP/WS), Claude bearer va OAuth token berishda tekshiruv; Telegram kirishi rad |
| Device flow | Tasdiq sahifasida panel IP'si va vaqti; boshqa tarmoqdan bo'lsa ogohlantirish |
| Admin | HMAC cookie (`sameSite=strict`), konstant vaqt, umumiy rate limit, o'zgartiruvchi so'rovlarda Origin, har amal audit'da (login, logout ham) |
| IDOR | REST (`/api/*`, `/api/agent/*`) va MCP tool'larining barcha id'li so'rovlari foydalanuvchi yoki qurilma bo'yicha filtrlanadi (ko'rib chiqildi; testlarda boshqa foydalanuvchiga 404) |
| Ko'p replika | Redis faqat ichki tarmoqda (cluster xabarlari ishonchli kanal hisoblanadi) |

## Xavfsizlik ko'rigi (2026-10-07)

| Soha | Holat |
|---|---|
| Maxfiy kalitlar | ElevenLabs kaliti AES-256-GCM bilan (`MASTER_KEY`) saqlanadi. API faqat `…abcd` ni qaytaradi va logga yozilmaydi. Telegram bot tokeni faqat env'da |
| Autentifikatsiya | Telegram bot deep link: bir martalik, 10 daqiqa; kod brauzerdagi httpOnly cookie siriga bog'langan, shuning uchun boshqa brauzer undan foydalana olmaydi. Sessiya cookie: `httpOnly`, `sameSite=lax`, https'da `secure`. Panel — device flow; tokenlar hash bilan saqlanadi va bekor qilinadi |
| Claude (MCP) | OAuth 2.1 (DCR + CIMD, PKCE majburiy). Har tool foydalanuvchiga bog'langan. Ulanishlar kabinetda bekor qilinadi |
| Rate limit | Login va qurilma tasdig'i — IP bo'yicha. OAuth register/token, MCP (foydalanuvchi bo'yicha), ElevenLabs — 60/daqiqa |
| Fayl yo'llari | Op va WS yo'llari server va panelda ish papkasi ichida tekshiriladi (`..` va absolyut yo'l rad etiladi). Storage kalitlari segment bo'yicha tekshiriladi |
| Fayllar | Faqat pre-signed URL (15 daqiqa). Yuklab olishda sha256 tekshiriladi; buzilgan fayl diskda qolmaydi |
| Izolyatsiya | Loyiha, job, asset, brand, shablon, batch va Telegram — foydalanuvchi bo'yicha. Testlarda boshqa foydalanuvchiga 404 yoki bo'sh javob tekshirilgan |
| HTTP sarlavhalari | `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy`, production'da HSTS |
| Audit | Login, qurilma, OAuth, ElevenLabs kaliti, brand, Telegram, MCP tool chaqiruvlari |
| ExtendScript | Yopiq op to'plami; expression'lar faqat kutubxonadan. `eval` yoki ixtiyoriy skript yo'q |
| ZXP | Imzolangan, `.debug` (remote debug porti) yo'q. ffmpeg — LGPL, o'zgartirilmagan |

Qolgan tavsiyalar (👤):

- Railway'da `MASTER_KEY` va `JWT_SIGNING_KEY` ni yillik almashtirish tartibi;
- Telegram bot tokeni chatda ochiq yuborilgan — doimiy ishlatishdan oldin @BotFather'da `/revoke`
  qilib, yangisini Railway'ga qo'yish.

## Regressiya to'plami

```bash
pnpm test:regression
```

Tarkibi:

- compiler snapshot'lari;
- server integratsiyasi (soxta agent, ElevenLabs va Telegram bilan);
- ES3 oplari;
- shablon kutubxonasi (har format);
- e2e gate'lar (haqiqiy agent + ffmpeg + mock AE).

To'liq to'plam: `pnpm check` (lint + typecheck + barcha testlar).
