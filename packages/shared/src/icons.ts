/**
 * Ikonkalar (spec `icon` qatlami): Lucide (serverda, internetsiz), istalgan Iconify to'plami
 * (`mdi:bell`, `simple-icons:youtube` …) yoki WorldVectorLogo logolari (`wvl:<slug>`). Server ikonka ma'lumotini topadi; oddiy holatda SVG → PDF qilib
 * panelga yuboradi (AE vektor footage), `as_shapes` da kompilyator geometriyadan native shape qatlam quradi.
 * Fayl nomi server va kompilyatorda bir xil (to'plam, rang va qalinlik bilan).
 */

/** PDF sahifasi (pt = AE'da px): qatlam masshtabi `size / ICON_BASE_PT`. */
export const ICON_BASE_PT = 256;

export const ICON_FOLDER = "icons";

/** PDF geometriyasi versiyasi: v2 — ikonka sahifani to'liq va markazda egallaydi (eski fayllar qayta ishlatilmaydi). */
export const ICON_FILE_VERSION = 2;

export const DEFAULT_ICON_SET = "lucide";

/** Iconify ikonka ma'lumoti (`getIconData` natijasi): `body` — SVG ichki qismi, viewBox `left top width height`. */
export interface IconData {
  body: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Logo (WorldVectorLogo): chiziq qalinligi va ranglar asl holicha (`stroke_width` ta'sir qilmaydi). */
  logo?: boolean;
}

/** `lucide:bell`, `mdi:bell` yoki `bell` (→ lucide) → to'plam va nom. */
export function iconRef(name: string): { prefix: string; name: string } {
  const i = name.indexOf(":");
  return i === -1
    ? { prefix: DEFAULT_ICON_SET, name }
    : { prefix: name.slice(0, i), name: name.slice(i + 1) };
}

/** Kanonik to'liq nom: `bell` → `lucide:bell`. */
export function iconKey(name: string): string {
  const ref = iconRef(name);
  return `${ref.prefix}:${ref.name}`;
}

/** `lucide:bell` yoki `bell` → `bell`. */
export function iconName(name: string): string {
  return iconRef(name).name;
}

export function iconFile(name: string, color: string, strokeWidth: number): string {
  const ref = iconRef(name);
  const hex = color.replace("#", "").toLowerCase();
  return `${ICON_FOLDER}/${ref.prefix}-${ref.name}_${hex}_${Math.round(strokeWidth * 100)}_v${ICON_FILE_VERSION}.pdf`;
}
