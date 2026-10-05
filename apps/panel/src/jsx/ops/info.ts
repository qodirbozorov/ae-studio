import type { InfoParams, OpResultData } from "@aes/shared/ae";

const MAX_COMPS = 200;
const MAX_FONTS = 2000;

interface FontLike {
  familyName?: string;
}

/**
 * `ae_info`: AE versiyasi, ochiq loyiha, comp'lar va shrift oilalari.
 * `app.fonts` AE 24.0+ da bor (Q10): eski versiyada `fonts: null` va izoh qaytadi.
 */
export function info(_params: InfoParams, opId: string): OpResultData {
  const project = app.project;
  const comps: {
    id: number;
    name: string;
    w: number;
    h: number;
    fps: number;
    duration: number;
    layers: number;
  }[] = [];
  for (let i = 1; i <= project.numItems && comps.length < MAX_COMPS; i++) {
    const item = project.item(i);
    if (item instanceof CompItem) {
      comps.push({
        id: item.id,
        name: item.name,
        w: item.width,
        h: item.height,
        fps: item.frameRate,
        duration: item.duration,
        layers: item.numLayers,
      });
    }
  }

  let fonts: string[] | null = null;
  let fontsNote: string | null = null;
  const fontsApi = (app as unknown as { fonts?: { allFonts?: FontLike[][] } }).fonts;
  if (fontsApi !== undefined && fontsApi !== null && fontsApi.allFonts !== undefined) {
    fonts = [];
    const groups = fontsApi.allFonts;
    for (let g = 0; g < groups.length && fonts.length < MAX_FONTS; g++) {
      const group = groups[g];
      const first = group === undefined ? undefined : group[0];
      if (first !== undefined && typeof first.familyName === "string") fonts.push(first.familyName);
    }
  } else {
    fontsNote = "Shriftlar ro'yxati AE 24.0+ da mavjud (app.fonts)";
  }

  const file = project.file;
  return {
    op_id: opId,
    reused: false,
    info: {
      ae_version: app.version,
      project_path: file === null ? null : file.fsName,
      dirty: (project as unknown as { dirty?: boolean }).dirty === true,
      comps: comps,
      fonts: fonts,
      fonts_note: fontsNote,
    },
  };
}
