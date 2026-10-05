# AE Studio — 5 fazali qurilish rejasi

> Manba: [ae-studio-plan.md](ae-studio-plan.md) (v1.0). Undagi barcha bo'limlar (§0–§17) va milestonelar (M0–M8) shu 5 fazaga taqsimlangan. Qaysi element qaysi fazaga tushgani §8 dagi qamrov jadvalida.
> Jarayon jurnali: [process.md](process.md). **Har todo tugaganda** shu yerga hisobot yoziladi.
> Tuzildi: 2026-10-05 · Repo ildizi: shu papka (§13 dagi `ae-studio/` tuzilishi shu yerda quriladi).

---

## 0. Ish protokoli

**Belgilar:** 👤 sizning harakatingiz kerak (akkaunt, kalit, tasdiq, AE'da qo'lda tekshiruv) · 🧪 gate testi · ❓ hal qilinishi kerak bo'lgan qaror (§9).

**Todo bajarildi deyiladi, qachonki (DoD):**
1. Kod va testlar yozilgan; tegishli paketlarda `pnpm typecheck && pnpm lint && pnpm test` o'tadi (AE qismida smoke-test).
2. §2 dagi invariantlar buzilmagan.
3. Shu faylda todo `[ ]` → `[x]` qilingan.
4. [process.md](process.md) ga hisobot qo'shilgan va **"Joriy holat"** yangilangan. ❓ yopilgan bo'lsa, qaror qarorlar jurnaliga ham yozilgan.

**Faza qoidasi:** keyingi faza oldingi fazaning 🧪 gate'i to'liq o'tgandan keyingina boshlanadi. Dalillar (buyruq chiqishi, fayl yo'llari) process.md ga yoziladi.

**Tiklash (compact yoki yangi sessiyadan keyin):** process.md → "Joriy holat" → oxirgi 3 hisobot → shu fayldagi birinchi `[ ]` todo.

---

## 1. Umumiy ko'rinish

| Faza | Nomi | Asl milestone | Faza oxirida nima ishlaydi |
|---|---|---|---|
| **1** | Poydevor | M0 + M1 | Monorepo, `shared` kontraktlar, Railway'da `/health`, AE ichidagi panel oplarni bajaradi |
| **2** | Yadro: ulanish + bajaruvchi | M2 + M3 | Device flow, WSS, compiler, state machine: `plan.json` dan AE'da video quriladi, uzilishdan keyin dublikatsiz davom etadi |
| **3** | Claude loop'i (audio'siz MVP) | M4 + M6 | Claude chatidan: brief → plan → build → kadr tekshiruvi/patch → mp4 → hisobot |
| **4** | ElevenLabs to'liq | M5 | Barcha `el_*`, TTS-first timing, karaoke subtitr, musiqa + ducking, SFX, o'zbek tili testi |
| **5** | Shablonlar, brand, qadoqlash | M7 + M8 | Shablon/brand/format variantlari, Claude'siz rejim, batch, Telegram, ZXP installer, hujjatlar |

```
Faza 1 ──▶ Faza 2 ──▶ Faza 3 ──▶ Faza 4 ──▶ Faza 5
poydevor   yadro      Claude MVP  audio      shablon + qadoqlash
```

**Asl rejadan farqlar va sabablari:**
- **M6 (Verify + Render) M5 (ElevenLabs) dan oldinga olindi.** VERIFY va RENDER audio'ga bog'liq emas. M5 gate'ini ("…bilan video") render'siz tekshirib bo'lmaydi. Bu tartibda Faza 3 oxirida butun loop (CHECK → … → REPORT) yopiladi, audio esa unga keyin `AUDIO` holati sifatida ulanadi.
- **Maxsus oplar o'zidan foydalanadigan qism bilan birga quriladi.** M3 da "barcha oplar" deyilgan, lekin `frames.capture`/`render.queue` (F3), `captions.build`/`audio.duck` (F4) va `template.instantiate` (F5) ni o'z fazasidan oldin gate bilan sinab bo'lmaydi.
- **Node 24 LTS.** Rejada "20+" deyilgan, lekin Node 20 2026-04 da EOL bo'lgan. §14 dagi `yarn` buyruqlari o'rniga `pnpm` ishlatiladi.

---

## 2. Invariantlar (har todo'da tekshiriladi, §0 va §2 dan)

