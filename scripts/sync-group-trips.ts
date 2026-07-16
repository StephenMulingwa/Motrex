/**
 * SM_Motrex - Group Trips (template 62) weekly sync.
 * Usage:
 *   npm run trips:sync -- --from 2026-06-01 --to 2026-07-14
 *   npm run trips:sync -- --week 2026-07-01 2026-07-07
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { enumerateWeeksInRange, yesterdayEatDateString } from "../src/lib/dateRange";
import { ensureSchema, upsertReportSnapshot } from "../src/lib/reportStore";
import { executeGroupTripsWeek, withWialonRetry } from "../src/lib/wialon/reports";

const DELAY_MS = 8000;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function parseArgs(): Array<{ from: string; to: string }> {
  const args = process.argv.slice(2);
  const weekIdx = args.indexOf("--week");
  if (weekIdx >= 0) {
    const from = args[weekIdx + 1];
    const to = args[weekIdx + 2];
    if (!from || !to) throw new Error("Usage: --week YYYY-MM-DD YYYY-MM-DD");
    return [{ from, to }];
  }

  const fromIdx = args.indexOf("--from");
  if (fromIdx >= 0) {
    const from = args[fromIdx + 1];
    const toIdx = args.indexOf("--to");
    const to = toIdx >= 0 ? args[toIdx + 1] : yesterdayEatDateString();
    if (!from || !to) throw new Error("Usage: --from YYYY-MM-DD --to YYYY-MM-DD");
    return enumerateWeeksInRange(from, to);
  }

  throw new Error("Provide --week FROM TO or --from FROM --to TO");
}

async function main() {
  await ensureSchema();
  const weeks = parseArgs();
  console.log(`[trips:sync] ${weeks.length} week(s) — template 62 SM_Motrex - Group Trips`);

  for (const week of weeks) {
    console.log(`[trips:sync] week ${week.from} → ${week.to}`);
    const result = await withWialonRetry(
      `${week.from} → ${week.to} / group trips`,
      () => executeGroupTripsWeek(week.from, week.to),
      [60_000, 120_000, 180_000],
    );
    await upsertReportSnapshot(result);
    console.log(
      `[trips:sync] stored ${result.payload.rows?.length ?? 0} rows (raw ${result.rawMeta.rawRowCount ?? 0})`,
    );
    await sleep(DELAY_MS);
  }

  console.log("[trips:sync] complete");
}

main().catch((err) => {
  console.error("[trips:sync] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
