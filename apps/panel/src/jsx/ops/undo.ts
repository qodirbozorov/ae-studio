import type { OpResultData, UndoParams } from "@aes/shared/ae";
import { raise } from "../lib/util";

/**
 * Live ekranidagi "Undo last": har op `aes:<op_id>` nomli undo group'da bajariladi.
 * AE Edit menyusidagi joriy band `Undo aes:<op_id>` bo'lsagina bekor qilinadi — orada foydalanuvchi
 * qo'lda biror narsa qilgan bo'lsa, boshqa amal tasodifan bekor qilinmaydi.
 */
export function undo(params: UndoParams, opId: string): OpResultData {
  const command = app.findMenuCommandId("Undo aes:" + params.op_id);
  if (!command) {
    return raise("AE_NOT_FOUND", "AE'dagi oxirgi amal " + params.op_id + " emas");
  }
  app.executeCommand(command);
  return { op_id: opId, reused: false, info: { undone: params.op_id } };
}
