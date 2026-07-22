"use client";

import { useMemo, useState, useCallback, type CSSProperties } from "react";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import PageHeader from "./PageHeader";
import ChartBox from "./ChartBox";
import { CategoryAxisTick } from "./CategoryAxisTick";
import { useReportData } from "@/lib/useReportData";
import { exportMotrexReportPdf } from "@/lib/exportMotrexReportPdf";
import { getUtilizationBand, UTILIZATION_BANDS } from "@/lib/utilizationBands";
import {
  SortHeader,
  sortRowsBy,
  useTableSort,
  parseFirstNumber,
} from "@/lib/sortableTable";
import { parseDateTimeMs } from "@/lib/parseDateTime";
import { TABLE_PAGE_SIZE, paginateRows, totalPages } from "@/lib/tablePagination";
import {
  computeYardsInside,
  distinctGeofences,
  filterByDurationBucket,
  cellSortValue,
  type YardsInsideRow,
} from "@/lib/yardsGeofence";
import { formatEatNow, todayEatDateString, currentEatMonthString } from "@/lib/dateRange";
import { formatTimeSince } from "@/lib/formatDuration";
import { SELECTED_GEOFENCE_NAMES } from "@/lib/motrexGeofences";
import type { YardsLiveDataset } from "@/lib/wialon/yards";
import { registrationKey, registrationLabel, shouldUseRegistrationLabel } from "@/lib/vehicleLabels";

function DatabaseLastUpdatedBar({
  lastUpdatedAt,
  note = "Daily pipeline starts at 12:00 AM EAT",
}: {
  lastUpdatedAt?: string | null;
  note?: string;
}) {
  return (
    <div
      style={{
        background: "linear-gradient(90deg, #ecfdf5 0%, #f0fdf4 100%)",
        border: "1px solid #86efac",
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 14,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        boxShadow: "0 1px 2px rgba(22, 101, 52, 0.08)",
      }}
    >
      <strong style={{ color: "#166534", fontSize: ".92rem" }}>
        Last database update: {lastUpdatedAt ? lastUpdatedAt : "No data in selected range yet"}
      </strong>
      <span style={{ color: "#15803d", fontSize: ".78rem", fontWeight: 600 }}>{note}</span>
    </div>
  );
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
  header = false,
}: {
  fromDate: string;
  toDate: string;
  setFromDate: (v: string) => void;
  setToDate: (v: string) => void;
  onRun: () => void;
  loading: boolean;
  header?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", justifyContent: header ? "flex-end" : "flex-start", marginBottom: header ? 0 : 16 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: ".72rem", color: "var(--text)", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em" }}>
        From
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", minWidth: 150 }}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: ".72rem", color: "var(--text)", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em" }}>
        To
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", minWidth: 150 }}
        />
      </label>
      <button
        type="button"
        onClick={() => onRun()}
        disabled={loading}
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          border: "none",
          background: "linear-gradient(135deg, #8b1026, #c41e3a)",
          color: "#fff",
          fontWeight: 900,
          cursor: loading ? "wait" : "pointer",
          boxShadow: "0 8px 18px rgba(139,16,38,0.24)",
        }}
      >
        Run
      </button>
    </div>
  );
}

const thStyle: CSSProperties = { padding: "8px 10px", whiteSpace: "nowrap" };
const tdStyle: CSSProperties = { padding: "6px 10px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" };
const CHART_COLORS = ["#c41e3a", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0891b2"];

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

function PivotTable({
  pivot,
  columns,
  colorizeDistanceCells = false,
}: {
  pivot: Record<string, Record<string, number>>;
  columns: string[];
  colorizeDistanceCells?: boolean;
}) {
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
                {columns.map((c) => {
                  const value = row.days[c] ?? 0;
                  const band = colorizeDistanceCells ? getUtilizationBand(value) : null;
                  return (
                  <td key={c} style={{ ...tdStyle, textAlign: "right", backgroundColor: band?.hex, color: band ? "#111827" : undefined }}>
                    {value ? Math.round(value * 10) / 10 : "—"}
                  </td>
                  );
                })}
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

function KpiGrid({ items }: { items: Array<{ label: string; value: string; color: string }> }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "14px 16px",
            boxShadow: "var(--shadow)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${item.color}, transparent)` }} />
          <div style={{ fontSize: "1.45rem", fontWeight: 800, color: "var(--text)" }}>{item.value}</div>
          <div style={{ marginTop: 6, fontSize: ".68rem", color: "#000", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 800 }}>{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function redButtonStyle(disabled = false): CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid rgba(139,16,38,0.35)",
    background: "linear-gradient(135deg, #8b1026, #c41e3a)",
    color: "#fff",
    fontWeight: 800,
    boxShadow: "0 8px 18px rgba(139,16,38,0.2)",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.72 : 1,
  };
}

function ExportActions({
  onExcel,
  onPdf,
}: {
  onExcel: () => void;
  onPdf: () => void;
}) {
  const buttonStyle: CSSProperties = {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid rgba(139,16,38,0.35)",
    background: "linear-gradient(135deg, #8b1026, #c41e3a)",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 8px 18px rgba(139,16,38,0.2)",
  };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", marginBottom: 12 }}>
      <button type="button" onClick={onExcel} style={buttonStyle}>
        Download Excel
      </button>
      <button type="button" onClick={onPdf} style={buttonStyle}>
        Download PDF
      </button>
    </div>
  );
}

function ChartPanel({ title, data, dataKey = "value" }: { title: string; data: Record<string, unknown>[]; dataKey?: string }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow)", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 800, color: "var(--text)" }}>{title}</div>
      <div style={{ padding: 12, minWidth: 0 }}>
        <ChartBox height={300} minHeight={220}>
          {(size) => (
            <ResponsiveContainer width={size.width} height={size.height} debounce={80}>
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 82 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5ecff" />
                <XAxis dataKey="name" interval={0} height={88} tick={(props) => <CategoryAxisTick {...props} maxChars={18} />} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#4d6488" }} tickLine={false} axisLine={false} width={42} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #d9e5ff", background: "#fff" }} />
                <Bar dataKey={dataKey} radius={[6, 6, 0, 0]}>
                  {data.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartBox>
      </div>
    </div>
  );
}

function monthBounds(month: string): { from: string; to: string } {
  const [year, monthIndex] = month.split("-").map(Number);
  const lastDay = new Date(year, monthIndex, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function weekBounds(month: string, week: string): { from: string; to: string } {
  if (week === "all") return monthBounds(month);
  const weekNum = Number(week);
  const start = (weekNum - 1) * 7 + 1;
  const monthRange = monthBounds(month);
  const end = Math.min(start + 6, Number(monthRange.to.slice(-2)));
  return {
    from: `${month}-${String(start).padStart(2, "0")}`,
    to: `${month}-${String(end).padStart(2, "0")}`,
  };
}

function MonthWeekFilter({
  fromDate,
  setFromDate,
  setToDate,
  onApply,
  loading = false,
}: {
  fromDate: string;
  setFromDate: (value: string) => void;
  setToDate: (value: string) => void;
  onApply: (from: string, to: string) => void;
  loading?: boolean;
}) {
  const [month, setMonth] = useState(() => fromDate.slice(0, 7) || currentEatMonthString());
  const [week, setWeek] = useState("all");
  const apply = () => {
    const bounds = weekBounds(month, week);
    setFromDate(bounds.from);
    setToDate(bounds.to);
    onApply(bounds.from, bounds.to);
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 16 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ".78rem", color: "var(--text2)", fontWeight: 700 }}>
        Month
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ".78rem", color: "var(--text2)", fontWeight: 700 }}>
        Week
        <select value={week} onChange={(e) => setWeek(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
          <option value="all">Full month</option>
          <option value="1">Week 1</option>
          <option value="2">Week 2</option>
          <option value="3">Week 3</option>
          <option value="4">Week 4</option>
          <option value="5">Week 5</option>
        </select>
      </label>
      <button type="button" onClick={apply} disabled={loading} style={redButtonStyle(loading)}>
        Apply Range
      </button>
    </div>
  );
}

function pivotRows(pivot: Record<string, Record<string, number>>, columns: string[]) {
  const merged: Record<string, Record<string, number>> = {};
  for (const [vehicle, values] of Object.entries(pivot)) {
    const key = registrationKey(vehicle) || "UNKNOWN";
    if (!merged[key]) merged[key] = {};
    for (const column of columns) {
      merged[key][column] = (merged[key][column] ?? 0) + (values[column] ?? 0);
    }
  }
  return Object.entries(merged).map(([vehicle, values]) => {
    const total = columns.reduce((sum, column) => sum + (values[column] ?? 0), 0);
    return { name: registrationLabel(vehicle), vehicle: registrationLabel(vehicle), total, values };
  });
}

function averageDurationLabel(rows: Record<string, unknown>[], key: string): string {
  if (!rows.length) return "—";
  const total = rows.reduce((sum, row) => sum + durationTextMs(row[key]), 0);
  return formatDuration(total / rows.length);
}

function numericMetric(row: Record<string, unknown>, key: string): number {
  return parseFirstNumber(String(row[key] ?? ""));
}

function rowsForColumns(rows: Record<string, unknown>[], columns: string[]) {
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ""])));
}

