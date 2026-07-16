"use client";

import { useMemo, useState, type CSSProperties } from "react";
import * as XLSX from "xlsx";
import type { LiveMonitorDataset, LiveMonitorDirection } from "@/lib/data";
import { formatEatNow } from "@/lib/dateRange";
import { formatTimeSince } from "@/lib/formatDuration";
import { directionLabel } from "@/lib/liveMonitorDirection";
import { SortHeader, sortRowsBy, useTableSort } from "@/lib/sortableTable";
import { TABLE_PAGE_SIZE, paginateRows, totalPages } from "@/lib/tablePagination";
import { registrationLabel } from "@/lib/vehicleLabels";
import { exportMotrexReportPdf } from "@/lib/exportMotrexReportPdf";
import PageHeader from "./PageHeader";
import DateFilter from "./DateFilter";

interface LiveMonitorProps {
  data: LiveMonitorDataset | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  startDate: string;
  endDate: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  nowMs: number;
}

type LiveSortKey =
  | "vehicle"
  | "currentLocation"
  | "lastUpdate"
  | "timeSinceUpdate"
  | "direction"
  | "speedKmh"
  | "status";

function directionBadgeStyle(direction: "going" | "coming" | "inside"): CSSProperties {
  if (direction === "going") {
    return {
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 6,
      fontSize: ".75rem",
      fontWeight: 700,
      background: "rgba(37, 99, 235, 0.12)",
      color: "#2563eb",
    };
  }
  if (direction === "coming") {
    return {
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 6,
      fontSize: ".75rem",
      fontWeight: 700,
      background: "rgba(22, 163, 74, 0.12)",
      color: "#16a34a",
    };
  }
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 6,
    fontSize: ".75rem",
    fontWeight: 700,
    background: "rgba(217, 119, 6, 0.12)",
    color: "#d97706",
  };
}

