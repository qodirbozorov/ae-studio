/**
 * DB backup (P5.13): barcha jadvallar Postgres'ning o'z JSON serializatsiyasi bilan (`json_agg`) →
 * gzip NDJSON (`{"table": "...", "rows": [...]}` har qatorda). Tiklash `json_populate_recordset` bilan —
 * turlar (timestamptz, jsonb, uuid, bigint) aniq qaytadi. Jadvallar FK tartibida (ota jadval avval).
 * Shifrlangan maxfiy ma'lumotlar (`secrets`) shifrlangan holda qoladi — tiklash uchun o'sha `MASTER_KEY` kerak.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import * as schema from "../db/schema";

export interface BackupStats {
  tables: number;
  rows: number;
}

/** Schema jadvallari FK bo'yicha topologik tartibda. */
export function orderedTables(): PgTable[] {
  const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
    is(value, PgTable),
  );
  const byName = new Map(tables.map((table) => [getTableName(table), table]));
  const done = new Set<string>();
  const out: PgTable[] = [];
  const visit = (table: PgTable, path: Set<string>) => {
    const name = getTableName(table);
    if (done.has(name) || path.has(name)) return;
    path.add(name);
    for (const fk of getTableConfig(table).foreignKeys) {
      const parent = getTableName(fk.reference().foreignTable);
      const parentTable = byName.get(parent);
      if (parentTable !== undefined && parent !== name) visit(parentTable, path);
    }
    path.delete(name);
    done.add(name);
    out.push(table);
  };
  for (const table of [...tables].sort((a, b) => getTableName(a).localeCompare(getTableName(b)))) {
    visit(table, new Set());
  }
  return out;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return (result as { rows?: Record<string, unknown>[] }).rows ?? [];
}

/** Butun DB → gzip NDJSON. */
export async function dumpDatabase(db: Db): Promise<{ data: Buffer; stats: BackupStats }> {
  const lines: string[] = [];
  let total = 0;
  const tables = orderedTables();
  for (const table of tables) {
    const name = getTableName(table);
    const result = await db.execute(
      sql.raw(`select coalesce(json_agg(t), '[]'::json)::text as data from "${name}" t`),
    );
    const text = String(rowsOf(result)[0]?.data ?? "[]");
    const rows = JSON.parse(text) as unknown[];
    total += rows.length;
    lines.push(JSON.stringify({ table: name, rows }));
  }
  return {
    data: gzipSync(Buffer.from(lines.join("\n"), "utf8")),
    stats: { tables: tables.length, rows: total },
  };
}

/**
 * Backup'ni bo'sh (migratsiyalangan) DB'ga tiklaydi. Jadvallar bo'sh bo'lishi kerak (aks holda xato —
 * mavjud ma'lumot ustiga yozilmaydi). Hammasi bitta tranzaksiyada.
 */
export async function restoreDatabase(db: Db, data: Buffer): Promise<BackupStats> {
  const dump = new Map<string, unknown[]>();
  for (const line of gunzipSync(data).toString("utf8").split("\n")) {
    if (line.trim() === "") continue;
    const entry = JSON.parse(line) as { table: string; rows: unknown[] };
    dump.set(entry.table, entry.rows);
  }
  let total = 0;
  let count = 0;
  await db.transaction(async (tx) => {
    for (const table of orderedTables()) {
      const name = getTableName(table);
      const rows = dump.get(name);
      if (rows === undefined || rows.length === 0) continue;
      const existing = rowsOf(
        await tx.execute(sql.raw(`select count(*)::int as n from "${name}"`)),
      );
      if (Number(existing[0]?.n ?? 0) > 0) throw new Error(`Tiklash: "${name}" bo'sh emas`);
      await tx.execute(
        sql`insert into ${sql.raw(`"${name}"`)} select * from json_populate_recordset(null::${sql.raw(`"${name}"`)}, ${JSON.stringify(rows)}::json)`,
      );
      total += rows.length;
      count++;
    }
  });
  return { tables: count, rows: total };
}
