import { after, NextResponse } from "next/server";
import { todayEatDateString } from "@/lib/dateRange";
import {
  type DailyPipelineStage,
  type DailyPipelineStep,
  isDailyPipelineStage,
  pipelineWindows,
  triggerDailyPipelineStep,
} from "@/lib/dailyPipeline";
import {
  cronRunFinish,
  cronRunProgress,
  cronRunStart,
  ensureSchema,
  findDailyPipelineRun,
  getCronRunState,
  syncGroupTripsUnitToDb,
  syncTripsSummaryBatch,
  syncYardsInsideToDb,
  upsertReportSnapshot,
} from "@/lib/reportStore";
import { executeStoredReport, withWialonRetry } from "@/lib/wialon/reports";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const YARDS_PER_REQUEST = 3;
const GROUP_TRIPS_PER_REQUEST = 2;
const ACTIVE_HEARTBEAT_MS = 20 * 60 * 1000;
const MAX_STEP_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function scheduleStep(step: DailyPipelineStep): void {
  after(async () => {
    try {
      if (step.attempt > 0) await sleep(step.attempt * 30_000);
      await triggerDailyPipelineStep(step);
    } catch (error) {
      const current = await getCronRunState(step.runId);
      if (!current || current.finishedAt) return;
      await cronRunFinish(step.runId, false, {
        ...current.detail,
        status: "failed",
        stage: step.stage,
        index: step.index,
        error: error instanceof Error ? error.message : String(error),
        failedAt: new Date().toISOString(),
      });
    }
  });
}

