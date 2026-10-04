# AE Studio — Claude + After Effects + ElevenLabs

> Prompt orqali After Effects'da video yig'adigan tizim.
> Holat: **qat'iy reja (v1.0)** · 2026-10-05
> Stack: **TypeScript** (hamma joyda) · **Railway** (server) · **CEP** (AE panel) · **ElevenLabs** (barcha audio)

---

## 0. Qat'iy qarorlar (o'zgarmaydi)

| # | Qaror | Sabab |
|---|---|---|
| D1 | Server (miya) **Railway**'da: remote MCP, job state, compiler, ElevenLabs, hisobot | Claude web/desktop/telefondan ishlaydi, job tarixi yo'qolmaydi |
| D2 | AE plugin = **CEP panel** (React + Node). Panelning o'zi local agent | Node CEP ichida bor, alohida dastur shart emas |
| D3 | UXP **yo'q** | CEP yetarli va barqaror |
| D4 | Claude **ExtendScript yozmaydi**. Claude → Spec → server compiler → Op → panel | Xavfsizlik, barqarorlik, resume |
| D5 | Asl media **localda qoladi**. Cloudga faqat: metadata, thumbnail/kadrlar, ElevenLabs uchun audio, generatsiya natijalari | Trafik, maxfiylik |
| D6 | ElevenLabs kaliti **faqat serverda** (shifrlangan, user akkauntiga bog'langan) | Kalit panel/Claude'ga hech qachon chiqmaydi |
| D7 | Bitta til — **TypeScript**, bitta sxema paketi (`shared`, zod) | Server, panel, MCP bir kontraktdan foydalanadi |
| D8 | Panel ↔ server: **outbound WebSocket** (panel ulanadi) | Port ochish, tunnel kerak emas |
| D9 | Native Node modullar **yo'q** panel ichida | CEP Node ABI muammosi |

---

## 1. Arxitektura

```
┌────────────────┐   HTTPS (MCP, OAuth)   ┌──────────────────────────── RAILWAY ───────────────────────────┐
│ Claude         │ ─────────────────────▶ │  api (Fastify)                                                  │
│ (web/desktop/  │ ◀───────────────────── │   ├─ /mcp        Remote MCP (Streamable HTTP)                   │
│  telefon)      │                        │   ├─ /oauth/*    OAuth 2.1 (Claude connector) + device flow     │
└────────────────┘                        │   ├─ /ws/agent   panel WebSocket                                │
                                          │   ├─ /api/*      web kabinet uchun REST                         │
                                          │   ├─ jobs/       state machine + navbat                         │
                                          │   ├─ compiler/   Spec → oplist                                  │
                                          │   ├─ eleven/     ElevenLabs client (to'liq)                     │
                                          │   └─ reports/    report.md generatori                           │
                                          │  worker (BullMQ)  uzoq ElevenLabs ishlari                       │
                                          │  Postgres  ·  Redis  ·  Object storage (R2/S3)                  │
                                          └───────────────────────────────▲────────────────────────────────┘
                                                                          │ WSS (outbound, token)
┌──────────────────────────────── FOYDALANUVCHI KOMPYUTERI ───────────────┴───────────────────────────────┐
│  After Effects                                                                                          │
│   └─ CEP panel "AE Studio" (React + Node)                                                               │
│        ├─ agent: WS client, fayl skaner, ffmpeg/ffprobe, upload/download                               │
│        ├─ op runner → evalScript → jsx/ops.jsx (ExtendScript ES3)                                      │
│        └─ UI: status, live log, job tarixi, shablonlar, sozlamalar                                     │
│  Ish papkasi: /source /audio /frames /out /logs /.aestudio                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Qoida:** Claude, panel va ElevenLabs bir-biri bilan to'g'ridan-to'g'ri gaplashmaydi — faqat server orqali.

---

## 2. Loop qoidalari (uchi ochiq qolmasligi uchun)

1. **Yagona haqiqat manbai** — Postgres'dagi `jobs` + `job_events`. Claude ham, panel ham shuni o'qiydi.
2. **Har bosqich gate bilan tugaydi.** O'tmasa: `error { code, retryable, hint }`.
3. **Har chaqiruvda timeout** (AE op, ElevenLabs, upload, ffmpeg).
4. **Uzoq ishlar asinxron**: tool `job_id` / `task_id` qaytaradi → `job_status`.
5. **Idempotent oplar**: har op `op_id` bilan, AE'da iz qoldiradi → `resume` dublikatsiz.
6. **Xatolar tasniflangan** (§12).
7. **VERIFY majburiy**, patch sikli maksimal **3** → keyin `ask_user`.
8. **Har job `REPORT` bilan yopiladi** — muvaffaqiyat ham, to'xtash ham.
9. **Panel uzilsa** job `WAITING_AGENT` ga o'tadi, ulanganda avtomatik davom etadi.
10. **Hech narsa o'chirilmaydi**: `.aep` va `plan.json` versiyalanadi (v001, v002…).

---

## 3. Holat mashinasi

```
CHECK → PLAN → INGEST → AUDIO → PREFLIGHT → BUILD → VERIFY → RENDER → REPORT → DONE
                                              ▲        │
                                              └─patch──┘ (max 3)

har qanday holat ──xato──▶ BLOCKED ──(retry | patch | ask_user | cancel)──▶ ... ──▶ REPORT
har qanday holat ──agent yo'q──▶ WAITING_AGENT ──(panel ulandi)──▶ oldingi holat
```

| Holat | Nima bo'ladi | Gate | Natija |
|---|---|---|---|
| CHECK | Server, panel online, AE versiyasi, papka tanlangan, ElevenLabs kaliti/kvota, ffmpeg | Hammasi `ok` | `env_report` |
| PLAN | Claude `plan.json` (Video Spec) yozadi, server zod bilan tekshiradi | Valid, barcha `asset:` havolalar nomlangan | `plan` v1 |
| INGEST | Panel papkani skanerlaydi, ffprobe, thumbnail/kadrlar → storage | Har fayl o'qildi yoki Claude buzuqni rad etdi | `assets` |
| AUDIO | Spec'dagi barcha ElevenLabs vazifalari (§7) | Har vazifa `done` / `skipped(sabab)` | `audio_tasks`, fayllar `/audio` da |
| PREFLIGHT | Havolalar ↔ fayllar, davomiyliklar (TTS-first timing), shriftlar, shablonlar, narx | `missing[]` bo'sh | `oplist` |
| BUILD | Panel oplarni ketma-ket bajaradi, live log | Barcha oplar `done` | `.aep` vNNN |
| VERIFY | Kalit vaqtlarda kadrlar → Claude ko'radi | `approve` yoki `patch` | `frames` |
| RENDER | Render Queue yoki `aerender` | Fayl bor, davomiylik = spec | `out/*.mp4` |
| REPORT | Qurilganlar, yo'llar, tahrir qo'llanmasi, ogohlantirishlar, kredit sarfi | Doim | `report.md` (chatda + panelda) |

---

## 4. Auth va ulanish

### 4.1 Claude ↔ server (custom connector)
- Server **OAuth 2.1** authorization server: `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, dynamic client registration, PKCE.
- User Claude'da: *Settings → Connectors → Add custom connector* → `https://<app>.up.railway.app/mcp` → login → ruxsat.
- Access token → `user_id`. Har MCP chaqiruv shu userning qurilmasi/joblari bilan ishlaydi.

### 4.2 Panel ↔ server (device flow)
1. Panel → `POST /oauth/device/code` → `user_code` (6 belgi) + `verification_uri`.
2. Panel kodni ko'rsatadi va brauzerni ochadi.
3. User web'da login qiladi, kodni tasdiqlaydi.
4. Panel `POST /oauth/device/token` ni poll qiladi → `device_token` (uzoq muddatli, bekor qilinadigan).
5. Token CEP user data papkasiga shifrlab yoziladi (`.aestudio/credentials`, AES, kalit mashinaga bog'liq).
6. Panel `wss://…/ws/agent` ga `Authorization: Bearer <device_token>` bilan ulanadi.

### 4.3 Web kabinet (minimal)
- Login (email magic link yoki Google), device kodni tasdiqlash, ulangan qurilmalar, ElevenLabs kalitini kiritish, job tarixi.
- Xuddi shu React; `api` servis static qilib beradi.

### 4.4 Xavfsizlik
- ElevenLabs kaliti Postgres'da **AES-256-GCM** bilan (master key Railway env'da).
- Fayl yo'llari faqat tanlangan ish papkasi ichida (path traversal tekshiruvi panelda ham, serverda ham).
- Storage'ga yuklash/yuklab olish — faqat **pre-signed URL** (15 daqiqa).
- Rate limit: user bo'yicha MCP va ElevenLabs chaqiruvlari.

---

## 5. Ma'lumotlar modeli (Postgres)

```sql
users            (id, email, created_at)
devices          (id, user_id, name, os, ae_version, last_seen_at, revoked_at)
oauth_clients    (id, redirect_uris, created_at)
oauth_tokens     (id, user_id, client_id, kind, hash, expires_at, revoked_at)
secrets          (user_id, provider, ciphertext, iv, tag, updated_at)      -- elevenlabs
projects         (id, user_id, device_id, name, root_path, created_at)
plans            (id, project_id, version, spec jsonb, created_by, created_at)
assets           (id, project_id, key, local_path, kind, meta jsonb, thumb_url, hash)
jobs             (id, project_id, plan_version, state, prev_state, patch_count, error jsonb, created_at, updated_at)
job_events       (id, job_id, ts, level, type, op_id, message, data jsonb)  -- live log manbai
ops              (id, job_id, seq, op_id, op, params jsonb, status, started_at, finished_at, error jsonb)
audio_tasks      (id, job_id, kind, params jsonb, params_hash, status, storage_key, local_path, duration_ms, credits, error jsonb)
eleven_cache     (params_hash, kind, storage_key, duration_ms, created_at)
templates        (id, user_id|null, slug, manifest jsonb, version)
brands           (id, user_id, slug, data jsonb)
renders          (id, job_id, preset, local_path, duration_ms, status)
reports          (id, job_id, markdown, created_at)
```

**Storage kalitlari:** `u/<user>/p/<project>/{thumbs|frames|audio-in|audio-out}/<hash>.<ext>`

---

## 6. Fayllar oqimi (data yo'qolmasligi)

| Fayl | Qayerda turadi | Cloudga chiqadimi |
|---|---|---|
| Asl video/rasm (`/source`) | Faqat local | Yo'q — faqat metadata + thumbnail/kadrlar |
| Referenslar uchun preview | Panel ffmpeg bilan tayyorlaydi (`asset_preview` so'raganda) | Ha, kichik JPG (≤1280px) |
| STT / alignment / isolation / dubbing uchun audio | Panel ffmpeg bilan ajratadi (`audio-in`) | Ha |
| ElevenLabs natijalari | Storage → panel yuklab `/audio` ga qo'yadi | Ha (kesh) |
| `.aep` loyiha | Local, versiyalanadi | Yo'q (ixtiyoriy backup keyin) |
| VERIFY kadrlari | `saveFrameToPng` → `/frames` → storage | Ha |
| Render | Local `/out` | Yo'q (ixtiyoriy) |
| `plan.json`, `report.md` | Postgres + local nusxa `.aestudio/` | Ha |

Panel har yuklab olingan fayl uchun **sha256** tekshiradi. Mos kelmasa qayta yuklaydi (3 marta), keyin `ASSET_CORRUPT`.

---

## 7. ElevenLabs — to'liq imkoniyatlar

Server `@elevenlabs/elevenlabs-js` SDK'dan foydalanadi. Endpoint yo'llari va parametrlarni yozishda rasmiy API reference'dan tekshiring (`elevenlabs.io/docs/api-reference`).

| Imkoniyat | Endpoint (asosiy) | Loopda ishlatilishi | MCP tool |
|---|---|---|---|
| Text-to-Speech | `POST /v1/text-to-speech/{voice_id}` (+ `/with-timestamps`, `/stream`) | Voiceover; timestamps → subtitr va sahna vaqtlari | `el_tts` |
| Text-to-Dialogue | `POST /v1/text-to-dialogue` | Bir nechta personaj suhbati | `el_dialogue` |
| Speech-to-Text (Scribe) | `POST /v1/speech-to-text` | Video transkripti, so'z timestamp, diarization, audio eventlar | `el_stt` |
| Forced Alignment | `POST /v1/forced-alignment` | Tayyor matn + audio → aniq so'z vaqtlari (subtitr) | `el_align` |
| Sound Effects | `POST /v1/sound-generation` | Transition, aksent, ambient | `el_sfx` |
| Music | `POST /v1/music`, `/v1/music/detailed`, `/v1/music/stream` + composition plan | Fon musiqa, aniq davomiylik, instrumental, bo'limlar | `el_music`, `el_music_plan` |
| Voice Changer (STS) | `POST /v1/speech-to-speech/{voice_id}` | Yozilgan ovozni boshqa ovozga | `el_voice_change` |
| Audio Isolation | `POST /v1/audio-isolation` | Shovqinli videodan toza ovoz | `el_isolate` |
| Dubbing | `POST /v1/dubbing` (+ status, natija) | Videoni boshqa tilga dublyaj | `el_dub` |
| Voice Design | `POST /v1/text-to-voice/design` (+ create) | Tavsifdan yangi ovoz | `el_voice_design` |
| Voice Cloning (IVC) | `POST /v1/voices/add` | Mijoz ovozini klonlash (rozilik bilan) | `el_voice_clone` |
| Voices / Models | `GET /v1/voices`, `GET /v1/models` | Ovoz va model tanlash | `el_voices`, `el_models` |
| Pronunciation dictionaries | `/v1/pronunciation-dictionaries/*` | Brend nomlari, o'zbekcha so'zlar talaffuzi | `el_pronunciation` |
| Subscription / usage | `GET /v1/user/subscription` | Kvota, narx bahosi | `el_usage` |

### 7.1 Qoidalar
- **Bitta umumiy `audio_task` modeli**: har vazifa `kind` + `params` → `params_hash` → kesh tekshiruvi → navbat (BullMQ) → natija storage'ga → panelga `audio.ready` eventi.
- **Kesh**: bir xil `params_hash` qayta generatsiya qilinmaydi.
- **Narx bahosi**: AUDIO dan oldin `el_estimate` → belgilar/sekundlar → kvotadan oshsa `ask_user`.
- **Retry**: 429/5xx → 3 marta exponential backoff. 401 → `EL_AUTH`, 402/kvota → `EL_QUOTA` (retryable: false).
- **Asinxron endpointlar** (dubbing va h.k.): worker status'ni poll qiladi, timeout 30 daqiqa.
- **TTS-first timing**: voiceover avval, keyin uning haqiqiy davomiyligi bo'yicha sahnalar qayta hisoblanadi (PREFLIGHT).
- **Ducking**: musiqa ovoz ostida avtomatik pasayadi (`audio.duck` op).
- **O'zbek tili**: M5 da STT/TTS sifat testi majburiy. Talaffuz uchun pronunciation dictionary + `transcript_edit`.
- **Voice cloning**: faqat egasining roziligi tasdiqlangandan keyin (`consent: true` majburiy parametr).

---

## 8. MCP toollar (to'liq ro'yxat)

Javob formati: `{ ok: true, data } | { ok: false, error: { code, retryable, hint } }`

| Guruh | Tool | Vazifa |
|---|---|---|
| Muhit | `env_check` | Server, panel, AE, papka, ElevenLabs, ffmpeg holati |
| | `devices_list` | Ulangan qurilmalar |
| | `ae_info` | AE versiyasi, ochiq loyiha, comp'lar, shriftlar |
| Loyiha | `project_create` | Ish papkasida loyiha (`/source /audio /frames /out /logs`) |
| | `project_list` / `project_get` | Loyihalar va holati |
| | `plan_write` / `plan_patch` / `plan_get` | Spec yozish, JSON-patch, versiyalar |
| Fayllar | `assets_scan` | Papkani skanerlash, ffprobe |
| | `asset_preview` | Rasm thumbnail yoki videodan N kadr (Claude ko'radi) |
| | `assets_list` | Assetlar va metadata |
| Audio | `el_tts` `el_dialogue` `el_stt` `el_align` `el_sfx` `el_music` `el_music_plan` `el_voice_change` `el_isolate` `el_dub` `el_voice_design` `el_voice_clone` `el_voices` `el_models` `el_pronunciation` `el_usage` `el_estimate` | §7 |
| | `audio_tasks_status` | Audio vazifalar holati |
| | `transcript_get` / `transcript_edit` | Transkriptni o'qish/tuzatish |
| Qurish | `preflight` | Tekshiruv + oplist kompilyatsiyasi |
| | `build_start` (`dry_run`) | Qurishni boshlash |
| | `job_status` | Holat, foiz, oxirgi N log |
| | `job_resume` / `job_cancel` / `job_list` | Boshqaruv va tarix |
| Tekshirish | `frames_capture` | Comp kadrlari (vaqtlar ro'yxati) |
| | `verify_approve` / `verify_patch` | Tasdiq yoki patch |
| Render | `render_start` / `render_presets` | Render |
| Shablon | `templates_list` / `template_get` / `template_apply` / `template_save` | §11 |
| | `brands_list` / `brand_save` | Brand kit |
| Hisobot | `report_get` | Yakuniy markdown |

**MCP prompts** (Claude'da tayyor buyruqlar): `/new-reel`, `/subtitle-video`, `/dub-video`, `/from-template`.

---

## 9. Video Spec (plan.json)

```json
{
  "version": 1,
  "format": { "w": 1080, "h": 1920, "fps": 30, "duration": "auto" },
  "variants": ["9:16", "1:1"],
  "brand": "default",
  "audio": {
    "voiceover": { "kind": "tts", "voice_id": "…", "model_id": "…", "text": "…", "pronunciation": ["brand-uz"] },
    "music":     { "kind": "music", "prompt": "upbeat corporate", "length": "match_video", "instrumental": true, "duck_under": "voiceover" },
    "sfx":       [ { "id": "whoosh1", "prompt": "fast whoosh", "duration_s": 0.8, "at": "s1.end" } ],
    "captions":  { "from": "voiceover", "method": "tts_timestamps", "style": "karaoke_bold" },
    "source_audio": { "asset": "asset:interview_01", "isolate": true, "transcribe": true }
  },
  "scenes": [
    { "id": "s1", "dur": "vo:0-1", "template": "hook_title",
      "slots": { "title": "3 ta xato", "bg": "asset:clip_01" }, "transition_out": "whip_left" },
    { "id": "s2", "dur": "vo:1-3",
      "layers": [
        { "type": "media", "src": "asset:photo_02", "anim": "ken_burns_in" },
        { "type": "text", "text": "…", "anim": "typewriter", "pos": "lower_third" }
      ] }
  ],
  "output": { "preset": "h264_social", "name": "reel_v1" }
}
```

- `dur: "vo:1-3"` — sahna davomiyligi voiceover'ning 1–3-gaplariga bog'lanadi (TTS-first timing).
- `asset:<key>` — `assets` jadvalidagi kalit.
- Sxema `packages/shared/src/spec.ts` da (zod) → JSON Schema eksport qilinib MCP tool `inputSchema` ga beriladi.

---

## 10. Op tili va panel protokoli

### 10.1 Oplar (yopiq to'plam)

| Op | Parametrlar |
|---|---|
| `project.open_or_create` | path |
| `project.save` | version |
| `item.import` | file, folder |
| `comp.create` | name, w, h, fps, dur, bg |
| `comp.nest` | child, parent, start |
| `layer.add_media` | comp, item, start, dur, fit |
| `layer.add_text` | comp, text, style, pos |
| `layer.add_shape` | comp, kind, color, size |
| `layer.add_audio` | comp, item, start, volume |
| `prop.keyframes` | layer, prop, keys[], ease |
| `prop.expression` | layer, prop, expr_id (faqat kutubxonadan) |
| `fx.apply_preset` | layer, ffx |
| `fx.add` | layer, matchName, params |
| `captions.build` | comp, words[], style |
| `audio.duck` | music_layer, voice_layer, amount_db |
| `template.instantiate` | template, slots, comp, start |
| `frames.capture` | comp, times[] |
| `render.queue` | comp, preset, out |

Har op: `{ op_id, seq, op, params, scene_id, timeout_ms }`.

### 10.2 WebSocket xabarlari (server ↔ panel)

```
server → panel   hello_ack, op.run, ops.batch, asset.preview.request, audio.extract.request,
                 file.download (presigned url, sha256, dest), job.pause, job.cancel, ping
panel → server   hello { device, ae_version, project_root }, op.started, op.done, op.failed,
                 log, asset.scanned, file.uploaded, file.saved, ae.state, pong
```

- Heartbeat: 10 s. 30 s javob bo'lmasa → `WAITING_AGENT`.
- Panel ulanganda `hello` → server tugallanmagan jobni topib davom ettiradi.
- Barcha xabarlar `shared/src/ws.ts` da zod bilan.

### 10.3 ExtendScript tomoni
- `runOp(json)` — dispatcher, `app.beginUndoGroup(op_id)`, `try/catch`, natija doim JSON string.
- `app.beginSuppressDialogs()` — modal oynalar opni osib qo'ymasligi uchun.
- `op_id` layer comment'ga yoziladi → `findByOpId` (resume va patch uchun).
- **Bitta evalScript = bitta op** (AE UI bloklanmasligi uchun).
- TS da yoziladi → ES3 `.jsx` ga build (Bolt CEP), `json2` polyfill.

---

## 11. Panel UI va shablonlar

### 11.1 Panel ekranlari
1. **Ulanish** — device kod, holat: 🟢 Server · 🟢 AE · 🟢 Claude · 🟢 ElevenLabs.
2. **Ish papkasi** — tanlash, oxirgi loyihalar.
3. **Live** — joriy job: holat zanjiri, progress (op soni), joriy sahna, live log (`⏳ → ✅ / ❌`), Pause / Resume / Cancel / Undo last.
4. **Tarix** — joblar (serverdan), hisobotni ochish, qayta render.
5. **Shablonlar** — galereya (preview gif), slotlarni qo'lda to'ldirib ishga tushirish (Claude'siz rejim).
6. **Audio** — generatsiya qilingan fayllar, eshitish, qayta generatsiya.
7. **Sozlamalar** — qurilma nomi, chiqish, log darajasi.

### 11.2 Shablon formati
`templates/<slug>/` → `template.aep` + `template.json` + `preview.gif`

```json
{
  "slug": "hook_title",
  "comp": "HOOK",
  "duration": { "min": 2, "max": 6, "stretch": "time_remap" },
  "formats": ["9:16", "1:1", "16:9"],
  "slots": {
    "title":  { "type": "text",  "layer": "TITLE", "max_chars": 40 },
    "bg":     { "type": "media", "layer": "BG_PLACEHOLDER", "fit": "cover" },
    "accent": { "type": "color", "egp": "Accent Color" }
  }
}
```

Boshlang'ich kutubxona: hook/sarlavha, lower third, subtitr stillari (karaoke, bold pop, minimal), transitionlar (`.ffx`), CTA/outro, product showcase, testimonial, top-3 ro'yxat.

### 11.3 Brand kit
`brand.json`: ranglar, shriftlar (+ fallback), logo asset, subtitr stili, default ovoz va musiqa uslubi.

### 11.4 Qo'shimchalar (prioritet tartibida)
1. Format variantlari (bitta Spec → 9:16, 1:1, 16:9)
2. Dry-run (AE'ga tegmasdan oplist + vaqt + kredit bahosi)
3. Batch (shablon + CSV → N ta video)
4. Expression kutubxonasi (wiggle, bounce, loop — nom bilan)
5. Telegram xabarnoma (render tugaganda)
6. Web kabinetda job tarixi va hisobotlar

---

## 12. Xato kodlari

| Prefiks | Misollar | Retryable |
|---|---|---|
| `ENV_` | `ENV_AGENT_OFFLINE`, `ENV_AE_CLOSED`, `ENV_NO_FOLDER`, `ENV_FFMPEG_MISSING` | ha (kutib) |
| `AUTH_` | `AUTH_EXPIRED`, `AUTH_DEVICE_REVOKED` | yo'q |
| `SPEC_` | `SPEC_INVALID` (zod path bilan), `SPEC_UNKNOWN_ASSET`, `SPEC_UNKNOWN_TEMPLATE` | yo'q → `plan_patch` |
| `ASSET_` | `ASSET_MISSING`, `ASSET_CORRUPT`, `ASSET_UNSUPPORTED` | qisman |
| `EL_` | `EL_AUTH`, `EL_QUOTA`, `EL_RATE_LIMIT`, `EL_TIMEOUT`, `EL_BAD_PARAMS` | `RATE_LIMIT`, `TIMEOUT` ha |
| `AE_` | `AE_SCRIPT_ERROR`, `AE_TIMEOUT`, `AE_FONT_MISSING`, `AE_VERSION` | `TIMEOUT` ha |
| `RENDER_` | `RENDER_FAILED`, `RENDER_DURATION_MISMATCH` | ha |
| `LOOP_` | `LOOP_PATCH_LIMIT` | yo'q → `ask_user` |

---

## 13. Repo tuzilishi

```
ae-studio/
├─ packages/
│  ├─ shared/        # zod: spec, ops, ws, mcp io, errors, template manifest
│  └─ compiler/      # Spec → oplist (sof funksiya, unit testlar)
├─ apps/
│  ├─ server/        # Railway: Fastify + MCP + OAuth + WS + jobs + eleven + reports
│  │  ├─ src/mcp/
│  │  ├─ src/oauth/
│  │  ├─ src/ws/
│  │  ├─ src/jobs/        # state machine
│  │  ├─ src/eleven/      # har imkoniyat alohida fayl
│  │  ├─ src/storage/     # R2/S3, presigned
│  │  ├─ src/reports/
│  │  └─ src/db/          # Drizzle schema + migrations
│  ├─ worker/        # BullMQ: ElevenLabs uzoq ishlar
│  ├─ web/           # kabinet: login, device tasdiq, kalitlar, tarix (React + Vite)
│  └─ panel/         # Bolt CEP: React + Vite + jsx
│     ├─ src/js/          # UI, agent, ws, ffmpeg wrapper
│     ├─ src/jsx/         # ExtendScript oplar (TS → ES3)
│     └─ cep.config.ts    # manifest sozlamalari
├─ templates/
├─ brands/
└─ docs/
```

### Texnologiyalar

| Qatlam | Texnologiya |
|---|---|
| Server | Node 20+, Fastify, `@modelcontextprotocol/sdk`, zod, Drizzle ORM, Postgres, Redis, BullMQ, pino |
| ElevenLabs | `@elevenlabs/elevenlabs-js` |
| Storage | Cloudflare R2 (S3 API) yoki Railway bucket |
| Panel | Bolt CEP, React, Vite, `ws`-ga mos browser WebSocket, ffmpeg/ffprobe binary (ZXP ichida) |
| AE script | ExtendScript ES3, `types-for-adobe` |
| Test | Vitest (shared, compiler, server), AE ichida smoke-test |
| Deploy | Railway: `server`, `worker`, Postgres, Redis servislari |

### Railway env

```
DATABASE_URL=            REDIS_URL=
PUBLIC_URL=https://<app>.up.railway.app
MASTER_KEY=              # secrets shifrlash (32 bayt, base64)
JWT_SIGNING_KEY=
S3_ENDPOINT=  S3_BUCKET=  S3_ACCESS_KEY=  S3_SECRET_KEY=
ELEVENLABS_DEFAULT_KEY=  # ixtiyoriy, faqat dev uchun
```

---

## 14. Panel o'rnatish va build

**Dev**
```
cd apps/panel
yarn dev            # Bolt CEP: hot reload, extensions papkasiga symlink
# bir marta: PlayerDebugMode
# macOS:   defaults write com.adobe.CSXS.<ver> PlayerDebugMode 1
# Windows: HKCU\Software\Adobe\CSXS.<ver>  PlayerDebugMode = "1"
```
AE → `Window → Extensions → AE Studio`

**Production**
```
yarn build && yarn zxp     # imzolangan ae-studio.zxp
```
User: ZXP Installer yoki `UnifiedPluginInstallerAgent --install ae-studio.zxp`

Extensions papkalari:
- macOS: `~/Library/Application Support/Adobe/CEP/extensions/`
- Windows: `%APPDATA%\Adobe\CEP\extensions\`

`manifest`: `--enable-nodejs`, `--mixed-context`, AE host versiyalari diapazoni.

---

## 15. Milestonelar (har biri "Tayyor" sharti bilan)

- [ ] **M0 — Skelet.** pnpm monorepo, `shared` sxemalar (spec, ops, ws, errors), lint, Vitest, Railway'da bo'sh `server` + Postgres + Redis.
  - Tayyor: `pnpm test` o'tadi, `/health` Railway'da javob beradi.
- [ ] **M1 — Panel ↔ AE.** Bolt CEP panel, `runOp('ping')`, `comp.create`, `layer.add_text`.
  - Tayyor: panel tugmasi AE'da comp yaratadi, live logda ko'rinadi.
- [ ] **M2 — Auth + WS.** Web kabinet login, device flow, panel WSS ulanishi, heartbeat, `WAITING_AGENT`.
  - Tayyor: panel kod orqali ulanadi; internet uzilib qaytsa avtomatik qayta ulanadi.
- [ ] **M3 — Oplar + compiler + jobs.** Barcha oplar, `op_id` idempotentlik, Spec → oplist, state machine, `job_events` → panel live log.
  - Tayyor: qo'lda yozilgan `plan.json` dan 3 sahnali video; o'rtada AE yopilib ochilsa dublikatsiz davom etadi.
- [ ] **M4 — Remote MCP + OAuth.** `/mcp`, OAuth 2.1 (DCR + PKCE), muhit/loyiha/fayl/qurish/hisobot toollari, `asset_preview`.
  - Tayyor: Claude'da custom connector ulanadi, chatda brief + rasmlar → video quriladi → hisobot chatda.
- [ ] **M5 — ElevenLabs to'liq.** `audio_task` modeli, kesh, worker, barcha `el_*` toollar, narx bahosi, TTS-first timing, captions, ducking, o'zbek tili testi.
  - Tayyor: voiceover + karaoke subtitr + generatsiya qilingan musiqa + SFX bilan video; mavjud videoni isolate + transcribe + subtitr qilish ishlaydi.
- [ ] **M6 — Verify + Render.** `frames_capture`, patch sikli (max 3), `aerender`, presetlar.
  - Tayyor: Claude kadrlarni ko'rib xatoni patch qiladi, mp4 chiqadi.
- [ ] **M7 — Shablonlar + brand kit.** Manifest, `template_apply/save`, 5 ta shablon, brand, format variantlari, panelda Claude'siz rejim.
  - Tayyor: bitta Spec'dan 9:16 va 16:9 variantlar brand kit bilan.
- [ ] **M8 — Qadoqlash.** ZXP imzolash, installer (ZXP + ffmpeg), web kabinet tarixi, batch, Telegram xabarnoma, hujjat.
  - Tayyor: toza kompyuterga 10 daqiqada o'rnatilib, birinchi video chiqadi.

---

## 16. Xavflar va yechimlar

| Xavf | Yechim |
|---|---|
| ExtendScript AE'ni bloklaydi | Bitta evalScript = bitta kichik op; og'ir ishlar serverda yoki panel Node'da |
| Modal dialoglar | `beginSuppressDialogs` + op timeout → `AE_TIMEOUT` |
| CEP Node eski | Vite/esbuild transpile, native modullar yo'q |
| Internet uzilishi | `WAITING_AGENT`, avtomatik reconnect, job serverda saqlanadi |
| Katta audio upload | ffmpeg bilan mono/opus siqish, resumable multipart upload |
| ElevenLabs kredit sarfi | Kesh, `el_estimate`, kvota chegarasi → `ask_user` |
| Claude noto'g'ri Spec yozadi | Zod xatolari aniq path bilan, `plan_patch` |
| Patch sikli aylanadi | Max 3 → `LOOP_PATCH_LIMIT` → `ask_user` |
| Shrift yo'q | PREFLIGHT tekshiruvi, brand fallback |
| AE versiya farqi | `ae_info` + oplarda versiya tekshiruvi |

---

## 17. Birinchi hafta — aniq qadamlar

1. `pnpm init` monorepo, `packages/shared` → `spec.ts`, `ops.ts`, `ws.ts`, `errors.ts`.
2. Bolt CEP bilan `apps/panel` yaratish, `PlayerDebugMode`, `runOp('ping')`.
3. `comp.create`, `layer.add_text`, `item.import`, `layer.add_media` oplari + `op_id` izi.
4. Railway: `server` (Fastify `/health`), Postgres, Redis, Drizzle migratsiya (§5).
5. WS: panel → server `hello`, server → panel `op.run`, live log panelda.
