import { MOTREX_GROUP_ID } from "@/lib/motrexConfig";
import { resolveGeofence } from "@/lib/motrexGeofences";
import { registrationLabel } from "@/lib/vehicleLabels";
import { computeDirection, resolveRowGeofence } from "@/lib/liveMonitorDirection";
import { fetchLiveMonitor } from "./liveMonitor";
import { fetchUnitGroupUnitIds, wialonLogin, wialonLogout, callWialon } from "./client";
import { fetchYardsVisitsForUnitIdIndex } from "./yardsGeofenceVisits";
import { withWialonRetry } from "./reports";

export interface YardsInsideUnit {
  unitId: number;
  vehicle: string;
  registration: string;
  geofence: string;
  /** Live Monitor last update, used when template 58 has no open visit. */
  timeInHint?: string;
}

/** Map vehicle/registration labels → unit IDs for every unit in the Motrex group. */
async function buildGroupVehicleNameToUnitId(sid: string): Promise<Map<string, number>> {
  const unitIds = await fetchUnitGroupUnitIds(sid, MOTREX_GROUP_ID);
  const idSet = new Set(unitIds);
  const map = new Map<string, number>();

  const search = await callWialon<{ items?: Array<{ id?: number; nm?: string }> }>(
    "core/search_items",
    {
      spec: {
        itemsType: "avl_unit",
        propName: "sys_name",
        propValueMask: "*",
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
    if (!idSet.has(unitId)) continue;
    const name = String(item.nm ?? "").trim();
    if (!name) continue;
    map.set(name.toUpperCase(), unitId);
    map.set(registrationLabel(name).toUpperCase(), unitId);
  }

  // Ensure Motrex*-named units are covered even if the broad search missed some.
  if (map.size < unitIds.length) {
    const motrexSearch = await callWialon<{ items?: Array<{ id?: number; nm?: string }> }>(
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
    ).catch(() => null);
    for (const item of motrexSearch?.items ?? []) {
      const unitId = Number(item.id);
      if (!Number.isFinite(unitId) || unitId <= 0) continue;
      if (unitIds.length && !idSet.has(unitId) && !String(item.nm ?? "").startsWith("Motrex")) continue;
      const name = String(item.nm ?? "").trim();
      if (!name) continue;
      map.set(name.toUpperCase(), unitId);
      map.set(registrationLabel(name).toUpperCase(), unitId);
    }
  }

  return map;
}

function resolveUnitId(nameMap: Map<string, number>, vehicle: string): number | null {
  const key = vehicle.trim().toUpperCase();
  return nameMap.get(key) ?? nameMap.get(registrationLabel(vehicle).toUpperCase()) ?? null;
}

/**
 * Phase 1: find vehicles currently Inside Motrex geofences (same rule as Live Monitor)
 * via live positions, then resolve Motrex-group unit IDs for template 58 enrichment.
 */
export async function discoverYardsInsideUnits(): Promise<YardsInsideUnit[]> {
  const sid = await wialonLogin();
  try {
    const now = Date.now();
    const fromMs = now - 60 * 60 * 1000;
    const live = await fetchLiveMonitor(fromMs, now);
    const nameMap = await buildGroupVehicleNameToUnitId(sid);
    const inside: YardsInsideUnit[] = [];
    const seenUnitIds = new Set<number>();
    const seenRegs = new Set<string>();

    for (const row of live.rows) {
      const direction = computeDirection(row, undefined);
      if (direction !== "inside") continue;

      const geofence = resolveRowGeofence(row) ?? resolveGeofence(row.lat, row.lon, row.currentLocation);
      if (!geofence) continue;

      const registration = registrationLabel(row.vehicle);
      const regKey = registration.toUpperCase();
      if (seenRegs.has(regKey)) continue;

      const unitId = resolveUnitId(nameMap, row.vehicle) ?? 0;
      if (unitId > 0) {
        if (seenUnitIds.has(unitId)) continue;
        seenUnitIds.add(unitId);
      }
      seenRegs.add(regKey);

      inside.push({
        unitId,
        vehicle: row.vehicle,
        registration,
        geofence,
        timeInHint: row.lastUpdate || undefined,
      });
    }

    return inside;
  } finally {
    await wialonLogout(sid);
  }
}

export async function fetchYardsLiveForUnitId(
  unitId: number,
  retryDelaysMs?: number[],
): Promise<{
  rows: Record<string, string>[];
  unitId: number;
  fetchedAt: string;
}> {
  const fetchedAt = new Date().toISOString();
  return withWialonRetry(
    `yards unit ${unitId}`,
    async () => {
      const result = await fetchYardsVisitsForUnitIdIndex(unitId);
      return { rows: result.rows, unitId: result.unitId, fetchedAt };
    },
    retryDelaysMs,
  );
}
