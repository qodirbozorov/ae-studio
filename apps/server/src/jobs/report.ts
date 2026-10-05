/**
 * REPORT (§3): qurilganlar, yo'llar, tahrir qo'llanmasi, ogohlantirishlar → `report.md`.
 * Sof funksiya: kirish ma'lumotini engine yig'adi.
 */
import type { AesError, JobOutcome, VideoSpec } from "@aes/shared";

export interface ReportInput {
  jobId: string;
  outcome: JobOutcome;
  projectName: string;
  rootPath: string;
  planVersion: number;
  /** Qurilgan `.aep` (ish papkasiga nisbiy); build bo'lmagan bo'lsa `null`. */
  aepPath: string | null;
  mainComp: string | null;
  spec: VideoSpec | null;
  ops: { total: number; done: number; failed: number };
  /** Muvaffaqiyatli renderlar (ish papkasiga nisbiy yo'l). */
  renders: { path: string; duration_s: number; size_bytes: number; preset: string }[];
  patchCount: number;
  warnings: string[];
  error: AesError | null;
  /** ISO vaqt. */
  finishedAt: string;
}

const OUTCOME_TITLE: Record<JobOutcome, string> = {
  success: "✅ Tayyor",
  cancelled: "⏹ Bekor qilindi",
  failed: "❌ Xato bilan tugadi",
};

export function buildReport(input: ReportInput): string {
  const lines: string[] = [];
  lines.push(`# ${OUTCOME_TITLE[input.outcome]} — ${input.projectName}`, "");
  lines.push(`- Job: \`${input.jobId}\``);
  lines.push(`- Plan: v${input.planVersion} (\`.aestudio/plan.v${pad3(input.planVersion)}.json\`)`);
  lines.push(`- Ish papkasi: \`${input.rootPath}\``);
  if (input.aepPath !== null) lines.push(`- AE loyiha: \`${input.aepPath}\``);
  for (const render of input.renders) {
    lines.push(
      `- Video: \`${render.path}\` (${render.duration_s.toFixed(2)} s, ${(render.size_bytes / 1048576).toFixed(1)} MB, ${render.preset})`,
    );
  }
  lines.push(`- Oplar: ${input.ops.done}/${input.ops.total} bajarildi`);
  if (input.ops.failed > 0) lines.push(`- Xato bergan oplar: ${input.ops.failed}`);
  if (input.patchCount > 0) lines.push(`- Patch'lar: ${input.patchCount}`);
  lines.push(`- Tugadi: ${input.finishedAt}`, "");

  const spec = input.spec;
  if (spec !== null) {
    lines.push("## Qurilganlar", "");
    lines.push(
      `Format ${spec.format.w}×${spec.format.h}, ${spec.format.fps} fps. ` +
        `Asosiy comp: \`${input.mainComp ?? spec.output.name}\`.`,
      "",
    );
    lines.push("| # | Sahna | Comp | Layerlar | O'tish |", "|---|---|---|---|---|");
    spec.scenes.forEach((scene, index) => {
      const comp = `${pad2(index + 1)}_${scene.id}`;
      const transition = scene.transition_out ?? "none";
      lines.push(
        `| ${index + 1} | ${scene.id} | \`${comp}\` | ${scene.layers?.length ?? 0} | ${transition} |`,
      );
    });
    lines.push("");
  }

  if (input.aepPath !== null) {
    lines.push("## Tahrir qo'llanmasi", "");
    lines.push(
      `1. After Effects'da \`${input.aepPath}\` ni oching.`,
      "2. Har sahna `Scenes` papkasidagi alohida comp (`NN_<sahna>`): matn va joylashuvni o'sha comp ichida o'zgartiring.",
      `3. Sahnalar tartibi va o'tishlar asosiy comp'da (\`${input.mainComp ?? "aes.main"}\`).`,
      "4. Manba fayllar `Source` papkasida; asl fayllar ish papkasidagi `source/` da qoladi.",
      "5. Qayta qurish yangi versiya faylini yaratadi: bu fayl ustiga yozilmaydi.",
      "",
    );
  }

  if (input.warnings.length > 0 || input.error !== null) {
    lines.push("## Ogohlantirishlar", "");
    for (const warning of input.warnings) lines.push(`- ${warning}`);
    if (input.error !== null) {
      lines.push(
        `- Oxirgi xato: \`${input.error.code}\`${input.error.message === undefined ? "" : ` — ${input.error.message}`}`,
        `  - ${input.error.hint}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
