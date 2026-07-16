"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getEcoDefaultRange,
  getTripsDefaultRange,
  getTripsSummaryDefaultRange,
  getUtilizationDefaultRange,
  getYardsDefaultRange,
} from "@/lib/dateRange";
import { STORED_REPORT_TYPES, type StoredReportType } from "@/lib/motrexConfig";

export interface ReportApiResponse {
  reportType: string;
  from: string;
  to: string;
  snapshotCount: number;
  totalRows?: number;
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
    case "trips_summary":
      return getTripsSummaryDefaultRange();
    default:
      return getUtilizationDefaultRange();
  }
}

function reportCacheKey(reportType: StoredReportType, from: string, to: string): string {
  return `${reportType}:${from}:${to}`;
}

function fetchReportData(reportType: StoredReportType, from: string, to: string): Promise<ReportApiResponse> {
  const cacheKey = reportCacheKey(reportType, from, to);
  const cached = reportCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const existingRequest = reportRequests.get(cacheKey);
  if (existingRequest) return existingRequest;

  const query = new URLSearchParams({ from, to });
  const request = fetch(`/api/reports/${reportType}?${query.toString()}`, { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Request failed (${res.status})`);
      }
      return res.json() as Promise<ReportApiResponse>;
    })
    .then((payload) => {
      reportCache.set(cacheKey, payload);
      return payload;
    })
    .finally(() => {
      reportRequests.delete(cacheKey);
    });

  reportRequests.set(cacheKey, request);
  return request;
}

export function preloadDefaultReports(): Promise<ReportApiResponse[]> {
  const reportTypes = STORED_REPORT_TYPES.filter(
    (reportType) => reportType !== "yards" && reportType !== "trips_summary",
  );
  return Promise.all(
    reportTypes.map((reportType) => {
      const range = defaultRangeForType(reportType);
      return fetchReportData(reportType, range.from, range.to);
    }),
  );
}

export function useReportData(reportType: StoredReportType) {
  const defaults = defaultRangeForType(reportType);
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [appliedFrom, setAppliedFrom] = useState(fromDate);
  const [appliedTo, setAppliedTo] = useState(toDate);
  const initialCacheKey = reportCacheKey(reportType, defaults.from, defaults.to);
  const [data, setData] = useState<ReportApiResponse | null>(() => reportCache.get(initialCacheKey) ?? null);
  const [loading, setLoading] = useState(() => !reportCache.has(initialCacheKey));
  const [error, setError] = useState<string | null>(null);

  const run = useCallback((overrideFrom?: string, overrideTo?: string) => {
    const nextFrom = typeof overrideFrom === "string" ? overrideFrom : fromDate;
    const nextTo = typeof overrideTo === "string" ? overrideTo : toDate;
    if (typeof overrideFrom === "string") setFromDate(overrideFrom);
    if (typeof overrideTo === "string") setToDate(overrideTo);
    setLoading(true);
    setError(null);
    setAppliedFrom(nextFrom);
    setAppliedTo(nextTo);
  }, [fromDate, toDate]);

  useEffect(() => {
    let cancelled = false;

    const cacheKey = reportCacheKey(reportType, appliedFrom, appliedTo);
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

    fetchReportData(reportType, appliedFrom, appliedTo)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load report.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reportType, appliedFrom, appliedTo]);

  return { data, loading, error, fromDate, toDate, setFromDate, setToDate, run };
}
