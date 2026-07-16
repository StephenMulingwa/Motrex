import { NextResponse } from "next/server";
import { cronRunFinish, cronRunStart, syncYardsInsideToDb } from "@/lib/reportStore";
import { triggerNextVehicleSync } from "@/lib/yardsSyncChain";

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

  const runId = await cronRunStart("daily-yards");
  let ok = true;
  const details: Record<string, unknown> = {};

  try {
    const result = await syncYardsInsideToDb(0, { clearBeforeSync: true });
    details.insideIndex = result.vehicleIndex;
    details.insideCount = result.vehicleCount;
    details.rowCount = result.rowCount;
    details.reportDate = result.reportDate;
    details.lastExecutionTime = result.lastExecutionTime;
    details.syncProgress = result.syncProgress;

    // Process a few more vehicles inline, then chain the rest.
    let nextIndex = 1;
    let last = result;
    while (!last.isLast && nextIndex < 3) {
      last = await syncYardsInsideToDb(nextIndex, { clearBeforeSync: false });
      nextIndex += 1;
    }
    details.rowCount = last.rowCount;
    details.syncProgress = last.syncProgress;

    if (!last.isLast) {
      triggerNextVehicleSync(nextIndex);
      details.chained = true;
      details.nextIndex = nextIndex;
    }
  } catch (error) {
    ok = false;
    details.error = error instanceof Error ? error.message : String(error);
  }

  await cronRunFinish(runId, ok, details);
  return NextResponse.json({ ok, ...details }, { status: ok ? 200 : 500 });
}
