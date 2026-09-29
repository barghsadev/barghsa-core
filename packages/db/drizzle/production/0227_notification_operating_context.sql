ALTER TABLE "in_app_notifications" ADD COLUMN "operating_context" text;--> statement-breakpoint
-- Preserve known destinations. Unclassified legacy account notices stay hidden
-- until they can be reviewed; guessing a context would expose staff content.
UPDATE in_app_notifications
SET operating_context='staff'
WHERE type ~ '^(admin|finance)\.'
   OR delivery_key LIKE 'refund-exhausted:%'
   OR link_route ~ '^/(admin|staff|crm)(/|\?|$)';--> statement-breakpoint
UPDATE in_app_notifications
SET operating_context='account'
WHERE operating_context IS NULL
  AND (type ~ '^auth\.' OR link_route ~ '^/settings/security(/|\?|$)');--> statement-breakpoint
UPDATE in_app_notifications
SET operating_context='customer'
WHERE operating_context IS NULL
  AND (profile_id IS NOT NULL
    OR type ~ '^(payment|profile)\.'
    OR link_route ~ '^/(app|dashboard|wallet|invoices|orders|electricity|saving|contracts|tickets|settings|support)(/|\?|$)');--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "chk_ian_operating_context" CHECK ("in_app_notifications"."operating_context" IS NULL OR "in_app_notifications"."operating_context" IN ('staff','customer','account'));
--> statement-breakpoint
-- Legacy SQL functions still insert without an operating_context column.
-- Classify those at the database boundary; unknown account-only rows remain
-- hidden instead of being guessed into a privileged or customer inbox.
CREATE FUNCTION classify_in_app_notification_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operating_context IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.type ~ '^(admin|finance)\.' OR NEW.delivery_key LIKE 'refund-exhausted:%'
    OR NEW.link_route ~ '^/(admin|staff|crm)(/|\?|$)' THEN
    NEW.operating_context := 'staff';
  ELSIF NEW.type ~ '^auth\.' OR NEW.link_route ~ '^/settings/security(/|\?|$)' THEN
    NEW.operating_context := 'account';
  ELSIF NEW.profile_id IS NOT NULL OR NEW.type ~ '^(payment|profile)\.'
    OR NEW.link_route ~ '^/(app|dashboard|wallet|invoices|orders|electricity|saving|contracts|tickets|settings|support)(/|\?|$)' THEN
    NEW.operating_context := 'customer';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_classify_in_app_notification_context
BEFORE INSERT ON in_app_notifications
FOR EACH ROW EXECUTE FUNCTION classify_in_app_notification_context();
