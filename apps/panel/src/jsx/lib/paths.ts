/**
 * Fayl yo'llari faqat ish papkasi ichida (§4.4). Panel agent ham tekshiradi; bu — ikkinchi himoya qatlami.
 */
import { raise } from "./util";

/** Nisbiy yo'lni ish papkasiga qo'shadi; absolyut yo'l yoki `..` bo'lsa ASSET_OUTSIDE_ROOT. */
export function resolveInRoot(root: string, rel: string): string {
  if (root === "") raise("ENV_NO_FOLDER", "Ish papkasi berilmagan");
  // ES3 (ExtendScript): regex ichida `/` hatto [...] da ham literalni tugatadi — `\x2f` ishlatiladi.
  if (/^([a-zA-Z]:|[\\\x2f]|~)/.test(rel)) raise("ASSET_OUTSIDE_ROOT", "Absolyut yo'l: " + rel);
  const parts = rel.split(/[\\\x2f]+/);
  const clean: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string;
    if (part === "" || part === ".") continue;
    if (part === "..") raise("ASSET_OUTSIDE_ROOT", "Yo'lda '..': " + rel);
    clean.push(part);
  }
  if (clean.length === 0) raise("ASSET_OUTSIDE_ROOT", "Bo'sh yo'l");
  const base = root.replace(/[\\\x2f]+$/, "");
  return base + "/" + clean.join("/");
}
