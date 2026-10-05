/**
 * Animatsiya (`anim`) va o'tish (`transition_out`) presetlari → `prop.keyframes` / `prop.expression` oplari.
 * Hammasi yopiq op to'plami ichida (D4): yangi AE kodi yo'q, faqat keyframe va kutubxona expression'lari.
 */
import type { Anim, Transition } from "@aes/shared";
import type { Ease, Keyframe, OpParamsMap, PropPath } from "@aes/shared";
import type { Frame } from "./layout";
import { round } from "./layout";

export type MotionOp =
  | { op: "prop.keyframes"; suffix: string; params: OpParamsMap["prop.keyframes"] }
  | { op: "prop.expression"; suffix: string; params: OpParamsMap["prop.expression"] };

export const ANIM_IN_S = 0.4;
export const TRANSITION_S = 0.3;

function keys(
  layer: string,
  prop: PropPath,
  frames: Keyframe[],
  ease: Ease,
  relative: boolean,
  suffix: string,
): MotionOp {
  return { op: "prop.keyframes", suffix, params: { layer, prop, keys: frames, ease, relative } };
}

export interface AnimTarget {
  /** Layer'ni yaratgan opning op_id si. */
  layer: string;
  /** Layer turi: masshtab/joylashuvga oid presetlar uchun. */
  kind: "media" | "text" | "shape";
  /** Layer joylashuvi (piksel) va boshlang'ich masshtabi (%). */
  pos: [number, number];
  scale: [number, number];
  /** Layer davomiyligi (soniya) — Ken Burns uchun. */
  dur: number;
}

/** Kirish animatsiyasi: vaqtlar layer boshiga nisbatan (`relative`). */
export function animOps(anim: Anim, target: AnimTarget, frame: Frame): MotionOp[] {
  const { layer, pos, scale } = target;
  const [x, y] = pos;
  const scaled = (k: number): number[] => [round(scale[0] * k), round(scale[1] * k)];
  const offset = (dx: number, dy: number): number[] => [round(x + dx), round(y + dy)];
  switch (anim) {
    case "none":
      return [];
    case "fade_in":
      return [
        keys(
          layer,
          "opacity",
          [
            { t: 0, v: 0 },
            { t: ANIM_IN_S, v: 100 },
          ],
          "ease_out",
          true,
          "anim",
        ),
      ];
    case "ken_burns_in":
      return [
        keys(
          layer,
          "scale",
          [
            { t: 0, v: scaled(1) },
            { t: target.dur, v: scaled(1.12) },
          ],
          "linear",
          true,
          "anim",
        ),
      ];
    case "ken_burns_out":
      return [
        keys(
          layer,
          "scale",
          [
            { t: 0, v: scaled(1.12) },
            { t: target.dur, v: scaled(1) },
          ],
          "linear",
          true,
          "anim",
        ),
      ];
    case "pop":
      return [
        keys(
          layer,
          "scale",
          [
            { t: 0, v: scaled(0) },
            { t: 0.25, v: scaled(1.1) },
            { t: 0.35, v: scaled(1) },
          ],
          "ease_out",
          true,
          "anim",
        ),
      ];
    case "zoom_in":
      return [
        keys(
          layer,
          "scale",
          [
            { t: 0, v: scaled(0.8) },
            { t: ANIM_IN_S, v: scaled(1) },
          ],
          "ease_out",
          true,
          "anim",
        ),
        keys(
          layer,
          "opacity",
          [
            { t: 0, v: 0 },
            { t: ANIM_IN_S, v: 100 },
          ],
          "ease_out",
          true,
          "anim.fade",
        ),
      ];
    case "slide_up":
    case "slide_down":
    case "slide_left":
    case "slide_right": {
      const d =
        anim === "slide_up"
          ? [0, 0.08 * frame.h]
          : anim === "slide_down"
            ? [0, -0.08 * frame.h]
            : anim === "slide_left"
              ? [0.08 * frame.w, 0]
              : [-0.08 * frame.w, 0];
      return [
        keys(
          layer,
          "position",
          [
            { t: 0, v: offset(d[0]!, d[1]!) },
            { t: ANIM_IN_S, v: offset(0, 0) },
          ],
          "ease_out",
          true,
          "anim",
        ),
        keys(
          layer,
          "opacity",
          [
            { t: 0, v: 0 },
            { t: ANIM_IN_S, v: 100 },
          ],
          "ease_out",
          true,
          "anim.fade",
        ),
      ];
    }
    case "typewriter":
      return target.kind === "text"
        ? [
            {
              op: "prop.expression",
              suffix: "anim",
              params: {
                layer,
                prop: "ADBE Text Properties/ADBE Text Document",
                expr_id: "typewriter",
                args: { cps: 20 },
              },
            },
          ]
        : animOps("fade_in", target, frame);
  }
}

/**
 * Sahna oxiridagi o'tish: asosiy comp'dagi nest layer'iga, absolyut vaqt bilan (`relative: false`).
 * `end` — sahnaning asosiy comp'dagi tugash vaqti.
 */
export function transitionOps(
  transition: Transition,
  layer: string,
  end: number,
  frame: Frame,
): MotionOp[] {
  if (transition === "none") return [];
  const from = round(Math.max(0, end - TRANSITION_S));
  const at = round(end);
  const cx = round(frame.w / 2);
  const cy = round(frame.h / 2);
  const move = (dx: number, dy: number) =>
    keys(
      layer,
      "position",
      [
        { t: from, v: [cx, cy] },
        { t: at, v: [round(cx + dx), round(cy + dy)] },
      ],
      "ease_in",
      false,
      "transition",
    );
  switch (transition) {
    case "fade":
      return [
        keys(
          layer,
          "opacity",
          [
            { t: from, v: 100 },
            { t: at, v: 0 },
          ],
          "linear",
          false,
          "transition",
        ),
      ];
    case "whip_left":
      return [move(-frame.w, 0)];
    case "whip_right":
      return [move(frame.w, 0)];
    case "whip_up":
      return [move(0, -frame.h)];
    case "whip_down":
      return [move(0, frame.h)];
    case "slide_left":
      return [
        move(-frame.w * 0.3, 0),
        keys(
          layer,
          "opacity",
          [
            { t: from, v: 100 },
            { t: at, v: 0 },
          ],
          "linear",
          false,
          "transition.fade",
        ),
      ];
    case "slide_right":
      return [
        move(frame.w * 0.3, 0),
        keys(
          layer,
          "opacity",
          [
            { t: from, v: 100 },
            { t: at, v: 0 },
          ],
          "linear",
          false,
          "transition.fade",
        ),
      ];
    case "zoom_in":
    case "zoom_out": {
      const to = transition === "zoom_in" ? 130 : 70;
      return [
        keys(
          layer,
          "scale",
          [
            { t: from, v: [100, 100] },
            { t: at, v: [to, to] },
          ],
          "ease_in",
          false,
          "transition",
        ),
        keys(
          layer,
          "opacity",
          [
            { t: from, v: 100 },
            { t: at, v: 0 },
          ],
          "linear",
          false,
          "transition.fade",
        ),
      ];
    }
  }
}
