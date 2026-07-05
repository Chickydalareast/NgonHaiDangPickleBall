CREATE TABLE "payment_batches" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "bill_id" uuid NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "total_vnd" integer NOT NULL,
  "created_by_admin_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_batches_idempotency_key_unique" UNIQUE("idempotency_key"),
  CONSTRAINT "payment_batches_total_nonnegative_check" CHECK ("payment_batches"."total_vnd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "court_rental_charges" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "bill_id" uuid NOT NULL,
  "order_line_id" uuid NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "start_time" varchar(5) NOT NULL,
  "duration_hours" integer NOT NULL,
  "base_amount_vnd" integer NOT NULL,
  "surcharge_amount_vnd" integer NOT NULL,
  "total_amount_vnd" integer NOT NULL,
  "breakdown" jsonb NOT NULL,
  "created_by_admin_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "court_rental_charges_order_line_id_unique" UNIQUE("order_line_id"),
  CONSTRAINT "court_rental_charges_idempotency_key_unique" UNIQUE("idempotency_key"),
  CONSTRAINT "court_rental_charges_duration_positive_check" CHECK ("court_rental_charges"."duration_hours" > 0),
  CONSTRAINT "court_rental_charges_base_nonnegative_check" CHECK ("court_rental_charges"."base_amount_vnd" >= 0),
  CONSTRAINT "court_rental_charges_surcharge_nonnegative_check" CHECK ("court_rental_charges"."surcharge_amount_vnd" >= 0),
  CONSTRAINT "court_rental_charges_total_formula_check" CHECK ("court_rental_charges"."total_amount_vnd" = "court_rental_charges"."base_amount_vnd" + "court_rental_charges"."surcharge_amount_vnd")
);
--> statement-breakpoint
ALTER TABLE "order_line_settlements" ADD COLUMN "payment_batch_id" uuid;
--> statement-breakpoint
ALTER TABLE "payment_batches" ADD CONSTRAINT "payment_batches_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_batches" ADD CONSTRAINT "payment_batches_created_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "court_rental_charges" ADD CONSTRAINT "court_rental_charges_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "court_rental_charges" ADD CONSTRAINT "court_rental_charges_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "court_rental_charges" ADD CONSTRAINT "court_rental_charges_created_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_line_settlements" ADD CONSTRAINT "order_line_settlements_payment_batch_id_payment_batches_id_fk" FOREIGN KEY ("payment_batch_id") REFERENCES "public"."payment_batches"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "payment_batches_bill_created_idx" ON "payment_batches" USING btree ("bill_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "one_court_rental_per_bill" ON "court_rental_charges" USING btree ("bill_id");
--> statement-breakpoint
CREATE INDEX "court_rental_charges_bill_idx" ON "court_rental_charges" USING btree ("bill_id");
--> statement-breakpoint
CREATE INDEX "order_line_settlements_payment_batch_idx" ON "order_line_settlements" USING btree ("payment_batch_id");
