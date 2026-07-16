import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { getDb } from "../src/db";
import { ensureSchema } from "../src/lib/reportStore";

async function main() {
  await ensureSchema();
  const db = getDb();
  const weeks = await db.execute(sql`
    SELECT week_start::text, week_end::text, count(*)::int AS rows,
           count(DISTINCT registration_number)::int AS vehicles
    FROM motrex_trips_summary
    GROUP BY 1, 2
    ORDER BY 1
  `);
  console.log(JSON.stringify(weeks.rows ?? weeks, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
