"use client";

import { useMemo, useState, type CSSProperties } from "react";
import PageHeader from "./PageHeader";
import { useReportData } from "@/lib/useReportData";
import type { StoredReportType } from "@/lib/motrexConfig";
import {
  SortHeader,
  sortRowsBy,
  useTableSort,
  parseDateTimeMs,
  parseFirstNumber,
} from "@/lib/sortableTable";
import { TABLE_PAGE_SIZE, paginateRows, totalPages } from "@/lib/tablePagination";
import {
  computeYardsInside,
  distinctGeofences,
  filterByMinDays,
  cellSortValue,
  type YardsInsideRow,
} from "@/lib/yardsGeofence";
import { registrationLabel, shouldUseRegistrationLabel } from "@/lib/vehicleLabels";

interface DbReportTabProps {
  title: string;
  titleAccent: string;
  subtitle: string;
  reportType: StoredReportType;
}

function TablePager({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = totalPages(total);
  if (total <= TABLE_PAGE_SIZE) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, fontSize: ".78rem" }}>
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", cursor: page <= 1 ? "default" : "pointer" }}
      >
        Previous
      </button>
      <span style={{ color: "var(--text2)" }}>
        Page {page} of {pages} · {total} row(s)
      </span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
        style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", cursor: page >= pages ? "default" : "pointer" }}
      >
        Next
      </button>
    </div>
  );
}

function DateRangeBar({
  fromDate,
  toDate,
  setFromDate,
  setToDate,
  onRun,
  loading,
}: {
  fromDate: string;
  toDate: string;
  setFromDate: (v: string) => void;
  setToDate: (v: string) => void;
  onRun: () => void;
  loading: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 16 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ".78rem", color: "var(--text2)" }}>
        From
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ".78rem", color: "var(--text2)" }}>
        To
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
        />
      </label>
      <button
        type="button"
        onClick={onRun}
        disabled={loading}
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          border: "none",
          background: "var(--accent)",
          color: "#1a1200",
          fontWeight: 600,
          cursor: loading ? "wait" : "pointer",
        }}
      >
        Run
      </button>
    </div>
  );
}

const thStyle: CSSProperties = { padding: "8px 10px", whiteSpace: "nowrap" };
const tdStyle: CSSProperties = { padding: "6px 10px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" };

function formatTableCell(column: string, value: unknown): string {
  const text = String(value ?? "");
  return shouldUseRegistrationLabel(column) ? registrationLabel(text) : text;
}

