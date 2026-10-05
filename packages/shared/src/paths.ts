/**
 * Path traversal himoyasi (§4.4): fayl yo'llari faqat ish papkasi ichida.
 * Panel agent ham, server ham ishlatadi. `node:path` siz (brauzer/Node/OS'dan mustaqil, `/` va `\\` ikkalasi).
 */
import { fail, ok } from "./result";
import type { Result } from "./result";

const ABSOLUTE_RE = /^([a-zA-Z]:|[\\/]|~)/;

/** Nisbiy yo'lni tozalaydi: `a\\b/./c` → `a/b/c`. Absolyut, `..` yoki bo'sh bo'lsa xato. */
export function normalizeRelPath(rel: string): Result<string> {
  if (ABSOLUTE_RE.test(rel)) return fail("ASSET_OUTSIDE_ROOT", "Absolyut yo'l: " + rel);
  const parts: string[] = [];
  for (const part of rel.split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") return fail("ASSET_OUTSIDE_ROOT", "Yo'lda '..': " + rel);
    // eslint-disable-next-line no-control-regex -- boshqaruv belgilarini ataylab rad etamiz
    if (/[\u0000-\u001f]/.test(part)) return fail("ASSET_OUTSIDE_ROOT", "Yo'lda boshqaruv belgisi");
    parts.push(part);
  }
  if (parts.length === 0) return fail("ASSET_OUTSIDE_ROOT", "Bo'sh yo'l");
  return ok(parts.join("/"));
}

/** Ish papkasi + nisbiy yo'l → absolyut yo'l (`/` ajratgich bilan). */
export function resolveInsideRoot(root: string, rel: string): Result<string> {
  if (root.trim() === "") return fail("ENV_NO_FOLDER", "Ish papkasi tanlanmagan");
  const normalized = normalizeRelPath(rel);
  if (!normalized.ok) return normalized;
  return ok(root.replace(/\\/g, "/").replace(/\/+$/, "") + "/" + normalized.data);
}
