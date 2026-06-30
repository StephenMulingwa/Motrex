import { parseDateTimeMs } from "./sortableTable";
import { registrationLabel } from "./vehicleLabels";

type Endpoint = "tororo" | "athi";

interface TripEvent {
  vehicle: string;
  endpoint: Endpoint;
  geofence: string;
  timeIn: string;
  timeOut: string;
  timestamp: number;
}

interface LegRow extends Record<string, string | number> {
  Table: "Outbound" | "Inbound";
  Vehicle: string;
  From: string;
  To: string;
  "Departure Time": string;
  "Arrival Time": string;
  "Transit Time": string;
  "Trip Count": number;
  "Report Date": string;
}

interface TatRow extends Record<string, string | number> {
  Table: "TAT";
  Vehicle: string;
  "Tororo Departure": string;
  "Athi River Arrival": string;
  "Athi River Departure": string;
  "Tororo Return": string;
  "Outbound Transit": string;
  "Time at Athi River": string;
  "Inbound Transit": string;
  "Full Round-Trip TAT": string;
  "Trip Count": number;
  "Report Date": string;
}

function pickKey(row: Record<string, unknown>, patterns: RegExp[]): string | null {
  for (const key of Object.keys(row)) {
    const lower = key.toLowerCase();
    if (patterns.some((pattern) => pattern.test(lower))) return key;
  }
  return null;
}

function value(row: Record<string, unknown>, key: string | null): string {
  return key ? String(row[key] ?? "").trim() : "";
}

function endpointForGeofence(geofence: string): Endpoint | null {
  const g = geofence.toLowerCase();
  if (/tororo/.test(g)) return "tororo";
  if (/athi|arthi|mombasa|vipingo/.test(g)) return "athi";
  return null;
}