function SimpleTable({ rows, columnOrder }: { rows: Record<string, unknown>[]; columnOrder?: string[] }) {
  const [page, setPage] = useState(1);
  const columns = useMemo(() => {
    if (columnOrder?.length) return columnOrder;
    if (!rows.length) return [];
    return Object.keys(rows[0]).filter((k) => !k.startsWith("_"));
  }, [columnOrder, rows]);

  type SortKey = string;
  const { sort, toggleSort } = useTableSort<SortKey>(null);

  const sorted = useMemo(
    () =>
      sortRowsBy(rows, sort, (row, key) => {
        const val = row[key];
        if (typeof val === "number") return val;
        const s = String(val ?? "");
        const dt = parseDateTimeMs(s);
        if (dt > Number.NEGATIVE_INFINITY) return dt;
        const num = parseFirstNumber(s);
        return num || s;
      }),
    [rows, sort],
  );

  const paged = useMemo(() => paginateRows(sorted, page), [sorted, page]);

  if (!rows.length) {
    return <p style={{ color: "var(--text2)", padding: 16 }}>No data for this range. Run backfill if data is missing.</p>;
  }

  return (
    <div>
      <div className="data-table-scroll" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8rem" }}>
          <thead>
            <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
              <th style={thStyle}>#</th>
              {columns.map((c) => (
                <SortHeader
                  key={c}
                  sortKey={c}
                  label={c}
                  sort={sort}
                  onToggle={toggleSort}
                  thStyle={thStyle}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={tdStyle}>{(page - 1) * TABLE_PAGE_SIZE + i + 1}</td>
                {columns.map((c) => (
                  <td key={c} style={tdStyle}>
                    {formatTableCell(c, row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager page={page} total={sorted.length} onChange={setPage} />
    </div>
  );
}

function endpointText(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function isAthiEndpoint(value: unknown): boolean {
  return /athi|arthi|mombasa|vipingo/.test(endpointText(value));
}

function isTororoEndpoint(value: unknown): boolean {
  return /tororo/.test(endpointText(value));
}

function rowMs(row: Record<string, unknown>, key: string): number {
  return parseDateTimeMs(String(row[key] ?? ""));
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const time = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return days > 0 ? `${days} days ${time}` : time;
}

function durationTextMs(value: unknown): number {
  const text = String(value ?? "").toLowerCase();
  let totalMs = 0;
  const dayMatch = text.match(/(\d+(?:\.\d+)?)\s*d(?:ay|ays)?/);
  const timeMatch = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dayMatch) totalMs += Number(dayMatch[1]) * 24 * 60 * 60 * 1000;
  if (timeMatch) {
    totalMs += Number(timeMatch[1]) * 60 * 60 * 1000;
    totalMs += Number(timeMatch[2]) * 60 * 1000;
    totalMs += Number(timeMatch[3] ?? 0) * 1000;
  }
  if (!timeMatch) {
    const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
    const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*m/);
    if (hourMatch) totalMs += Number(hourMatch[1]) * 60 * 60 * 1000;
    if (minuteMatch) totalMs += Number(minuteMatch[1]) * 60 * 1000;
  }
  return totalMs;
}

type PivotSortKey = "vehicle" | "total" | string;

function PivotTable({ pivot, columns }: { pivot: Record<string, Record<string, number>>; columns: string[] }) {
  const [page, setPage] = useState(1);
  const vehicles = Object.keys(pivot);
  const { sort, toggleSort } = useTableSort<PivotSortKey>({ key: "vehicle", dir: "asc" });

  const rows = useMemo(
    () =>
      vehicles.map((v) => {
        const dayValues = pivot[v] ?? {};
        const total = columns.reduce((s, c) => s + (dayValues[c] ?? 0), 0);
        return { vehicle: v, total, days: dayValues };
      }),
    [vehicles, pivot, columns],
  );

  const sorted = useMemo(
    () =>
      sortRowsBy(rows, sort, (row, key) => {
        if (key === "vehicle") return row.vehicle;
        if (key === "total") return row.total;
        return row.days[key] ?? 0;
      }),
    [rows, sort],
  );

  const paged = useMemo(() => paginateRows(sorted, page), [sorted, page]);

  if (!vehicles.length) {
    return <p style={{ color: "var(--text2)", padding: 16 }}>No pivot data for this range.</p>;
  }

  return (
    <div>
      <div className="data-table-scroll" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".78rem" }}>
          <thead>
            <tr style={{ background: "var(--surface2)" }}>
              <th style={thStyle}>#</th>
              <SortHeader sortKey="vehicle" label="Vehicle" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
              {columns.map((c) => (
                <SortHeader key={c} sortKey={c} label={c} sort={sort} onToggle={toggleSort} align="right" thStyle={thStyle} />
              ))}
              <SortHeader sortKey="total" label="Total" sort={sort} onToggle={toggleSort} align="right" thStyle={thStyle} />
            </tr>
          </thead>
          <tbody>
            {paged.map((row, i) => (
              <tr key={row.vehicle} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={tdStyle}>{(page - 1) * TABLE_PAGE_SIZE + i + 1}</td>
                <td style={tdStyle}>{registrationLabel(row.vehicle)}</td>
                {columns.map((c) => (
                  <td key={c} style={{ ...tdStyle, textAlign: "right" }}>
                    {row.days[c] ? Math.round(row.days[c] * 10) / 10 : "—"}
                  </td>
                ))}
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                  {Math.round(row.total * 10) / 10}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager page={page} total={sorted.length} onChange={setPage} />
    </div>
  );
}

function ReportTabShell({
  title,
  titleAccent,
  subtitle,
  reportType,
  mode,
}: DbReportTabProps & { mode: "rows" | "pivot" }) {
  const { data, loading, error, fromDate, toDate, setFromDate, setToDate, run } = useReportData(reportType);

  return (
    <div>
      <PageHeader title={title} titleAccent={titleAccent} subtitle={subtitle} />
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 16,
          boxShadow: "var(--shadow)",
        }}
      >
        <DateRangeBar
          fromDate={fromDate}
          toDate={toDate}
          setFromDate={setFromDate}
          setToDate={setToDate}
          onRun={run}
          loading={loading}
        />
        {error && <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
        {loading ? (
          <p style={{ color: "var(--text2)" }}>Loading from cloud database…</p>
        ) : mode === "pivot" ? (
          <PivotTable pivot={data?.pivot ?? {}} columns={data?.columns ?? []} />
        ) : (
          <SimpleTable rows={data?.rows ?? []} />
        )}
        {data && (
          <p style={{ fontSize: ".72rem", color: "var(--text3)", marginTop: 12 }}>
            {data.snapshotCount} day snapshot(s) loaded from Neon · {data.rows.length} row(s)
          </p>
        )}
      </div>
    </div>
  );
}

type YardsSortKey = "vehicle" | "geofence" | "timeIn" | "duration" | "lastExecutionTime" | "status";
type DurationFilter = "all" | "1" | "2" | "3";

export function YardsTab() {
  const { data, loading, error, fromDate, toDate, setFromDate, setToDate, run } = useReportData("yards");
  const [search, setSearch] = useState("");
  const [geofenceFilter, setGeofenceFilter] = useState("");
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");
  const [page, setPage] = useState(1);
  const { sort, toggleSort } = useTableSort<YardsSortKey>({ key: "duration", dir: "desc" });

  const insideRows = useMemo(() => computeYardsInside(data?.rows ?? []), [data?.rows]);

  const geofenceOptions = useMemo(() => distinctGeofences(insideRows), [insideRows]);

  const filtered = useMemo(() => {
    let rows = insideRows;
    const minDays = durationFilter === "all" ? null : Number(durationFilter);
    rows = filterByMinDays(rows, minDays);
    if (geofenceFilter) rows = rows.filter((r) => r.geofence === geofenceFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.vehicle.toLowerCase().includes(q) || r.registrationNumber.toLowerCase().includes(q));
    }
    return rows;
  }, [insideRows, durationFilter, geofenceFilter, search]);

  const sorted = useMemo(
    () => sortRowsBy(filtered, sort, (row, key) => cellSortValue(row, key)),
    [filtered, sort],
  );

  const paged = useMemo(() => paginateRows(sorted, page), [sorted, page]);
  const lastExecutionTime = insideRows.find((row) => row.lastExecutionTime && row.lastExecutionTime !== "—")?.lastExecutionTime ?? "—";

  const durationChips: { id: DurationFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "1", label: "1+ day" },
    { id: "2", label: "2+ days" },
    { id: "3", label: "3+ days" },
  ];

  return (
    <div>
      <PageHeader
        title="SM_Motrex"
        titleAccent="Yards"
        subtitle="Vehicles currently inside yard geofences (excludes Out of geofences)"
      />
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 16,
          boxShadow: "var(--shadow)",
        }}
      >
        <DateRangeBar
          fromDate={fromDate}
          toDate={toDate}
          setFromDate={setFromDate}
          setToDate={setToDate}
          onRun={run}
          loading={loading}
        />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Search registration…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", minWidth: 160 }}
          />
          <select
            value={geofenceFilter}
            onChange={(e) => {
              setGeofenceFilter(e.target.value);
              setPage(1);
            }}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          >
            <option value="">All geofences</option>
            {geofenceOptions.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {durationChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => {
                  setDurationFilter(chip.id);
                  setPage(1);
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: durationFilter === chip.id ? "1px solid var(--blue)" : "1px solid var(--border)",
                  background: durationFilter === chip.id ? "rgba(21,87,216,0.1)" : "var(--surface2)",
                  cursor: "pointer",
                  fontSize: ".75rem",
                  fontWeight: 600,
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
        {loading ? (
          <p style={{ color: "var(--text2)" }}>Loading from cloud database…</p>
        ) : !sorted.length ? (
          <p style={{ color: "var(--text2)", padding: 16 }}>
            No vehicles currently inside a yard geofence for this range.
          </p>
        ) : (
          <div>
            <div className="data-table-scroll" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8rem" }}>
                <thead>
                  <tr style={{ background: "var(--surface2)" }}>
                    <th style={thStyle}>#</th>
                    <SortHeader sortKey="vehicle" label="Vehicle" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                    <SortHeader sortKey="geofence" label="Geofence" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                    <SortHeader sortKey="timeIn" label="Time In" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                    <SortHeader sortKey="duration" label="Time in Geofence" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                    <SortHeader sortKey="lastExecutionTime" label="Last Execution Time" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                    <SortHeader sortKey="status" label="Status" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row: YardsInsideRow, i) => (
                    <tr key={`${row.vehicle}-${row.geofence}`} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={tdStyle}>{(page - 1) * TABLE_PAGE_SIZE + i + 1}</td>
                      <td style={tdStyle}>{row.vehicle}</td>
                      <td style={tdStyle}>{row.geofence}</td>
                      <td style={tdStyle}>{row.timeIn}</td>
                      <td style={tdStyle}>{row.duration}</td>
                      <td style={tdStyle}>{row.lastExecutionTime}</td>
                      <td style={tdStyle}>{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePager page={page} total={sorted.length} onChange={setPage} />
          </div>
        )}
        {data && (
          <p style={{ fontSize: ".72rem", color: "var(--text3)", marginTop: 12 }}>
            {data.snapshotCount} day snapshot(s) · {insideRows.length} vehicle(s) inside geofences
            {" · "}Last execution: {lastExecutionTime}
          </p>
        )}
      </div>
    </div>
  );
}

export function TripsTab() {
  const { data, loading, error, fromDate, toDate, setFromDate, setToDate, run } = useReportData("trips");
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const outboundRows = useMemo(
    () => rows.filter((row) => isAthiEndpoint(row.From) && isTororoEndpoint(row.To)),
    [rows],
  );
  const inboundRows = useMemo(
    () => rows.filter((row) => isTororoEndpoint(row.From) && isAthiEndpoint(row.To)),
    [rows],
  );
  const tatRows = useMemo(() => {
    const inboundByVehicle = new Map<string, Record<string, unknown>[]>();
    for (const row of inboundRows) {
      const vehicle = registrationLabel(String(row.Vehicle ?? ""));
      inboundByVehicle.set(vehicle, [...(inboundByVehicle.get(vehicle) ?? []), row]);
    }
    const usedInbound = new Set<Record<string, unknown>>();
    return outboundRows
      .map((outbound) => {
        const vehicle = registrationLabel(String(outbound.Vehicle ?? ""));
        const tororoArrivalMs = rowMs(outbound, "Arrival Time");
        const returnLeg = (inboundByVehicle.get(vehicle) ?? [])
          .filter((candidate) => !usedInbound.has(candidate) && rowMs(candidate, "Departure Time") >= tororoArrivalMs)
          .sort((a, b) => rowMs(a, "Departure Time") - rowMs(b, "Departure Time"))[0];
        if (!returnLeg) return null;
        usedInbound.add(returnLeg);
        const outboundTransit = outbound["Transit Time"] ?? "";
        const inboundTransit = returnLeg["Transit Time"] ?? "";
        const fullTatMs = durationTextMs(outboundTransit) + durationTextMs(inboundTransit);
        return {
          Vehicle: vehicle,
          "Trip Counts": 1,
          "Athi River Departure": outbound["Departure Time"] ?? "",
          "Tororo Arrival": outbound["Arrival Time"] ?? "",
          "Tororo Return": returnLeg["Departure Time"] ?? "",
          "Athi River Arrival": returnLeg["Arrival Time"] ?? "",
          "Outbound Transit": outboundTransit,
          "Inbound Transit": inboundTransit,
          "Full Round-Trip TAT": formatDuration(fullTatMs),
        };
      })
      .filter((row) => row !== null)
      .map((row) => row as Record<string, unknown>);
  }, [outboundRows, inboundRows]);
  const tripCount = outboundRows.length + inboundRows.length;
  const tripColumns = useMemo(
    () => [
      "Vehicle",
      "Trip Count",
      "Departure Time",
      "Arrival Time",
      "Transit Time",
      "Parkings duration",
      "Total time",
    ],
    [],
  );
  const tatColumns = useMemo(
    () => [
      "Vehicle",
      "Trip Counts",
      "Athi River Departure",
      "Tororo Arrival",
      "Tororo Return",
      "Athi River Arrival",
      "Outbound Transit",
      "Inbound Transit",
      "Full Round-Trip TAT",
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Athi River /"
        titleAccent="Tororo Trips"
        subtitle="Daily one-day-at-a-time Trips report from Neon"
      />
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 16,
          boxShadow: "var(--shadow)",
        }}
      >
        <DateRangeBar
          fromDate={fromDate}
          toDate={toDate}
          setFromDate={setFromDate}
          setToDate={setToDate}
          onRun={run}
          loading={loading}
        />
        {error && <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
        {loading ? (
          <p style={{ color: "var(--text2)" }}>Loading from cloud database…</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <p style={{ margin: 0, color: "var(--text2)", fontSize: ".82rem", fontWeight: 600 }}>
              {tripCount} trip(s): {outboundRows.length} outbound · {inboundRows.length} inbound · {tatRows.length} TAT row(s)
            </p>
            <section>
              <h3 style={{ margin: "0 0 10px", fontSize: ".95rem", color: "var(--text)" }}>Outbound: Athi River to Tororo</h3>
              <SimpleTable rows={outboundRows} columnOrder={tripColumns} />
            </section>
            <section>
              <h3 style={{ margin: "0 0 10px", fontSize: ".95rem", color: "var(--text)" }}>Inbound: Tororo to Athi River</h3>
              <SimpleTable rows={inboundRows} columnOrder={tripColumns} />
            </section>
            <section>
              <h3 style={{ margin: "0 0 10px", fontSize: ".95rem", color: "var(--text)" }}>TAT: Round-trip turnaround</h3>
              <SimpleTable rows={tatRows} columnOrder={tatColumns} />
            </section>
          </div>
        )}
        {data && (
          <p style={{ fontSize: ".72rem", color: "var(--text3)", marginTop: 12 }}>
            {data.snapshotCount} day snapshot(s) loaded from Neon · {rows.length} row(s)
          </p>
        )}
      </div>
    </div>
  );
}

function formatMetric(value: number, unit: string): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const rounded = Math.round(value * 10) / 10;
  return unit ? `${rounded} ${unit}` : String(rounded);
}

function firstText(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? "").trim();
}

export function TripsSummaryTab() {
  const { data, loading, error, fromDate, toDate, setFromDate, setToDate, run } = useReportData("trips");
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const tripRows = useMemo(() => rows.filter((row) => ["Outbound", "Inbound"].includes(String(row.Table ?? ""))), [rows]);
  const summaryRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        mileage: number;
        consumed: number;
        avgConsumption: number[];
        avgSpeed: number[];
        maxSpeed: number;
        initialFuelLevel: string;
        finalFuelLevel: string;
      }
    >();

    for (const row of tripRows) {
      const vehicle = registrationLabel(String(row.Vehicle ?? "Unknown")) || "Unknown";
      const current =
        grouped.get(vehicle) ??
        {
          mileage: 0,
          consumed: 0,
          avgConsumption: [],
          avgSpeed: [],
          maxSpeed: 0,
          initialFuelLevel: "",
          finalFuelLevel: "",
        };
      current.mileage += parseFirstNumber(String(row.Mileage ?? ""));
      current.consumed += parseFirstNumber(String(row["Consumed by AbsFCS"] ?? ""));
      const consumption = parseFirstNumber(String(row["Avg consumption by AbsFCS"] ?? ""));
      const speed = parseFirstNumber(String(row["Avg speed"] ?? ""));
      if (consumption > 0) current.avgConsumption.push(consumption);
      if (speed > 0) current.avgSpeed.push(speed);
      current.maxSpeed = Math.max(current.maxSpeed, parseFirstNumber(String(row["Max speed"] ?? "")));
      if (!current.initialFuelLevel) current.initialFuelLevel = firstText(row, "Initial fuel level");
      current.finalFuelLevel = firstText(row, "Final fuel level") || current.finalFuelLevel;
      grouped.set(vehicle, current);
    }

    return Array.from(grouped.entries()).map(([vehicle, values]) => ({
      Vehicle: vehicle,
      Mileage: formatMetric(values.mileage, "km"),
      "Consumed by AbsFCS": formatMetric(values.consumed, "l"),
      "Avg consumption by AbsFCS": formatMetric(
        values.avgConsumption.reduce((sum, value) => sum + value, 0) / Math.max(values.avgConsumption.length, 1),
        "l/100 km",
      ),
      "Avg speed": formatMetric(
        values.avgSpeed.reduce((sum, value) => sum + value, 0) / Math.max(values.avgSpeed.length, 1),
        "km/h",
      ),
      "Max speed": formatMetric(values.maxSpeed, "km/h"),
      "Initial fuel level": values.initialFuelLevel,
      "Final fuel level": values.finalFuelLevel,
    }));
  }, [tripRows]);

  const summaryColumns = useMemo(
    () => [
      "Vehicle",
      "Mileage",
      "Consumed by AbsFCS",
      "Avg consumption by AbsFCS",
      "Avg speed",
      "Max speed",
      "Initial fuel level",
      "Final fuel level",
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Trips"
        titleAccent="Summary"
        subtitle="Trip summary statistics aggregated per vehicle from Neon"
      />
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 16,
          boxShadow: "var(--shadow)",
        }}
      >
        <DateRangeBar
          fromDate={fromDate}
          toDate={toDate}
          setFromDate={setFromDate}
          setToDate={setToDate}
          onRun={run}
          loading={loading}
        />
        {error && <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
        {loading ? (
          <p style={{ color: "var(--text2)" }}>Loading from cloud database…</p>
        ) : (
          <SimpleTable rows={summaryRows} columnOrder={summaryColumns} />
        )}
        {data && (
          <p style={{ fontSize: ".72rem", color: "var(--text3)", marginTop: 12 }}>
            {data.snapshotCount} day snapshot(s) loaded from Neon · {summaryRows.length} vehicle(s)
          </p>
        )}
      </div>
    </div>
  );
}

export function UtilizationTab() {
  return (
    <ReportTabShell
      title="Fleet"
      titleAccent="Utilization"
      subtitle="Daily distance pivot from Track3 utilization report"
      reportType="utilization"
      mode="pivot"
    />
  );
}

export function EcoDrivingTab() {
  return (
    <ReportTabShell
      title="Eco"
      titleAccent="Driving"
      subtitle="Violation counts by vehicle — cloud database"
      reportType="eco_driving"
      mode="pivot"
    />
  );
}
