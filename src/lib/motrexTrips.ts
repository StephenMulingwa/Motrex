import { parseDateTimeMs } from "./parseDateTime";
import { registrationLabel } from "./vehicleLabels";

export type TripDirection = "Outbound" | "Inbound";

export interface GroupTripTableMeta {
  match: RegExp;
  direction: TripDirection;
  routePair: "motrex_tororo" | "multiple_tororo" | "vipingo_tororo_athi";
  label: string;
}

/** Six Wialon tables in SM_Motrex - Group Trips (template 62). */
export const GROUP_TRIP_TABLES: GroupTripTableMeta[] = [
  {
    match: /motrex\s*-\s*tororo/i,
    direction: "Outbound",
    routePair: "motrex_tororo",
    label: "Motrex - Tororo",
  },
  {
    match: /tororo\s*-\s*motrex/i,
    direction: "Inbound",
    routePair: "motrex_tororo",
    label: "Tororo - Motrex",
  },
  {
    match: /multiple\s*-\s*tororo/i,
    direction: "Outbound",
    routePair: "multiple_tororo",
    label: "Multiple - Tororo",
  },
  {
    match: /tororo\s*-\s*multiple/i,
    direction: "Inbound",
    routePair: "multiple_tororo",
    label: "Tororo - Multiple",
  },
  {
    match: /vipingo\s*-\s*tororo\s*\/?\s*athi/i,
    direction: "Outbound",
    routePair: "vipingo_tororo_athi",
    label: "Vipingo - Tororo/Athi",
  },
  {
    match: /tororo\s*\/?\s*athi\s*-\s*vipingo/i,
    direction: "Inbound",
    routePair: "vipingo_tororo_athi",
    label: "Tororo/Athi - Vipingo",
  },
];

interface LegRow extends Record<string, string | number> {
  Table: TripDirection;
  Vehicle: string;
  From: string;
  To: string;
  "Loading Zone": string;
  "Offloading Zone": string;
  "Route Pair": string;
  "Wialon Table": string;
  "Departure Time": string;
  "Arrival Time": string;
  "Transit Time": string;
  "Trip Count": number;
  "Report Date": string;
}

