"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getTripsSummaryDefaultRange } from "@/lib/dateRange";
import type { ReportApiResponse } from "@/lib/useReportData";

type TripsSummaryApiPayload = ReportApiResponse & {
  syncInProgress?: boolean;
  syncProgress?: "in_progress" | "complete" | null;
  syncStatus?: string | null;
};

async function fetchTripsSummary(from: string, to: string): Promise<TripsSummaryApiPayload> {
  const query = new URLSearchParams({ from, to });
  const res = await fetch(`/api/reports/trips_summary?${query.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<TripsSummaryApiPayload>;
}

async function triggerTripsSummarySync(params: {
  weekStart: string;
  weekEnd: string;
  from?: string;
  to?: string;
  weekIndex?: number;
}): Promise<void> {
  const qs = new URLSearchParams({
    weekStart: params.weekStart,
    weekEnd: params.weekEnd,
    batchIndex: "0",
  });
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.weekIndex != null) qs.set("weekIndex", String(params.weekIndex));

  const res = await fetch(`/api/trips-summary/sync?${qs.toString()}`, { method: "POST", cache: "no-store" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Sync failed (${res.status})`);
  }
}

export function useTripsSummaryData() {
  const defaults = getTripsSummaryDefaultRange();
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [appliedFrom, setAppliedFrom] = useState(defaults.from);
  const [appliedTo, setAppliedTo] = useState(defaults.to);
  const [data, setData] = useState<TripsSummaryApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (from: string, to: string) => {
      if (pollRef.current) return;
      pollRef.current = setInterval(async () => {
        try {
          const payload = await fetchTripsSummary(from, to);
          setData(payload);
          if (payload.syncProgress === "complete" || !payload.syncInProgress) {
            stopPolling();
            setSyncing(false);
            setLoading(false);
          }
        } catch {
          // Keep polling while chain runs.
        }
      }, 10_000);
    },
    [stopPolling],
  );

  const reload = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchTripsSummary(from, to);
      setData(payload);
      if (payload.syncInProgress) {
        setSyncing(true);
        startPolling(from, to);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trips summary.");
    } finally {
      setLoading(false);
    }
  }, [startPolling]);

  const syncAndLoad = useCallback(
    async (from: string, to: string, weekStart?: string, weekEnd?: string) => {
      setSyncing(true);
      setLoading(true);
      setError(null);
      stopPolling();
      try {
        await triggerTripsSummarySync({
          weekStart: weekStart ?? from,
          weekEnd: weekEnd ?? to,
          from: weekStart ? undefined : from,
          to: weekStart ? undefined : to,
          weekIndex: weekStart ? undefined : 0,
        });
        startPolling(from, to);
        const payload = await fetchTripsSummary(from, to);
        setData(payload);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to sync trips summary.");
        setSyncing(false);
        setLoading(false);
      }
    },
    [startPolling, stopPolling],
  );

  const run = useCallback(
    (overrideFrom?: string, overrideTo?: string) => {
      const nextFrom = typeof overrideFrom === "string" ? overrideFrom : fromDate;
      const nextTo = typeof overrideTo === "string" ? overrideTo : toDate;
      if (typeof overrideFrom === "string") setFromDate(overrideFrom);
      if (typeof overrideTo === "string") setToDate(overrideTo);
      setAppliedFrom(nextFrom);
      setAppliedTo(nextTo);
      void syncAndLoad(nextFrom, nextTo);
    },
    [fromDate, toDate, syncAndLoad],
  );

  const applyWeek = useCallback(
    (from: string, to: string) => {
      setFromDate(from);
      setToDate(to);
      setAppliedFrom(from);
      setAppliedTo(to);
      void syncAndLoad(from, to, from, to);
    },
    [syncAndLoad],
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    void reload(appliedFrom, appliedTo);
  }, [appliedFrom, appliedTo, reload]);

  return {
    data,
    loading: loading && !data,
    syncing,
    error,
    fromDate,
    toDate,
    setFromDate,
    setToDate,
    run,
    applyWeek,
    reload,
  };
}
