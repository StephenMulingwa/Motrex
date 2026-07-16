import { NextResponse } from "next/server";
import { getYardsLiveStoredData } from "@/lib/reportStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getYardsLiveStoredData();
    const syncInProgress = data.syncProgress === "in_progress";
    const hasUsableData = (data.insideRows?.length ?? 0) > 0 || data.rows.length > 0;
    const lastSyncMs =
      data.lastExecutionTime && data.lastExecutionTime !== "—"
        ? Date.parse(String(data.lastExecutionTime).replace(" EAT", "").replace(" ", "T") + "+03:00")
        : 0;
    const staleSync =
      syncInProgress &&
      !hasUsableData &&
      lastSyncMs > 0 &&
      Date.now() - lastSyncMs > 45 * 60 * 1000;
    // Only auto-bootstrap when there is truly nothing to show (not while last-good day is visible).
    const syncPending = (!hasUsableData && !syncInProgress) || staleSync;

    return NextResponse.json(
      {
        rows: data.rows,
        insideRows: data.insideRows ?? [],
        fetchedAt: new Date().toISOString(),
        lastExecutionTime: data.lastExecutionTime,
        range: { from: data.from, to: data.to },
        syncPending,
        syncInProgress: syncInProgress && !staleSync,
        syncProgress: staleSync ? null : (data.syncProgress ?? null),
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load yards data.";
    console.error("[api/yards]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
