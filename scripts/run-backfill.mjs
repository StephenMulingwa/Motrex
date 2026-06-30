import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

const CRON_SECRET = process.env.CRON_SECRET ?? "motrex-cron-secret-change-in-production";
const BASE = process.env.BACKFILL_BASE_URL ?? "http://localhost:3000";

async function main() {
  console.log(`Starting backfill via ${BASE}/api/admin/backfill …`);
  const res = await fetch(`${BASE}/api/admin/backfill`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