- Claude, panel va ElevenLabs bir-biri bilan to'g'ridan-to'g'ri gaplashmaydi, faqat server orqali. Panel serverga **outbound** WSS bilan ulanadi (D1, D8).
- Claude ExtendScript yozmaydi: Spec → compiler → yopiq op to'plami (D4).
- Asl media localda qoladi; ElevenLabs kaliti faqat serverda, shifrlangan holda turadi (D5, D6).
- Barcha kontraktlar `packages/shared` (zod) dan olinadi (D7). Panelda native Node modul yo'q (D9), UXP yo'q (D3).
- Har chaqiruvda timeout bor; xato doim `{ code, retryable, hint }` ko'rinishida (§12).
- Oplar idempotent (`op_id`); bitta evalScript = bitta op.
- Hech narsa o'chirilmaydi: `.aep` va `plan.json` versiyalanadi. Har job `REPORT` bilan yopiladi.

---

## 3. Faza 1 — Poydevor (M0 + M1)

**Maqsad:** kontraktlar tayyor bo'ladi. Ikki uch (Railway'dagi server va AE ichidagi panel) ishlaydi va dev-WS orqali bog'lanadi (§17 "birinchi hafta").

- [x] **P1.01 — Muhit.** Node 24 LTS + pnpm (corepack) + ffmpeg/ffprobe: ruxsatingiz bilan men o'rnataman (user papkasiga, admin'siz). 👤 **After Effects** (Creative Cloud). `PlayerDebugMode = "1"` (`HKCU\Software\Adobe\CSXS.<11|12>`), `git init`, 👤 git `user.email`.
  - Holat (2026-10-05): Node v24.21.0 ✅ · pnpm 12.9.1 ✅ · ffmpeg n8.1.3 ✅ · git ✅ (`main`, repo-local email) · After Effects + PlayerDebugMode → 👤 boshqa kompyuterda.
  - Tayyor: `node -v`, `pnpm -v`, `ffprobe -version` ishlaydi; AE va CSXS versiyalari process.md ga yozilgan.
- [x] **P1.02 — Monorepo skeleti.** pnpm workspace, `tsconfig.base.json` (strict), ESLint (flat) + Prettier, Vitest workspace, `.gitignore`, `engines.node`, §13 papkalari: `packages/{shared,compiler}`, `apps/{server,worker,web,panel}`, `templates/`, `brands/`, `docs/`.
  - Tayyor: `pnpm install && pnpm lint && pnpm typecheck && pnpm test` toza o'tadi.
- [x] **P1.03 — `shared/errors.ts` va javob formati.** §12 dagi barcha kodlar (prefiks, `retryable`, standart `hint`), `Result<T> = { ok: true, data } | { ok: false, error }` (§8), `err()` helper.
  - Tayyor: har kod uchun test bor; noma'lum kod tip xatosi beradi.
- [x] **P1.04 — `shared/spec.ts` (Video Spec, §9).** `format`, `variants`, `brand`, `audio.*`, `scenes` (`dur`: soniya yoki `vo:a-b`, `template` + `slots`, `layers`: media/text/shape/audio, `anim`, `pos`, `transition_out`), `output`; `asset:<key>` havola parseri; MCP `inputSchema` uchun JSON Schema eksporti. ❓ zod v3 yoki v4 (MCP SDK bilan moslik, Q6).
  - Tayyor: §9 namunasi valid; 10+ noto'g'ri holat aniq zod path bilan rad etiladi.
- [x] **P1.05 — `shared/ops.ts`, `ws.ts`, `template.ts`, `brand.ts`.** 18 op (discriminated union, har biriga params sxemasi), op konverti `{ op_id, seq, op, params, scene_id, timeout_ms }`, op natijasi; §10.2 dagi barcha WS xabarlari (+ `protocol_version`); shablon manifesti (§11.2) va `brand.json` (§11.3) sxemalari.
  - Tayyor: har op va xabar uchun valid + invalid test.
