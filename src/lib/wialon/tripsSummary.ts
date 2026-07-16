import {
  MOTREX_GROUP_ID,
  TEMPLATES,
  TRIPS_SUMMARY_BATCH_SIZE,
} from "@/lib/motrexConfig";
import { dayBoundsUnix } from "@/lib/dateRange";
import { registrationKey, registrationLabel } from "@/lib/vehicleLabels";
import { fetchUnitGroupUnitIds, toNumber, wialonLogin, wialonLogout } from "./client";
import { runTemplateReportForBounds, withWialonRetry } from "./reports";

export interface TripsSummaryMappedRow {
  registrationNumber: string;
  vehicle: string;
  mileageKm: number;
  fuelConsumedL: number;
  avgConsumptionKml: number;
  parkingsSec: number;
  maxSpeedKmh: number;
  utilizationPct: number;
  engineHoursSec: number;
  timeInTripsSec: number;
  consumedFlsL: number;
  avgConsumptionFlsL100: number;
  rawRow: Record<string, unknown>;
}

function pickKey(row: Record<string, string>, patterns: RegExp[]): string | null {
  for (const key of Object.keys(row)) {
    const lower = key.toLowerCase();
    if (patterns.some((p) => p.test(lower))) return key;
  }
  return null;
}

function cell(row: Record<string, string>, key: string | null): string {
  return key ? String(row[key] ?? "").trim() : "";
}

/** Parse Wialon duration strings like "2 days 14:57:38" or "0:00:00". */
export function parseWialonDurationSec(value: unknown): number {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || text === "-----") return 0;
  let total = 0;
  const dayMatch = text.match(/(\d+(?:\.\d+)?)\s*d(?:ay|ays)?/);
  if (dayMatch) total += Number(dayMatch[1]) * 86400;
  const timeMatch = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (timeMatch) {
    total += Number(timeMatch[1]) * 3600;
    total += Number(timeMatch[2]) * 60;
    total += Number(timeMatch[3] ?? 0);
  } else {
    const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
    const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?!p)/);
    if (hourMatch) total += Number(hourMatch[1]) * 3600;
    if (minuteMatch) total += Number(minuteMatch[1]) * 60;
  }
  return Number.isFinite(total) && total > 0 ? total : 0;
}

