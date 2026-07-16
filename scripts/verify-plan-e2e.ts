/**
 * E2E verification for plan completion.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { getDb } from "../src/db";
import {
  ensureSchema,
  getStoredReportData,
  getTripsSummaryStoredData,
  getYardsLiveStoredData,
} from "../src/lib/reportStore";

function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: unknown[] }).rows ?? [];
  }
  return [];
}

async function main() {
  await ensureSchema();
  const db = getDb();

  console.log("\n=== trips_summary week vehicle counts ===");
  const summaryCounts = await db.execute(sql`
    SELECT week_start::text AS week_start, week_end::text AS week_end,
           COUNT(DISTINCT registration_number)::int AS vehicles
    FROM motrex_trips_summary
    WHERE week_start >= '2026-06-01' AND week_end <= '2026-07-14'
    GROUP BY week_start, week_end
    ORDER BY week_start
  `);
  console.log(JSON.stringify(rowsOf(summaryCounts), null, 2));

  console.log("\n=== eco_driving distinct dates Jul 1-14 ===");
  const ecoDates = await db.execute(sql`
    SELECT report_date::text AS d, COUNT(*)::int AS rows
    FROM motrex_eco_driving
    WHERE report_date >= '2026-07-01' AND report_date <= '2026-07-14'
    GROUP BY report_date
    ORDER BY report_date
  `);
  console.log(JSON.stringify(rowsOf(ecoDates), null, 2));

  console.log("\n=== motrex_trips by week / direction / route ===");
  const tripStats = await db.execute(sql`
    SELECT week_start::text AS week_start, week_end::text AS week_end,
           trip_type, route_pair, COUNT(*)::int AS n
    FROM motrex_trips
    WHERE week_start >= '2026-06-01'
    GROUP BY week_start, week_end, trip_type, route_pair
    ORDER BY week_start, route_pair, trip_type
  `);
  console.log(JSON.stringify(rowsOf(tripStats), null, 2));

  const tripTotal = await db.execute(sql`SELECT COUNT(*)::int AS n FROM motrex_trips`);
  console.log("total trips rows", rowsOf(tripTotal));

  console.log("\n=== API-shaped loads ===");
  const trips = await getStoredReportData("trips", "2026-06-01", "2026-07-14");
  console.log("trips API rows", trips.rows?.length ?? 0, "snapshots", trips.snapshots?.length ?? 0);
  const dirs = new Set((trips.rows ?? []).map((r) => String(r.Table ?? "")));
  const pairs = new Set((trips.rows ?? []).map((r) => String(r["Route Pair"] ?? "")));
  console.log("directions", [...dirs], "routePairs", [...pairs]);

  const summary = await getTripsSummaryStoredData("2026-07-08", "2026-07-14");
  console.log("summary Jul8-14 vehicles", summary.rows?.length ?? 0);

  const eco = await getStoredReportData("eco_driving", "2026-07-01", "2026-07-14");
  console.log(
    "eco pivot vehicles",
    Object.keys(eco.pivot ?? {}).length,
    "columns",
    (eco.columns ?? []).length,
  );

  console.log("\n=== yards last-good ===");
  const yardsLive = await getYardsLiveStoredData();
  console.log("yards live rows", yardsLive.rows?.length ?? 0, "lastExec", yardsLive.lastExecutionTime);

  console.log("\nOK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
