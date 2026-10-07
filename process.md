# AE Studio — Jarayon jurnali

> **Compact yoki yangi sessiyadan keyin avval shu faylni o'qing:** "Joriy holat" → oxirgi 3 hisobot → [ae-studio-phases.md](ae-studio-phases.md) dagi birinchi `[ ]` todo.
> Talab (2026-10-05): har todo bajarilganda shu faylga hisobot yoziladi, shunda compact paytida kontekst yo'qolmaydi.
> Reja: [ae-studio-phases.md](ae-studio-phases.md) (5 faza, 69 todo) · Asl reja: [ae-studio-plan.md](ae-studio-plan.md)

---

## Joriy holat

<!-- Har todo'dan keyin shu blok USTIGA YOZILADI. Tarix pastdagi hisobotlarda saqlanadi. -->

- **Faza:** Barcha 5 faza — kod qismi tugadi; production'da (2026-10-07)
- **Oxirgi bajarilgan:** Tuzatish: jsx ichma-ich ternar (522-qator) + ExtendScript skani + yangi ZXP (2026-10-08)
- **Keyingi todo:** 👤 qo'lda sinovlar va kalitlar (pastdagi Blokerlar)
- **Blokerlar:** 👤 Claude'da custom connector (docs/claude-connector.md) · 👤 ElevenLabs kaliti (kabinet → Sozlamalar) + P4.14 real o'lchov · 👤 Telegram token chatda ochiq: keyin /revoke + yangisi · 👤 AE kompyuterida: ZXP o'rnatish (apps/panel/release), Live/Undo, saveFrameToPng, aerender, .aep shablon, app.fonts · 👤 Mac: macOS ZXP · 👤 toza kompyuterda 10 daqiqalik o'rnatish (M8)
- **Ochiq qarorlar:** Q3 (provayder tanlovi), Q4, Q5, Q7 (real o'lchov 👤), Q10. Yopilgan: Q1, Q2, Q6, Q8 (self-signed), Q9 (LGPL)
- **Muhit (2026-10-05):** Windows 10 Pro 19045 · Node v24.21.0 · npm 11.19 · pnpm 12.9.1 (corepack 0.36) · ffmpeg/ffprobe n8.1.3 LGPL · git 2.56 · Railway CLI 5.63.1 (login bor) · Python 3.9 · After Effects bu kompyuterda YO'Q (👤 boshqa kompyuterda sinaladi)
- **Bash tool eslatmasi:** shu sessiyada PATH yangilanmagan, har buyruq oldidan: `export PATH="/c/Users/991106847/AppData/Local/Programs/nodejs:/c/Users/991106847/AppData/Local/Programs/ffmpeg/bin:$PATH"`
- **Muhim yo'llar / URL'lar:** Node `%LOCALAPPDATA%\Programs\nodejs` · ffmpeg `%LOCALAPPDATA%\Programs\ffmpeg\bin` · Railway: https://server-production-9c75.up.railway.app (loyiha ae-studio, servislar server/Postgres/Redis, volume /data)

---

## Qarorlar jurnali

<!-- Faqat qo'shiladi. Rejadan chetga chiqilganda yoki ❓ savol yopilganda yoziladi. -->

| Sana | Todo | Qaror | Sabab |
|---|---|---|---|
| 2026-10-05 | P0.02 | 9 milestone (M0–M8) 5 fazaga birlashtirildi | Foydalanuvchi talabi |
| 2026-10-05 | P0.02 | M6 (Verify + Render) M5 (ElevenLabs) dan oldinga olindi | Verify/Render audio'ga bog'liq emas; M5 gate'i render talab qiladi; Faza 3 da butun loop yopiladi |
| 2026-10-05 | P0.02 | Maxsus oplar o'zidan foydalanadigan qism bilan birga quriladi (frames/render → F3, captions/duck → F4, template → F5) | M3 dagi "barcha oplar"ni o'z fazasidan oldin gate bilan sinab bo'lmaydi |
| 2026-10-05 | P0.02 | Node 20+ o'rniga Node 24 LTS | Node 20 2026-04 da EOL bo'lgan |
| 2026-10-05 | P0.02 | §14 dagi `yarn` o'rniga `pnpm` | Monorepo pnpm'da |
| 2026-10-05 | P1.01 | After Effects bu kompyuterga o'rnatilmaydi; plagin boshqa kompyuterda sinaladi. Bu yerda kod darajasidagi tekshiruv yetarli: typecheck, testlar, ES3 build validatsiyasi, mock-AE testlari | Foydalanuvchi qarori |
| 2026-10-05 | P1.01 | Har todo'dan keyin git commit va push | Foydalanuvchi ruxsati |
| 2026-10-05 | P1.01 | ffmpeg uchun BtbN LGPL build | Q9 bilan mos (tarqatishda ham LGPL) |
| 2026-10-05 | P1.02 | TypeScript 6.0.3 (7.x emas) | typescript-eslint 8.71 faqat `<6.1.0` ni qo'llaydi |
| 2026-10-05 | P1.02 | **Q6 yopildi: zod v4** | MCP SDK 1.32 peer: `zod ^3.25 \|\| ^4.0` |
| 2026-10-05 | P1.02 | Ichki paketlar TS manbasi sifatida eksport qilinadi (build'siz), importlar kengaytmasiz (`moduleResolution: Bundler`); server prod uchun esbuild bundle | Oddiy, jsx rollup ham resolve qiladi |
| 2026-10-05 | P1.02 | ExtendScript (jsx) `shared` dan faqat zod'siz, ES3-xavfsiz fayllarni import qiladi (`errors`, `result`, `ae`) | jsx typecheck `noLib` + types-for-adobe (ES3); zod jsx bundle'ga tushmasligi kerak |
| 2026-10-05 | P1.03 | §12 ga qo'shimcha kodlar: AUTH_INVALID, ASSET_OUTSIDE_ROOT, AE_UNKNOWN_OP, AE_BAD_PARAMS, AE_NOT_FOUND, SYS_INTERNAL/BAD_REQUEST/NOT_FOUND/RATE_LIMIT | §12 da faqat misollar bor; Faza 1 oplari va server uchun kerak |
| 2026-10-05 | P1.04 | `vo:a-b` = voiceover gap chegaralari [a, b), 0 dan; ketma-ket vo: sahnalari uzluksiz bo'lishi shart | §9 namunasi (s1 vo:0-1, s2 vo:1-3) faqat shu talqinda mos keladi |
| 2026-10-05 | P1.04 | anim/pos/transition/output preset — yopiq enumlar; pos qo'shimcha nisbiy {x,y} (0–1) | Claude to'qib chiqargan nom PLAN'da aniq xato bilan to'xtaydi; variantlar uchun nisbiy koordinata |
| 2026-10-05 | P1.04 | §9 kengaytmalari: voiceover kind tts/dialogue/asset, music kind music/asset, sfx prompt yoki asset, layer turlari media/text/shape/audio (+ id/start/dur) | §7 imkoniyatlari (dialogue, tayyor audio) va §10 oplari (shape/audio) Spec'dan ifodalanishi uchun |
| 2026-10-05 | P1.04 | Zod xabarlari o'zbekcha (`z.locales.uz`, faqat parse vaqtida, global config emas); details path'lari JSON Pointer | Foydalanuvchi o'zbek; Claude path'ni to'g'ridan-to'g'ri plan_patch'da ishlatadi |
| 2026-10-05 | P1.05 | Op parametrlari past darajali: koordinata/o'lcham piksel ([x,y]); havolalar (comp/item/layer/parent/child) — elementni yaratgan opning op_id si | Oplar deterministik va sodda bo'ladi; preset/nisbiy hisob compiler'da; resume/patch op_id izi orqali |
| 2026-10-05 | P1.05 | WS'ga qo'shildi: job.update, job.event (server→panel, Live ekrani), request.failed (panel→server) | §10.2 ro'yxatida Live log va so'rov xatosi uchun xabar yo'q edi |
| 2026-10-05 | P1.05 | `ping` — tizim opi (Spec'dan chiqmaydi), 18 ta yopiq op to'plamiga qo'shilmaydi | Diagnostika (AE versiyasi, loyiha yo'li) uchun |
| 2026-10-05 | P1.06 | Server deploy: Railpack + `apps/server/railway.json` (config-as-code, preDeploy migratsiya); bundle esbuild, npm bog'liqliklar tashqi | Monorepo workspace paketlari (TS manba) bundle ichiga olinadi; Dockerfile'siz eng sodda yo'l |
| 2026-10-05 | P1.06 | Server javoblari (404/500 ham) §8 Result formatida | Claude/panel/web uchun yagona xato shakli |
| 2026-10-05 | P1.07 | Lokal dev/test DB: PGlite (WASM Postgres 18); dev server uchun pglite-socket (Docker'siz) | Bu kompyuterda Docker/Postgres yo'q; haqiqiy drayver (postgres.js) ham sinaladi |
| 2026-10-05 | P1.07 | §5 ga qo'shimcha ustunlar: oauth_clients.client_name, oauth_tokens.{device_id,scope,data}, assets.{status,timestamps}, jobs.outcome, ops.result, timestamps | DCR rozilik ekrani, device flow holati, INGEST buzuq fayllari, job yakuni, op natijasi (comp id) uchun kerak |
| 2026-10-05 | P1.09 | Panel toolchain Bolt CEP 2.2.3 da sinalgan versiyalarda: Vite 6, plugin-react 4, Babel 7 (monorepo qolgan qismi Vite 8/TS 6) | vite-cep-plugin Vite ≤7 ni qo'llaydi; ES3 pipeline Babel 7 bilan sinalgan |
| 2026-10-05 | P1.09 | Agent (Node) alohida esbuild bundle (dist/cep/agent/agent.cjs), UI uni CEP Node require bilan yuklaydi; CSInterface vendor qilinmaydi | `ws` va Node API brauzer bundle'iga aralashmaydi; agent Node'da test qilinadi |
| 2026-10-05 | P1.09 | vitest maxWorkers: 1 | Dev kompyuterda xotira kam, parallel worker'lar crash beradi |
| 2026-10-05 | P1.13 | **Q1 yopildi:** panel WS — CEP Node'dagi sof-JS `ws` paketi, `Authorization: Bearer` header bilan (agent.cjs ichiga bundle qilinadi) | Brauzer WebSocket header qo'ya olmaydi; e2e test va bundle sinovidan o'tdi |
| 2026-10-05 | P2.01 | Faza 1 gate'i (AE va Railway bandlari) ochiq qolgan holda Faza 2 boshlandi | Foydalanuvchi: 'test qilib ko'rishni imkoni bo'lmadi, qolgan ishlarni davom ettiraver' |
| 2026-10-05 | P2.01 | **Q2 yopildi:** web login — email magic link; xatlar Resend API orqali (`RESEND_API_KEY`), kalit bo'lmasa dev rejimda havola logga chiqadi | Eng sodda, Google OAuth client shart emas |
| 2026-10-05 | P2.01 | Sessiyalar JWT emas, DB'dagi opaque token (sha256 hash, cookie) | Darhol bekor qilish mumkin, kalit boshqaruvi yo'q; JWT_SIGNING_KEY hozircha ishlatilmaydi |
| 2026-10-05 | P2.02 | DB oqimlari testlarida production drayveri ham sinaladi: `createWireTestDb()` (PGlite socket + postgres.js) | PGlite drayveri postgres.js xatolarini (Date param) yashirgani aniqlandi |
| 2026-10-05 | P2.05 | Dev token rejimi (DEV_AGENT_TOKEN, /dev/op) olib tashlandi; o'rniga sessiya bilan himoyalangan POST /api/devices/:id/ops | Rejada 'dev token o'chiriladi'; diagnostika uchun egasi o'z qurilmasiga op yubora oladi |
| 2026-10-05 | P2.06 | Storage: S3-mos interfeys (R2/Railway bucket — env bilan) + lokal drayver (HMAC imzoli /storage/*) dev/test uchun | Q3 kodga ta'sir qilmaydi; bulutsiz to'liq upload/download e2e testlari |
| 2026-10-05 | P2.08 | WS'ga `assets.scan` (server → panel) qo'shildi | §10.2 da INGEST'ni boshlovchi xabar yo'q edi; natija `asset.scanned` bilan keladi |
| 2026-10-05 | P2.08 | LGPL ffmpeg'da libx264 yo'q; H.264 uchun libopenh264 yoki h264_mf (Windows) bor | P3.07 render: AE o'z H.264 chiqishi yoki ffmpeg+openh264 |
| 2026-10-05 | P2.10 | Build versiya fayliga (`<nom>_vNNN.aep`) yoziladi, har sahnadan keyin saqlanadi; patch'da avval yangi versiya | Resume'da saqlangan joydan davom etadi; ustiga yozish yo'q (§2.10) |
| 2026-10-05 | P2.10 | Matn layerlari hozircha nuqtali matn (`max_width` qutisi keyinroq) | AE box text o'lchami va joylashuvi vizual tekshiruvsiz xavfli; VERIFY (Faza 3) bilan sozlanadi |
| 2026-10-05 | P1.08 | Migratsiya Railway preDeploy o'rniga root `start` skriptida (migrate && index); railway.json repo ildizida | Railpack railway.json deploy buyruqlarini qo'llamadi; migratsiya idempotent |
| 2026-10-05 | P1.08 | S3 berilguncha storage Railway volume'da (/data/storage) | Qayta deployda fayllar o'chmasligi uchun |
| 2026-10-05 | P2.11 | BUILD resume: uzilish/retry'dan keyin oxirgi bajarilgan project.save dan keyingi oplardan + loyihani ochish opi qayta (oxirgi done opdan emas) | AE yopilgan bo'lsa saqlanmagan oplar yo'qolgan; oplar idempotent — dublikat yo'q |
| 2026-10-05 | P2.11 | Har job o'tishi compare-and-set (WHERE state=eski); pause jobs.paused ustunida | Amallar ishlab turgan handler bilan poygasiz; server restartda pauza saqlanadi |
| 2026-10-05 | P2.11 | WAITING_AGENT dan qaytish panel hello xabarida (presence emas) | hello kelganda panel ish papkasi ma'lum bo'ladi (CHECK uchun) |
| 2026-10-05 | P2.11 | Yangi xato kodlari JOB_ACTIVE, JOB_BAD_ACTION (JOB_ prefiksi) | Bitta qurilmada bitta aktiv job va holatga mos bo'lmagan amal uchun |
| 2026-10-05 | P2.12 | Undo last = tizim opi undo: AE Edit menyusida aynan 'Undo aes:<op_id>' bo'lsagina bajariladi; faqat BUILD pauzasida | Har op o'z undo group'ida; orada qo'lda qilingan amal tasodifan bekor qilinmaydi |
| 2026-10-05 | P2.12 | job.update ga paused/outcome/error qo'shildi; panel tarixni HTTP (/api/agent/jobs/:id/events) bilan oladi | Live ekrani qayta ulanganda to'liq holatni ko'rsatishi uchun |
| 2026-10-05 | P2.13 | Lokal hisobot nusxasi .aestudio/report.vNNN.md (aep versiyasi bo'yicha), yagona report.md emas | Hech bir fayl ustiga yozilmaydi (§2.10) |
| 2026-10-05 | P2.13 | file.download default'da mavjud faylni boshqa tarkib bilan almashtirmaydi (overwrite flag'i); plan/report storage'da docs/<sha256> | Versiyalar himoyasi panel tomonida ham; content-addressed — takroriy yuklash yo'q |
| 2026-10-05 | P2.14 | Faza 2 gate'ining kod va prod qismi production smoke testi (prod.smoke.test.ts, mock AE) bilan yopildi; haqiqiy AE bandlari 👤 qoldi | Bu kompyuterda AE yo'q (foydalanuvchi qarori) |
| 2026-10-05 | P3.01 | OAuth: DCR + CIMD ikkalasi; opaque tokenlar (access 1 soat, refresh 30 kun, rotation + reuse'da oila bekor); ruxsat ekrani server HTML | MCP spec 2025-11-25 (CIMD SHOULD, DCR MAY) va Claude hujjati (ikkalasini ham qo'llaydi) |
| 2026-10-05 | P3.02 | /mcp stateless (har so'rovga yangi Server, JSON javob), low-level SDK Server + zod v4 toJSONSchema; tool tavsiflari ingliz tilida, xato hint'lari o'zbekcha | Railway bitta nusxa, sessiya holati kerak emas; tavsiflar model uchun aniqroq |
| 2026-10-05 | P3.03 | Q10 yopildi: ae_info shriftlarni app.fonts (AE 24+) dan oladi, yo'q bo'lsa fonts=null + izoh | Eski AE'da API yo'q, xato emas |
| 2026-10-05 | P3.03 | project_create faqat mavjud papkani ochadi (subpapkalarni yaratadi), ildiz papkani yaratmaydi | Claude xato yo'l bilan foydalanuvchi diskida keraksiz papka yaratmasligi uchun |
| 2026-10-05 | P3.06 | Q4 yopildi: patch — yangi plan versiyasi + yangi .aep vNNN da to'liq qayta qurish (joyida tahrir emas) | Yopiq op to'plamida o'chirish yo'q; eski fayl saqlanadi; nest dublikati xavfi yo'q |
| 2026-10-05 | P3.07 | Q5 yopildi: aerender asosiy, Render Queue zaxira; AE oraliq fayl → panel ffmpeg (preset) → out/<nom>_vNNN.mp4, ustiga yozmaslik (_2…) | Output module shablonlari AE versiyalari orasida farq qiladi; ffmpeg preset'ni bir xil qiladi; LGPL build'da libx264 yo'q → encoder avtomatik tanlanadi |
| 2026-10-05 | P3.10 | §5 ga audit_log jadvali; MCP audit faqat o'zgartiruvchi (readOnlyHint bo'lmagan) toollar | Xavfsizlik hodisalari kuzatilsin, o'qish chaqiruvlari jurnalni to'ldirmasin |
| 2026-10-05 | P3.12 | Faza 3 gate'i skriptlangan Claude (faqat MCP toollari) bilan lokal va production'da yopildi; haqiqiy Claude UI va AE bandlari 👤 | Bu kompyuterda AE yo'q, Claude connector login'i uchun RESEND kaliti kerak |
| 2026-10-05 | P4.01 | ElevenLabs uchun SDK o'rniga yupqa fetch klient | Aniq nazorat (retry, timeout, xato xaritasi), soxta API bilan to'liq test, bog'liqlik kam |
| 2026-10-05 | P4.01 | Q7 yopildi: o'zbekcha TTS — eleven_v4 (default), STT — scribe_v2 | Rasmiy models sahifasi: uzb faqat v4/v4_turbo; Scribe 'Good' tier |
| 2026-10-05 | P4.03 | BullMQ worker o'rniga server ichidagi Postgres asosidagi navbat (recover bilan) | Railway bitta nusxa, Postgres yagona haqiqat manbai, Redis'siz test; keyin kerak bo'lsa alohida worker'ga ajratiladi |
| 2026-10-05 | P4.03 | ElevenLabs natijalari storage'da (audio-out/<sha256>), panelga file.download bilan audio/<kind>_<sha12>.<ext> ga yetkaziladi | Foydalanuvchi talabi: EL fayllari serverda saqlanadi, panelga olib kelinadi; tarkibga bog'liq nom — ustiga yozmaslik |
| 2026-10-05 | P4.04 | audio-in yuklash: resumable multipart o'rniga bitta pre-signed PUT + 3 urinish (oldin mono Opus 32k ga siqiladi) | ~15 MB/soat; S3 bitta PUT 5 GB gacha; soddaroq va lokal storage bilan ham ishlaydi |
| 2026-10-05 | P4.05 | Default TTS modeli eleven_v4; talaffuz lug'atlari pronunciation_dicts jadvalida (slug) | O'zbekcha faqat v4 da; spec slug bilan murojaat qiladi |
| 2026-10-05 | P4.08 | el_voice_clone: consent literal true (zod) + audit | §7.1: faqat egasining roziligi bilan |
| 2026-10-05 | P4.09 | AUDIO: SFX xatosi skipped (job davom etadi), voiceover/musiqa/manba xatosi BLOCKED; patch AUDIO'dan qayta boshlanadi | §7.1 'done yoki skipped(sabab)'; asosiy ovozsiz video ma'nosiz |
| 2026-10-05 | P4.10 | vo:a-b = B[b]-B[a], B[k] = k-gap boshlanishi (pauza oldingi sahnaga), oxiriga 0.3 s | Sahna almashuvi gap boshlanishiga to'g'ri keladi, oxirgi so'z kesilmaydi |
| 2026-10-05 | P4.11 | karaoke = so'zlar navbat bilan paydo bo'ladi (Source Text hold keyframe'lari), rangli so'z ajratish emas | ES3/AE 22 da belgi diapazoni uslublari yo'q; ishonchli va AE versiyalarida bir xil |
| 2026-10-05 | P4.15 | Kvota gate'i keshlangan vazifalarni ham baholashga qo'shadi | oddiy va xavfsiz: kam qoldiqda foydalanuvchidan so'raladi; keyin optimallashtirish mumkin |
| 2026-10-05 | P5.01 | Shablon ikki xil: aep (template.instantiate) va recipe (compiler layerlarga yoyadi) | .aep dizayn faylini bu yerda yaratib bo'lmaydi — boshlang'ich kutubxona qayta yaratsa bo'ladigan recipe; aep yo'li template_save va dizaynerlar uchun |
| 2026-10-05 | P5.02 | template_save ikki xil: recipe (Spec sahnasidan, AE'siz) va aep (qurilgan .aep panel orqali storage'ga) | recipe AE'siz qayta yaratiladi va formatlarga moslashadi; aep dizayner ishlovi kerak bo'lganda |
| 2026-10-05 | P5.03 | preview.gif o'rniga panel galereyasi manifestdan sxematik ko'rinish chizadi; gif ixtiyoriy | gif uchun haqiqiy AE render kerak (👤), galereya esa doim ishlashi kerak |
| 2026-10-05 | P5.04 | Spec brand default 'default' saqlanmagan bo'lsa brand'siz quriladi | mavjud Spec'lar va snapshot'lar o'zgarmaydi; brand ixtiyoriy qatlam |
| 2026-10-05 | P5.05 | Variantlar bitta .aep ichida alohida asosiy comp'lar (aes.main.<tag>), footage importi umumiy | bitta build/VERIFY, har format alohida render va gate; asosiy format oplari o'zgarmaydi |
| 2026-10-05 | P5.06 | Claude'siz job'lar auto_approve bilan (VERIFY avtomatik) | panel/batch'da kadrlarni tekshiradigan Claude yo'q; render gate (±1 kadr) baribir ishlaydi |
| 2026-10-07 | P5.07 | Batch qatorlari oldindan to'liq tekshiriladi, BLOCKED qator bekor qilinib keyingisiga o'tiladi | yarim yo'lda to'xtab qolgan batch'dan ko'ra xato qatorlar hisobotda ko'rinadigan to'liq natija foydaliroq |
| 2026-10-07 | P5.08 | Telegram long polling (getUpdates), webhook emas | Railway'da bitta instans; ochiq HTTPS endpoint va secret kerak emas |
| 2026-10-07 | P5.10 | Q8: self-signed ZXP; Q9: faqat LGPL ffmpeg ZXP ichida (bin/<platform>-<arch>) | shaxsiy tarqatishga yetarli; LGPL o'zgartirilmagan binar bilan tarqatishga ruxsat beradi |
| 2026-10-07 | P5.13 | DB backup ilova ichida (json_agg → storage), pg_dump emas | Railway konteynerida pg_dump yo'q; JSON orqali turlar aniq tiklanadi va PGlite bilan test qilinadi |
| 2026-10-07 | Login | Kabinetga kirish faqat Telegram deep link (email/magic link olib tashlandi) | foydalanuvchi talabi; xat xizmati kerak emas, kirish bilan xabarnoma chati ham ulanadi |

---

## Hisobot shabloni

```text
### YYYY-MM-DD · P<f>.<nn> — <nom> · ✅ bajarildi | ⚠️ qisman | ❌ bloklangan
- **Qilindi:** …
- **Fayllar:** …
- **Tekshiruv:** buyruq → natija
- **Qarorlar / chetga chiqishlar:** … (qarorlar jurnaliga ham yoziladi)
- **Muammolar / qarz:** …
- **Keyingi:** P<f>.<nn>
```

---

## Hisobotlar (eng yangisi pastda)

### 2026-10-05 · P0.01 — Asl rejani o'qish va muhitni tekshirish · ✅
- **Qilindi:** `ae-studio-plan.md` (§0–§17, M0–M8) to'liq o'qildi; kompyuterdagi vositalar tekshirildi.
- **Topilmalar:** Node, pnpm, ffmpeg, After Effects va CEP extensions papkasi yo'q. git 2.56 va Railway CLI 5.63.1 (login qilingan) bor. Papka git repo emas, ichida faqat `ae-studio-plan.md` bor.
- **Rejadagi nomuvofiqliklar:** brauzer WebSocket `Authorization` header qo'ya olmaydi (Q1); yopiq op to'plamida patch uchun o'chirish opi yo'q (Q4); §14 da `yarn`, monorepo esa pnpm'da; Node 20 EOL bo'lgan.
- **Keyingi:** P0.02

### 2026-10-05 · P0.02 — 5 fazali reja tuzildi · ✅
- **Qilindi:** `ae-studio-phases.md` yozildi: 5 faza, 69 todo (P1.01–P5.14), har faza oxirida 🧪 gate (M0–M8 dagi "Tayyor" shartlari), invariantlar, qamrov jadvali, 10 ta ochiq qaror (Q1–Q10), 👤 ro'yxati.
- **Fayllar:** `ae-studio-phases.md` (yangi)
- **Tekshiruv:** asl rejadagi har element qamrov jadvalida bitta todo'ga bog'langan: 18 op, 50 MCP tool, 4 prompt, 19 WS xabar, 7 panel ekrani, 17 jadval, §11.4 qo'shimchalari.
- **Keyingi:** P0.03

### 2026-10-05 · P0.03 — Jarayon jurnali va xotira · ✅
- **Qilindi:** `process.md` (shu fayl) yaratildi: joriy holat, qarorlar jurnali, hisobot shabloni. Claude xotirasiga hisobot protokoli yozildi, u har sessiyada avtomatik yuklanadi.
- **Fayllar:** `process.md` (yangi); xotira: `process-md-reporting.md`, `user-uzbek-language.md`
- **Keyingi:** P1.01 (👤 ruxsatingiz kerak)

### 2026-10-05 · P1.01 — Muhit · ✅ (AE qismi boshqa kompyuterda)
- **Qilindi:** Node v24.21.0 (zip, sha256 tekshirildi) → `%LOCALAPPDATA%\Programs\nodejs`; corepack orqali pnpm 12.9.1; ffmpeg/ffprobe n8.1.3 LGPL (BtbN) → `%LOCALAPPDATA%\Programs\ffmpeg\bin`; User PATH, `~/.bashrc`, `~/.bash_profile`; `git init -b main`, repo-local `user.email`, `core.autocrlf=false`.
- **Tekshiruv:** `node -v` → v24.21.0 · `pnpm -v` → 12.9.1 · `ffprobe -version` → n8.1.3.
- **Qarorlar:** After Effects va PlayerDebugMode boshqa kompyuterda (foydalanuvchi). Bu yerda kod darajasida tekshiriladi. Har todo'dan keyin commit + push.
- **Muammolar / qarz:** Bash tool sessiya snapshot'idan foydalanadi, PATH qo'lda qo'shiladi ("Joriy holat"ga qarang). Git remote yo'q.
- **Keyingi:** P1.02

### 2026-10-05 · P1.02 — Monorepo skeleti · ✅
- **Qilindi:** pnpm workspace (`packages/*`, `apps/*`); root `package.json` (build/typecheck/lint/test/format/check skriptlari); `tsconfig.base.json` (strict, Bundler, verbatimModuleSyntax, noUncheckedIndexedAccess); ESLint 10 flat + typescript-eslint; Prettier; Vitest 5 `projects`; `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`; `@aes/shared` va `@aes/compiler` skeletlari; `apps/*` papkalari (o'z todo'larida to'ldiriladi).
- **Versiyalar:** typescript 6.0.3 · eslint 10.12 · typescript-eslint 8.71 · vitest 5.0.3 · prettier 3.9.9 · @types/node 24.
- **Tekshiruv:** `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` → hammasi toza.
- **Qarorlar:** TS 6 (7 emas); Q6 → zod v4; importlar kengaytmasiz; jsx uchun ES3-xavfsiz shared qismi (qarorlar jurnalida).
- **Keyingi:** P1.03

### 2026-10-05 · P1.03 — `shared/errors.ts` va javob formati · ✅
- **Qilindi:** `errors.ts`: §12 dagi 24 ta kod + qo'shimchalar (`AUTH_INVALID`, `ASSET_OUTSIDE_ROOT`, `AE_UNKNOWN_OP`, `AE_BAD_PARAMS`, `AE_NOT_FOUND`, `SYS_*`), har birida `retryable` va o'zbekcha `hint`; `makeError` (noma'lum kod runtime'da `SYS_INTERNAL` bo'ladi), `isErrorCode`, `errorPrefix`. `result.ts`: `Result<T> = Ok | Fail`, `ok`/`fail`/`failWith`. Ikkala fayl ES3-xavfsiz (jsx bundle'iga kiradi). Subpath eksportlar: `@aes/shared/errors`, `@aes/shared/result`.
- **Fayllar:** `packages/shared/src/{errors,result,index}.ts`, `packages/shared/test/errors.test.ts`
- **Tekshiruv:** `vitest --project @aes/shared` → 7/7 ✅ (tip darajasida: noma'lum kod `@ts-expect-error`) · typecheck · lint · prettier ✅
- **Qarorlar:** ASSET_ "qisman" → faqat `ASSET_CORRUPT` retryable. ES3 xavfsizligi P1.10 dagi jsx typecheck dasturida yakuniy tekshiriladi.
- **Keyingi:** P1.04

### 2026-10-05 · P1.04 — `shared/spec.ts` (Video Spec, §9) · ✅
- **Qilindi:** zod v4 sxema: `format` (juft o'lcham, fps, duration auto|soniya), `variants` (9:16/1:1/16:9), `brand`, `audio` (voiceover: tts/dialogue/asset; music: music/asset + duck; sfx: prompt|asset + `at` langari; captions; source_audio), `scenes` (dur: soniya | `vo:a-b`; template+slots | layers; transition_out), layerlar (media/text/shape/audio, ixtiyoriy `id/start/dur`), `output`. Hamma obyekt `strictObject`. Spec darajasidagi tekshiruvlar: takroriy id'lar, `vo:` uzluksizligi va voiceover talabi, SFX langari mavjud sahnaga, captions/duck manbalari, variantlar. `parseSpec` (SPEC_INVALID + JSON Pointer path'lar, o'zbekcha zod lokali), `collectAssetRefs`, `parseVoRange`, `parseSceneAnchor`, `specJsonSchema()` (MCP uchun, ~10.6 KB). `common.ts`: slug/asset/rang/til primitivlari, `parseWith`, `formatIssues`.
- **Fayllar:** `packages/shared/src/{common,spec,index}.ts`, `packages/shared/test/spec.test.ts`, `test/fixtures/spec-plan-example.json` (asl rejadan aynan olingan)
- **Tekshiruv:** 35/35 test ✅ (§9 namunasi valid; 20+ noto'g'ri holat aniq path bilan) · typecheck · lint · prettier ✅
- **Qarorlar:** qarorlar jurnalida (vo: semantikasi, yopiq enumlar, strict, o'zbek lokali). Root'ga `tsx` qo'shildi.
- **Keyingi:** P1.05

### 2026-10-05 · P1.05 — `shared/ops.ts`, `ws.ts`, `template.ts`, `brand.ts` · ✅
- **Qilindi:** `ae.ts`: op tilining sof TS tiplari (18 op + `ping` tizim opi, `OpEnvelope`, `OpResultData`, `AeRequest/AeResponse` ko'prigi). Fayl ES3-xavfsiz, jsx shu tiplardan foydalanadi. `ops.ts`: har op uchun zod params sxemasi, `opEnvelopeSchema` (discriminated union), `opResultDataSchema`, `makeOp`, `parseOpEnvelope` (AE_BAD_PARAMS), timeout'lar (`OP_TIMEOUT_MS`), `OP_PATH_PARAMS`, op_id formati (`[aes:<op_id>]` izi uchun xavfsiz). Compile vaqtidagi `Mutual` tekshiruvi zod ↔ `ae.ts` mosligini kafolatlaydi (ataylab buzib sinaldi, tutildi). `ws.ts`: §10.2 ning barcha 19 xabari + `job.update`, `job.event`, `request.failed`; heartbeat konstantalari; `parseServerMessage/parsePanelMessage`. `jobs.ts`: holatlar (§3), outcome'lar, `MAX_PATCHES=3`. `template.ts` (§11.2), `brand.ts` (§11.3).
- **Fayllar:** `packages/shared/src/{ae,ops,ws,jobs,template,brand,index}.ts`, `test/contracts.test.ts`, `test/fixtures/template-plan-example.json`; `tsconfig.test.json` (src muhitdan mustaqil, testlar Node tiplari bilan).
- **Tekshiruv:** 90/90 test ✅. Testlar asl rejani o'qib solishtiradi: §10.1 op ro'yxati = `OP_NAMES`; §10.2 xabarlari sxemada bor; §3 zanjiri = `JOB_FLOW`; §9 va §11.2 namunalari valid. typecheck (2 config) · lint · prettier ✅.
- **Qarorlar:** op darajasida koordinatalar piksel (`[x,y]`), compiler preset/nisbiy qiymatlarni pikselga aylantiradi; havolalar (`comp`, `item`, `layer`) yaratgan opning op_id si; WS'ga 3 ta qo'shimcha xabar.
- **Keyingi:** P1.06

### 2026-10-05 · P1.06 — Server skeleti · ✅
- **Qilindi:** `apps/server`: Fastify 5.12 (pino logger, `authorization`/`cookie` redact, trustProxy, requestTimeout 30 s); `env.ts` (zod, o'zbekcha xabarlar, xatoda maxfiy qiymatlar chiqmaydi, production'da `PUBLIC_URL` majburiy, `MASTER_KEY` 32 bayt tekshiruvi); `/health` (DB `select 1` + Redis `PING`, har biriga 2 s timeout, 200/503, `Result` formatida); 404/500 handlerlari `Result` formatida (ichki tafsilot oshkor qilinmaydi); graceful shutdown (SIGTERM/SIGINT, 10 s dan keyin majburiy); `withTimeout`; esbuild bundle (`@aes/*` ichiga olinadi, npm paketlar tashqarida) → `dist/index.js` 42 KB; `railway.json` (Railpack, preDeploy migratsiya, healthcheck); `.env.example`; ioredis `family: 0` (Railway private tarmog'i IPv6).
- **Fayllar:** `apps/server/{package.json,tsconfig.json,vitest.config.ts,build.mjs,railway.json,.env.example}`, `src/{index,app,env,health,redis,version}.ts`, `src/db/client.ts`, `src/lib/timeout.ts`, `test/{env,health}.test.ts`; `pnpm-workspace.yaml` → `allowBuilds: esbuild` (pnpm 12 talabi).
- **Tekshiruv:** 13/13 test ✅ (PGlite bilan haqiqiy DB ping). Smoke: `node dist/index.js` (DB/Redis yo'q) → `/health` 503 `{db:error, redis:error}`, `/nope` 404 `SYS_NOT_FOUND`, env yo'q → tushunarli `EnvError`. typecheck · lint · prettier ✅.
- **Muammolar / qarz:** PGlite birinchi ishga tushishda ~12 s oladi, shuning uchun server testlari uchun timeout 30/60 s. Haqiqiy Postgres/Redis bilan tekshiruv P1.08 (Railway) da.
- **Keyingi:** P1.07

### 2026-10-05 · P1.07 — DB sxema va migratsiyalar · ✅
- **Qilindi:** Drizzle sxemasi: §5 dagi 17 jadval. Enum'lar (`job_state`, `log_level`, `job_outcome`) `@aes/shared` dan olinadi; qolgan holat enum'lari ham bor. Cheklovlar: `plans(project_id, version)` unique + `version >= 1`, `ops(job_id, op_id)` unique (idempotentlik), `assets(project_id, key)` unique, `templates` `NULLS NOT DISTINCT` (global shablonlar), `brands(user_id, slug)`, `secrets` PK `(user_id, provider)`; FK cascade (user → hammasi), `projects.device_id` SET NULL; `updated_at` avtomatik. Migratsiya `drizzle/0000_init.sql`. `findMigrationsDir` (tsx'da ham, bundle'da ham topadi). `migrate-cli.ts` → `dist/migrate.js` (Railway preDeploy). `scripts/dev-db.ts` (`pnpm --filter @aes/server dev:db`): PGlite'ni Postgres wire-protocol orqali ochadi, Docker kerak emas.
- **Fayllar:** `apps/server/{drizzle.config.ts, drizzle/, scripts/dev-db.ts}`, `src/db/{schema,migrate,migrate-cli,client}.ts`, `test/db.test.ts`, `test/helpers/db.ts`
- **Tekshiruv:** server 23/23 (3 marta barqaror), repo 113/113 ✅. Jadval nomlari asl reja §5 dan o'qib solishtiriladi. Cheklovlar Postgres xato kodlari bilan sinalgan (23505/23503/23514). Haqiqiy postgres.js drayveri TCP orqali (pglite-socket): `dist/migrate.js` → 17 jadval; qayta qo'llash xavfsiz; server bundle `/health` → `db=ok`.
- **Muammolar / qarz:** parallel ishlagan 2 ta PGlite Windows'da vitest worker'ini qulatdi (0x80000003), shuning uchun server testlari `fileParallelism: false` bilan ishlaydi.
- **Keyingi:** P1.08 (👤 Railway tasdiqi kerak), parallel ravishda P1.09

### 2026-10-05 · P1.09 — Panel skeleti (Bolt CEP) · ✅ (AE'da ko'rish 👤)
- **Qilindi:** `apps/panel` Bolt CEP 2.2.3 toolchain'i bilan: vite-cep-plugin 2.2.3 + Vite 6.4 + plugin-react 4.7 + React 19; `cep.config.ts` (id `com.aestudio.panel`, AEFT `[22.0,99.9]`, CSXS 11, `--enable-nodejs --mixed-context`, ikonkalar); `vite.config.ts` (ExtendScript bundle `buildStart` da, ZXP imzolashdan oldin tayyor bo'ladi; production build AppData'dagi junction'ni o'chiradi, `AES_SYMLINK=1` bo'lsa qoladi); `vite.es.config.ts` (rollup + Babel 7 preset-env (targetsiz) + Bolt `jsxInclude`/`jsxPonyfill`, `generateJsx()` testlar uchun); jsx tsconfig `noLib` + types-for-adobe AE 22.0 (ES3 tiplar); `json2.js` vendor; o'z `cep.ts` wrapper'i (CSInterface o'rniga `__adobe_cep__`); UI skeleti (holat indikatorlari); 23×23 ikonkalar; `docs/panel-install.md`. ESLint: ES3 kodiga sintaksis cheklovlari.
- **Tekshiruv:** `pnpm --filter @aes/panel build` → `dist/cep` (manifest.xml, .debug, UI cjs 225 KB, jsx 3.7 KB, ikonkalar). Panel testlari 7/7: jsx bundle acorn `ecmaVersion: 3` dan o'tadi; JSON'siz vm'da json2 o'rnatiladi va `$[NS].version` mavjud; bundle'da ES5 API yo'q; cep.config tekshiruvi. Repo 120/120 (2 marta) · typecheck (UI + jsx) · lint · prettier ✅.
- **Muammolar / qarz:** Dev kompyuterda xotira juda kam (RAM 7.9 GB, bo'sh 0.3 GB; commit'ning bo'shi 2.1 GB). Parallel vitest worker'lar native crash berdi, shuning uchun root'da `maxWorkers: 1`. Vite 6 `@types/node>=18` peer ogohlantirishi bor, panelda ataylab `@types/node@16` (CEP Node 15–17 API'si). AE'da ochib ko'rish 👤 boshqa kompyuterda.
- **Keyingi:** P1.10

### 2026-10-05 · P1.10 — ExtendScript runtime · ✅
- **Qilindi:** `src/jsx/dispatcher.ts`: `runOp(json)` (har doim JSON qaytaradi; `beginSuppressDialogs` + `beginUndoGroup("aes:<op_id>")`, `finally` da yopiladi; read-only `ping` uchun undo group ochilmaydi; AE < 22 → `AE_VERSION`; noma'lum op → `AE_UNKNOWN_OP`; yomon JSON → `AE_BAD_PARAMS`; handler'dagi `raise()` tasniflangan xatoga, boshqa istisno `AE_SCRIPT_ERROR` ga (qator raqami bilan) aylanadi). `registerOp`, `ops/ping.ts`, `lib/trace.ts` (`[aes:<op_id>]` izi, `findItemByOpId`, `findLayerByOpId`, `requireComp`/`requireItem`), `lib/paths.ts` (`resolveInRoot`: absolyut yo'l va `..` → `ASSET_OUTSIDE_ROOT`), `lib/util.ts` (ES3 `isArray`, `hexToRgb`, `raise`). `$[NS] = { version, runOp }`. `@aes/shared/errors` jsx bundle ichida runtime'da ishlatiladi (ES3-xavfsiz ekani tasdiqlandi).
- **Test infratuzilmasi:** `test/ae-mock.ts`: AE object model mock'i (project/items/CompItem/layers/TextDocument/ImportOptions/File, undo/dialog hisoblagichlari). `test/jsx-harness.ts`: bundle JSON'siz vm'da yuklanadi.
- **Tekshiruv:** panel 11/11 ✅ (ping, yomon JSON, noma'lum op, eski AE). Test topdi: Babel `_typeof` helper'i `Symbol.iterator` ni bundle'ga qo'shgan edi, shuning uchun `transform-typeof-symbol` o'chirildi. jsx typecheck (ES3) · lint · prettier ✅.
- **Keyingi:** P1.11

### 2026-10-05 · P1.11 — Panel op runner va live log · ✅
- **Qilindi:** `src/agent/` (CEP ichidagi Node agenti, brauzer API'siga bog'liq emas):
  - `ae-bridge.ts`: `$[NS].runOp(json)` skripti, ES3-xavfsiz satr literal (U+2028/2029 escape), `timeout_ms` → `AE_TIMEOUT`. jsx yuklanmagan bo'lsa `$.evalFile` bilan yuklab, bir marta qayta urinadi. `EvalScript error.` va yaroqsiz javob → `AE_SCRIPT_ERROR`.
  - `op-runner.ts`: qat'iy ketma-ket navbat; AE'ga yuborishdan oldin zod konvert tekshiruvi va fayl yo'llari (`OP_PATH_PARAMS` → `resolveInsideRoot`); `op.started/done/failed` eventlari; `current()` (resume uchun).
  - `log.ts`: halqa bufer + obunachilar (⏳/✅/❌).
  - `createAgent()`.
  - `agent.build.ts`: esbuild → `dist/cep/agent/agent.cjs` (node15, minify, 485 KB). Vite `buildStart` da jsx bilan parallel build qilinadi.
  - `shared/paths.ts`: muhitdan mustaqil path traversal himoyasi (panel + server).
  - UI: `lib/agent.ts` (CEP Node `require`), `LiveLog`, `DevTools` (Ping / Comp yaratish / Matn qo'shish).
- **Tekshiruv:** agent testlari haqiqiy jsx bundle bilan mock-AE vm'da: ping oqimi + log + eventlar; yaroqsiz konvert va yo'l AE'ga yuborilmaydi; timeout; ketma-ketlik; jsx avtomatik yuklanishi; istisnolar. `agent.cjs` oddiy Node'da `require` qilinib, op bajarildi. Repo 146/146 · typecheck (UI + agent@node16 + jsx@ES3) · lint · prettier ✅.
- **Keyingi:** P1.12

### 2026-10-05 · P1.12 — Birinchi 4 op · ✅ (AE'da sinash 👤)
- **Qilindi:** ExtendScript oplari:
  - `comp.create`: o'lcham, fps, davomiylik, `bg` rangi, papka.
  - `item.import`: `resolveInRoot` ikkinchi qatlami; `ASSET_MISSING` / `ASSET_UNSUPPORTED`.
  - `layer.add_text`: nuqtali yoki box matn; uslub (font/size/rang/stroke/justify/tracking/leading); `all_caps` matnni katta harfga o'tkazadi, chunki AE 22 da `allCaps` faqat o'qiladi. Pozitsiya va vaqt beriladi.
  - `layer.add_media`: `fit` (cover/contain/stretch/none) masshtabi, pozitsiya, shaffoflik, `keep_audio` bo'lmasa video ovozi o'chiriladi; faqat audio element → `AE_BAD_PARAMS`.

  Hammasi idempotent: `[aes:<op_id>]` izi bo'lsa `reused: true` qaytadi, dublikat yaratilmaydi. Havola topilmasa `AE_NOT_FOUND`. `lib/ae.ts` yordamchilari. `ae-smoke.jsx`: AE ichida qo'lda ishga tushiriladigan smoke-test (`dist/cep/ae-smoke.jsx`). Ko'rsatma `docs/panel-install.md` da.
- **Tekshiruv:** `jsx-ops.test.ts` 11 ta test, haqiqiy bundle mock AE'da (yaratish, iz, idempotentlik, cover/contain/stretch masshtablari, xato kodlari, istisnodan keyin undo/dialog yopilishi). Smoke skript ES3 parser'dan o'tadi va mock AE'da "HAMMASI OK" chiqaradi. Repo 159/159 · typecheck · lint · prettier ✅.
- **Topilgan va tuzatilgan:** Prettier `.jsx` ga trailing comma qo'shgan edi (ES3 sintaksis xatosi), shuning uchun `.jsx` uchun `trailingComma: none`. ES3 testi buni ushladi.
- **Keyingi:** P1.13

### 2026-10-05 · P1.13 — Dev WS · ✅ (Railway'da sinash P1.08 dan keyin)
- **Qilindi:**
  - **Server:** `@fastify/websocket`; `src/ws/dev-agent.ts` (`DevAgentHub`): `/ws/agent` Bearer `DEV_AGENT_TOKEN` bilan (timing-safe taqqoslash). `hello` → `hello_ack`; 10 s `ping`, 30 s javobsiz → uzish. `op.done/failed` op_id bo'yicha kutayotgan so'rovga beriladi. `POST /dev/op` (konvert zod bilan tekshiriladi → `op.run` → natija; panel yo'q bo'lsa 503 `ENV_AGENT_OFFLINE`; timeout `AE_TIMEOUT`). `GET /dev/agent`. Faqat `DEV_AGENT_TOKEN` berilganda yoqiladi.
  - **Agent:** `ws-client.ts`, sof-JS `ws` + `Authorization` header (**Q1 amalda yopildi**). `hello` (qurilma, AE versiyasi, ish papkasi, bajarilayotgan op), `pong`, `op.run`/`ops.batch` → runner, runner eventlari → `op.started/done/failed`. Uzilsa backoff + ±20% jitter (1 s → 30 s); 401 → log + qayta urinish.
  - **UI:** `Connection` (URL + token, localStorage), 🟢/🔴 Server indikatori.
- **Tekshiruv:** `dev-ws.e2e.test.ts` (haqiqiy Fastify port + haqiqiy `ws` + haqiqiy jsx bundle mock AE'da): `POST /dev/op` → AE'da comp va matn yaratiladi → javob; AE xatosi tasniflangan holda qaytadi; panel yo'q → 503; noto'g'ri token → 401 (HTTP va WS); server o'chib qayta yonsa agent o'zi qayta ulanadi. Build qilingan `agent.cjs` (536 KB, `ws` ichida) oddiy Node'da haqiqiy server jarayoniga ulandi va `/dev/op` → 200. Repo 164/164 · typecheck · lint · prettier ✅.
- **Keyingi:** P1.14 (gate). P1.08 Railway 👤 tasdiq kutmoqda.

### 2026-10-05 · P1.14 — 🧪 Faza 1 gate · ⚠️ qisman (kod qismi ✅, Railway va AE 👤 kutilmoqda)
- **Kod darajasida o'tdi:** `pnpm test` 164/164; typecheck (shared, compiler, server, panel UI, agent@node16, jsx@ES3); lint; prettier. E2E zanjir (server WS ↔ agent ↔ jsx mock AE) avtomatik testda ishlaydi. Server bundle haqiqiy Postgres protokoli bilan `/health` (db=ok) qaytaradi.
- **Sinov uchun tayyor fayl:** `apps/panel/dist/zxp/com.aestudio.panel.zxp` (self-signed, DigiCert timestamp, `ZXPSignCmd -verify` → OK; ichida agent, jsx, manifest, ikonkalar, `ae-smoke.jsx`). Ko'rsatma `docs/panel-install.md` da.
- **Kutilmoqda:** (1) 👤 P1.08 Railway deploy uchun tasdiq → `/health` va Railway'dan `op.run`; (2) 👤 AE kompyuterida: ZXP o'rnatish → panel tugmalari va `ae-smoke.jsx` natijasi.
- **Eslatma:** bu muhitda `NoDefaultCurrentDirectoryInExePath=1` bor, shuning uchun ZXP faqat `env -u NoDefaultCurrentDirectoryInExePath pnpm --filter @aes/panel zxp` bilan quriladi. Oddiy terminalda `pnpm zxp` yetarli. ZXP org nomi bo'sh joysiz (`AEStudio`). `.debug` fayli ZXP ichida qoladi, uni production'da olib tashlash (P5.10) qarz sifatida yozildi.
- **Keyingi:** 👤 javoblar: Railway tasdig'i va git remote URL

### 2026-10-05 · P2.01 — Web login (email magic link) · ✅ (Resend kaliti 👤 keyin)
- **Kontekst:** foydalanuvchi AE sinovini o'tkaza olmadi va "qolgan ishlarni davom ettir" dedi. Faza 1 gate'ining AE/Railway bandlari ochiq qoldi, Faza 2 boshlandi.
- **Qilindi:**
  - `auth/tokens.ts`: opaque tokenlar; DB'da faqat sha256 saqlanadi. `issue/findActive/consume` (atomar, bir martalik) va `revoke`.
  - `auth/mailer.ts`: `RESEND_API_KEY` bo'lsa Resend, bo'lmasa logga chiqaradi; testlar uchun `MemoryMailer`.
  - `auth/session.ts`: `aes_session` HttpOnly cookie, Lax, https'da Secure, 30 kun. `request.user` to'ldiriladi, `requireUser` → 401 `AUTH_EXPIRED`.
  - `auth/routes.ts`:
    - `POST /api/auth/magic-link`: havola 15 daqiqa amal qiladi, bir email'ga 30 s'da bitta; javob email mavjudligini oshkor qilmaydi.
    - `GET /api/auth/verify`: havola bir marta ishlatiladi; user topiladi yoki yaratiladi; sessiya ochilib, faqat ichki `next` ga 303 qaytaradi (open redirect yo'q).
    - `GET /api/me`, `POST /api/auth/logout`.
  - `context.ts` (AppContext + `now` soat). Env: `RESEND_API_KEY`, `MAIL_FROM`.
- **Tekshiruv:** `auth.test.ts` 6 ta (to'liq oqim, bir martalik va eskirish, hash saqlash, rate limit, open redirect, email normalizatsiyasi). Server 29/29 · typecheck · lint · prettier ✅.
- **Keyingi:** P2.02

### 2026-10-05 · P2.03 — Device flow (RFC 8628) · ✅
- **Eslatma:** P2.02 (kabinet UI) device tasdiqlash API'siga bog'liq, shuning uchun P2.03 oldin bajarildi.
- **Qilindi:** `src/devices/routes.ts`:
  - `POST /oauth/device/code`: 6 belgili `user_code` (adashtiradigan belgilarsiz alifbo, faol kodlar orasida takrorlanmaydi), `device_code` (opaque, hash bilan), `verification_uri(_complete)`, 600 s, interval 5.
  - `POST /oauth/device/token`: RFC javoblari `authorization_pending`, `slow_down`, `expired_token`, `access_denied`. Tasdiqlansa `device_code` atomar iste'mol qilinadi, `devices` qatori va muddatsiz `device` tokeni yaratiladi.
  - Kabinet: `GET /api/devices/pending?code=` (kod `abc-123` kabi kiritilsa ham normallashtiriladi), `POST /api/devices/confirm`, `GET /api/devices`, `POST /api/devices/:id/revoke` (faqat egasi; qurilma tokenlari ham bekor qilinadi).
  - `authenticateDevice()` P2.05 WSS uchun.
- **Tekshiruv:** `device-flow.test.ts` 5 ta (to'liq oqim, slow_down, bir martalik kod, rad etish, eskirish, revoke tokenni darhol o'ldiradi, begona user revoke qila olmaydi, sessiyasiz 401, noto'g'ri grant). typecheck · lint ✅.
- **Keyingi:** P2.02

### 2026-10-05 · P2.02 — Web kabinet skeleti · ✅
- **Qilindi:** `apps/web` (React 19 + Vite 8):
  - login (magic link so'rash);
  - `/device?code=` (kodni tekshirish, qurilma nomi, ruxsat berish / rad etish; login'dan keyin `next` bilan shu sahifaga qaytadi);
  - qurilmalar ro'yxati va bekor qilish;
  - chiqish; yorug'/qorong'i mavzu. Dev'da `/api`, `/oauth` lokal serverga proksi qilinadi.

  Server: `src/web.ts` (`@fastify/static`; `WEB_DIST` yoki `apps/web/dist` avtomatik topiladi), SPA fallback (noma'lum GET → `index.html`; `/api`, `/oauth`, `/ws`, `/dev`, `/mcp`, `/health` → 404 §8 formatida). `railway.json` build: web + server.
- **Topilgan va tuzatilgan:** haqiqiy jarayon bilan smoke-test (dev-db PGlite socket + tsx server + curl) qilinganda `/oauth/device/code` postgres.js drayverida 500 berdi: raw `sql` ichidagi `Date` parametri serializatsiya qilinmaydi. PGlite testlari buni ko'rmagan. `gt()` bilan tuzatildi va `createWireTestDb()` qo'shildi (PGlite wire-server + haqiqiy postgres.js). `pg-driver.test.ts` login va device flow'ni production drayveri bilan sinaydi. Xatoni qaytarib tekshirildi, test uni ushlaydi.
- **Tekshiruv:** jonli smoke: kabinet `/` → HTML; magic link (logdan) → 303 → cookie → `/api/me` → `test@example.com`. Testlar: `web.test.ts` 3 ta, `pg-driver.test.ts` 1 ta. Repo 179/179 · typecheck · lint · prettier ✅. Web build 224 KB.
- **Keyingi:** P2.04

### 2026-10-05 · P2.04 — Panel: Ulanish ekrani va credentials · ✅ (AE'da ko'rish 👤)
- **Qilindi:**
  - **agent:** `pairing.ts`: device flow klienti — kod olish, poll, `slow_down` +5 s, denied/expired/cancelled → `PairingError`; `normalizeServerUrl`; `agentSocketUrl` (https → wss). `http.ts`: `node:https` ustidagi JSON POST, chunki CEP Node 15 da `fetch` yo'q. `credentials.ts`: `<userData>/.aestudio/credentials`, AES-256-GCM; kalit = scrypt(hostname | OS user | home | platform), native modulsiz. `createAgent`: `account()`, `pair()`, `connectSaved()`, `logout()`. WS 401 → `unauthorized` holati: qayta urinish to'xtaydi va saqlangan token o'chiriladi (qurilma kabinetda bekor qilingan holat).
  - **UI:** `Connection.tsx`: hisob bo'lsa avtomatik ulanadi; bo'lmasa server URL → katta kod → brauzer avtomatik ochiladi → tasdiq kutiladi → ulanadi; chiqish va bekor qilish. Token CEP `userData` papkasida.
- **Tekshiruv:** `pairing.test.ts` 5 ta (shifr fayli tokenni ochiq saqlamaydi; boshqa mashina yoki buzilgan fayl ochilmaydi; haqiqiy Fastify serveri bilan to'liq juftlash va kabinet API orqali tasdiq; rad etish; bekor qilish). dev-ws e2e 401 → `unauthorized` ga yangilandi. Panel 43/43 · typecheck · lint · build ✅.
- **Keyingi:** P2.05

### 2026-10-05 · P2.05 — Production WSS (device token) · ✅
- **Qilindi:**
  - **Server:** `src/ws/hub.ts` `AgentHub` (har qurilma alohida; yangi ulanish eskisini almashtiradi).
    - `hello` → `devices.ae_version/last_seen` yangilanadi va `hello_ack` yuboriladi; `ae.state` → AE versiyasi yangilanadi.
    - Heartbeat 10 s; 30 s javobsiz bo'lsa uziladi.
    - `presence` va `message` obunalari P2.11 dagi `WAITING_AGENT` uchun.
    - `run()` op_id bo'yicha kutadi (timeout + 5 s, uzilsa `ENV_AGENT_OFFLINE`); `kick()`.
    - `src/ws/routes.ts`: `/ws/agent` `Authorization: Bearer <device_token>` (`authenticateDevice`, yaroqsiz bo'lsa 401 `AUTH_DEVICE_REVOKED`); `POST /api/devices/:id/ops` (faqat egasiga; joblargacha diagnostika).
    - Kabinetda revoke → `hub.kick()`. Dev token (`DEV_AGENT_TOKEN`, `/dev/op`, `dev-agent.ts`) olib tashlandi.
  - **Agent:** ulangach `ping` → `ae.state` (AE versiyasi, loyiha yo'li); `WsClient.reportAeState`.
- **Tekshiruv:** `agent-ws.e2e.test.ts` 4 ta (haqiqiy device flow bilan juftlash → device token bilan WS → kabinetdan op → mock AE → natija; AE versiyasi qurilma ro'yxatida; revoke → uzilish → 401 → `unauthorized` → credentials fayli o'chadi; heartbeat timeout → server uzadi → panel qayta ulanadi; server qayta ishga tushsa saqlangan token bilan ulanadi; ulanmagan qurilma → `ENV_AGENT_OFFLINE`). Repo 183/183 · typecheck · lint · prettier ✅.
- **Keyingi:** P2.06 (storage) — ❓ 👤 R2 yoki Railway bucket (Q3)

### 2026-10-05 · P2.06 — Storage (S3 / lokal) · ✅ (R2 yoki Railway bucket kalitlari 👤)
- **Qilindi:**
  - **Server:** `src/storage/`:
    - `Storage` interfeysi (`presignPut/presignGet` 15 daqiqa, `head/getBytes/putBytes`); `storageKey()` → `u/<user>/p/<project>/{thumbs|frames|audio-in|audio-out}/<hash>.<ext>` (path traversal yo'q).
    - `S3Storage` (AWS SDK v3, path-style, region `auto`): R2 ham, Railway bucket ham faqat `S3_*` env bilan ulanadi.
    - `LocalStorage` (dev/test): disk + HMAC-SHA256 imzoli `/storage/*` PUT/GET (muddat, metod va kalit imzo ichida; xom oqim faqat shu plagin scope'ida).
    - `createStorage()`: S3 env to'liq bo'lsa S3, aks holda lokal (production'da ogohlantiradi). `app.storage` decorate qilingan; SPA fallback `/storage/` ni chetlaydi.
  - **Panel agent:** `files.ts`: `sha256File` (oqim bilan), `downloadVerified` (vaqtinchalik `.part` fayl → hash → rename; 3 urinish → `ASSET_CORRUPT`), `uploadFile` (PUT stream). WS `file.download` → ish papkasi guard'i → `file.saved` yoki `request.failed`.
- **Tekshiruv:** `storage.test.ts` 7 ta (kalitlar; imzolangan PUT/GET; buzilgan, boshqa metod va muddati o'tgan imzo → 403; JSON route'lar ta'sirlanmagan; S3 presign formati tarmoqsiz). `files.e2e.test.ts` 3 ta (300 KB upload; download + sha256; mos kelmasa aynan 3 urinish va `.part` qolmaydi; WS `file.download` → fayl ish papkasida, `..` → `ASSET_OUTSIDE_ROOT`, noto'g'ri hash → `ASSET_CORRUPT`). Repo 193/193 · typecheck · lint · prettier ✅.
- **Qarz:** "resumable multipart upload" (katta audio, §16) P4.04 da.
- **Keyingi:** P2.07

### 2026-10-05 · P2.07 — Ish papkasi va Sozlamalar · ✅ (AE'da ko'rish 👤)
- **Qilindi:**
  - **Server:** `src/projects/routes.ts`:
    - `POST /api/agent/projects` (device token; bir qurilmadagi bir papka = bitta loyiha; nom papka nomidan olinadi; absolyut bo'lmagan yoki `..` li yo'l → `ENV_NO_FOLDER`).
    - `GET /api/agent/projects` (oxirgi 20 ta), `GET /api/projects` (kabinet).
    - `normalizeRootPath` (Windows `\` va disk ildizi), `resolveProjectPath`: server tomoni path guard, `shared/paths` bilan (§4.4).
  - **Agent:** `workspace.ts`: `prepareProjectFolder` (`source/audio/frames/out/logs/.aestudio`), `settings.json` (qurilma nomi, log darajasi). `openProject`, `recentProjects`, `currentProject`, `settings/updateSettings`; qurilma nomi device flow va `hello` da ishlatiladi. `http.ts`: `getJson`, header'lar.
  - **UI:** `Workspace` (CEP papka dialogi, oxirgi loyihalar), `Settings`; live log darajasi bo'yicha filtrlanadi.
- **Tekshiruv:** `projects.test.ts` 3 ta, `workspace.e2e.test.ts` 2 ta (haqiqiy server + juftlangan agent: papkalar yaratiladi, server loyihasi yoziladi, takror ochilsa o'sha loyiha, yo'q papka → xato, sozlamalar yangi agentda o'qiladi). Papkadan tashqari yo'l ikkala tomonda rad etiladi: panel P2.06/P1.12, server shu yerda. Repo 198/198 · typecheck · lint · prettier ✅.
- **Keyingi:** P2.08 (ffmpeg wrapper + INGEST)

### 2026-10-05 · P2.08 — ffmpeg wrapper va INGEST · ✅
- **Qilindi:**
  - **Agent:**
    - `ffmpeg.ts`: `spawn` + timeout + kill; binar yo'q bo'lsa `ENV_FFMPEG_MISSING`. `probe` (davomiylik, o'lcham, fps, kodeklar, audio; o'qilmasa `ASSET_CORRUPT`). `thumbnail` (≤1280px JPG, video uchun 10% joydagi kadr).
    - `ingest.ts`: `source/` rekursiv (yashirin fayllar chiqarib tashlanadi); tur kengaytma bo'yicha; slug kalit (`Clip 01.mp4` → `clip_01`, takrorlar `_2`); ordinal tartib, shuning uchun kalitlar mashinaga bog'liq emas. Tez hash: ≤8 MB to'liq, kattalari uchun hajm + boshi va oxiridan 1 MB. Buzuq fayl skanerlashni to'xtatmaydi (`error`), ffmpeg yo'q bo'lsa butun skan to'xtaydi.
    - `scanAssets()`: thumbnail → presigned upload → `asset.scanned`. WS `assets.scan` (faqat ochiq papka uchun, aks holda `request.failed ENV_NO_FOLDER`). Sozlama `ffmpeg_dir`. UI "Skanerlash" tugmasi.
  - **Server:** `src/assets/routes.ts`: `asset.scanned` → `assets` upsert (`ok/corrupt/unsupported`; skanda yo'qlari `missing`); `POST /api/agent/projects/:id/uploads` (thumbs/frames/audio-in presign); assetlar ro'yxati (agent va kabinet); `POST /api/projects/:id/scan` → `assets.scan` (ulanmagan bo'lsa 503).
  - **Shared:** WS'ga `assets.scan` (server → panel) qo'shildi.
- **Tekshiruv:** haqiqiy ffmpeg (LGPL build) bilan yaratilgan test media'da (1920×1080 video + audio, 640×360 .mov, png, wav, buzuq mp4, txt, yashirin fayl): `ingest.test.ts` 8 ta; `ingest.e2e.test.ts` 2 ta (kabinet → server → panel → ffmpeg → thumbnail storage'da → DB; o'chirilgan fayl → `missing`; boshqa papka ochiq → `ENV_NO_FOLDER`; ulanmagan → 503). Repo 209/209 · typecheck · lint · prettier · panel build ✅.
- **Topilma:** LGPL ffmpeg'da `libx264` yo'q, lekin `libopenh264`, `h264_mf` va apparat encoder'lar bor (P3.07 render qarori uchun).
- **Keyingi:** P2.09 (qolgan yadro oplar)

### 2026-10-05 · P2.09 — Qolgan yadro oplar · ✅ (AE'da sinash 👤)
- **Qilindi (ExtendScript, ES3):**
  - `project.open_or_create`: o'sha fayl ochiq bo'lsa `reused`; mavjud bo'lsa `app.open`, yo'q bo'lsa yangi loyiha + saqlash. Ochiq loyihada saqlanmagan o'zgarish bo'lsa **ochilmaydi** (§2.10: hech narsa yo'qolmaydi). Bu holat `dirty` (AE 22 tiplarida yo'q, ehtiyotkor talqin) bilan aniqlanadi.
  - `project.save`: `vNNN`; boshqa mavjud versiya ustiga yozilmaydi; resume'da shu faylning o'ziga saqlanadi. Loyiha oplari undo group'siz.
  - `comp.nest`: o'z-o'ziga nest rad etiladi; davomiylik child comp'dan olinadi.
  - `layer.add_shape`: rect/ellipse, radius, fill rangi, pozitsiya, shaffoflik (shape contents → vector group → shape + fill).
  - `layer.add_audio`: daraja dB; video'li element bo'lsa tasvir o'chiriladi; ovozsiz element → `AE_BAD_PARAMS`.
  - `prop.keyframes`: alias yoki matchName yo'li (raqamli segment — indeks); `relative` vaqt; ease (linear / hold / bezier: ease_in, ease_out, ease_in_out); ease o'lchami `propertyValueType` bo'yicha (spatial 1, TwoD 2, ThreeD 3); kalit indeksi `nearestKeyIndex` bilan olinadi (`setValueAtTime` hech narsa qaytarmaydi).
  - `prop.expression`: faqat kutubxonadan (`wiggle`, `loop_out`, `bounce`, `pulse`); argumentlar faqat chegaralangan son yoki ruxsat etilgan qiymat, kod kiritib bo'lmaydi. `EXPRESSION_IDS` shared'da ham bor (test mosligini tekshiradi).
  - `fx.add`: `canAddProperty` → effekt; parametr matchName yoki ko'rinadigan nom bilan; noma'lum effekt/parametr → `AE_BAD_PARAMS`. `fx.apply_preset`: ish papkasidan `.ffx`.

  Yaratmaydigan oplarda idempotentlik layer comment'idagi `[aes:<op_id>]` izi orqali (`hasLayerTag`). `ops.batch` P1.13 dan beri agent'da bor.
- **Mock AE:** umumiy property tizimi (addProperty/canAddProperty, nom/indeks bo'yicha, keyframe/interp/ease, expression, `propertyValueType` haqiqiy enum qiymatlari bilan, `nearestKeyIndex`), shape contents, effektlar, audio darajalari, `app.open/newProject`, `project.save/dirty`.
- **Tekshiruv:** `jsx-ops-core.test.ts` 15 ta (haqiqiy ES3 bundle mock AE'da). jsx bundle 36 KB, ES3 parse va ES5 API taqiqi testlari o'tadi. Repo 224/224 · typecheck (ES3 tiplari) · lint · prettier · build ✅.
- **Keyingi:** P2.10 (compiler: Spec → oplist)

### 2026-10-05 · P2.10 — Compiler (Spec → oplist) · ✅
- **Qilindi:** `packages/compiler` (sof, deterministik):
  - **`compile(spec, ctx)` tartibi:** `project.open_or_create` → takrorsiz `item.import` (Source papkasi) → asosiy comp (`aes.main`) → har sahna uchun comp (`NN_<id>`, Scenes papkasi), layerlar, animatsiya, `comp.nest`, `transition_out`, oraliq `project.save` → yakuniy `project.save`.
  - **Barqaror op_id'lar:** `<sahna>.<layer id | lN>[.anim]`, `asset.<kalit>`, `<sahna>.comp/.nest/.save`.
  - **`layout.ts`:** pozitsiya presetlari va `{x,y}` → piksel; `fitScale` ExtendScript'dagi bilan bir xil formula.
  - **`motion.ts`:** `anim` (fade_in, ken_burns_in/out (fit masshtabidan), pop, zoom_in, slide_*, typewriter → kutubxonadagi `typewriter` expression) va `transition_out` (fade, whip_*, slide_*, zoom_*) nest layer'ida absolyut vaqt bilan.
  - **Matn uslubi default'lari:** o'lcham ≈ H×0.045, oq rang, markazga tekislangan.
  - **Asset tekshiruvi:** noma'lum → `SPEC_UNKNOWN_ASSET`; buzuq yoki yo'q → `ASSET_*`; audio'ni media sifatida → `SPEC_INVALID`.
  - **Vaqt:** `vo:` faqat `sceneDurations` bilan (Faza 4), aks holda `SPEC_INVALID`; shablon → `SPEC_UNKNOWN_TEMPLATE` (Faza 5).
  - **VERIFY uchun:** `keyTimes`; ogohlantirishlar (video qisqa, `format.duration` farqi).

  Shared va jsx: `typewriter` expression qo'shildi.
- **Dizayn tuzatishi:** build versiya fayliga (`<nom>_vNNN.aep`) yoziladi va har sahnadan keyin saqlanadi. Avval build `reel.aep` ga yozilib, oxirida "save as" qilinardi; bunda qayta ishga tushirilganda eski bo'sh fayl ochilib qolardi.
- **Tekshiruv:** compiler 13 ta test (sxemaga moslik, havola tartibi, vaqtlar, piksel joylashuvi, animatsiya va o'tishlar, kalit vaqtlar, snapshot, determinizm, bitta sahnadagi o'zgarish faqat o'sha opni o'zgartirishi, xatolar). `build.e2e.test.ts` 3 ta: compiler → haqiqiy ES3 bundle → mock AE; 3 sahnali video to'liq quriladi; to'liq qayta yuborish → 0 ta yangi element; o'rtada uzilgan build qolganini dublikatsiz tugatadi. **P2.14 gate'ining (3 sahnali video + resume) kod qismi qamrab olindi.** Repo 240/240 · typecheck · lint · prettier ✅.
- **Qarz:** matn hozircha nuqtali (paragraf qutisi `max_width` VERIFY bilan vizual sinovdan keyin, Faza 3).
- **Keyingi:** P2.11 (job state machine)

### 2026-10-05 · P1.08 — Railway deploy · ✅
- **Qilindi (Railway CLI, foydalanuvchi ruxsati bilan):**
  - Loyiha `ae-studio` (id `71a8f12c-d2d7-424c-9b06-942b6ef8a2d6`, env `production`) yaratildi. Servislar: `server`, `Postgres`, `Redis`.
  - `server` o'zgaruvchilari:
    - ulanishlar: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}`;
    - muhit: `NODE_ENV=production`, `PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`, `LOG_LEVEL=info`;
    - kalitlar: tasodifiy `MASTER_KEY` (32 bayt base64) va `JWT_SIGNING_KEY`;
    - storage: `STORAGE_DIR=/data/storage`.
  - Domen: https://server-production-9c75.up.railway.app.
  - Volume: `server-volume`, `/data` ga ulangan. S3 berilguncha lokal storage qayta deployda o'chmaydi.
  - `railway.json` repo ildiziga ko'chirildi. Root `package.json` ga `start` qo'shildi: `node apps/server/dist/migrate.js && node apps/server/dist/index.js`.
- **Topilma:** Railpack `railway.json` dagi `startCommand`, `buildCommand` va `preDeployCommand` ni qo'llamadi:
  - birinchi build "No start command detected" bilan yiqildi;
  - keyingi deployda migratsiya bajarilmadi (`relation "oauth_tokens" does not exist`).

  Shu sababli migratsiya `start` skriptiga ko'chirildi. Migratsiya idempotent, shuning uchun har ishga tushishda bajarilishi xavfsiz. Railpack root'da `pnpm build` ni ishlatadi (barcha paketlar, shu jumladan panel).
- **Tekshiruv:** `GET /health` → `{"status":"ok","db":"ok","redis":"ok"}`. `GET /` → 200 (kabinet). `POST /api/auth/magic-link` → `sent: true`, ya'ni DB'ga yozish ishlaydi. Xatlar hozircha server logiga chiqadi, chunki `RESEND_API_KEY` yo'q.
- **Qoldi (👤):** `RESEND_API_KEY` va `MAIL_FROM` (haqiqiy xat uchun); R2 yoki Railway bucket kalitlari (ixtiyoriy, hozir volume).
- **Keyingi:** P2.11

### 2026-10-05 · P2.11 — Job state machine · ✅
- **Qilindi (`apps/server/src/jobs/`):**
  - **`machine.ts`:** sof qism — zanjir (`nextState`), side-holatlar, amal ruxsatlari:
    - BLOCKED → retry, patch, ask_user, cancel;
    - VERIFY → approve, patch;
    - pause/resume.
  - **`engine.ts` (`JobEngine`):**
    - Har o'tish compare-and-set (`WHERE state = <eski>`), shuning uchun cancel yoki pause ishlab turgan handler bilan to'qnashmaydi.
    - Bir job uchun bitta driver; ishlab turganda yangi drive chaqirilsa, qayta aylanish belgilanadi.
    - Handlerlar:
      - CHECK: panel online, panelda ochiq papka loyiha papkasiga teng, AE `ping`. Javob yo'q bo'lsa `ENV_AE_CLOSED`. Natija `check.env` hodisasi (env_report).
      - PLAN: plan versiyasi va zod tekshiruvi.
      - INGEST: `assets.scan`, panel javobi `request_id` bo'yicha kutiladi, keyin `applyScan`.
      - AUDIO: skipped (Faza 4 gacha).
      - PREFLIGHT: compile (havolalar, assetlar, holat), `.aep` vNNN ajratiladi, oplist `ops` jadvaliga yoziladi. Barmoq izi o'zgarmagan bo'lsa `done` holatlari saqlanadi.
      - BUILD: oplar ketma-ket `hub.run` orqali; progress va pause/cancel oplar orasida tekshiriladi.
      - VERIFY: qo'lda approve kutiladi (Faza 3 gacha).
      - RENDER: skipped (Faza 3 gacha).
      - REPORT: `reports` jadvaliga yoziladi, keyin DONE (`outcome`).
    - **Resume:** uzilish yoki retry'dan keyin BUILD oxirgi bajarilgan `project.save` dan keyingi oplardan davom etadi va loyihani ochish opi avval qayta yuboriladi. Sabab: AE yopilgan bo'lsa saqlanmagan qism yo'qolgan bo'ladi; oplar idempotent, shuning uchun dublikat bo'lmaydi.
    - **Panel holati:** panel yo'q bo'lsa `WAITING_AGENT` (`prev_state`). Panel `hello` yuborganda job oldingi holatiga qaytadi va davom etadi. Server qayta ishga tushsa `recover()` ishlaydi.
    - **Patch:** yangi plan versiyasi, `patch_count` oshadi, ko'pi bilan 3 ta (`LOOP_PATCH_LIMIT`). Biror op qurilgan bo'lsa yangi vNNN ajratiladi, ya'ni qurilgan fayl ustiga yozilmaydi.
    - **Bitta qurilmada bitta aktiv job:** DB'da partial unique index (`state <> 'DONE'`) va `JOB_ACTIVE` xatosi.
  - **`report.ts`:** `report.md` generatori (qurilganlar jadvali, yo'llar, tahrir qo'llanmasi, ogohlantirishlar).
  - **`routes.ts`:** plans (POST, GET ro'yxat va bitta), project jobs (POST, GET), job, events (`?after=`), report va actions. Panel uchun `/api/agent/jobs/active` va `/api/agent/jobs/:id/actions` (pause/resume/cancel).
- **Boshqa o'zgarishlar:**
  - **DB:** migratsiya `0001_jobs_engine` — `jobs` ga `device_id`, `aep_version` (loyiha bo'yicha unique), `oplist_hash`, `paused` qo'shildi.
  - **Shared:** `JOB_ACTIVE` va `JOB_BAD_ACTION` xato kodlari, `JOB_ACTIONS`; `ae.state` ga `project_root`.
  - **Hub:** `request()` (`request_id` bo'yicha javob kutish; uzilishda `ENV_AGENT_OFFLINE`); panelning oxirgi holati `state()`.
  - **Agent:** `ae.state` da ish papkasi yuboriladi, papka ochilganda qayta yuboriladi.
- **Tekshiruv:** `jobs.test.ts` 17 ta, soxta agent (`test/helpers/fake-agent.ts`) bilan. Qamrab olingan yo'llar:
  - to'liq oqim → VERIFY → approve → DONE, hisobot va ikkinchi job → v002;
  - bitta aktiv job; plan yo'q yoki noto'g'ri;
  - panel yo'q → WAITING_AGENT → ulanadi;
  - BUILD o'rtasida uzilish → oxirgi saqlashdan dublikatsiz davom;
  - server restart → `recover`;
  - boshqa papka → BLOCKED → retry; AE jim → `ENV_AE_CLOSED`; INGEST xatosi;
  - PREFLIGHT noma'lum asset → patch; BUILD op xatosi → retry oxirgi saqlashdan;
  - VERIFY'dan patch → yangi `.aep` versiyasi; patch chegarasi;
  - noto'g'ri amal; cancel (panelga `job.cancel`); pause/resume.

  Repo 257/257 · typecheck · lint · prettier · server build ✅.
- **Qarz:** CHECK'da shriftlar va ElevenLabs tekshiruvi (Faza 4/5).
- **Keyingi:** P2.12 (Live log va Live ekrani)

### 2026-10-05 · P2.12 — Live log va Live ekrani · ✅ (AE'da ko'rish 👤)
- **Server (`jobs/live.ts`):**
  - Engine tinglovchilari panelga ikki xil xabar yuboradi:
    - `job.update`: holat, `prev_state`, progress (op soni), joriy sahna, pauza, yakun, BLOCKED xatosi;
    - `job.event`: har `job_events` yozuvi.
  - Panel qayta ulanganda (`hello`) aktiv job holati darhol yuboriladi. Panelning `log` xabarlari (`job_id` bilan) job log'iga yoziladi.
  - Panel uchun yangi endpointlar: `GET /api/agent/jobs/:id/events` (tarix) va `/api/agent/jobs/:id/actions` (pause, resume, cancel, undo).
- **Undo last:**
  - Yangi tizim opi `undo`. jsx tomoni AE Edit menyusidagi band aynan `Undo aes:<op_id>` bo'lsagina `executeCommand` qiladi. Orada qo'lda o'zgarish bo'lsa, boshqa amal tasodifan bekor qilinmaydi.
  - Server faqat BUILD pauzada ruxsat beradi va op hali bajarilayotgan bo'lsa rad etadi. Oxirgi `done` op (ochish/saqlash bundan mustasno) `pending` ga qaytariladi va resume'da qayta bajariladi.
- **Panel:**
  - **`agent/live.ts` (`LiveJobStore`):** aktiv job holati va hodisalari. Yangi job kelganda tarix serverdan yuklanadi va jonli kelgan hodisalar bilan dublikatsiz birlashtiriladi.
  - **`agent.jobAction()`:** Live ekranidagi amallarni serverga yuboradi. Job hodisalari umumiy LiveLog'ga ham chiqadi (op hodisalaridan tashqari, chunki ular op-runner'da allaqachon log qilinadi).
  - **`Live.tsx`:** holat zanjiri (BLOCKED/WAITING'da `prev_state` bo'yicha), progress bar, sahna, xato; Pause/Resume, Undo last, Cancel (tasdiq bilan); job log'i.
- **Shared:**
  - `job.update` ga `paused`, `outcome` va `error` qo'shildi.
  - `JOB_ACTIONS` ga `undo` qo'shildi; yangi `PANEL_JOB_ACTIONS`.
  - `SYSTEM_OP_NAMES` ga `undo` qo'shildi.
- **Tekshiruv:**
  - `jobs.test.ts` ga 5 ta test:
    - panelga holatlar zanjiri, sahna, progress va hodisalar boradi;
    - BLOCKED xatosi update ichida keladi; qayta ulanganda aktiv job darhol yuboriladi;
    - qurilma tokeni bilan tarix va amallar (approve rad etiladi, cancel ishlaydi);
    - Undo ikki marta, keyin resume ikkala opni qayta bajaradi;
    - pauzasiz undo rad etiladi.
  - `live.test.ts` 3 ta; `jsx-ops-core` ga undo testi (faqat oxirgi group bekor qilinadi, boshqa op so'ralsa `AE_NOT_FOUND`).
  - **`job.e2e.test.ts` (to'liq zanjir):** haqiqiy server, device flow, agent, haqiqiy ffmpeg INGEST va ES3 bundle (mock AE). Natija: 2 sahnali video quriladi, `.aep` v001 saqlanadi, Live store VERIFY va hodisalarni ko'rsatadi, approve → DONE va hisobot.

  Repo 267+ · typecheck · lint · prettier · panel build ✅.
- **👤 AE'da:** Live ekranini va Undo last'ni haqiqiy AE'da ko'rish. AE `findMenuCommandId("Undo aes:…")` ni qanday qo'llashi tekshirilishi kerak; ishlamasa undo `AE_NOT_FOUND` bilan xavfsiz rad etadi.
- **Keyingi:** P2.13 (versiyalash, plan/report lokal nusxalari)

### 2026-10-05 · P2.13 — Versiyalash va oddiy REPORT · ✅
- **Versiyalar (hech biri ustiga yozilmaydi):**
  - **`plans`:** har yangi spec yangi versiya oladi (`plans_project_version_uq`); patch ham yangi versiya yaratadi.
  - **`.aep` vNNN:** `jobs.aep_version` loyiha bo'yicha unique. Har job, va patch qurilgan versiyadan keyin, yangi raqam oladi; compile `<nom>_vNNN.aep` ga yozadi. jsx `project.save` boshqa mavjud versiya ustiga yozmaydi (P2.09).
  - **Lokal nusxalar** (`.aestudio/plan.vNNN.json` BUILD'ga har kirishda, `.aestudio/report.vNNN.md` REPORT'da; build bo'lmasa `report.job-<id>.md`):
    - yo'l: storage (`docs/<sha256>`, yangi kind) → presigned GET → panelga `file.download`;
    - REPORT panel uzilgan bo'lsa ham tugaydi, faqat nusxasiz.
  - **Panel himoyasi:** `file.download` mavjud faylni boshqa tarkib bilan almashtirmaydi (yangi `overwrite` flag'i, default yo'q). Bir xil sha256 bo'lsa fayl "saqlangan" hisoblanadi, ya'ni amal idempotent.
- **REPORT:** `report.ts` (P2.11) hisobotni `reports` jadvaliga va lokal nusxaga yozadi. Ichida:
  - natija, plan va `.aep` yo'llari, oplar soni, patch'lar;
  - sahnalar jadvali va tahrir qo'llanmasi;
  - ogohlantirishlar va oxirgi xato.
- **Tekshiruv:**
  - `jobs.test.ts` ga 4 ta test:
    - ikki job va patch → `plan.v001/v002.json`, `report.v001/v003.md` alohida; `.aep` v001/v002/v003 alohida; birorta ustiga yozish urinishi yo'q;
    - plan versiyasi DB'da o'zgarmas (23505);
    - `aep_version` loyiha ichida takrorlanmaydi (23505);
    - panel uzilgan bo'lsa REPORT nusxasiz tugaydi.
  - `files.e2e`: bir xil tarkib → saqlangan; boshqa tarkib → rad etiladi, eski fayl joyida; `overwrite: true` → almashtiriladi.
  - `job.e2e`: diskda `.aestudio/plan.v001.json` va `report.v001.md` paydo bo'ladi (hisobot DB'dagi bilan bir xil).

  Repo 273/273 · typecheck · lint · prettier ✅.
- **Keyingi:** P2.14 (Faza 2 gate)

### 2026-10-05 · P2.14 — 🧪 Faza 2 gate · ⚠️ kod va prod qismi ✅, haqiqiy AE bandlari 👤
- **Railway (production) smoke** — `apps/panel/test/prod.smoke.test.ts` (faqat `AES_PROD_URL` va `AES_PROD_COOKIE` bilan ishga tushadi).
  - **Sharoit:** https://server-production-9c75.up.railway.app ga haqiqiy agent kodi, device flow va ffmpeg INGEST; ExtendScript ES3 bundle mock AE'da. Natija ✅ (20 s).
  - **Job `83d0c299…`** quyidagi zanjirdan o'tdi:
    1. CHECK → PLAN → INGEST (6 fayl, 2 tasi ataylab buzuq) → AUDIO (skipped) → PREFLIGHT (30 op → `…_v001.aep`) → BUILD;
    2. `point.l0` paytida panel uzildi → `WAITING_AGENT`;
    3. qayta ulandi → `build.resume` (loyiha qayta ochildi, oxirgi saqlangan sahnadan) → BUILD tugadi (30/30);
    4. VERIFY → approve → RENDER (skipped) → REPORT → DONE (`success`).
  - **Dublikat yo'q:** comp'lar `01_hook, 02_point, 03_cta, smoke`; asosiy comp'da 3 nest; `02_point` da 3 layer.
  - **Lokal nusxa:** `.aestudio/report.v001.md` diskda va DB'dagi hisobot bilan bir xil.
  - **Tozalash:** smoke qurilmasi kabinetdan bekor qilindi (revoke).
- **Gate bandlari:**
  - ✅ **Avtomatik qayta ulanish:** `WAITING_AGENT` → davom (prod).
  - ✅ **3 sahnali video `plan.json` dan:** `build.e2e`, `job.e2e`, prod smoke.
  - ✅ **`report.md`:** `reports` jadvali va `.aestudio/report.v001.md`.
  - 👤 **Panel kabinet kodi orqali ulanishi:** device flow va WS prod'da agent kodi bilan ishladi. AE ichidagi panel UI'ni haqiqiy AE'da ko'rish qoldi.
  - 👤 **AE yopilib qayta ochilsa dublikatsiz davom:** uzilish simulyatsiyasi prod'da dublikatsiz o'tdi. Haqiqiy AE'da yopib-ochish sinovi qoldi.
- **Faza 1 gate'iga ta'siri:**
  - `/health` Railway'da javob beradi ✅.
  - Railway'dan `op.run` mock AE'da bajarildi; haqiqiy AE 👤.
- **Boshqa:** `build.resume` xabari aniqlashtirildi ("loyiha qayta ochiladi, <op> dan"). Repo testlari va prod smoke o'tdi.
- **Faza 2 yakuni:** P2.01–P2.13 bajarildi; P2.14 ning kod va prod qismi ✅. Qolgan 👤 bandlar AE kompyuterida tekshiriladi:
  - ZXP o'rnatish (`docs/panel-install.md`);
  - kabinet kodi bilan ulanish;
  - Live ekrani va Undo last;
  - AE'ni o'rtada yopib-ochish.
- **Keyingi:** Faza 3 — P3.01

### 2026-10-05 · P3.01 — OAuth 2.1 server · ✅
- **Manbalar:**
  - MCP authorization spec 2025-11-25 (modelcontextprotocol.io);
  - Claude connector auth hujjati (claude.com/docs/connectors/building/authentication):
    - callback `https://claude.ai/api/mcp/auth_callback`;
    - Claude Code — loopback redirect, port ixtiyoriy;
    - CIMD faqat `client_id_metadata_document_supported` va `none` auth usuli birga bo'lsa ishlatiladi, aks holda DCR;
    - token endpoint form-urlencoded;
    - refresh rotation, xatoda `invalid_grant`;
    - `offline_access` scope.
- **Qilindi (`src/oauth/`):**
  - **Metadata:**
    - `/.well-known/oauth-protected-resource` va `…/mcp`: `resource` = `<PUBLIC_URL>/mcp`, `scopes_supported` = `[mcp]`.
    - `/.well-known/oauth-authorization-server`: S256, `none` + client_secret_post/basic, `client_id_metadata_document_supported`, `registration_endpoint`, `revocation_endpoint`.
  - **DCR (`POST /oauth/register`):**
    - redirect faqat https yoki http loopback, fragmentsiz;
    - grant'lar authorization_code va refresh_token;
    - confidential klientga sir beriladi (DB'da sha256);
    - IP bo'yicha rate limit.
  - **CIMD:**
    - `client_id` — https URL; hujjat olinadi, `client_id` URL'ga aynan teng bo'lishi shart;
    - redirect'lar tekshiriladi, 5 daqiqa kesh, `oauth_clients` ga yoziladi;
    - SSRF himoyasi: ichki IP rad etiladi, redirect'siz, 5 s, 64 KB.
  - **`/oauth/authorize`:**
    - klient yoki redirect noto'g'ri bo'lsa foydalanuvchiga xato sahifasi chiqadi (begona manzilga redirect yo'q);
    - qolgan xatolar `redirect_uri?error=…&state&iss` bilan qaytadi;
    - PKCE S256 majburiy; `resource` (RFC 8707) kanonik ko'rinishda solishtiriladi;
    - sessiya yo'q bo'lsa `/login?next=…` ga yuboriladi (kabinet SPA `/login` ni qo'llaydi, `next` 4000 belgigacha);
    - ruxsat ekrani: ilova nomi, qaytish host'i, faqat loopback bo'lsa ogohlantirish, CSRF (sessiya HMAC), `X-Frame-Options: DENY`, CSP.
  - **`/oauth/token`:**
    - authorization_code: kod bir martalik va 10 daqiqa; redirect_uri, PKCE va resource tekshiriladi;
    - refresh_token: rotation; eski refresh qayta ishlatilsa user va klientning barcha tokenlari bekor qilinadi;
    - access token 1 soat, refresh 30 kun; `Cache-Control: no-store`.
  - **`/oauth/revoke` (RFC 7009);** kabinetda `GET /api/oauth/connections` va `POST /api/oauth/connections/revoke` ("ulangan ilovalar" API'si).
  - **`/mcp` uchun:** `authenticateBearer` (faqat shu resource uchun berilgan access token) va `bearerChallenge`.
  - **DB:** migratsiya `0002_oauth_clients` — `kind`, `token_endpoint_auth_method`, `secret_hash`, `updated_at`.
  - **`lib/rate-limit.ts`:** sirpanuvchi oyna limiter.
- **Tekshiruv:** `oauth.test.ts` 14 ta:
  - metadata;
  - to'liq DCR + PKCE oqimi (sessiyasiz → login `next`);
  - ruxsat sahifasi (HTML escape, host, email), deny, soxta CSRF → 403;
  - kod bir martalik, noto'g'ri verifier va resource;
  - refresh rotation va oilani bekor qilish; access 1 soatdan keyin eskiradi;
  - PKCE va redirect qoidalari; DCR validatsiyasi; confidential klient (Basic);
  - revoke va "ulangan ilovalar";
  - CIMD: loopback port'siz, Claude Code kabi; noto'g'ri yoki yo'q hujjat;
  - SSRF.

  Repo 287 ✅.
- **Keyingi:** P3.02 (`/mcp`)

### 2026-10-05 · P3.02 — `/mcp` (Streamable HTTP) · ✅
- **Qilindi (`src/mcp/`):**
  - **`routes.ts`:**
    - `POST /mcp` stateless rejimda ishlaydi: har so'rovga yangi `Server` va `StreamableHTTPServerTransport`, javob JSON (`enableJsonResponse`), body 4 MB gacha.
    - Bearer token `authenticateBearer` bilan tekshiriladi (faqat shu resource uchun berilgan token). Token yo'q bo'lsa 401 va `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp", scope="mcp"`; yaroqsiz bo'lsa qo'shimcha `error="invalid_token"`.
    - `GET`/`DELETE /mcp` → 405.
    - `onRequest`/`onCall` hook'lari (Claude indikatori va audit uchun).
  - **`server.ts`:**
    - SDK'ning low-level `Server` sinfi ishlatiladi; `inputSchema` zod v4 `z.toJSONSchema` dan olinadi.
    - Argumentlar `parseWith` bilan tekshiriladi (uz locale, JSON Pointer path'lar).
    - Javob yagona `{ok, data|error}` text va ixtiyoriy rasmlar; xatoda `isError`.
    - User bo'yicha rate limit: daqiqasiga 120 ta (`SYS_RATE_LIMIT`, `retry_after_s`).
    - MCP `instructions`: loop qoidalari (env_check → … → report_get).
  - **`registry.ts`** (`ToolDef`, `defineTool`, `ToolContext`) va **`prompts.ts`** (`PromptDef`, ro'yxati P3.09 da to'ldiriladi).
  - Birinchi tool: **`spec_schema`** (JSON Schema va yopiq ro'yxatlar).
  - Bog'liqlik: `@modelcontextprotocol/sdk` 1.32.0 (protokol 2025-11-25).
- **Tekshiruv:** `mcp.test.ts` 6 ta:
  - 401 challenge aniq formatda; yaroqsiz token → `invalid_token`;
  - boshqa resource uchun berilgan token rad etiladi; GET → 405;
  - **SDK `Client` + `StreamableHTTPClientTransport` haqiqiy HTTP orqali:** initialize (instructions, server nomi) → tools/list (annotatsiyalar) → tools/call. Bu MCP Inspector'ga teng sinov;
  - noma'lum tool → `isError` + `SYS_NOT_FOUND`; har tool `inputSchema` obyekt.

  Server bundle SDK bilan yuklanadi. Repo testlari ✅.
- **Keyingi:** P3.03

### 2026-10-05 · P3.03 — Muhit va loyiha toollari · ✅
- **MCP toollari (`src/mcp/tools/`):**
  - **`env_check`:** server, panel online, AE versiyasi, panelda ochiq papka, ffmpeg, ElevenLabs ("Faza 4") va aktiv job. Natija `ready` va `issues[]` (har biri `{code, retryable, hint}`).
  - **`devices_list`:** qurilmalar (online, AE versiyasi, papka, ochiq `.aep`, ffmpeg).
  - **`ae_info`:** yangi tizim opi `info` (read-only, undo group'siz). Qaytaradi: AE versiyasi, ochiq `.aep`, `dirty`, comp'lar (200 tagacha), shrift oilalari. **Q10 yopildi:** `app.fonts` faqat AE 24+ da bor; bo'lmasa `fonts: null` va izoh.
  - **`project_create`:** yangi WS juftligi `project.open` → `project.opened`. Panel mavjud papkada subpapkalarni yaratadi, loyihani ro'yxatdan o'tkazadi va faollashtiradi. Nisbiy yo'l yoki yo'q papka → `ENV_NO_FOLDER`.
  - **`project_list`, `project_get`:** qurilma holati, assetlar xulosasi (tur/holat bo'yicha), plan versiyalari, oxirgi joblar.
  - **`plan_write`:** yangi versiya, xulosa (sahnalar, davomiylik, `asset_refs`). `SPEC_INVALID` aniq JSON Pointer path'lar bilan.
  - **`plan_patch`:** RFC 6902 JSON Patch (`lib/json-patch.ts`: add/remove/replace/move/copy/test, `~0`/`~1`, massiv `-`). Natija yangi versiya; xatoda `op_index` va `path` qaytadi.
  - **`plan_get`:** spec, xulosa va versiyalar ro'yxati.
  - **Umumiy (`common.ts`):** qurilma tanlash (berilgan id, yoki yagona online/yagona qurilma; aks holda `device_id` so'raladi), loyiha egaligi.
- **Panel va agent:**
  - `ae.state` ga `ffmpeg` (agent `ffmpeg -version` / `ffprobe -version` bilan tekshiradi); hub buni saqlaydi.
  - Agent `project.open` ga `openProject` bilan javob beradi.
- **Tekshiruv:**
  - `mcp-tools.test.ts` 9 ta, soxta panel bilan:
    - `env_check`: qurilma yo'q, ready holati, ffmpeg yo'q;
    - bir nechta qurilma → `device_id` so'raladi;
    - `ae_info` online va offline;
    - `project_create`, `project_list`, `project_get`;
    - offline va begona loyiha → `SYS_NOT_FOUND`;
    - plan write/patch/get, `SPEC_INVALID` path'lari;
    - JSON Patch: barcha oplar va xatolar.
  - `jsx-ops-core`: `info` opi (comp'lar, `fonts: null` yoki AE 24+ ro'yxati).
  - `workspace.e2e`: haqiqiy agent bilan MCP `project_create` → diskda papkalar, agent root almashadi; yo'q papka → `ENV_NO_FOLDER`.

  Repo 307 ✅.
- **Keyingi:** P3.04 (fayl toollari)

### 2026-10-05 · P3.04 — Fayl toollari · ✅
- **MCP (`src/mcp/tools/assets.ts`):**
  - **`assets_scan`:** panelga `assets.scan`, javob 90 s gacha kutiladi. So'ng `applyScan` qo'llanadi va qaytadi: holatlar bo'yicha son va muammoli fayllar ro'yxati. Kechiksa `status: running` (kech kelgan javobni umumiy tinglovchi baribir qo'llaydi).
  - **`assets_list`:** key (`asset:<key>`), tur, holat, o'lcham, davomiylik, fps, audio bor-yo'qligi, xato. Tur va holat bo'yicha filtr.
  - **`asset_preview`:**
    - rejimlar: `image` (bitta rasm; videoda 10% dagi kadr) va `frames` (times yoki count, 8 tagacha); `max_px` 128–1280, default 768;
    - oqim: server pre-signed PUT URL'lar beradi (`frames/p<uuid>.jpg`) → panel `asset.preview.request` → ffmpeg → yuklaydi → `asset.preview.ready` → server storage'dan oladi → MCP **image content** (`image/jpeg`, bir javobda 4 MB gacha);
    - xatolar: noma'lum key → `SPEC_UNKNOWN_ASSET`; audio/other → `ASSET_UNSUPPORTED`; buzuq → `ASSET_CORRUPT`; panel yo'q → `ENV_AGENT_OFFLINE`.
  - **`previewImages()`** umumiy yordamchi (P3.06 `frames_capture` ham ishlatadi).
- **Panel (`agent/preview.ts`):**
  - `makePreviews` va `previewTimes`: vaqtlar davomiylik ichiga siqiladi, rasmda vaqt `null`.
  - Yo'l `resolveInsideRoot` bilan tekshiriladi (ish papkasidan tashqariga chiqib bo'lmaydi); vaqtinchalik fayllar o'chiriladi.
- **Shared:** yangi panel xabari `asset.preview.ready`.
- **Tekshiruv:** `mcp-assets.e2e.test.ts` (haqiqiy server, agent va ffmpeg):
  - `previewTimes` birlik testlari;
  - skan → 6 fayl (4 ok, 1 corrupt, 1 unsupported);
  - ro'yxat → 4 ta yaroqli key;
  - rasm preview → 1 ta JPEG (FFD8);
  - video → 3 kadr (0.333/1/1.667 s);
  - xato yo'llari va offline.

  Repo 310 ✅.
- **Keyingi:** P3.05 (qurish toollari)

### 2026-10-05 · P3.05 — Qurish toollari · ✅
- **MCP (`src/mcp/tools/build.ts`):**
  - **`preflight`:** AE'ga tegmaydi. Plan joriy assetlar bilan compile qilinadi. Qaytaradi:
    - `missing[]`: `asset:<key>` + sabab (unknown, corrupt, missing, unsupported);
    - compile xatosi; op soni, sahnalar, umumiy davomiylik;
    - VERIFY uchun `key_times`, ogohlantirishlar;
    - quriladigan `.aep` yo'li (keyingi vNNN) va vaqt bahosi.
  - **`build_start`:** job yaratadi va darhol `job_id` qaytaradi. `dry_run` rejimi (§11.4.2) faqat compile qiladi: op'lar turi bo'yicha, vaqt bahosi, `credits: 0` (audio Faza 4). `JOB_ACTIVE` himoyasi saqlanadi.
  - **`job_status`:** holat, `prev_state`, pauza, progress (done/total/%), xato, patch soni, `.aep` yo'li, oxirgi N log (debug'siz) va `next_step` maslahati (holatga qarab: VERIFY → frames_capture…, BLOCKED → hint + job_resume…, WAITING_AGENT → panelni ochish).
  - **`job_resume`:** BLOCKED → retry, pauza → resume, WAITING_AGENT → tushuntirish (`ENV_AGENT_OFFLINE`).
  - **`job_cancel`:** qurilgan qism o'chirilmaydi, hisobot `cancelled`.
  - **`job_list`:** loyiha bo'yicha yoki hammasi.
  - **`ownJob`:** begona job ko'rinmaydi.
- **Engine:** `compileAssets()` umumiy yordamchi sifatida ajratildi; `nextAepVersion` ochiq qilindi.
- **Tekshiruv:** `mcp-build.test.ts` 5 ta:
  - preflight: unknown/corrupt `missing[]`, so'ng ready (`aep_path`, `key_times`, baho);
  - `dry_run` job yaratmaydi; plan yo'q → `SYS_NOT_FOUND`;
  - `build_start` → VERIFY (100%, `next_step`), ikkinchi → `JOB_ACTIVE`, `job_list`, cancel → DONE;
  - WAITING_AGENT'da resume tushuntiradi; BLOCKED → `job_resume` → VERIFY;
  - begona user hech narsa ko'rmaydi.

  Repo ✅.
- **Keyingi:** P3.06 (VERIFY: kadrlar va patch sikli)

### 2026-10-05 · P3.06 — VERIFY: kadrlar va patch sikli · ✅ (AE'da `saveFrameToPng` 👤)
- **jsx `frames.capture` (`ops/frames.ts`):**
  - Comp op_id bo'yicha topiladi; papka ish papkasi ichida yaratiladi (`Folder.create`).
  - Har vaqt uchun `comp.saveFrameToPng`. Bu API hujjatlashtirilmagan va asinxron, shuning uchun fayl paydo bo'lishi va bo'sh bo'lmasligi `$.sleep` bilan 15 s gacha kutiladi; vaqt comp ichiga siqiladi.
  - Mavjud fayl ustiga yozilmaydi (`AE_BAD_PARAMS`). Undo group ochilmaydi (loyiha o'zgarmaydi).
- **MCP (`src/mcp/tools/verify.ts`):**
  - **`frames_capture`:**
    - faqat VERIFY yoki DONE holatida;
    - vaqtlar default'da PREFLIGHT kalit vaqtlaridan (`engine.keyTimes`), 8 tagacha teng oraliqda;
    - avval job'ning `.aep` fayli `project.open_or_create` bilan ochiladi (ochiq bo'lsa reused), so'ng `frames.capture` (comp `aes.main`, papka `frames/<job>-<stamp>`);
    - har PNG `previewImages` orqali JPEG image content'ga aylanadi; job log'iga `verify.frames` yoziladi.
  - **`verify_approve`:** RENDER → REPORT → DONE.
  - **`verify_patch`:**
    - to'liq spec yoki job planiga nisbatan JSON Patch (bittasi majburiy) va ixtiyoriy `reason` (log'ga);
    - yangi plan versiyasi va yangi `.aep` vNNN; javobda `patches_left`;
    - 4-patch `LOOP_PATCH_LIMIT` (hint: ask_user); noto'g'ri patch `SPEC_INVALID`, `patch_count` oshmaydi.
  - **Q4 yopildi:** patch o'zgargan sahnani joyida tahrirlamaydi. Yangi versiya faylida to'liq qayta quriladi, eski `.aep` saqlanadi. Hech narsa o'chirilmaydi va op to'plami yopiq qoladi.
  - Engine'ga ochiq `note()` va `keyTimes()` qo'shildi.
- **Mock AE:** `Folder`, `$.sleep`, `File.length`, `CompItem.saveFrameToPng`, `frameDuration`; `realDisk` rejimi (e2e uchun PNG haqiqiy diskka yoziladi).
- **Tekshiruv:**
  - `jsx-ops-core`: `frames.capture` (yozish, siqish, qayta yozmaslik, `AE_NOT_FOUND`, `ASSET_OUTSIDE_ROOT`, undo yo'q).
  - `mcp-verify.test.ts` 6 ta:
    - `sampleTimes`;
    - kalit vaqtlardagi kadrlar → rasmlar; job fayli ochiladi; log yoziladi; maxsus `times`;
    - VERIFY bo'lmagan job → `JOB_BAD_ACTION`;
    - approve → DONE;
    - **3 ta patch o'tadi (v002/v003/v004), 4-chisi `LOOP_PATCH_LIMIT`** — todo'ning "Tayyor" sharti;
    - noto'g'ri patch va spec+patch birga.
  - `job.e2e`: haqiqiy agent, ES3 bundle (mock) va ffmpeg bilan `frames_capture` → diskda PNG → Claude'ga JPEG (FFD8).

  Repo ✅.
- **👤 AE'da:** `saveFrameToPng` haqiqiy AE'da PNG yozishi va kutish mantig'i tekshirilsin.
- **Keyingi:** P3.07 (RENDER)

### 2026-10-05 · P3.07 — RENDER · ✅ (haqiqiy aerender 👤)
- **Q5 yopildi:** asosiy usul `aerender` (AE UI bloklanmaydi), zaxira — AE Render Queue (jsx `render.queue`).
- **Oqim:** AE oraliq faylni render qiladi, panel uni ffmpeg bilan preset bo'yicha MP4 ga o'giradi. Natija `out/<output.name>_vNNN.mp4`; mavjud bo'lsa `_2`, `_3`…, ffmpeg `-n` bilan — hech narsa ustiga yozilmaydi.
- **Shared:**
  - `render.ts`: `RENDER_PRESETS` (`h264_social` ~8 Mbit/s, `h264_hq` ~20 Mbit/s, AAC, yuv420p, faststart) va `durationMatches` (±1 kadr + 10 ms).
  - WS: `render.request` (server → panel), `render.done` (panel → server); `OutputPreset` tipi.
- **jsx:**
  - `render.queue` (zaxira): faqat shu element render qilinadi; boshqa navbat elementlari vaqtincha o'chirilib, keyin tiklanadi; qo'shilgan element olib tashlanadi; loyiha o'z fayliga saqlanadi. Natija `RQItemStatus.DONE` emas bo'lsa → `RENDER_FAILED`.
  - `ping` endi `app_path` (`Folder.appPackage`) qaytaradi.
- **Agent (`agent/render.ts`):**
  - aerender qidirish tartibi: sozlama, keyin AE papkasi (Windows `<app>/aerender.exe`, macOS `.app` yonida).
  - `.js`/`.mjs` o'rab oluvchi skriptlar Node bilan ishga tushadi (test va maxsus holatlar uchun). `PROGRESS` qatorlari 10% qadam bilan log'ga yoziladi.
  - Oraliq papka `out/.render-<id>` (keyin o'chiriladi); unda eng katta fayl olinadi, chunki AE kengaytmani o'zi qo'yishi mumkin.
  - **Encoder tanlovi:** libx264 → h264_mf → libopenh264 → h264_videotoolbox → h264_nvenc → mpeg4. Bu kompyuterdagi LGPL build'da `h264_mf` tanlandi va ishladi.
  - Natija ffprobe bilan tekshiriladi. Bir vaqtda bitta render.
  - Yangi sozlamalar: `aerender_path`, `render_om_template`.
- **Server:**
  - **Engine `RENDER` holati:** `renders` qatori yaratiladi (running) → panelga `render.request` (timeout davomiylikka qarab).
    - **Gate:** davomiylik PREFLIGHT natijasidagi qiymatga ±1 kadr. Mos kelmasa `RENDER_DURATION_MISMATCH`, panel xatosida `RENDER_FAILED` → BLOCKED (`job_resume` qayta render qiladi).
    - Panel uzilsa `WAITING_AGENT`, qaytganda qayta render.
  - **`renderAgain`:** DONE job'ni fonda qayta render qiladi (`idle()` uni ham kutadi).
  - **DB:** migratsiya `0003_renders` — `size_bytes`, `method`, `encoder`, `error`, `updated_at`.
  - **Hisobot:** `Video: out/…mp4 (s, MB, preset)` qatorlari qo'shildi.
- **MCP:**
  - `render_presets`;
  - `render_start` (faqat DONE job, fonda, boshqa preset bilan ham);
  - `job_status` endi `renders[]` qaytaradi.
- **Tekshiruv:**
  - `render.test.ts` 6 ta (soxta panel):
    - `durationMatches`;
    - approve → to'g'ri `render.request` → done → hisobot;
    - mos kelmagan davomiylik → BLOCKED → `job_resume` → DONE;
    - panel xatosi → `RENDER_FAILED`;
    - render paytida uzilish → WAITING → qayta render;
    - `render_presets`/`render_start` (DONE emas → xato, offline → xato).
  - `render.e2e.test.ts` 4 ta (haqiqiy agent va ffmpeg):
    - soxta aerender → `out/promo_v001.mp4`, ffprobe davomiyligi ±1 kadr, oraliq papka o'chirilgan; qayta render → `promo_v001_2.mp4`;
    - davomiylik farqi → BLOCKED;
    - aerender yo'q → Render Queue zaxirasi.
  - `job.e2e` va `prod.smoke` endi render bilan yakunlanadi.
  - `jsx-ops-core`: `render.queue` (navbatni tiklash, olib tashlash, `RENDER_FAILED`).

  Repo 335 ✅, panel build ✅.
- **👤 AE'da:** haqiqiy `aerender` (AE 2022+) va output module default'i (AE 23+ da H.264) bilan oraliq fayl; kerak bo'lsa `render_om_template` sozlamasi.
- **Keyingi:** P3.08 (report_get, Tarix ekrani, Claude indikatori)

### 2026-10-05 · P3.08 — To'liq REPORT va Tarix ekrani · ✅ (AE'da ko'rish 👤)
- **MCP:**
  - **`report_get`:** yakuniy markdown, outcome, `.aep` yo'li, tayyor videolar. REPORT'gacha `JOB_BAD_ACTION` (holat bilan).
  - Hisobot P3.07 dan beri `Video: out/…mp4` qatorlarini ham o'z ichiga oladi.
- **Claude indikatori (`mcp/presence.ts`):**
  - `linked`: user'da faol OAuth access yoki refresh token bor; `last_seen_at`: oxirgi MCP so'rovi.
  - Server bu holatni panelga ikki holatda yuboradi: `hello` paytida va MCP so'rovida (30 s da ko'pi bilan bir marta).
  - Yangi WS xabari: `claude.status`.
- **Panel endpointlari (qurilma tokeni, faqat o'z joblari):**
  - `GET /api/agent/jobs` (loyiha nomi, `.aep` yo'li, renderlar);
  - `GET /api/agent/jobs/:id/report`;
  - `POST /api/agent/jobs/:id/render` (qayta render, preset bilan).
- **Panel:**
  - **Agent:** `claude` store, `history()`, `jobReport()`, `renderAgain()`.
  - **`claude.ts`:** `claudeIndicator` sof modul — UI uni Node kodisiz import qiladi (UI bundle'ga agent tushmaydi).
  - **`History.tsx`:** joblar ro'yxati (natija belgisi, holat, plan versiyasi, vaqt, `.aep`, video), hisobotni ochish/yopish, DONE job uchun "Qayta render", yangilash tugmasi.
  - **Holat qatori:** Claude 🟢 — faol (15 daqiqa ichida chaqiruv) yoki ulangan; 🔴 — ulanmagan.
- **Tekshiruv:**
  - `history.test.ts` 4 ta:
    - `claude.status`: hello'da ulanmagan, MCP'dan keyin `linked` + vaqt, 30 s throttle;
    - `report_get` REPORT'gacha va keyin;
    - Tarix, hisobot va qayta render qurilma tokeni bilan; noto'g'ri preset; tokensiz → 401;
    - boshqa qurilma begona job'ni ko'rmaydi.
  - `live.test.ts`: `claudeIndicator`.
  - `job.e2e`: haqiqiy agent bilan `history()`, `jobReport()` va Claude store (`linked`).

  Panel build ✅. Repo testlari ✅.
- **Keyingi:** P3.09 (MCP prompt `/new-reel`)

### 2026-10-05 · P3.09 — MCP prompt `/new-reel` · ✅
- **Qilindi (`src/mcp/prompts.ts`):** `new-reel` prompti (audio'siz).
  - **Argumentlar:** `brief` (majburiy), `folder`, `format` (9:16 default, 1:1, 16:9), `duration`.
  - **Matn:** Claude'ga to'liq loop yo'riqnomasi:
    1. env_check;
    2. loyiha → assets_scan/list → asset_preview;
    3. spec_schema → sahna rejasi (hook → fikrlar → CTA, qisqa matnlar);
    4. foydalanuvchidan tasdiq → plan_write;
    5. preflight → build_start;
    6. job_status polling;
    7. VERIFY: frames_capture, tanqidiy tekshiruv, verify_patch (≤3) yoki verify_approve;
    8. report_get.

    Shuningdek: audio hali yo'q, hech narsa o'chirilmaydi, foydalanuvchi tilida gaplashish.
  - `prompts/list` va `prompts/get` handlerlari P3.02 dan beri bor.
- **Tekshiruv:** `mcp.test.ts`:
  - `/new-reel`: ro'yxatda; argumentlar matnga tushadi (format o'lchami, davomiylik, papka); default'lar; noma'lum prompt → xato.
  - Prompt va server `instructions`ida tilga olingan har bir tool haqiqatda mavjud (avtomatik solishtirish — keyinchalik nom o'zgarsa test yiqiladi).

  Repo 343 ✅.
- **Keyingi:** P3.10 (xavfsizlik)

### 2026-10-05 · P3.10 — Xavfsizlik · ✅
- **Rate limit:**
  - MCP: user bo'yicha 120 ta/daqiqa (P3.02).
  - OAuth: `/oauth/register` IP bo'yicha 30 ta/soat, `/oauth/token` 120 ta/daqiqa (P3.01).
  - **Yangi:** `POST /api/auth/magic-link`, `/oauth/device/code`, `/api/devices/confirm` — IP va yo'l bo'yicha 10 daqiqada 30 ta; oshsa 429 va `Retry-After`. Magic link'ning har email uchun 30 s chegarasi saqlanadi.
- **Server tomonida yo'l tekshiruvi:**
  - `asset_preview`/`frames_capture` panelga yuborishdan oldin yo'l `resolveProjectPath` (ish papkasi ichida) bilan tekshiriladi → `ASSET_OUTSIDE_ROOT`.
  - Qolgan yo'llar server tomonidan yasaladi va papka ichida bo'ladi: kadrlar papkasi, `out_base` (`fileBase`), `.aep` (`aepPath`). Panel jsx ham alohida tekshiradi (ikki qatlam).
- **Token revoke UI:** kabinetda yangi "Ulangan ilovalar" sahifasi (`/connections`) — ilovalar (nomi, qaytish host'lari, faol tokenlar), "Uzish" tugmasi (user+klient tokenlari bekor), Claude connector URL'i bo'yicha yo'riqnoma.
- **Presigned URL muddati:** 15 daqiqa (`PRESIGN_TTL_S`). Muddati o'tgan imzo 403 qaytaradi (`storage.test` allaqachon qamraydi). MCP rasmlar URL emas, base64 sifatida beriladi.
- **Audit jurnali (`audit_log` jadvali, migratsiya `0004`; §5 ga qo'shimcha):**
  - `audit()` yordamchisi; yozish xatosi asosiy amalni to'xtatmaydi.
  - **Yoziladigan hodisalar:**
    - `device.approved`/`denied`/`revoked`;
    - `oauth.authorized`/`denied`/`revoked`;
    - `oauth.refresh_reuse` (system);
    - Claude'ning o'zgartiruvchi MCP chaqiruvlari (`mcp.<tool>`, `{ok}`; `readOnlyHint` toollar yozilmaydi).
  - Kabinet: `GET /api/audit` (faqat o'z yozuvlari, 100 ta) va "Faollik" bo'limi.
- **Tekshiruv:**
  - `security.test.ts` 4 ta:
    - qurilma audit'i, begona audit ko'rinmaydi, sessiyasiz 401;
    - MCP audit faqat o'zgartiruvchi toollar uchun;
    - device code rate limit → 429 + `Retry-After`, oyna o'tgach tiklanadi;
    - `asset_preview` `../../secret.jpg` → `ASSET_OUTSIDE_ROOT`, panelga hech narsa ketmaydi.
  - `oauth.test`: authorized → refresh_reuse → revoked tartibi.
  - `db.test`: 17 + `audit_log`.

  Web build ✅. Repo testlari ✅.
- **Keyingi:** P3.11 (Claude'ga ulash: deploy + tayyorgarlik)

### 2026-10-05 · P3.11 — Claude'ga ulash · ⚠️ server tayyor, Claude UI'da ulash 👤
- **Deploy:** Railway'ga P3.01–P3.10 bilan deploy qilindi; migratsiyalar 0002–0004 qo'llandi. `/health` → db ok, redis ok.
- **Production'da avtomatik tekshirildi** (`apps/server/scripts/oauth-smoke.mjs` — Claude connector'ning qadamlari bilan, foydalanuvchi sessiyasi orqali):
  1. `POST /mcp` tokensiz → 401 + `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp", scope="mcp"`.
  2. PRM: `resource` = `https://server-production-9c75.up.railway.app/mcp`. AS metadata: S256, CIMD=true.
  3. DCR: Claude callback'i `https://claude.ai/api/mcp/auth_callback` bilan → ruxsat ekrani → kod (state mos) → token (form-urlencoded, `expires_in` 3600, scope `mcp offline_access`).
  4. MCP SDK klient HTTPS orqali: initialize (`ae-studio 0.1.0`), 25 ta tool, `new-reel` prompti, `env_check`.
  5. Refresh rotation; kabinetdan uzish → eski token 401.

  Sessiyasiz authorize → 303 `/login?next=/oauth/authorize?…`; `/login` SPA 200.
- **Yo'riqnoma:** `docs/claude-connector.md` (oldindan kerak bo'lganlar, ulash qadamlari, tekshirish, uzish, texnik jadval).
- **👤 Qoldi:**
  - Claude Settings → Connectors → Add custom connector → URL → login → ruxsat; web, desktop va telefondan tekshirish.
  - **Bloker:** magic link xati hozir yuborilmaydi (`RESEND_API_KEY` yo'q), shuning uchun foydalanuvchi o'zi kira olmaydi. `RESEND_API_KEY` va `MAIL_FROM` Railway'ga qo'shilishi kerak.
- **Keyingi:** P3.12 (Faza 3 gate)

### 2026-10-05 · P3.12 — 🧪 Faza 3 gate · ⚠️ kod va prod qismi ✅, haqiqiy Claude/AE bandlari 👤
- **Gate stsenariysi (`apps/panel/test/reel-scenario.ts`)** faqat MCP toollari orqali, Claude qiladigan ketma-ketlikda:
  1. `project_create` → `env_check` (ready, papka mos).
  2. `assets_scan` → `assets_list` → `asset_preview` (rasm).
  3. `spec_schema` → `plan_write` (**ataylab xato:** CTA 0.5 s va "Obuna boling") → `preflight` (ready) → `build_start`.
  4. `job_status` polling → VERIFY → `frames_capture` (rasmlar) → `verify_patch` (JSON Patch: dur 2, "Obuna bo'ling!", sabab bilan) → yangi `.aep` v002 → `frames_capture`.
  5. `verify_approve` → RENDER → DONE → `report_get`: `out/gate_v002.mp4`, davomiylik ±1 kadr, "Patch'lar: 1".
- **Lokal (`gate3.e2e.test.ts`):** haqiqiy server, device flow, agent, ffmpeg, ES3 bundle (mock AE, kadrlar diskda) va soxta aerender.
  - ffprobe: MP4 4 s.
  - v001 va v002 `.aep` ikkalasi saqlangan; `.aestudio/plan.v002.json` va `report.v002.md` bor.
- **Production (`prod.gate3.smoke.test.ts`)** — haqiqiy Claude connector oqimi bilan olingan token:
  - oqim: DCR → ruxsat ekrani → PKCE → `https://server-production-9c75.up.railway.app/mcp` (JSON-RPC);
  - agent shu kompyuterda (device flow bilan ulangan);
  - natija ✅: job `a0ba9900…`, 12 kadr Claude'ga image content sifatida, 1 patch, `out/gate_v002.mp4` 4.02 s (`h264_social`), 21/21 op, hisobot;
  - tozalash: OAuth ulanishi va qurilma bekor qilindi (kabinetda ulanishlar bo'sh).
- **Gate davomida topilgan va tuzatilgan xato:**
  - **Muammo:** panel AE holatini hali yubormagan paytda `env_check` "AE yopiq" deb qaytarardi.
  - **Agent tomoni:** AE holati ping'dan keyin darhol yuboriladi, ffmpeg tekshiruvi alohida keyin keladi. `project_create` javobi esa `ae.state` dan keyin yuboriladi, shuning uchun tartib kafolatlangan.
  - **Server tomoni:** `env_check` AE versiyasi noma'lum bo'lsa AE'ni jonli `ping` qiladi. Test bilan qoplangan.
- **Gate bandlari:**
  - ✅ **brief → video → hisobot:** prod MCP orqali, skriptlangan "Claude" bilan.
  - ✅ **Kadrlarni ko'rib patch qilish.**
  - ✅ **`/out` da mp4, davomiylik mos.**
  - 👤 **Claude UI'da custom connector:** server tomoni prod'da ✅; `RESEND_API_KEY` kerak, ulash qadamlari `docs/claude-connector.md` da.
  - 👤 **Haqiqiy AE'da:** `saveFrameToPng`, aerender, Live/Undo.
- **Faza 3 yakuni:** P3.01–P3.10 ✅; P3.11 va P3.12 ning server, kod va prod qismi ✅. Repo 350 test ✅ (2 ta prod smoke qo'lda ishga tushiriladi).
- **Keyingi:** Faza 4 — P4.01 (ElevenLabs kaliti 👤)

### 2026-10-05 · P4.01 — Kalit va xavfsizlik · ✅ (haqiqiy kalit 👤)
- **Manbalar:** ElevenLabs rasmiy API reference (TTS with-timestamps, STT, forced alignment, SFX, music + plan, dialogue, dubbing + status + audio, voice design, IVC, STS, isolation, pronunciation dictionaries, user/subscription, models).
- **Q7 yopildi:** o'zbekcha TTS faqat `eleven_v4` va `eleven_v4_turbo` da (v3 va multilingual_v2 da yo'q). STT `scribe_v2` o'zbekchani "Good" darajada (WER 10–20%) qo'llaydi.
- **Qilindi:**
  - **`eleven/client.ts`:** yupqa `fetch` klient (SDK o'rniga); `xi-api-key`; har so'rovga timeout.
    - Xato xaritasi: 401 → `EL_AUTH`, 402/kvota → `EL_QUOTA`, 429 → `EL_RATE_LIMIT`, 5xx/tarmoq → `EL_TIMEOUT`, boshqa 4xx → `EL_BAD_PARAMS`.
    - 429/5xx da 3 marta exponential backoff (0.5/1/2 s).
    - `ELEVENLABS_BASE_URL` env (regional server yoki test).
  - **`secrets.ts`:** AES-256-GCM (`MASTER_KEY`), `save/read/delete`, `…abcd` niqob.
  - **`eleven/service.ts` (`ctx.eleven`):**
    - kalitni `GET /v1/user/subscription` bilan tekshirib saqlash (noto'g'ri kalit saqlanmaydi);
    - obuna 60 s kesh; holat: tarif, ishlatilgan/limit, qoldiq, yangilanish sanasi;
    - user bo'yicha 60 chaqiruv/daqiqa;
    - panelga yangi WS xabari `elevenlabs.status` (hello'da va kalit o'zgarganda).
  - **Web kabinet → Sozlamalar → ElevenLabs:** kalit maydoni (password), holat, almashtirish, o'chirish. Kalit javobda hech qachon qaytmaydi. Audit: `elevenlabs.key_set` va `key_removed`.
  - **CHECK:** spec ElevenLabs talab qilsa (`audioUsesEleven`) — kalit yo'q → `EL_AUTH`, hisob xatosi → o'sha kod, kvota 0 → `EL_QUOTA` (BLOCKED).
  - **`env_check`:** `checks.elevenlabs` (configured, ok, tier, qolgan belgilar, hint).
  - **Panel:** holat qatorida ElevenLabs 🟢 (qoldiq bilan), 🔴 kalit yo'q yoki xato.
- **Tekshiruv:**
  - Soxta ElevenLabs (`test/helpers/fake-eleven.ts`): rasmiy yo'llar va javob shakllari; audio sifatida haqiqiy WAV.
  - `eleven-settings.test.ts` 5 ta:
    - kalit oqimi (noto'g'ri → saqlanmaydi; to'g'ri → shifrlangan, javobda yo'q, audit; o'chirish; sessiyasiz 401);
    - GCM buzilgan shifr ochilmaydi;
    - xato xaritasi; retry (429×2 → muvaffaqiyat; 5xx → 3 qayta urinish; 422 → retry'siz);
    - CHECK (`EL_AUTH`, `EL_QUOTA`), `env_check` holati, panelga `elevenlabs.status`.

  Repo 356 ✅.
- **Keyingi:** P4.02 (imkoniyatlar qatlami)

### 2026-10-05 · P4.02 — `eleven/` klient qatlami · ✅
- **Qilindi:** imkoniyatlar oilalar bo'yicha 4 faylda, har imkoniyat alohida funksiya; yo'l va maydonlar rasmiy API reference bo'yicha.
  - **`tts.ts`:** `POST /v1/text-to-speech/{voice_id}/with-timestamps`. Javob: `audio_base64`, `alignment`, `normalized_alignment` (belgi vaqtlari); `output_format=mp3_44100_128`.
  - **`generate.ts`:**
    - dialogue — `/v1/text-to-dialogue`, default model `eleven_v3`;
    - SFX — `/v1/sound-generation`, `eleven_text_to_sound_v2`, 0.5–30 s;
    - music — `/v1/music` (`prompt` + `music_length_ms` + `force_instrumental`, yoki `composition_plan`; ikkalasi birga emas);
    - composition plan — `/v1/music/plan`.
  - **`analyze.ts`:**
    - STT — `/v1/speech-to-text`, `scribe_v2`, so'z darajasidagi vaqtlar, diarization, audio eventlar;
    - forced alignment — `/v1/forced-alignment`, file + text → characters, words, loss;
    - isolation — `/v1/audio-isolation`.
  - **`voice.ts`:**
    - STS — `/v1/speech-to-speech/{voice_id}`, `eleven_multilingual_sts_v2`;
    - dubbing: create → `GET /v1/dubbing/{id}` (dubbing | dubbed | failed) poll → `GET …/audio/{lang}`; timeout 30 daqiqa;
    - voice design — `/v1/text-to-voice/design` va saqlash `/v1/text-to-voice`;
    - IVC — `/v1/voices/add`;
    - ro'yxatlar — `/v2/voices`, `/v1/models`;
    - pronunciation — `/v1/pronunciation-dictionaries/add-from-rules`.
  - **`audio.ts`:** `sniffAudio` (fayl turi baytlardan: wav, mp3, ogg, m4a), multipart `formWith`.
  - Xato xaritasi va retry (P4.01) hamma joyda bir xil; user bo'yicha rate limit `ElevenService.client()` da.
- **Tekshiruv:** `eleven-capabilities.test.ts` 6 ta — har imkoniyat soxta API'ga to'g'ri yo'l, query, JSON yoki multipart maydonlar bilan boradi va javob to'g'ri o'qiladi. Dubbing: 3 poll → audio; timeout → `EL_TIMEOUT`. `sniffAudio` tekshirildi.
- **Keyingi:** P4.03 (`audio_task` va navbat)

### 2026-10-05 · P4.03 — `audio_task` va navbat · ✅
- **Qaror (rejadan chetga chiqish):** alohida `apps/worker` (BullMQ) o'rniga server ichidagi navbat; holat Postgres'da.
  - Railway'da bitta server nusxasi ishlaydi. `jobs`/`audio_tasks` allaqachon yagona haqiqat manbai.
  - Server qayta ishga tushsa `recover()` tugallanmagan vazifalarni qayta navbatga qo'yadi.
  - Testlar PGlite bilan ishlaydi (Redis kerak emas). Concurrency 2.
- **Qilindi (`src/audio/service.ts`, `ctx.audio`):**
  - **Oqim:** `kind + params (+ kirish fayllarining sha256)` → kanonik JSON → `params_hash` → `eleven_cache`.
    - Hit bo'lsa: darhol `done`, `cached`, 0 kredit.
    - Miss bo'lsa: `queued` → `running` (CAS) → ElevenLabs → audio storage'ga (`audio-out/<sha256>.<ext>`, tarkibga bog'liq) → kesh upsert → `done` → panelga yetkazish.
  - **Turlar:** tts, dialogue, sfx, music, stt, align, isolate, voice_change, dub, voice_design (P4.05–P4.08 toollari shu navbatni ishlatadi).
  - **Yetkazish:** panel online bo'lsa `file.download` → `audio/<kind>_<sha12>.<ext>` (sha256 tekshiruvi, mavjud fayl ustiga yozilmaydi) → `file.saved` → `local_path`, `delivered_at`.
    - Panel offline bo'lsa natija storage'da kutadi va `hello` da `deliverPending` yetkazadi.
    - Davomiylik noma'lum bo'lsa (SFX/dialogue) panel ffprobe natijasidan olinadi (`file.saved.duration_s`) va keshga ham yoziladi.
  - Kesh kalitida kirish fayllarining sha256 ham bor; `fresh: true` keshni chetlab o'tadi (qayta generatsiya). `retry()` faqat `failed` vazifa uchun, `skip(reason)`.
  - Kredit bahosi (`estimate.ts`, taxminiy): TTS — belgilar (flash/turbo 0.5×), SFX ~40/s, music ~10/s, isolate/STS ~1000/min, dub ~3000/min.
  - **DB:** migratsiya `0005` — `audio_tasks` ga user_id, project_id, label, inputs, content_type, ext, sha256, delivered_at, cached, result qo'shildi; `job_id` nullable. `eleven_cache` ga content_type, ext, sha256, credits, result; `storage_key` nullable.
  - **WS:** `audio.update` (server → panel, Audio ekrani uchun); `file.saved.duration_s`.
  - **MCP:** `audio_tasks_status` (id'lar, job yoki loyiha bo'yicha; natija qisqartiriladi).
- **Tekshiruv:** `audio-tasks.test.ts` 6 ta:
  - kanonik hash;
  - TTS → storage → panelga `audio/tts_<sha>.wav` (alignment'dan 1.08 s);
  - qayta chaqiruv → `cached`, 0 kredit, yangi EL so'rovi yo'q; `fresh` → yangi so'rov;
  - offline → hello'da yetkaziladi, davomiylik paneldan (0.8 s) va keshga;
  - kalit yo'q → `EL_AUTH` → kalit kiritilgach retry → done;
  - `recover()`; MCP holat tooli.

  Repo 369 ✅.
- **Keyingi:** P4.04 (panel: audio ajratish → `audio-in`)

### 2026-10-05 · P4.04 — Panel: audio ajratish · ✅
- **Panel (`agent/extract.ts`):** `audio.extract.request` qabul qilinganda:
  1. Yo'l `resolveInsideRoot` bilan tekshiriladi; fayl bo'lmasa `ASSET_MISSING`.
  2. ffprobe: ovoz yo'q → `ASSET_UNSUPPORTED`.
  3. ffmpeg: `-vn`, mono, ixtiyoriy sample rate. Formatlar: opus (libopus 32 kbit/s, `.ogg`), wav (pcm_s16le), mp3 (libmp3lame 96 kbit/s).
  4. Pre-signed PUT, 3 marta qayta urinish → `file.uploaded` (sha256, hajm, `duration_s`). Vaqtinchalik fayllar o'chiriladi.
- **"Resumable multipart" o'rniga:** bitta PUT + 3 urinish. Ovoz oldin mono Opus'ga siqiladi (~15 MB/soat), shuning uchun bitta so'rov yetarli. Qarorlar jurnaliga yozildi.
- **Server (`audio/inputs.ts` → `extractInput`):**
  - panel online va yo'l loyiha ichida ekani tekshiriladi;
  - `audio-in/in<uuid>.<ext>` pre-signed PUT → panel → storage'da borligi tasdiqlanadi → `InputRef` (`name`, `storage_key`, `sha256`, `duration_s`).
  - `sha256` audio vazifa kesh kalitiga kiradi (bir xil manba → qayta generatsiya yo'q).
- **Shared:** `file.uploaded.duration_s`.
- **Tekshiruv:** `audio-extract.e2e.test.ts` (haqiqiy server, agent va ffmpeg):
  - `Clip 01.mp4` → `audio-in/…ogg` (OggS sarlavha), sha256 storage'dagi baytlarga mos, davomiylik ~2 s;
  - ovozsiz `.mov` → `ASSET_UNSUPPORTED`; `../secret.mp4` → `ASSET_OUTSIDE_ROOT`; wav formati.

  Repo ✅.
- **Keyingi:** P4.05 (TTS, ovozlar, narx toollari)

### 2026-10-05 · P4.05 — TTS, ovozlar, narx · ✅
- **MCP toollari (`mcp/tools/eleven-voice.ts`):**
  - **`el_tts`:**
    - so'z vaqtlari bilan; default model `eleven_v4` (o'zbekcha uchun);
    - til, voice_settings, talaffuz lug'atlari (slug → locator), `fresh`, `wait_s` (≤55 s; 0 — darhol `task_id`);
    - natija loyihaning `audio/` papkasiga yetkaziladi; bir xil parametr → kesh, 0 kredit.
  - **`el_voices`** (qidiruv), **`el_models`** (til bo'yicha filtr + "o'zbekcha → eleven_v4" eslatmasi).
  - **`el_pronunciation`:**
    - qoidalar: `{word, alias}` yoki `{word, phoneme, alphabet}` → ElevenLabs `add-from-rules`;
    - yangi jadval `pronunciation_dicts` (migratsiya `0006`, slug → el_id/version_id); qoidasiz chaqirilsa ro'yxat.
  - **`el_usage`:** tarif, ishlatilgan, qolgan, yangilanish sanasi.
  - **`el_estimate`:** plan yoki items bo'yicha taxminiy kredit, qolgan kvota bilan solishtiriladi; oshsa `fits:false`, `ask_user:true` va hint.
  - **`build_start` dry_run:** endi `credits` va `audio` bo'limini ham qaytaradi.
- **`audio/plan.ts` (`planAudioTasks`):** spec `audio` → vazifalar ro'yxati (bahoda ham, AUDIO holatida ham ishlatiladi):
  - voiceover: tts / dialogue / asset+text → align;
  - music: `match_video` → video uzunligi, 3–600 s ga siqiladi;
  - SFX (prompt bilan);
  - source_audio: isolate va STT.
- **Umumiy (`eleven-common.ts`):** `runTask` (yuborish + kutish; xatoda `task_id` bilan), `inputFromAsset` (asset → panel ajratadi → `audio-in`), `dictionaries`, `direct` (navbatsiz chaqiruv).
- **Tekshiruv:** `eleven-tools.test.ts` (P4.05 bo'limi, 5 ta):
  - kalitsiz `EL_AUTH`; `el_usage`;
  - `el_tts` (model va til so'rovga boradi, `audio/` ga yetkaziladi, qayta → kesh);
  - lug'at yaratish → TTS'da locator; noma'lum lug'at;
  - ovozlar va modellar (uz → `eleven_v4`);
  - `el_estimate` (tts 16 + music 95 + sfx 32 = 143), kvota oshsa `ask_user`; `dry_run` krediti.

### 2026-10-05 · P4.06 — Generatsiya · ✅
- **MCP (`mcp/tools/eleven-generate.ts`):**
  - **`el_dialogue`:** bir nechta ovoz, `eleven_v3`.
  - **`el_sfx`:** prompt, 0.5–30 s, loop, prompt_influence.
  - **`el_music`:** prompt + aniq `duration_s` (3–600) + instrumental, yoki el_music_plan'dan `composition_plan`. Ikkalasi birga → `SYS_BAD_REQUEST`.
  - **`el_music_plan`:** global uslublar + aniq davomiylikli bo'limlar; Claude tahrirlab `el_music` ga beradi.
  - Hammasi `audio_task` navbati orqali: kesh, storage, `audio/` ga yetkazish.
- **Tekshiruv (P4.06 bo'limi):**
  - dialog va SFX (davomiylik 1.2 s);
  - plan (2 bo'lim, 20 s) → shu plan bo'yicha musiqa 20 s;
  - prompt bo'yicha musiqa 12 s (`music_length_ms` 12000, instrumental);
  - prompt + plan birga → xato.

### 2026-10-05 · P4.07 — Tahlil · ✅
- **MCP (`mcp/tools/eleven-analyze.ts`):**
  - **`el_stt`:** Scribe (`scribe_v2`), til, diarize, num_speakers. Panel asset'dan ovozni ajratadi (`audio-in`, sha256 kesh kalitida).
  - **`el_align`:** ma'lum matn + yozilgan ovoz → so'z vaqtlari.
  - **`el_isolate`:** toza ovoz (yangi fayl `audio/` da).
  - **`transcript_get`:** so'zlar, start/end, speaker; tahrirlangan versiya ustun turadi.
  - **`transcript_edit`:** so'zlarni vaqtlarni o'zgartirmasdan tuzatadi (`words: [{index, text}]` yoki so'zlar soni bir xil to'liq matn) → `result.transcript_edited`. Subtitrlar shu versiyani ishlatadi.
  - Rasm yoki boshqa tur → `ASSET_UNSUPPORTED`.
- **Soxta panel:** `audio.extract.request` → storage'ga WAV va `file.uploaded`.
- **Tekshiruv (P4.07 bo'limi):**
  - STT (panel aynan shu faylni ajratadi; til va diarize so'rovga boradi) → `transcript_get` (4 so'z);
  - indeks bo'yicha tahrir (vaqt saqlanadi), to'liq matn bo'yicha tahrir; so'zlar soni mos kelmasa xato;
  - alignment, isolation; rasm → xato.

### 2026-10-05 · P4.08 — Ovozni o'zgartirish · ✅
- **MCP (`mcp/tools/eleven-transform.ts`):**
  - **`el_voice_change`:** STS, `remove_background_noise`.
  - **`el_dub`:** yaratish → status poll (30 daqiqagacha, navbatda) → dublyaj audiosi `audio/` ga; uzun media uchun `wait_s: 0`.
  - **`el_voice_design`:** tavsifdan namunalar. Birinchi namuna eshitish uchun `audio/` ga tushadi, hammasi `result.previews` da. `save: {generated_voice_id, name}` → `voice_id`.
  - **`el_voice_clone`:** `consent: true` majburiy (zod literal); aks holda rad etiladi. Namunalar panel ajratgan ovozdan olinadi. Audit jurnaliga `mcp.el_voice_clone` yoziladi.
- **Tekshiruv (P4.08 bo'limi):**
  - voice change; dubbing (2 poll → audio, `dubbing_id`);
  - voice design (2 namuna) va saqlash (`designed_gen_2`);
  - klon: `consent:false` → rad, `true` → `cloned_1`, audit'da bor.

  `eleven-tools.test.ts` 8/8, repo 378 ✅.
- **Keyingi:** P4.09 (AUDIO holati)

### 2026-10-05 · P4.09 — AUDIO holati · ✅
- **Engine `audioStep`:**
  1. Spec `audio` → `planAudioTasks`. Vazifa bo'lmasa `audio.skipped` (asset audio bo'lsa ham `audio.ready` yoziladi).
  2. **Kvota gate:** taxminiy kredit (asset davomiyliklari bilan) qolgan kvotadan oshsa → BLOCKED `EL_QUOTA`, `details.ask_user: true`, generatsiya boshlanmaydi.
  3. **Birinchi bosqich:** voiceover (tts / dialogue / asset+align), SFX, manba audio (isolate, STT). Kirish fayllarini panel ajratadi (`extractInput`). Vazifalar job'ga bog'langan (`job_id`).
  4. **Natija:** SFX xatosi → `skipped(sabab)` va ogohlantirish; voiceover/musiqa/manba xatosi → BLOCKED (`task_id` va `role` bilan).
  5. **TTS-first timing** (`planTiming`) → video uzunligi → ikkinchi bosqich: musiqa `match_video` aniq shu uzunlikda.
  6. Hamma fayllar panelga yetkazilishi shart (panel uzilsa → WAITING_AGENT).
  7. **`audio.ready` hodisasi** (plan versiyasi bilan): compile uchun fayllar va so'z vaqtlari, vazifalar, kesh soni, davomiylik.
- **Patch** endi AUDIO'dan qayta boshlanadi (yangi matn → yangi ovoz; o'zgarmagan qismlar keshdan).
- **Resume:** qayta bajarishda hamma narsa keshdan keladi, kredit sarflanmaydi.

### 2026-10-05 · P4.10 — TTS-first timing (PREFLIGHT) · ✅
- **Compiler (`timing.ts`):**
  - **`wordsFromAlignment`:** TTS belgi vaqtlari → so'zlar.
  - **`sentenceBoundaries`:** gap chegaralari `B[0] = 0`, `B[k]` = k-gap boshlanishi (pauza oldingi sahnaga qo'shiladi), `B[n]` = audio oxiri + 0.3 s.
  - **`planTiming`:** `vo:a-b` = `B[b] − B[a]`.
    - Gaplar soni yetmasa `SPEC_INVALID` (`details.sentences` bilan).
    - Voiceover'dan oldin oddiy sahnalar bo'lsa, voiceover shuncha siljiydi (`voOffset`).
    - `duration: "auto"` = sahnalar yig'indisi.
  - **`resolveAt`:** `s1.end`, `s2.start+0.5` langarlari. **`voiceSegments`:** ducking uchun so'zlar oraliqlari birlashtiriladi.
- **PREFLIGHT:** oxirgi `audio.ready` (shu plan versiyasiga tegishli) → `compile(ctx.audio)` → sahna davomiyliklari voiceover'dan.
- Musiqa `length: "match_video"` AUDIO'da timing'dan keyin aniq uzunlikda generatsiya qilinadi.
- SFX `at` langarlari compile'da hal qilinadi.

### 2026-10-05 · P4.11 — Audio oplar · ✅ (AE'da ko'rish 👤)
- **jsx (`ops/audio.ts`):**
  - **`captions.build`:**
    - so'zlar qatorlarga bo'linadi (`max_words`, gap oxiri `.!?`, >0.6 s pauza; qisqa bo'shliqlarda qator keyingisigacha turadi);
    - har qator — box text layer, in/out so'zlar bo'yicha;
    - stillar: `karaoke_bold` (katta harf, stroke, so'zlar Source Text keyframe'lari bilan navbatma-navbat), `bold_pop` (sariq, masshtab pop), `minimal` (fade);
    - idempotent (`<op_id>.<i>` izlari).
  - **`audio.duck`:** musiqa Audio Levels'iga ovoz oraliqlarida `amount_db` pasayish (fade bilan). Yaqin oraliqlar birlashtiriladi; idempotent.
  - `applyTextStyle` endi eksport qilinadi.
- **Compiler (`compileAudio`)** — asosiy comp'da:
  - `audio.vo` import va `aes.vo` (voOffset'da);
  - tozalangan manba `aes.source`;
  - `aes.music` (butun video, `volume_db`) va `duck_under` bo'lsa `aes.duck`;
  - `aes.sfx.<id>` (langar vaqtida);
  - `aes.captions` (voiceover yoki manba so'zlari, pozitsiya presetdan, quti eni kadrning 86%).
  - Spec audio'dagi asset'lar (musiqa, SFX, tayyor voiceover) import qilinadi.
  - Manba video ovozi: tozalanmagan va `use_in_video` bo'lsa media layer'da `keep_audio`.
  - Fayl yo'q bo'lsa ogohlantirish beriladi.
- **Mock AE aniqlashtirildi:**
  - `startTime` layer'ni siljitadi (in/out);
  - TextDocument qiymat sifatida ishlaydi (o'qish va yozishda nusxa).
- **Tekshiruv:**
  - **Compiler** `audio.test.ts` 5 ta: so'zlar va gaplar; `planTiming` (xato, `voOffset`); langarlar va oraliqlar; to'liq audio oplar; fayl yo'q / manba audio.
  - **jsx:** subtitr qatorlari va karaoke keyframe'lari, ducking keyframe'lari, reused.
  - **Server** `audio-job.test.ts` 5 ta:
    - to'liq AUDIO → VERIFY: 3 vazifa, fayllar panelda (sha256); sahnalar gaplardan; musiqa = video uzunligi; duck, SFX `hook.end` da, subtitr matni = voiceover;
    - qayta job → hammasi keshdan, generatsiya so'rovi 0;
    - kvota → `EL_QUOTA` + `ask_user`, generatsiya 0;
    - SFX xatosi → skipped va davom; voiceover xatosi → BLOCKED;
    - audio'siz spec o'zgarmagan.

  Repo 390 ✅, panel build ✅.
- **Keyingi:** P4.12 (panel Audio ekrani)

### 2026-10-05 · P4.12 — Panel Audio ekrani · ✅ (AE'da ko'rish 👤)
- **Server (`audio/routes.ts`, qurilma tokeni, faqat o'z loyihalari):**
  - `GET /api/agent/audio` — loyiha bo'yicha filtr.
  - `POST /api/agent/audio/:id/regenerate` — o'sha parametrlar, kesh chetlab o'tiladi, yangi variant; eski fayl qoladi, chunki yangisi boshqa (tarkibga bog'liq) nom oladi.
  - `POST /api/agent/audio/:id/retry` — faqat `failed` uchun, aks holda 409.
  - Jonli yangilanish: `audio.update` WS (P4.03 dan).
- **Panel:**
  - **`agent/audio-store.ts`:** ro'yxat, upsert, loyiha filtri, yangisi birinchi.
  - **Agent:** `loadAudio`, `audioAction` (regenerate/retry), `absolutePath`.
  - **`Audio.tsx`:**
    - holat, nom, tur, davomiylik, "keshdan" belgisi, fayl yo'li, xato;
    - "▶ Eshitish" (`<audio>` ish papkasidagi faylni `file:///` orqali ochadi);
    - "Qayta generatsiya" (transkript turlari uchun yo'q), "Qayta urinish".
- **Tekshiruv:**
  - `audio-screen.test.ts` 2 ta: ro'yxat; jonli `queued` → `done`; qayta generatsiya → yangi ElevenLabs so'rovi; done uchun retry → 409; boshqa qurilma begona audio'ni ko'rmaydi (404).
  - `live.test.ts`: `AudioStore`.

  Panel build ✅.
- **Keyingi:** P4.13 (MCP promptlar)

### 2026-10-05 · P4.13 — MCP promptlar · ✅
- **`/new-reel` audio bilan yangilandi:**
  - voiceover gaplarga bo'linadi, sahnalar `vo:a-b`;
  - ovoz `el_voices` dan, o'zbekcha uchun `eleven_v4` va `uz`; brend so'zlar `el_pronunciation`;
  - musiqa `match_video` + `duck_under`; SFX langarlari; subtitr stillari;
  - plan yozilgach `el_estimate` → `ask_user` bo'lsa ruxsat so'raladi;
  - ElevenLabs kaliti yo'q bo'lsa audio'siz quriladi va kabinet eslatiladi.
- **`/subtitle-video`** (video, til, stil): kerak bo'lsa `el_isolate` → `el_stt` → `transcript_get` → `transcript_edit` (o'zbekcha imlo, foydalanuvchi tasdig'i) → spec (`source_audio` + `captions.from = source_audio`) → build → VERIFY → `report_get`.
- **`/dub-video`** (video, maqsad tili): `el_estimate` (dub, davomiylik bilan) → `el_dub` (`wait_s: 0`, `audio_tasks_status`) → dublyaj fayli asset voiceover sifatida → build.
- **MCP `instructions`ga audio bo'limi qo'shildi:** spec audio, AUDIO bosqichi, kesh, o'zbekcha model, `el_estimate`, mustaqil toollar, klon faqat rozilik bilan.
- **Tekshiruv:** `mcp.test.ts` — 3 prompt ro'yxatda; har prompt matni argumentlarni o'z ichiga oladi. Promptlar va `instructions`da tilga olingan har tool (endi `el_*`, `audio_*`, `transcript_*` ham) haqiqatda mavjudligi avtomatik tekshiriladi.
- **Keyingi:** P4.14 (o'zbek tili testi)

### 2026-10-05 · P4.14 — 🧪 O'zbek tili testi · ⚠️ vosita va hujjat ✅, haqiqiy o'lchov 👤 (kalit)
- **Q7 (rasmiy hujjat):**
  - o'zbekcha TTS — faqat `eleven_v4` va `eleven_v4_turbo`; v3, multilingual_v2 va flash'da yo'q;
  - STT `scribe_v2` — "Good" (WER 10–20%);
  - dialog default `eleven_v3` o'zbekchani qo'llamaydi, o'zbekcha dialog uchun `model_id: eleven_v4` berish kerak.
- **Qilindi:**
  - **`audio/wer.ts`:** o'zbek lotin normalizatsiyasi (kichik harf, tinish belgilarisiz, `ʻ ʼ ' ‘ ’ \`` → `'`) va so'z bo'yicha Levenshtein WER (almashtirish/o'chirish/qo'shish).
  - **`scripts/uz-quality.mts`:** haqiqiy kalit bilan ishga tushiriladi:
    - 5 ta o'zbekcha namuna (`oʻ`, `gʻ`, brendlar, undov) → TTS (v4 va v4_turbo, `uz`, brend talaffuz lug'ati);
    - → STT (`scribe_v2`) → WER va forced alignment loss → markdown jadval.
  - **`docs/uz-quality.md`:** model jadvali, usul, natijalar bo'limi (kalit kiritilgach), talaffuz lug'ati qoidalari, tavsiyalar (raqamlarni so'z bilan yozish, `transcript_edit`, apostroflar).
- **Tekshiruv:** `uz-quality.test.ts` 2 ta (normalizatsiya va apostroflar; WER turlari). Skript typecheck'dan o'tadi.
- **👤 Qoldi:** ElevenLabs kaliti bilan `uz-quality.mts` ni ishga tushirish va jadvalni `docs/uz-quality.md` ga ko'chirish.
- **Keyingi:** P4.15 (Faza 4 gate)

### P4.15 — 🧪 Faza 4 gate (2026-10-05)

**Nima qilindi:**
- `apps/panel/test/gate4.e2e.test.ts` — haqiqiy server + haqiqiy agent (Node) + ffmpeg + ES3 jsx bundle (mock AE, `realDisk`) + soxta aerender + soxta ElevenLabs API (rasmiy yo'llar, haqiqiy WAV). Hammasi Claude ishlatadigan MCP toollari orqali:
  1. **Voiceover + karaoke + musiqa (ducking) + SFX:** `plan_write` → `preflight` (`pending_audio: true`) → `build_start` → AUDIO (tts, sfx, music `match_video`) → har fayl server storage'idan panelga yuklab olinadi (`audio/<kind>_<sha12>.<ext>`) → AE'da `VOICEOVER`, `MUSIC` (Audio Levels kalitlari — ducking), `SFX whoosh`, `CAPTION n` (so'zma-so'z Source Text: `BUGUN` → `BUGUN UCHTA` → `BUGUN UCHTA SIR.`) → `frames_capture` → `verify_approve` → `out/vo_reel_v001.mp4`.
  2. **Mavjud video:** `source_audio` isolate + transcribe (`language_code: uz`) → `SOURCE (clean)` + `CAPTION 1` (`SALOM BU INTERVYU EDI`) → render → `out/interview_v001.mp4`.
  3. **Kesh:** bir xil plan bilan yangi job — ElevenLabs'ga generatsiya so'rovi 0 ta, hamma vazifa `cached: true, credits: 0`.
  4. **Kvota:** qoldiq 10 belgi, yangi matn → job `BLOCKED EL_QUOTA` (`details.ask_user: true`), `el_estimate` → `fits: false, ask_user: true`; generatsiya so'rovi yo'q.
- `e2e-helpers.start()` — uchinchi parametr (`createTestApp` deps: `elevenOptions` va h.k.).
- `ae-mock` — `realDisk` rejimida diskdagi audio fayllarni (mp3/wav/ogg/m4a) AE "ko'radi" (agent yuklab olgan ElevenLabs fayllari import qilinadi).
- MCP `preflight` / `build_start dry_run` — `vo:a-b` sahnalari uchun AUDIO natijasi bo'lmasa `pending_audio: true` (vaqtlar AUDIO bosqichida aniqlanadi); bo'lsa shu plan versiyasining oxirgi `audio.ready` natijasi bilan kompilyatsiya (`engine.audioReadyFor`).

**Tekshiruv:** `pnpm test` 398 o'tdi / 2 skip · typecheck · lint · prettier · panel build — toza.

**👤 qolgan:** haqiqiy ElevenLabs kaliti bilan va haqiqiy AE'da shu ikki ssenariyni qo'lda o'tkazish (kalit web → Sozlamalar → ElevenLabs).

### P5.01 — Shablon tizimi (2026-10-05)

**Nima qilindi:**
- **Manifest (`packages/shared/src/template.ts`)** — ikki manba:
  - `aep`: dizayner `.aep` fayli. `comp`, slot → `layer`, rang → `egp` talab qilinadi; fayl server storage'ida (`files.aep`).
  - `recipe`: Spec layerlari retsepti, `{{slot}}` / `{{brand.*}}` o'rinbosarlari bilan, `.aep` kerak emas.
  - Slotlarda `default` va `label`; manifestda `bg`, `tags`, `files.preview` qo'shildi.
- **Op `template.instantiate`** (shared + jsx `ops/template.ts`):
  - `.aep` loyiha sifatida bir marta import qilinadi (`Templates` papkasi, iz `tpl.<slug>.v<n>`).
  - Har sahna shablon comp'ining o'z nusxasini oladi (idempotent: `<op_id>.comp`).
  - Slotlar: matn → Source Text; media → `replaceSource` + `fit`; rang → Essential Graphics, bo'lmasa shu nomli "Color Control" effekti.
  - Sahnaga qo'yiladi; `time_remap` bilan shablon davomiyligi sahna davomiyligiga moslanadi.
- **Compiler (`packages/compiler/src/template.ts`)** — `scene.template` uchun:
  - slot tekshiruvi: majburiy slot, noma'lum slot, `max_chars`, `asset:` havola, `#RRGGBB`;
  - recipe → layerlar, op_id `<sahna>.tpl.<id>`, sahna layerlari ostida; `"if": "<slot>"` — slot bo'sh bo'lsa layer chiqmaydi;
  - aep → `template.instantiate` + media slot assetlari import qilinadi;
  - format yoki davomiylik manifestga mos kelmasa ogohlantirish;
  - brand tokenlari: brand bo'lmasa default ranglar ishlatiladi, shrift/logo tokeni olib tashlanadi.
- **Server:**
  - `TemplateService` (`ctx.templates`): tizim kutubxonasi (`templates/<slug>/template.json` bundle'ga kiradi) + `templates` jadvali; tartib: foydalanuvchi > umumiy > tizim; versiyalar.
  - `compileExtras` — engine PREFLIGHT va MCP `preflight` / `dry_run` uchun bir xil kontekst.
  - PREFLIGHT'da aep fayl storage'dan panelga `templates/<slug>_v<n>.aep` ga yuklanadi (`file.download`, sha256).
- **Kutubxonaning birinchi shabloni:** `hook_title` (recipe; 9:16 / 1:1 / 16:9).
- **Mock AE:** `.aep` loyiha importi, `CompItem.duplicate`, `replaceSource`, time remap, `removeKey`, Color Control.

**Testlar:** compiler `template.test` (6), panel `jsx-template.test` (3), server `templates.test` (5). To'liq to'plam 411 o'tdi. `gate3` og'ir yuk ostida bir marta timing sabab yiqildi, alohida o'tdi. Typecheck, lint, prettier, panel build toza.

**👤:** haqiqiy AE'da `.aep` shablon importi va Essential Graphics rangi.

### P5.02 — Shablon toollari va prompt (2026-10-05)

**Nima qilindi:**
- **MCP toollar** (`apps/server/src/mcp/tools/templates.ts`):
  - `templates_list` — format/tag filtri; slot turi, majburiyligi, default, `max_chars`; `preview_url`.
  - `template_get` — to'liq manifest, `has_aep`, `example_scene` (Spec'ga tayyor sahna).
  - `template_apply` — slotlarni darhol tekshiradi va yangi plan versiyasini yozadi:
    - `mode: new` — shablon formatida yangi Spec;
    - `mode: append` — oxirgi planga sahna qo'shadi (shu `scene_id` bo'lsa almashtiradi).
  - `template_save` — plan sahnasidan shablon (slug bor bo'lsa yangi versiya):
    - `recipe` (default): sahna layerlari retseptga aylanadi; `id`li matn/media layerlar slot bo'ladi, default — joriy qiymat;
    - `aep`: VERIFY yoki undan keyingi holatdagi job'ning `.aep` fayli panel orqali storage'ga yuklanadi; comp `NN_<sahna>`, slotlar layer nomi bo'yicha.
- **WS `file.upload.request`** (server → panel). Panel ish papkasidagi faylni pre-signed PUT bilan yuklaydi va `file.uploaded` qaytaradi. Papkadan tashqari yo'l va yo'q fayl rad etiladi.
- **Compiler:** `id`li layer AE'da shu nom bilan yaratiladi (aep shablon slotlari va qo'lda tahrir uchun). Snapshot'ga 2 ta `name` qo'shildi, boshqa farq yo'q.
- **Umumiy yordamchilar** (`templates/apply.ts`): `templateSummary`, `exampleScene`, `applyTemplate`, `recipeFromScene`, `aepManifestFromScene` — panel ekrani (P5.06) va batch (P5.07) ham ishlatadi.
- **MCP prompt `/from-template`.**

**Testlar:**
- server `templates.test`: +6 — list/get, apply new/append/xato, recipe save → apply → build, aep save → upload → keyingi build'da yetkazish, prompt;
- panel `files.e2e`: `file.upload.request` haqiqiy agent bilan;
- `mcp.test`: prompt ro'yxati va tool prefikslari yangilandi.

To'liq to'plam: 418 test o'tdi. `build.e2e` dagi layer nomi kutilmasi yangilandi. Typecheck, lint, prettier toza.

### P5.03 — Boshlang'ich kutubxona (2026-10-05)

**Nima qilindi:**
- **6 ta recipe shablon** (`templates/<slug>/template.json`, 9:16 / 1:1 / 16:9), hammasi brand tokenlari va ixtiyoriy slotlar (`if`) bilan:
  - `hook_title`;
  - `lower_third`;
  - `cta_outro` — logo default `{{brand.logo}}`;
  - `product_showcase`;
  - `testimonial`;
  - `top3_list` — bandlar ketma-ket chiqadi.
- Subtitr stillari (`karaoke_bold`, `bold_pop`, `minimal`) va o'tishlar oldingi fazalardan bor. `templates/README.md` da kutubxona, recipe yozish qoidalari, aep yo'li va preview tartibi hujjatlandi.
- **Spec media `scale`:** `fit` natijasiga ko'paytiruvchi. Logo yoki mahsulot kadrning bir qismini egallaydi. Op parametri, jsx va animatsiya masshtabi shunga moslandi.
- **Matn `max_width` endi ishlaydi.** Oldin compiler uni e'tiborsiz qoldirardi va uzun matn kadrdan chiqib ketishi mumkin edi. Endi taxminiy eni oshsa paragraf qutisi (`box`) beriladi: balandligi qatorlar soniga qarab, markazi `pos` da. Snapshot'da faqat uzun caption qutiga o'tdi.
- Media slot default'i brand tokeni bo'lishi mumkin (`{{brand.logo}}`).

**Testlar:** `apps/panel/test/template-library.test.ts` — 37 holat: 6 shablon × 3 format × (brand bilan to'liq slotlar / brand'siz faqat majburiy slotlar). Har holatda:
- kompilyatsiya ogohlantirishsiz;
- oplar sxemaga mos;
- matnlar kadr ichida (taxminiy eni);
- brand shriftlari qo'llanadi;
- oplar haqiqiy ES3 bundle'da mock AE'da bajariladi.

**👤:** dizaynni haqiqiy AE'da ko'rib chiqish va `preview.gif` (render + ffmpeg, README'dagi tartib).

### P5.04 — Brand kit (2026-10-05)

**Nima qilindi:**
- **`BrandService` (`ctx.brands`)** — `brands` jadvali: upsert, ro'yxat, `resolve`. Spec'dagi `"default"` saqlanmagan bo'lsa video brand'siz quriladi; boshqa slug topilmasa `SPEC_INVALID /brand`.
- **MCP:** `brands_list`, `brand_save` (kirish — `brandSchema`).
- **Compiler (`packages/compiler/src/brand.ts`)** — brand quyidagilarni beradi:
  - matnning default shrifti (body) va rangi;
  - sahna foni;
  - subtitr stili (Spec `captions.style` endi ixtiyoriy: Spec → brand → `karaoke_bold`);
  - shablon tokenlari. Logo asset loyihada bo'lmasa video logo'siz quriladi, ogohlantirish bilan.
- **Shriftlar:** ishlatiladigan barcha shriftlar AE ro'yxati bo'yicha tekshiriladi.
  - Shrift yo'q bo'lsa brand fallback'i ishlatiladi (ogohlantirish bilan).
  - Fallback ham yo'q bo'lsa `AE_FONT_MISSING` (`details.font`, `fallback`).
  - Ro'yxat noma'lum bo'lsa (AE < 24) tekshirilmaydi.
- **AE ro'yxati qayerdan:**
  - jsx `info` op endi `font_names` qaytaradi (PostScript nomlari, `app.fonts`);
  - engine PREFLIGHT ro'yxatni brand yoki Spec shrifti bo'lgandagina so'raydi, panel uzilsa kutadi;
  - MCP `preflight` / `dry_run` panel online bo'lsa so'raydi.
- **Audio:** TTS `voice_id` va musiqa `prompt` ixtiyoriy bo'ldi; bo'lmasa `brand.voice` / `brand.music_style` ishlatiladi (`planAudioTasks`). CHECK'da `missingBrandAudio`: ikkalasi ham yo'q bo'lsa `SPEC_INVALID`.
- `brands/README.md` va `brands/example/brand.json`.

**Testlar:**
- compiler `brand.test` (5): defaultlar, fallback/`AE_FONT_MISSING`, subtitr stili, logo;
- server `brands.test` (6): toollar, build'da tokenlar/shrift/logo/fon, fallback va `AE_FONT_MISSING` (engine va MCP preflight), noma'lum brand, brand ovozi va musiqasi, ovozsiz voiceover.

To'liq to'plam: 467 o'tdi. Typecheck, lint, prettier toza.

**👤:** haqiqiy AE 24+ da `app.fonts` PostScript nomlari.

### P5.05 — Format variantlari (2026-10-05)

**Nima qilindi:**
- **Compiler** — `spec.variants` (masalan `["1:1", "16:9"]`):
  - Har variant uchun alohida daraxt quriladi: asosiy comp `aes.main.<tag>` (nomi `<output.name>_<tag>`), sahna comp'lari `<tag>_NN_<sahna>`, `Scenes <tag>` papkasi, op_id'lar `<tag>.` prefiksi bilan.
  - Asosiy format oplari variantlar qo'shilganda ham aynan o'zgarishsiz qoladi (snapshot va test tasdiqlaydi).
  - Variant kadri: qisqa tomon asosiy formatdagidek, uzun tomon aspektga qarab (juft son). 1080×1920 dan → 1080×1080 va 1920×1080.
  - Joylashuv nisbiy (`toPixels`), media `fit` kadrga qarab hisoblanadi. Piksel qiymatlari (shrift, chiziq, radius) qisqa tomonlar nisbatida masshtablanadi.
  - **Safe area** (har tomondan 4%): matn markazi qutisi kadr ichida qoladigan qilib suriladi (asosiy formatda ham).
  - Audio (voiceover, musiqa + ducking, SFX, subtitr) har variant asosiy comp'ida qayta qo'yiladi. Fayl importi bitta.
  - Shablon variant formatiga mo'ljallanmagan bo'lsa ogohlantirish.
  - `CompileOutput.variants`.
- **Engine RENDER:**
  - asosiy format va har variant alohida render qilinadi (`out/<nom>_<tag>_v001.mp4`), har biri ±1 kadr gate'idan o'tadi;
  - `renders` jadvaliga `variant` va `aep_version` ustunlari qo'shildi (migratsiya `0007_render_variants`);
  - xato yoki uzilishdan keyin faqat qolgan variantlar render qilinadi;
  - `render_start` (qayta render) hammasini qayta render qiladi.
- **MCP `frames_capture`:** yangi `variant` parametri — VERIFY'da har formatni ko'rish uchun.

**Testlar:**
- compiler `variants.test` (4): kadrlar; asosiy oplar o'zgarmasligi; variant comp, nest va importlar; nisbiy joylashuv; safe area; audio.
- server `render.test` (+2): 3 ta render ketma-ketligi va qatorlari, `frames_capture` variant comp'ida va noma'lum variant, qayta render; variant xatosi → BLOCKED → resume'da faqat qolgani.

To'liq to'plam: 473 test o'tdi. Typecheck, lint, prettier toza.

### P5.06 — Panel Shablonlar ekrani (Claude'siz rejim) (2026-10-05)

**Nima qilindi:**
- **Server REST** (`apps/server/src/templates/routes.ts`, qurilma tokeni):
  - `GET /api/agent/templates` — galereya: qisqa ko'rinish, manifest (fayllarsiz), namuna sahna.
  - `POST /api/agent/templates/:slug/run` — slotlar, format, qo'shimcha variantlar, davomiylik, brand qabul qiladi. `applyTemplate` bilan darhol tekshiradi, yangi plan (`created_by: user`) va job yaratadi.
- **`jobs.auto_approve`** (migratsiya `0008_jobs_auto_approve`): Claude'siz job'da VERIFY avtomatik o'tadi (`verify.auto` hodisasi). Batch ham shuni ishlatadi.
- **Panel:**
  - `Templates.tsx`: galereya kartalari — `preview.gif` bo'lsa u, bo'lmasa manifest retseptidan SVG sxema. Forma: matn (`max_chars`), media (loyihaning ok assetlari), rang, format va qo'shimcha formatlar, davomiylik. Natija Live bo'limida kuzatiladi.
  - `agent/templates.ts` — sof funksiyalar: `sketchItems`, `validateSlots`, `slotPayload`, `aspectSize`.
  - Agent API'ga `templates()`, `projectAssets()`, `runTemplate()` qo'shildi.

**Testlar:** `apps/panel/test/templates-screen.e2e.test.ts`:
- galereya, sxema, slot tekshiruvi, assetlar;
- haqiqiy agent + ES3 bundle (mock AE) + ffmpeg + soxta aerender: slotlar → job → VERIFY avtomatik → `out/hook_title_v001.mp4` va `out/hook_title_16x9_v001.mp4`.

To'liq to'plam: 474 o'tdi. `mcp.test` bitta marta yiqildi — pauza paytida mashina uxlagani sabab (15 736 s); qayta ishga tushirilganda o'tdi. Typecheck, lint, panel build toza.

### P5.07 — Batch: shablon + CSV → N ta video (2026-10-07)

**Nima qilindi:**
- **CSV parser** (`apps/server/src/batch/csv.ts`): RFC 4180 (qo'shtirnoq, ichki vergul va qator, `""`), CRLF/LF, BOM. Ajratuvchi avtomatik aniqlanadi (`,` / `;` / tab). Sarlavha majburiy, ko'pi bilan 500 qator.
- **`BatchService` (`ctx.batches`)** — jadval `batches` va `jobs.batch_id` (migratsiya `0009_batches`):
  - Ustun ↔ slot: default — bir xil nom, yoki `mapping`. `name` ustuni fayl nomini beradi (tozalanadi, takrorlansa raqam qo'shiladi).
  - **Barcha qatorlar oldindan tekshiriladi.** Xato bo'lsa hech narsa boshlanmaydi: `SPEC_INVALID`, `details.rows` da qator raqamlari va sabablari.
  - Qatorlar ketma-ket job bo'ladi (`auto_approve`, qurilmada bitta aktiv job). Qurilma band bo'lsa, job tugashi bilan davom etadi.
  - Job BLOCKED bo'lsa: xato qatorga yoziladi, job bekor qilinadi, keyingi qatorga o'tiladi.
  - Har qator natijasi: render qilingan fayllar.
  - Server qayta ishga tushsa `recover()` davom ettiradi. `batch_cancel` qolgan qatorlarni to'xtatadi.
  - Yakunda markdown hisobot (jadval) va listener (Telegram uchun).
- **MCP:** `batch_start`, `batch_status` (qatorlar + hisobot), `batch_cancel`.
- **REST (panel):** `POST /api/agent/batches`, `GET /api/agent/batches/:id`.
- **Panel:** Shablonlar formasida "CSV (ixtiyoriy, batch)" maydoni. To'ldirilsa, batch boshlanadi. Agent'ga `runBatch()` qo'shildi.

**Testlar:**
- server `batch.test` (7): CSV holatlari va xatolari; 3 qator → 3 ta video ketma-ket (render nomlari, natijalar, hisobot, `auto_approve` / `batch_id`); oldindan tekshiruv; BLOCKED → failed va davom etish; bekor qilish; REST auth.
- panel `templates-screen.e2e`: haqiqiy agent bilan CSV (2 qator) → 2 ta mp4.

To'liq to'plam: 482 o'tdi. `jobs.test` dagi bitta yiqilish mashina uxlagani sabab (89 302 s), alohida qayta ishga tushirilganda 26/26 o'tdi. Typecheck, lint toza.

### P5.08 — Telegram xabarnoma (2026-10-07)

**Nima qilindi:**
- **`TelegramService` (`ctx.telegram`)**, env: `TELEGRAM_BOT_TOKEN` (👤 BotFather), `TELEGRAM_BOT_USERNAME`, `TELEGRAM_API_URL`.
  - **Bog'lash:**
    - kabinetda bir martalik kod beriladi (15 daqiqa, deep link `https://t.me/<bot>?start=<kod>`);
    - foydalanuvchi botga `/start <kod>` yoki kodning o'zini yuboradi;
    - server long polling (`getUpdates`) bilan uni o'qiydi va `chat_id` ni saqlaydi; webhook kerak emas;
    - noto'g'ri yoki eskirgan kodga javob qaytariladi; kod bir martalik.
  - **Xabarlar:**
    - render tugadi (`🎬`, ushbu `.aep` versiyasidagi barcha fayllar, variantlar ham);
    - job BLOCKED (`⚠️`, xato kodi va matni);
    - batch yakuni (`📦`, qatorlar bo'yicha bitta umumiy xabar; batch qatorlari alohida xabar bermaydi).
    - Takrorlanmaydi (dedup). Yuborish xatosi log'ga yoziladi va job'ga ta'sir qilmaydi.
  - Token yo'q bo'lsa xizmat o'chiq turadi.
- **Jadval `telegram_links`** (migratsiya `0010_telegram`).
- **REST:** `GET /api/settings/telegram`, `POST /api/settings/telegram/code`, `DELETE /api/settings/telegram` (audit bilan).

**Testlar:** server `telegram.test` (4) — `FakeTelegram` (Bot API: `getUpdates` / `sendMessage`):
- bog'lash: deep link, noto'g'ri, bir martalik va eskirgan kod, uzish;
- render → xabar (fayl yo'li), BLOCKED → xabar;
- batch → bitta umumiy xabar;
- token yo'q → o'chiq.

To'liq to'plam: 487 o'tdi.

**👤:** BotFather'da bot yaratib, `TELEGRAM_BOT_TOKEN` va `TELEGRAM_BOT_USERNAME` ni Railway'ga qo'yish.

### P5.09 — Web kabinet to'liq (2026-10-07)

**Nima qilindi:**
- **Server** (`apps/server/src/cabinet/routes.ts`, sessiya cookie):
  - `GET /api/jobs` — barcha loyihalardagi oxirgi 50 ta job: loyiha nomi, holat, natija, batch, renderlar (variant bilan);
  - `GET /api/batches`;
  - `GET/PUT /api/brands`, `DELETE /api/brands/:slug` (audit bilan).
  - Hisobot uchun avvaldan bor `GET /api/jobs/:id/report` ishlatiladi.
- **Web kabinet** — bo'limlar:
  - Qurilmalar va Ulangan ilovalar (Claude tokenlari) — avvaldan bor;
  - **Tarix** (yangi `JobsPage`): batch'lar; joblar, holat, xato, render fayllari, ochiladigan markdown hisobot;
  - **Sozlamalar:**
    - ElevenLabs kaliti;
    - **Telegram**: holat, bog'lash kodi va deep link, uzish;
    - **Brand kit**: ro'yxat, rang namunalari, JSON tahrir — `brand_save` bilan bir xil sxema.

**Testlar:** server `cabinet.test` (2):
- tarix (renderlar, hisobot), boshqa foydalanuvchiga bo'sh/404, auth'siz 401;
- brand: saqlash, ro'yxat, xato, o'chirish, izolyatsiya.

Server testlari: 197 o'tdi. Typecheck, lint, web build toza.

### P5.10 — Panel production build (2026-10-07)

**Nima qilindi:**
- **ffmpeg ZXP ichida:**
  - `apps/panel/scripts/bundle-ffmpeg.mjs` binarlarni `src/bin/<platform>-<arch>/` ga ko'chiradi (manba: `AES_FFMPEG_DIR` yoki PATH).
  - LGPL tekshiruvi: `--enable-gpl` yoki `--enable-nonfree` bo'lsa skript to'xtaydi (Q9). Yoniga `LICENSE.txt` va `VERSION.txt` yoziladi.
  - `cep.config` `copyAssets` → `dist/cep/bin`.
- **Agent** ffmpeg'ni shu tartibda qidiradi: sozlama → ZXP ichidagi `bin/<tag>` (`bundledFfmpegDir`) → PATH.
- **`.debug` ZXP'dan olib tashlandi** — P1.14 qarzi. Vite plugin uni imzolashdan oldin bundle'dan o'chiradi; dev build'da qoladi.
- **Reliz:**
  - `pnpm zxp` → `pnpm --filter @aes/panel release` → bundle-ffmpeg → `vite build` (ZXP) → `name-zxp.mjs`;
  - natija: `apps/panel/release/ae-studio-<versiya>.zxp` va `.sha256`;
  - versiya `package.json` dan (manifest, UI, fayl nomi);
  - `apps/panel/src/bin/` va `release/` gitignore'da.
- **Haqiqiy natija:** `ae-studio-0.1.0.zxp`, 111 MB (`bin/win32-x64/ffmpeg.exe`, `ffprobe.exe`, LICENSE ichida; `.debug` yo'q). `ZXPSignCmd -verify -certinfo` → "Signing Certificate: Valid", timestamp valid.
- **`docs/release-panel.md`:** jarayon, versiyalash, Q8/Q9 qarorlari, macOS (👤).

**Testlar:** panel `agent.test` (+2) — ffmpeg qidirish tartibi (vaqtinchalik extension papkasi) va litsenziya tekshiruvi.

**Qarorlar:**
- Q8 — self-signed (parol `ZXP_PASSWORD`);
- Q9 — faqat LGPL build.

**👤:** macOS ZXP (Mac kerak); tijoriy sertifikat faqat Adobe Exchange uchun.

### P5.11 — Installer va birinchi ishga tushirish (2026-10-07)

**Nima qilindi:**
- **O'rnatish skriptlari** (`scripts/install/`): `install-panel.ps1` (Windows), `install-panel.sh` (macOS).
  - Avval Adobe UnifiedPluginInstallerAgent bilan `--install <zxp>`. UPIA bo'lmasa yoki `-Manual` / `--manual` berilsa, ZXP foydalanuvchi CEP extensions papkasiga ochiladi.
  - Eski versiya `.old-<sana>` nomi bilan saqlanadi, `manifest.xml` tekshiriladi, macOS'da ffmpeg'ga `+x` beriladi.
  - ZXP imzolangan, shuning uchun `PlayerDebugMode` kerak emas.
  - `pnpm zxp` skriptlarni reliz papkasiga ZXP yoniga qo'yadi.
- **Birinchi ishga tushirish ustasi** (panel `FirstRun.tsx`, mantiq `agent/onboarding.ts`):
  - qadamlar: ulanish → ish papkasi → muhit tekshiruvi → «Tayyor»;
  - muhit tekshiruvi: ffmpeg (manbasi: sozlama / panel ichida / PATH), aerender, Node;
  - topilmasa tushunarli maslahat beriladi;
  - holat `settings.onboarded` da saqlanadi;
  - usta tugaguncha faqat sozlash bo'limlari ko'rinadi (Live, Shablonlar, Audio, Tarix — keyin).
- Agent'ga `onboarding()`, `finishOnboarding()`, `environment()` qo'shildi.
- **`docs/panel-install.md` qayta yozildi:** foydalanuvchi uchun 10 daqiqalik yo'l, dasturchi yo'li, nosozliklar.

**Tekshiruv:**
- `install-panel.ps1 -Manual` haqiqiy `ae-studio-0.1.0.zxp` bilan vaqtinchalik extensions papkasiga o'rnatildi (CSXS, agent, jsx, `bin/win32-x64`); qayta o'rnatishda zaxira nusxa yaratildi.
- `bash -n install-panel.sh` — sintaksis to'g'ri.
- Testlar: panel `agent.test` (+1: qadamlar, muhit qatorlari), `workspace.e2e` (+1: haqiqiy agent bilan qadamlar, `environment()`, saqlanish).
- Typecheck, lint, panel build toza.

**👤:** toza kompyuterda 10 daqiqada o'rnatib, birinchi videoni chiqarish (Faza 5 gate, M8); macOS skriptini Mac'da sinash.

### P5.12 — Hujjatlar (2026-10-07)

**Nima qilindi:**
- **Foydalanuvchi qo'llanmasi** (`docs/user-guide.md`): o'rnatish (panel, Claude connector, kabinet — ElevenLabs/Telegram/brand), Claude bilan birinchi video, tayyor buyruqlar, Claude'siz shablonlar va CSV batch, formatlar va brend, muammolar. `docs/panel-install.md` P5.11 da yangilangan.
- **Dasturchi qo'llanmasi** (`docs/developer.md`): tuzilma va oqim, ishlab chiqish va testlar, yangi op (ES3, idempotentlik izi, mock AE), yangi ElevenLabs imkoniyati, yangi shablon, yangi MCP tool, Railway deploy va migratsiya.
- **MCP tool ma'lumotnomasi zod'dan generatsiya qilinadi:** `apps/server/src/docs/generate.ts`, `pnpm gen:docs` → `docs/mcp-tools.md` (54 tool guruhlar bo'yicha: parametr, turi, majburiyligi, default va chegaralar; 4 prompt).
- **Xato kodlari va yechimlari:** `docs/errors.md`, `ERROR_DEFS` dan generatsiya (kod, qayta urinish, nima qilish kerak).
- `docs/README.md` — hujjatlar indeksi.

**Testlar:** server `docs.test` (2) — generatsiya qilingan hujjatlar kod bilan aynan mos (yangi tool yoki xato qo'shilsa test eslatadi); har tool va har kod hujjatda, guruhsiz qolmagan. Typecheck, lint toza.

### P5.13 — Production tayyorgarlik (2026-10-07)

**Nima qilindi:**
- **Railway:** healthcheck `/health` (DB va Redis), `ON_FAILURE` × 5, SIGTERM'da toza to'xtash — avvaldan bor, tekshirildi. Ishga tushganda joblar, audio va batch'lar tiklanadi.
- **DB backup** (`apps/server/src/ops/backup.ts`):
  - Postgres JSON serializatsiyasi (`json_agg`) → gzip NDJSON.
  - Tiklash `json_populate_recordset` bilan: turlar aniq, FK topologik tartibda, bitta tranzaksiyada. Bo'sh bo'lmagan bazaga yozmaydi.
  - **Avtomatik:** production'da `MaintenanceService` (`BACKUP_INTERVAL_H=24`) → storage `system/backups/`, rotatsiya `BACKUP_KEEP=14`.
  - **CLI:** `scripts/backup.mts dump|restore`.
  - Storage drayverlariga (local, S3) `delete` va `list` qo'shildi.
- **Loglarni saqlash muddati** (har kuni):
  - `job_events` — yakunlangan va eski joblar uchun (`LOG_RETENTION_DAYS=90`);
  - `audit_log` — 365 kun;
  - eskirgan OAuth tokenlari;
  - Telegram kodlari.
- **Xavfsizlik ko'rigi** (`docs/production.md` jadvali): kalitlar, auth va cookie bayroqlari, MCP OAuth, rate limit, yo'llar, pre-signed fayllar, izolyatsiya, audit, ExtendScript, ZXP.
  - Tuzatish: barcha javoblarga `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`; production'da HSTS.
- **Regressiya to'plami:** `pnpm test:regression` — compiler snapshot'lari, server integratsiyasi (soxta agent / EL / Telegram), ES3 oplari, shablon kutubxonasi, e2e gate'lar.
- `.env.example` ga Telegram va backup sozlamalari qo'shildi.

**Testlar:**
- server `maintenance.test` (3): FK tartibi; backup → rotatsiya → toza PGlite'ga tiklash (`jobs` qatori aynan teng, Date turlari, secrets) va bo'sh bo'lmagan bazaga rad etish; loglar muddati.
- `security.test` (+1): sarlavhalar.
- `pnpm test:regression`: 270/270. Typecheck, lint toza.

**👤:** Railway Postgres volume snapshot'larini yoqish; `MASTER_KEY` ni alohida xavfsiz joyda saqlash.

### P5.14 — 🧪 Faza 5 gate, yakuniy (2026-10-07)

**Kod qismi** — `apps/panel/test/gate5.e2e.test.ts`. Ishlatilgan muhit: haqiqiy server, haqiqiy agent, ffmpeg, ES3 bundle (mock AE, AE 24+ shriftlari bilan), soxta aerender; Claude oqimi MCP orqali.

1. **Bitta Spec → 9:16, 1:1, 16:9, brand kit bilan (M7).** Shablonlar `hook_title` + `cta_outro`, brand `acme`.
   - AE'da uchta asosiy comp: 1080×1920, 1080×1080, 1920×1080.
   - Brand qo'llandi: sahna foni, sarlavha shrifti va rangi, logo.
   - Body shrifti AE'da yo'q → fallback ArialMT ishlatildi.
   - `frames_capture` variant comp'ida ishladi.
   - Natija: `launch_v001.mp4`, `launch_1x1_v001.mp4`, `launch_16x9_v001.mp4`; hisobotda barchasi bor.
2. **Shablon + CSV (3 qator) → 3 ta video + Telegram.**
   - Telegram kabinet kodi va `/start` bilan bog'landi.
   - `batch_start` (`top3_list`, 1:1) → `ovqat_v001.mp4`, `sport_v002.mp4`, `kitob_v003.mp4`.
   - Telegram'ga bitta umumiy xabar keldi (3/3, fayl yo'llari bilan).
3. **To'liq regressiya:** `pnpm test` — 501 o'tdi (2 skip: haqiqiy AE va prod smoke). `pnpm test:regression` — 270/270. Typecheck, lint, prettier, panel/web/server build toza.

**👤 qoldi:** toza kompyuterga 10 daqiqada o'rnatib birinchi videoni chiqarish (M8) — `docs/panel-install.md`, reliz papkasi `apps/panel/release/`.

### Deploy — Faza 4–5 Railway'da (2026-10-07)

- `railway up --service server` → deployment `68c95416…` SUCCESS. Migratsiyalar 0005–0010 qo'llandi (`start` skriptida).
- Production tekshiruvi:
  - `/health` → db ok, redis ok;
  - xavfsizlik sarlavhalari: nosniff, DENY, referrer-policy, HSTS;
  - yangi endpointlar (`/api/settings/telegram`, `/api/agent/templates`, `/mcp`) auth'siz → 401.
- **Avtomatik DB backup production'da ishladi** (haqiqiy Postgres, postgres-js): `system/backups/2026-10-06T22-50-09-797Z.ndjson.gz` — 21 jadval, 244 qator, 12 KB. Tozalash ham ishga tushdi.
- Telegram o'chiq turibdi: `TELEGRAM_BOT_TOKEN` hali yo'q (👤).

### Kabinetga kirish Telegram orqali (email olib tashlandi) (2026-10-07)

**Talab (foydalanuvchi):** registratsiya pochta orqali emas, Telegram botga deep link orqali; pochta qismini olib tashlash. Vaqtincha bot `@telegrab_app_bot`.

**Nima qilindi:**
- **Oqim** (`apps/server/src/auth/telegram-login.ts`, `auth/routes.ts`):
  1. `POST /api/auth/telegram` — deep link `https://t.me/telegrab_app_bot?start=login_<kod>` (kod 18 bayt, 10 daqiqa) va httpOnly cookie siri (DB'da faqat hash) qaytaradi.
  2. Bot `/start login_<kod>` ni oladi → hisob Telegram id bo'yicha topiladi yoki yaratiladi (ism yangilanadi) → so'rov tasdiqlanadi → shu chat xabarnomalar uchun avtomatik ulanadi.
  3. `GET /api/auth/telegram/status` — tasdiqlangan bo'lsa bir martalik sessiya cookie'si va `next`.
  - Kod boshqa brauzerga sessiya bermaydi. Ishlatilgan yoki eskirgan kod rad etiladi. Tashqi `next` qabul qilinmaydi. Rate limit qo'yildi.
- **DB** (migratsiya `0011_telegram_login`):
  - `users.email` ixtiyoriy bo'ldi (eski hisoblar saqlanadi);
  - `users.telegram_id` (unique) va `name` qo'shildi;
  - yangi jadval `telegram_logins`.
- **Email butunlay olib tashlandi:** `/api/auth/magic-link`, `/api/auth/verify`, mailer (Resend), `RESEND_API_KEY` / `MAIL_FROM` env, kabinet email formasi. `/api/me` endi `name` qaytaradi.
- **Web:** «Telegram orqali kirish» tugmasi. Bot yangi oynada ochiladi (popup bloker'dan himoyalangan), sahifa holatni so'raydi va avtomatik kiradi.
- **Railway:** `TELEGRAM_BOT_TOKEN` va `TELEGRAM_BOT_USERNAME=telegrab_app_bot` qo'yildi (`getMe` → ok, webhook yo'q).
- Hujjatlar yangilandi: claude-connector, panel-install, user-guide, developer, production, `.env.example`.

**Testlar:** `auth.test` (6) — `FakeTelegram` bilan:
- to'liq oqim, sessiya cookie bayroqlari, `/api/me`, logout;
- xabarnoma chati ulanishi;
- qayta kirish shu hisobga (ism yangilanadi);
- boshqa brauzer, soxta siri, ishlatilgan va eskirgan kod;
- hash'lar;
- open redirect, bot sozlanmagan holat (503);
- magic link endpointi yo'q (404).

Test yordamchisi `login()` sessiyani to'g'ridan-to'g'ri beradi. To'liq to'plam: 501 o'tdi (`db` va `storage` testlari moslandi).

**👤:**
- token chatda ochiq yuborildi — doimiy ishlatishdan oldin @BotFather'da `/revoke` qilib yangisini qo'yish;
- bu bot boshqa ilovada ham polling qilsa, `getUpdates` to'qnashadi (bitta iste'molchi bo'lishi kerak).

### Tuzatish: Claude connector ulanishi tugamasdi (2026-10-07)

- **Belgi:** Claude'da "You started connecting to ae-studio but didn't finish". Kabinet faolligida "Ilovaga ruxsat berildi" qayta-qayta yozilgan, `/oauth/token` so'rovi umuman kelmagan.
- **Sabab:** ruxsat sahifasining CSP'si `form-action 'self'` edi. Brauzer form POST'dan keyingi 303 yo'naltirishni ham `form-action` bilan tekshiradi, shuning uchun `https://claude.ai/api/mcp/auth_callback` ga o'tish bloklangan. Server tomoni to'g'ri ishlagan; avtomatik test esa brauzersiz bo'lgani uchun xatoni ko'rmagan.
- **Tuzatish:** `form-action 'self' <redirect_uri origin>` (maxsus sxema bo'lsa `claude:` kabi sxema). Origin client metadata'da ro'yxatdan o'tgan `redirect_uri` dan olinadi.
- **Test:** `oauth.test` har ruxsatda brauzer qoidasini tekshiradi (303 manzili `form-action` ichida). Tuzatishsiz 9 test yiqiladi, tuzatish bilan 15/15.

### Tuzatish: panelni ulashda `The "listener" argument must be of type function` (2026-10-07)

- **Belgi:** AE'da panel → Ulanish: `❌ Ulanish: The "listener" argument must be of type function. Received an instance of Object`.
- **Sabab:** CEP paneli `--mixed-context` rejimida ishlaydi, shu sababli global `URL` — brauzer (Chromium) klassi. Agent `http.request(new URL(...), options, cb)` chaqirgan. CEP'dagi Node (15/16) URL'ni `instanceof` bilan taniydi, brauzer URL'ini tanimaydi va uni `options` deb oladi. Natijada haqiqiy `options` callback o'rniga tushadi va xato chiqadi. Testlar oddiy Node 24 da ishlagani uchun xato ko'rinmagan: u yerda URL duck-typing bilan tanilardi.
- **Tuzatish:** Node `http(s).request` / `get` ga URL satr sifatida beriladi (`target.href`) — `http.ts` va `files.ts` (yuklash va yuklab olish).
- **Test:** `files.e2e` — global `URL` ni Node tanimaydigan "brauzer" klassi bilan almashtirib, `getJson` / `postJson` va fayl yuklash/yuklab olish sinaladi. Tuzatishsiz aynan shu xato chiqadi, tuzatish bilan o'tadi.
- **Reliz:** yangi `apps/panel/release/ae-studio-0.1.0.zxp` (sha256 `dba360ee…`).
- `gate3` to'liq to'plam yuki ostida bir marta timing sabab yiqildi, alohida o'tdi (avval ham kuzatilgan).

### Tuzatish: haqiqiy AE'da "ExtendScript (jsx) AE'ga yuklanmagan" (2026-10-08)

- **Belgi:** panel ulandi, lekin har op (ping, info, comp.create) `AE_SCRIPT_ERROR: ExtendScript (jsx) AE'ga yuklanmagan` qaytardi. AE 2025, Windows.
- **Topilgan nuqsonlar** (testlar mock AE / V8'da o'tgan, haqiqiy ExtendScript ko'rmagan):
  1. **Yakka CR:** Bolt `jsxInclude` json2'ni yakka `\r` bilan qo'shgan — `{\r// ----- EXTENDSCRIPT INCLUDES ------ //\r"object"!=typeof JSON…`. V8 `\r` ni qator oxiri deb biladi. ExtendScript bilmasa, `//` izohi json2 va undan keyingi kodni yutadi va fayl yuklanmaydi.
  2. **Non-ASCII:** bundle'da 50 qatorda UTF-8 belgilar bor edi (o'zbekcha apostrof, `—`, `→`). ExtendScript BOM'siz faylni tizim kodirovkasida (cp1251/1252) o'qishi mumkin.
  3. **Diagnostika yo'q edi:** `$.evalFile` xatosi "yuklanmagan" ostida yashirilardi.
- **Tuzatish:**
  - rollup plagini `extendScriptSafe` (renderChunk va generateBundle): bundle to'liq ASCII (`\uXXXX`) va faqat LF;
  - `loadJsx`: ExtendScript ichida `try/catch` — fayl yo'qligi yoki istisno matni va qatori op xatosiga qo'shiladi;
  - testlar: `jsx-bundle` (ASCII, CR yo'q, include izohi alohida qatorda), bridge diagnostikasi; mock'da jsx fayli ro'yxatga olindi.
- **Reliz:** yangi ZXP (sha256 `07fa3ebf…`).
- **👤:** qayta o'rnatish. Agar yana yuklanmasa, xato matnida AE'dagi aniq sabab va qator raqami ko'rinadi.

### Tuzatish: AE'da `SyntaxError: Expected: )` (jsx 386-qator) (2026-10-08)

- **Diagnostika ishladi:** AE xatoni qator raqami bilan qaytardi.
- **Sabab:** `/^([a-zA-Z]:|[\/]|~)/` va `/[\/]+/` regex'lari. ES3'da (ExtendScript) regex literal ichidagi `/`, hatto `[...]` klassi ichida bo'lsa ham, literalni tugatadi; bu qoidani faqat ES5 yumshatgan. Acorn'ning ES3 rejimi buni tekshirmaydi, shuning uchun test o'tib ketgan.
- **Tuzatish:** `jsx/lib/paths.ts` (3 joy) va `jsx/ops/frames.ts` (1 joy) — `/` o'rniga `\x2f`.
- **Yangi bundle tekshiruvlari** (`jsx-bundle.test`):
  - regex literal ichida escape qilinmagan `/` yo'q — tuzatishsiz aynan "386:" qatorini ko'rsatib yiqiladi;
  - obyekt/massiv literallarida oxirgi vergul yo'q.
- **Reliz:** yangi ZXP (sha256 `e445e2f8…`).

### Tuzatish: AE'da `SyntaxError: Expected: :` (jsx 522-qator) (2026-10-08)

- **Sabab:** `fitScale` dagi ternar ichidagi ternar — `fit === "cover" ? (sx > sy ? sx : sy) : …`. Babel qavslarni olib tashlaydi, ExtendScript parseri esa consequent ichidagi ternarni tushunmaydi. Alternate'dagi ichma-ich ternar (json2'da) ExtendScript'da ishlaydi.
- **Tuzatish:** `jsx/ops/layer.ts` `fitScale` — if/else.
- **Test:** `jsx-bundle` — consequent'da ternar yo'qligi AST bo'yicha tekshiriladi; tuzatishsiz yiqiladi.
- **Oldindan skan** (bittalab kutmaslik uchun): blok ichida funksiya deklaratsiyasi, parametrsiz `catch`, getter/setter, ES5 metodlari (forEach/map/trim/keys/defineProperty/bind …) — bundle'da hech biri yo'q.
- **Reliz:** yangi ZXP.
