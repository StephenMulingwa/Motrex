export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatTimeSince(lastUpdateMs: number | null, nowMs: number): string {
  if (lastUpdateMs == null || !Number.isFinite(lastUpdateMs)) return "—";
  const diff = nowMs - lastUpdateMs;
  if (diff < 0) return "—";
  if (diff < 60_000) {
    const seconds = Math.max(0, Math.floor(diff / 1000));
    return `${seconds}s`;
  }
  return formatDuration(diff) || "—";
}
