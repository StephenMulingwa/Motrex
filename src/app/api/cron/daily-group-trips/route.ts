import { NextResponse } from "next/server";
import { rollingTripsSyncRange } from "@/lib/dateRange";
import { cronRunFinish, cronRunStart, ensureSchema } from "@/lib/reportStore";
import { triggerNextTripsUnitSync } from "@/lib/tripsSyncChain";

/** Vercel cron: 02:00 UTC daily = 05:00 EAT — rolling 14-day Group Trips refresh. */
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

  const runId = await cronRunStart("daily-group-trips");
  const { from, to } = rollingTripsSyncRange();
  const details: Record<string, unknown> = {
    intervalStart: from,
    intervalEnd: to,
    reportType: "trips",
    mode: "per_unit_chain",
  };
  let ok = true;

  try {
    await ensureSchema();
    triggerNextTripsUnitSync({
      unitIndex: 0,
      intervalStart: from,
      intervalEnd: to,
    });
    details.message = "Group Trips rolling 14-day unit chain started";
  } catch (error) {
    ok = false;
    details.error = error instanceof Error ? error.message : String(error);
  }

  await cronRunFinish(runId, ok, details);
  return NextResponse.json({ ok, ...details }, { status: ok ? 200 : 500 });
}
