import { parseDateTimeMs } from "./parseDateTime";
import { formatEatDateTime } from "./dateRange";
import { formatDuration, formatTimeSince } from "./formatDuration";
import { matchSelectedGeofence } from "./motrexGeofences";
import { registrationLabel } from "./vehicleLabels";

export interface NormalizedYardsRow {
  registrationNumber: string;
  vehicle: string;
  geofence: string;
  selectedGeofence: string | null;
  timeIn: string;
  timeOut: string;
  duration: string;
  lastExecutionTime: string;
  reportDate?: string;
}

export interface YardsInsideRow {
  registrationNumber: string;
  vehicle: string;
  geofence: string;
  timeIn: string;
  lastExecutionTime: string;
  duration: string;
  durationDays: number;
  status: "Inside";
  template58Visit?: Record<string, string>;
}

const OUT_OF_GEOFENCE_RE = /out\s+of\s+geofence/i;

export function isOpenVisit(timeOut: string): boolean {
  const value = String(timeOut ?? "").trim();
  if (!value || value === "—" || value === "-" || value === "0") return true;
  if (/^0{2}[.:]0{2}/.test(value)) return true;
  return parseDateTimeMs(value) <= 0;
}

function hasValidTimeOut(timeOut: string): boolean {
  return !isOpenVisit(timeOut);
}

function pickColumn(keys: string[], patterns: RegExp[]): string | null {
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (patterns.some((p) => p.test(lower))) return key;
  }
  return null;
}

export function normalizeYardsRows(rows: Record<string, unknown>[]): NormalizedYardsRow[] {
  if (!rows.length) return [];

  const sampleKeys = Object.keys(rows[0]).filter((k) => !k.startsWith("_"));
  const vehicleKey = pickColumn(sampleKeys, [/^vehicle$/, /vehicle|unit|name/i]) ?? sampleKeys[0];
  const registrationKey = pickColumn(sampleKeys, [/registration|reg\s*no|plate|number/i]) ?? vehicleKey;
  const geofenceKey = pickColumn(sampleKeys, [/geofence|geozone/i]);
  const timeInKey = pickColumn(sampleKeys, [/time\s*in|beginning|entry/i]);
  const timeOutKey = pickColumn(sampleKeys, [/time\s*out|end|exit/i]);
  const durationKey = pickColumn(sampleKeys, [/duration/i]);
  const lastExecutionKey = pickColumn(sampleKeys, [/last\s*execution|execution\s*time|executed\s*at/i]);

  if (!vehicleKey || !geofenceKey) return [];

  return rows
    .map((row) => {
      const geofence = String(row[geofenceKey] ?? "").trim();
      return {
        registrationNumber: registrationLabel(String(row[registrationKey] ?? row[vehicleKey] ?? "")),
        vehicle: registrationLabel(String(row[vehicleKey] ?? "")),
        geofence,
        selectedGeofence: matchSelectedGeofence(geofence),
        timeIn: timeInKey ? String(row[timeInKey] ?? "").trim() : "",
        timeOut: timeOutKey ? String(row[timeOutKey] ?? "").trim() : "",
        duration: durationKey ? String(row[durationKey] ?? "").trim() : "",
        lastExecutionTime: lastExecutionKey ? formatEatDateTime(String(row[lastExecutionKey] ?? "").trim()) : "",
        reportDate: row._reportDate ? String(row._reportDate) : undefined,
      };
    })
    .filter((r) => r.registrationNumber && r.geofence);
}

export function isOutOfGeofences(name: string): boolean {
  return OUT_OF_GEOFENCE_RE.test(name.trim());
}

function rowTimestamp(row: NormalizedYardsRow): number {
  const candidates = [parseDateTimeMs(row.timeOut), parseDateTimeMs(row.timeIn)].filter((v) => Number.isFinite(v) && v > 0);
  if (candidates.length) return Math.max(...candidates);
  if (row.reportDate) return parseKenyaDateMs(`${row.reportDate}T12:00:00`);
  return 0;
}

function parseKenyaDateMs(input: string): number {
  const ms = Date.parse(input.includes("+") ? input : `${input}+03:00`);
  return Number.isFinite(ms) ? ms : 0;
}

function eventTimeInMs(row: NormalizedYardsRow): number {
  const timeIn = parseDateTimeMs(row.timeIn);
  if (timeIn > 0) return timeIn;
  return rowTimestamp(row);
}

