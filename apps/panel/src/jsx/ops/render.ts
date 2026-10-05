import type { AeContext, OpResultData, RenderQueueParams } from "@aes/shared/ae";
import { resolveInRoot } from "../lib/paths";
import { requireComp } from "../lib/trace";
import { raise } from "../lib/util";

/**
 * Zaxira render (Q5): aerender topilmasa AE Render Queue orqali (UI render davomida band bo'ladi).
 * Faqat shu element render qilinadi: navbatdagi boshqa elementlar vaqtincha o'chiriladi va keyin tiklanadi.
 * Qo'shilgan navbat elementi render'dan keyin olib tashlanadi; loyiha o'zgarishsiz saqlanadi.
 * Natijaviy fayl (AE kengaytmani o'zi qo'yishi mumkin) — `info.file`.
 */
export function renderQueue(params: RenderQueueParams, opId: string, ctx: AeContext): OpResultData {
  const comp = requireComp(params.comp);
  const outAbs = resolveInRoot(ctx.root, params.out);
  const file = new File(outAbs);
  if (file.exists) raise("AE_BAD_PARAMS", "Fayl mavjud, ustiga yozilmaydi: " + params.out);
  const folder = file.parent;
  if (folder !== null && !folder.exists) folder.create();

  const queue = app.project.renderQueue;
  const item = queue.items.add(comp);
  const paused: RenderQueueItem[] = [];
  for (let i = 1; i <= queue.numItems; i++) {
    const other = queue.item(i);
    if (other !== item && other.render) {
      other.render = false;
      paused.push(other);
    }
  }
  let resultPath: string;
  let status: RQItemStatus;
  try {
    item.outputModule(1).file = file;
    queue.render();
    status = item.status;
    resultPath = item.outputModule(1).file.fsName;
  } finally {
    for (let j = 0; j < paused.length; j++) (paused[j] as RenderQueueItem).render = true;
    item.remove();
  }
  if (status !== RQItemStatus.DONE)
    raise("RENDER_FAILED", "Render Queue holati: " + String(status));
  if (app.project.file !== null) app.project.save(app.project.file);
  return { op_id: opId, reused: false, info: { file: resultPath } };
}
