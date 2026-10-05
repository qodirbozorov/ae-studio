/**
 * JSON Patch (RFC 6902) — `plan_patch` uchun. JSON Pointer (RFC 6901): `~1` → `/`, `~0` → `~`.
 * Asl hujjat o'zgarmaydi (chuqur nusxa ustida ishlanadi).
 */
import { fail, ok } from "@aes/shared";
import type { Result } from "@aes/shared";
import { z } from "zod";

export const jsonPatchSchema = z
  .array(
    z.discriminatedUnion("op", [
      z.strictObject({ op: z.literal("add"), path: z.string(), value: z.unknown() }),
      z.strictObject({ op: z.literal("remove"), path: z.string() }),
      z.strictObject({ op: z.literal("replace"), path: z.string(), value: z.unknown() }),
      z.strictObject({ op: z.literal("move"), from: z.string(), path: z.string() }),
      z.strictObject({ op: z.literal("copy"), from: z.string(), path: z.string() }),
      z.strictObject({ op: z.literal("test"), path: z.string(), value: z.unknown() }),
    ]),
  )
  .min(1)
  .max(200);

export type JsonPatch = z.output<typeof jsonPatchSchema>;

type Container = Record<string, unknown> | unknown[];

class PatchError extends Error {}

function tokens(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/"))
    throw new PatchError(`JSON Pointer '/' bilan boshlanishi kerak: ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function isContainer(value: unknown): value is Container {
  return typeof value === "object" && value !== null;
}

function arrayIndex(array: unknown[], token: string, forAdd: boolean): number {
  if (forAdd && token === "-") return array.length;
  if (!/^(0|[1-9]\d*)$/.test(token)) throw new PatchError(`Massiv indeksi noto'g'ri: ${token}`);
  const index = Number(token);
  const max = forAdd ? array.length : array.length - 1;
  if (index > max) throw new PatchError(`Indeks chegaradan tashqarida: ${token}`);
  return index;
}

/** Ota konteyner va oxirgi token. */
function parentOf(root: unknown, pointer: string): { parent: Container; key: string } {
  const parts = tokens(pointer);
  if (parts.length === 0) throw new PatchError("Ildizni almashtirib bo'lmaydi");
  let current: unknown = root;
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(current)) current = current[arrayIndex(current, part, false)];
    else if (isContainer(current) && Object.prototype.hasOwnProperty.call(current, part)) {
      current = (current as Record<string, unknown>)[part];
    } else throw new PatchError(`Yo'l topilmadi: ${pointer}`);
  }
  if (!isContainer(current)) throw new PatchError(`Yo'l topilmadi: ${pointer}`);
  return { parent: current, key: parts[parts.length - 1]! };
}

function get(root: unknown, pointer: string): unknown {
  let current: unknown = root;
  for (const part of tokens(pointer)) {
    if (Array.isArray(current)) current = current[arrayIndex(current, part, false)];
    else if (isContainer(current) && Object.prototype.hasOwnProperty.call(current, part)) {
      current = (current as Record<string, unknown>)[part];
    } else throw new PatchError(`Yo'l topilmadi: ${pointer}`);
  }
  return current;
}

function add(root: unknown, pointer: string, value: unknown): void {
  const { parent, key } = parentOf(root, pointer);
  if (Array.isArray(parent)) parent.splice(arrayIndex(parent, key, true), 0, value);
  else parent[key] = value;
}

function remove(root: unknown, pointer: string): unknown {
  const { parent, key } = parentOf(root, pointer);
  if (Array.isArray(parent)) return parent.splice(arrayIndex(parent, key, false), 1)[0];
  if (!Object.prototype.hasOwnProperty.call(parent, key))
    throw new PatchError(`Yo'l topilmadi: ${pointer}`);
  const old = parent[key];
  delete parent[key];
  return old;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Patch'ni qo'llaydi; xato bo'lsa `SPEC_INVALID` (qaysi op, qaysi path). */
export function applyJsonPatch(document: unknown, patch: JsonPatch): Result<unknown> {
  const root = structuredClone(document);
  for (const [index, op] of patch.entries()) {
    try {
      switch (op.op) {
        case "add":
          add(root, op.path, structuredClone(op.value));
          break;
        case "remove":
          remove(root, op.path);
          break;
        case "replace":
          remove(root, op.path);
          add(root, op.path, structuredClone(op.value));
          break;
        case "move": {
          if (op.path.startsWith(`${op.from}/`))
            throw new PatchError("O'z ichiga ko'chirib bo'lmaydi");
          const value = remove(root, op.from);
          add(root, op.path, value);
          break;
        }
        case "copy":
          add(root, op.path, structuredClone(get(root, op.from)));
          break;
        case "test":
          if (!deepEqual(get(root, op.path), op.value))
            throw new PatchError(`test o'tmadi: ${op.path}`);
          break;
      }
    } catch (error) {
      if (error instanceof PatchError) {
        return fail("SPEC_INVALID", `patch[${index}] (${op.op}): ${error.message}`, {
          op_index: index,
          path: op.path,
        });
      }
      throw error;
    }
  }
  return ok(root);
}
