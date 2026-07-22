import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { clearAllYards, ensureSchema, getYardsTodayRowCount } from "../src/lib/reportStore";
import { getDb } from "../src/db";
import { sql } from "drizzle-orm";

async function main() {
  await ensureSchema();
  const db = getDb();
  const before = await db.execute(sql`select count(*)::int as c from motrex_yards`);
  console.log("[yards:clear] rows before:", (before.rows[0] as { c: number }).c);
  await clearAllYards();
  const after = await db.execute(sql`select count(*)::int as c from motrex_yards`);
  console.log("[yards:clear] rows after:", (after.rows[0] as { c: number }).c);
  console.log("[yards:clear] today count:", await getYardsTodayRowCount());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
