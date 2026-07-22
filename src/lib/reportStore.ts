import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  cronRuns,
  motrexEcoDriving,
  motrexTrips,
  motrexTripsSummary,
  motrexUtilization,
  motrexYards,
  reportSnapshots,
} from "@/db/schema";
import type { ReportSnapshotPayload } from "@/lib/data";
import type { StoredReportType } from "@/lib/motrexConfig";
import type { ReportExecutionResult } from "@/lib/wialon/reports";
import { parseDurationSeconds } from "./duration";
import { enumerateWeeksInRange, formatEatDateTime, getYardsLiveRange, todayEatDateString } from "./dateRange";
import {
  executeTripsSummaryBatchWithFallback,
  fetchMotrexUnitIds,
  formatWialonDurationSec,
  metricsFromSummaryRawRow,
  splitSummaryBatches,
  type TripsSummaryMappedRow,
} from "./wialon/tripsSummary";
import { formatTimeSince } from "./formatDuration";
import { parseDateTimeMs } from "./parseDateTime";
import { registrationKey, registrationLabel } from "./vehicleLabels";
import { fetchYardsLiveForVehicleIndex } from "./wialon/yards";
import { discoverYardsInsideUnits, fetchYardsLiveForUnitId, type YardsInsideUnit } from "./wialon/yardsInside";
import { computeYardsInside, computeInsideSummaryFromVisits, isOpenVisit, type YardsInsideRow } from "./yardsGeofence";

export interface StoredReportResponse {
  reportType: StoredReportType;
  from: string;
  to: string;
  snapshotCount: number;
  totalRows?: number;
  rows: Record<string, unknown>[];
  insideRows?: YardsInsideRow[];
  pivot: Record<string, Record<string, number>>;
  columns: string[];
  snapshots: Array<{ reportDate: string; rowCount: number; meta: Record<string, unknown> | null }>;
  /** Formatted EAT timestamp of the newest row in the selected range. */
  lastUpdatedAt?: string | null;
  syncProgress?: "in_progress" | "complete";
  syncInProgress?: boolean;
}

function pickKey(row: Record<string, unknown>, patterns: RegExp[]): string | null {
  for (const key of Object.keys(row)) {
    const lower = key.toLowerCase();
    if (patterns.some((p) => p.test(lower))) return key;
  }
  return null;
}

function value(row: Record<string, unknown>, key: string | null): string {
  return key ? String(row[key] ?? "").trim() : "";
}

function normalizeRegistration(row: Record<string, unknown>): string {
  const regKey = pickKey(row, [/registration|reg\s*no|plate|number/i]);
  const vehicleKey = pickKey(row, [/^vehicle$|vehicle|unit|group|name/i]);
  return registrationLabel(value(row, regKey) || value(row, vehicleKey) || "Unknown");
}

function normalizeVehicle(row: Record<string, unknown>): string {
  const vehicleKey = pickKey(row, [/^vehicle$|vehicle|unit|group|name/i]);
  return registrationLabel(value(row, vehicleKey) || normalizeRegistration(row));
}

function mergePivotValue(pivot: Record<string, Record<string, number>>, vehicle: string, column: string, value: number) {
  const key = registrationKey(vehicle || "Unknown") || "UNKNOWN";
  if (!pivot[key]) pivot[key] = {};
  pivot[key][column] = (pivot[key][column] ?? 0) + value;
}

function tripMetric(row: Record<string, unknown>, column: string): string | null {
  const direct = row[column];
  if (direct == null || direct === "") return null;
  return String(direct);
}