function findCurrentStintStartMs(events: NormalizedYardsRow[], selectedGeofence: string): number {
  let startMs = 0;

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (isOutOfGeofences(event.geofence)) break;
    if (event.selectedGeofence !== selectedGeofence) break;
    if (hasValidTimeOut(event.timeOut) && i === events.length - 1) break;
    const timeInMs = eventTimeInMs(event);
    if (timeInMs > 0) startMs = timeInMs;
  }

  return startMs;
}

function formatDurationMs(ms: number, endMs: number, startMs: number | null): string {
  if (startMs != null && startMs > 0) return formatTimeSince(startMs, endMs);
  const label = formatDuration(ms);
  return label || "—";
}

export interface ComputeYardsInsideOptions {
  endMs?: number;
  lastExecutionTime?: string;
}

/**
 * Vehicles currently inside a selected geofence.
 * Duration = now minus first Time In of the current inside stint.
 */
export function computeYardsInside(
  rows: Record<string, unknown>[],
  endMsOrOptions: number | ComputeYardsInsideOptions = Date.now(),
): YardsInsideRow[] {
  const options: ComputeYardsInsideOptions =
    typeof endMsOrOptions === "number" ? { endMs: endMsOrOptions } : endMsOrOptions;
  const endMs = options.endMs ?? Date.now();
  const reportLastExecutionTime = options.lastExecutionTime ?? "";

  const normalized = normalizeYardsRows(rows);
  if (!normalized.length) return [];

  const byVehicle = new Map<string, NormalizedYardsRow[]>();
  for (const row of normalized) {
    const list = byVehicle.get(row.registrationNumber) ?? [];
    list.push(row);
    byVehicle.set(row.registrationNumber, list);
  }

  const results: YardsInsideRow[] = [];

  for (const [registrationNumber, events] of byVehicle) {
    const sorted = [...events].sort((a, b) => rowTimestamp(a) - rowTimestamp(b));
    const latest = sorted[sorted.length - 1];
    const selectedGeofence = latest?.selectedGeofence;
    if (!latest || isOutOfGeofences(latest.geofence) || !selectedGeofence) continue;
    if (hasValidTimeOut(latest.timeOut)) continue;

    const stintStartMs = findCurrentStintStartMs(sorted, selectedGeofence);
    if (stintStartMs <= 0) continue;

    const diff = Math.max(0, endMs - stintStartMs);
    results.push({
      registrationNumber,
      vehicle: registrationLabel(latest.vehicle || registrationNumber),
      geofence: selectedGeofence,
      timeIn: formatEatDateTime(stintStartMs),
      lastExecutionTime: reportLastExecutionTime || latest.lastExecutionTime || "—",
      duration: formatDurationMs(diff, endMs, stintStartMs),
      durationDays: diff / 86400000,
      status: "Inside",
    });
  }

  return results.sort((a, b) => b.durationDays - a.durationDays);
}

/** Current inside stint for a vehicle in the live-discovered geofence, or null if not inside. */
export function currentInsideRowForGeofence(
  rows: Record<string, unknown>[],
  liveGeofence: string,
  endMsOrOptions: number | ComputeYardsInsideOptions = Date.now(),
): YardsInsideRow | null {
  const inside = computeYardsInside(rows, endMsOrOptions);
  const target = matchSelectedGeofence(liveGeofence) ?? liveGeofence;
  return (
    inside.find((r) => r.geofence === target) ??
    inside.find((r) => matchSelectedGeofence(r.geofence) === target) ??
    null
  );
}

