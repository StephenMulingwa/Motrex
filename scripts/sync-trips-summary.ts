/**
 * Trips summary sync — template 61 (SM_New_Motrex_Summary) in 100-vehicle batches.
 * Usage:
 *   npm run trips-summary:sync -- --week 2026-07-01 2026-07-07
 *   npm run trips-summary:sync -- --month 2026-07
 *   npm run trips-summary:sync -- --from 2026-06-01 --to 2026-07-14
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import {
  enumerateWeeksInRange,
  monthBounds,
  yesterdayEatDateString,
} from "../src/lib/dateRange";
import { ensureSchema, syncTripsSummaryBatch } from "../src/lib/reportStore";

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

  const monthIdx = args.indexOf("--month");
  if (monthIdx >= 0) {
    const month = args[monthIdx + 1];
    if (!month) throw new Error("Usage: --month YYYY-MM");
    const bounds = monthBounds(month);
    const yesterday = yesterdayEatDateString();
    const to = bounds.to > yesterday ? yesterday : bounds.to;
    if (to < bounds.from) {
      console.log(`[trips-summary:sync] month ${month} has no days through yesterday yet`);
      return [];
    }
    return enumerateWeeksInRange(bounds.from, to);
  }

  throw new Error("Provide --week FROM TO, --month YYYY-MM, or --from FROM --to TO");
}

async function syncWeek(from: string, to: string): Promise<void> {
  const yesterday = yesterdayEatDateString();
  const syncEnd = to > yesterday ? yesterday : to;
  console.log(`[trips-summary:sync] week ${from} → ${to}${syncEnd < to ? ` (fetch through ${syncEnd})` : ""}`);
  let batchIndex = 0;
  let result = await syncTripsSummaryBatch({
    weekStart: from,
    weekEnd: to,
    syncEnd: syncEnd < to ? syncEnd : undefined,
    batchIndex: 0,
    authorized: true,
  });
  console.log(
    `[trips-summary:sync] batch 1/${result.batchCount} rows=${result.rowCount} units=${result.unitCount}`,
  );

  while (!result.isLastBatch) {
    await sleep(DELAY_MS);
    batchIndex += 1;
    result = await syncTripsSummaryBatch({
      weekStart: from,
      weekEnd: to,
      syncEnd: syncEnd < to ? syncEnd : undefined,
      batchIndex,
      authorized: true,
    });
    console.log(
      `[trips-summary:sync] batch ${batchIndex + 1}/${result.batchCount} rows=${result.rowCount}`,
    );
  }
}

async function main() {
  await ensureSchema();
  const weeks = parseArgs();
  console.log(`[trips-summary:sync] ${weeks.length} week(s) to sync`);

  for (const week of weeks) {
    await syncWeek(week.from, week.to);
    await sleep(DELAY_MS);
  }

  console.log("[trips-summary:sync] complete");
}

main().catch((err) => {
  console.error("[trips-summary:sync] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
