import type { LiveMonitorDataset, LiveMonitorKpis, LiveMonitorRow } from "@/lib/data";
import { parseKenyaDateTime } from "@/lib/dateRange";
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

function shiftWialonDateTime(value: string): string {
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
  dt.setHours(dt.getHours() + 3);
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
  windowFromMs: number,
  windowToMs: number,
): LiveMonitorRow[] {
  const idxVehicle = pickAny(headers, [/group|vehicle|unit|name/]);
  const idxLocation = pickAny(headers, [/location|address|place|position/]);
  const idxLastUpdate = pickAny(headers, [/last update|last message|time|date/]);
  const idxSpeed = pickAny(headers, [/speed/]);
  const idxStatus = pickAny(headers, [/status/]);

  return rawRows.map((row) => {
    const cells = row.c ?? [];
    const vehicle = cellText(cells[idxVehicle >= 0 ? idxVehicle : 0]);
    const locCell = cells[idxLocation >= 0 ? idxLocation : 1];
    const location = cellText(locCell);
    const coords = cellCoords(locCell);
    const lastRaw = cellText(cells[idxLastUpdate >= 0 ? idxLastUpdate : 2]);
    const lastUpdate = shiftWialonDateTime(lastRaw) || lastRaw;
    const speedKmh = toNumber(cellText(cells[idxSpeed >= 0 ? idxSpeed : 3]));
    const statusRaw = idxStatus >= 0 ? cellText(cells[idxStatus]) : "";
    const status =
      statusRaw ||
      (speedKmh > 0 ? "🟢 Moving" : "🔴 Stationary");

    let updatedInWindow = false;
    const parsed = parseKenyaDateTime(lastUpdate.replace(" ", "T"));
    if (!Number.isNaN(parsed)) {
      updatedInWindow = parsed >= windowFromMs && parsed <= windowToMs;
    }

    return {
      vehicle,
      currentLocation: location || "—",
      lat: coords.lat,
      lon: coords.lon,
      lastUpdate: lastUpdate || "—",
      speedKmh,
      status,
      updatedInWindow,
    };
  });
}

function computeKpis(rows: LiveMonitorRow[]): LiveMonitorKpis {
  const tracked = rows.length;
  const notUpdatedInWindow = rows.filter((r) => !r.updatedInWindow).length;
  const active = rows.filter((r) => r.speedKmh > 0).length;
  const stationary = Math.max(0, tracked - active);
  const avgSpeed =
    tracked > 0
      ? Math.round((rows.reduce((s, r) => s + r.speedKmh, 0) / tracked) * 10) / 10
      : 0;
  return { tracked, notUpdatedInWindow, active, stationary, avgSpeed };
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

    const rows = parseLiveRows(headers, rawRows, fromMs, toMs).sort((a, b) =>
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
