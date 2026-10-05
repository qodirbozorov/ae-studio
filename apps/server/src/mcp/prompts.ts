/**
 * MCP prompts (§8): Claude'dagi tayyor buyruqlar. Faza 3: `/new-reel` (audio'siz; Faza 4 da ovoz, musiqa, subtitr qo'shiladi).
 */
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required?: boolean }[];
  render(args: Record<string, string>): GetPromptResult;
}

const FORMATS: Record<string, { w: number; h: number; label: string }> = {
  "9:16": { w: 1080, h: 1920, label: "vertikal (Reels/TikTok/Shorts)" },
  "1:1": { w: 1080, h: 1080, label: "kvadrat" },
  "16:9": { w: 1920, h: 1080, label: "gorizontal (YouTube)" },
};

function text(value: string): GetPromptResult["messages"][number] {
  return { role: "user", content: { type: "text", text: value } };
}

export function newReelPrompt(args: Record<string, string>): GetPromptResult {
  const brief = (args.brief ?? "").trim();
  const format = FORMATS[args.format ?? "9:16"] ?? FORMATS["9:16"]!;
  const duration = Number(args.duration);
  const target = Number.isFinite(duration) && duration > 0 ? `${duration} s atrofida` : "15–30 s";
  const folder = (args.folder ?? "").trim();
  const steps = [
    `AE Studio orqali After Effects'da yangi qisqa video (reel) tayyorla.`,
    ``,
    `Brief: ${brief === "" ? "(foydalanuvchidan qisqacha so'ra: mavzu, maqsad, auditoriya, uslub)" : brief}`,
    `Format: ${format.w}×${format.h} ${format.label}, 30 fps. Davomiylik: ${target}.`,
    folder === ""
      ? `Ish papkasi: project_list dan tanla yoki foydalanuvchidan mavjud papka yo'lini so'rab project_create.`
      : `Ish papkasi: ${folder} (kerak bo'lsa project_create).`,
    ``,
    `Qadamlar (har birida natijani tekshir, xato bo'lsa error.hint ga amal qil):`,
    `1. env_check — ready bo'lmasa, issues[] dagi hint'larni foydalanuvchiga ayt va to'xta.`,
    `2. Loyiha → assets_scan → assets_list. Asosiy fayllarni asset_preview bilan ko'r (videodan 3–4 kadr). Faqat status=ok fayllardan foydalan.`,
    `3. spec_schema ni o'qi. Sahnalarni rejalashtir: hook (1–3 s, kuchli birinchi kadr) → asosiy fikrlar → CTA. Har sahnada 1 ta asosiy media + qisqa matn (≤ 6–8 so'z), o'qilishi oson joylashuv, mos anim va transition_out.`,
    `4. Rejani foydalanuvchiga 3–6 qatorda ko'rsat (sahnalar, matnlar, qaysi fayl) va tasdiq so'ra. Keyin plan_write.`,
    `5. preflight — missing[] bo'sh va ready=true bo'lguncha tuzat (plan_patch). Keyin build_start.`,
    `6. job_status ni 5–10 s oralig'ida tekshir (VERIFY, BLOCKED yoki DONE gacha). Progressni qisqa ayt.`,
    `7. VERIFY: frames_capture. Kadrlarni brief bilan tanqidiy solishtir: matn sig'adimi va o'qiladimi, kompozitsiya, rang, kesilgan joylar. Muammo bo'lsa verify_patch (aniq sabab bilan, ko'pi bilan 3 marta), keyin yana frames_capture. Yaxshi bo'lsa verify_approve.`,
    `8. Render tugagach report_get: hisobotni va out/ dagi MP4 yo'lini foydalanuvchiga ko'rsat.`,
    ``,
    `Hozircha ovoz, musiqa va subtitr yo'q (keyingi bosqich). Hech narsa o'chirilmaydi: plan va .aep versiyalanadi. Foydalanuvchi bilan uning tilida (odatda o'zbekcha) gaplash.`,
  ];
  return {
    description: "AE Studio: yangi reel (audio'siz)",
    messages: [text(steps.join("\n"))],
  };
}

export const PROMPTS: PromptDef[] = [
  {
    name: "new-reel",
    title: "Yangi reel",
    description:
      "Brief va fayllardan After Effects'da qisqa video: reja → qurish → kadrlarni tekshirish → render → hisobot (hozircha audio'siz).",
    arguments: [
      {
        name: "brief",
        description: "Video nima haqida, kim uchun, qanday uslubda",
        required: true,
      },
      { name: "folder", description: "Ish papkasi (absolyut yo'l), ixtiyoriy" },
      { name: "format", description: "9:16 (default), 1:1 yoki 16:9" },
      { name: "duration", description: "Taxminiy davomiylik, soniya" },
    ],
    render: newReelPrompt,
  },
];
