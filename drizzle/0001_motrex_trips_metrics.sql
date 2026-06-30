ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "grouping" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "trip" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "trip_from" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "trip_to" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "beginning" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "end" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "mileage" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "consumed_by_abs_fcs" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "avg_consumption_by_abs_fcs" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "trip_duration" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "total_time" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "parkings_duration" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "avg_speed" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "max_speed" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "initial_fuel_level" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "final_fuel_level" text;--> statement-breakpoint
ALTER TABLE "motrex_trips" ADD COLUMN IF NOT EXISTS "count" text;
