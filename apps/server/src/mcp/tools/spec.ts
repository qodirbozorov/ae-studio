/** Video Spec hujjati: Claude plan yozishdan oldin bir marta o'qiydi. */
import { ANIMS, OUTPUT_PRESETS, POSITIONS, TRANSITIONS, ok, specJsonSchema } from "@aes/shared";
import { z } from "zod";
import { defineTool } from "../registry";

export const specTools = [
  defineTool({
    name: "spec_schema",
    title: "Video Spec schema",
    description:
      "JSON Schema of the Video Spec (plan.json) accepted by plan_write, plus the closed lists of animations, positions, transitions and output presets. Read once before writing a plan.",
    input: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async handler() {
      return ok({
        schema: specJsonSchema(),
        anims: ANIMS,
        positions: POSITIONS,
        transitions: TRANSITIONS,
        output_presets: OUTPUT_PRESETS,
        notes: [
          "Media is referenced only as asset:<key> (keys from assets_list).",
          "Scene dur is seconds; layers are drawn bottom-to-top in array order (first = bottom).",
          "pos accepts a preset name or {x,y} relative to the frame (0..1).",
        ],
      });
    },
  }),
];
