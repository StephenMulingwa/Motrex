import { weekBounds } from "@/lib/dateRange";

export const DAILY_PIPELINE_STAGES = [
  "utilization",
  "eco",
  "yards",
  "trips_summary",
  "group_trips",
  "complete",
] as const;

export type DailyPipelineStage = (typeof DAILY_PIPELINE_STAGES)[number];

export interface DailyPipelineStep {
  runId: number;
  pipelineDate: string;
  stage: DailyPipelineStage;
  index: number;
  attempt: number;
}

export interface DailyPipelineWindows {
  yesterday: string;
  weekStart: string;
  weekEnd: string;
  ecoDates: string[];
  groupTripsFrom: string;
  groupTripsTo: string;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDateDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

export function pipelineWindows(pipelineDate: string): DailyPipelineWindows {
  const yesterday = addDateDays(pipelineDate, -1);
  const month = yesterday.slice(0, 7);
  const day = Number(yesterday.slice(8, 10));
  const weekNumber = Math.min(5, Math.max(1, Math.ceil(day / 7)));
  const week = weekBounds(month, String(weekNumber));
  const ecoDates: string[] = [];

  for (let date = week.from; date <= yesterday; date = addDateDays(date, 1)) {
    ecoDates.push(date);
  }

  return {
    yesterday,
    weekStart: week.from,
    weekEnd: week.to,
    ecoDates,
    groupTripsFrom: addDateDays(pipelineDate, -14),
    groupTripsTo: yesterday,
  };
}

export function isDailyPipelineStage(value: string): value is DailyPipelineStage {
  return DAILY_PIPELINE_STAGES.includes(value as DailyPipelineStage);
}

function pipelineBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");
  return "http://localhost:3000";
}

export function dailyPipelineStepUrl(step: DailyPipelineStep): string {
  const query = new URLSearchParams({
    runId: String(step.runId),
    pipelineDate: step.pipelineDate,
    stage: step.stage,
    index: String(step.index),
    attempt: String(step.attempt),
  });
  return `${pipelineBaseUrl()}/api/cron/daily-pipeline?${query.toString()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dispatch the next bounded pipeline worker. Retries transport/5xx failures;
 * each worker is idempotent through delete+upsert or conflict-upsert storage.
 */
export async function triggerDailyPipelineStep(step: DailyPipelineStep): Promise<void> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new Error("CRON_SECRET missing; cannot continue daily pipeline.");

  const url = dailyPipelineStepUrl(step);
  const retryDelays = [0, 2_000, 5_000];
  let lastError: unknown;

  for (const delay of retryDelays) {
    if (delay) await sleep(delay);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
      });
      if (response.ok) return;
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Daily pipeline worker failed (${response.status}).`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to dispatch ${step.stage} index ${step.index}.`);
}
