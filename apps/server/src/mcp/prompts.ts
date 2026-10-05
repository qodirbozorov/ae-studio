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
    `4. Audio (env_check'da elevenlabs.ok bo'lsa): voiceover matnini gaplarga bo'lib yoz va sahnalarni gaplarga bog'la (dur: "vo:0-1", "vo:1-3" — TTS-first timing). Ovoz: el_voices (o'zbekcha uchun model eleven_v4, language "uz"); brend so'zlar uchun el_pronunciation. Musiqa: audio.music (length "match_video", duck_under "voiceover"). Aksentlar: audio.sfx (at: "hook.end"). Subtitr: audio.captions (from "voiceover", style karaoke_bold | bold_pop | minimal).`,
    `5. Rejani foydalanuvchiga 3–6 qatorda ko'rsat (sahnalar, matnlar, ovoz, musiqa) va tasdiq so'ra. Keyin plan_write va el_estimate: ask_user bo'lsa narxni aytib ruxsat so'ra.`,
    `6. preflight — missing[] bo'sh va ready=true bo'lguncha tuzat (plan_patch). Keyin build_start (audio AUDIO bosqichida generatsiya qilinadi, keshdan qayta ishlatiladi).`,
    `7. job_status ni 5–10 s oralig'ida tekshir (VERIFY, BLOCKED yoki DONE gacha). Progressni qisqa ayt.`,
    `8. VERIFY: frames_capture. Kadrlarni brief bilan tanqidiy solishtir: matn sig'adimi va o'qiladimi, kompozitsiya, rang, kesilgan joylar. Muammo bo'lsa verify_patch (aniq sabab bilan, ko'pi bilan 3 marta), keyin yana frames_capture. Yaxshi bo'lsa verify_approve.`,
    `9. Render tugagach report_get: hisobotni va out/ dagi MP4 yo'lini foydalanuvchiga ko'rsat.`,
    ``,
    `ElevenLabs kaliti bo'lmasa audio'siz qur va foydalanuvchiga kabinet → Sozlamalar → ElevenLabs ni eslat. Hech narsa o'chirilmaydi: plan, .aep va audio versiyalanadi. Foydalanuvchi bilan uning tilida (odatda o'zbekcha) gaplash.`,
  ];
  return {
    description: "AE Studio: yangi reel (ovoz, musiqa, subtitr bilan)",
    messages: [text(steps.join("\n"))],
  };
}

export function subtitlePrompt(args: Record<string, string>): GetPromptResult {
  const video = (args.video ?? "").trim();
  const language = (args.language ?? "uz").trim();
  const style = (args.style ?? "karaoke_bold").trim();
  const steps = [
    `Mavjud videoga subtitr qo'sh (AE Studio, ElevenLabs Scribe).`,
    ``,
    `Video: ${video === "" ? "(assets_list dan so'ra/tanla)" : video} · til: ${language} · stil: ${style}.`,
    ``,
    `1. env_check (elevenlabs.ok bo'lishi shart) → loyiha → assets_scan → assets_list.`,
    `2. Ovoz shovqinli bo'lsa avval el_isolate (toza ovoz).`,
    `3. el_stt (language "${language}", diarize kerak bo'lsa) → transcript_get. Matnni o'qib, imlo va nomlarni transcript_edit bilan tuzat (vaqtlar o'zgarmaydi). O'zbekcha transkriptni foydalanuvchiga ko'rsatib tasdiqlat.`,
    `4. Spec: bitta sahna (dur = video davomiyligi), media layer asset:<video> (fit cover), audio.source_audio {asset, transcribe: true, isolate: <2-qadamga qarab>}, audio.captions {from: "source_audio", method: "stt", style: "${style}"}.`,
    `5. plan_write → preflight → build_start → job_status → frames_capture (subtitr o'qiladimi, ekrandan chiqmaydimi) → verify_approve yoki verify_patch → report_get.`,
  ];
  return { description: "AE Studio: videoga subtitr", messages: [text(steps.join("\n"))] };
}

export function dubPrompt(args: Record<string, string>): GetPromptResult {
  const video = (args.video ?? "").trim();
  const target = (args.target_lang ?? "en").trim();
  const steps = [
    `Videoni boshqa tilga dublyaj qil (ElevenLabs Dubbing).`,
    ``,
    `Video: ${video === "" ? "(assets_list dan tanla)" : video} · maqsad tili: ${target}.`,
    ``,
    `1. env_check (elevenlabs.ok) → loyiha → assets_scan → assets_list.`,
    `2. el_estimate items [{kind: "dub", input_seconds: <video davomiyligi>}] — ask_user bo'lsa narxni aytib ruxsat ol.`,
    `3. el_dub (target_lang "${target}", wait_s 0) → audio_tasks_status bilan kuzat (uzun video bir necha daqiqa).`,
    `4. Tayyor dublyaj fayli audio/ papkasida (assets_scan qilsang asset bo'lib chiqadi). Spec: sahna — asl video (ovozsiz), audio.voiceover {kind: "asset", asset: asset:<dublyaj>}; xohlasa subtitr uchun el_stt dublyaj faylidan → audio.captions.`,
    `5. plan_write → preflight → build_start → VERIFY → report_get.`,
  ];
  return { description: "AE Studio: dublyaj", messages: [text(steps.join("\n"))] };
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
  {
    name: "subtitle-video",
    title: "Videoga subtitr",
    description: "Mavjud video: (toza ovoz) → transkript (Scribe) → tahrir → subtitrli video.",
    arguments: [
      { name: "video", description: "Video asset kaliti yoki fayl nomi" },
      { name: "language", description: "Til kodi (default uz)" },
      { name: "style", description: "karaoke_bold (default), bold_pop yoki minimal" },
    ],
    render: subtitlePrompt,
  },
  {
    name: "dub-video",
    title: "Dublyaj",
    description: "Videoni boshqa tilga dublyaj qilish (ElevenLabs Dubbing) va AE'da yig'ish.",
    arguments: [
      { name: "video", description: "Video asset kaliti" },
      { name: "target_lang", description: "Maqsad tili (masalan en, ru)", required: true },
    ],
    render: dubPrompt,
  },
];
