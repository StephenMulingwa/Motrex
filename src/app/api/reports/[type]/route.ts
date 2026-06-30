import { NextResponse } from "next/server";
import { STORED_REPORT_TYPES, type StoredReportType } from "@/lib/motrexConfig";
import { getStoredReportData } from "@/lib/reportStore";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ type: string }> },
) {
  try {
    const { type } = await context.params;
    const reportType = type as StoredReportType;
    if (!STORED_REPORT_TYPES.includes(reportType)) {
      return NextResponse.json({ error: "Unknown report type." }, { status: 400 });
    }

    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? "2026-06-01";
    const to = url.searchParams.get("to") ?? "2026-06-28";

    return NextResponse.json(await getStoredReportData(reportType, from, to));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load report data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
