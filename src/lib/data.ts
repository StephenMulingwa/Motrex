export type LiveMonitorStatus = "moving" | "stationary" | "unknown";
export type LiveMonitorDirection = "going" | "coming" | "inside";

export interface LiveMonitorRow {
  vehicle: string;
  currentLocation: string;
  lat: number | null;
  lon: number | null;
  lastUpdate: string;
  lastUpdateMs: number | null;
  geofence: string | null;
  direction: LiveMonitorDirection;
  speedKmh: number;
  status: string;
  statusCategory: LiveMonitorStatus;
  updatedInWindow: boolean;
}

export interface LiveMonitorKpis {
  tracked: number;
  moving: number;
  stationary: number;
  unknown: number;
}

export interface LiveMonitorDataset {
  rows: LiveMonitorRow[];
  kpis: LiveMonitorKpis;
  fetchedAt: string;
  range: { from: string; to: string };
}

export interface ReportTableRow {
  [key: string]: string | number | boolean | null;
}

export interface ReportSnapshotPayload {
  rows?: ReportTableRow[];
  pivot?: Record<string, Record<string, number>>;
  columns?: string[];
  summary?: Record<string, unknown>;
}
