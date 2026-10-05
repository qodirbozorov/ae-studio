/**
 * Boshlang'ich shablon kutubxonasi (§11.2, P5.03): repo'dagi `templates/<slug>/template.json` fayllari
 * server bundle'iga kiritiladi (esbuild JSON importi). Hammasi `recipe` — `.aep` kerak emas.
 */
import { parseTemplateManifest } from "@aes/shared";
import type { TemplateManifest } from "@aes/shared";
import hookTitle from "../../../../templates/hook_title/template.json" with { type: "json" };

const RAW: unknown[] = [hookTitle];

function load(): TemplateManifest[] {
  return RAW.map((raw) => {
    const parsed = parseTemplateManifest(raw);
    if (!parsed.ok) throw new Error(`Shablon kutubxonasi: ${parsed.error.message}`);
    return parsed.data;
  });
}

/** Tizim shablonlari (versiya 1, o'zgarmaydi; tahrirlangani `template_save` bilan foydalanuvchiniki bo'ladi). */
export const BUILTIN_TEMPLATES: readonly TemplateManifest[] = load();
