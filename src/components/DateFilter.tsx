"use client";

import { useMediaQuery } from "../lib/useMediaQuery";
import { LAYOUT_NARROW_QUERY } from "../lib/breakpoints";

interface DateFilterProps {
  startDate: string;
  endDate: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  onRun?: () => void;
  runLabel?: string;
  running?: boolean;
}

export default function DateFilter({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  onRun,
  runLabel = "Run",
  running = false,
}: DateFilterProps) {
  const compact = useMediaQuery(LAYOUT_NARROW_QUERY);

  const inputStyle: React.CSSProperties = {
    padding: compact ? "3px 5px" : "8px 12px",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text)",
    fontSize: compact ? ".65rem" : ".78rem",
    fontFamily: "var(--font-mono)",
    outline: "none",
    transition: "var(--transition)",
    colorScheme: "light",
    minHeight: compact ? 32 : undefined,
    maxHeight: compact ? 34 : undefined,
    lineHeight: compact ? 1.15 : undefined,
    boxSizing: "border-box",
    width: compact ? "100%" : undefined,
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: compact ? 0 : "160px",
  };

  const pairStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: compact ? 3 : 6,
    minWidth: 0,
    flexGrow: compact ? 1 : 0,
    flexShrink: 1,
    flexBasis: compact ? 0 : "auto",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: compact ? ".6rem" : ".72rem",
    color: "var(--text)",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: compact ? ".04em" : ".06em",
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
  };

  return (
    <div
      className="date-filter-row"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: compact ? "flex-start" : "flex-end",
        gap: compact ? 5 : 10,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        flexWrap: compact ? "nowrap" : "wrap",
        overflowX: compact ? "auto" : undefined,
        WebkitOverflowScrolling: compact ? "touch" : undefined,
      }}
    >
      <div className="date-filter-pair" style={pairStyle}>
        <span className="date-filter-label" style={labelStyle}>
          From
        </span>
        <input
          type="datetime-local"
          value={startDate}
          onChange={(e) => onStartChange(e.target.value)}
          className="date-filter-input"
          style={inputStyle}
        />
      </div>
      <div className="date-filter-pair" style={pairStyle}>
        <span className="date-filter-label" style={labelStyle}>
          To
        </span>
        <input
          type="datetime-local"
          value={endDate}
          onChange={(e) => onEndChange(e.target.value)}
          className="date-filter-input"
          style={inputStyle}
        />
      </div>

      {onRun && (
        <button
          type="button"
          onClick={onRun}
          style={{
            padding: compact ? "5px 10px" : "8px 16px",
            background: "linear-gradient(90deg, rgba(245,179,0,0.95), rgba(255,212,81,0.95))",
            border: "1px solid rgba(245,179,0,0.5)",
            borderRadius: "var(--radius-sm)",
            color: "#4a3200",
            fontWeight: 800,
            fontFamily: "var(--font-head)",
            fontSize: compact ? ".68rem" : ".78rem",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: "auto",
            whiteSpace: "nowrap",
            cursor: running ? "wait" : "pointer",
            letterSpacing: ".02em",
            boxShadow: "0 6px 16px rgba(245,179,0,0.22)",
            opacity: running ? 0.7 : 1,
          }}
        >
          {running ? "Running..." : runLabel}
        </button>
      )}
    </div>
  );
}
