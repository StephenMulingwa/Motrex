import { registrationLabel } from "@/lib/vehicleLabels";
import { matchSelectedGeofence, resolveGeofence } from "@/lib/motrexGeofences";
import { fetchLiveMonitor } from "./liveMonitor";
import { fetchUnitGroupUnitIds, wialonLogin, wialonLogout, callWialon } from "./client";
import { fetchYardsVisitsForUnitIdIndex } from "./yardsGeofenceVisits";
import { withWialonRetry } from "./reports";

export interface YardsInsideUnit {
  unitId: number;
  vehicle: string;
  registration: string;
  geofence: string;
}

async function buildVehicleNameToUnitId(sid: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const search = await callWialon<{ items?: Array<{ id?: number; nm?: string }> }>(
    "core/search_items",
    {
      spec: {
        itemsType: "avl_unit",
        propName: "sys_name",
        propValueMask: "Motrex*",
        sortType: "sys_name",
      },
      force: 1,
      flags: 1,
      from: 0,
      to: 10000,
    },
    sid,
  );
  for (const item of search.items ?? []) {
    const unitId = Number(item.id);
    const name = String(item.nm ?? "").trim();
    if (!Number.isFinite(unitId) || unitId <= 0 || !name) continue;
    map.set(name.toUpperCase(), unitId);
    map.set(registrationLabel(name).toUpperCase(), unitId);
  }
  return map;
}

function resolveUnitId(nameMap: Map<string, number>, vehicle: string): number | null {
  const key = vehicle.trim().toUpperCase();
  return nameMap.get(key) ?? nameMap.get(registrationLabel(vehicle).toUpperCase()) ?? null;
}

/** Phase 1: find vehicles currently inside template-58 yard geofences via live positions. */
export async function discoverYardsInsideUnits(): Promise<YardsInsideUnit[]> {
  const sid = await wialonLogin();
  try {
    const now = Date.now();
    const fromMs = now - 60 * 60 * 1000;
    const live = await fetchLiveMonitor(fromMs, now);
    const nameMap = await buildVehicleNameToUnitId(sid);
    const inside: YardsInsideUnit[] = [];
    const seen = new Set<number>();

    for (const row of live.rows) {
      const rawGeofence = resolveGeofence(row.lat, row.lon, row.currentLocation);
      const geofence = rawGeofence ? matchSelectedGeofence(rawGeofence) : null;
      if (!geofence) continue;

      const unitId = resolveUnitId(nameMap, row.vehicle);
      if (!unitId || seen.has(unitId)) continue;
      seen.add(unitId);

      inside.push({
        unitId,
        vehicle: row.vehicle,
        registration: registrationLabel(row.vehicle),
        geofence,
      });
    }

    return inside;
  } finally {
    await wialonLogout(sid);
  }
}

export async function fetchYardsLiveForUnitId(unitId: number): Promise<{
  rows: Record<string, string>[];
  unitId: number;
  fetchedAt: string;
}> {
  const fetchedAt = new Date().toISOString();
  return withWialonRetry(`yards unit ${unitId}`, async () => {
    const result = await fetchYardsVisitsForUnitIdIndex(unitId);
    return { rows: result.rows, unitId: result.unitId, fetchedAt };
  });
}
