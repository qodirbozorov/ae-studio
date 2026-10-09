# AE STUDIO MCP — yangilash bo'yicha texnik vazifa

| | |
|---|---|
| Hujjat | Texnik vazifa (TV), v1.0 |
| Sana | 2026-10-10 |
| Asos | 2026-10-09 sessiyasi: "Harajat Kuzatuv Bot" promo, 70,6 s, 9:16, loyiha `xarajat-bot-promo`, plan v1–v7 |
| Holat | Muhokama va bosqichma-bosqich amalga oshirish uchun |
| Bog'liq Claude skill'lari | `ae-motion-design`, `ae-extendscript`, `storyboard-to-shotlist` |

---

## 0. Qisqacha

**Maqsad.** Claude After Effects'da dizayner darajasidagi motion grafikani (kinetik tipografiya, UI mockup, 3D kamera, grafiklar, maskalar, effektlar) rejalashtira olishi va AE'ga **tez va ishonchli** yubora olishi kerak.

**Uchta asosiy o'zgarish:**

1. **Spec v2.** Deklarativ til AE'ning asosiy imkoniyatlarini qamrab olishi kerak:
   - keyframe va easing;
   - shape path, stroke, trim, repeater;
   - parenting va precomp, komponentlar;
   - text animator;
   - effektlar, maska va matte;
   - 3D kamera va yorug'lik;
   - expression.
2. **Bajarish modeli.** Har bir operatsiya uchun alohida round-trip o'rniga, har bir sahna uchun bitta JSX paketi yuboriladi.
   - Hozir 70 s'lik promo build qilish ≈ 6 daqiqa oladi.
   - Maqsad: ≤ 60 s.
3. **Ko'rish va boshqarish vositalari:**
   - ishlaydigan contact sheet;
   - `ae_inspect`;
   - nazorat ostidagi `ae_run_jsx`;
   - VO vaqt belgilari (`vo_timings`);
   - preset va shablon kutubxonasi.

**Orqaga moslik:** `version: 1` spec'lar avvalgidek ishlayveradi; v2 `version: 2` bilan yoqiladi.

---

## 1. Joriy holat va aniqlangan muammolar

