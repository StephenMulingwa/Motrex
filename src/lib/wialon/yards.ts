import { formatEatDateTime, getYardsLiveRange } from "@/lib/dateRange";
import { withWialonRetry } from "./reports";
import {
  fetchYardsVisitsForVehicleIndex,
  getYardsVehicleCount,
  YARDS_BATCH_SIZE,
} from "./yardsGeofenceVisits";
import type { YardsInsideRow } from "@/lib/yardsGeofence";

export interface YardsLiveDataset {
  rows: Record<string, string>[];
  insideRows?: YardsInsideRow[];
  fetchedAt: string;
  lastExecutionTime: string;
  range: { from: string; to: string };
  syncPending?: boolean;
}

export { YARDS_BATCH_SIZE, getYardsVehicleCount };
export { discoverYardsInsideUnits, fetchYardsLiveForUnitId } from "./yardsInside";
export type { YardsInsideUnit } from "./yardsInside";

export async function fetchYardsLiveForVehicleIndex(vehicleIndex: number): Promise<{
  rows: Record<string, string>[];
  vehicleIndex: number;
  vehicleCount: number;
  unitId: number | null;
  fetchedAt: string;
}> {
  const fetchedAt = new Date().toISOString();

  return withWialonRetry(`yards vehicle ${vehicleIndex}`, async () => {
    const result = await fetchYardsVisitsForVehicleIndex(vehicleIndex);
    return {
      rows: result.rows,
      vehicleIndex: result.vehicleIndex,
      vehicleCount: getYardsVehicleCount(result.unitCount),
      unitId: result.unitId,
      fetchedAt,
    };
  });
}

/** Run all vehicles sequentially (local script). */
export async function fetchYardsLiveAllVehicles(): Promise<YardsLiveDataset> {
  const range = getYardsLiveRange();
  const fetchedAt = new Date();
  const first = await fetchYardsLiveForVehicleIndex(0);
  const vehicleCount = first.vehicleCount;
  const allRows = [...first.rows];

  for (let i = 1; i < vehicleCount; i += 1) {
    const vehicle = await fetchYardsLiveForVehicleIndex(i);
    allRows.push(...vehicle.rows);
  }

  return {
    rows: allRows,
    fetchedAt: fetchedAt.toISOString(),
    lastExecutionTime: formatEatDateTime(fetchedAt),
    range,
  };
}

/** @deprecated Use fetchYardsLiveForVehicleIndex. */
export const fetchYardsLiveForBatchIndex = async (batchIndex: number) => {
  const result = await fetchYardsLiveForVehicleIndex(batchIndex);
  return {
    rows: result.rows,
    batchIndex: result.vehicleIndex,
    batchCount: result.vehicleCount,
    fetchedAt: result.fetchedAt,
  };
};

/** @deprecated Use fetchYardsLiveAllVehicles. */
export const fetchYardsLiveAllBatches = fetchYardsLiveAllVehicles;

/** @deprecated Use getYardsVehicleCount. */
export { getYardsVehicleCount as getYardsBatchCount };
