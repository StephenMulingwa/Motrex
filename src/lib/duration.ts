/** Parse a duration like "01:23:45", "12:34", or "2 days 03:04:05" to seconds. */
export function parseDurationSeconds(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-----" || raw === "—") return 0;
  const dayMatch = raw.match(/(\d+)\s+days?/i);
  const days = dayMatch ? Number(dayMatch[1]) : 0;
  const timeMatch = raw.match(/(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})/);
  const timePart = timeMatch ? timeMatch[1] : raw;
  const parts = timePart.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return 0;
  if (parts.length === 3) return days * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return days * 86400 + parts[0] * 60 + parts[1];
  return 0;
}

/** True when duration is 0:00:00, blank, or otherwise parses to zero seconds. */
export function isZeroDuration(value: string | number | null | undefined): boolean {
  return parseDurationSeconds(value) === 0;
}
