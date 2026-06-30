export interface LiveMonitorRow {
  vehicle: string;
  currentLocation: string;
  lat: number | null;
  lon: number | null;
  lastUpdate: string;
  speedKmh: number;
  status: string;
  updatedInWindow: boolean;
}

export interface LiveMonitorKpis {
  tracked: number;
  notUpdatedInWindow: number;
  active: number;
  stationary: number;
  avgSpeed: number;
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
