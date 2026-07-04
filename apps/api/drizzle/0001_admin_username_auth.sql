DO $$
DECLARE
  admin_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO admin_count FROM admin_users;

  IF admin_count > 1 THEN
    RAISE EXCEPTION 'Step 5 migration requires at most one existing admin user; found %', admin_count;
  END IF;

  IF admin_count = 1 THEN
    UPDATE admin_users SET email = 'admin';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "admin_users" DROP CONSTRAINT "admin_users_email_lowercase_check";--> statement-breakpoint
ALTER TABLE "admin_users" DROP CONSTRAINT "admin_users_email_unique";--> statement-breakpoint
ALTER TABLE "admin_users" RENAME COLUMN "email" TO "username";--> statement-breakpoint
ALTER TABLE "admin_users" ALTER COLUMN "username" SET DATA TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_username_unique" UNIQUE("username");--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_username_format_check" CHECK ("admin_users"."username" ~ '^[a-z0-9._-]{3,50}$');
