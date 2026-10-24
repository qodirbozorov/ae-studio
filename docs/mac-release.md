# AE Studio paneli — macOS relizi (Mac'ning o'zida)

> Mac'da VS Code'da ochib, qadamlarni ketma-ket bajaring (Claude Code'ga ham shu faylni berish mumkin:
> «docs/mac-release.md bo'yicha Mac relizini tayyorla»).

## Holat (2026-10-17)

| Qism | Holat |
|---|---|
| Panel (React UI, Node agent, ExtendScript) | Kross-platforma. Mac'ga xos joylar tuzatildi (pastda) |
| ffmpeg / ffprobe | `scripts/build-ffmpeg-mac.sh` — LGPL static, Apple Silicon + Intel, macOS 12+ |
| ZXP | `release/ae-studio-<versiya>-mac.zxp` (~51 MB): `bin/darwin-arm64` + `bin/darwin-x64` |
| Imzo | `vite-cep-plugin` ichidagi `ZXPSignCmd` (faqat x86_64 → Apple Silicon'da **Rosetta** kerak) |
| O'rnatish | `install-panel.sh` (UPIA bo'lsa u bilan, bo'lmasa `~/Library/.../CEP/extensions`) |
| Server | Build vaqtidagi `VITE_AES_SERVER_URL` (sukut — prod), Windows bilan bir xil |

**ffmpeg Windows'dagi (BtbN LGPL) bilan bir xil imkoniyatlarda:** panel ishlatadigan hamma narsa bor —
`libopus` (audio ajratish, sukut formati), `libmp3lame` (mp3), `drawtext` (freetype + harfbuzz, contact sheet
yorliqlari), `libdav1d` (AV1 manbalar), `h264_videotoolbox` (render), `aac`, `pcm_s16le`, `mjpeg`/`png`.
Homebrew'dagi ffmpeg ishlatilmaydi: u GPL va Homebrew dylib'lariga bog'langan — boshqa Mac'da ishlamaydi.

**Mac'ga xos tuzatishlar (Windows xatti-harakati o'zgarmagan):**

- `agent/ffmpeg.ts` — AE Rosetta ostida (x64) ochilsa ham ffmpeg topiladi (boshqa arxitektura papkasi zaxira);
  o'rnatuvchi bajarish bitini yo'qotsa — `chmod`, papka root'niki bo'lsa `~/Library/Caches/com.aestudio.panel/bin/`
  ga nusxa.
- `agent/credentials.ts` — kalit macOS'da hostname o'rniga IOPlatformUUID'dan (hostname tarmoqqa qarab
  o'zgaradi va sessiya yo'qolardi).
- `jsx/lib/hybrid.ts` — AE presetlari: Mac'da `Presets` `.app` ichida emas, uning yonida.
- `install-panel.sh` — UPIA bilan o'rnatilgandan keyin ham `chmod +x` va karantin belgisini olib tashlash;
  papkada bir nechta ZXP bo'lsa `-mac.zxp` tanlanadi.

---

## 0. Talablar

