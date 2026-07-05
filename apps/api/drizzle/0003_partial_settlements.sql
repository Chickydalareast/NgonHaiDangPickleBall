CREATE TYPE "public"."settlement_status" AS ENUM('ACTIVE', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."settlement_type" AS ENUM('PAID', 'WAIVED');--> statement-breakpoint
CREATE TABLE "order_line_settlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"bill_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"settlement_type" "settlement_type" NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_snapshot_vnd" integer NOT NULL,
	"amount_vnd" integer NOT NULL,
	"reason" text,
	"idempotency_key" varchar(128) NOT NULL,
	"status" "settlement_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by_admin_user_id" uuid NOT NULL,
	"reversed_by_admin_user_id" uuid,
	"reversal_reason" text,
	"reversal_idempotency_key" varchar(128),
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_line_settlements_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "order_line_settlements_reversal_idempotency_key_unique" UNIQUE("reversal_idempotency_key"),
	CONSTRAINT "order_line_settlements_quantity_positive_check" CHECK ("order_line_settlements"."quantity" > 0),
	CONSTRAINT "order_line_settlements_unit_price_nonnegative_check" CHECK ("order_line_settlements"."unit_price_snapshot_vnd" >= 0),
	CONSTRAINT "order_line_settlements_amount_formula_check" CHECK ("order_line_settlements"."amount_vnd" = "order_line_settlements"."unit_price_snapshot_vnd" * "order_line_settlements"."quantity"),
	CONSTRAINT "order_line_settlements_reason_consistency_check" CHECK (("order_line_settlements"."settlement_type" = 'PAID' AND "order_line_settlements"."reason" IS NULL) OR ("order_line_settlements"."settlement_type" = 'WAIVED' AND "order_line_settlements"."reason" IS NOT NULL)),
	CONSTRAINT "order_line_settlements_reversal_consistency_check" CHECK (("order_line_settlements"."status" = 'ACTIVE' AND "order_line_settlements"."reversed_by_admin_user_id" IS NULL AND "order_line_settlements"."reversal_reason" IS NULL AND "order_line_settlements"."reversal_idempotency_key" IS NULL AND "order_line_settlements"."reversed_at" IS NULL) OR ("order_line_settlements"."status" = 'REVERSED' AND "order_line_settlements"."reversed_by_admin_user_id" IS NOT NULL AND "order_line_settlements"."reversal_reason" IS NOT NULL AND "order_line_settlements"."reversal_idempotency_key" IS NOT NULL AND "order_line_settlements"."reversed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "order_line_settlements" ADD CONSTRAINT "order_line_settlements_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_settlements" ADD CONSTRAINT "order_line_settlements_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_settlements" ADD CONSTRAINT "order_line_settlements_created_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_settlements" ADD CONSTRAINT "order_line_settlements_reversed_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("reversed_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_line_settlements_bill_created_idx" ON "order_line_settlements" USING btree ("bill_id","created_at");--> statement-breakpoint
CREATE INDEX "order_line_settlements_line_status_idx" ON "order_line_settlements" USING btree ("order_line_id","status");