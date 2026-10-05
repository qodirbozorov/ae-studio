/** Audio natijalar va kirishlar uchun umumiy turlar. */

export interface AudioResult {
  audio: Buffer;
  contentType: string;
  ext: "mp3" | "wav" | "ogg" | "m4a" | "bin";
  /** Imkoniyatga xos qo'shimcha (alignment, dubbing_id ...). */
  data?: Record<string, unknown>;
}

export interface InputFile {
  data: Buffer;
  filename: string;
  contentType: string;
}

/** Fayl turi baytlardan (EL odatda mp3 qaytaradi; testlar va pcm formatlar WAV). */
export function sniffAudio(data: Buffer): Pick<AudioResult, "contentType" | "ext"> {
  const tag = (from: number, to: number) => data.subarray(from, to).toString("latin1");
  if (tag(0, 4) === "RIFF") return { contentType: "audio/wav", ext: "wav" };
  if (tag(0, 4) === "OggS") return { contentType: "audio/ogg", ext: "ogg" };
  if (tag(4, 8) === "ftyp") return { contentType: "audio/mp4", ext: "m4a" };
  const first = data[0] ?? 0;
  const second = data[1] ?? 0;
  if (tag(0, 3) === "ID3" || (first === 0xff && (second & 0xe0) === 0xe0)) {
    return { contentType: "audio/mpeg", ext: "mp3" };
  }
  return { contentType: "application/octet-stream", ext: "bin" };
}

export function audioResult(data: Buffer, extra?: Record<string, unknown>): AudioResult {
  return { audio: data, ...sniffAudio(data), ...(extra === undefined ? {} : { data: extra }) };
}

export function formWith(
  fields: Record<string, string | number | boolean | undefined>,
  files: [string, InputFile][],
): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) form.append(name, String(value));
  }
  for (const [name, file] of files) {
    form.append(
      name,
      new Blob([new Uint8Array(file.data)], { type: file.contentType }),
      file.filename,
    );
  }
  return form;
}

export const DEFAULT_OUTPUT = "mp3_44100_128";