- macOS 12+; Apple Silicon yoki Intel (ikkala arxitektura bitta Mac'da yig'iladi).
- Xcode Command Line Tools: `xcode-select --install`
- Yig'ish asboblari: `brew install node@24 nasm pkg-config meson ninja`
  (`node@24` keg-only: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`), so'ng `corepack enable`.
- Apple Silicon'da Rosetta (ZXPSignCmd uchun): `softwareupdate --install-rosetta --agree-to-license`
- After Effects 2022 (22.0) yoki yangi.

## 1. Repo

```bash
git clone https://github.com/qodirbozorov/ae-studio.git
cd ae-studio
pnpm install
pnpm --filter @aes/panel typecheck
```

## 2. LGPL static ffmpeg (har arxitektura ≈5–10 daqiqa)

```bash
bash apps/panel/scripts/build-ffmpeg-mac.sh arm64
bash apps/panel/scripts/build-ffmpeg-mac.sh x86_64
```

Skript manbalarni yuklaydi (`~/build/ffmpeg-mac/`): ffmpeg 8.1.3 (Windows bilan bir xil), opus, lame, freetype,
harfbuzz, dav1d — hammasi static. Natija: `~/ffmpeg-lgpl/<arch>/bin/{ffmpeg,ffprobe,THIRD_PARTY_LICENSES.txt}`.
Homebrew `.pc` fayllari ko'rinmaydi (`PKG_CONFIG_LIBDIR`), `MACOSX_DEPLOYMENT_TARGET=12.0`.

**Tekshiruv:**

```bash
B=~/ffmpeg-lgpl/arm64/bin
$B/ffmpeg -version | grep -c -- '--enable-gpl'                                  # 0
otool -L $B/ffmpeg | grep -v -E '/usr/lib/|/System/Library/' | tail -n +2       # bo'sh
$B/ffmpeg -hide_banner -encoders | grep -E 'h264_videotoolbox|libopus|libmp3lame|aac|pcm_s16le'
$B/ffmpeg -hide_banner -filters | grep drawtext
otool -l $B/ffmpeg | grep -A4 LC_BUILD_VERSION | grep minos                     # 12.0
```

Intel binarini Apple Silicon'da `arch -x86_64 ~/ffmpeg-lgpl/x86_64/bin/ffmpeg -version` bilan tekshiring.

## 3. ZXP

```bash
pnpm --filter @aes/panel release:mac
```

`scripts/release-mac.sh`:
1. `bundle-ffmpeg.mjs` ikki marta — LGPL tekshiruvi, `src/bin/darwin-arm64/` va `src/bin/darwin-x64/`
   (`VERSION.txt`, `LICENSE.txt`, `THIRD_PARTY_LICENSES.txt` bilan);
2. `pnpm zxp` — build va imzo;
3. `name-zxp.mjs` (`AES_ZXP_SUFFIX=-mac`) — `apps/panel/release/ae-studio-<versiya>-mac.zxp` (+ `.sha256`) va
   o'rnatish skriptlari.

Imzo tekshiruvi:

```bash
S=$(ls -d node_modules/.pnpm/vite-cep-plugin*/node_modules/vite-cep-plugin/lib/bin)
(cd "$S" && ./ZXPSignCmd -verify "$OLDPWD/apps/panel/release/ae-studio-<versiya>-mac.zxp" -certinfo)
# Signing Certificate: Valid
```

Windows ZXP o'zgarmaydi: u Windows'da `pnpm zxp` bilan quriladi (`src/bin/` git'ga kirmaydi, har platforma
o'z binarlarini qo'shadi).

## 4. O'rnatish

After Effects'ni yoping:

```bash
cd apps/panel/release
bash install-panel.sh            # yoki: bash install-panel.sh ae-studio-<versiya>-mac.zxp
```

UPIA (Creative Cloud) bo'lsa u bilan, bo'lmasa `~/Library/Application Support/Adobe/CEP/extensions/` ga
ochiladi; ffmpeg'ga `chmod +x`, karantin belgisi olib tashlanadi. AE → **Window → Extensions → AE Studio**.

## 5. Mac'da sinov ro'yxati

- [ ] Panel ochiladi, «Kirish» → brauzerda Telegram tasdig'i → profil va «● Server» yashil.
- [ ] Ish papkasi tanlanadi (`~/…` yo'l, bo'sh joy va kirill harfli nom bilan ham).
- [ ] Muhit tekshiruvi: **ffmpeg ✓** (manba «bundled»), aerender ✓
      (`/Applications/Adobe After Effects 20xx/aerender`).
- [ ] Claude: `env_check` → `assets_scan` (video davomiyligi va o'lchami — ffprobe) → `asset_preview`.
- [ ] Kichik job (3 sahna) → VERIFY → `contact_sheet` (yorliqlar — drawtext) → panelda «Tasdiqlash».
- [ ] Preset ishlatilgan sahna (`presets_list` AE'ning standart presetlarini ham ko'rsatadi).
- [ ] Audio: videodan ovoz ajratish (transkripsiya yoki tozalash) — `audio.extract` (opus) xatosiz.
- [ ] Render (faqat sinov uchun, qisqa): MP4 `out/` da; encoder `h264_videotoolbox`.
- [ ] Panelni yopib-ochish, AE'ni qayta ishga tushirish, Wi-Fi'ni almashtirish — sessiya saqlanadi.

Xato bo'lsa — loglar:
- CEP: `~/Library/Logs/CSXS/` (`CEP*-AEFT.log`), panel ichidagi DevTools uchun
  `defaults write com.adobe.CSXS.11 PlayerDebugMode 1` (AE 2024+ uchun `.12` ham) va imzosiz dev build.
- Panel → Live log va Tarix; serverda job log (kabinet → Tarix).

## 6. Yakun

- [ ] `release/ae-studio-<versiya>-mac.zxp` va `.sha256` ni saqlang (git'ga kirmaydi).
- [ ] Kod o'zgargan bo'lsa — commit va push.
- [ ] `process.md` → Blokerlar'dan "👤 Mac: macOS ZXP" ni olib tashlang, qisqa hisobot yozing.