export function formatWialonDurationSec(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return "";
  const sec = Math.floor(totalSec);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  const time = `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (days === 1) return `1 day ${time}`;
  if (days > 1) return `${days} days ${time}`;
  return time;
}

export function mapTripsSummaryRows(rows: Record<string, string>[]): TripsSummaryMappedRow[] {
  return rows.map((row) => {
    const vehicleKey = pickKey(row, [/^grouping$|^vehicle$|vehicle|unit|group|name/i]);
    const regKey = pickKey(row, [/registration|reg\s*no|plate|number/i]);
    const mileageKey = pickKey(row, [/mileage\s*in\s*trips|^mileage$|distance/i]);
    const fuelKey = pickKey(row, [/consumed\s*by\s*fls|^consumed|fuel/i]);
    const avgKey = pickKey(row, [/avg\.?\s*consumption\s*by\s*fls|avg.*consum|consum.*avg|km\/l|l\/100/i]);
    const parkingsKey = pickKey(row, [/^parkings$|parking/i]);
    const maxSpeedKey = pickKey(row, [/max\.?\s*speed|maximum\s*speed/i]);
    const utilKey = pickKey(row, [/^utilization$|utili/i]);
    const engineKey = pickKey(row, [/engine\s*hours|engine\s*hrs/i]);
    const timeInTripsKey = pickKey(row, [/time\s*in\s*trips/i]);
    const flsKey = pickKey(row, [/consumed\s*by\s*fls/i]);
    const avgFlsKey = pickKey(row, [/avg\.?\s*consumption\s*by\s*fls/i]);

    const vehicle = registrationLabel(cell(row, vehicleKey) || cell(row, regKey) || "Unknown");
    const registrationNumber = registrationKey(registrationLabel(cell(row, regKey) || vehicle)) || vehicle;

    const mileageKm = toNumber(cell(row, mileageKey));
    const fuelConsumedL = toNumber(cell(row, fuelKey) || cell(row, flsKey));
    const consumedFlsL = toNumber(cell(row, flsKey) || cell(row, fuelKey));

    let avgConsumptionFlsL100 = toNumber(cell(row, avgFlsKey) || cell(row, avgKey));
    const avgHeader = (avgFlsKey || avgKey)?.toLowerCase() ?? "";
    if (avgConsumptionFlsL100 > 0 && !/l\/100|100\s*km/i.test(avgHeader) && avgConsumptionFlsL100 < 30) {
      avgConsumptionFlsL100 = 100 / avgConsumptionFlsL100;
    } else if (avgConsumptionFlsL100 <= 0 && consumedFlsL > 0 && mileageKm > 0) {
      avgConsumptionFlsL100 = (consumedFlsL / mileageKm) * 100;
    }

    const avgConsumptionKml =
      avgConsumptionFlsL100 > 0
        ? 100 / avgConsumptionFlsL100
        : mileageKm > 0 && fuelConsumedL > 0
          ? mileageKm / fuelConsumedL
          : 0;

    return {
      registrationNumber,
      vehicle,
      mileageKm,
      fuelConsumedL: fuelConsumedL || consumedFlsL,
      avgConsumptionKml,
      parkingsSec: parseWialonDurationSec(cell(row, parkingsKey)),
      maxSpeedKmh: toNumber(cell(row, maxSpeedKey)),
      utilizationPct: toNumber(cell(row, utilKey)),
      engineHoursSec: parseWialonDurationSec(cell(row, engineKey)),
      timeInTripsSec: parseWialonDurationSec(cell(row, timeInTripsKey)),
      consumedFlsL: consumedFlsL || fuelConsumedL,
      avgConsumptionFlsL100,
      rawRow: row as Record<string, unknown>,
    };
  });
}

/** Extract metrics from a stored raw_row (supports already-synced weeks). */
export function metricsFromSummaryRawRow(raw: Record<string, unknown> | null | undefined): {
  mileageKm: number;
  fuelConsumedL: number;
  parkingsSec: number;
  maxSpeedKmh: number;
  utilizationPct: number;
  engineHoursSec: number;
  timeInTripsSec: number;
  consumedFlsL: number;
  avgConsumptionFlsL100: number;
} {
  const row: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) row[k] = String(v ?? "");
  const mapped = mapTripsSummaryRows([row])[0];
  return {
    mileageKm: mapped.mileageKm,
    fuelConsumedL: mapped.fuelConsumedL,
    parkingsSec: mapped.parkingsSec,
    maxSpeedKmh: mapped.maxSpeedKmh,
    utilizationPct: mapped.utilizationPct,
    engineHoursSec: mapped.engineHoursSec,
    timeInTripsSec: mapped.timeInTripsSec,
    consumedFlsL: mapped.consumedFlsL,
    avgConsumptionFlsL100: mapped.avgConsumptionFlsL100,
  };
}

export function splitSummaryBatches(unitIds: number[]): number[][] {
  const batches: number[][] = [];
  for (let i = 0; i < unitIds.length; i += TRIPS_SUMMARY_BATCH_SIZE) {
    batches.push(unitIds.slice(i, i + TRIPS_SUMMARY_BATCH_SIZE));
  }
  return batches.filter((batch) => batch.length > 0);
}

function shouldTripsSummarySplitFallback(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /Track3 Database error (1|1003|1004|1005|6)|LIMIT exec_report_duration|LIMIT msgs_activity|timeout|temporar|ECONNRESET|ETIMEDOUT|fetch failed|Invalid session/i.test(
    msg,
  );
}

async function fetchTripsSummaryBatch(
  sid: string,
  weekStart: string,
  weekEnd: string,
  unitIds: number[],
): Promise<TripsSummaryMappedRow[]> {
  const { from } = dayBoundsUnix(weekStart);
  const endBounds = dayBoundsUnix(weekEnd);
  const result = await runTemplateReportForBounds(
    sid,
    TEMPLATES.tripsSummary,
    from,
    endBounds.to,
    unitIds,
    unitIds.length > 150,
  );
  return mapTripsSummaryRows(result.rows);
}

async function fetchTripsSummaryBatchFreshLogin(
  weekStart: string,
  weekEnd: string,
  unitIds: number[],
): Promise<TripsSummaryMappedRow[]> {
  const sid = await wialonLogin();
  try {
    return await fetchTripsSummaryBatch(sid, weekStart, weekEnd, unitIds);
  } finally {
    await wialonLogout(sid).catch(() => undefined);
  }
}

export async function executeTripsSummaryBatchWithFallback(
  weekStart: string,
  weekEnd: string,
  unitIds: number[],
  label: string,
): Promise<TripsSummaryMappedRow[]> {
  const minSplit = 10;

  async function runBatch(ids: number[], attemptLabel: string): Promise<TripsSummaryMappedRow[]> {
    const delays = ids.length > minSplit ? [45_000] : [60_000, 120_000, 180_000];
    try {
      return await withWialonRetry(
        attemptLabel,
        () => fetchTripsSummaryBatchFreshLogin(weekStart, weekEnd, ids),
        delays,
      );
    } catch (error) {
      if (ids.length <= minSplit || !shouldTripsSummarySplitFallback(error)) {
        throw error;
      }
      const mid = Math.ceil(ids.length / 2);
      console.warn(
        `${attemptLabel} failed — fallback split: ${mid} + ${ids.length - mid} vehicles`,
      );
      await new Promise((r) => setTimeout(r, 20_000));
      const first = await runBatch(ids.slice(0, mid), `${attemptLabel} (${mid})`);
      await new Promise((r) => setTimeout(r, 15_000));
      const second = await runBatch(ids.slice(mid), `${attemptLabel} (${ids.length - mid})`);
      return [...first, ...second];
    }
  }

  return runBatch(unitIds, label);
}

export async function fetchMotrexUnitIds(): Promise<number[]> {
  const sid = await wialonLogin();
  try {
    return await fetchUnitGroupUnitIds(sid, MOTREX_GROUP_ID);
  } finally {
    await wialonLogout(sid).catch(() => undefined);
  }
}
