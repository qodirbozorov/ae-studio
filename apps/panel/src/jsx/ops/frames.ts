import type { AeContext, FramesCaptureParams, OpResultData } from "@aes/shared/ae";
import { resolveInRoot } from "../lib/paths";
import { requireComp } from "../lib/trace";
import { raise } from "../lib/util";

const WAIT_STEP_MS = 100;
const WAIT_MAX_MS = 15000;

function pad(value: number): string {
  return value < 10 ? "0" + value : String(value);
}

/**
 * VERIFY kadrlari: `comp.saveFrameToPng` hujjatlashtirilmagan va asinxron — fayl paydo bo'lishi
 * (va bo'sh bo'lmasligi) kutiladi. Papka har chaqiruvda yangi (server beradi): mavjud fayl ustiga yozilmaydi.
 * Loyiha o'zgarmaydi (undo group ochilmaydi).
 */
export function framesCapture(
  params: FramesCaptureParams,
  opId: string,
  ctx: AeContext,
): OpResultData {
  const comp = requireComp(params.comp);
  const dirAbs = resolveInRoot(ctx.root, params.dir);
  const relDir = params.dir.replace(/[\\/]+$/, "");
  const folder = new Folder(dirAbs);
  if (!folder.exists && !folder.create()) {
    raise("AE_SCRIPT_ERROR", "Papka yaratilmadi: " + relDir);
  }
  const last = Math.max(0, comp.duration - comp.frameDuration);
  const files: { time: number; path: string }[] = [];
  for (let i = 0; i < params.times.length; i++) {
    const time = Math.min(params.times[i] as number, last);
    const name = "frame_" + pad(i + 1) + ".png";
    const file = new File(dirAbs + "/" + name);
    if (file.exists)
      raise("AE_BAD_PARAMS", "Kadr fayli mavjud, ustiga yozilmaydi: " + relDir + "/" + name);
    comp.saveFrameToPng(time, file);
    let waited = 0;
    while ((!file.exists || file.length <= 0) && waited < WAIT_MAX_MS) {
      $.sleep(WAIT_STEP_MS);
      waited += WAIT_STEP_MS;
    }
    if (!file.exists || file.length <= 0)
      raise("AE_TIMEOUT", "Kadr yozilmadi: " + relDir + "/" + name);
    files.push({ time: Math.round(time * 1000) / 1000, path: relDir + "/" + name });
  }
  return { op_id: opId, reused: false, info: { comp: comp.name, files: files } };
}