interface TatRow extends Record<string, string | number> {
  Table: "TAT";
  Vehicle: string;
  "Loading Departure": string;
  "Offloading Arrival": string;
  "Offloading Departure": string;
  "Loading Return": string;
  "Outbound Transit": string;
  "Time at Offload": string;
  "Customer Time": string;
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

export function matchGroupTripTable(tableName: string): GroupTripTableMeta | null {
  const name = String(tableName ?? "").trim();
  if (!name) return null;
  return GROUP_TRIP_TABLES.find((t) => t.match.test(name)) ?? null;
}

function zoneLabel(raw: string): string {
  const g = raw.toLowerCase();
  if (/tororo/.test(g)) return "Tororo";
  if (/athi|arthi/.test(g)) return "Athi River";
  if (/kibarani|multiple/.test(g)) return "Multiple Kibarani";
  if (/vipingo\s*main|main\s*yard/.test(g)) return "Vipingo Main yard";
  if (/vipingo|mombasa\s*cement/.test(g)) return "Mombasa Cement(Vipingo Area)";
  return raw.trim() || "Unknown";
}

export function isOffloadingZone(zone: string): boolean {
  return /tororo|athi|arthi/i.test(zone);
}

export function isLoadingZone(zone: string): boolean {
  return /vipingo|mombasa|kibarani|multiple|motrex/i.test(zone) && !isOffloadingZone(zone);
}

/**
 * Build Outbound / Inbound / TAT rows from template-62 detalization rows.
 * Prefer rows tagged with `_wialonTable` (multi-table fetch). Falls back to Trip from/to heuristics.
 */
export function buildMotrexTripTables(
  rows: Record<string, unknown>[],
  reportDate: string,
): Record<string, string | number>[] {
  const outbound: LegRow[] = [];
  const inbound: LegRow[] = [];

  for (const row of rows) {
    const vehicleKey = pickKey(row, [/^vehicle$|vehicle|unit|registration|plate|name|grouping/i]);
    const fromKey = pickKey(row, [/^trip\s*from$|trip\s*from/i]);
    const toKey = pickKey(row, [/^trip\s*to$|trip\s*to/i]);
    const beginningKey = pickKey(row, [/^beginning$|beginning|departure/i]);
    const endKey = pickKey(row, [/^end$|arrival/i]);

    const vehicle = registrationLabel(value(row, vehicleKey) || value(row, pickKey(row, [/grouping/i])));
    if (!vehicle) continue;

    const tripFrom = value(row, fromKey);
    const tripTo = value(row, toKey);
    const departure = value(row, beginningKey);
    const arrival = value(row, endKey);
    if (!tripFrom || !tripTo || !departure || !arrival) continue;

    const tableName = String(row._wialonTable ?? row["Wialon Table"] ?? "");
    const meta = matchGroupTripTable(tableName);

    let direction: TripDirection;
    let routePair: string;
    let wialonTable: string;

    if (meta) {
      direction = meta.direction;
      routePair = meta.routePair;
      wialonTable = meta.label;
    } else {
      // Fallback: Vipingo/Motrex/Multiple → Tororo/Athi = Outbound
      const fromOffload = isOffloadingZone(tripFrom);
      const toOffload = isOffloadingZone(tripTo);
      if (fromOffload === toOffload) continue;
      direction = !fromOffload && toOffload ? "Outbound" : "Inbound";
      routePair = /kibarani|multiple/i.test(tripFrom + tripTo)
        ? "multiple_tororo"
        : /vipingo\s*main|main\s*yard/i.test(tripFrom + tripTo)
          ? "vipingo_tororo_athi"
          : "motrex_tororo";
      wialonTable = tableName || "inferred";
    }

    const loadingZone = direction === "Outbound" ? zoneLabel(tripFrom) : zoneLabel(tripTo);
    const offloadingZone = direction === "Outbound" ? zoneLabel(tripTo) : zoneLabel(tripFrom);

    const leg: LegRow = {
      ...preserveWialonTripColumns(row),
      Table: direction,
      Vehicle: vehicle,
      From: zoneLabel(tripFrom),
      To: zoneLabel(tripTo),
      "Loading Zone": loadingZone,
      "Offloading Zone": offloadingZone,
      "Route Pair": routePair,
      "Wialon Table": wialonTable,
      "Departure Time": departure,
      "Arrival Time": arrival,
      "Transit Time": String(row["Trip duration"] ?? "") || diffLabel(arrival, departure),
      "Parkings duration": String(row["Parkings duration"] ?? ""),
      "Total time": String(row["Total time"] ?? ""),
      "Trip Count": Number(row.Count ?? 1) || 1,
      "Report Date": reportDate,
    };

    if (direction === "Outbound") outbound.push(leg);
    else inbound.push(leg);
  }

  const tat: TatRow[] = [];
  const inboundByKey = new Map<string, LegRow[]>();
  for (const leg of inbound) {
    const key = `${leg.Vehicle}::${leg["Route Pair"]}`;
    inboundByKey.set(key, [...(inboundByKey.get(key) ?? []), leg]);
  }

  for (const leg of outbound) {
    const key = `${leg.Vehicle}::${leg["Route Pair"]}`;
    const candidates = (inboundByKey.get(key) ?? []).filter(
      (candidate) => parseDateTimeMs(candidate["Departure Time"]) >= parseDateTimeMs(leg["Arrival Time"]),
    );
    const returnLeg = candidates.sort(
      (a, b) => parseDateTimeMs(a["Departure Time"]) - parseDateTimeMs(b["Departure Time"]),
    )[0];
    if (!returnLeg) continue;

    tat.push({
      Table: "TAT",
      Vehicle: leg.Vehicle,
      "Loading Departure": leg["Departure Time"],
      "Offloading Arrival": leg["Arrival Time"],
      "Offloading Departure": returnLeg["Departure Time"],
      "Loading Return": returnLeg["Arrival Time"],
      "Outbound Transit": leg["Transit Time"],
      "Time at Offload": diffLabel(returnLeg["Departure Time"], leg["Arrival Time"]),
      "Customer Time": diffLabel(returnLeg["Departure Time"], leg["Arrival Time"]),
      "Inbound Transit": returnLeg["Transit Time"],
      "Full Round-Trip TAT": diffLabel(returnLeg["Arrival Time"], leg["Departure Time"]),
      "Trip Count": 1,
      "Report Date": reportDate,
    });
  }

  return [...outbound, ...inbound, ...tat].map((row) => ({ ...row }));
}
