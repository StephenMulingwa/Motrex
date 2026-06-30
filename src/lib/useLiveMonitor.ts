"use client";

import { useCallback, useEffect, useState } from "react";
import type { LiveMonitorDataset } from "@/lib/data";
import { getLiveMonitorRange } from "@/lib/dateRange";

export function useLiveMonitor(initialData: LiveMonitorDataset | null = null) {
  const [data, setData] = useState<LiveMonitorDataset | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const range = getLiveMonitorRange();

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setRefreshNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (initialData && refreshNonce === 0) return;

    let cancelled = false;

    const query = new URLSearchParams({ from: range.start, to: range.end });
    fetch(`/api/wialon/live-monitor?${query.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Request failed (${res.status})`);
        }
        return res.json() as Promise<LiveMonitorDataset>;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
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
  }, [refreshNonce, initialData, range.start, range.end]);

  return { data, loading, error, refresh };
}
