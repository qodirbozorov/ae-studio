# Panel relizi (ZXP)

Panel bitta imzolangan ZXP fayl sifatida tarqatiladi. Ichida: React UI, Node agent (`agent/agent.cjs`),
ExtendScript bundle (`jsx/index.js`), manifest, ikonkalar va **ffmpeg/ffprobe** (`bin/<platform>-<arch>/`).

## Bir buyruq

```bash
pnpm zxp            # = pnpm --filter @aes/panel release
```

Bu buyruq uch qadamni bajaradi:

1. `scripts/bundle-ffmpeg.mjs` ffmpeg/ffprobe'ni `apps/panel/src/bin/<platform>-<arch>/` ga ko'chiradi.
   Binarlar `AES_FFMPEG_DIR` papkasidan yoki PATH'dan olinadi. Yoniga `LICENSE.txt` va `VERSION.txt`
   yoziladi. Build GPL yoki nonfree bo'lsa skript to'xtaydi.
2. `vite build` (ZXP rejimi) ishga tushadi. `src/bin` ZXP'ga kiradi, `.debug` (CEP debug portlari) chiqarib
   tashlanadi. Keyin self-signed sertifikat bilan imzolanadi (DigiCert timestamp).
3. `scripts/name-zxp.mjs` natijani `apps/panel/release/ae-studio-<versiya>.zxp` ga ko'chiradi va
   `.sha256` faylini yozadi.

Bu muhitda (Windows, `NoDefaultCurrentDirectoryInExePath=1`) buyruqni shunday ishga tushiring:
`env -u NoDefaultCurrentDirectoryInExePath pnpm zxp`.

Tekshiruv: `ZXPSignCmd -verify <fayl>.zxp -certinfo` natijasi "Signing Certificate: Valid" bo'lishi kerak.

## Versiyalash

Versiya `apps/panel/package.json` dagi `version` maydonidan olinadi. U uch joyga tushadi:

- manifestdagi `ExtensionBundleVersion`;
- panel sarlavhasi (`v0.1.0`);
- reliz fayli nomi.

Har relizda versiyani oshiring (semver):

- patch — xato tuzatish;
- minor — yangi imkoniyat;
- major — protokol o'zgarishi.

Server panel versiyasini `hello` xabaridan biladi.

## ffmpeg qayerdan olinadi (agent)

Agent ffmpeg'ni quyidagi tartibda qidiradi:

1. Sozlamalardagi papka (`ffmpeg_dir`).
2. ZXP ichidagi `bin/<platform>-<arch>/`.
3. PATH.

Panel → Muhit bo'limida qaysi biri ishlatilayotgani ko'rinadi.

## Qarorlar

- **Q8 — imzolash:** self-signed sertifikat. Shaxsiy va jamoaviy tarqatish uchun yetarli: ZXP Installer va
  `UnifiedPluginInstallerAgent` uni qabul qiladi. Parol `ZXP_PASSWORD` env orqali beriladi. Adobe Exchange'da
  sotish kerak bo'lsa, tijoriy sertifikat olinadi (👤).
- **Q9 — ffmpeg litsenziyasi:** faqat LGPL build tarqatiladi, o'zgartirilmagan holda va manba havolasi bilan
  (`LICENSE.txt`). Hozirgi Windows build: `n8.1.3 LGPL`, ~130 MB (ZXP ~110 MB).

## 👤 macOS

macOS ZXP'si Mac'da quriladi (har platforma o'z binarlarini qo'shadi):

```bash
AES_FFMPEG_DIR=/path/to/ffmpeg-lgpl pnpm zxp
```

Universal (Windows + macOS) ZXP kerak bo'lsa:

1. Windows'dagi `src/bin/win32-x64` ni Mac'dagi `src/bin` ga ko'chiring.
2. Mac'da `pnpm zxp` ni ishga tushiring.
3. Ikkala papka ham bitta ZXP'ga kiradi. Agent o'z platformasinikini tanlaydi.
