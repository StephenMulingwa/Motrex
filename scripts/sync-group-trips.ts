/**
 * SM_Motrex - Group Trips (template 62) per-unit sync.
 * Usage:
 *   npm run trips:sync -- --from 2026-06-01 --to 2026-07-15 --per-unit
 *   npm run trips:sync -- --resume
 *   npm run trips:sync -- --week 2026-07-01 2026-07-07 --per-unit
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { enumerateWeeksInRange, yesterdayEatDateString } from "../src/lib/dateRange";
import {
  TRIPS_HISTORICAL_END,
  TRIPS_HISTORICAL_START,
} from "../src/lib/motrexConfig";
import {
  ensureSchema,
  getGroupTripsSyncMeta,
  upsertReportSnapshot,
} from "../src/lib/reportStore";
import { executeGroupTripsWeek, withWialonRetry } from "../src/lib/wialon/reports";

const DELAY_MS = 3000;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function parseArgs(): {
  intervals: Array<{ from: string; to: string }>;
  resume: boolean;
  perUnit: boolean;
} {
  const args = process.argv.slice(2);
  const resume = args.includes("--resume");
  const perUnit = args.includes("--per-unit") || resume;

  if (resume) {
    const fromIdx = args.indexOf("--from");
    const toIdx = args.indexOf("--to");
    const from = fromIdx >= 0 ? args[fromIdx + 1] : TRIPS_HISTORICAL_START;
    const to = toIdx >= 0 ? args[toIdx + 1] : TRIPS_HISTORICAL_END;
    return { intervals: [{ from, to }], resume: true, perUnit: true };
  }

  const weekIdx = args.indexOf("--week");
  if (weekIdx >= 0) {
    const from = args[weekIdx + 1];
    const to = args[weekIdx + 2];
    if (!from || !to) throw new Error("Usage: --week YYYY-MM-DD YYYY-MM-DD");
    return { intervals: [{ from, to }], resume: false, perUnit };
  }

  const fromIdx = args.indexOf("--from");
  if (fromIdx >= 0) {
    const from = args[fromIdx + 1];
    const toIdx = args.indexOf("--to");
    const to = toIdx >= 0 ? args[toIdx + 1] : yesterdayEatDateString();
    if (!from || !to) throw new Error("Usage: --from YYYY-MM-DD --to YYYY-MM-DD");
    // Per-unit backfill uses one full interval; weekly path keeps calendar weeks.
    if (perUnit) return { intervals: [{ from, to }], resume: false, perUnit };
    return { intervals: enumerateWeeksInRange(from, to), resume: false, perUnit };
  }

  throw new Error("Provide --week FROM TO, --from FROM --to TO, or --resume");
}

async function main() {
  await ensureSchema();
  const { intervals, resume, perUnit } = parseArgs();
  console.log(
    `[trips:sync] ${intervals.length} interval(s) — template 62${perUnit ? " per-unit" : ""}${resume ? " (resume)" : ""}`,
  );

  for (const interval of intervals) {
    let startUnitIndex = 0;
    if (resume) {
      const meta = await getGroupTripsSyncMeta(interval.from, interval.to);
      if (meta?.syncProgress === "complete") {
        console.log(`[trips:sync] ${interval.from} → ${interval.to} already complete`);
        continue;
      }
      if (meta && typeof meta.lastUnitIndex === "number" && meta.lastUnitIndex >= 0) {
        startUnitIndex = meta.lastUnitIndex + 1;
        console.log(
          `[trips:sync] resume from unit ${startUnitIndex + 1}/${meta.unitCount ?? "?"} after index ${meta.lastUnitIndex}`,
        );
      }
    }

    console.log(`[trips:sync] ${interval.from} → ${interval.to} (start unit index ${startUnitIndex})`);
    const result = await withWialonRetry(
      `${interval.from} → ${interval.to} / group trips`,
      () =>
        executeGroupTripsWeek(interval.from, interval.to, {
          startUnitIndex,
        }),
      [60_000, 120_000, 180_000],
    );
    await upsertReportSnapshot(result);
    console.log(
      `[trips:sync] stored meta — raw ${result.rawMeta.rawRowCount ?? 0}, built ${result.rawMeta.rowCount ?? 0}`,
    );
    await sleep(DELAY_MS);
  }

  console.log("[trips:sync] complete");
}

main().catch((err) => {
  console.error("[trips:sync] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
