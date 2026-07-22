import { NextResponse } from "next/server";
import { currentCalendarWeekSyncBounds, enumerateDates } from "@/lib/dateRange";
import { cronRunFinish, cronRunStart, ensureSchema, upsertReportSnapshot } from "@/lib/reportStore";
import { executeStoredReport, withWialonRetry } from "@/lib/wialon/reports";

/** Vercel cron: 00:00 UTC daily = 03:00 EAT — current calendar week through yesterday. */
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

  const runId = await cronRunStart("daily-eco-driving");
  const { weekStart, weekEnd, syncEnd } = currentCalendarWeekSyncBounds();
  const dates = enumerateDates(weekStart, syncEnd);
  const details: Record<string, unknown> = {
    weekStart,
    weekEnd,
    syncEnd,
    dates,
    reportType: "eco_driving",
  };
  let ok = true;

  try {
    await ensureSchema();
    const results: Array<{ reportDate: string; rowCount: number }> = [];

    for (const reportDate of dates) {
      const result = await withWialonRetry(`${reportDate} / eco_driving`, () =>
        executeStoredReport("eco_driving", reportDate),
      );
      await upsertReportSnapshot(result);
      results.push({
        reportDate,
        rowCount:
          result.payload.rows?.length ?? Object.keys(result.payload.pivot ?? {}).length,
      });
    }

    details.results = results;
    details.rowCount = results.reduce((sum, entry) => sum + entry.rowCount, 0);
  } catch (error) {
    ok = false;
    details.error = error instanceof Error ? error.message : String(error);
  }

  await cronRunFinish(runId, ok, details);
  return NextResponse.json({ ok, ...details }, { status: ok ? 200 : 500 });
}
