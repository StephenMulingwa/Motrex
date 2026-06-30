export interface DateRange {
  start: string;
  end: string;
}

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

function eatNowDate(): Date {
  const now = new Date();
  return new Date(now.getTime() + EAT_OFFSET_MS);
}

function formatEatDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Default report range: June 1 of current year through yesterday (EAT). */
export function getDefaultReportRange(): DateRange {
  const eatNow = eatNowDate();
  const yesterday = new Date(eatNow);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const start = new Date(Date.UTC(eatNow.getUTCFullYear(), 5, 1, 0, 0, 0));
  return {
    start: toInputDateTimeFromUtc(start),
    end: toInputDateTimeFromUtc(yesterday),
  };
}

function toInputDateTimeFromUtc(d: Date) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/** Live Monitor default: last 1 hour in EAT. */
export function getLiveMonitorRange(): DateRange {
  const eatNow = eatNowDate();
  const oneHourAgo = new Date(eatNow.getTime() - 60 * 60 * 1000);
  return {
    start: toInputDateTimeFromUtc(oneHourAgo),
    end: toInputDateTimeFromUtc(eatNow),
  };
}

export function parseKenyaDateTime(input: string): number {
  const raw = String(input ?? "").trim();
  if (!raw) return NaN;
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw)) {
    return new Date(raw).getTime();
  }
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? `${raw}:00` : raw;
  return new Date(`${withSeconds}+03:00`).getTime();
}

export function formatEatNow(): string {
  const eat = eatNowDate();
  return eat.toISOString().replace("T", " ").slice(0, 19) + " EAT";
}

export function formatEatDateTime(value: Date | string | number): string {
  if (typeof value === "string" && /\bEAT\b/.test(value)) return value;
  const base = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(base.getTime())) return String(value ?? "");
  const eat = new Date(base.getTime() + EAT_OFFSET_MS);
  return eat.toISOString().replace("T", " ").slice(0, 19) + " EAT";
}

export function todayEatDateString(): string {
  return formatEatDate(eatNowDate());
}

export function yesterdayEatDateString(): string {
  const eat = eatNowDate();
  eat.setUTCDate(eat.getUTCDate() - 1);
  return formatEatDate(eat);
}

export function sevenDaysAgoEatDateString(): string {
  const eat = eatNowDate();
  eat.setUTCDate(eat.getUTCDate() - 7);
  return formatEatDate(eat);
}

export function fourteenDaysAgoEatDateString(): string {
  const eat = eatNowDate();
  eat.setUTCDate(eat.getUTCDate() - 14);
  return formatEatDate(eat);
}

export function getYardsDefaultRange(): { from: string; to: string } {
  return {
    from: "2026-06-22",
    to: todayEatDateString(),
  };
}

export function getTripsDefaultRange(): { from: string; to: string } {
  return {
    from: "2026-06-15",
    to: "2026-06-30",
  };
}

export function getUtilizationDefaultRange(): { from: string; to: string } {
  const eatNow = eatNowDate();
  const start = `${eatNow.getUTCFullYear()}-06-01`;
  return { from: start, to: yesterdayEatDateString() };
}

export function getEcoDefaultRange(): { from: string; to: string } {
  return getUtilizationDefaultRange();
}

export function getRollingWeekRange(): { from: string; to: string } {
  return {
    from: sevenDaysAgoEatDateString(),
    to: todayEatDateString(),
  };
}

export function dayBoundsUnix(dateStr: string): { from: number; to: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const from = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00+03:00`).getTime();
  const to = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T23:59:59+03:00`).getTime();
  return { from: Math.floor(from / 1000), to: Math.floor(to / 1000) };
}

export function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00+03:00`);
  const end = new Date(`${to}T00:00:00+03:00`);
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
