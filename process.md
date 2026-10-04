# AE Studio — Jarayon jurnali

> **Compact yoki yangi sessiyadan keyin avval shu faylni o'qing:** "Joriy holat" → oxirgi 3 hisobot → [ae-studio-phases.md](ae-studio-phases.md) dagi birinchi `[ ]` todo.
> Talab (2026-10-05): har todo bajarilganda shu faylga hisobot yoziladi, shunda compact paytida kontekst yo'qolmaydi.
> Reja: [ae-studio-phases.md](ae-studio-phases.md) (5 faza, 69 todo) · Asl reja: [ae-studio-plan.md](ae-studio-plan.md)

---

## Joriy holat

<!-- Har todo'dan keyin shu blok USTIGA YOZILADI. Tarix pastdagi hisobotlarda saqlanadi. -->

- **Faza:** 1 — Poydevor · jarayonda (3/14)
- **Oxirgi bajarilgan:** P1.03 — shared/errors.ts va Result (2026-10-05)
- **Keyingi todo:** P1.04 — shared/spec.ts (Video Spec)
- **Blokerlar:** git remote yo'q (push uchun repo URL kerak) · P1.08 Railway uchun tasdiq kerak
- **Ochiq qarorlar:** Q1–Q5, Q7–Q10 (phases §9). Yopilgan: Q6 (zod v4)
- **Muhit (2026-10-05):** Windows 10 Pro 19045 · Node v24.21.0 · npm 11.19 · pnpm 12.9.1 (corepack 0.36) · ffmpeg/ffprobe n8.1.3 LGPL · git 2.56 · Railway CLI 5.63.1 (login bor) · Python 3.9 · After Effects bu kompyuterda YO'Q (👤 boshqa kompyuterda sinaladi)
- **Bash tool eslatmasi:** shu sessiyada PATH yangilanmagan, har buyruq oldidan: `export PATH="/c/Users/991106847/AppData/Local/Programs/nodejs:/c/Users/991106847/AppData/Local/Programs/ffmpeg/bin:$PATH"`
- **Muhim yo'llar / URL'lar:** Node `%LOCALAPPDATA%\Programs\nodejs` · ffmpeg `%LOCALAPPDATA%\Programs\ffmpeg\bin` · Railway URL hali yo'q

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
