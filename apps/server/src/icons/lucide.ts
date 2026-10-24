/**
 * Lucide ikonkalari (ISC): Iconify JSON serverda (internetsiz) — sukut to'plami (`bell` = `lucide:bell`).
 */
import { icons as lucide } from "@iconify-json/lucide";
import type { IconData } from "@aes/shared";
import { getIconData } from "@iconify/utils";
import { normalizeIcon } from "./svg";

export const LUCIDE_TOTAL = Object.keys(lucide.icons).length;

export function lucideIcon(name: string): IconData | null {
  const data = getIconData(lucide, name);
  return data === null ? null : normalizeIcon(data);
}

const NAMES = [...Object.keys(lucide.icons), ...Object.keys(lucide.aliases ?? {})].sort();

/** Nom bo'yicha qidiruv: avval boshlanishi mos, keyin ichida uchraydigan. */
export function searchLucide(query: string, limit: number): string[] {
  const words = query
    .toLowerCase()
    .split(/[\s,_-]+/)
    .filter((w) => w !== "");
  if (words.length === 0) return NAMES.slice(0, limit).map((name) => `lucide:${name}`);
  const hits = NAMES.filter((name) => words.every((w) => name.includes(w)));
  const head = words[0]!;
  hits.sort(
    (a, b) => Number(!a.startsWith(head)) - Number(!b.startsWith(head)) || a.length - b.length,
  );
  return hits.slice(0, limit).map((name) => `lucide:${name}`);
}
