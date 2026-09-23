-- Electricity invoices are issued after the initial contract version. Permit the
-- current unpublished review version to bind that invoice and its delivery term.
CREATE OR REPLACE FUNCTION guard_contract_activation_requirement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; rule contract_activation_rules%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Activation requirements cannot be deleted' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM contract_versions WHERE id=NEW.version_id AND contract_id=NEW.contract_id)
 THEN RAISE EXCEPTION 'Activation requirements must belong to their contract version' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO rule FROM contract_activation_rules WHERE service_type=parent.service_type FOR SHARE;
  IF NOT FOUND OR NEW.rule_revision<>rule.revision OR NEW.signature_required<>rule.signature_required
   OR NEW.payment_required<>rule.payment_required OR NEW.service_start_required<>rule.service_start_required
  THEN RAISE EXCEPTION 'Activation requirements must snapshot current service rules' USING ERRCODE='23514'; END IF;
  NEW.captured_at:=clock_timestamp();
 ELSE
  IF (to_jsonb(NEW)-'initial_invoice_id'-'service_starts_at'-'service_ends_at') IS DISTINCT FROM (to_jsonb(OLD)-'initial_invoice_id'-'service_starts_at'-'service_ends_at')
   OR parent.current_version_id<>NEW.version_id
   OR (parent.state NOT IN ('Draft','ChangesRequested')
     AND NOT (parent.state='AwaitingStaffReview' AND parent.service_type='electricity'))
   OR EXISTS(SELECT 1 FROM contract_publications WHERE version_id=NEW.version_id)
  THEN RAISE EXCEPTION 'Published activation requirements and rule snapshots are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.initial_invoice_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM invoices i WHERE i.id=NEW.initial_invoice_id AND i.profile_id=parent.profile_id
   AND i.state NOT IN ('Cancelled','Refunded','PartiallyRefunded') AND i.adjustment_for_invoice_id IS NULL
   AND (i.contract_id=parent.id::text OR (parent.order_id IS NOT NULL AND i.order_id=parent.order_id AND (i.contract_id IS NULL OR i.contract_id=parent.id::text)))
 ) THEN RAISE EXCEPTION 'Initial invoice must belong to the contract profile and order or contract' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND parent.service_type='electricity' AND parent.state='AwaitingStaffReview'
  AND NOT EXISTS(
   SELECT 1 FROM electricity_orders e JOIN invoices i ON i.order_id=e.id
   WHERE e.id=parent.order_id AND i.id=NEW.initial_invoice_id AND i.type='auto'
    AND i.profile_id=parent.profile_id AND i.replaces_invoice_id IS NULL
    AND i.adjustment_for_invoice_id IS NULL
    AND NEW.service_starts_at IS NOT DISTINCT FROM e.period_start
    AND NEW.service_ends_at IS NOT DISTINCT FROM e.period_end
  )
 THEN RAISE EXCEPTION 'Electricity activation must bind the submitted invoice and term' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Repair only electricity versions that were submitted before this link existed.
-- The repair runs once with the guard disabled because some versions are already
-- published; its exact invoice and term are derived from the immutable order.
ALTER TABLE contract_activation_requirements DISABLE TRIGGER contract_activation_requirement_guard;
WITH repaired AS (
 UPDATE contract_activation_requirements r
 SET initial_invoice_id=i.id,service_starts_at=e.period_start,service_ends_at=e.period_end
 FROM contracts c JOIN electricity_orders e ON e.id=c.order_id
 JOIN invoices i ON i.order_id=e.id AND i.profile_id=c.profile_id AND i.type='auto'
   AND i.adjustment_for_invoice_id IS NULL AND i.replaces_invoice_id IS NULL
   AND i.state NOT IN ('Cancelled','Refunded','PartiallyRefunded')
 WHERE r.contract_id=c.id AND r.version_id=c.current_version_id
   AND c.service_type='electricity' AND c.state NOT IN ('Completed','Cancelled','Rejected')
   AND r.initial_invoice_id IS NULL AND e.period_start IS NOT NULL AND e.period_end IS NOT NULL
 RETURNING c.id AS contract_id,c.profile_id,r.version_id,i.id AS invoice_id
)
INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
SELECT uuid_generate_v7(),p.user_id,'electricity.activation_requirement_repaired',
  jsonb_build_object('contractId',r.contract_id,'versionId',r.version_id,'invoiceId',r.invoice_id,'actorType','system'),
  uuid_generate_v7(),'127.0.0.1'
FROM repaired r JOIN profiles p ON p.id=r.profile_id;
ALTER TABLE contract_activation_requirements ENABLE TRIGGER contract_activation_requirement_guard;
--> statement-breakpoint
CREATE FUNCTION sync_electricity_order_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.service_type='electricity' AND NEW.state='Active' AND OLD.state<>'Active'
  AND NEW.order_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM electricity_orders e JOIN electricity_contracts ec ON ec.order_id=e.id
   WHERE e.id=NEW.order_id AND ec.contract_id=NEW.id
  ) THEN
  UPDATE electricity_orders SET status='active',updated_at=clock_timestamp()
    WHERE id=NEW.order_id AND status='approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Electricity order is not approved for activation'
    USING ERRCODE='23514',CONSTRAINT='contract_activation_prerequisites'; END IF;
  UPDATE electricity_contracts SET status='active',updated_at=clock_timestamp()
    WHERE contract_id=NEW.id AND order_id=NEW.order_id;
  UPDATE orders SET status='CONFIRMED',updated_at=clock_timestamp()
    WHERE id=NEW.order_id AND status='PENDING';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER contracts_electricity_activation_sync AFTER UPDATE OF state ON contracts
 FOR EACH ROW EXECUTE FUNCTION sync_electricity_order_activation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_rejected_electricity_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_paid bigint;
BEGIN
 IF TG_OP='INSERT' THEN previous_paid:=0; ELSE previous_paid:=OLD.paid_amount; END IF;
 IF NEW.order_id IS NOT NULL AND NEW.paid_amount>previous_paid AND EXISTS(
  SELECT 1 FROM electricity_orders e WHERE e.id=NEW.order_id
    AND e.status IN ('changes_requested','rejected','cancelled')
 ) THEN RAISE EXCEPTION 'Electricity order is unavailable for payment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
