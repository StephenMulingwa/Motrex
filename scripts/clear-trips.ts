/**
 * Clear all motrex_trips rows and trips report_snapshots.
 * Usage: npx tsx scripts/clear-trips.ts
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { clearAllTrips, ensureSchema } from "../src/lib/reportStore";

async function main() {
  await ensureSchema();
  await clearAllTrips();
  console.log("[clear-trips] motrex_trips and trips snapshots cleared");
}

main().catch((err) => {
  console.error("[clear-trips] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
