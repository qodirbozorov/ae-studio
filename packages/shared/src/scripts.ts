/**
 * Skript op'lari (gibrid usul): spec qila olmaydigan qisqa ishlar (preset, text animator, expression,
 * kutubxona snippetlari, istisno holatda xom kod). Xom kod uchun xavfli chaqiruvlar rad etiladi.
 */
import { z } from "zod";
import { slugSchema } from "./common";

/** Xom kod chegarasi (bayt). */
export const SCRIPT_MAX_BYTES = 50_000;

const DANGER: [RegExp, string][] = [
  [/system\s*\.\s*callSystem/, "system.callSystem"],
  [/\.\s*execute\s*\(/, "File.execute"],
  [/\$\s*\.\s*evalFile/, "$.evalFile"],
  [/\bSocket\b/, "Socket"],
  [/app\s*\.\s*(quit|exitAfterLaunchAndEval)\s*\(/, "app.quit"],
  [/app\s*\.\s*project\s*\.\s*close\s*\(/, "app.project.close"],
];

/** Xavfli chaqiruv nomi yoki null. AE elementlarini o'chirish (`layer.remove()`) ruxsat. */
export function scriptDanger(code: string): string | null {
  for (const [re, name] of DANGER) if (re.test(code)) return name;
  // Fayl yoki papka o'chirish/qayta nomlash: File/Folder bilan birga kelgan .remove()/.rename().
  if (/\b(File|Folder)\b/.test(code) && /\.\s*(remove|rename)\s*\(/.test(code)) {
    return "File/Folder .remove/.rename";
  }
  return null;
}

export const SCRIPT_HOOK_RE =
  /^(after_layer:[a-z0-9][a-z0-9_-]{0,63}|after_scene:[a-z0-9][a-z0-9_-]{0,63}|after_build)$/;

export const scriptSchema = z
  .strictObject({
    id: slugSchema,
    lib: slugSchema.optional().describe("Library snippet name (scripts_lib_list)"),
    code: z
      .string()
      .min(1)
      .max(SCRIPT_MAX_BYTES)
      .optional()
      .describe("Raw ExtendScript (ES3) — exceptional cases only; the panel may ask the user"),
    hook: z
      .string()
      .regex(SCRIPT_HOOK_RE)
      .default("after_build")
      .describe("after_layer:<layer id> | after_scene:<scene id> | after_build"),
    args: z.record(z.string().min(1).max(64), z.unknown()).optional(),
  })
  .describe(
    "Script op run inside the build (AES helpers available). Results go to the job log; a failing script does not stop the job.",
  );

export type ScriptSpec = z.output<typeof scriptSchema>;