Quyidagilar 2026-10-09 sessiyasida amalda kuzatildi (job id'lar loglarda bor).

| # | Muammo | Dalil | Ta'sir | Ustuvorlik |
|---|---|---|---|---|
| 1 | Spec lug'ati tor. Qatlam turi 4 ta, shakl 2 ta, animatsiya 11 ta. Rotation, stroke, path, gradient, effekt, maska, parent va keyframe yo'q | `spec_schema` | Dizayn sodda chiqadi, "3D" faqat taqlid qilinadi, donut grafik qilib bo'lmaydi | P0 |
| 2 | Har bir op alohida round-trip | plan v7: 1 151 op ≈ 5 daq 49 s (≈ 0,30 s/op); plan v2: 472 op ≈ 81 s (≈ 0,17 s/op) | Iteratsiya juda sekin | P0 |
| 3 | `frames_capture` ishlamaydi: `AE_TIMEOUT` 3 urinishdan 3 tasida (max_px 640/540/480, 1–2 kadr) | job `1beadaeb…` | VERIFY sikli amalda yo'q | P0 |
| 4 | Sahnaning `bg` maydoni vizualda qo'llanmagan bo'lishi mumkin: foydalanuvchi qop-qora fon ko'rdi (v2 plan, och sahnalar) | foydalanuvchi fikri | Ranglar butunlay noto'g'ri | P0 (tekshirish kerak) |
| 5 | Ochiq loyihada saqlanmagan o'zgarish bo'lsa → `AE_BAD_PARAMS`, `retryable: false` | job `257f62fd…` | Qo'lda aralashuv talab qilinadi; xato kodi sababni aytmaydi | P1 |
| 6 | AE qayta ochilganda panel papkasi "unutiladi" (`ENV_NO_FOLDER`) | `env_check` | Qo'lda aralashuv | P1 |
| 7 | Bir nechta qurilma bo'lsa, `env_check` `device_id`'siz xato beradi — loyiha qurilmaga bog'langan bo'lsa ham | `env_check` | Ortiqcha qadam | P2 |
| 8 | `el_estimate` keshni hisobga olmaydi: 1 367 kredit ko'rsatdi, aslida 8/8 keshdan olindi | estimate vs job log | Xarajat haqida noto'g'ri ogohlantirish | P2 |
| 9 | Katta spec'ni yuborish qiyin. ≈ 90 KB bitta chaqiruvga sig'maydi. `plan_write` oraliq spec'ni rad etadi (sfx `at` hali yo'q sahnaga ishora qiladi), shuning uchun indeks bo'yicha 5 ta patch bilan yig'ishga to'g'ri keldi | plan v3–v7 | Ko'p token sarfi, indeks xatosi xavfi | P1 |
| 10 | Bir sahnada ko'pi bilan 50 qatlam | sxema | Telefon mockup'ning o'zi ≈ 20 qatlam oladi | P1 |
| 11 | Semantika hujjatlashtirilmagan: `pos` qatlam markazimi; matn qayerga yakorlanadi; `size` w/h alohida nisbat (aylana uchun h = w·1080/1920) | sxema | Tekislash taxminga tayanadi | P1 |
| 12 | Shriftlar preflight'da tekshirilmaydi; PostScript nomi xato bo'lsa, AE jim almashtiradi | — | Vizual xato | P1 |
| 13 | Chiqish (exit) animatsiyasi yo'q: `dur` tugashi bilan element kesilib yo'qoladi | sxema | Kadrlar "sakraydi" | P1 |
| 14 | VO jumla vaqtlari faqat build ichida aniqlanadi; Claude reja tuzayotganda ularni bilmaydi | `vo:a-b` | Ovoz bilan sinxronlash taxminiy (≈ 14 belgi/s bo'yicha hisoblandi) | P1 |

---

## 2. Maqsadlar va o'lchanadigan natijalar (KPI)

| Ko'rsatkich | Hozir | Maqsad |
|---|---|---|
| 70 s promo build (15 sahna, ~600 qatlam) | ≈ 6 daq | ≤ 60 s (i5-7200U kabi o'rta mashinada ≤ 90 s) |
| 1 000 "element-xususiyat" build | ≈ 5 daq | ≤ 30 s |
| 6 kadrlik contact sheet (540 px) | ishlamaydi | ≤ 15 s, 10/10 muvaffaqiyatli |
| §9'dagi 6 ta "oltin sahna" | qurib bo'lmaydi | spec v2 bilan, JSX'siz quriladi |
| BLOCKED holatlarini avtomatik tiklash | 0% | ≥ 90% (dirty project, papka, qurilma) |
| v1 regressiyasi | — | Avvalgi barcha plan'lar bir xil natija beradi |

---

## 3. Arxitektura

### 3.1 Hozirgi oqim (kuzatuv asosida)

```
Claude → MCP server (plan.json v1)
       → preflight: ops[] (1 qatlam ≈ 2–4 op)
       → panel polling
       → har bir op: evalScript(kichik JSX) → AE → ack → keyingi op
```

### 3.2 Yangi oqim

```
Claude → MCP server (plan v2)
       → Kompilyator: sahna → JSX bundle (runtime chaqiruvlari ketma-ketligi)
       → panel: sahna uchun 1 marta evalScript
       → AE → natija JSON {layers_created, warnings[], ms}
```

**Runtime kutubxona — `aes_runtime.jsx`:**
- Sessiya boshida panel uni bir marta yuklaydi (`$.evalFile`) va global `AES` obyektini yaratadi.
- Tarkibi:
  - hex → rgb;
  - ease (cubic-bezier → KeyframeEase);
  - `anim`, `shape`, `text`, `fx`, `mask`, `matte`, `camera`, `light`, `component` funksiyalari;
  - `dump`;
  - JSON serializer (ES3).
- Interfeysi §11-D'da.
- Kutubxonaning `AES.version` qiymati serverga xabar qilinadi. Versiya mos kelmasa, panel uni qayta yuklaydi.

**Sahna dasturi:**
- Kompilyator generatsiya qiladigan qisqa, deterministik `AES.*` chaqiruvlari.
- Kompilyator sahnaga mos keladigan oxirgi plan versiyasidan JSX'ni o'qiladigan holatda saqlaydi: `jobs/<id>/scene_s03.jsx`. Bu debug va audit uchun.

**Granulyarlik:**
- Progress, xato va resume sahna darajasida ishlaydi (`scene_started`, `scene_done` hodisalari).
- 400 qatlamdan katta sahna avtomatik bo'linadi.

**Idempotentlik:**
- Har bir sahna o'z precomp'ida quriladi: `AES_S03_v002`.
- Qayta build eskisini **o'chirmaydi**: u `AES_archive` papkasiga ko'chiriladi.

### 3.3 Kompozitsiya tuzilmasi

```
AES_MAIN (1080×1920, umumiy davomiylik, audio qatlamlari shu yerda)
 ├─ AES_S01 … AES_S15   (sahna precomp'lari; startTime = sahna boshlanishi)
 │    ├─ komponent precomp'lari (AES_C_phone, AES_C_chat, AES_C_card …)
 │    └─ qatlamlar
 └─ O'tishlar: qo'shni sahna qatlamlari bir-birining ustiga tushadi (overlap = o'tish davomiyligi)
```

### 3.4 AE tomonida tezlik qoidalari

Bular kompilyator va runtime uchun majburiy:
1. `app.beginSuppressDialogs()` va har bir sahna uchun bitta `beginUndoGroup`.
2. Bir xususiyatda ko'p keyframe bo'lsa — `setValuesAtTimes(times[], values[])`.
3. Yozish sikli ichida qiymatlarni qayta o'qimaslik.
4. Comp viewer faqat oxirida ochiladi (`openInViewer`).
5. `app.project.save` faqat job oxirida chaqiriladi, versiyalangan nom bilan.
6. Har bir sahnaning ms vaqti logga yoziladi: `scene.timing`.

---

## 4. Spec v2

To'liq misollar §11-E'da. Bu yerda — tuzilma va qoidalar.

### 4.1 Umumiy tuzilma

```json
{
  "version": 2,
  "format": { "w": 1080, "h": 1920, "fps": 30, "duration": "auto" },
  "units": "px",
  "brand": "harajat-warm",
  "tokens": {
    "colors": { "accent": "#D97757", "ink": "#141413", "ivory": "#FAF9F5" },
    "ease":   { "enter": [0.16, 1, 0.3, 1], "exit": [0.7, 0, 0.84, 0], "move": [0.65, 0, 0.35, 1], "soft": [0.333, 0, 0.667, 1], "pop": [0.34, 1.56, 0.64, 1] },
    "type":   { "h1": { "font": "Georgia", "size": 112 }, "body": { "font": "ClarityCity-Regular", "size": 42 } }
  },
  "components": { "phone": { "...": "§4.9" } },
  "audio":  { "...": "v1 bilan bir xil" },
  "scenes": [ { "...": "§4.2–4.12" } ],
  "output": { "preset": "h264_social", "name": "video" }
}
```

**Birliklar (`units`):**
- `"px"` — v2'da sukut bo'yicha;
- `"rel"` — v1'dagidek 0..1;
- har qanday koordinata `"50%"` ko'rinishidagi satr bo'lishi ham mumkin (tegishli o'qqa nisbatan).

**Token havolalari:** `"$accent"`, `"$enter"`, `"$h1"`. Kompilyator ularni preflight'da yechadi.

**Vaqt:**
- son = soniya;
- `"12f"` = kadr;
- `"end-0.3"` = qatlam yoki sahna oxiridan.

### 4.2 Qatlamning umumiy maydonlari

| Maydon | Tur | Izoh |
|---|---|---|
| `id` | string | Sahna ichida yagona; `parent`, `matte`, patch'lar uchun |
| `type` | enum | `shape`, `text`, `media`, `solid`, `null`, `adjustment`, `component`, `group`, `camera`, `light`, `audio` |
| `start`, `dur` | vaqt | Sahnaga nisbatan |
| `parent` | id | AE parenting |
| `anchor` | [x,y] yoki kalit so'z | `center`, `top_left` … va `bbox_center`, `bbox_left` … (matnning real chegarasi, `sourceRectAtTime` bo'yicha) |
| `position`, `scale`, `rotation`, `opacity` | qiymat | Boshlang'ich qiymatlar |
| `three_d`, `orientation`, `rotation_x`, `rotation_y` | | 3D |
| `material` | {casts_shadows, accepts_shadows, accepts_lights} | 3D |
| `blend` | enum | `normal`, `add`, `screen`, `multiply`, `overlay`, `soft_light` … |
| `motion_blur` | bool | Comp darajasida avtomatik yoqiladi |
| `matte` | {source: id, type: `alpha`/`alpha_inverted`/`luma`/`luma_inverted`} | AE 23+ `setTrackMatte` |
| `masks[]` | §4.7 | |
| `effects[]` | §4.6 | |
| `keyframes{}` | §4.3 | |
| `expressions{}` | §4.11 | |
| `in`, `out` | preset | §4.10 |
| `label`, `guide` | | Tartib uchun |

### 4.3 Keyframe va easing

```json
"keyframes": {
  "position": [ { "t": 0, "v": [540, 2100] }, { "t": 0.5, "v": [540, 960], "ease": "$enter" } ],
  "scale":    [ { "t": 0, "v": [0, 0] }, { "t": "12f", "v": [100, 100], "ease": "$pop" } ],
  "opacity":  [ { "t": 0, "v": 0 }, { "t": "4f", "v": 100, "ease": "linear" } ]
}
```

- **`t`** — qatlamning `start`iga nisbatan vaqt.
- **`ease`** — segmentga tegishli: oldingi kalitdan shu kalitgacha. Qiymat quyidagilardan biri:
  - token yoki `[x1, y1, x2, y2]` (CSS cubic-bezier);
  - `"linear"` yoki `"hold"`;
  - xom AE qiymatlari: `{ "out": [speed, influence], "in": [speed, influence] }`.
- **Cubic-bezier → AE konvertatsiyasi:** segment uchun Δv (spatial xususiyatda yo'l uzunligi) va T aniqlanadi, keyin:
  - `influence_out = x1·100`, `speed_out = (y1/x1)·Δv/T`;
  - `influence_in = (1−x2)·100`, `speed_in = ((1−y2)/(1−x2))·Δv/T`.

  Ko'p o'lchamli non-spatial xususiyatlarda (Scale) hisob har bir o'lcham uchun alohida qilinadi. Rang uchun speed = 0.
- **`spatial`:** `"linear"` (sukut bo'yicha; to'g'ri chiziq — tangentlar 0) yoki `"auto"`.
- **Overshoot (`pop`)** faqat non-spatial xususiyatlarda ishlaydi. Position'da overshoot so'ralsa, kompilyator o'lchamlarni ajratadi (`position.x`/`position.y`) yoki 3 kalitga o'giradi.
- **Xususiyat yo'llari:**
  - qatlam: `position`, `position.x|y|z`, `anchor`, `scale`, `rotation`, `rotation_x`, `rotation_y`, `orientation`, `opacity`;
  - shape: `contents.<id>.size|roundness|position`, `contents.<id>.trim.start|end|offset`, `contents.<id>.stroke.width|color`, `contents.<id>.fill.color|opacity`, `contents.<id>.transform.position|scale|rotation|opacity`;
  - matn: `animators.<id>.selector.start|end|offset`, `animators.<id>.<prop>`;
  - effekt: `effects.<id>.<param_alias>`;
  - maska: `masks.<id>.path|feather|expansion|opacity`;
  - kamera: `zoom`, `focus_distance`, `aperture`, `position`, `point_of_interest`.

### 4.4 Shape qatlam

```json
{
  "type": "shape", "id": "ring", "position": [540, 900],
  "contents": [
    { "id": "track", "kind": "ellipse", "size": [520, 520],
      "stroke": { "color": "#E8E3D9", "width": 44, "cap": "round" } },
    { "id": "seg1", "kind": "ellipse", "size": [520, 520],
      "stroke": { "color": "$red", "width": 44, "cap": "round" },
      "trim": { "start": 0, "end": 0, "offset": 0 },
      "keyframes": { "trim.end": [ { "t": 0, "v": 0 }, { "t": 0.8, "v": 45, "ease": "$enter" } ] } }
  ]
}
```

- **`kind` turlari:**
  - `rect` {size, roundness};
  - `ellipse` {size};
  - `path` {points | `svg_d`, closed};
  - `star` / `polygon` {points, outer_radius, inner_radius, roundness};
  - `group` {contents[]} (ichma-ich).
- **Bo'yoq:**
  - `fill` {color | gradient, opacity};
  - `stroke` {color | gradient, width, cap: butt|round|square, join, dashes[]}.
- **Modifikatorlar:** `trim`, `round_corners`, `repeater` {copies, offset, transform}, `offset_paths`, `merge` {mode}.
- **Stek tartibi:** kompilyator guruh ichida shu tartibda joylaydi: path'lar → modifikatorlar → stroke → fill. `repeater` bo'yoqdan keyin qo'yiladi.
- **Gradient:** `{ "type": "linear|radial", "stops": [[0, "#hex"], [1, "#hex"]], "start": [x, y], "end": [x, y] }`.
  - **Ogohlantirish:** shape gradient stop'larini ExtendScript bilan ishonchli o'rnatib bo'lmaydi (custom value).
  - Kompilyator gradientni shu tartibda yechadi:
    1. `ADBE Ramp` effekti + matte;
    2. tayyor `.ffx` preset (gradient bilan);
    3. aepx/XML orqali — keyingi bosqichda, ixtiyoriy.
  - Natija preflight `warnings[]`da ko'rsatiladi.
- **`svg_d`:** server SVG path'ni AE `Shape`ga o'giradi: vertices, inTangents, outTangents. Tangentlar vertex'ga **nisbatan** bo'ladi.
- **`icon`** (ixtiyoriy): `"icon": "lucide:check"` — server ikonani litsenziyasi mos kutubxonadan oladi (masalan, Lucide, ISC) va path'ga o'giradi.

### 4.5 Matn qatlam

```json
{
  "type": "text", "id": "h1",
  "text": "Pul qayerga\nketdi?",
  "style": {
    "font": "Georgia", "size": 132, "color": "$ivory", "tracking": -10, "leading": 140, "align": "left",
    "runs": [ { "from": 12, "to": 18, "font": "Georgia-Italic", "color": "$accent" } ]
  },
  "box": [920, 400],
  "anchor": "bbox_left",
  "position": [80, 860],
  "animators": [ { "id": "rise", "preset": "rise_blur_words", "t": 0, "dur": 0.7 } ]
}
```

- **`\n`** qo'llab-quvvatlanadi. `box` berilsa, `addBoxText` ishlatiladi.
- **`runs`** — bitta qatlam ichida har xil shrift va rang:
  - AE 24+ dagi per-character styling API'si orqali (`TextDocument.characterRange` — implementator AE 25'da tasdiqlashi kerak);
  - API bo'lmasa — fallback: bir nechta qatlam, `bbox` bo'yicha tekislanadi.
- **`anchor: "bbox_*"`** — `sourceRectAtTime` bo'yicha aniq tekislash. Kenglikni taxmin qilish butunlay yo'qoladi (#11 muammo yopiladi).
- **`animators` to'liq shakli:**

```json
{ "id": "a1",
  "properties": { "position": [0, 60], "opacity": 0, "blur": 8, "scale": [90, 90], "tracking": 0, "fill": "#hex" },
  "selector": { "based_on": "words", "shape": "ramp_up", "ease_high": 70, "ease_low": 0, "order": "forward",
                "keyframes": { "offset": [ { "t": 0, "v": -100 }, { "t": 0.7, "v": 100, "ease": "$enter" } ] } } }
```

- **`counter`:**

```json
"counter": { "from": 0, "to": 15000000, "t": 0, "dur": 1.0, "ease": "$enter", "format": "space_thousands", "prefix": "", "suffix": " so'm" }
```

  Kompilyator 0→100 Slider va Source Text expression yaratadi. Slider ±1 000 000 bilan cheklangan, shuning uchun qiymat foiz orqali masshtablanadi.

### 4.6 Effektlar

```json
"effects": [
  { "id": "bl", "fx": "gaussian_blur", "params": { "blurriness": 12 },
    "keyframes": { "blurriness": [ { "t": 0, "v": 20 }, { "t": 0.4, "v": 0, "ease": "$enter" } ] } },
  { "id": "sh", "fx": "drop_shadow", "params": { "color": "#000000", "opacity": 25, "direction": 180, "distance": 18, "softness": 60 } },
  { "id": "raw", "fx": "ADBE Glo2", "params_by_index": { "3": 40, "4": 1.2 } }
]
```

- **Alias jadvali** §11-C'da. Parametr alias'lari kompilyator ichida matchName yoki indeksga xaritalanadi. Bu xaritalar AE 25'da `dump` bilan tasdiqlanib, avtomatik test bilan qotiriladi.
- **Foiz birliklari:** `opacity` va boshqa foiz parametrlari 0..100 ko'rinishida beriladi. Kompilyator effektning ichki shkalasiga o'giradi (masalan, Drop Shadow opacity ichkarida 0–255 bo'lishi mumkin).
- **Noma'lum effekt:** `fx` `app.effects` ro'yxatida bo'lmasa, preflight `FX_UNKNOWN` xatosini beradi. Parametr noto'g'ri bo'lsa — `FX_PARAM_UNKNOWN`.

### 4.7 Maska va matte

```json
"masks": [ { "id": "m1", "rect": [0, 0, 920, 160], "roundness": 24, "mode": "add", "feather": [20, 20], "expansion": 0, "opacity": 100, "inverted": false } ],
"matte": { "source": "reveal_box", "type": "alpha" }
```

- Maska shakli quyidagilardan biri bo'ladi: `rect`, `ellipse`, `points` yoki `svg_d`.
- Matte manbasi shu sahnada bo'lishi shart. Uning video'si avtomatik o'chiriladi.

### 4.8 3D, kamera, yorug'lik

```json
[
  { "type": "camera", "id": "cam", "zoom": 2400,
    "dof": { "enabled": true, "focus_distance": 2400, "aperture": 60, "blur_level": 100 },
    "keyframes": { "position": [ { "t": 0, "v": [540, 960, -2600] }, { "t": 6, "v": [540, 960, -2350], "ease": "$soft" } ] } },
  { "type": "light", "id": "key", "light": "spot", "color": "#FFF3E6", "intensity": 110,
    "position": [300, 200, -800], "casts_shadows": true, "shadow_darkness": 40, "shadow_diffusion": 60 }
]
```

- `scene.renderer`: `classic_3d` (sukut bo'yicha). Advanced 3D (AE 24+) qo'llab-quvvatlanishini implementator tekshiradi.
- Kamera orbitasi uchun `parent: "<null_id>"` ishlatiladi.

### 4.9 Komponentlar (qayta ishlatiladigan bloklar)

```json
"components": {
  "phone": { "w": 760, "h": 1560, "params": ["title"],
             "layers": [ "...korpus, bezel, header ('{{title}}'), composer..." ],
             "slots": { "screen": { "x": 20, "y": 20, "w": 720, "h": 1520 } } },
  "bubble_in": { "params": ["text"], "auto_size": "text", "layers": [ "..." ] }
}
```

```json
{ "type": "component", "id": "p1", "use": "phone", "params": { "title": "Harajat Kuzatuv Bot" },
  "position": [540, 1000], "scale": [100, 100],
  "slots": { "screen": { "layers": [ "...chat kontenti..." ] } } }
```

- Komponent precomp sifatida bir marta yaratiladi va ko'p sahnada ishlatiladi. Spec hajmi 5–10 barobar kamayadi (#9, #10 muammolar).
- `auto_size: "text"` — pufak o'lchami matnning real chegarasiga moslanadi (`sourceRectAtTime` + padding).
- `slots.screen` — ichki precomp. Ekran kontenti telefon korpusidan mustaqil scroll va zoom qilinadi.

### 4.10 Kirish/chiqish presetlari va stagger

```json
"in":  { "preset": "rise", "dur": 0.5, "ease": "$enter", "distance": 60 },
"out": { "preset": "fade_down", "dur": 0.3, "at": "end-0.3", "ease": "$exit" }
```

```json
{ "type": "group", "id": "buttons", "stagger": { "step": "3f", "order": "forward", "apply": "in" }, "children": [ "..." ] }
```

- **Minimal preset kutubxonasi:**

  | Guruh | Presetlar |
  |---|---|
  | Asosiy | `fade`, `rise`, `drop`, `slide_l`, `slide_r` |
  | Kattalashtirish | `scale_pop` (overshoot), `zoom_in`, `zoom_out` |
  | Yashirib ochish | `blur_in`, `mask_up` (o'z qutisi ichida), `wipe_l`, `wipe_r` |
  | Chizish | `draw` (trim 0→100) |
  | Matn | `typewriter`, `counter`, `rise_blur_words`, `chars_cascade`, `tracking_in` |
  | UI | `bubble_in`, `tap`, `ripple` |
  | Chiqish | `fade_out`, `fade_down`, `scale_out`, `blur_out` |

- Har bir preset ochiq keyframe'larga kengaytiriladi. Claude natijani `ae_inspect` bilan ko'ra oladi.
- Har bir preset `params`ni qabul qiladi (masofa, burchak, kuchlanish).
- `in`/`out` yo'q bo'lsa — v1'dagidek kesiladi, preflight esa `warnings[]`ga yozadi (#13).

### 4.11 Expression'lar

```json
"expressions": { "rotation": "wiggle(0.5, 2)" },
"macros": { "$drift": { "scale_per_s": 1.5 }, "$overshoot": { "amp": 0.06, "freq": 3, "decay": 7 }, "$loop": "cycle", "$follow": { "layer": "lead", "lag": 0.08 } }
```

- Effektlarga expression ichida **indeks** orqali murojaat qilinadi (`effect(1)(1)`), chunki AE lokalizatsiyasi nomlarni o'zgartiradi.
- `validate_expressions: true` bo'lsa, preflight expression'ni vaqtinchalik comp'da qo'llab ko'radi, `expressionError`ni tekshiradi va xatoni qatori bilan qaytaradi.

### 4.12 O'tishlar (main comp'da)

```json
"transition_out": { "type": "circle_wipe", "dur": "12f", "origin": "layer:btn_add", "ease": "$enter" }
```

- **Turlar:**
  - `cut`, `cross_dissolve`;
  - `match_cut` {from: id, to: id} — pozitsiya va masshtab moslanadi;
  - `circle_wipe` {origin};
  - `shape_wipe`;
  - `whip` {direction} — directional blur bilan;
  - `zoom_through`, `push` {direction}.
- v1'dagi `fade`, `whip_*`, `zoom_*`, `slide_*` nomlari mos turlarga xaritalanadi.

### 4.13 Validatsiya (preflight)

**Xatolar:**
- shrift `fonts_list`da yo'q → `AE_FONT_MISSING`;
- effekt `app.effects`da yo'q → `FX_UNKNOWN`;
- `parent` sikli bor;
- `matte` manbasi topilmadi;
- keyframe vaqti qatlam oralig'idan tashqarida;
- sahnada > 400 qatlam (avtomatik bo'linmasa).

**Ogohlantirishlar (`warnings[]`):**
- matn platforma xavfsiz zonasidan chiqqan: tepadan 220 px, pastdan 380 px;
- matn 28 px'dan kichik;
- matn kontrasti < 4,5:1 (WCAG; fon rangi ma'lum bo'lsa);
- qatlam `in`/`out`'siz kesiladi;
- gradient fallback ishlatilgan.

**Natija:** `preflight.ok`, `errors[]`, `warnings[]`, `estimate { ops, scenes, expected_build_s }`.

### 4.14 v1 → v2 moslik

- v1 `anim` nomlari v2 presetlariga xaritalanadi.
- `pos` (rel) px'ga o'giriladi.
- `bg` har doim to'liq kadrli solid qatlamga aylanadi (#4 muammo shu bilan yopiladi).
- v1 spec'lar **eski kompilyatorga emas**, yangi bundle kompilyatoriga yo'naltiriladi — tezlik ularga ham tegadi. Natija vizual snapshot test bilan solishtiriladi.

---

## 5. Yangi va o'zgaradigan MCP vositalari

### 5.1 `ae_run_jsx` (yangi)

- **Kirish:** `{ project_id, script (≤ 200 KB), timeout_s = 60 (max 600), undo_group, save_after = false, dry_run = false }`.
- **Chiqish:** `{ ok, result (skript qaytargan satr), duration_ms, warnings[], aep_path? }`.
- **Xatolar:**

  | Kod | Ma'lumot |
  |---|---|
  | `JSX_SYNTAX` | {line, message} |
  | `JSX_RUNTIME` | {line, message} |
  | `JSX_DENIED` | {rule} |
  | `AE_BUSY` | — |
  | `AE_TIMEOUT` | — |

- **Ruxsat:** kabinetda loyiha uchun "Skriptlarga ruxsat" bayrog'i yoqilgan bo'lishi kerak (sukut bo'yicha o'chiq). Har bir chaqiruv audit log'ga yoziladi (skript matni + natija). Xavfsizlik — §7.
- **`dry_run`:** faqat sintaksis va taqiqlar ro'yxatini tekshiradi, bajarmaydi.

### 5.2 `ae_inspect` (yangi)

- **Kirish:** `{ target: "project" | "comp:<name>" | "layer:<comp>/<layer>", depth = 2, include: ["transform", "effects", "contents", "text", "keyframes", "expressions", "masks"] }`.
- **Chiqish:** JSON daraxt — matchName, name, value, keys [{t, v}], expression, error.
- Javob ≤ 200 KB, ortig'i `cursor` bilan sahifalanadi.

### 5.3 `frames_capture` (tuzatish) va `contact_sheet` (yangi)

- **Kirish:** `{ job_id | comp, times[] | "auto", max_px = 540, grid = "3x2" }`. `"auto"` = har bir sahnaning hit vaqti + o'tishlar o'rtasi + oxirgi kadr.
- **Chiqish:** bitta JPEG (grid, har kadr ostida vaqt yozilgan) + alohida kadrlar.
- **Implementatsiya variantlari** (implementator AE 25'da sinab, tanlaydi):
  - (a) `CompItem.saveFrameToPng(time, file)` — hujjatlashtirilmagan, lekin keng ishlatiladi;
  - (b) loyiha nusxasidan ikkinchi `aerender` jarayonida PNG kadrlar (`-s`/`-e` oraliq) — AE UI bloklanmaydi;
  - (c) render queue — oxirgi variant.
- **Timeout:** kadr boshiga 10 s, umumiy 60 s.
- **Xato aniq sabab bilan:** `FRAME_CAPTURE_FAILED { reason: "modal_suspected" | "comp_not_found" | "render_error" | "timeout" }`.

### 5.4 `preview_render` (yangi)

- **Kirish:** `{ comp, from, to, scale = 0.33, fps = 15 }`.
- **Chiqish:** kichik MP4 + 8 ta kadr.
- `aerender` fon jarayonida ishlaydi va AE'ni bloklamaydi.

### 5.5 `vo_timings` (yangi)

- **Kirish:** `{ project_id, plan_version }`.
- **Chiqish:** `{ sentences: [{ i, text, start, end }], words: [{ w, start, end, sentence }], duration }`.
- AUDIO bosqichini (keshdan) ishga tushiradi. ElevenLabs timestamps ma'lumotidan foydalanadi — caption'lar uchun hozir ham ishlatilmoqda.
- **Maqsad:** Claude build'dan **oldin** xoreografiyani so'z vaqtlariga bog'laydi (#14).

### 5.6 Plan'ni boshqarish (o'zgarish)

- **`plan_patch`** — id bo'yicha manzillar: `/scenes/@s5b/layers/@h1/text`. Indeks yo'llari ham ishlashda davom etadi.
- **`plan_scene_put`** `{ project_id, scene, after?: "<scene_id>" }` — sahnani id bo'yicha upsert qiladi.
- **`plan_write`** `{ ..., defer_validation: true }` + **`plan_validate`** — reja bo'laklab yig'iladi va oxirida bir marta tekshiriladi (#9).
- **`plan_diff`** `{ from, to }` — versiyalar farqi, foydalanuvchiga ko'rsatish uchun.

### 5.7 Presetlar va shablonlar (yangi)

- **`presets_list`, `preset_apply`** `{ layer, preset (.ffx), at }` — foydalanuvchining Presets papkasi + server bilan keladigan kutubxona.
- **`template_import_aep`** `{ asset }` — dizayner `.aep` faylidagi Essential Graphics xususiyatlarini slot sifatida o'qiydi. Mavjud `template_apply` bilan to'ldiriladi.
- **`mogrt_list`, `mogrt_apply`** — ixtiyoriy, 5-bosqich.

### 5.8 Yordamchi vositalar (yangi)

- **`fonts_list`** `{ query }` → `[{ family, style, postscript }]`. Preflight shu ro'yxat bilan tekshiradi.
- **`svg_to_shape`** `{ asset | svg }` → shape `contents` JSON. Claude natijani ko'rib, spec'ga qo'shadi.
- **`ae_project_status`** → `{ path, dirty, open_comps[], modal_suspected, panel_folder }`.
- **`project_save_as`** `{ suffix }` — versiyalangan saqlash.

### 5.9 Mavjud vositalardagi o'zgarishlar

- **`env_check`, `project_*`:** loyiha → qurilma bog'lanishi avtomatik; `device_id` faqat noaniq holatda so'raladi (#7).
- **`job_status`:**
  - `progress.scene`;
  - `scenes[{ id, state, ms }]`;
  - `next_step` aniqroq.
- **`el_estimate`:** har bir element uchun `cached: true/false`, `total_uncached` (#8).
- **`spec_schema`:** `version` parametri (1 | 2) + har bir maydon uchun izoh. Semantika aniq yoziladi: `pos` = anchor nuqtasi, matn yakori, `size` birliklari (#11).

---

## 6. Bajarish, tiklanish va xato kodlari

| Kod | Qachon | retryable | Avtomatik harakat |
|---|---|---|---|
| `AE_PROJECT_DIRTY` | Ochiq loyihada saqlanmagan o'zgarish bor | true | Siyosatga qarab: (a) joriy loyiha `_autosave_vNNN` sifatida saqlanadi va davom etiladi; (b) foydalanuvchidan so'raladi. Sukut bo'yicha (a), hech narsa yo'qolmaydi |
| `ENV_NO_FOLDER` | Panel papkani unutgan | true | Loyihaning oxirgi papkasi avtomatik tiklanadi (panel `localStorage` + server) |
| `AE_MODAL_SUSPECTED` | AE `evalScript`'ga 10 s ichida javob bermadi | true | Foydalanuvchiga aniq xabar: "AE'da ochiq dialog oynasini yoping" |
| `AE_FONT_MISSING` | Preflight | false | Eng yaqin o'rnatilgan shriftlar taklif qilinadi |
| `FX_UNKNOWN`, `FX_PARAM_UNKNOWN` | Preflight | false | — |
| `JSX_SYNTAX`, `JSX_RUNTIME` | Bundle yoki `ae_run_jsx` | false | Satr raqami va sahna id'si bilan |
| `JSX_DENIED` | `ae_run_jsx` taqiqi | false | Qaysi qoida buzilgani |
| `RENDER_TIMEOUT`, `FRAME_CAPTURE_FAILED` | Render va kadrlar | true | Sabab bilan |

- **Resume:** sahna darajasida. `job_resume` muvaffaqiyatli qurilgan sahnalarni qayta qurmaydi.
- **Heartbeat:** panel ≤ 5 s'da bir marta yuboradi. AE "band" holatini (uzoq `evalScript`) server ko'rib turadi.
- **Bekor qilish:** `job_cancel` keyingi sahna chegarasida to'xtaydi. Qisman qurilgan sahna precomp'i `_partial` deb belgilanadi.

---

## 7. Xavfsizlik

1. **`ae_run_jsx` faqat opt-in:** kabinetda loyiha uchun yoqiladi, istalgan payt o'chiriladi.
2. **Statik taqiqlar** (bajarishdan oldin skript matni tekshiriladi):
   - `system.callSystem`;
   - `.remove(` (File/Folder);
   - `app.quit`;
   - `app.newProject` va `app.project.close(` — avval saqlanmagan bo'lsa;
   - `Socket`;
   - `$.evalFile` — loyiha ildizidan tashqaridagi yo'l bilan;
   - `app.executeCommand` — faqat ruxsat etilgan ID'lar bilan;
   - loyiha ildizidan tashqariga yozish.
3. **Runtime himoya:** `File`/`Folder` wrapper'i yo'llarni loyiha ildizi bilan cheklaydi; timeout; skript hajmi ≤ 200 KB.
4. **Audit:** har bir skript, natija va davomiylik job log'iga yoziladi.
5. **Limitlar:** loyiha uchun kunlik chaqiruvlar soni sozlanadi (sukut bo'yicha 300).
6. **Hech narsa o'chirilmaydi:** plan, `.aep` va render versiyalash siyosati saqlanadi (v001, v002 …).
7. **Ovoz klonlash qoidasi** (faqat ovoz egasining roziligi bilan) o'zgarishsiz qoladi.

---

## 8. Server `instructions` matni (Claude uchun yangilanadi)

Joriy matn o'rniga quyidagisi taklif qilinadi (ingliz tilida — modellar uchun aniqroq):

```text
AE Studio builds After Effects videos on the user's computer from a Video Spec. Spec v2 covers keyframes with
cubic-bezier easing, shape paths/strokes/trim/repeater, parenting, precomp components, text animators, effects,
masks/mattes, 3D camera/lights and expressions. Each scene compiles to one JSX bundle (fast).

Loop:
1 env_check (device auto-resolved) → 2 project_get/create → 3 assets_scan/assets_list (+asset_preview)
→ 4 spec_schema(version:2) → 5 vo_timings (sentence/word times BEFORE planning motion)
→ 6 plan_write (use components and presets; plan_scene_put for big plans) → 7 preflight (fix errors, read warnings)
→ 8 build_start → 9 contact_sheet(auto) → verify_patch / verify_approve → 10 render → report_get.

Prefer: tokens, components, in/out presets, stagger groups. Use raw keyframes for custom choreography.
Use ae_run_jsx only for what spec v2 cannot express (requires the project's script permission).
Never edit the audio block when only graphics change (it is cached by parameters).
Reply to the user in their language (often Uzbek).
```

---

## 9. Test va qabul mezonlari

### 9.1 "Oltin sahnalar"

Har biri uchun spec v2 JSON + kutilgan kadrlar beriladi; snapshot SSIM ≥ 0,98, 3 ta vaqt nuqtasida.

| # | Sahna | Tekshiriladigan imkoniyatlar |
|---|---|---|
| G1 | Kinetik sarlavha: 2 qator, so'zma-so'z rise + blur; 2-qator kursiv aksent rangda; tagiga chiziq chiziladi | text animator, runs, bbox anchor, trim |
| G2 | Telefon mockup: komponent + ekran precomp'i, 3D Y 12°, kamera 8% push-in, chat pufagi overshoot, tap ripple, scroll | component, slots, 3D, camera, pop ease, group stagger |
| G3 | Donut grafik: 3 segment (45/30/25), round cap, markazda count-up | stroke, trim offset, counter |
| G4 | Ustunli grafik + gauge: stagger 3f, overshoot, gradient fon, grain | group stagger, effects (ramp, noise), scale anchor |
| G5 | Logo reveal: 3D medalyon, light sweep, yumshoq glow, DOF | 3D, light, effects, camera dof |
| G6 | O'tishlar: tap nuqtasidan circle wipe, whip + directional blur, match cut | transitions, motion blur |

### 9.2 Qabul ro'yxati

- [ ] G1–G6 JSX'siz quriladi; kadrlar `ae-motion-design` cheklistidan o'tadi.
- [ ] 70 s promo (15 sahna) build ≤ 60 s (i5-7200U'da ≤ 90 s). Har bir sahnaning ms vaqti logda.
- [ ] `contact_sheet` 6 kadrni ≤ 15 s'da qaytaradi; ketma-ket 10 marta muvaffaqiyatli.
- [ ] v1 regressiyasi: oldingi plan'lar (`test`, `tinchlik`, `munosabat`, `xarajat-bot-promo` v1–v7) xatosiz quriladi va vizual farq ruxsat etilgan chegarada.
- [ ] `AE_PROJECT_DIRTY` va `ENV_NO_FOLDER` avtomatik tiklanadi; ma'lumot yo'qolmaydi.
- [ ] Preflight noto'g'ri shrift va effektni ushlaydi; ogohlantirishlar ishlaydi (xavfsiz zona, kichik matn, kontrast).
- [ ] `ae_run_jsx`: §7'dagi har bir taqiq uchun bitta salbiy test; ruxsat o'chiq bo'lsa — `JSX_DENIED`.
- [ ] `el_estimate` kesh holatini to'g'ri ko'rsatadi.
- [ ] `vo_timings` jumla chegaralari `vo:a-b` sahna chegaralari bilan ±1 kadr aniqlikda mos keladi.
- [ ] `spec_schema(version: 2)` har bir maydonni izoh va misol bilan qaytaradi.

---

## 10. Bosqichlar (taxminiy, 1 dasturchi)

| Bosqich | Mazmuni | Muddat | Natija |
|---|---|---|---|
| 0 — Tuzatishlar | #3 frames, #4 bg, #5 dirty, #6 papka, #7 qurilma, #8 estimate, #11 semantika hujjati | 3–5 kun | VERIFY sikli ishlaydi |
| 1 — Bundle kompilyator | §3.2–3.4; runtime lib; v1'ni yangi kompilyatorga o'tkazish; sahna darajasida resume | 1–1,5 hafta | 6 daq → < 1 daq |
| 2 — Spec v2 yadro | keyframe va easing, shape contents (path/stroke/trim/repeater), parenting, precomp va komponentlar, matn (runs, bbox, animators), in/out presetlar, stagger | 2 hafta | G1, G2, G3 |
| 3 — Spec v2 boy | effekt alias'lari, maska va matte, 3D kamera va yorug'lik, expression makrolari, o'tishlar | 1,5 hafta | G4, G5, G6 |
| 4 — Vositalar | `ae_inspect`, `ae_run_jsx` (+ xavfsizlik), `contact_sheet`, `preview_render`, `vo_timings`, `fonts_list`, `svg_to_shape`, plan id-patch | 1,5–2 hafta | To'liq sikl |
| 5 — Kutubxona | ≥ 25 preset, ≥ 6 komponent (phone, chat_in/out, card, chart_bar, chart_donut, cta), golden testlar | 1 hafta | Dizayner sifati "qutidan" |

**Tavsiya etiladigan tartib:** 0 → 1 → 2. Shu uchta bosqichdan keyin sifat va tezlikdagi asosiy sakrash ko'rinadi. Keyin 4 (`vo_timings` va `contact_sheet` birinchi), so'ng 3 va 5.

---

## 11. Ilovalar

### A. Ease tokenlari

| Token | cubic-bezier | AE (Δv/T = o'rtacha tezlik) | Qo'llanishi |
|---|---|---|---|
| `enter` | 0.16, 1, 0.3, 1 | A: speed 6,25×avg, infl 16% → B: speed 0, infl 70% | Kirish, ochilish |
| `exit` | 0.7, 0, 0.84, 0 | A: 0 / 70% → B: 6,25×avg / 16% | Chiqish |
| `move` | 0.65, 0, 0.35, 1 | A: 0 / 65% → B: 0 / 65% | Joy almashtirish |
| `soft` | 0.333, 0, 0.667, 1 | A: 0 / 33,3% → B: 0 / 33,3% (AE Easy Ease) | Sekin drift boshlanishi/to'xtashi |
| `pop` | 0.34, 1.56, 0.64, 1 | A: 4,59×avg / 34% → B: 0 / 36% (overshoot, faqat non-spatial) | Badge, tugma, pufak |

### B. Cubic-bezier → AE formulasi

Segment A→B uchun: T = tB − tA, Δv = vB − vA (spatial'da yo'l uzunligi; ko'p o'lchamli non-spatial'da har bir o'lcham uchun alohida).

```
outEase(A) = KeyframeEase( x1>0 ? (y1/x1)·Δv/T : 0 ,  max(0.1, x1·100) )
inEase(B)  = KeyframeEase( x2<1 ? ((1−y2)/(1−x2))·Δv/T : 0 ,  max(0.1, (1−x2)·100) )
```

- Spatial xususiyat uchun tezlik musbat (moduli) bo'ladi.
- 1D va non-spatial xususiyat uchun tezlik ishorasi Δv ishorasiga teng.
- Rang uchun tezlik 0.
- Ease qo'llashdan oldin ikkala kalitning interpolatsiyasi `BEZIER` bo'lishi kerak.
- To'liq ES3 implementatsiyasi: `ae-extendscript` skill'i, 4-bo'lim (`segmentEase`).

### C. Effekt alias'lari → matchName

**Holat** ustuni: ✔ — keng tasdiqlangan; ◐ — AE 25'da `dump` bilan tasdiqlash shart.

| Alias | matchName | Asosiy parametrlar (alias → indeks) | Holat |
|---|---|---|---|
| `gaussian_blur` | ADBE Gaussian Blur 2 | blurriness → 1, dimensions → 2 | ✔ |
| `directional_blur` | ADBE Motion Blur | direction → 1, length → 2 | ✔ |
| `radial_blur` | ADBE Radial Blur | dump | ◐ |
| `drop_shadow` | ADBE Drop Shadow | color 1, opacity 2 (ichki 0–255), direction 3, distance 4, softness 5 | ◐ (opacity shkalasi) |
| `glow` | ADBE Glo2 | dump | ◐ |
| `fill` | ADBE Fill | color 3, opacity 7 | ◐ |
| `tint` | ADBE Tint | black 1, white 2, amount 3 | ✔ |
| `gradient_ramp` | ADBE Ramp | start 1, start_color 2, end 3, end_color 4, shape 5 | ✔ |
| `four_color_gradient` | ADBE 4ColorGradient | dump | ◐ |
| `fractal_noise` | ADBE Fractal Noise | dump | ◐ |
| `noise` | ADBE Noise | amount 1 | ✔ |
| `linear_wipe` | ADBE Linear Wipe | completion 1, angle 2, feather 3 | ✔ |
| `radial_wipe` | ADBE Radial Wipe | completion 1, start_angle 2 | ✔ |
| `turbulent_displace` | ADBE Turbulent Displace | dump | ◐ |
| `transform` | ADBE Geometry2 | dump | ◐ |
| `light_sweep` | CC Light Sweep | dump | ◐ |
| `hue_saturation` | ADBE HUE SATURATION | dump | ◐ |
| `exposure` | ADBE Exposure2 | dump | ◐ |
| `set_matte` | ADBE Set Matte3 | dump | ◐ |
| `echo` | ADBE Echo | dump | ◐ |
| `slider` / `color_ctrl` / `point_ctrl` / `checkbox` / `angle` | ADBE Slider Control / ADBE Color Control / ADBE Point Control / ADBE Checkbox Control / ADBE Angle Control | value → 1 | ✔ |

**Asosiy shape matchName'lari (✔):**
- guruh va kontent: `ADBE Root Vectors Group`, `ADBE Vector Group`, `ADBE Vectors Group`;
- shakllar: `ADBE Vector Shape - Rect` / `- Ellipse` / `- Group` / `- Star`;
- bo'yoq: `ADBE Vector Graphic - Fill` / `- Stroke`;
- modifikatorlar: `ADBE Vector Filter - Trim` / `- RC` / `- Repeater`;
- transform: `ADBE Vector Transform Group`.

**Matn (✔/◐):**
- `ADBE Text Properties`, `ADBE Text Document`, `ADBE Text Animators`, `ADBE Text Animator`, `ADBE Text Animator Properties`;
- `ADBE Text Selectors`, `ADBE Text Selector`, `ADBE Text Percent Start` / `End` / `Offset`;
- `ADBE Text Range Advanced` → `ADBE Text Range Type2` (1 belgi, 2 bo'sh joysiz belgi, 3 so'z, 4 qator), `ADBE Text Range Shape` (1 square, 2 ramp up, 3 ramp down, 4 triangle, 5 round, 6 smooth);
- `ADBE Text Position 3D`, `ADBE Text Opacity`, `ADBE Text Blur`, `ADBE Text Scale 3D`, `ADBE Text Rotation`, `ADBE Text Tracking Amount`, `ADBE Text Fill Color`.

### D. Runtime kutubxona interfeysi (`AES.*`)

```text
AES.version
AES.hex(h) → [r,g,b]
AES.comp(name, w, h, dur, fps) / AES.findComp(name)
AES.anim(prop, keys[[t,v,curve?]], curve) ; AES.segmentEase(prop, k, curve) ; AES.straightPath(prop)
AES.shapeLayer(comp, name, pos) ; AES.group(parent, name)
AES.rect(g, w, h, r) ; AES.ellipse(g, w, h) ; AES.path(g, verts, inT, outT, closed)
AES.trim(g) ; AES.fill(g, rgb, op) ; AES.stroke(g, rgb, w, cap) ; AES.repeater(g, n, offset)
AES.text(comp, str, style) ; AES.anchorTo(layer, "bbox_left"|...) ; AES.animator(layer, spec)
AES.fx(layer, matchName, byIndex) ; AES.mask(layer, spec) ; AES.matte(layer, source, type)
AES.precomp(parentComp, name, w, h) ; AES.component(comp, def, params, slots)
AES.camera(comp, spec) ; AES.light(comp, spec) ; AES.expr(prop, code) → error|""
AES.counter(layer, spec) ; AES.stagger(layers[], step, order)
AES.dump(prop, depth) ; AES.json(obj) ; AES.saveVersion(root, base)
```

Asosiy funksiyalarning ES3 implementatsiyasi (tekshirilgan sintaksis bilan) `ae-extendscript` skill'ida bor. Uni boshlang'ich nuqta sifatida olish mumkin.

### E. Namuna: spec v2'da bitta sahna (chat + tap + counter)

```json
{
  "id": "s5c", "dur": "vo:10-11",
  "background": { "color": "#ECE8DE", "radial": { "color": "#F5F3ED", "radius": 900 }, "grain": 3 },
  "transition_out": { "type": "circle_wipe", "dur": "12f", "origin": "layer:ok_badge" },
  "layers": [
    { "type": "text", "id": "kicker", "text": "05 · HARAJAT QO'SHISH", "style": { "font": "Consolas", "size": 26, "color": "#87867F", "tracking": 80 },
      "anchor": "bbox_center", "position": [540, 62], "in": { "preset": "fade", "dur": 0.3 } },
    { "type": "component", "id": "phone", "use": "phone", "params": { "title": "Harajat Kuzatuv Bot" },
      "position": [540, 1085], "three_d": true, "rotation_y": -8,
      "keyframes": { "rotation_y": [ { "t": 0, "v": -8 }, { "t": "end", "v": -4, "ease": "$soft" } ] },
      "slots": { "screen": { "layers": [
        { "type": "component", "id": "q", "use": "bubble_in", "params": { "text": "Kategoriyani tanlang:" },
          "anchor": "bottom_left", "position": [24, 1180], "in": { "preset": "bubble_in" } },
        { "type": "group", "id": "kb", "position": [24, 1200], "stagger": { "step": "3f", "apply": "in" },
          "children": [
            { "type": "component", "id": "k1", "use": "inline_button", "params": { "label": "Majburiy", "dot": "$red" }, "in": { "preset": "scale_pop" } },
            { "type": "component", "id": "k2", "use": "inline_button", "params": { "label": "Zarur", "dot": "$yellow" }, "in": { "preset": "scale_pop" } },
            { "type": "component", "id": "k3", "use": "inline_button", "params": { "label": "Ixtiyoriy", "dot": "$green" }, "in": { "preset": "scale_pop" } }
          ] },
        { "type": "component", "id": "tap1", "use": "tap", "start": 0.7, "position": "layer:k1" }
      ] } } },
    { "type": "shape", "id": "ok_badge", "start": 2.4, "position": [320, 160],
      "contents": [ { "id": "c", "kind": "ellipse", "size": [108, 108], "fill": { "color": "$green" } },
                    { "id": "tick", "kind": "path", "svg_d": "M-22 2 L-6 18 L24 -16", "closed": false,
                      "stroke": { "color": "#FFFFFF", "width": 10, "cap": "round" }, "trim": { "end": 0 },
                      "keyframes": { "trim.end": [ { "t": 0.1, "v": 0 }, { "t": 0.4, "v": 100, "ease": "$enter" } ] } } ],
      "in": { "preset": "scale_pop", "dur": "12f" } },
    { "type": "text", "id": "ok_text", "start": 2.5, "text": "Qo'shildi!",
      "style": { "font": "Georgia-Italic", "size": 76, "color": "#4F7A40" }, "anchor": "bbox_left", "position": [400, 160],
      "animators": [ { "id": "r", "preset": "chars_cascade", "t": 0, "dur": 0.5 } ] }
  ]
}
```

### F. Namuna: kompilyator chiqaradigan JSX bundle (qisqartirilgan)

```js
(function () {
  var A = AES, out = [], t0 = new Date().getTime();
  app.beginSuppressDialogs(); app.beginUndoGroup("AES s5c");
  try {
    var c = A.comp("AES_S5C_v002", 1080, 1920, 3.7, 30);
    A.background(c, { color: "#ECE8DE", radial: { color: "#F5F3ED", radius: 900 }, grain: 3 });
    var k = A.text(c, "05 · HARAJAT QO'SHISH", { font: "Consolas", size: 26, color: A.hex("#87867F"), tracking: 80 });
    A.anchorTo(k, "center"); k.transform.position.setValue([540, 62]); A.preset(k, "fade", { dur: 0.3 });
    var phone = A.component(c, "phone", { title: "Harajat Kuzatuv Bot" }, { screen: "AES_S5C_screen_v002" });
    phone.threeDLayer = true;
    A.anim(phone.property("ADBE Transform Group").property("ADBE Rotate Y"), [[0, -8], [3.7, -4]], "soft");
    // ... slots, group stagger, badge, text animators ...
    out.push(A.json({ ok: true, layers: c.numLayers, ms: new Date().getTime() - t0 }));
  } catch (e) {
    out.push(A.json({ ok: false, line: e.line, error: e.toString() }));
  } finally { app.endUndoGroup(); app.endSuppressDialogs(false); }
  return out.join("");
})();
```

---

**Yakuniy eslatma.** Spec, vositalar va komponentlar bo'yicha tafsilotlarni implementator AE 25'da tasdiqlaydi. Ayniqsa ◐ belgili matchName'lar, `saveFrameToPng`, `characterRange` va Advanced 3D tekshirilishi kerak. Tasdiqlangan qiymatlar keyin skill'lar va server `instructions` matniga qaytariladi.
