/** ES3 yordamchilari: ExtendScript'da ES5 API (Array.isArray, String#trim ...) yo'q. */
import type { ErrorCode } from "@aes/shared/errors";

export function isArray(value: unknown): value is unknown[] {
  return Object.prototype.toString.call(value as object) === "[object Array]";
}

/** Op handler'lari tasniflangan xatoni shu bilan tashlaydi; dispatcher uni `{ ok: false }` ga aylantiradi. */
export interface AesThrown {
  aesCode: ErrorCode;
  message: string;
  details?: unknown;
}

export function raise(code: ErrorCode, message: string, details?: unknown): never {
  const thrown: AesThrown = { aesCode: code, message: message };
  if (details !== undefined) thrown.details = details;
  throw thrown;
}

export function isAesThrown(value: unknown): value is AesThrown {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { aesCode?: unknown }).aesCode === "string"
  );
}

/** `#RRGGBB` → AE rangi [r, g, b] (0–1). */
export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (match === null) raise("AE_BAD_PARAMS", "Noto'g'ri rang: " + hex);
  return [
    parseInt(match[1] as string, 16) / 255,
    parseInt(match[2] as string, 16) / 255,
    parseInt(match[3] as string, 16) / 255,
  ];
}