function parseStep(request: Request): DailyPipelineStep {
  const url = new URL(request.url);
  const runId = Number(url.searchParams.get("runId"));
  const pipelineDate = url.searchParams.get("pipelineDate") ?? "";
  const stageValue = url.searchParams.get("stage") ?? "";
  const index = Number(url.searchParams.get("index") ?? "0");
  const attempt = Number(url.searchParams.get("attempt") ?? "0");

  if (!Number.isInteger(runId) || runId <= 0) throw new Error("runId must be a positive integer.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pipelineDate)) throw new Error("Invalid pipelineDate.");
  if (!isDailyPipelineStage(stageValue) || stageValue === "complete") {
    throw new Error("Invalid pipeline stage.");
  }
  if (!Number.isInteger(index) || index < 0) throw new Error("index must be non-negative.");
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error("attempt must be non-negative.");

  return { runId, pipelineDate, stage: stageValue, index, attempt };
}

async function moveTo(
  current: DailyPipelineStep,
  stage: DailyPipelineStage,
  index: number,
  progress: Record<string, unknown>,
): Promise<DailyPipelineStep> {
  const next: DailyPipelineStep = {
    runId: current.runId,
    pipelineDate: current.pipelineDate,
    stage,
    index,
    attempt: 0,
  };
  await cronRunProgress(current.runId, {
    status: "in_progress",
    pipelineDate: current.pipelineDate,
    stage,
    index,
    attempt: 0,
    ...progress,
  });
  return next;
}

async function processUtilization(step: DailyPipelineStep): Promise<DailyPipelineStep> {
  const windows = pipelineWindows(step.pipelineDate);
  const result = await withWialonRetry(
    `${windows.yesterday} / utilization`,
    () => executeStoredReport("utilization", windows.yesterday),
    [10_000],
  );
  await upsertReportSnapshot(result);
  return moveTo(step, "eco", 0, {
    utilizationCompletedAt: new Date().toISOString(),
    utilizationReportDate: windows.yesterday,
    utilizationRowCount:
      result.payload.rows?.length ?? Object.keys(result.payload.pivot ?? {}).length,
  });
}

async function processEco(step: DailyPipelineStep): Promise<DailyPipelineStep> {
  const windows = pipelineWindows(step.pipelineDate);
  const reportDate = windows.ecoDates[step.index];
  if (!reportDate) {
    return moveTo(step, "yards", 0, {
      ecoCompletedAt: new Date().toISOString(),
      ecoDateCount: windows.ecoDates.length,
    });
  }

  const result = await withWialonRetry(
    `${reportDate} / eco_driving`,
    () => executeStoredReport("eco_driving", reportDate),
    [10_000],
  );
  await upsertReportSnapshot(result);

  const nextIndex = step.index + 1;
  if (nextIndex < windows.ecoDates.length) {
    return moveTo(step, "eco", nextIndex, {
      ecoLastDate: reportDate,
      ecoCompletedDates: nextIndex,
      ecoDateCount: windows.ecoDates.length,
    });
  }
  return moveTo(step, "yards", 0, {
    ecoCompletedAt: new Date().toISOString(),
    ecoLastDate: reportDate,
    ecoCompletedDates: nextIndex,
    ecoDateCount: windows.ecoDates.length,
  });
}

async function processYards(step: DailyPipelineStep): Promise<DailyPipelineStep> {
  let index = step.index;
  let result = await syncYardsInsideToDb(index, {
    clearBeforeSync: index === 0,
    retryDelaysMs: [10_000],
  });
  index += 1;

  while (!result.isLast && index < step.index + YARDS_PER_REQUEST) {
    result = await syncYardsInsideToDb(index, {
      clearBeforeSync: false,
      retryDelaysMs: [10_000],
    });
    index += 1;
  }

  if (!result.isLast) {
    return moveTo(step, "yards", index, {
      yardsProcessed: index,
      yardsVehicleCount: result.vehicleCount,
      yardsRowCount: result.rowCount,
    });
  }

  return moveTo(step, "trips_summary", 0, {
    yardsCompletedAt: new Date().toISOString(),
    yardsProcessed: result.vehicleCount,
    yardsVehicleCount: result.vehicleCount,
    yardsRowCount: result.rowCount,
  });
}

async function processTripsSummary(step: DailyPipelineStep): Promise<DailyPipelineStep> {
  const windows = pipelineWindows(step.pipelineDate);
  const result = await syncTripsSummaryBatch({
    weekStart: windows.weekStart,
    weekEnd: windows.weekEnd,
    syncEnd: windows.yesterday,
    batchIndex: step.index,
    authorized: true,
  });

  if (!result.isLastBatch) {
    return moveTo(step, "trips_summary", step.index + 1, {
      tripsSummaryBatch: step.index + 1,
      tripsSummaryBatchCount: result.batchCount,
      tripsSummaryRowCount: result.rowCount,
    });
  }

  return moveTo(step, "group_trips", 0, {
    tripsSummaryCompletedAt: new Date().toISOString(),
    tripsSummaryBatch: result.batchCount,
    tripsSummaryBatchCount: result.batchCount,
    tripsSummaryRowCount: result.rowCount,
  });
}

async function processGroupTrips(step: DailyPipelineStep): Promise<DailyPipelineStep | null> {
  const windows = pipelineWindows(step.pipelineDate);
  let index = step.index;
  let result = await syncGroupTripsUnitToDb(index, {
    intervalStart: windows.groupTripsFrom,
    intervalEnd: windows.groupTripsTo,
    clearBeforeSync: index === 0,
    clearMode: "overlap",
    retryDelaysMs: [10_000],
  });
  index += 1;

  while (!result.isLast && index < step.index + GROUP_TRIPS_PER_REQUEST) {
    result = await syncGroupTripsUnitToDb(index, {
      intervalStart: windows.groupTripsFrom,
      intervalEnd: windows.groupTripsTo,
      clearBeforeSync: false,
      clearMode: "overlap",
      retryDelaysMs: [10_000],
    });
    index += 1;
  }

  if (!result.isLast) {
    return moveTo(step, "group_trips", index, {
      groupTripsProcessed: index,
      groupTripsUnitCount: result.unitCount,
      groupTripsFrom: windows.groupTripsFrom,
      groupTripsTo: windows.groupTripsTo,
    });
  }

  const current = await getCronRunState(step.runId);
  await cronRunFinish(step.runId, true, {
    ...(current?.detail ?? {}),
    status: "complete",
    stage: "complete",
    index: result.unitCount,
    groupTripsCompletedAt: new Date().toISOString(),
    groupTripsProcessed: result.unitCount,
    groupTripsUnitCount: result.unitCount,
    groupTripsFrom: windows.groupTripsFrom,
    groupTripsTo: windows.groupTripsTo,
    completedAt: new Date().toISOString(),
  });
  return null;
}

async function processStep(step: DailyPipelineStep): Promise<DailyPipelineStep | null> {
  switch (step.stage) {
    case "utilization":
      return processUtilization(step);
    case "eco":
      return processEco(step);
    case "yards":
      return processYards(step);
    case "trips_summary":
      return processTripsSummary(step);
    case "group_trips":
      return processGroupTrips(step);
    case "complete":
      return null;
  }
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureSchema();
  const pipelineDate = todayEatDateString();
  const existing = await findDailyPipelineRun(pipelineDate);

  if (existing?.ok === true) {
    return NextResponse.json({
      ok: true,
      alreadyComplete: true,
      runId: existing.id,
      pipelineDate,
    });
  }

  let runId: number;
  let stage: DailyPipelineStage = "utilization";
  let index = 0;
  let attempt = 0;
  let resumed = false;

  if (existing && !existing.finishedAt) {
    runId = existing.id;
    const savedStage = String(existing.detail.stage ?? "");
    stage = isDailyPipelineStage(savedStage) && savedStage !== "complete" ? savedStage : "utilization";
    index = Number(existing.detail.index ?? 0);
    attempt = Number(existing.detail.attempt ?? 0);
    resumed = true;
    const heartbeatMs = Date.parse(String(existing.detail.lastHeartbeatAt ?? ""));
    if (Number.isFinite(heartbeatMs) && Date.now() - heartbeatMs < ACTIVE_HEARTBEAT_MS) {
      return NextResponse.json({
        ok: true,
        alreadyRunning: true,
        runId,
        pipelineDate,
        stage,
        index,
        attempt,
      });
    }
  } else {
    runId = await cronRunStart("daily-pipeline");
    await cronRunProgress(runId, {
      status: "in_progress",
      pipelineDate,
      stage,
      index,
      attempt,
      startedAt: new Date().toISOString(),
      stageOrder: ["utilization", "eco", "yards", "trips_summary", "group_trips"],
      windows: pipelineWindows(pipelineDate),
    });
  }

  const step = { runId, pipelineDate, stage, index, attempt };
  scheduleStep(step);
  return NextResponse.json({ ok: true, resumed, ...step }, { status: 202 });
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let step: DailyPipelineStep;
  try {
    step = parseStep(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid pipeline step." },
      { status: 400 },
    );
  }

  const run = await getCronRunState(step.runId);
  if (!run) return NextResponse.json({ error: "Pipeline run not found." }, { status: 404 });
  if (run.finishedAt) {
    return NextResponse.json({ ok: true, skipped: true, reason: "run_finished" });
  }
  if (String(run.detail.pipelineDate ?? "") !== step.pipelineDate) {
    return NextResponse.json({ error: "Pipeline date does not match run." }, { status: 409 });
  }

  const expectedStage = String(run.detail.stage ?? "");
  const expectedIndex = Number(run.detail.index ?? 0);
  const expectedAttempt = Number(run.detail.attempt ?? 0);
  if (
    expectedStage !== step.stage ||
    expectedIndex !== step.index ||
    expectedAttempt !== step.attempt
  ) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "stale_step",
      expectedStage,
      expectedIndex,
      expectedAttempt,
    });
  }

  try {
    const next = await processStep(step);
    if (next) scheduleStep(next);
    return NextResponse.json({
      ok: true,
      completedStage: step.stage,
      completedIndex: step.index,
      next,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (step.attempt + 1 < MAX_STEP_ATTEMPTS) {
      const retryStep = { ...step, attempt: step.attempt + 1 };
      await cronRunProgress(step.runId, {
        status: "retrying",
        stage: step.stage,
        index: step.index,
        attempt: retryStep.attempt,
        lastError: message,
        nextRetryAt: new Date(Date.now() + retryStep.attempt * 30_000).toISOString(),
      });
      scheduleStep(retryStep);
      return NextResponse.json(
        { ok: true, retrying: true, error: message, next: retryStep },
        { status: 202 },
      );
    }
    const current = await getCronRunState(step.runId);
    await cronRunFinish(step.runId, false, {
      ...(current?.detail ?? {}),
      status: "failed",
      stage: step.stage,
      index: step.index,
      error: message,
      failedAt: new Date().toISOString(),
    });
    console.error(`[daily-pipeline] ${step.stage} index ${step.index}:`, message);
    return NextResponse.json({ ok: false, error: message, ...step }, { status: 500 });
  }
}