- [x] **P1.06 — Server skeleti.** `apps/server`: Fastify + pino, env validatsiyasi (zod, §13 env ro'yxati), `/health` (DB + Redis ping), graceful shutdown, Railway build konfiguratsiyasi.
  - Tayyor: lokal `pnpm dev` da `/health` 200 qaytaradi.
- [x] **P1.07 — DB sxema va migratsiyalar.** Drizzle: §5 dagi **barcha 17 jadval** (indekslar, FK, `jobs.state` enum), `pnpm db:migrate`; testlarda PGlite (Docker shart emas).
  - Tayyor: migratsiya bo'sh DB'da va PGlite'da o'tadi; asosiy CRUD testlari bor.
- [x] **P1.08 — Railway deploy.** 👤 tasdiq bilan, CLI orqali: loyiha, `server` + Postgres + Redis servislari, env o'zgaruvchilar, deploy paytida migratsiya.
  - Tayyor: `https://<app>.up.railway.app/health` → `{ db: ok, redis: ok }`.
- [x] **P1.09 — Panel skeleti (Bolt CEP).** `apps/panel`: React + Vite + TS, `cep.config.ts` (id, AE host diapazoni, `--enable-nodejs`, `--mixed-context`), build target CEP ichidagi Chromium/Node'ga mos, pnpm workspace'ga ulangan, `extensions` papkasiga dev symlink.
  - Tayyor: 👤 AE → Window → Extensions → AE Studio ochiladi, hot reload ishlaydi.
- [x] **P1.10 — ExtendScript runtime (§10.3).** `src/jsx`: TS → ES3 build, `json2` polyfill, `runOp(json)` dispatcher (`beginUndoGroup(op_id)`, `beginSuppressDialogs`, `try/catch`, natija doim JSON string), AE versiya tekshiruvi (`AE_VERSION`), `ping` op, `op_id` izi (layer/item comment) va `findByOpId`.
  - Tayyor: `runOp('ping')` AE versiyasi va loyiha yo'lini qaytaradi; xatoda `AE_SCRIPT_ERROR` JSON keladi.
- [x] **P1.11 — Panel op runner va live log.** `evalScript` uchun promise wrapper, `timeout_ms` o'tsa `AE_TIMEOUT`, ketma-ket navbat (bitta evalScript = bitta op), live log komponenti (⏳ → ✅/❌), dev tugmalar.
  - Tayyor: tugmalar bosilganda ping va op natijalari logda chiqadi.
- [x] **P1.12 — Birinchi 4 op.** `comp.create`, `layer.add_text`, `item.import`, `layer.add_media`. Idempotent: izi bor bo'lsa mavjud element qaytariladi. Fayl yo'li faqat ish papkasi ichida bo'lishi mumkin (path traversal tekshiruvi).
  - Tayyor: bitta op ikki marta yuborilsa dublikat paydo bo'lmaydi; AE smoke-test skripti bor.
- [x] **P1.13 — Dev WS.** Server `/ws/agent` (vaqtinchalik dev token), panel WS klienti, `hello`/`hello_ack`, `ping`/`pong`, `op.run` → `op.started`/`op.done`/`op.failed`, `log`; dev endpoint `POST /dev/op`.
  - Tayyor: Railway'dagi serverdan yuborilgan op AE'da bajariladi, natija serverga qaytadi.
- [ ] **P1.14 — 🧪 Faza 1 gate.**
  - [x] `pnpm test` o'tadi (M0) — 164/164, 2026-10-05
  - [ ] `/health` Railway'da javob beradi (M0)
  - [ ] 👤 panel tugmasi AE'da comp + matn yaratadi va bu live logda ko'rinadi (M1)
  - [ ] Railway'dan yuborilgan `op.run` AE'da bajariladi (§17.5)

---

## 4. Faza 2 — Yadro: ulanish + bajaruvchi (M2 + M3)

**Maqsad:** xavfsiz va doimiy ulanish; joblarni server boshqaradi: `plan.json` → compiler → oplar → AE.

- [x] **P2.01 — Web login.** ❓ 👤 usulni tanlash: email magic link (Resend/SMTP kaliti) yoki Google OAuth (client ID) (Q2). `users`, sessiya (`JWT_SIGNING_KEY`); dev rejimda link logga chiqadi.
  - Tayyor: login/logout ishlaydi, sessiya testlari bor.
- [x] **P2.02 — Web kabinet skeleti (§4.3).** `apps/web` (React + Vite): login, device kodni tasdiqlash, ulangan qurilmalar (revoke). Kabinetni server static qilib beradi; `/api/*` REST sessiya bilan ishlaydi.
  - Tayyor: kabinet Railway'da ochiladi.
- [x] **P2.03 — Device flow (§4.2, RFC 8628).** `POST /oauth/device/code` (6 belgili `user_code`), `POST /oauth/device/token` poll (`authorization_pending`, `slow_down`, `expired_token`, `access_denied`), `device_token` (hash holida saqlanadi, uzoq muddatli, bekor qilinadi), `devices` jadvali.
  - Tayyor: to'liq oqim bo'yicha integratsiya testi bor.
- [x] **P2.04 — Panel: Ulanish ekrani va credentials.** Kodni ko'rsatish, brauzerni ochish, poll. Token `.aestudio/credentials` ga AES bilan yoziladi (kalit mashinaga bog'liq, Node `crypto`, native modulsiz). Holat indikatorlari: 🟢 Server · 🟢 AE.
  - Tayyor: 👤 panel kod orqali ulanadi; AE qayta ochilganda qayta login so'ramaydi.
- [x] **P2.05 — Production WSS.** ❓ Brauzer `WebSocket` `Authorization` header qo'ya olmaydi (Q1). Tavsiya: CEP Node'da sof-JS `ws` paketi (header bilan, §4.2 ga mos). Heartbeat 10 s; 30 s javob bo'lmasa qurilma offline, joblar `WAITING_AGENT` ga o'tadi. Panel backoff + jitter bilan qayta ulanadi; `hello` kelganda tugallanmagan job davom etadi. Dev token o'chiriladi.
  - Tayyor: tarmoq uzilishi testida panel avtomatik qayta ulanadi va job davom etadi.
