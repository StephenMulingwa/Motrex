import { NextResponse } from "next/server";
import { previousWeekEatRange } from "@/lib/dateRange";
import { cronRunFinish, cronRunStart, ensureSchema } from "@/lib/reportStore";
import { triggerNextTripsSummarySync } from "@/lib/tripsSummarySyncChain";

/** Vercel cron: Monday 04:00 UTC = 07:00 EAT — previous week's trips summary. */
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

  const runId = await cronRunStart("weekly-trips-summary");
  const { from, to } = previousWeekEatRange();
  const details: Record<string, unknown> = { from, to, reportType: "trips_summary" };
  let ok = true;

  try {
    await ensureSchema();
    triggerNextTripsSummarySync({
      weekStart: from,
      weekEnd: to,
      batchIndex: 0,
    });
    details.message = "Trips summary batch chain started";
  } catch (error) {
    ok = false;
    details.error = error instanceof Error ? error.message : String(error);
  }

  await cronRunFinish(runId, ok, details);
  return NextResponse.json({ ok, ...details }, { status: ok ? 200 : 500 });
}
