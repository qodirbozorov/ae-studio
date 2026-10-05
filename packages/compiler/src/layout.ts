/** Joylashuv va masshtab hisoblari: Spec'dagi preset/nisbiy qiymatlar → piksel (§9, §10.1). */
import type { Position } from "@aes/shared";

export interface Frame {
  w: number;
  h: number;
}

/** Pozitsiya presetlari (kadr o'lchamiga nisbatan). */
const PRESETS: Record<string, [number, number]> = {
  center: [0.5, 0.5],
  top: [0.5, 0.12],
  bottom: [0.5, 0.88],
  upper_third: [0.5, 1 / 3],
  lower_third: [0.5, 0.78],
  top_left: [0.1, 0.1],
  top_right: [0.9, 0.1],
  bottom_left: [0.1, 0.9],
  bottom_right: [0.9, 0.9],
};

export function toPixels(pos: Position, frame: Frame): [number, number] {
  const [rx, ry] = typeof pos === "string" ? (PRESETS[pos] ?? [0.5, 0.5]) : [pos.x, pos.y];
  return [round(rx * frame.w), round(ry * frame.h)];
}

/** `fit` bo'yicha masshtab (%) — ExtendScript'dagi `fitScale` bilan bir xil formula. */
export function fitScale(
  fit: "cover" | "contain" | "stretch" | "none",
  item: { width?: number | null; height?: number | null },
  frame: Frame,
): [number, number] {
  const iw = item.width ?? 0;
  const ih = item.height ?? 0;
  if (fit === "none" || iw <= 0 || ih <= 0) return [100, 100];
  const sx = frame.w / iw;
  const sy = frame.h / ih;
  if (fit === "stretch") return [round(sx * 100), round(sy * 100)];
  const s = fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
  return [round(s * 100), round(s * 100)];
}

/** 3 xonagacha yaxlitlash (snapshot'lar barqaror bo'lishi uchun). */
export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
