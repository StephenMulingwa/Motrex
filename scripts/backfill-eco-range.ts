/**
 * Eco Driving backfill for a date range (one day at a time).
 * Usage: npx tsx scripts/backfill-eco-range.ts --from 2026-07-01 --to 2026-07-14
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { enumerateDates } from "../src/lib/dateRange";
import { ensureSchema, upsertReportSnapshot } from "../src/lib/reportStore";
import { executeStoredReport, withWialonRetry } from "../src/lib/wialon/reports";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf("--from");
  const toIdx = args.indexOf("--to");
  const from = fromIdx >= 0 ? args[fromIdx + 1] : "";
  const to = toIdx >= 0 ? args[toIdx + 1] : "";
  if (!from || !to) throw new Error("Usage: --from YYYY-MM-DD --to YYYY-MM-DD");

  await ensureSchema();
  const dates = enumerateDates(from, to);
  console.log(`[eco:backfill] ${dates.length} day(s) ${from} → ${to}`);

  for (const dateStr of dates) {
    console.log(`[eco:backfill] ${dateStr}`);
    const result = await withWialonRetry(`${dateStr} / eco_driving`, () =>
      executeStoredReport("eco_driving", dateStr),
    );
    await upsertReportSnapshot(result);
    const count =
      result.payload.rows?.length ?? Object.keys(result.payload.pivot ?? {}).length;
    console.log(`[eco:backfill] ${dateStr} ok rows/vehicles≈${count}`);
    await sleep(3000);
  }

  console.log("[eco:backfill] complete");
}

main().catch((err) => {
  console.error("[eco:backfill] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
