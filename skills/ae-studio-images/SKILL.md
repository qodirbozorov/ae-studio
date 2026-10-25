---
name: ae-studio-images
description: Find and use stock photos (Unsplash) in AE Studio videos — when a scene needs a background, b-roll still, product context or illustrative photo that the user's own source/ files don't have. Covers when to search, writing English queries, matching orientation and brand color, showing options to the user, importing into the project (images_search → images_import → asset:unsplash_…), using the photo in the spec, and photo credits. Uzbek: rasm, foto, fon rasmi, stok rasm, Unsplash, rasm topib qo'y.
---

# AE Studio — stock photos (Unsplash)

AE Studio's MCP server can search Unsplash and drop a chosen photo into the user's project folder
(`source/unsplash/`). The photo then behaves like any of the user's own files: `asset:unsplash_<id>` in the spec.
Files come straight from Unsplash's CDN to the user's computer — nothing is re-hosted.

## When to use it

Use stock photos only when the video needs a picture the user doesn't have:

- a background behind text (title cards, quotes, statistics, "3 tips" lists);
- b-roll stills for a voiceover topic (a city, a field, an office, food, nature, a process);
- context for a product or service (a workplace, a classroom, a kitchen, a road);
- a mood or season (sunrise, rain, winter, a festive table).

Do **not** use it when:

- the user's `source/` already has suitable footage — always run `assets_list` first and prefer the user's own media;
- the user asked for their own photos only, or for a specific real person or place they will supply;
- you need a **logo or brand mark** — use `icons_search` (Iconify `simple-icons:`/`logos:`, or
  `source: "worldvectorlogo"`) instead;
- you need an icon, an arrow or a UI element — use `icons_search`.

## Workflow

1. **Check what exists.** Call `assets_list` (after `assets_scan` if needed) and look at the user's images and videos
   (`asset_preview`). List the scenes that still lack a visual.

2. **Search once per subject.** Call `images_search` with:
   - `query` — **English**, 1–4 concrete words: subject + setting + light/mood. Examples:
     - "cotton field sunrise", "modern office desk", "students classroom",
     - "Samarkand Registan", "bread bakery oven", "city night traffic".
   - `project_id` — so orientation follows the plan format (9:16 → portrait, 16:9 → landscape, 1:1 → squarish).
   - `color` (optional) — to match the brand or the scene palette (`blue`, `orange`, `black_and_white` …).
   - `count` — 8–12 is enough.

   The hourly quota is shared (demo key: 50 requests/hour). Reuse results; don't search the same words twice. If
   results are poor, change the words (broader subject, drop the color) rather than paging deep.

3. **Show options and let the user choose.** Never import silently. Present 3–6 candidates in the user's language
   (usually Uzbek), numbered, each with: description, size and orientation, author, and the `thumb` link. Example:

   > Fon uchun 4 ta variant (Unsplash):
   > 1. Paxta dalasi, quyosh chiqishi — 6000×4000, muallif: Aziz Karimov — [ko'rish](thumb-url)
   > 2. …
   > Qaysi birini olay? (Raqamni yozing yoki "boshqasini qidir" deng.)

   If the user has already said "pick it yourself", choose the best one and say which you picked and why.

4. **Import the chosen photo.** Call `images_import` with `project_id` and `photo_id`:
   - `width` defaults to 1.25 × the plan's larger side (max 4000 px). Pass a larger `width` only for slow zooms
     (`ken_burns_in` on a 4K plan) or tight crops.
   - The panel must be online (`ENV_AGENT_OFFLINE` → ask the user to open After Effects and the AE Studio panel).
   - The result gives `ref` (e.g. `asset:unsplash_ab1_cd`), file size and the attribution line. Importing the same
     photo again returns the existing asset — no second download.

5. **Use it in the spec** like any media file:

   ```json
   { "type": "media", "src": "asset:unsplash_ab1_cd", "fit": "cover", "anim": "ken_burns_in" }
   ```

   - Full-frame background: `fit: "cover"`, gentle motion (`ken_burns_in` / `ken_burns_out`).
   - Under text: add a dark band or overlay so the text stays readable, e.g.
     `{ "type": "shape", "kind": "rect", "color": "#000000", "size": { "w": 1, "h": 0.4 }, "pos": "bottom", "opacity": 45 }`,
     and keep text in the calm part of the photo (sky, wall, empty table).
   - Picture card inside a layout: `fit: "contain"` with `scale` < 1, or a mask from the professional fields.
   - One photo per scene is plenty. Keep a set consistent: similar light, palette and style (the `color` field helps;
     the same author often helps too).

6. **Credits at the end.** After the build (or before rendering), call `images_credits` and give the user the lines
   for the post description, e.g. "Photo by Aziz Karimov on Unsplash". The Unsplash License doesn't require credit in
   the video itself, but crediting is good practice and AE Studio shows it in the project.

## Rules

- The user decides: show options, import only what they picked (or explicitly delegated).
- Prefer the user's own media; stock is for gaps.
- Don't use photos of identifiable people to suggest they endorse a product, a party or a service.
- Don't present a stock photo as the user's own place or product (e.g. "our office") unless the user says it's fine.
- Unsplash content is for the video, not for AI training or datasets.
- Unsplash+ (premium) photos are filtered out automatically; if an id is refused as premium, pick another.

## Errors

| Error | What to do |
|---|---|
| `SYS_BAD_REQUEST` "Rasmlar xizmati sozlanmagan" | The admin hasn't added the Unsplash key (admin → Rasmlar). Tell the user; continue without stock photos. |
| `SYS_RATE_LIMIT` | The hourly quota is used up. Use the results you already have, or continue and add the photo later. |
| `ENV_AGENT_OFFLINE` | The panel is offline — ask the user to open AE and the panel, then retry `images_import`. |
| `SYS_NOT_FOUND` | Wrong or deleted photo id — search again. |
| `ASSET_CORRUPT` on import | The download was interrupted — retry once; if it repeats, try a smaller `width`. |