- [x] **P2.06 — Storage (§4.4, §6).** ❓ 👤 Cloudflare R2 yoki Railway bucket (Q3). S3 klient, pre-signed PUT/GET (15 daqiqa), kalit sxemasi `u/<user>/p/<project>/{thumbs|frames|audio-in|audio-out}/<hash>.<ext>`. Panelda upload/download + sha256 tekshiruvi (3 qayta urinish, keyin `ASSET_CORRUPT`); `file.download` / `file.uploaded` / `file.saved`.
  - Tayyor: buzilgan fayl qayta yuklab olinadi, 3 urinishdan keyin `ASSET_CORRUPT` qaytadi.
- [x] **P2.07 — Ish papkasi va Sozlamalar.** Papka tanlash, `/source /audio /frames /out /logs /.aestudio` yaratish, oxirgi loyihalar (`projects`). Path traversal guard `shared` da turadi va panel bilan serverda ishlatiladi. Sozlamalar ekrani: qurilma nomi, chiqish, log darajasi. `ae.state` xabari.
  - Tayyor: papkadan tashqaridagi yo'l ikkala tomonda ham rad etiladi (test).
- [x] **P2.08 — ffmpeg wrapper va INGEST.** `child_process.spawn` + timeout + kill. ffprobe metadata, rasm thumbnail / video kadrlari (≤1280px JPG) storage'ga yuklanadi; `asset.scanned` → `assets` jadvali; katta fayllar uchun tez hash strategiyasi.
  - Tayyor: aralash papka (video, rasm, audio, buzuq fayl) to'g'ri skanerlanadi.
- [x] **P2.09 — Qolgan yadro oplar.** `project.open_or_create`, `project.save` (vNNN), `comp.nest`, `layer.add_shape`, `layer.add_audio`, `prop.keyframes` (ease), `prop.expression` (+ expression kutubxonasi: wiggle, bounce, loop va boshqalar, faqat nom bilan, §11.4.4), `fx.apply_preset`, `fx.add`; `ops.batch`.
  - Tayyor: har op idempotent, har biriga AE smoke-test bor.
- [x] **P2.10 — Compiler (Spec → oplist).** Sof funksiya: format → asosiy comp; sahnalar → sahna comp'lari + nest; layerlar → oplar; `anim` (ken_burns_in, typewriter, fade, slide…), `pos` (lower_third, center…) formatga nisbiy; `transition_out` (whip_left…) keyframe asosida; VERIFY uchun kalit vaqtlar; **deterministik `op_id`** (resume va patch uchun barqaror). `vo:` davomiyliklari Faza 4 da.
  - Tayyor: snapshot testlar bor; bir xil spec har doim bir xil oplist beradi.
- [x] **P2.11 — Job state machine (§3).** Barcha holatlar va o'tishlar, gate'lar, `BLOCKED` (retry | patch | ask_user | cancel), `WAITING_AGENT` (`prev_state`), `patch_count`. Handlerlar: CHECK (server, panel, AE, papka, ffmpeg), PLAN (zod + havolalar), INGEST, PREFLIGHT (havola ↔ fayl, shriftlar, compile), BUILD (oxirgi `done` opdan davom etadi), REPORT. Vaqtincha: AUDIO → `skipped` (Faza 4 gacha), VERIFY → qo'lda approve (Faza 3 gacha), RENDER → Faza 3 da. Bitta qurilmada bitta aktiv job.
  - Tayyor: soxta agent bilan to'liq oqim va har bir xato yo'li sinalgan.
- [ ] **P2.12 — Live log va Live ekrani.** `job_events` → WS → panel: holat zanjiri, progress (op soni), joriy sahna, log; Pause / Resume / Cancel / Undo last (`job.pause`, `job.cancel`).
  - Tayyor: 👤 job panelda real vaqtda kuzatiladi va boshqariladi.
- [ ] **P2.13 — Versiyalash va oddiy REPORT.** `plans` versiyalari, `.aep` vNNN, local nusxalar `.aestudio/plan.vNNN.json`. `reports/` generatori (qurilganlar, yo'llar, tahrir qo'llanmasi, ogohlantirishlar) → `reports` jadvali va `.aestudio/report.md`.
  - Tayyor: hech qaysi versiya ustiga yozilmaydi (test).
