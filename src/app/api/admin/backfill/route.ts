import { NextResponse } from "next/server";
import { getBackfillDatesForType, STORED_REPORT_TYPES } from "@/lib/motrexConfig";
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

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = await cronRunStart("backfill");
  const results: unknown[] = [];
  let ok = true;
  let successCount = 0;
  let failCount = 0;

  try {
    await ensureSchema();

    for (const reportType of STORED_REPORT_TYPES) {
      const dates = getBackfillDatesForType(reportType);
      for (const dateStr of dates) {
        try {
          const result = await withWialonRetry(`${dateStr} / ${reportType}`, () => executeStoredReport(reportType, dateStr));
          await upsertReportSnapshot(result);
          successCount += 1;
          results.push({
            date: dateStr,
            reportType,
            ok: true,
            rowCount: result.payload.rows?.length ?? Object.keys(result.payload.pivot ?? {}).length,
          });
        } catch (error) {
          failCount += 1;
          ok = false;
          results.push({
            date: dateStr,
            reportType,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } catch (error) {
    ok = false;
    results.push({ fatal: error instanceof Error ? error.message : String(error) });
  }

  const detail = { successCount, failCount, results };
  await cronRunFinish(runId, ok && failCount === 0, detail);

  return NextResponse.json(
    { ok: ok && failCount === 0, ...detail },
    { status: ok && failCount === 0 ? 200 : 207 },
  );
}
