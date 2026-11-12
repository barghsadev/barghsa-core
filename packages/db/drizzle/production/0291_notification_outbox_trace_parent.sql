-- Existing rows stay null. The later default applies only to new inserts.
ALTER TABLE "notification_outbox" ADD COLUMN "trace_parent" text;--> statement-breakpoint
ALTER TABLE "notification_outbox" ALTER COLUMN "trace_parent" SET DEFAULT nullif(current_setting('barghsa.traceparent', true), '');--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_trace_parent_valid" CHECK (
      "notification_outbox"."trace_parent" ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$'
      AND substring("notification_outbox"."trace_parent", 4, 32) <> repeat('0', 32)
      AND substring("notification_outbox"."trace_parent", 37, 16) <> repeat('0', 16)) NOT VALID;--> statement-breakpoint
CREATE FUNCTION preserve_notification_trace_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trace_parent IS DISTINCT FROM OLD.trace_parent THEN
    RAISE EXCEPTION 'Notification trace context is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER notification_outbox_preserve_trace_parent BEFORE UPDATE OF trace_parent ON notification_outbox
 FOR EACH ROW EXECUTE FUNCTION preserve_notification_trace_parent();
