import { parseDateTimeMs } from "./sortableTable";
import { formatEatDateTime } from "./dateRange";
import { registrationLabel } from "./vehicleLabels";

export interface NormalizedYardsRow {
  registrationNumber: string;
  vehicle: string;
  geofence: string;
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
}

const OUT_OF_GEOFENCE_RE = /out\s+of\s+geofence/i;
const CURRENT_YARD_GEOFENCES = new Set(["mcl parking vipingo", "motrex mikindani yard"]);

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
    .map((row) => ({
      registrationNumber: registrationLabel(String(row[registrationKey] ?? row[vehicleKey] ?? "")),
      vehicle: registrationLabel(String(row[vehicleKey] ?? "")),
      geofence: String(row[geofenceKey] ?? "").trim(),
      timeIn: timeInKey ? String(row[timeInKey] ?? "").trim() : "",
      timeOut: timeOutKey ? String(row[timeOutKey] ?? "").trim() : "",
      duration: durationKey ? String(row[durationKey] ?? "").trim() : "",
      lastExecutionTime: lastExecutionKey ? formatEatDateTime(String(row[lastExecutionKey] ?? "").trim()) : "",
      reportDate: row._reportDate ? String(row._reportDate) : undefined,
    }))
    .filter((r) => r.registrationNumber && r.geofence);
}

export function isOutOfGeofences(name: string): boolean {
  return OUT_OF_GEOFENCE_RE.test(name.trim());
}

function normalizeGeofenceName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isCurrentYardGeofence(name: string): boolean {
  return CURRENT_YARD_GEOFENCES.has(normalizeGeofenceName(name));
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

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function durationFromRow(row: NormalizedYardsRow, endMs: number): { label: string; days: number } {
  const startMs = rowTimestamp(row);
  if (startMs <= 0) return { label: "—", days: 0 };

  const startFromTimeIn = parseDateTimeMs(row.timeIn);
  const start = startFromTimeIn > 0 ? startFromTimeIn : startMs;
  const diff = Math.max(0, endMs - start);
  return { label: formatDuration(diff), days: diff / 86400000 };
}

/**
 * Vehicles currently inside a named yard geofence.
 * A vehicle is included when its latest event (by time) is a named yard, not "Out of geofences".
 */
export function computeYardsInside(rows: Record<string, unknown>[], endMs = Date.now()): YardsInsideRow[] {
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
    if (!latest || isOutOfGeofences(latest.geofence) || !isCurrentYardGeofence(latest.geofence)) continue;

    const { label, days } = durationFromRow(latest, endMs);
    results.push({
      registrationNumber,
      vehicle: registrationLabel(latest.vehicle || registrationNumber),
      geofence: latest.geofence,
      timeIn: latest.timeIn || latest.reportDate || "—",
      lastExecutionTime: latest.lastExecutionTime || latest.reportDate || "—",
      duration: label,
      durationDays: days,
      status: "Inside",
    });
  }

  return results.sort((a, b) => b.durationDays - a.durationDays);
}

export function filterByMinDays(rows: YardsInsideRow[], minDays: number | null): YardsInsideRow[] {
  if (minDays == null || minDays <= 0) return rows;
  return rows.filter((r) => r.durationDays >= minDays);
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
