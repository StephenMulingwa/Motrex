import { NextResponse } from "next/server";
import { enumerateWeeksInRange } from "@/lib/dateRange";
import { syncTripsSummaryBatch } from "@/lib/reportStore";
import { triggerNextTripsSummarySync } from "@/lib/tripsSummarySyncChain";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorizeWithSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function parseParams(request: Request): {
  weekStart: string;
  weekEnd: string;
  batchIndex: number;
  from?: string;
  to?: string;
  weekIndex: number;
} {
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const weekIndexRaw = url.searchParams.get("weekIndex");
  const weekIndex = weekIndexRaw == null ? 0 : Number(weekIndexRaw);
  const batchIndexRaw = url.searchParams.get("batchIndex");
  const batchIndex = batchIndexRaw == null ? 0 : Number(batchIndexRaw);

  let weekStart = url.searchParams.get("weekStart") ?? "";
  let weekEnd = url.searchParams.get("weekEnd") ?? "";

  if (from && to) {
    const weeks = enumerateWeeksInRange(from, to);
    const active = weeks[weekIndex] ?? weeks[0];
    if (active) {
      weekStart = active.from;
      weekEnd = active.to;
    }
  }

  if (!weekStart || !weekEnd) {
    throw new Error("weekStart and weekEnd are required.");
  }
  if (!Number.isFinite(batchIndex) || batchIndex < 0) {
    throw new Error("batchIndex must be a non-negative integer.");
  }
  if (!Number.isFinite(weekIndex) || weekIndex < 0) {
    throw new Error("weekIndex must be a non-negative integer.");
  }

  return { weekStart, weekEnd, batchIndex, from, to, weekIndex };
}

export async function POST(request: Request) {
  let params: ReturnType<typeof parseParams>;
  try {
    params = parseParams(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid sync parameters.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const authorized = authorizeWithSecret(request);
  if (!authorized && params.batchIndex > 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncTripsSummaryBatch({ ...params, authorized });

    if (!result.isLastBatch) {
      triggerNextTripsSummarySync({
        weekStart: result.weekStart,
        weekEnd: result.weekEnd,
        batchIndex: result.batchIndex + 1,
        from: params.from,
        to: params.to,
        weekIndex: params.weekIndex,
      });
    } else if (!result.isLastWeek && params.from && params.to) {
      triggerNextTripsSummarySync({
        weekStart: result.weekStart,
        weekEnd: result.weekEnd,
        batchIndex: 0,
        from: params.from,
        to: params.to,
        weekIndex: params.weekIndex + 1,
      });
    }

    return NextResponse.json({ ok: true, authorized, ...result }, { status: 200 });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "";
    const safeMessage =
      rawMessage && rawMessage.trim().length > 0
        ? rawMessage.replace(/wialon/gi, "Track3 Database")
        : "Unknown Track3 Database error.";
    console.error("[api/trips-summary/sync]", safeMessage);
    return NextResponse.json(
      { ok: false, error: safeMessage, batchIndex: params.batchIndex, weekIndex: params.weekIndex },
      { status: 500 },
    );
  }
}
