function syncBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");
  return "http://localhost:3000";
}

export function tripsSummarySyncUrl(params: {
  weekStart: string;
  weekEnd: string;
  batchIndex: number;
  from?: string;
  to?: string;
  weekIndex?: number;
  syncEnd?: string;
}): string {
  const qs = new URLSearchParams({
    weekStart: params.weekStart,
    weekEnd: params.weekEnd,
    batchIndex: String(params.batchIndex),
  });
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.weekIndex != null) qs.set("weekIndex", String(params.weekIndex));
  if (params.syncEnd) qs.set("syncEnd", params.syncEnd);
  return `${syncBaseUrl()}/api/trips-summary/sync?${qs.toString()}`;
}

/** Fire-and-forget trigger for the next batch or week in the chain. */
export function triggerNextTripsSummarySync(params: {
  weekStart: string;
  weekEnd: string;
  batchIndex: number;
  from?: string;
  to?: string;
  weekIndex?: number;
  syncEnd?: string;
}): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn("[trips-summary-sync-chain] CRON_SECRET missing; cannot chain next batch.");
    return;
  }

  const url = tripsSummarySyncUrl(params);
  fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
  }).catch((error) => {
    console.error(
      `[trips-summary-sync-chain] failed to trigger batch ${params.batchIndex} week ${params.weekStart}:`,
      error instanceof Error ? error.message : error,
    );
  });
}