- [ ] **P2.14 — 🧪 Faza 2 gate.**
  - [ ] 👤 panel web kabinetdagi kod orqali ulanadi (M2)
  - [ ] internet uzilib qaytganda avtomatik qayta ulanadi: `WAITING_AGENT` → davom (M2)
  - [ ] qo'lda yozilgan `plan.json` dan 3 sahnali video quriladi (M3)
  - [ ] 👤 o'rtada AE yopilib qayta ochilsa, dublikatsiz davom etadi (M3)
  - [ ] `report.md` hosil bo'ladi

---

## 5. Faza 3 — Claude loop'i, audio'siz MVP (M4 + M6)

**Maqsad:** Claude (web/desktop/telefon) custom connector orqali butun loopni boshqaradi.

- [ ] **P3.01 — OAuth 2.1 server (§4.1).** `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, dynamic client registration, `/oauth/authorize` (kabinet sessiyasi + ruxsat ekrani), `/oauth/token` (PKCE S256 majburiy, refresh rotation), revoke. `/mcp` 401 qaytarganda `WWW-Authenticate` + resource metadata beriladi. MCP authorization spec'ning joriy talablari (DCR / Client ID Metadata Document) va Claude callback URL'lari rasmiy hujjatdan tekshiriladi.
  - Tayyor: test klient bilan to'liq DCR + PKCE oqimi o'tadi.
- [ ] **P3.02 — `/mcp` (Streamable HTTP).** `@modelcontextprotocol/sdk`, token → `user_id`, user bo'yicha rate limit, yagona javob formati, zod'dan JSON Schema `inputSchema`, MCP `instructions` (Claude uchun loop qoidalari).
  - Tayyor: MCP Inspector bilan ulanib, tool chaqirib bo'ladi.
- [ ] **P3.03 — Muhit va loyiha toollari.** `env_check`, `devices_list`, `ae_info` (versiya, ochiq loyiha, comp'lar, shriftlar; ❓ `app.fonts` eski AE'da yo'q, Q10), `project_create`, `project_list`, `project_get`, `plan_write` (`SPEC_INVALID` aniq path bilan), `plan_patch` (JSON Patch → yangi versiya), `plan_get`.
- [ ] **P3.04 — Fayl toollari.** `assets_scan` (asinxron), `assets_list`, `asset_preview`: `asset.preview.request` → panel ffmpeg → Claude'ga **image content** sifatida qaytadi (token tejash uchun kichraytiriladi).
- [ ] **P3.05 — Qurish toollari.** `preflight` (`missing[]` + oplist xulosasi), `build_start` (+ `dry_run`: AE'ga tegmasdan oplist + vaqt bahosi, §11.4.2), `job_status` (holat, %, oxirgi N log), `job_resume`, `job_cancel`, `job_list`.
- [ ] **P3.06 — VERIFY: kadrlar va patch sikli.** `frames.capture` op (`saveFrameToPng` hujjatlashtirilmagan va asinxron, shuning uchun fayl paydo bo'lishini kutish kerak), `frames_capture` tool (rasmlar Claude'ga), `verify_approve`, `verify_patch`. Patch oldidan `.aep` ning yangi versiyasi saqlanadi. ❓ Patch strategiyasi (Q4): o'zgargan sahna comp'i yangi versiya sifatida qayta nest qilinadi, shunda hech narsa o'chirilmaydi va op to'plami yopiq qoladi. Maksimal 3 patch; undan keyin `LOOP_PATCH_LIMIT` → `ask_user`.
  - Tayyor: 3 ta patch o'tadi, 4-chisi `LOOP_PATCH_LIMIT` qaytaradi.
- [ ] **P3.07 — RENDER.** `render.queue` op. ❓ `aerender` (AE UI bloklanmaydi, tavsiya) yoki Render Queue (Q5). Presetlar (`h264_social` …), `render_start`, `render_presets`. Gate: fayl mavjud va ffprobe davomiyligi spec'ga teng (±1 kadr), aks holda `RENDER_DURATION_MISMATCH`. `renders` jadvali.
- [ ] **P3.08 — To'liq REPORT va Tarix ekrani.** `report_get` (chatda markdown); panel Tarix ekrani (joblar, hisobotni ochish, qayta render); 🟢 Claude indikatori.
- [ ] **P3.09 — MCP prompt `/new-reel`.** Hozircha audio'siz versiya; Faza 4 da yangilanadi.
- [ ] **P3.10 — Xavfsizlik.** Rate limit, server tomonida path traversal, token revoke (kabinetda "ulangan ilovalar"), presigned URL muddatlari, audit eventlar.
- [ ] **P3.11 — Claude'ga ulash.** 👤 Settings → Connectors → Add custom connector → `https://<app>.up.railway.app/mcp`; web, desktop va telefondan tekshiriladi.
- [ ] **P3.12 — 🧪 Faza 3 gate.**
  - [ ] 👤 Claude'da custom connector ulanadi (M4)
  - [ ] chatda brief + rasmlar → video quriladi → hisobot chatda chiqadi (M4)
  - [ ] Claude kadrlarni ko'rib, ataylab qilingan xatoni patch qiladi (M6)
  - [ ] `/out` da mp4 chiqadi, davomiyligi spec'ga mos (M6)

