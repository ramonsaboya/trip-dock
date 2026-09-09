ALTER TABLE "transport_legs" ALTER COLUMN "from_stop_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transport_legs" ALTER COLUMN "to_stop_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transport_legs" ADD COLUMN "from_location" text;--> statement-breakpoint
ALTER TABLE "transport_legs" ADD COLUMN "to_location" text;--> statement-breakpoint
ALTER TABLE "transport_legs" ADD CONSTRAINT "transport_legs_endpoints_check" CHECK (
      (("transport_legs"."from_stop_id" is not null and "transport_legs"."from_location" is null) or
       ("transport_legs"."from_stop_id" is null and length(trim("transport_legs"."from_location")) > 0 and "transport_legs"."from_location" is not null)) and
      (("transport_legs"."to_stop_id" is not null and "transport_legs"."to_location" is null) or
       ("transport_legs"."to_stop_id" is null and length(trim("transport_legs"."to_location")) > 0 and "transport_legs"."to_location" is not null)) and
      ("transport_legs"."from_stop_id" is not null or "transport_legs"."to_stop_id" is not null)
    );