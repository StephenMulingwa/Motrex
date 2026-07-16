import { NextResponse } from "next/server";
import { getYardsLiveStoredData } from "@/lib/reportStore";

export const dynamic = "force-dynamic";

/** @deprecated Use GET /api/yards instead. Read-only DB snapshot. */
export async function GET() {
  try {
    const data = await getYardsLiveStoredData();
    return NextResponse.json(
      {
        rows: data.rows,
        fetchedAt: new Date().toISOString(),
        lastExecutionTime: data.lastExecutionTime,
        range: { from: data.from, to: data.to },
        syncPending: data.rows.length === 0,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load yards data.";
    console.error("[api/wialon/yards]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
