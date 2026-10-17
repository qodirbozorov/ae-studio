# AE Studio paneli — macOS relizi (Mac'ning o'zida)

> Mac'da VS Code'da ochib, qadamlarni ketma-ket bajaring (Claude Code'ga ham shu faylni berish mumkin:
> «docs/mac-release.md bo'yicha Mac relizini tayyorla»).

## Qisqa hisobot (2026-10-17)

| Qism | Holat |
|---|---|
| Panel (React UI, Node agent, ExtendScript) | Kross-platforma. macOS yo'llari kodda bor (aerender `.app` yonida, `~/Library/...`), lekin **Mac'da hali sinalmagan** |
| O'rnatish skripti | `scripts/install/install-panel.sh` — tayyor (UPIA yoki qo'lda; karantin belgisi olib tashlanadi) |
| ffmpeg / ffprobe | ZXP'da hozir faqat **Windows** binarlari. Mac uchun **LGPL static** build kerak — shu yerda yig'iladi |
| Imzo | `vite-cep-plugin` ichidagi `ZXPSignCmd` (macOS binari bor), self-signed sertifikat |
| Server | Build vaqtidagi `VITE_AES_SERVER_URL` (sukut — prod), panelda faqat «Kirish» tugmasi |

Nima uchun Homebrew'dagi ffmpeg emas: u GPL va Homebrew kutubxonalariga dinamik bog'langan — boshqa Mac'da
ishlamaydi va tarqatib bo'lmaydi (Q9: faqat LGPL). Shuning uchun manbadan, tashqi kutubxonalarsiz yig'amiz.
Panelga kerak bo'lgan hamma narsa ichki kodeklarda bor: PCM/WAV, AAC, MJPEG/PNG, H.264 (`h264_videotoolbox`).

Natija: alohida **`ae-studio-<versiya>-mac.zxp`** (Windows ZXP'ga Mac binarlarini qo'shmaymiz — Windows ffmpeg
256 MB, universal fayl juda og'ir bo'ladi).

---

## 0. Talablar

