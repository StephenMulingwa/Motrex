"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { YardsLiveDataset } from "@/lib/wialon/yards";
import type { YardsInsideRow } from "@/lib/yardsGeofence";

type YardsApiPayload = YardsLiveDataset & {
  insideRows?: YardsInsideRow[];
  syncInProgress?: boolean;
  syncProgress?: "in_progress" | "complete" | null;
  syncPending?: boolean;
};

async function fetchYardsFromDb(): Promise<YardsApiPayload> {
  const res = await fetch("/api/yards", { cache: "no-store" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<YardsApiPayload>;
}

async function triggerYardsSync(opts: { resume?: boolean; refresh?: boolean } = {}): Promise<void> {
  const qs = new URLSearchParams({ insideIndex: "0" });
  if (opts.resume) qs.set("resume", "1");
  if (opts.refresh) qs.set("refresh", "1");
  const res = await fetch(`/api/yards/sync?${qs.toString()}`, { method: "POST", cache: "no-store" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Sync failed (${res.status})`);
  }
}

export function useYardsData(initialData: YardsLiveDataset | null = null) {
  const [data, setData] = useState<YardsApiPayload | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const bootstrapAttemptedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const payload = await fetchYardsFromDb();
        setData(payload);
        setNowMs(Date.now());
        if (payload.syncProgress === "complete" || (!payload.syncPending && !payload.syncInProgress)) {
          stopPolling();
          setSyncing(false);
        }
      } catch {
        // Keep polling while chain runs.
      }
    }, 10_000);
  }, [stopPolling]);

  const reloadFromDb = useCallback(() => {
    setNowMs(Date.now());
    setLoading(true);
    setError(null);
    setRefreshNonce((n) => n + 1);
  }, []);

  const refresh = reloadFromDb;

  const syncFromTrack3 = useCallback(async () => {
    setSyncing(true);
    setError(null);
    stopPolling();
    try {
      const current = data ?? (await fetchYardsFromDb());
      const resume = Boolean(current.syncInProgress);
      await triggerYardsSync({ resume, refresh: !resume });
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync yards data.");
      setSyncing(false);
    }
  }, [data, stopPolling, startPolling]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    if (initialData && refreshNonce === 0) return;

    let cancelled = false;

    fetchYardsFromDb()
      .then(async (payload) => {
        if (cancelled) return;

        // Always paint DB data immediately (including last-good prior day).
        setData(payload);
        setLoading(false);
        setNowMs(Date.now());

        if (payload.syncInProgress) {
          setSyncing(true);
          startPolling();
        }

        const hasUsableData = (payload.insideRows?.length ?? 0) > 0 || (payload.rows?.length ?? 0) > 0;
        // Only auto-bootstrap when there is nothing to show — never wipe a populated last-good view.
        const shouldBootstrap =
          payload.syncPending && !hasUsableData && !bootstrapAttemptedRef.current && !payload.syncInProgress;

        if (shouldBootstrap) {
          bootstrapAttemptedRef.current = true;
          setSyncing(true);
          try {
            await triggerYardsSync({ refresh: true });
            if (cancelled) return;
            startPolling();
          } catch (syncErr) {
            if (!cancelled) {
              console.error("[useYardsData] bootstrap sync failed:", syncErr);
              setSyncing(false);
            }
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load yards data.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshNonce, initialData, startPolling]);

  return {
    data,
    loading: loading && !data,
    syncing,
    error,
    refresh,
    reloadFromDb,
    syncFromTrack3,
    nowMs,
    lastExecutionTime: data?.lastExecutionTime ?? "—",
  };
}
