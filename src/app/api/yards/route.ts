import { NextResponse } from "next/server";
import { getYardsLiveStoredData } from "@/lib/reportStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getYardsLiveStoredData();
    const syncInProgress = data.syncProgress === "in_progress";

    return NextResponse.json(
      {
        rows: data.rows,
        insideRows: data.insideRows ?? [],
        fetchedAt: new Date().toISOString(),
        lastExecutionTime: data.lastExecutionTime,
        lastUpdatedAt: data.lastUpdatedAt ?? data.lastExecutionTime,
        range: { from: data.from, to: data.to },
        syncPending: false,
        syncInProgress,
        syncProgress: data.syncProgress ?? null,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load yards data.";
    console.error("[api/yards]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
