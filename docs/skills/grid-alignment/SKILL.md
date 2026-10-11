---
name: grid-alignment
description: Grid-based layout and automatic alignment check for video frames (After Effects, AE STUDIO, motion graphics, social video, slides). Turns every frame into a 10×10 grid, places each element on grid lines, then audits the built comp with a script and fixes every misalignment by exact pixel offsets. Use before planning any layout and after every build. Uzbek: joylashuv, tekislash, alignment, grid, setka, kompozitsiya.
---

# Grid alignment (10×10)

Goal: no "almost aligned" elements. Every element sits on the grid, shares edges with its neighbours, keeps equal gaps and stays inside the safe zone. Placement is planned on the grid, built from the grid, and then measured and corrected automatically.

## 1. The grid

The frame is divided into 10 columns and 10 rows.

- Vertical lines are `x0 … x10` and horizontal lines are `y0 … y10`.
- Line `k` is at `k × W / 10` (x) or `k × H / 10` (y).
- Half lines (`x2.5`, `y6.5`) are allowed. Nothing finer.
- A box is written `[x1–x2, y1–y2]` in line numbers. For example, `[1–9, 3–5]` means columns 1 to 9 and rows 3 to 5.

| format | frame (px) | column | row | half step |
|---|---|---|---|---|
| 9:16 | 1080 × 1920 | 108 | 192 | 54 / 96 |
| 1:1 | 1080 × 1080 | 108 | 108 | 54 / 54 |
| 16:9 | 1920 × 1080 | 192 | 108 | 96 / 54 |

Pixels from a line: `x = line × W / 10`, `y = line × H / 10`.

### Safe zones in grid terms

- **9:16 (Reels, TikTok, Shorts):**
  - text and key elements stay inside `[1–9, 1.5–8]`;
  - on TikTok the right edge of text stops at `x8.5`;
  - backgrounds and decor may use the full `[0–10, 0–10]`.
- **16:9 and 1:1:** text inside `[0.5–9.5, 0.5–9.5]`.

## 2. Placement rules

1. **Every element snaps.** On each axis, at least one of its left / centre / right (top / centre / bottom) lies on a line or a half line.
2. **One edge per column.** Stacked elements share one alignment: all left on the same line, or all centred on the same line. Never mix left and centre in one stack.
3. **Equal gaps.** Gaps inside a group are equal and a multiple of a half row (0.5 or 1). The gap between groups is at least twice the gap inside a group.
4. **Spans, not pixels.** Widths are whole or half spans: a headline `x1–x9` (8 columns), a card `x1.5–x8.5`, a button `x3–x7`.
5. **Text sizes come from the row height.** At 9:16 one row is 192 px. Use:
   - display = 0.75–0.9 row (144–172 px);
   - H1 = 0.5–0.6 row (96–115 px);
   - H2 = 0.35–0.4 row (67–77 px);
   - body = 0.22–0.25 row (42–48 px);
   - caption = 0.16–0.18 row (31–35 px).

   A text block of `n` lines takes `n × size × 1.15` px vertically, rounded up to a half row.
6. **Optical centre.** The hero sits on `y4–y5` (about 45% of the height), not on `y5`.
7. **No collisions.** Elements never partially overlap. Full containment (text on a card, icon in a button) is fine. Text never overlaps text.
8. **Decor is free.** Background blobs, grain, light leaks and particles ignore the grid. List them in `SKIP` for the audit.

## 3. Layout patterns (9:16)

| pattern | elements and boxes |
|---|---|
| hero statement | kicker `[1–9, 3–3.5]` · headline `[1–9, 3.5–5]` · supporting line `[1–9, 5.5–6]` (one left edge at `x1`) |
| split | statement `[1–9, 2–4]` · visual `[1–9, 4.5–8]` |
| device | phone `[2–8, 1.5–8.5]` · callouts outside the phone on `x0.5–2` or `x8–9.5` |
| data | big number `[1–9, 3–4.5]` · chart `[1–9, 5–7.5]` · label `[1–9, 7.5–8]` |
| list (3 items) | rows `[1–9, 3–4]`, `[1–9, 4.5–5.5]`, `[1–9, 6–7]` (gap 0.5 row) |
| end card | logo `[4–6, 3–4]` · CTA text `[1–9, 4.5–5.5]` · button `[3–7, 6–6.5]` · handle `[1–9, 7–7.5]` |

