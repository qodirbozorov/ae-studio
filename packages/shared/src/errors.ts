/**
 * Tasniflangan xato kodlari (ae-studio-plan.md §12).
 *
 * DIQQAT: bu fayl ExtendScript (ES3) bundle'iga ham kiradi. Faqat ES3-xavfsiz kod yoziladi:
 * zod yo'q, ES5+ API yo'q (Object.keys, Array#map, JSON...), lib utility tiplari yo'q.
 */

export const ERROR_DEFS = {
  // ENV_ — muhit holati; sharoit tiklangach qayta urinish mumkin
  ENV_AGENT_OFFLINE: {
    retryable: true,
    hint: "Panel serverga ulanmagan. After Effects'da AE Studio panelini oching; ulanishi bilan job avtomatik davom etadi.",
  },
  ENV_AE_CLOSED: {
    retryable: true,
    hint: "After Effects yopiq yoki javob bermayapti. AE'ni oching va panelni qayta yuklang.",
  },
  ENV_NO_FOLDER: {
    retryable: true,
    hint: "Ish papkasi tanlanmagan. Panelning 'Ish papkasi' ekranida papkani tanlang.",
  },
  ENV_FFMPEG_MISSING: {
    retryable: true,
    hint: "ffmpeg/ffprobe topilmadi. Panel sozlamalarida ffmpeg yo'lini tekshiring.",
  },

  // AUTH_ — avtorizatsiya; qayta urinish yordam bermaydi
  AUTH_INVALID: {
    retryable: false,
    hint: "Token yaroqsiz. Qayta kiring yoki panelni qayta ulang.",
  },
  AUTH_EXPIRED: {
    retryable: false,
    hint: "Sessiya muddati tugagan. Qayta kiring.",
  },
  AUTH_DEVICE_REVOKED: {
    retryable: false,
    hint: "Bu qurilma web kabinetda bekor qilingan. Panelni yangi kod bilan qayta ulang.",
  },

  // SPEC_ — Video Spec xatolari; plan_patch bilan tuzatiladi
  SPEC_INVALID: {
    retryable: false,
    hint: "Spec sxemaga mos emas. details dagi path'larni tuzatib plan_patch qiling.",
  },
  SPEC_UNKNOWN_ASSET: {
    retryable: false,
    hint: "Spec'da noma'lum 'asset:' havolasi bor. assets_list bilan mavjud kalitlarni tekshirib plan_patch qiling.",
  },
  SPEC_UNKNOWN_TEMPLATE: {
    retryable: false,
    hint: "Spec'da noma'lum shablon bor. templates_list bilan tekshirib plan_patch qiling.",
  },

  // ASSET_ — fayllar
  ASSET_MISSING: {
    retryable: false,
    hint: "Fayl topilmadi. Faylni ish papkasiga qo'ying va assets_scan qiling.",
  },
  ASSET_CORRUPT: {
    retryable: true,
    hint: "Fayl buzilgan yoki sha256 mos kelmadi. Qayta yuklab olinadi; takrorlansa manba faylni almashtiring.",
  },
  ASSET_UNSUPPORTED: {
    retryable: false,
    hint: "Fayl formati qo'llanmaydi. Uni boshqa formatga o'tkazing yoki Spec'dan olib tashlang.",
  },
  ASSET_OUTSIDE_ROOT: {
    retryable: false,
    hint: "Fayl yo'li ish papkasidan tashqarida. Faqat ish papkasi ichidagi nisbiy yo'llardan foydalaning.",
  },

  // EL_ — ElevenLabs
  EL_AUTH: {
    retryable: false,
    hint: "ElevenLabs kaliti yaroqsiz. Web kabinetda kalitni yangilang.",
  },
  EL_QUOTA: {
    retryable: false,
    hint: "ElevenLabs kvotasi yetmaydi. Tarifni oshiring yoki vazifalarni qisqartiring (ask_user).",
  },
  EL_RATE_LIMIT: {
    retryable: true,
    hint: "ElevenLabs so'rovlar chegarasi. Biroz kutib qayta urinadi.",
  },
  EL_TIMEOUT: {
    retryable: true,
    hint: "ElevenLabs javob bermadi. Qayta urinadi.",
  },
  EL_BAD_PARAMS: {
    retryable: false,
    hint: "ElevenLabs parametrlari noto'g'ri. details ni tekshirib vazifani tuzating.",
  },

  // AE_ — After Effects / ExtendScript
  AE_SCRIPT_ERROR: {
    retryable: false,
    hint: "ExtendScript xatosi. message va qatorni tekshiring; Spec'ni tuzatib qayta quring.",
  },
  AE_TIMEOUT: {
    retryable: true,
    hint: "AE op vaqtida tugamadi (modal oyna yoki og'ir ish bo'lishi mumkin). AE'ni tekshirib job_resume qiling.",
  },
  AE_FONT_MISSING: {
    retryable: false,
    hint: "Shrift AE'da topilmadi. Shriftni o'rnating yoki brand fallback shriftini ishlating.",
  },
  AE_VERSION: {
    retryable: false,
    hint: "After Effects versiyasi qo'llanmaydi (kamida 22.0 kerak).",
  },
  AE_UNKNOWN_OP: {
    retryable: false,
    hint: "Panel bu opni bilmaydi. Panelni yangilang.",
  },
  AE_BAD_PARAMS: {
    retryable: false,
    hint: "Op parametrlari noto'g'ri. details ni tekshiring.",
  },
  AE_NOT_FOUND: {
    retryable: false,
    hint: "Havola qilingan comp/layer/element AE loyihasida topilmadi. Oldingi op bajarilganini tekshiring.",
  },

  // RENDER_
  RENDER_FAILED: {
    retryable: true,
    hint: "Render muvaffaqiyatsiz. Qayta urinib ko'riladi; takrorlansa render logini tekshiring.",
  },
  RENDER_DURATION_MISMATCH: {
    retryable: true,
    hint: "Render davomiyligi Spec'ga mos emas. Qayta render qilinadi.",
  },

  // LOOP_
  LOOP_PATCH_LIMIT: {
    retryable: false,
    hint: "Patch chegarasi (3) tugadi. Foydalanuvchidan yo'l-yo'riq so'rang (ask_user).",
  },

  // JOB_ — job boshqaruvi
  JOB_ACTIVE: {
    retryable: false,
    hint: "Bu qurilmada boshqa job ishlayapti. U tugashini kuting yoki uni bekor qiling (cancel).",
  },
  JOB_BAD_ACTION: {
    retryable: false,
    hint: "Bu amal job'ning hozirgi holatida mumkin emas. job holatini qayta o'qing.",
  },

  // SYS_ — umumiy server xatolari
  SYS_INTERNAL: {
    retryable: true,
    hint: "Kutilmagan server xatosi. Qayta urinib ko'ring.",
  },
  SYS_BAD_REQUEST: {
    retryable: false,
    hint: "So'rov noto'g'ri. details ni tekshiring.",
  },
  SYS_NOT_FOUND: {
    retryable: false,
    hint: "So'ralgan obyekt topilmadi.",
  },
  SYS_RATE_LIMIT: {
    retryable: true,
    hint: "So'rovlar chegarasi. Biroz kutib qayta urining.",
  },
} as const;

