/**
 * Resume yards sync from last saved insideIndex (does not clear DB).
 * Usage: npm run yards:resume
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { getDb } from "../src/db";
import {
  ensureSchema,
  getYardsTodayRowCount,
  loadTodayYardsSnapshot,
  syncYardsInsideToDb,
} from "../src/lib/reportStore";
import { todayEatDateString } from "../src/lib/dateRange";

const DELAY_MS = 2000;
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /1004|LIMIT msgs_activity|rate limit/i.test(msg);
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
      console.log(`[yards:resume] rate limit at index ${index}, retry in ${wait / 1000}s...`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function verifyNoDupes(today: string): Promise<void> {
  const db = getDb();
  const stats = await db.execute(sql`
    SELECT count(*)::int as total, count(distinct registration_number)::int as distinct_regs
    FROM motrex_yards WHERE report_date = ${today}
  `);
  const row = stats.rows[0] as { total: number; distinct_regs: number };
  console.log(`[yards:resume] verify today: ${row.total} rows, ${row.distinct_regs} distinct`);
  if (row.total !== row.distinct_regs) {
    throw new Error(`Duplicate rows remain: ${row.total} total vs ${row.distinct_regs} distinct`);
  }
}

async function main() {
  await ensureSchema();
  const before = await getYardsTodayRowCount();
  const snap = await loadTodayYardsSnapshot();
  const lastInsideIndex = Number(snap?.rawMeta?.lastInsideIndex ?? -1);
  const vehicleCount = Number(snap?.rawMeta?.vehicleCount ?? 0);
  let startIndex = Math.max(0, lastInsideIndex + 1);

  console.log(`[yards:resume] rows before: ${before}`);

  let saved = 0;
  let skipped = 0;

  if (startIndex === 0 && vehicleCount === 0) {
    console.log("[yards:resume] nothing to resume — run npm run yards:sync");
    return;
  }

  const sparseRows = (count: number) => before < count * 0.5;

  if (startIndex >= vehicleCount && vehicleCount > 0) {
    if (!sparseRows(vehicleCount)) {
      console.log("[yards:resume] sync already complete");
      await verifyNoDupes(todayEatDateString());
      return;
    }
    console.log(
      `[yards:resume] marked complete but sparse (${before} rows for ${vehicleCount} inside) — repairing all`,
    );
    for (let i = 0; i < vehicleCount; i += 1) {
      const repairResult = await syncWithRetry(i);
      if (repairResult.vehicleRowCount > 0) saved += 1;
      else skipped += 1;
      if ((i + 1) % 10 === 0) {
        console.log(`[yards:resume] repair progress ${i + 1}/${vehicleCount} rows=${repairResult.rowCount}`);
      }
      await sleep(DELAY_MS);
    }
    const after = await getYardsTodayRowCount();
    await verifyNoDupes(todayEatDateString());
    console.log(
      `[yards:resume] complete — rows: ${after}, saved: ${saved}, skipped: ${skipped}, inside: ${after}`,
    );
    return;
  }

  const needsRepair = startIndex > 0 && sparseRows(startIndex);
  if (needsRepair) {
    console.log(
      `[yards:resume] repairing indices 0..${startIndex - 1} (${before} rows vs ${startIndex} processed)`,
    );
    for (let i = 0; i < startIndex; i += 1) {
      const repairResult = await syncWithRetry(i);
      if (repairResult.vehicleRowCount > 0) saved += 1;
      else skipped += 1;
      if ((i + 1) % 10 === 0) {
        console.log(`[yards:resume] repair progress ${i + 1}/${startIndex} rows=${repairResult.rowCount}`);
      }
      await sleep(DELAY_MS);
    }
    console.log(`[yards:resume] repair done — rows now: ${await getYardsTodayRowCount()}`);
  }

  if (startIndex === 0 && before === 0) {
    console.log("[yards:resume] starting fresh sync at index 0");
  } else {
    console.log(`[yards:resume] resume at insideIndex ${startIndex} / ${vehicleCount}`);
  }

  const freshStart = startIndex === 0 && before === 0 && !needsRepair;
  let result = await syncWithRetry(startIndex, freshStart);
  if (result.vehicleRowCount > 0) saved += 1;
  else skipped += 1;

  for (let i = startIndex + 1; i < result.vehicleCount; i += 1) {
    result = await syncWithRetry(i);
    if (result.vehicleRowCount > 0) saved += 1;
    else skipped += 1;

    if ((i + 1) % 10 === 0) {
      console.log(
        `[yards:resume] progress ${i + 1}/${result.vehicleCount} saved=${saved} skipped=${skipped} rows=${result.rowCount}`,
      );
    }
    await sleep(DELAY_MS);
  }

  const after = await getYardsTodayRowCount();
  await verifyNoDupes(todayEatDateString());
  console.log(
    `[yards:resume] complete — rows: ${after}, saved: ${saved}, skipped: ${skipped}, inside: ${result.insideCount ?? after}`,
  );
}

main().catch((err) => {
  console.error("[yards:resume] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
