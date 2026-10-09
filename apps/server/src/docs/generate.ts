/**
 * Hujjat generatori (P5.12): MCP tool ma'lumotnomasi (zod sxemalaridan) va xato kodlari jadvali (`ERROR_DEFS`).
 * `pnpm gen:docs` → `docs/mcp-tools.md`, `docs/errors.md`. Test hujjatlar kod bilan mosligini tekshiradi.
 */
import { ERROR_DEFS } from "@aes/shared";
import { z } from "zod";
import { PROMPTS } from "../mcp/prompts";
import { TOOLS } from "../mcp/tools";

type JsonSchema = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  default?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  pattern?: string;
};

const GROUPS: [RegExp, string][] = [
  [/^(env_check|devices_list|ae_info)$/, "Muhit"],
  [/^(project_|plan_|spec_)/, "Loyiha va plan"],
  [/^assets?_/, "Fayllar"],
  [/^(el_|audio_|transcript_)/, "Audio (ElevenLabs)"],
  [/^(preflight|build_start|job_)/, "Qurish"],
  [/^(frames_|verify_|contact_sheet)/, "Tekshirish"],
  [/^render_/, "Render"],
  [/^templates?_/, "Shablonlar"],
  [/^brands?_/, "Brand kit"],
  [/^batch_/, "Batch"],
  [/^report_/, "Hisobot"],
];

function groupOf(name: string): string {
  return GROUPS.find(([re]) => re.test(name))?.[1] ?? "Boshqa";
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function typeOf(schema: JsonSchema): string {
  if (schema.const !== undefined) return `\`${JSON.stringify(schema.const)}\``;
  if (schema.enum !== undefined) return schema.enum.map((v) => `\`${String(v)}\``).join(" \\| ");
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants !== undefined) {
    return [...new Set(variants.filter((v) => v.type !== "null").map(typeOf))].join(" \\| ");
  }
  if (schema.type === "array")
    return `${schema.items === undefined ? "any" : typeOf(schema.items)}[]`;
  if (schema.type === "object") return "object";
  if (schema.format === "uuid") return "uuid";
  if (Array.isArray(schema.type)) return schema.type.join(" \\| ");
  return schema.type ?? "any";
}

function limits(schema: JsonSchema): string {
  const parts: string[] = [];
  if (schema.default !== undefined) parts.push(`default \`${JSON.stringify(schema.default)}\``);
  if (schema.minimum !== undefined) parts.push(`≥ ${schema.minimum}`);
  if (schema.maximum !== undefined) parts.push(`≤ ${schema.maximum}`);
  if (schema.maxLength !== undefined) parts.push(`≤ ${schema.maxLength} belgi`);
  return parts.join(", ");
}

export function toolsMarkdown(): string {
  const lines = [
    "# MCP toollar ma'lumotnomasi",
    "",
    "> Avtomatik generatsiya qilingan (`pnpm gen:docs`, manba: `apps/server/src/mcp/tools`). Qo'lda tahrirlamang.",
    "",
    "Javob formati: `{ ok: true, data } | { ok: false, error: { code, retryable, hint, message?, details? } }`.",
    "Xato kodlari: [errors.md](errors.md).",
    "",
    `Jami: **${TOOLS.length}** tool, **${PROMPTS.length}** prompt.`,
    "",
  ];
  const groups = new Map<string, (typeof TOOLS)[number][]>();
  for (const tool of TOOLS) {
    const group = groupOf(tool.name);
    groups.set(group, [...(groups.get(group) ?? []), tool]);
  }
  const order = [...GROUPS.map(([, g]) => g), "Boshqa"];
  for (const group of order) {
    const tools = groups.get(group);
    if (tools === undefined) continue;
    lines.push(`## ${group}`, "");
    for (const tool of tools) {
      const schema = z.toJSONSchema(tool.input, {
        io: "input",
        unrepresentable: "any",
      }) as JsonSchema;
      const readOnly = tool.annotations?.readOnlyHint === true ? " · faqat o'qish" : "";
      lines.push(`### \`${tool.name}\` — ${tool.title}${readOnly}`, "", tool.description, "");
      const props = Object.entries(schema.properties ?? {});
      if (props.length === 0) {
        lines.push("Parametrsiz.", "");
        continue;
      }
      const required = new Set(schema.required ?? []);
      lines.push("| Parametr | Turi | Majburiy | Izoh |", "|---|---|---|---|");
      for (const [name, prop] of props) {
        const note = [prop.description ?? "", limits(prop)].filter((x) => x !== "").join(" · ");
        lines.push(
          `| \`${name}\` | ${cell(typeOf(prop))} | ${required.has(name) && prop.default === undefined ? "ha" : ""} | ${cell(note)} |`,
        );
      }
      lines.push("");
    }
  }
  lines.push("## Promptlar", "");
  for (const prompt of PROMPTS) {
    const args = prompt.arguments
      .map((a) => `\`${a.name}\`${a.required === true ? " (majburiy)" : ""} — ${a.description}`)
      .join("; ");
    lines.push(
      `- **/${prompt.name}** — ${prompt.description}${args === "" ? "" : ` Argumentlar: ${args}.`}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

const PREFIXES: [string, string][] = [
  ["ENV_", "Muhit (panel, AE, papka, ffmpeg)"],
  ["AUTH_", "Avtorizatsiya"],
  ["SPEC_", "Spec (reja)"],
  ["ASSET_", "Fayllar"],
  ["AE_", "After Effects"],
  ["EL_", "ElevenLabs"],
  ["RENDER_", "Render"],
  ["JOB_", "Job boshqaruvi"],
  ["LOOP_", "VERIFY sikli"],
  ["FRAME_", "Kadrlar (VERIFY)"],
  ["FX_", "Effektlar"],
  ["JSX_", "ExtendScript skriptlar"],
  ["SYS_", "Tizim"],
];

export function errorsMarkdown(): string {
  const lines = [
    "# Xato kodlari va yechimlari",
    "",
    "> Avtomatik generatsiya qilingan (`pnpm gen:docs`, manba: `packages/shared/src/errors.ts`). Qo'lda tahrirlamang.",
    "",
    "Har xato: `code`, `retryable` (sabab tuzatilmasa ham qayta urinish yordam beradimi), `hint` (nima qilish kerak),",
    "ixtiyoriy `message` va `details`. Job BLOCKED bo'lsa sabab tuzatilgach `job_resume` (panelda — Davom ettirish).",
    "",
  ];
  const defs = ERROR_DEFS as Record<string, { retryable: boolean; hint: string }>;
  const codes = Object.keys(defs);
  for (const [prefix, title] of PREFIXES) {
    const group = codes.filter((code) => code.startsWith(prefix));
    if (group.length === 0) continue;
    lines.push(`## ${title}`, "", "| Kod | Qayta urinish | Nima qilish kerak |", "|---|---|---|");
    for (const code of group) {
      const def = defs[code]!;
      lines.push(`| \`${code}\` | ${def.retryable ? "ha" : "yo'q"} | ${cell(def.hint)} |`);
    }
    lines.push("");
  }
  const other = codes.filter((code) => !PREFIXES.some(([p]) => code.startsWith(p)));
  if (other.length > 0) {
    lines.push("## Boshqa", "", "| Kod | Qayta urinish | Nima qilish kerak |", "|---|---|---|");
    for (const code of other) {
      lines.push(
        `| \`${code}\` | ${defs[code]!.retryable ? "ha" : "yo'q"} | ${cell(defs[code]!.hint)} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
