/**
 * Remove stale live-monitor rows and duplicate registrations from motrex_yards.
 * Usage: npm run yards:dedupe
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { getDb } from "../src/db";
import { todayEatDateString } from "../src/lib/dateRange";
import { registrationKey, registrationLabel } from "../src/lib/vehicleLabels";

const WIALON_TIME_RE = /^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}$/;
const EAT_TIME_RE = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+EAT$/i;

function isWialonTimeIn(value: string | null): boolean {
  return WIALON_TIME_RE.test(String(value ?? "").trim());
}

function isStaleEatTimeIn(value: string | null): boolean {
  return EAT_TIME_RE.test(String(value ?? "").trim());
}

async function main() {
  const db = getDb();
  const today = todayEatDateString();

  const before = await db.execute(sql`select count(*)::int as c from motrex_yards`);
  const beforeCount = (before.rows[0] as { c: number }).c;
  console.log(`[yards:dedupe] rows before: ${beforeCount}`);

  const stale = await db.execute(sql`
    DELETE FROM motrex_yards
    WHERE time_in ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} EAT$'
    RETURNING id
  `);
  console.log(`[yards:dedupe] deleted stale EAT-format rows: ${stale.rows.length}`);

  const all = await db.execute(sql`
    SELECT id, report_date, registration_number, vehicle, time_in, updated_at
    FROM motrex_yards
    ORDER BY report_date, updated_at DESC
  `);

  const keepIds = new Set<number>();
  const bestByKey = new Map<string, { id: number; wialon: boolean; updatedAt: string }>();

  for (const row of all.rows as Array<{
    id: number;
    report_date: string;
    registration_number: string;
    vehicle: string;
    time_in: string | null;
    updated_at: string;
  }>) {
    const key = `${String(row.report_date)}::${registrationKey(row.registration_number || row.vehicle)}`;
    const wialon = isWialonTimeIn(row.time_in);
    const current = bestByKey.get(key);
    if (!current) {
      bestByKey.set(key, { id: row.id, wialon, updatedAt: String(row.updated_at) });
      continue;
    }
    const better =
      (wialon && !current.wialon) ||
      (wialon === current.wialon && String(row.updated_at) > current.updatedAt);
    if (better) {
      bestByKey.set(key, { id: row.id, wialon, updatedAt: String(row.updated_at) });
    }
  }

  for (const { id } of bestByKey.values()) keepIds.add(id);

  const dupesToDelete = (all.rows as Array<{ id: number }>)
    .map((r) => r.id)
    .filter((id) => !keepIds.has(id));

  if (dupesToDelete.length) {
    for (const id of dupesToDelete) {
      await db.execute(sql`DELETE FROM motrex_yards WHERE id = ${id}`);
    }
  }
  console.log(`[yards:dedupe] deleted duplicate rows: ${dupesToDelete.length}`);

  const normalize = await db.execute(sql`SELECT id, registration_number, vehicle FROM motrex_yards`);
  let normalized = 0;
  for (const row of normalize.rows as Array<{ id: number; registration_number: string; vehicle: string }>) {
    const label = registrationLabel(row.registration_number || row.vehicle);
    if (label !== row.registration_number) {
      await db.execute(sql`
        UPDATE motrex_yards SET registration_number = ${label}, vehicle = ${label}
        WHERE id = ${row.id}
      `);
      normalized += 1;
    }
  }
  console.log(`[yards:dedupe] normalized registration labels: ${normalized}`);

  const todayStats = await db.execute(sql`
    SELECT count(*)::int as total, count(distinct upper(registration_number))::int as distinct_regs
    FROM motrex_yards WHERE report_date = ${today}
  `);
  const stats = todayStats.rows[0] as { total: number; distinct_regs: number };
  const after = await db.execute(sql`select count(*)::int as c from motrex_yards`);
  const afterCount = (after.rows[0] as { c: number }).c;

  console.log(`[yards:dedupe] rows after: ${afterCount}`);
  console.log(`[yards:dedupe] today ${today}: ${stats.total} rows, ${stats.distinct_regs} distinct registrations`);
  if (stats.total !== stats.distinct_regs) {
    console.warn("[yards:dedupe] WARNING: duplicates remain for today — re-run or check data");
    process.exit(1);
  }

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS motrex_yards_date_reg_unique
    ON motrex_yards (report_date, registration_number)
  `);
  console.log("[yards:dedupe] unique index ensured");
}

main().catch((err) => {
  console.error("[yards:dedupe] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
