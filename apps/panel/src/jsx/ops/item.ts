import type { AeContext, ItemImportParams, OpResultData } from "@aes/shared/ae";
import { findOrCreateFolder, itemResult } from "../lib/ae";
import { resolveInRoot } from "../lib/paths";
import { findItemByOpId, stampItem } from "../lib/trace";
import { raise } from "../lib/util";

/** `item.import` — faqat ish papkasi ichidagi fayl; izi bor bo'lsa qayta import qilinmaydi. */
export function itemImport(p: ItemImportParams, opId: string, ctx: AeContext): OpResultData {
  const existing = findItemByOpId(opId);
  if (existing !== null) return itemResult(opId, "footage", existing, true);

  const path = resolveInRoot(ctx.root, p.file);
  const file = new File(path);
  if (!file.exists) return raise("ASSET_MISSING", "Fayl topilmadi: " + p.file);

  const options = new ImportOptions(file);
  if (options.canImportAs(ImportAsType.FOOTAGE)) options.importAs = ImportAsType.FOOTAGE;
  let item: _ItemClasses;
  try {
    item = app.project.importFile(options);
  } catch (error) {
    return raise("ASSET_UNSUPPORTED", "Import qilib bo'lmadi: " + p.file + " — " + String(error));
  }
  if (p.folder !== undefined) item.parentFolder = findOrCreateFolder(p.folder);
  stampItem(item, opId);
  return itemResult(opId, "footage", item, false);
}
