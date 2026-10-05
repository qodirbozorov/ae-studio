/**
 * Render presetlari (§3 RENDER, P3.07). Q5: asosiy usul `aerender` (AE UI bloklanmaydi), zaxira — Render Queue.
 * AE oraliq faylni render qiladi, panel uni ffmpeg bilan yakuniy mp4 ga o'giradi (preset shu yerda).
 */
import type { OutputPreset } from "./spec";

export interface RenderPreset {
  label: string;
  description: string;
  container: "mp4";
  video_bitrate: string;
  audio_bitrate: string;
}

export const RENDER_PRESETS: Record<OutputPreset, RenderPreset> = {
  h264_social: {
    label: "H.264 — ijtimoiy tarmoqlar",
    description:
      "MP4 (H.264 + AAC), ~8 Mbit/s, yuv420p, faststart: Instagram/TikTok/Telegram uchun",
    container: "mp4",
    video_bitrate: "8M",
    audio_bitrate: "192k",
  },
  h264_hq: {
    label: "H.264 — yuqori sifat",
    description: "MP4 (H.264 + AAC), ~20 Mbit/s: arxiv, YouTube yoki keyingi montaj uchun",
    container: "mp4",
    video_bitrate: "20M",
    audio_bitrate: "320k",
  },
};

/** Davomiylik gate'i: ±1 kadr (+ 10 ms yaxlitlash zaxirasi). */
export function durationMatches(actual: number, expected: number, fps: number): boolean {
  return Math.abs(actual - expected) <= 1 / fps + 0.01;
}
