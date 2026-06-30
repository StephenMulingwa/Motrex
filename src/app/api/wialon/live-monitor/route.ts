import { NextResponse } from "next/server";
import { parseKenyaDateTime, getLiveMonitorRange } from "@/lib/dateRange";
import { fetchLiveMonitor } from "@/lib/wialon/liveMonitor";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const defaultRange = getLiveMonitorRange();
    const fromInput = url.searchParams.get("from") ?? defaultRange.start;
    const toInput = url.searchParams.get("to") ?? defaultRange.end;

    const fromMs = parseKenyaDateTime(fromInput);
    const toMs = parseKenyaDateTime(toInput);

    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs >= toMs) {
      return NextResponse.json(
        { error: "Invalid from/to date range. Use valid ISO datetimes (from < to)." },
        { status: 400 },
      );
    }

    const data = await fetchLiveMonitor(fromMs, toMs);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "";
    const safeMessage =
      rawMessage && rawMessage.trim().length > 0
        ? rawMessage.replace(/wialon/gi, "Track3 Database")
        : "Unknown Track3 Database error.";
    console.error("[api/wialon/live-monitor]", safeMessage);
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
