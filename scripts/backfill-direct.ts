/**
 * Direct backfill — runs outside Next.js HTTP timeout.
 * Usage: npx tsx scripts/backfill-direct.ts
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { getBackfillDatesForType, STORED_REPORT_TYPES } from "../src/lib/motrexConfig";
import { cronRunFinish, cronRunStart, ensureSchema, upsertReportSnapshot } from "../src/lib/reportStore";
import { executeHistoricalTripsReport, executeStoredReport, withWialonRetry } from "../src/lib/wialon/reports";

function selectedReportTypes() {
  const raw = process.env.BACKFILL_TYPES;
  if (!raw) return STORED_REPORT_TYPES;
  const selected = new Set(raw.split(",").map((v) => v.trim()).filter(Boolean));
  return STORED_REPORT_TYPES.filter((type) => selected.has(type));
}

function selectedDatesForType(reportType: (typeof STORED_REPORT_TYPES)[number]) {
  const date = process.env.BACKFILL_DATE?.trim();
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return [date];
  return getBackfillDatesForType(reportType);
}

async function main() {
  await ensureSchema();
  const runId = await cronRunStart("backfill-direct");
  let successCount = 0;
  let failCount = 0;
  const results: unknown[] = [];

  for (const reportType of selectedReportTypes()) {
    if (reportType === "trips" && !process.env.BACKFILL_DATE?.trim()) {
      try {
        console.log("\ntrips: 2026-06-15 00:00 → 2026-06-30 23:59 (historical 15-day interval)");
        const result = await withWialonRetry("2026-06-15 → 2026-06-30 / trips", executeHistoricalTripsReport);
        await upsertReportSnapshot(result);
        successCount += 1;
        results.push({
          date: result.reportDate,
          reportType,
          ok: true,
          rowCount: result.payload.rows?.length ?? 0,
          meta: result.rawMeta,
        });
      } catch (error) {
        failCount += 1;
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`    FAILED: ${msg}`);
        results.push({ date: "2026-06-15 to 2026-06-30", reportType, ok: false, error: msg });
      }
      continue;
    }

    const dates = selectedDatesForType(reportType);
    console.log(`\n${reportType}: ${dates[0]} → ${dates[dates.length - 1]} (${dates.length} days)`);

    for (const dateStr of dates) {
      try {
        console.log(`  ${dateStr} / ${reportType} …`);
        const result = await withWialonRetry(`${dateStr} / ${reportType}`, () => executeStoredReport(reportType, dateStr));
        await upsertReportSnapshot(result);
        successCount += 1;
        results.push({
          date: dateStr,
          reportType,
          ok: true,
          rowCount: result.payload.rows?.length ?? Object.keys(result.payload.pivot ?? {}).length,
        });
      } catch (error) {
        failCount += 1;
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`    FAILED: ${msg}`);
        results.push({ date: dateStr, reportType, ok: false, error: msg });
      }
    }
  }

  const detail = { successCount, failCount, results };
  await cronRunFinish(runId, failCount === 0, detail);
  console.log(`\nDone. Success: ${successCount}, Failed: ${failCount}`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
