CREATE TABLE "packing_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "packing_categories_id_profile_id_unique" UNIQUE("id","profile_id"),
	CONSTRAINT "packing_categories_profile_id_normalized_name_unique" UNIQUE("profile_id","normalized_name"),
	CONSTRAINT "packing_category_name" CHECK (length(trim("packing_categories"."name")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "packing_day_tags" (
	"profile_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"day" date NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "packing_day_tags_plan_id_day_tag_id_unique" UNIQUE("plan_id","day","tag_id")
);
--> statement-breakpoint
CREATE TABLE "packing_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"mode" text NOT NULL,
	"suggested" integer NOT NULL,
	"override" integer,
	"packed" integer DEFAULT 0 NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"explanation" jsonb NOT NULL,
	CONSTRAINT "packing_entries_plan_id_item_id_unique" UNIQUE("plan_id","item_id"),
	CONSTRAINT "packing_entry_counts" CHECK ("packing_entries"."suggested" between 0 and 9999 and ("packing_entries"."override" is null or "packing_entries"."override" between 0 and 9999) and "packing_entries"."packed" between 0 and 9999 and "packing_entries"."packed" <= coalesce("packing_entries"."override", "packing_entries"."suggested")),
	CONSTRAINT "packing_entry_mode" CHECK ("packing_entries"."mode" in ('CHECKBOX','QUANTITY') and ("packing_entries"."mode" <> 'CHECKBOX' or ("packing_entries"."suggested" <= 1 and coalesce("packing_entries"."override",0) <= 1 and "packing_entries"."packed" <= 1)))
);
--> statement-breakpoint
CREATE TABLE "packing_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"mode" text DEFAULT 'CHECKBOX' NOT NULL,
	"baseline" boolean DEFAULT false NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"basis" text DEFAULT 'DAYS' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "packing_items_id_profile_id_unique" UNIQUE("id","profile_id"),
	CONSTRAINT "packing_items_profile_id_category_id_normalized_name_unique" UNIQUE("profile_id","category_id","normalized_name"),
	CONSTRAINT "packing_item_rule" CHECK ("packing_items"."quantity" between 1 and 100 and "packing_items"."interval" between 1 and 365 and "packing_items"."mode" in ('CHECKBOX','QUANTITY') and "packing_items"."basis" in ('DAYS','NIGHTS')),
	CONSTRAINT "packing_item_name" CHECK (length(trim("packing_items"."name")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "packing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"fingerprint" text,
	"generated_at" timestamp with time zone,
	CONSTRAINT "packing_plans_id_profile_id_unique" UNIQUE("id","profile_id"),
	CONSTRAINT "packing_plans_profile_id_trip_id_unique" UNIQUE("profile_id","trip_id")
);
--> statement-breakpoint
CREATE TABLE "packing_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"catalog_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packing_tag_items" (
	"profile_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "packing_tag_items_profile_id_tag_id_item_id_unique" UNIQUE("profile_id","tag_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "packing_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "packing_tags_id_profile_id_unique" UNIQUE("id","profile_id"),
	CONSTRAINT "packing_tags_profile_id_normalized_name_unique" UNIQUE("profile_id","normalized_name"),
	CONSTRAINT "packing_tag_name" CHECK (length(trim("packing_tags"."name")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "packing_categories" ADD CONSTRAINT "packing_categories_profile_id_packing_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."packing_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_day_tags" ADD CONSTRAINT "packing_day_tags_plan_id_profile_id_packing_plans_id_profile_id_fk" FOREIGN KEY ("plan_id","profile_id") REFERENCES "public"."packing_plans"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_day_tags" ADD CONSTRAINT "packing_day_tags_tag_id_profile_id_packing_tags_id_profile_id_fk" FOREIGN KEY ("tag_id","profile_id") REFERENCES "public"."packing_tags"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_entries" ADD CONSTRAINT "packing_entries_profile_id_packing_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."packing_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_entries" ADD CONSTRAINT "packing_entries_plan_id_profile_id_packing_plans_id_profile_id_fk" FOREIGN KEY ("plan_id","profile_id") REFERENCES "public"."packing_plans"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_entries" ADD CONSTRAINT "packing_entries_item_id_profile_id_packing_items_id_profile_id_fk" FOREIGN KEY ("item_id","profile_id") REFERENCES "public"."packing_items"("id","profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_profile_id_packing_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."packing_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_category_id_profile_id_packing_categories_id_profile_id_fk" FOREIGN KEY ("category_id","profile_id") REFERENCES "public"."packing_categories"("id","profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_plans" ADD CONSTRAINT "packing_plans_profile_id_packing_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."packing_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_plans" ADD CONSTRAINT "packing_plans_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_tag_items" ADD CONSTRAINT "packing_tag_items_tag_id_profile_id_packing_tags_id_profile_id_fk" FOREIGN KEY ("tag_id","profile_id") REFERENCES "public"."packing_tags"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_tag_items" ADD CONSTRAINT "packing_tag_items_item_id_profile_id_packing_items_id_profile_id_fk" FOREIGN KEY ("item_id","profile_id") REFERENCES "public"."packing_items"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_tags" ADD CONSTRAINT "packing_tags_profile_id_packing_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."packing_profiles"("id") ON DELETE cascade ON UPDATE no action;