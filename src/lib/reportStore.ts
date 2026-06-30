import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { cronRuns, motrexEcoDriving, motrexTrips, motrexUtilization, motrexYards, reportSnapshots } from "@/db/schema";
import type { ReportSnapshotPayload } from "@/lib/data";
import type { StoredReportType } from "@/lib/motrexConfig";
import type { ReportExecutionResult } from "@/lib/wialon/reports";
import { parseDurationSeconds } from "./duration";
import { formatEatDateTime } from "./dateRange";
import { registrationLabel } from "./vehicleLabels";

export interface StoredReportResponse {
  reportType: StoredReportType;
  from: string;
  to: string;
  snapshotCount: number;
  totalRows?: number;
  rows: Record<string, unknown>[];
  pivot: Record<string, Record<string, number>>;
  columns: string[];
  snapshots: Array<{ reportDate: string; rowCount: number; meta: Record<string, unknown> | null }>;
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

function tripMetric(row: Record<string, unknown>, column: string): string | null {
  const direct = row[column];
  if (direct == null || direct === "") return null;
  return String(direct);
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
    await db.delete(motrexYards).where(eq(motrexYards.reportDate, result.reportDate));
    if (!rows.length) return;
    await db.insert(motrexYards).values(
      rows.map((row) => {
        const geofenceKey = pickKey(row, [/geofence|geozone/i]);
        const timeInKey = pickKey(row, [/time\s*in|beginning|entry/i]);
        const timeOutKey = pickKey(row, [/time\s*out|end|exit/i]);
        const durationKey = pickKey(row, [/duration/i]);
        return {
          reportDate: result.reportDate,
          registrationNumber: normalizeRegistration(row),
          vehicle: normalizeVehicle(row),
          geofence: value(row, geofenceKey),
          timeIn: value(row, timeInKey) || null,
          timeOut: value(row, timeOutKey) || null,
          durationSeconds: parseDurationSeconds(value(row, durationKey)),
          status: /out\s+of\s+geofence/i.test(value(row, geofenceKey)) ? "Out" : "Inside",
          lastExecutionTime: formatEatDateTime(now),
          rawRow: row,
          updatedAt: now,
        };
      }),
    );
    return;
  }

  if (result.reportType === "trips") {
    const weekStart = String(result.rawMeta.weekStart ?? result.rawMeta.intervalStart ?? result.reportDate);
    const weekEnd = String(result.rawMeta.weekEnd ?? result.rawMeta.intervalEnd ?? result.reportDate);
    await db
      .delete(motrexTrips)
      .where(and(eq(motrexTrips.weekStart, weekStart), eq(motrexTrips.weekEnd, weekEnd)));
    if (!rows.length) return;
    await db.insert(motrexTrips).values(
      rows.map((row) => ({
        weekStart,
        weekEnd,
        tripType: String(row.Table ?? "Raw"),
        registrationNumber: normalizeRegistration(row),
        vehicle: normalizeVehicle(row),
        grouping: tripMetric(row, "Grouping"),
        trip: tripMetric(row, "Trip"),
        tripFrom: tripMetric(row, "Trip from"),
        tripTo: tripMetric(row, "Trip to"),
        beginning: tripMetric(row, "Beginning"),
        end: tripMetric(row, "End"),
        mileage: tripMetric(row, "Mileage"),
        consumedByAbsFcs: tripMetric(row, "Consumed by AbsFCS"),
        avgConsumptionByAbsFcs: tripMetric(row, "Avg consumption by AbsFCS"),
        tripDuration: tripMetric(row, "Trip duration"),
        totalTime: tripMetric(row, "Total time"),
        parkingsDuration: tripMetric(row, "Parkings duration"),
        avgSpeed: tripMetric(row, "Avg speed"),
        maxSpeed: tripMetric(row, "Max speed"),
        initialFuelLevel: tripMetric(row, "Initial fuel level"),
        finalFuelLevel: tripMetric(row, "Final fuel level"),
        count: tripMetric(row, "Count"),
        rawRow: row,
        updatedAt: now,
      })),
    );
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
        if (!mergedPivot[vehicle]) mergedPivot[vehicle] = {};
        for (const [col, val] of Object.entries(days)) {
          mergedPivot[vehicle][col] = (mergedPivot[vehicle][col] ?? 0) + val;
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
    const rows = await db
      .select()
      .from(motrexTrips)
      .where(and(gte(motrexTrips.weekEnd, fromDate), lte(motrexTrips.weekStart, toDate)))
      .orderBy(motrexTrips.weekStart);
    if (rows.length) {
      return {
        reportType,
        from: fromDate,
        to: toDate,
        snapshotCount: new Set(rows.map((r) => `${r.weekStart}:${r.weekEnd}`)).size,
        rows: rows.map((r) => ({
          ...(r.rawRow as Record<string, unknown>),
          Table: r.tripType,
          "Registration Number": r.registrationNumber,
          Vehicle: r.vehicle,
          Grouping: r.grouping ?? "",
          Trip: r.trip ?? "",
          "Trip from": r.tripFrom ?? "",
          "Trip to": r.tripTo ?? "",
          Beginning: r.beginning ?? "",
          End: r.end ?? "",
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

  if (reportType === "utilization") {
    const rows = await db
      .select()
      .from(motrexUtilization)
      .where(and(gte(motrexUtilization.reportDate, fromDate), lte(motrexUtilization.reportDate, toDate)))
      .orderBy(motrexUtilization.reportDate);
    if (rows.length) {
      const pivot: Record<string, Record<string, number>> = {};
      const columns = new Set<string>();
      for (const r of rows) {
        if (!pivot[r.registrationNumber]) pivot[r.registrationNumber] = {};
        pivot[r.registrationNumber][r.dayLabel] = (pivot[r.registrationNumber][r.dayLabel] ?? 0) + r.mileageKm;
        columns.add(r.dayLabel);
      }
      return {
        reportType,
        from: fromDate,
        to: toDate,
        snapshotCount: new Set(rows.map((r) => String(r.reportDate))).size,
        rows: rows.map((r) => ({ ...(r.rawRow as Record<string, unknown>), _reportDate: String(r.reportDate) })),
        pivot,
        columns: Array.from(columns).sort(),
        snapshots: Array.from(new Set(rows.map((r) => String(r.reportDate)))).map((d) => ({
          reportDate: d,
          rowCount: rows.filter((r) => String(r.reportDate) === d).length,
          meta: { source: "motrex_utilization" },
        })),
      };
    }
  }

  if (reportType === "eco_driving") {
    const rows = await db
      .select({
        reportDate: motrexEcoDriving.reportDate,
        registrationNumber: motrexEcoDriving.registrationNumber,
        violation: motrexEcoDriving.violation,
        count: motrexEcoDriving.count,
      })
      .from(motrexEcoDriving)
      .where(and(gte(motrexEcoDriving.reportDate, fromDate), lte(motrexEcoDriving.reportDate, toDate)))
      .orderBy(motrexEcoDriving.reportDate);
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

export async function ensureSchema(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS report_snapshots (
      id SERIAL PRIMARY KEY,
      report_type TEXT NOT NULL CHECK (report_type IN ('yards', 'trips', 'utilization', 'eco_driving')),
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
}
