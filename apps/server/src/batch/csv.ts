/**
 * CSV (RFC 4180): qo'shtirnoqli maydonlar (ichida vergul, qator, `""`), CRLF/LF, UTF-8 BOM.
 * Ajratuvchi sarlavha qatoridan aniqlanadi: `;` (Excel, mahalliy sozlamalar) yoki `,` (yoki tab).
 */
import { fail, ok } from "@aes/shared";
import type { Result } from "@aes/shared";

export interface CsvTable {
  header: string[];
  rows: Record<string, string>[];
}

const MAX_ROWS = 500;

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const candidate of [",", ";", "\t"]) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === candidate) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Barcha qatorlar (maydonlar massivi); bo'sh qatorlar tashlab yuboriladi. */
export function parseCsvRecords(input: string): Result<string[][]> {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    if (!(record.length === 1 && record[0]!.trim() === "")) records.push(record);
    record = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
    } else if (ch === delimiter) {
      pushField();
      i++;
    } else if (ch === "\r" || ch === "\n") {
      pushRecord();
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (quoted) return fail("SYS_BAD_REQUEST", "CSV: yopilmagan qo'shtirnoq");
  if (field !== "" || record.length > 0) pushRecord();
  return ok(records);
}

/** Sarlavha + qatorlar (ustun nomi → qiymat). */
export function parseCsv(input: string): Result<CsvTable> {
  const records = parseCsvRecords(input);
  if (!records.ok) return records;
  const [head, ...body] = records.data;
  if (head === undefined) return fail("SYS_BAD_REQUEST", "CSV bo'sh: sarlavha qatori kerak");
  const header = head.map((h) => h.trim());
  if (header.some((h) => h === "")) return fail("SYS_BAD_REQUEST", "CSV: bo'sh ustun nomi");
  if (new Set(header).size !== header.length) {
    return fail("SYS_BAD_REQUEST", "CSV: ustun nomlari takrorlangan");
  }
  if (body.length === 0) return fail("SYS_BAD_REQUEST", "CSV: ma'lumot qatori yo'q");
  if (body.length > MAX_ROWS) return fail("SYS_BAD_REQUEST", `CSV: ko'pi bilan ${MAX_ROWS} qator`);
  const rows: Record<string, string>[] = [];
  for (const [index, record] of body.entries()) {
    if (record.length > header.length) {
      return fail(
        "SYS_BAD_REQUEST",
        `CSV ${index + 2}-qator: ${record.length} maydon, sarlavhada ${header.length}`,
      );
    }
    rows.push(Object.fromEntries(header.map((h, j) => [h, (record[j] ?? "").trim()])));
  }
  return ok({ header, rows });
}
