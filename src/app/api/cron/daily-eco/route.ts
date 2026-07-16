import { NextResponse } from "next/server";
import { yesterdayEatDateString } from "@/lib/dateRange";
import {
  cronRunFinish,
  cronRunStart,
  ensureSchema,
  upsertReportSnapshot,
} from "@/lib/reportStore";
import { executeStoredReport, withWialonRetry } from "@/lib/wialon/reports";

/** Vercel cron: 00:00 UTC daily = 03:00 EAT — previous day's Eco Driving. */
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
  const reportDate = yesterdayEatDateString();
  const details: Record<string, unknown> = { reportDate, reportType: "eco_driving" };
  let ok = true;

  try {
    await ensureSchema();
    const result = await withWialonRetry(`${reportDate} / eco_driving`, () =>
      executeStoredReport("eco_driving", reportDate),
    );
    await upsertReportSnapshot(result);
    details.rowCount =
      result.payload.rows?.length ?? Object.keys(result.payload.pivot ?? {}).length;
    details.meta = result.rawMeta;
  } catch (error) {
    ok = false;
    details.error = error instanceof Error ? error.message : String(error);
  }

  await cronRunFinish(runId, ok, details);
  return NextResponse.json({ ok, ...details }, { status: ok ? 200 : 500 });
}