16:9: same idea on columns. For example, statement `[1–5, 3–7]` and visual `[5.5–9, 2–8]`.

## 4. Workflow

1. **Plan.** For every shot, write a layout table before building:

   | element | role | box | align | group |
   |---|---|---|---|---|
   | kicker | label | `[1–9, 3–3.5]` | left `x1` | A |
   | title | headline | `[1–9, 3.5–5]` | left `x1` | A |
   | card | surface | `[1–9, 5.5–7.5]` | centre `x5` | B |

   Check it against section 2 before building.

2. **Build from the boxes.** Centre `cx = (x1 + x2) / 2 × W / 10`, `cy = (y1 + y2) / 2 × H / 10`, width `(x2 − x1) × W / 10`, height `(y2 − y1) × H / 10`.
   - **AE STUDIO spec (relative units):** `pos: { x: (x1 + x2) / 20, y: (y1 + y2) / 20 }`, shape `size: { w: (x2 − x1) / 10, h: (y2 − y1) / 10 }`, text `max_width: (x2 − x1) / 10`. For left-aligned text set `style.align: "left"`; the text then starts at the box's left edge.
   - **AE STUDIO pro fields (px):** `transform.position: [cx, cy]`. Shape `contents` positions are relative to the layer position.
   - **Raw JSX:** for text, set the anchor from the real glyph bounds first (`sourceRectAtTime`: left edge for left-aligned, centre for centred), then put the position on the grid line.

3. **Audit after every build.** Run the script in section 5 (for example through `ae_run_jsx`) on each scene comp, at the time when each shot is fully on screen (its hit time). Sample several times if elements move.

4. **Fix.** Every issue comes with exact offsets. Apply them, rebuild or patch, and audit again. Repeat until `ok: true`.
   - `move_x` / `move_y`: add this many pixels to the layer position. In relative spec units, add `move_x / W` to `pos.x` and `move_y / H` to `pos.y`.
   - `safe_zone`: shrink the text (`max_width`, size) or move it inward by `over_px`.
   - `overlap` / `text_overlap`: move one element by at least the overlap plus a half-row gap, or reduce its span.
   - `near_align_x` / `near_align_y`: move the second layer by `move` so the edges coincide.
   - `unequal_gaps`: set all gaps in the stack to the most common value (rounded to a half row).

5. **Only then look.** After the audit passes, a contact sheet or the user's own timeline review checks taste, not geometry.

## 5. Audit script (ExtendScript, ES3)

Edit the four settings at the top. It returns JSON: elements in grid units and a list of issues with fixes. It is read-only: it changes nothing in the project.

