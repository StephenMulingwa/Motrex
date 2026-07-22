import { NextResponse } from "next/server";
import {
  getYardsTodayRowCount,
  loadTodayYardsSnapshot,
  resolveYardsSyncStartIndex,
  syncYardsInsideToDb,
} from "@/lib/reportStore";
import { triggerNextVehicleSync } from "@/lib/yardsSyncChain";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const CRON_VEHICLES_PER_REQUEST = 3;

function authorizeWithSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function parseInsideIndex(request: Request): number {
  const url = new URL(request.url);
  const raw =
    url.searchParams.get("insideIndex") ??
    url.searchParams.get("vehicleIndex") ??
    url.searchParams.get("batchIndex");
  const index = raw == null ? 0 : Number(raw);
  if (!Number.isFinite(index) || index < 0) {
    throw new Error("insideIndex must be a non-negative integer.");
  }
  return index;
}

export async function POST(request: Request) {
  let requestedIndex = 0;
  try {
    requestedIndex = parseInsideIndex(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid insideIndex.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const authorized = authorizeWithSecret(request);
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";
  const uiChain = url.searchParams.get("ui") === "1";
  let bootstrap = false;

  if (!authorized) {
    const snap = await loadTodayYardsSnapshot();
    const inProgress = snap?.rawMeta?.syncProgress === "in_progress";
    const lastInsideIndex = Number(snap?.rawMeta?.lastInsideIndex ?? -1);
    const stale = Boolean(
      inProgress &&
        snap?.rawMeta?.lastSyncAt &&
        Date.now() - Date.parse(String(snap.rawMeta.lastSyncAt)) > 45 * 60 * 1000,
    );
    const canResume = inProgress && lastInsideIndex >= 0;

    if (requestedIndex !== 0) {
      // UI drives the chain one vehicle at a time while sync is in progress.
      if (!uiChain || (!inProgress && !canResume)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else {
      bootstrap = forceRefresh || (await getYardsTodayRowCount()) === 0 || stale || canResume;
      if (!bootstrap && !uiChain) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
  }

  const vehiclesPerRequest = uiChain ? 1 : CRON_VEHICLES_PER_REQUEST;

  try {
    const { insideIndex, clearBeforeSync } = await resolveYardsSyncStartIndex(requestedIndex, authorized);
    let result = await syncYardsInsideToDb(insideIndex, { clearBeforeSync });
    let nextIndex = insideIndex + 1;

    while (!result.isLast && nextIndex < insideIndex + vehiclesPerRequest) {
      result = await syncYardsInsideToDb(nextIndex, { clearBeforeSync: false });
      nextIndex += 1;
    }

    // Cron chains server-side; UI client loops with ui=1.
    if (!result.isLast && authorized && !uiChain) {
      triggerNextVehicleSync(nextIndex);
    }

    return NextResponse.json(
      {
        ok: true,
        bootstrap,
        uiChain,
        requestedIndex,
        insideIndex,
        clearBeforeSync,
        nextIndex: result.isLast ? null : nextIndex,
        ...result,
      },
      { status: 200 },
    );
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "";
    const safeMessage =
      rawMessage && rawMessage.trim().length > 0
        ? rawMessage.replace(/wialon/gi, "Track3 Database")
        : "Unknown Track3 Database error.";
    console.error("[api/yards/sync]", safeMessage);
    return NextResponse.json({ ok: false, error: safeMessage, insideIndex: requestedIndex }, { status: 500 });
  }
}
