"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc";

export type SortState<K extends string = string> = {
  key: K;
  dir: SortDirection;
} | null;

/**
 * Sort state hook for clickable table headers.
 * Click an unsorted column → ascending. Click again → descending. Click again → ascending.
 * Clicking a different column resets direction to ascending.
 */
export function useTableSort<K extends string>(initial: SortState<K> = null) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const toggleSort = (key: K) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, dir: "asc" };
      return { key, dir: current.dir === "asc" ? "desc" : "asc" };
    });
  };
  return { sort, setSort, toggleSort };
}

/** Stable sort. Returns a new array — does not mutate input. */
export function sortRowsBy<T, K extends string>(
  rows: readonly T[],
  sort: SortState<K>,
  keyExtractor: (row: T, key: K) => number | string | null | undefined,
): T[] {
  if (!sort) return rows.slice();
  const dirMul = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, idx) => ({ row, idx, value: keyExtractor(row, sort.key) }))
    .sort((a, b) => {
      const cmp = compareSortable(a.value, b.value) * dirMul;
      return cmp !== 0 ? cmp : a.idx - b.idx;
    })
    .map(({ row }) => row);
}

function compareSortable(a: unknown, b: unknown): number {
  const aMissing = a === null || a === undefined || a === "";
  const bMissing = b === null || b === undefined || b === "";
  if (aMissing && bMissing) return 0;
  // Missing values always sort to the bottom regardless of direction.
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    if (Number.isNaN(a)) return 1;
    if (Number.isNaN(b)) return -1;
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/** Parse a duration like "01:23:45", "12:34", or "2 days 03:04:05" to seconds. */
export { parseDurationSeconds } from "./duration";

/** Parse a Track3 timestamp like "12.05.2026 09:20:26" to a sortable millisecond value. */
export function parseDateTimeMs(value: string | null | undefined): number {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-----" || raw === "—") return Number.NEGATIVE_INFINITY;
  const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return Number.NEGATIVE_INFINITY;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const hh = Number(m[4] ?? 0);
  const mi = Number(m[5] ?? 0);
  const ss = Number(m[6] ?? 0);
  const ms = new Date(yyyy, mm - 1, dd, hh, mi, ss).getTime();
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/** Extract the first numeric value from a cell (handles "1.60 km", "81 km/h", "1,200", etc.). */
export function parseFirstNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  const m = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

interface SortIconProps {
  dir: SortDirection | null;
  color: string;
}

function SortIcon({ dir, color }: SortIconProps) {
  if (dir === "asc") {
    return <ChevronUp size={12} color={color} strokeWidth={2.6} aria-hidden />;
  }
  if (dir === "desc") {
    return <ChevronDown size={12} color={color} strokeWidth={2.6} aria-hidden />;
  }
  return <ChevronsUpDown size={12} color={color} strokeWidth={2.2} aria-hidden />;
}

interface SortHeaderProps<K extends string> {
  /** Column key — must match a key understood by your sortRowsBy extractor. */
  sortKey: K;
  /** Header text or node. */
  label: ReactNode;
  sort: SortState<K>;
  onToggle: (key: K) => void;
  align?: "left" | "right" | "center";
  /** Base `th` style (typography, padding, etc.). */
  thStyle?: CSSProperties;
  /** Optional override styles. */
  style?: CSSProperties;
  /** Optional tooltip override. */
  title?: string;
}

/**
 * A clickable `<th>` that toggles ascending/descending sort on its column.
 * Renders a small chevron icon (faded when inactive) so users can see which
 * column is currently sorted and in which direction.
 */
export function SortHeader<K extends string>({
  sortKey,
  label,
  sort,
  onToggle,
  align = "left",
  thStyle,
  style,
  title,
}: SortHeaderProps<K>) {
  const isActive = sort?.key === sortKey;
  const dir = isActive ? (sort?.dir ?? null) : null;
  const iconColor = isActive ? "var(--blue)" : "#9aa7c2";
  const ariaSort = isActive ? (dir === "asc" ? "ascending" : "descending") : "none";
  const labelText = typeof label === "string" ? label : undefined;

  return (
    <th
      onClick={() => onToggle(sortKey)}
      aria-sort={ariaSort}
      title={title ?? (labelText ? `Sort by ${labelText}` : "Sort column")}
      style={{
        cursor: "pointer",
        userSelect: "none",
        ...thStyle,
        textAlign: align,
        ...style,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          justifyContent:
            align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
          width: "100%",
        }}
      >
        {align === "right" && <SortIcon dir={dir} color={iconColor} />}
        <span>{label}</span>
        {align !== "right" && <SortIcon dir={dir} color={iconColor} />}
      </span>
    </th>
  );
}
