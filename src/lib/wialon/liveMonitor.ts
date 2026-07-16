import type { LiveMonitorDataset, LiveMonitorKpis, LiveMonitorRow, LiveMonitorStatus } from "@/lib/data";
import { parseKenyaDateTime } from "@/lib/dateRange";
import { computeDirection } from "@/lib/liveMonitorDirection";
import { resolveGeofence } from "@/lib/motrexGeofences";
import {
  MOTREX_GROUP_ID,
  MOTREX_RESOURCE_ID,
  TEMPLATES,
} from "@/lib/motrexConfig";
import {
  cellCoords,
  cellText,
  execReport,
  fetchTableRowsRaw,
  pickAny,
  toNumber,
  wialonLogin,
  wialonLogout,
  type RawRow,
} from "./client";

function formatWialonDateTime(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-----") return raw;
  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return raw;
  const dd = Number(match[1]);
  const mm = Number(match[2]);
  const yyyy = Number(match[3]);
  const hh = Number(match[4] ?? 0);
  const min = Number(match[5] ?? 0);
  const ss = Number(match[6] ?? 0);
  const dt = new Date(yyyy, mm - 1, dd, hh, min, ss);
  if (Number.isNaN(dt.getTime())) return raw;
  const outDd = String(dt.getDate()).padStart(2, "0");
  const outMm = String(dt.getMonth() + 1).padStart(2, "0");
  const outYy = dt.getFullYear();
  const outHh = String(dt.getHours()).padStart(2, "0");
  const outMin = String(dt.getMinutes()).padStart(2, "0");
  const outSs = String(dt.getSeconds()).padStart(2, "0");
  return `${outYy}-${outMm}-${outDd} ${outHh}:${outMin}:${outSs}`;
}

function parseLiveRows(
  headers: string[],
  rawRows: RawRow[],
): LiveMonitorRow[] {
  const idxVehicle = pickAny(headers, [/group|vehicle|unit|name/]);
  const idxLocation = pickAny(headers, [/location|address|place|position/]);
  const idxLastUpdate = pickAny(headers, [/last update|last message|time|date/]);
  const idxSpeed = pickAny(headers, [/speed/]);
  const freshSinceMs = Date.now() - 60 * 60 * 1000;
  return rawRows.map((row) => {
    const cells = row.c ?? [];
    const vehicle = cellText(cells[idxVehicle >= 0 ? idxVehicle : 0]);
    const locCell = cells[idxLocation >= 0 ? idxLocation : 1];
    const location = cellText(locCell);
    const coords = cellCoords(locCell);
    const lastRaw = cellText(cells[idxLastUpdate >= 0 ? idxLastUpdate : 2]);
    const lastUpdate = formatWialonDateTime(lastRaw) || lastRaw;
    const speedKmh = toNumber(cellText(cells[idxSpeed >= 0 ? idxSpeed : 3]));

    let updatedInWindow = false;
    let lastUpdateMs: number | null = null;
    const parsed = parseKenyaDateTime(lastUpdate.replace(" ", "T"));
    if (!Number.isNaN(parsed)) {
      lastUpdateMs = parsed;
      updatedInWindow = parsed >= freshSinceMs;
    }
    const statusCategory: LiveMonitorStatus = !updatedInWindow ? "unknown" : speedKmh > 5 ? "moving" : "stationary";
    const status =
      statusCategory === "moving"
        ? "🟢 Moving"
        : statusCategory === "stationary"
          ? "🔴 Stationary"
          : "⚪ Unknown";

    const geofence = resolveGeofence(coords.lat, coords.lon, location);
    const currentLocation = geofence ?? (location || "—");

    const baseRow = {
      vehicle,
      currentLocation,
      lat: coords.lat,
      lon: coords.lon,
      lastUpdate: lastUpdate || "—",
      lastUpdateMs,
      geofence,
      speedKmh,
      status,
      statusCategory,
      updatedInWindow,
    };

    return {
      ...baseRow,
      direction: computeDirection(baseRow, undefined),
    };
  });
}

function computeKpis(rows: LiveMonitorRow[]): LiveMonitorKpis {
  const tracked = rows.length;
  const moving = rows.filter((r) => r.statusCategory === "moving").length;
  const stationary = rows.filter((r) => r.statusCategory === "stationary").length;
  const unknown = rows.filter((r) => r.statusCategory === "unknown").length;
  return { tracked, moving, stationary, unknown };
}

export async function fetchLiveMonitor(fromMs: number, toMs: number): Promise<LiveMonitorDataset> {
  const sid = await wialonLogin();
  try {
    const { tables } = await execReport(sid, {
      resourceId: MOTREX_RESOURCE_ID,
      templateId: TEMPLATES.onlineStatus,
      objectId: MOTREX_GROUP_ID,
      from: Math.floor(fromMs / 1000),
      to: Math.floor(toMs / 1000),
    });

    let rawRows: RawRow[] = [];
    let headers: string[] = [];

    const primary = tables[0];
    if (primary && primary.rows > 0) {
      headers = primary.header;
      rawRows = await fetchTableRowsRaw(sid, 0, primary.rows);
    }

    if (!rawRows.length && tables.length > 1) {
      for (let ti = 1; ti < tables.length; ti += 1) {
        const t = tables[ti];
        if (t.rows > 0) {
          headers = t.header;
          rawRows = await fetchTableRowsRaw(sid, ti, t.rows);
          if (rawRows.length) break;
        }
      }
    }

    const rows = parseLiveRows(headers, rawRows).sort((a, b) =>
      a.vehicle.localeCompare(b.vehicle),
    );

    return {
      rows,
      kpis: computeKpis(rows),
      fetchedAt: new Date().toISOString(),
      range: {
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
      },
    };
  } finally {
    await wialonLogout(sid);
  }
}
