"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import type { LiveMonitorDataset } from "@/lib/data";
import { formatEatNow } from "@/lib/dateRange";
import { SortHeader, sortRowsBy, useTableSort } from "@/lib/sortableTable";
import { TABLE_PAGE_SIZE, paginateRows, totalPages } from "@/lib/tablePagination";
import { registrationLabel } from "@/lib/vehicleLabels";
import PageHeader from "./PageHeader";

interface LiveMonitorProps {
  data: LiveMonitorDataset | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

type LiveSortKey = "vehicle" | "currentLocation" | "lastUpdate" | "speedKmh" | "status";

function mapsUrl(row: { currentLocation: string; lat: number | null; lon: number | null }) {
  if (row.lat != null && row.lon != null) {
    return `https://www.google.com/maps?q=${row.lat},${row.lon}`;
  }
  if (row.currentLocation && row.currentLocation !== "—") {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.currentLocation)}`;
  }
  return null;
}

export default function LiveMonitor({ data, loading, error, onRefresh }: LiveMonitorProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [freshnessFilter, setFreshnessFilter] = useState("");
  const [page, setPage] = useState(1);
  const { sort, toggleSort } = useTableSort<LiveSortKey>(null);

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    return rows.filter((r) => {
      if (search && !registrationLabel(r.vehicle).toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter === "moving" && r.speedKmh <= 0) return false;
      if (statusFilter === "stationary" && r.speedKmh > 0) return false;
      if (freshnessFilter === "updated" && !r.updatedInWindow) return false;
      if (freshnessFilter === "not_updated" && r.updatedInWindow) return false;
      return true;
    });
  }, [data, search, statusFilter, freshnessFilter]);

  const sorted = useMemo(
    () =>
      sortRowsBy(filtered, sort, (row, key) => {
        if (key === "speedKmh") return row.speedKmh;
        if (key === "vehicle") return registrationLabel(row.vehicle);
        if (key === "currentLocation") return row.currentLocation;
        if (key === "lastUpdate") return row.lastUpdate;
        if (key === "status") return row.status;
        return "";
      }),
    [filtered, sort],
  );

  const paged = useMemo(() => paginateRows(sorted, page), [sorted, page]);
  const pages = totalPages(sorted.length);

  const exportExcel = () => {
    const sheet = sorted.map((r) => ({
      Vehicle: registrationLabel(r.vehicle),
      Location: r.currentLocation,
      "Last Update": r.lastUpdate,
      "Speed (km/h)": r.speedKmh,
      Status: r.status,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "Fleet Status");
    XLSX.writeFile(wb, `Motrex_LiveMonitor_${Date.now()}.xlsx`);
  };

  const kpis = data?.kpis;
  const thStyle = { padding: "10px 12px" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader
        title="Live"
        titleAccent="Monitor"
        subtitle="Real-time fleet status — SM_Motrex_Online Status (past 1 hour, EAT)"
        right={
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent)",
              color: "#1a1200",
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        {[
          { label: "Tracked Vehicles", value: kpis?.tracked ?? "—", color: "var(--blue)" },
          { label: "Active", value: kpis?.active ?? "—", color: "var(--green)" },
          { label: "Stationary", value: kpis?.stationary ?? "—", color: "var(--blue)" },
          { label: "Avg speed", value: kpis ? `${kpis.avgSpeed} km/h` : "—", color: "var(--red)" },
        ].map((k) => (
          <div
            key={k.label}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "16px 18px",
              boxShadow: "var(--shadow)",
            }}
          >
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: ".78rem", color: "var(--text2)", marginTop: 4 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: 12, background: "#fff0f0", border: "1px solid #ffcaca", borderRadius: 8, color: "var(--red)" }}>
          {error}
        </div>
      )}

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 16,
          boxShadow: "var(--shadow)",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Search vehicle…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              minWidth: 180,
            }}
          />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          >
            <option value="">All status</option>
            <option value="moving">Moving</option>
            <option value="stationary">Stationary</option>
          </select>
          <select
            value={freshnessFilter}
            onChange={(e) => {
              setFreshnessFilter(e.target.value);
              setPage(1);
            }}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          >
            <option value="">All vehicles</option>
            <option value="updated">Updated in window</option>
            <option value="not_updated">Not updated in window</option>
          </select>
          <button
            type="button"
            onClick={exportExcel}
            style={{
              marginLeft: "auto",
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface2)",
              cursor: "pointer",
            }}
          >
            Export Excel
          </button>
          <span style={{ fontSize: ".75rem", color: "var(--text3)" }}>
            Last fetch: {data ? formatEatNow() : "—"} · Auto-refresh 5 min
          </span>
        </div>

        <div className="data-table-scroll" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
            <thead>
              <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                <th style={thStyle}>#</th>
                <SortHeader sortKey="vehicle" label="Vehicle" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                <SortHeader sortKey="currentLocation" label="Current location" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                <SortHeader sortKey="lastUpdate" label="Last Update" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                <SortHeader sortKey="speedKmh" label="Speed (km/h)" sort={sort} onToggle={toggleSort} thStyle={thStyle} align="right" />
                <SortHeader sortKey="status" label="Status" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--text2)" }}>
                    Loading live fleet data…
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--text2)" }}>
                    No vehicles match filters.
                  </td>
                </tr>
              ) : (
                paged.map((row, i) => {
                  const url = mapsUrl(row);
                  const rowNum = (page - 1) * TABLE_PAGE_SIZE + i + 1;
                  return (
                    <tr key={`${row.vehicle}-${rowNum}`} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 12px" }}>{rowNum}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 500 }}>{registrationLabel(row.vehicle)}</td>
                      <td style={{ padding: "8px 12px" }}>
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue)" }}>
                            {row.currentLocation}
                          </a>
                        ) : (
                          row.currentLocation
                        )}
                      </td>
                      <td style={{ padding: "8px 12px" }}>{row.lastUpdate}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>{row.speedKmh}</td>
                      <td style={{ padding: "8px 12px" }}>{row.status}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {sorted.length > TABLE_PAGE_SIZE && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, fontSize: ".78rem" }}>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", cursor: page <= 1 ? "default" : "pointer" }}
            >
              Previous
            </button>
            <span style={{ color: "var(--text2)" }}>
              Page {page} of {pages} · {sorted.length} vehicle(s)
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", cursor: page >= pages ? "default" : "pointer" }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
