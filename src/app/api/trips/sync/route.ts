import { NextResponse } from "next/server";
import { yesterdayEatDateString } from "@/lib/dateRange";
import { syncGroupTripsUnitToDb } from "@/lib/reportStore";
import { triggerNextTripsUnitSync } from "@/lib/tripsSyncChain";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const UNITS_PER_REQUEST = 2;

function authorizeWithSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function parseParams(request: Request): {
  unitIndex: number;
  intervalStart: string;
  intervalEnd: string;
} {
  const url = new URL(request.url);
  const yesterday = yesterdayEatDateString();
  const unitIndex = Number(url.searchParams.get("unitIndex") ?? "0");
  if (!Number.isFinite(unitIndex) || unitIndex < 0) {
    throw new Error("unitIndex must be a non-negative integer.");
  }
  const intervalStart = url.searchParams.get("intervalStart") ?? yesterday;
  const intervalEnd = url.searchParams.get("intervalEnd") ?? yesterday;
  return { unitIndex, intervalStart, intervalEnd };
}

export async function POST(request: Request) {
  if (!authorizeWithSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let unitIndex = 0;
  let intervalStart = "";
  let intervalEnd = "";
  try {
    ({ unitIndex, intervalStart, intervalEnd } = parseParams(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid params.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    let result = await syncGroupTripsUnitToDb(unitIndex, {
      intervalStart,
      intervalEnd,
      clearBeforeSync: unitIndex === 0,
    });
    let nextIndex = unitIndex + 1;

    while (!result.isLast && nextIndex < unitIndex + UNITS_PER_REQUEST) {
      result = await syncGroupTripsUnitToDb(nextIndex, {
        intervalStart,
        intervalEnd,
        clearBeforeSync: false,
      });
      nextIndex += 1;
    }

    if (!result.isLast) {
      triggerNextTripsUnitSync({
        unitIndex: nextIndex,
        intervalStart,
        intervalEnd,
      });
    }

    return NextResponse.json({
      ok: true,
      nextIndex: result.isLast ? null : nextIndex,
      ...result,
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "";
    const safeMessage =
      rawMessage && rawMessage.trim().length > 0
        ? rawMessage.replace(/wialon/gi, "Track3 Database")
        : "Unknown Track3 Database error.";
    console.error("[api/trips/sync]", safeMessage);
    return NextResponse.json({ ok: false, error: safeMessage, unitIndex }, { status: 500 });
  }
}
