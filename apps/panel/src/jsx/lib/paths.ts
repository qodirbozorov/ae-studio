/**
 * Fayl yo'llari faqat ish papkasi ichida (§4.4). Panel agent ham tekshiradi; bu — ikkinchi himoya qatlami.
 */
import { raise } from "./util";

/** Nisbiy yo'lni ish papkasiga qo'shadi; absolyut yo'l yoki `..` bo'lsa ASSET_OUTSIDE_ROOT. */
export function resolveInRoot(root: string, rel: string): string {
  if (root === "") raise("ENV_NO_FOLDER", "Ish papkasi berilmagan");
  if (/^([a-zA-Z]:|[\\/]|~)/.test(rel)) raise("ASSET_OUTSIDE_ROOT", "Absolyut yo'l: " + rel);
  const parts = rel.split(/[\\/]+/);
  const clean: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string;
    if (part === "" || part === ".") continue;
    if (part === "..") raise("ASSET_OUTSIDE_ROOT", "Yo'lda '..': " + rel);
    clean.push(part);
  }
  if (clean.length === 0) raise("ASSET_OUTSIDE_ROOT", "Bo'sh yo'l");
  const base = root.replace(/[\\/]+$/, "");
  return base + "/" + clean.join("/");
}