async function saveExcelWorkbook(workbook: ExcelJS.Workbook, fileName: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function UtilizationLegend() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 12px", fontSize: ".76rem", color: "var(--text2)", fontWeight: 700 }}>
      {UTILIZATION_BANDS.map((band) => (
        <span key={band.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 18, height: 12, border: "1px solid rgba(17,24,39,0.25)", background: band.hex }} />
          {band.label}
        </span>
      ))}
    </div>
  );
}

type YardsSortKey = "vehicle" | "geofence" | "timeIn" | "duration" | "lastExecutionTime" | "status";
type DurationFilter = "all" | "1" | "2" | "3";

interface YardsTabProps {
  data: YardsLiveDataset | null;
  loading: boolean;
  syncing?: boolean;
  syncLabel?: string | null;
  error: string | null;
  onRefresh: () => void;
  onSyncFromTrack3: () => void;
  nowMs: number;
  lastExecutionTime: string;
  lastUpdatedAt?: string | null;
}

export function YardsTab({
  data,
  loading,
  syncing = false,
  syncLabel = null,
  error,
  onRefresh,
  onSyncFromTrack3,
  nowMs,
  lastExecutionTime,
  lastUpdatedAt,
}: YardsTabProps) {
  const [search, setSearch] = useState("");
  const [geofenceFilter, setGeofenceFilter] = useState("");
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");
  const [page, setPage] = useState(1);
  const { sort, toggleSort: baseToggleSort } = useTableSort<YardsSortKey>({ key: "duration", dir: "desc" });

  const toggleSort = useCallback(
    (key: YardsSortKey) => {
      baseToggleSort(key);
      setPage(1);
    },
    [baseToggleSort],
  );

  const insideRows = useMemo(() => {
    const snapshotInside = (data as { insideRows?: YardsInsideRow[] } | null)?.insideRows ?? [];
    if (snapshotInside.length) {
      return snapshotInside.map((row) => {
        const timeInMs = parseDateTimeMs(row.timeIn);
        const durationDays =
          timeInMs > 0 ? Math.max(0, (nowMs - timeInMs) / 86400000) : row.durationDays;
        return {
          ...row,
          duration: formatTimeSince(timeInMs > 0 ? timeInMs : null, nowMs),
          durationDays,
        };
      });
    }
    if (data?.rows?.length) {
      return computeYardsInside(data.rows, { endMs: nowMs, lastExecutionTime });
    }
    return [];
  }, [data, nowMs, lastExecutionTime]);

  const uniqueVehicleCount = useMemo(
    () => new Set(insideRows.map((r) => registrationKey(r.registrationNumber || r.vehicle))).size,
    [insideRows],
  );

  const geofenceOptions = useMemo(() => distinctGeofences(insideRows), [insideRows]);

  const filtered = useMemo(() => {
    let rows = insideRows;
    rows = filterByDurationBucket(rows, durationFilter === "all" ? null : durationFilter);
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

  const durationChips: { id: DurationFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "1", label: "1+ day" },
    { id: "2", label: "2+ days" },
    { id: "3", label: "3+ days" },
  ];

  const exportExcel = () => {
    const sheet = sorted.map((row) => {
      const timeInMs = parseDateTimeMs(row.timeIn);
      return {
        Vehicle: row.vehicle,
        Geofence: row.geofence,
        "Time In": row.timeIn,
        "Time in Geofence": formatTimeSince(timeInMs > 0 ? timeInMs : null, nowMs),
        Status: row.status,
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "Yards");
    XLSX.writeFile(wb, `Motrex_Yards_${todayEatDateString()}.xlsx`);
  };

  const exportPdf = () => {
    exportMotrexReportPdf({
      title: "Motrex Yards",
      subtitle: `Vehicles inside geofences · ${formatEatNow()}`,
      fileName: `Motrex_Yards_${todayEatDateString()}.pdf`,
      summary: [
        { label: "Vehicles Inside", value: String(uniqueVehicleCount), accent: "#c41e3a" },
        { label: "Last Execution", value: lastExecutionTime, accent: "#2563eb" },
        { label: "Geofence Zones", value: String(SELECTED_GEOFENCE_NAMES.length), accent: "#16a34a" },
      ],
      sections: [
        {
          heading: "Inside Vehicles",
          head: [["Vehicle", "Geofence", "Time In", "Time in Geofence", "Status"]],
          body: sorted.map((row) => {
            const timeInMs = parseDateTimeMs(row.timeIn);
            return [
              row.vehicle,
              row.geofence,
              row.timeIn,
              formatTimeSince(timeInMs > 0 ? timeInMs : null, nowMs),
              row.status,
            ];
          }),
        },
      ],
    });
  };

  return (
    <div>
      <PageHeader
        title="Motrex"
        titleAccent="Yards"
        subtitle={`Vehicles inside selected geofences · last 30 days (${SELECTED_GEOFENCE_NAMES.length} zones)`}
        right={
          <button
            type="button"
            onClick={onSyncFromTrack3}
            disabled={syncing}
            title="Discover vehicles inside geofences and sync last 30 days from Track3"
            style={redButtonStyle(syncing)}
          >
            {syncing ? (syncLabel ?? "Syncing…") : "Sync from Track3"}
          </button>
        }
      />
      <DatabaseLastUpdatedBar
        lastUpdatedAt={lastUpdatedAt}
        note="Daily pipeline starts at 12:00 AM EAT"
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
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            style={redButtonStyle(loading && !syncing)}
          >
            {loading && !syncing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {sorted.length > 0 && <ExportActions onExcel={exportExcel} onPdf={exportPdf} />}
        {!data && !loading && !error && (
          <p style={{ margin: "0 0 12px", color: "var(--text2)", fontSize: ".82rem", fontWeight: 700 }}>
            No yards data yet — background sync will populate the database shortly.
          </p>
        )}

        {error && <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
        {loading ? (
          <p style={{ color: "var(--text2)" }}>Preparing report data…</p>
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
                    <SortHeader sortKey="status" label="Status" sort={sort} onToggle={toggleSort} thStyle={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row: YardsInsideRow, i) => {
                    const timeInMs = parseDateTimeMs(row.timeIn);
                    return (
                    <tr
                      key={registrationKey(row.registrationNumber || row.vehicle)}
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      <td style={tdStyle}>{(page - 1) * TABLE_PAGE_SIZE + i + 1}</td>
                      <td style={tdStyle}>{row.vehicle}</td>
                      <td style={tdStyle}>{row.geofence}</td>
                      <td style={tdStyle}>{row.timeIn}</td>
                      <td style={tdStyle}>
                        {formatTimeSince(timeInMs > 0 ? timeInMs : null, nowMs)}
                      </td>
                      <td style={tdStyle}>{row.status}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <TablePager page={page} total={sorted.length} onChange={setPage} />
          </div>
        )}
        {data && (
          <p style={{ fontSize: ".72rem", color: "var(--text3)", marginTop: 12 }}>
            Last 30 days · {uniqueVehicleCount} vehicle(s) inside geofences
          </p>
        )}
      </div>
    </div>
  );
}

function tripEventMs(row: Record<string, unknown>): number {
  const keys = ["Departure Time", "Beginning", "Loading Departure", "Offloading Arrival", "Arrival Time"];
  for (const key of keys) {
    const ms = rowMs(row, key);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return Number.NEGATIVE_INFINITY;
}

function tripInDateRange(row: Record<string, unknown>, fromDate: string, toDate: string): boolean {
  const ms = tripEventMs(row);
  if (!Number.isFinite(ms) || ms <= 0) return false;
  const fromMs = Date.parse(`${fromDate}T00:00:00+03:00`);
  const toMs = Date.parse(`${toDate}T23:59:59+03:00`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return true;
  return ms >= fromMs && ms <= toMs;
}

function topVehiclesByTripCount(rows: Record<string, unknown>[], limit = 10): Array<{ name: string; value: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = registrationLabel(String(row.Vehicle ?? "Unknown"));
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function TripsTab() {
  const { data, loading, error, fromDate, toDate, setFromDate, setToDate, run } = useReportData("trips");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [loadingZone, setLoadingZone] = useState("all");
  const [offloadingZone, setOffloadingZone] = useState("all");
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);

  const dateFilteredRows = useMemo(
    () => rows.filter((row) => tripInDateRange(row, fromDate, toDate)),
    [rows, fromDate, toDate],
  );

  const loadingZones = useMemo(() => {
    const set = new Set<string>();
    for (const row of dateFilteredRows) {
      const z = String(row["Loading Zone"] ?? row.From ?? "").trim();
      if (z) set.add(z);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [dateFilteredRows]);

  const offloadingZones = useMemo(() => {
    const set = new Set<string>();
    for (const row of dateFilteredRows) {
      const z = String(row["Offloading Zone"] ?? row.To ?? "").trim();
      if (z && /tororo|athi/i.test(z)) set.add(z);
      else if (z) set.add(z);
    }
    set.add("Tororo");
    set.add("Athi River");
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [dateFilteredRows]);

  const filteredBase = useMemo(() => {
    return dateFilteredRows.filter((row) => {
      if (String(row.Table ?? "") === "TAT") return false;
      const q = vehicleSearch.trim().toLowerCase();
      if (q && !registrationLabel(String(row.Vehicle ?? "")).toLowerCase().includes(q)) return false;
      const load = String(row["Loading Zone"] ?? row.From ?? "");
      const off = String(row["Offloading Zone"] ?? row.To ?? "");
      if (loadingZone !== "all" && load !== loadingZone) return false;
      if (offloadingZone !== "all") {
        if (offloadingZone === "Athi River") {
          if (!/athi/i.test(off)) return false;
        } else if (offloadingZone === "Tororo") {
          if (!/tororo/i.test(off)) return false;
        } else if (off !== offloadingZone) {
          return false;
        }
      }
      return true;
    });
  }, [dateFilteredRows, vehicleSearch, loadingZone, offloadingZone]);

  const outboundRows = useMemo(
    () =>
      filteredBase.filter(
        (row) =>
          String(row.Table ?? "") === "Outbound" ||
          (isAthiEndpoint(row.From) && isTororoEndpoint(row.To)),
      ),
    [filteredBase],
  );
  const inboundRows = useMemo(
    () =>
      filteredBase.filter(
        (row) =>
          String(row.Table ?? "") === "Inbound" ||
          (isTororoEndpoint(row.From) && isAthiEndpoint(row.To)),
      ),
    [filteredBase],
  );
  const outboundDisplayRows = useMemo<Record<string, unknown>[]>(
    () =>
      outboundRows.map((row) => ({
        ...(row as Record<string, unknown>),
        Distance: formatMetric(parseFirstNumber(String(row.Mileage ?? "")), "km"),
        "Loading Zone": row["Loading Zone"] ?? row.From ?? "",
        "Offloading Zone": row["Offloading Zone"] ?? row.To ?? "",
      })),
    [outboundRows],
  );
  const inboundDisplayRows = useMemo<Record<string, unknown>[]>(
    () =>
      inboundRows.map((row) => ({
        ...(row as Record<string, unknown>),
        Distance: formatMetric(parseFirstNumber(String(row.Mileage ?? "")), "km"),
        "Loading Zone": row["Loading Zone"] ?? row.To ?? "",
        "Offloading Zone": row["Offloading Zone"] ?? row.From ?? "",
      })),
    [inboundRows],
  );
  const tatRows = useMemo(() => {
    const inboundByVehicle = new Map<string, Record<string, unknown>[]>();
    for (const row of inboundRows) {
      const vehicle = registrationLabel(String(row.Vehicle ?? ""));
      const pair = String(row["Route Pair"] ?? "");
      const key = `${vehicle}::${pair}`;
      inboundByVehicle.set(key, [...(inboundByVehicle.get(key) ?? []), row]);
    }
    const usedInbound = new Set<Record<string, unknown>>();
    return outboundRows
      .map((outbound) => {
        const vehicle = registrationLabel(String(outbound.Vehicle ?? ""));
        const pair = String(outbound["Route Pair"] ?? "");
        const key = `${vehicle}::${pair}`;
        const tororoArrivalMs = rowMs(outbound, "Arrival Time");
        const returnLeg = (inboundByVehicle.get(key) ?? inboundByVehicle.get(`${vehicle}::`) ?? [])
          .filter((candidate) => !usedInbound.has(candidate) && rowMs(candidate, "Departure Time") >= tororoArrivalMs)
          .sort((a, b) => rowMs(a, "Departure Time") - rowMs(b, "Departure Time"))[0];
        if (!returnLeg) return null;
        usedInbound.add(returnLeg);
        const outboundTransit = outbound["Transit Time"] ?? "";
        const inboundTransit = returnLeg["Transit Time"] ?? "";
        const fullTatMs = durationTextMs(outboundTransit) + durationTextMs(inboundTransit);
        const roundTripDistance =
          parseFirstNumber(String(outbound.Mileage ?? "")) + parseFirstNumber(String(returnLeg.Mileage ?? ""));
        return {
          Vehicle: vehicle,
          "Loading Zone": outbound["Loading Zone"] ?? outbound.From ?? "",
          "Offloading Zone": outbound["Offloading Zone"] ?? outbound.To ?? "",
          "Loading Departure": outbound["Departure Time"] ?? "",
          "Offloading Arrival": outbound["Arrival Time"] ?? "",
          "Offloading Departure": returnLeg["Departure Time"] ?? "",
          "Loading Return": returnLeg["Arrival Time"] ?? "",
          "Outbound Transit": outboundTransit,
          "Inbound Transit": inboundTransit,
          "Customer Time": formatDuration(
            Math.max(0, rowMs(returnLeg, "Departure Time") - rowMs(outbound, "Arrival Time")),
          ),
          Distance: formatMetric(roundTripDistance, "km"),
          "Full Round-Trip TAT": formatDuration(fullTatMs),
        };
      })
      .filter((row) => row !== null)
      .map((row) => row as Record<string, unknown>);
  }, [outboundRows, inboundRows]);

  const topOutbound = useMemo(() => topVehiclesByTripCount(outboundRows), [outboundRows]);
  const topInbound = useMemo(() => topVehiclesByTripCount(inboundRows), [inboundRows]);
  const topTat = useMemo(() => topVehiclesByTripCount(tatRows), [tatRows]);

  const tripCount = outboundRows.length + inboundRows.length;
  const tripColumns = useMemo(
    () => [
      "Vehicle",
      "Loading Zone",
      "Offloading Zone",
      "Departure Time",
      "Arrival Time",
      "Distance",
      "Transit Time",
      "Parkings duration",
      "Total time",
    ],
    [],
  );
  const tatColumns = useMemo(
    () => [
      "Vehicle",
      "Loading Zone",
      "Offloading Zone",
      "Loading Departure",
      "Offloading Arrival",
      "Offloading Departure",
      "Loading Return",
      "Outbound Transit",
      "Inbound Transit",
      "Customer Time",
      "Distance",
      "Full Round-Trip TAT",
    ],
    [],
  );

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsForColumns(outboundDisplayRows, tripColumns)), "Outbound");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsForColumns(inboundDisplayRows, tripColumns)), "Inbound");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsForColumns(tatRows, tatColumns)), "TAT");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topOutbound), "Top Outbound");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topInbound), "Top Inbound");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topTat), "Top TAT");
    XLSX.writeFile(wb, `Motrex_Group_Trips_${fromDate}_${toDate}.xlsx`);
  };
  const exportPdf = () => {
    exportMotrexReportPdf({
      title: "Motrex Group Trips",
      subtitle: `${fromDate} to ${toDate} · Group Trips`,
      fileName: `Motrex_Group_Trips_${fromDate}_${toDate}.pdf`,
      summary: [
        { label: "Outbound Trips", value: String(outboundRows.length), accent: "#c41e3a" },
        { label: "Inbound Trips", value: String(inboundRows.length), accent: "#2563eb" },
        { label: "TAT Rows", value: String(tatRows.length), accent: "#16a34a" },
        { label: "Avg Outbound Transit", value: averageDurationLabel(outboundRows, "Transit Time"), accent: "#f59e0b" },
        { label: "Avg Inbound Transit", value: averageDurationLabel(inboundRows, "Transit Time"), accent: "#7c3aed" },
        { label: "Avg Round Trip TAT", value: averageDurationLabel(tatRows, "Full Round-Trip TAT"), accent: "#0891b2" },
      ],
      sections: [
        { heading: "Outbound", head: [tripColumns], body: outboundDisplayRows.slice(0, 80).map((row) => tripColumns.map((col) => row[col] ?? "")) },
        { heading: "Inbound", head: [tripColumns], body: inboundDisplayRows.slice(0, 80).map((row) => tripColumns.map((col) => row[col] ?? "")) },
        { heading: "TAT: Round-trip turnaround", head: [tatColumns], body: tatRows.slice(0, 80).map((row) => tatColumns.map((col) => row[col] ?? "")) },
      ],
    });
  };

  return (
    <div>
      <PageHeader
        title="Group"
        titleAccent="Trips"
        subtitle="Trips between Motrex, Multiple, and Vipingo yards and Tororo or Athi"
        right={<DateRangeBar fromDate={fromDate} toDate={toDate} setFromDate={setFromDate} setToDate={setToDate} onRun={run} loading={loading} header />}
      />
      <DatabaseLastUpdatedBar
        lastUpdatedAt={data?.lastUpdatedAt}
        note="Daily pipeline starts at 12:00 AM EAT · last 14 days"
      />
      <MonthWeekFilter
        fromDate={fromDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
        onApply={(from, to) => run(from, to)}
        loading={loading}
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
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
            <input
              type="text"
              placeholder="Search vehicle..."
              value={vehicleSearch}
              onChange={(e) => setVehicleSearch(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", minWidth: 200 }}
            />
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ".78rem", color: "var(--text2)", fontWeight: 700 }}>
              Loading zone
              <select
                value={loadingZone}
                onChange={(e) => setLoadingZone(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", minWidth: 180 }}
              >
                <option value="all">All loading zones</option>
                {loadingZones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ".78rem", color: "var(--text2)", fontWeight: 700 }}>
              Offloading zone
              <select
                value={offloadingZone}
                onChange={(e) => setOffloadingZone(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", minWidth: 160 }}
              >
                <option value="all">All offloading zones</option>
                {offloadingZones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ExportActions onExcel={exportExcel} onPdf={exportPdf} />
        </div>
        {error && <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
        {loading ? (
          <p style={{ color: "var(--text2)" }}>Preparing report data…</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <KpiGrid
              items={[
                { label: "Outbound Trips", value: String(outboundRows.length), color: "#c41e3a" },
                { label: "Inbound Trips", value: String(inboundRows.length), color: "#2563eb" },
                { label: "TAT Rows", value: String(tatRows.length), color: "#16a34a" },
                { label: "Avg Outbound Transit", value: averageDurationLabel(outboundRows, "Transit Time"), color: "#f59e0b" },
                { label: "Avg Inbound Transit", value: averageDurationLabel(inboundRows, "Transit Time"), color: "#7c3aed" },
                { label: "Avg Round-Trip TAT", value: averageDurationLabel(tatRows, "Full Round-Trip TAT"), color: "#0891b2" },
              ]}
            />
            <p style={{ margin: 0, color: "var(--text2)", fontSize: ".82rem", fontWeight: 600 }}>
              {fromDate} → {toDate} · {tripCount} trip(s): {outboundRows.length} outbound · {inboundRows.length} inbound ·{" "}
              {tatRows.length} TAT row(s)
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
              <ChartPanel title="Top 10 Vehicles — Outbound Trips" data={topOutbound} />
              <ChartPanel title="Top 10 Vehicles — Inbound Trips" data={topInbound} />
              <ChartPanel title="Top 10 Vehicles — Round-Trip TAT" data={topTat} />
            </div>
            <section>
              <h3 style={{ margin: "0 0 10px", fontSize: "1.02rem", color: "var(--text)", fontWeight: 900 }}>Outbound</h3>
              <SimpleTable rows={outboundDisplayRows} columnOrder={tripColumns} />
            </section>
            <section>
              <h3 style={{ margin: "0 0 10px", fontSize: "1.02rem", color: "var(--text)", fontWeight: 900 }}>Inbound</h3>
              <SimpleTable rows={inboundDisplayRows} columnOrder={tripColumns} />
            </section>
            <section>
              <h3 style={{ margin: "0 0 10px", fontSize: "1.02rem", color: "var(--text)", fontWeight: 900 }}>TAT: Round-trip turnaround</h3>
              <SimpleTable rows={tatRows} columnOrder={tatColumns} />
            </section>
          </div>
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

export function TripsSummaryTab() {
  const { data, loading, error, fromDate, toDate, setFromDate, setToDate, run } =
    useReportData("trips_summary");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const summaryRows = useMemo(() => {
    const rows = data?.rows ?? [];
    const q = vehicleSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => String(row.Vehicle ?? "").toLowerCase().includes(q));
  }, [data?.rows, vehicleSearch]);

  const summaryColumns = useMemo(
    () => [
      "Vehicle",
      "Mileage in trips",
      "Parkings",
      "Max. speed",
      "Utilization",
      "Engine hours",
      "Time in trips",
      "Consumed by FLS",
      "Avg. consumption by FLS",
    ],
    [],
  );
  const totalMileage = summaryRows.reduce(
    (sum, row) => sum + (numericMetric(row, "Mileage in trips") || numericMetric(row, "Mileage")),
    0,
  );
  const totalFuel = summaryRows.reduce(
    (sum, row) => sum + (numericMetric(row, "Consumed by FLS") || numericMetric(row, "Fuel Consumed")),
    0,
  );
  const avgConsumptionValues = summaryRows
    .map((row) => numericMetric(row, "Avg. consumption by FLS") || numericMetric(row, "Avg Consumption (Km/l)"))
    .filter((value) => value > 0);
  const topMileage = useMemo(
    () =>
      [...summaryRows]
        .map((row) => ({
          name: String(row.Vehicle ?? ""),
          value: numericMetric(row, "Mileage in trips") || numericMetric(row, "Mileage"),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    [summaryRows],
  );
  const topFuel = useMemo(
    () =>
      [...summaryRows]
        .map((row) => ({
          name: String(row.Vehicle ?? ""),
          value: numericMetric(row, "Consumed by FLS") || numericMetric(row, "Fuel Consumed"),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    [summaryRows],
  );
  const topConsumption = useMemo(
    () =>
      [...summaryRows]
        .map((row) => ({
          name: String(row.Vehicle ?? ""),
          value:
            numericMetric(row, "Avg. consumption by FLS") ||
            numericMetric(row, "Avg Consumption (Km/l)"),
        }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    [summaryRows],
  );
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Trips Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topMileage), "Top Mileage");
    XLSX.writeFile(wb, `Motrex_Trips_Summary_${fromDate}_${toDate}.xlsx`);
  };
  const exportPdf = () => {
    exportMotrexReportPdf({
      title: "Motrex Trips Summary",
      subtitle: `${fromDate} to ${toDate}`,
      fileName: `Motrex_Trips_Summary_${fromDate}_${toDate}.pdf`,
      summary: [
        { label: "Total Mileage", value: `${totalMileage.toFixed(1)} km`, accent: "#c41e3a" },
        { label: "Fuel Consumed (FLS)", value: `${totalFuel.toFixed(1)} l`, accent: "#2563eb" },
        {
          label: "Avg Consumption (FLS)",
          value: avgConsumptionValues.length
            ? `${(avgConsumptionValues.reduce((sum, value) => sum + value, 0) / avgConsumptionValues.length).toFixed(1)} l/100 km`
            : "—",
          accent: "#16a34a",
        },
        { label: "Vehicle Count", value: String(summaryRows.length), accent: "#0891b2" },
      ],
      sections: [
        {
          heading: "Top 10 Vehicles by Mileage",
          head: [["Vehicle", "Mileage"]],
          body: topMileage.map((row) => [row.name, row.value.toFixed(1)]),
        },
        {
          heading: "Trips Summary",
          head: [summaryColumns],
          body: summaryRows
            .slice(0, 80)
            .map((row) => summaryColumns.map((column) => (row as Record<string, unknown>)[column] ?? "")),
        },
      ],
    });
  };
  const busy = loading;

  return (
    <div>
      <PageHeader
        title="Trips"
        titleAccent="Summary"
        subtitle="Weekly vehicle mileage, fuel, utilization, and engine-hour summary"
        right={
          <DateRangeBar
            fromDate={fromDate}
            toDate={toDate}
            setFromDate={setFromDate}
            setToDate={setToDate}
            onRun={run}
            loading={busy}
            header
          />
        }
      />
      <DatabaseLastUpdatedBar
        lastUpdatedAt={data?.lastUpdatedAt}
        note="Daily pipeline starts at 12:00 AM EAT"
      />
      <MonthWeekFilter
        fromDate={fromDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
        onApply={(from, to) => run(from, to)}
        loading={busy}
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
        {error && <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
        {loading && !data ? (
          <p style={{ color: "var(--text2)" }}>Preparing report data…</p>
        ) : (
          <>
            <KpiGrid
              items={[
                { label: "Total Mileage", value: `${totalMileage.toFixed(1)} km`, color: "#c41e3a" },
                { label: "Consumed by FLS", value: `${totalFuel.toFixed(1)} l`, color: "#2563eb" },
                {
                  label: "Avg. consumption by FLS",
                  value: avgConsumptionValues.length
                    ? `${(avgConsumptionValues.reduce((sum, value) => sum + value, 0) / avgConsumptionValues.length).toFixed(1)} l/100 km`
                    : "—",
                  color: "#16a34a",
                },
                { label: "Vehicle Count", value: String(summaryRows.length), color: "#0891b2" },
              ]}
            />
            <ExportActions onExcel={exportExcel} onPdf={exportPdf} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 16 }}>
              <ChartPanel title="Top 10 Vehicles by Mileage" data={topMileage} />
              <ChartPanel title="Top 10 Vehicles by Consumed by FLS" data={topFuel} />
              <ChartPanel title="Top 10 Vehicles by Avg. consumption by FLS" data={topConsumption} />
            </div>
            <input
              type="text"
              placeholder="Search vehicle…"
              value={vehicleSearch}
              onChange={(e) => setVehicleSearch(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                minWidth: 220,
                marginBottom: 12,
              }}
            />
            <SimpleTable rows={summaryRows} columnOrder={summaryColumns} />
          </>
        )}
        {data && (
          <p style={{ fontSize: ".72rem", color: "var(--text3)", marginTop: 12 }}>
            {data.snapshotCount} week snapshot(s) loaded · {summaryRows.length} vehicle(s)
          </p>
        )}
      </div>
    </div>
  );
}

export function UtilizationTab() {
  const { data, loading, error, fromDate, toDate, setFromDate, setToDate, run } = useReportData("utilization");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const rows = useMemo(() => pivotRows(data?.pivot ?? {}, data?.columns ?? []), [data]);
  const topVehicles = useMemo(() => [...rows].sort((a, b) => b.total - a.total).slice(0, 10), [rows]);
  const bottomVehicles = useMemo(() => [...rows].filter((r) => r.total > 0).sort((a, b) => a.total - b.total).slice(0, 10), [rows]);
  const topDays = useMemo(
    () =>
      (data?.columns ?? [])
        .map((column) => ({
          name: column,
          value: rows.reduce((sum, row) => sum + (row.values[column] ?? 0), 0),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    [data?.columns, rows],
  );
  const totalDistance = rows.reduce((sum, row) => sum + row.total, 0);
  const activeVehicles = rows.filter((row) => row.total > 0).length;
  const highestVehicle = topVehicles[0];
  const highestDay = topDays[0];
  const filteredPivot = useMemo(() => {
    const q = vehicleSearch.trim().toLowerCase();
    const source = q ? rows.filter((row) => row.vehicle.toLowerCase().includes(q)) : rows;
    const pivot: Record<string, Record<string, number>> = {};
    for (const row of source) {
      pivot[row.vehicle] = row.values;
    }
    return pivot;
  }, [rows, vehicleSearch]);
  const exportExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Motrex Fleet Insights";
    const columns = data?.columns ?? [];
    const headers = ["Vehicle", ...columns, "Total"];
    const sheet = workbook.addWorksheet("Utilization");

    sheet.addRow(["DAILY UTILIZATION REPORT"]);
    sheet.mergeCells(1, 1, 1, headers.length);
    sheet.getCell(1, 1).font = { bold: true, size: 13 };
    sheet.getCell(1, 1).alignment = { horizontal: "center" };
    sheet.addRow([]);
    for (const band of UTILIZATION_BANDS) {
      const row = sheet.addRow(["", band.label]);
      row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: band.argb } };
      row.getCell(1).border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    }
    sheet.addRow([]);

    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCEBFA" } };
    rows.forEach((row) => {
      const worksheetRow = sheet.addRow([row.vehicle, ...columns.map((column) => row.values[column] ?? 0), row.total]);
      columns.forEach((column, index) => {
        const cell = worksheetRow.getCell(index + 2);
        const band = getUtilizationBand(row.values[column] ?? 0);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band.argb } };
      });
    });
    sheet.columns.forEach((column, index) => {
      column.width = index === 0 ? 18 : 12;
      column.alignment = index === 0 ? { horizontal: "left" } : { horizontal: "right" };
    });

    const addVehicleSheet = (name: string, vehicleRows: Array<{ vehicle: string; total: number }>) => {
      const rankingSheet = workbook.addWorksheet(name);
      rankingSheet.addRow(["Vehicle", "Total Distance"]);
      rankingSheet.getRow(1).font = { bold: true };
      vehicleRows.forEach((row) => rankingSheet.addRow([row.vehicle, Number(row.total.toFixed(1))]));
      rankingSheet.columns = [{ width: 18 }, { width: 16 }];
    };
    addVehicleSheet("Top Vehicles", topVehicles.map((row) => ({ vehicle: row.vehicle, total: row.total })));
    addVehicleSheet("Least Vehicles", bottomVehicles.map((row) => ({ vehicle: row.vehicle, total: row.total })));

    await saveExcelWorkbook(workbook, `Motrex_Utilization_${fromDate}_${toDate}.xlsx`);
  };
  const exportPdf = () => {
    const columns = data?.columns ?? [];
    exportMotrexReportPdf({
      title: "Motrex Fleet Utilization",
      subtitle: `${fromDate} to ${toDate}`,
      fileName: `Motrex_Utilization_${fromDate}_${toDate}.pdf`,
      summary: [
        { label: "Total Distance", value: totalDistance.toLocaleString(undefined, { maximumFractionDigits: 1 }), accent: "#c41e3a" },
        { label: "Active Vehicles", value: String(activeVehicles), accent: "#16a34a" },
        { label: "Avg / Vehicle", value: activeVehicles ? (totalDistance / activeVehicles).toFixed(1) : "0", accent: "#2563eb" },
        { label: "Highest Vehicle", value: highestVehicle ? `${highestVehicle.vehicle} (${highestVehicle.total.toFixed(1)})` : "—", accent: "#f59e0b" },
        { label: "Highest Day", value: highestDay ? `${highestDay.name} (${highestDay.value.toFixed(1)})` : "—", accent: "#7c3aed" },
      ],
      sections: [
        { heading: "Top 10 Vehicles", head: [["Vehicle", "Total Distance"]], body: topVehicles.map((r) => [r.vehicle, r.total.toFixed(1)]) },
        { heading: "Least 10 Vehicles", head: [["Vehicle", "Total Distance"]], body: bottomVehicles.map((r) => [r.vehicle, r.total.toFixed(1)]) },
        {
          heading: "Fleet Utilization",
          head: [["Vehicle", ...columns, "Total"]],
          body: rows.slice(0, 80).map((row) => [row.vehicle, ...columns.map((column) => row.values[column] ?? 0), row.total]),
          didParseCell: (cellData) => {
            if (cellData.section !== "body" || cellData.column.index <= 0 || cellData.column.index > columns.length) return;
            const value = parseFirstNumber(String(cellData.cell.raw ?? ""));
            const band = getUtilizationBand(value);
            cellData.cell.styles.fillColor = band.rgb;
            cellData.cell.styles.textColor = [17, 24, 39];
          },
        },
      ],
    });
  };
  return (
    <div>
      <PageHeader
        title="Fleet"
        titleAccent="Utilization"
        subtitle="Daily distance pivot from Track3 utilization report"
        right={<DateRangeBar fromDate={fromDate} toDate={toDate} setFromDate={setFromDate} setToDate={setToDate} onRun={run} loading={loading} header />}
      />
      <DatabaseLastUpdatedBar lastUpdatedAt={data?.lastUpdatedAt} />
      <MonthWeekFilter
        fromDate={fromDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
        onApply={(from, to) => run(from, to)}
        loading={loading}
      />
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {loading && !data && <p style={{ color: "var(--text2)" }}>Preparing report data…</p>}
      {data && (
        <>
          <KpiGrid
            items={[
              { label: "Total Distance", value: totalDistance.toLocaleString(undefined, { maximumFractionDigits: 1 }), color: "#c41e3a" },
              { label: "Active Vehicles", value: String(activeVehicles), color: "#16a34a" },
              { label: "Average / Vehicle", value: activeVehicles ? (totalDistance / activeVehicles).toFixed(1) : "0", color: "#2563eb" },
              { label: "Highest Vehicle", value: highestVehicle ? `${highestVehicle.vehicle} · ${highestVehicle.total.toFixed(1)}` : "—", color: "#f59e0b" },
              { label: "Highest Day", value: highestDay ? `${highestDay.name} · ${highestDay.value.toFixed(1)}` : "—", color: "#7c3aed" },
            ]}
          />
          <ExportActions onExcel={exportExcel} onPdf={exportPdf} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 16 }}>
            <ChartPanel title="Top 10 Vehicles by Total Distance" data={topVehicles.map((r) => ({ name: r.vehicle, value: Number(r.total.toFixed(1)) }))} />
            <ChartPanel title="Bottom 10 Vehicles by Total Distance" data={bottomVehicles.map((r) => ({ name: r.vehicle, value: Number(r.total.toFixed(1)) }))} />
            <ChartPanel title="Top 10 Days by Distance Covered" data={topDays.map((r) => ({ name: r.name, value: Number(r.value.toFixed(1)) }))} />
          </div>
          <UtilizationLegend />
          <input
            type="text"
            placeholder="Search vehicle…"
            value={vehicleSearch}
            onChange={(e) => setVehicleSearch(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              minWidth: 220,
              marginBottom: 12,
            }}
          />
          <PivotTable pivot={filteredPivot} columns={data.columns ?? []} colorizeDistanceCells />
          <p style={{ marginTop: 12, color: "var(--text2)", fontSize: ".8rem" }}>
            {data.snapshotCount} day snapshot(s) loaded · {data.totalRows ?? data.rows.length} row(s)
          </p>
        </>
      )}
    </div>
  );
}

export function EcoDrivingTab() {
  const { data, loading, error, fromDate, toDate, setFromDate, setToDate, run } = useReportData("eco_driving");
  const rows = useMemo(() => pivotRows(data?.pivot ?? {}, data?.columns ?? []), [data]);
  const topVehicles = useMemo(() => [...rows].sort((a, b) => b.total - a.total).slice(0, 10), [rows]);
  const bottomVehicles = useMemo(() => [...rows].filter((r) => r.total > 0).sort((a, b) => a.total - b.total).slice(0, 10), [rows]);
  const violationTypes = useMemo(
    () =>
      (data?.columns ?? [])
        .map((column) => ({
          name: column,
          value: rows.reduce((sum, row) => sum + (row.values[column] ?? 0), 0),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    [data?.columns, rows],
  );
  const totalViolations = rows.reduce((sum, row) => sum + row.total, 0);
  const activeVehicles = rows.filter((row) => row.total > 0).length;
  const topViolation = violationTypes[0];
  const highestRisk = topVehicles[0];
  const exportRows = rows.map((row) => {
    const values: Record<string, string | number> = { Vehicle: row.vehicle, Total: row.total };
    for (const column of data?.columns ?? []) values[column] = row.values[column] ?? 0;
    return values;
  });
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportRows), "Eco Driving");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(violationTypes), "Violation Types");
    XLSX.writeFile(wb, `Motrex_Eco_Driving_${fromDate}_${toDate}.xlsx`);
  };
  const exportPdf = () => {
    exportMotrexReportPdf({
      title: "Motrex Eco Driving",
      subtitle: `${fromDate} to ${toDate}`,
      fileName: `Motrex_Eco_Driving_${fromDate}_${toDate}.pdf`,
      summary: [
        { label: "Total Violations", value: totalViolations.toLocaleString(), accent: "#c41e3a" },
        { label: "Active Vehicles", value: String(activeVehicles), accent: "#16a34a" },
        { label: "Top Violation", value: topViolation ? `${topViolation.name} (${topViolation.value})` : "—", accent: "#f59e0b" },
        { label: "Avg / Vehicle", value: activeVehicles ? (totalViolations / activeVehicles).toFixed(1) : "0", accent: "#2563eb" },
        { label: "Highest Risk", value: highestRisk ? `${highestRisk.vehicle} (${highestRisk.total})` : "—", accent: "#7c3aed" },
      ],
      sections: [
        { heading: "Top 10 Vehicles", head: [["Vehicle", "Violations"]], body: topVehicles.map((r) => [r.vehicle, r.total]) },
        { heading: "Eco Driving Pivot", head: [["Vehicle", "Total", ...(data?.columns ?? [])]], body: exportRows.slice(0, 80).map((r) => Object.values(r)) },
      ],
    });
  };
  return (
    <div>
      <PageHeader
        title="Eco"
        titleAccent="Driving"
        subtitle="Violation counts by vehicle"
        right={<DateRangeBar fromDate={fromDate} toDate={toDate} setFromDate={setFromDate} setToDate={setToDate} onRun={run} loading={loading} header />}
      />
      <DatabaseLastUpdatedBar lastUpdatedAt={data?.lastUpdatedAt} />
      <MonthWeekFilter
        fromDate={fromDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
        onApply={(from, to) => run(from, to)}
        loading={loading}
      />
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {loading && !data && <p style={{ color: "var(--text2)" }}>Preparing report data…</p>}
      {data && (
        <>
          <KpiGrid
            items={[
              { label: "Total Violations", value: totalViolations.toLocaleString(), color: "#c41e3a" },
              { label: "Active Vehicles", value: String(activeVehicles), color: "#16a34a" },
              { label: "Top Violation", value: topViolation ? `${topViolation.name} · ${topViolation.value}` : "—", color: "#f59e0b" },
              { label: "Average / Vehicle", value: activeVehicles ? (totalViolations / activeVehicles).toFixed(1) : "0", color: "#2563eb" },
              { label: "Highest Risk Vehicle", value: highestRisk ? `${highestRisk.vehicle} · ${highestRisk.total}` : "—", color: "#7c3aed" },
            ]}
          />
          <ExportActions onExcel={exportExcel} onPdf={exportPdf} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 16 }}>
            <ChartPanel title="Top 10 Vehicles by Violations" data={topVehicles.map((r) => ({ name: r.vehicle, value: r.total }))} />
            <ChartPanel title="Top 10 Violation Types" data={violationTypes} />
            <ChartPanel title="Bottom 10 Vehicles by Violations" data={bottomVehicles.map((r) => ({ name: r.vehicle, value: r.total }))} />
          </div>
          <PivotTable pivot={data.pivot ?? {}} columns={data.columns ?? []} />
          <p style={{ marginTop: 12, color: "var(--text2)", fontSize: ".8rem" }}>
            {data.snapshotCount} day snapshot(s) loaded · {data.totalRows ?? data.rows.length} row(s)
          </p>
        </>
      )}
    </div>
  );
}
