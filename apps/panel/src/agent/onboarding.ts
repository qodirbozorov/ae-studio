/**
 * Birinchi ishga tushirish ustasi (P5.11): ulanish → ish papkasi → muhit tekshiruvi → tayyor.
 * Holat sof funksiya bilan hisoblanadi (UI faqat ko'rsatadi); "tayyor" sozlamalarda saqlanadi.
 */
export type OnboardingStep = "connect" | "folder" | "env" | "done";

export interface OnboardingState {
  /** Qurilma hisobi saqlangan (device flow o'tilgan). */
  paired: boolean;
  /** Ish papkasi tanlangan va loyiha ro'yxatdan o'tgan. */
  project: boolean;
  /** Foydalanuvchi muhit tekshiruvini ko'rib "Tayyor" bosgan. */
  onboarded: boolean;
}

export function onboardingStep(state: OnboardingState): OnboardingStep {
  if (!state.paired) return "connect";
  if (!state.project) return "folder";
  if (!state.onboarded) return "env";
  return "done";
}

export const ONBOARDING_STEPS: { step: Exclude<OnboardingStep, "done">; title: string }[] = [
  { step: "connect", title: "Serverga ulanish" },
  { step: "folder", title: "Ish papkasi" },
  { step: "env", title: "Muhit tekshiruvi" },
];

export type FfmpegSource = "settings" | "bundled" | "path";

export interface EnvironmentReport {
  ffmpeg: boolean;
  ffmpeg_source: FfmpegSource;
  /** aerender topildimi (render uchun; yo'q bo'lsa Render Queue zaxira). */
  aerender: boolean;
  aerender_path: string | null;
  node: string;
}

export interface EnvironmentItem {
  ok: boolean;
  label: string;
  hint?: string;
}

/** Muhit hisobotini foydalanuvchiga tushunarli qatorlarga aylantiradi. */
export function environmentItems(report: EnvironmentReport): EnvironmentItem[] {
  const source: Record<FfmpegSource, string> = {
    settings: "sozlamadagi papka",
    bundled: "panel ichida",
    path: "tizim PATH",
  };
  return [
    report.ffmpeg
      ? { ok: true, label: `ffmpeg/ffprobe (${source[report.ffmpeg_source]})` }
      : {
          ok: false,
          label: "ffmpeg/ffprobe topilmadi",
          hint: "Panelni ZXP'dan qayta o'rnating yoki Sozlamalarda ffmpeg papkasini ko'rsating",
        },
    report.aerender
      ? { ok: true, label: `aerender: ${report.aerender_path ?? "topildi"}` }
      : {
          ok: false,
          label: "aerender topilmadi",
          hint: "Render AE Render Queue orqali bo'ladi (sekinroq); Sozlamalarda aerender yo'lini bering",
        },
    { ok: true, label: `Node ${report.node}` },
  ];
}
