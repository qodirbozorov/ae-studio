import type { CompCreateParams, OpResultData } from "@aes/shared/ae";
import { findOrCreateFolder, itemResult } from "../lib/ae";
import { findItemByOpId, stampItem } from "../lib/trace";
import { hexToRgb, raise } from "../lib/util";

/** `comp.create` — izi bor bo'lsa mavjud comp qaytariladi (dublikat yo'q). */
export function compCreate(p: CompCreateParams, opId: string): OpResultData {
  const existing = findItemByOpId(opId);
  if (existing !== null) {
    if (!(existing instanceof CompItem)) {
      return raise("AE_SCRIPT_ERROR", "op_id boshqa turdagi elementda: " + opId);
    }
    return itemResult(opId, "comp", existing, true);
  }
  const comp = app.project.items.addComp(p.name, p.w, p.h, 1, p.dur, p.fps);
  if (p.bg !== undefined) comp.bgColor = hexToRgb(p.bg);
  if (p.folder !== undefined) comp.parentFolder = findOrCreateFolder(p.folder);
  stampItem(comp, opId);
  return itemResult(opId, "comp", comp, false);
}
