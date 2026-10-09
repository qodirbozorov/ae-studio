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

function pad3(n: number): string {
  const s = String(n);
  return s.length >= 3 ? s : s.length === 2 ? "0" + s : "00" + s;
}

/**
 * #5: saqlanmagan o'zgarishlarni yo'qotmaslik — joriy loyiha `<nom>_autosave_vNNN.aep` sifatida saqlanadi
 * (nomsiz loyiha — `<ish papkasi>/.aestudio/autosave/`). Mavjud fayl ustiga yozilmaydi.
 */
function autosave(root: string): string {
  const open = app.project.file;
  let dir: string;
  let base: string;
  if (open !== null) {
    const full = open.fsName.replace(/\\/g, "/");
    const slash = full.lastIndexOf("/");
    dir = full.substring(0, slash);
    base = full.substring(slash + 1).replace(/\.aep$/i, "");
  } else {
    dir = root.replace(/[\\\x2f]+$/, "") + "/.aestudio/autosave";
    base = "untitled";
  }
  const folder = new Folder(dir);
  if (!folder.exists) folder.create();
  let n = 1;
  let target = new File(dir + "/" + base + "_autosave_v" + pad3(n) + ".aep");
  while (target.exists && n < 999) {
    n++;
    target = new File(dir + "/" + base + "_autosave_v" + pad3(n) + ".aep");
  }
  app.project.save(target);
  return target.fsName;
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
  let autosaved: string | null = null;
  if (hasUnsavedChanges()) {
    if (p.dirty === "fail") {
      return raise(
        "AE_PROJECT_DIRTY",
        "Ochiq loyihada saqlanmagan o'zgarishlar bor — avval saqlang yoki yoping",
      );
    }
    autosaved = autosave(ctx.root);
  }
  const file = new File(path);
  if (file.exists) {
    app.open(file);
  } else {
    app.newProject();
    app.project.save(file);
  }
  const data = result(opId, path, false);
  if (autosaved !== null) data.info = { path: path, autosaved: autosaved };
  return data;
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
