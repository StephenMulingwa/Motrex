import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { MOTREX_RESOURCE_ID } from "../src/lib/motrexConfig";
import { callWialon, wialonLogin, wialonLogout } from "../src/lib/wialon/client";

async function main() {
  const sid = await wialonLogin();
  try {
    // List report templates on Motrex resource
    const data = await callWialon<{
      item?: { id?: number; nm?: string; rep?: Record<string, { id?: number; n?: string }> };
    }>("core/search_item", {
      id: MOTREX_RESOURCE_ID,
      flags: 8192, // report templates
    }, sid);

    const reps = data.item?.rep ?? {};
    const list = Object.values(reps).map((r) => ({ id: r.id, name: r.n }));
    console.log(JSON.stringify({ resource: MOTREX_RESOURCE_ID, count: list.length, templates: list }, null, 2));

    for (const id of [15, 61, 62]) {
      try {
        const t = await callWialon<unknown[]>("report/get_report_data", { itemId: MOTREX_RESOURCE_ID, col: [id] }, sid);
        console.log(`template ${id}:`, JSON.stringify(t?.[0] ? { id: (t[0] as { id?: number }).id, n: (t[0] as { n?: string }).n } : t));
      } catch (e) {
        console.log(`template ${id} error:`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    await wialonLogout(sid).catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
