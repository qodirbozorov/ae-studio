# AE Studio — dasturchi qo'llanmasi

## Tuzilma

| Papka | Nima |
|---|---|
| `packages/shared` | Umumiy sxemalar (zod): Spec, oplar, WS xabarlari, xato kodlari, shablon, brand. ES3 bundle'ga ham kiradi (`errors.ts`, `ae.ts` — ES3-xavfsiz) |
| `packages/compiler` | Spec → oplist (sof funksiya): timing (TTS-first), shablonlar, brand, variantlar, audio |
| `apps/server` | Fastify: MCP (`/mcp`), OAuth 2.1, WS hub, job engine (holat mashinasi), ElevenLabs, audio navbati, shablonlar, batch, Telegram, kabinet API |
| `apps/web` | Web kabinet (React) |
| `apps/panel` | CEP panel: React UI, Node agent (`src/agent`), ExtendScript oplari (`src/jsx`, ES3) |
| `templates/`, `brands/` | Shablon kutubxonasi (recipe JSON) va brand namunasi |
| `docs/` | Hujjatlar. `mcp-tools.md` va `errors.md` generatsiya qilinadi (`pnpm gen:docs`) |

Oqim: Claude → MCP tool → `plan_write` (Spec) → `build_start` → engine. Engine holatlari:
`CHECK → PLAN → INGEST → AUDIO → PREFLIGHT → BUILD → VERIFY → RENDER → REPORT → DONE`. BUILD'da oplar
WS orqali panelga yuboriladi; agent ularni `evalScript` bilan jsx'da bajaradi.

## Ishlab chiqish

```bash
pnpm install
pnpm --filter @aes/server dev:db   # lokal Postgres (PGlite)
pnpm --filter @aes/server dev
pnpm --filter @aes/panel dev   # panel (AE'da PlayerDebugMode bilan)
pnpm check             # lint + typecheck + test
pnpm gen:docs          # MCP va xato hujjatlari
```

Testlar Vitest bilan yoziladi. Turlari:

- server — PGlite, soxta agent (`test/helpers/fake-agent.ts`), soxta ElevenLabs va Telegram;
- panel e2e — haqiqiy agent, haqiqiy ES3 bundle mock AE'da (`test/ae-mock.ts`), haqiqiy ffmpeg,
  soxta aerender;
- compiler — snapshot.

## Yangi op qo'shish

1. **Sxema:** `packages/shared/src/ops.ts` — `OP_NAMES`, params zod sxemasi, `OP_PARAMS_SCHEMAS`. Kerak
   bo'lsa timeout (`OP_TIMEOUT_MS`) va yo'l parametrlari (`OP_PATH_PARAMS`) ham qo'shiladi. TS tipi —
   `packages/shared/src/ae.ts` (`OpParamsMap`).
2. **ExtendScript:** `apps/panel/src/jsx/ops/<nom>.ts`.
   - Faqat ES3: `let`/`const` va arrow funksiyani Babel o'giradi; `Array#map`, `JSON` va ES5 API yo'q.
   - **Idempotentlik:** avval `findLayerInComp` / `findItemByOpId` bilan izni qidiring; bor bo'lsa
     `reused: true` qaytaring; yaratilgan elementga `stampLayer` / `stampItem`.
   - Xato — `raise(code, message)`.
   - `dispatcher.ts` da `registerOp`.
3. **Mock AE:** `apps/panel/test/ae-mock.ts` ga kerakli AE API qo'shiladi va `jsx-*.test.ts` da test yoziladi.
4. **Compiler:** `packages/compiler/src/compile.ts` — op_id barqaror nomdan (sahna/layer id) bo'lishi
   kerak: resume va patch shunga tayanadi.
5. Contract test namunasi: `packages/shared/test/contracts.test.ts`.

## Yangi ElevenLabs imkoniyati

1. **Klient funksiyasi:** `apps/server/src/eleven/<guruh>.ts`. U `ElevenClient.json` / `binary` (3 marta
   qayta urinish, xato xaritasi `EL_*`) va `AudioResult` / `InputFile` ni ishlatadi.
2. **Kind:** `packages/shared/src/audio.ts` dagi `AUDIO_KINDS` ga qo'shiladi. Kredit bahosi —
   `apps/server/src/audio/estimate.ts`.
3. **Audio navbatida bajarish:** `apps/server/src/audio/service.ts` (`execute` switch). Natija storage'ga
   (`audio-out/<sha256>`) yoziladi, `eleven_cache` (params_hash) to'ldiriladi, so'ng panelga yetkaziladi
   (`file.download`).
