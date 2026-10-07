-- Preserve legacy approved rows without inventing a reason; enforce new decisions.
CREATE FUNCTION guard_electricity_increase_decision_reason() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' AND NEW.review_reason IS DISTINCT FROM OLD.review_reason THEN
    RAISE EXCEPTION 'Reviewed electricity increase reason is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status = 'pending' AND NEW.status NOT IN ('pending','expired')
     AND (NEW.review_reason IS NULL OR length(trim(NEW.review_reason)) NOT BETWEEN 1 AND 1000) THEN
    RAISE EXCEPTION 'Electricity increase review requires a reason' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER electricity_increase_decision_reason_guard
BEFORE UPDATE ON electricity_quantity_increase_requests
FOR EACH ROW EXECUTE FUNCTION guard_electricity_increase_decision_reason();
