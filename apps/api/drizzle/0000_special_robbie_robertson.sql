CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'IDEA' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_stop_position_unique" UNIQUE("stop_id","position"),
	CONSTRAINT "activities_position_check" CHECK ("activities"."position" >= 0),
	CONSTRAINT "activities_status_check" CHECK ("activities"."status" in ('IDEA', 'PLANNED', 'BOOKED', 'DONE'))
);
--> statement-breakpoint
CREATE TABLE "ai_proposal_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"operation_type" text NOT NULL,
	"description" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_proposal_operations_position_unique" UNIQUE("proposal_id","position"),
	CONSTRAINT "ai_proposal_operations_position_check" CHECK ("ai_proposal_operations"."position" >= 0),
	CONSTRAINT "ai_proposal_operations_status_check" CHECK ("ai_proposal_operations"."status" in ('PENDING', 'APPLIED', 'EXCLUDED'))
);
--> statement-breakpoint
CREATE TABLE "ai_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"base_trip_revision" integer NOT NULL,
	"model" text NOT NULL,
	"openai_response_id" text,
	"schema_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"applied_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_proposals_status_check" CHECK ("ai_proposals"."status" in ('PENDING', 'APPLIED', 'DISCARDED', 'STALE'))
);
--> statement-breakpoint
CREATE TABLE "stays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"check_in" timestamp with time zone,
	"check_out" timestamp with time zone,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stays_stop_position_unique" UNIQUE("stop_id","position"),
	CONSTRAINT "stays_position_check" CHECK ("stays"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transport_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"from_stop_id" uuid NOT NULL,
	"to_stop_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"mode" text NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"departure_time" timestamp with time zone,
	"arrival_time" timestamp with time zone,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_legs_trip_position_unique" UNIQUE("trip_id","position"),
	CONSTRAINT "transport_legs_position_check" CHECK ("transport_legs"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trip_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"name" text NOT NULL,
	"location_text" text,
	"position" integer NOT NULL,
	"arrival_date" date,
	"departure_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_stops_id_trip_id_unique" UNIQUE("id","trip_id"),
	CONSTRAINT "trip_stops_trip_position_unique" UNIQUE("trip_id","position"),
	CONSTRAINT "trip_stops_position_check" CHECK ("trip_stops"."position" >= 0),
	CONSTRAINT "trip_stops_date_range_check" CHECK ("trip_stops"."arrival_date" is null or "trip_stops"."departure_date" is null or "trip_stops"."departure_date" >= "trip_stops"."arrival_date")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"destination_area" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"traveler_count" integer NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_date_range_check" CHECK ("trips"."end_date" >= "trips"."start_date"),
	CONSTRAINT "trips_traveler_count_check" CHECK ("trips"."traveler_count" >= 1 and "trips"."traveler_count" <= 20),
	CONSTRAINT "trips_revision_check" CHECK ("trips"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_stop_trip_fk" FOREIGN KEY ("stop_id","trip_id") REFERENCES "public"."trip_stops"("id","trip_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposal_operations" ADD CONSTRAINT "ai_proposal_operations_proposal_id_ai_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."ai_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_stop_trip_fk" FOREIGN KEY ("stop_id","trip_id") REFERENCES "public"."trip_stops"("id","trip_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_legs" ADD CONSTRAINT "transport_legs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_legs" ADD CONSTRAINT "transport_legs_from_stop_trip_fk" FOREIGN KEY ("from_stop_id","trip_id") REFERENCES "public"."trip_stops"("id","trip_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_legs" ADD CONSTRAINT "transport_legs_to_stop_trip_fk" FOREIGN KEY ("to_stop_id","trip_id") REFERENCES "public"."trip_stops"("id","trip_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_trip_stop_position_idx" ON "activities" USING btree ("trip_id","stop_id","position");--> statement-breakpoint
CREATE INDEX "ai_proposal_operations_order_idx" ON "ai_proposal_operations" USING btree ("proposal_id","position");--> statement-breakpoint
CREATE INDEX "ai_proposals_trip_created_idx" ON "ai_proposals" USING btree ("trip_id","created_at");--> statement-breakpoint
CREATE INDEX "stays_trip_stop_position_idx" ON "stays" USING btree ("trip_id","stop_id","position");--> statement-breakpoint
CREATE INDEX "transport_legs_trip_position_idx" ON "transport_legs" USING btree ("trip_id","position");--> statement-breakpoint
CREATE INDEX "trip_stops_trip_position_idx" ON "trip_stops" USING btree ("trip_id","position");