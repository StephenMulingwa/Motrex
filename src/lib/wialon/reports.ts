import type { ReportSnapshotPayload } from "@/lib/data";
import {
  ECO_INLINE_TEMPLATE,
  ECO_RESOURCE_ID,
  MOTREX_GROUP_ID,
  MOTREX_RESOURCE_ID,
  TEMPLATES,
  TRIPS_HISTORICAL_END,
  TRIPS_HISTORICAL_START,
  UTILIZATION_INLINE_TEMPLATE,
  UTILIZATION_RESOURCE_ID,
  type StoredReportType,
} from "@/lib/motrexConfig";
import { dayBoundsUnix, todayEatDateString } from "@/lib/dateRange";
import { buildMotrexTripTables } from "@/lib/motrexTrips";
import {
  execReport,
  fetchAllTableData,
  fetchUnitGroupUnitIds,
  getReportTemplateData,
  toNumber,
  wialonLogin,
  wialonLogout,
} from "./client";

export interface ReportExecutionResult {
  reportType: StoredReportType;
  reportDate: string;
  payload: ReportSnapshotPayload;
  rawMeta: Record<string, unknown>;
}

async function runTemplateReportForBounds(
  sid: string,
  templateId: number,
  from: number,
  to: number,
  reportObjectIdList?: number[],
): Promise<{ rows: Record<string, string>[]; headers: string[]; tableIndex: number }> {
  const useRemoteExec = (reportObjectIdList?.length ?? 0) > 150;
  const objectId = reportObjectIdList?.[0] ?? MOTREX_GROUP_ID;
  const extraObjectIds = reportObjectIdList?.length ? reportObjectIdList.slice(1) : undefined;
  let tables;
  try {
    ({ tables } = await execReport(sid, {
      resourceId: MOTREX_RESOURCE_ID,
      templateId,
      objectId,
      reportObjectIdList: extraObjectIds,
      from,
      to,
      remoteExec: useRemoteExec,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Track3 Database error (4|6)/.test(message)) throw error;
    const template = await getReportTemplateData(sid, MOTREX_RESOURCE_ID, templateId);
    ({ tables } = await execReport(sid, {
      resourceId: MOTREX_RESOURCE_ID,
      objectId,
      reportObjectIdList: extraObjectIds,
      from,
      to,
      inlineTemplate: template,
      remoteExec: useRemoteExec,
    }));
  }

  let best = { rows: [] as Record<string, string>[], headers: [] as string[], tableIndex: 0 };
  for (let i = 0; i < tables.length; i += 1) {
    if (tables[i].rows <= 0) continue;
    const data = await fetchAllTableData(sid, tables, i);
    if (data.rows.length >= best.rows.length) {
      best = { ...data, tableIndex: i };
    }
  }
  return best;
}

function splitTripsBatches<T>(items: T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < 5; i += 1) {
    batches.push(items.slice(i * 100, i * 100 + 100));
  }
  batches.push(items.slice(500));
  return batches.filter((batch) => batch.length > 0);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryWialonError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /Track3 Database error 1005|LIMIT exec_report_duration|timeout|temporar|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
}

export async function withWialonRetry<T>(
  label: string,
  run: () => Promise<T>,
  delaysMs = [60_000, 120_000, 180_000],
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt >= delaysMs.length || !shouldRetryWialonError(error)) throw error;
      const waitMs = delaysMs[attempt];
      console.warn(`${label} failed (${error instanceof Error ? error.message : String(error)}). Retrying in ${Math.round(waitMs / 1000)}s.`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

function buildUtilizationPivot(
  tripRows: Record<string, string>[],
  dateStr: string,
): ReportSnapshotPayload {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dayNum = d;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dt = new Date(`${dateStr}T12:00:00+03:00`);
  const dayFormatted = `${dayNames[dt.getDay()].slice(0, 2)}-${dayNum}`;

  const pivot: Record<string, Record<string, number>> = {};
  const rawRows: Record<string, string | number>[] = [];

  for (const row of tripRows) {
    const vehicleKey = Object.keys(row).find((k) => /group|vehicle/i.test(k));
    const mileageKey = Object.keys(row).find((k) => /mileage|distance/i.test(k));
    const beginningKey = Object.keys(row).find((k) => /beginning|time/i.test(k));

    const vehicle = vehicleKey ? String(row[vehicleKey] ?? "").trim() : "";
    if (!vehicle || vehicle === "-----") continue;

    const mileageRaw = mileageKey ? String(row[mileageKey] ?? "") : "0";
    const mileage = toNumber(mileageRaw.replace(/ km/i, ""));

    if (!pivot[vehicle]) pivot[vehicle] = {};
    pivot[vehicle][dayFormatted] = (pivot[vehicle][dayFormatted] ?? 0) + mileage;

    rawRows.push({
      vehicle,
      day: dayFormatted,
      date: dateStr,
      mileageKm: mileage,
      beginning: beginningKey ? row[beginningKey] : "",
    });
  }

  const columns = [dayFormatted];
  const totalDistance = Object.values(pivot).reduce(
    (sum, days) => sum + (days[dayFormatted] ?? 0),
    0,
  );

  return {
    rows: rawRows,
    pivot,
    columns,
    summary: {
      month: m,
      year: y,
      dayFormatted,
      totalDistanceKm: Math.round(totalDistance * 100) / 100,
      vehicleCount: Object.keys(pivot).length,
    },
  };
}

function buildEcoPivot(ecoRows: Record<string, string>[]): ReportSnapshotPayload {
  const pivot: Record<string, Record<string, number>> = {};
  const rawRows: Record<string, string | number>[] = [];

  for (const row of ecoRows) {
    const groupKey = Object.keys(row).find((k) => /group|vehicle/i.test(k));
    const violationKey = Object.keys(row).find((k) => /violation/i.test(k));
    const countKey = Object.keys(row).find((k) => /count/i.test(k));

    const grouping = groupKey ? String(row[groupKey] ?? "").trim() : "";
    const violation = violationKey ? String(row[violationKey] ?? "").trim() : "";
    const count = countKey ? toNumber(row[countKey]) : 0;

    if (!grouping || !violation || violation === "-----" || count <= 0) continue;

    if (!pivot[grouping]) pivot[grouping] = {};
    pivot[grouping][violation] = (pivot[grouping][violation] ?? 0) + count;

    rawRows.push({ grouping, violation, count });
  }

  const violationSet = new Set<string>();
  for (const v of Object.values(pivot)) {
    for (const k of Object.keys(v)) violationSet.add(k);
  }

  return {
    rows: rawRows,
    pivot,
    columns: Array.from(violationSet).sort(),
    summary: { violationTypes: violationSet.size, vehicleCount: Object.keys(pivot).length },
  };
}

async function executeTripsForBounds({
  sid,
  from,
  to,
  reportDate,
  intervalStart,
  intervalEnd,
  started,
}: {
  sid: string;
  from: number;
  to: number;
  reportDate: string;
  intervalStart: string;
  intervalEnd: string;
  started: number;
}): Promise<ReportExecutionResult> {
  const unitIds = await fetchUnitGroupUnitIds(sid, MOTREX_GROUP_ID);
  const batches = splitTripsBatches(unitIds);
  const rawTripRows: Record<string, string>[] = [];
  const batchMeta: Array<{ batch: number; unitCount: number; rowCount: number; tableIndex: number }> = [];
  let tableIndex = 0;

  console.log(`  Trips unit batches: ${batches.map((batch) => batch.length).join(" + ")} vehicles`);

  for (const [idx, batch] of batches.entries()) {
    console.log(`  Running trips batch ${idx + 1}/${batches.length} (${batch.length} vehicles) …`);
    const result = await withWialonRetry(
      `${intervalStart} → ${intervalEnd} / trips batch ${idx + 1}`,
      () => runTemplateReportForBounds(sid, TEMPLATES.athiTororoTrips, from, to, batch),
    );
    rawTripRows.push(...result.rows);
    batchMeta.push({
      batch: idx + 1,
      unitCount: batch.length,
      rowCount: result.rows.length,
      tableIndex: result.tableIndex,
    });
    tableIndex = result.tableIndex;
  }

  const tripRows = buildMotrexTripTables(rawTripRows, reportDate);
  return {
    reportType: "trips",
    reportDate,
    payload: { rows: tripRows },
    rawMeta: {
      rowCount: tripRows.length,
      rawRowCount: rawTripRows.length,
      tableIndex,
      executionMs: Date.now() - started,
      from,
      to,
      intervalStart,
      intervalEnd,
      weekStart: intervalStart,
      weekEnd: intervalEnd,
      batchCount: batchMeta.length,
      unitCount: unitIds.length,
      batches: batchMeta,
    },
  };
}

export async function executeStoredReport(
  reportType: StoredReportType,
  dateStr: string,
): Promise<ReportExecutionResult> {
  const started = Date.now();
  const sid = await wialonLogin();

  try {
    const bounds = dayBoundsUnix(dateStr);
    const from = bounds.from;
    const to =
      (reportType === "yards" || reportType === "trips") && dateStr === todayEatDateString()
        ? Math.min(bounds.to, Math.floor(Date.now() / 1000))
        : bounds.to;
    let payload: ReportSnapshotPayload = { rows: [] };
    let rowCount = 0;
    let tableIndex = 0;
    const extraMeta: Record<string, unknown> = {};

    if (reportType === "yards") {
      const result = await runTemplateReportForBounds(sid, TEMPLATES.yards, from, to);
      payload = { rows: result.rows };
      rowCount = result.rows.length;
      tableIndex = result.tableIndex;
    } else if (reportType === "trips") {
      return executeTripsForBounds({
        sid,
        from,
        to,
        reportDate: dateStr,
        intervalStart: dateStr,
        intervalEnd: dateStr,
        started,
      });
    } else if (reportType === "utilization") {
      const { tables } = await execReport(sid, {
        resourceId: UTILIZATION_RESOURCE_ID,
        objectId: MOTREX_GROUP_ID,
        from,
        to,
        inlineTemplate: UTILIZATION_INLINE_TEMPLATE as unknown as Record<string, unknown>,
      });
      const tripsTableIdx = tables.findIndex((t) =>
        t.header.some((h) => /mileage|beginning/i.test(h)),
      );
      const idx = tripsTableIdx >= 0 ? tripsTableIdx : 1;
      const data = await fetchAllTableData(sid, tables, idx);
      payload = buildUtilizationPivot(data.rows, dateStr);
      rowCount = data.rows.length;
      tableIndex = idx;
    } else if (reportType === "eco_driving") {
      const { tables } = await execReport(sid, {
        resourceId: ECO_RESOURCE_ID,
        objectId: MOTREX_GROUP_ID,
        from,
        to,
        inlineTemplate: ECO_INLINE_TEMPLATE as unknown as Record<string, unknown>,
      });
      const ecoIdx = tables.findIndex((t) =>
        t.header.some((h) => /violation|mileage/i.test(h)),
      );
      const idx = ecoIdx >= 0 ? ecoIdx : 1;
      const data = await fetchAllTableData(sid, tables, idx);
      payload = buildEcoPivot(data.rows);
      rowCount = data.rows.length;
      tableIndex = idx;
    }

    return {
      reportType,
      reportDate: dateStr,
      payload,
      rawMeta: {
        rowCount,
        tableIndex,
        executionMs: Date.now() - started,
        from,
        to,
        ...extraMeta,
      },
    };
  } finally {
    await wialonLogout(sid);
  }
}

export async function executeHistoricalTripsReport(): Promise<ReportExecutionResult> {
  const started = Date.now();
  const sid = await wialonLogin();
  try {
    const { from } = dayBoundsUnix(TRIPS_HISTORICAL_START);
    const { to } = dayBoundsUnix(TRIPS_HISTORICAL_END);
    console.log(`  Historical trips interval: ${TRIPS_HISTORICAL_START} 00:00 → ${TRIPS_HISTORICAL_END} 23:59`);
    return executeTripsForBounds({
      sid,
      from,
      to,
      reportDate: TRIPS_HISTORICAL_END,
      intervalStart: TRIPS_HISTORICAL_START,
      intervalEnd: TRIPS_HISTORICAL_END,
      started,
    });
  } finally {
    await wialonLogout(sid);
  }
}

export async function executeAllStoredReports(dateStr: string): Promise<ReportExecutionResult[]> {
  const types: StoredReportType[] = ["yards", "trips", "utilization", "eco_driving"];
  const results: ReportExecutionResult[] = [];
  for (const t of types) {
    results.push(await withWialonRetry(`${dateStr} / ${t}`, () => executeStoredReport(t, dateStr)));
  }
  return results;
}
