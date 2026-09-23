ALTER TYPE "public"."contract_state" ADD VALUE 'Rejected' BEFORE 'Cancelled';
--> statement-breakpoint
CREATE FUNCTION guard_rejected_electricity_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='Rejected' AND NEW.state<>'Rejected' THEN
    RAISE EXCEPTION 'Rejected electricity contracts are terminal' USING ERRCODE='23514';
  END IF;
  IF NEW.state='Rejected' AND OLD.state<>'Rejected' AND (
    NEW.service_type<>'electricity' OR OLD.state<>'AwaitingStaffReview'
    OR EXISTS(SELECT 1 FROM contract_publications WHERE contract_id=NEW.id)
  ) THEN
    RAISE EXCEPTION 'Only unpublished electricity contracts awaiting staff review can be rejected' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rejected_electricity_contract_guard BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION guard_rejected_electricity_contract();
--> statement-breakpoint
CREATE FUNCTION guard_rejected_electricity_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM contracts WHERE id=NEW.contract_id AND state='Rejected') THEN
    RAISE EXCEPTION 'Rejected electricity contracts cannot be published' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rejected_electricity_publication_guard BEFORE INSERT ON contract_publications
  FOR EACH ROW EXECUTE FUNCTION guard_rejected_electricity_publication();