4. **MCP tool:** `apps/server/src/mcp/tools/eleven-*.ts`. `runTask` (kesh, kutish, yetkazish) bilan.
   Tool nomi neytral (`voice_*`, `audio_*`, `music_*`) — provayder nomi foydalanuvchiga va Claude'ga
   ko'rinmaydi. Eski `el_*` nomlar `aliases` orqali bir reliz davomida ishlaydi.
5. **Narx:** `packages/shared/src/pricing.ts` (`quoteAudio`) — tannarx × 2.4, basic (DFN3, kutubxona) × 0.1,
   kesh × 0.5; sarf `usage_ledger` ga (`BillingService.charge`, vazifa bo'yicha idempotent). Qimmat
   imkoniyat bo'lsa `isProAudio` ga qo'shing — u Pro tasdig'idan o'tadi (`BILLING_CONFIRM_REQUIRED`).
6. Soxta API: `apps/server/test/helpers/fake-eleven.ts` — rasmiy yo'l va javob shakli bilan.

## Yangi shablon

[templates/README.md](../templates/README.md): `templates/<slug>/template.json`, so'ng
`apps/server/src/templates/library.ts` ga import. Kutubxona testi har formatda tekshiradi.

## Yangi MCP tool

`apps/server/src/mcp/tools/<guruh>.ts` da `defineTool` yoziladi va `index.ts` ga qo'shiladi.

- Tavsif inglizcha va aniq bo'lsin: Claude uni o'qiydi.
- Xato `fail(code, message, details)` bilan, kodi `ERROR_DEFS` dan.
- So'ng `pnpm gen:docs` va test.

## Ko'p replika (P9.07)

Server bir nechta replikada ishlay oladi (`apps/server/src/cluster`). Yangi kod yozganda:

- **Holat xotirada bo'lmasin.** Haqiqat manbai — Postgres; xotiradagi kesh faqat tezlik uchun.
- **Panelga** faqat `ctx.hub` orqali (`send`, `run`, `request`, `kick`) — panel boshqa replikada bo'lsa ham
  yetadi. `hub.onMessage` faqat shu replikaga ulangan panellar xabarini oladi: undagi ish DB orqali bo'lsin.
- **Fondagi ish** (davriy yoki "bitta bo'lishi shart"): `withLock(ctx.cluster, "<kalit>", ttl, fn)` yoki lider
  qulfi (`cluster.acquire` har tick'da). Yakka rejimda (`cluster.shared = false`) qulf yo'q.
- **Rate limit:** `createLimiter(ctx.cluster, "<nom>", limit, oyna)`.
- **Boshqa replikaga xabar:** `cluster.broadcast({ t: "<tur>", … })` / `cluster.sendTo(replica, …)`;
  qabul — `cluster.onMessage` (build vaqtida ro'yxatdan o'tkazing, `onReady` ichida emas).
- **Test:** `test/cluster.test.ts` — ikki ilova bitta PGlite va `MemoryNetwork` bilan. Butun to'plamni
  taqsimlangan yo'llar yoqilgan holda: `AES_TEST_CLUSTER=shared pnpm test`. Redis buyruqlari —
  `test/redis-cluster.test.ts` (ioredis-mock).

## Deploy (Railway)

- `railway.json`:
  - build: `pnpm --filter @aes/web build && pnpm --filter @aes/server build`;
  - pre-deploy: `node apps/server/dist/migrate.js` — Drizzle migratsiyalari `apps/server/drizzle/`;
  - start: `node apps/server/dist/index.js`;
  - healthcheck: `/health` (DB va Redis holati).
- Muhit o'zgaruvchilari: `apps/server/src/env.ts`. Production'da `PUBLIC_URL`, `DATABASE_URL`,
  `REDIS_URL`, `MASTER_KEY` (32 bayt base64), `JWT_SIGNING_KEY` (OAuth CSRF), storage (`S3_*` yoki volume'da
  `STORAGE_DIR`) kerak. Kabinetga kirish uchun `TELEGRAM_BOT_TOKEN` va
  `TELEGRAM_BOT_USERNAME` majburiy: login Telegram deep link orqali.
- Migratsiya: `apps/server/src/db/schema.ts` → `cd apps/server && npx drizzle-kit generate --name <nom>`.
- Panel relizi: [release-panel.md](release-panel.md). Production tayyorgarligi:
  [production.md](production.md).
