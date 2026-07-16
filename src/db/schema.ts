import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const reportSnapshots = pgTable(
  "report_snapshots",
  {
    id: serial("id").primaryKey(),
    reportType: text("report_type").notNull(),
    reportDate: date("report_date").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    rawMeta: jsonb("raw_meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    reportTypeCheck: check(
      "report_snapshots_type_check",
      sql`${t.reportType} IN ('yards', 'trips', 'trips_summary', 'utilization', 'eco_driving')`,
    ),
    reportTypeDateUnique: uniqueIndex("report_snapshots_type_date_unique").on(
      t.reportType,
      t.reportDate,
    ),
  }),
);

export const cronRuns = pgTable("cron_runs", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ok: boolean("ok"),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
});

export const motrexYards = pgTable("motrex_yards", {
  id: serial("id").primaryKey(),
  reportDate: date("report_date").notNull(),
  registrationNumber: text("registration_number").notNull(),
  vehicle: text("vehicle").notNull(),
  geofence: text("geofence").notNull(),
  timeIn: text("time_in"),
  timeOut: text("time_out"),
  durationSeconds: integer("duration_seconds"),
  status: text("status").notNull().default("Inside"),
  lastExecutionTime: text("last_execution_time"),
  rawRow: jsonb("raw_row").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  reportDateRegUnique: uniqueIndex("motrex_yards_date_reg_unique").on(t.reportDate, t.registrationNumber),
}));

export const motrexTrips = pgTable("motrex_trips", {
  id: serial("id").primaryKey(),
  weekStart: date("week_start").notNull(),
  weekEnd: date("week_end").notNull(),
  tripType: text("trip_type").notNull().default("Raw"),
  routePair: text("route_pair"),
  registrationNumber: text("registration_number").notNull(),
  vehicle: text("vehicle").notNull(),
  grouping: text("grouping"),
  trip: text("trip"),
  tripFrom: text("trip_from"),
  tripTo: text("trip_to"),
  beginning: text("beginning"),
  end: text("end"),
  mileage: text("mileage"),
  consumedByAbsFcs: text("consumed_by_abs_fcs"),
  avgConsumptionByAbsFcs: text("avg_consumption_by_abs_fcs"),
  tripDuration: text("trip_duration"),
  totalTime: text("total_time"),
  parkingsDuration: text("parkings_duration"),
  avgSpeed: text("avg_speed"),
  maxSpeed: text("max_speed"),
  initialFuelLevel: text("initial_fuel_level"),
  finalFuelLevel: text("final_fuel_level"),
  count: text("count"),
  rawRow: jsonb("raw_row").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const motrexTripsSummary = pgTable(
  "motrex_trips_summary",
  {
    id: serial("id").primaryKey(),
    weekStart: date("week_start").notNull(),
    weekEnd: date("week_end").notNull(),
    registrationNumber: text("registration_number").notNull(),
    vehicle: text("vehicle").notNull(),
    mileageKm: doublePrecision("mileage_km").notNull().default(0),
    fuelConsumedL: doublePrecision("fuel_consumed_l").notNull().default(0),
    avgConsumptionKml: doublePrecision("avg_consumption_kml").notNull().default(0),
    rawRow: jsonb("raw_row").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    weekRegUnique: uniqueIndex("motrex_trips_summary_week_reg_unique").on(
      t.weekStart,
      t.weekEnd,
      t.registrationNumber,
    ),
  }),
);

export const motrexUtilization = pgTable("motrex_utilization", {
  id: serial("id").primaryKey(),
  reportDate: date("report_date").notNull(),
  registrationNumber: text("registration_number").notNull(),
  dayLabel: text("day_label").notNull(),
  mileageKm: doublePrecision("mileage_km").notNull().default(0),
  rawRow: jsonb("raw_row").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const motrexEcoDriving = pgTable("motrex_eco_driving", {
  id: serial("id").primaryKey(),
  reportDate: date("report_date").notNull(),
  registrationNumber: text("registration_number").notNull(),
  violation: text("violation").notNull(),
  count: integer("count").notNull().default(0),
  rawRow: jsonb("raw_row").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
