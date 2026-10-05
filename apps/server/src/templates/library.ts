/**
 * Boshlang'ich shablon kutubxonasi (§11.2, P5.03): repo'dagi `templates/<slug>/template.json` fayllari
 * server bundle'iga kiritiladi (esbuild JSON importi). Hammasi `recipe` — `.aep` kerak emas.
 */
import { parseTemplateManifest } from "@aes/shared";
import type { TemplateManifest } from "@aes/shared";
import ctaOutro from "../../../../templates/cta_outro/template.json" with { type: "json" };
import hookTitle from "../../../../templates/hook_title/template.json" with { type: "json" };
import lowerThird from "../../../../templates/lower_third/template.json" with { type: "json" };
import productShowcase from "../../../../templates/product_showcase/template.json" with { type: "json" };
import testimonial from "../../../../templates/testimonial/template.json" with { type: "json" };
import top3List from "../../../../templates/top3_list/template.json" with { type: "json" };

const RAW: unknown[] = [hookTitle, lowerThird, ctaOutro, productShowcase, testimonial, top3List];

function load(): TemplateManifest[] {
  return RAW.map((raw) => {
    const parsed = parseTemplateManifest(raw);
    if (!parsed.ok) throw new Error(`Shablon kutubxonasi: ${parsed.error.message}`);
    return parsed.data;
  });
}

/** Tizim shablonlari (versiya 1, o'zgarmaydi; tahrirlangani `template_save` bilan foydalanuvchiniki bo'ladi). */
export const BUILTIN_TEMPLATES: readonly TemplateManifest[] = load();
