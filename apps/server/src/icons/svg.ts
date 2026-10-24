// Boshqa loyihalar (web/panel) server fayllarini kompilyatsiya qilganda ham tip e'loni topilsin.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./svg-to-pdfkit.d.ts" />
/**
 * Ikonka → SVG (rang, chiziq qalinligi) → PDF (AE vektor footage). PDF sahifasi `ICON_BASE_PT` pt kvadrat,
 * ikonka unga to'liq va markazda sig'adi (nisbat saqlanadi) — AE'da qatlam masshtabi `size / ICON_BASE_PT`.
 */
import { ICON_BASE_PT } from "@aes/shared";
import type { IconData } from "@aes/shared";
import { iconToHTML, iconToSVG } from "@iconify/utils";
import type { getIconData } from "@iconify/utils";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";

type FullIcon = NonNullable<ReturnType<typeof getIconData>>;

/** Iconify ma'lumoti → `IconData`: flip/rotate `body` ga qo'shiladi, viewBox sonlarga ajratiladi. */
export function normalizeIcon(data: FullIcon): IconData {
  const svg = iconToSVG(data);
  const [left, top, width, height] = svg.attributes.viewBox.split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return { body: svg.body, left, top, width, height };
}

/** Ildiz `<svg>` dagi bolalarga meros bo'ladigan atributlar (qolganlari — o'lcham, nomlar fazosi). */
const ROOT_INHERITED = new Set([
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "opacity",
  "style",
  "class",
  "transform",
  "color",
]);

/**
 * To'liq SVG hujjati (logo fayli) → `IconData`: viewBox (yoki width/height), ichki qism; ildizdagi
 * bo'yoq atributlari `<g>` bilan saqlanadi. Ildiz topilmasa null.
 */
export function svgDocumentToIcon(svg: string): IconData | null {
  const clean = svg
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const open = /<svg\b((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*>/i.exec(clean);
  const close = clean.lastIndexOf("</svg>");
  if (open === null || close < open.index) return null;
  const attrs: Record<string, string> = {};
  for (const a of open[1]!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[a[1]!] = a[2] ?? a[3] ?? "";
  }
  const size = (v: string | undefined) => {
    const n = v === undefined || v.endsWith("%") ? NaN : Number.parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  let box: number[] | null = null;
  if (attrs.viewBox !== undefined) {
    box = attrs.viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (box.length !== 4 || box.some((v) => !Number.isFinite(v)) || box[2]! <= 0 || box[3]! <= 0) {
      box = null;
    }
  }
  if (box === null) {
    const w = size(attrs.width);
    const h = size(attrs.height);
    if (w === null || h === null) return null;
    box = [0, 0, w, h];
  }
  let body = clean.slice(open.index + open[0].length, close).trim();
  const inherited = Object.entries(attrs).filter(([key]) => ROOT_INHERITED.has(key));
  if (inherited.length > 0) {
    const list = inherited.map(([key, value]) => `${key}="${value.replace(/"/g, "&quot;")}"`);
    body = `<g ${list.join(" ")}>${body}</g>`;
  }
  return { body, left: box[0]!, top: box[1]!, width: box[2]!, height: box[3]!, logo: true };
}

/** SVG (rang `currentColor` o'rniga, aniq yozilgan `stroke-width` lar spec qalinligiga — logolarda emas). */
export function iconSvg(icon: IconData, color: string, strokeWidth: number): string {
  let body = icon.body.replace(/currentColor/g, color);
  if (icon.logo !== true) {
    body = body.replace(/stroke-width="[\d.]+"/g, `stroke-width="${strokeWidth}"`);
  }
  return iconToHTML(body, {
    width: String(ICON_BASE_PT),
    height: String(ICON_BASE_PT),
    viewBox: `${icon.left} ${icon.top} ${icon.width} ${icon.height}`,
    preserveAspectRatio: "xMidYMid meet",
  });
}

export function iconPdf(svg: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [ICON_BASE_PT, ICON_BASE_PT], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    // `assumePt`: SVG birligi = pt. Aks holda px → pt (×0.75) bo'lib, ikonka sahifaning chap-yuqori
    // 75% qismiga tushadi va AE'da kichik hamda surilgan chiqadi.
    SVGtoPDF(doc, svg, 0, 0, { width: ICON_BASE_PT, height: ICON_BASE_PT, assumePt: true });
    doc.end();
  });
}
