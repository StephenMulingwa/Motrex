"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getEcoDefaultRange,
  getTripsDefaultRange,
  getUtilizationDefaultRange,
  getYardsDefaultRange,
} from "@/lib/dateRange";
import type { StoredReportType } from "@/lib/motrexConfig";

export interface ReportApiResponse {
  reportType: string;
  from: string;
  to: string;
  snapshotCount: number;
  rows: Record<string, unknown>[];
  pivot: Record<string, Record<string, number>>;
  columns: string[];
  snapshots: Array<{ reportDate: string; rowCount: number; meta: Record<string, unknown> | null }>;
}

const reportCache = new Map<string, ReportApiResponse>();
const reportRequests = new Map<string, Promise<ReportApiResponse>>();

function defaultRangeForType(reportType: StoredReportType): { from: string; to: string } {
  switch (reportType) {
    case "yards":
      return getYardsDefaultRange();
    case "trips":
      return getTripsDefaultRange();
    case "utilization":
      return getUtilizationDefaultRange();
    case "eco_driving":
      return getEcoDefaultRange();
    default:
      return getUtilizationDefaultRange();
  }
}

export function useReportData(reportType: StoredReportType) {
  const defaults = defaultRangeForType(reportType);
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [appliedFrom, setAppliedFrom] = useState(fromDate);
  const [appliedTo, setAppliedTo] = useState(toDate);
  const initialCacheKey = `${reportType}:${defaults.from}:${defaults.to}`;
  const [data, setData] = useState<ReportApiResponse | null>(() => reportCache.get(initialCacheKey) ?? null);
  const [loading, setLoading] = useState(() => !reportCache.has(initialCacheKey));
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    setAppliedFrom(fromDate);
    setAppliedTo(toDate);
  }, [fromDate, toDate]);

  useEffect(() => {
    let cancelled = false;

    const cacheKey = `${reportType}:${appliedFrom}:${appliedTo}`;
    const cached = reportCache.get(cacheKey);
    if (cached) {
      Promise.resolve().then(() => {
        if (!cancelled) {
          setData(cached);
          setLoading(false);
          setError(null);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    const query = new URLSearchParams({ from: appliedFrom, to: appliedTo });
    const request =
      reportRequests.get(cacheKey) ??
      fetch(`/api/reports/${reportType}?${query.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Request failed (${res.status})`);
        }
        return res.json() as Promise<ReportApiResponse>;
      });
    reportRequests.set(cacheKey, request);

    request
      .then((payload) => {
        reportCache.set(cacheKey, payload);
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load report.");
      })
      .finally(() => {
        reportRequests.delete(cacheKey);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reportType, appliedFrom, appliedTo]);

  return { data, loading, error, fromDate, toDate, setFromDate, setToDate, run };
}
