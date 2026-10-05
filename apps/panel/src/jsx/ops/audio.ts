import type {
  AudioDuckParams,
  CaptionsBuildParams,
  CaptionWord,
  OpResultData,
  TextStyleOp,
} from "@aes/shared/ae";
import { setLayerTiming, transformProperty } from "../lib/ae";
import { findLayerInComp, hasLayerTag, requireComp, requireLayer, stampLayer } from "../lib/trace";
import { applyTextStyle } from "./layer";

interface CaptionStyle {
  caps: boolean;
  size: number;
  color: string;
  stroke_color?: string;
  stroke_width?: number;
  anim: "karaoke" | "pop" | "fade";
}

/** Subtitr stillari (§11.2): karaoke_bold, bold_pop, minimal. `size` — kadr balandligiga nisbatan. */
const STYLES: { [name: string]: CaptionStyle | undefined } = {
  karaoke_bold: {
    caps: true,
    size: 0.05,
    color: "#FFFFFF",
    stroke_color: "#000000",
    stroke_width: 8,
    anim: "karaoke",
  },
  bold_pop: {
    caps: true,
    size: 0.055,
    color: "#FFE14D",
    stroke_color: "#000000",
    stroke_width: 8,
    anim: "pop",
  },
  minimal: { caps: false, size: 0.04, color: "#FFFFFF", anim: "fade" },
};

interface Chunk {
  words: CaptionWord[];
  start: number;
  end: number;
}

/** So'zlarni qatorlarga bo'ladi: `max_words`, gap oxiri (.!?) yoki 0.6 s dan uzun pauza. */
export function chunkWords(words: CaptionWord[], maxWords: number): Chunk[] {
  const chunks: Chunk[] = [];
  let current: CaptionWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as CaptionWord;
    const previous = current.length > 0 ? (current[current.length - 1] as CaptionWord) : null;
    const pause = previous !== null && word.start - previous.end > 0.6;
    const sentenceEnd = previous !== null && /[.!?]$/.test(previous.text);
    if (current.length >= maxWords || pause || sentenceEnd) {
      chunks.push({
        words: current,
        start: (current[0] as CaptionWord).start,
        end: (current[current.length - 1] as CaptionWord).end,
      });
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) {
    chunks.push({
      words: current,
      start: (current[0] as CaptionWord).start,
      end: (current[current.length - 1] as CaptionWord).end,
    });
  }
  // Qisqa bo'shliqlarda keyingi qatorgacha ko'rinib turadi (miltillamaslik uchun).
  for (let j = 0; j + 1 < chunks.length; j++) {
    const a = chunks[j] as Chunk;
    const b = chunks[j + 1] as Chunk;
    if (b.start - a.end < 0.3) a.end = b.start;
  }
  return chunks;
}

function joinWords(words: CaptionWord[], count: number, caps: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < count && i < words.length; i++) parts.push((words[i] as CaptionWord).text);
  const text = parts.join(" ");
  return caps ? text.toUpperCase() : text;
}

/**
 * `captions.build` — so'z vaqtlaridan subtitr: har qator alohida text layer (in/out so'zlar bo'yicha).
 * karaoke — so'zlar navbat bilan paydo bo'ladi (Source Text keyframe'lari), pop — masshtab, minimal — fade.
 */
export function captionsBuild(p: CaptionsBuildParams, opId: string): OpResultData {
  const comp = requireComp(p.comp);
  const chunks = chunkWords(p.words, p.max_words);
  if (findLayerInComp(comp, opId + ".0") !== null) {
    return { op_id: opId, reused: true, info: { layers: chunks.length } };
  }
  const style =
    STYLES[p.style] !== undefined
      ? (STYLES[p.style] as CaptionStyle)
      : (STYLES.minimal as CaptionStyle);
  const size = Math.round(comp.height * style.size);
  const textStyle: TextStyleOp = { size: size, color: style.color, justify: "center" };
  if (style.stroke_color !== undefined) textStyle.stroke_color = style.stroke_color;
  if (style.stroke_width !== undefined) textStyle.stroke_width = style.stroke_width;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] as Chunk;
    const full = joinWords(chunk.words, chunk.words.length, style.caps);
    const layer = comp.layers.addBoxText([p.box_w, size * 3], full);
    layer.name = "CAPTION " + (i + 1);
    applyTextStyle(layer, textStyle);
    transformProperty(layer, "ADBE Position").setValue(p.pos);
    setLayerTiming(layer, comp, chunk.start, Math.max(0.05, chunk.end - chunk.start));

    if (style.anim === "karaoke") {
      const source = (layer.property("ADBE Text Properties") as PropertyGroup).property(
        "ADBE Text Document",
      ) as Property;
      for (let w = 0; w < chunk.words.length; w++) {
        const doc = source.value as TextDocument;
        doc.text = joinWords(chunk.words, w + 1, style.caps);
        source.setValueAtTime(w === 0 ? chunk.start : (chunk.words[w] as CaptionWord).start, doc);
      }
    } else if (style.anim === "pop") {
      const scale = transformProperty(layer, "ADBE Scale");
      scale.setValueAtTime(chunk.start, [80, 80]);
      scale.setValueAtTime(chunk.start + 0.12, [100, 100]);
    } else {
      const opacity = transformProperty(layer, "ADBE Opacity");
      opacity.setValueAtTime(chunk.start, 0);
      opacity.setValueAtTime(chunk.start + 0.1, 100);
    }
    stampLayer(layer, opId + "." + i);
  }
  return { op_id: opId, reused: false, info: { layers: chunks.length } };
}

/**
 * `audio.duck` — ovoz eshitiladigan oraliqlarda musiqa `amount_db` ga pasayadi (fade bilan), keyin qaytadi.
 * Yaqin oraliqlar birlashtiriladi (pompalanmaslik uchun).
 */
export function audioDuck(p: AudioDuckParams, opId: string): OpResultData {
  const music = requireLayer(p.music_layer);
  requireLayer(p.voice_layer);
  if (hasLayerTag(music, opId)) return { op_id: opId, reused: true };
  const levels = (music.property("ADBE Audio Group") as PropertyGroup).property(
    "ADBE Audio Levels",
  ) as Property;
  const base = (levels.value as number[])[0] as number;
  const low = base + p.amount_db;

  const spans: { start: number; end: number }[] = [];
  const sorted = p.segments.slice(0).sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i] as { start: number; end: number };
    const last = spans.length > 0 ? spans[spans.length - 1] : undefined;
    if (last !== undefined && seg.start - last.end <= p.fade * 2) {
      if (seg.end > last.end) last.end = seg.end;
    } else {
      spans.push({ start: seg.start, end: seg.end });
    }
  }
  for (let j = 0; j < spans.length; j++) {
    const span = spans[j] as { start: number; end: number };
    const fadeIn = span.start - p.fade > 0 ? span.start - p.fade : 0;
    if (span.start > 0) levels.setValueAtTime(fadeIn, [base, base]);
    levels.setValueAtTime(span.start, [low, low]);
    levels.setValueAtTime(span.end, [low, low]);
    levels.setValueAtTime(span.end + p.fade, [base, base]);
  }
  stampLayer(music, opId);
  return { op_id: opId, reused: false, info: { segments: spans.length } };
}
