/**
 * Loyiha oplari. "Hech narsa o'chirilmaydi" (§2.10): ochiq loyihada saqlanmagan o'zgarishlar bo'lsa
 * boshqa loyiha ochilmaydi; versiya fayli mavjud bo'lsa ustiga yozilmaydi.
 */
import type {
  AeContext,
  OpResultData,
  ProjectOpenOrCreateParams,
  ProjectSaveParams,
} from "@aes/shared/ae";
import { resolveInRoot } from "../lib/paths";
import { raise } from "../lib/util";

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const slashed = p.replace(/\\/g, "/");
    return $.os.indexOf("Windows") >= 0 ? slashed.toLowerCase() : slashed;
  };
  return norm(a) === norm(b);
}

function currentPath(): string | null {
  const file = app.project.file;
  return file === null ? null : file.fsName;
}

/** `dirty` AE'ning eski versiyalarida bo'lmasligi mumkin: unda elementli loyiha "saqlanmagan" hisoblanadi. */
function hasUnsavedChanges(): boolean {
  const dirty = (app.project as unknown as { dirty?: boolean }).dirty;
  if (dirty === true) return true;
  return dirty === undefined && app.project.numItems > 0;
}

function result(opId: string, path: string, reused: boolean): OpResultData {
  const name = path.substring(path.replace(/\\/g, "/").lastIndexOf("/") + 1);
  return {
    op_id: opId,
    reused: reused,
    target: { kind: "project", name: name },
    info: { path: path },
  };
}

/** `project.open_or_create` — mavjud .aep ni ochadi yoki yangisini yaratib shu yo'lga saqlaydi. */
export function projectOpenOrCreate(
  p: ProjectOpenOrCreateParams,
  opId: string,
  ctx: AeContext,
): OpResultData {
  const path = resolveInRoot(ctx.root, p.path);
  const open = currentPath();
  if (open !== null && samePath(open, path)) return result(opId, path, true);
  if (hasUnsavedChanges()) {
    return raise(
      "AE_BAD_PARAMS",
      "Ochiq loyihada saqlanmagan o'zgarishlar bor — avval saqlang yoki yoping",
    );
  }
  const file = new File(path);
  if (file.exists) {
    app.open(file);
  } else {
    app.newProject();
    app.project.save(file);
  }
  return result(opId, path, false);
}

/** `project.save` — `vNNN` faylga saqlash; boshqa versiya fayli ustiga yozilmaydi. */
export function projectSave(p: ProjectSaveParams, opId: string, ctx: AeContext): OpResultData {
  const path = resolveInRoot(ctx.root, p.path);
  const file = new File(path);
  const open = currentPath();
  const reused = open !== null && samePath(open, path);
  if (file.exists && !reused) {
    return raise("AE_BAD_PARAMS", "Versiya fayli allaqachon mavjud (ustiga yozilmaydi): " + p.path);
  }
  app.project.save(file);
  const data = result(opId, path, reused);
  data.info = { path: path, version: p.version };
  return data;
}