export type ErrorCode = keyof typeof ERROR_DEFS;

/** Barcha xatolarning yagona shakli: `{ code, retryable, hint }` + ixtiyoriy tafsilotlar. */
export interface AesError {
  code: ErrorCode;
  retryable: boolean;
  hint: string;
  /** Aniq nima bo'lgani (masalan, ExtendScript xabari). */
  message?: string;
  /** Mashina o'qiydigan qo'shimcha ma'lumot (masalan, zod path'lari). */
  details?: unknown;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_DEFS, value);
}

export function makeError(code: ErrorCode, message?: string, details?: unknown): AesError {
  // Runtime'da (ExtendScript, tarmoqdan kelgan qiymat) tip kafolati yo'q: noma'lum kod SYS_INTERNAL bo'ladi.
  if (!isErrorCode(code)) {
    return makeError("SYS_INTERNAL", "Noma'lum xato kodi: " + String(code), details);
  }
  const def = ERROR_DEFS[code];
  const error: AesError = { code: code, retryable: def.retryable, hint: def.hint };
  if (message !== undefined) error.message = message;
  if (details !== undefined) error.details = details;
  return error;
}

/** `EL_QUOTA` → `EL`. */
export function errorPrefix(code: ErrorCode): string {
  return code.substring(0, code.indexOf("_"));
}
