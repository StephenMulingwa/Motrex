function syncBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");
  return "http://localhost:3000";
}

export function yardsSyncUrl(vehicleIndex: number): string {
  return `${syncBaseUrl()}/api/yards/sync?vehicleIndex=${vehicleIndex}`;
}

/** Fire-and-forget trigger for the next vehicle in the daily chain. */
export function triggerNextVehicleSync(vehicleIndex: number): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn("[yards-sync-chain] CRON_SECRET missing; cannot chain next vehicle.");
    return;
  }

  const url = yardsSyncUrl(vehicleIndex);
  fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
  }).catch((error) => {
    console.error(
      `[yards-sync-chain] failed to trigger vehicle ${vehicleIndex}:`,
      error instanceof Error ? error.message : error,
    );
  });
}

/** @deprecated Use triggerNextVehicleSync. */
export const triggerNextBatchSync = triggerNextVehicleSync;

/** @deprecated Use yardsSyncUrl. */
export function yardsSyncUrlBatch(batchIndex: number): string {
  return yardsSyncUrl(batchIndex);
}
