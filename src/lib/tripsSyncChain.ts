function syncBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");
  return "http://localhost:3000";
}

export function tripsSyncUrl(params: {
  unitIndex: number;
  intervalStart: string;
  intervalEnd: string;
}): string {
  const qs = new URLSearchParams({
    unitIndex: String(params.unitIndex),
    intervalStart: params.intervalStart,
    intervalEnd: params.intervalEnd,
  });
  return `${syncBaseUrl()}/api/trips/sync?${qs.toString()}`;
}

/** Fire-and-forget trigger for the next unit in the daily Group Trips chain. */
export function triggerNextTripsUnitSync(params: {
  unitIndex: number;
  intervalStart: string;
  intervalEnd: string;
}): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn("[trips-sync-chain] CRON_SECRET missing; cannot chain next unit.");
    return;
  }

  const url = tripsSyncUrl(params);
  fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
  }).catch((error) => {
    console.error(
      `[trips-sync-chain] failed to trigger unit ${params.unitIndex}:`,
      error instanceof Error ? error.message : error,
    );
  });
}
