import { parseSpec } from "@aes/shared";
import type { VideoSpec } from "@aes/shared";
import type { CompileContext } from "../src/compile";

/** 3 sahnali qo'lda yozilgan plan.json (P2.14 gate'i: media + matn + shape, animatsiya, o'tishlar). */
export const THREE_SCENES = {
  version: 1,
  format: { w: 1080, h: 1920, fps: 30 },
  output: { preset: "h264_social", name: "reel_v1" },
  scenes: [
    {
      id: "hook",
      dur: 3,
      transition_out: "whip_left",
      layers: [
        { type: "media", src: "asset:clip_01", anim: "ken_burns_in" },
        {
          id: "title",
          type: "text",
          text: "3 ta xato",
          anim: "pop",
          pos: "center",
          style: { size: 120 },
        },
      ],
    },
    {
      id: "point",
      dur: 4,
      bg: "#101820",
      transition_out: "fade",
      layers: [
        { type: "media", src: "asset:photo_02", fit: "contain", anim: "fade_in" },
        {
          type: "shape",
          kind: "rect",
          color: "#FFCC00",
          size: { w: 0.8, h: 0.08 },
          pos: "lower_third",
          radius: 24,
        },
        {
          id: "caption",
          type: "text",
          text: "Ko'p odam buni bilmaydi",
          pos: "lower_third",
          anim: "typewriter",
        },
      ],
    },
    {
      id: "cta",
      dur: 2.5,
      layers: [
        {
          type: "text",
          text: "Obuna bo'ling!",
          anim: "slide_up",
          style: { color: "#FFCC00", all_caps: true },
        },
        { type: "audio", src: "asset:ding", start: 0.2, volume_db: -6 },
      ],
    },
  ],
};

export function spec(input: unknown = THREE_SCENES): VideoSpec {
  const parsed = parseSpec(input);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.data;
}

export const CONTEXT: CompileContext = {
  projectPath: "reel_v001.aep",
  version: 1,
  assets: {
    clip_01: {
      key: "clip_01",
      local_path: "source/clip_01.mp4",
      kind: "video",
      status: "ok",
      meta: { width: 1920, height: 1080, duration: 8 },
    },
    photo_02: {
      key: "photo_02",
      local_path: "source/photo_02.jpg",
      kind: "image",
      status: "ok",
      meta: { width: 1000, height: 1500 },
    },
    ding: {
      key: "ding",
      local_path: "audio/ding.wav",
      kind: "audio",
      status: "ok",
      meta: { duration: 1 },
    },
  },
};
