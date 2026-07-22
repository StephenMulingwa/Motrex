import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "../src/db";
import { motrexYards } from "../src/db/schema";
import { todayEatDateString } from "../src/lib/dateRange";
import { ensureSchema, syncYardsInsideToDb, getYardsTodayRowCount } from "../src/lib/reportStore";

const WIALON_TIME_RE = /^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}$/;

function assertWialonTimeIn(timeIn: string | null, lastExecutionTime: string | null): void {
  if (!timeIn) throw new Error("time_in is missing");
  if (!WIALON_TIME_RE.test(timeIn)) {
    throw new Error(`time_in is not Wialon format (got "${timeIn}")`);
  }
  if (timeIn === lastExecutionTime?.replace(/\s+EAT$/, "").trim()) {
    throw new Error("time_in equals last_execution_time — live-monitor fallback detected");
  }
}

async function main() {
  await ensureSchema();
  const verifyTarget = Number(process.env.YARDS_TEST_INSIDE ?? "3");
  const maxAttempts = Number(process.env.YARDS_TEST_MAX ?? "25");
  let verified = 0;
  let lastMaxId = 0;
  let totalRows = await getYardsTodayRowCount();
  console.log(`[yards:test] rows before: ${totalRows}`);
  console.log(`[yards:test] verify ${verifyTarget} template-58 saves (up to ${maxAttempts} vehicles)...`);

  let vehicleCount = 0;
  for (let insideIndex = 0; insideIndex < maxAttempts && verified < verifyTarget; insideIndex += 1) {
    const before = await getYardsTodayRowCount();
    const result = await syncYardsInsideToDb(insideIndex);
    vehicleCount = result.vehicleCount;
    const after = await getYardsTodayRowCount();
    const inserted = after > before;

    console.log(
      `[yards:test] inside ${insideIndex + 1}/${result.vehicleCount} unitId=${result.unitId} ${inserted ? `+${after - before} rows` : "skipped"} (total ${after})`,
    );

    if (inserted) {
      const db = getDb();
      const today = todayEatDateString();
      const [sample] = await db
        .select()
        .from(motrexYards)
        .where(and(eq(motrexYards.reportDate, today), gt(motrexYards.id, lastMaxId)))
        .orderBy(desc(motrexYards.id))
        .limit(1);

      if (sample) {
        lastMaxId = sample.id;
        console.log(
          `[yards:test]   ${sample.registrationNumber} @ ${sample.geofence} | in: ${sample.timeIn ?? "—"}`,
        );
        assertWialonTimeIn(sample.timeIn, sample.lastExecutionTime);
        console.log(`[yards:test]   OK: Wialon time_in verified`);
        verified += 1;
      }
    }

    totalRows = after;
    if (result.isLast) break;
  }

  if (verified < verifyTarget) {
    console.error(`[yards:test] only verified ${verified}/${verifyTarget} saves (of ${vehicleCount} inside vehicles)`);
    process.exit(1);
  }

  console.log(`[yards:test] done, total rows: ${totalRows}, verified: ${verified}`);
}

main().catch((err) => {
  console.error("[yards:test] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
