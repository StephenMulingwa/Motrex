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

export function thirtyDaysAgoEatDateString(): string {
  const eat = eatNowDate();
  eat.setUTCDate(eat.getUTCDate() - 30);
  return formatEatDate(eat);
}

/** Yards live report: rolling last 30 days in EAT through now. */
export function getYardsLiveRange(): { from: string; to: string } {
  return {
    from: thirtyDaysAgoEatDateString(),
    to: todayEatDateString(),
  };
}

export function getYardsLiveUnixBounds(): { from: number; to: number } {
  const range = getYardsLiveRange();
  const fromBounds = dayBoundsUnix(range.from);
  return {
    from: fromBounds.from,
    to: Math.floor(Date.now() / 1000),
  };
}

export function getYardsDefaultRange(): { from: string; to: string } {
  return {
    from: "2026-06-22",
    to: todayEatDateString(),
  };
}

export function getTripsDefaultRange(): { from: string; to: string } {
  return getCurrentMonthEatRange();
}

export function getUtilizationDefaultRange(): { from: string; to: string } {
  return getCurrentMonthEatRange();
}

/** First day of current month (EAT) through yesterday, or today on the 1st. */
export function getCurrentMonthEatRange(): { from: string; to: string } {
  const eatNow = eatNowDate();
  const year = eatNow.getUTCFullYear();
  const month = String(eatNow.getUTCMonth() + 1).padStart(2, "0");
  const from = `${year}-${month}-01`;
  const yesterday = yesterdayEatDateString();
  if (yesterday < from) {
    return { from, to: todayEatDateString() };
  }
  return { from, to: yesterday };
}

export function currentEatMonthString(): string {
  const eatNow = eatNowDate();
  return `${eatNow.getUTCFullYear()}-${String(eatNow.getUTCMonth() + 1).padStart(2, "0")}`;
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

export function monthBounds(month: string): { from: string; to: string } {
  const [year, monthIndex] = month.split("-").map(Number);
  const lastDay = new Date(year, monthIndex, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

export function weekBounds(month: string, week: string): { from: string; to: string } {
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

export function getTripsSummaryDefaultRange(): { from: string; to: string } {
  return getCurrentMonthEatRange();
}

export function weekOverlapsRange(
  weekStart: string,
  weekEnd: string,
  from: string,
  to: string,
): boolean {
  return weekStart <= to && weekEnd >= from;
}

/** Calendar weeks (Week 1–5) within a date range, using the same month-week grid as the UI. */
export function enumerateWeeksInRange(from: string, to: string): Array<{ from: string; to: string }> {
  const startMonth = from.slice(0, 7);
  const endMonth = to.slice(0, 7);
  const months: string[] = [];
  let [y, m] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  const weeks: Array<{ from: string; to: string }> = [];
  for (const month of months) {
    for (let w = 1; w <= 5; w += 1) {
      const bounds = weekBounds(month, String(w));
      if (bounds.from > to || bounds.to < from) continue;
      weeks.push({
        from: bounds.from < from ? from : bounds.from,
        to: bounds.to > to ? to : bounds.to,
      });
    }
  }

  const seen = new Set<string>();
  return weeks.filter((w) => {
    const key = `${w.from}:${w.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Current UI calendar week (Week 1–5) clipped through yesterday (EAT). */
export function currentWeekEatRangeThroughYesterday(): { from: string; to: string } {
  const { weekStart, syncEnd } = currentCalendarWeekSyncBounds();
  return { from: weekStart, to: syncEnd };
}

/**
 * Calendar week bounds for DB keys (full Week 1–5 grid) plus syncEnd (yesterday, capped in week).
 * Wialon fetches weekStart→syncEnd; DB stores under weekStart→weekEnd (full calendar week).
 */
export function currentCalendarWeekSyncBounds(): {
  weekStart: string;
  weekEnd: string;
  syncEnd: string;
} {
  const syncEnd = yesterdayEatDateString();
  const month = syncEnd.slice(0, 7);
  const day = Number(syncEnd.slice(8, 10));
  const weekNum = Math.min(5, Math.max(1, Math.ceil(day / 7)));
  const bounds = weekBounds(month, String(weekNum));
  return {
    weekStart: bounds.from,
    weekEnd: bounds.to,
    syncEnd: bounds.to > syncEnd ? syncEnd : bounds.to,
  };
}

/** Rolling Group Trips cron window: last 14 days through yesterday (EAT). */
export function rollingTripsSyncRange(): { from: string; to: string } {
  return {
    from: fourteenDaysAgoEatDateString(),
    to: yesterdayEatDateString(),
  };
}

/** Previous calendar week (Mon–Sun style grid: last 7-day block ending yesterday). */
export function previousWeekEatRange(): { from: string; to: string } {
  const end = yesterdayEatDateString();
  const eat = eatNowDate();
  eat.setUTCDate(eat.getUTCDate() - 7);
  const from = formatEatDate(eat);
  return { from, to: end };
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
