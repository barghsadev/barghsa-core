ALTER TABLE "electricity_quantity_increase_requests" ADD COLUMN "amendment_document" jsonb;--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD COLUMN "amendment_sha256" text;--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD CONSTRAINT "electricity_quantity_increase_amendment_check" CHECK (("electricity_quantity_increase_requests"."amendment_document" IS NULL AND "electricity_quantity_increase_requests"."amendment_sha256" IS NULL AND "electricity_quantity_increase_requests"."status" IN ('pending','rejected')) OR ("electricity_quantity_increase_requests"."amendment_document" IS NOT NULL AND "electricity_quantity_increase_requests"."amendment_sha256" ~ '^[0-9a-f]{64}$' AND "electricity_quantity_increase_requests"."status" NOT IN ('pending','rejected')));
--> statement-breakpoint
CREATE FUNCTION guard_electricity_increase_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Electricity increase history cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF OLD.status <> 'pending' THEN
    IF NEW.amendment_document IS DISTINCT FROM OLD.amendment_document
       OR NEW.amendment_sha256 IS DISTINCT FROM OLD.amendment_sha256
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.original_kwh IS DISTINCT FROM OLD.original_kwh
       OR NEW.requested_kwh IS DISTINCT FROM OLD.requested_kwh
       OR NEW.period_end IS DISTINCT FROM OLD.period_end
       OR NEW.version_id IS DISTINCT FROM OLD.version_id
       OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
      RAISE EXCEPTION 'Reviewed electricity increase terms are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF OLD.status = 'rejected' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Rejected electricity increase is terminal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER electricity_increase_amendment_guard
 BEFORE UPDATE OR DELETE ON electricity_quantity_increase_requests
 FOR EACH ROW EXECUTE FUNCTION guard_electricity_increase_amendment();
