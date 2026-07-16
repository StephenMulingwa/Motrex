/**
 * Smart yards sync — inside vehicles only (template 55 scan + template 58 visits).
 * Usage: npm run yards:sync
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { ensureSchema, getYardsTodayRowCount, syncYardsInsideToDb } from "../src/lib/reportStore";

const DELAY_MS = 2000;
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /1004|LIMIT msgs_activity|rate limit|fetch failed/i.test(msg);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function syncWithRetry(
  index: number,
  clearBeforeSync = false,
): Promise<Awaited<ReturnType<typeof syncYardsInsideToDb>>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await syncYardsInsideToDb(index, { clearBeforeSync });
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err) || attempt >= RETRY_DELAYS_MS.length) throw err;
      const wait = RETRY_DELAYS_MS[attempt];
      console.log(`[yards:sync] retry index ${index} in ${wait / 1000}s (${err instanceof Error ? err.message : err})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function main() {
  await ensureSchema();
  const before = await getYardsTodayRowCount();
  console.log(`[yards:sync] rows before: ${before}`);
  console.log("[yards:sync] inside-first: live geofence scan + template 58 per inside vehicle");

  const first = await syncWithRetry(0, true);
  let result = first;
  let saved = first.vehicleRowCount > 0 ? 1 : 0;
  let skipped = first.vehicleRowCount > 0 ? 0 : 1;

  for (let i = 1; i < first.vehicleCount; i += 1) {
    result = await syncWithRetry(i);
    if (result.vehicleRowCount > 0) saved += 1;
    else skipped += 1;
    if ((i + 1) % 10 === 0) {
      console.log(
        `[yards:sync] progress ${i + 1}/${first.vehicleCount} saved=${saved} skipped=${skipped} rows=${result.rowCount}`,
      );
    }
    await sleep(DELAY_MS);
  }

  const after = await getYardsTodayRowCount();

  console.log(`[yards:sync] complete for ${result.reportDate}`);
  console.log(
    `[yards:sync] inside vehicles: ${result.vehicleCount}, raw rows: ${result.rowCount}, inside snapshot: ${result.insideCount ?? 0}`,
  );
  console.log(`[yards:sync] last execution: ${result.lastExecutionTime}`);
  console.log(`[yards:sync] rows in DB now: ${after}`);
}

main().catch((err) => {
  console.error("[yards:sync] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
