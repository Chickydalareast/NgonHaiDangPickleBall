CREATE TYPE "public"."activity_actor_type" AS ENUM('SYSTEM', 'ADMIN', 'CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('ADMIN');--> statement-breakpoint
CREATE TYPE "public"."admin_user_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('OPEN', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."catalog_record_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."order_line_status" AS ENUM('ACTIVE', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'ACCEPTED', 'SERVED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."service_point_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."service_request_status" AS ENUM('PENDING', 'RESOLVED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."venue_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"venue_id" uuid,
	"actor_type" "activity_actor_type" NOT NULL,
	"actor_admin_user_id" uuid,
	"action" varchar(120) NOT NULL,
	"entity_type" varchar(80),
	"entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"role" "admin_role" DEFAULT 'ADMIN' NOT NULL,
	"status" "admin_user_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email"),
	CONSTRAINT "admin_users_email_lowercase_check" CHECK ("admin_users"."email" = lower("admin_users"."email"))
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"venue_id" uuid NOT NULL,
	"service_point_id" uuid NOT NULL,
	"status" "bill_status" DEFAULT 'OPEN' NOT NULL,
	"subtotal_vnd" integer DEFAULT 0 NOT NULL,
	"total_vnd" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_subtotal_nonnegative_check" CHECK ("bills"."subtotal_vnd" >= 0),
	CONSTRAINT "bills_total_nonnegative_check" CHECK ("bills"."total_vnd" >= 0),
	CONSTRAINT "bills_total_not_below_subtotal_check" CHECK ("bills"."total_vnd" >= "bills"."subtotal_vnd"),
	CONSTRAINT "bills_terminal_timestamp_consistency_check" CHECK (("bills"."status" = 'COMPLETED' AND "bills"."completed_at" IS NOT NULL AND "bills"."cancelled_at" IS NULL) OR ("bills"."status" = 'CANCELLED' AND "bills"."cancelled_at" IS NOT NULL AND "bills"."completed_at" IS NULL) OR ("bills"."status" = 'OPEN' AND "bills"."completed_at" IS NULL AND "bills"."cancelled_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "catalog_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"venue_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"description" text,
	"status" "catalog_record_status" DEFAULT 'ACTIVE' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_categories_sort_order_nonnegative_check" CHECK ("catalog_categories"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"venue_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(160) NOT NULL,
	"description" text,
	"unit_name" varchar(40) NOT NULL,
	"price_vnd" integer NOT NULL,
	"status" "catalog_record_status" DEFAULT 'ACTIVE' NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"image_public_id" text,
	"image_version" bigint,
	"image_width" integer,
	"image_height" integer,
	"image_format" varchar(20),
	"image_alt" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_price_nonnegative_check" CHECK ("catalog_items"."price_vnd" >= 0),
	CONSTRAINT "catalog_items_sort_order_nonnegative_check" CHECK ("catalog_items"."sort_order" >= 0),
	CONSTRAINT "catalog_items_image_dimensions_positive_check" CHECK (("catalog_items"."image_width" IS NULL OR "catalog_items"."image_width" > 0) AND ("catalog_items"."image_height" IS NULL OR "catalog_items"."image_height" > 0))
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"item_name_snapshot" varchar(160) NOT NULL,
	"unit_name_snapshot" varchar(40) NOT NULL,
	"image_public_id_snapshot" text,
	"unit_price_snapshot_vnd" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_vnd" integer NOT NULL,
	"status" "order_line_status" DEFAULT 'ACTIVE' NOT NULL,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_lines_unit_price_nonnegative_check" CHECK ("order_lines"."unit_price_snapshot_vnd" >= 0),
	CONSTRAINT "order_lines_quantity_positive_check" CHECK ("order_lines"."quantity" > 0),
	CONSTRAINT "order_lines_total_formula_check" CHECK ("order_lines"."line_total_vnd" = "order_lines"."unit_price_snapshot_vnd" * "order_lines"."quantity"),
	CONSTRAINT "order_lines_void_consistency_check" CHECK (("order_lines"."status" = 'VOIDED' AND "order_lines"."voided_at" IS NOT NULL AND "order_lines"."void_reason" IS NOT NULL) OR ("order_lines"."status" = 'ACTIVE' AND "order_lines"."voided_at" IS NULL AND "order_lines"."void_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"venue_id" uuid NOT NULL,
	"service_point_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"status" "order_status" DEFAULT 'PENDING' NOT NULL,
	"note" text,
	"total_vnd" integer DEFAULT 0 NOT NULL,
	"accepted_at" timestamp with time zone,
	"served_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "orders_total_nonnegative_check" CHECK ("orders"."total_vnd" >= 0),
	CONSTRAINT "orders_status_timestamp_consistency_check" CHECK (("orders"."status" = 'PENDING' AND "orders"."accepted_at" IS NULL AND "orders"."served_at" IS NULL AND "orders"."cancelled_at" IS NULL AND "orders"."cancellation_reason" IS NULL) OR ("orders"."status" = 'ACCEPTED' AND "orders"."accepted_at" IS NOT NULL AND "orders"."served_at" IS NULL AND "orders"."cancelled_at" IS NULL AND "orders"."cancellation_reason" IS NULL) OR ("orders"."status" = 'SERVED' AND "orders"."accepted_at" IS NOT NULL AND "orders"."served_at" IS NOT NULL AND "orders"."cancelled_at" IS NULL AND "orders"."cancellation_reason" IS NULL) OR ("orders"."status" = 'CANCELLED' AND "orders"."served_at" IS NULL AND "orders"."cancelled_at" IS NOT NULL AND "orders"."cancellation_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "service_points" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"venue_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"status" "service_point_status" DEFAULT 'ACTIVE' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_points_slug_unique" UNIQUE("slug"),
	CONSTRAINT "service_points_sort_order_nonnegative_check" CHECK ("service_points"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"venue_id" uuid NOT NULL,
	"service_point_id" uuid NOT NULL,
	"bill_id" uuid,
	"status" "service_request_status" DEFAULT 'PENDING' NOT NULL,
	"message" text,
	"resolved_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_requests_terminal_timestamp_consistency_check" CHECK (("service_requests"."status" = 'RESOLVED' AND "service_requests"."resolved_at" IS NOT NULL AND "service_requests"."cancelled_at" IS NULL) OR ("service_requests"."status" = 'CANCELLED' AND "service_requests"."cancelled_at" IS NOT NULL AND "service_requests"."resolved_at" IS NULL) OR ("service_requests"."status" = 'PENDING' AND "service_requests"."resolved_at" IS NULL AND "service_requests"."cancelled_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Ho_Chi_Minh' NOT NULL,
	"currency" varchar(3) DEFAULT 'VND' NOT NULL,
	"status" "venue_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_admin_user_id_admin_users_id_fk" FOREIGN KEY ("actor_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_service_point_id_service_points_id_fk" FOREIGN KEY ("service_point_id") REFERENCES "public"."service_points"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_categories" ADD CONSTRAINT "catalog_categories_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_category_id_catalog_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."catalog_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_service_point_id_service_points_id_fk" FOREIGN KEY ("service_point_id") REFERENCES "public"."service_points"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_points" ADD CONSTRAINT "service_points_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_service_point_id_service_points_id_fk" FOREIGN KEY ("service_point_id") REFERENCES "public"."service_points"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_logs_venue_created_idx" ON "activity_logs" USING btree ("venue_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_logs_entity_idx" ON "activity_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_user_idx" ON "admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "admin_users_status_idx" ON "admin_users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_bill_per_service_point" ON "bills" USING btree ("service_point_id") WHERE "bills"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "bills_venue_status_idx" ON "bills" USING btree ("venue_id","status");--> statement-breakpoint
CREATE INDEX "bills_service_point_created_idx" ON "bills" USING btree ("service_point_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_categories_venue_slug_unique" ON "catalog_categories" USING btree ("venue_id","slug");--> statement-breakpoint
CREATE INDEX "catalog_categories_venue_status_sort_idx" ON "catalog_categories" USING btree ("venue_id","status","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_venue_slug_unique" ON "catalog_items" USING btree ("venue_id","slug");--> statement-breakpoint
CREATE INDEX "catalog_items_category_status_sort_idx" ON "catalog_items" USING btree ("category_id","status","is_available","sort_order");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_bill_status_idx" ON "order_lines" USING btree ("bill_id","status");--> statement-breakpoint
CREATE INDEX "orders_bill_created_idx" ON "orders" USING btree ("bill_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_service_point_status_idx" ON "orders" USING btree ("service_point_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "service_points_venue_code_unique" ON "service_points" USING btree ("venue_id","code");--> statement-breakpoint
CREATE INDEX "service_points_venue_status_idx" ON "service_points" USING btree ("venue_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "one_pending_service_request_per_service_point" ON "service_requests" USING btree ("service_point_id") WHERE "service_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "service_requests_venue_status_idx" ON "service_requests" USING btree ("venue_id","status");--> statement-breakpoint
CREATE INDEX "venues_status_idx" ON "venues" USING btree ("status");