import { NextResponse } from "next/server";
import { currentWeekEatRangeThroughYesterday } from "@/lib/dateRange";
import { cronRunFinish, cronRunStart, ensureSchema } from "@/lib/reportStore";
import { triggerNextTripsSummarySync } from "@/lib/tripsSummarySyncChain";

/** Vercel cron: daily 04:00 UTC = 07:00 EAT — refresh current calendar week (through yesterday). */
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

  const runId = await cronRunStart("daily-trips-summary");
  const { from, to } = currentWeekEatRangeThroughYesterday();
  const details: Record<string, unknown> = { from, to, reportType: "trips_summary" };
  let ok = true;

  try {
    await ensureSchema();
    triggerNextTripsSummarySync({
      weekStart: from,
      weekEnd: to,
      batchIndex: 0,
    });
    details.message = "Trips summary current-week batch chain started";
  } catch (error) {
    ok = false;
    details.error = error instanceof Error ? error.message : String(error);
  }

  await cronRunFinish(runId, ok, details);
  return NextResponse.json({ ok, ...details }, { status: ok ? 200 : 500 });
}
