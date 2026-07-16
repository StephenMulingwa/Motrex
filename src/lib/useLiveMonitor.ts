"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveMonitorDataset, LiveMonitorRow } from "@/lib/data";
import { getLiveMonitorRange } from "@/lib/dateRange";
import {
  computeDirection,
  loadPreviousPositionsFromStorage,
  savePreviousPositionsToStorage,
  type PreviousPosition,
} from "@/lib/liveMonitorDirection";
import { resolveGeofence } from "@/lib/motrexGeofences";

function enrichRowsWithDirection(
  rows: LiveMonitorRow[],
  previousPositions: Map<string, PreviousPosition>,
): LiveMonitorRow[] {
  return rows.map((row) => {
    const previous = previousPositions.get(row.vehicle);
    const geofence = row.geofence ?? resolveGeofence(row.lat, row.lon, row.currentLocation);
    const enriched: LiveMonitorRow = {
      ...row,
      geofence,
      currentLocation: geofence ?? row.currentLocation,
    };
    const direction = computeDirection(enriched, previous);
    return { ...enriched, direction };
  });
}

function updatePreviousPositions(rows: LiveMonitorRow[], previousPositions: Map<string, PreviousPosition>) {
  const now = Date.now();
  for (const row of rows) {
    if (row.lat != null && row.lon != null) {
      previousPositions.set(row.vehicle, { lat: row.lat, lon: row.lon, savedAtMs: now });
    }
  }
  savePreviousPositionsToStorage(previousPositions);
}

export function useLiveMonitor(initialData: LiveMonitorDataset | null = null) {
  const initialRange = getLiveMonitorRange();
  const previousPositionsRef = useRef<Map<string, PreviousPosition>>(loadPreviousPositionsFromStorage());
  const [data, setData] = useState<LiveMonitorDataset | null>(() => {
    if (!initialData) return null;
    const enrichedRows = enrichRowsWithDirection(initialData.rows, previousPositionsRef.current);
    updatePreviousPositions(enrichedRows, previousPositionsRef.current);
    return { ...initialData, rows: enrichedRows };
  });
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setRefreshNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (initialData && refreshNonce === 0) return;

    let cancelled = false;

    const query = new URLSearchParams({ from: startDate, to: endDate });
    fetch(`/api/wialon/live-monitor?${query.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Request failed (${res.status})`);
        }
        return res.json() as Promise<LiveMonitorDataset>;
      })
      .then((payload) => {
        if (cancelled) return;
        const enrichedRows = enrichRowsWithDirection(payload.rows, previousPositionsRef.current);
        updatePreviousPositions(enrichedRows, previousPositionsRef.current);
        setData({ ...payload, rows: enrichedRows });
        setNowMs(Date.now());
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load live data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshNonce, initialData, startDate, endDate]);

  return { data, loading, error, refresh, startDate, endDate, setStartDate, setEndDate, nowMs };
}
