import { NextResponse } from "next/server";
import { yesterdayEatDateString } from "@/lib/dateRange";
import {
  cronRunFinish,
  cronRunStart,
  ensureSchema,
  upsertReportSnapshot,
} from "@/lib/reportStore";
import { triggerNextTripsUnitSync } from "@/lib/tripsSyncChain";
import { executeStoredReport, withWialonRetry } from "@/lib/wialon/reports";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = await cronRunStart("daily-reports");
  const dateStr = yesterdayEatDateString();
  const details: Record<string, unknown> = { date: dateStr, results: [] as unknown[] };
  let ok = true;

  try {
    await ensureSchema();
    const results: unknown[] = [];

    const yards = await withWialonRetry(`${dateStr} / yards`, () =>
      executeStoredReport("yards", dateStr),
    );
    await upsertReportSnapshot(yards);
    results.push({
      reportType: yards.reportType,
      rowCount: yards.payload.rows?.length ?? 0,
      meta: yards.rawMeta,
    });

    // Group Trips: per-unit chain for yesterday (template 62) — too many units for one invocation.
    triggerNextTripsUnitSync({
      unitIndex: 0,
      intervalStart: dateStr,
      intervalEnd: dateStr,
    });
    results.push({
      reportType: "trips",
      mode: "per_unit_chain",
      intervalStart: dateStr,
      intervalEnd: dateStr,
      chained: true,
    });

    details.results = results;
  } catch (error) {
    ok = false;
    details.error = error instanceof Error ? error.message : String(error);
  }

  await cronRunFinish(runId, ok, details);
  return NextResponse.json({ ok, ...details }, { status: ok ? 200 : 500 });
}