---

## 6. Faza 4 — ElevenLabs to'liq (M5)

**Maqsad:** §7 dagi barcha imkoniyatlar yagona `audio_task` modeli orqali ishlaydi va loopga to'liq ulanadi. Endpoint va parametrlar rasmiy API reference'dan tekshiriladi.

- [ ] **P4.01 — Kalit va xavfsizlik.** 👤 ElevenLabs API kaliti. Kabinetda kiritiladi → `secrets` (AES-256-GCM, `MASTER_KEY`), `GET /v1/user/subscription` bilan tekshiriladi. Kalit hech qachon qaytarilmaydi (faqat `…abcd` ko'rinadi). CHECK ga ElevenLabs + kvota qo'shiladi; 🟢 ElevenLabs indikatori.
- [ ] **P4.02 — `eleven/` klient qatlami.** `@elevenlabs/elevenlabs-js`, har imkoniyat alohida faylda. Xato xaritasi: 401 → `EL_AUTH`, 402/kvota → `EL_QUOTA`, 429 → `EL_RATE_LIMIT`, timeout → `EL_TIMEOUT`, 4xx → `EL_BAD_PARAMS`. 429/5xx da 3 marta exponential backoff; user bo'yicha rate limit.
- [ ] **P4.03 — `audio_task` va worker.** `apps/worker` (BullMQ) Railway'da. Oqim: `kind + params → params_hash → eleven_cache → navbat → storage (audio-out) → audio.ready → file.download → panel /audio (sha256) → file.saved`. Asinxron endpointlar poll qilinadi (timeout 30 daqiqa); `audio_tasks_status` tool.
- [ ] **P4.04 — Panel: audio ajratish.** `audio.extract.request` → ffmpeg (mono/opus siqish) → resumable multipart upload (`audio-in`).
- [ ] **P4.05 — TTS, ovozlar, narx.** `el_tts` (`/with-timestamps` orqali so'z vaqtlari), `el_voices`, `el_models`, `el_pronunciation`, `el_usage`, `el_estimate` (belgilar/sekundlar → kredit; kvotadan oshsa `ask_user`). `dry_run` ga kredit bahosi qo'shiladi.
- [ ] **P4.06 — Generatsiya.** `el_dialogue`, `el_sfx`, `el_music`, `el_music_plan` (composition plan, aniq davomiylik, instrumental, bo'limlar).
- [ ] **P4.07 — Tahlil.** `el_stt` (Scribe: so'z timestamp, diarization, audio eventlar), `el_align`, `el_isolate`, `transcript_get` / `transcript_edit`.
- [ ] **P4.08 — Ovozni o'zgartirish.** `el_voice_change`, `el_dub` (yaratish → status poll → natija), `el_voice_design` (+ create), `el_voice_clone` (`consent: true` bo'lmasa rad etiladi).
- [ ] **P4.09 — AUDIO holati.** Spec `audio` → vazifalar ro'yxati → `el_estimate` gate → bajarish. Har vazifa `done` yoki `skipped(sabab)` bilan tugaydi.
- [ ] **P4.10 — TTS-first timing (PREFLIGHT).** Gap chegaralari timestamps'dan olinadi; `dur: "vo:a-b"` soniyaga aylanadi; `duration: "auto"`; musiqa `length: "match_video"`; SFX `at: "s1.end"` langarlari.
- [ ] **P4.11 — Audio oplar.** `captions.build` (so'zlar → matn layerlari; stillar: karaoke_bold, bold_pop, minimal), `audio.duck` (ovoz segmentlari ostida musiqa `amount_db` ga pasayadi), ikkalasi compiler'ga ulanadi.
- [ ] **P4.12 — Panel Audio ekrani.** Generatsiya qilingan fayllar, eshitish, qayta generatsiya.
- [ ] **P4.13 — MCP promptlar.** `/subtitle-video`, `/dub-video`; `/new-reel` audio bilan yangilanadi.
- [ ] **P4.14 — 🧪 O'zbek tili testi (majburiy, §7.1).** STT namuna matn bilan solishtiriladi. TTS uchun qaysi modellar o'zbekchani qo'llashi rasmiy hujjatdan tekshiriladi (Q7). Brend so'zlar uchun pronunciation dictionary tuziladi. Natijalar `docs/uz-quality.md` ga yoziladi.
- [ ] **P4.15 — 🧪 Faza 4 gate.**
  - [ ] voiceover + karaoke subtitr + generatsiya qilingan musiqa (ducking bilan) + SFX bilan video (M5)
  - [ ] mavjud video uchun isolate + transcribe + subtitr ishlaydi (M5)
  - [ ] kesh: qayta ishga tushirishda kredit sarflanmaydi
  - [ ] kvota oshsa `ask_user` qaytadi

---

## 7. Faza 5 — Shablonlar, brand kit, qadoqlash (M7 + M8)

**Maqsad:** qayta ishlatiladigan dizayn tizimi va tayyor mahsulot sifatida yetkazib berish.

- [ ] **P5.01 — Shablon tizimi (§11.2).** `templates/<slug>/` (`template.aep` + `template.json` + `preview.gif`), `templates` jadvali, `template.instantiate` op. Slotlar: text → layer nomi, media → placeholder `fit`, color → Essential Graphics; `duration.stretch: time_remap`. Compiler'da `scene.template` → op.
- [ ] **P5.02 — Shablon toollari va prompt.** `templates_list`, `template_get`, `template_apply`, `template_save` (joriy comp'dan yangi shablon); MCP prompt `/from-template`.
- [ ] **P5.03 — Boshlang'ich kutubxona.** hook_title, lower_third, cta_outro, product_showcase, testimonial, top3_list; subtitr stillari (karaoke, bold pop, minimal); transitionlar (`.ffx` yoki op asosida). Imkon qadar qayta yaratsa bo'ladigan "template builder" jsx skriptlari bilan; `preview.gif` = aerender + ffmpeg. 👤 dizaynni ko'rib chiqish.
  - Tayyor: kamida 5 ta shablon (M7), har biri manifestdagi formatlarda sinalgan.
- [ ] **P5.04 — Brand kit (§11.3).** `brands/` + `brands` jadvali, `brands_list`, `brand_save`. Compiler qo'llaydi: ranglar, shriftlar (+ fallback; PREFLIGHT'da `AE_FONT_MISSING`), logo, subtitr stili, default ovoz va musiqa uslubi.
- [ ] **P5.05 — Format variantlari (§11.4.1).** Bitta Spec'dan 9:16 / 1:1 / 16:9: formatga nisbiy joylashuv, safe area, media `fit`, har variant alohida render qilinadi.
- [ ] **P5.06 — Panel Shablonlar ekrani (Claude'siz rejim).** Galereya (preview gif), slotlarni qo'lda to'ldirish, job REST orqali ishga tushadi.
- [ ] **P5.07 — Batch (§11.4.3).** Shablon + CSV → N ta video (ustun ↔ slot, har qator uchun progress va hisobot).
- [ ] **P5.08 — Telegram xabarnoma.** 👤 BotFather token. Kabinetdan bog'lash kodi olinadi; render tugaganda yoki job BLOCKED bo'lganda xabar keladi.
- [ ] **P5.09 — Web kabinet to'liq.** Job tarixi va hisobotlar, qurilmalar, ulangan ilovalar (Claude tokenlari), ElevenLabs kaliti, Telegram.
- [ ] **P5.10 — Panel production build.** ffmpeg/ffprobe ZXP ichida (Windows + macOS; ❓ LGPL build, Q9; 👤 macOS sinovi uchun Mac kerak), `pnpm build && pnpm zxp`, ❓ 👤 imzolash sertifikati (Q8), versiyalash.
- [ ] **P5.11 — Installer va birinchi ishga tushirish.** ZXP Installer / `UnifiedPluginInstallerAgent --install`; panelda birinchi ishga tushirish ustasi (ulanish → papka → env check).
- [ ] **P5.12 — Hujjatlar (`docs/`).** Foydalanuvchi qo'llanmasi (o'rnatish, Claude'ga ulash, birinchi video); dasturchi qo'llanmasi (yangi op yoki yangi EL imkoniyat qo'shish, deploy); MCP tool ma'lumotnomasi (zod'dan generatsiya qilinadi); xato kodlari va yechimlari.
- [ ] **P5.13 — Production tayyorgarlik.** Railway healthcheck/restart, DB backup, loglarni saqlash muddati, xavfsizlik ko'rigi, e2e regressiya to'plami (compiler snapshot + soxta agent bilan server integratsiyasi).
- [ ] **P5.14 — 🧪 Faza 5 gate (yakuniy).**
  - [ ] bitta Spec'dan 9:16 va 16:9 (va 1:1) variantlar brand kit bilan chiqadi (M7)
  - [ ] shablon + CSV (3 qator) → 3 ta video + Telegram xabar
  - [ ] 👤 toza kompyuterga 10 daqiqada o'rnatilib, birinchi video chiqadi (M8)
  - [ ] to'liq regressiya o'tadi

---

## 8. Qamrov jadvali (asl rejadagi hech narsa tushib qolmasligi uchun)

| Element | F1 | F2 | F3 | F4 | F5 |
|---|---|---|---|---|---|
| Oplar (18, §10.1) | `item.import` `comp.create` `layer.add_media` `layer.add_text` | `project.*` `comp.nest` `layer.add_shape` `layer.add_audio` `prop.*` `fx.*` | `frames.capture` `render.queue` | `captions.build` `audio.duck` | `template.instantiate` |
| MCP toollar (50, §8) | — | — | muhit, loyiha, plan, fayllar, qurish, verify, render, `report_get` (24) | `el_*` (17) + `audio_tasks_status` + `transcript_*` (20) | `template*` + `brand*` (6) |
| MCP promptlar | — | — | `/new-reel` | `/subtitle-video` `/dub-video` | `/from-template` |
| Holatlar (§3) | — | hammasi (AUDIO = skip, VERIFY = qo'lda) | VERIFY (Claude), RENDER | AUDIO | — |
| WS xabarlari (19, §10.2) | `hello(_ack)` `ping/pong` `op.*` `log` | `ops.batch` `file.*` `asset.scanned` `job.pause/cancel` `ae.state` | `asset.preview.request` | `audio.extract.request` | — |
| Panel ekranlari (7, §11.1) | Live (oddiy) | Ulanish, Ish papkasi, Live, Sozlamalar | Tarix | Audio | Shablonlar |
| Auth (§4) | dev token | kabinet login, device flow | OAuth 2.1 (DCR + PKCE) | — | — |
| Web kabinet (§4.3) | — | login, device tasdiq, qurilmalar | OAuth ruxsat, ulangan ilovalar | ElevenLabs kaliti | tarix, hisobotlar, Telegram |
| Xavfsizlik (§4.4) | path traversal (panel) | presigned, path traversal (shared) | MCP rate limit, revoke | AES-256-GCM, EL rate limit | xavfsizlik ko'rigi |
| Qo'shimchalar (§11.4) | — | expression kutubxonasi | dry-run | dry-run kredit bahosi | variantlar, batch, Telegram, kabinet tarixi |
| DB (§5, 17 jadval) | sxema + migratsiya | users, devices, projects, plans, assets, jobs, job_events, ops, reports | oauth_*, renders | secrets, audio_tasks, eleven_cache | templates, brands |

---

## 9. ❓ Hal qilinishi kerak bo'lgan qarorlar (rejani tahlil qilishda topildi)

| # | Masala | Tavsiya | Qachon |
|---|---|---|---|
| Q1 | Brauzer `WebSocket` `Authorization` header qo'ya olmaydi (§4.2 bilan §13 ziddiyati) | CEP Node'da sof-JS `ws` paketi | P2.05 |
| Q2 | Web login usuli | Email magic link (Resend), eng soddasi | P2.01 |
| Q3 | Storage | Cloudflare R2 (egress bepul) yoki Railway bucket | P2.06 |
| Q4 | Yopiq op to'plamida o'chirish opi yo'q, patch qanday qilinadi? | O'zgargan sahna comp'ini yangi versiya qilib qayta nest qilish | P3.06 |
| Q5 | Render usuli | `aerender` (UI bloklanmaydi); Render Queue zaxira sifatida | P3.07 |
| Q6 | zod v3 yoki v4 | MCP SDK qaysi birini qo'llasa | P1.04 |
| Q7 | O'zbek TTS qaysi modelda ishlaydi | Rasmiy hujjat + amaliy test | P4.14 |
| Q8 | ZXP imzolash sertifikati | Self-signed (shaxsiy tarqatish uchun yetarli) | P5.10 |
| Q9 | ffmpeg'ni tarqatish litsenziyasi | LGPL build | P5.10 |
| Q10 | Shriftlar API (`app.fonts`) eski AE versiyalarida yo'q | Versiya tekshiruvi + fallback | P3.03 |

---

## 10. 👤 Sizdan kerak bo'ladigan narsalar (oldindan ro'yxat)

| Qachon | Nima |
|---|---|
| P1.01 | After Effects o'rnatish (Creative Cloud); Node/pnpm/ffmpeg o'rnatishga ruxsat; git `user.email` |
| P1.08 | Railway'da servislar yaratishga tasdiq (CLI'da login bor) |
| P2.01 | Login usuli + Resend API kaliti yoki Google OAuth client |
| P2.06 | R2 bucket va kalitlar (yoki Railway bucket) |
| P3.11 | Claude'da custom connector qo'shish |
| P4.01 | ElevenLabs API kaliti (yetarli kvotali tarif) |
| P5.08 | Telegram bot tokeni |
| P5.10 | ZXP sertifikati qarori; macOS sinovi uchun Mac |
| Har gate | AE'da qo'lda tekshiruv (panel, vizual natija) |