```js
(function () {
  var COMP = "";   // comp name; "" = the active comp
  var TIMES = [];  // seconds to sample; [] = the middle of the comp
  var TOL = 6;     // px: allowed distance from a grid line and between aligned edges
  var SKIP = [];   // layer names to ignore (decor, particles, grain)

  function findComp(n) {
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof CompItem && it.name === n) return it;
    }
    return null;
  }
  function j(o) {
    if (o === null || o === undefined) return "null";
    var t = typeof o, a = [], k;
    if (t === "number" || t === "boolean") return String(o);
    if (t === "string") return '"' + o.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
    if (o instanceof Array) { for (k = 0; k < o.length; k++) a.push(j(o[k])); return "[" + a.join(",") + "]"; }
    for (k in o) if (o.hasOwnProperty(k)) a.push(j(k) + ":" + j(o[k]));
    return "{" + a.join(",") + "}";
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function has(list, v) { for (var i = 0; i < list.length; i++) if (list[i] === v) return true; return false; }
  function tp(l, mn) { return l.property("ADBE Transform Group").property(mn); }
  function off(v, step) { return v - Math.round(v / step) * step; }
  function bestOff(vals, step) {
    var b = null;
    for (var i = 0; i < vals.length; i++) {
      var d = off(vals[i], step);
      if (b === null || Math.abs(d) < Math.abs(b)) b = d;
    }
    return b;
  }
  function box(l, t) {
    var r = l.sourceRectAtTime(t, false);
    var pos = tp(l, "ADBE Position");
    var p = pos.dimensionsSeparated
      ? [tp(l, "ADBE Position_0").valueAtTime(t, false), tp(l, "ADBE Position_1").valueAtTime(t, false)]
      : pos.valueAtTime(t, false);
    var a = tp(l, "ADBE Anchor Point").valueAtTime(t, false);
    var s = tp(l, "ADBE Scale").valueAtTime(t, false);
    var sx = s[0] / 100, sy = s[1] / 100;
    var xa = p[0] + (r.left - a[0]) * sx, ya = p[1] + (r.top - a[1]) * sy;
    var xb = xa + r.width * sx, yb = ya + r.height * sy;
    return { x1: Math.min(xa, xb), y1: Math.min(ya, yb), x2: Math.max(xa, xb), y2: Math.max(ya, yb) };
  }

  var comp = COMP === "" ? app.project.activeItem : findComp(COMP);
  if (!(comp instanceof CompItem)) return j({ ok: false, error: "comp not found: " + COMP });
  var W = comp.width, H = comp.height, CW = W / 10, CH = H / 10;
  var M = H > W ? { t: 220, b: 380, l: 80, r: 120 } : { t: H * 0.05, b: H * 0.05, l: W * 0.05, r: W * 0.05 };
  if (TIMES.length === 0) TIMES = [comp.duration / 2];

  var elements = [], issues = [];
  for (var ti = 0; ti < TIMES.length; ti++) {
    var t = TIMES[ti], els = [];
    for (var i = 1; i <= comp.numLayers; i++) {
      var l = comp.layer(i);
      try {
        if (!l.enabled || l.guideLayer || has(SKIP, l.name)) continue;
        if (t < l.inPoint || t >= l.outPoint) continue;
        if (l.adjustmentLayer || l.nullLayer || l.hasVideo === false) continue;
        if (tp(l, "ADBE Opacity").valueAtTime(t, false) <= 0) continue;
        var b = box(l, t);
        if (b.x2 - b.x1 < 1 || b.y2 - b.y1 < 1) continue;
        var text = false;
        try { text = l.property("ADBE Text Properties") !== null; } catch (e1) { text = false; }
        var bg = b.x2 - b.x1 >= W * 0.95 && b.y2 - b.y1 >= H * 0.95;
        var notes = [];
        if (l.parent !== null) notes.push("parented: box is in parent space, check by eye");
        if (tp(l, "ADBE Rotate Z").valueAtTime(t, false) !== 0) notes.push("rotated: box is approximate");
        els.push({ name: l.name, text: text, bg: bg, box: b });
        elements.push({
          name: l.name, t: r1(t), text: text, bg: bg,
          cells: [r1(b.x1 / CW), r1(b.y1 / CH), r1(b.x2 / CW), r1(b.y2 / CH)],
          px: [Math.round(b.x1), Math.round(b.y1), Math.round(b.x2), Math.round(b.y2)],
          notes: notes
        });
        if (bg) continue;
        var dx = bestOff([b.x1, (b.x1 + b.x2) / 2, b.x2], CW / 2);
        var dy = bestOff([b.y1, (b.y1 + b.y2) / 2, b.y2], CH / 2);
        if (Math.abs(dx) > TOL) issues.push({ type: "off_grid_x", layer: l.name, t: r1(t), move_x: r1(-dx) });
        if (Math.abs(dy) > TOL) issues.push({ type: "off_grid_y", layer: l.name, t: r1(t), move_y: r1(-dy) });
        if (text) {
          var o = [];
          if (b.x1 < M.l) o.push("left " + Math.round(M.l - b.x1));
          if (b.x2 > W - M.r) o.push("right " + Math.round(b.x2 - (W - M.r)));
          if (b.y1 < M.t) o.push("top " + Math.round(M.t - b.y1));
          if (b.y2 > H - M.b) o.push("bottom " + Math.round(b.y2 - (H - M.b)));
          if (o.length > 0) issues.push({ type: "safe_zone", layer: l.name, t: r1(t), over_px: o.join(", ") });
        }
      } catch (e) {
        // cameras, lights and layers without bounds are skipped
      }
    }

    for (var a1 = 0; a1 < els.length; a1++) {
      for (var a2 = a1 + 1; a2 < els.length; a2++) {
        var A = els[a1], B = els[a2];
        if (A.bg || B.bg) continue;
        var ix = Math.min(A.box.x2, B.box.x2) - Math.max(A.box.x1, B.box.x1);
        var iy = Math.min(A.box.y2, B.box.y2) - Math.max(A.box.y1, B.box.y1);
        if (ix > TOL && iy > TOL) {
          var aInB = A.box.x1 >= B.box.x1 - TOL && A.box.x2 <= B.box.x2 + TOL && A.box.y1 >= B.box.y1 - TOL && A.box.y2 <= B.box.y2 + TOL;
          var bInA = B.box.x1 >= A.box.x1 - TOL && B.box.x2 <= A.box.x2 + TOL && B.box.y1 >= A.box.y1 - TOL && B.box.y2 <= A.box.y2 + TOL;
          if ((A.text && B.text) || (!aInB && !bInA)) {
            issues.push({ type: A.text && B.text ? "text_overlap" : "overlap", layers: [A.name, B.name], t: r1(t), px: [Math.round(ix), Math.round(iy)] });
          }
        }
        if (ix > 0) {
          var ex = [[A.box.x1, B.box.x1, "left"], [(A.box.x1 + A.box.x2) / 2, (B.box.x1 + B.box.x2) / 2, "centre"], [A.box.x2, B.box.x2, "right"]];
          var bx = null;
          for (var q = 0; q < ex.length; q++) if (bx === null || Math.abs(ex[q][1] - ex[q][0]) < Math.abs(bx[1] - bx[0])) bx = ex[q];
          var ddx = bx[1] - bx[0];
          if (Math.abs(ddx) > TOL && Math.abs(ddx) < CW / 2) {
            issues.push({ type: "near_align_x", layers: [A.name, B.name], edge: bx[2], t: r1(t), move: r1(-ddx) });
          }
        }
        if (iy > 0) {
          var ey = [[A.box.y1, B.box.y1, "top"], [(A.box.y1 + A.box.y2) / 2, (B.box.y1 + B.box.y2) / 2, "centre"], [A.box.y2, B.box.y2, "bottom"]];
          var by = null;
          for (var w = 0; w < ey.length; w++) if (by === null || Math.abs(ey[w][1] - ey[w][0]) < Math.abs(by[1] - by[0])) by = ey[w];
          var ddy = by[1] - by[0];
          if (Math.abs(ddy) > TOL && Math.abs(ddy) < CH / 2) {
            issues.push({ type: "near_align_y", layers: [A.name, B.name], edge: by[2], t: r1(t), move: r1(-ddy) });
          }
        }
      }
    }

    var col = [];
    for (var c = 0; c < els.length; c++) if (!els[c].bg) col.push(els[c]);
    for (var s1 = 0; s1 < col.length; s1++) {
      for (var s2 = 0; s2 < col.length - 1 - s1; s2++) {
        if (col[s2].box.y1 > col[s2 + 1].box.y1) { var tmp = col[s2]; col[s2] = col[s2 + 1]; col[s2 + 1] = tmp; }
      }
    }
    var gaps = [], names = [];
    for (var g = 0; g + 1 < col.length; g++) {
      var U = col[g], D = col[g + 1];
      var shared = Math.min(U.box.x2, D.box.x2) - Math.max(U.box.x1, D.box.x1);
      var gap = D.box.y1 - U.box.y2;
      if (shared > 0 && gap > 0) { gaps.push(Math.round(gap)); names.push(U.name + " → " + D.name); }
    }
    if (gaps.length >= 2) {
      var lo = gaps[0], hi = gaps[0];
      for (var m = 1; m < gaps.length; m++) { if (gaps[m] < lo) lo = gaps[m]; if (gaps[m] > hi) hi = gaps[m]; }
      if (hi - lo > TOL) issues.push({ type: "unequal_gaps", t: r1(t), gaps: gaps, pairs: names });
    }
  }

  return j({
    ok: issues.length === 0, comp: comp.name, size: [W, H], cell: [r1(CW), r1(CH)],
    safe: M, elements: elements, issues: issues
  });
})();
```

Notes:
- The box is the layer's real content bounds (`sourceRectAtTime`), transformed by its position, anchor and scale. Text uses its glyph bounds, so the check is exact for text.
- Parented and rotated layers are marked in `notes`; check them by eye or unparent them for the audit.
- Decor, particles and anything that deliberately breaks the grid go in `SKIP`.
- A pass means geometry only. Taste (hierarchy, contrast, rhythm) is still the designer's job.

## 6. Checklist

- [ ] Every shot has a layout table with grid boxes before the build.
- [ ] Text inside the safe zone in grid terms (9:16: `[1–9, 1.5–8]`).
- [ ] Every stack has one alignment edge; gaps are equal half-row multiples.
- [ ] Sizes follow the row-based scale; nothing below 28 px.
- [ ] The audit returns `ok: true` at every hit time of every scene.
