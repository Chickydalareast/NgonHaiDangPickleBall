DO $$
BEGIN
  CREATE TYPE "public"."order_line_kind" AS ENUM('CATALOG', 'MANUAL_PRODUCT', 'MANUAL_TIME');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint
ALTER TABLE "order_lines" ALTER COLUMN "catalog_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN IF NOT EXISTS "line_kind" "order_line_kind" DEFAULT 'CATALOG' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN IF NOT EXISTS "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN IF NOT EXISTS "billing_interval_minutes" integer;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_kind_metadata_check" CHECK (("order_lines"."line_kind" = 'CATALOG' AND "order_lines"."catalog_item_id" IS NOT NULL AND "order_lines"."duration_minutes" IS NULL AND "order_lines"."billing_interval_minutes" IS NULL) OR ("order_lines"."line_kind" = 'MANUAL_PRODUCT' AND "order_lines"."catalog_item_id" IS NULL AND "order_lines"."image_public_id_snapshot" IS NULL AND "order_lines"."duration_minutes" IS NULL AND "order_lines"."billing_interval_minutes" IS NULL) OR ("order_lines"."line_kind" = 'MANUAL_TIME' AND "order_lines"."catalog_item_id" IS NULL AND "order_lines"."image_public_id_snapshot" IS NULL AND "order_lines"."duration_minutes" IS NOT NULL AND "order_lines"."duration_minutes" > 0 AND "order_lines"."billing_interval_minutes" IS NOT NULL AND "order_lines"."billing_interval_minutes" > 0 AND "order_lines"."quantity" = CEIL("order_lines"."duration_minutes"::numeric / "order_lines"."billing_interval_minutes"::numeric)));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
