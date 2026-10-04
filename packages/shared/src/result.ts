/**
 * Yagona javob formati (ae-studio-plan.md §8): `{ ok: true, data } | { ok: false, error }`.
 * ES3-xavfsiz: ExtendScript bundle'iga ham kiradi.
 */
import { makeError } from "./errors";
import type { AesError, ErrorCode } from "./errors";

export type Ok<T> = { ok: true; data: T };
export type Fail = { ok: false; error: AesError };
export type Result<T> = Ok<T> | Fail;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data: data };
}

export function fail(code: ErrorCode, message?: string, details?: unknown): Fail {
  return { ok: false, error: makeError(code, message, details) };
}

export function failWith(error: AesError): Fail {
  return { ok: false, error: error };
}
