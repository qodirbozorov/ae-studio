/// <reference path="./svg-to-pdfkit.d.ts" />
/**
 * Lucide ikonkalari (ISC): Iconify JSON (internetsiz) → rang/qalinlik bilan SVG → PDF (AE vektor footage).
 */
import { icons as lucide } from "@iconify-json/lucide";
import { getIconData, iconToHTML, iconToSVG } from "@iconify/utils";
import { ICON_BASE_PT, iconName } from "@aes/shared";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";

/** Ikonka SVG'si (rang va chiziq qalinligi bilan); topilmasa null. */
export function lucideSvg(name: string, color: string, strokeWidth: number): string | null {
  const data = getIconData(lucide, iconName(name));
  if (data === null) return null;
  const svg = iconToSVG(data, { width: ICON_BASE_PT, height: ICON_BASE_PT });
  const body = svg.body
    .replace(/currentColor/g, color)
    .replace(/stroke-width="[\d.]+"/g, `stroke-width="${strokeWidth}"`);
  return iconToHTML(body, svg.attributes);
}

export function lucidePdf(svg: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [ICON_BASE_PT, ICON_BASE_PT], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    SVGtoPDF(doc, svg, 0, 0, { width: ICON_BASE_PT, height: ICON_BASE_PT });
    doc.end();
  });
}

const NAMES = [...Object.keys(lucide.icons), ...Object.keys(lucide.aliases ?? {})].sort();

/** Nom bo'yicha qidiruv: avval boshlanishi mos, keyin ichida uchraydigan. */
export function searchLucide(query: string, limit: number): string[] {
  const words = query
    .toLowerCase()
    .split(/[\s,_-]+/)
    .filter((w) => w !== "");
  if (words.length === 0) return NAMES.slice(0, limit);
  const hits = NAMES.filter((name) => words.every((w) => name.includes(w)));
  const head = words[0]!;
  hits.sort(
    (a, b) => Number(!a.startsWith(head)) - Number(!b.startsWith(head)) || a.length - b.length,
  );
  return hits.slice(0, limit).map((name) => `lucide:${name}`);
}
