/**
 * Lucide ikonkalari (spec `icon` qatlami): server SVG → PDF qiladi, panel `icons/` ga yuklaydi, AE vektor
 * footage sifatida import qiladi. Fayl nomi server va kompilyatorda bir xil (rang va qalinlik bilan).
 */

/** PDF sahifasi (pt = AE'da px): qatlam masshtabi `size / ICON_BASE_PT`. */
export const ICON_BASE_PT = 256;

export const ICON_FOLDER = "icons";

/** `lucide:bell` yoki `bell` → `bell`. */
export function iconName(name: string): string {
  return name.replace(/^lucide:/, "");
}

export function iconFile(name: string, color: string, strokeWidth: number): string {
  const hex = color.replace("#", "").toLowerCase();
  return `${ICON_FOLDER}/lucide-${iconName(name)}_${hex}_${Math.round(strokeWidth * 100)}.pdf`;
}
