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

type YardsSyncStep = {
  ok: boolean;
  isLast?: boolean;
  nextIndex?: number | null;
  vehicleIndex?: number;
  vehicleCount?: number;
  rowCount?: number;
  error?: string;
};

const STEP_DELAY_MS = 1500;
const RETRY_DELAYS_MS = [30_000, 60_000];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitError(message: string): boolean {
  return /1004|LIMIT msgs_activity|rate limit|fetch failed/i.test(message);
}

async function fetchYardsFromDb(): Promise<YardsApiPayload> {
  const res = await fetch("/api/yards", { cache: "no-store" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<YardsApiPayload>;
}

async function runYardsSyncStep(insideIndex: number, opts: { refresh?: boolean } = {}): Promise<YardsSyncStep> {
  const qs = new URLSearchParams({ insideIndex: String(insideIndex), ui: "1" });
  if (opts.refresh) qs.set("refresh", "1");
  const res = await fetch(`/api/yards/sync?${qs.toString()}`, { method: "POST", cache: "no-store" });
  const payload = (await res.json().catch(() => ({}))) as YardsSyncStep & { error?: string };
  if (!res.ok || !payload.ok) {
    throw new Error(payload.error ?? `Sync failed (${res.status})`);
  }
  return payload;
}

async function runYardsSyncStepWithRetry(
  insideIndex: number,
  opts: { refresh?: boolean } = {},
): Promise<YardsSyncStep> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await runYardsSyncStep(insideIndex, opts);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isRateLimitError(msg) || attempt >= RETRY_DELAYS_MS.length) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr;
}

export function useYardsData(initialData: YardsLiveDataset | null = null) {
  const [data, setData] = useState<YardsApiPayload | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [syncing, setSyncing] = useState(false);
  const [syncLabel, setSyncLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const syncLoopRef = useRef<Promise<void> | null>(null);
  const cancelSyncRef = useRef(false);

  const refreshDb = useCallback(async () => {
    const payload = await fetchYardsFromDb();
    setData(payload);
    setNowMs(Date.now());
    return payload;
  }, []);

  const runFullYardsSync = useCallback(
    async (opts: { resume?: boolean; refresh?: boolean } = {}) => {
      if (syncLoopRef.current) return syncLoopRef.current;

      cancelSyncRef.current = false;
      setSyncing(true);
      setError(null);

      const loop = (async () => {
        let nextIndex: number | null = 0;
        let isFirst = true;

        try {
          while (nextIndex != null && !cancelSyncRef.current) {
            const step = await runYardsSyncStepWithRetry(nextIndex, {
              refresh: isFirst && Boolean(opts.refresh),
            });

            const vehicleIndex = Number(step.vehicleIndex ?? nextIndex);
            const vehicleCount = Number(step.vehicleCount ?? 0);
            if (vehicleCount > 0) {
              setSyncLabel(`Syncing vehicle ${vehicleIndex + 1}/${vehicleCount}…`);
            }

            await refreshDb();

            if (step.isLast || step.nextIndex == null) break;

            nextIndex = step.nextIndex;
            isFirst = false;
            await sleep(STEP_DELAY_MS);
          }
        } catch (err) {
          if (!cancelSyncRef.current) {
            setError(err instanceof Error ? err.message : "Failed to sync yards data.");
          }
        } finally {
          setSyncLabel(null);
          setSyncing(false);
          syncLoopRef.current = null;
          try {
            await refreshDb();
          } catch {
            // ignore final refresh errors
          }
        }
      })();

      syncLoopRef.current = loop;
      return loop;
    },
    [refreshDb],
  );

  const reloadFromDb = useCallback(() => {
    setNowMs(Date.now());
    setLoading(true);
    setError(null);
    setRefreshNonce((n) => n + 1);
  }, []);

  const refresh = reloadFromDb;

  const syncFromTrack3 = useCallback(async () => {
    const current = data ?? (await refreshDb());
    const resume = Boolean(current.syncInProgress);
    await runFullYardsSync({ resume, refresh: !resume });
  }, [data, refreshDb, runFullYardsSync]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      cancelSyncRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (initialData && refreshNonce === 0) return;

    let cancelled = false;

    fetchYardsFromDb()
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setLoading(false);
        setNowMs(Date.now());
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
  }, [refreshNonce, initialData]);

  return {
    data,
    loading: loading && !data,
    syncing,
    syncLabel,
    error,
    refresh,
    reloadFromDb,
    syncFromTrack3,
    nowMs,
    lastExecutionTime: data?.lastExecutionTime ?? "—",
    lastUpdatedAt: data?.lastUpdatedAt ?? data?.lastExecutionTime ?? null,
  };
}
