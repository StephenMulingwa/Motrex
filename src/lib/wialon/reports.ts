import type { ReportSnapshotPayload } from "@/lib/data";
import {
  ECO_INLINE_TEMPLATE,
  ECO_RESOURCE_ID,
  GROUP_TRIPS_FALLBACK_BATCH_SIZE,
  MOTREX_GROUP_ID,
  MOTREX_RESOURCE_ID,
  TEMPLATES,
  TRIPS_HISTORICAL_END,
  TRIPS_HISTORICAL_START,
  UTILIZATION_INLINE_TEMPLATE,
  UTILIZATION_RESOURCE_ID,
  type StoredReportType,
} from "@/lib/motrexConfig";
import { dayBoundsUnix, enumerateDates, todayEatDateString } from "@/lib/dateRange";
import { buildMotrexTripTables, matchGroupTripTable } from "@/lib/motrexTrips";
import { registrationKey } from "@/lib/vehicleLabels";
import {
  execReport,
  fetchAllTableData,
  fetchUnitGroupUnitIds,
  getReportTemplateData,
  toNumber,
  wialonLogin,
  wialonLogout,
  type ReportTableMeta,
} from "./client";

export interface ReportExecutionResult {
  reportType: StoredReportType;
  reportDate: string;
  payload: ReportSnapshotPayload;
  rawMeta: Record<string, unknown>;
}

