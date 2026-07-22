import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { ensureSchema, getYardsTodayRowCount } from "../src/lib/reportStore";

async function main() {
  await ensureSchema();
  console.log(await getYardsTodayRowCount());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
