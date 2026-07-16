import { parseKenyaDateTime } from "./dateRange";

/** Parse Track3 / EAT timestamps to a sortable millisecond value (server-safe). */
export function parseDateTimeMs(value: string | null | undefined): number {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-----" || raw === "—" || raw === "-") return Number.NEGATIVE_INFINITY;

  if (/\d{4}-\d{2}-\d{2}/.test(raw)) {
    const normalized = raw.replace(/\s+EAT$/i, "").replace(" ", "T");
    const ms = parseKenyaDateTime(normalized);
    if (Number.isFinite(ms) && !Number.isNaN(ms)) return ms;
  }

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
