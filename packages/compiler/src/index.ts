export { MAIN_COMP, compile, keyTimes } from "./compile";
export type {
  CompileAsset,
  CompileAudio,
  CompileContext,
  CompileOutput,
  CompiledScene,
} from "./compile";
export {
  VO_TAIL_S,
  planTiming,
  resolveAt,
  sentenceBoundaries,
  shiftWords,
  voiceSegments,
  wordsFromAlignment,
} from "./timing";
export type { AlignmentLike, Timing } from "./timing";
export { fitScale, toPixels } from "./layout";
export { ANIM_IN_S, TRANSITION_S, animOps, transitionOps } from "./motion";
export { DEFAULT_BRAND_TOKENS, aspectOf, brandTokens, expandTemplate } from "./template";
export type { CompileTemplate, ExpandedTemplate, TokenValue } from "./template";