function mapsUrl(row: { currentLocation: string; lat: number | null; lon: number | null }) {
  if (row.lat != null && row.lon != null) {
    return `https://www.google.com/maps?q=${row.lat},${row.lon}`;
  }
  if (row.currentLocation && row.currentLocation !== "—") {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.currentLocation)}`;
  }
  return null;
}

export default function LiveMonitor({
  data,
  loading,
  error,
  onRefresh,
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  nowMs,
}: LiveMonitorProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState<LiveMonitorDirection | "">("");
  const [page, setPage] = useState(1);
  const { sort, toggleSort } = useTableSort<LiveSortKey>(null);

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    const query = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (query) {
        const directionText = directionLabel(r.direction, r.geofence ?? r.currentLocation).toLowerCase();
        const matchesSearch =
          registrationLabel(r.vehicle).toLowerCase().includes(query) ||
          r.currentLocation.toLowerCase().includes(query) ||
          directionText.includes(query) ||
          r.direction.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }
      if (statusFilter && r.statusCategory !== statusFilter) return false;
      if (directionFilter && r.direction !== directionFilter) return false;
      return true;
    });
  }, [data, search, statusFilter, directionFilter]);

  const sorted = useMemo(
    () =>
      sortRowsBy(filtered, sort, (row, key) => {
        if (key === "speedKmh") return row.speedKmh;
        if (key === "vehicle") return registrationLabel(row.vehicle);
        if (key === "currentLocation") return row.currentLocation;
        if (key === "lastUpdate") return row.lastUpdate;
        if (key === "timeSinceUpdate") return row.lastUpdateMs ?? 0;
        if (key === "direction") return directionLabel(row.direction, row.geofence ?? row.currentLocation);
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
      "Time Since Update": formatTimeSince(r.lastUpdateMs, nowMs),
      Direction: directionLabel(r.direction, r.geofence ?? r.currentLocation),
      "Speed (km/h)": r.speedKmh,
      Status: r.status,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "Fleet Status");
    XLSX.writeFile(wb, `Motrex_LiveMonitor_${Date.now()}.xlsx`);
  };

  const exportPdf = () => {
    exportMotrexReportPdf({
      title: "Motrex Live Monitor",
      subtitle: `${startDate} → ${endDate}`,
      fileName: `Motrex_LiveMonitor_${Date.now()}.pdf`,
      summary: [
        { label: "Tracked Vehicles", value: String(kpis?.tracked ?? "—"), accent: "#2563eb" },
        { label: "Moving", value: String(kpis?.moving ?? "—"), accent: "#16a34a" },
        { label: "Stationary", value: String(kpis?.stationary ?? "—"), accent: "#2563eb" },
        { label: "Unknown", value: String(kpis?.unknown ?? "—"), accent: "#64748b" },
      ],
      sections: [
        {
          heading: "Fleet Status",
          head: [["#", "Vehicle", "Location", "Last Update", "Time Since Update", "Direction", "Speed (km/h)", "Status"]],
          body: sorted.map((r, idx) => [
            idx + 1,
            registrationLabel(r.vehicle),
            r.currentLocation,
            r.lastUpdate,
            formatTimeSince(r.lastUpdateMs, nowMs),
            directionLabel(r.direction, r.geofence ?? r.currentLocation),
            r.speedKmh,
            r.status,
          ]),
        },
      ],
    });
  };

  const kpis = data?.kpis;
  const thStyle = { padding: "10px 12px" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader
        title="Live"
        titleAccent="Monitor"
        subtitle="Real-time fleet status, selected EAT window"
        right={
          <DateFilter
            startDate={startDate}
            endDate={endDate}
            onStartChange={onStartChange}
            onEndChange={onEndChange}
            onRun={onRefresh}
            runLabel="Run"
            running={loading}
          />
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
          { label: "Moving", value: kpis?.moving ?? "—", color: "var(--green)" },
          { label: "Stationary", value: kpis?.stationary ?? "—", color: "var(--blue)" },
          { label: "Unknown", value: kpis?.unknown ?? "—", color: "#64748b" },
        ].map((k) => (
          <div
            key={k.label}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "16px 18px",
              boxShadow: "var(--shadow)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${k.color}, transparent)` }} />
            <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "var(--text)" }}>{k.value}</div>
            <div style={{ fontSize: ".72rem", color: "#000", marginTop: 6, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 800 }}>{k.label}</div>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              type="text"
              placeholder="Search vehicle, location, direction…"
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
            <span style={{ fontSize: ".75rem", color: "var(--text3)" }}>
              Last fetch: {data ? formatEatNow() : "—"} · Auto-refresh 10 min
            </span>
          </div>
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
            <option value="unknown">Unknown</option>
          </select>
          <select
            value={directionFilter}
            onChange={(e) => {
              setDirectionFilter(e.target.value as LiveMonitorDirection | "");
              setPage(1);
            }}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          >
            <option value="">All directions</option>
            <option value="going">Going</option>
            <option value="coming">Coming</option>
            <option value="inside">Inside</option>
          </select>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid rgba(139,16,38,0.35)",
              background: "linear-gradient(135deg, #8b1026, #c41e3a)",
              color: "#fff",
              fontWeight: 800,
              boxShadow: "0 8px 18px rgba(139,16,38,0.2)",
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.72 : 1,
            }}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            type="button"
            onClick={exportExcel}
            style={{
              marginLeft: "auto",
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid rgba(139,16,38,0.35)",
              background: "linear-gradient(135deg, #8b1026, #c41e3a)",
              color: "#fff",
              fontWeight: 800,
              boxShadow: "0 8px 18px rgba(139,16,38,0.2)",
              cursor: "pointer",
            }}
          >
            Export Excel
          </button>
          <button
            type="button"
            onClick={exportPdf}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid rgba(139,16,38,0.35)",
              background: "linear-gradient(135deg, #8b1026, #c41e3a)",
              color: "#fff",
              fontWeight: 800,
              boxShadow: "0 8px 18px rgba(139,16,38,0.2)",
              cursor: "pointer",
            }}
          >
            Export PDF
          </button>
        </div>

        <div className="data-table-scroll" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
            <thead>
              <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                <th style={thStyle}>#</th>
                <SortHeader sortKey="vehicle" label="Vehicle" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                <SortHeader sortKey="currentLocation" label="Current location" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                <SortHeader sortKey="lastUpdate" label="Last Update" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                <SortHeader sortKey="timeSinceUpdate" label="Time Since Update" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                <SortHeader sortKey="direction" label="Direction" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                <SortHeader sortKey="speedKmh" label="Speed (km/h)" sort={sort} onToggle={toggleSort} thStyle={thStyle} align="right" />
                <SortHeader sortKey="status" label="Status" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: "center", color: "var(--text2)" }}>
                    Loading live fleet data…
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: "center", color: "var(--text2)" }}>
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
                      <td style={{ padding: "8px 12px" }}>{formatTimeSince(row.lastUpdateMs, nowMs)}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={directionBadgeStyle(row.direction)}>
                          {directionLabel(row.direction, row.geofence ?? row.currentLocation)}
                        </span>
                      </td>
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