function rawVisitField(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/** Current inside stint from Template 58 visits for a live-discovered geofence. No live-monitor fallback. */
export function computeInsideSummaryFromVisits(
  visitRows: Record<string, unknown>[],
  liveGeofence: string,
  unit: { registration: string; vehicle: string },
  endMsOrOptions: number | ComputeYardsInsideOptions = Date.now(),
): (YardsInsideRow & { template58Visit: Record<string, string> }) | null {
  const options: ComputeYardsInsideOptions =
    typeof endMsOrOptions === "number" ? { endMs: endMsOrOptions } : endMsOrOptions;
  const endMs = options.endMs ?? Date.now();
  const lastExecutionTime = options.lastExecutionTime ?? formatEatDateTime(new Date(endMs));
  const targetGeofence = matchSelectedGeofence(liveGeofence) ?? liveGeofence;

  if (!visitRows.length) return null;

  const normalized = normalizeYardsRows(visitRows);
  const paired = normalized.map((n, idx) => ({ row: n, raw: visitRows[idx] ?? {} }));
  const openRows = paired.filter(({ row }) => isOpenVisit(row.timeOut));
  const candidates = openRows.length ? openRows : paired.slice(-1);

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const { row, raw } = candidates[i];
    const geofence = row.selectedGeofence ?? matchSelectedGeofence(row.geofence) ?? row.geofence;
    if (!geofence) continue;
    if (geofence !== targetGeofence && !geofence.includes(targetGeofence)) {
      continue;
    }
    if (isOutOfGeofences(row.geofence)) continue;

    const rawTimeIn = rawVisitField(raw, "Time in", "Time In") || row.timeIn;
    const rawTimeOut = rawVisitField(raw, "Time out", "Time Out") || row.timeOut;
    const rawDuration = rawVisitField(raw, "Duration in", "Duration") || row.duration;

    const timeInMs = parseDateTimeMs(rawTimeIn);
    if (timeInMs <= 0) continue;

    const diff = Math.max(0, endMs - timeInMs);
    const vehicle = registrationLabel(row.vehicle || unit.vehicle || unit.registration);
    const registration = registrationLabel(unit.registration || vehicle);

    const template58Visit: Record<string, string> = {
      Grouping: row.vehicle || unit.vehicle,
      Vehicle: row.vehicle || unit.vehicle,
      Geofence: geofence,
      "Time in": rawTimeIn,
      "Time out": rawTimeOut,
      "Duration in": rawDuration,
    };

    return {
      registrationNumber: registration,
      vehicle,
      geofence,
      timeIn: rawTimeIn,
      lastExecutionTime,
      duration: formatDurationMs(diff, endMs, timeInMs),
      durationDays: diff / 86400000,
      status: "Inside",
      template58Visit,
    };
  }

  return null;
}

/** @deprecated Use computeInsideSummaryFromVisits — no live-monitor fallback. */
export function resolveInsideRowForLiveUnit(
  visitRows: Record<string, unknown>[],
  unit: { registration: string; vehicle: string; geofence: string },
  endMsOrOptions: number | ComputeYardsInsideOptions = Date.now(),
): YardsInsideRow | null {
  const summary = computeInsideSummaryFromVisits(visitRows, unit.geofence, unit, endMsOrOptions);
  if (!summary) return null;
  const { template58Visit: _, ...row } = summary;
  return row;
}

export type DurationFilterBucket = "1" | "2" | "3";

/** 1+ day: [1,2) · 2+ days: [2,3) · 3+ days: ≥3 */
export function filterByDurationBucket(
  rows: YardsInsideRow[],
  bucket: DurationFilterBucket | null,
): YardsInsideRow[] {
  if (!bucket) return rows;
  const min = Number(bucket);
  if (min >= 3) return rows.filter((r) => r.durationDays >= 3);
  return rows.filter((r) => r.durationDays >= min && r.durationDays < min + 1);
}

/** @deprecated Use filterByDurationBucket */
export function filterByMinDays(rows: YardsInsideRow[], minDays: number | null): YardsInsideRow[] {
  if (minDays == null || minDays <= 0) return rows;
  if (minDays >= 3) return rows.filter((r) => r.durationDays >= 3);
  return rows.filter((r) => r.durationDays >= minDays && r.durationDays < minDays + 1);
}

export function distinctGeofences(rows: YardsInsideRow[]): string[] {
  return [...new Set(rows.map((r) => r.geofence).filter(Boolean))].sort();
}

export function cellSortValue(row: YardsInsideRow, key: string): number | string {
  switch (key) {
    case "vehicle":
      return row.vehicle;
    case "registrationNumber":
      return row.registrationNumber;
    case "geofence":
      return row.geofence;
    case "timeIn":
      return parseDateTimeMs(row.timeIn);
    case "duration":
      return row.durationDays;
    case "lastExecutionTime":
      return parseDateTimeMs(row.lastExecutionTime);
    case "status":
      return row.status;
    default:
      return "";
  }
}