- macOS 12+; Apple Silicon (M1–M4) yoki Intel — qaysi Mac'da yig'sangiz, shu arxitektura chiqadi.
- Xcode Command Line Tools: `xcode-select --install`
- Homebrew (faqat yig'ish asboblari uchun): `brew install nasm pkg-config`
- Node 24 LTS (`brew install node@24` yoki nvm) va pnpm: `corepack enable`
- After Effects 2022 (22.0) yoki yangi.

## 1. Repo

```bash
git clone <repo-url> video-ae-ai-plugin
cd video-ae-ai-plugin
pnpm install
pnpm --filter @aes/panel typecheck
```

## 2. LGPL static ffmpeg (≈10–15 daqiqa)

Windows'dagi bilan bir xil versiya oilasini oling (hozir **8.1.x**; aniq nom — <https://ffmpeg.org/releases/>).

```bash
mkdir -p ~/build && cd ~/build
curl -LO https://ffmpeg.org/releases/ffmpeg-8.1.tar.xz      # oxirgi 8.1.x
tar xf ffmpeg-8.1.tar.xz && cd ffmpeg-8.1

./configure \
  --prefix="$HOME/ffmpeg-lgpl" \
  --disable-gpl --disable-nonfree \
  --enable-static --disable-shared \
  --disable-autodetect \
  --enable-zlib --enable-videotoolbox --enable-audiotoolbox \
  --disable-doc --disable-debug --disable-ffplay

make -j"$(sysctl -n hw.ncpu)" && make install
```

`--disable-autodetect` — Homebrew kutubxonalari (SDL, xz, ...) jimgina ulanib qolmasin.

**Tekshiruv (hammasi shart):**

```bash
B=~/ffmpeg-lgpl/bin
$B/ffmpeg -version | grep -c -- '--enable-gpl'          # 0 bo'lishi kerak
otool -L $B/ffmpeg | grep -v -E '/usr/lib/|/System/Library/' | tail -n +2   # bo'sh bo'lishi kerak
$B/ffmpeg -hide_banner -encoders | grep -E 'h264_videotoolbox|aac|mjpeg|png|pcm_s16le'
$B/ffprobe -version | head -1
```

`otool` chiqishida `/opt/homebrew/...` yoki `/usr/local/...` bo'lsa — build boshqa Mac'da ishlamaydi:
`configure`'ni `--disable-autodetect` bilan qayta bajaring.

## 3. ZXP'ga qo'shish va reliz

```bash
cd ~/…/video-ae-ai-plugin
AES_FFMPEG_DIR=~/ffmpeg-lgpl/bin AES_ZXP_SUFFIX=-mac pnpm --filter @aes/panel release
```

Bu:
1. `bundle-ffmpeg.mjs` — litsenziyani tekshiradi (GPL bo'lsa to'xtaydi) va binarlarni
   `apps/panel/src/bin/darwin-arm64/` (Intel'da `darwin-x64/`) ga, `VERSION.txt` + `LICENSE.txt` bilan qo'yadi;
2. `pnpm zxp` — build va imzo (`ZXPSignCmd`);
3. `name-zxp.mjs` — `apps/panel/release/ae-studio-<versiya>-mac.zxp` (+ `.sha256`) va `install-panel.sh`.

`ZXPSignCmd` "permission denied" yoki "cannot be opened" desa:

```bash
S=$(ls -d node_modules/.pnpm/vite-cep-plugin*/node_modules/vite-cep-plugin/lib/bin)
chmod +x "$S/ZXPSignCmd" && xattr -d com.apple.quarantine "$S/ZXPSignCmd" 2>/dev/null; true
```

Windows'da yig'ilgan binarlar `src/bin/win32-x64/` Mac'dagi klonda yo'q (`.gitignore`) — Mac ZXP'da faqat
darwin papkasi bo'ladi, shu to'g'ri.

**Ikkala arxitektura kerak bo'lsa** (Apple Silicon + Intel): Intel Mac'da 2-bosqichni takrorlab,
`~/ffmpeg-lgpl/bin/{ffmpeg,ffprobe}` ni shu repodagi `apps/panel/src/bin/darwin-x64/` ga nusxalang, so'ng
`AES_ZXP_SUFFIX=-mac pnpm --filter @aes/panel zxp && node apps/panel/scripts/name-zxp.mjs`
(bundle bosqichisiz — ikkala papka ZXP'ga kiradi).

## 4. O'rnatish

After Effects'ni yoping:

```bash
cd apps/panel/release
bash install-panel.sh ae-studio-<versiya>-mac.zxp
```

Skript UPIA (Creative Cloud) bilan o'rnatadi, bo'lmasa `~/Library/Application Support/Adobe/CEP/extensions/`
ga ochadi, ffmpeg'ga `chmod +x` va karantin belgisini olib tashlaydi. AE → **Window → Extensions → AE Studio**.

## 5. Mac'da sinov ro'yxati

- [ ] Panel ochiladi, «Kirish» → brauzerda Telegram tasdig'i → profil va «● Server» yashil.
- [ ] Ish papkasi tanlanadi (`~/…` yo'l, bo'sh joy va kirill harfli nom bilan ham).
- [ ] Muhit tekshiruvi: **ffmpeg ✓** (Sozlama → ffmpeg yo'li bo'sh — ZXP ichidagisi ishlatiladi).
- [ ] Claude: `env_check` → `assets_scan` (video davomiyligi va o'lchami to'g'ri — ffprobe) → `asset_preview`.
- [ ] Kichik job (3 sahna) → VERIFY → panelda «Tasdiqlash».
- [ ] Audio: videodan ovoz ajratish (transkripsiya yoki standart tozalash) — `audio.extract` xatosiz.
- [ ] Render (faqat sinov uchun, qisqa): aerender topiladi (`/Applications/Adobe After Effects 20xx/aerender`),
      MP4 `out/` da; encoder `h264_videotoolbox`.
- [ ] Panelni yopib-ochish va AE'ni qayta ishga tushirish — sessiya saqlanadi, qayta ulanadi.

Xato bo'lsa — loglar:
- CEP: `~/Library/Logs/CSXS/` (`CEP*-AEFT.log`), panel ichidagi DevTools uchun
  `defaults write com.adobe.CSXS.11 PlayerDebugMode 1` (AE 2024+ uchun `.12` ham).
- Panel → Live log va Tarix; serverda job log (kabinet → Tarix).

Topilgan xatolarni (log parchasi bilan) Windows'dagi sessiyaga yuboring yoki shu repoda tuzating
(`apps/panel/src/agent/*` — Node agent, `apps/panel/src/jsx/*` — ExtendScript).

## 6. Yakun

- [ ] `release/ae-studio-<versiya>-mac.zxp` va `.sha256` ni saqlang (git'ga kirmaydi).
- [ ] Kod o'zgargan bo'lsa — commit va push.
- [ ] `process.md` → Blokerlar'dan "👤 Mac: macOS ZXP" ni olib tashlang, qisqa hisobot yozing.
