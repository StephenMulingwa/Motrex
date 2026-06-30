CREATE TABLE "fleet_ai_message" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	CONSTRAINT "fleet_ai_message_role_check" CHECK ("fleet_ai_message"."role" IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "fleet_ai_meta" (
	"id" integer PRIMARY KEY NOT NULL,
	"active_session_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fleet_ai_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fleet_ai_message" ADD CONSTRAINT "fleet_ai_message_session_id_fleet_ai_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."fleet_ai_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_ai_meta" ADD CONSTRAINT "fleet_ai_meta_active_session_id_fleet_ai_session_id_fk" FOREIGN KEY ("active_session_id") REFERENCES "public"."fleet_ai_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "fleet_ai_meta" ("id", "active_session_id") VALUES (1, NULL) ON CONFLICT ("id") DO NOTHING;