export async function runTemplateReportForBounds(
  sid: string,
  templateId: number,
  from: number,
  to: number,
  reportObjectIdList?: number[],
  forceRemoteExec = false,
): Promise<{ rows: Record<string, string>[]; headers: string[]; tableIndex: number }> {
  const useRemoteExec = forceRemoteExec || (reportObjectIdList?.length ?? 0) > 150;
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

/** Fetch every non-empty table from a Motrex resource template, tagging rows with the table name. */
export async function runTemplateAllTablesForBounds(
  sid: string,
  templateId: number,
  from: number,
  to: number,
  reportObjectIdList?: number[],
  forceRemoteExec = false,
): Promise<{ rows: Record<string, string>[]; tables: Array<{ name: string; rowCount: number; index: number }> }> {
  // Template 62 is avl_unit_group: reportObjectId must be the group; unit IDs go in reportObjectIdList.
  const useRemoteExec = forceRemoteExec || (reportObjectIdList?.length ?? 0) > 25;
  const objectId = MOTREX_GROUP_ID;
  const unitList = reportObjectIdList?.length ? reportObjectIdList : undefined;
  let tables: ReportTableMeta[];
  try {
    ({ tables } = await execReport(sid, {
      resourceId: MOTREX_RESOURCE_ID,
      templateId,
      objectId,
      reportObjectIdList: unitList,
      from,
      to,
      remoteExec: useRemoteExec,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 4/6 = duration/internal; 7 = access denied (often wrong binding or transient ACL on Track3)
    if (!/Track3 Database error (4|6|7)/.test(message)) throw error;
    const template = await getReportTemplateData(sid, MOTREX_RESOURCE_ID, templateId);
    ({ tables } = await execReport(sid, {
      resourceId: MOTREX_RESOURCE_ID,
      objectId,
      reportObjectIdList: unitList,
      from,
      to,
      inlineTemplate: template,
      remoteExec: true,
    }));
  }

  const merged: Record<string, string>[] = [];
  const tableMeta: Array<{ name: string; rowCount: number; index: number }> = [];

  for (let i = 0; i < tables.length; i += 1) {
    if (tables[i].rows <= 0) continue;
    const data = await fetchAllTableData(sid, tables, i);
    const tableName = tables[i].name || `table_${i}`;
    // Prefer known group-trip tables; still keep unnamed detalization if columns look like trips.
    const isKnown = Boolean(matchGroupTripTable(tableName));
    const looksLikeTrip = data.headers.some((h) => /trip\s*from|trip\s*to|beginning/i.test(h));
    if (!isKnown && !looksLikeTrip) continue;

    for (const row of data.rows) {
      merged.push({ ...row, _wialonTable: tableName });
    }
    tableMeta.push({ name: tableName, rowCount: data.rows.length, index: i });
  }

  return { rows: merged, tables: tableMeta };
}

function shouldTripsSplitFallback(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /Track3 Database error (1|4|7|1003|1004|1005|6)|LIMIT exec_report_duration|LIMIT msgs_activity|timeout|temporar|ECONNRESET|ETIMEDOUT|fetch failed|Invalid session|remote report/i.test(
    msg,
  );
}

async function fetchGroupTripsBatchWithFallback(
  from: number,
  to: number,
  unitIds: number[] | undefined,
  label: string,
): Promise<{ rows: Record<string, string>[]; tables: Array<{ name: string; rowCount: number; index: number }> }> {
  type BatchResult = { rows: Record<string, string>[]; tables: Array<{ name: string; rowCount: number; index: number }> };
  const minSplit = GROUP_TRIPS_FALLBACK_BATCH_SIZE;

  async function runFresh(ids: number[] | undefined, attemptLabel: string): Promise<BatchResult> {
    const sid = await wialonLogin();
    try {
      return await withWialonRetry(
        attemptLabel,
        // Always remoteExec for group-rides template — sync often hits error 4 on Track3.
        () => runTemplateAllTablesForBounds(sid, TEMPLATES.groupTrips, from, to, ids, true),
        [60_000, 120_000, 180_000],
      );
    } finally {
      await wialonLogout(sid).catch(() => undefined);
    }
  }

  async function run(ids: number[] | undefined, attemptLabel: string): Promise<BatchResult> {
    try {
      return await runFresh(ids, attemptLabel);
    } catch (error) {
      if (!ids || ids.length <= minSplit || !shouldTripsSplitFallback(error)) throw error;
      const mid = Math.ceil(ids.length / 2);
      console.warn(`${attemptLabel} failed — fallback split: ${mid} + ${ids.length - mid}`);
      await new Promise((r) => setTimeout(r, 15_000));
      const a = await run(ids.slice(0, mid), `${attemptLabel} (${mid})`);
      await new Promise((r) => setTimeout(r, 10_000));
      const b = await run(ids.slice(mid), `${attemptLabel} (${ids.length - mid})`);
      return { rows: [...a.rows, ...b.rows], tables: [...a.tables, ...b.tables] };
    }
  }

  return run(unitIds, label);
}

function splitUtilizationFallbackBatches(unitIds: number[]): [number[], number[]] {
  return [unitIds.slice(0, 305), unitIds.slice(305)];
}

async function fetchUtilizationTripRows(
  sid: string,
  from: number,
  to: number,
  unitIds?: number[],
): Promise<{ rows: Record<string, string>[]; tableIndex: number }> {
  const useBatch = Boolean(unitIds?.length);
  const objectId = MOTREX_GROUP_ID;
  const reportObjectIdList = useBatch ? unitIds : undefined;
  const remoteExec = useBatch && unitIds!.length > 150;

  const { tables } = await execReport(sid, {
    resourceId: UTILIZATION_RESOURCE_ID,
    objectId,
    reportObjectIdList,
    from,
    to,
    inlineTemplate: UTILIZATION_INLINE_TEMPLATE as unknown as Record<string, unknown>,
    remoteExec,
  });

  const tripsTableIdx = tables.findIndex((t) =>
    t.header.some((h) => /mileage|beginning/i.test(h)),
  );
  const idx = tripsTableIdx >= 0 ? tripsTableIdx : 1;
  const data = await fetchAllTableData(sid, tables, idx);
  return { rows: data.rows, tableIndex: idx };
}

async function executeUtilizationForBounds({
  from,
  to,
  reportDate,
  started,
}: {
  from: number;
  to: number;
  reportDate: string;
  started: number;
}): Promise<ReportExecutionResult> {
  let sid = await wialonLogin();
  try {
    const label = `${reportDate} / utilization`;
    let tripRows: Record<string, string>[] = [];
    let tableIndex = 0;
    const extraMeta: Record<string, unknown> = { executionMode: "full_group" };

    const unitIds = await fetchUnitGroupUnitIds(sid, MOTREX_GROUP_ID);
    extraMeta.unitCount = unitIds.length;

    try {
      const full = await withWialonRetry(label, () => fetchUtilizationTripRows(sid, from, to));
      tripRows = full.rows;
      tableIndex = full.tableIndex;
    } catch (error) {
      if (!shouldUtilizationSplitFallback(error)) throw error;

      await wialonLogout(sid).catch(() => undefined);
      sid = await wialonLogin();

      const [batch1, batch2] = splitUtilizationFallbackBatches(unitIds);
      console.warn(
        `${label} timed out — fallback split: ${batch1.length} + ${batch2.length} vehicles (remoteExec)`,
      );

      extraMeta.executionMode = "fallback_split";
      extraMeta.fallbackBatches = [batch1.length, batch2.length];

      const batchMeta: Array<{ batch: number; unitCount: number; rowCount: number; tableIndex: number }> = [];

      for (const [idx, batch] of [batch1, batch2].entries()) {
        if (!batch.length) continue;
        console.log(`  Running utilization fallback batch ${idx + 1}/2 (${batch.length} vehicles) …`);
        const result = await withWialonRetry(`${label} batch ${idx + 1}`, () =>
          fetchUtilizationTripRows(sid, from, to, batch),
        );
        tripRows.push(...result.rows);
        batchMeta.push({
          batch: idx + 1,
          unitCount: batch.length,
          rowCount: result.rows.length,
          tableIndex: result.tableIndex,
        });
        tableIndex = result.tableIndex;
      }
      extraMeta.batches = batchMeta;
    }

    const payload = buildUtilizationPivot(tripRows, reportDate);
    return {
      reportType: "utilization",
      reportDate,
      payload,
      rawMeta: {
        rowCount: tripRows.length,
        tableIndex,
        executionMs: Date.now() - started,
        from,
        to,
        ...extraMeta,
      },
    };
  } finally {
    await wialonLogout(sid).catch(() => undefined);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryWialonError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /Track3 Database error (1|1003|1004|1005)|LIMIT exec_report_duration|LIMIT msgs_activity|timeout|temporar|ECONNRESET|ETIMEDOUT|fetch failed|Invalid session/i.test(msg);
}

/** Full-group utilization failed — try 305+304 split (timeouts, duration limits, Wialon error 6). */
function shouldUtilizationSplitFallback(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return shouldRetryWialonError(error) || /Track3 Database error 6/i.test(msg);
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

    const vehicle = registrationKey(vehicleKey ? String(row[vehicleKey] ?? "").trim() : "");
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
  from,
  to,
  reportDate,
  intervalStart,
  intervalEnd,
  started,
}: {
  from: number;
  to: number;
  reportDate: string;
  intervalStart: string;
  intervalEnd: string;
  started: number;
}): Promise<ReportExecutionResult> {
  const sid = await wialonLogin();
  let unitIds: number[];
  try {
    unitIds = await fetchUnitGroupUnitIds(sid, MOTREX_GROUP_ID);
  } finally {
    await wialonLogout(sid).catch(() => undefined);
  }

  const rawTripRows: Record<string, string>[] = [];
  const batchMeta: Array<{
    batch: number;
    unitCount: number;
    rowCount: number;
    tables: Array<{ name: string; rowCount: number; index: number }>;
  }> = [];

  const dates = enumerateDates(intervalStart, intervalEnd);
  const useDaily = dates.length > 1;

  if (useDaily) {
    console.log(
      `  Group Trips (template ${TEMPLATES.groupTrips}): ${dates.length} day-by-day full-group runs (${unitIds.length} vehicles)…`,
    );
    for (const [idx, dateStr] of dates.entries()) {
      console.log(`  Running group trips day ${idx + 1}/${dates.length} (${dateStr}) …`);
      const dayBounds = dayBoundsUnix(dateStr);
      const result = await fetchGroupTripsBatchWithFallback(
        dayBounds.from,
        dayBounds.to,
        undefined,
        `${dateStr} / group trips day`,
      );
      rawTripRows.push(...result.rows);
      batchMeta.push({
        batch: idx + 1,
        unitCount: unitIds.length,
        rowCount: result.rows.length,
        tables: result.tables,
      });
      await new Promise((r) => setTimeout(r, 5_000));
    }
  } else {
    console.log(
      `  Group Trips (template ${TEMPLATES.groupTrips}): full Motrex group (${unitIds.length} vehicles) for ${intervalStart}…`,
    );
    const full = await fetchGroupTripsBatchWithFallback(
      from,
      to,
      undefined,
      `${intervalStart} → ${intervalEnd} / group trips full group`,
    );
    rawTripRows.push(...full.rows);
    batchMeta.push({
      batch: 1,
      unitCount: unitIds.length,
      rowCount: full.rows.length,
      tables: full.tables,
    });
  }

  const tripRows = buildMotrexTripTables(rawTripRows, reportDate);
  return {
    reportType: "trips",
    reportDate,
    payload: { rows: tripRows },
    rawMeta: {
      templateId: TEMPLATES.groupTrips,
      templateName: "SM_Motrex - Group Trips",
      rowCount: tripRows.length,
      rawRowCount: rawTripRows.length,
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

async function executeEcoDrivingForBounds({
  sid,
  from,
  to,
  extraMeta,
}: {
  sid: string;
  from: number;
  to: number;
  extraMeta: Record<string, unknown>;
}): Promise<{ payload: ReportSnapshotPayload; rowCount: number; tableIndex: number }> {
  let tables;
  try {
    ({ tables } = await execReport(sid, {
      resourceId: ECO_RESOURCE_ID,
      objectId: MOTREX_GROUP_ID,
      from,
      to,
      inlineTemplate: ECO_INLINE_TEMPLATE as unknown as Record<string, unknown>,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Track3 Database error (4|6|1003|1005)/.test(message)) throw error;
    console.warn(`  Eco Driving sync failed (${message}) — retrying with remoteExec`);
    ({ tables } = await execReport(sid, {
      resourceId: ECO_RESOURCE_ID,
      objectId: MOTREX_GROUP_ID,
      from,
      to,
      inlineTemplate: ECO_INLINE_TEMPLATE as unknown as Record<string, unknown>,
      remoteExec: true,
    }));
  }
  const ecoIdx = tables.findIndex((t) =>
    t.header.some((h) => /violation|mileage/i.test(h)),
  );
  const tableIndex = ecoIdx >= 0 ? ecoIdx : 1;
  const data = await fetchAllTableData(sid, tables, tableIndex);
  extraMeta.executionMode = "full_group";
  extraMeta.unitCount = 609;
  return { payload: buildEcoPivot(data.rows), rowCount: data.rows.length, tableIndex };
}

export async function executeStoredReport(
  reportType: StoredReportType,
  dateStr: string,
): Promise<ReportExecutionResult> {
  const started = Date.now();
  const bounds = dayBoundsUnix(dateStr);
  const from = bounds.from;
  const to =
    (reportType === "yards" || reportType === "trips") && dateStr === todayEatDateString()
      ? Math.min(bounds.to, Math.floor(Date.now() / 1000))
      : bounds.to;

  if (reportType === "utilization") {
    return executeUtilizationForBounds({ from, to, reportDate: dateStr, started });
  }

  if (reportType === "trips") {
    return executeTripsForBounds({
      from,
      to,
      reportDate: dateStr,
      intervalStart: dateStr,
      intervalEnd: dateStr,
      started,
    });
  }

  const sid = await wialonLogin();

  try {
    let payload: ReportSnapshotPayload = { rows: [] };
    let rowCount = 0;
    let tableIndex = 0;
    const extraMeta: Record<string, unknown> = {};

    if (reportType === "yards") {
      const result = await runTemplateReportForBounds(sid, TEMPLATES.yards, from, to);
      payload = { rows: result.rows };
      rowCount = result.rows.length;
      tableIndex = result.tableIndex;
    } else if (reportType === "eco_driving") {
      const result = await executeEcoDrivingForBounds({ sid, from, to, extraMeta });
      payload = result.payload;
      rowCount = result.rowCount;
      tableIndex = result.tableIndex;
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
  const { from } = dayBoundsUnix(TRIPS_HISTORICAL_START);
  const { to } = dayBoundsUnix(TRIPS_HISTORICAL_END);
  console.log(`  Historical trips interval: ${TRIPS_HISTORICAL_START} 00:00 → ${TRIPS_HISTORICAL_END} 23:59`);
  return executeTripsForBounds({
    from,
    to,
    reportDate: TRIPS_HISTORICAL_END,
    intervalStart: TRIPS_HISTORICAL_START,
    intervalEnd: TRIPS_HISTORICAL_END,
    started,
  });
}

/** Execute SM_Motrex - Group Trips (template 62) for an arbitrary date range (week). */
export async function executeGroupTripsWeek(
  weekStart: string,
  weekEnd: string,
): Promise<ReportExecutionResult> {
  const started = Date.now();
  const { from } = dayBoundsUnix(weekStart);
  const { to } = dayBoundsUnix(weekEnd);
  console.log(`  Group trips week: ${weekStart} 00:00 → ${weekEnd} 23:59`);
  return executeTripsForBounds({
    from,
    to,
    reportDate: weekEnd,
    intervalStart: weekStart,
    intervalEnd: weekEnd,
    started,
  });
}

export async function executeAllStoredReports(dateStr: string): Promise<ReportExecutionResult[]> {
  const types: StoredReportType[] = ["yards", "trips", "utilization", "eco_driving"];
  const results: ReportExecutionResult[] = [];
  for (const t of types) {
    results.push(await withWialonRetry(`${dateStr} / ${t}`, () => executeStoredReport(t, dateStr)));
  }
  return results;
}
