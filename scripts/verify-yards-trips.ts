import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { getTripsSummaryStoredData, getYardsLiveStoredData, getYardsTodayRowCount } from "../src/lib/reportStore";

async function main() {
  const todayRows = await getYardsTodayRowCount();
  const yards = await getYardsLiveStoredData();
  const trips = await getTripsSummaryStoredData("2026-06-01", "2026-07-14");
  console.log(
    JSON.stringify(
      {
        yards: {
          todayRows,
          inside: yards.insideRows?.length ?? 0,
          rows: yards.rows.length,
          sync: yards.syncProgress,
          lastExec: yards.lastExecutionTime,
        },
        tripsSummary: {
          vehicles: trips.rows.length,
          weeks: trips.snapshotCount,
          sync: trips.syncProgress,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
