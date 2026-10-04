/** Umumiy zod primitivlari va validatsiya natijasini `Result` ga aylantirish. */
import { z } from "zod";
import type { ErrorCode } from "./errors";
import { fail, ok } from "./result";
import type { Result } from "./result";

const uzLocale = z.locales.uz();

export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Slug: kichik lotin harf, raqam, `_`, `-` (sahna id, shablon/brand nomi, asset kaliti). */
export const slugSchema = z.string().regex(SLUG_RE, {
  error: "Slug faqat kichik lotin harf, raqam, '_' va '-' dan iborat bo'lishi kerak (1–64 belgi)",
});

export const ASSET_REF_RE = /^asset:([a-z0-9][a-z0-9_-]{0,63})$/;

/** `asset:<kalit>` — `assets` jadvalidagi kalitga havola. */
export const assetRefSchema = z.string().regex(ASSET_REF_RE, {
  error:
    "Asset havolasi 'asset:<kalit>' ko'rinishida bo'lishi kerak (kalit: kichik harf, raqam, '_', '-')",
});

export function assetKeyOf(ref: string): string | null {
  const match = ASSET_REF_RE.exec(ref);
  return match ? (match[1] ?? null) : null;
}

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, {
  error: "Rang '#RRGGBB' ko'rinishida bo'lishi kerak",
});

/** Til kodi: `uz`, `en`, `ru-RU`. */
export const languageSchema = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, {
  error: "Til kodi 'uz' yoki 'en-US' ko'rinishida bo'lishi kerak",
});

export interface IssueDetail {
  /** JSON Pointer (RFC 6901), masalan `/scenes/1/dur` — `plan_patch` da shu path ishlatiladi. */
  path: string;
  message: string;
  code: string;
}

export function toJsonPointer(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => "/" + String(segment).replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("");
}

export function formatIssues(issues: readonly z.core.$ZodIssue[]): IssueDetail[] {
  return issues.map((issue) => ({
    path: toJsonPointer(issue.path),
    message: issue.message,
    code: issue.code,
  }));
}

/** Sxema bo'yicha tekshiradi; xato bo'lsa `code` bilan, path'lari va o'zbekcha xabarlari bilan qaytaradi. */
export function parseWith<T>(schema: z.ZodType<T>, input: unknown, code: ErrorCode): Result<T> {
  const parsed = schema.safeParse(input, { error: uzLocale.localeError });
  if (parsed.success) return ok(parsed.data);
  const details = formatIssues(parsed.error.issues);
  const preview = details
    .slice(0, 3)
    .map((d) => (d.path || "/") + " — " + d.message)
    .join("; ");
  return fail(code, details.length + " ta xato: " + preview, details);
}
