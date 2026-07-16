import { getYardsLiveUnixBounds } from "@/lib/dateRange";
import { MOTREX_GROUP_ID, MOTREX_RESOURCE_ID, TEMPLATES } from "@/lib/motrexConfig";
import { matchSelectedGeofence } from "@/lib/motrexGeofences";
import {
  execReport,
  fetchDetalizedZonesVisitRows,
  fetchUnitGroupUnitIds,
  wialonLogin,
  wialonLogout,
} from "./client";

/** One vehicle per Wialon execution. */
export const YARDS_BATCH_SIZE = 1;

let cachedUnitIds: number[] | null = null;

export async function getYardsUnitIds(sid: string): Promise<number[]> {
  if (!cachedUnitIds) {
    cachedUnitIds = await fetchUnitGroupUnitIds(sid, MOTREX_GROUP_ID);
  }
  return cachedUnitIds;
}

export function getYardsVehicleCount(unitCount: number): number {
  return unitCount;
}

export function getYardsVehicleId(unitIds: number[], vehicleIndex: number): number | null {
  return unitIds[vehicleIndex] ?? null;
}

export function clearYardsUnitIdCache(): void {
  cachedUnitIds = null;
}

function normalizeVisitRows(rows: Record<string, string>[]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const row of rows) {
    const rawGeofence = String(row.Geofence ?? "").trim();
    const canonical = matchSelectedGeofence(rawGeofence);
    if (!canonical) continue;
    const vehicle = String(row.Vehicle ?? row.Grouping ?? "").trim();
    if (!vehicle) continue;
    out.push({
      ...row,
      Geofence: canonical,
      Vehicle: vehicle,
      Grouping: vehicle,
    });
  }
  return out;
}

async function execVisitsForUnit(
  sid: string,
  unitId: number,
  from: number,
  to: number,
): Promise<Record<string, string>[]> {
  const { tables } = await execReport(sid, {
    resourceId: MOTREX_RESOURCE_ID,
    templateId: TEMPLATES.geofenceVisits,
    objectId: unitId,
    from,
    to,
  });

  const rows = await fetchDetalizedZonesVisitRows(sid, tables);
  return normalizeVisitRows(rows);
}

export async function fetchYardsVisitsForUnitId(
  sid: string,
  unitId: number,
): Promise<{ rows: Record<string, string>[]; unitId: number }> {
  const { from, to } = getYardsLiveUnixBounds();
  const rows = await execVisitsForUnit(sid, unitId, from, to);
  return { rows, unitId };
}

export async function fetchYardsVisitsForUnitIdIndex(unitId: number): Promise<{
  rows: Record<string, string>[];
  unitId: number;
}> {
  const sid = await wialonLogin();
  try {
    return await fetchYardsVisitsForUnitId(sid, unitId);
  } finally {
    await wialonLogout(sid);
  }
}

export async function fetchYardsVisitsForVehicle(
  sid: string,
  vehicleIndex: number,
): Promise<{ rows: Record<string, string>[]; vehicleIndex: number; unitCount: number; unitId: number | null }> {
  const unitIds = await getYardsUnitIds(sid);
  const unitId = getYardsVehicleId(unitIds, vehicleIndex);
  if (unitId == null) {
    return { rows: [], vehicleIndex, unitCount: unitIds.length, unitId: null };
  }

  const { from, to } = getYardsLiveUnixBounds();
  const rows = await execVisitsForUnit(sid, unitId, from, to);
  return { rows, vehicleIndex, unitCount: unitIds.length, unitId };
}

export async function fetchYardsVisitsForVehicleIndex(vehicleIndex: number): Promise<{
  rows: Record<string, string>[];
  vehicleIndex: number;
  unitCount: number;
  unitId: number | null;
}> {
  const sid = await wialonLogin();
  try {
    if (vehicleIndex === 0) clearYardsUnitIdCache();
    return await fetchYardsVisitsForVehicle(sid, vehicleIndex);
  } finally {
    await wialonLogout(sid);
  }
}

/** @deprecated Use getYardsVehicleCount. */
export const getYardsBatchCount = getYardsVehicleCount;

/** @deprecated Use fetchYardsVisitsForVehicleIndex. */
export async function fetchYardsVisitsForBatchIndex(batchIndex: number) {
  const result = await fetchYardsVisitsForVehicleIndex(batchIndex);
  return {
    rows: result.rows,
    batchIndex: result.vehicleIndex,
    unitCount: result.unitCount,
  };
}
