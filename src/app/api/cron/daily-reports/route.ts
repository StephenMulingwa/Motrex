import { NextResponse } from "next/server";
import { yesterdayEatDateString } from "@/lib/dateRange";
import {
  cronRunFinish,
  cronRunStart,
  ensureSchema,
  upsertReportSnapshot,
} from "@/lib/reportStore";
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
    const types = ["yards", "trips"] as const;
    const results = [];
    for (const reportType of types) {
      const result = await withWialonRetry(`${dateStr} / ${reportType}`, () =>
        executeStoredReport(reportType, dateStr),
      );
      await upsertReportSnapshot(result);
      results.push({
        reportType: result.reportType,
        rowCount: result.payload.rows?.length ?? Object.keys(result.payload.pivot ?? {}).length,
        meta: result.rawMeta,
      });
    }
    details.results = results;
  } catch (error) {
    ok = false;
    details.error = error instanceof Error ? error.message : String(error);
  }

  await cronRunFinish(runId, ok, details);
  return NextResponse.json({ ok, ...details }, { status: ok ? 200 : 500 });
}