function dayLabelSortValue(label: string): number {
  const match = label.match(/-(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function upsertDedicatedReport(result: ReportExecutionResult): Promise<void> {
  const db = getDb();
  const rows = result.payload.rows ?? [];
  const now = new Date();

  if (result.reportType === "yards") {
    await clearYardsForDate(result.reportDate);
    await insertYardsRows(result.reportDate, rows, now);
    return;
  }

  if (result.reportType === "trips") {
    const weekStart = String(result.rawMeta.weekStart ?? result.rawMeta.intervalStart ?? result.reportDate);
    const weekEnd = String(result.rawMeta.weekEnd ?? result.rawMeta.intervalEnd ?? result.reportDate);
    // Per-unit sync already upserts vehicle-by-vehicle; do not wipe the interval.
    if (result.rawMeta.mode === "per_unit") return;
    await db
      .delete(motrexTrips)
      .where(and(eq(motrexTrips.weekStart, weekStart), eq(motrexTrips.weekEnd, weekEnd)));
    if (!rows.length) return;
    await db.insert(motrexTrips).values(tripRowInsertValues(weekStart, weekEnd, rows, now));
    return;
  }

  if (result.reportType === "utilization") {
    await db.delete(motrexUtilization).where(eq(motrexUtilization.reportDate, result.reportDate));
    if (!rows.length) return;
    await db.insert(motrexUtilization).values(
      rows.map((row) => ({
        reportDate: result.reportDate,
        registrationNumber: registrationLabel(String(row.vehicle ?? normalizeRegistration(row))),
        dayLabel: String(row.day ?? result.rawMeta.dayFormatted ?? result.reportDate),
        mileageKm: Number(row.mileageKm ?? 0),
        rawRow: row,
        updatedAt: now,
      })),
    );
    return;
  }

  if (result.reportType === "eco_driving") {
    await db.delete(motrexEcoDriving).where(eq(motrexEcoDriving.reportDate, result.reportDate));
    if (!rows.length) return;
    const values = rows.map((row) => ({
        reportDate: result.reportDate,
        registrationNumber: registrationLabel(String(row.grouping ?? normalizeRegistration(row))),
        violation: String(row.violation ?? ""),
        count: Number(row.count ?? 0),
        rawRow: row,
        updatedAt: now,
    }));
    for (const batch of chunks(values, 5000)) {
      await db.insert(motrexEcoDriving).values(batch);
    }
  }
}

export async function upsertReportSnapshot(result: ReportExecutionResult): Promise<void> {
  const db = getDb();
  await upsertDedicatedReport(result);
  await db
    .insert(reportSnapshots)
    .values({
      reportType: result.reportType,
      reportDate: result.reportDate,
      payload: result.payload as Record<string, unknown>,
      rawMeta: result.rawMeta,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [reportSnapshots.reportType, reportSnapshots.reportDate],
      set: {
        payload: result.payload as Record<string, unknown>,
        rawMeta: result.rawMeta,
        updatedAt: new Date(),
      },
    });
}

function yardsRowValues(reportDate: string, rows: Record<string, unknown>[], now: Date) {
  return rows.map((row) => {
    const geofenceKey = pickKey(row, [/geofence|geozone/i]);
    const timeInKey = pickKey(row, [/time\s*in|beginning|entry/i]);
    const timeOutKey = pickKey(row, [/time\s*out|end|exit/i]);
    const durationKey = pickKey(row, [/duration/i]);
    return {
      reportDate,
      registrationNumber: normalizeRegistration(row),
      vehicle: normalizeVehicle(row),
      geofence: value(row, geofenceKey),
      timeIn: value(row, timeInKey) || null,
      timeOut: value(row, timeOutKey) || null,
      durationSeconds: parseDurationSeconds(value(row, durationKey)),
      status: /out\s+of\s+geofence/i.test(value(row, geofenceKey))
        ? "Out"
        : isOpenVisit(value(row, timeOutKey))
          ? "Inside"
          : "Out",
      lastExecutionTime: formatEatDateTime(now),
      rawRow: row,
      updatedAt: now,
    };
  });
}

async function clearYardsForDate(reportDate: string): Promise<void> {
  const db = getDb();
  await db.delete(motrexYards).where(eq(motrexYards.reportDate, reportDate));
}

/** Remove rows older than the day before reportDate (always keep yesterday as last-good). */
async function clearYardsBeforeDate(reportDate: string): Promise<void> {
  const db = getDb();
  // Keep reportDate and the previous calendar day so a same-day re-sync wipe still has fallback data.
  await db.execute(sql`
    DELETE FROM motrex_yards
    WHERE report_date < (${reportDate}::date - INTERVAL '1 day')
  `);
}

/** Remove all Vipingo/Tororo / Group Trips rows and trip snapshots. */
export async function clearAllTrips(): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute(sql`DELETE FROM motrex_trips`);
  await db.execute(sql`DELETE FROM report_snapshots WHERE report_type = 'trips'`);
}

function tripRowInsertValues(
  weekStart: string,
  weekEnd: string,
  rows: Record<string, unknown>[],
  now = new Date(),
) {
  return rows.map((row) => ({
    weekStart,
    weekEnd,
    tripType: String(row.Table ?? "Raw"),
    routePair: tripMetric(row, "Route Pair"),
    registrationNumber: normalizeRegistration(row),
    vehicle: normalizeVehicle(row),
    grouping: tripMetric(row, "Grouping"),
    trip: tripMetric(row, "Trip"),
    tripFrom: tripMetric(row, "Trip from") || tripMetric(row, "From") || tripMetric(row, "Loading Zone"),
    tripTo: tripMetric(row, "Trip to") || tripMetric(row, "To") || tripMetric(row, "Offloading Zone"),
    beginning: tripMetric(row, "Beginning") || tripMetric(row, "Departure Time"),
    end: tripMetric(row, "End") || tripMetric(row, "Arrival Time"),
    mileage: tripMetric(row, "Mileage"),
    consumedByAbsFcs: tripMetric(row, "Consumed by AbsFCS"),
    avgConsumptionByAbsFcs: tripMetric(row, "Avg consumption by AbsFCS"),
    tripDuration: tripMetric(row, "Trip duration") || tripMetric(row, "Transit Time"),
    totalTime: tripMetric(row, "Total time"),
    parkingsDuration: tripMetric(row, "Parkings duration"),
    avgSpeed: tripMetric(row, "Avg speed"),
    maxSpeed: tripMetric(row, "Max speed"),
    initialFuelLevel: tripMetric(row, "Initial fuel level"),
    finalFuelLevel: tripMetric(row, "Final fuel level"),
    count: tripMetric(row, "Count") || tripMetric(row, "Trip Count"),
    rawRow: row,
    updatedAt: now,
  }));
}

/**
 * Resume-safe upsert: replace only the given vehicles' rows for the interval.
 * Empty rows are a no-op (unit had no trips).
 */
export async function upsertTripsVehicleRows(
  weekStart: string,
  weekEnd: string,
  rows: Record<string, unknown>[],
): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const db = getDb();
  const now = new Date();
  const registrations = [
    ...new Set(rows.map((row) => registrationKey(normalizeRegistration(row))).filter(Boolean)),
  ];
  for (const reg of registrations) {
    await db.execute(sql`
      DELETE FROM motrex_trips
      WHERE week_start = ${weekStart}::date
        AND week_end = ${weekEnd}::date
        AND regexp_replace(upper(registration_number), '[^A-Z0-9]', '', 'g') = ${reg}
    `);
  }
  for (const batch of chunks(tripRowInsertValues(weekStart, weekEnd, rows, now), 2000)) {
    await db.insert(motrexTrips).values(batch);
  }
  return rows.length;
}

export type GroupTripsSyncMeta = {
  syncProgress: "in_progress" | "complete";
  lastUnitIndex: number;
  unitCount: number;
  unitIds?: number[];
  templateId?: number;
  mode?: string;
  lastSyncAt?: string;
  lastUnitRowCount?: number;
  lastTables?: unknown;
  intervalStart?: string;
  intervalEnd?: string;
  [key: string]: unknown;
};

/** Snapshot key for a group-trips interval (prefer interval start). */
export function groupTripsSnapshotDate(intervalStart: string): string {
  return intervalStart;
}

export async function getGroupTripsSyncMeta(
  intervalStart: string,
  intervalEnd: string,
): Promise<GroupTripsSyncMeta | null> {
  await ensureSchema();
  const db = getDb();
  const [snap] = await db
    .select()
    .from(reportSnapshots)
    .where(
      and(
        eq(reportSnapshots.reportType, "trips"),
        eq(reportSnapshots.reportDate, groupTripsSnapshotDate(intervalStart)),
      ),
    )
    .limit(1);
  if (!snap?.rawMeta) return null;
  const meta = snap.rawMeta as GroupTripsSyncMeta;
  if (meta.intervalEnd && String(meta.intervalEnd) !== intervalEnd) {
    // Different bounds under same start key — still return for resume of this start.
  }
  return meta;
}

export async function saveGroupTripsSyncMeta(
  intervalStart: string,
  intervalEnd: string,
  meta: GroupTripsSyncMeta,
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const reportDate = groupTripsSnapshotDate(intervalStart);
  const rawMeta: GroupTripsSyncMeta = {
    ...meta,
    intervalStart,
    intervalEnd,
    weekStart: intervalStart,
    weekEnd: intervalEnd,
    mode: meta.mode ?? "per_unit",
  };
  await db
    .insert(reportSnapshots)
    .values({
      reportType: "trips",
      reportDate,
      payload: { rows: [] },
      rawMeta,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [reportSnapshots.reportType, reportSnapshots.reportDate],
      set: {
        rawMeta,
        updatedAt: new Date(),
      },
    });
}

export interface GroupTripsUnitSyncResult {
  unitIndex: number;
  unitCount: number;
  unitId: number;
  rawRowCount: number;
  storedRowCount: number;
  isLast: boolean;
  intervalStart: string;
  intervalEnd: string;
  syncProgress: "in_progress" | "complete";
  tables: Array<{ name: string; rowCount: number; index: number }>;
}

/** Sync one Motrex unit for Group Trips (template 62) over [intervalStart, intervalEnd]. */
export async function syncGroupTripsUnitToDb(
  unitIndex: number,
  options: {
    intervalStart: string;
    intervalEnd: string;
    clearBeforeSync?: boolean;
    /** overlap = rolling cron window; exact = single interval bucket only */
    clearMode?: "overlap" | "exact";
    unitIds?: number[];
    retryDelaysMs?: number[];
  },
): Promise<GroupTripsUnitSyncResult> {
  await ensureSchema();
  const { intervalStart, intervalEnd, clearBeforeSync = false } = options;
  const clearMode = options.clearMode ?? "overlap";
  const { dayBoundsUnix } = await import("./dateRange");
  const { buildMotrexTripTables } = await import("./motrexTrips");
  const {
    runGroupTripsForUnit,
    withWialonRetry,
  } = await import("./wialon/reports");
  const { fetchUnitGroupUnitIds, wialonLogin, wialonLogout } = await import("./wialon/client");
  const { MOTREX_GROUP_ID, TEMPLATES } = await import("./motrexConfig");

  if (clearBeforeSync && unitIndex === 0) {
    if (clearMode === "exact") {
      await dbDeleteTripsForInterval(intervalStart, intervalEnd);
    } else {
      await clearTripsOverlappingRange(intervalStart, intervalEnd);
    }
  }

  let unitIds = options.unitIds;
  if (!unitIds?.length) {
    const existing = await getGroupTripsSyncMeta(intervalStart, intervalEnd);
    if (Array.isArray(existing?.unitIds) && existing.unitIds.length) {
      unitIds = existing.unitIds.map(Number);
    } else {
      const sid = await wialonLogin();
      try {
        unitIds = await fetchUnitGroupUnitIds(sid, MOTREX_GROUP_ID);
      } finally {
        await wialonLogout(sid).catch(() => undefined);
      }
    }
  }

  if (unitIndex < 0 || unitIndex >= unitIds.length) {
    throw new Error(`unitIndex ${unitIndex} out of range (0…${unitIds.length - 1})`);
  }

  const unitId = unitIds[unitIndex];
  const { from } = dayBoundsUnix(intervalStart);
  const { to } = dayBoundsUnix(intervalEnd);
  const label = `${intervalStart} → ${intervalEnd} / unit ${unitIndex + 1}/${unitIds.length} (${unitId})`;

  const result = await withWialonRetry(
    label,
    async () => {
      const sid = await wialonLogin();
      try {
        return await runGroupTripsForUnit(sid, unitId, from, to);
      } finally {
        await wialonLogout(sid).catch(() => undefined);
      }
    },
    options.retryDelaysMs ?? [45_000, 90_000, 150_000],
  );

  const tripRows = buildMotrexTripTables(result.rows, intervalEnd);
  await upsertTripsVehicleRows(intervalStart, intervalEnd, tripRows);
  const isLast = unitIndex >= unitIds.length - 1;
  await saveGroupTripsSyncMeta(intervalStart, intervalEnd, {
    syncProgress: isLast ? "complete" : "in_progress",
    lastUnitIndex: unitIndex,
    unitCount: unitIds.length,
    unitIds,
    templateId: TEMPLATES.groupTrips,
    mode: "per_unit",
    lastSyncAt: new Date().toISOString(),
    lastUnitRowCount: result.rows.length,
    lastTables: result.tables,
  });

  return {
    unitIndex,
    unitCount: unitIds.length,
    unitId,
    rawRowCount: result.rows.length,
    storedRowCount: tripRows.length,
    isLast,
    intervalStart,
    intervalEnd,
    syncProgress: isLast ? "complete" : "in_progress",
    tables: result.tables,
  };
}

async function dbDeleteTripsForInterval(weekStart: string, weekEnd: string): Promise<void> {
  const db = getDb();
  await db
    .delete(motrexTrips)
    .where(and(eq(motrexTrips.weekStart, weekStart), eq(motrexTrips.weekEnd, weekEnd)));
}

/** Remove trip rows whose stored interval overlaps [intervalStart, intervalEnd] (rolling sync). */
export async function clearTripsOverlappingRange(intervalStart: string, intervalEnd: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute(sql`
    DELETE FROM motrex_trips
    WHERE week_start <= ${intervalEnd}::date
      AND week_end >= ${intervalStart}::date
  `);
}

/** @deprecated Prefer clearYardsForDate / clearYardsBeforeDate so UI can serve last-good rows. */
export async function clearAllYards(): Promise<void> {
  const db = getDb();
  await db.execute(sql`DELETE FROM motrex_yards`);
}

async function insertYardsRows(
  reportDate: string,
  rows: Record<string, unknown>[],
  now = new Date(),
): Promise<number> {
  if (!rows.length) return 0;
  const db = getDb();
  for (const batch of chunks(yardsRowValues(reportDate, rows, now), 5000)) {
    await db.insert(motrexYards).values(batch);
  }
  return rows.length;
}

async function deleteYardsForRegistration(reportDate: string, registration: string): Promise<void> {
  const db = getDb();
  const key = registrationKey(registration);
  await db.execute(sql`
    DELETE FROM motrex_yards
    WHERE report_date = ${reportDate}
      AND upper(regexp_replace(registration_number, '^Motrex\\s*-\\s*', '', 'i')) = ${key}
  `);
}

async function insertYardsInsideRow(
  reportDate: string,
  inside: YardsInsideRow,
  now = new Date(),
): Promise<number> {
  const db = getDb();
  const reg = registrationLabel(inside.registrationNumber || inside.vehicle);
  await deleteYardsForRegistration(reportDate, reg);

  const visit = inside.template58Visit;
  const rawRow: Record<string, unknown> = visit
    ? { ...visit, status: inside.status }
    : {
        Vehicle: reg,
        "Registration Number": reg,
        Geofence: inside.geofence,
        "Time in": inside.timeIn,
        "Time out": "",
        "Duration in": inside.duration,
        "Last Execution Time": inside.lastExecutionTime,
        status: inside.status,
      };

  await db
    .insert(motrexYards)
    .values({
      reportDate,
      registrationNumber: reg,
      vehicle: reg,
      geofence: inside.geofence,
      timeIn: inside.timeIn,
      timeOut: null,
      durationSeconds: Math.max(0, Math.round(inside.durationDays * 86400)),
      status: "Inside",
      lastExecutionTime: inside.lastExecutionTime,
      rawRow,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [motrexYards.reportDate, motrexYards.registrationNumber],
      set: {
        vehicle: reg,
        geofence: inside.geofence,
        timeIn: inside.timeIn,
        timeOut: null,
        durationSeconds: Math.max(0, Math.round(inside.durationDays * 86400)),
        status: "Inside",
        lastExecutionTime: inside.lastExecutionTime,
        rawRow,
        updatedAt: now,
      },
    });
  return 1;
}

function loadInsideUnitsFromMeta(rawMeta: Record<string, unknown> | null | undefined): YardsInsideUnit[] {
  const units = rawMeta?.insideUnits;
  if (!Array.isArray(units)) return [];
  const parsed: YardsInsideUnit[] = [];
  for (const u of units) {
    const row = u as Record<string, unknown>;
    const unitId = Number(row.unitId ?? 0);
    const geofence = String(row.geofence ?? "").trim();
    const vehicle = String(row.vehicle ?? "").trim();
    const registration = String(row.registration ?? registrationLabel(vehicle)).trim();
    if (!geofence || !registration) continue;
    if (!Number.isFinite(unitId) || unitId < 0) continue;
    const timeInHint = String(row.timeInHint ?? "").trim();
    parsed.push({
      unitId,
      vehicle,
      registration,
      geofence,
      ...(timeInHint ? { timeInHint } : {}),
    });
  }
  return parsed;
}

async function upsertYardsSnapshotOnly(
  reportDate: string,
  payload: ReportSnapshotPayload & { insideRows?: YardsInsideRow[] },
  rawMeta: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db
    .insert(reportSnapshots)
    .values({
      reportType: "yards",
      reportDate,
      payload: payload as Record<string, unknown>,
      rawMeta,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [reportSnapshots.reportType, reportSnapshots.reportDate],
      set: {
        payload: payload as Record<string, unknown>,
        rawMeta,
        updatedAt: new Date(),
      },
    });
}

export async function loadTodayYardsSnapshot(): Promise<{
  payload: ReportSnapshotPayload & { insideRows?: YardsInsideRow[] };
  rawMeta: Record<string, unknown> | null;
} | null> {
  const db = getDb();
  const today = todayEatDateString();
  const rows = await db
    .select()
    .from(reportSnapshots)
    .where(and(eq(reportSnapshots.reportType, "yards"), eq(reportSnapshots.reportDate, today)))
    .limit(1);
  const snap = rows[0];
  if (!snap) return null;
  return {
    payload: (snap.payload ?? { rows: [] }) as ReportSnapshotPayload & { insideRows?: YardsInsideRow[] },
    rawMeta: (snap.rawMeta as Record<string, unknown> | null) ?? null,
  };
}

export interface YardsVehicleSyncResult {
  vehicleIndex: number;
  vehicleCount: number;
  vehicleRowCount: number;
  rowCount: number;
  unitId: number | null;
  insideCount?: number;
  isLast: boolean;
  reportDate: string;
  lastExecutionTime: string;
  syncProgress: "in_progress" | "complete";
}

/** @deprecated Use YardsVehicleSyncResult. */
export type YardsBatchSyncResult = YardsVehicleSyncResult;

async function finalizeYardsSync(
  reportDate: string,
  partialMeta: Record<string, unknown>,
): Promise<YardsVehicleSyncResult> {
  const db = getDb();
  const range = getYardsLiveRange();
  const dbRows = await db.select().from(motrexYards).where(eq(motrexYards.reportDate, reportDate));
  const mappedRows = mapYardsDbRows(dbRows);
  const now = new Date();
  const lastExecutionTime = formatEatDateTime(now);
  const insideRows = yardsInsideFromDbOrVisits(dbRows, mappedRows, now.getTime(), lastExecutionTime);

  const rawMeta: Record<string, unknown> = {
    ...partialMeta,
    source: "yards_template_58",
    templateId: 58,
    syncProgress: "complete",
    insideCount: insideRows.length,
    rowCount: dbRows.length,
    lastSyncAt: now.toISOString(),
    range,
  };

  await upsertYardsSnapshotOnly(
    reportDate,
    { rows: mappedRows as ReportSnapshotPayload["rows"], insideRows },
    rawMeta,
  );

  // Drop prior days only after today's sync produced rows (keep last-good otherwise).
  if (dbRows.length > 0) {
    await clearYardsBeforeDate(reportDate);
  }

  return {
    vehicleIndex: Number(partialMeta.lastVehicleIndex ?? partialMeta.lastInsideIndex ?? 0),
    vehicleCount: Number(partialMeta.vehicleCount ?? 0),
    vehicleRowCount: Number(partialMeta.vehicleRowCount ?? 0),
    rowCount: dbRows.length,
    unitId: partialMeta.lastUnitId != null ? Number(partialMeta.lastUnitId) : null,
    insideCount: insideRows.length,
    isLast: true,
    reportDate,
    lastExecutionTime,
    syncProgress: "complete",
  };
}

export interface YardsSyncOptions {
  clearBeforeSync?: boolean;
  retryDelaysMs?: number[];
}

/** Resolve sync start index for UI vs cron (avoid wiping mid-chain). clearBeforeSync only clears today's date. */
export async function resolveYardsSyncStartIndex(
  requestedIndex: number,
  authorized: boolean,
): Promise<{ insideIndex: number; clearBeforeSync: boolean }> {
  if (authorized) {
    return { insideIndex: requestedIndex, clearBeforeSync: requestedIndex === 0 };
  }

  if (requestedIndex > 0) {
    return { insideIndex: requestedIndex, clearBeforeSync: false };
  }

  const rowCount = await getYardsTodayRowCount();
  const snap = await loadTodayYardsSnapshot();
  const inProgress = snap?.rawMeta?.syncProgress === "in_progress";
  const lastInsideIndex = Number(snap?.rawMeta?.lastInsideIndex ?? -1);

  if (inProgress && lastInsideIndex >= 0) {
    return { insideIndex: lastInsideIndex + 1, clearBeforeSync: false };
  }

  // Fresh run: clear only today's rows so prior-day last-good data remains visible.
  return { insideIndex: 0, clearBeforeSync: true };
}

/** Sync one inside vehicle (template 58, 30 days) discovered via live geofence scan. */
export async function syncYardsInsideToDb(
  insideIndex: number,
  options: YardsSyncOptions = {},
): Promise<YardsVehicleSyncResult> {
  await ensureSchema();
  const reportDate = todayEatDateString();
  const range = getYardsLiveRange();
  const now = new Date();
  const lastExecutionTime = formatEatDateTime(now);

  if (insideIndex < 0) {
    throw new Error("insideIndex must be >= 0.");
  }

  let insideUnits: YardsInsideUnit[] = [];

  if (insideIndex === 0) {
    // Clear only today — keep yesterday (and snapshot last-good) visible during the long sync.
    const previousSnap = await loadTodayYardsSnapshot();
    const previousInside = previousSnap?.payload.insideRows ?? [];
    if (options.clearBeforeSync) {
      await clearYardsForDate(reportDate);
    }
    insideUnits = await discoverYardsInsideUnits();
    console.log(`[yards:sync] discovered ${insideUnits.length} vehicles inside yard geofences`);

    if (!insideUnits.length) {
      return finalizeYardsSync(reportDate, {
        source: "yards_template_58",
        templateId: 58,
        syncMode: "inside_first",
        insideUnits: [],
        insideUnitIds: [],
        lastInsideIndex: -1,
        vehicleCount: 0,
        vehicleRowCount: 0,
        range,
        lastSyncAt: now.toISOString(),
      });
    }

    await upsertYardsSnapshotOnly(
      reportDate,
      { rows: [], insideRows: previousInside },
      {
        source: "yards_template_58",
        templateId: 58,
        syncMode: "inside_first",
        insideUnits,
        insideUnitIds: insideUnits.map((u) => u.unitId),
        syncProgress: "in_progress",
        range,
        lastSyncAt: now.toISOString(),
        rowCount: 0,
      },
    );
  } else {
    const snap = await loadTodayYardsSnapshot();
    insideUnits = loadInsideUnitsFromMeta(snap?.rawMeta);
    if (!insideUnits.length) {
      throw new Error("insideUnits missing from snapshot; restart sync at insideIndex=0.");
    }
  }

  // (index 0 snapshot already written above when starting a fresh sync)

  if (insideIndex >= insideUnits.length) {
    return finalizeYardsSync(reportDate, {
      source: "yards_template_58",
      templateId: 58,
      syncMode: "inside_first",
      insideUnits,
      insideUnitIds: insideUnits.map((u) => u.unitId),
      lastInsideIndex: insideIndex - 1,
      vehicleCount: insideUnits.length,
      vehicleRowCount: 0,
      range,
      lastSyncAt: now.toISOString(),
    });
  }

  const current = insideUnits[insideIndex];
  let vehicleRowCount = 0;

  if (current.unitId > 0) {
    const fetched = await fetchYardsLiveForUnitId(current.unitId, options.retryDelaysMs);
    const insideSummary = computeInsideSummaryFromVisits(fetched.rows, current.geofence, current, {
      endMs: now.getTime(),
      lastExecutionTime,
    });
    if (insideSummary) {
      vehicleRowCount = await insertYardsInsideRow(reportDate, insideSummary, now);
    }
  }

  if (!vehicleRowCount) {
    // No template-58 open visit (e.g. Athi River) or unresolved unit ID — store live Inside row.
    const timeIn = current.timeInHint?.trim() || lastExecutionTime;
    const timeInMs = parseDateTimeMs(timeIn);
    const endMs = now.getTime();
    const durationDays =
      timeInMs > 0 ? Math.max(0, (endMs - timeInMs) / 86400000) : 0;
    vehicleRowCount = await insertYardsInsideRow(
      reportDate,
      {
        registrationNumber: current.registration,
        vehicle: registrationLabel(current.vehicle),
        geofence: current.geofence,
        timeIn,
        lastExecutionTime,
        duration: timeInMs > 0 ? formatTimeSince(timeInMs, endMs) : "—",
        durationDays,
        status: "Inside",
      },
      now,
    );
    console.log(
      `[yards:sync] live-inside unit ${current.unitId || "n/a"} (${current.registration}) @ ${current.geofence}`,
    );
  }

  const rowCount = await getYardsTodayRowCount();
  const isLast = insideIndex >= insideUnits.length - 1;

  const partialMeta: Record<string, unknown> = {
    source: "yards_template_58",
    templateId: 58,
    syncMode: "inside_first",
    insideUnits,
    insideUnitIds: insideUnits.map((u) => u.unitId),
    syncProgress: isLast ? "complete" : "in_progress",
    lastInsideIndex: insideIndex,
    vehicleCount: insideUnits.length,
    lastUnitId: current.unitId,
    lastGeofence: current.geofence,
    lastSyncAt: now.toISOString(),
    range,
    rowCount,
    vehicleRowCount,
  };

  if (isLast) {
    return finalizeYardsSync(reportDate, partialMeta);
  }

  const prevSnap = await loadTodayYardsSnapshot();
  const dbRowsNow = await getDb().select().from(motrexYards).where(eq(motrexYards.reportDate, reportDate));
  const liveInside = yardsInsideFromDbOrVisits(dbRowsNow, mapYardsDbRows(dbRowsNow), now.getTime(), lastExecutionTime);
  await upsertYardsSnapshotOnly(
    reportDate,
    {
      rows: mapYardsDbRows(dbRowsNow) as ReportSnapshotPayload["rows"],
      insideRows: liveInside.length ? liveInside : prevSnap?.payload.insideRows,
    },
    partialMeta,
  );

  return {
    vehicleIndex: insideIndex,
    vehicleCount: insideUnits.length,
    vehicleRowCount,
    rowCount,
    unitId: current.unitId,
    isLast: false,
    reportDate,
    lastExecutionTime,
    syncProgress: "in_progress",
  };
}

/** Sync one vehicle (template 58, 30 days) and append visit rows immediately. */
export async function syncYardsVehicleToDb(vehicleIndex: number): Promise<YardsVehicleSyncResult> {
  await ensureSchema();
  const reportDate = todayEatDateString();
  const range = getYardsLiveRange();
  const now = new Date();

  if (vehicleIndex < 0) {
    throw new Error("vehicleIndex must be >= 0.");
  }

  if (vehicleIndex === 0) {
    await clearYardsForDate(reportDate);
  }

  const fetched = await fetchYardsLiveForVehicleIndex(vehicleIndex);
  const vehicleCount = fetched.vehicleCount;

  if (vehicleIndex >= vehicleCount) {
    return finalizeYardsSync(reportDate, {
      source: "yards_template_58",
      templateId: 58,
      lastVehicleIndex: vehicleIndex - 1,
      vehicleCount,
      vehicleRowCount: 0,
      range,
      lastSyncAt: now.toISOString(),
    });
  }

  const vehicleRowCount = await insertYardsRows(reportDate, fetched.rows, now);
  const rowCount = await getYardsTodayRowCount();
  const isLast = vehicleIndex >= vehicleCount - 1;

  const partialMeta: Record<string, unknown> = {
    source: "yards_template_58",
    templateId: 58,
    syncProgress: isLast ? "complete" : "in_progress",
    lastVehicleIndex: vehicleIndex,
    vehicleCount,
    lastUnitId: fetched.unitId,
    lastSyncAt: now.toISOString(),
    range,
    rowCount,
    vehicleRowCount,
  };

  if (isLast) {
    return finalizeYardsSync(reportDate, partialMeta);
  }

  await upsertYardsSnapshotOnly(reportDate, { rows: [] }, partialMeta);

  return {
    vehicleIndex,
    vehicleCount,
    vehicleRowCount,
    rowCount,
    unitId: fetched.unitId,
    isLast: false,
    reportDate,
    lastExecutionTime: formatEatDateTime(now),
    syncProgress: "in_progress",
  };
}

/** Run inside-first sync for all vehicles currently in yard geofences (local script). */
export async function syncYardsLiveToDb(): Promise<YardsVehicleSyncResult> {
  await ensureSchema();
  const first = await syncYardsInsideToDb(0, { clearBeforeSync: true });
  let result = first;
  for (let i = 1; i < first.vehicleCount; i += 1) {
    result = await syncYardsInsideToDb(i);
    if (i % 5 === 0) {
      console.log(`[yards:sync] inside ${i + 1}/${first.vehicleCount}, rows: ${result.rowCount}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return result;
}

/** @deprecated Use syncYardsVehicleToDb. */
export async function syncYardsBatchToDb(batchIndex: number): Promise<YardsVehicleSyncResult> {
  const result = await syncYardsVehicleToDb(batchIndex);
  return {
    ...result,
    batchIndex: result.vehicleIndex,
    batchCount: result.vehicleCount,
    batchRowCount: result.vehicleRowCount,
  } as YardsVehicleSyncResult & { batchIndex: number; batchCount: number; batchRowCount: number };
}

/** @deprecated Use syncYardsVehicleToDb. */
export type YardsGeofenceSyncResult = YardsVehicleSyncResult;

/** @deprecated Use syncYardsVehicleToDb. */
export async function syncYardsGeofenceToDb(vehicleIndex: number): Promise<YardsVehicleSyncResult> {
  return syncYardsVehicleToDb(vehicleIndex);
}

export async function getYardsTodayRowCount(): Promise<number> {
  const db = getDb();
  const today = todayEatDateString();
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(motrexYards)
    .where(eq(motrexYards.reportDate, today));
  return result[0]?.count ?? 0;
}

function mapYardsDbToInsideRows(
  rows: Array<{
    registrationNumber: string;
    vehicle: string;
    geofence: string;
    timeIn: string | null;
    durationSeconds: number | null;
    status: string;
    lastExecutionTime: string | null;
    rawRow: unknown;
    updatedAt?: Date | string | null;
  }>,
  endMs = Date.now(),
): YardsInsideRow[] {
  const WIALON_TIME_RE = /^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}$/;

  const inside = rows.filter((r) => r.status === "Inside");
  const bestByKey = new Map<string, (typeof inside)[number]>();

  for (const row of inside) {
    const key = registrationKey(row.registrationNumber || row.vehicle);
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, row);
      continue;
    }
    const rowWialon = WIALON_TIME_RE.test(String(row.timeIn ?? "").trim());
    const existingWialon = WIALON_TIME_RE.test(String(existing.timeIn ?? "").trim());
    const rowUpdated = String(row.updatedAt ?? "");
    const existingUpdated = String(existing.updatedAt ?? "");
    if (
      (rowWialon && !existingWialon) ||
      (rowWialon === existingWialon && rowUpdated > existingUpdated)
    ) {
      bestByKey.set(key, row);
    }
  }

  return [...bestByKey.values()]
    .map((r) => {
      const timeInMs = parseDateTimeMs(r.timeIn ?? "");
      let durationDays = 0;
      if (timeInMs > 0) {
        durationDays = Math.max(0, (endMs - timeInMs) / 86400000);
      } else if (r.durationSeconds != null && r.durationSeconds > 0) {
        durationDays = r.durationSeconds / 86400;
      }
      return {
        registrationNumber: registrationLabel(r.registrationNumber || r.vehicle),
        vehicle: registrationLabel(r.vehicle || r.registrationNumber),
        geofence: r.geofence,
        timeIn: r.timeIn ?? "—",
        lastExecutionTime: r.lastExecutionTime ?? "—",
        duration: formatTimeSince(timeInMs > 0 ? timeInMs : null, endMs),
        durationDays,
        status: "Inside" as const,
      };
    })
    .sort((a, b) => b.durationDays - a.durationDays);
}

function yardsInsideFromDbOrVisits(
  dbRows: Array<{
    registrationNumber: string;
    vehicle: string;
    geofence: string;
    timeIn: string | null;
    timeOut: string | null;
    durationSeconds: number | null;
    status: string;
    lastExecutionTime: string | null;
    rawRow: unknown;
    reportDate: string;
  }>,
  mappedRows: Record<string, unknown>[],
  endMs: number,
  lastExecutionTime: string,
): YardsInsideRow[] {
  if (dbRows.some((r) => r.status === "Inside")) {
    return mapYardsDbToInsideRows(dbRows, endMs);
  }
  return computeYardsInside(mappedRows, { endMs, lastExecutionTime });
}

function mapYardsDbRows(
  rows: Array<{
    reportDate: string;
    registrationNumber: string;
    vehicle: string;
    geofence: string;
    timeIn: string | null;
    timeOut: string | null;
    lastExecutionTime: Date | string | null;
    rawRow: unknown;
  }>,
): Record<string, unknown>[] {
  return rows.map((r) => ({
    ...(r.rawRow as Record<string, unknown>),
    "Registration Number": r.registrationNumber,
    Vehicle: r.vehicle,
    Geofence: r.geofence,
    "Time in": r.timeIn ?? "",
    "Time out": r.timeOut ?? "",
    "Last Execution Time": formatEatDateTime(r.lastExecutionTime ?? ""),
    _reportDate: String(r.reportDate),
  }));
}

/** Read the latest yards live snapshot from Postgres (falls back to last-good day while today's sync runs). */
export async function getYardsLiveStoredData(): Promise<StoredReportResponse & { lastExecutionTime: string }> {
  const db = getDb();
  const range = getYardsLiveRange();
  const today = todayEatDateString();
  const snapshot = await loadTodayYardsSnapshot();
  const rawMeta = snapshot?.rawMeta ?? {};
  const syncProgress =
    rawMeta.syncProgress === "complete" || rawMeta.syncProgress === "in_progress"
      ? rawMeta.syncProgress
      : undefined;

  let rows = await db
    .select()
    .from(motrexYards)
    .where(eq(motrexYards.reportDate, today))
    .orderBy(motrexYards.reportDate);

  let servedFromPriorDay = false;
  // While today is empty (fresh clear or mid-sync before first insert), serve last-good day instantly.
  if (!rows.length) {
    const latest = await db
      .select({ reportDate: motrexYards.reportDate })
      .from(motrexYards)
      .where(and(gte(motrexYards.reportDate, range.from), lte(motrexYards.reportDate, range.to)))
      .orderBy(desc(motrexYards.reportDate), desc(motrexYards.updatedAt))
      .limit(1);

    const latestDate = latest[0]?.reportDate;
    if (latestDate) {
      rows = await db.select().from(motrexYards).where(eq(motrexYards.reportDate, latestDate));
      servedFromPriorDay = String(latestDate) !== today;
    }
  }

  const mappedRows = mapYardsDbRows(rows);
  const lastSyncAt = rawMeta.lastSyncAt ? String(rawMeta.lastSyncAt) : "";
  const rowLastExec = rows.find((r) => r.lastExecutionTime)?.lastExecutionTime;
  const lastExecutionTime = lastSyncAt
    ? formatEatDateTime(lastSyncAt)
    : rowLastExec
      ? formatEatDateTime(rowLastExec)
      : "—";
  const lastUpdatedAt = rows.length
    ? formatEatDateTime(
        rows.reduce((max, row) => {
          const ts = row.updatedAt?.getTime() ?? 0;
          return ts > max ? ts : max;
        }, 0),
      )
    : lastExecutionTime !== "—"
      ? lastExecutionTime
      : null;
  const endMs = Date.now();
  const snapshotInside = snapshot?.payload.insideRows ?? [];
  const insideRows = rows.some((r) => r.status === "Inside")
    ? mapYardsDbToInsideRows(rows, endMs)
    : snapshotInside.length
      ? snapshotInside
      : [];

  return {
    reportType: "yards",
    from: range.from,
    to: range.to,
    snapshotCount: new Set(rows.map((r) => String(r.reportDate))).size,
    rows: mappedRows.length ? mappedRows : (snapshot?.payload.rows as Record<string, unknown>[] | undefined) ?? [],
    insideRows,
    pivot: {},
    columns: [],
    snapshots: Array.from(new Set(rows.map((r) => String(r.reportDate)))).map((d) => ({
      reportDate: d,
      rowCount: rows.filter((r) => String(r.reportDate) === d).length,
      meta: { source: "motrex_yards_live", syncProgress: syncProgress ?? null, servedFromPriorDay },
    })),
    syncProgress,
    syncInProgress: syncProgress === "in_progress",
    lastExecutionTime,
    lastUpdatedAt,
  };
}

function fallbackResponse(
  reportType: StoredReportType,
  from: string,
  to: string,
  snapshots: Array<{ reportDate: string; payload: ReportSnapshotPayload; rawMeta: Record<string, unknown> | null }>,
): StoredReportResponse {
  const mergedRows: Record<string, unknown>[] = [];
  const mergedPivot: Record<string, Record<string, number>> = {};
  const columns = new Set<string>();

  for (const snap of snapshots) {
    const payload = snap.payload;
    if (payload.rows) {
      for (const row of payload.rows) mergedRows.push({ ...row, _reportDate: snap.reportDate });
    }
    if (payload.pivot) {
      for (const [vehicle, days] of Object.entries(payload.pivot)) {
        for (const [col, val] of Object.entries(days)) {
          mergePivotValue(mergedPivot, vehicle, col, val);
          columns.add(col);
        }
      }
    }
    if (payload.columns) {
      for (const c of payload.columns) columns.add(c);
    }
  }

  return {
    reportType,
    from,
    to,
    snapshotCount: snapshots.length,
    rows: mergedRows,
    pivot: mergedPivot,
    columns: Array.from(columns).sort(),
    snapshots: snapshots.map((s) => ({
      reportDate: s.reportDate,
      rowCount: s.payload.rows?.length ?? 0,
      meta: s.rawMeta,
    })),
  };
}

export async function getStoredReportData(
  reportType: StoredReportType,
  fromDate: string,
  toDate: string,
): Promise<StoredReportResponse> {
  const db = getDb();

  async function maxUpdatedAt(
    table:
      | typeof motrexTrips
      | typeof motrexTripsSummary
      | typeof motrexUtilization
      | typeof motrexEcoDriving,
    whereClause: ReturnType<typeof and>,
  ): Promise<string | null> {
    const [row] = await db
      .select({ maxAt: sql<Date | null>`max(${table.updatedAt})` })
      .from(table)
      .where(whereClause);
    return row?.maxAt ? formatEatDateTime(row.maxAt) : null;
  }

  if (reportType === "yards") {
    const rows = await db
      .select()
      .from(motrexYards)
      .where(and(gte(motrexYards.reportDate, fromDate), lte(motrexYards.reportDate, toDate)))
      .orderBy(motrexYards.reportDate);
    if (rows.length) {
      return {
        reportType,
        from: fromDate,
        to: toDate,
        snapshotCount: new Set(rows.map((r) => String(r.reportDate))).size,
        rows: rows.map((r) => ({
          ...(r.rawRow as Record<string, unknown>),
          "Registration Number": r.registrationNumber,
          Vehicle: r.vehicle,
          Geofence: r.geofence,
          "Time in": r.timeIn ?? "",
          "Time out": r.timeOut ?? "",
          "Last Execution Time": formatEatDateTime(r.lastExecutionTime ?? ""),
          _reportDate: String(r.reportDate),
        })),
        pivot: {},
        columns: [],
        snapshots: Array.from(new Set(rows.map((r) => String(r.reportDate)))).map((d) => ({
          reportDate: d,
          rowCount: rows.filter((r) => String(r.reportDate) === d).length,
          meta: { source: "motrex_yards" },
        })),
      };
    }
  }

  if (reportType === "trips") {
    const whereClause = and(gte(motrexTrips.weekEnd, fromDate), lte(motrexTrips.weekStart, toDate));
    const rows = await db
      .select()
      .from(motrexTrips)
      .where(whereClause)
      .orderBy(motrexTrips.weekStart);
    const lastUpdatedAt = await maxUpdatedAt(motrexTrips, whereClause);
    if (rows.length) {
      return {
        reportType,
        from: fromDate,
        to: toDate,
        snapshotCount: new Set(rows.map((r) => `${r.weekStart}:${r.weekEnd}`)).size,
        lastUpdatedAt,
        rows: rows.map((r) => ({
          ...(r.rawRow as Record<string, unknown>),
          Table: r.tripType,
          "Route Pair": r.routePair ?? (r.rawRow as Record<string, unknown>)?.["Route Pair"] ?? "",
          "Registration Number": r.registrationNumber,
          Vehicle: r.vehicle,
          Grouping: r.grouping ?? "",
          Trip: r.trip ?? "",
          "Trip from": r.tripFrom ?? "",
          "Trip to": r.tripTo ?? "",
          From: r.tripFrom ?? String((r.rawRow as Record<string, unknown>)?.From ?? ""),
          To: r.tripTo ?? String((r.rawRow as Record<string, unknown>)?.To ?? ""),
          "Loading Zone":
            String((r.rawRow as Record<string, unknown>)?.["Loading Zone"] ?? r.tripFrom ?? ""),
          "Offloading Zone":
            String((r.rawRow as Record<string, unknown>)?.["Offloading Zone"] ?? r.tripTo ?? ""),
          Beginning: r.beginning ?? "",
          End: r.end ?? "",
          "Departure Time":
            String((r.rawRow as Record<string, unknown>)?.["Departure Time"] ?? r.beginning ?? ""),
          "Arrival Time":
            String((r.rawRow as Record<string, unknown>)?.["Arrival Time"] ?? r.end ?? ""),
          "Transit Time":
            String((r.rawRow as Record<string, unknown>)?.["Transit Time"] ?? r.tripDuration ?? ""),
          Mileage: r.mileage ?? "",
          "Consumed by AbsFCS": r.consumedByAbsFcs ?? "",
          "Avg consumption by AbsFCS": r.avgConsumptionByAbsFcs ?? "",
          "Trip duration": r.tripDuration ?? "",
          "Total time": r.totalTime ?? "",
          "Parkings duration": r.parkingsDuration ?? "",
          "Avg speed": r.avgSpeed ?? "",
          "Max speed": r.maxSpeed ?? "",
          "Initial fuel level": r.initialFuelLevel ?? "",
          "Final fuel level": r.finalFuelLevel ?? "",
          Count: r.count ?? "",
          "Trip Count": r.count ?? "1",
          _reportDate: String(r.weekStart),
        })),
        pivot: {},
        columns: [],
        snapshots: Array.from(new Set(rows.map((r) => String(r.weekStart)))).map((start) => {
          return {
            reportDate: start,
            rowCount: rows.filter((r) => String(r.weekStart) === start).length,
            meta: { source: "motrex_trips", reportDate: start },
          };
        }),
      };
    }
  }

  if (reportType === "trips_summary") {
    return getTripsSummaryStoredData(fromDate, toDate);
  }

  if (reportType === "utilization") {
    const whereClause = and(
      gte(motrexUtilization.reportDate, fromDate),
      lte(motrexUtilization.reportDate, toDate),
    );
    const rows = await db
      .select()
      .from(motrexUtilization)
      .where(whereClause)
      .orderBy(motrexUtilization.reportDate);
    const lastUpdatedAt = await maxUpdatedAt(motrexUtilization, whereClause);
    if (rows.length) {
      const pivot: Record<string, Record<string, number>> = {};
      const columns = new Set<string>();
      for (const r of rows) {
        mergePivotValue(pivot, r.registrationNumber, r.dayLabel, r.mileageKm);
        columns.add(r.dayLabel);
      }
      return {
        reportType,
        from: fromDate,
        to: toDate,
        snapshotCount: new Set(rows.map((r) => String(r.reportDate))).size,
        lastUpdatedAt,
        rows: rows.map((r) => ({ ...(r.rawRow as Record<string, unknown>), _reportDate: String(r.reportDate) })),
        pivot,
        columns: Array.from(columns).sort((a, b) => dayLabelSortValue(a) - dayLabelSortValue(b) || a.localeCompare(b)),
        snapshots: Array.from(new Set(rows.map((r) => String(r.reportDate)))).map((d) => ({
          reportDate: d,
          rowCount: rows.filter((r) => String(r.reportDate) === d).length,
          meta: { source: "motrex_utilization" },
        })),
      };
    }
  }

  if (reportType === "eco_driving") {
    const whereClause = and(
      gte(motrexEcoDriving.reportDate, fromDate),
      lte(motrexEcoDriving.reportDate, toDate),
    );
    const rows = await db
      .select({
        reportDate: motrexEcoDriving.reportDate,
        registrationNumber: motrexEcoDriving.registrationNumber,
        violation: motrexEcoDriving.violation,
        count: motrexEcoDriving.count,
      })
      .from(motrexEcoDriving)
      .where(whereClause)
      .orderBy(motrexEcoDriving.reportDate);
    const lastUpdatedAt = await maxUpdatedAt(motrexEcoDriving, whereClause);
    if (rows.length) {
      const pivot: Record<string, Record<string, number>> = {};
      const columns = new Set<string>();
      const dailyCounts = new Map<string, number>();
      for (const r of rows) {
        const reportDate = String(r.reportDate);
        if (!pivot[r.registrationNumber]) pivot[r.registrationNumber] = {};
        pivot[r.registrationNumber][r.violation] = (pivot[r.registrationNumber][r.violation] ?? 0) + r.count;
        columns.add(r.violation);
        dailyCounts.set(reportDate, (dailyCounts.get(reportDate) ?? 0) + 1);
      }
      return {
        reportType,
        from: fromDate,
        to: toDate,
        snapshotCount: dailyCounts.size,
        totalRows: rows.length,
        lastUpdatedAt,
        rows: [],
        pivot,
        columns: Array.from(columns).sort(),
        snapshots: Array.from(dailyCounts.entries()).map(([d, rowCount]) => ({
          reportDate: d,
          rowCount,
          meta: { source: "motrex_eco_driving" },
        })),
      };
    }
  }

  return fallbackResponse(reportType, fromDate, toDate, await getReportSnapshots(reportType, fromDate, toDate));
}

export async function getReportSnapshots(
  reportType: StoredReportType,
  fromDate: string,
  toDate: string,
): Promise<Array<{ reportDate: string; payload: ReportSnapshotPayload; rawMeta: Record<string, unknown> | null }>> {
  const db = getDb();
  const rows = await db
    .select({
      reportDate: reportSnapshots.reportDate,
      payload: reportSnapshots.payload,
      rawMeta: reportSnapshots.rawMeta,
    })
    .from(reportSnapshots)
    .where(
      and(
        eq(reportSnapshots.reportType, reportType),
        gte(reportSnapshots.reportDate, fromDate),
        lte(reportSnapshots.reportDate, toDate),
      ),
    )
    .orderBy(reportSnapshots.reportDate);

  return rows.map((r) => ({
    reportDate: String(r.reportDate),
    payload: r.payload as ReportSnapshotPayload,
    rawMeta: (r.rawMeta as Record<string, unknown> | null) ?? null,
  }));
}

export async function cronRunStart(jobName: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .insert(cronRuns)
    .values({ jobName, ok: null })
    .returning({ id: cronRuns.id });
  return row?.id ?? 0;
}

export interface DailyPipelineRunState {
  id: number;
  finishedAt: Date | null;
  ok: boolean | null;
  detail: Record<string, unknown>;
}

export async function getCronRunState(runId: number): Promise<DailyPipelineRunState | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: cronRuns.id,
      finishedAt: cronRuns.finishedAt,
      ok: cronRuns.ok,
      detail: cronRuns.detail,
    })
    .from(cronRuns)
    .where(eq(cronRuns.id, runId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    finishedAt: row.finishedAt,
    ok: row.ok,
    detail: row.detail ?? {},
  };
}

export async function findDailyPipelineRun(
  pipelineDate: string,
): Promise<DailyPipelineRunState | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: cronRuns.id,
      finishedAt: cronRuns.finishedAt,
      ok: cronRuns.ok,
      detail: cronRuns.detail,
    })
    .from(cronRuns)
    .where(eq(cronRuns.jobName, "daily-pipeline"))
    .orderBy(desc(cronRuns.startedAt))
    .limit(20);

  const row = rows.find(
    (candidate) => String(candidate.detail?.pipelineDate ?? "") === pipelineDate,
  );
  if (!row) return null;
  return {
    id: row.id,
    finishedAt: row.finishedAt,
    ok: row.ok,
    detail: row.detail ?? {},
  };
}

export async function cronRunProgress(
  runId: number,
  detailPatch: Record<string, unknown>,
): Promise<void> {
  const current = await getCronRunState(runId);
  if (!current || current.finishedAt) return;
  const db = getDb();
  await db
    .update(cronRuns)
    .set({
      detail: {
        ...current.detail,
        ...detailPatch,
        lastHeartbeatAt: new Date().toISOString(),
      },
    })
    .where(eq(cronRuns.id, runId));
}

export async function cronRunFinish(
  runId: number,
  ok: boolean,
  detail: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db
    .update(cronRuns)
    .set({ finishedAt: new Date(), ok, detail })
    .where(eq(cronRuns.id, runId));
}

export interface TripsSummarySyncResult {
  weekStart: string;
  weekEnd: string;
  batchIndex: number;
  batchCount: number;
  rowCount: number;
  unitCount: number;
  isLastBatch: boolean;
  isLastWeek: boolean;
  syncProgress: "in_progress" | "complete";
}

function formatTripsSummaryMetric(value: number, unit: string): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const rounded = Math.round(value * 10) / 10;
  return unit ? `${rounded} ${unit}` : String(rounded);
}

export async function clearTripsSummaryWeek(weekStart: string, weekEnd: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db
    .delete(motrexTripsSummary)
    .where(and(eq(motrexTripsSummary.weekStart, weekStart), eq(motrexTripsSummary.weekEnd, weekEnd)));
}

export async function upsertTripsSummaryBatch(
  weekStart: string,
  weekEnd: string,
  rows: TripsSummaryMappedRow[],
): Promise<number> {
  await ensureSchema();
  const db = getDb();
  const now = new Date();
  if (!rows.length) return 0;

  for (const chunk of chunks(rows, 100)) {
    await db
      .insert(motrexTripsSummary)
      .values(
        chunk.map((row) => ({
          weekStart,
          weekEnd,
          registrationNumber: row.registrationNumber,
          vehicle: row.vehicle,
          mileageKm: row.mileageKm,
          fuelConsumedL: row.fuelConsumedL,
          avgConsumptionKml: row.avgConsumptionKml,
          rawRow: row.rawRow,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [motrexTripsSummary.weekStart, motrexTripsSummary.weekEnd, motrexTripsSummary.registrationNumber],
        set: {
          vehicle: sql`excluded.vehicle`,
          mileageKm: sql`excluded.mileage_km`,
          fuelConsumedL: sql`excluded.fuel_consumed_l`,
          avgConsumptionKml: sql`excluded.avg_consumption_kml`,
          rawRow: sql`excluded.raw_row`,
          updatedAt: now,
        },
      });
  }
  return rows.length;
}

export async function loadTripsSummarySyncMeta(weekStart: string): Promise<Record<string, unknown> | null> {
  await ensureSchema();
  const db = getDb();
  const [row] = await db
    .select({ rawMeta: reportSnapshots.rawMeta })
    .from(reportSnapshots)
    .where(and(eq(reportSnapshots.reportType, "trips_summary"), eq(reportSnapshots.reportDate, weekStart)))
    .limit(1);
  return (row?.rawMeta as Record<string, unknown> | null) ?? null;
}

export async function saveTripsSummarySyncMeta(
  weekStart: string,
  weekEnd: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date();
  await db
    .insert(reportSnapshots)
    .values({
      reportType: "trips_summary",
      reportDate: weekStart,
      payload: { rows: [], pivot: {}, columns: [], summary: { weekStart, weekEnd } },
      rawMeta: meta,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [reportSnapshots.reportType, reportSnapshots.reportDate],
      set: {
        rawMeta: meta,
        updatedAt: now,
      },
    });
}

async function loadTripsSummarySyncStatus(fromDate: string, toDate: string): Promise<{
  syncInProgress: boolean;
  syncProgress: "in_progress" | "complete" | undefined;
  syncStatus: string | null;
}> {
  const weeks = enumerateWeeksInRange(fromDate, toDate);
  let inProgress = false;
  let status: string | null = null;

  for (const week of weeks) {
    const meta = await loadTripsSummarySyncMeta(week.from);
    if (!meta) continue;
    if (meta.syncProgress === "in_progress") {
      inProgress = true;
      const batchIndex = Number(meta.lastBatchIndex ?? 0);
      const batchCount = Number(meta.batchCount ?? 0);
      status = `Syncing week ${week.from}–${week.to} · batch ${batchIndex + 1}/${Math.max(batchCount, 1)}`;
      break;
    }
  }

  return {
    syncInProgress: inProgress,
    syncProgress: inProgress ? "in_progress" : weeks.length ? "complete" : undefined,
    syncStatus: status,
  };
}

export async function getTripsSummaryStoredData(fromDate: string, toDate: string): Promise<StoredReportResponse> {
  await ensureSchema();
  const db = getDb();
  const rows = await db
    .select()
    .from(motrexTripsSummary)
    .where(and(gte(motrexTripsSummary.weekEnd, fromDate), lte(motrexTripsSummary.weekStart, toDate)))
    .orderBy(motrexTripsSummary.weekStart, motrexTripsSummary.vehicle);

  type Agg = {
    vehicle: string;
    mileageKm: number;
    fuelConsumedL: number;
    parkingsSec: number;
    maxSpeedKmh: number;
    utilizationPctSum: number;
    utilizationWeight: number;
    engineHoursSec: number;
    timeInTripsSec: number;
    consumedFlsL: number;
  };

  const aggregated = new Map<string, Agg>();

  for (const row of rows) {
    const key = row.registrationNumber || row.vehicle;
    const fromRaw = metricsFromSummaryRawRow(row.rawRow as Record<string, unknown>);
    const mileageKm = fromRaw.mileageKm || row.mileageKm || 0;
    const fuelConsumedL = fromRaw.fuelConsumedL || row.fuelConsumedL || 0;
    const current = aggregated.get(key) ?? {
      vehicle: row.vehicle,
      mileageKm: 0,
      fuelConsumedL: 0,
      parkingsSec: 0,
      maxSpeedKmh: 0,
      utilizationPctSum: 0,
      utilizationWeight: 0,
      engineHoursSec: 0,
      timeInTripsSec: 0,
      consumedFlsL: 0,
    };
    current.mileageKm += mileageKm;
    current.fuelConsumedL += fuelConsumedL;
    current.parkingsSec += fromRaw.parkingsSec;
    current.maxSpeedKmh = Math.max(current.maxSpeedKmh, fromRaw.maxSpeedKmh);
    if (fromRaw.utilizationPct > 0) {
      const weight = Math.max(fromRaw.engineHoursSec, 1);
      current.utilizationPctSum += fromRaw.utilizationPct * weight;
      current.utilizationWeight += weight;
    }
    current.engineHoursSec += fromRaw.engineHoursSec;
    current.timeInTripsSec += fromRaw.timeInTripsSec;
    current.consumedFlsL += fromRaw.consumedFlsL || fuelConsumedL;
    aggregated.set(key, current);
  }

  const summaryColumns = [
    "Vehicle",
    "Mileage in trips",
    "Parkings",
    "Max. speed",
    "Utilization",
    "Engine hours",
    "Time in trips",
    "Consumed by FLS",
    "Avg. consumption by FLS",
  ];

  const summaryRows = Array.from(aggregated.values()).map((entry) => {
    const avgKml =
      entry.fuelConsumedL > 0 && entry.mileageKm > 0 ? entry.mileageKm / entry.fuelConsumedL : 0;
    const avgFlsL100 =
      entry.consumedFlsL > 0 && entry.mileageKm > 0
        ? (entry.consumedFlsL / entry.mileageKm) * 100
        : avgKml > 0
          ? 100 / avgKml
          : 0;
    const utilizationPct =
      entry.utilizationWeight > 0 ? entry.utilizationPctSum / entry.utilizationWeight : 0;

    return {
      Vehicle: entry.vehicle,
      "Mileage in trips": formatTripsSummaryMetric(entry.mileageKm, "km"),
      Parkings: formatWialonDurationSec(entry.parkingsSec),
      "Max. speed": formatTripsSummaryMetric(entry.maxSpeedKmh, "km/h"),
      Utilization: utilizationPct > 0 ? `${Math.round(utilizationPct * 10) / 10} %` : "",
      "Engine hours": formatWialonDurationSec(entry.engineHoursSec),
      "Time in trips": formatWialonDurationSec(entry.timeInTripsSec),
      "Consumed by FLS": formatTripsSummaryMetric(entry.consumedFlsL || entry.fuelConsumedL, "l"),
      "Avg. consumption by FLS":
        avgFlsL100 > 0 ? `${Math.round(avgFlsL100 * 10) / 10} l/100 km` : "",
      // Keep legacy numeric fields for KPI cards that still read Mileage / Fuel
      Mileage: formatTripsSummaryMetric(entry.mileageKm, "km"),
      "Fuel Consumed": formatTripsSummaryMetric(entry.fuelConsumedL || entry.consumedFlsL, "l"),
      "Avg Consumption (Km/l)": formatTripsSummaryMetric(avgKml, "km/l"),
      mileageKm: entry.mileageKm,
      fuelConsumedL: entry.fuelConsumedL || entry.consumedFlsL,
      avgConsumptionKml: avgKml,
    };
  });

  const weekKeys = new Set(rows.map((r) => `${r.weekStart}:${r.weekEnd}`));
  const lastUpdatedAt = rows.length
    ? formatEatDateTime(
        rows.reduce((max, row) => {
          const ts = row.updatedAt?.getTime() ?? 0;
          return ts > max ? ts : max;
        }, 0),
      )
    : null;

  return {
    reportType: "trips_summary",
    from: fromDate,
    to: toDate,
    snapshotCount: weekKeys.size,
    lastUpdatedAt,
    rows: summaryRows,
    pivot: {},
    columns: summaryColumns,
    snapshots: Array.from(weekKeys).map((key) => {
      const [weekStart] = key.split(":");
      return {
        reportDate: weekStart,
        rowCount: rows.filter((r) => `${r.weekStart}:${r.weekEnd}` === key).length,
        meta: { source: "motrex_trips_summary", week: key },
      };
    }),
  };
}

export async function syncTripsSummaryBatch(params: {
  weekStart: string;
  weekEnd: string;
  batchIndex: number;
  from?: string;
  to?: string;
  weekIndex?: number;
  authorized?: boolean;
  /** Wialon fetch end (yesterday capped in week); defaults to weekEnd. */
  syncEnd?: string;
}): Promise<TripsSummarySyncResult> {
  await ensureSchema();
  const { weekStart, weekEnd, batchIndex } = params;
  const weekIndex = params.weekIndex ?? 0;
  const multiWeek = Boolean(params.from && params.to);
  const weeks = multiWeek ? enumerateWeeksInRange(params.from!, params.to!) : [{ from: weekStart, to: weekEnd }];
  const activeWeek = weeks[weekIndex] ?? weeks[0];
  const dbWeekStart = activeWeek.from;
  const dbWeekEnd = activeWeek.to;
  const fetchEnd = params.syncEnd ?? dbWeekEnd;

  let meta = (await loadTripsSummarySyncMeta(dbWeekStart)) ?? {};
  let unitIds = Array.isArray(meta.unitIds) ? (meta.unitIds as number[]) : [];
  let batches = Array.isArray(meta.batches) ? (meta.batches as number[][]) : [];

  if (batchIndex === 0) {
    const staleMs = 45 * 60 * 1000;
    if (
      meta.syncProgress === "in_progress" &&
      meta.lastSyncAt &&
      Date.now() - Date.parse(String(meta.lastSyncAt)) > staleMs
    ) {
      meta = {};
    }
    if (multiWeek && weekIndex === 0) {
      await saveTripsSummarySyncMeta(dbWeekStart, dbWeekEnd, {
        syncProgress: "in_progress",
        rangeFrom: params.from,
        rangeTo: params.to,
        pendingWeeks: weeks,
        currentWeekIndex: 0,
        startedAt: new Date().toISOString(),
        syncEnd: fetchEnd,
      });
    } else if (multiWeek) {
      await saveTripsSummarySyncMeta(dbWeekStart, dbWeekEnd, {
        syncProgress: "in_progress",
        rangeFrom: params.from,
        rangeTo: params.to,
        pendingWeeks: weeks,
        currentWeekIndex: weekIndex,
        startedAt: new Date().toISOString(),
        syncEnd: fetchEnd,
      });
    }
    await clearTripsSummaryWeek(dbWeekStart, dbWeekEnd);
    unitIds = await fetchMotrexUnitIds();
    batches = splitSummaryBatches(unitIds);
    meta = {
      weekStart: dbWeekStart,
      weekEnd: dbWeekEnd,
      syncEnd: fetchEnd,
      unitIds,
      batches: batches.map((b) => b.length),
      batchCount: batches.length,
      syncProgress: "in_progress",
      lastBatchIndex: -1,
      lastSyncAt: new Date().toISOString(),
      rangeFrom: params.from,
      rangeTo: params.to,
      pendingWeeks: multiWeek ? weeks : undefined,
      currentWeekIndex: weekIndex,
    };
    await saveTripsSummarySyncMeta(dbWeekStart, dbWeekEnd, meta);
  } else if (!batches.length) {
    unitIds = await fetchMotrexUnitIds();
    batches = splitSummaryBatches(unitIds);
    meta = {
      ...meta,
      unitIds,
      batches: batches.map((b) => b.length),
      batchCount: batches.length,
      syncProgress: "in_progress",
      syncEnd: fetchEnd,
    };
    await saveTripsSummarySyncMeta(dbWeekStart, dbWeekEnd, meta);
  }

  const batchUnitIds = splitSummaryBatches(unitIds)[batchIndex];
  if (!batchUnitIds?.length) {
    throw new Error(`Invalid batch index ${batchIndex} (batch count ${batches.length}).`);
  }

  const mappedRows = await executeTripsSummaryBatchWithFallback(
    dbWeekStart,
    fetchEnd,
    batchUnitIds,
    `${dbWeekStart}–${fetchEnd} / trips_summary batch ${batchIndex + 1}/${batches.length}`,
  );

  const upserted = await upsertTripsSummaryBatch(dbWeekStart, dbWeekEnd, mappedRows);
  const isLastBatch = batchIndex >= batches.length - 1;
  const isLastWeek = weekIndex >= weeks.length - 1;

  if (isLastBatch) {
    if (isLastWeek) {
      await saveTripsSummarySyncMeta(dbWeekStart, dbWeekEnd, {
        ...meta,
        syncProgress: "complete",
        lastBatchIndex: batchIndex,
        lastSyncAt: new Date().toISOString(),
        rowCountTotal: upserted,
        syncEnd: fetchEnd,
      });
    } else {
      const nextWeek = weeks[weekIndex + 1];
      await saveTripsSummarySyncMeta(dbWeekStart, dbWeekEnd, {
        ...meta,
        syncProgress: "complete",
        lastBatchIndex: batchIndex,
        lastSyncAt: new Date().toISOString(),
        syncEnd: fetchEnd,
      });
      await saveTripsSummarySyncMeta(nextWeek.from, nextWeek.to, {
        syncProgress: "in_progress",
        rangeFrom: params.from,
        rangeTo: params.to,
        pendingWeeks: weeks,
        currentWeekIndex: weekIndex + 1,
        startedAt: new Date().toISOString(),
        syncEnd: params.syncEnd,
      });
    }
  } else {
    await saveTripsSummarySyncMeta(dbWeekStart, dbWeekEnd, {
      ...meta,
      syncProgress: "in_progress",
      lastBatchIndex: batchIndex,
      lastSyncAt: new Date().toISOString(),
      syncEnd: fetchEnd,
    });
  }

  return {
    weekStart: dbWeekStart,
    weekEnd: dbWeekEnd,
    batchIndex,
    batchCount: batches.length,
    rowCount: upserted,
    unitCount: unitIds.length,
    isLastBatch,
    isLastWeek: isLastBatch && isLastWeek,
    syncProgress: isLastBatch && isLastWeek ? "complete" : "in_progress",
  };
}

export async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = ensureSchemaOnce().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

let schemaPromise: Promise<void> | null = null;

async function migrateReportSnapshotsTypeCheck(db: ReturnType<typeof getDb>): Promise<void> {
  // Drop every CHECK on report_type (inline CREATE TABLE names differ from our named constraint).
  await db.execute(sql`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'report_snapshots'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%report_type%'
      LOOP
        EXECUTE format('ALTER TABLE report_snapshots DROP CONSTRAINT IF EXISTS %I', r.conname);
      END LOOP;
    END $$;
  `);

  await db.execute(sql`
    UPDATE report_snapshots
    SET report_type = 'yards'
    WHERE report_type NOT IN ('yards', 'trips', 'trips_summary', 'utilization', 'eco_driving')
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'report_snapshots_type_check'
      ) THEN
        ALTER TABLE report_snapshots
          ADD CONSTRAINT report_snapshots_type_check
          CHECK (report_type IN ('yards', 'trips', 'trips_summary', 'utilization', 'eco_driving'));
      END IF;
    END $$;
  `);
}

async function ensureSchemaOnce(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS report_snapshots (
      id SERIAL PRIMARY KEY,
      report_type TEXT NOT NULL,
      report_date DATE NOT NULL,
      payload JSONB NOT NULL,
      raw_meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (report_type, report_date)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cron_runs (
      id SERIAL PRIMARY KEY,
      job_name TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      ok BOOLEAN,
      detail JSONB
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS motrex_yards (
      id SERIAL PRIMARY KEY,
      report_date DATE NOT NULL,
      registration_number TEXT NOT NULL,
      vehicle TEXT NOT NULL,
      geofence TEXT NOT NULL,
      time_in TEXT,
      time_out TEXT,
      duration_seconds INTEGER,
      status TEXT NOT NULL DEFAULT 'Inside',
      last_execution_time TEXT,
      raw_row JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS motrex_trips (
      id SERIAL PRIMARY KEY,
      week_start DATE NOT NULL,
      week_end DATE NOT NULL,
      trip_type TEXT NOT NULL DEFAULT 'Raw',
      registration_number TEXT NOT NULL,
      vehicle TEXT NOT NULL,
      raw_row JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS motrex_utilization (
      id SERIAL PRIMARY KEY,
      report_date DATE NOT NULL,
      registration_number TEXT NOT NULL,
      day_label TEXT NOT NULL,
      mileage_km DOUBLE PRECISION NOT NULL DEFAULT 0,
      raw_row JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS motrex_eco_driving (
      id SERIAL PRIMARY KEY,
      report_date DATE NOT NULL,
      registration_number TEXT NOT NULL,
      violation TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      raw_row JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`ALTER TABLE motrex_trips ADD COLUMN IF NOT EXISTS trip_type TEXT NOT NULL DEFAULT 'Raw'`);
  await db.execute(sql`ALTER TABLE motrex_trips ADD COLUMN IF NOT EXISTS route_pair TEXT`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS motrex_yards_date_reg_unique
    ON motrex_yards (report_date, registration_number)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS motrex_trips_summary (
      id SERIAL PRIMARY KEY,
      week_start DATE NOT NULL,
      week_end DATE NOT NULL,
      registration_number TEXT NOT NULL,
      vehicle TEXT NOT NULL,
      mileage_km DOUBLE PRECISION NOT NULL DEFAULT 0,
      fuel_consumed_l DOUBLE PRECISION NOT NULL DEFAULT 0,
      avg_consumption_kml DOUBLE PRECISION NOT NULL DEFAULT 0,
      raw_row JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS motrex_trips_summary_week_reg_unique
    ON motrex_trips_summary (week_start, week_end, registration_number)
  `);
  await migrateReportSnapshotsTypeCheck(db);
}