function endpointLabel(endpoint: Endpoint): string {
  return endpoint === "tororo" ? "Tororo" : "Athi River";
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function diffLabel(end: string, start: string): string {
  const endMs = parseDateTimeMs(end);
  const startMs = parseDateTimeMs(start);
  if (!Number.isFinite(endMs) || !Number.isFinite(startMs)) return "";
  return formatDuration(endMs - startMs);
}

const WIALON_TRIP_COLUMNS = [
  "Grouping",
  "Trip",
  "Trip from",
  "Trip to",
  "Beginning",
  "End",
  "Mileage",
  "Consumed by AbsFCS",
  "Avg consumption by AbsFCS",
  "Trip duration",
  "Total time",
  "Parkings duration",
  "Avg speed",
  "Max speed",
  "Initial fuel level",
  "Final fuel level",
  "Count",
] as const;

function preserveWialonTripColumns(row: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(WIALON_TRIP_COLUMNS.map((column) => [column, String(row[column] ?? "")]));
}

function normalizeTripEvents(rows: Record<string, unknown>[]): TripEvent[] {
  return rows
    .map((row) => {
      const vehicleKey = pickKey(row, [/^vehicle$|vehicle|unit|registration|plate|name/i]);
      const geofenceKey = pickKey(row, [/geofence|geozone|location|place/i]);
      const timeInKey = pickKey(row, [/time\s*in|beginning|entry|arrival|from/i]);
      const timeOutKey = pickKey(row, [/time\s*out|end|exit|departure|to/i]);
      const geofence = value(row, geofenceKey);
      const endpoint = endpointForGeofence(geofence);
      const timeIn = value(row, timeInKey);
      const timeOut = value(row, timeOutKey);
      const timestamp = parseDateTimeMs(timeIn || timeOut);
      return {
        vehicle: registrationLabel(value(row, vehicleKey)),
        endpoint,
        geofence,
        timeIn,
        timeOut,
        timestamp,
      };
    })
    .filter((row): row is TripEvent => Boolean(row.vehicle && row.endpoint && row.timestamp > 0));
}

export function buildMotrexTripTables(rows: Record<string, unknown>[], reportDate: string): Record<string, string | number>[] {
  const events = normalizeTripEvents(rows);
  const byVehicle = new Map<string, TripEvent[]>();
  for (const event of events) {
    const list = byVehicle.get(event.vehicle) ?? [];
    list.push(event);
    byVehicle.set(event.vehicle, list);
  }

  const outbound: LegRow[] = [];
  const inbound: LegRow[] = [];

  for (const row of rows) {
    const vehicleKey = pickKey(row, [/^vehicle$|vehicle|unit|registration|plate|name|grouping/i]);
    const fromKey = pickKey(row, [/^trip\s*from$|trip\s*from/i]);
    const toKey = pickKey(row, [/^trip\s*to$|trip\s*to/i]);
    const beginningKey = pickKey(row, [/^beginning$|beginning|departure/i]);
    const endKey = pickKey(row, [/^end$|arrival/i]);
    if (!fromKey || !toKey || !beginningKey || !endKey) continue;

    const from = endpointForGeofence(value(row, fromKey));
    const to = endpointForGeofence(value(row, toKey));
    const vehicle = registrationLabel(value(row, vehicleKey));
    if (!vehicle || !from || !to || from === to) continue;

    const departure = value(row, beginningKey);
    const arrival = value(row, endKey);
    const table = from === "athi" && to === "tororo" ? "Outbound" : "Inbound";
    const leg: LegRow = {
      ...preserveWialonTripColumns(row),
      Table: table,
      Vehicle: vehicle,
      From: endpointLabel(from),
      To: endpointLabel(to),
      "Departure Time": departure,
      "Arrival Time": arrival,
      "Transit Time": String(row["Trip duration"] ?? "") || diffLabel(arrival, departure),
      "Parkings duration": String(row["Parkings duration"] ?? ""),
      "Total time": String(row["Total time"] ?? ""),
      "Trip Count": Number(row.Count ?? 1) || 1,
      "Report Date": reportDate,
    };
    if (table === "Outbound") outbound.push(leg);
    else inbound.push(leg);
  }

  for (const [vehicle, vehicleEvents] of byVehicle) {
    const sorted = vehicleEvents.sort((a, b) => a.timestamp - b.timestamp);
    let previous: TripEvent | null = null;

    for (const event of sorted) {
      if (!previous) {
        previous = event;
        continue;
      }
      if (event.endpoint === previous.endpoint) {
        previous = event;
        continue;
      }

      const from = previous.endpoint;
      const to = event.endpoint;
      const departure = previous.timeOut || previous.timeIn;
      const arrival = event.timeIn || event.timeOut;
      const table = from === "athi" && to === "tororo" ? "Outbound" : "Inbound";
      const leg: LegRow = {
        Table: table,
        Vehicle: vehicle,
        From: endpointLabel(from),
        To: endpointLabel(to),
        "Departure Time": departure,
        "Arrival Time": arrival,
        "Transit Time": diffLabel(arrival, departure),
        "Trip Count": 1,
        "Report Date": reportDate,
      };
      if (table === "Outbound") outbound.push(leg);
      else inbound.push(leg);
      previous = event;
    }
  }

  const tat: TatRow[] = [];
  const inboundByVehicle = new Map<string, LegRow[]>();
  for (const leg of inbound) {
    const list = inboundByVehicle.get(leg.Vehicle) ?? [];
    list.push(leg);
    inboundByVehicle.set(leg.Vehicle, list);
  }

  for (const leg of outbound) {
    const candidates = (inboundByVehicle.get(leg.Vehicle) ?? []).filter(
      (candidate) => parseDateTimeMs(candidate["Departure Time"]) >= parseDateTimeMs(leg["Arrival Time"]),
    );
    const returnLeg = candidates.sort(
      (a, b) => parseDateTimeMs(a["Departure Time"]) - parseDateTimeMs(b["Departure Time"]),
    )[0];
    if (!returnLeg) continue;

    tat.push({
      Table: "TAT",
      Vehicle: leg.Vehicle,
      "Tororo Departure": leg["Departure Time"],
      "Athi River Arrival": leg["Arrival Time"],
      "Athi River Departure": returnLeg["Departure Time"],
      "Tororo Return": returnLeg["Arrival Time"],
      "Outbound Transit": leg["Transit Time"],
      "Time at Athi River": diffLabel(returnLeg["Departure Time"], leg["Arrival Time"]),
      "Inbound Transit": returnLeg["Transit Time"],
      "Full Round-Trip TAT": diffLabel(returnLeg["Arrival Time"], leg["Departure Time"]),
      "Trip Count": 1,
      "Report Date": reportDate,
    });
  }

  return [...outbound, ...inbound, ...tat].map((row) => ({ ...row }));
}
