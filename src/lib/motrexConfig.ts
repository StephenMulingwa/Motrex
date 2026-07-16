import {
  enumerateDates,
  todayEatDateString,
  yesterdayEatDateString,
} from "./dateRange";

export const MOTREX_GROUP_ID = 26659458;
export const MOTREX_RESOURCE_ID = 26054231;
export const UTILIZATION_RESOURCE_ID = 25960707;
export const ECO_RESOURCE_ID = 17082202;

export const TEMPLATES = {
  onlineStatus: 55,
  yards: 56,
  geofenceVisits: 58,
  /** @deprecated Use groupTrips (template 62). */
  athiTororoTrips: 62,
  groupTrips: 62,
  tripsSummary: 61,
} as const;

export const STORED_REPORT_TYPES = ["yards", "trips", "trips_summary", "utilization", "eco_driving"] as const;
export type StoredReportType = (typeof STORED_REPORT_TYPES)[number];

export const REPORT_LABELS: Record<StoredReportType, string> = {
  yards: "SM_Motrex_Yards",
  trips: "SM_Motrex - Group Trips",
  trips_summary: "SM_New_Motrex_Summary",
  utilization: "Utilization",
  eco_driving: "Eco Driving",
};

export const TRIPS_SUMMARY_BATCH_SIZE = 25;
export const TRIPS_SUMMARY_FALLBACK_BATCH_SIZE = 15;
/** Smaller batches — template 62 has 6 geofence-ride tables and needs remoteExec. */
export const GROUP_TRIPS_BATCH_SIZE = 25;
export const GROUP_TRIPS_FALLBACK_BATCH_SIZE = 10;

/** Inline Wialon template for daily utilization (from Track3 Large fleet.ipynb). */
export const UTILIZATION_INLINE_TEMPLATE = {
  id: 9,
  n: "Test Trip Report",
  ct: "avl_unit_group",
  p: '{"descr":"","bind":{"avl_unit_group":[]}}',
  tbl: [
    {
      n: "unit_group_stats",
      l: "Statistics",
      c: "",
      cl: "",
      cp: "",
      s: '["address_format","time_format","us_units","deviation"]',
      sl: '["Address","Time Format","Measure","Deviation"]',
      filter_order: [],
      p: '{"address_format":"960495616_10_5","time_format":"%E.%m.%Y_%H:%M:%S","us_units":0,"deviation":"30"}',
      sch: { f1: 0, f2: 0, t1: 0, t2: 0, m: 0, y: 0, w: 0, fl: 0 },
      f: 0,
    },
    {
      n: "unit_group_trips",
      l: "Trips",
      c: '["time_begin","mileage"]',
      cl: '["Beginning","Mileage"]',
      cp: "[{},{}]",
      s: "",
      sl: "",
      filter_order: [
        "duration",
        "mileage",
        "base_eh_sensor",
        "engine_hours",
        "speed",
        "stops",
        "sensors",
        "sensor_name",
        "custom_sensors_col",
        "driver",
        "trailer",
        "geozones_ex",
      ],
      p: "",
      sch: { f1: 0, f2: 0, t1: 0, t2: 0, m: 0, y: 0, w: 0, fl: 0 },
      f: 0,
    },
  ],
  bsfl: { ct: 1663589579, mt: 1724130701 },
};

/** Inline eco-driving template (from Track3 Large fleet.ipynb). */
export const ECO_INLINE_TEMPLATE = {
  id: 152,
  n: "Mawa Scoring Fleet Report",
  ct: "avl_unit_group",
  p: '{"descr":"","bind":{"avl_unit_group":[]}}',
  tbl: [
    {
      n: "unit_group_stats",
      l: "Statistics",
      c: "",
      cl: "",
      cp: "",
      s: '["address_format","time_format","us_units","deviation"]',
      sl: '["Address","Time Format","Measure","Deviation"]',
      filter_order: [],
      p: '{"address_format":"1255211008_10_5","time_format":"%Y-%m-%E_%H:%M:%S","us_units":0,"deviation":"30"}',
      sch: { f1: 0, f2: 0, t1: 0, t2: 0, m: 0, y: 0, w: 0, fl: 0 },
      f: 0,
    },
    {
      n: "unit_group_ecodriving",
      l: "Eco driving",
      c: '["mileage","violation_name","violations_count","violation_duration","violation_mileage"]',
      cl: '["Mileage","Violation","Count","Violation duration","Violation mileage"]',
      cp: "[{},{},{},{},{}]",
      s: "",
      sl: "",
      filter_order: [
        "violation_group_name",
        "violation_duration",
        "show_all_trips",
        "mileage",
        "colors",
        "custom_sensors_col",
        "geozones_ex",
      ],
      p: '{"violation_group_name":"*"}',
      sch: { f1: 0, f2: 0, t1: 0, t2: 0, m: 0, y: 0, w: 0, fl: 0 },
      f: 256,
    },
  ],
  bsfl: { ct: 1724150506, mt: 1724150636 },
};

export const BACKFILL_START = "2026-06-01";
export const YARDS_BACKFILL_START = "2026-06-22";
export const TRIPS_BACKFILL_START = "2026-06-22";
export const TRIPS_HISTORICAL_START = "2026-06-01";
export const TRIPS_HISTORICAL_END = "2026-07-15";

/** Date ranges for initial backfill per report type. */
export function getBackfillDatesForType(reportType: StoredReportType): string[] {
  switch (reportType) {
    case "yards":
      return enumerateDates(YARDS_BACKFILL_START, todayEatDateString());
    case "trips":
      return enumerateDates(TRIPS_BACKFILL_START, todayEatDateString());
    case "utilization":
    case "eco_driving":
      return enumerateDates(BACKFILL_START, yesterdayEatDateString());
    default:
      return enumerateDates(BACKFILL_START, yesterdayEatDateString());
  }
}
