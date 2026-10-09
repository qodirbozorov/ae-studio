import type { AeContext, FramesCaptureParams, OpResultData } from "@aes/shared/ae";
import { resolveInRoot } from "../lib/paths";
import { requireComp } from "../lib/trace";
import { raise } from "../lib/util";

function pad(value: number): string {
  return value < 10 ? "0" + value : String(value);
}

/**
 * VERIFY kadrlari: `comp.saveFrameToPng` hujjatlashtirilmagan va **asinxron** — AE kadrni skript tugagandan
 * keyin (o'z asosiy oqimida) yozadi. Shuning uchun bu yerda kutilmaydi: ExtendScript ichidagi `$.sleep`
 * sikli AE'ni bloklab, fayl hech qachon yozilmasdi (AE_TIMEOUT, update-technicalguidline #3).
 * Fayllar paydo bo'lishini panel agenti diskda kutadi. Papka har chaqiruvda yangi: ustiga yozilmaydi.
 * Loyiha o'zgarmaydi (undo group ochilmaydi).
 */
export function framesCapture(
  params: FramesCaptureParams,
  opId: string,
  ctx: AeContext,
): OpResultData {
  const comp = requireComp(params.comp);
  const dirAbs = resolveInRoot(ctx.root, params.dir);
  const relDir = params.dir.replace(/[\\\x2f]+$/, "");
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
    files.push({ time: Math.round(time * 1000) / 1000, path: relDir + "/" + name });
  }
  // `pending: true` — fayllar AE tomonidan keyinroq yoziladi (agent kutadi).
  return { op_id: opId, reused: false, info: { comp: comp.name, files: files, pending: true } };
}
