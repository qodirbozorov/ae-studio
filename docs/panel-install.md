# AE Studio panelini o'rnatish

After Effects 2022 (22.0) yoki undan yangi versiya kerak (CEP 11+). Windows yoki macOS.

## Oddiy yo'l: reliz papkasi (≈10 daqiqa)

Reliz papkasida quyidagi fayllar bor:

- `ae-studio-<versiya>.zxp` (imzolangan; ffmpeg ichida);
- `.sha256`;
- `install-panel.ps1` va `install-panel.sh`.

1. After Effects'ni yoping.
2. O'rnating:
   - **Windows** (PowerShell, reliz papkasida):
     ```powershell
     powershell -ExecutionPolicy Bypass -File install-panel.ps1
     ```
   - **macOS** (Terminal, reliz papkasida):
     ```bash
     bash install-panel.sh
     ```

   Skript avval Adobe **UnifiedPluginInstallerAgent** (Creative Cloud bilan keladi) orqali o'rnatadi.
   U bo'lmasa, ZXP'ni foydalanuvchi CEP papkasiga ochadi. Eski versiya `.old-<sana>` nomi bilan saqlanadi.
   `PlayerDebugMode` kerak emas.
3. AE → **Window → Extensions → AE Studio**. Birinchi ishga tushirish ustasi 3 qadamda olib boradi:
   1. **Serverga ulanish.** Manzilni kiriting (masalan `https://server-production-9c75.up.railway.app`) va
      «Ulash» bosing. Brauzerda kabinet ochiladi: «Telegram orqali kirish» (botda Start) va kodni
      tasdiqlang.
   2. **Ish papkasi.** Videolar uchun papka tanlang. Ichida `source/`, `audio/`, `out/` yaratiladi.
      Fayllaringizni `source/` ga qo'ying.
   3. **Muhit tekshiruvi.** ffmpeg (panel ichida) va aerender topilganini ko'rasiz, so'ng «Tayyor» bosing.
4. **Claude'ni ulang** ([claude-connector.md](claude-connector.md)) va birinchi videoni so'rang: `/new-reel`
   yoki `/from-template`. Claude'siz yo'l ham bor: panel → Shablonlar → slotlarni to'ldirish →
   «Videoni yaratish».
5. Ixtiyoriy sozlamalar (web kabinet → Sozlamalar):
   - ElevenLabs kaliti — ovoz, musiqa, subtitr;
   - Telegram — xabarnomalar;
   - Brand kit.

## Dasturchi uchun

- Reliz yasash: [release-panel.md](release-panel.md) (`pnpm zxp`).
- Tez sinash (imzosiz):
  1. `pnpm --filter @aes/panel build` bilan build qiling.
  2. `apps/panel/dist/cep/` papkasini `…/CEP/extensions/com.aestudio.panel/` ga nusxalang.
  3. Bir marta `PlayerDebugMode` ni yoqing:
     - Windows (PowerShell):
       ```powershell
       foreach ($v in 11, 12) { New-Item -Force "HKCU:\Software\Adobe\CSXS.$v" | Out-Null; Set-ItemProperty "HKCU:\Software\Adobe\CSXS.$v" PlayerDebugMode "1" }
       ```
     - macOS: `defaults write com.adobe.CSXS.11 PlayerDebugMode 1` (va `.12`).
- Panel konsoli: dev build'da Chrome'da `http://localhost:8860` → DevTools. ZXP'da `.debug` yo'q.

## Nosozliklar

- **Panel menyuda yo'q:** AE'ni to'liq qayta ishga tushiring. Papka nomi `com.aestudio.panel` bo'lishi va
  ichida `CSXS/manifest.xml` bo'lishi kerak.
- **«ffmpeg topilmadi»:** ZXP'ni qayta o'rnating yoki panel Sozlamalarida ffmpeg papkasini bering.
- **«aerender topilmadi»:** render AE Render Queue orqali ishlaydi (sekinroq). Sozlamalarda `aerender.exe`
  yo'lini bering.
- Xato kodlari va yechimlari: [errors.md](errors.md).

## Smoke-test (AE ichida)

AE → **File → Scripts → Run Script File…** → extension papkasidagi `ae-smoke.jsx`. Skript oplarni ikki marta
yuboradi:

- ikkinchi marta `reused` qaytishi kerak — dublikat yaratilmaydi;
- noto'g'ri yo'llar rad etilishi kerak.
